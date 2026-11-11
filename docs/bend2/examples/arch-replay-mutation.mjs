// arch-replay-mutation.mjs — the reference half of the rejected-mutation corpus (issue #539,
// work-bend2-architecture, review track 1).
//
// Where the other corpora replay recorded rows, this one drives the implementation's admission verbs
// with requests it must refuse, and reports what a refusal leaves behind: the typed code, the ledger
// row count, the projection cursor and the rows a consumer is still owed. A refused mutation must
// write no row and must not disturb the history it was offered against.
//
//   node docs/bend2/examples/arch-replay-mutation.mjs --run       print the RESULT lines
//   node docs/bend2/examples/arch-replay-mutation.mjs --compare   run both halves live and compare them against expect
//
// Working state is written under the system temp directory and removed on exit. It imports impl/src
// read-only and writes nothing into it.

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CoordinationStore } from '../../../impl/src/coordination-store.mjs';
import { canonicalDigest } from '../../../impl/src/coordination-internals.mjs';
import { DEFAULT_RUN_LINEAGE_POLICY } from '../../../impl/src/run-lineage.mjs';

const HERE = dirname(new URL(import.meta.url).pathname);
const CASES = join(HERE, 'arch-replay-mutation.cases');
const EXPECT = join(HERE, 'arch-replay-mutation.expect');
const BEND = join(HERE, '../../../node_modules/.bend/bin/bend');
const PROTOTYPE_SOURCE = join(HERE, 'arch-replay-mutation.bend');

const REPO = 'repo-arch-replay-mutation';
const CLOCK_ISO = '2026-09-23T00:00:00.000Z';
const EXPIRED = '2026-09-22T00:00:00.000Z';
const LIVE = '2026-09-23T01:00:00.000Z';

const scratchRoots = [];
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-arch-mutation-${label}-`));
  scratchRoots.push(root);
  return root;
}
function cleanScratch() {
  for (const root of scratchRoots) rmSync(root, { recursive: true, force: true });
  scratchRoots.length = 0;
}

/** A store with one working parent task, which is what a lease request needs. */
function seededStore(root) {
  const store = new CoordinationStore(root, {
    repoId: REPO, clock: () => CLOCK_ISO, runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY,
  });
  store.createTask({
    id: 'task-mutation-parent',
    brief: { objective: 'Own the rejected-mutation corpus.', capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId: 'run-mutation-parent', taskType: 'general',
    reservedWorkerId: 'worker-mutation-parent', vendorRequested: 'mock', modelRequested: 'model-a',
    modelPolicy: null, effortRequested: 'low', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: 'task.created:task-mutation-parent' });
  const task = store.claimTask('task-mutation-parent', 'worker-mutation-parent', 1, {
    actor: 'orchestrator', key: 'task.claimed:task-mutation-parent',
  }, {
    harnessRequested: 'mock', harnessResolved: 'mock@fixture',
    modelRequested: 'model-a', modelResolved: 'model-a', modelObserved: 'model-a',
    effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
    routeKey: '["mock","fixture","model-a","low"]',
  }).task;
  const session = {
    principalId: 'principal-mutation',
    sessionId: 'session-mutation',
    authorityDigest: createHash('sha256').update('authenticated-session').digest('hex'),
    expiresAt: LIVE,
  };
  const base = { schemaVersion: 1, repoId: REPO, parentTask: { id: 'task-mutation-parent', version: task.version }, session };
  return { store, base, task };
}

function rowCount(root) {
  const text = readFileSync(join(root, 'events.jsonl'), 'utf8');
  return text.split('\n').filter(Boolean).length;
}

/** CASE|id|request|rowsBefore|readerCursor */
function readCases() {
  return readFileSync(CASES, 'utf8').split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('CASE|'))
    .map((line) => {
      const [, id, request, rowsBefore, readerCursor] = line.split('|');
      return { id, request, rowsBefore: Number(rowsBefore), readerCursor: Number(readerCursor) };
    });
}

/** The request one case offers, built from the base request the seeded store's parent task allows. */
function requestFor(caseRow, base) {
  if (caseRow.request === 'unknown_field') return { ...base, extraField: 'not part of the request' };
  if (caseRow.request === 'expired_session') return { ...base, session: { ...base.session, expiresAt: EXPIRED } };
  return base;
}

/** The key a lease admission carries: the derived operation identity, as its sibling admissions
 * derive theirs. Admission checks the payload before the key, so the two refused cases never reach
 * the key comparison; the valid case needs it exactly. */
function leaseKey(base, task) {
  const identity = {
    repoId: REPO,
    parentRunId: task.runId,
    parentTaskId: task.id,
    parentTaskVersion: task.version,
    workerId: task.assignee,
    principalId: base.session.principalId,
    sessionId: base.session.sessionId,
    sessionAuthorityDigest: base.session.authorityDigest,
  };
  return `run.orchestrator_lease:run-orchestrator-lease:${canonicalDigest(identity)}`;
}

/** Attempt one mutation against a freshly seeded store and report what it left behind. */
function attempt(caseRow) {
  const root = scratch(caseRow.id);
  const { store, base, task } = seededStore(root);
  const before = { rows: rowCount(root), cursor: store.snapshot().lastSeq };
  let admitted = false;
  let refusal = 'none';
  let message = null;
  try {
    store.issueRunOrchestratorLease(requestFor(caseRow, base), {
      actor: 'orchestrator',
      key: leaseKey(base, task),
    });
    admitted = true;
  } catch (error) {
    refusal = error?.code ?? error?.name ?? 'unknown';
    message = error?.message ?? null;
  }
  const after = { rows: rowCount(root), cursor: store.snapshot().lastSeq };
  return {
    admitted,
    refusal,
    cursor: after.cursor,
    owed: after.cursor - caseRow.readerCursor,
    rowsBefore: before.rows,
    rowsAfter: after.rows,
    rowsWritten: after.rows - before.rows,
    message,
  };
}

const resultLine = (id, r) => [
  'RESULT', id,
  `admitted=${r.admitted}`,
  `refusal=${r.refusal}`,
  `rows_written=${r.rowsWritten}`,
  `cursor=${r.cursor}`,
  `owed=${r.owed}`,
].join('|');

function referenceLines(verbose) {
  const lines = [];
  for (const caseRow of readCases()) {
    const outcome = attempt(caseRow);
    lines.push(resultLine(caseRow.id, outcome));
    if (verbose) process.stderr.write(`${caseRow.id}: ${JSON.stringify(outcome)}\n`);
  }
  return lines;
}

function run() {
  process.stdout.write(`${referenceLines(true).join('\n')}\n`);
  cleanScratch();
}

/** EXPECT|id|admitted|refusal_class|rows_written|cursor|owed */
function readExpect() {
  const out = new Map();
  for (const line of readFileSync(EXPECT, 'utf8').split('\n')) {
    if (!line.startsWith('EXPECT|')) continue;
    const [, id, admitted, refusalClass, rowsWritten, cursor, owed] = line.trim().split('|');
    out.set(id, { id, admitted, refusal_class: refusalClass, rows_written: rowsWritten, cursor, owed });
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
    const fields = ['admitted', 'rows_written', 'cursor', 'owed'];
    const refusalOf = (row) => String(row?.refusal_class ?? row?.refusal);
    const refDiffers = fields.filter((field) => String(ref?.[field]) !== String(want[field]));
    const protoDiffers = fields.filter((field) => String(proto?.[field]) !== String(want[field]));
    if (refusalOf(ref) !== String(want.refusal_class)) refDiffers.push('refusal_class');
    if (refusalOf(proto) !== String(want.refusal_class)) protoDiffers.push('refusal_class');
    const verdict = refDiffers.length === 0 && protoDiffers.length === 0 ? 'AGREEMENT' : 'DISAGREEMENT';
    if (verdict === 'DISAGREEMENT') disagreements += 1;
    process.stdout.write(`CASE ${id}: ${verdict}\n`);
    process.stdout.write(`  required   : admitted=${want.admitted} refusal_class=${want.refusal_class} rows_written=${want.rows_written} cursor=${want.cursor} owed=${want.owed}\n`);
    process.stdout.write(`  reference  : admitted=${ref?.admitted} refusal_class=${ref?.refusal} rows_written=${ref?.rows_written} cursor=${ref?.cursor} owed=${ref?.owed}\n`);
    if (refDiffers.length > 0) process.stdout.write(`  reference differs on: ${refDiffers.join(', ')}\n`);
    process.stdout.write(`  prototype  : admitted=${proto?.admitted} refusal_class=${proto?.refusal_class} rows_written=${proto?.rows_written} cursor=${proto?.cursor} owed=${proto?.owed}\n`);
    if (protoDiffers.length > 0) process.stdout.write(`  prototype differs on: ${protoDiffers.join(', ')}\n`);
  }
  process.stdout.write(`cases compared: ${expect.size}; disagreements: ${disagreements}\n`);
  cleanScratch();
}

const mode = process.argv[2] ?? '--run';
if (mode === '--run') await run();
else if (mode === '--compare') compare();
else {
  process.stderr.write('usage: node docs/bend2/examples/arch-replay-mutation.mjs [--run|--compare]\n');
  process.exit(2);
}
