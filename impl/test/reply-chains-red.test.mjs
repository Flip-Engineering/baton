// Epic #105 red-first suite — folded reply-chains contract v1.1, as amended by #598 F03.
// Authority: docs/reference/evidence/reply-chains-2026-08-06/
//   reply-chains-contract.md (v1.1), contract-fold.md (B-1..B-7),
//   contract-redteam.md (the attack surface), suite-105-brief.md (this suite's brief),
//   suite-blueteam.md (the blue-team verification report), suite-fold-2-brief.md.
//
// #598 F03 REMOVED the depth/budget model this suite was written against: no budget argument on
// sendMessage, no MAX_MESSAGE_DEPTH_BUDGET, no per-branch depth ceiling or per-sender reply slot,
// no depth-coded receipt/envelope/audit-row fields, no message_budget_invalid mapping, no
// approval-style lastRefusal. A reply chain is unbounded; every reply is its own message;
// messageReceipt is the honest {delivered, read, actedOn, reply, replies} (+ spill citation).
// The rows below pin what SURVIVES — the walk, membership ordering, replay, escalation routing,
// the closed scanner and command table — and the ABSENCE of the depth-coded surfaces. Rows that
// only pinned the removed mechanisms were deleted.
//
// Fixture idiom mirrors bidirectional-v3-red.test.mjs (Coordinator + coordinationForLog +
// ScriptableAdapter, the lane level) and workflow-surface-red.test.mjs (createDriver +
// BatonApplication, the facade level); the MCP fixture mirrors wave-observability-red.test.mjs
// (McpFleetServer tools/list + tools/call).
//
// NUL-byte discipline: the two NUL files are never read whole — application.mjs is touched only
// through the imported APPLICATION_COMMAND_DEFINITIONS export (H2) and the facade fixture;
// coordination-store.mjs only through the imported CoordinationStore/coordinationForLog. All other
// sources are NUL-free and read whole for the source pins (mcp-northbound.mjs F3,
// wave-driver.mjs H6). This suite file contains 0 NUL bytes.
//
// No clocks: no assertion depends on wall time; the only timestamps are the fixed NOW constant
// passed to the surfaces' clock hooks. localeCompare is never used; sorted-key literals below are
// in ACTUAL sorted order.

// ===========================================================================
// ROW INVENTORY
// ===========================================================================
//
// §A The admission model (post-F03)
//   A1  PIN — a plain send admits the reply; a duplicate reply by the same sender and a
//         reply-to-a-reply BOTH deliver (latest wins on replies, first reply kept on reply);
//         no message_depth_exceeded exists anywhere. Kills an impl that reinstates a depth
//         code or a per-sender slot refusal.
//   A2  — a 3-deep exchange lands (each hop inReplyTo-linked) and a FOURTH hop keeps landing:
//         the chain has no depth ceiling.
//
// §B The walk (B-1)
//   B1  — the chain root→r1→r2→r3 walks the lane; every receipt answers the honest closed
//         shape with NO depth/budget/remaining fields.
//   B2  — messageRunId resolves EVERY hop to the root's run (parent-target-run inheritance —
//         the reply record's target deep-equals the parent's target verbatim, T6); the
//         orchestrator reads her own chain's receipts through the facade.
//
// §C Membership (B-2)
//   C1  — a foreign worker's reply into another run's chain refuses message_target_not_member;
//         a member of the parent's run — a SIBLING worker, not the target — is admitted
//         (T1: the positive control kills a target-only membership impl).
//   C2  PIN — B-2 admission order (parent-exists BEFORE run-membership): a reply to an UNKNOWN
//         message id draws message_parent_not_found for BOTH a run-member and a foreign worker —
//         never message_target_not_member. Kills an impl that checks membership before
//         parent-exists.
//
// §E Replay (B-4)
//   E1  — reply hops are durable store-audited message.delivered rows carrying inReplyTo
//         (replay seeds); the audit rows carry NO depth-coded fields.
//   E2  — legacy alias message.sent rows are distinguishable by alias: true and the
//         <workerId>:<tail> key shape; a fresh coordinator REBUILDS the chain topology from
//         the durable rows and never mints the alias as a phantom root.

// §F Facade allowlist (D3, post-F03)
//   F3  — the stateFailureCode body in mcp-northbound.mjs knows NO message_* lane codes:
//         message_budget_invalid and message_depth_exceeded are gone with the mechanism, and
//         the worker-stream membership/parent codes never crossed the MCP surface anyway.
//
// §G Escalation (B-6)
//   G1  PIN — D8: a blocking follow-up rides the existing interaction lane (question.asked
//         blocking:true → task input_required, handle blocked); a conversational reply never
//         transitions a task phase and never mints an interaction — even a reply frame carrying a
//         machine-readable blocking marker stays prose (T4).
//   G2  — a fresh root send re-roots the conversation: replies land on the stalled chain's
//         receipts and a new root admits a fresh chain (the recovery path, no budget vocabulary).
//
// §H Facade + MCP/web (D6/D7, post-F03)
//   H1  — run.message.send carries NO budget on the outcome; run.message.receipt is the honest
//         closed shape {delivered, read, actedOn, reply, replies} with no depth-coded fields.
//   H2  PIN — RC-08/G7: the byte-stable APPLICATION_COMMAND_DEFINITIONS key set is unchanged; the
//         eight message-lane direct ports are not table keys.
//   H3  — baton_run_message_send's inputSchema carries NO budget property.
//   H6  PIN — RC-10/D9: a chain-replying worker is mid-turn working (no pending interaction, task
//         phase unmoved — waitingOn stays null); WAITING_ON_KINDS (closed five) and
//         BLOCKING_INTERACTION_KINDS (closed three) are byte-unchanged.
//   H7  PIN — RC-11: a reply frame naming budget, blocking, or priority (any extra field) drops to
//         prose — the scanner stays closed on the sorted-key literal 'body,inReplyTo' (T4).

// ===========================================================================
// REMOVED SURFACES (#598 F03 — the depth/budget vocabulary this suite once pinned)
// ===========================================================================
//
//   sendMessage budget argument  — the declared per-send depth budget (ignored, then removed)
//   messageReceipt().depth / .budget / .remaining / .lastRefusal  — the receipt is the honest
//     {delivered, read, actedOn, reply, replies} (+ spill citation)
//   reply envelope {depth, budget, remaining}  — the envelope is the closed
//     {messageId, inReplyTo, from, body} (+ spill citation)
//   message_depth_exceeded / message_budget_invalid  — both refusal codes are gone, lane and
//     mcp/web mappings alike
//   send outcome .budget  — the send outcome names no budget
//   audit-row depth fields  — message.sent/message.delivered rows carry no depth/budget/remaining
//   MAX_MESSAGE_DEPTH_BUDGET (limits.mjs)  — the export is removed
//   run.message.receipt depth-coded fields  — the facade projects the lane's honest shape
//   baton_run_message_send inputSchema budget  — the MCP schema property is removed
//   web dispatchFailure message_budget_invalid branch  — the mapping is removed

// ===========================================================================
// PIN LIST (green at HEAD AND under the correct implementation)
// ===========================================================================
//
//   A1  no depth code anywhere     — kills: an impl that reinstates message_depth_exceeded or a
//                                      per-sender reply-slot refusal
//   C2  parent-exists BEFORE membership — kills: an impl that checks run-membership before the
//                                      parent-exists check (a foreign worker replying to an
//                                      unknown message id would then see message_target_not_member)
//   G1  blocking → interaction lane  — kills: a machine-readable blocking marker on the reply
//                                      frame (violates RC-11 wire asymmetry) or a reply
//                                      transitioning a task phase
//   H2  command-table byte-stability — kills: message ports registered as APPLICATION_COMMAND_DEFINITIONS
//                                      entries (breaks the direct-port law, G7)
//   H6  closed waiting enums         — kills: a new waitingOn kind for chains or a reply routed
//                                      into BLOCKING_INTERACTION_KINDS
//   H7  wire asymmetry               — kills: the scanner accepting budget/extra fields in the
//                                      reply frame

// ===========================================================================
// CURRENT SPLIT (post-F03; run from the repo root)
// ===========================================================================
//   All rows green against the amended contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BatonApplication, APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { WAITING_ON_KINDS } from '../src/application-semantics.mjs';
import { scanForMessageSend } from '../src/claude-session.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { CoordinationStore, coordinationForLog } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import { createDriver, DEFAULT_RUN_LINEAGE_POLICY, McpFleetServer } from '../src/index.mjs';
import { Log } from '../src/log.mjs';

const NOW = Date.parse('2026-08-06T12:00:00.000Z');
const REPO = 'repo-reply-chains-105';

const dirs = [];
function tmpDir(label = 'baton-rc105-') {
  const dir = mkdtempSync(join(tmpdir(), label));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function principalOf(id) {
  return Object.freeze({ actor: `test:${id}`, principalId: id, sessionId: `session-${id}` });
}

function makeBrief(overrides = {}) {
  return {
    goal: 'read the world, then produce the deliverable',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'report written',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
    requiredEffects: [],
    ...overrides,
  };
}

// The bd3 staging adapter (workflow-surface idiom): admits spawns, records prompts, and emits only
// what the harness drives (no autonomous turns — every epoch is driven by the test's emit calls).
class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native', turnCompletion: 'pausable',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'], family: 'mock',
        acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
        serviceTier: null, provenance: 'reply-chains-105', refreshedAt: null,
      },
    };
    this.calls = { spawn: [], prompt: [], interrupt: [], approve: [], answer: [], kill: [] };
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn(worker, brief) { this.calls.spawn.push({ worker, brief }); return { ok: true }; }
  async prompt(worker, content, mode) { this.calls.prompt.push({ worker, content, mode }); return { ok: true }; }
  async interrupt(worker, then) { this.calls.interrupt.push({ worker, then }); return { ok: true }; }
  async approve(worker, requestId, decision, payload) { this.calls.approve.push({ worker, requestId, decision, payload }); return { ok: true }; }
  async answer(worker, requestId, answer) { this.calls.answer.push({ worker, requestId, answer }); return { ok: true }; }
  async kill(worker) { this.calls.kill.push({ worker }); return { ok: true }; }
}

function passingReferee() {
  return async (task) => ({
    reverified: true, observedExit: task.brief.verification.expectExit,
    matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
  });
}

// The lane-level Coordinator dependency set (bidirectional-v3 idiom): a real Coordinator over a
// coordinationForLog store, a ScriptableAdapter for emit-driven frames, a no-diff capture, and a
// fixed now (the budget is a count, never a clock — no assertion depends on wall time).
function coordinatorDeps({ adapter, log, coordination }) {
  return {
    log,
    coordination: coordination ?? coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees: {
      create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
      capture: async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] }),
      createVerifyWorktree: async () => ({ path: tmpdir() }),
      removeVerifyWorktree: async () => {},
      remove: async () => {},
      reconcile: async () => {},
    },
    referee: passingReferee(),
    route: () => 'mock',
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
    progressNudgeWindowMs: 25,
  };
}

function laneFixture({ adapter = new ScriptableAdapter() } = {}) {
  const dir = tmpDir('baton-rc105-lane-');
  const log = new Log(join(dir, 'log'));
  const coordinator = new Coordinator(coordinatorDeps({ adapter, log }));
  return { dir, log, coordinator, adapter };
}

// T2 (blue-team fold): a SECOND coordinator over a FRESH CoordinationStore on the same logDir —
// the real replay entry point is the Coordinator constructor's _replay(). The live store's writer
// lease is released first (the ledger is already authoritative; the first coordinator is read-only
// once the chain is built), so the fresh store replays the durable rows from disk and claims the
// lease on its own first write. Nothing here reads the live coordinator's _messages map.
function replayCoordinator(fx) {
  fx.coordinator._coordination.releaseWriterLease();
  const store = new CoordinationStore(join(fx.dir, 'log', 'coordination'), {
    operationalRead: (worker, seq) => fx.log.read(worker, seq).find((event) => event.seq === seq) ?? null,
  });
  return new Coordinator(coordinatorDeps({ adapter: fx.adapter, log: fx.log, coordination: store }));
}

const PROFILE = Object.freeze({
  schemaVersion: 1, repoId: REPO, definitionOfDone: ['verification passes'],
  constraints: [], risk: 'low',
  goalBudget: { tokens: 200000, usd: 20, wallMin: 120, providerTurns: 64 },
  nodeBudget: { tokens: 50000, usd: 5, wallMin: 30, providerTurns: 16 },
  pathScope: ['**'],
  verification: {
    command: 'true', arguments: [], cwd: '.', envAllowlist: [],
    expectExit: 0, expectResult: 'exit_code', timeoutMs: 30000, maxOutputBytes: 65536,
    requiredPredecessorEvidence: [],
  },
  routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

function gitRepo(label) {
  const repo = tmpDir(label);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'baton-test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Baton Test'], { cwd: repo });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'base'], { cwd: repo });
  return repo;
}

// Full application fixture (workflow-surface idiom): one real createDriver stack so the facade, the
// kernel lanes, and the durable store share state. A permissive authorize is the host policy stub.
async function facadeFixture(t, { adapter = new ScriptableAdapter() } = {}) {
  const repo = gitRepo('baton-rc105-repo-');
  const logDir = tmpDir('baton-rc105-log-');
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: adapter },
    runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY,
    stopDeadlineMs: 1000,
    watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
  });
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('rc-planner'),
      dispatcher: principalOf('rc-dispatcher'),
      observer: principalOf('rc-observer'),
    },
    authorize: async () => true,
  });
  t.after(async () => {
    try { await application.shutdown(principalOf('rc-cleanup')); } catch { /* RED failures may interrupt setup */ }
  });
  return { repo, logDir, adapter, driver, application, coordination: driver.coordination };
}

async function mcpFixture(t, fx) {
  const coordination = new CoordinationStore(join(fx.logDir, 'mcp-coord'), {
    clock: () => new Date(NOW).toISOString(),
  });
  const server = new McpFleetServer({
    coordinator: {},
    coordination,
    application: fx.application,
    surface: 'application',
    principal: {
      userId: 'mcp-op', sessionId: 'mcp-sess',
      capabilities: ['observe', 'control', 'emergency_stop'],
      repoIds: [REPO],
      expiresAt: new Date(NOW + 60_000).toISOString(),
      revoked: false,
    },
    repoIds: [REPO],
    now: () => NOW,
    maxWaitMs: 25_000,
    maxMessageBytes: 64 * 1024,
    takeToolQuota: async () => ({ ok: true }),
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
  });
  const init = await server.handle({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'rc105', version: '0' } },
  });
  assert.ok(init?.result?.protocolVersion, 'mcp initialize resolves');
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  t.after(async () => { await server.close().catch(() => {}); });
  return { server };
}

async function flush(times = 40) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}
async function facadeError(fn) {
  try { return await fn(); } catch (error) { return error; }
}

function emitReply(adapter, handle, inReplyTo, body, overrides = {}) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'message.send', actor: 'worker',
    payload: { inReplyTo, body, ...overrides },
  });
}

// Emit one reply frame and return the parent's reply envelope (null if the hop was refused).
async function replyStep(fx, handle, inReplyTo, body) {
  emitReply(fx.adapter, handle, inReplyTo, body);
  await flush();
  return fx.coordinator.messageReceipt(inReplyTo)?.reply ?? null;
}

// ===========================================================================
// §A — The admission model (post-F03)
// ===========================================================================

test('A1 PIN: a plain send admits the reply; repeat and chained replies deliver — no depth code, no slot refusal', async () => {
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:a1' });
  const root = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'status?' }, { actor: 'orchestrator' });
  const r1 = await replyStep(fx, handle, root.messageId, 'one');
  assert.ok(r1, 'a plain send admits the reply');
  assert.deepEqual(coordinator.messageReceipt(root.messageId).reply, r1, 'the reply lands on the parent receipt');
  // #598 F03: no per-sender reply slot — the same sender may reply again to the SAME parent;
  // `reply` keeps the first, `replies` holds the latest.
  emitReply(fx.adapter, handle, root.messageId, 'duplicate');
  await flush();
  const dup = coordinator.messageReceipt(root.messageId);
  assert.equal(dup.reply?.body ?? null, 'one', 'reply keeps the FIRST reply on the parent');
  assert.deepEqual(dup.replies?.map((row) => row.body), ['duplicate'], 'replies holds the sender\'s latest reply');
  // a reply to the reply also delivers — the chain has no depth ceiling, and it is never
  // misread as an unknown parent
  const r2 = await replyStep(fx, handle, r1.messageId, 'two');
  assert.ok(r2, 'a reply to the reply delivers (never message_parent_not_found, never a depth refusal)');
  const rejected = coordinator._log.read(handle.id).filter((event) => event.kind === 'message.rejected');
  assert.equal(rejected.length, 0, 'no message.rejected row exists — the depth code is gone with the mechanism');
});

test('A2: a 3-deep exchange lands; a fourth hop keeps landing — the chain has no depth ceiling', async () => {
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:a2' });
  const root = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'status?' }, { actor: 'orchestrator' });
  const r1 = await replyStep(fx, handle, root.messageId, 'one');
  assert.ok(r1, 'the first hop lands');
  const r2 = await replyStep(fx, handle, r1.messageId, 'two');
  assert.ok(r2, 'the second hop lands');
  const r3 = await replyStep(fx, handle, r2.messageId, 'three');
  assert.ok(r3, 'the third hop lands');
  assert.equal(r2.inReplyTo, r1.messageId, 'the second hop is inReplyTo-linked to the first');
  assert.equal(r3.inReplyTo, r2.messageId, 'the third hop is inReplyTo-linked to the second');
  const r4 = await replyStep(fx, handle, r3.messageId, 'four');
  assert.ok(r4, 'the fourth hop lands — no depth exhaustion exists');
  assert.deepEqual(Object.keys(r4).sort(), ['body', 'from', 'inReplyTo', 'messageId'],
    'the reply envelope is the closed {messageId, inReplyTo, from, body} shape');
});


// ===========================================================================
// §B — The walk (B-1)
// ===========================================================================

test('B1: the chain root→r1→r2→r3 walks the lane; receipts carry no depth-coded fields', async () => {
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:b1' });
  const root = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'status?' }, { actor: 'orchestrator' });
  const rootReceipt = coordinator.messageReceipt(root.messageId);
  for (const field of ['depth', 'budget', 'remaining', 'lastRefusal']) {
    assert.equal(Object.hasOwn(rootReceipt, field), false, `the receipt carries no ${field} (the honest closed shape)`);
  }
  const r1 = await replyStep(fx, handle, root.messageId, 'one');
  assert.ok(r1, 'the first hop lands');
  const r2 = await replyStep(fx, handle, r1.messageId, 'two');
  assert.ok(r2, 'the second hop lands');
  const r3 = await replyStep(fx, handle, r2.messageId, 'three');
  assert.ok(r3, 'the third hop lands');
  // walk root → r1 → r2 → r3 through the receipts
  assert.equal(coordinator.messageReceipt(root.messageId).reply?.body, 'one');
  assert.equal(coordinator.messageReceipt(r1.messageId).reply?.body, 'two');
  assert.equal(coordinator.messageReceipt(r2.messageId).reply?.body, 'three');
  assert.equal(coordinator.messageReceipt(r3.messageId).reply, null, 'the third hop has no reply yet');
});

test('B2 (RC-06 + B-1): messageRunId resolves EVERY hop to the root\'s run; the orchestrator reads her own chain\'s receipts', async (t) => {
  const fx = await facadeFixture(t);
  const coordinator = fx.driver.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:b2' });
  const wave = principalOf('wave-owner');
  const root = await coordinator.sendMessage({ kind: 'inform', to: { workerId: handle.id }, body: 'x' }, { actor: 'orchestrator' });
  emitReply(fx.adapter, handle, root.messageId, 'ack');
  await flush();
  const r1 = coordinator.messageReceipt(root.messageId).reply;
  assert.ok(r1, 'the first hop lands');
  assert.equal(coordinator.messageRunId(root.messageId), 'run:b2', 'the root resolves to the run');
  assert.equal(coordinator.messageRunId(r1.messageId), 'run:b2',
    'the first reply hop inherits the parent\'s target verbatim (B-1) so messageRunId resolves to the ROOT\'s run');
  // T6 (blue-team fold): the B-1 target-verbatim law at the record level — the reply record's
  // target deep-equals the parent's target, not a fresh {workerId: null} mint.
  // the orchestrator reads her own chain's receipts through the facade (resolve-then-authorize)
  const viaFacade = await facadeError(() => fx.application.command('run.message.receipt', { messageId: r1.messageId }, wave, null));
  assert.ok(viaFacade && viaFacade.code === undefined
    && Object.hasOwn(viaFacade, 'reply') && Object.hasOwn(viaFacade, 'replies'),
    'the facade serves the hop receipt in the honest closed shape — the chain is walkable including the orchestrator-rooted first hop');
  for (const field of ['depth', 'budget', 'remaining', 'lastRefusal']) {
    assert.equal(Object.hasOwn(viaFacade, field), false, `the facade receipt carries no ${field}`);
  }
});

// ===========================================================================
// §C — Membership (B-2)
// ===========================================================================

test('C1 (RC-12): a foreign worker\'s reply refuses message_target_not_member BEFORE the depth/slot checks', async () => {
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const memberA = await coordinator.spawn('mock', makeBrief(), { runId: 'run:c1-r' });
  const memberC = await coordinator.spawn('mock', makeBrief(), { runId: 'run:c1-r' });
  const foreignB = await coordinator.spawn('mock', makeBrief(), { runId: 'run:c1-s' });
  const root = await coordinator.sendMessage({ kind: 'inform', to: { workerId: memberA.id }, body: 'chain in run R' }, { actor: 'orchestrator' });
  // (a) the foreign worker's reply into the run-R chain refuses with the membership code
  emitReply(fx.adapter, foreignB, root.messageId, 'sneak');
  await flush();
  const foreignRejected = coordinator._log.read(foreignB.id).filter((event) => event.kind === 'message.rejected').at(-1);
  assert.equal(foreignRejected?.payload?.reason, 'message_target_not_member',
    'stage: membership-check-missing — a foreign worker\'s reply must refuse message_target_not_member (B-2); at HEAD no membership check exists and the foreign reply lands (it even fills the slot)');
  // (b) positive control (T1): a SIBLING worker of the parent's RUN — not the target — is admitted
  // by clause 2 (run-membership). At HEAD the target-only slot fills, so this hop is refused; the
  // sibling control is what kills a target-only membership impl.
  const memberReply = await replyStep(fx, memberC, root.messageId, 'sibling in the same run');
  assert.ok(memberReply && memberReply.from === memberC.id,
    'a member of the parent\'s run is admitted (T1) — the slot is a RUN resource, never a target-exclusive one');
  // (c) ordering: the membership refusal fires BEFORE the depth/slot check — a foreign reply to a
  // slot-filled parent still draws message_target_not_member, never message_depth_exceeded
  emitReply(fx.adapter, foreignB, root.messageId, 'sneak again');
  await flush();
  const orderingRejected = coordinator._log.read(foreignB.id).filter((event) => event.kind === 'message.rejected').at(-1);
  assert.equal(orderingRejected?.payload?.reason, 'message_target_not_member',
    'the membership refusal precedes the depth/slot check (admission order, D2) — never a slot consumed, never a budget hop spent by a non-member');
  // (d) the slot is never consumed by a non-member — the sibling's reply sits on the parent
  assert.equal(coordinator.messageReceipt(root.messageId).reply?.from, memberC.id,
    'the foreign reply never fills the slot — only a run-member\'s reply sits on the parent');
});

test('C2 PIN (B-2 admission order): a reply to an UNKNOWN message id draws message_parent_not_found for BOTH a run-member and a foreign worker — never message_target_not_member', async () => {
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const memberA = await coordinator.spawn('mock', makeBrief(), { runId: 'run:c2-r' });
  const foreignB = await coordinator.spawn('mock', makeBrief(), { runId: 'run:c2-s' });
  const ghost = `message:${'0'.repeat(64)}`;
  // the parent-exists check (message_parent_not_found) precedes the run-membership check (B-2
  // admission order) — BOTH a run-member and a foreign worker must see the parent code, never the
  // membership code (the membership check cannot see a run it was never admitted to).
  for (const worker of [memberA, foreignB]) {
    emitReply(fx.adapter, worker, ghost, 'reply to nowhere');
    await flush();
    const rejected = coordinator._log.read(worker.id).filter((event) => event.kind === 'message.rejected').at(-1);
    assert.equal(rejected?.payload?.reason, 'message_parent_not_found',
      'a reply to an unknown message id draws message_parent_not_found for every worker — the parent-exists check comes FIRST (B-2); never message_target_not_member');
  }
  assert.equal(coordinator.messageReceipt(ghost), null, 'no ghost message was ever minted');
});

// ===========================================================================
// §E — Replay (B-4)
// ===========================================================================

test('E1: reply hops are durable store-audited rows keyed by inReplyTo; audit rows carry no depth fields', async () => {
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:e1' });
  const root = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'status?' }, { actor: 'orchestrator' });
  const sentRow = coordinator._coordination.events().find((event) => event.kind === 'message.sent' && event.payload?.messageId === root.messageId);
  assert.ok(sentRow, 'the root send is store-audited');
  for (const field of ['depth', 'budget', 'remaining']) {
    assert.equal(Object.hasOwn(sentRow.payload, field), false, `the message.sent row carries no ${field}`);
  }
  assert.equal(sentRow.idempotencyKey, `message.sent:${root.messageId}`, 'the idempotency key is unchanged (message.sent:<id>)');
  // a reply hop is a store-audited message.delivered row WITH inReplyTo — the replay seed
  emitReply(fx.adapter, handle, root.messageId, 'ack');
  await flush();
  const replyRow = coordinator._coordination.events().find((event) => event.kind === 'message.delivered' && event.payload?.inReplyTo != null);
  assert.ok(replyRow, 'a reply hop is store-audited as a message.delivered row carrying inReplyTo (the replay seed)');
  assert.equal(replyRow.payload.inReplyTo, root.messageId, 'the reply row names its parent — a fresh coordinator rebuilds the topology from these rows');
  for (const field of ['depth', 'budget', 'remaining']) {
    assert.equal(Object.hasOwn(replyRow.payload, field), false, `the message.delivered reply row carries no ${field}`);
  }
  assert.ok(String(replyRow.idempotencyKey).startsWith('message.delivered:'), 'the reply row rides the closed message.delivered audit kind');
});

test('E2 (RC-07/B-4): legacy alias rows are distinguishable by alias: true + the <workerId>:<tail> key shape; a fresh coordinator rebuilds the chain topology and never mints the alias', async () => {
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:e2' });
  await coordinator.send(handle.id, 'legacy steer message', 'steer');
  const aliasRows = coordinator._coordination.events().filter((event) => event.kind === 'message.sent' && event.payload?.alias === true);
  assert.ok(aliasRows.length >= 1, 'the legacy alias is store-audited as a message.sent row');
  const alias = aliasRows[0];
  assert.equal(alias.payload.alias, true, 'the alias: true marker distinguishes the legacy shape (B-4)');
  assert.ok(String(alias.idempotencyKey).startsWith('message.sent:') && String(alias.idempotencyKey).includes(`:${handle.id}:`),
    'the alias row is keyed message.sent:<workerId>:<tail>, never a minted message id — the replay skips it by key shape');
  // B1 (blue-team fold): the CONTRACT-CORRECT discriminators are the alias marker and the KEY
  // SHAPE plus the ABSENT depth fields — the legacy alias row never carried depth/budget/remaining
  // (nor inReplyTo). The suite's earlier depth===0/budget===1/remaining===1 assertions on the alias
  // row contradicted B-4 and are deleted here; the alias is replay-SKIPPED, not budgeted.
  assert.equal(Object.hasOwn(alias.payload, 'inReplyTo'), false,
    'the legacy alias row carries no inReplyTo — it is not a reply hop and must never re-link as one (B-4)');
  for (const field of ['depth', 'budget', 'remaining']) {
    assert.equal(Object.hasOwn(alias.payload, field), false,
      `the legacy alias row carries no ${field} — replay skips it by the alias marker AND the absent depth fields (B-4)`);
  }
  // a real chain next to the alias: root + one reply, both durable
  const root = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'status?' }, { actor: 'orchestrator' });
  emitReply(fx.adapter, handle, root.messageId, 'ack');
  await flush();
  const r1 = coordinator.messageReceipt(root.messageId).reply;
  assert.ok(r1, 'the first hop lands');
  // T2 (blue-team fold): the REAL replay entry point is the Coordinator constructor's _replay() —
  // a SECOND coordinator over a FRESH store on the same ledger must rebuild root → r1 from the
  // durable rows (B-4), and must NOT mint the alias as a phantom root.
  const replay = replayCoordinator(fx);
  const rootReceipt = replay.messageReceipt(root.messageId);
  assert.ok(rootReceipt, 'a fresh coordinator must rebuild root → r1 from the durable rows (T2/B-4)');
  assert.equal(rootReceipt.reply?.inReplyTo, root.messageId, 'the rebuilt r1 re-links to its parent (parent.reply re-link)');
  const r1Replay = replay.messageReceipt(r1.messageId);
  assert.ok(r1Replay, 'the rebuilt r1 is resolvable by its own id');
  assert.equal(r1Replay.reply ?? null, null, 'the rebuilt r1 has no children');
  for (const field of ['depth', 'budget', 'remaining']) {
    assert.equal(Object.hasOwn(rootReceipt, field), false, `the rebuilt receipt carries no ${field}`);
  }
  assert.equal(replay._messages.has(alias.payload.messageId), false,
    'the legacy alias row is never minted as a phantom root — replay skips the <workerId>:<tail> key shape (B-4)');
});
// ===========================================================================
// §F — Facade allowlist (D3, post-F03)
// ===========================================================================

test('F3: the stateFailureCode body knows NO message_* lane codes — the budget mapping is gone', () => {
  // T5 (blue-team fold): the checks are scoped to the stateFailureCode FUNCTION BODY, not the whole
  // file — a wrong impl that adds any message_* lane code inside that body must stay red. The body
  // is the allowlist seam — the single place where a lane refusal code becomes an MCP tool error.
  const src = readFileSync(fileURLToPath(new URL('../src/mcp-northbound.mjs', import.meta.url)), 'utf8');
  const body = src.match(/function stateFailureCode\(cause\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.equal(body.includes("'message_budget_invalid'"), false,
    '#598 F03: message_budget_invalid is gone with the budget mechanism — the body must not allowlist it');
  assert.equal(body.includes("'message_depth_exceeded'"), false, 'message_depth_exceeded is a worker-stream event, never an MCP tool error');
  assert.equal(body.includes("'message_target_not_member'"), false, 'message_target_not_member is a worker-stream event, never an MCP tool error');
  assert.equal(body.includes("'message_parent_not_found'"), false, 'message_parent_not_found is a worker-stream event, never an MCP tool error');
});

// ===========================================================================
// §G — Escalation (B-6)
// ===========================================================================

test('G1 PIN (D8): a blocking follow-up rides the interaction lane; a reply chain never transitions a task phase', async () => {
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:g1' });
  const before = coordinator._tasks.get(handle.taskId).status;
  const root = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'status?', budget: 2 }, { actor: 'orchestrator' });
  emitReply(fx.adapter, handle, root.messageId, 'working on it');
  await flush();
  assert.equal(coordinator._tasks.get(handle.taskId).status, before,
    'a conversational reply never transitions the task phase (G11)');
  assert.equal(coordinator._pending.size, 0, 'a reply never mints a pending interaction');
  // T4 (blue-team fold): even a reply frame carrying a machine-readable blocking marker is STILL
  // prose — the marker on the REPLY frame never routes it into the interaction lane (RC-11 wire
  // asymmetry). At HEAD the extra field is ignored by the structured emit admission; a wrong impl
  // that phase-transitions on a blocking-marker reply dies here.
  const root2 = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'status2?', budget: 2 }, { actor: 'orchestrator' });
  emitReply(fx.adapter, handle, root2.messageId, 'still prose', { blocking: true });
  await flush();
  assert.equal(coordinator._tasks.get(handle.taskId).status, before,
    'a blocking-marker reply never transitions the task phase (T4) — the marker is a scanForMessageSend-rejected shape, never an interaction');
  assert.equal(coordinator._pending.size, 0, 'a blocking-marker reply never mints a pending interaction (T4)');
  // the SAME follow-up, raised as a blocking question, rides the existing interaction lane
  fx.adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'question.asked', actor: 'worker',
    payload: { requestId: 'g1-q', blocking: true, text: 'need input to continue' },
  });
  await flush();
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'input_required',
    'a blocking follow-up transitions the task to input_required — the interaction lane (coordinator.mjs:12614-12631), never the reply lane');
  assert.equal(coordinator._workers.get(handle.id).status, 'blocked',
    'the live handle is blocked (spawn returns a _publicHandle snapshot — read the live worker state)');
  assert.ok(coordinator._pending.has('g1-q'), 'the blocking question is pending');
});

test('G2: the stalled chain stays receipt-readable, and a fresh root send re-roots the conversation', async () => {
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:g2' });
  const root = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'status?' }, { actor: 'orchestrator' });
  emitReply(fx.adapter, handle, root.messageId, 'one');
  await flush();
  const r1 = coordinator.messageReceipt(root.messageId).reply;
  assert.ok(r1, 'the first hop lands');
  emitReply(fx.adapter, handle, r1.messageId, 'two');
  await flush();
  // the orchestrator reads the chain's state on the receipts — no worker-stream read, and no
  // lane refusal ever ends a chain (a stall is the worker's own silence, never a depth budget)
  assert.equal(coordinator.messageReceipt(r1.messageId).reply?.body ?? null, 'two',
    'the chain sits where the worker left it, receipt-readable');
  // the recovery: the orchestrator re-roots with a fresh root send — the conversation continues
  const fresh = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 're-root' }, { actor: 'orchestrator' });
  assert.ok(fresh?.ok === true, 'a fresh root send is admitted after a stall (D8 deadlock-recovery)');
  emitReply(fx.adapter, handle, fresh.messageId, 'resumed');
  await flush();
  const resumed = coordinator.messageReceipt(fresh.messageId).reply;
  assert.ok(resumed, 'the re-rooted conversation admits a fresh chain');
});

// ===========================================================================
// §H — Facade + MCP/web (D6/D7)
// ===========================================================================

test('H1: run.message.send carries no budget on the outcome; run.message.receipt is the honest closed shape', async (t) => {
  const fx = await facadeFixture(t);
  const coordinator = fx.driver.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:h1' });
  const wave = principalOf('wave-owner');
  const outcome = await facadeError(() => fx.application.command('run.message.send', { workerId: handle.id, kind: 'query', body: 'status?' }, wave, null));
  assert.ok(outcome && outcome.messageId, 'the run.message.send outcome names the minted message id');
  assert.equal(Object.hasOwn(outcome, 'budget'), false, '#598 F03: the send outcome carries no budget');
  const receipt = await facadeError(() => fx.application.command('run.message.receipt', { messageId: outcome.messageId }, wave, null));
  assert.deepEqual(Object.keys(receipt ?? {}).sort(),
    ['actedOn', 'delivered', 'messageId', 'read', 'replies', 'reply', 'schemaVersion'],
    'the facade receipt is the lane\'s honest shape plus its own envelope keys');
});

test('H2 PIN (RC-08/G7): the byte-stable command table is untouched — the eight message-lane direct ports are not table keys', () => {
  const EIGHT = ['run.message.send', 'run.message.receipt', 'run.attention.watch',
    'run.scratchpad.read', 'run.scratchpad.elevate', 'run.board.post', 'run.board.read', 'run.knowledge.seed'];
  for (const key of EIGHT) {
    assert.equal(Object.hasOwn(APPLICATION_COMMAND_DEFINITIONS, key), false,
      `${key} is a DIRECT PORT — the byte-stable APPLICATION_COMMAND_DEFINITIONS table is untouched (D6/G7); the projection law is reach, never semantics`);
  }
});

test('H3: baton_run_message_send carries no budget schema property', async (t) => {
  const fx = await facadeFixture(t);
  const { server } = await mcpFixture(t, fx);
  const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const sendTool = listed.result.tools.find((tool) => tool.name === 'baton_run_message_send');
  assert.ok(sendTool, 'the message send tool is present in the MCP enumeration');
  assert.equal(Object.hasOwn(sendTool.inputSchema?.properties ?? {}, 'budget'), false,
    '#598 F03: the budget schema property is removed — the reply chain is not budgeted');
});


test('H6 PIN (RC-10/D9): a chain-replying worker is mid-turn working — no waiting kind, no interaction; the two enums are byte-unchanged', async () => {
  // the closed five (WAITING_ON_KINDS) and the closed three (BLOCKING_INTERACTION_KINDS) are unchanged
  assert.deepEqual([...WAITING_ON_KINDS], ['capacity_ceiling', 'dispatch_pending', 'plan_approval', 'provider_stalled', 'spawning'],
    'the closed five waiting kinds are byte-unchanged (G9/D9) — no new kind for chains');
  assert.ok(Object.isFrozen(WAITING_ON_KINDS), 'WAITING_ON_KINDS stays frozen');
  const waveSrc = readFileSync(fileURLToPath(new URL('../src/wave-driver.mjs', import.meta.url)), 'utf8');
  assert.ok(waveSrc.includes("answer_decision: 'decision', answer_question: 'question', answer_approval: 'approval'"),
    'the closed three blocking-interaction kinds are byte-unchanged (wave-driver.mjs:189-191) — a message reply is not an interaction kind');
  // a worker that has replied in a chain is mid-turn working: no pending interaction, task phase unmoved
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:h6' });
  const before = coordinator._tasks.get(handle.taskId).status;
  const root = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'status?', budget: 2 }, { actor: 'orchestrator' });
  emitReply(fx.adapter, handle, root.messageId, 'mid-turn');
  await flush();
  assert.equal(coordinator._tasks.get(handle.taskId).status, before,
    'the replied worker stays mid-turn working — no blocking interaction, waitingOn stays null (D9)');
  assert.equal(coordinator._pending.size, 0, 'no blocking interaction is pending — the chain\'s state lives in the orchestrator\'s receipts');
});

test('H7 PIN (RC-11): a reply frame naming budget, blocking, or priority drops to prose — the scanner stays closed on {inReplyTo, body}', () => {
  const inReplyTo = `message:${'0'.repeat(64)}`;
  // the sorted-key literal stays 'body,inReplyTo' — any extra field is rejected
  assert.equal(scanForMessageSend(`MESSAGE_SEND: {"inReplyTo":"${inReplyTo}","body":"ack","budget":3}`), null,
    'the scanner rejects the budget-bearing frame — the closed sorted-key literal "body,inReplyTo" (claude-session.mjs:161); a worker can never set a budget (RC-11 wire asymmetry)');
  // T4 (blue-team fold): a machine-readable blocking marker on the reply frame is equally wire
  // asymmetry — the scanner must never let a reply carry blocking into the interaction lane
  assert.equal(scanForMessageSend(`MESSAGE_SEND: {"inReplyTo":"${inReplyTo}","body":"ack","blocking":true}`), null,
    'the scanner rejects the blocking-marker frame — the wire asymmetry holds for blocking too (T4/RC-11)');
  assert.equal(scanForMessageSend(`MESSAGE_SEND: {"inReplyTo":"${inReplyTo}","body":"ack","priority":1}`), null,
    'the scanner rejects the priority frame — any extra field is prose, never a reply');
  // the closed frame {inReplyTo, body} still parses
  const clean = scanForMessageSend(`MESSAGE_SEND: {"inReplyTo":"${inReplyTo}","body":"ack"}`);
  assert.ok(clean && clean.body === 'ack'
    && clean.budget === undefined && clean.blocking === undefined && clean.priority === undefined,
    'the closed frame still parses and carries nothing else');
});
