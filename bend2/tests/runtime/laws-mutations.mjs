#!/usr/bin/env node
// Raw acquisition runner for the runtime-values law mutation controls.
//
// This runner acquires evidence only. It computes no refusal verdicts, no
// shape matching and no diagnostic correlation: attribution of the retained
// diagnostics belongs to the sole Interfaces-owned shared checker, and no
// classifier or schema is implemented here.
//
// Durability: one frozen input snapshot of the full bend2 tree is taken per
// run under <evidence>/snapshot/ with a hashed manifest, and the snapshot is
// re-verified against its manifest before and after every case. Case
// directories are exclusive (reserved with exclusive creation, never
// deleted or reused), separate the compiled input tree from the evidence
// area, and are retained. Each case follows one fixed order: copy the
// frozen input, verify the copied input is unchanged against the snapshot
// (a failure prevents the spawn), make the single exact edit, verify the
// edited input against the snapshot with the declared change (a failure
// prevents the spawn), invoke the compiler from the case input directory,
// and verify the edited input again after the run. The closure comparison
// uses ONE coordinate space - the bend2 root - in both directions, so
// deletions, extras and content drift are all detected and the target is
// named bend2-relative. Symlinks are refused in the admitted input closure.
//
// Process capture: exact stdout/stderr Buffers travel through the records
// and are written as raw byte files; UTF-8 renderings are separate files.
// The direct child pid is recorded as the direct child (not necessarily the
// compiler process when the admitted entry is a wrapper). The compiler path
// is resolved absolutely before hashing or spawning; the binary digest is
// recorded with the explicit limit that binary hashing does not prove
// dependency closure, and the archive/base-input provenance is recorded
// unavailable with reasons when no archive input was supplied. The
// environment identity is a digest over all inherited name=value pairs plus
// explicit disclosures and overrides. Every case binds the serialized
// baseline observation digest; that document retains the baseline argv, cwd
// and outcome together with the toolchain and source identity links.
//
// Edit/law linkage: the intended law block is extracted with BYTE offsets,
// its content span EXCLUDES separator blank lines so proof removal cannot
// change the asserted law bytes, the exact removed/added byte buffers are
// retained as files, edits must match exactly once, the unchanged law bytes
// are proven across the edit, and the per-case declared expectation
// metadata stays bound to definition, source and entry. The per-definition
// digest is a lane-local observation; canonical serialization and common
// digest reconciliation are owned by CI/Interfaces.
//
// Evidence writes are load-bearing: a failed case-evidence write marks the
// case as an evidence-storage failure (never a completed acquisition) and
// counts as a failure, with a best-effort log line. Setup runs inside the
// supervised region so a storage-permitting failure still produces the
// summary.
//
// Usage, on an admitted runner:
//   node bend2/tests/runtime/laws-mutations.mjs [path-to-bend-2.0.25]

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { MUTATION_DEFINITIONS, LAW_ENTRY } from './laws-mutation-definitions.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const CAPTURE_MODULE = 'bend2/src/context/runtime/observations-capture.bend';
const CLASSIFY_MODULE = 'bend2/src/context/runtime/observations-classification.bend';
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

function safeFileDigest(path) {
  try {
    const bytes = readFileSync(path);
    return { path, bytes: bytes.length, sha256: sha256Hex(bytes) };
  } catch (err) {
    return { path, unavailable: true, reason: String(err.message ?? err) };
  }
}

function resolveBend() {
  const candidates = [process.argv[2], process.env.BEND].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      // Resolve absolutely before hashing or spawning: a relative candidate
      // would otherwise be resolved against each case's cwd and could hash
      // one file and launch a different or missing path.
      return resolve(candidate);
    }
  }
  return null;
}

// Exclusive evidence root reservation: recursive:false mkdir succeeds only
// for the creator, so two concurrent runs never share or delete each other's
// evidence.
function reserveEvidenceRoot() {
  const base = process.env.BATON_RUNTIME_EVIDENCE_DIR
    ?? join(ROOT, '.scratch', 'runtime-values-laws-evidence', new Date().toISOString().replace(/[:.]/g, '-'));
  try {
    mkdirSync(base, { recursive: false });
    return base;
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      for (let suffix = 1; suffix < 1000; suffix += 1) {
        const candidate = `${base}-run${suffix}`;
        try {
          mkdirSync(candidate, { recursive: false });
          return candidate;
        } catch (next) {
          if (!next || next.code !== 'EEXIST') throw next;
        }
      }
      throw new Error(`evidence root collision: ${base} and numbered run suffixes already exist`);
    }
    throw err;
  }
}

// One complete process record for an invocation: argv, cwd, direct child
// pid, status versus signal versus error, and the EXACT raw byte streams
// carried as Buffers beside their UTF-8 renderings.
function runProcess(argv, cwd) {
  const started = new Date().toISOString();
  const startedMs = Date.now();
  const child = spawnSync(argv[0], argv.slice(1), { env: ENV, cwd, encoding: 'buffer', maxBuffer: Infinity });
  const stdoutBytes = child.stdout ?? Buffer.alloc(0);
  const stderrBytes = child.stderr ?? Buffer.alloc(0);
  const spawnError = child.error ? String(child.error.message ?? child.error) : null;
  return {
    argv,
    cwd,
    wrapperPid: process.pid,
    directChildPid: typeof child.pid === 'number' ? child.pid : null,
    directChildPidNote: 'the direct child of this wrapper; not necessarily the compiler process when the admitted entry is a wrapper',
    started,
    ended: new Date().toISOString(),
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
  };
}

// Writes the exact raw byte files plus the separate UTF-8 renderings; no
// re-encoding feeds the raw files.
function writeProcessStreams(evidenceDir, record) {
  const stdoutRaw = Buffer.isBuffer(record.stdoutBytes) ? record.stdoutBytes : Buffer.alloc(0);
  const stderrRaw = Buffer.isBuffer(record.stderrBytes) ? record.stderrBytes : Buffer.alloc(0);
  writeFileSync(join(evidenceDir, 'stdout.raw'), stdoutRaw);
  writeFileSync(join(evidenceDir, 'stderr.raw'), stderrRaw);
  writeFileSync(join(evidenceDir, 'stdout.utf8.txt'), Buffer.from(record.stdoutUtf8 ?? '', 'utf8'));
  writeFileSync(join(evidenceDir, 'stderr.utf8.txt'), Buffer.from(record.stderrUtf8 ?? '', 'utf8'));
  return {
    stdoutRawFile: join(evidenceDir, 'stdout.raw'),
    stderrRawFile: join(evidenceDir, 'stderr.raw'),
    stdoutUtf8File: join(evidenceDir, 'stdout.utf8.txt'),
    stderrUtf8File: join(evidenceDir, 'stderr.utf8.txt'),
    stdoutSha256: record.stdoutSha256,
    stderrSha256: record.stderrSha256,
  };
}

// Freezes one immutable input snapshot of the full bend2 tree. Symlinks are
// refused outright in the admitted input closure: no copied path may stay a
// live external input and no lexical or chained referent claim is needed.
function freezeSnapshot() {
  const snapshotRoot = join(EVIDENCE_DIR, 'snapshot');
  const symlinks = [];
  const inventoryLinks = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) symlinks.push(relative(snapshotRoot, full));
      else if (entry.isDirectory()) inventoryLinks(full);
    }
  };
  inventoryLinks(join(ROOT, 'bend2'));
  if (symlinks.length > 0) {
    return { refused: true, symlinks };
  }
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
    refused: false,
    root: snapshotRoot,
    bend2Root: join(snapshotRoot, 'bend2'),
    manifestPath: 'snapshot/manifest.json',
    manifestBytes,
    manifestDigest: sha256Hex(manifestBytes),
    fileCount: files.length,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
  };
}

// Re-verifies the frozen snapshot against its own manifest: every file must
// still exist with the recorded bytes, and no file may have appeared. Used
// before and after the case loop.
function verifySnapshot(snapshot) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const bytes = readFileSync(full);
        files.push({ path: relative(snapshot.root, full), bytes: bytes.length, sha256: sha256Hex(bytes) });
      }
    }
  };
  walk(snapshot.root);
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const recorded = JSON.parse(snapshot.manifestBytes.toString('utf8')).files;
  const drift = [];
  const recordedPaths = new Set(recorded.map((file) => file.path));
  const currentPaths = new Set(files.map((file) => file.path));
  for (const file of recorded) {
    const current = files.find((candidate) => candidate.path === file.path);
    if (!current) drift.push({ path: file.path, reason: 'missing from the frozen snapshot' });
    else if (current.sha256 !== file.sha256 || current.bytes !== file.bytes) drift.push({ path: file.path, reason: 'content differs from the manifest' });
  }
  for (const file of files) {
    if (!recordedPaths.has(file.path)) drift.push({ path: file.path, reason: 'appeared after the manifest was written' });
  }
  return { verified: drift.length === 0, drift };
}

// Prepares a retained case directory with a separated input tree and
// evidence area. Case paths are exclusive: an existing directory refuses
// instead of deleting prior evidence.
function prepareCase(index, name, snapshotRoot) {
  const caseDir = join(CASES_DIR, `${String(index).padStart(3, '0')}-${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
  if (existsSync(caseDir)) {
    throw new Error(`case directory collision: ${caseDir} already exists`);
  }
  mkdirSync(join(caseDir, 'evidence'), { recursive: true });
  const inputDir = join(caseDir, 'input');
  cpSync(join(snapshotRoot, 'bend2'), join(inputDir, 'bend2'), { recursive: true });
  return { caseDir, inputDir, inputBend2Dir: join(inputDir, 'bend2'), evidenceDir: join(caseDir, 'evidence') };
}

// Compares the case's compiled bend2 tree against the frozen bend2 tree in
// BOTH directions, in one coordinate space (bend2-relative paths). When
// expectedChange is null the comparison must be an exact unchanged match;
// otherwise the single named target must equal the declared changed bytes
// and nothing else may differ.
function closureDiff(inputBend2Dir, snapshotBend2Dir, expectedChange) {
  const changed = [];
  const unexpected = [];
  const missing = [];
  const extra = [];
  const walkCase = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(inputBend2Dir, full);
      if (entry.isDirectory()) {
        walkCase(full);
        continue;
      }
      const snapshotPath = join(snapshotBend2Dir, rel);
      if (!existsSync(snapshotPath)) {
        extra.push(rel);
        continue;
      }
      const caseBytes = readFileSync(full);
      const snapshotBytes = readFileSync(snapshotPath);
      if (expectedChange && rel === expectedChange.relativePath) {
        if (caseBytes.equals(expectedChange.bytes)) changed.push(rel);
        else unexpected.push({ path: rel, reason: 'target bytes differ from the declared changed bytes' });
      } else if (!caseBytes.equals(snapshotBytes)) {
        unexpected.push({ path: rel, reason: 'differs from the frozen snapshot' });
      }
    }
  };
  walkCase(inputBend2Dir);
  const walkSnapshot = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(snapshotBend2Dir, full);
      if (entry.isDirectory()) walkSnapshot(full);
      else if (!existsSync(join(inputBend2Dir, rel))) missing.push(rel);
    }
  };
  walkSnapshot(snapshotBend2Dir);
  return {
    changedPaths: changed,
    unexpectedDiffs: unexpected,
    missingPaths: missing,
    extraPaths: extra,
    closureMatches: unexpected.length === 0 && missing.length === 0 && extra.length === 0 && (expectedChange ? changed.length === 1 : changed.length === 0),
  };
}

// Extracts ONE law block by name with BYTE offsets. The asserted law
// content span EXCLUDES the trailing separator blank lines, so a proof
// removal that shifts blank-line separation cannot change the asserted law
// bytes; the raw span including separators is retained separately.
function extractLawBlock(moduleBytes, lawName) {
  const moduleText = moduleBytes.toString('utf8');
  const charStart = moduleText.indexOf(`law ${lawName}:`);
  if (charStart === -1) return null;
  const rest = moduleText.slice(charStart);
  const lines = rest.split('\n');
  const blockLines = [lines[0]];
  let charLength = lines[0].length;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === '' || line.startsWith(' ') || line.startsWith('\t')) {
      blockLines.push(line);
      charLength += line.length + 1;
    } else {
      break;
    }
  }
  const rawText = blockLines.join('\n');
  const contentLines = [...blockLines];
  while (contentLines.length > 1 && contentLines[contentLines.length - 1].trim() === '') contentLines.pop();
  const contentText = contentLines.join('\n');
  const byteStart = Buffer.byteLength(moduleText.slice(0, charStart), 'utf8');
  const rawBytes = Buffer.from(rawText, 'utf8');
  const contentBytes = Buffer.from(contentText, 'utf8');
  return {
    lawName,
    charStart,
    byteStart,
    rawByteEnd: byteStart + rawBytes.length,
    rawBytesLength: rawBytes.length,
    contentByteEnd: byteStart + contentBytes.length,
    contentBytesLength: contentBytes.length,
    sha256: sha256Hex(contentBytes),
    bytes: contentBytes,
  };
}

// Verifies an edit matches exactly once in the module text and returns the
// byte-level edit record with the unchanged surrounding digests.
function uniqueEdit(moduleBytes, findText, replaceText) {
  const moduleText = moduleBytes.toString('utf8');
  const first = moduleText.indexOf(findText);
  if (first === -1) return { found: false };
  const last = moduleText.lastIndexOf(findText);
  if (first !== last) return { found: true, unique: false };
  const byteOffset = Buffer.byteLength(moduleText.slice(0, first), 'utf8');
  return {
    found: true,
    unique: true,
    charOffset: first,
    byteOffset,
    removedBytes: Buffer.byteLength(findText, 'utf8'),
    addedBytes: Buffer.byteLength(replaceText, 'utf8'),
    beforeSha256: sha256Hex(moduleBytes.subarray(0, byteOffset)),
    afterSha256: sha256Hex(moduleBytes.subarray(byteOffset + Buffer.byteLength(findText, 'utf8'))),
  };
}

let BEND = null;
let CASES_DIR = null;
let EVIDENCE_DIR = null;

const rows = [];
let summaryWritten = false;
let storageFailures = 0;
function writeSummary(failures, extra) {
  if (summaryWritten) return;
  summaryWritten = true;
  const total = failures + storageFailures;
  try {
    writeFileSync(
      join(EVIDENCE_DIR, 'summary.json'),
      JSON.stringify({
        rows: rows.map((row) => ({
          control: row.control,
          kind: row.kind ?? null,
          acquired: row.acquired ?? false,
          notAcquiredClass: row.notAcquiredClass ?? null,
          noProcess: row.noProcess ?? null,
          baselineObservationDigest: row.baselineObservationDigest ?? null,
          law: row.law ?? null,
          source: row.source ?? null,
          executedCwd: row.executedCwd ?? null,
          process: row.process
            ? {
                argv: row.process.argv,
                cwd: row.process.cwd,
                wrapperPid: row.process.wrapperPid,
                directChildPid: row.process.directChildPid,
                started: row.process.started,
                ended: row.process.ended,
                durationMs: row.process.durationMs,
                exitCode: row.process.exitCode,
                signal: row.process.signal,
                spawnError: row.process.spawnError,
                stdoutLength: row.process.stdoutLength,
                stderrLength: row.process.stderrLength,
                stdoutSha256: row.process.stdoutSha256,
                stderrSha256: row.process.stderrSha256,
                rawStreamFiles: row.rawStreams ?? null,
              }
            : null,
        })),
        failures: total,
        storageFailures,
        attribution: 'deferred to the sole Interfaces-owned shared checker; this runner reports acquisition only',
        ...extra,
      }, null, 2),
    );
  } catch (err) {
    console.log(JSON.stringify({ summaryWriteError: String(err.message ?? err) }));
  }
}

// Records a row and persists it. A failed evidence write is load-bearing:
// the case can no longer claim a completed acquisition, so the row is
// downgraded to an evidence-storage failure and counted.
function record(row) {
  rows.push(row);
  try {
    writeFileSync(join(EVIDENCE_DIR, `${String(rows.length).padStart(3, '0')}-${row.control.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`), JSON.stringify(row, null, 2));
  } catch (err) {
    storageFailures += 1;
    if (row.acquired === true) {
      row.acquired = false;
      row.notAcquiredClass = 'evidence-storage-failed';
    }
    row.storageError = String(err.message ?? err);
    console.log(JSON.stringify({ control: row.control, evidenceStorageFailed: true, error: row.storageError }));
    return;
  }
  console.log(JSON.stringify({ control: row.control, acquired: row.acquired ?? false, notAcquiredClass: row.notAcquiredClass ?? null, noProcess: row.noProcess ?? null }));
}

// Compiles the case input directory: LAW_ENTRY resolves inside
// <case>/input, so the spawn cwd is the input directory and the executed
// cwd recorded on the row is exactly that directory.
function runCompiler(inputDir) {
  return runProcess([BEND, LAW_ENTRY, '--check-only'], inputDir);
}

let failures = 0;
try {
  // Setup runs inside the supervised region so a storage-permitting failure
  // still produces the summary.
  EVIDENCE_DIR = reserveEvidenceRoot();
  CASES_DIR = join(EVIDENCE_DIR, 'cases');
  mkdirSync(CASES_DIR, { recursive: true });
  BEND = resolveBend();

  const identity = {
    node: {
      version: process.version,
      execPath: process.execPath,
      execArgv: process.execArgv,
      executableBytes: safeFileDigest(process.execPath),
    },
    cwd: ROOT,
    entry: LAW_ENTRY,
    environment: (() => {
      const pairs = Object.keys(ENV).sort().map((key) => `${key}=${ENV[key]}\n`);
      const digest = sha256Hex(Buffer.from(pairs.join(''), 'utf8'));
      const disclosures = {};
      for (const key of ['PATH', 'HOME', 'BEND', 'BEND_NO_TELEMETRY', 'TMPDIR']) {
        if (ENV[key] !== undefined) disclosures[key] = ENV[key];
      }
      return { pairCount: pairs.length, digest, disclosures, overrides: { BEND_NO_TELEMETRY: '1' } };
    })(),
    bendRequested: BEND,
    bendUnavailable: BEND === null,
    compilerArchive: { unavailable: true, reason: 'no archive provenance input was supplied; the resolved binary digest stands alone and hashing it cannot prove dependency closure' },
  };
  // The exact producer bytes: the live loaded runner and definitions files,
  // bound to their frozen snapshot copies once the snapshot exists.
  identity.producerBytes = {
    runnerLive: safeFileDigest(import.meta.filename),
    definitionsLive: safeFileDigest(join(import.meta.dirname, 'laws-mutation-definitions.mjs')),
    frozenCopiesBoundAfterSnapshot: true,
  };
  if (BEND) {
    identity.bendBinary = safeFileDigest(BEND);
    identity.bendVersionProcess = runProcess([BEND, 'version'], ROOT);
    writeProcessStreams(EVIDENCE_DIR, identity.bendVersionProcess);
  } else {
    identity.bendBinary = { unavailable: true, reason: 'no Bend executable supplied or found' };
  }
  writeFileSync(join(EVIDENCE_DIR, '000-run-identity.json'), JSON.stringify(identity, null, 2));
  console.log(JSON.stringify({ control: 'run-identity', bendUnavailable: identity.bendUnavailable }));

  if (BEND === null) {
    record({ control: 'compiler-unavailable', kind: 'setup', acquired: false, notAcquiredClass: 'compiler-unavailable', noProcess: { reason: 'no Bend executable was supplied or found' } });
    writeSummary((failures += 1), { stopped: 'compiler-unavailable' });
    console.log('laws-mutations: red - no Bend executable');
    process.exit(1);
  }

  // One frozen input snapshot for baseline and every case; symlinks refuse.
  const snapshot = freezeSnapshot();
  writeFileSync(join(EVIDENCE_DIR, '001-snapshot.json'), JSON.stringify({ refused: snapshot.refused, symlinks: snapshot.symlinks ?? null, manifestDigest: snapshot.manifestDigest ?? null, fileCount: snapshot.fileCount ?? null }, null, 2));
  if (snapshot.refused) {
    record({
      control: 'snapshot-symlinks-present',
      kind: 'setup',
      acquired: false,
      notAcquiredClass: 'symlinks-in-admitted-input-closure',
      noProcess: { reason: 'symlinks are refused in the admitted input closure so no copied path stays a live external input', symlinks: snapshot.symlinks },
    });
    writeSummary((failures += 1), { stopped: 'symlinks-in-admitted-input-closure' });
    console.log('laws-mutations: red - symlinks in the admitted input closure');
    process.exit(1);
  }
  // Bind the executed producer bytes to the frozen copies and verify the
  // snapshot against its manifest before any case.
  identity.entryBytes = safeFileDigest(join(snapshot.root, LAW_ENTRY));
  identity.producerBytes.runnerFrozen = safeFileDigest(join(snapshot.root, relative(join(ROOT, 'bend2'), import.meta.filename)));
  identity.producerBytes.definitionsFrozen = safeFileDigest(join(snapshot.root, relative(join(ROOT, 'bend2'), join(import.meta.dirname, 'laws-mutation-definitions.mjs'))));
  identity.producerBytes.frozenCopiesMatchLive =
    identity.producerBytes.runnerFrozen.sha256 === identity.producerBytes.runnerLive.sha256 &&
    identity.producerBytes.definitionsFrozen.sha256 === identity.producerBytes.definitionsLive.sha256;
  identity.baseInputClosure = { manifestDigest: snapshot.manifestDigest, fileCount: snapshot.fileCount, bytes: snapshot.bytes };
  writeFileSync(join(EVIDENCE_DIR, '000-run-identity.json'), JSON.stringify(identity, null, 2));
  const preVerify = verifySnapshot(snapshot);
  writeFileSync(join(EVIDENCE_DIR, '002-snapshot-verify-pre.json'), JSON.stringify(preVerify, null, 2));
  if (!preVerify.verified) {
    record({ control: 'snapshot-verify-pre', kind: 'setup', acquired: false, notAcquiredClass: 'snapshot-drift', noProcess: { reason: 'frozen snapshot drifted from its manifest before any case', drift: preVerify.drift } });
    writeSummary((failures += 1), { stopped: 'snapshot-drift' });
    process.exit(1);
  }

  // Baseline: copy, verify unchanged closure BEFORE the spawn, compile from
  // the input directory, verify unchanged again, and serialize the baseline
  // observation with its bindings.
  const baseline = prepareCase(0, 'baseline', snapshot.root);
  const baselinePreDiff = closureDiff(baseline.inputBend2Dir, snapshot.bend2Root, null);
  if (!baselinePreDiff.closureMatches) {
    record({ control: 'baseline', kind: 'baseline', acquired: false, notAcquiredClass: 'pre-spawn-closure-mismatch', executedCwd: baseline.inputDir, preDiff: baselinePreDiff, noProcess: { reason: 'the copied input did not match the frozen snapshot before the spawn' } });
    writeSummary((failures += 1), { stopped: 'baseline-closure' });
    process.exit(1);
  }
  const baselineRun = runCompiler(baseline.inputDir);
  const baselinePostDiff = closureDiff(baseline.inputBend2Dir, snapshot.bend2Root, null);
  const baselineObservationDoc = {
    control: 'baseline',
    process: { argv: baselineRun.argv, cwd: baselineRun.cwd, exitCode: baselineRun.exitCode, signal: baselineRun.signal, spawnError: baselineRun.spawnError, stdoutSha256: baselineRun.stdoutSha256, stderrSha256: baselineRun.stderrSha256, stdoutLength: baselineRun.stdoutLength, stderrLength: baselineRun.stderrLength, directChildPid: baselineRun.directChildPid, started: baselineRun.started, ended: baselineRun.ended },
    bindings: {
      snapshotManifestDigest: snapshot.manifestDigest,
      entryDigest: identity.entryBytes.sha256,
      bendBinaryDigest: identity.bendBinary.sha256 ?? null,
      bendVersionStdoutSha256: identity.bendVersionProcess ? identity.bendVersionProcess.stdoutSha256 : null,
      nodeExecutableDigest: identity.node.executableBytes.sha256 ?? null,
      environmentDigest: identity.environment.digest,
      producerRunnerSha256: identity.producerBytes.runnerFrozen.sha256,
      producerDefinitionsSha256: identity.producerBytes.definitionsFrozen.sha256,
      preDiff: baselinePreDiff,
      postDiff: baselinePostDiff,
    },
  };
  const baselineObservationBytes = Buffer.from(JSON.stringify(baselineObservationDoc), 'utf8');
  writeFileSync(join(baseline.evidenceDir, 'baseline-observation.json'), baselineObservationBytes);
  const baselineObservationDigest = sha256Hex(baselineObservationBytes);
  const baselineAcquired =
    baselineRun.spawnError === null && baselineRun.signal === null && baselineRun.exitCode === 0 &&
    baselinePreDiff.closureMatches && baselinePostDiff.closureMatches;
  record({
    control: 'baseline',
    kind: 'baseline',
    entry: LAW_ENTRY,
    executedCwd: baseline.inputDir,
    snapshot,
    acquired: baselineAcquired,
    notAcquiredClass: baselineAcquired ? null : baselineRun.spawnError ? 'spawn-error' : baselineRun.signal ? 'signal' : baselineRun.exitCode !== 0 ? 'baseline-nonzero-exit' : 'post-spawn-closure-mismatch',
    baselineObservationDigest,
    preDiff: baselinePreDiff,
    postDiff: baselinePostDiff,
    process: baselineRun,
    rawStreams: writeProcessStreams(baseline.evidenceDir, baselineRun),
  });
  if (!baselineAcquired) {
    writeSummary((failures += 1), { stopped: 'baseline-did-not-compile-cleanly', baselineObservationDigest });
    console.log('laws-mutations: red - baseline did not compile cleanly on the frozen snapshot');
    process.exit(1);
  }

  let caseCounter = 1;
  function nextCase(name) {
    return prepareCase(caseCounter++, name, snapshot.root);
  }

  // Case order: copy -> verify unchanged (prevents spawn) -> edit -> verify
  // edited (prevents spawn) -> compile -> verify edited again.
  function verifyOrFail(paths, law, preDiff, editedDiff, postDiff) {
    if (!preDiff.closureMatches) {
      record({ control: `${law.kind}:${law.name}`, kind: law.kind, law: law.name, source: law.source, acquired: false, notAcquiredClass: 'pre-spawn-closure-mismatch', executedCwd: paths.inputDir, preDiff, noProcess: { reason: 'the copied input did not match the frozen snapshot before the edit' } });
      return false;
    }
    if (!editedDiff.closureMatches) {
      record({ control: `${law.kind}:${law.name}`, kind: law.kind, law: law.name, source: law.source, acquired: false, notAcquiredClass: 'edited-closure-mismatch', executedCwd: paths.inputDir, editedDiff, noProcess: { reason: 'the edited input did not match the snapshot with exactly the declared change' } });
      return false;
    }
    if (postDiff && !postDiff.closureMatches) {
      record({ control: `${law.kind}:${law.name}`, kind: law.kind, law: law.name, source: law.source, acquired: false, notAcquiredClass: 'post-spawn-closure-mismatch', executedCwd: paths.inputDir, postDiff });
      return false;
    }
    return true;
  }

  for (const law of PROOF_REMOVAL_LAWS) {
    try {
      const paths = nextCase(`proof-${law.name}`);
      const original = readFileSync(join(snapshot.root, law.file));
      const originalText = original.toString('utf8');
      const proofPattern = new RegExp(`\\ndef ${law.name}\\([^)]*\\):\\n  \\{==\\}\\n`);
      const matches = originalText.match(new RegExp(proofPattern.source, 'g')) ?? [];
      if (matches.length !== 1) {
        record({ control: `proof-removal:${law.name}`, kind: 'proof-removal', law: law.name, source: law.file, acquired: false, notAcquiredClass: 'edit-not-unique', noProcess: { reason: `proof def occurrences: ${matches.length}` } });
        failures += 1;
        continue;
      }
      const edit = uniqueEdit(original, matches[0], '\n');
      const changed = Buffer.from(originalText.slice(0, edit.charOffset) + '\n' + originalText.slice(edit.charOffset + matches[0].length), 'utf8');
      const targetRelative = relative('bend2', law.file);
      const preDiff = closureDiff(paths.inputBend2Dir, snapshot.bend2Root, null);
      if (!verifyOrFail(paths, { kind: 'proof-removal', name: law.name, source: law.file }, preDiff, null, null)) {
        failures += 1;
        continue;
      }
      writeFileSync(join(paths.inputDir, law.file), changed);
      const editedDiff = closureDiff(paths.inputBend2Dir, snapshot.bend2Root, { relativePath: targetRelative, bytes: changed });
      if (!verifyOrFail(paths, { kind: 'proof-removal', name: law.name, source: law.file }, preDiff, editedDiff, null)) {
        failures += 1;
        continue;
      }
      const lawBlock = extractLawBlock(original, law.name);
      const changedLawBlock = extractLawBlock(changed, law.name);
      if (lawBlock) writeFileSync(join(paths.evidenceDir, `law-${law.name}.txt`), lawBlock.bytes);
      writeFileSync(join(paths.evidenceDir, 'removed-proof.txt'), Buffer.from(matches[0], 'utf8'));
      const run = runCompiler(paths.inputDir);
      const postDiff = closureDiff(paths.inputBend2Dir, snapshot.bend2Root, { relativePath: targetRelative, bytes: changed });
      const rawStreams = writeProcessStreams(paths.evidenceDir, run);
      const closureOk = postDiff.closureMatches;
      const lawUnchanged = lawBlock !== null && changedLawBlock !== null && lawBlock.bytes.equals(changedLawBlock.bytes);
      const acquired = run.spawnError === null && run.signal === null && run.exitCode !== null && closureOk && lawUnchanged;
      record({
        control: `proof-removal:${law.name}`,
        kind: 'proof-removal',
        law: law.name,
        source: law.file,
        entry: LAW_ENTRY,
        executedCwd: paths.inputDir,
        snapshot,
        acquired,
        notAcquiredClass: acquired ? null : run.spawnError ? 'spawn-error' : run.signal ? 'signal' : closureOk ? (lawUnchanged ? 'missing-status' : 'law-text-changed') : 'post-spawn-closure-mismatch',
        lawLinkage: {
          intendedLaw: law.name,
          lawBlock: lawBlock ? { byteStart: lawBlock.byteStart, rawByteEnd: lawBlock.rawByteEnd, contentByteEnd: lawBlock.contentByteEnd, contentBytesLength: lawBlock.contentBytesLength, sha256: lawBlock.sha256, note: 'content span excludes separator blank lines; raw span retained in the evidence file' } : null,
          lawBytesUnchangedAcrossEdit: lawUnchanged,
          edit: { kind: 'proof-removal', byteOffset: edit.byteOffset, removedBytes: edit.removedBytes, addedBytes: edit.addedBytes, unique: edit.unique },
          removedProofBytesFile: join(paths.evidenceDir, 'removed-proof.txt'),
          unchangedSurroundings: { beforeSha256: edit.beforeSha256, afterSha256: edit.afterSha256 },
          moduleBefore: { bytes: original.length, sha256: sha256Hex(original) },
          moduleAfter: { bytes: changed.length, sha256: sha256Hex(changed) },
        },
        baselineObservationDigest,
        preDiff,
        editedDiff,
        postDiff,
        process: run,
        rawStreams,
      });
      if (!acquired) failures += 1;
    } catch (caseError) {
      record({ control: `proof-removal:${law.name}`, kind: 'proof-removal', law: law.name, acquired: false, notAcquiredClass: 'case-setup-failure', noProcess: { reason: String(caseError.message ?? caseError) } });
      failures += 1;
    }
  }

  for (const definition of MUTATION_DEFINITIONS) {
    try {
      const paths = nextCase(`mutation-${definition.name}`);
      const original = readFileSync(join(snapshot.root, definition.file));
      const edit = uniqueEdit(original, definition.find, definition.replace);
      if (!edit.found || !edit.unique) {
        record({ control: `mutation:${definition.name}`, kind: 'mutation', law: definition.law, source: definition.file, acquired: false, notAcquiredClass: edit.found ? 'edit-not-unique' : 'find-text-absent', noProcess: { reason: edit.found ? 'find text matches more than once' : 'find text absent from the frozen module' } });
        failures += 1;
        continue;
      }
      const changed = Buffer.from(original.toString('utf8').slice(0, edit.charOffset) + definition.replace + original.toString('utf8').slice(edit.charOffset + definition.find.length), 'utf8');
      const targetRelative = relative('bend2', definition.file);
      const preDiff = closureDiff(paths.inputBend2Dir, snapshot.bend2Root, null);
      if (!verifyOrFail(paths, { kind: 'mutation', name: definition.name, source: definition.file }, preDiff, null, null)) {
        failures += 1;
        continue;
      }
      writeFileSync(join(paths.inputDir, definition.file), changed);
      const editedDiff = closureDiff(paths.inputBend2Dir, snapshot.bend2Root, { relativePath: targetRelative, bytes: changed });
      if (!verifyOrFail(paths, { kind: 'mutation', name: definition.name, source: definition.file }, preDiff, editedDiff, null)) {
        failures += 1;
        continue;
      }
      const lawBlock = extractLawBlock(original, definition.law);
      const changedLawBlock = extractLawBlock(changed, definition.law);
      if (lawBlock) writeFileSync(join(paths.evidenceDir, `law-${definition.law}.txt`), lawBlock.bytes);
      const run = runCompiler(paths.inputDir);
      const postDiff = closureDiff(paths.inputBend2Dir, snapshot.bend2Root, { relativePath: targetRelative, bytes: changed });
      const rawStreams = writeProcessStreams(paths.evidenceDir, run);
      const closureOk = postDiff.closureMatches;
      const lawUnchanged = lawBlock !== null && changedLawBlock !== null && lawBlock.bytes.equals(changedLawBlock.bytes);
      const acquired = run.spawnError === null && run.signal === null && run.exitCode !== null && closureOk && lawUnchanged;
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
      record({
        control: `mutation:${definition.name}`,
        kind: 'mutation',
        law: definition.law,
        source: definition.file,
        entry: definition.entry,
        executedCwd: paths.inputDir,
        snapshot,
        acquired,
        notAcquiredClass: acquired ? null : run.spawnError ? 'spawn-error' : run.signal ? 'signal' : closureOk ? (lawUnchanged ? 'missing-status' : 'law-text-changed') : 'post-spawn-closure-mismatch',
        declaredExpectations: { expected: definition.expected, observed: definition.observed, boundTo: { definition: definition.name, source: definition.file, entry: definition.entry } },
        definitionDigestLaneLocal: { digest: sha256Hex(Buffer.from(canonical, 'utf8')), note: 'lane-local observation over this lane serialization; canonical serialization and digest reconciliation are owned by CI/Interfaces' },
        historicDigest: definition.historicDigest,
        definitionsModuleBytes: identity.definitionsModuleBytes ?? identity.producerBytes.definitionsFrozen,
        lawLinkage: {
          intendedLaw: definition.law,
          lawBlock: lawBlock ? { byteStart: lawBlock.byteStart, rawByteEnd: lawBlock.rawByteEnd, contentByteEnd: lawBlock.contentByteEnd, contentBytesLength: lawBlock.contentBytesLength, sha256: lawBlock.sha256 } : null,
          lawBytesUnchangedAcrossEdit: lawUnchanged,
          edit: { kind: 'replace', byteOffset: edit.byteOffset, removedBytes: edit.removedBytes, addedBytes: edit.addedBytes, unique: edit.unique },
          unchangedSurroundings: { beforeSha256: edit.beforeSha256, afterSha256: edit.afterSha256 },
          moduleBefore: { bytes: original.length, sha256: sha256Hex(original) },
          moduleAfter: { bytes: changed.length, sha256: sha256Hex(changed) },
        },
        baselineObservationDigest,
        preDiff,
        editedDiff,
        postDiff,
        process: run,
        rawStreams,
      });
      if (!acquired) failures += 1;
    } catch (caseError) {
      record({ control: `mutation:${definition.name}`, kind: 'mutation', law: definition.law, acquired: false, notAcquiredClass: 'case-setup-failure', noProcess: { reason: String(caseError.message ?? caseError) } });
      failures += 1;
    }
  }

  // Re-verify the frozen snapshot after all cases, then summarize.
  const postVerify = verifySnapshot(snapshot);
  writeFileSync(join(EVIDENCE_DIR, '003-snapshot-verify-post.json'), JSON.stringify(postVerify, null, 2));
  if (!postVerify.verified) failures += 1;
  writeSummary(failures, { snapshot: { manifestDigest: snapshot.manifestDigest, fileCount: snapshot.fileCount }, snapshotVerifiedPost: postVerify.verified });
  console.log(
    `laws-mutations: ${failures === 0 && storageFailures === 0 ? 'complete' : 'incomplete'} - baseline + ${PROOF_REMOVAL_LAWS.length} proof removals + ${MUTATION_DEFINITIONS.length} mutations, ${failures} failures, ${storageFailures} storage failures, evidence in ${EVIDENCE_DIR}`,
  );
  process.exit(failures === 0 && storageFailures === 0 ? 0 : 1);
} catch (runError) {
  failures += 1;
  writeSummary(failures, { stopped: `setup-failure: ${String(runError && runError.stack ? runError.stack : runError)}` });
  console.log(`laws-mutations: red - setup failure: ${String(runError && runError.message ? runError.message : runError)}`);
  process.exit(1);
}
