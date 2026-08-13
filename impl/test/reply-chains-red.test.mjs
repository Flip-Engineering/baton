// Epic #105 red-first suite — folded reply-chains contract v1.1.
// Authority: docs/reference/evidence/reply-chains-2026-08-06/
//   reply-chains-contract.md (v1.1 — source of truth), contract-fold.md (B-1..B-7),
//   contract-redteam.md (the attack surface), suite-105-brief.md (this suite's brief),
//   suite-blueteam.md (the blue-team verification report — the fold-2 findings T1-T6/N1-N4),
//   suite-fold-2-brief.md (the fold-2 brief that dispatched these edits).
//
// Twenty-six rows (20 red + 6 pins) over the v1.1 acceptance pins RC-01..RC-13: the budget model
// (D1 — default-1 byte-identity, declared budget rides, the depth-exhaustion payload, the
// out-of-bound refusal AT SEND, count-never-clock), the walk (B-1 — every hop resolves to the
// root's run through messageRunId under resolve-then-authorize), membership (B-2 —
// message_target_not_member BEFORE the depth/slot checks), the per-branch cap (B-3 + the MAX=8
// derivation), replay (B-4 — the row→record mapping: inReplyTo presence, parent.reply re-link,
// per-member multi-reply parents, the legacy alias row), refusal observability (B-5 — lastRefusal
// + the lane as the single budget authority), escalation (B-6 — the interaction lane vs the reply
// lane, the deadlock-recovery path), and facade + MCP/web (D6/D7 — budget fields ride the
// projection, the byte-stable table untouched, refusals surface-constant).
//
// Red-first: written against the v1.1 contract BEFORE implementation; every red row fails for its
// named stage today and goes green on the contract's implementation ONLY. Pin rows are green today
// AND under the correct implementation, but fail a plausible WRONG one (the pin list below names
// the wrong implementation each pin kills). Fixture idiom mirrors
// bidirectional-v3-red.test.mjs (Coordinator + coordinationForLog + ScriptableAdapter, the lane
// level) and workflow-surface-red.test.mjs (createDriver + BatonApplication, the facade level);
// the MCP fixture mirrors wave-observability-red.test.mjs (McpFleetServer tools/list + tools/call).
//
// NUL-byte discipline: the two NUL files are never read whole — application.mjs is touched only
// through the imported APPLICATION_COMMAND_DEFINITIONS export (H2) and the facade fixture;
// coordination-store.mjs only through the imported CoordinationStore/coordinationForLog. All other
// sources are NUL-free and read whole for the source pins (mcp-northbound.mjs F3,
// web-northbound.mjs H5, wave-driver.mjs H6). This suite file contains 0 NUL bytes.
//
// No clocks: the budget is a count, never a clock (D1); no assertion depends on wall time; the only
// timestamps are the fixed NOW constant passed to the surfaces' clock hooks. localeCompare is never
// used; sorted-key literals below are in ACTUAL sorted order.

// ===========================================================================
// ROW INVENTORY (the stage is the HEAD failure seam, named per row; the split at
// the bottom was measured against the PRE-implementation tree)
// ===========================================================================
//
// §A The budget model (D1)
//   A1  PIN — default-1 byte-identity: a plain send (no budget) admits exactly one reply; a reply
//         to that reply refuses with the depth code, never message_parent_not_found (RC-02). Kills
//         an impl whose default is not 1.
//   A2  RC-01 — a 3-deep exchange lands under a budget-3 root (each hop inReplyTo-linked); a reply
//         to the depth-3 hop refuses. (RED — stage: chain-dies-at-r1, reply-to-reply refuses at
//         depth 1 at HEAD)
//   A3  RC-03 — the depth-exhaustion refusal payload carries {depth, budget, remaining} with
//         remaining: 0. (RED — stage: exhaustion-payload-missing, payload is {depth} only)
//   A4  RC-04 — a declared budget outside [1, MAX] (0, 9) refuses AT SEND with message_budget_invalid
//         thrown by the lane. (RED — stage: send-budget-refusal-missing, the lane ignores budget)
//   A5  RC-05 — a non-integer budget (1.5, '3') refuses AT THE LANE with message_budget_invalid
//         (the lane is the single shape authority). (RED — stage: lane-shape-authority-missing)
//   A6  D1 — the budget is a COUNT: safe-integer depth/budget/remaining that move only when a hop
//         lands, no clock-like field rides the receipt. (RED — stage: budget-count-missing)
//
// §B The walk (B-1)
//   B1  RC-06 — per-hop receipts carry {depth, budget, remaining}; the reply envelope carries the
//         depth fields; the chain root→r1→r2→r3 walks the lane. (RED — stage: per-hop-depth-missing)
//   B2  RC-06 + B-1 — messageRunId resolves EVERY hop to the root's run (parent-target-run
//         inheritance — the reply record's target deep-equals the parent's target verbatim, T6);
//         the orchestrator reads her own chain's receipts through the facade. (RED — stage:
//         target-inheritance-missing, reply records mint target: {workerId: null})
//
// §C Membership (B-2)
//   C1  RC-12 — a foreign worker's reply into another run's chain refuses message_target_not_member
//         BEFORE the depth/slot checks (ordering pinned); the slot is never consumed by a
//         non-member; a member of the parent's run — a SIBLING worker, not the target — is
//         admitted (T1: the positive control is a run-member, killing a target-only membership
//         impl). (RED — stage: membership-check-missing, the foreign reply lands at HEAD)
//   C2  PIN — B-2 admission order (parent-exists BEFORE run-membership): a reply to an UNKNOWN
//         message id draws message_parent_not_found for BOTH a run-member and a foreign worker —
//         never message_target_not_member. Kills an impl that checks membership before
//         parent-exists (a foreign worker would then see the run's membership code).
//
// §D Per-branch cap (B-3)
//   D1  D1/B-3 — two sibling branches each get the full depth; the budget is a per-branch constant
//         (inherited verbatim, only remaining counts down); a branch cannot spend its sibling's
//         hops — a fresh root send re-roots with a full budget. (RED — stage:
//         per-branch-budget-missing)
//   D2  D1 — MAX_MESSAGE_DEPTH_BUDGET = 8 (closed), a safe integer and the smallest power of two
//         strictly above the 3-deep exchange; the per-frame invariant (body cap 2,048 < scanner
//         window 20,480) holds at any depth. (RED source pin — stage: max-budget-constant-missing,
//         no export at HEAD)
//
// §E Replay (B-4)
//   E1  RC-07 — reply hops are durable store-audited message.delivered rows carrying inReplyTo
//         (replay seeds); root message.sent rows carry {depth: 0, budget, remaining}; a fresh
//         coordinator can rebuild the chain topology from the rows. (RED — stage:
//         reply-row-absent / root-row-depth-missing, replies are worker-log appendAttributed only)
//   E2  RC-07/B-4 — legacy alias message.sent rows are distinguishable by alias: true, the
//         message.sent:<workerId>:<tail> key shape, NO inReplyTo, and the ABSENT depth fields
//         (B1: the earlier depth/budget/remaining assertions on the alias row contradicted B-4
//         and were deleted); a fresh coordinator REBUILDS the chain topology from the durable
//         rows and never mints the alias as a phantom root. (RED — stage:
//         replay-topology-not-rebuilt, _replay never seeds _messages at HEAD)
//
// §F Refusal observability (B-5)
//   F1  RC-13 — after a depth-exhaustion refusal, the refusing parent's receipt carries
//         lastRefusal {reason, depth, budget, remaining: 0} — at the lane and through
//         run.message.receipt. (RED — stage: lastRefusal-absent, message.rejected is stream-only)
//   F2  RC-05 — the lane is the single budget authority: the facade passes budget raw and never
//         masks the lane's code with application_message_send_invalid (B-5b). (RED — stage:
//         facade-double-gate, the closed key set rejects budget)
//   F3  D3 — message_budget_invalid is the ONE new allowlisted code in stateFailureCode; the
//         worker-stream codes (message_depth_exceeded, message_target_not_member,
//         message_parent_not_found) stay absent. (RED source pin — stage: allowlist-missing; T5 —
//         the checks are scoped to the FUNCTION BODY via /function stateFailureCode\(cause\) \{/,
//         so a wrong impl that adds the codes elsewhere in the file stays red)
//
// §G Escalation (B-6)
//   G1  PIN — D8: a blocking follow-up rides the existing interaction lane (question.asked
//         blocking:true → task input_required, handle blocked); a conversational reply never
//         transitions a task phase and never mints an interaction — even a reply frame carrying a
//         machine-readable blocking marker stays prose (T4). Kills an impl that routes blocking
//         follow-ups into the reply lane OR lets a marker on the reply frame transition a phase.
//   G2  D8/B-6 — the deadlock-recovery path is exercised: a stalled chain's exhaustion is
//         orchestrator-readable via lastRefusal, and a fresh root send re-roots the conversation
//         with a new budget. (RED — stage: lastRefusal-absent, the observation surface is missing)
//
// §H Facade + MCP/web (D6/D7)
//   H1  RC-08 — run.message.send outcome carries budget; run.message.receipt carries
//         {depth, budget, remaining}. (RED — stage: facade-budget-missing, the facade rejects the
//         budget key at HEAD)
//   H2  PIN — RC-08/G7: the byte-stable APPLICATION_COMMAND_DEFINITIONS key set is unchanged; the
//         eight message-lane direct ports are not table keys. Kills an impl that registers the
//         ports as table entries.
//   H3  RC-09 — baton_run_message_send accepts budget {integer, minimum: 1, maximum: 8, optional}.
//         (RED — stage: mcp-message-budget-missing)
//   H4  RC-09/RC-04 — an out-of-range budget on baton_run_message_send surfaces as
//         message_budget_invalid, never command_outcome_unknown / unknown_argument_field; an
//         in-range budget is ACCEPTED (N1 — the _dispatch branch at mcp-northbound.mjs:1771-1778
//         builds the closed {runId?, workerId, kind, body} shape, stripping budget, so at HEAD
//         even an in-range budget dies as unknown_argument_field). (RED — stage:
//         mcp-message-budget-missing, the schema has no budget at HEAD)
//   H5  RC-09/D3 — the web mapper (dispatchFailure) gains a message_budget_invalid branch →
//         httpStatus: 400. (RED source pin — stage: web-mapper-branch-missing, zero references)
//   H6  PIN — RC-10/D9: a chain-replying worker is mid-turn working (no pending interaction, task
//         phase unmoved — waitingOn stays null); WAITING_ON_KINDS (closed five) and
//         BLOCKING_INTERACTION_KINDS (closed three) are byte-unchanged. Kills an impl that adds a
//         waiting kind for chains or routes replies into the interaction lane.
//   H7  PIN — RC-11: a reply frame naming budget, blocking, or priority (any extra field) drops to
//         prose — the scanner stays closed on the sorted-key literal 'body,inReplyTo' (T4 — the
//         blocking/priority probes pin the wire asymmetry both ways). Kills an impl that lets a
//         worker set a budget or attach a machine-readable blocking marker to a reply frame.

// ===========================================================================
// INVENTED SURFACES (all probed through REAL surface entry points — no invented
// module is imported; the invented members below are absent from the surfaces at HEAD)
// ===========================================================================
//
//   coordinator.sendMessage({kind, to, body, budget}, auth)  — declared budget on the lane send
//     (HEAD: sendMessage destructures {kind, to, body}; budget is ignored)
//   messageReceipt().depth / .budget / .remaining / .lastRefusal  — per-message receipt fields
//     (HEAD: messageReceipt returns {delivered, read, actedOn, reply})
//   reply envelope {depth, budget, remaining}  — per-hop depth fields on the reply envelope
//     (HEAD: the envelope is closed {messageId, inReplyTo, from, body})
//   refusal payload {budget, remaining}  — additive depth-exhaustion payload (HEAD: {depth} only)
//   message.rejected reason 'message_target_not_member'  — new worker-stream membership code
//     (HEAD: no membership check; the foreign reply lands)
//   send outcome .budget  — the declared budget on the send outcome (HEAD: absent)
//   durable reply rows  — message.delivered store rows carrying inReplyTo (HEAD: replies are
//     worker-log appendAttributed only, never store-audited)
//   MAX_MESSAGE_DEPTH_BUDGET (limits.mjs)  — the closed ceiling constant (HEAD: no such export)
//   run.message.receipt {depth, budget, remaining, lastRefusal}  — depth-carrying facade receipt
//     (HEAD: the facade returns {delivered, read, actedOn, reply})
//   baton_run_message_send inputSchema budget  — MCP schema property (HEAD: absent; a budget
//     argument dies at the generic key-closure as unknown_argument_field)
//   web dispatchFailure message_budget_invalid branch → httpStatus: 400  — the web mapper branch
//     (HEAD: absent)

// ===========================================================================
// PIN LIST (green at HEAD AND under the correct implementation)
// ===========================================================================
//
//   A1  default-1 byte-identity      — kills: a default other than 1 (0 admits nothing, 2+ admits
//                                      a reply to a reply) changing today's admission decision
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
// VERIFIED SPLIT (measured against the PRE-implementation tree; run twice)
// ===========================================================================
//   PASS 6 · FAIL 20 — stable across two runs from the repo root
//   (split recorded in suite-draft-notes.md and suite-fold-2.md)

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
import * as limits from '../src/limits.mjs';
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
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: Infinity, maxContext: 100000,
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

async function laneSendCode(coordinator, args, auth = { actor: 'orchestrator' }) {
  try { await coordinator.sendMessage(args, auth); return 'resolved'; } catch (error) { return error?.code ?? 'thrown'; }
}

// ===========================================================================
// §A — The budget model (D1)
// ===========================================================================

test('A1 PIN (RC-02): default-1 byte-identity — a plain send admits exactly one reply and the reply-to-reply refuses with the depth code', async () => {
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:a1' });
  const root = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'status?' }, { actor: 'orchestrator' });
  // default budget: exactly one reply is admitted
  const r1 = await replyStep(fx, handle, root.messageId, 'one');
  assert.ok(r1, 'a plain send (no budget) admits the first reply');
  assert.deepEqual(coordinator.messageReceipt(root.messageId).reply, r1, 'the reply lands on the parent receipt');
  // a second reply to the SAME parent is refused by the slot law, never unknown-parent
  emitReply(fx.adapter, handle, root.messageId, 'duplicate');
  await flush();
  const rootRejected = coordinator._log.read(handle.id).filter((event) => event.kind === 'message.rejected').at(-1);
  assert.equal(rootRejected?.payload?.reason, 'message_depth_exceeded',
    'a duplicate reply draws the depth code (slot law), never message_parent_not_found');
  // a reply to the reply refuses with the depth code (default-1 byte-identity — C2 stays green)
  emitReply(fx.adapter, handle, r1.messageId, 'two');
  await flush();
  const chainRejected = coordinator._log.read(handle.id).filter((event) => event.kind === 'message.rejected').at(-1);
  assert.equal(chainRejected?.payload?.reason, 'message_depth_exceeded',
    'a reply to the reply refuses with the depth code (never unknown-parent) — the default-1 admission decision is byte-identical to today');
});

test('A2 (RC-01): a 3-deep exchange lands under a budget-3 root; the depth-3 hop is exhausted', async () => {
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:a2' });
  const root = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'status?', budget: 3 }, { actor: 'orchestrator' });
  const r1 = await replyStep(fx, handle, root.messageId, 'one');
  assert.ok(r1, 'the first hop lands (depth 1)');
  const r2 = await replyStep(fx, handle, r1.messageId, 'two');
  assert.ok(r2,
    'stage: chain-dies-at-r1 — the second hop must land (r1 depth 1 < budget 3); at HEAD a reply to a reply refuses at depth 1 (coordinator.mjs:12533-12535)');
  const r3 = await replyStep(fx, handle, r2.messageId, 'three');
  assert.ok(r3, 'the third hop lands (depth 3)');
  assert.equal(r2.inReplyTo, r1.messageId, 'the second hop is inReplyTo-linked to the first');
  assert.equal(r3.inReplyTo, r2.messageId, 'the third hop is inReplyTo-linked to the second');
  // each hop's envelope carries the depth-coded fields (D2/D4)
  assert.deepEqual({ depth: r1.depth, budget: r1.budget, remaining: r1.remaining }, { depth: 1, budget: 3, remaining: 2 });
  assert.deepEqual({ depth: r2.depth, budget: r2.budget, remaining: r2.remaining }, { depth: 2, budget: 3, remaining: 1 });
  assert.deepEqual({ depth: r3.depth, budget: r3.budget, remaining: r3.remaining }, { depth: 3, budget: 3, remaining: 0 });
  // a reply to the depth-3 hop refuses with the exhaustion payload
  emitReply(fx.adapter, handle, r3.messageId, 'four');
  await flush();
  const exhausted = coordinator._log.read(handle.id).filter((event) => event.kind === 'message.rejected').at(-1);
  assert.deepEqual(exhausted?.payload, { reason: 'message_depth_exceeded', inReplyTo: r3.messageId, depth: 4, budget: 3, remaining: 0 });
});

test('A3 (RC-03): the depth-exhaustion refusal payload carries {depth, budget, remaining} with remaining: 0', async () => {
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:a3' });
  const root = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'status?', budget: 1 }, { actor: 'orchestrator' });
  const r1 = await replyStep(fx, handle, root.messageId, 'one');
  assert.ok(r1, 'the first hop lands (depth 1, budget 1, remaining 0)');
  // a reply to the depth-1 hop exhausts the budget
  emitReply(fx.adapter, handle, r1.messageId, 'two');
  await flush();
  const refused = coordinator._log.read(handle.id).filter((event) => event.kind === 'message.rejected').at(-1);
  assert.deepEqual(refused?.payload, { reason: 'message_depth_exceeded', inReplyTo: r1.messageId, depth: 2, budget: 1, remaining: 0 },
    'stage: exhaustion-payload-missing — the refusal must name depth AND budget AND remaining: 0 (D3); at HEAD the payload is {depth} only (coordinator.mjs:12534)');
});

test('A4 (RC-04): a declared budget outside [1, MAX] refuses AT SEND with message_budget_invalid', async () => {
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:a4' });
  const zero = await laneSendCode(coordinator, { kind: 'query', to: { workerId: handle.id }, body: 'x', budget: 0 });
  assert.equal(zero, 'message_budget_invalid',
    'stage: send-budget-refusal-missing — budget 0 must refuse at the lane with the named code (D3/RC-04); at HEAD the lane ignores budget (sendMessage destructures {kind, to, body})');
  const nine = await laneSendCode(coordinator, { kind: 'query', to: { workerId: handle.id }, body: 'x', budget: 9 });
  assert.equal(nine, 'message_budget_invalid', 'budget 9 (above MAX_MESSAGE_DEPTH_BUDGET 8) must refuse at the lane');
});

test('A5 (RC-05): a non-integer budget refuses AT THE LANE — the lane is the single shape authority', async () => {
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:a5' });
  const half = await laneSendCode(coordinator, { kind: 'query', to: { workerId: handle.id }, body: 'x', budget: 1.5 });
  assert.equal(half, 'message_budget_invalid',
    'stage: lane-shape-authority-missing — budget 1.5 must refuse at the lane (B-5b); at HEAD the lane ignores budget');
  const str = await laneSendCode(coordinator, { kind: 'query', to: { workerId: handle.id }, body: 'x', budget: '3' });
  assert.equal(str, 'message_budget_invalid', 'budget "3" (a string) must refuse at the lane');
});

test('A6 (D1): the budget is a COUNT — safe integers that move only when a hop lands, never a clock', async () => {
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:a6' });
  const root = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'status?', budget: 3 }, { actor: 'orchestrator' });
  assert.equal(root.budget, 3, 'stage: budget-count-missing — the send outcome carries the declared budget (D2)');
  const atSend = coordinator.messageReceipt(root.messageId);
  assert.equal(atSend.depth, 0, 'the root sits at depth 0');
  assert.equal(atSend.budget, 3, 'the root carries the full budget');
  assert.equal(atSend.remaining, 3, 'remaining equals the budget at the root');
  for (const clock of ['deadlineAt', 'expiresAt', 'ticks', 'windowMs', 'since']) {
    assert.equal(Object.hasOwn(atSend, clock), false, `no clock-like field rides the receipt (${clock})`);
  }
  const r1 = await replyStep(fx, handle, root.messageId, 'one');
  assert.equal(coordinator.messageReceipt(root.messageId).remaining, 3,
    'the root\'s remaining does not move when a CHILD hop lands — only the child\'s own remaining counts down');
  assert.deepEqual({ depth: r1.depth, remaining: r1.remaining }, { depth: 1, remaining: 2 },
    'a landed hop decrements its own remaining by exactly one');
  assert.equal(Number.isSafeInteger(r1.remaining), true, 'remaining is a safe integer');
});

// ===========================================================================
// §B — The walk (B-1)
// ===========================================================================

test('B1 (RC-06): per-hop receipts carry {depth, budget, remaining}; the chain root→r1→r2→r3 walks the lane', async () => {
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:b1' });
  const root = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'status?', budget: 3 }, { actor: 'orchestrator' });
  const rootReceipt = coordinator.messageReceipt(root.messageId);
  assert.equal(rootReceipt.depth, 0, 'stage: per-hop-depth-missing — the root receipt must carry depth 0 (D4); at HEAD messageReceipt returns no depth fields');
  assert.equal(rootReceipt.budget, 3);
  assert.equal(rootReceipt.remaining, 3);
  const r1 = await replyStep(fx, handle, root.messageId, 'one');
  assert.ok(r1, 'the first hop lands');
  const r2 = await replyStep(fx, handle, r1.messageId, 'two');
  assert.ok(r2, 'the second hop lands');
  const r3 = await replyStep(fx, handle, r2.messageId, 'three');
  assert.ok(r3, 'the third hop lands');
  // walk root → r1 → r2 → r3, reading depth/budget/remaining at every hop
  const hop1 = coordinator.messageReceipt(root.messageId).reply;
  assert.deepEqual({ depth: hop1.depth, budget: hop1.budget, remaining: hop1.remaining }, { depth: 1, budget: 3, remaining: 2 });
  const hop2 = coordinator.messageReceipt(r1.messageId).reply;
  assert.deepEqual({ depth: hop2.depth, budget: hop2.budget, remaining: hop2.remaining }, { depth: 2, budget: 3, remaining: 1 });
  const hop3 = coordinator.messageReceipt(r2.messageId).reply;
  assert.deepEqual({ depth: hop3.depth, budget: hop3.budget, remaining: hop3.remaining }, { depth: 3, budget: 3, remaining: 0 });
  assert.equal(coordinator.messageReceipt(r3.messageId).reply, null, 'the depth-3 hop is exhausted — no fourth hop');
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
    'stage: target-inheritance-missing — the first reply hop inherits the parent\'s target verbatim (B-1) so messageRunId resolves to the ROOT\'s run; at HEAD the reply record mints target: {workerId: null} (coordinator.mjs:12580) → null');
  // T6 (blue-team fold): the B-1 target-verbatim law at the record level — the reply record's
  // target deep-equals the parent's target, not a fresh {workerId: null} mint. At HEAD the reply
  // record mints target: {workerId: null} (coordinator.mjs:12580), so the deep-equal fails on the
  // null workerId even where the walk itself has no other defect.
  assert.deepEqual(coordinator._messages.get(r1.messageId)?.target, coordinator._messages.get(root.messageId)?.target,
    'the reply record\'s target deep-equals the parent\'s target verbatim (B-1; at HEAD the reply record mints target: {workerId: null} at coordinator.mjs:12580)');
  // the orchestrator reads her own chain's receipts through the facade (resolve-then-authorize)
  const viaFacade = await facadeError(() => fx.application.command('run.message.receipt', { messageId: r1.messageId }, wave, null));
  assert.ok(viaFacade && viaFacade.code === undefined && viaFacade.depth === 1 && viaFacade.budget === 1,
    'the facade serves the hop receipt with depth fields — the chain is walkable including the orchestrator-rooted first hop');
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
// §D — Per-branch cap (B-3)
// ===========================================================================

test('D1 (D1/B-3): two sibling branches each get the full depth — the budget is a per-branch constant', async () => {
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:d1' });
  // branch 1: a budget-3 root, r1 → r2 → r3 down one branch
  const branchRoot = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'branch one', budget: 3 }, { actor: 'orchestrator' });
  assert.equal(branchRoot.budget, 3, 'stage: per-branch-budget-missing — the declared budget rides the outcome');
  const r1 = await replyStep(fx, handle, branchRoot.messageId, 'one');
  assert.ok(r1, 'the first hop lands');
  assert.equal(r1.budget, 3, 'the budget inherits VERBATIM down the branch — the cap is a constant, never a subtree hop total');
  assert.equal(r1.remaining, 2);
  const r2 = await replyStep(fx, handle, r1.messageId, 'two');
  assert.equal(r2.budget, 3, 'the budget stays 3 at the second hop');
  assert.equal(r2.remaining, 1);
  const r3 = await replyStep(fx, handle, r2.messageId, 'three');
  assert.equal(r3.budget, 3, 'the budget stays 3 at the third hop');
  assert.equal(r3.remaining, 0);
  // branch 2 (sibling): a FRESH root send re-roots with a FULL budget — one branch cannot spend
  // its sibling's hops
  const siblingRoot = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'branch two', budget: 3 }, { actor: 'orchestrator' });
  assert.equal(siblingRoot.budget, 3, 'the sibling branch starts with the full budget');
  const s1 = await replyStep(fx, handle, siblingRoot.messageId, 'one again');
  assert.ok(s1, 'the sibling branch admits its first reply');
  assert.equal(s1.depth, 1, 'the sibling branch starts fresh at depth 1');
  assert.equal(s1.remaining, 2, 'the sibling branch\'s hops were not spent by branch 1');
});

test('D2 (D1): MAX_MESSAGE_DEPTH_BUDGET is the closed 8 ceiling, with the contract\'s derivation pins', () => {
  assert.equal(limits.MAX_MESSAGE_DEPTH_BUDGET, 8,
    'stage: max-budget-constant-missing — at HEAD limits.mjs exports no MAX_MESSAGE_DEPTH_BUDGET; D1 pins the closed 8 conversational ceiling');
  assert.equal(Number.isSafeInteger(limits.MAX_MESSAGE_DEPTH_BUDGET), true, 'the ceiling is a safe integer');
  assert.equal(limits.MAX_MESSAGE_DEPTH_BUDGET & (limits.MAX_MESSAGE_DEPTH_BUDGET - 1), 0,
    'derivation: 8 is a power of two');
  assert.ok(limits.MAX_MESSAGE_DEPTH_BUDGET >= 4 && limits.MAX_MESSAGE_DEPTH_BUDGET <= 8,
    'derivation: the ceiling is the smallest power of two strictly above the 3-deep acceptance exchange (RC-01), with headroom for the #94 four-surveyor pattern');
  assert.ok(limits.FRAME_LIMITS['message.send.body'].value < limits.FRAME_LIMITS['scanner.window.message_send'].value,
    'derivation: the per-frame invariant holds at any depth — the 2,048-byte body admission cap never approaches the 20,480-byte scanner window (B-3 corrected)');
});

// ===========================================================================
// §E — Replay (B-4)
// ===========================================================================

test('E1 (RC-07): reply hops are durable store-audited rows keyed by inReplyTo; root rows carry depth/budget/remaining', async () => {
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:e1' });
  const root = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'status?', budget: 3 }, { actor: 'orchestrator' });
  const sentRow = coordinator._coordination.events().find((event) => event.kind === 'message.sent' && event.payload?.messageId === root.messageId);
  assert.ok(sentRow, 'the root send is store-audited');
  assert.equal(sentRow.payload.depth, 0,
    'stage: root-row-depth-missing — the message.sent audit row must carry {depth: 0, budget, remaining} (B-4); at HEAD the row is {messageId, kind, from, to, body, targetCount}');
  assert.equal(sentRow.payload.budget, 3);
  assert.equal(sentRow.payload.remaining, 3);
  assert.equal(sentRow.idempotencyKey, `message.sent:${root.messageId}`, 'the idempotency key is unchanged (message.sent:<id>)');
  // a reply hop is a store-audited message.delivered row WITH inReplyTo — the replay seed
  emitReply(fx.adapter, handle, root.messageId, 'ack');
  await flush();
  const replyRow = coordinator._coordination.events().find((event) => event.kind === 'message.delivered' && event.payload?.inReplyTo != null);
  assert.ok(replyRow,
    'stage: reply-row-absent — a reply hop must be store-audited as a message.delivered row carrying inReplyTo (B-4); at HEAD replies are worker-log appendAttributed only, never store rows');
  assert.equal(replyRow.payload.inReplyTo, root.messageId, 'the reply row names its parent — a fresh coordinator rebuilds the topology from these rows');
  assert.equal(replyRow.payload.depth, 1);
  assert.equal(replyRow.payload.budget, 3);
  assert.equal(replyRow.payload.remaining, 2);
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
  // a real chain next to the alias: root (budget 2) + one reply, both durable
  const root = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'status?', budget: 2 }, { actor: 'orchestrator' });
  emitReply(fx.adapter, handle, root.messageId, 'ack');
  await flush();
  const r1 = coordinator.messageReceipt(root.messageId).reply;
  assert.ok(r1, 'the first hop lands');
  // T2 (blue-team fold): the REAL replay entry point is the Coordinator constructor's _replay() —
  // a SECOND coordinator over a FRESH store on the same ledger must rebuild root → r1 from the
  // durable rows (B-4), and must NOT mint the alias as a phantom root. At HEAD _replay() never
  // seeds _messages (coordinator.mjs:13274) so messageReceipt returns null.
  const replay = replayCoordinator(fx);
  const rootReceipt = replay.messageReceipt(root.messageId);
  assert.ok(rootReceipt,
    'stage: replay-topology-not-rebuilt — a fresh coordinator must rebuild root → r1 from the durable rows (T2/B-4); at HEAD _replay() never seeds _messages (coordinator.mjs:13274) and messageReceipt returns null');
  assert.equal(rootReceipt.depth, 0, 'the rebuilt root sits at depth 0');
  assert.equal(rootReceipt.budget, 2, 'the rebuilt root carries the declared budget');
  assert.equal(rootReceipt.remaining, 2, 'the rebuilt root starts with remaining === budget');
  assert.equal(rootReceipt.reply?.inReplyTo, root.messageId, 'the rebuilt r1 re-links to its parent (parent.reply re-link)');
  const r1Replay = replay.messageReceipt(r1.messageId);
  assert.deepEqual({ depth: r1Replay.depth, budget: r1Replay.budget, remaining: r1Replay.remaining }, { depth: 1, budget: 2, remaining: 1 },
    'the rebuilt r1 hop carries {depth: 1, budget: 2, remaining: 1}');
  assert.equal(replay._messages.has(alias.payload.messageId), false,
    'the legacy alias row is never minted as a phantom root — replay skips the <workerId>:<tail> key shape (B-4)');
});

// ===========================================================================
// §F — Refusal observability (B-5)
// ===========================================================================

test('F1 (RC-13): after a depth-exhaustion refusal the parent\'s receipt carries lastRefusal through run.message.receipt', async (t) => {
  const fx = await facadeFixture(t);
  const coordinator = fx.driver.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:f1' });
  const wave = principalOf('wave-owner');
  const root = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'status?', budget: 1 }, { actor: 'orchestrator' });
  emitReply(fx.adapter, handle, root.messageId, 'one');
  await flush();
  const r1 = coordinator.messageReceipt(root.messageId).reply;
  assert.ok(r1, 'the first hop lands');
  emitReply(fx.adapter, handle, r1.messageId, 'two');
  await flush();
  // the refusing parent's receipt carries the orchestrator-readable refusal at the LANE
  assert.deepEqual(coordinator.messageReceipt(r1.messageId).lastRefusal, {
    reason: 'message_depth_exceeded', depth: 2, budget: 1, remaining: 0,
  },
  'stage: lastRefusal-absent — the refusing parent\'s receipt must carry lastRefusal (B-5a); at HEAD messageReceipt returns no lastRefusal and message.rejected is stream-only');
  // and through the facade (B-1 target inheritance makes r1 resolvable to the run)
  const viaFacade = await facadeError(() => fx.application.command('run.message.receipt', { messageId: r1.messageId }, wave, null));
  assert.deepEqual(viaFacade?.lastRefusal, { reason: 'message_depth_exceeded', depth: 2, budget: 1, remaining: 0 },
    'the refusal surface crosses run.message.receipt with the same shape');
});

test('F2 (RC-05): the lane is the single budget authority — the facade passes budget raw and never masks the lane\'s code', async (t) => {
  const fx = await facadeFixture(t);
  const coordinator = fx.driver.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:f2' });
  const wave = principalOf('wave-owner');
  const half = await facadeError(() => fx.application.command('run.message.send', { workerId: handle.id, kind: 'query', body: 'x', budget: 1.5 }, wave, null));
  assert.equal(half?.code, 'message_budget_invalid',
    'stage: facade-double-gate — at HEAD the facade masks the lane\'s budget refusal with application_message_send_invalid (the closed key set rejects budget); the lane is the single authority for shape AND range (B-5b)');
  const str = await facadeError(() => fx.application.command('run.message.send', { workerId: handle.id, kind: 'query', body: 'x', budget: '3' }, wave, null));
  assert.equal(str?.code, 'message_budget_invalid', 'a string budget also draws message_budget_invalid from the lane, never the facade shape code');
});

test('F3 (D3): message_budget_invalid is the ONE new allowlisted code inside stateFailureCode; worker-stream codes are absent', () => {
  // T5 (blue-team fold): the checks are scoped to the stateFailureCode FUNCTION BODY, not the whole
  // file — a wrong impl that adds message_budget_invalid somewhere else (or leaks the worker-stream
  // codes anywhere in the file) must stay red. The body is the allowlist seam (D3) — the single
  // place where a lane refusal code becomes an MCP tool error.
  const src = readFileSync(fileURLToPath(new URL('../src/mcp-northbound.mjs', import.meta.url)), 'utf8');
  const body = src.match(/function stateFailureCode\(cause\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.ok(body.includes("'message_budget_invalid'"),
    'stage: allowlist-missing — at HEAD the stateFailureCode body (mcp-northbound.mjs:198-261) knows no message_* codes; D3 adds message_budget_invalid inside that body so the send-side refusal never collapses to command_outcome_unknown');
  // the worker-stream codes never cross the MCP surface (D3) — they stay absent from the body
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

test('G2 (D8/B-6): the deadlock-recovery path is exercised — a stalled chain\'s exhaustion is orchestrator-readable and a fresh root send re-roots', async () => {
  const fx = laneFixture();
  const coordinator = fx.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:g2' });
  // a budget-1 chain stalls: r1 lands, a reply to r1 exhausts the budget
  const root = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'status?', budget: 1 }, { actor: 'orchestrator' });
  emitReply(fx.adapter, handle, root.messageId, 'one');
  await flush();
  const r1 = coordinator.messageReceipt(root.messageId).reply;
  assert.ok(r1, 'the first hop lands');
  emitReply(fx.adapter, handle, r1.messageId, 'two');
  await flush();
  // the orchestrator observes the stall on the refusing parent's receipt — no worker-stream read
  assert.deepEqual(coordinator.messageReceipt(r1.messageId).lastRefusal, {
    reason: 'message_depth_exceeded', depth: 2, budget: 1, remaining: 0,
  },
  'stage: lastRefusal-absent — the exhaustion signal (remaining: 0) is orchestrator-readable via lastRefusal; at HEAD the refusal is stream-only');
  // the recovery: the orchestrator re-roots with a fresh root send — the conversation continues
  const fresh = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 're-root', budget: 2 }, { actor: 'orchestrator' });
  assert.ok(fresh?.ok === true, 'a fresh root send is admitted after a stall (D8 deadlock-recovery)');
  emitReply(fx.adapter, handle, fresh.messageId, 'resumed');
  await flush();
  const resumed = coordinator.messageReceipt(fresh.messageId).reply;
  assert.ok(resumed, 'the re-rooted conversation admits a fresh chain');
  assert.equal(resumed.depth, 1, 'the re-rooted chain starts fresh at depth 1');
});

// ===========================================================================
// §H — Facade + MCP/web (D6/D7)
// ===========================================================================

test('H1 (RC-08): run.message.send carries budget on the outcome; run.message.receipt carries {depth, budget, remaining}', async (t) => {
  const fx = await facadeFixture(t);
  const coordinator = fx.driver.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:h1' });
  const wave = principalOf('wave-owner');
  const outcome = await facadeError(() => fx.application.command('run.message.send', { workerId: handle.id, kind: 'query', body: 'status?', budget: 3 }, wave, null));
  assert.ok(outcome && outcome.budget === 3,
    'stage: facade-budget-missing — the run.message.send outcome must carry the declared budget (D6); at HEAD the facade rejects the budget key (application_message_send_invalid)');
  const receipt = await facadeError(() => fx.application.command('run.message.receipt', { messageId: outcome.messageId }, wave, null));
  assert.equal(receipt?.depth, 0, 'the facade receipt carries depth');
  assert.equal(receipt?.budget, 3, 'the facade receipt carries budget');
  assert.equal(receipt?.remaining, 3, 'the facade receipt carries remaining');
});

test('H2 PIN (RC-08/G7): the byte-stable command table is untouched — the eight message-lane direct ports are not table keys', () => {
  const EIGHT = ['run.message.send', 'run.message.receipt', 'run.attention.watch',
    'run.scratchpad.read', 'run.scratchpad.elevate', 'run.board.post', 'run.board.read', 'run.knowledge.seed'];
  for (const key of EIGHT) {
    assert.equal(Object.hasOwn(APPLICATION_COMMAND_DEFINITIONS, key), false,
      `${key} is a DIRECT PORT — the byte-stable APPLICATION_COMMAND_DEFINITIONS table is untouched (D6/G7); the projection law is reach, never semantics`);
  }
});

test('H3 (RC-09): baton_run_message_send accepts budget {integer, minimum: 1, maximum: 8, optional}', async (t) => {
  const fx = await facadeFixture(t);
  const { server } = await mcpFixture(t, fx);
  const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const sendTool = listed.result.tools.find((tool) => tool.name === 'baton_run_message_send');
  assert.ok(sendTool, 'the message send tool is present in the MCP enumeration');
  const budget = sendTool.inputSchema?.properties?.budget;
  assert.ok(budget,
    'stage: mcp-message-budget-missing — at HEAD baton_run_message_send carries no budget schema property (mcp-northbound.mjs:585-593); D7 adds budget {integer, minimum: 1, maximum: 8}');
  assert.equal(budget.type, 'integer');
  assert.equal(budget.minimum, 1);
  assert.equal(budget.maximum, 8);
  assert.equal(sendTool.inputSchema?.required?.includes('budget') ?? false, false, 'budget is optional (default 1)');
});

test('H4 (RC-09/RC-04): an out-of-range budget on baton_run_message_send surfaces as message_budget_invalid', async (t) => {
  const fx = await facadeFixture(t);
  const handle = await fx.driver.coordinator.spawn('mock', makeBrief(), { runId: 'run:h4' });
  const { server } = await mcpFixture(t, fx);
  const call = await server.handle({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'baton_run_message_send', arguments: { repoId: REPO, workerId: handle.id, kind: 'inform', body: 'x', budget: 9 } },
  });
  assert.equal(call.result?.isError, true, 'an out-of-range budget draws a tool error');
  const parsed = JSON.parse(call.result.content[0].text);
  assert.equal(parsed.error?.code, 'message_budget_invalid',
    'stage: mcp-message-budget-missing — at HEAD budget is an undeclared field (unknown_argument_field at the key-closure, mcp-northbound.mjs:898) and the code does not exist; D7/D3 surface the lane\'s refusal verbatim, never command_outcome_unknown');
  // N1 (blue-team fold): an IN-RANGE budget must be accepted — the _dispatch branch for
  // baton_run_message_send (mcp-northbound.mjs:1771-1778) builds the CLOSED shape
  // {runId?, workerId, kind, body}, so at HEAD even budget: 3 is stripped and the argument dies
  // at the key-closure as unknown_argument_field (isError true). D7 must let budget ride the
  // dispatch so the in-range call succeeds.
  const inRange = await server.handle({
    jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: { name: 'baton_run_message_send', arguments: { repoId: REPO, workerId: handle.id, kind: 'inform', body: 'x', budget: 3 } },
  });
  assert.equal(inRange.result?.isError, false,
    'an in-range budget is accepted through the MCP surface (N1) — the _dispatch branch must carry budget, never strip it (mcp-northbound.mjs:1771-1778)');
});

test('H5 (RC-09/D3): the web mapper maps message_budget_invalid to 400', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/web-northbound.mjs', import.meta.url)), 'utf8');
  assert.ok(src.includes("'message_budget_invalid'"),
    'stage: web-mapper-branch-missing — at HEAD web-northbound.mjs has zero message_budget_invalid references; D3 adds the dispatchFailure branch → httpStatus: 400 (the same "command precondition failed" class as the capability_*_invalid family, web-northbound.mjs:195-199)');
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
