// Issue #465 (the remaining item) — the release checkpoint carries the PROJECTIONS and the seq they
// cover, never the event log, and the successor rebuilds the two ledger families from the ledger.
//
// OBSERVED (the clone, 2026-09-18 17:30Z; 119 MB ledger): every stop skipped the release write as
// `release_checkpoint_unbounded` against the declared cost ceiling (16 777 216 bytes), because the
// body carried `_events` (193 MB) and `_byKey` (195 MB) — the SAME row objects counted twice — on a
// 207 MB projection whose every other family was under 9 MB. The two dominant families are not the
// projection's to carry: the ledger file IS their durable copy, and a replay reads it anyway.
//
// What this file pins, on real CoordinationStore bytes:
//   a  an event-dominated ledger (200 rows × 100 KB: `_events` is the whole payload) writes a
//      bounded release checkpoint — `state: written`, the measured bytes kilobytes rather than
//      megabytes, `coversSeq` on the outcome row and on the envelope — and neither `_events` nor
//      `_byKey` is a key of the body the write persisted (a `bytesByFamily` entry for either is the
//      double count the breakdown exists to expose);
//   b  the successor opened from that checkpoint plus a ledger tail reads every row back from the
//      ledger — `_events` is the ledger's rows and `_byKey` resolves a TAIL row — rebuilds the same
//      index a cold replay builds, and projects the same state: every family the checkpoint carries
//      deep-equals the cold replay's, the served view's digest is the same, and a referenced text
//      (a web command's answer body, a task's brief) resolves through the rebuilt rows;
//   c  the byte breakdown counts each object ONCE: `bytesByFamily` carries the body's own families
//      and closes exactly on the measured bytes, while the two families the body does not carry are
//      reported as what the successor rebuilds them from — the rows' own bytes on the ledger
//      (attributed to `_events` alone) and `_byKey`'s key count with 0 bytes of its own;
//   d  a checkpoint that claims more rows than the ledger holds (`coversSeq` past its last row), or
//      whose authority digest is another build's, is refused as its own state, FALLS BACK to
//      replaying the ledger with the reason on the row, and the open writes the cache the next open
//      needs — a cache is never authoritative over the ledger.
// Every row here is synchronous: the store's open and release are plain calls, so there is no await
// to bound (docs/42 §8) and no clock is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';

import { PROJECTION_CHECKPOINT_FIELDS } from '../src/coordination-internals.mjs';
import { CoordinationStore } from '../src/index.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

const CHECKPOINT = 'projection.checkpoint';
const REPO_ID = 'repo-issue465c';
const ACTOR = 'test:issue465c';
// The event families the fixture makes dominant: 200 rows of a 100 KB `mcp.audit` body serialize to
// ~20 MB of `_events`, past the declared cost ceiling; the fold keeps none of that text in any other
// family (an `_mcpCalls` row is a few bytes), so the body's cost IS the event log at HEAD.
const EVENT_ROWS = 200;
const EVENT_BODY_BYTES = 100 * 1024;
const WEB_BODY_BYTES = 200 * 1024;
const SPILL_BODY_BYTES = 50 * 1024;
const GOAL_MARKER = 'issue465c-goal-objective-marker';
const GOAL_OBJECTIVE = `${GOAL_MARKER} ${'g'.repeat(40 * 1024)}`;
const COST = FRAME_LIMITS['checkpoint.projection_bytes'];

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
const digest = (value) => sha256(JSON.stringify(value));
const auth = (principalId, key) => ({
  actor: `direct:${principalId}`, principalId, repoId: REPO_ID, runId: null, key,
  sessionDigest: sha256(`session:${principalId}`),
});

function directoryFor(t, label) {
  const directory = mkdtempSync(join(tmpdir(), `baton-issue465c-${label}-`));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** Read the checkpoint envelope. v8's deserialize loses Buffer-ness, so the body bytes are
 * re-copied into a Buffer the way the writer stored them. */
function envelopeOf(directory) {
  const envelope = deserialize(readFileSync(join(directory, CHECKPOINT)));
  envelope.projectionBytes = Buffer.from(envelope.projectionBytes);
  return envelope;
}
function writeEnvelope(directory, envelope) {
  writeFileSync(join(directory, CHECKPOINT), serialize(envelope), { mode: 0o600 });
}
/** Write the body the envelope carries back onto disk, re-deriving the digest the reader checks. */
function writeBody(directory, envelope, body) {
  envelope.projectionBytes = serialize(body);
  envelope.projectionDigest = sha256(envelope.projectionBytes);
  writeEnvelope(directory, envelope);
}

/** The dominant family's rows: `recordMcpAudit` is a store verb, so the fixture is a real ledger.
 * Every body is DISTINCT (`entry` is written into its own body), because the serializer counts one
 * repeated text once and this fixture's point is a body that is one event log. */
function seedEventRows(store) {
  for (let index = 1; index <= EVENT_ROWS; index += 1) {
    store.recordMcpAudit({ entry: index, blob: `${'x'.repeat(EVENT_BODY_BYTES)}#${index}` },
      { actor: ACTOR, key: `issue465c:row:${index}` });
  }
}

/** Append rows directly to the ledger beyond a checkpoint's coverage — the tail a used checkpoint
 * must still fold (a fallback folds these too, so the startup counters tell the two apart). Rows
 * mirror the issue397/issue449 fixture template. */
function appendTailRows(directory, fromSeq, count) {
  const rows = [];
  for (let offset = 0; offset < count; offset += 1) {
    const seq = fromSeq + offset;
    rows.push(JSON.stringify({
      schemaVersion: 1, seq, ts: '2026-09-18T12:00:00.000Z', kind: 'driver.recorded',
      actor: ACTOR, idempotencyKey: `issue465c:tail:${seq}`,
      payload: { kind: 'issue465c.tail', index: seq },
    }));
  }
  appendFileSync(join(directory, 'events.jsonl'), `${rows.join('\n')}\n`);
}

/** The web command lane's own admission shape (web-northbound's fields, minus the transport): the
 * request content is never on the row — only its digest and the per-axis digest map. */
const webCommandFields = () => ({
  commandId: 'cmd-465c', scopeKey: 'scope-465c', requestDigest: sha256('cmd-465c'),
  command: 'swarm_view', repoId: REPO_ID, runId: null, userId: 'user-1', sessionId: 'session-1',
  credentialId: 'cred-1', origin: 'cli', expectedFence: null, requestAxes: { request: 'digest' },
});
const ref = (kind, value) => ({
  [`${kind}Id`]: value[`${kind}Id`], version: value.version, digest: value.digest,
});

/** ONE goal -> plan -> approval -> gate -> task, plus a completed web command and a spill: the
 * families whose text the checkpoint carries as a REFERENCE, so the successor must resolve them. */
function richFixture(store) {
  store.admitWebCommand(webCommandFields(), { actor: 'web:user-1', key: 'web:admit' });
  const answer = { ok: true, projection: 'full', payload: 'w'.repeat(WEB_BODY_BYTES) };
  store.completeWebCommand('cmd-465c', { httpStatus: 200, body: answer },
    { actor: 'web:user-1', key: 'web:complete' });
  const spilled = 's'.repeat(SPILL_BODY_BYTES);
  const spill = store.mintSpill({ body: spilled, lane: 'message.send.body' },
    { actor: 'orchestrator', key: 'spill:465c' }).spill;

  const goal = store.defineGoal({
    objective: GOAL_OBJECTIVE,
    definitionOfDone: ['node --test passes'],
    constraints: ['No network access'],
    risk: 'high',
    budget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
    predecessor: null,
  }, auth('goal-owner', 'goal:465c')).goal;
  const plan = store.proposePlan({
    goal: ref('goal', goal),
    predecessor: null,
    nodes: [{
      key: 'implement',
      objective: 'issue465c-plan-node-marker',
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
    }],
  }, auth('planner', 'plan:465c')).plan;
  store.approvePlan({
    goal: ref('goal', goal), plan: ref('plan', plan),
    expectedDisposition: null, disposition: 'approved',
  }, auth('approver', 'approval:465c'));
  const gate = {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey: 'implement', expectedDispatchVersion: 0,
    capabilities: ['code'], effects: ['repository_edit'],
  };
  const route = { vendor: 'mock', model: 'model-a', effort: 'low' };
  const preview = store.previewPlanDispatch(gate, route);
  const task = store.createPlanGatedTask({
    id: 'task-465c', brief: preview.brief, deps: preview.resolvedDeps, refines: null, runId: null,
    taskType: 'general', reservedWorkerId: 'worker:task-465c', vendorRequested: 'mock',
    modelRequested: 'model-a', modelPolicy: null, effortRequested: 'low', effortResolved: null,
    effortObserved: null, routeKey: null, sessionRequest: { mode: 'new' },
  }, gate, route, auth('dispatcher', 'dispatch:465c')).task;
  return { goal, plan, task, answer, spilled, spill };
}

/** The fixture every row below is built on: the dominant event rows, the reference-carrying
 * families, and the release that writes the checkpoint under the declared cost ceiling. */
function releasedFixture(t, label) {
  const directory = directoryFor(t, label);
  const store = new CoordinationStore(directory, storeOptions());
  seedEventRows(store);
  const fixture = richFixture(store);
  // The store's own row count: the dominant event rows plus the reference-carrying fixture's.
  const rows = store._events.length;
  store.releaseWriterLease({ requireOwned: true });
  return { directory, store, rows, ...fixture };
}

// ── 465c-a: the bounded body — the projections and coversSeq, never the event log ─────────────────

test('465c-a: an event-dominated ledger writes a bounded checkpoint that carries no event log', (t) => {
  const { directory, store, rows } = releasedFixture(t, 'bounded');
  const release = store.checkpointReleaseState();
  assert.equal(release?.state, 'written',
    `the release writes a bounded body whatever the ledger holds (skipped at HEAD as ${release?.reason},`
    + ` measuring ${release?.bytes} bytes against the cost bound ${release?.costBound})`);
  assert.equal(release.rows, rows);
  assert.equal(release.coversSeq, rows,
    'the outcome row names the seq the carried projections cover (the ledger rows the open must not re-fold)');
  assert.ok(Number.isSafeInteger(release.bytes) && release.bytes <= COST.value,
    `the measured body (${release.bytes} B) is inside the declared cost ceiling (${COST.value} B)`);
  assert.ok(release.bytes < 1_048_576,
    `a body that no longer carries the event log is kilobytes, not the ${rows} rows it summarises`
    + ` (measured ${release.bytes} B)`);
  assert.ok(release.ledgerBytes > COST.value,
    `the ledger itself is past the cost ceiling (${release.ledgerBytes} B) — evidence on the row, never the gate`);

  const payload = store._projectionCheckpointPayload();
  assert.equal('_events' in payload, false, '`_events` is not a key of the body the write persists');
  assert.equal('_byKey' in payload, false, '`_byKey` is not a key of the body the write persists');
  assert.deepEqual(Object.keys(payload).sort(), [...PROJECTION_CHECKPOINT_FIELDS].sort(),
    'the body is the projection field list the shape digest is derived from — the two ledger families are not in it');

  // The bytes on disk are the same body: the envelope records coversSeq and the ledger prefix it
  // was written against, so the claim the successor reads is the writer's own.
  const envelope = envelopeOf(directory);
  assert.equal(envelope.coversSeq, rows, 'the envelope records the seq its projections cover');
  const persisted = deserialize(envelope.projectionBytes);
  assert.equal('_events' in persisted, false, 'the persisted body carries no event log');
  assert.equal('_byKey' in persisted, false, 'the persisted body carries no idempotency index');
  assert.equal(Buffer.compare(envelope.projectionBytes, serialize(payload)), 0,
    'the measured body and the persisted bytes are the same serialize');
});

// ── 465c-b: the successor rebuilds the ledger families and projects the cold replay's state ───────

test('465c-b: a successor reads every row back from the ledger and projects what a cold replay does', (t) => {
  const { directory, rows, goal, task, spill, spilled } = releasedFixture(t, 'successor');
  assert.equal(deserialize(readFileSync(join(directory, CHECKPOINT))).coversSeq, rows,
    'the fixture wrote a checkpoint covering every row on the ledger');
  appendTailRows(directory, rows + 1, 1);

  const replayDirectory = `${directory}-replay`;
  t.after(() => rmSync(replayDirectory, { recursive: true, force: true }));
  cpSync(directory, replayDirectory, { recursive: true });
  unlinkSync(join(replayDirectory, CHECKPOINT));

  const served = new CoordinationStore(directory, storeOptions());
  const replayed = new CoordinationStore(replayDirectory, storeOptions());
  assert.equal(served.startupStatus().checkpoint, 'valid', 'the first open is served by the checkpoint');
  assert.equal(served.startupStatus().source, 'checkpoint_tail', 'with the tail folded past it');
  assert.equal(replayed.startupStatus().checkpoint, 'absent', 'the second has no cache: it replays the ledger');

  // (i) every row is on the store, read back from the ledger file the checkpoint points at.
  assert.equal(served._events.length, rows + 1, '`_events` is the ledger\'s own rows, the tail included');
  assert.deepEqual(served._events, replayed._events, 'the rebuilt rows ARE the ledger\'s rows');
  assert.equal(served._byKey.size, replayed._byKey.size, 'the index is rebuilt to the same span');
  assert.deepEqual(served._byKey.get(`issue465c:tail:${rows + 1}`), replayed._byKey.get(`issue465c:tail:${rows + 1}`),
    'a TAIL row resolves through the rebuilt index');
  assert.deepEqual(served._byKey.get('issue465c:row:1'), replayed._byKey.get('issue465c:row:1'),
    'and so does a row the checkpoint\'s projections already cover');

  // (ii) the same projection: every family the body carries, family by family, and the served view.
  for (const field of PROJECTION_CHECKPOINT_FIELDS) {
    assert.deepEqual(served[field], replayed[field], `${field}: the adopted projection is the replay's`);
  }
  assert.equal(digest(served.snapshot()), digest(replayed.snapshot()),
    'the projection the checkpoint serves has the cold replay\'s digest');

  // (iii) the texts the body carried as REFERENCES resolve through the rebuilt rows: the successor
  // adopts the state, and the reference grammar answers what the ledger row holds.
  const web = served.webCommand('cmd-465c');
  assert.deepEqual(web.outcome, { httpStatus: 200, body: { ok: true, projection: 'full', payload: 'w'.repeat(WEB_BODY_BYTES) } },
    'a completed web command answers the body its reference names');
  assert.deepEqual(web.outcome, replayed.webCommand('cmd-465c').outcome);
  assert.equal(served.materializeSpill(spill.spillId).body, spilled,
    'a spill resolves the bytes the ledger row holds');
  assert.equal(served.materializeSpill(spill.spillId).body, replayed.materializeSpill(spill.spillId).body);
  // The task's brief is the fixture's own preview OBJECT, carried by the ledger row whole.
  assert.deepEqual(served.task('task-465c').brief, replayed.task('task-465c').brief,
    'a task answers the brief its reference names');
  assert.deepEqual(served.task('task-465c').brief, task.brief,
    'and the brief the served task answers is the one the dispatcher pinned');
  assert.equal(served.goalVersion(goal.goalId, goal.version).objective, GOAL_OBJECTIVE,
    'a goal answers the objective its reference names');
  assert.equal(served.goalVersion(goal.goalId, goal.version).objective,
    replayed.goalVersion(goal.goalId, goal.version).objective);
  served.releaseWriterLease({ requireOwned: true });
  replayed.releaseWriterLease({ requireOwned: true });
});

// ── 465c-c: the breakdown counts each object once ────────────────────────────────────────────────

test('465c-c: the byte breakdown counts the ledger families once and closes on the measured bytes', (t) => {
  const { store, rows } = releasedFixture(t, 'breakdown');
  const release = store.checkpointReleaseState();
  assert.equal(release?.state, 'written');
  const payload = store._projectionCheckpointPayload();
  const families = Object.keys(payload);
  assert.deepEqual(Object.keys(release.bytesByFamily).sort(), [...families].sort(),
    'one entry per family of the body the gate judged — and no entry for a family the body does not carry');
  for (const family of families) {
    assert.equal(release.bytesByFamily[family], serialize(payload[family]).byteLength,
      `${family} carries its own measured bytes under the serializer the ceiling is applied to`);
  }
  const summed = families.reduce((total, family) => total + release.bytesByFamily[family], 0);
  assert.equal(summed + release.projectionBaselineBytes - release.sharedBytes, release.bytes,
    'the breakdown closes exactly on the measured bytes: Σ families + baseline − shared === bytes');
  assert.equal(release.bytesByFamily._events, undefined, 'no family entry carries the rows the ledger holds');
  assert.equal(release.bytesByFamily._byKey, undefined, 'and none carries the index over them');

  // The two families the body does not carry are reported as what the successor rebuilds them from:
  // the rows' own bytes on the ledger (attributed to `_events` alone — no payload family counts
  // them, and `sharedBytes` never counts them a second time) and `_byKey`'s key count, with no bytes
  // of its own.
  assert.deepEqual(release.rebuiltFamilies?._byKey, { keys: rows, bytes: 0 },
    '`_byKey` reports its key count and 0 bytes');
  assert.deepEqual(release.rebuiltFamilies?._events, { rows, bytes: release.ledgerBytes },
    '`_events` is the rows and the durable file that holds them, read in O(1) — never re-serialized to measure');
  assert.ok(summed < 1_048_576,
    `the families the body carries sum to kilobytes (${summed} B): the rows the ledger holds are nowhere in the sum`);
});

// ── 465c-d: a cache is never authoritative over the ledger ───────────────────────────────────────

test('465c-d: a claim past the ledger and another build\'s authority both fall back to the ledger', (t) => {
  const { directory, store, rows } = releasedFixture(t, 'fallback');
  assert.equal(store.checkpointReleaseState()?.state, 'written', 'the fixture wrote its checkpoint');

  // (1) A checkpoint that claims more rows than the ledger holds: the claim is refused as its own
  // state, the ledger is replayed, and the open rewrites the cache the next open needs.
  const truncated = directoryFor(t, 'claim-past-ledger');
  cpSync(directory, truncated, { recursive: true });
  const claim = envelopeOf(truncated);
  claim.coversSeq = rows + 16;
  writeEnvelope(truncated, claim);
  const reopened = new CoordinationStore(truncated, storeOptions());
  const status = reopened.startupStatus();
  assert.equal(status.checkpoint, 'stale_ledger',
    'a claim past the ledger\'s last row is its own state, never a silent reuse');
  assert.equal(status.source, 'ledger_fallback', 'the ledger is authoritative for the full replay');
  assert.equal(status.checkpointEvents, 0, 'nothing is reused from a claim the ledger does not back');
  assert.equal(status.replayedEvents, rows, 'every row replays and folds');
  assert.equal(status.checkpointReason, 'covers_beyond_ledger', 'the row names the invariant it failed');
  assert.equal(reopened.snapshot().lastSeq, rows, 'the ledger\'s own last row is the truth');
  assert.equal(status.checkpointRewrite?.state, 'written', 'the open writes the cache it just rebuilt');
  assert.equal(status.checkpointRewrite?.reason, 'stale_ledger_rewrite');
  assert.equal(envelopeOf(truncated).coversSeq, rows, 'and the rewrite records this open\'s own claim');
  reopened.releaseWriterLease({ requireOwned: true });

  const afterRewrite = new CoordinationStore(truncated, storeOptions());
  assert.equal(afterRewrite.startupStatus().checkpoint, 'valid', 'the following open is served by it');
  assert.equal(afterRewrite.startupStatus().replayedEvents, 0, 'and folds nothing');
  afterRewrite.releaseWriterLease({ requireOwned: true });

  // (2) A proven checkpoint under another build's authority digest: its projections were folded
  // under other cards and policies, so they are not this build's state — the successor replays the
  // ledger and rewrites the cache rather than adopting them.
  const other = directoryFor(t, 'other-authority');
  cpSync(directory, other, { recursive: true });
  const foreign = envelopeOf(other);
  foreign.authorityDigest = 'f'.repeat(64);
  writeEnvelope(other, foreign);
  const second = new CoordinationStore(other, storeOptions());
  const secondStatus = second.startupStatus();
  assert.equal(secondStatus.checkpoint, 'stale_authority',
    'a proven checkpoint under another authority digest is its own state, never corrupt');
  assert.equal(secondStatus.checkpointReason, 'authority_digest');
  assert.equal(secondStatus.source, 'ledger_fallback', 'its state is not this build\'s: the ledger replays');
  assert.equal(secondStatus.checkpointEvents, 0, 'nothing is adopted from another authority\'s fold');
  assert.equal(secondStatus.replayedEvents, rows);
  assert.equal(second.snapshot().lastSeq, rows);
  assert.equal(secondStatus.checkpointRewrite?.state, 'written', 'the open refreshes it under this authority');
  assert.equal(secondStatus.checkpointRewrite?.reason, 'stale_authority_rewrite');
  assert.equal(envelopeOf(other).authorityDigest, second._checkpointAuthorityDigest,
    'the cache now carries this build\'s authority');
  second.releaseWriterLease({ requireOwned: true });

  const third = new CoordinationStore(other, storeOptions());
  assert.equal(third.startupStatus().checkpoint, 'valid', 'the following open reports the checkpoint used');
  assert.equal(third.startupStatus().replayedEvents, 0, 'and replays nothing');
  third.releaseWriterLease({ requireOwned: true });
});
