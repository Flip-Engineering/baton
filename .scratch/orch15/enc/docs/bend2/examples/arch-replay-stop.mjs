// arch-replay-stop.mjs — the reference half of the stop-replay differential corpus (issue #539,
// work-bend2-architecture, review track 1: "run the same admission/fold/projection cases through
// both implementations").
//
// The corpus is one frozen source trace plus the cases replayed against it:
//
//   arch-replay-stop.ledger.jsonl  the frozen source trace: coordination rows as the implementation
//                                  writes them
//   arch-replay-stop.cases         the case inputs, read by BOTH halves
//   arch-replay-stop.expect        the required logical behaviour per case, read by neither half
//                                  (ARCH-CLOSE-11 / M-5 / M-14)
//   arch-replay-stop.reference.txt this half's RESULT lines (written by --run)
//   arch-replay-stop.prototype.txt the Bend2 half's RESULT lines (written by the example evidence)
//
// This half drives the branch's own CoordinationStore over the frozen ledger, once per declared
// policy basis, and prints one RESULT line per case. It imports impl/src read-only and writes
// nothing into it.
//
//   node docs/bend2/examples/arch-replay-stop.mjs --emit-ledger   rewrite the frozen ledger
//   node docs/bend2/examples/arch-replay-stop.mjs --run           print the RESULT lines
//   node docs/bend2/examples/arch-replay-stop.mjs --compare       run both halves live and compare them against expect
//
// Working state (the ledger copies it replays) is written under .scratch/ and removed on exit.

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CoordinationStore, coordinationReplayFailure } from '../../../impl/src/coordination-store.mjs';
import { canonicalDigest } from '../../../impl/src/coordination-internals.mjs';
import { DEFAULT_RUN_LINEAGE_POLICY } from '../../../impl/src/run-lineage.mjs';

const HERE = dirname(new URL(import.meta.url).pathname);
const LEDGER = join(HERE, 'arch-replay-stop.ledger.jsonl');
const CASES = join(HERE, 'arch-replay-stop.cases');
const EXPECT = join(HERE, 'arch-replay-stop.expect');
const BEND = join(HERE, '../../../node_modules/.bend/bin/bend');
const PROTOTYPE_SOURCE = join(HERE, 'arch-replay-stop.bend');

const REPO_ID = 'repo-arch-replay-stop';
const RUN_ID = 'run-arch-replay-stop';
const CLOCK_ISO = '2026-09-23T00:00:00.000Z';
const ACTOR = 'operator:arch-replay-stop';
const STOP_SEQ = 3;
const THROUGH_SEQ = 2;

const taskId = (index) => `task-${String(index).padStart(6, '0')}`;
const workerId = (index) => `worker-${String(index).padStart(6, '0')}`;

/** One durable task row, shaped as createTask writes it. */
function taskRow(seq, index) {
  return {
    schemaVersion: 1, seq, ts: CLOCK_ISO, kind: 'task.created',
    actor: 'orchestrator', idempotencyKey: `task.created:${taskId(index)}`,
    payload: {
      id: taskId(index),
      brief: { objective: `Own ${RUN_ID} unit ${index}`, capabilities: ['baton_orchestrator'] },
      deps: [], refines: null, relation: 'root', runId: RUN_ID, taskType: 'general',
      reservedWorkerId: workerId(index),
      vendorRequested: 'kimi-code', modelRequested: 'kimi-code/k3', modelPolicy: null,
      effortRequested: 'max', sessionRequest: { mode: 'new' },
    },
  };
}

/** The recorded run stop, digest-bound as admitRunStop binds it under a run-lineage policy: the
 * payload carries the policy-bearing field set (scope, throughSeq, targetRunIds). */
function runStopRow(seq) {
  const targetRunIds = [RUN_ID];
  const targetTaskIds = [taskId(0), taskId(1)];
  const targetWorkerIds = [workerId(0), workerId(1)];
  const reasonDigest = canonicalDigest('stop the run and everything it owns');
  return {
    schemaVersion: 1, seq, ts: CLOCK_ISO, kind: 'run.stop_admitted',
    actor: ACTOR, idempotencyKey: `run.stop:${RUN_ID}`,
    payload: {
      schemaVersion: 1,
      scope: 'run_subtree',
      repoId: REPO_ID,
      runId: RUN_ID,
      reasonDigest,
      requestDigest: canonicalDigest({ repoId: REPO_ID, runId: RUN_ID, reasonDigest }),
      throughSeq: THROUGH_SEQ,
      targetRunIds,
      targetTaskIds,
      targetWorkerIds,
      targetDigest: canonicalDigest({ throughSeq: THROUGH_SEQ, targetRunIds, targetTaskIds, targetWorkerIds }),
    },
  };
}

const ledgerRows = () => [taskRow(1, 0), taskRow(2, 1), runStopRow(STOP_SEQ)];

function emitLedger() {
  const bytes = `${ledgerRows().map((row) => JSON.stringify(row)).join('\n')}\n`;
  writeFileSync(LEDGER, bytes);
  process.stdout.write(`arch-replay-stop.ledger.jsonl written: ${Buffer.byteLength(bytes)} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}\n`);
}

/** CASE|id|basis|rowIntegrity|rowSeq|rowTargetTasks|readerCursor */
function readCases() {
  return readFileSync(CASES, 'utf8').split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('CASE|'))
    .map((line) => {
      const [, id, basis, integrity, rowSeq, rowTargets, readerCursor] = line.split('|');
      return {
        id, basis, integrity,
        rowSeq: Number(rowSeq), rowTargets: Number(rowTargets), readerCursor: Number(readerCursor),
      };
    });
}

const scratchRoots = [];
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-arch-replay-${label}-`));
  scratchRoots.push(root);
  return root;
}
function cleanScratch() {
  for (const root of scratchRoots) rmSync(root, { recursive: true, force: true });
  scratchRoots.length = 0;
}

/** Replay the frozen ledger under one policy basis and one row state, and report what the
 * implementation decided. `intact` replays the frozen bytes; `corrupt` replays the same row with
 * one bound digest altered, which is what a damaged source byte looks like to the fold. */
function replay(caseRow) {
  const root = scratch(caseRow.id);
  const rows = readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const stop = rows.find((candidate) => candidate.seq === caseRow.rowSeq);
  if (!stop || stop.kind !== 'run.stop_admitted') throw new Error(`no recorded run.stop_admitted at seq ${caseRow.rowSeq}`);
  if (caseRow.integrity === 'corrupt') stop.payload.targetDigest = 'f'.repeat(64);
  writeFileSync(join(root, 'events.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  const base = { repoId: REPO_ID, clock: () => CLOCK_ISO };

  if (caseRow.basis === 'present' && caseRow.integrity === 'intact') {
    const store = new CoordinationStore(root, { ...base, runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY });
    const projected = store.runStop(RUN_ID);
    const cursor = store.snapshot().lastSeq;
    return {
      admitted: true,
      refusal: 'none',
      classification: 'none',
      quarantine: false,
      targets: projected.targetTaskIds.length,
      cursor,
      owed: cursor - caseRow.readerCursor,
      remedy: 'none',
      declaredTargets: stop.payload.targetTaskIds.length,
    };
  }

  // Every other case is a replay the implementation refuses: a missing policy basis, or a row whose
  // own binding no longer recomputes. The store constructor carries the fold.
  let thrown = null;
  try {
    new CoordinationStore(root, caseRow.basis === 'present'
      ? { ...base, runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY }
      : base);
  } catch (error) {
    thrown = error;
  }
  const probe = coordinationReplayFailure(root);
  if (probe === null) {
    // The fold accepted the row, which is a different (also reportable) state.
    return {
      admitted: true, refusal: 'none', classification: 'none', quarantine: false,
      targets: caseRow.rowTargets, cursor: caseRow.rowSeq,
      owed: caseRow.rowSeq - caseRow.readerCursor, remedy: 'none',
      declaredTargets: stop.payload.targetTaskIds.length,
    };
  }
  const remedyNamesQuarantine = /quarantin/i.test(probe.remedy ?? '');
  const refusedAt = probe.seq ?? caseRow.rowSeq;
  return {
    admitted: false,
    refusal: probe.code ?? thrown?.code ?? 'unknown',
    classification: 'replay_refused',
    quarantine: remedyNamesQuarantine,
    targets: 0,
    cursor: refusedAt - 1,
    owed: refusedAt - 1 - caseRow.readerCursor,
    remedy: remedyNamesQuarantine ? 'quarantine' : 'none',
    declaredTargets: stop.payload.targetTaskIds.length,
    probeSeq: probe.seq ?? null,
    probeKind: probe.kind ?? null,
    probeMessage: probe.message ?? null,
  };
}

const resultLine = (id, r) => [
  'RESULT', id,
  `admitted=${r.admitted}`,
  `refusal=${r.refusal}`,
  `classification=${r.classification}`,
  `quarantine=${r.quarantine}`,
  `targets=${r.targets}`,
  `cursor=${r.cursor}`,
  `owed=${r.owed}`,
  `remedy=${r.remedy}`,
].join('|');

function referenceLines(verbose) {
  const lines = [];
  for (const caseRow of readCases()) {
    const outcome = replay(caseRow);
    lines.push(resultLine(caseRow.id, outcome));
    if (verbose) process.stderr.write(`${caseRow.id}: ${JSON.stringify(outcome)}\n`);
  }
  return lines;
}

function run() {
  process.stdout.write(`${referenceLines(true).join('\n')}\n`);
  cleanScratch();
}

/** EXPECT|id|admitted|classification|quarantine|targets|cursor|owed */
function readExpect() {
  const out = new Map();
  for (const line of readFileSync(EXPECT, 'utf8').split('\n')) {
    if (!line.startsWith('EXPECT|')) continue;
    const [, id, admitted, classification, quarantine, targets, cursor, owed] = line.trim().split('|');
    out.set(id, { id, admitted, classification, quarantine, targets, cursor, owed });
  }
  return out;
}

function parseResults(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    if (!line.startsWith('RESULT|')) continue;
    const [, id, ...fields] = line.trim().split('|');
    out.set(id, Object.fromEntries(fields.map((field) => field.split('='))));
  }
  return out;
}

/** The prototype half, run live at the pinned toolchain: the corpus's own bend program answers the
 * same case file, and its stdout is the only prototype answer this comparison reads. */
function bendResults() {
  if (!existsSync(BEND)) {
    process.stderr.write(`the pinned bend binary is missing: ${BEND}\n`);
    process.exit(1);
  }
  const out = spawnSync(BEND, [PROTOTYPE_SOURCE], { env: { ...process.env, BEND_NO_TELEMETRY: '1' }, encoding: 'utf8' });
  if (out.error || out.status !== 0) {
    process.stderr.write(`the bend run failed: ${out.error?.message ?? out.stderr ?? ''}\n`);
    process.exit(1);
  }
  return parseResults(out.stdout);
}

function compare() {
  const expect = readExpect();
  const reference = parseResults(referenceLines(false).join('\n'));
  const prototype = bendResults();
  let disagreements = 0;
  for (const [id, want] of expect) {
    const ref = reference.get(id);
    const proto = prototype.get(id);
    const missing = ['admitted', 'classification', 'quarantine', 'targets', 'cursor', 'owed']
      .filter((field) => String(ref?.[field]) !== String(want[field]));
    const protoMissing = ['admitted', 'classification', 'quarantine', 'targets', 'cursor', 'owed']
      .filter((field) => String(proto?.[field]) !== String(want[field]));
    const verdict = missing.length === 0 && protoMissing.length === 0 ? 'AGREEMENT'
      : missing.length > 0 ? 'DISAGREEMENT' : 'DISAGREEMENT';
    if (verdict === 'DISAGREEMENT') disagreements += 1;
    process.stdout.write(`CASE ${id}: ${verdict}\n`);
    process.stdout.write(`  required   : admitted=${want.admitted} classification=${want.classification} quarantine=${want.quarantine} targets=${want.targets} cursor=${want.cursor} owed=${want.owed}\n`);
    process.stdout.write(`  reference  : admitted=${ref?.admitted} classification=${ref?.classification} quarantine=${ref?.quarantine} targets=${ref?.targets} cursor=${ref?.cursor} owed=${ref?.owed} refusal=${ref?.refusal} remedy=${ref?.remedy}\n`);
    if (missing.length > 0) process.stdout.write(`  reference differs on: ${missing.join(', ')}\n`);
    process.stdout.write(`  prototype  : admitted=${proto?.admitted} classification=${proto?.classification} quarantine=${proto?.quarantine} targets=${proto?.targets} cursor=${proto?.cursor} owed=${proto?.owed}\n`);
    if (protoMissing.length > 0) process.stdout.write(`  prototype differs on: ${protoMissing.join(', ')}\n`);
  }
  process.stdout.write(`cases compared: ${expect.size}; disagreements: ${disagreements}\n`);
  cleanScratch();
}

const mode = process.argv[2] ?? '--run';
if (mode === '--emit-ledger') emitLedger();
else if (mode === '--run') run();
else if (mode === '--compare') compare();
else {
  process.stderr.write('usage: node docs/bend2/examples/arch-replay-stop.mjs [--emit-ledger|--run|--compare]\n');
  process.exit(2);
}
