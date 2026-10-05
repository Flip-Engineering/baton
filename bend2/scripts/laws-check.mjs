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
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

// One compile observation with its complete separate streams and its actual
// terminal outcome, including spawn failures.
function compile(bend, cwd) {
  const result = spawnSync(bend, [ENTRY, '--check-only'], {
    env: ENV, cwd, encoding: 'utf8', maxBuffer: Infinity, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    return {
      ok: false,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: null,
      signal: null,
      spawnError: String(result.error.code ?? result.error),
    };
  }
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status,
    signal: result.signal ?? null,
    spawnError: null,
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
// output bytes are retained under the run-private scratch, including the
// baseline and every passing negative control. The index is rewritten after
// each case with its actual terminal outcome and argv, and marks the record
// incomplete until the final control finishes; a run that stops early leaves
// a partial index that says so. The stdout row and summary contract is
// unchanged.
mkdirSync(join(SCRATCH, 'evidence'), { recursive: true });
const evidenceIndex = [];
let evidenceComplete = false;
const writeEvidenceIndex = () => {
  writeFileSync(join(SCRATCH, 'evidence', 'index.json'), JSON.stringify({
    schema: 'capacity-controls/ordinary-evidence@1',
    complete: evidenceComplete,
    cases: evidenceIndex,
  }, null, 2) + '\n');
};
const retainEvidence = (id, stdout, stderr, outcome, argv) => {
  const stem = id.replace(/[^A-Za-z0-9_.-]/g, '_');
  const stdoutName = `${stem}.stdout`;
  const stderrName = `${stem}.stderr`;
  writeFileSync(join(SCRATCH, 'evidence', stdoutName), stdout);
  writeFileSync(join(SCRATCH, 'evidence', stderrName), stderr);
  evidenceIndex.push({
    id,
    stdout: { path: `evidence/${stdoutName}`, bytes: Buffer.byteLength(stdout), sha256: sha256Of(stdout) },
    stderr: { path: `evidence/${stderrName}`, bytes: Buffer.byteLength(stderr), sha256: sha256Of(stderr) },
    outcome,
    argv,
  });
  writeEvidenceIndex();
};
function sha256Of(text) {
  return createHash('sha256').update(text).digest('hex');
}

const baseline = compile(BEND, SCRATCH);
retainEvidence('baseline', baseline.stdout, baseline.stderr, outcomeOf(baseline), [BEND, ENTRY, '--check-only']);
console.log(JSON.stringify({ check: 'entry compiles with every law proven', passed: baseline.ok }));
if (!baseline.ok) {
  failures++;
  console.log(baseline.output.trimEnd());
  console.log(`laws-check: red - ${rows.length} laws, 1 compile, ${failures} failure; proof-removal controls did not run`);
  process.exit(1);
}

for (const { law, file } of rows) {
  const repoPath = repoPathOf(file);
  const copied = join(SCRATCH, repoPath);
  const originalText = pristine.get(repoPath);
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
    retainEvidence(`proof:${law}`, control.stdout, control.stderr, outcomeOf(control),
      removed ? [BEND, ENTRY, '--check-only'] : null);
    const verdict = classifyCase({
      control: { kind: 'proof-removal', law, module: repoPath },
      state: outcomeOf(control).state,
      exitCode: control.exitCode,
      signal: control.signal,
      spawnError: control.spawnError,
      stderrText: control.stderr,
      baselineOk: baseline.ok,
      delta: removed ? { changedText, expectedChangedText } : null,
      supplied: null,
    });
    const passed = removed && verdict.class === 'intended-law-refusal' && verdict.qualified;
    if (!passed) failures++;
    console.log(JSON.stringify({
      law,
      module: repoPath,
      proof: removed ? 'removed' : 'missing',
      gate: passed ? 'refuses' : 'accepts',
      passed,
    }));
    if (!passed) console.log(control.stderr.trimEnd());
  } finally {
    writeFileSync(copied, pristine.get(repoPath));
    if (readFileSync(copied, 'utf8') !== pristine.get(repoPath)) {
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
  const text = pristine.get(mutation.file);
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
    retainEvidence(`mutation:${mutation.name}`, control.stdout, control.stderr, outcomeOf(control),
      applied ? [BEND, ENTRY, '--check-only'] : null);
    const verdict = classifyCase({
      control: { kind: 'mutation', law: mutation.law, module: mutation.file },
      expectation: definitionExpectation(mutation),
      location: mutation.location,
      state: outcomeOf(control).state,
      exitCode: control.exitCode,
      signal: control.signal,
      spawnError: control.spawnError,
      stderrText: control.stderr,
      baselineOk: baseline.ok,
      delta: applied ? { changedText, expectedChangedText } : null,
      supplied: null,
    });
    const passed = applied && verdict.class === 'intended-law-refusal' && verdict.qualified;
    if (!passed) failures++;
    console.log(JSON.stringify({
      mutation: mutation.name,
      law: mutation.law,
      applied,
      gate: passed ? 'refuses' : 'accepts',
      passed,
    }));
    if (!passed) console.log(control.stderr.trimEnd());
  } finally {
    writeFileSync(copied, pristine.get(mutation.file));
    if (readFileSync(copied, 'utf8') !== pristine.get(mutation.file)) {
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
    await groupCli(rest);
  } else if (mode === '--aggregate') {
    const { aggregateCli } = await import('./capacity-controls/aggregate.mjs');
    await aggregateCli(rest);
  } else if (mode === '--classify') {
    const { classifyCli } = await import('./capacity-controls/aggregate.mjs');
    await classifyCli(rest);
  } else if (typeof mode === 'string' && mode.startsWith('-')) {
    // Refusal happens here, before any compiler resolution or effect.
    console.error(`laws-check: unknown mode ${mode}; expected --discover, --group, --aggregate or --classify`);
    process.exit(2);
  } else {
    main();
  }
}
