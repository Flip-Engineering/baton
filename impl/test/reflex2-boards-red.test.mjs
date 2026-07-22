// REFLEX-2 orchestrator-controlled task boards — red suite
// (docs/reference/evidence/reflex-wave-live-2026-07-21/reflex2-boards-decisions.md, issue #17,
// docs/32 §3.2). The binding contract resolves the red-team findings F8/F9/F10:
//   F8 — immutable items + successor versions with claim migration keyed to itemId; claims gain
//        the scratch death lifecycle so an item never wedges in `claimed`.
//   F9 — a NEW board-scoped, replay-derivable fence counter (NEVER FenceTable, NEVER the worker
//        turn fence — the claimScratch trap); claim CAS at expectedBoardFence.
//   F10 — non-evented reads (no `board.read` event kind) with cached per-worker projections keyed
//        by (board, workerId, boardFence), MAX_BOARD_VIEW_BYTES/MAX_BOARD_ITEMS bounds, and
//        boundedAttentionText/SECRET_SHAPED_TEXT sanitization with untrusted-prose provenance.
//
// Low-level ledger mechanics are exercised directly against CoordinationStore (mirroring
// test/phase11-coordination-store.test.mjs's documented "construct a store directly" harness).
// Worker-death claim expiry is exercised through the real createDriver terminal hook, and the
// bounded/sanitized projection through application.mjs's exported projectBoardView.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationRefusal, CoordinationStore, coordinationForLog } from '../src/coordination-store.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { createDriver, MockAdapter } from '../src/index.mjs';
import {
  ValidationError, createBoardClaimRequest, createBoardItem, createBoardReport,
} from '../src/messages.mjs';
import { projectBoardView } from '../src/application.mjs';

const dirs = [];
function dir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-reflex2-'));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

async function until(fn, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition not met');
}

const auth = (key, actor = 'orchestrator') => ({ actor, key });

function freshStore() { return new CoordinationStore(dir()); }

/** A minimal Adapter conforming to the coordinator D1 contract; a spawned worker parks at
 * `working` and stays there (no auto-completion), which is all the fence/claim tests need. */
class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: Infinity,
      maxContext: 100000, verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' }, decision: 'native',
    };
    this._cb = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._cb = cb; }
  emit(event) { if (this._cb) this._cb(event); }
  async spawn() { return { ok: true }; }
  async prompt() { return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
  async kill() { return { ok: true }; }
}

function lightweightCoordinator() {
  const d = dir();
  const log = new Log(join(d, 'log'));
  const coordination = coordinationForLog(log);
  const fences = new FenceTable();
  const coordinator = new Coordinator({
    log, coordination, fences, adapters: { mock: new ScriptableAdapter() },
    worktrees: {
      create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
      capture: async () => ({ sha: 'sha-result' }), createVerifyWorktree: async () => ({ path: tmpdir() }),
      removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' }),
    route: () => 'mock', approvalTimeoutMs: 60000, stopDeadlineMs: 15000,
  });
  return { coordinator, coordination, fences };
}

function brief(overrides = {}) {
  return {
    goal: 'g', constraints: [], pathScope: ['.'], definitionOfDone: 'd',
    verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1000, usd: 1, wallMin: 1 }, ...overrides,
  };
}

// ============================================================
// Part C shapes — messages.mjs closed-shape refusals
// ============================================================

test('createBoardItem refuses an unknown field, a bad board id, and an empty/oversized title', () => {
  assert.throws(() => createBoardItem({ board: 'shared', title: 'ok', bogus: 1 }), ValidationError);
  assert.throws(() => createBoardItem({ board: 'has spaces', title: 'ok' }), ValidationError);
  assert.throws(() => createBoardItem({ board: 'shared', title: '' }), ValidationError);
  assert.throws(() => createBoardItem({ board: 'shared', title: 'x'.repeat(161) }), ValidationError);
});

test('createBoardItem refuses oversized detail, too many/invalid evidence, and a bad owner', () => {
  assert.throws(() => createBoardItem({ board: 'shared', title: 'ok', detail: 'x'.repeat(4097) }), ValidationError);
  const nine = Array.from({ length: 9 }, (_, i) => ({ coordinationSeq: i + 1 }));
  assert.throws(() => createBoardItem({ board: 'shared', title: 'ok', evidence: nine }), ValidationError);
  assert.throws(() => createBoardItem({ board: 'shared', title: 'ok', evidence: [{ nope: 1 }] }), ValidationError);
  assert.throws(() => createBoardItem({ board: 'shared', title: 'ok', owner: 'bad owner' }), ValidationError);
});

test('createBoardItem accepts a valid item and normalizes detail:null/owner:null/evidence:[]', () => {
  const item = createBoardItem({ board: 'shared', title: 'Do X' });
  assert.deepEqual(item, { board: 'shared', title: 'Do X', detail: null, owner: null, evidence: [] });
  assert.ok(Object.isFrozen(item));
  const rich = createBoardItem({ board: 'shared', title: 'Do X', detail: 'why', owner: 'w1', evidence: [{ coordinationSeq: 3 }] });
  assert.deepEqual(rich.evidence, [{ coordinationSeq: 3 }]);
});

test('createBoardClaimRequest refuses a missing/negative expectedBoardFence and a bad itemId', () => {
  assert.throws(() => createBoardClaimRequest({ itemId: 'board-item:abc' }), ValidationError);
  assert.throws(() => createBoardClaimRequest({ itemId: 'board-item:abc', expectedBoardFence: -1 }), ValidationError);
  assert.throws(() => createBoardClaimRequest({ itemId: 'has spaces', expectedBoardFence: 0 }), ValidationError);
  assert.throws(() => createBoardClaimRequest({ itemId: 'board-item:abc', expectedBoardFence: 1, extra: 1 }), ValidationError);
  assert.doesNotThrow(() => createBoardClaimRequest({ itemId: 'board-item:abc', expectedBoardFence: 0 }));
});

test('createBoardReport requires itemId, a positive itemVersion, a 64-hex itemDigest, and a bounded body', () => {
  const ok = { itemId: 'board-item:abc', itemVersion: 1, itemDigest: 'a'.repeat(64), body: 'done' };
  assert.doesNotThrow(() => createBoardReport(ok));
  assert.throws(() => createBoardReport({ ...ok, itemVersion: 0 }), ValidationError);
  assert.throws(() => createBoardReport({ ...ok, itemDigest: 'nothex' }), ValidationError);
  assert.throws(() => createBoardReport({ ...ok, body: '' }), ValidationError);
  assert.throws(() => createBoardReport({ ...ok, body: 'x'.repeat(4097) }), ValidationError);
  assert.throws(() => createBoardReport({ ...ok, bogus: 1 }), ValidationError);
});

// ============================================================
// F8 — item identity & claim lifecycle (immutable versioned items)
// ============================================================

test('F8: retitle mints a successor itemVersion under a stable itemId; the prior version is retained', () => {
  const s = freshStore();
  const posted = s.postBoardItem({ board: 'shared', title: 'Do X', owner: 'w1' }, auth('post1'));
  const itemId = posted.item.itemId;
  assert.equal(posted.item.itemVersion, 1);

  const retitled = s.retitleBoardItem(itemId, { title: 'Do X (edited)' }, auth('retitle1'));
  assert.equal(retitled.item.itemId, itemId, 'itemId is the stable lineage key, never reminted');
  assert.equal(retitled.item.itemVersion, 2);
  assert.notEqual(retitled.item.itemDigest, posted.item.itemDigest, 'a new version content-addresses to a new digest');

  const history = s.boardItemVersions(itemId);
  assert.equal(history.length, 2);
  assert.equal(history[0].itemVersion, 1);
  assert.equal(history[0].title, 'Do X', 'the prior version is retained byte-exact, never relabeled in place');
  assert.equal(history[0].itemDigest, posted.item.itemDigest);
});

test('F8: a submitted itemDigest that disagrees is refused loudly (board_item_digest_mismatch), never a silent overwrite', () => {
  const s = freshStore();
  assert.throws(() => s.postBoardItem({ board: 'shared', title: 'Do X', itemDigest: '0'.repeat(64) }, auth('post-bad')),
    (e) => e instanceof CoordinationRefusal && e.code === 'board_item_digest_mismatch');
  const posted = s.postBoardItem({ board: 'shared', title: 'Do X' }, auth('post-ok'));
  assert.throws(() => s.retitleBoardItem(posted.item.itemId, { title: 'Y', itemDigest: '0'.repeat(64) }, auth('retitle-bad')),
    (e) => e instanceof CoordinationRefusal && e.code === 'board_item_digest_mismatch');
});

test('F8: an open claim survives a benign retitle via board.claim_migrated — no re-claim, no retry storm', () => {
  const s = freshStore();
  const posted = s.postBoardItem({ board: 'shared', title: 'Do X', owner: 'w1' }, auth('post1'));
  const itemId = posted.item.itemId;
  const claim = s.requestBoardClaim({ itemId, owner: 'w1', expectedBoardFence: 1 }, auth('claim1', 'worker'));
  assert.equal(claim.result, 'claimed');

  const before = s.events().length;
  const retitled = s.retitleBoardItem(itemId, { title: 'Do X (edited)' }, auth('retitle1'));
  assert.equal(retitled.migrated, true, 'a held claim is carried forward, not invalidated');
  const migratedEvents = s.events().slice(before).map((e) => e.kind);
  assert.ok(migratedEvents.includes('board.item_retitled'));
  assert.ok(migratedEvents.includes('board.claim_migrated'));

  const carried = s.activeBoardClaims({ workerId: 'w1' });
  assert.equal(carried.length, 1, 'the claim is keyed to itemId, still active after the edit');
  assert.equal(carried[0].itemId, itemId);
  assert.equal(carried[0].owner, 'w1');
  assert.equal(carried[0].itemVersion, 2, 'the migrated claim advances to the successor version');
  assert.equal(carried[0].boardFence, s.boardFence('shared'), 'migration advances the stored fence with the item');
  assert.equal(carried[0].version, 1, 'migration is not an expiry — the claim version does not bump');
});

test('F8: a report binds the EXACT observed (itemVersion, itemDigest); a later retitle never re-points it, and a wrong digest is refused', () => {
  const s = freshStore();
  const posted = s.postBoardItem({ board: 'shared', title: 'Do X', owner: 'w1' }, auth('post1'));
  const itemId = posted.item.itemId;
  const observedDigest = posted.item.itemDigest;

  // The orchestrator retitles AFTER the worker observed v1.
  s.retitleBoardItem(itemId, { title: 'Do X (edited)' }, auth('retitle1'));

  const report = s.submitBoardReport({ itemId, itemVersion: 1, itemDigest: observedDigest, owner: 'w1', body: 'did the thing' }, auth('rep1', 'worker'));
  assert.equal(report.result, 'submitted');
  assert.equal(report.report.itemVersion, 1, 'the report binds the exact version the worker observed, not the current one');
  assert.equal(report.report.itemDigest, observedDigest);

  assert.throws(() => s.submitBoardReport({ itemId, itemVersion: 1, itemDigest: '0'.repeat(64), owner: 'w1', body: 'x' }, auth('rep-bad', 'worker')),
    (e) => e instanceof CoordinationRefusal && e.code === 'board_report_binding_mismatch');
});

test('F8: a worker death expires its board claims through the terminal hook and returns the item to open (never wedges in claimed)', async () => {
  const repo = dir();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'baton-test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Baton Test'], { cwd: repo });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'base'], { cwd: repo });
  const driver = createDriver({
    repoRoot: repo, logDir: dir(), stopDeadlineMs: 1000,
    adapters: { mock: new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'slow.txt', content: 'x', delayMs: 5000 }] } }) },
    watchdog: { stallMs: 0 },
  });
  const handle = await driver.coordinator.spawn('mock', brief({ pathScope: ['slow.txt'] }), { taskId: 'board-death' });
  await until(() => driver.coordinator.list()[0]?.status === 'working');

  const posted = driver.coordinator.postBoardItem({ board: 'shared', title: 'Do the slow thing', owner: handle.id }, { idempotencyKey: 'post-death' });
  const itemId = posted.item.itemId;
  const claim = driver.coordinator.requestBoardClaim(handle.id, { itemId, expectedBoardFence: driver.coordinator.boardFence('shared') }, { idempotencyKey: 'claim-death' });
  assert.equal(claim.result, 'claimed');
  assert.equal(driver.coordination.activeBoardClaims({ workerId: handle.id }).length, 1);

  const stopped = await driver.coordinator.kill(handle.id, 'human');
  assert.equal(stopped.result, 'confirmed');

  assert.equal(driver.coordination.activeBoardClaims({ workerId: handle.id }).length, 0, 'the dead worker\'s board claim is reaped');
  assert.equal(driver.coordination.boardItem(itemId).state, 'open', 'the item returns to open, never a phantom done and never wedged in claimed');
  assert.equal(driver.coordination.boardSnapshot('shared').claims.length, 0);
});

// ============================================================
// F9 — the board fence is board-scoped and replay-derivable
// ============================================================

test('F9: a worker turn-fence bump (nudge/steer) does NOT invalidate that worker\'s board claim (never the FenceTable)', async () => {
  const { coordinator, coordination, fences } = lightweightCoordinator();
  const handle = await coordinator.spawn('mock', brief());
  await until(() => coordinator.list()[0]?.status === 'working');

  const posted = coordinator.postBoardItem({ board: 'shared', title: 'Do X', owner: handle.id }, { idempotencyKey: 'post1' });
  const claim = coordinator.requestBoardClaim(handle.id, { itemId: posted.item.itemId, expectedBoardFence: 1 }, { idempotencyKey: 'claim1' });
  assert.equal(claim.result, 'claimed');

  // A routine nudge/steer bumps the worker turn fence. Under the scratch trap this would
  // invalidate in-flight claims; boards MUST be decoupled from it.
  fences.bumpTurn(handle.id);
  fences.bumpHuman(handle.id);

  assert.equal(coordination.activeBoardClaims({ workerId: handle.id }).length, 1, 'the board claim is untouched by a worker turn-fence bump');
  assert.equal(coordinator.boardFence('shared'), 1, 'the board fence is unmoved by any worker fence change');
  // A subsequent claim still CASes against the unchanged BOARD fence.
  const another = coordinator.postBoardItem({ board: 'shared', title: 'Do Y', owner: handle.id }, { idempotencyKey: 'post2' });
  const second = coordinator.requestBoardClaim(handle.id, { itemId: another.item.itemId, expectedBoardFence: 2 }, { idempotencyKey: 'claim2' });
  assert.equal(second.result, 'claimed');
});

test('F9: the board fence advances only on the five authority events, and never on claim/report/migrate/expire traffic', () => {
  const s = freshStore();
  assert.equal(s.boardFence('shared'), 0);
  const a = s.postBoardItem({ board: 'shared', title: 'A', owner: 'w1' }, auth('p1'));
  assert.equal(s.boardFence('shared'), 1, 'item_posted advances');
  s.postBoardItem({ board: 'shared', title: 'B', owner: 'w2' }, auth('p2'));
  assert.equal(s.boardFence('shared'), 2);

  // Worker traffic must NOT bump the board fence — N workers reporting never livelock each other.
  s.requestBoardClaim({ itemId: a.item.itemId, owner: 'w1', expectedBoardFence: 2 }, auth('c1', 'worker'));
  s.submitBoardReport({ itemId: a.item.itemId, itemVersion: 1, itemDigest: a.item.itemDigest, owner: 'w1', body: 'note' }, auth('r1', 'worker'));
  assert.equal(s.boardFence('shared'), 2, 'claim_requested and report_submitted do not bump the fence');

  s.retitleBoardItem(a.item.itemId, { title: 'A2' }, auth('rt1')); // + a hub-applied claim_migrated
  assert.equal(s.boardFence('shared'), 3, 'only the authority transition bumped; the migration did not');

  s.closeBoardItem(a.item.itemId, auth('cl1'));
  assert.equal(s.boardFence('shared'), 4, 'item_closed advanced the fence');
  // A drop on an already-closed item is refused and never touches the fence.
  assert.throws(() => s.dropBoardItem(a.item.itemId, auth('dr1')),
    (e) => e instanceof CoordinationRefusal && e.code === 'board_item_not_open');
  assert.equal(s.boardFence('shared'), 4, 'the refused drop-on-closed did not advance the fence');
});

test('F9: the board fence replays to the same value by re-counting, and worker traffic never changes it', () => {
  const root = dir();
  const s = new CoordinationStore(root);
  const a = s.postBoardItem({ board: 'shared', title: 'A', owner: 'w1' }, auth('p1'));
  s.postBoardItem({ board: 'shared', title: 'B', owner: 'w2' }, auth('p2'));
  s.requestBoardClaim({ itemId: a.item.itemId, owner: 'w1', expectedBoardFence: 2 }, auth('c1', 'worker'));
  s.retitleBoardItem(a.item.itemId, { title: 'A2' }, auth('rt1'));
  const expected = s.boardFence('shared');
  assert.equal(expected, 3);

  // Reconstruct a fresh store over the SAME durable ledger — the fence is derived, not stored.
  const replayed = new CoordinationStore(root);
  assert.equal(replayed.boardFence('shared'), expected, 'replay reconstructs the board fence exactly by re-counting authority events');
  assert.equal(replayed.activeBoardClaims({ workerId: 'w1' })[0].itemVersion, 2, 'the migrated claim replays identically');
});

test('F9: claim CAS — a stale expectedBoardFence is rejected while a current one wins exactly-once (first claim wins)', () => {
  const s = freshStore();
  const a = s.postBoardItem({ board: 'shared', title: 'A', owner: 'w1' }, auth('p1'));
  s.postBoardItem({ board: 'shared', title: 'B', owner: 'w2' }, auth('p2')); // advances fence to 2

  const stale = s.requestBoardClaim({ itemId: a.item.itemId, owner: 'w1', expectedBoardFence: 1 }, auth('c-stale', 'worker'));
  assert.equal(stale.result, 'stale_board_fence');
  assert.equal(stale.boardFence, 2, 'the current board fence is echoed for a cheap re-read (no ledger write)');

  const won = s.requestBoardClaim({ itemId: a.item.itemId, owner: 'w1', expectedBoardFence: 2 }, auth('c-win', 'worker'));
  assert.equal(won.result, 'claimed');
  const contender = s.requestBoardClaim({ itemId: a.item.itemId, owner: 'w2', expectedBoardFence: 2 }, auth('c-conflict', 'worker'));
  assert.equal(contender.result, 'conflict', 'exactly-once: the first claim wins, a concurrent one conflicts');
  assert.equal(contender.conflict.owner, 'w1');
});

// ============================================================
// F10 — read cost: non-evented reads + cached, bounded, sanitized projection
// ============================================================

test('F10: a board poll appends no ledger event, and no board.read event kind exists', () => {
  const s = freshStore();
  s.postBoardItem({ board: 'shared', title: 'A', owner: 'w1' }, auth('p1'));
  const before = s.events().length;
  for (let i = 0; i < 5; i += 1) s.boardSnapshot('shared');
  assert.equal(s.events().length, before, 'a board poll never appends to the replay-critical ledger');
  assert.equal(s.events().some((e) => e.kind === 'board.read'), false, 'there is no board.read event kind');
});

test('F10: the projection is served from cache while the board fence is unchanged and recomputed only on advance', () => {
  const s = freshStore();
  s.postBoardItem({ board: 'shared', title: 'A', owner: 'w1' }, auth('p1'));
  const cache = new Map();
  const viewer = { role: 'orchestrator' };

  const first = projectBoardView(s.boardSnapshot('shared'), viewer, cache);
  const cached = projectBoardView(s.boardSnapshot('shared'), viewer, cache);
  assert.equal(first, cached, 'the exact cached projection is served while the board fence is unchanged');

  s.postBoardItem({ board: 'shared', title: 'B', owner: 'w2' }, auth('p2')); // advances the board fence
  const recomputed = projectBoardView(s.boardSnapshot('shared'), viewer, cache);
  assert.notEqual(recomputed, first, 'a fence advance is the only thing that recomputes the projection');
  assert.equal(recomputed.boardFence, 2);
});

test('F10: the projection honors MAX_BOARD_ITEMS with an explicit boardViewTruncated story (never silent)', () => {
  const items = Array.from({ length: 600 }, (_, i) => ({
    itemId: `i${i}`, itemVersion: 1, board: 'shared', title: `t${i}`, detail: null,
    state: 'open', owner: 'w1', ordinal: i + 1, itemDigest: 'a'.repeat(64),
  }));
  const snapshot = { board: 'shared', boardFence: 1, items, claims: [], reports: [] };
  const view = projectBoardView(snapshot, { role: 'orchestrator' });
  assert.ok(view.items.length <= 512, 'the item count is bounded by MAX_BOARD_ITEMS');
  assert.equal(view.boardViewTruncated, true, 'truncation is surfaced explicitly, never silently');
});

test('F10: a per-worker slice excludes items the worker cannot see (owned items + own board only)', () => {
  const snapshot = {
    board: 'shared', boardFence: 1,
    items: [
      { itemId: 'i1', itemVersion: 1, board: 'shared', title: 'mine', detail: null, state: 'open', owner: 'w1', ordinal: 1, itemDigest: 'a'.repeat(64) },
      { itemId: 'i2', itemVersion: 1, board: 'shared', title: 'theirs', detail: null, state: 'open', owner: 'w2', ordinal: 2, itemDigest: 'b'.repeat(64) },
    ],
    claims: [], reports: [],
  };
  const w1 = projectBoardView(snapshot, { role: 'worker', workerId: 'w1' });
  assert.deepEqual(w1.items.map((i) => i.itemId), ['i1'], 'a worker sees only the shared items it owns');
  const orch = projectBoardView(snapshot, { role: 'orchestrator' });
  assert.deepEqual(orch.items.map((i) => i.itemId), ['i1', 'i2'], 'the orchestrator sees all items');
});

test('F14: title/detail/report bodies are sanitized and provenance-marked as untrusted prose (never hub-styled)', () => {
  const snapshot = {
    board: 'shared', boardFence: 1,
    items: [{
      itemId: 'i1', itemVersion: 1, board: 'shared',
      title: 'api_key: ABCDEFGHIJKL0123456789', detail: 'ordinary detail',
      state: 'open', owner: 'w1', ordinal: 1, itemDigest: 'a'.repeat(64),
    }],
    claims: [],
    reports: [{ itemId: 'i1', itemVersion: 1, itemDigest: 'a'.repeat(64), owner: 'w1', body: 'my report body' }],
  };
  const view = projectBoardView(snapshot, { role: 'orchestrator' });
  const item = view.items[0];
  assert.equal(item.title.text, '[credential-shaped content redacted]', 'credential-shaped title text is redacted');
  assert.equal(item.title.provenance, 'model-authored');
  assert.equal(item.title.untrusted, true);
  assert.equal(item.detail.provenance, 'model-authored');
  assert.equal(item.detail.untrusted, true);
  assert.equal(item.reports[0].body.text, 'my report body');
  assert.equal(item.reports[0].body.untrusted, true, 'report bodies are worker content, marked untrusted, never hub-styled');
});
