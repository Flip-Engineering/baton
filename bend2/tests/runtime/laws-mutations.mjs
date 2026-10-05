#!/usr/bin/env node
// Raw acquisition runner for the runtime-values law mutation controls.
//
// This runner acquires evidence only. It computes no refusal verdicts, no
// shape matching and no diagnostic correlation: attribution of the retained
// diagnostics belongs to the sole Interfaces-owned shared checker, and no
// classifier or schema is implemented here.
//
// One immutable snapshot per run: before any case, the full bend2 tree of
// the admitted checkout is copied once into <evidence>/snapshot/ and hashed
// file by file into a manifest; every case compiles a fresh copy of that
// frozen snapshot, never the live tree, and links the snapshot manifest
// digest. Original and changed module bytes, the law text, and the exact
// delta are retained beside each case's raw compiler streams so no evidence
// row references bytes that were deleted.
//
// Per case the runner retains: the exact compiler argv, cwd, environment
// identity (key list plus the explicit policy assignments), the compiler
// binary digest and its version output, the actual compiler child process id
// (this wrapper's pid is recorded separately and is not the compiler pid),
// start and end times, the observed exit status or signal or spawn error,
// and the complete separate stdout and stderr as exact buffers - hashed and
// length-recorded over the raw bytes, with their UTF-8 renderings retained
// alongside for reading.
//
// Outcome vocabulary (acquisition bookkeeping, not attribution): 'acquired'
// means the compiler ran to a normal termination and its complete streams
// were captured, whatever the exit code; 'not-acquired' names the
// infrastructure class (spawn-error, signal, missing-streams). The baseline
// case additionally requires exit 0 on the frozen snapshot for any later
// case to be meaningful. Case-level acquired/not-acquired never reports a
// law refusal.
//
// Usage, on an admitted runner:
//   node bend2/tests/runtime/laws-mutations.mjs [path-to-bend-2.0.25]

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { MUTATION_DEFINITIONS, LAW_ENTRY } from './laws-mutation-definitions.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const CAPTURE_MODULE = 'bend2/src/context/runtime/observations-capture.bend';
const CLASSIFY_MODULE = 'bend2/src/context/runtime/observations-classification.bend';
const SCRATCH = join(ROOT, '.scratch', 'runtime-values-laws-mutations');
const EVIDENCE_DIR =
  process.env.BATON_RUNTIME_EVIDENCE_DIR ??
  join(ROOT, '.scratch', 'runtime-values-laws-evidence', new Date().toISOString().replace(/[:.]/g, '-'));
const ENV = { ...process.env, BEND_NO_TELEMETRY: '1' };

const PROOF_REMOVAL_LAWS = [
  { name: 'runtime_evidence_preserves_every_identity_member', file: CAPTURE_MODULE },
  { name: 'capture_record_carries_both_event_identities_and_the_fixed_consistency_pair', file: CAPTURE_MODULE },
  { name: 'capture_without_an_end_event_stays_open', file: CAPTURE_MODULE },
  { name: 'runtime_fact_admits_only_the_observed_classification', file: CLASSIFY_MODULE },
  { name: 'class_tags_are_the_four_fixed_names', file: CLASSIFY_MODULE },
  { name: 'expansion_admits_each_class_at_itself', file: CLASSIFY_MODULE },
  { name: 'observed_expansion_refuses_every_other_classification', file: CLASSIFY_MODULE },
  { name: 'observed_value_completeness_follows_the_conservative_rule', file: CLASSIFY_MODULE },
  { name: 'a_preview_is_incomplete_regardless_of_its_flags', file: CLASSIFY_MODULE },
];

function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

function resolveBend() {
  const candidates = [process.argv[2], process.env.BEND].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// Freezes one immutable snapshot of the full bend2 tree under the evidence
// directory and returns its manifest: one row per file with byte length and
// SHA-256, plus the aggregate manifest digest that every case links to.
function freezeSnapshot() {
  const snapshotRoot = join(EVIDENCE_DIR, 'snapshot');
  cpSync(join(ROOT, 'bend2'), join(snapshotRoot, 'bend2'), { recursive: true });
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const bytes = readFileSync(full);
        files.push({ path: relative(snapshotRoot, full), bytes: bytes.length, sha256: sha256Hex(bytes) });
      }
    }
  };
  walk(snapshotRoot);
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const manifest = { files, fileCount: files.length };
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  writeFileSync(join(snapshotRoot, 'manifest.json'), manifestBytes);
  return {
    root: snapshotRoot,
    manifestPath: join('snapshot', 'manifest.json'),
    manifestDigest: sha256Hex(manifestBytes),
    fileCount: files.length,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
  };
}

// Each case compiles a fresh copy of the frozen snapshot, so the compiled
// inputs are exactly the frozen bytes.
function prepareScratch(snapshotRoot) {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  cpSync(join(snapshotRoot, 'bend2'), join(SCRATCH, 'bend2'), { recursive: true });
}

function readModule(path) {
  return readFileSync(join(SCRATCH, path));
}

function writeModule(path, bytes) {
  writeFileSync(join(SCRATCH, path), bytes);
}

// Runs the scoped entry compile with byte-exact stream capture. Records the
// observed process identity: the direct child is the compiler process
// itself; this wrapper's pid is recorded separately and is not the compiler
// pid.
function runCompiler(cwd) {
  const started = new Date().toISOString();
  const startedMs = Date.now();
  const child = spawnSync(BEND, [LAW_ENTRY, '--check-only'], { env: ENV, cwd, encoding: 'buffer', maxBuffer: Infinity });
  const ended = new Date().toISOString();
  const stdoutBytes = child.stdout ?? Buffer.alloc(0);
  const stderrBytes = child.stderr ?? Buffer.alloc(0);
  const spawnError = child.error ? String(child.error.message ?? child.error) : null;
  const acquired = spawnError === null && child.signal === null && child.status !== null;
  return {
    argv: [BEND, LAW_ENTRY, '--check-only'],
    cwd,
    wrapperPid: process.pid,
    compilerPid: typeof child.pid === 'number' ? child.pid : null,
    started,
    ended,
    durationMs: Date.now() - startedMs,
    exitCode: child.status,
    signal: child.signal,
    spawnError,
    stdoutBytes,
    stderrBytes,
    stdoutLength: stdoutBytes.length,
    stderrLength: stderrBytes.length,
    stdoutSha256: sha256Hex(stdoutBytes),
    stderrSha256: sha256Hex(stderrBytes),
    stdoutUtf8: stdoutBytes.toString('utf8'),
    stderrUtf8: stderrBytes.toString('utf8'),
    acquired,
    notAcquiredClass: acquired ? null : spawnError ? 'spawn-error' : child.signal ? 'signal' : 'missing-status',
  };
}

function environmentIdentity() {
  const keys = Object.keys(ENV).sort();
  const recorded = {};
  for (const key of ['PATH', 'HOME', 'BEND', 'BEND_NO_TELEMETRY', 'TMPDIR']) {
    if (ENV[key] !== undefined) recorded[key] = ENV[key];
  }
  return { keyCount: keys.length, keys, recordedValues: recorded };
}

const BEND = resolveBend();
mkdirSync(EVIDENCE_DIR, { recursive: true });

// Run identity: the admitted runner records the exact compiler binary
// identity, its version output, the runtime and the environment identity.
const identity = {
  node: process.version,
  execPath: process.execPath,
  execArgv: process.execArgv,
  cwd: ROOT,
  entry: LAW_ENTRY,
  scratch: SCRATCH,
  environment: environmentIdentity(),
  bendRequested: BEND,
  bendUnavailable: BEND === null,
};
if (BEND) {
  const bendBytes = readFileSync(BEND);
  identity.bendBinary = { path: BEND, bytes: bendBytes.length, sha256: sha256Hex(bendBytes) };
  try {
    identity.bendVersion = spawnSync(BEND, ['version'], { env: ENV, encoding: 'buffer' }).stdout.toString('utf8').trim();
  } catch (err) {
    identity.bendVersion = `unavailable: ${String(err.message ?? err)}`;
  }
}
writeFileSync(join(EVIDENCE_DIR, '000-run-identity.json'), JSON.stringify(identity, null, 2));

const rows = [];
let failures = 0;
function record(row) {
  rows.push(row);
  writeFileSync(join(EVIDENCE_DIR, `${String(rows.length).padStart(3, '0')}-${row.control.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`), JSON.stringify(row, null, 2));
  console.log(JSON.stringify({ control: row.control, acquired: row.acquired, notAcquiredClass: row.notAcquiredClass ?? null }));
}

if (BEND === null) {
  record({ control: 'compiler-unavailable', acquired: false, notAcquiredClass: 'compiler-unavailable' });
  console.log(`laws-mutations: red - no Bend executable; ${rows.length} rows in ${EVIDENCE_DIR}`);
  process.exit(1);
}

// One frozen snapshot for baseline and every case.
const snapshot = freezeSnapshot();
writeFileSync(join(EVIDENCE_DIR, '001-snapshot.json'), JSON.stringify(snapshot, null, 2));

// Baseline: the frozen snapshot's unchanged entry must compile with exit 0
// for any later case to be meaningful.
prepareScratch(snapshot.root);
const baselineRun = runCompiler(SCRATCH);
record({
  control: 'baseline',
  kind: 'baseline',
  entry: LAW_ENTRY,
  snapshot,
  acquired: baselineRun.acquired,
  notAcquiredClass: baselineRun.notAcquiredClass,
  baselineExitZero: baselineRun.exitCode === 0,
  run: baselineRun,
});
if (!baselineRun.acquired || baselineRun.exitCode !== 0) {
  failures += 1;
  console.log(`laws-mutations: red - baseline did not compile cleanly on the frozen snapshot; ${rows.length} rows in ${EVIDENCE_DIR}`);
  rmSync(SCRATCH, { recursive: true, force: true });
  process.exit(1);
}

const originalCapture = readFileSync(join(snapshot.root, CAPTURE_MODULE));
const originalClassify = readFileSync(join(snapshot.root, CLASSIFY_MODULE));
const originals = new Map([
  [CAPTURE_MODULE, originalCapture],
  [CLASSIFY_MODULE, originalClassify],
]);

function extractLawText(moduleBytes) {
  const moduleText = moduleBytes.toString('utf8');
  const lines = moduleText.split('\n');
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('law ')) {
      if (current) blocks.push(current);
      current = [line];
    } else if (current !== null) {
      if (line === '' || line.startsWith(' ') || line.startsWith('\t')) {
        current.push(line);
      } else {
        blocks.push(current);
        current = null;
      }
    }
  }
  if (current) blocks.push(current);
  return Buffer.from(blocks.map((block) => block.join('\n')).join('\n\n'), 'utf8');
}

function lawBytesUnchanged(changedBytes, originalBytes) {
  return extractLawText(changedBytes).equals(extractLawText(originalBytes));
}

for (const law of PROOF_REMOVAL_LAWS) {
  prepareScratch(snapshot.root);
  const modulePath = join(SCRATCH, law.file);
  const original = originals.get(law.file);
  const proofPattern = new RegExp(`\\ndef ${law.name}\\([^)]*\\):\\n  \\{==\\}\\n`);
  if (!proofPattern.test(original.toString('utf8'))) {
    record({ control: `proof-removal:${law.name}`, kind: 'proof-removal', law: law.name, source: law.file, acquired: false, notAcquiredClass: 'find-text-absent' });
    failures += 1;
    continue;
  }
  const changed = Buffer.from(original.toString('utf8').replace(proofPattern, '\n'), 'utf8');
  writeFileSync(modulePath, changed);
  const compiledMatchesChanged = readFileSync(modulePath).equals(changed);
  writeFileSync(join(EVIDENCE_DIR, `bytes-proof-removal-${law.name}-original.bend`), original);
  writeFileSync(join(EVIDENCE_DIR, `bytes-proof-removal-${law.name}-changed.bend`), changed);
  writeFileSync(join(EVIDENCE_DIR, `law-text-${law.name}.txt`), extractLawText(changed));
  const run = runCompiler(SCRATCH);
  record({
    control: `proof-removal:${law.name}`,
    kind: 'proof-removal',
    law: law.name,
    source: law.file,
    entry: LAW_ENTRY,
    snapshot,
    acquired: run.acquired && compiledMatchesChanged,
    notAcquiredClass: run.acquired ? (compiledMatchesChanged ? null : 'compiled-bytes-mismatch') : run.notAcquiredClass,
    moduleBefore: { bytes: original.length, sha256: sha256Hex(original) },
    moduleAfter: { bytes: changed.length, sha256: sha256Hex(changed) },
    lawTextSha256: sha256Hex(extractLawText(changed)),
    lawBytesUnchanged: lawBytesUnchanged(changed, original),
    compiledBytesMatch: compiledMatchesChanged,
    run,
  });
  if (!(run.acquired && compiledMatchesChanged)) failures += 1;
}

for (const definition of MUTATION_DEFINITIONS) {
  prepareScratch(snapshot.root);
  const original = originals.get(definition.file);
  if (!original.toString('utf8').includes(definition.find)) {
    record({ control: `mutation:${definition.name}`, kind: 'mutation', law: definition.law, source: definition.file, acquired: false, notAcquiredClass: 'find-text-absent' });
    failures += 1;
    continue;
  }
  const changed = Buffer.from(original.toString('utf8').replace(definition.find, definition.replace), 'utf8');
  const canonical = JSON.stringify({
    name: definition.name,
    file: definition.file,
    entry: definition.entry,
    law: definition.law,
    expected: definition.expected,
    observed: definition.observed,
    find: definition.find,
    replace: definition.replace,
  });
  const modulePath = join(SCRATCH, definition.file);
  writeFileSync(modulePath, changed);
  const compiledMatchesChanged = readFileSync(modulePath).equals(changed);
  writeFileSync(join(EVIDENCE_DIR, `bytes-mutation-${definition.name}-original.bend`), original);
  writeFileSync(join(EVIDENCE_DIR, `bytes-mutation-${definition.name}-changed.bend`), changed);
  writeFileSync(join(EVIDENCE_DIR, `law-text-${definition.name}.txt`), extractLawText(changed));
  const run = runCompiler(SCRATCH);
  record({
    control: `mutation:${definition.name}`,
    kind: 'mutation',
    law: definition.law,
    source: definition.file,
    entry: definition.entry,
    snapshot,
    acquired: run.acquired && compiledMatchesChanged,
    notAcquiredClass: run.acquired ? (compiledMatchesChanged ? null : 'compiled-bytes-mismatch') : run.notAcquiredClass,
    definitionDigest: sha256Hex(Buffer.from(canonical, 'utf8')),
    historicDigest: definition.historicDigest,
    definition,
    moduleBefore: { bytes: original.length, sha256: sha256Hex(original) },
    moduleAfter: { bytes: changed.length, sha256: sha256Hex(changed) },
    delta: { findBytes: Buffer.byteLength(definition.find, 'utf8'), replaceBytes: Buffer.byteLength(definition.replace, 'utf8') },
    lawTextSha256: sha256Hex(extractLawText(changed)),
    lawBytesUnchanged: lawBytesUnchanged(changed, original),
    compiledBytesMatch: compiledMatchesChanged,
    nonTargetInputs: [
      (() => {
        const bytes = readFileSync(join(SCRATCH, LAW_ENTRY));
        return { path: LAW_ENTRY, bytes: bytes.length, sha256: sha256Hex(bytes) };
      })(),
      (() => {
        const otherPath = definition.file === CAPTURE_MODULE ? CLASSIFY_MODULE : CAPTURE_MODULE;
        const bytes = readFileSync(join(SCRATCH, otherPath));
        return { path: otherPath, bytes: bytes.length, sha256: sha256Hex(bytes) };
      })(),
    ],
    run,
  });
  if (!(run.acquired && compiledMatchesChanged)) failures += 1;
}

rmSync(SCRATCH, { recursive: true, force: true });
writeFileSync(
  join(EVIDENCE_DIR, 'summary.json'),
  JSON.stringify({
    rows: rows.map(({ run, ...rest }) => ({
      ...rest,
      run: {
        argv: run.argv,
        cwd: run.cwd,
        wrapperPid: run.wrapperPid,
        compilerPid: run.compilerPid,
        started: run.started,
        ended: run.ended,
        durationMs: run.durationMs,
        exitCode: run.exitCode,
        signal: run.signal,
        spawnError: run.spawnError,
        stdoutLength: run.stdoutLength,
        stderrLength: run.stderrLength,
        stdoutSha256: run.stdoutSha256,
        stderrSha256: run.stderrSha256,
        acquired: run.acquired,
        notAcquiredClass: run.notAcquiredClass,
      },
    })),
    snapshot,
    failures,
    attribution: 'deferred to the sole Interfaces-owned shared checker; this runner reports acquisition only',
  }, null, 2),
);
console.log(
  `laws-mutations: ${failures === 0 ? 'complete' : 'incomplete'} - baseline + ${PROOF_REMOVAL_LAWS.length} proof removals + ${MUTATION_DEFINITIONS.length} mutations, ${failures} not acquired, evidence in ${EVIDENCE_DIR}`,
);
process.exit(failures === 0 ? 0 : 1);
