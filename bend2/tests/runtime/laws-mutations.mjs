#!/usr/bin/env node
// Scoped negative-control acquisition for the runtime-values law modules.
// This runner acquires raw evidence only; classification of the retained
// diagnostics belongs to the sole Interfaces-owned shared checker, and the
// corrected --classify API and schema are pending, so no predicate and no
// schema are implemented or frozen here.
//
// What one run retains, per control: the exact compiler argv, cwd, recorded
// environment policy, compiler path and binary digest, the compiler's own
// `version` output, the compiler child process id (this wrapper's pid is
// recorded separately and is not the compiler pid), actual start and end
// times, the observed exit status or signal or spawn error, the complete
// stdout and stderr streams separately with byte lengths and SHA-256
// digests, and the source snapshot binding: SHA-256 of the entry, the two
// law modules, and the development entry, identical to the successful
// unchanged baseline's snapshot. Each mutation retains its definition JSON
// and digest, the original and changed module bytes' hashes, the exact
// replaced delta, and the unchanged law text digest. Scratch is recreated
// per control from the tree and non-target inputs are hashed to show they
// did not change.
//
// Outcome vocabulary (raw, not a classifier verdict):
//   baseline-ok            the unchanged entry compiled with exit 0
//   proof-refusal          a proof-removal control whose diagnostics are
//                          exactly the known two-line Bend proof-removal
//                          shape (the diagnostic carries no law name, so the
//                          binding is the exact proof edit plus completed
//                          status plus the unchanged snapshot, never a name
//                          substring)
//   mutation-refusal       an implementation-mutation control where the
//                          compiler ran, exited nonzero through normal
//                          status, and produced nonempty diagnostics; the
//                          raw diagnostics are retained for the shared
//                          classifier to attribute
//   unqualified            everything else, with its named class:
//                          compiler-unavailable, spawn-error, signal,
//                          empty-diagnostics, baseline-failure,
//                          snapshot-mismatch, proof-shape-mismatch,
//                          find-text-absent
// A syntax error, a launch failure, an exception, a signal, resource loss,
// missing metadata, or a baseline or unrelated error is never a law refusal.
//
// Usage, on an admitted runner:
//   node bend2/tests/runtime/laws-mutations.mjs [path-to-bend-2.0.25]
// Prints one JSON row per control and a final summary; exits nonzero when
// the baseline failed, any expected refusal was unqualified, or any control
// outcome is unqualified.

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, createHash, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const ENTRY = join('bend2', 'tests', 'runtime', 'observations-laws.bend');
const CAPTURE_MODULE = join('bend2', 'src', 'context', 'runtime', 'observations-capture.bend');
const CLASSIFY_MODULE = join('bend2', 'src', 'context', 'runtime', 'observations-classification.bend');
const SCRATCH = join(ROOT, '.scratch', 'runtime-values-laws-mutations');
const EVIDENCE_DIR =
  process.env.BATON_RUNTIME_EVIDENCE_DIR ??
  join(ROOT, '.scratch', 'runtime-values-laws-evidence', new Date().toISOString().replace(/[:.]/g, '-'));
const ENV = { ...process.env, BEND_NO_TELEMETRY: '1' };

// The proof-removal diagnostic of Bend 2.0.25 on this platform is exactly
// these two lines and carries no law name.
const PROOF_REMOVAL_DIAGNOSTIC =
  'Error: 1 TODO found.\nThe code is incomplete, and not a valid proof yet.';

const CAPTURE = 'observations-capture.bend';
const CLASSIFY = 'observations-classification.bend';

const LAWS = [
  { name: 'runtime_evidence_preserves_every_identity_member', file: CAPTURE },
  { name: 'capture_record_carries_both_event_identities_and_the_fixed_consistency_pair', file: CAPTURE },
  { name: 'capture_without_an_end_event_stays_open', file: CAPTURE },
  { name: 'runtime_fact_admits_only_the_observed_classification', file: CLASSIFY },
  { name: 'class_tags_are_the_four_fixed_names', file: CLASSIFY },
  { name: 'expansion_admits_each_class_at_itself', file: CLASSIFY },
  { name: 'observed_expansion_refuses_every_other_classification', file: CLASSIFY },
  { name: 'observed_value_completeness_follows_the_conservative_rule', file: CLASSIFY },
  { name: 'a_preview_is_incomplete_regardless_of_its_flags', file: CLASSIFY },
];

// The implementation mutations this lane contributes. Each definition names
// its source file, the scoped entry, the intended qualified law, the exact
// find/replace delta, and the expected and observed constructors the law
// comparison should produce. Definitions are exported for the sole
// Interfaces-owned laws-mutations export; the authoritative digest is over
// the canonical JSON of the definition without the derived digest field.
export const MUTATION_DEFINITIONS = [
  {
    name: 'capture-record-changes-consistency',
    file: CAPTURE,
    entry: ENTRY,
    law: 'capture_record_carries_both_event_identities_and_the_fixed_consistency_pair',
    expected: 'CaptureRecord{consistency: "per-response", controlExclusivity: "unverified", ...}',
    observed: 'CaptureRecord{consistency: "per-response-wrong", controlExclusivity: "unverified", ...}',
    find: 'consistency: "per-response"',
    replace: 'consistency: "per-response-wrong"',
  },
  {
    name: 'capture-record-claims-verified-exclusivity',
    file: CAPTURE,
    entry: ENTRY,
    law: 'capture_record_carries_both_event_identities_and_the_fixed_consistency_pair',
    expected: 'CaptureRecord{controlExclusivity: "unverified", ...}',
    observed: 'CaptureRecord{controlExclusivity: "verified", ...}',
    find: 'controlExclusivity: "unverified"',
    replace: 'controlExclusivity: "verified"',
  },
  {
    name: 'unfinished-capture-manufactures-a-record',
    file: CAPTURE,
    entry: ENTRY,
    law: 'capture_without_an_end_event_stays_open',
    expected: 'CaptureOpen{detail: "multirequest capture has no end event identity"}',
    observed: 'CaptureRecord{startEvent, endEvent, consistency: "per-response", controlExclusivity: "unverified", epoch}',
    find: 'case False{}: CaptureOpen{detail: "multirequest capture has no end event identity"}',
    replace: 'case False{}: CaptureRecord{startEvent: startEvent, endEvent: endEvent, consistency: "per-response", controlExclusivity: "unverified", epoch: epoch}',
  },
  {
    name: 'runtime-evidence-drops-the-original-member',
    file: CAPTURE,
    entry: ENTRY,
    law: 'runtime_evidence_preserves_every_identity_member',
    expected: 'RuntimeEvidence{..., original: original}',
    observed: 'RuntimeEvidence{..., original: ""}',
    find: 'RuntimeEvidence{runtime: runtime, epoch: epoch, thread: thread, script: script, generated: generated, original: original}',
    replace: 'RuntimeEvidence{runtime: runtime, epoch: epoch, thread: thread, script: script, generated: generated, original: ""}',
  },
  {
    name: 'runtime-facts-admit-checked',
    file: CLASSIFY,
    entry: ENTRY,
    law: 'runtime_fact_admits_only_the_observed_classification',
    expected: 'fact_class_admitted(Checked{}) == False{}',
    observed: 'fact_class_admitted(Checked{}) == True{}',
    find: 'match cls:\n    case Observed{}: True{}\n    case StaticPossible{}: False{}\n    case Checked{}: False{}',
    replace: 'match cls:\n    case Observed{}: True{}\n    case StaticPossible{}: False{}\n    case Checked{}: True{}',
  },
  {
    name: 'expansion-upgrades-every-fact-to-observed',
    file: CLASSIFY,
    entry: ENTRY,
    law: 'observed_expansion_refuses_every_other_classification',
    expected: 'expansion_admitted(Observed{}, StaticPossible{}) == False{}',
    observed: 'expansion_admitted(Observed{}, StaticPossible{}) == True{}',
    find: 'String.eq(class_tag(original), class_tag(proposed))',
    replace: 'True{}',
  },
  {
    name: 'static-possible-tag-renamed',
    file: CLASSIFY,
    entry: ENTRY,
    law: 'class_tags_are_the_four_fixed_names',
    expected: 'class_tag(StaticPossible{}) in {"observed", "static-possible", "checked", "declared"}',
    observed: 'class_tag(StaticPossible{}) == "static"',
    find: '"static-possible"',
    replace: '"static"',
  },
  {
    name: 'completeness-ignores-the-preview',
    file: CLASSIFY,
    entry: ENTRY,
    law: 'observed_value_completeness_follows_the_conservative_rule',
    expected: 'observed_value_complete(hasPreview, overflow) == Bool.and(Bool.not(hasPreview), Bool.not(overflow))',
    observed: 'observed_value_complete(hasPreview, overflow) == Bool.not(overflow)',
    find: 'Bool.and(Bool.not(hasPreview), Bool.not(expansionOverflow))',
    replace: 'Bool.not(expansionOverflow)',
  },
];

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function resolveBend() {
  const candidates = [process.argv[2], process.env.BEND].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function sourceSnapshot() {
  const read = (rel) => sha256Hex(readFileSync(join(ROOT, rel)));
  return {
    entry: { path: ENTRY, sha256: read(ENTRY) },
    captureModule: { path: CAPTURE_MODULE, sha256: read(CAPTURE_MODULE) },
    classifyModule: { path: CLASSIFY_MODULE, sha256: read(CLASSIFY_MODULE) },
  };
}

function fileDigest(path) {
  try {
    const stats = statSync(path);
    return { path, size: stats.size, sha256: sha256Hex(readFileSync(path)) };
  } catch (err) {
    return { path, error: String(err.message ?? err) };
  }
}

function prepareScratch() {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  cpSync(join(ROOT, 'bend2'), join(SCRATCH, 'bend2'), { recursive: true });
}

// Runs the scoped entry compile. Records the observed process identity: the
// direct child is the compiler process itself; this wrapper's pid is
// recorded separately and is not the compiler pid.
function runCompiler(cwd) {
  const started = new Date().toISOString();
  const startedMs = Date.now();
  let result;
  try {
    const child = spawnSync(BEND, [ENTRY, '--check-only'], { env: ENV, cwd, encoding: 'utf8', maxBuffer: Infinity });
    result = {
      ran: child.error == null,
      spawnError: child.error ? String(child.error.message ?? child.error) : null,
      exitCode: child.status,
      signal: child.signal,
      stdout: child.stdout ?? '',
      stderr: child.stderr ?? '',
    };
  } catch (err) {
    result = { ran: false, spawnError: String(err.message ?? err), exitCode: null, signal: null, stdout: '', stderr: '' };
  }
  const diagnostics = `${result.stdout}${result.stderr}`;
  return {
    argv: [BEND, ENTRY, '--check-only'],
    cwd,
    wrapperPid: process.pid,
    compilerPid: null,
    started,
    ended: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    exitCode: result.exitCode,
    signal: result.signal,
    spawnError: result.spawnError,
    stdout: result.stdout,
    stderr: result.stderr,
    stdoutBytes: Buffer.byteLength(result.stdout, 'utf8'),
    stderrBytes: Buffer.byteLength(result.stderr, 'utf8'),
    stdoutSha256: sha256Hex(Buffer.from(result.stdout, 'utf8')),
    stderrSha256: sha256Hex(Buffer.from(result.stderr, 'utf8')),
    diagnostics,
  };
}

const BEND = resolveBend();
mkdirSync(EVIDENCE_DIR, { recursive: true });

// Run identity: the admitted runner records the exact compiler archive or
// binary identity, its version output, and the environment policy.
const identity = {
  node: process.version,
  execPath: process.execPath,
  execArgv: process.execArgv,
  cwd: ROOT,
  entry: ENTRY,
  scratch: SCRATCH,
  environmentPolicy: { set: { BEND_NO_TELEMETRY: '1' }, inherited: 'runner environment, recorded in the run receipt' },
  bendRequested: BEND,
  bendUnavailable: BEND === null,
};
if (BEND) {
  identity.bendBinary = fileDigest(BEND);
  try {
    identity.bendVersion = execFileSync(BEND, ['version'], { env: ENV, encoding: 'utf8' }).trim();
  } catch (err) {
    identity.bendVersion = `unavailable: ${String(err.message ?? err)}`;
  }
}
writeFileSync(join(EVIDENCE_DIR, '000-run-identity.json'), JSON.stringify(identity, null, 2));

const rows = [];
let failures = 0;
function record(row) {
  rows.push(row);
  writeFileSync(join(EVIDENCE_DIR, `${String(rows.length).padStart(3, '0')}-${row.control}.json`), JSON.stringify(row, null, 2));
  console.log(JSON.stringify(row));
}

if (BEND === null) {
  record({ control: 'compiler-unavailable', outcome: 'unqualified', class: 'compiler-unavailable', refused: false });
  console.log(`laws-mutations: red - no Bend executable; ${rows.length} rows in ${EVIDENCE_DIR}`);
  process.exit(1);
}

// Baseline: the unchanged entry must compile with exit 0, and its frozen
// snapshot binds every later control. One complete snapshot is frozen here
// for baseline and cases; the original and changed module bytes, the law
// text and the exact delta are retained beside each control's diagnostics so
// no evidence row references bytes that were deleted.
prepareScratch();
const FROZEN_SNAPSHOT = sourceSnapshot();
const baselineRun = runCompiler(SCRATCH);
const baseline = {
  control: 'baseline',
  outcome: baselineRun.exitCode === 0 ? 'baseline-ok' : 'unqualified',
  class: baselineRun.exitCode === 0 ? null : (baselineRun.spawnError ? 'spawn-error' : baselineRun.signal ? 'signal' : 'baseline-failure'),
  snapshot: FROZEN_SNAPSHOT,
  run: baselineRun,
};
record(baseline);
if (baseline.outcome !== 'baseline-ok') {
  failures += 1;
  console.log(`laws-mutations: red - baseline failed; ${rows.length} rows in ${EVIDENCE_DIR}`);
  process.exit(1);
}

const originalCapture = readFileSync(join(ROOT, CAPTURE_MODULE), 'utf8');
const originalClassify = readFileSync(join(ROOT, CLASSIFY_MODULE), 'utf8');
const originals = { [CAPTURE]: originalCapture, [CLASSIFY]: originalClassify };

function unchangedLawText(moduleText) {
  // The law blocks must be byte-identical across a mutation: each `law `
  // line plus its indented and blank continuation lines, joined in order.
  return sha256Hex(Buffer.from(extractLawText(moduleText), 'utf8'));
}

function extractLawText(moduleText) {
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
  return blocks.map((block) => block.join('\n')).join('\n\n');
}

for (const law of LAWS) {
  prepareScratch();
  const modulePath = join(SCRATCH, 'bend2', 'src', 'context', 'runtime', law.file);
  const original = readFileSync(join(ROOT, 'bend2', 'src', 'context', 'runtime', law.file), 'utf8');
  const proofPattern = new RegExp(`\\ndef ${law.name}\\([^)]*\\):\\n  \\{==\\}\\n`);
  if (!proofPattern.test(original)) {
    record({ control: `proof-removal:${law.name}`, outcome: 'unqualified', class: 'find-text-absent', refused: false, law: law.name });
    failures += 1;
    continue;
  }
  const changed = original.replace(proofPattern, '\n');
  const before = sha256Hex(Buffer.from(original, 'utf8'));
  const after = sha256Hex(Buffer.from(changed, 'utf8'));
  writeFileSync(modulePath, changed);
  const compiledBytesMatch = sha256Hex(readFileSync(modulePath)) === after;
  writeFileSync(join(EVIDENCE_DIR, `bytes-proof-removal-${law.name}-original.bend`), original);
  writeFileSync(join(EVIDENCE_DIR, `bytes-proof-removal-${law.name}-changed.bend`), changed);
  const run = runCompiler(SCRATCH);
  const shapeMatch = run.diagnostics.trim() === PROOF_REMOVAL_DIAGNOSTIC;
  const refused =
    compiledBytesMatch &&
    run.spawnError === null &&
    run.signal === null &&
    run.exitCode !== 0 &&
    run.diagnostics.trim() !== '' &&
    shapeMatch;
  record({
    control: `proof-removal:${law.name}`,
    law: law.name,
    source: `bend2/src/context/runtime/${law.file}`,
    entry: ENTRY,
    outcome: refused ? 'proof-refusal' : 'unqualified',
    class: refused ? null : shapeMatch ? null : 'proof-shape-mismatch',
    refused,
    mutation: { kind: 'proof-removal', before, after },
    lawTextDigest: unchangedLawText(changed),
    lawTextUnchanged: unchangedLawText(changed) === unchangedLawText(original),
    compiledBytesMatch,
    frozenSnapshot: FROZEN_SNAPSHOT,
    run,
  });
  if (!refused) failures += 1;
}

for (const definition of MUTATION_DEFINITIONS) {
  prepareScratch();
  const original = originals[definition.file];
  if (!original.includes(definition.find)) {
    record({
      control: `mutation:${definition.name}`,
      outcome: 'unqualified',
      class: 'find-text-absent',
      refused: false,
      law: definition.law,
    });
    failures += 1;
    continue;
  }
  const changed = original.replace(definition.find, definition.replace);
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
  const modulePath = join(SCRATCH, 'bend2', 'src', 'context', 'runtime', definition.file);
  writeFileSync(modulePath, changed);
  const compiledBytesMatch = sha256Hex(readFileSync(modulePath)) === sha256Hex(Buffer.from(changed, 'utf8'));
  writeFileSync(join(EVIDENCE_DIR, `bytes-mutation-${definition.name}-original.bend`), original);
  writeFileSync(join(EVIDENCE_DIR, `bytes-mutation-${definition.name}-changed.bend`), changed);
  writeFileSync(join(EVIDENCE_DIR, `law-text-${definition.name}.txt`), extractLawText(changed));
  const run = runCompiler(SCRATCH);
  const refused =
    compiledBytesMatch &&
    run.spawnError === null &&
    run.signal === null &&
    run.exitCode !== 0 &&
    run.diagnostics.trim() !== '';
  // Diagnostic correlation is recorded raw for the shared classifier; it
  // gates nothing here. The expected and observed constructors count as
  // correlated when both appear in the retained diagnostics.
  const correlated =
    run.diagnostics.includes(definition.expected.split('(')[0].trim()) ||
    run.diagnostics.includes(definition.expected.split('{')[0].trim()) ||
    (run.diagnostics.length > 0 && run.diagnostics.includes(definition.law));
  record({
    control: `mutation:${definition.name}`,
    law: definition.law,
    source: `bend2/src/context/runtime/${definition.file}`,
    entry: definition.entry,
    outcome: refused ? 'mutation-refusal' : 'unqualified',
    class: refused ? null : run.spawnError ? 'spawn-error' : run.signal ? 'signal' : run.diagnostics.trim() === '' ? 'empty-diagnostics' : 'unqualified',
    refused,
    definitionDigest: sha256Hex(Buffer.from(canonical, 'utf8')),
    definition,
    moduleBefore: sha256Hex(Buffer.from(original, 'utf8')),
    moduleAfter: sha256Hex(Buffer.from(changed, 'utf8')),
    delta: { findBytes: Buffer.byteLength(definition.find, 'utf8'), replaceBytes: Buffer.byteLength(definition.replace, 'utf8') },
    lawTextDigest: unchangedLawText(changed),
    lawTextUnchanged: unchangedLawText(changed) === unchangedLawText(original),
    lawTextSha256: sha256Hex(Buffer.from(extractLawText(changed), 'utf8')),
    compiledBytesMatch,
    nonTargetInputs: [fileDigest(join(SCRATCH, ENTRY)), fileDigest(join(SCRATCH, definition.file === CAPTURE ? CLASSIFY_MODULE : CAPTURE_MODULE))],
    diagnosticCorrelation: { correlated, note: 'raw observation only; attribution belongs to the shared classifier' },
    frozenSnapshot: FROZEN_SNAPSHOT,
    run,
  });
  if (!refused) failures += 1;
}

rmSync(SCRATCH, { recursive: true, force: true });
writeFileSync(join(EVIDENCE_DIR, 'summary.json'), JSON.stringify({ rows, failures }, null, 2));
console.log(
  `laws-mutations: ${failures === 0 ? 'green' : 'red'} - baseline + ${LAWS.length} proof removals + ${MUTATION_DEFINITIONS.length} mutations, ${failures} unqualified, evidence in ${EVIDENCE_DIR}`,
);
process.exit(failures === 0 ? 0 : 1);
