// CDP runtime lane: the packaged credential-free bootstrap.
//
// Contract: docs/bend2/semantic-context-spec.md, "Runtime contract". The target keeper
// launches this module under `/usr/bin/env -i`. It reads the complete explicit target
// launch document from initial stdin through EOF, validates it, and calls
// `process.execve` with the selected absolute target Node, argv and complete target
// environment. Initial target stdin is EOF: the document is read through EOF and execve
// transfers the same descriptor position.
//
// The process image is replaced in place, so the target keeps this process's pid: no
// spawning wrapper survives, and the target's parent stays the recorded target keeper.
// There is no size or time cutoff on the document read.
//
// Target prevalidation (security follow-up S1): a resolved real path alone does not
// establish that the executable can be loaded. Before execve the resolved target must be
// an existing regular file with execute permission, and the resolution must have
// succeeded. A residual execve failure still keeps its raw error code and this process's
// actual exit status.
//
// Phase evidence: the record written before `execve` is `launchPrepared`, and it states
// its own phase. A prepared record is not a successful image replacement and not a
// started target: without positive retained evidence of a later phase, the phase and its
// cause remain unknown. Nothing here claims a target-side failure.
//
// Usage: /usr/bin/env -i <node> bootstrap.mjs   (launch document on stdin)

import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { admitLaunchDocument } from './bootstrap-admission.mjs';

const SELF = fileURLToPath(import.meta.url);

async function readStdinToEnd() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// The selected executable: its declared path, its resolved real path, and the observed
// kind/permission facts the prevalidation checked.
function executablePrevalidation(declared) {
  let resolved;
  try {
    resolved = realpathSync(declared);
  } catch (error) {
    return { ok: false, condition: 'launchNodeUnresolved', path: declared, code: error.code ?? null };
  }
  let stats;
  try {
    stats = statSync(resolved);
  } catch (error) {
    return { ok: false, condition: 'launchNodeUnavailable', path: declared, resolved, code: error.code ?? null };
  }
  if (!stats.isFile()) {
    return { ok: false, condition: 'launchNodeNotRegular', path: declared, resolved, code: null };
  }
  try {
    accessSync(resolved, constants.X_OK);
  } catch (error) {
    return { ok: false, condition: 'launchNodeNotExecutable', path: declared, resolved, code: error.code ?? null };
  }
  return {
    ok: true,
    executable: {
      path: declared,
      resolved,
      size: stats.size,
      mode: (stats.mode & 0o7777).toString(8),
    },
  };
}

function report(record) {
  process.stderr.write(`${JSON.stringify(record)}\n`);
}

const document = await readStdinToEnd();
const admitted = admitLaunchDocument(document);
if (!admitted.ok) {
  report({
    version: 1,
    kind: 'launchRefused',
    phase: 'document',
    condition: admitted.condition,
    detail: admitted.detail,
  });
  process.exit(2);
}

const prevalidation = executablePrevalidation(admitted.doc.node);
if (!prevalidation.ok) {
  report({
    version: 1,
    kind: 'launchRefused',
    phase: 'prevalidation',
    condition: prevalidation.condition,
    detail: { path: prevalidation.path, resolved: prevalidation.resolved ?? null, code: prevalidation.code },
  });
  process.exit(3);
}

// The bootstrap and final executable identities are recorded separately, before the
// image is replaced. This record names its phase and asserts no later phase.
report({
  version: 1,
  kind: 'launchPrepared',
  phase: 'pre-exec',
  bootstrap: { path: SELF },
  executable: prevalidation.executable,
  argv: admitted.doc.argv,
  envKeys: Object.keys(admitted.doc.env).sort(),
});

if (typeof process.execve !== 'function') {
  // The floor is Node 22.15.0. Exec-in-place is unavailable without execve, and a spawn
  // would leave a wrapper in the process relationship, so this refuses rather than
  // substituting one.
  report({
    version: 1,
    kind: 'launchExecUnavailable',
    phase: 'pre-exec',
    condition: 'launchExecUnavailable',
    detail: { node: process.version },
  });
  process.exit(4);
}

try {
  process.execve(admitted.doc.node, admitted.doc.argv, admitted.doc.env);
} catch (error) {
  // A residual execve failure keeps its raw error code; this process's exit status is
  // the observed status and no target phase is inferred from it.
  report({
    version: 1,
    kind: 'launchExecFailed',
    phase: 'pre-exec',
    condition: 'launchExecFailed',
    detail: { code: error.code ?? null, message: error.message },
  });
  process.exit(5);
}
