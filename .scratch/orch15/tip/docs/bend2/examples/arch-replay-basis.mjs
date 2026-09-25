// arch-replay-basis.mjs — the reference half of the authorization-basis corpus (issue #539,
// work-bend2-architecture, review track 1: "run the same admission/fold/projection cases through
// both implementations").
//
// Where arch-replay-stop freezes one hand-written stop trace, this corpus freezes a trace the
// implementation itself produced: a parent task, its claim, and the run-orchestrator lease the
// deployment issued under its run-lineage policy. It then replays that trace under the basis that
// authorized it, under a changed basis, and under no basis at all, and it asks the diagnostic path
// (`coordinationReplayFailure`, the probe behind `baton doctor`) the same question.
//
//   node docs/bend2/examples/arch-replay-basis.mjs --emit-ledger   write the frozen trace
//   node docs/bend2/examples/arch-replay-basis.mjs --run           print the RESULT lines
//   node docs/bend2/examples/arch-replay-basis.mjs --compare       run both halves live and compare them against expect
//
// Working state is written under the system temp directory and removed on exit. It imports impl/src
// read-only and writes nothing into it.
import { CoordinationStore, coordinationReplayFailure } from '../../../impl/src/coordination-store.mjs';
import { canonicalDigest } from '../../../impl/src/coordination-internals.mjs';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { DEFAULT_RUN_LINEAGE_POLICY } from '../../../impl/src/run-lineage.mjs';

const HERE = dirname(new URL(import.meta.url).pathname);
const LEDGER = join(HERE, 'arch-replay-basis.ledger.jsonl');
const CASES = join(HERE, 'arch-replay-basis.cases');
const EXPECT = join(HERE, 'arch-replay-basis.expect');
const BEND = join(HERE, '../../../node_modules/.bend/bin/bend');
const PROTOTYPE_SOURCE = join(HERE, 'arch-replay-basis.bend');

const REPO = 'repo-arch-replay-basis';
const RUN_ID = 'run-arch-replay-basis-parent';
const TASK_ID = 'task-arch-replay-basis-parent';
const WORKER_ID = 'worker-arch-replay-basis-parent';
const CLOCK_ISO = '2026-09-23T00:00:00.000Z';
const LEASE_EXPIRES = '2026-09-23T01:00:00.000Z';

/** The changed basis the corpus replays against: one run-lineage field differs, so the policy digest
 * the recorded lease carries no longer matches the deployment's. */
const CHANGED_POLICY = Object.freeze({
  ...DEFAULT_RUN_LINEAGE_POLICY,
  maxChildrenPerRun: DEFAULT_RUN_LINEAGE_POLICY.maxChildrenPerRun + 1,
});

const scratchRoots = [];
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-arch-basis-${label}-`));
  scratchRoots.push(root);
  return root;
}
function cleanScratch() {
  for (const root of scratchRoots) rmSync(root, { recursive: true, force: true });
  scratchRoots.length = 0;
}

/** Build the trace by driving the implementation's own admission verbs. */
function buildTrace() {
  const root = scratch('emit');
  const store = new CoordinationStore(root, {
    repoId: REPO, clock: () => CLOCK_ISO, runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY,
  });
  store.createTask({
    id: TASK_ID,
    brief: { objective: 'Probe the authorization basis.', capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId: RUN_ID, taskType: 'general',
    reservedWorkerId: WORKER_ID, vendorRequested: 'mock', modelRequested: 'model-a',
    modelPolicy: null, effortRequested: 'low', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${TASK_ID}` });
  const task = store.claimTask(TASK_ID, WORKER_ID, 1, {
    actor: 'orchestrator', key: `task.claimed:${TASK_ID}`,
  }, {
    harnessRequested: 'mock', harnessResolved: 'mock@fixture',
    modelRequested: 'model-a', modelResolved: 'model-a', modelObserved: 'model-a',
    effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
    routeKey: '["mock","fixture","model-a","low"]',
  }).task;
  const session = {
    principalId: 'principal-arch-basis',
    sessionId: 'session-arch-basis',
    authorityDigest: createHash('sha256').update('authenticated-session').digest('hex'),
    expiresAt: LEASE_EXPIRES,
  };
  const leaseIdentity = {
    repoId: REPO, parentRunId: RUN_ID, parentTaskId: TASK_ID, parentTaskVersion: task.version,
    workerId: WORKER_ID, principalId: session.principalId, sessionId: session.sessionId,
    sessionAuthorityDigest: session.authorityDigest,
  };
  store.issueRunOrchestratorLease({
    schemaVersion: 1, repoId: REPO, parentTask: { id: TASK_ID, version: task.version }, session,
  }, { actor: 'orchestrator', key: `run.orchestrator_lease:run-orchestrator-lease:${canonicalDigest(leaseIdentity)}` });
  const bytes = readFileSync(join(root, 'events.jsonl'), 'utf8');
  cleanScratch();
  return bytes;
}

function emitLedger() {
  const bytes = buildTrace();
  writeFileSync(LEDGER, bytes);
  process.stdout.write(`arch-replay-basis.ledger.jsonl written: ${Buffer.byteLength(bytes)} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}\n`);
}

/** CASE|id|basis|rowIntegrity|rowSeq|readerCursor */
function readCases() {
  return readFileSync(CASES, 'utf8').split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('CASE|'))
    .map((line) => {
      const [, id, basis, integrity, rowSeq, readerCursor] = line.split('|');
      return { id, basis, integrity, rowSeq: Number(rowSeq), readerCursor: Number(readerCursor) };
    });
}

/** The frozen rows, with the trailing row replaced by a row the fold refuses when the case says so. */
function ledgerRows(caseRow) {
  const rows = readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  if (caseRow.integrity === 'invalid') {
    const last = rows[rows.length - 1];
    last.payload = { ...last.payload, unboundField: 'not part of the lease payload' };
  }
  return rows;
}

function policyFor(basis) {
  if (basis === 'same') return DEFAULT_RUN_LINEAGE_POLICY;
  if (basis === 'changed') return CHANGED_POLICY;
  return undefined;
}

/** Replay the trace under one basis and report the resident's verdict and the diagnostic path's. */
function replay(caseRow) {
  const rows = ledgerRows(caseRow);
  const root = scratch(caseRow.id);
  writeFileSync(join(root, 'events.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  const openOptions = { repoId: REPO, clock: () => CLOCK_ISO };
  const policy = policyFor(caseRow.basis);
  if (policy !== undefined) openOptions.runLineagePolicy = policy;
  const lastRowSeq = rows[rows.length - 1].seq;

  let admitted = true;
  let refusal = 'none';
  let cursor = rows.length;
  let thrownMessage = null;
  try {
    const store = new CoordinationStore(root, openOptions);
    cursor = store.snapshot().lastSeq;
  } catch (error) {
    admitted = false;
    refusal = error?.code ?? error?.name ?? 'unknown';
    thrownMessage = error?.message ?? null;
    cursor = lastRowSeq - 1;
  }

  // The diagnostic path: the probe behind `baton doctor` opens the ledger with no deployment basis.
  const probe = coordinationReplayFailure(root);
  const doctor = probe === null ? 'clean' : 'refused';
  const remedyNamesQuarantine = /quarantin/i.test(probe?.remedy ?? '');

  return {
    admitted,
    refusal,
    classification: admitted ? 'none' : 'replay_refused',
    quarantine: remedyNamesQuarantine,
    cursor,
    owed: cursor - caseRow.readerCursor,
    doctor,
    doctorCode: probe?.code ?? 'none',
    remedy: remedyNamesQuarantine ? 'quarantine' : 'none',
    thrownMessage,
    probeCode: probe?.code ?? null,
    probeSeq: probe?.seq ?? null,
  };
}

const resultLine = (id, r) => [
  'RESULT', id,
  `admitted=${r.admitted}`,
  `refusal=${r.refusal}`,
  `classification=${r.classification}`,
  `quarantine=${r.quarantine}`,
  `cursor=${r.cursor}`,
  `owed=${r.owed}`,
  `doctor=${r.doctor}`,
  `doctorCode=${r.doctorCode}`,
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

/** EXPECT|id|admitted|classification|quarantine|cursor|owed|doctor */
function readExpect() {
  const out = new Map();
  for (const line of readFileSync(EXPECT, 'utf8').split('\n')) {
    if (!line.startsWith('EXPECT|')) continue;
    const [, id, admitted, classification, quarantine, cursor, owed, doctor] = line.trim().split('|');
    out.set(id, { id, admitted, classification, quarantine, cursor, owed, doctor });
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

const REQUIRED = ['admitted', 'classification', 'quarantine', 'cursor', 'owed', 'doctor'];

function compare() {
  const expect = readExpect();
  const reference = parseResults(referenceLines(false).join('\n'));
  const prototype = bendResults();
  let disagreements = 0;
  for (const [id, want] of expect) {
    const ref = reference.get(id);
    const proto = prototype.get(id);
    const differs = (row) => REQUIRED.filter((field) => String(row?.[field]) !== String(want[field]));
    const refDiffers = differs(ref);
    const protoDiffers = differs(proto);
    const verdict = refDiffers.length === 0 && protoDiffers.length === 0 ? 'AGREEMENT' : 'DISAGREEMENT';
    if (verdict === 'DISAGREEMENT') disagreements += 1;
    process.stdout.write(`CASE ${id}: ${verdict}\n`);
    process.stdout.write(`  required   : admitted=${want.admitted} classification=${want.classification} quarantine=${want.quarantine} cursor=${want.cursor} owed=${want.owed} doctor=${want.doctor}\n`);
    process.stdout.write(`  reference  : admitted=${ref?.admitted} classification=${ref?.classification} quarantine=${ref?.quarantine} cursor=${ref?.cursor} owed=${ref?.owed} doctor=${ref?.doctor} refusal=${ref?.refusal}\n`);
    if (refDiffers.length > 0) process.stdout.write(`  reference differs on: ${refDiffers.join(', ')}\n`);
    process.stdout.write(`  prototype  : admitted=${proto?.admitted} classification=${proto?.classification} quarantine=${proto?.quarantine} cursor=${proto?.cursor} owed=${proto?.owed} doctor=${proto?.doctor}\n`);
    if (protoDiffers.length > 0) process.stdout.write(`  prototype differs on: ${protoDiffers.join(', ')}\n`);
  }
  process.stdout.write(`cases compared: ${expect.size}; disagreements: ${disagreements}\n`);
  cleanScratch();
}

const mode = process.argv[2] ?? '--run';
if (mode === '--emit-ledger') emitLedger();
else if (mode === '--run') run();
else if (mode === '--compare') compare();
else {
  process.stderr.write('usage: node docs/bend2/examples/arch-replay-basis.mjs [--emit-ledger|--run|--compare]\n');
  process.exit(2);
}
