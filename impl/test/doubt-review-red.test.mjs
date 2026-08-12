// Issue #66 red suite — the folded doubt-review contract v1.1.
// Source of truth: docs/reference/evidence/doubt-review-2026-08-12/
//   doubt-review-contract.md (v1.1) + contract-fold.md + contract-redteam.md + suite-66-brief.md.
//
// The doubt: a `kind:'doubt'` scratchpad entry elevates into the shared review surface at the
// settle ritual, is receipted as a durable `knowledge.doubt_*` record (state = latest event for
// the doubtId), is queryable through the orchestrator-addressed `knowledge.doubts` read, is
// answered/dismissed through `knowledge.promote_doubt` (server-derived lease authority), and
// carries project-persistent at the review boundary when the lease revokes. Every capability row
// below is RED at HEAD (the behavior is absent from this tree) and fails at a NAMED stage; the PIN
// rows are green today by construction and must STAY green on the implementation (the fold's
// "must NOT change").
//
// Row inventory (29 rows — 24 RED / 5 PIN):
//   A1     RED  D1 elevation                      (note+plan-only selection, coordinator.mjs:11513)
//   A2     PIN  D1 non-doubt path byte-identical  (green today — note fact + candidacy, plan fact-null)
//   A3     RED  D1 derived sub-cap refusal        (doubts-only starvation refuses scratchpad_partition_exhausted)
//   B1     RED  D2 doubt_raised minted at settle  (no knowledge.doubt_* event kind in the inventory)
//   B2     RED  D2 answered+dismissed transitions (coordinator.resolveDoubt missing)
//   B3     RED  D2 carried transition             (sweepSettlementLeases has no doubt handling)
//   B4     RED  D2 replay-exactness               (no doubt events to replay — exactly-once mint)
//   C1     RED  D3 folded projection + row        (knowledge.doubts absent from snapshot().knowledge and the registry)
//   C2     RED  D3 receipt openDoubts 0-as-0      (no openDoubts field on the settle receipt)
//   C3     RED  D3 knowledge.doubts read          (application_command_unavailable — command missing)
//   C4     RED  D3 authority boundary             (doubt_surface_unavailable — command missing)
//   C5     RED  D7 frame rows                     (view.open_doubts.* + doubt.resolution.bytes absent from FRAME_LIMITS)
//   D1     RED  D4 answered + pushRequested       (coordinator.resolveDoubt missing)
//   D2     RED  D4 dismissed + closed reason      (coordinator.resolveDoubt missing)
//   D3     RED  D4 forged resolution refuses      (coordinator.resolveDoubt missing)
//   D4     RED  D4 self-resolution never auto-close (coordinator.resolveDoubt missing)
//   D5     RED  D4 lease never a caller field     (coordinator.resolveDoubt missing)
//   D6     RED  D4 taxonomy boundary              (coordinator.resolveDoubt missing)
//   E1     RED  D5 raise-before-sweep ordering    (no knowledge.doubt_raised event kind)
//   E2     RED  D5 elevated-but-unraised carries  (sweep has no doubt handling)
//   E3     RED  D5 settle error leaves doubts intact (batch reap loses the doubt)
//   F1     RED  D6 answer addresses the doubting worker (coordinator.resolveDoubt missing)
//   K1     RED  refusals promote_doubt/doubts rows (application-semantics rows missing)
//   K2     RED  refusals 9-code family constant   (coordinatorNs.DOUBT_REFUSAL_CODES missing)
//   K3     RED  refusals fire typed in scenario   (coordinator.resolveDoubt missing)
//   G1     PIN  R9 board candidacy stays note-only (green today)
//   G2     PIN  OQ3 open doubt on the scratchpad  (green today — application.mjs:745-748)
//   G3     PIN  D5 sweep still retires + cancels  (green today — the existing sweep behavior)
//   G4     PIN  no localeCompare in impl/src      (green today)
//
// Invented surfaces (every one absent at HEAD — the first assertion on each is an `assert.ok` so
// the row fails at the NAMED stage, never on a vacuous shape assertion):
//   knowledge.doubt_raised / knowledge.doubt_resolved / knowledge.doubt_carried  — the three new
//     event kinds, folded into snapshot().knowledge + the event-kind inventory (M5)
//   coordinator.resolveDoubt(runId, doubtId, disposition, session, {resolution, dismissalReason})
//     — the D4 resolve authority; the active run-orchestrator lease is re-derived server-side,
//     never a caller field (HOLE-3)
//   application.command('knowledge.promote_doubt', ...)   — the D4 command row (embedded-only)
//   application.command('knowledge.doubts', ...)          — the D3 observe row (embedded-only,
//     direct-port dispatch branch at application.mjs:12493-12495)
//   store.snapshot().knowledge.doubts                     — the folded doubt projection (M5)
//   receipt.openDoubts                                    — the settle receipt's reviewed-doubt count
//   coordinatorNs.DOUBT_REFUSAL_CODES                     — the frozen 9-code doubt refusal family
//   FRAME_LIMITS['view.open_doubts.items'] = 8  / FRAME_LIMITS['view.open_doubts.bytes'] = 8192
//     / FRAME_LIMITS['doubt.resolution.bytes'] = 4096     — the D7 rows, derived not re-declared
//   wrapHubDerived(worker, text)                          — {provenance:'hub-derived', untrusted:true}
//   the `knowledge.doubt_resolved` push coordinates       — {workerId, doubtId, resolution,
//     pushRequested:true}, the #79 `doubt_answer:${doubtId}` durable id (D6)
//
// Suite-law hygiene: hermetic (mock adapters, mkdtemp, test.after, no network); fixed-clock store
// for the direct harness and a real-time-anchored store clock for the application harness (the
// deployment's clock, never a wall-clock assertion); sorted-key literals in ACTUAL order;
// `localeCompare` banned; no timers; NUL discipline — application.mjs and coordination-store.mjs
// are never read whole, only their exports are imported (the red-team's M2 correction). Verified
// split is recorded below after two consecutive runs from the repo root.
//
// VERIFIED SPLIT — two consecutive runs from the repo root (`node --test impl/test/doubt-review-red.test.mjs`):
//   run 1: tests 29 · pass 5 · fail 24 · cancelled 0 · skipped 0 · todo 0
//   run 2: tests 29 · pass 5 · fail 24 · cancelled 0 · skipped 0 · todo 0
//   stable — the identical 24 rows fail at their NAMED stages on both runs; the 5 PIN rows
//   (A2, G1–G4) stay green. Failing rows, by named stage: A1 (coordinator.mjs:11513 note+plan-only
//   selection), A3 (no sub-cap prevalidation in elevateTaskScratchpad), B1/B2/B3/B4 (no doubt event
//   kind / coordinator.resolveDoubt missing / sweep has no doubt handling / no doubt events to
//   replay), C1/C2 (knowledge.doubts absent, no openDoubts field), C3/C4 (application_command_unavailable),
//   C5 (rows absent from FRAME_LIMITS), D1–D6 (coordinator.resolveDoubt missing), E1 (no doubt_raised
//   event kind), E2 (sweep has no doubt handling), E3 (the settle ritual's reap dispositions the
//   doubt orchestrator_skipped at HEAD), F1 (coordinator.resolveDoubt missing), K1/K2/K3 (rows
//   missing / coordinatorNs.DOUBT_REFUSAL_CODES absent / coordinator.resolveDoubt missing).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter } from '../src/adapter.mjs';
import { BatonApplication } from '../src/application.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import * as coordinatorNs from '../src/coordinator.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import { bindBaton, createDriver, DEFAULT_RUN_LINEAGE_POLICY } from '../src/index.mjs';
import { Log } from '../src/log.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

// Verified split (recorded after the draft — two consecutive runs from the repo root):
//   run 1: tests 29 · pass 5 · fail 24 · cancelled 0 · skipped 0 · todo 0
//   run 2: tests 29 · pass 5 · fail 24 · cancelled 0 · skipped 0 · todo 0
//   deterministic — the 5 passes are exactly the PIN rows (A2, G1, G2, G3, G4); the 24 failures
//   are the RED rows, each confirmed to fail at its NAMED stage.

const repoId = 'repo-doubt-review';
const FIXED_TS = '2026-08-01T08:00:00.000Z';
const dirs = [];
function dir(label) {
  const d = mkdtempSync(join(tmpdir(), `baton-66-${label}-`));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function digest(value) {
  const canonical = (v) => {
    if (Array.isArray(v)) return v.map(canonical);
    if (!v || typeof v !== 'object') return v;
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
const auth = (key, actor = 'orchestrator') => ({ actor, key });
const principal = (id) => Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` });

function refusalCode(fn) {
  try { fn(); return null; }
  catch (error) { return error?.code ?? error?.name ?? 'unknown_error'; }
}

// The wave-owner review session the settle ritual mints its lease with — the only session the
// contract's resolve act accepts (server-re-derived from the caller; never a caller field).
const REVIEW_SESSION = Object.freeze({
  principalId: 'wave-owner', sessionId: 'session-wave-owner',
  authorityDigest: digest({ kind: 'authenticated-worker-session', principalId: 'wave-owner', sessionId: 'session-wave-owner' }),
  expiresAt: '2026-08-01T08:30:00.000Z',
});
const FOREIGN_SESSION = Object.freeze({
  principalId: 'mallory', sessionId: 'session-mallory',
  authorityDigest: digest({ kind: 'authenticated-worker-session', principalId: 'mallory', sessionId: 'session-mallory' }),
  expiresAt: '2026-08-01T08:30:00.000Z',
});

// The contract's refusal vocabulary — ACTUAL sorted order (compareCanonicalStrings byte order;
// no localeCompare anywhere). This is the exact frozen family the implementation must export.
const DOUBT_REFUSAL_CODES_EXPECTED = Object.freeze([
  'doubt_carry_conflict',
  'doubt_dismissal_invalid',
  'doubt_promote_conflict',
  'doubt_promote_invalid',
  'doubt_promote_not_authorized',
  'doubt_promote_stale',
  'doubt_promote_unknown',
  'doubt_resolution_exceeded',
  'doubt_surface_unavailable',
]);
const DISMISSAL_REASONS = Object.freeze(['deferred', 'duplicate', 'out_of_scope', 'unfounded']);

// The D7 rows the contract pins (limits.mjs, ONE declared registry — no re-declaration).
const OPEN_DOUBTS_ITEMS_ROW = Object.freeze({
  lane: 'view.open_doubts.items', class: 'view', value: 8, unit: 'items', graceful: 'shed-flagged',
});
const OPEN_DOUBTS_BYTES_ROW = Object.freeze({
  lane: 'view.open_doubts.bytes', class: 'view', value: 8192, unit: 'bytes', graceful: 'shed-flagged',
});
const DOUBT_RESOLUTION_BYTES_ROW = Object.freeze({
  lane: 'doubt.resolution.bytes', class: 'admission', value: 4096, unit: 'bytes',
  graceful: 'refused', enforcedAt: 'coordinator.resolveDoubt', refusalCode: 'doubt_resolution_exceeded',
});

// ---------------------------------------------------------------------------
// A-rows — D1 elevation
// ---------------------------------------------------------------------------

test('A1: a doubt-kind entry elevates to the shared partition (RED — note+plan-only selection)', () => {
  const { store, coordinator } = directHarness();
  const runId = 'run:a1'; const taskId = 'task:a1'; const workerId = 'worker:a1';
  registerSteering(store, runId, W1, 'research');
  seedMember(store, { runId, taskId, workerId, entries: [{ kind: 'doubt', question: 'does the contract bind TTL?', context: null }] });
  coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  const shared = store.scratchpadSnapshot(runId, 'shared');
  assert.equal(shared.entries.some((entry) => entry.kind === 'doubt'), true,
    'D1 elevation: a doubt elevates into shared (stage: coordinator.mjs:11513 filters note+plan only)');
  const elevated = shared.entries.find((entry) => entry.kind === 'doubt');
  assert.equal(elevated.content?.question, 'does the contract bind TTL?', 'the question survives verbatim');
  assert.equal(elevated.scratchFactId ?? null, null, 'a doubt never mints a bridge scratch fact (GT2)');
  const reap = store.events().find((event) => event.kind === 'scratchpad.partition_reaped' && event.payload?.basis === 'task_settled');
  const disposition = (reap?.payload?.dispositions ?? []).find((row) => row.entryId === elevated.source?.entryId);
  assert.equal(disposition?.result, 'elevated', 'under a driven selection the doubt dispositions elevated, never orchestrator_skipped');
  assert.equal(disposition?.reasonCode, 'selected');
});

test('A2: the non-doubt path is byte-identical to v1.0 (PIN — green today, must stay green)', () => {
  const { store, coordinator } = directHarness();
  const runId = 'run:a2'; const taskId = 'task:a2'; const workerId = 'worker:a2';
  registerSteering(store, runId, W1, 'research');
  seedMember(store, { runId, taskId, workerId, entries: [
    { kind: 'note', text: 'the lease binds' },
    { kind: 'plan', objective: 'survey the lease', steps: [{ text: 'read', state: 'done' }], supersedes: null },
  ] });
  const receipt = coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  const shared = store.scratchpadSnapshot(runId, 'shared');
  assert.deepEqual(shared.entries.map((entry) => entry.kind).sort(), ['note', 'plan'], 'note+plan elevate');
  const noteShared = shared.entries.find((entry) => entry.kind === 'note');
  assert.ok(noteShared.scratchFactId, 'the note mints a scratch fact (D4.3), unchanged');
  assert.equal(shared.entries.find((entry) => entry.kind === 'plan')?.scratchFactId ?? null, null, 'the plan carries no fact');
  assert.equal(store.boardSnapshot(`wave-settlement:${W1}`).items.length, 1, 'the note candidacy posts');
  assert.equal(receipt.candidatesAwaitingAdmission, 1, 'candidacy count unchanged');
});

test('A3: a doubt-heavy batch refuses the derived sub-cap as a whole (RED — no sub-cap prevalidation)', () => {
  const { store } = directHarness();
  const runId = 'run:a3';
  registerSteering(store, runId, W1, 'research');
  // The 3:1 reservation: within the 512 shared ceiling, doubts ≤ 384 and notes+plans ≥ 128
  // (HOLE-5). The worker partition caps at 128, so the doubt budget can only bind through the
  // shared partition's accumulated composition. Accumulate 300 doubts across distinct worker
  // scopes (each a distinct task — the elevation reap key names the task), then a final 100-doubt
  // batch that pushes the run's shared partition to 400 doubts — over the 384 doubt budget. Under
  // the contract the elevation prevalidates the WHOLE batch and refuses scratchpad_partition_exhausted
  // before any successor/fact/reap. At HEAD the 512 ceiling is the only check, so the same batch
  // succeeds — the red is the missing sub-cap, not a full-shared false positive.
  for (let round = 0; round < 3; round += 1) {
    const workerId = `worker:a3-${round}`;
    const roundTask = `task:a3-${round}`;
    spawnMemberTask(store, { runId, taskId: roundTask, workerId });
    writeRound(store, { runId, taskId: roundTask, workerId }, 100, 'doubt', `acc${round}`);
    elevateRound(store, { runId, taskId: roundTask, workerId });
  }
  const finalWorker = 'worker:a3-final';
  const finalTask = 'task:a3-final';
  spawnMemberTask(store, { runId, taskId: finalTask, workerId: finalWorker });
  writeRound(store, { runId, taskId: finalTask, workerId: finalWorker }, 100, 'doubt', 'final');
  const code = refusalCode(() => elevateRound(store, { runId, taskId: finalTask, workerId: finalWorker }));
  assert.equal(code, 'scratchpad_partition_exhausted',
    'D1 sub-cap: the doubt-heavy batch refuses as a whole (stage: no sub-cap prevalidation in elevateTaskScratchpad)');
});

// ---------------------------------------------------------------------------
// B-rows — D2 the durable doubt record + lifecycle
// ---------------------------------------------------------------------------

test('B1: the settle ritual mints knowledge.doubt_raised with the full worker frame (RED — no doubt event kind)', () => {
  const { store, coordinator } = directHarness();
  const runId = 'run:b1'; const taskId = 'task:b1'; const workerId = 'worker:b1';
  registerSteering(store, runId, W1, 'research');
  seedMember(store, { runId, taskId, workerId, entries: [
    { kind: 'doubt', question: 'the question verbatim', context: 'the context verbatim' },
    { kind: 'note', text: 'a note' },
  ] });
  coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  const raise = store.events().find((event) => event.kind === 'knowledge.doubt_raised');
  assert.ok(raise, 'a knowledge.doubt_raised event is minted at the settle ritual (stage: no doubt event kind in the inventory)');
  const payload = raise.payload;
  assert.deepEqual(Object.keys(payload).sort(), [
    'context', 'doubtId', 'question', 'runId', 'schemaVersion', 'sharedEntryId',
    'sourceEntryDigest', 'sourceEntryId', 'taskId', 'waveId', 'workerId',
  ], 'the closed payload field set (ACTUAL sorted order)');
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.runId, runId);
  assert.equal(payload.waveId, W1);
  assert.equal(payload.taskId, taskId);
  assert.equal(payload.workerId, workerId);
  assert.equal(payload.question, 'the question verbatim', 'the question is recorded verbatim');
  assert.equal(payload.context, 'the context verbatim');
  assert.ok(payload.doubtId.startsWith('doubt:'), 'doubtId is doubt:<sha256>');
  assert.equal(raise.idempotencyKey, `knowledge.doubt_raised:${W1}:${payload.sharedEntryId}`, 'the idempotency key is pinned');
});

test('B2: answered and dismissed transitions are receipted (RED — coordinator.resolveDoubt missing)', () => {
  const { store, coordinator } = directHarness();
  const raisedFor = (waveId) => store.events()
    .find((event) => event.kind === 'knowledge.doubt_raised' && event.payload?.waveId === waveId)?.payload?.doubtId ?? 'doubt:missing';
  // Answered.
  const aRunId = 'run:b2a'; const aTaskId = 'task:b2a'; const aWorkerId = 'worker:b2a';
  registerSteering(store, aRunId, W1, 'research');
  seedMember(store, { runId: aRunId, taskId: aTaskId, workerId: aWorkerId, entries: [
    { kind: 'doubt', question: 'q answered', context: null },
    { kind: 'note', text: 'n answered' },
  ] });
  const receiptA = coordinator.settlementLease(W1, REVIEW_SESSION, { members: [aRunId] });
  const doubtIdA = raisedFor(W1);
  assert.ok(coordinator.resolveDoubt, 'coordinator.resolveDoubt-missing');
  coordinator.resolveDoubt(receiptA.runId, doubtIdA, 'answered', REVIEW_SESSION, { resolution: 'the TTL does bind — here is the reasoning.' });
  const resolvedA = store.events().find((event) => event.kind === 'knowledge.doubt_resolved' && event.payload?.doubtId === doubtIdA);
  assert.ok(resolvedA, 'the answer mints knowledge.doubt_resolved');
  assert.equal(resolvedA.payload.disposition, 'answered');
  assert.equal(resolvedA.payload.answeredBy, 'orchestrator');
  assert.equal(resolvedA.payload.pushRequested, true, 'an answered doubt arms the push seam (D6)');
  assert.equal(resolvedA.idempotencyKey, `knowledge.doubt_resolved:${doubtIdA}`, 'the idempotency key is pinned to the doubtId');
  // Dismissed (a second wave so the doubt is fresh in state reviewed).
  const bRunId = 'run:b2b'; const bTaskId = 'task:b2b'; const bWorkerId = 'worker:b2b';
  registerSteering(store, bRunId, W2, 'research');
  seedMember(store, { runId: bRunId, taskId: bTaskId, workerId: bWorkerId, entries: [
    { kind: 'doubt', question: 'q dismissed', context: null },
    { kind: 'note', text: 'n dismissed' },
  ] });
  const receiptB = coordinator.settlementLease(W2, REVIEW_SESSION, { members: [bRunId] });
  const doubtIdB = raisedFor(W2);
  coordinator.resolveDoubt(receiptB.runId, doubtIdB, 'dismissed', REVIEW_SESSION, { dismissalReason: 'out_of_scope' });
  const resolvedB = store.events().find((event) => event.kind === 'knowledge.doubt_resolved' && event.payload?.doubtId === doubtIdB);
  assert.equal(resolvedB?.payload?.disposition, 'dismissed');
  assert.equal(resolvedB?.payload?.dismissalReason, 'out_of_scope');
  assert.equal(resolvedB?.payload?.pushRequested, false, 'a dismissed doubt never arms the push');
});

test('B3: a doubt still reviewed when its lease revokes carries (RED — sweep has no doubt handling)', () => {
  const { store, coordinator } = directHarness();
  const runId = 'run:b3'; const taskId = 'task:b3'; const workerId = 'worker:b3';
  registerSteering(store, runId, W1, 'research');
  seedMember(store, { runId, taskId, workerId, entries: [
    { kind: 'doubt', question: 'unanswered', context: null },
    { kind: 'note', text: 'a note' },
  ] });
  coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  store.sweepSettlementLeases(repoId, { maxLeases: 16, currentWaveId: 'wave:next' });
  const carried = store.events().find((event) => event.kind === 'knowledge.doubt_carried');
  assert.ok(carried, 'the sweep mints knowledge.doubt_carried at the review boundary (stage: sweepSettlementLeases retires candidates but has no doubt handling)');
  assert.equal(carried.payload.carriedBy, 'review_window_expired');
  assert.ok(Number.isSafeInteger(carried.payload.carriedSeq), 'carriedSeq is the event’s own seq');
  assert.equal(carried.idempotencyKey, `knowledge.doubt_carried:${carried.payload.doubtId}`, 'the idempotency key is pinned to the doubtId');
});

test('B4: re-driving the same wave mints the same doubtId exactly-once (RED — no doubt events to replay)', () => {
  const { store, coordinator } = directHarness();
  const runId = 'run:b4'; const taskId = 'task:b4'; const workerId = 'worker:b4';
  registerSteering(store, runId, W1, 'research');
  seedMember(store, { runId, taskId, workerId, entries: [
    { kind: 'doubt', question: 'replay me', context: null },
    { kind: 'note', text: 'a note' },
  ] });
  coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  const raises = store.events().filter((event) => event.kind === 'knowledge.doubt_raised');
  assert.equal(raises.length, 1, 'the re-drive replays exactly — one doubt_raised (stage: no doubt events exist to replay)');
  assert.ok(raises[0]?.payload?.doubtId?.startsWith('doubt:'), 'the raised record carries the derived doubtId');
});

// ---------------------------------------------------------------------------
// C-rows — D3 the queryable review surface
// ---------------------------------------------------------------------------

test('C1: the doubt projection folds into snapshot().knowledge and the registry row exists (RED — knowledge.doubts absent)', () => {
  const { store, coordinator } = directHarness();
  const runId = 'run:c1'; const taskId = 'task:c1'; const workerId = 'worker:c1';
  registerSteering(store, runId, W1, 'research');
  seedMember(store, { runId, taskId, workerId, entries: [
    { kind: 'doubt', question: 'query me', context: null },
    { kind: 'note', text: 'a note' },
  ] });
  coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  const projection = store.snapshot().knowledge;
  assert.ok(projection.doubts, 'the folded knowledge.doubts projection exists (stage: the folded map has no doubts key — M5)');
  assert.ok(Array.isArray(projection.doubts), 'doubts is an array of records');
  const row = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.find((entry) => entry.key === 'knowledge.doubts');
  assert.ok(row, 'the knowledge.doubts registry row exists');
  assert.equal(row.profile, 'kernel');
  assert.deepEqual([...(row.surfaces ?? [])].sort(), ['embedded'], 'embedded-only, orchestrator-addressed (the board.claim precedent)');
  assert.equal(row.effect, 'observe');
  assert.deepEqual([...(row.serverDerived ?? [])].sort(), ['actor', 'principalId', 'sessionId']);
});

test('C2: the settle receipt carries knowledge.openDoubts zero as 0, never missing (RED — no openDoubts field)', () => {
  const { store, coordinator } = directHarness();
  const runId = 'run:c2'; const taskId = 'task:c2'; const workerId = 'worker:c2';
  registerSteering(store, runId, W1, 'research');
  seedMember(store, { runId, taskId, workerId, entries: [{ kind: 'note', text: 'no doubts here' }] });
  const receipt = coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  assert.equal(receipt.openDoubts, 0, 'a doubt-free wave receipts openDoubts as the explicit integer zero (stage: the receipt has no openDoubts field)');
  assert.equal(receipt.candidatesAwaitingAdmission, 1, 'candidacy stays alongside the doubt count');
});

test('C3: knowledge.doubts returns bounded, sorted, UNTRUSTED-framed records (RED — application_command_unavailable)', async (t) => {
  const { application, store } = appHarness(t);
  const waveId = 'wave:c3';
  const runId = 'run:c3'; const taskId = 'task:c3'; const workerId = 'worker:c3';
  store.recordDriver('steering.registered', { runId, driverKind: 'wave', actor: 'orchestrator', waveId, waveRole: 'research' }, { actor: 'orchestrator', key: `run.steering_registered:${runId}` });
  seedMember(store, { runId, taskId, workerId, entries: [
    { kind: 'doubt', question: 'query me', context: null },
    { kind: 'note', text: 'a note' },
  ] });
  await application.command('knowledge.settlement_lease', { waveId, members: [runId] }, principal('wave-owner')).catch(() => {});
  const read = await application.command('knowledge.doubts', { waveId }, principal('wave-owner'))
    .then((value) => ({ ok: true, value }), (error) => ({ ok: false, code: error?.code ?? error?.name ?? 'thrown' }));
  assert.equal(read.ok, true, `knowledge.doubts read dispatches (stage: command missing — got ${read.code})`);
  const { runId: outRunId, waveId: outWaveId, doubts, openDoubtsTruncated } = read.value ?? {};
  assert.equal(outRunId, `run-settlement:${waveId}`);
  assert.equal(outWaveId, waveId);
  assert.ok(Array.isArray(doubts), 'doubts is an array');
  const record = doubts[0];
  assert.ok(record, 'at least one raised doubt record');
  assert.deepEqual(Object.keys(record).sort(), [
    'carriedSeq', 'context', 'dismissalReason', 'doubtId', 'question', 'raisedSeq',
    'resolution', 'resolvedSeq', 'runId', 'state', 'taskId', 'waveId', 'workerId',
  ], 'the closed record field set (ACTUAL sorted order)');
  assert.equal(record.state, 'reviewed');
  assert.equal(typeof record.raisedSeq, 'number', 'raisedSeq is the raise event’s seq');
  assert.equal(record.resolvedSeq, null, 'resolvedSeq is null until the transition exists');
  assert.equal(record.carriedSeq, null, 'carriedSeq is null until the transition exists');
  assert.deepEqual(Object.keys(record.question ?? {}).sort(), ['provenance', 'text', 'untrusted', 'worker'],
    'the doubting worker’s question is wrapProse-framed (UNTRUSTED)');
  assert.equal(record.question.provenance, 'model-authored');
  assert.equal(record.question.untrusted, true);
  assert.equal(typeof openDoubtsTruncated, 'boolean', 'the shed flag is explicit');
});

test('C4: the read refuses a caller holding neither the lease nor the orchestrator authority (RED — command missing)', async (t) => {
  const { application, store } = appHarness(t);
  const waveId = 'wave:c4';
  const runId = 'run:c4'; const taskId = 'task:c4'; const workerId = 'worker:c4';
  store.recordDriver('steering.registered', { runId, driverKind: 'wave', actor: 'orchestrator', waveId, waveRole: 'research' }, { actor: 'orchestrator', key: `run.steering_registered:${runId}` });
  seedMember(store, { runId, taskId, workerId, entries: [
    { kind: 'doubt', question: 'secret of this wave', context: null },
    { kind: 'note', text: 'a note' },
  ] });
  await application.command('knowledge.settlement_lease', { waveId, members: [runId] }, principal('wave-owner')).catch(() => {});
  // A member worker session holds none of the two authorities — the boundary is orchestrator-
  // addressed; a worker never reads the review ledger (let alone another run's doubts). The refusal
  // is typed doubt_surface_unavailable (D3, HOLE-4) — never application_command_unavailable.
  const workerRead = await application.command('knowledge.doubts', { waveId }, principal(`worker:${workerId}`))
    .then((value) => ({ ok: true, value }), (error) => ({ ok: false, code: error?.code ?? error?.name ?? 'thrown' }));
  assert.equal(workerRead.ok, false, 'a worker session is refused the read');
  assert.equal(workerRead.code, 'doubt_surface_unavailable',
    `the refusal is typed doubt_surface_unavailable (stage: command missing — got ${workerRead.code})`);
  // The lease-holding caller still reads the same wave (the positive control), proving the refusal
  // is authority-shaped, not a blanket gate.
  const ownerRead = await application.command('knowledge.doubts', { waveId }, principal('wave-owner'))
    .then((value) => ({ ok: true, value }), (error) => ({ ok: false, code: error?.code ?? error?.name ?? 'thrown' }));
  assert.equal(ownerRead.ok, true, 'the lease holder reads the wave');
});

test('C5: the three D7 frame rows land in the ONE registry (RED — rows absent from FRAME_LIMITS)', () => {
  assert.deepEqual(
    { ...(FRAME_LIMITS['view.open_doubts.items'] ?? { lane: null }), value: FRAME_LIMITS['view.open_doubts.items']?.value ?? null },
    OPEN_DOUBTS_ITEMS_ROW,
    'view.open_doubts.items = 8 (items, shed-flagged) — derived from view.knowledge_slice.items',
  );
  assert.deepEqual(
    { ...(FRAME_LIMITS['view.open_doubts.bytes'] ?? { lane: null }), value: FRAME_LIMITS['view.open_doubts.bytes']?.value ?? null },
    OPEN_DOUBTS_BYTES_ROW,
    'view.open_doubts.bytes = 8192 (bytes, shed-flagged) — the honest sum that renders one answered record',
  );
  assert.deepEqual(
    { ...(FRAME_LIMITS['doubt.resolution.bytes'] ?? { lane: null }), value: FRAME_LIMITS['doubt.resolution.bytes']?.value ?? null },
    DOUBT_RESOLUTION_BYTES_ROW,
    'doubt.resolution.bytes = 4096 (bytes, admission) — derived from board.detail',
  );
  assert.ok(8192 >= 1024 + 2048 + 4096, 'one answered record (question + context + resolution + wrappers) renders inside view.open_doubts.bytes (HOLE-1)');
});

// ---------------------------------------------------------------------------
// D-rows — D4 knowledge.promote_doubt
// ---------------------------------------------------------------------------

test('D1: an answered doubt is receipted with the push coordinates (RED — coordinator.resolveDoubt missing)', () => {
  const { store, coordinator } = directHarness();
  const runId = 'run:d1'; const taskId = 'task:d1'; const workerId = 'worker:d1';
  registerSteering(store, runId, W1, 'research');
  seedMember(store, { runId, taskId, workerId, entries: [
    { kind: 'doubt', question: 'q', context: null },
    { kind: 'note', text: 'n' },
  ] });
  const receipt = coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  const doubtId = store.events().find((event) => event.kind === 'knowledge.doubt_raised')?.payload?.doubtId ?? 'doubt:missing';
  assert.ok(coordinator.resolveDoubt, 'coordinator.resolveDoubt-missing');
  coordinator.resolveDoubt(receipt.runId, doubtId, 'answered', REVIEW_SESSION, { resolution: 'the answer, bounded' });
  const resolved = store.events().find((event) => event.kind === 'knowledge.doubt_resolved' && event.payload?.doubtId === doubtId);
  assert.ok(resolved, 'the answer mints knowledge.doubt_resolved');
  const payload = resolved.payload;
  assert.deepEqual(Object.keys(payload).sort(), [
    'answeredBy', 'dismissalReason', 'disposition', 'doubtId', 'pushRequested', 'resolution', 'schemaVersion',
  ], 'the doubt_resolved payload field set (ACTUAL sorted order)');
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.doubtId, doubtId);
  assert.equal(payload.disposition, 'answered');
  assert.equal(payload.pushRequested, true);
  assert.equal(payload.answeredBy, 'orchestrator');
  assert.equal(payload.resolution, 'the answer, bounded');
  assert.equal(payload.dismissalReason, null, 'an answered doubt has no dismissal reason');
  assert.ok(resolved.idempotencyKey === `knowledge.doubt_resolved:${doubtId}`, 'the idempotency key is pinned to the doubtId');
});

test('D2: a dismissed doubt is receipted with the closed reason and never pushes (RED — coordinator.resolveDoubt missing)', () => {
  const { store, coordinator } = directHarness();
  const runId = 'run:d2'; const taskId = 'task:d2'; const workerId = 'worker:d2';
  registerSteering(store, runId, W1, 'research');
  seedMember(store, { runId, taskId, workerId, entries: [
    { kind: 'doubt', question: 'q', context: null },
    { kind: 'note', text: 'n' },
  ] });
  const receipt = coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  const doubtId = store.events().find((event) => event.kind === 'knowledge.doubt_raised')?.payload?.doubtId ?? 'doubt:missing';
  assert.ok(coordinator.resolveDoubt, 'coordinator.resolveDoubt-missing');
  coordinator.resolveDoubt(receipt.runId, doubtId, 'dismissed', REVIEW_SESSION, { dismissalReason: 'duplicate' });
  const resolved = store.events().find((event) => event.kind === 'knowledge.doubt_resolved' && event.payload?.doubtId === doubtId);
  assert.ok(resolved, 'the dismissal mints knowledge.doubt_resolved');
  assert.equal(resolved.payload.disposition, 'dismissed');
  assert.equal(resolved.payload.dismissalReason, 'duplicate');
  assert.equal(resolved.payload.pushRequested, false, 'a dismissed doubt never arms the push');
});

test('D3: a forged resolution from a non-authority refuses typed (RED — coordinator.resolveDoubt missing)', () => {
  const { store, coordinator } = directHarness();
  const runId = 'run:d3'; const taskId = 'task:d3'; const workerId = 'worker:d3';
  registerSteering(store, runId, W1, 'research');
  seedMember(store, { runId, taskId, workerId, entries: [
    { kind: 'doubt', question: 'q', context: null },
    { kind: 'note', text: 'n' },
  ] });
  const receipt = coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  const doubtId = store.events().find((event) => event.kind === 'knowledge.doubt_raised')?.payload?.doubtId ?? 'doubt:missing';
  assert.ok(coordinator.resolveDoubt, 'coordinator.resolveDoubt-missing');
  const code = refusalCode(() => coordinator.resolveDoubt(receipt.runId, doubtId, 'answered', FOREIGN_SESSION, { resolution: 'forged' }));
  assert.equal(code, 'run_orchestrator_session_mismatch', 'a foreign session fails the server-re-derived lease gate typed (the #73 forge class is closed)');
});

test('D4: a worker self-resolution never auto-closes the doubt (RED — no doubt record to keep reviewed)', () => {
  const { store, coordinator } = directHarness();
  const runId = 'run:d4'; const taskId = 'task:d4'; const workerId = 'worker:d4';
  registerSteering(store, runId, W1, 'research');
  // The member's OWN note is the self-resolution — it elevates and candidacies separately, but
  // must never close the doubt record (OQ2: the review authority is never bypassed).
  seedMember(store, { runId, taskId, workerId, entries: [
    { kind: 'doubt', question: 'self-resolved?', context: null },
    { kind: 'note', text: 'resolved it myself' },
  ] });
  coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  const record = store.snapshot().knowledge.doubts?.find((row) => row.question?.text === 'self-resolved?');
  assert.ok(record, 'the raised doubt record exists (stage: no doubt record to keep reviewed)');
  assert.equal(record.state, 'reviewed', 'the self-resolution note never auto-closes the doubt (OQ2)');
  assert.equal(store.boardSnapshot(`wave-settlement:${W1}`).items.length, 1, 'the note candidacies separately, never as the doubt’s close');
});

test('D5: the resolve authority is the server-re-derived lease, never a caller field (RED — coordinator.resolveDoubt missing)', () => {
  const { store, coordinator } = directHarness();
  const runId = 'run:d5'; const taskId = 'task:d5'; const workerId = 'worker:d5';
  registerSteering(store, runId, W1, 'research');
  seedMember(store, { runId, taskId, workerId, entries: [
    { kind: 'doubt', question: 'q', context: null },
    { kind: 'note', text: 'n' },
  ] });
  const receipt = coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  const doubtId = store.events().find((event) => event.kind === 'knowledge.doubt_raised')?.payload?.doubtId ?? 'doubt:missing';
  assert.ok(coordinator.resolveDoubt, 'coordinator.resolveDoubt-missing');
  // The call carries ONLY the session — there is no lease argument on the act at all. The active
  // lease for the settlement run is re-derived server-side from the session (HOLE-3); the correct
  // session resolves without supplying anything.
  const resolved = coordinator.resolveDoubt(receipt.runId, doubtId, 'answered', REVIEW_SESSION, { resolution: 'derived, not supplied' });
  assert.ok(resolved, 'resolveDoubt works from the session alone, no caller lease field');
  // A foreign session still refuses — the lease is the session-bound authority, never a caller
  // field a caller could substitute.
  const forged = refusalCode(() => coordinator.resolveDoubt(receipt.runId, doubtId, 'answered', FOREIGN_SESSION, { resolution: 'x' }));
  assert.equal(forged, 'run_orchestrator_session_mismatch', 'the #73 forge class is closed — a foreign session cannot resolve');
});

test('D6: answer/dismiss mints no Finding, KG node, board item, workflow_admitted, or scratch-fact (RED — coordinator.resolveDoubt missing)', () => {
  const { store, coordinator } = directHarness();
  const runId = 'run:d6'; const taskId = 'task:d6'; const workerId = 'worker:d6';
  registerSteering(store, runId, W1, 'research');
  seedMember(store, { runId, taskId, workerId, entries: [
    { kind: 'doubt', question: 'q', context: null },
    { kind: 'note', text: 'n' },
  ] });
  const receipt = coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  const doubtId = store.events().find((event) => event.kind === 'knowledge.doubt_raised')?.payload?.doubtId ?? 'doubt:missing';
  assert.ok(coordinator.resolveDoubt, 'coordinator.resolveDoubt-missing');
  const nodesBefore = store.snapshot().knowledge.nodes.length;
  const boardsBefore = store.events().filter((event) => event.kind === 'board.item_posted').length;
  const factsBefore = store.events().filter((event) => event.kind === 'scratch.fact_posted').length;
  coordinator.resolveDoubt(receipt.runId, doubtId, 'answered', REVIEW_SESSION, { resolution: 'the taxonomy boundary is structural' });
  const nodesAfter = store.snapshot().knowledge.nodes.length;
  const boardsAfter = store.events().filter((event) => event.kind === 'board.item_posted').length;
  const factsAfter = store.events().filter((event) => event.kind === 'scratch.fact_posted').length;
  assert.equal(nodesAfter, nodesBefore, 'no new KG node (GT2/GT5 — a doubt answer never enters the Finding graph)');
  assert.equal(boardsAfter, boardsBefore, 'no new board item');
  assert.equal(factsAfter, factsBefore, 'no new scratch fact');
  assert.equal(store.events().filter((event) => event.kind === 'knowledge.workflow_admitted').length, 0, 'no workflow admission');
});

// ---------------------------------------------------------------------------
// E-rows — D5 the settle composition
// ---------------------------------------------------------------------------

test('E1: the raise scan runs BEFORE the carry sweep in one settle invocation (RED — no raise to order)', () => {
  const { store, coordinator } = directHarness();
  // Wave B holds a live lease that the settle ritual for wave A must sweep.
  coordinator.settlementLease(W2, REVIEW_SESSION, {});
  const runId = 'run:e1'; const taskId = 'task:e1'; const workerId = 'worker:e1';
  registerSteering(store, runId, W1, 'research');
  seedMember(store, { runId, taskId, workerId, entries: [
    { kind: 'doubt', question: 'order me', context: null },
    { kind: 'note', text: 'n' },
  ] });
  coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  const raise = store.events().find((event) => event.kind === 'knowledge.doubt_raised');
  const revoke = store.events().find((event) => event.kind === 'run.orchestrator_lease_revoked');
  assert.ok(raise, 'the settle ritual raises its wave’s doubts (stage: no knowledge.doubt_raised event kind)');
  assert.ok(revoke, 'the settle ritual swept wave B’s stale lease');
  assert.ok(raise.seq < revoke.seq, 'elevate → raise → sweep: the raise precedes the sweep’s revocation (D5 ordering)');
});

test('E2: an elevated-but-unraised doubt is receipted by the widened carry (RED — sweep has no doubt handling)', () => {
  const { store, coordinator } = directHarness();
  const runId = 'run:e2'; const taskId = 'task:e2'; const workerId = 'worker:e2';
  registerSteering(store, runId, W1, 'research');
  seedMember(store, { runId, taskId, workerId, entries: [{ kind: 'doubt', question: 'never raised', context: null }] });
  // Direct elevation bypasses the coordinator selection — the doubt lands in shared unraised
  // (OQ4: a post-ritual direct elevation is never raised by a later ritual).
  const fence = store.scratchpadFence(runId, `worker:${workerId}`);
  const workerEntries = store.scratchpadSnapshot(runId, `worker:${workerId}`).entries;
  store.elevateTaskScratchpad({
    runId, taskId, workerId, expectedScratchpadFence: fence,
    entryIds: workerEntries.map((row) => row.entryId),
  }, auth(`scratchpad.task_settlement:${taskId}`));
  // Mint the lease for the wave (members absent — the ritual itself scans no members here).
  coordinator.settlementLease(W1, REVIEW_SESSION, {});
  store.sweepSettlementLeases(repoId, { maxLeases: 16, currentWaveId: 'wave:next' });
  const carried = store.events().find((event) => event.kind === 'knowledge.doubt_carried');
  const raise = store.events().find((event) => event.kind === 'knowledge.doubt_raised');
  assert.ok(carried, 'the sweep carries the elevated-but-unraised doubt (stage: sweepSettlementLeases has no doubt handling)');
  assert.ok(raise, 'the same sweep mints the absent raise first — the receipted contradiction (HOLE-2)');
  assert.equal(raise.payload.doubtId, carried.payload.doubtId, 'raise and carry close the SAME doubt');
  assert.equal(carried.payload.carriedBy, 'review_window_expired');
});

test('E3: the settle path never silently drops a doubt — the reap is never its tombstone (RED — the reap is)', () => {
  const { store, coordinator } = directHarness();
  const runId = 'run:e3'; const taskId = 'task:e3'; const workerId = 'worker:e3';
  registerSteering(store, runId, W1, 'research');
  seedMember(store, { runId, taskId, workerId, entries: [
    { kind: 'doubt', question: 'the only doubt', context: null },
    { kind: 'note', text: 'the only note' },
  ] });
  // The settle ritual elevates the member's partition and reaps it — elevateTaskScratchpad IS the
  // worker-scope reap (basis task_settled). At HEAD the coordinator selects only notes+plans, so
  // the doubt is disposed orchestrator_skipped and the reap deletes the whole worker scope with it
  // — gone from the worker partition, never raised, never in shared: a silent sink (HOLE-2). Under
  // the contract the doubt elevates with the note, so the reap dispositions it 'elevated' and the
  // shared record survives — the honest fate is answered / dismissed / carried, never a sink.
  coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  const stillInWorker = store.scratchpadSnapshot(runId, `worker:${workerId}`).entries.some((row) => row.kind === 'doubt');
  const sharedDoubt = store.scratchpadSnapshot(runId, 'shared').entries.some((row) => row.kind === 'doubt');
  const raised = store.events().some((event) => event.kind === 'knowledge.doubt_raised');
  assert.ok(stillInWorker || sharedDoubt || raised,
    'a settled doubt is never silently dropped — it stays in the worker partition, shared, or raised (stage: the settle ritual\'s reap dispositions the doubt orchestrator_skipped at HEAD)');
});

// ---------------------------------------------------------------------------
// F-rows — D6 the answer push
// ---------------------------------------------------------------------------

test('F1: the resolved event addresses the DOUBTING worker, never a different worker (RED — coordinator.resolveDoubt missing)', () => {
  const { store, coordinator } = directHarness();
  const runId = 'run:f1'; const taskId = 'task:f1'; const workerId = 'worker:f1';
  registerSteering(store, runId, W1, 'research');
  seedMember(store, { runId, taskId, workerId, entries: [
    { kind: 'doubt', question: 'q', context: null },
    { kind: 'note', text: 'n' },
  ] });
  const receipt = coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  const doubtId = store.events().find((event) => event.kind === 'knowledge.doubt_raised')?.payload?.doubtId ?? 'doubt:missing';
  assert.ok(coordinator.resolveDoubt, 'coordinator.resolveDoubt-missing');
  coordinator.resolveDoubt(receipt.runId, doubtId, 'answered', REVIEW_SESSION, { resolution: 'the answer rides the #79 lane' });
  const resolved = store.events().find((event) => event.kind === 'knowledge.doubt_resolved' && event.payload?.doubtId === doubtId);
  assert.ok(resolved, 'the answer mints knowledge.doubt_resolved');
  // The #79 coordinates: worker-addressed by identity, durable id doubt_answer:<doubtId> (D6).
  assert.equal(resolved.payload.workerId, workerId, 'the push addresses the DOUBTING worker, never the settlement worker or another member');
  assert.equal(resolved.payload.doubtId, doubtId);
  assert.equal(resolved.payload.pushRequested, true);
  assert.equal(resolved.payload.resolution, 'the answer rides the #79 lane');
  assert.ok(Buffer.byteLength(resolved.payload.resolution) <= (FRAME_LIMITS['doubt.resolution.bytes']?.value ?? 4096),
    'the resolution is bounded by doubt.resolution.bytes');
});

// ---------------------------------------------------------------------------
// K-rows — refusal vocabulary
// ---------------------------------------------------------------------------

test('K1: the promote_doubt and doubts registry rows land with the pinned shape (RED — rows missing)', () => {
  const rows = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations;
  const promote = rows.find((entry) => entry.key === 'knowledge.promote_doubt');
  assert.ok(promote, 'knowledge.promote_doubt registry row exists (stage: rows missing)');
  assert.equal(promote.profile, 'kernel');
  assert.deepEqual([...(promote.surfaces ?? [])].sort(), ['embedded'], 'embedded-only — distinct from knowledge.promote');
  assert.equal(promote.liveMethod, 'resolveDoubt', 'the registry names the gate');
  assert.deepEqual([...(promote.authorityFields ?? [])].sort(), ['disposition', 'doubtId', 'runId'], 'authorityFields (ACTUAL sorted order)');
  assert.deepEqual([...(promote.serverDerived ?? [])].sort(), ['actor', 'principalId', 'sessionId'], 'the lease is never a caller field (HOLE-3)');
  const read = rows.find((entry) => entry.key === 'knowledge.doubts');
  assert.ok(read, 'knowledge.doubts registry row exists');
  assert.equal(read.liveMethod, 'resolveDoubt', 'the read shares the resolve authority seam');
});

test('K2: the 9-code refusal family is surface-constant in ACTUAL sorted order (RED — coordinatorNs.DOUBT_REFUSAL_CODES missing)', () => {
  assert.ok(coordinatorNs.DOUBT_REFUSAL_CODES, 'the frozen DOUBT_REFUSAL_CODES export exists (stage: the refusal family is absent)');
  assert.ok(Object.isFrozen(coordinatorNs.DOUBT_REFUSAL_CODES), 'the family is frozen — typed, never mutable');
  assert.deepEqual([...coordinatorNs.DOUBT_REFUSAL_CODES], DOUBT_REFUSAL_CODES_EXPECTED, 'the exact 9 codes in ACTUAL sorted order');
});

test('K3: the refusal family fires typed in each named scenario (RED — coordinator.resolveDoubt missing)', () => {
  const { store, coordinator } = directHarness();
  const runId = 'run:k3'; const taskId = 'task:k3'; const workerId = 'worker:k3';
  registerSteering(store, runId, W1, 'research');
  seedMember(store, { runId, taskId, workerId, entries: [
    { kind: 'doubt', question: 'q', context: null },
    { kind: 'note', text: 'n' },
  ] });
  const receipt = coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  const doubtId = store.events().find((event) => event.kind === 'knowledge.doubt_raised')?.payload?.doubtId ?? 'doubt:missing';
  assert.ok(coordinator.resolveDoubt, 'coordinator.resolveDoubt-missing');
  // doubt_promote_invalid — answered without a bounded resolution.
  assert.equal(refusalCode(() => coordinator.resolveDoubt(receipt.runId, doubtId, 'answered', REVIEW_SESSION, {})),
    'doubt_promote_invalid', 'answered without resolution refuses doubt_promote_invalid');
  // doubt_dismissal_invalid — dismissalReason outside the closed enum.
  assert.equal(refusalCode(() => coordinator.resolveDoubt(receipt.runId, doubtId, 'dismissed', REVIEW_SESSION, { dismissalReason: 'because_i_said' })),
    'doubt_dismissal_invalid', 'an open-ended dismissal reason refuses doubt_dismissal_invalid');
  // doubt_promote_unknown — a doubtId that is not a raised record.
  assert.equal(refusalCode(() => coordinator.resolveDoubt(receipt.runId, `doubt:${'f'.repeat(64)}`, 'answered', REVIEW_SESSION, { resolution: 'x' })),
    'doubt_promote_unknown', 'an unknown doubtId refuses doubt_promote_unknown');
  // doubt_resolution_exceeded — the resolution exceeds the doubt.resolution.bytes row (4096);
  // the doubt is still reviewed (the refusal transitions nothing), so the state guard cannot preempt.
  const oversized = 'r'.repeat(4097);
  assert.equal(refusalCode(() => coordinator.resolveDoubt(receipt.runId, doubtId, 'answered', REVIEW_SESSION, { resolution: oversized })),
    'doubt_resolution_exceeded', 'an over-bound resolution refuses doubt_resolution_exceeded');
  // doubt_promote_stale — the doubt is no longer in state reviewed (already resolved).
  coordinator.resolveDoubt(receipt.runId, doubtId, 'answered', REVIEW_SESSION, { resolution: 'first answer' });
  assert.equal(refusalCode(() => coordinator.resolveDoubt(receipt.runId, doubtId, 'answered', REVIEW_SESSION, { resolution: 'second answer' })),
    'doubt_promote_stale', 'a second resolve on the same doubt refuses doubt_promote_stale');
  // The lease family fires verbatim (M3 — one code per condition); the state guard is never the
  // code for an expired/foreign review window.
  assert.equal(refusalCode(() => coordinator.resolveDoubt(receipt.runId, doubtId, 'answered', FOREIGN_SESSION, { resolution: 'x' })),
    'run_orchestrator_session_mismatch', 'a foreign session fires the lease code verbatim, never doubt_promote_stale');
});

// ---------------------------------------------------------------------------
// G-rows — structural pins (green today, must stay green)
// ---------------------------------------------------------------------------

test('G1: board candidacy stays note-only — a doubt never posts a board item (PIN)', () => {
  const { store, coordinator } = directHarness();
  const runId = 'run:g1'; const taskId = 'task:g1'; const workerId = 'worker:g1';
  registerSteering(store, runId, W1, 'research');
  seedMember(store, { runId, taskId, workerId, entries: [
    { kind: 'doubt', question: 'never a candidate', context: null },
    { kind: 'note', text: 'the only candidate' },
  ] });
  coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  assert.equal(store.boardSnapshot(`wave-settlement:${W1}`).items.length, 1, 'only the note candidacies');
  const posts = store.events().filter((event) => event.kind === 'board.item_posted' && event.payload?.board === `wave-settlement:${W1}`);
  assert.equal(posts.length, 1, 'one candidacy post');
  assert.ok(posts[0].idempotencyKey.includes('scratchpad-entry:'), 'the candidacy key is the note’s shared entry, never a doubtId');
});

test('G2: an open doubt is visible on the worker scratchpad projection (PIN — OQ3 split)', () => {
  const { store } = directHarness();
  const runId = 'run:g2'; const taskId = 'task:g2'; const workerId = 'worker:g2';
  seedMember(store, { runId, taskId, workerId, entries: [{ kind: 'doubt', question: 'pre-raise open doubt', context: 'ctx' }] });
  const workerScope = `worker:${workerId}`;
  const row = store.scratchpadSnapshot(runId, workerScope).entries.find((entry) => entry.kind === 'doubt');
  assert.ok(row, 'the open doubt lives in the worker partition before any raise');
  assert.equal(row.content?.question, 'pre-raise open doubt', 'the doubt is visible via the scratchpad projection (the wave driver already sees it)');
});

test('G3: the sweep still retires note-candidacy board items and cancels settlement tasks (PIN)', () => {
  const { store, coordinator } = directHarness();
  const runId = 'run:g3'; const taskId = 'task:g3'; const workerId = 'worker:g3';
  registerSteering(store, runId, W1, 'research');
  seedMember(store, { runId, taskId, workerId, entries: [{ kind: 'note', text: 'candidate note' }] });
  coordinator.settlementLease(W1, REVIEW_SESSION, { members: [runId] });
  const board = store.boardSnapshot(`wave-settlement:${W1}`);
  assert.equal(board.items.length, 1, 'the note candidacy posts');
  const swept = store.sweepSettlementLeases(repoId, { maxLeases: 16, currentWaveId: 'wave:next' });
  assert.ok(swept.revoked.length >= 1, 'the sweep revokes the stale settlement lease');
  const task = store.task(`settlement-task:${W1}`);
  assert.equal(task?.status, 'cancelled', 'the swept settlement task is cancelled');
});

test('G4: no localeCompare anywhere in impl/src (PIN — the comparator family is canonical byte order)', () => {
  const src = join(import.meta.dirname, '..', 'src');
  const names = ['coordination-store.mjs', 'coordinator.mjs', 'application.mjs', 'limits.mjs', 'application-semantics.mjs'];
  for (const name of names) {
    const source = readFileSync(join(src, name), 'utf8');
    assert.equal(source.includes('localeCompare'), false, `${name} never uses localeCompare`);
  }
});

// ---------------------------------------------------------------------------
// Harnesses
// ---------------------------------------------------------------------------

const W1 = 'wave:doubt-1';
const W2 = 'wave:doubt-2';

// The coordinator-direct harness: a fresh store/coordinator pair on a fixed clock, with no
// worktree `reconcile` (an injected async reconciler would leave _startupCleanupPending>0 and
// throw coordinator_cleanup_pending at the first tick — the bidirectional-v3 suite avoids this by
// draining microtasks; this suite avoids it structurally).
function directHarness() {
  const store = new CoordinationStore(dir('direct'), {
    repoId,
    clock: () => FIXED_TS,
    runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY,
  });
  const coordinator = new Coordinator({
    log: new Log(dir('log')),
    coordination: store,
    fences: new FenceTable(),
    adapters: {
      mock: {
        card: () => ({ harness: 'mock', authPosture: 'api_key', concurrencyCeiling: 1, maxContext: 100000, verbs: { spawn: 'native' }, decision: 'native', turnCompletion: 'pausable' }),
        onEvent: () => {},
      },
    },
    worktrees: {
      create: async () => ({ path: '/wt', branch: 'b', baseSha: 'sha' }),
      capture: async () => ({ sha: 'sha', baseSha: 'sha', changedPaths: [] }),
      remove: async () => {},
      createVerifyWorktree: async () => dir('verify'),
      removeVerifyWorktree: async () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' }),
    route: () => 'mock',
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
    progressNudgeWindowMs: 25,
    repoId,
  });
  return { store, coordinator };
}

// Register a member run as steering-driven (the wave driver's binding, application.mjs:4627-4641)
// so the store's elevateTaskScratchpad elevates its entries at all.
function registerSteering(store, runId, waveId, role) {
  store.recordDriver('steering.registered', { runId, driverKind: 'wave', actor: 'orchestrator', waveId, waveRole: role },
    { actor: 'orchestrator', key: `run.steering_registered:${runId}` });
}

// A completed member run whose worker partition carries the given scratchpad entries. Mirrors the
// wave driver's member lifecycle: createTask → claimTask → writeScratchpad → transitionTask
// completed (the settle ritual then elevates the note+plan, and under the contract the doubts).
function seedMember(store, { runId, taskId, workerId, entries }) {
  store.createTask({
    id: taskId, brief: { objective: `member ${runId}`, capabilities: ['code', 'test'] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'mock', modelRequested: 'mock-model',
    modelPolicy: null, effortRequested: 'low', sessionRequest: { mode: 'new' },
  }, auth(`task.created:${taskId}`));
  store.claimTask(taskId, workerId, 1, auth(`task.claimed:${taskId}`), {
    harnessRequested: 'mock', harnessResolved: 'mock@fixture',
    modelRequested: 'mock-model', modelResolved: 'mock-model', modelObserved: 'mock-model',
    effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
    routeKey: '["mock","fixture","mock-model","low"]',
  });
  for (const [i, entry] of entries.entries()) {
    store.writeScratchpad({ runId, taskId, workerId, entry },
      { actor: 'worker', principalId: workerId, key: `scratchpad.write:${runId}:${i}` });
  }
  store.transitionTask(taskId, 'completed', 2, auth(`task.completed:${taskId}`));
}

// A fresh member task for the accumulation fixtures (A3) — a distinct taskId gives the elevation's
// reap key (`scratchpad.partition_reaped:${runId}:${taskId}:${fence}`) a distinct namespace, so
// multiple elevation rounds into the same run's shared partition never collide as a re-drive.
function spawnMemberTask(store, { runId, taskId, workerId }) {
  store.createTask({
    id: taskId, brief: { objective: `accum ${taskId}`, capabilities: ['code', 'test'] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'mock', modelRequested: 'mock-model',
    modelPolicy: null, effortRequested: 'low', sessionRequest: { mode: 'new' },
  }, auth(`task.created:${taskId}`));
  store.claimTask(taskId, workerId, 1, auth(`task.claimed:${taskId}`), {
    harnessRequested: 'mock', harnessResolved: 'mock@fixture',
    modelRequested: 'mock-model', modelResolved: 'mock-model', modelObserved: 'mock-model',
    effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
    routeKey: '["mock","fixture","mock-model","low"]',
  });
}

// A scratchpad write round for the accumulation fixtures (A3) — writes `count` entries of one
// kind into a (possibly non-assignee) worker scope, then elevates that scope's entries. The
// worker partition caps at MAX_SCRATCHPAD_WORKER_ENTRIES (128), so a round never exceeds it; the
// shared partition is per-run and accumulates across rounds (no reap between rounds — elevation
// leaves the worker partition live).
function writeRound(store, { runId, taskId, workerId }, count, kind, label) {
  for (let i = 0; i < count; i += 1) {
    const entry = kind === 'doubt'
      ? { kind: 'doubt', question: `${label}-${i}`, context: null }
      : { kind: 'note', text: `${label}-${i}` };
    store.writeScratchpad({ runId, taskId, workerId, entry },
      { actor: 'worker', principalId: workerId, key: `scratchpad.write:${runId}:${label}:${i}` });
  }
}
function elevateRound(store, { runId, taskId, workerId }) {
  const fence = store.scratchpadFence(runId, `worker:${workerId}`);
  const entries = store.scratchpadSnapshot(runId, `worker:${workerId}`).entries;
  return store.elevateTaskScratchpad({
    runId, taskId, workerId, expectedScratchpadFence: fence,
    entryIds: entries.map((row) => row.entryId),
  }, auth(`scratchpad.task_settlement:${taskId}`));
}

// The application harness for the command rows (knowledge.settlement_lease, knowledge.doubts).
// The store clock is real-time anchored (the deployment's clock, never a wall-clock assertion);
// the goal-plan policy is NON-mandatory so a seeded member task needs no approved goal/plan.
const ANCHORED_STORE_CLOCK = (() => {
  const base = Date.parse('2026-08-01T06:00:00.000Z');
  const start = Date.now();
  return () => base + (Date.now() - start);
})();

function root(label) {
  const d = dir(label);
  execFileSync('git', ['init', '-q'], { cwd: d });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: d });
  return d;
}

function appHarness(t) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    now: ANCHORED_STORE_CLOCK,
    adapters: { mock: new MockAdapter({ scenario: { outcome: 'completed' } }) },
    stopDeadlineMs: 2_000,
    approvalTimeoutMs: 3_000,
    runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY,
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1, repoId, mandatory: false, approvalTtlMs: 60_000,
        riskClasses: ['low', 'medium', 'high', 'critical'],
        effectClasses: ['provider_call', 'repository_edit'],
        capabilityClasses: ['code', 'test'],
        limits: {
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 16, maxDepsPerNode: 16,
          maxTextBytes: 16_384, maxItems: 128, maxScopePaths: 128, maxRouteValues: 64,
          maxGoalBytes: 256 * 1024, maxPlanBytes: 512 * 1024, maxStatusBytes: 1024 * 1024,
          maxTokens: 100_000_000, maxUsd: 1_000, maxWallMin: 480, maxProviderTurns: 2_048,
        },
      }),
      authorize: async () => true,
    },
  });
  const application = new BatonApplication({
    driver,
    repoId,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1, repoId, definitionOfDone: ['deployment verification passes'],
        constraints: [], risk: 'low',
        goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
        pathScope: ['**'],
        verification: {
          command: 'true', arguments: [], cwd: '.', envAllowlist: [],
          expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536,
          requiredPredecessorEvidence: [],
        },
        routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
        capabilities: ['code', 'test'],
        effects: ['provider_call', 'repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      }),
    },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principal('wave-owner'));
  t.after(async () => {
    await driver.closeAuthority?.();
    await driver.coordination?.releaseWriterLease?.();
  });
  return { application, baton, driver, store: driver.coordination };
}
