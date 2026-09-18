// Issue #465 — the checkpoint's REMAINING second copies (#465 items 1, 2, 3 and the old-shape load).
//
// The clone's 288 671 406-byte checkpoint was 2.7× the 107 535 399-byte ledger it summarises, and
// the `_events` family (the parsed window) was only 180 159 961 B of it. The rest was the projection
// keeping a SECOND copy of text its own ledger row already holds. Measured on this file's fixture
// (one web command with a 200 KB answer body, one spill with a 50 KB body, one goal with a 40 KB
// objective, one plan with a 3 KB node objective, one task with a 4 KB brief):
//
//   family          @HEAD        after       what the projection kept
//   _webCommands    205 324 B      549 B     the response body (row 205 314 B -> 539 B)
//   _spills          51 548 B      384 B     the spilled bytes (row 51 466 B -> 302 B)
//   _goals           41 619 B      717 B     the objective (row 41 543 B -> 641 B)
//   _goalHeads       41 576 B      674 B     the head row, the same rendered row
//   _plans            4 280 B      789 B     the plan's nodes (row 4 204 B -> 713 B)
//   _planHeads        4 346 B      855 B     the head row, the same rendered row
//   _tasks            4 437 B      444 B     the task brief (row 4 423 B -> 430 B)
//   projection      622 288 B  317 961 B     of a 310 578-byte ledger
//
// The rule is the #464/#469 one, applied to the families the #465 breakdown measured: a row keeps
// its IDENTITY and OUTCOME and references the text by the ledger row that holds it. ONE reference
// grammar and one reader serve every family (`PROJECTION_REFERENCES` +
// `_projectionReferenceValue` in `impl/src/coordination-store.mjs`), and WHERE the pair is minted
// follows what the landed readers allow: a `_spills` row carries it from the FOLD, because every
// reader of a spill row is this store's own accessor (`materializeSpill`, the mint receipt) and
// composes the bytes back; the `_webCommands`, goal, plan and task rows carry it in the checkpoint
// BODY, because the two web-command accessors are bare delegates into the extracted internals port
// (their bijection pin counts them) and consumers outside this store read the goal/plan/task rows
// whole (`coordination-replay.mjs` `plan.nodes`, the application's goal/plan readers). The fold
// answers every existing read in both cases, so the two renderings cannot drift.
//
// Rows (red-first at HEAD on the three item rows, observed before the change):
//   a  a completed web command's row keeps the receipt's identity and outcome and references the
//      response body by the ledger row that holds it: a 200 KB answer adds 205 320 B to the family
//      at HEAD and 539 B after, the body reads back through the reference (the ONE reader) and the
//      ledger row still carries it whole — `webCommand`/`webCommandByScope`/the replay arm answer
//      exactly the receipt they always did;
//   b  the same for a spill: 51 466 B at HEAD, 302 B after, and `materializeSpill` answers the body
//      the referenced `spill.minted` row holds (the row's own `bytes` is that body's length);
//   c  a goal's/plan's/task's text appears ONCE on the ledger and the projection references it: the
//      goal objective's marker is carried by exactly one ledger row, no family of the checkpoint
//      body carries it, and `goalVersion`/`planVersion`/`task` still answer the whole row;
//   d  the parity rows (green at HEAD and after): a store served by the checkpoint and a store
//      served by the ledger alone answer the SAME rows (the #290 rule), and a checkpoint written by
//      the pre-change shape — every family carrying its text inline — still loads and answers every
//      read (the restore reads the parsed window and the idempotency index, never those families).
// Every row here is synchronous: there is no await to bound, and no clock or adapter is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialize } from 'node:v8';
import { createHash } from 'node:crypto';

import { CoordinationStore } from '../src/index.mjs';

const CHECKPOINT = 'projection.checkpoint';
const REPO_ID = 'repo-issue465-second-copies';
const ACTOR = 'test:issue465-second-copies';
const WEB_BODY_BYTES = 200 * 1024;
const SPILL_BODY_BYTES = 50 * 1024;
const GOAL_MARKER = 'issue465s-goal-objective-marker';
const NODE_MARKER = 'issue465s-plan-node-marker';
const GOAL_OBJECTIVE = `${GOAL_MARKER} ${'g'.repeat(40 * 1024)}`;

// The goal/plan policy the task lane needs; its own limits are the fixture's, not the deployment's.
const policy = Object.freeze({
  schemaVersion: 1, repoId: REPO_ID, mandatory: true, approvalTtlMs: 60 * 60 * 1_000,
  riskClasses: ['low', 'medium', 'high'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 64 * 1024, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 256 * 1024, maxPlanBytes: 512 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});
const storeOptions = () => ({ goalPlanPolicy: policy, checkpointInterval: 100_000 });
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const auth = (principalId, key) => ({
  actor: `direct:${principalId}`, principalId, repoId: REPO_ID, runId: null, key,
  sessionDigest: sha256(`session:${principalId}`),
});

function directoryFor(t, label) {
  const directory = mkdtempSync(join(tmpdir(), `baton-issue465s-${label}-`));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function storeFor(t, label) {
  return new CoordinationStore(directoryFor(t, label), storeOptions());
}
/** The checkpoint BODY this build writes — the object the cost gate serializes and measures. */
const body = (store) => store._projectionCheckpointPayload({ durable: true });
const familyBytes = (store, family) => serialize(body(store)[family]).byteLength;
const rowBytes = (store, family, key) => serialize(body(store)[family].get(key)).byteLength;
const ledgerRow = (store, seq) => store.eventsView()[seq - 1];
/** How many ledger rows carry this text at all — the second copy is measured, never assumed. */
const ledgerCarriers = (store, marker) => store
  .eventsView().filter((event) => JSON.stringify(event).includes(marker)).length;

const ref = (kind, value) => ({
  [`${kind}Id`]: value[`${kind}Id`], version: value.version, digest: value.digest,
});

/** The web command lane's own admission shape (web-northbound's fields, minus the transport): the
 * request content is never on the row — only its digest and the per-axis digest map. */
const webCommandFields = (bodyBytes) => ({
  commandId: 'cmd-465s', scopeKey: 'scope-465s', requestDigest: sha256('cmd-465s'),
  command: 'swarm_view', repoId: REPO_ID, runId: null, userId: 'user-1', sessionId: 'session-1',
  credentialId: 'cred-1', origin: 'cli', expectedFence: null, requestAxes: { request: 'digest' },
  ...(bodyBytes === undefined ? {} : { bodyBytes }),
});

/** ONE goal -> plan -> approval -> gate -> task, with the fixture's own text markers. */
function goalPlanFixture(store) {
  const goal = store.defineGoal({
    objective: GOAL_OBJECTIVE,
    definitionOfDone: ['node --test passes'],
    constraints: ['No network access'],
    risk: 'high',
    budget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
    predecessor: null,
  }, auth('goal-owner', 'goal:465s')).goal;
  const nodes = [{
    key: 'implement',
    objective: `${NODE_MARKER} ${'n'.repeat(3_000)}`,
    definitionOfDone: ['node --test passes'],
    deps: [], pathScope: ['impl/**'], risk: 'high',
    budget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
    verification: {
      command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'],
      expectExit: 0, expectResult: 'exit_code', timeoutMs: 60_000, maxOutputBytes: 1_000_000,
      requiredPredecessorEvidence: [],
    },
    routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] },
    capabilities: ['code'], effects: ['repository_edit'],
  }];
  const plan = store.proposePlan({ goal: ref('goal', goal), predecessor: null, nodes },
    auth('planner', 'plan:465s')).plan;
  store.approvePlan({
    goal: ref('goal', goal), plan: ref('plan', plan),
    expectedDisposition: null, disposition: 'approved',
  }, auth('approver', 'approval:465s'));
  const gate = {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey: 'implement', expectedDispatchVersion: 0,
    capabilities: ['code'], effects: ['repository_edit'],
  };
  const route = { vendor: 'mock', model: 'model-a', effort: 'low' };
  const preview = store.previewPlanDispatch(gate, route);
  const task = store.createPlanGatedTask({
    id: 'task-465s', brief: preview.brief, deps: preview.resolvedDeps, refines: null, runId: null,
    taskType: 'general', reservedWorkerId: 'worker:task-465s', vendorRequested: 'mock',
    modelRequested: 'model-a', modelPolicy: null, effortRequested: 'low', effortResolved: null,
    effortObserved: null, routeKey: null, sessionRequest: { mode: 'new' },
  }, gate, route, auth('dispatcher', 'dispatch:465s')).task;
  return { goal, plan, nodes, task };
}

// ── 465s-a: a completed web command references its answer body ───────────────────────────────────

test('465s-a: a 200 KB web command answer adds under 1 KB to the projection and reads back through its reference', (t) => {
  const store = storeFor(t, 'web');
  store.admitWebCommand(webCommandFields(), { actor: 'web:user-1', key: 'web:admit' });
  const admitted = familyBytes(store, '_webCommands');
  const answer = { ok: true, projection: 'full', payload: 'w'.repeat(WEB_BODY_BYTES) };
  const completed = store.completeWebCommand('cmd-465s', { httpStatus: 200, body: answer },
    { actor: 'web:user-1', key: 'web:complete' });

  const projected = body(store);
  const added = familyBytes(store, '_webCommands') - admitted;
  assert.ok(added < 1_024,
    `a completed web command adds under 1 KB to the projection (#465 item 1): measured ${added} B — at HEAD the 200 KB `
    + `answer body rode the row (${rowBytes(store, '_webCommands', 'cmd-465s')} B)`);

  const row = projected._webCommands.get('cmd-465s');
  assert.equal(row.commandId, 'cmd-465s', 'the row keeps the receipt identity');
  assert.equal(row.status, 'completed');
  assert.equal(row.outcome.httpStatus, 200, 'the row keeps the OUTCOME — the status a reader decides on');
  assert.equal(row.outcome.body, null, 'the answer body is not a second copy on the row');
  assert.equal(row.outcome.bodyBytes, Buffer.byteLength(JSON.stringify(answer), 'utf8'),
    'the reference reports the bytes the projection did not carry');
  assert.deepEqual(row.outcome.bodyRef, { kind: 'web.command_completed', seq: completed.event.seq },
    'the pair names the ledger row that holds the body');

  const ledger = ledgerRow(store, completed.event.seq);
  assert.equal(ledger.kind, 'web.command_completed');
  assert.deepEqual(ledger.payload.outcome.body, answer, 'the ledger row still carries the whole body');
  assert.equal(JSON.stringify(ledger.payload).includes('requestDigest'), false,
    'and the request content was never on the row to reference (only the digest map is)');

  assert.deepEqual(store._projectionReferenceValue(row.outcome.bodyRef), answer,
    'the ONE reader answers the body the pair names');
  assert.deepEqual(store.webCommand('cmd-465s').outcome.body, answer,
    'the store\'s own reader answers the row it always did');
  assert.deepEqual(store.webCommandByScope('scope-465s').outcome.body, answer);
  assert.deepEqual(store.webCommand('cmd-465s').outcome, { httpStatus: 200, body: answer },
    'and the outcome the reader composes is exactly the recorded outcome');
  assert.deepEqual(store.completeWebCommand('cmd-465s', { httpStatus: 200, body: answer },
    { actor: 'web:user-1', key: 'web:complete' }).command.outcome.body, answer,
  'the replay arm a retry crosses answers the recorded body too');
  assert.equal(store.webCommand('cmd-465s-never-admitted'), null);

  // A failed command references its body the same way: one rule for both terminal kinds.
  store.admitWebCommand({ ...webCommandFields(), commandId: 'cmd-465s-failed', scopeKey: 'scope-465s-failed' },
    { actor: 'web:user-1', key: 'web:admit:failed' });
  const failure = store.failWebCommand('cmd-465s-failed', { httpStatus: 409, body: { ok: false, error: { code: 'idempotency_conflict' } } },
    { actor: 'web:user-1', key: 'web:fail:failed' });
  const failedRow = body(store)._webCommands.get('cmd-465s-failed');
  assert.equal(failedRow.outcome.httpStatus, 409);
  assert.deepEqual(failedRow.outcome.bodyRef, { kind: 'web.command_failed', seq: failure.event.seq });
  assert.deepEqual(store.webCommand('cmd-465s-failed').outcome.body, { ok: false, error: { code: 'idempotency_conflict' } });
});

// ── 465s-b: a spill references its bytes ─────────────────────────────────────────────────────────

test('465s-b: a spill adds under 1 KB to the projection and reads back through its reference', (t) => {
  const store = storeFor(t, 'spill');
  const before = familyBytes(store, '_spills');
  const spilled = 's'.repeat(SPILL_BODY_BYTES);
  const minted = store.mintSpill({ body: spilled, lane: 'message.send.body' },
    { actor: 'orchestrator', key: 'spill:465s' });

  const projected = body(store);
  const added = familyBytes(store, '_spills') - before;
  assert.ok(added < 1_024,
    `a spill adds under 1 KB to the projection (#465 item 2): measured ${added} B — at HEAD the body rode the row `
    + `(${rowBytes(store, '_spills', minted.spill.spillId)} B)`);

  const row = projected._spills.get(minted.spill.spillId);
  assert.equal(row.spillId, minted.spill.spillId, 'the row keeps its digest-addressed identity');
  assert.equal(row.digest, minted.spill.digest);
  assert.equal(row.bytes, SPILL_BODY_BYTES, 'the row already names the body\'s exact length');
  assert.equal(row.body, null, 'the spilled bytes are not a second copy on the row');
  assert.deepEqual(row.bodyRef, { kind: 'spill.minted', seq: minted.spill.observedSeq },
    'the pair names the ledger row that holds the bytes');

  const ledger = ledgerRow(store, minted.spill.observedSeq);
  assert.equal(ledger.kind, 'spill.minted');
  assert.equal(ledger.payload.body, spilled, 'the ledger row still carries the whole body');
  assert.equal(store._projectionReferenceValue(row.bodyRef), spilled, 'the ONE reader answers the bytes');
  assert.equal(store.materializeSpill(minted.spill.spillId).body, spilled,
    'the reader every spilled objective resolves through is unchanged');
  assert.equal(minted.spill.body, spilled, 'and the mint receipt still names the body it minted');
  assert.equal(store.mintSpill({ body: spilled, lane: 'message.send.body' },
    { actor: 'orchestrator', key: 'spill:465s' }).spill.body, spilled, 'the idempotent replay is unchanged');
  assert.equal(store.materializeSpill(`spill:sha256:${'0'.repeat(64)}`), null, 'an unknown spill is still null');

  // A reference that cannot be read is absence, never a guessed value.
  const orphan = { ...row.bodyRef, seq: store.eventsView().length + 1 };
  assert.equal(store._projectionReferenceValue(orphan), null);
  assert.equal(store._projectionReferenceValue({ kind: 'task.created', seq: row.bodyRef.seq }), null,
    'a pair naming a row of another kind resolves to nothing');
});

// ── 465s-c: the goal/plan/task second copies are references ──────────────────────────────────────

test('465s-c: a goal/plan/task row\'s text appears on one ledger row and the projection references it', (t) => {
  const store = storeFor(t, 'goal-plan');
  const { goal, plan, nodes, task } = goalPlanFixture(store);
  const projected = body(store);

  const goalRow = projected._goals.get(store._goalVersionKey(goal.goalId, goal.version));
  assert.equal(goalRow.objective, null, 'no goal objective rides the projection');
  assert.equal(goalRow.objectiveBytes, Buffer.byteLength(GOAL_OBJECTIVE, 'utf8'),
    'the reference reports the length the projection did not carry');
  assert.deepEqual(goalRow.objectiveRef, { kind: 'goal.version_defined', seq: goal.definedEvent },
    'the pair names the goal row that holds the objective');
  assert.equal(goalRow.goalId, goal.goalId, 'the row keeps its identity');
  assert.equal(goalRow.version, goal.version);
  assert.equal(goalRow.digest, goal.digest);
  assert.equal(goalRow.definedEvent, goal.definedEvent);
  assert.equal(goalRow.risk, 'high', 'and every fact the row is read for stays on it');

  const planRow = projected._plans.get(store._planVersionKey(plan.planId, plan.version));
  assert.equal(planRow.nodes, null, 'no plan nodes ride the projection');
  assert.deepEqual(planRow.nodesRef, { kind: 'plan.version_proposed', seq: plan.proposedEvent });
  const ledgerNodes = ledgerRow(store, plan.proposedEvent).payload.plan.nodes;
  assert.equal(planRow.nodesBytes, Buffer.byteLength(JSON.stringify(ledgerNodes), 'utf8'));
  assert.equal(planRow.planId, plan.planId);
  assert.equal(planRow.digest, plan.digest);

  const taskRow = projected._tasks.get(task.id);
  assert.equal(taskRow.brief, null, 'no task brief rides the projection');
  assert.deepEqual(taskRow.briefRef, { kind: 'task.created', seq: taskRow.createdEvent });
  assert.equal(taskRow.briefBytes, Buffer.byteLength(JSON.stringify(ledgerRow(store, taskRow.createdEvent).payload.brief), 'utf8'));
  assert.equal(taskRow.status, 'pending', 'the derived state the fold adds stays on the row');

  // ONE rendering per row: a family and its head map are set from the SAME frozen row, so the body
  // pays once and the alias survives.
  assert.equal(projected._goalHeads.get(store._goalScopeKey(REPO_ID, goal.runId)), goalRow,
    'the goal head IS the rendered row, not a second rendering');
  assert.equal(projected._planHeads.get(store._planHeadKey(goal)), planRow,
    'the plan head IS the rendered row, not a second rendering');

  // The text lives on exactly one ledger row, and the projection carries none of it.
  assert.equal(ledgerCarriers(store, GOAL_MARKER), 1,
    'the goal objective is carried by one ledger row (the one the reference names)');
  const families = serialize([projected._goals, projected._goalHeads, projected._plans,
    projected._planHeads, projected._tasks]).toString('utf8');
  assert.equal(families.includes(GOAL_MARKER), false, 'no second copy of the objective in the body');
  assert.equal(families.includes(NODE_MARKER), false, 'no second copy of the plan\'s nodes in the body');

  // And the fold still answers every existing read, whole.
  assert.equal(store.goalVersion(goal.goalId, goal.version).objective, GOAL_OBJECTIVE);
  assert.deepEqual(store.planVersion(plan.planId, plan.version).nodes, plan.nodes);
  assert.deepEqual(store.task(task.id).brief, ledgerRow(store, taskRow.createdEvent).payload.brief);
  assert.deepEqual(store._projectionReferenceValue(goalRow.objectiveRef), GOAL_OBJECTIVE);
  assert.deepEqual(store._projectionReferenceValue(planRow.nodesRef), plan.nodes);
  assert.deepEqual(store._projectionReferenceValue(taskRow.briefRef), ledgerRow(store, taskRow.createdEvent).payload.brief);
});

// ── 465s-d: the parity rows — a cache-served store and a ledger-served store answer the same rows ─

test('465s-d: the checkpoint-served store and the ledger-served store answer the same rows', (t) => {
  const directory = directoryFor(t, 'parity');
  const store = new CoordinationStore(directory, storeOptions());
  const web = webCommandFields();
  store.admitWebCommand(web, { actor: 'web:user-1', key: 'web:admit' });
  const answer = { ok: true, projection: 'full', payload: 'w'.repeat(16 * 1024) };
  store.completeWebCommand('cmd-465s', { httpStatus: 200, body: answer }, { actor: 'web:user-1', key: 'web:complete' });
  const spilled = 's'.repeat(8 * 1024);
  const minted = store.mintSpill({ body: spilled, lane: 'message.send.body' },
    { actor: 'orchestrator', key: 'spill:465s' });
  const { goal, plan, task } = goalPlanFixture(store);
  store.releaseWriterLease({ requireOwned: true });
  assert.equal(store.checkpointReleaseState()?.state, 'written',
    'the release writes the checkpoint this fixture fits under its cost bound');

  const replayDirectory = `${directory}-replay`;
  t.after(() => rmSync(replayDirectory, { recursive: true, force: true }));
  cpSync(directory, replayDirectory, { recursive: true });
  unlinkSync(join(replayDirectory, CHECKPOINT));
  const served = new CoordinationStore(directory, storeOptions());
  const replayed = new CoordinationStore(replayDirectory, storeOptions());
  assert.equal(served.startupStatus().checkpoint, 'valid', 'the first open is served by the cache it found');
  assert.equal(replayed.startupStatus().checkpoint, 'absent', 'the second has no cache: it replays the ledger');

  for (const [label, opened] of [['served', served], ['replayed', replayed]]) {
    assert.deepEqual(opened.webCommand('cmd-465s').outcome, { httpStatus: 200, body: answer },
      `${label}: a completed web command answers its recorded outcome`);
    assert.equal(opened.materializeSpill(minted.spill.spillId).body, spilled, `${label}: a spill answers its bytes`);
    assert.equal(opened.goalVersion(goal.goalId, goal.version).objective, GOAL_OBJECTIVE, `${label}: the goal answers its objective`);
    assert.deepEqual(opened.planVersion(plan.planId, plan.version).nodes,
      ledgerRow(opened, plan.proposedEvent).payload.plan.nodes, `${label}: the plan answers its nodes`);
    assert.deepEqual(opened.task(task.id).brief, store.task(task.id).brief, `${label}: the task answers its brief`);
    assert.deepEqual(opened.admitWebCommand(web, { actor: 'web:user-1', key: 'web:admit' }).command.outcome,
      { httpStatus: 200, body: answer }, `${label}: and a retried command replays its recorded answer`);
  }
});

// ── 465s-e: a checkpoint whose families still carry the text (the shape every resident has on disk) ─

test('465s-e: a checkpoint written by the pre-change shape still loads and answers every read', (t) => {
  const directory = directoryFor(t, 'legacy-shape');
  const store = new CoordinationStore(directory, storeOptions());
  const web = webCommandFields();
  store.admitWebCommand(web, { actor: 'web:user-1', key: 'web:admit' });
  const answer = { ok: true, projection: 'full', payload: 'w'.repeat(4 * 1024) };
  store.completeWebCommand('cmd-465s', { httpStatus: 200, body: answer }, { actor: 'web:user-1', key: 'web:complete' });
  const spilled = 's'.repeat(4 * 1024);
  const minted = store.mintSpill({ body: spilled, lane: 'message.send.body' },
    { actor: 'orchestrator', key: 'spill:465s' });
  const { goal, plan, task } = goalPlanFixture(store);

  // The projection as the PREVIOUS build wrote it: every family carries the text inline, with no
  // reference pair on the row. The text is read from the ledger row a pair names — the shape's own
  // inverse, derived here so the file is a real pre-change checkpoint and not an approximation —
  // and a family whose rows carry no pair is passed through exactly as this build wrote it (which
  // IS the pre-change shape on a build before this lane).
  const current = body(store);
  const at = (seq) => store.eventsView()[seq - 1];
  const inline = (row, field, read) => {
    const reference = row?.[`${field}Ref`];
    if (reference === undefined) return row;
    const { [`${field}Ref`]: _reference, [`${field}Bytes`]: _bytes, ...rest } = row;
    return { ...rest, [field]: read(at(reference.seq).payload) };
  };
  const legacy = {
    ...current,
    _webCommands: new Map([...current._webCommands].map(([key, row]) => {
      const reference = row.outcome?.bodyRef;
      if (reference === undefined) return [key, row];
      const { bodyRef: _reference, bodyBytes: _bytes, ...outcome } = row.outcome;
      return [key, { ...row, outcome: { ...outcome, body: at(reference.seq).payload.outcome?.body ?? null } }];
    })),
    _spills: new Map([...current._spills].map(([key, row]) => [key, inline(row, 'body', (payload) => payload.body ?? null)])),
    _goals: new Map([...current._goals].map(([key, row]) => [key, inline(row, 'objective', (payload) => payload.goal?.objective ?? null)])),
    _goalHeads: new Map([...current._goalHeads].map(([key, row]) => [key, inline(row, 'objective', (payload) => payload.goal?.objective ?? null)])),
    _plans: new Map([...current._plans].map(([key, row]) => [key, inline(row, 'nodes', (payload) => payload.plan?.nodes ?? null)])),
    _planHeads: new Map([...current._planHeads].map(([key, row]) => [key, inline(row, 'nodes', (payload) => payload.plan?.nodes ?? null)])),
    _tasks: new Map([...current._tasks].map(([key, row]) => [key, inline(row, 'brief', (payload) => payload.brief ?? null)])),
  };
  const ledgerBytes = readFileSync(join(directory, 'events.jsonl'));
  const projectionBytes = serialize(legacy);
  writeFileSync(join(directory, CHECKPOINT), serialize({
    schemaVersion: 1,
    authorityDigest: store._checkpointAuthorityDigest,
    projectionShapeDigest: store._projectionShapeDigest,
    servedCommit: null,
    throughSeq: legacy._events.length,
    prefixBytes: ledgerBytes.byteLength,
    prefixDigest: sha256(ledgerBytes),
    projectionDigest: sha256(projectionBytes),
    projectionBytes,
  }), { mode: 0o600 });

  const reopened = new CoordinationStore(directory, storeOptions());
  assert.equal(reopened.startupStatus().checkpoint, 'valid',
    'a checkpoint whose families carry the text inline is still THIS build\'s shape — the field set is what the digest covers');
  assert.equal(reopened.startupStatus().source, 'checkpoint');
  assert.deepEqual(reopened.webCommand('cmd-465s').outcome, { httpStatus: 200, body: answer },
    'the fold mints the reference over the replayed rows whatever shape the cache carried');
  assert.equal(reopened.materializeSpill(minted.spill.spillId).body, spilled);
  assert.equal(reopened.goalVersion(goal.goalId, goal.version).objective, GOAL_OBJECTIVE);
  assert.deepEqual(reopened.planVersion(plan.planId, plan.version).nodes,
    ledgerRow(reopened, plan.proposedEvent).payload.plan.nodes);
  assert.deepEqual(reopened.task(task.id).brief, store.task(task.id).brief);
});
