#!/usr/bin/env node
// Raw acquisition runner for the runtime-values law mutation controls.
//
// This runner acquires evidence only. It computes no refusal verdicts, no
// shape matching and no diagnostic correlation: attribution of the retained
// diagnostics belongs to the sole Interfaces-owned shared checker, and no
// classifier or schema is implemented here.
//
// Durability: one immutable frozen snapshot of the full bend2 tree is taken
// per run under <evidence>/snapshot/ with a hashed manifest. Every case
// compiles its own retained case directory copied from that snapshot; case
// directories are never deleted, and each row records the actual executed
// cwd. After the edit, each case's complete file closure is compared against
// the frozen snapshot: the only allowed difference is the single target
// module, and every non-target input must be byte-identical. Symlinks in the
// tree are inventoried with their referents; a symlink resolving outside the
// snapshot rejects the run, so no copied path stays a live external input.
//
// Process capture: exact buffers for stdout and stderr, retained BOTH as
// separate raw files with their own digests and inside the case JSON; the
// direct child pid is recorded as the direct child (it is not necessarily
// the compiler process when the admitted entry is a wrapper); start and end
// times, exit status versus signal versus spawn error are recorded. Node
// identity records the executable bytes digest; the compiler identity
// records the resolved absolute binary digest and a complete process record
// of the version invocation; the environment identity is a digest over all
// inherited name=value pairs plus explicit disclosures and overrides. Every
// case binds the baseline observation digest.
//
// Edit/law linkage: each case retains the intended law block bytes with
// their source range, the exact unique edit offset and byte counts, the
// original and changed module bytes, the unchanged surrounding bytes'
// digests, and for proof removals the removed proof bytes with their byte
// range. Per-case declared expectation metadata stays bound to the
// definition, source and entry. The per-definition digest recorded here is
// a lane-local observation over this lane's serialization; canonical
// serialization and common digest reconciliation are owned by CI/Interfaces,
// historic digests stay historical, and the current serialized definition
// module's byte digest is recorded separately.
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
const EVIDENCE_DIR =
  process.env.BATON_RUNTIME_EVIDENCE_DIR ??
  join(ROOT, '.scratch', 'runtime-values-laws-evidence', new Date().toISOString().replace(/[:.]/g, '-'));
const CASES_DIR = join(EVIDENCE_DIR, 'cases');
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

// One complete process record for a helper invocation such as the compiler
// version query: argv, cwd, direct child pid, status versus signal versus
// error, and the exact raw streams with their digests.
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
    stdoutLength: stdoutBytes.length,
    stderrLength: stderrBytes.length,
    stdoutSha256: sha256Hex(stdoutBytes),
    stderrSha256: sha256Hex(stderrBytes),
    stdoutUtf8: stdoutBytes.toString('utf8'),
    stderrUtf8: stderrBytes.toString('utf8'),
  };
}

// Freezes one immutable snapshot of the full bend2 tree, inventories
// symlinks with their referents, and rejects the run when a symlink referent
// lies outside the snapshot: copied paths must not remain live external
// inputs.
function freezeSnapshot() {
  const snapshotRoot = join(EVIDENCE_DIR, 'snapshot');
  cpSync(join(ROOT, 'bend2'), join(snapshotRoot, 'bend2'), { recursive: true });
  const files = [];
  const symlinks = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = readlinkSync(full);
        let referentReal = null;
        let referentError = null;
        try {
          referentReal = resolve(dirname2(full), target);
        } catch (err) {
          referentError = String(err.message ?? err);
        }
        symlinks.push({
          path: relative(snapshotRoot, full),
          target,
          referentReal,
          referentError,
          insideSnapshot: referentReal ? referentReal.startsWith(snapshotRoot + '/') : false,
        });
        continue;
      }
      if (entry.isDirectory()) walk(full);
      else {
        const bytes = readFileSync(full);
        files.push({ path: relative(snapshotRoot, full), bytes: bytes.length, sha256: sha256Hex(bytes) });
      }
    }
  };
  function dirname2(p) {
    const index = p.lastIndexOf('/');
    return index > 0 ? p.slice(0, index) : '/';
  }
  walk(snapshotRoot);
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const outside = symlinks.filter((link) => !link.insideSnapshot);
  const manifest = { files, symlinks, fileCount: files.length, symlinkCount: symlinks.length };
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  writeFileSync(join(snapshotRoot, 'manifest.json'), manifestBytes);
  return {
    root: snapshotRoot,
    manifestPath: 'snapshot/manifest.json',
    manifestDigest: sha256Hex(manifestBytes),
    fileCount: files.length,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    symlinks,
    symlinksOutsideSnapshot: outside,
  };
}

// Compiles a fresh retained case directory copied from the frozen snapshot
// and returns its cwd. Case directories are never deleted.
function prepareCase(index, name, snapshotRoot) {
  const caseDir = join(CASES_DIR, `${String(index).padStart(3, '0')}-${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
  rmSync(caseDir, { recursive: true, force: true });
  mkdirSync(caseDir, { recursive: true });
  cpSync(join(snapshotRoot, 'bend2'), join(caseDir, 'bend2'), { recursive: true });
  return caseDir;
}

// Compares the complete case closure against the frozen snapshot: the only
// allowed difference is the single target module with exactly the changed
// bytes; every other file must be byte-identical. Returns the structured
// diff used as the full non-target input evidence.
function closureDiff(caseDir, snapshotRoot, relativeTarget, expectedChangedBytes) {
  const changed = [];
  const unexpected = [];
  const missing = [];
  const compare = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(caseDir, full);
      if (entry.isDirectory()) {
        compare(full);
        continue;
      }
      const snapshotPath = join(snapshotRoot, rel);
      let snapshotBytes = null;
      try {
        snapshotBytes = readFileSync(snapshotPath);
      } catch {
        missing.push(rel);
        continue;
      }
      const caseBytes = readFileSync(full);
      if (rel === relativeTarget) {
        if (!caseBytes.equals(expectedChangedBytes)) {
          unexpected.push({ path: rel, reason: 'target bytes differ from the declared changed bytes' });
        } else {
          changed.push(rel);
        }
      } else if (!caseBytes.equals(snapshotBytes)) {
        unexpected.push({ path: rel, reason: 'non-target input differs from the frozen snapshot' });
      }
    }
  };
  compare(caseDir);
  return { changedPaths: changed, unexpectedDiffs: unexpected, missingPaths: missing, closureMatchesSingleEdit: changed.length === 1 && unexpected.length === 0 && missing.length === 0 };
}

// Runs the scoped entry compile inside a case with byte-exact stream
// capture. The raw streams are written into the retained case directory as
// byte-exact JSON documents and their digests recorded; the direct child
// pid is recorded as the direct child.
function runCompiler(caseDir) {
  return runProcess([BEND, LAW_ENTRY, '--check-only'], caseDir);
}

function writeProcessStreams(caseDir, record) {
  // The raw stream bytes are re-created from their exact captured buffers;
  // the JSON documents keep Buffer arrays so no byte is lost.
  writeFileSync(join(caseDir, 'stdout.raw.bytes.json'), JSON.stringify(Buffer.from(record.stdoutUtf8 ?? '', 'utf8')));
  writeFileSync(join(caseDir, 'stderr.raw.bytes.json'), JSON.stringify(Buffer.from(record.stderrUtf8 ?? '', 'utf8')));
  return {
    stdoutFile: join(caseDir, 'stdout.raw.bytes.json'),
    stderrFile: join(caseDir, 'stderr.raw.bytes.json'),
    stdoutSha256: record.stdoutSha256,
    stderrSha256: record.stderrSha256,
  };
}

// Extracts ONE law block by name with its byte range inside the module.
function extractLawBlock(moduleBytes, lawName) {
  const moduleText = moduleBytes.toString('utf8');
  const startOffset = moduleText.indexOf(`law ${lawName}:`);
  if (startOffset === -1) return null;
  const lines = moduleText.slice(startOffset).split('\n');
  const blockLines = [lines[0]];
  let consumed = lines[0].length;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === '' || line.startsWith(' ') || line.startsWith('\t')) {
      blockLines.push(line);
      consumed += line.length + 1;
    } else {
      break;
    }
  }
  const text = blockLines.join('\n');
  return { lawName, source: 'bend2/src/context/runtime module', startOffset, endOffset: startOffset + text.length, bytesLength: Buffer.byteLength(text, 'utf8'), text };
}

const BEND = resolveBend();
mkdirSync(CASES_DIR, { recursive: true });

const rows = [];
let summaryWritten = false;
function writeSummary(failures, extra) {
  if (summaryWritten) return;
  summaryWritten = true;
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
            }
          : null,
        rawStreams: row.rawStreams ?? null,
        definitionDigestLaneLocal: row.definitionDigestLaneLocal ?? null,
      })),
      failures,
      attribution: 'deferred to the sole Interfaces-owned shared checker; this runner reports acquisition only',
      ...extra,
    }, null, 2),
  );
}

function record(row) {
  rows.push(row);
  writeFileSync(join(EVIDENCE_DIR, `${String(rows.length).padStart(3, '0')}-${row.control.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`), JSON.stringify(row, null, 2));
  console.log(JSON.stringify({ control: row.control, acquired: row.acquired ?? false, notAcquiredClass: row.notAcquiredClass ?? null, noProcess: row.noProcess ?? null }));
}

// Run identity: resolved compiler, runtime executable digest, complete
// version process record, and the environment digest over all inherited
// name=value pairs plus the explicit disclosures and overrides.
const identity = {
  node: {
    version: process.version,
    execPath: process.execPath,
    execArgv: process.execArgv,
    executableBytes: safeFileDigest(process.execPath),
  },
  runnerBytes: safeFileDigest(import.meta.filename),
  definitionsBytes: safeFileDigest(join(import.meta.dirname, 'laws-mutation-definitions.mjs')),
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
};
if (BEND) {
  identity.bendBinary = safeFileDigest(BEND);
  identity.bendVersionProcess = runProcess([BEND, 'version'], ROOT);
} else {
  identity.bendBinary = { unavailable: true, reason: 'no Bend executable supplied or found' };
}
writeFileSync(join(EVIDENCE_DIR, '000-run-identity.json'), JSON.stringify(identity, null, 2));
console.log(JSON.stringify({ control: 'run-identity', bendUnavailable: identity.bendUnavailable }));

let failures = 0;
try {
  if (BEND === null) {
    record({ control: 'compiler-unavailable', kind: 'setup', acquired: false, notAcquiredClass: 'compiler-unavailable', noProcess: { reason: 'no Bend executable was supplied or found' } });
    writeSummary((failures += 1), { stopped: 'compiler-unavailable' });
    console.log('laws-mutations: red - no Bend executable');
    process.exit(1);
  }

  // One frozen snapshot for baseline and every case, with symlink
  // inventory; outside referents reject the run.
  const snapshot = freezeSnapshot();
  writeFileSync(join(EVIDENCE_DIR, '001-snapshot.json'), JSON.stringify(snapshot, null, 2));
  if (snapshot.symlinksOutsideSnapshot.length > 0) {
    record({
      control: 'snapshot-symlinks-outside',
      kind: 'setup',
      acquired: false,
      notAcquiredClass: 'symlink-referents-outside-snapshot',
      noProcess: { reason: 'copied paths must not remain live external inputs', symlinks: snapshot.symlinksOutsideSnapshot },
    });
    writeSummary((failures += 1), { stopped: 'symlink-referents-outside-snapshot' });
    console.log('laws-mutations: red - symlink referents outside the snapshot');
    process.exit(1);
  }
  identity.entryBytes = safeFileDigest(join(snapshot.root, LAW_ENTRY));
  writeFileSync(join(EVIDENCE_DIR, '000-run-identity.json'), JSON.stringify(identity, null, 2));

  // Baseline: the frozen snapshot's unchanged entry must compile with exit 0.
  const baselineDir = prepareCase(0, 'baseline', snapshot.root);
  const baselineRun = runCompiler(baselineDir, join(CASES_DIR, '000-baseline'));
  const baselineProcess = { ...baselineRun, rawStreams: undefined };
  const baselineObservation = Buffer.from(JSON.stringify({
    argv: baselineRun.argv, cwd: baselineRun.cwd, exitCode: baselineRun.exitCode, signal: baselineRun.signal,
    spawnError: baselineRun.spawnError, stdoutSha256: baselineRun.stdoutSha256, stderrSha256: baselineRun.stderrSha256,
    stdoutLength: baselineRun.stdoutLength, stderrLength: baselineRun.stderrLength,
  }), 'utf8');
  const baselineObservationDigest = sha256Hex(baselineObservation);
  const baselineAcquired = baselineRun.spawnError === null && baselineRun.signal === null && baselineRun.exitCode === 0;
  record({
    control: 'baseline',
    kind: 'baseline',
    entry: LAW_ENTRY,
    executedCwd: baselineDir,
    snapshot,
    acquired: baselineAcquired,
    notAcquiredClass: baselineAcquired ? null : baselineRun.spawnError ? 'spawn-error' : baselineRun.signal ? 'signal' : 'baseline-nonzero-exit',
    baselineObservationDigest,
    process: baselineRun,
    rawStreams: writeProcessStreams(join(CASES_DIR, '000-baseline'), baselineRun),
  });
  if (!baselineAcquired) {
    writeSummary((failures += 1), { stopped: 'baseline-did-not-compile-cleanly' });
    console.log('laws-mutations: red - baseline did not compile cleanly on the frozen snapshot');
    process.exit(1);
  }

  const caseIndex = { value: 1 };
  function nextCaseDir(name) {
    return prepareCase(caseIndex.value++, name, snapshot.root);
  }

  for (const law of PROOF_REMOVAL_LAWS) {
    const caseDir = nextCaseDir(`proof-${law.name}`);
    const original = readFileSync(join(snapshot.root, law.file));
    const originalText = original.toString('utf8');
    const proofPattern = new RegExp(`\\ndef ${law.name}\\([^)]*\\):\\n  \\{==\\}\\n`);
    const match = proofPattern.exec(originalText);
    if (!match) {
      record({ control: `proof-removal:${law.name}`, kind: 'proof-removal', law: law.name, source: law.file, acquired: false, notAcquiredClass: 'find-text-absent', noProcess: { reason: 'proof def not found in the frozen module' } });
      failures += 1;
      continue;
    }
    const findIndex = match.index;
    const removal = match[0];
    const changed = Buffer.from(originalText.slice(0, findIndex) + '\n' + originalText.slice(findIndex + removal.length), 'utf8');
    writeFileSync(moduleAbs, changed);
    const lawBlock = extractLawBlock(original, law.name);
    if (lawBlock) writeFileSync(join(caseDir, `law-${law.name}.txt`), Buffer.from(lawBlock.text, 'utf8'));
    const run = runCompiler(caseDir);
    writeProcessStreams(caseDir, run);
    const closure = closureDiff(caseDir, snapshot.root, law.file, changed);
    const acquired = run.spawnError === null && run.signal === null && run.exitCode !== null && closure.closureMatchesSingleEdit;
    record({
      control: `proof-removal:${law.name}`,
      kind: 'proof-removal',
      law: law.name,
      source: law.file,
      entry: LAW_ENTRY,
      executedCwd: caseDir,
      snapshot,
      acquired,
      notAcquiredClass: acquired ? null : run.spawnError ? 'spawn-error' : run.signal ? 'signal' : closure.closureMatchesSingleEdit ? 'missing-status' : 'closure-mismatch',
      lawLinkage: {
        intendedLaw: law.name,
        lawBlock: lawBlock ? { startOffset: lawBlock.startOffset, endOffset: lawBlock.endOffset, bytesLength: lawBlock.bytesLength } : null,
        edit: { kind: 'proof-removal', offset: findIndex, removedBytes: Buffer.byteLength(removal, 'utf8'), addedBytes: 1 },
        removedProofBytes: Buffer.byteLength(removal, 'utf8'),
        unchangedSurroundings: {
          beforeSha256: sha256Hex(original.subarray(0, findIndex)),
          afterSha256: sha256Hex(original.subarray(findIndex + removal.length)),
        },
        moduleBefore: { bytes: original.length, sha256: sha256Hex(original) },
        moduleAfter: { bytes: changed.length, sha256: sha256Hex(changed) },
      },
      baselineObservationDigest,
      closure,
      process: run,
      rawStreams: writeProcessStreams(caseDir, run),
    });
    if (!acquired) failures += 1;
  }

  for (const definition of MUTATION_DEFINITIONS) {
    const caseDir = nextCaseDir(`mutation-${definition.name}`);
    const original = readFileSync(join(snapshot.root, definition.file));
    const originalText = original.toString('utf8');
    const findIndex = originalText.indexOf(definition.find);
    if (findIndex === -1) {
      record({ control: `mutation:${definition.name}`, kind: 'mutation', law: definition.law, source: definition.file, acquired: false, notAcquiredClass: 'find-text-absent', noProcess: { reason: 'find text absent from the frozen module' } });
      failures += 1;
      continue;
    }
    const changed = Buffer.from(originalText.slice(0, findIndex) + definition.replace + originalText.slice(findIndex + definition.find.length), 'utf8');
    writeFileSync(join(caseDir, definition.file), changed);
    const lawBlock = extractLawBlock(original, definition.law);
    if (lawBlock) writeFileSync(join(caseDir, `law-${definition.law}.txt`), Buffer.from(lawBlock.text, 'utf8'));
    const run = runCompiler(caseDir);
    const closure = closureDiff(caseDir, snapshot.root, definition.file, changed);
    const acquired = run.spawnError === null && run.signal === null && run.exitCode !== null && closure.closureMatchesSingleEdit;
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
      executedCwd: caseDir,
      snapshot,
      acquired,
      notAcquiredClass: acquired ? null : run.spawnError ? 'spawn-error' : run.signal ? 'signal' : closure.closureMatchesSingleEdit ? 'missing-status' : 'closure-mismatch',
      declaredExpectations: { expected: definition.expected, observed: definition.observed, boundTo: { definition: definition.name, source: definition.file, entry: definition.entry } },
      definitionDigestLaneLocal: { digest: sha256Hex(Buffer.from(canonical, 'utf8')), note: 'lane-local observation over this lane serialization; canonical serialization and digest reconciliation are owned by CI/Interfaces' },
      historicDigest: definition.historicDigest,
      definitionsModuleBytes: identity.definitionsBytes,
      lawLinkage: {
        intendedLaw: definition.law,
        lawBlock: lawBlock ? { startOffset: lawBlock.startOffset, endOffset: lawBlock.endOffset, bytesLength: lawBlock.bytesLength } : null,
        edit: { kind: 'replace', offset: findIndex, removedBytes: Buffer.byteLength(definition.find, 'utf8'), addedBytes: Buffer.byteLength(definition.replace, 'utf8') },
        unchangedSurroundings: {
          beforeSha256: sha256Hex(original.subarray(0, findIndex)),
          afterSha256: sha256Hex(original.subarray(findIndex + definition.find.length)),
        },
        moduleBefore: { bytes: original.length, sha256: sha256Hex(original) },
        moduleAfter: { bytes: changed.length, sha256: sha256Hex(changed) },
      },
      baselineObservationDigest,
      closure,
      process: run,
      rawStreams: writeProcessStreams(caseDir, run),
    });
    if (!acquired) failures += 1;
  }

  writeSummary(failures, { snapshot });
  console.log(
    `laws-mutations: ${failures === 0 ? 'complete' : 'incomplete'} - baseline + ${PROOF_REMOVAL_LAWS.length} proof removals + ${MUTATION_DEFINITIONS.length} mutations, ${failures} not acquired, evidence in ${EVIDENCE_DIR}`,
  );
  process.exit(failures === 0 ? 0 : 1);
} catch (err) {
  failures += 1;
  writeSummary(failures, { stopped: `setup-failure: ${String(err && err.stack ? err.stack : err)}` });
  console.log(`laws-mutations: red - setup failure: ${String(err && err.message ? err.message : err)}`);
  process.exit(1);
}
