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

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expectationMet, intendedMutationRefusal, isTodoRefusal, refusedNormally } from './capacity-controls/classify.mjs';
import { MUTATIONS } from './laws-mutations.mjs';

// A definition carries its own expected and observed constructor metadata when
// the definition owner has bound it; there is no external source for it.
function definitionExpectation(mutation) {
  if (mutation.expected === undefined && mutation.observed === undefined) return undefined;
  return { expected: mutation.expected, observed: mutation.observed };
}

export const ROOT = resolve(import.meta.dirname, '..', '..');
export const SRC = join(ROOT, 'bend2', 'src');
export const ENTRY = join('bend2', 'src', 'coordinator', 'main.bend');
export const ENV = { ...process.env, BEND_NO_TELEMETRY: '1' };

export function resolveBend(selected = process.argv[2]) {
  const candidates = [
    selected,
    process.env.BEND,
    join(ROOT, 'node_modules', '.bend', 'bin', 'bend'),
    join(ROOT, '.bend', 'bin', 'bend'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  console.error('Bend is unavailable. Set BEND to an installed Bend 2.0.25 executable.');
  process.exit(1);
}

function run(bend, args, cwd) {
  return execFileSync(bend, args, { env: ENV, cwd, encoding: 'utf8', maxBuffer: Infinity });
}

function compile(bend, cwd) {
  try {
    const stdout = run(bend, [ENTRY, '--check-only'], cwd);
    return { ok: true, output: stdout, exitCode: 0, signal: null };
  } catch (err) {
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}`, exitCode: err.status ?? null, signal: err.signal ?? null };
  }
}

function discover(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...discover(full));
    else if (entry.name.endsWith('.bend')) found.push(full);
  }
  return found.sort();
}

// One row per `law <name>:` in the tree, with the module that states it.
// Discovery reads the given copied tree so a run's records bind the same
// snapshot its compiles use; the default is the live source.
export function laws(srcDir = SRC) {
  const rows = [];
  for (const file of discover(srcDir)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      const match = /^law ([A-Za-z0-9_]+):/.exec(line);
      if (match) rows.push({ law: match[1], file });
    }
  }
  return rows;
}

// The `def <name>(...)` block that proves <name>: the def line and every
// following blank or indented line. Returns the [start, end) line range with
// the split lines, or null when no such def exists.
export function proofBlockRange(text, name) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`def ${name}(`));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end++;
  return { start, end, lines };
}

// Remove the proof block for <name> from modulePath. Returns false when no
// such def exists.
export function removeProof(modulePath, name) {
  const text = readFileSync(modulePath, 'utf8');
  const block = proofBlockRange(text, name);
  if (!block) return false;
  block.lines.splice(block.start, block.end - block.start);
  writeFileSync(modulePath, block.lines.join('\n'));
  return true;
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

const rows = laws();
let failures = 0;

// Pristine bytes of every module the controls below mutate, read from the
// scratch copy itself, so discovery and every restore use the one copied
// snapshot and never re-read the live tree.
const pristine = new Map();
const capture = (repoPath) => {
  if (!pristine.has(repoPath)) pristine.set(repoPath, readFileSync(join(SCRATCH, repoPath)));
};
for (const { file } of rows) capture(relative(ROOT, file));
for (const mutation of MUTATIONS) capture(mutation.file);

// Raw per-case evidence for the consumption step: every control's complete
// output bytes are retained under the run-private scratch, including the
// baseline and every passing negative control. The stdout row and summary
// contract is unchanged.
mkdirSync(join(SCRATCH, 'evidence'), { recursive: true });
const evidenceIndex = [];
const retainEvidence = (id, output) => {
  const name = `${id.replace(/[^A-Za-z0-9_.-]/g, '_')}.output`;
  writeFileSync(join(SCRATCH, 'evidence', name), output);
  evidenceIndex.push({ id, path: `evidence/${name}`, bytes: Buffer.byteLength(output), sha256: sha256Of(output) });
};
function sha256Of(text) {
  return createHash('sha256').update(text).digest('hex');
}

const baseline = compile(BEND, SCRATCH);
retainEvidence('baseline', baseline.output);
console.log(JSON.stringify({ check: 'entry compiles with every law proven', passed: baseline.ok }));
if (!baseline.ok) {
  failures++;
  console.log(baseline.output.trimEnd());
  console.log(`laws-check: red - ${rows.length} laws, 1 compile, ${failures} failure; proof-removal controls did not run`);
  process.exit(1);
}

for (const { law, file } of rows) {
  const repoPath = relative(ROOT, file);
  const copied = join(SCRATCH, repoPath);
  const removed = removeProof(copied, law);
  const control = removed ? compile(BEND, SCRATCH) : { ok: true, output: '', exitCode: null, signal: null };
  retainEvidence(`proof:${law}`, control.output);
  const passed = removed && refusedNormally(control) && isTodoRefusal(control.output);
  if (!passed) failures++;
  console.log(JSON.stringify({
    law,
    module: relative(ROOT, file),
    proof: removed ? 'removed' : 'missing',
    gate: passed ? 'refuses' : 'accepts',
    passed,
  }));
  if (!passed) console.log(control.output.trimEnd());
  writeFileSync(copied, pristine.get(repoPath));
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
  writeFileSync(copied, applied ? text.replace(mutation.find, mutation.replace) : text);
  const control = applied ? compile(BEND, SCRATCH) : { ok: true, output: '', exitCode: null, signal: null };
  retainEvidence(`mutation:${mutation.name}`, control.output);
  const location = refusedNormally(control) ? intendedMutationRefusal(control.output, mutation.law) : null;
  const expected = location !== null && expectationMet(control.output, definitionExpectation(mutation));
  const passed = applied && location !== null && expected;
  if (!passed) failures++;
  console.log(JSON.stringify({
    mutation: mutation.name,
    law: mutation.law,
    applied,
    gate: passed ? 'refuses' : 'accepts',
    passed,
  }));
  if (!passed) console.log(control.output.trimEnd());
  writeFileSync(copied, pristine.get(mutation.file));
}

writeFileSync(join(SCRATCH, 'evidence', 'index.json'), JSON.stringify({
  schema: 'capacity-controls/ordinary-evidence@1',
  scratch: SCRATCH,
  cases: evidenceIndex,
}, null, 2) + '\n');

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
