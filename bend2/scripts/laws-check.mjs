#!/usr/bin/env node
// The negative control for the tree's law gate. The entry module imports
// bend2/src/coordinator/laws.bend, so a compile of the entry verifies every law
// the module states. This script proves that each law is really verified: for
// every `law` in bend2/src it copies the tree, removes that law's proof, and
// requires the entry's compile to fail. A law whose proof can be removed while
// the entry still compiles is not part of the gate, and the script reports it.
//
// Usage: node bend2/scripts/laws-check.mjs [compiler]
//
// Importing this module performs no work: the executable behavior lives in
// main(), which runs only when this file is the process entry.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyCase } from './capacity-controls/classify.mjs';
import { MUTATIONS } from './laws-mutations.mjs';
import { ENTRY, ENV, ROOT, SRC, laws, proofBlockRange, removeProof, resolveBend } from './laws-common.mjs';

// The shared primitives live in laws-common.mjs and are re-exported here so
// the checker keeps one import surface; helper modules import the leaf
// directly, which keeps every module dependency graph acyclic.
export { ENTRY, ENV, ROOT, SRC, laws, proofBlockRange, removeProof, resolveBend };

// A definition carries its own expected and observed constructor metadata when
// the definition owner has bound it; there is no external source for it.
function definitionExpectation(mutation) {
  if (mutation.expected === undefined && mutation.observed === undefined) return undefined;
  return { expected: mutation.expected, observed: mutation.observed };
}

function run(bend, args, cwd) {
  return execFileSync(bend, args, { env: ENV, cwd, encoding: 'utf8', maxBuffer: Infinity });
}

// One compile observation with its complete separate raw streams (exact
// bytes, decoded only where classification needs text) and its actual
// terminal outcome, including spawn failures.
function compile(bend, cwd) {
  const started = Date.now() / 1000;
  const result = spawnSync(bend, [ENTRY, '--check-only'], {
    env: ENV, cwd, maxBuffer: Infinity, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ended = Date.now() / 1000;
  if (result.error) {
    return {
      ok: false,
      stdout: result.stdout ?? Buffer.alloc(0),
      stderr: result.stderr ?? Buffer.alloc(0),
      exitCode: null,
      signal: null,
      spawnError: String(result.error.code ?? result.error),
      started,
      ended,
    };
  }
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: result.stderr ?? Buffer.alloc(0),
    exitCode: result.status,
    signal: result.signal ?? null,
    spawnError: null,
    started,
    ended,
  };
}

function outcomeOf(receipt) {
  if (receipt.spawnError !== null) return { state: 'spawn-error', exit_code: null, signal: null, spawn_error: receipt.spawnError };
  if (receipt.signal !== null) return { state: 'signalled', exit_code: null, signal: receipt.signal, spawn_error: null };
  return { state: 'exited', exit_code: receipt.exitCode, signal: null, spawn_error: null };
}

// The complete gate invocation: resolve the compiler, copy the tree once into
// a run-private scratch directory, and run the baseline, every proof-removal
// control and every mutation control against that copy. Scratch is unique per
// run, so concurrent invocations in one checkout never share state, and every
// control restores the file it mutated from bytes captured at copy time.
export function main(argv = process.argv.slice(2)) {
const BEND = resolveBend(argv[0]);
mkdirSync(join(ROOT, '.scratch'), { recursive: true });
const SCRATCH = mkdtempSync(join(ROOT, '.scratch', 'bend2-laws-check-'));
const version = run(BEND, ['version'], ROOT).trim();
if (version !== 'bend 2.0.25') {
  console.error(`expected bend 2.0.25, got: ${version}`);
  process.exit(1);
}

cpSync(join(ROOT, 'bend2'), join(SCRATCH, 'bend2'), { recursive: true });

const rows = laws(join(SCRATCH, 'bend2', 'src'));
let failures = 0;

// Pristine text of every module the controls below mutate, read from the
// scratch copy itself as explicit UTF-8, so discovery, textual replacement
// and every restore use the one copied snapshot and never re-read the live
// tree.
const pristine = new Map();
// Repo-relative control paths are derived from the copied tree root, so they
// select the copied module and never re-derive a path through this run's
// scratch directory name.
const repoPathOf = (file) => join('bend2', relative(join(SCRATCH, 'bend2'), file));
const capture = (repoPath) => {
  if (!pristine.has(repoPath)) pristine.set(repoPath, readFileSync(join(SCRATCH, repoPath), 'utf8'));
};
for (const { file } of rows) capture(repoPathOf(file));
for (const mutation of MUTATIONS) capture(mutation.file);

// Raw per-case evidence for the consumption step: every control's complete
// separate raw streams, the parent classifier verdict, the exact applied
// delta and the run identity are retained under the run-private scratch,
// including the baseline and every passing negative control. The index is
// rewritten after each case with its actual terminal outcome and argv, and
// marks the record incomplete until the final control finishes; a run that
// stops early leaves a partial index that says so. Child streams stay raw
// compiler bytes: the parent rows and this index carry the classification.
mkdirSync(join(SCRATCH, "evidence"), { recursive: true });
const evidenceIndex = [];
let evidenceComplete = false;
function sha256Of(data) {
  return createHash("sha256").update(data).digest("hex");
}
const gitIdentity = () => {
  if (!existsSync(join(ROOT, ".git"))) return { head: null, tree: null, bend2_tree: null };
  const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: Infinity }).trim();
  return { head: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}"), bend2_tree: git("rev-parse", "HEAD:bend2") };
};
const ordinaryNonce = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
const runIdentity = {
  source: gitIdentity(),
  compiler: { path: BEND, version, sha256: sha256Of(readFileSync(BEND)) },
  entry: ENTRY,
  checker_argv: [BEND, ENTRY, "--check-only"],
  origin: {
    workflow: process.env.GITHUB_WORKFLOW ?? null,
    run_id: process.env.GITHUB_RUN_ID ?? null,
    run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    jobs: process.env.GITHUB_JOB ? [process.env.GITHUB_JOB] : [],
    image_os: process.env.ImageOS ?? null,
    image_version: process.env.ImageVersion ?? null,
  },
  invocation: `ordinary:${ordinaryNonce}`,
  nonce: ordinaryNonce,
  verifier: {
    checker_sha256: sha256Of(readFileSync(join(ROOT, "bend2", "scripts", "laws-check.mjs"))),
    laws_common_module_sha256: sha256Of(readFileSync(join(ROOT, "bend2", "scripts", "laws-common.mjs"))),
    definitions_module_sha256: sha256Of(readFileSync(join(ROOT, "bend2", "scripts", "laws-mutations.mjs"))),
    classifier_module_sha256: sha256Of(readFileSync(join(ROOT, "bend2", "scripts", "capacity-controls", "classify.mjs"))),
    work_set_module_sha256: sha256Of(readFileSync(join(ROOT, "bend2", "scripts", "capacity-controls", "work-set.mjs"))),
    aggregate_module_sha256: sha256Of(readFileSync(join(ROOT, "bend2", "scripts", "capacity-controls", "aggregate.mjs"))),
    group_run_module_sha256: sha256Of(readFileSync(join(ROOT, "bend2", "scripts", "capacity-controls", "group-run.mjs"))),
  },
};
const writeEvidenceIndex = () => {
  // Complete admitted-input inventory: the full captured tree with byte
  // digests, keyed by path, so consumers verify non-target files against
  // their originals and bind every input through completion. The run block
  // mirrors index_path and scratch so envelope and index agree on the
  // launched-run location without fallback parsing.
  const inputs = {};
  for (const [path, bytes] of pristine.entries()) inputs[path] = { sha256: sha256Of(bytes) };
  const run = {
    ...runIdentity,
    index_path: join(SCRATCH, 'evidence', 'index.json'),
    scratch: SCRATCH,
  };
  writeFileSync(join(SCRATCH, 'evidence', 'index.json'), JSON.stringify({
    schema: 'capacity-controls/ordinary-evidence@2',
    run,
    inputs,
    complete: evidenceComplete,
    cases: evidenceIndex,
  }, null, 2) + '\n');
};
const retainEvidence = (id, verdict, applied, delta, stdout, stderr, outcome, argv, started, ended) => {
  const stem = id.replace(/[^A-Za-z0-9_.-]/g, "_");
  const stdoutName = `${stem}.stdout`;
  const stderrName = `${stem}.stderr`;
  writeFileSync(join(SCRATCH, "evidence", stdoutName), stdout);
  writeFileSync(join(SCRATCH, "evidence", stderrName), stderr);
  let changed = null;
  if (delta !== null) {
    const changedName = `${stem}.changed`;
    writeFileSync(join(SCRATCH, "evidence", changedName), Buffer.from(delta.changedText, "utf8"));
    changed = {
      original_sha256: delta.original_sha256,
      changed_sha256: delta.changed_sha256,
      changed_path: `evidence/${changedName}`,
    };
  }
  evidenceIndex.push({
    id,
    applied,
    // The parent classifier verdict is retained separately from the raw
    // child streams: the child stdout is compiler bytes, never checker rows.
    verdict: verdict === null ? null : {
      class: verdict.class, attributed_law: verdict.attributedLaw, qualified: verdict.qualified === true,
    },
    // The recorded command is the compile that actually ran, whether or not
    // the setup transform was applied.
    argv,
    delta: changed,
    stdout: { path: `evidence/${stdoutName}`, bytes: stdout.byteLength, sha256: sha256Of(stdout) },
    stderr: { path: `evidence/${stderrName}`, bytes: stderr.byteLength, sha256: sha256Of(stderr) },
    outcome,
    started,
    ended,
  });
  writeEvidenceIndex();
};
function sha256Of(data) {
  return createHash("sha256").update(data).digest("hex");
}

const baseline = compile(BEND, SCRATCH);
// The consumer envelope names the run identity and the retained index path
// as the first stdout line; the checker rows and final summary keep their
// existing contract, and the child streams stay raw compiler bytes.
console.log(JSON.stringify({
  schema: 'capacity-controls/ordinary-run@1',
  index_path: join(SCRATCH, 'evidence', 'index.json'),
  scratch: SCRATCH,
  source: runIdentity.source,
  compiler: runIdentity.compiler,
  entry: ENTRY,
  origin: runIdentity.origin,
  invocation: runIdentity.invocation,
  verifier: runIdentity.verifier,
}));
retainEvidence('baseline', {
  class: baseline.ok ? 'baseline-ok' : 'baseline-failed', attributedLaw: null, qualified: baseline.ok,
}, true, null, baseline.stdout, baseline.stderr, outcomeOf(baseline),
  [BEND, ENTRY, '--check-only'], baseline.started, baseline.ended);
console.log(JSON.stringify({ check: 'entry compiles with every law proven', passed: baseline.ok }));
if (!baseline.ok) {
  failures++;
  console.log(baseline.stderr.toString("utf8").trimEnd());
  if (baseline.stdout.toString("utf8").trimEnd() !== '') console.log(baseline.stdout.toString("utf8").trimEnd());
  console.log(`laws-check: red - ${rows.length} laws, 1 compile, ${failures} failure; proof-removal controls did not run`);
  process.exit(1);
}

for (const { law, file } of rows) {
  const repoPath = repoPathOf(file);
  const copied = join(SCRATCH, repoPath);
  const originalBytes = pristine.get(repoPath);
  const originalText = originalBytes.toString('utf8');
  let removed = false;
  let changedText = null;
  let expectedChangedText = null;
  let control = null;
  try {
    removed = removeProof(copied, law);
    if (removed) {
      changedText = readFileSync(copied, 'utf8');
      const lines = originalText.split('\n');
      const block = proofBlockRange(originalText, law);
      lines.splice(block.start, block.end - block.start);
      expectedChangedText = lines.join('\n');
      if (changedText !== expectedChangedText) {
        throw new Error(`laws-check: proof application mismatch for ${law}`);
      }
    }
    control = compile(BEND, SCRATCH);
    const proofDelta = removed ? {
      original_sha256: sha256Of(originalBytes),
      changed_sha256: sha256Of(Buffer.from(changedText, 'utf8')),
      changedText,
    } : null;
    const verdict = classifyCase({
      control: { kind: 'proof-removal', law, module: repoPath },
      state: outcomeOf(control).state,
      exitCode: control.exitCode,
      signal: control.signal,
      spawnError: control.spawnError,
      stderrText: control.stderr.toString("utf8"),
      baselineOk: baseline.ok,
      delta: removed ? { changedText, expectedChangedText } : null,
      supplied: null,
    });
    retainEvidence(`proof:${law}`, verdict, removed, proofDelta, control.stdout, control.stderr, outcomeOf(control),
      [BEND, ENTRY, '--check-only'], control.started, control.ended);
    const passed = removed && verdict.class === 'intended-law-refusal' && verdict.qualified;
    if (!passed) failures++;
    console.log(JSON.stringify({
      law,
      module: repoPath,
      proof: removed ? 'removed' : 'missing',
      gate: passed ? 'refuses' : 'accepts',
      passed,
    }));
    if (!passed) console.log(control.stderr.toString("utf8").trimEnd());
  } finally {
    writeFileSync(copied, originalBytes);
    if (!readFileSync(copied).equals(originalBytes)) {
      console.error(`laws-check: restoration verification failed for ${repoPath}`);
      process.exit(1);
    }
  }
}

// A mutation is a deliberate change to an implementation, made in the scratch
// copy, that a law must refuse. The proof-removal loop above shows every law's
// proof is required; these controls show that a law's right-hand side is not
// the function under test, so that changing the function breaks the proof. A
// mutation that still compiles means the law it names does not bind the code
// it claims to bind, and it is reported as a failure.
// The mutation controls are the checker's executed definitions, imported
// from laws-mutations.mjs: the array holds the initial literal and every
// later push in source order. This file carries no definition bytes of its own.

for (const mutation of MUTATIONS) {
  const copied = join(SCRATCH, mutation.file);
  const originalBytes = pristine.get(mutation.file);
  const text = originalBytes.toString("utf8");
  const applied = text.includes(mutation.find);
  let changedText = null;
  let expectedChangedText = null;
  let control = null;
  try {
    if (applied) {
      expectedChangedText = text.replace(mutation.find, mutation.replace);
      writeFileSync(copied, expectedChangedText);
      changedText = expectedChangedText;
    }
    control = compile(BEND, SCRATCH);
    const mutationDelta = applied ? {
      original_sha256: sha256Of(originalBytes),
      changed_sha256: sha256Of(Buffer.from(changedText, 'utf8')),
      changedText,
    } : null;
    const verdict = classifyCase({
      control: { kind: 'mutation', law: mutation.law, module: mutation.file },
      expectation: definitionExpectation(mutation),
      location: mutation.location,
      state: outcomeOf(control).state,
      exitCode: control.exitCode,
      signal: control.signal,
      spawnError: control.spawnError,
      stderrText: control.stderr.toString("utf8"),
      baselineOk: baseline.ok,
      delta: applied ? { changedText, expectedChangedText } : null,
      supplied: null,
    });
    retainEvidence(`mutation:${mutation.name}`, verdict, applied, mutationDelta, control.stdout, control.stderr, outcomeOf(control),
      [BEND, ENTRY, '--check-only'], control.started, control.ended);
    const passed = applied && verdict.class === 'intended-law-refusal' && verdict.qualified;
    if (!passed) failures++;
    console.log(JSON.stringify({
      mutation: mutation.name,
      law: mutation.law,
      applied,
      gate: passed ? 'refuses' : 'accepts',
      passed,
    }));
    if (!passed) console.log(control.stderr.toString("utf8").trimEnd());
  } finally {
    writeFileSync(copied, originalBytes);
    if (!readFileSync(copied).equals(originalBytes)) {
      console.error(`laws-check: restoration verification failed for ${mutation.file}`);
      process.exit(1);
    }
  }
}

evidenceComplete = true;
writeEvidenceIndex();

console.log(`laws-check: ${failures === 0 ? 'green' : 'red'} - ${rows.length} laws, ${MUTATIONS.length} mutations, ${rows.length + MUTATIONS.length + 1} compiles, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
}

// Mode dispatch for the module-group evidence workflow. The ordinary complete
// invocation runs when the first argument is not a mode flag.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === '--discover') {
    const { discoverCli } = await import('./capacity-controls/work-set.mjs');
    discoverCli(rest);
  } else if (mode === '--group') {
    const { groupCli } = await import('./capacity-controls/group-run.mjs');
    await groupCli(process.argv.slice(2));
  } else if (mode === '--aggregate') {
    const { aggregateCli } = await import('./capacity-controls/aggregate.mjs');
    await aggregateCli(rest);
  } else if (mode === '--classify') {
    const { classifyCli } = await import('./capacity-controls/aggregate.mjs');
    await classifyCli(process.argv.slice(2));
  } else if (typeof mode === 'string' && mode.startsWith('-')) {
    // Refusal happens here, before any compiler resolution or effect.
    console.error(`laws-check: unknown mode ${mode}; expected --discover, --group, --aggregate or --classify`);
    process.exit(2);
  } else {
    main();
  }
}
