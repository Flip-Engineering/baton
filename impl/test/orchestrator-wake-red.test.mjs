// Orchestrator-wake red-first acceptance suite (issue #71, contract:
// docs/reference/evidence/orchestrator-wake-2026-08-07/orchestrator-wake-contract.md v1.1 +
// the fold-2 v1.2 amendment; brief: docs/reference/evidence/
// orchestrator-wake-2026-08-07/suite-71-brief.md). The wake primitive is
// attention.wait(runId, {afterCursor: {storeCursor, reasonsCursor}, timeoutMs}, principal):
// a long-poll on coordination-store.mjs waitAfter(:8880) composed through the coordinator's
// _attentionScopeAuthorized (:7080) / _attentionPage (:7106) with a split cursor (B1:
// storeCursor + reasonsCursor, never folded into one token) and a stable-identity
// candidacy_review (B2: minted once into _attentionReasons, refreshed in place, never
// re-minted per page read).
//
// Red-first: every capability row fails for a NAMED stage at HEAD and goes green on the
// v1.1 implementation ONLY. Pin rows (marked PIN) are green at HEAD and MUST stay green —
// they exist so a wrong implementation has nowhere to hide.
//
// Suite law (brief): namespace imports for invented surfaces; hermetic (mock adapters,
// mkdtemp, test.after, no network); run TWICE from the repo root and record the stable
// split in the header; sorted-key literals in ACTUAL order; localeCompare banned; no clocks
// as workflow controls (timeoutMs is only the transport bound) — the fold-2 injectable
// fixture clock (RETURN-TRIP/F1) is advanced EXPLICITLY past the coalescing window, never
// wall-time-derived, so it is deterministic by construction; NUL discipline —
// application.mjs/coordination-store.mjs carry NUL bytes, so the two source-grep rows read
// them with readFileSync (not a shell pipeline) and never scan the NUL-bearing files whole.
//
// ROW INVENTORY (§A-§K, 36 rows: 30 RED / 6 PIN):
//   §A  WAIT-DISPATCH · WAIT-HONEST-EMPTY · WAIT-PLAN-APPROVAL
//   §B  DECISION-PARK-WAKES · DECISION-FIRST-SHAPE · ANSWER-FROM-WAKE · ALREADY-RESOLVED(PIN)
//       · REVALIDATED
//   §C  CURSOR-SHAPE · RETURN-TRIP · REASONS-ALONE
//   §D  CANDIDACY-WAKE · CANDIDACY-HONEST-EMPTY · CANDIDACY-REFRESH
//   §E  WORKER-REFUSED · AUTHORITY-RUN-SCOPED · TWO-WAITERS
//   §F  REPLY-NO-WAKE · BLOCKING-ESCALATES
//   §G  WAKE-REASONS-SET(stage[WAKE_REASONS-missing]) · WAITING-ON-KINDS-PIN · ATTENTION-TYPES-PIN
//   §H  MCP-TOOL · MCP-SCHEMA-CAPABILITY · WEB-ENVELOPE · WEB-CEILING · MCP-CEILING ·
//       CLI-GRAMMAR · WAKE-ABORT
//   §I  LIMITS-PIN · OVERSIZE-REFUSAL · ACTIONS-SLICE
//   §J  STORE-VISIBLE(PIN)
//   §K  WAIT-INVALID · MCP-ALLOWLIST · EXISTING-PINS(PIN)
//
// NAMED RED STAGES (every failing row names exactly one):
//   stage[attention-wait-command-missing] — the command is absent (HEAD throws
//       application_command_unavailable at application.mjs:12616); the default stage for
//       every dispatch row.
//   stage[WAKE_REASONS-missing]            — application-semantics.mjs has no WAKE_REASONS.
//   stage[baton-attention-wait-tool-missing] — no MCP ordinary tool row nor capability map.
//   stage[web-envelope-missing]            — the web command envelope has no attention_wait.
//   stage[cli-grammar-missing]             — parseBatonCli throws 'expected attention watch'.
//   stage[mcp-allowlist-missing]           — stateFailureCode lacks attention_wait_invalid.
//
// INVENTED SURFACES (namespace imports, per suite law):
//   WAKE_REASONS            -> application-semantics.mjs (absent at HEAD — the RED row's
//                              stage[WAKE_REASONS-missing]).
//   validateWebCommandEnvelope -> web-northbound.mjs:1885 (the exported validateEnvelope,
//                              defined at web-northbound.mjs:387).
//   parseBatonCli           -> application-cli.mjs (existing).
//   mcpApplicationToolNames -> mcp-northbound.mjs:2215 (existing).
//   FRAME_LIMITS            -> limits.mjs:110 (existing; the W-8 limits are byte-unchanged).
//   ATTENTION_TYPES         -> messages.mjs:18 (existing; the #10-era inbox vocabulary).
//
// PIN LIST (green at HEAD, byte-unchanged by the fold):
//   P1 ALREADY-RESOLVED — run.answer's already_resolved receipt path is byte-identical.
//   P2 WAITING-ON-KINDS-PIN — the closed five, frozen, ACTUAL sorted order.
//   P3 ATTENTION-TYPES-PIN — the closed five, frozen, ACTUAL order.
//   P4 LIMITS-PIN — the W-8 decision/view limits are byte-unchanged.
//   P5 STORE-VISIBLE — plan proposal + candidacy admission advance the store seq.
//   P6 EXISTING-PINS — attention_scope_forbidden and application_attention_watch_invalid
//      survive untouched.
//
// VERIFIED SPLIT: 30 RED / 6 PIN — run twice from the repo root on 2026-08-07 at
// HEAD 0792e5e; both passes identical (36 tests, 6 pass, 30 fail, all 30 at a named
// stage; pins P1-P6 green). The fold (suite-fold-2.md) resolves F1-F10; F6's behavioral
// 65+ spill row is DEFERRED there with an explicit reason (heavy multi-member staging).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter } from '../src/adapter.mjs';
import * as applicationSemanticsNs from '../src/application-semantics.mjs';
import { parseBatonCli } from '../src/application-cli.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { mcpApplicationToolNames } from '../src/mcp-northbound.mjs';
import { ATTENTION_TYPES } from '../src/messages.mjs';
import { validateWebCommandEnvelope } from '../src/web-northbound.mjs';
import {
  BatonApplication,
  createDriver,
  DEFAULT_RUN_LINEAGE_POLICY,
} from '../src/index.mjs';

const REPO = 'repo-orchestrator-wake';
const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });

const dirs = [];
const drivers = [];
function tmpDir(label = 'baton-wp-') {
  const d = mkdtempSync(join(tmpdir(), label));
  dirs.push(d);
  return d;
}
test.after(async () => {
  for (const driver of drivers) {
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function gitRepo(label) {
  const repo = tmpDir(label);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'baton-test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Baton Test'], { cwd: repo });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'base'], { cwd: repo });
  return repo;
}

const canonical = (value) => (Array.isArray(value) ? value.map(canonical) : (value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value));
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function principalOf(id) {
  return Object.freeze({ actor: `test:${id}`, principalId: id, sessionId: `session-${id}` });
}

// The quiet adapter: admits spawns, records everything, and emits only what the harness
// drives (no autonomous turns — wake rows control every epoch).
class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: Infinity, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native', turnCompletion: 'pausable',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'], family: 'mock',
        acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
        serviceTier: null, provenance: 'orchestrator-wake-red', refreshedAt: null,
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

// The scenario-driven adapter: members run to completion and block on their ask (decision or
// blocking question). Plus the run-debug emit shim for harness interludes.
class WorkflowAdapter extends MockAdapter {
  constructor(scenario) {
    super({ harness: 'mock', scenario });
    const baseCard = this.card.bind(this);
    this.card = () => ({
      ...baseCard(),
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'], family: 'mock',
        acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
        serviceTier: null, provenance: 'orchestrator-wake-red', refreshedAt: null,
      },
    });
  }
  emit(event) {
    const session = this._sessions.get(event.worker);
    if (session) this._emit(session, event.kind, event.payload ?? {});
  }
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
  followPolicy: Object.freeze({
    mode: 'enabled', maxWaitMs: 60000, maxChanges: 64, maxResponseBytes: 524288, maxScanEvents: 128,
  }),
});

// The OVERSIZE-REFUSAL fixture: a wake whose serialized payload exceeds the frame cap
// (the application.mjs:8307 follow-policy discipline — Buffer.byteLength(JSON.stringify(result))
// > policy.maxResponseBytes) refuses application_attention_wait_oversize (D6).
const PROFILE_TINY = Object.freeze({
  ...PROFILE,
  followPolicy: Object.freeze({
    mode: 'enabled', maxWaitMs: 60000, maxChanges: 64, maxResponseBytes: 2048, maxScanEvents: 128,
  }),
});

// mandatory:false — plan approval is still required (the wave run gates on awaiting_plan_approval
// and the member dispatches only after approve), but the store's createTask goal_plan_required
// gate is relaxed. That gate is existing goal-plan policy (covered by issue10's suites); the wake
// suite needs authorityOn's DIRECT createTask staging for the D3 lease-holder (a baton_orchestrator
// parent task that no approved plan node can carry) — so the lease ceremony must not trip it.
const GOAL_PLAN_POLICY = Object.freeze({
  schemaVersion: 1, repoId: REPO, mandatory: false, approvalTtlMs: 3600000,
  riskClasses: ['low'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 65536, maxPlanBytes: 262144, maxStatusBytes: 262144,
    maxTokens: 1000000, maxUsd: 100, maxWallMin: 1440, maxProviderTurns: 10000,
  }),
});

// The worker-side decision park (G6): a decision request that blocks the member turn. The
// interaction lands in the coordinator's interaction lane and surfaces through
// application.decisionList -> projectDecisionAttention (application.mjs:575-599).
const DECISION_SCENARIO = Object.freeze({
  outcome: 'completed', edits: [],
  ask: {
    kind: 'decision',
    question: 'Which option should the orchestrator approve for this wave run?',
    options: [
      { id: 'opt-a', label: 'A', summary: null },
      { id: 'opt-b', label: 'B', summary: null },
    ],
    allowFreeResponse: false, recommended: null, deadlineMs: 120000, afterEditIndex: 0,
  },
});

// A blocking question (G10): question.asked blocking:true -> input_required, surfacing as an
// answer_question actionable item (W-5).
const BLOCKING_QUESTION_SCENARIO = Object.freeze({
  outcome: 'completed', edits: [],
  ask: { kind: 'question', question: 'Which directory should hold the generated artifact?', blocking: true },
});

// The oversize question: 2003 bytes (under the 2048 decision.question admission bound) so the
// interaction parks cleanly, but the serialized wake payload (~2.3 kB) blows past the 2048
// followPolicy.maxResponseBytes and draws application_attention_wait_oversize (D6).
const OVERSIZE_QUESTION = `Weigh the candidate implementations for the approved plan and select the one to adopt, given the deployment constraints already established and the requirement that the chosen path remain within the declared frame economics for this decision ${'x'.repeat(1760)}?`;
const OVERSIZE_DECISION_SCENARIO = Object.freeze({
  outcome: 'completed', edits: [],
  ask: {
    kind: 'decision',
    question: OVERSIZE_QUESTION,
    options: [{ id: 'opt-a', label: 'A', summary: null }],
    allowFreeResponse: false, recommended: null, deadlineMs: 120000, afterEditIndex: 0,
  },
});

// Sorted-key / ACTUAL-order literals (localeCompare banned; the arrays below are pinned
// byte-for-byte against the contract, not derived from a comparator).
const HONEST_EMPTY_KEYS = Object.freeze(['actions', 'reasons', 'reasonsCursor', 'storeCursor', 'timedOut', 'woken']);
const WOKEN_KEYS = Object.freeze(['actions', 'reasons', 'reasonsCursor', 'runId', 'schemaVersion', 'storeCursor', 'timedOut', 'waitingOn', 'wave', 'woken']);
const WAKE_REASONS_SORTED = Object.freeze(['answer_approval', 'answer_decision', 'answer_question', 'budget_alarm', 'candidacy_review', 'member_terminal', 'plan_approval', 'wave_terminal']);
const WAITING_ON_KINDS_SORTED = Object.freeze(['capacity_ceiling', 'dispatch_pending', 'plan_approval', 'provider_stalled', 'spawning']);
const ATTENTION_TYPES_ACTUAL = Object.freeze(['approval', 'question', 'blocked', 'stalled', 'budget_alarm']);

// Full application fixture (workflow-surface-red idiom): one real createDriver stack so the
// facade, the kernel lanes, and the durable store share state. goalPlanAuthority is always
// on (every wake run is a wave run). adapter defaults to the quiet ScriptableAdapter.
async function wakeFixture(t, { adapter = new ScriptableAdapter(), profile = PROFILE, now } = {}) {
  const repo = gitRepo('baton-wp-repo-');
  const logDir = tmpDir('baton-wp-log-');
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: adapter },
    runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY,
    stopDeadlineMs: 1000,
    watchdog: { stallMs: 0 },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
    ...(now ? { now: now.now.bind(now) } : {}),
  });
  drivers.push(driver);
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: { default: profile },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('wp-planner'),
      dispatcher: principalOf('wp-dispatcher'),
      observer: principalOf('wp-observer'),
    },
    authorize: async () => true,
  });
  t.after(async () => {
    try { await application.shutdown(principalOf('wp-cleanup')); } catch { /* RED failures may interrupt setup */ }
  });
  const coordination = driver.coordination;
  return { repo, logDir, adapter, driver, application, coordination, owner: principalOf('wave-owner') };
}

// A wave-shaped run through the application ceremony (run.start with driverKind:'wave' then the
// plan approval gate). approve:false leaves the run awaiting plan approval so the wake pages
// plan_approval.
async function startWaveRun(fx, { approve = true, profile = 'default' } = {}) {
  const owner = fx.owner;
  const started = await fx.application.start({
    objective: 'orchestrator wake staging', profile, route: ROUTE, scope: ['**'], driverKind: 'wave',
  }, owner);
  const approved = approve
    ? await fx.application.approve(started.runId, started.plan.digest, principalOf('wake-approver'))
    : null;
  return { owner, runId: started.runId, started, approved };
}

// The wake call (the invented command surface). Cursors default to (0,0); timeoutMs is only
// the transport bound — never a workflow control. `signal` is the H7 transport-bound cancellation
// token: the MCP/web transports supply it on connection close, and the WAKE-ABORT row injects it
// directly to pin the coordination_wait_aborted -> wake-cancelled mapping. It is a non-wire
// field (never serialized), exactly like the transportHidden args the MCP schema carries.
function wake(fx, runId, { storeCursor = 0, reasonsCursor = 0, timeoutMs = 5000, signal } = {}, principal = fx.owner) {
  return fx.application.command('attention.wait', {
    runId,
    afterCursor: { storeCursor, reasonsCursor },
    timeoutMs,
    ...(signal ? { signal } : {}),
  }, principal, null);
}

// Attach handlers immediately so a rejection between registration and await is never
// unhandled (DECISION-PARK-WAKES registers the waiter before the park).
function tracked(promise) {
  return promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
}
const settle = tracked;

// Capture the lane's own coded refusal for byte-identity comparison.
async function laneError(fn) {
  try { await fn(); return null; } catch (error) { return { code: error?.code ?? null, message: error?.message ?? null }; }
}
const facadeError = laneError;

async function flush(times = 80) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// The F1 fold: the fixture clock is INJECTABLE so RETURN-TRIP drives the member-terminal
// storm-coalescing window (ATTENTION_COALESCE_WINDOW_MS = 500) deterministically — advance()
// past the window between the two emits, never a real `sleep(600)` (the #7 class the brief bans).
// `createDriver` already forwards `opts.now` into the Coordinator (`this._now = opts.now ||
// Date.now`, coordinator.mjs:996), so the controllable clock is purely a fixture seam.
function controllableClock(base = Date.now()) {
  let t = base;
  return {
    now: () => t,
    advance: (ms) => { t += ms; },
  };
}

// Yield to the macrotask queue once — a settled-boundary seam (F9's CANDIDACY-REFRESH), never a
// clock or a workflow gate. A B2 refresh delivered on a macrotask notifier must land before the
// re-wake pages the stable-identity candidacy_review.
const yieldMacrotask = () => new Promise((resolve) => { setTimeout(resolve, 0); });

async function until(probe, { tries = 400, delayMs = 20, label = 'predicate' } = {}) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    last = await probe();
    if (last) return last;
    await new Promise((resolve) => { setTimeout(resolve, delayMs); });
  }
  throw new Error(`until: ${label} never became true (last: ${JSON.stringify(last)?.slice(0, 200)})`);
}

async function parkedDecision(fx, runId, principal) {
  return until(
    async () => {
      const view = await fx.application.decisionList({ runId }, principal, null);
      return view.decisions.length > 0 ? view.decisions[0] : null;
    },
    { label: `decision parked on ${runId}` },
  );
}

async function parkedBlockingQuestion(fx, runId, principal) {
  return until(
    async () => {
      const view = await fx.application.status(runId, principal);
      return view.blockedInteraction?.kind === 'answer_question' ? view.blockedInteraction : null;
    },
    { label: `answer_question parked on ${runId}` },
  );
}

async function dispatchedWorker(fx, runId) {
  return until(
    async () => fx.driver.coordinator.list().find((handle) => handle.runId === runId && handle.taskId != null) ?? null,
    { label: `worker dispatched on ${runId}` },
  );
}

// The board-authority-red lease ceremony: an orchestrator task on runId, a claimed worker,
// and an issued run-orchestrator lease; the closed sessionAuthority proof plus the principal
// the review authority recognizes (D3: run-scoped admits the live lease holder).
function authorityOn(fx, { runId, principalId, sessionId }) {
  const coordination = fx.coordination;
  const authorityDigest = digest({ proof: `${runId}:${principalId}:${sessionId}` });
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  const taskId = `task-${runId}-${principalId}`.replaceAll(':', '-');
  const workerId = `worker-${runId}-${principalId}`.replaceAll(':', '-');
  coordination.createTask({
    id: taskId, brief: { objective: `orchestrate ${runId}`, capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'mock', modelRequested: 'mock-model',
    modelPolicy: null, effortRequested: 'low', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${taskId}` });
  const task = coordination.claimTask(taskId, workerId, 1,
    { actor: 'orchestrator', key: `task.claimed:${taskId}` }, {
      harnessRequested: 'mock', harnessResolved: 'mock@fixture',
      modelRequested: 'mock-model', modelResolved: 'mock-model', modelObserved: 'mock-model',
      effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
      routeKey: '["mock","fixture","mock-model","low"]',
    }).task;
  const leaseId = `run-orchestrator-lease:${digest({
    repoId: REPO, parentRunId: runId, parentTaskId: taskId, parentTaskVersion: task.version,
    workerId, principalId, sessionId, sessionAuthorityDigest: authorityDigest,
  })}`;
  const receipt = coordination.issueRunOrchestratorLease({
    schemaVersion: 1, repoId: REPO, parentTask: { id: taskId, version: task.version },
    session: { principalId, sessionId, authorityDigest, expiresAt },
  }, { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` });
  const sessionAuthority = Object.freeze({
    schemaVersion: 1, authorityDigest, expiresAt, orchestratorLeaseId: receipt.lease.leaseId,
  });
  return { receipt, runId, principalId, sessionId, sessionAuthority, taskId, workerId };
}

const CANDIDACY_NODE = (n) => ({
  id: `knowledge:wake-cand-${n}`,
  type: 'Finding',
  grounding: 'observed',
  body: `candidacy seed ${n}`,
  promotion: { kind: 'Finding', trigger: 'board.item_closed' },
});

// Admit a knowledge node as a board-close candidacy. The evidence coordinationSeq must
// reference a PRIOR store event, so it is bound to the current head at admission time
// (verified: knowledgeCandidateQueue surfaces the repo-scoped count).
function admitCandidacy(fx, n) {
  const evidenceSeq = fx.coordination.events().length;
  fx.coordination.addKnowledgeNode(
    { ...CANDIDACY_NODE(n), evidence: [{ coordinationSeq: evidenceSeq }] },
    { actor: 'policy', key: `wake.candidacy:${n}` },
  );
}

const webEnvelope = (timeoutMs) => ({
  schemaVersion: 1, command: 'attention_wait', commandId: 'cmd-wake-web-1', idempotencyKey: 'wake-web-1',
  repoId: REPO, origin: 'web', runId: 'run:web-wake',
  args: { runId: 'run:web-wake', afterCursor: { storeCursor: 0, reasonsCursor: 0 }, timeoutMs },
});

// ===========================================================================
// Section A — the wake primitive dispatches; honest empty; plan_approval.
// stage[attention-wait-command-missing]: attention.wait is absent at HEAD — the dispatch
// throws application_command_unavailable (application.mjs:12467) before any state is read.
// ===========================================================================

test('WAIT-DISPATCH (§A): attention.wait dispatches; malformed closures refuse attention_wait_invalid before state', async (t) => {
  const fx = await wakeFixture(t);
  const { owner, runId } = await startWaveRun(fx, { approve: false });
  const settled = await tracked(wake(fx, runId, { timeoutMs: 5000 }, owner));
  assert.ok(settled.ok,
    `stage[attention-wait-command-missing]: attention.wait must dispatch (threw ${settled.error?.code ?? ''})`);
  assert.equal(settled.value.woken, true, 'a plan awaiting approval wakes the waiter');
  const malformed = [
    ['bad runId', () => wake(fx, 'not a run id', { timeoutMs: 1000 }, owner)],
    ['negative storeCursor', () => wake(fx, runId, { storeCursor: -1, timeoutMs: 1000 }, owner)],
    ['negative reasonsCursor', () => wake(fx, runId, { reasonsCursor: -1, timeoutMs: 1000 }, owner)],
    ['negative timeoutMs', () => wake(fx, runId, { timeoutMs: -5 }, owner)],
    // F8 fold: waitAfter requires timeoutMs > 0; a zero bound is malformed, never a degenerate wait.
    ['zero timeoutMs', () => wake(fx, runId, { timeoutMs: 0 }, owner)],
    // F8 fold: the B1 split cursors are integer tokens — a non-integer cursor is malformed.
    ['non-integer storeCursor', () => wake(fx, runId, { storeCursor: '3', timeoutMs: 1000 }, owner)],
    ['non-integer reasonsCursor', () => wake(fx, runId, { reasonsCursor: '7', timeoutMs: 1000 }, owner)],
    // F8 fold: the afterCursor block is required — a missing continuation is malformed.
    ['missing afterCursor', () => fx.application.command('attention.wait', { runId, timeoutMs: 1000 }, owner, null)],
    // F8 fold: the kind discriminator is a closed class — an unknown kind is malformed.
    ['unknown kind', () => wake(fx, runId, { kind: 'not_a_wake_kind', timeoutMs: 1000 }, owner)],
  ];
  for (const [label, fn] of malformed) {
    const err = await laneError(fn);
    assert.equal(err?.code, 'attention_wait_invalid',
      `${label} refuses with attention_wait_invalid — never a TypeError, never a generic application code`);
  }
});

test('WAIT-HONEST-EMPTY (§A D1.3): a quiet run honest-empties with both cursors unchanged, and the wake HELD a waitAfter', async (t) => {
  const fx = await wakeFixture(t);
  const { owner, runId } = await startWaveRun(fx);
  // F2 fold: spy the store's waitAfter so the row pins W-1's transport guarantee — the wake
  // anchors a waitAfter on the store cursor (never a _waitPollMs-style poll loop). The spy wraps
  // and calls through, so the honest empty still resolves through the real waitAfter.
  const waitCalls = [];
  const realWaitAfter = fx.coordination.waitAfter.bind(fx.coordination);
  fx.coordination.waitAfter = (afterSeq, timeoutMs, options) => {
    waitCalls.push({ afterSeq, timeoutMs });
    return realWaitAfter(afterSeq, timeoutMs, options);
  };
  const settled = await tracked(wake(fx, runId, { storeCursor: 0, reasonsCursor: 0, timeoutMs: 300 }, owner));
  assert.ok(settled.ok,
    `stage[attention-wait-command-missing]: attention.wait must dispatch (threw ${settled.error?.code ?? ''})`);
  const result = settled.value;
  assert.equal(result.woken, false, 'no wake-worthy item — never a fabricated reason');
  assert.equal(result.timedOut, true, 'the transport bound is the honest timeout');
  assert.deepEqual(Object.keys(result).sort(), HONEST_EMPTY_KEYS, 'the honest empty carries exactly the six sorted keys');
  assert.deepEqual(result.actions, [], 'no actions');
  assert.deepEqual(result.reasons, [], 'no reasons');
  assert.equal(result.storeCursor, 0, 'the store cursor is unchanged');
  assert.equal(result.reasonsCursor, 0, 'the reasons cursor is unchanged');
  assert.ok(waitCalls.length >= 1, 'the wake held a waitAfter on the quiet hot path — no poll loop (W-1)');
  assert.equal(waitCalls[0].afterSeq, 0, 'the held waitAfter anchored the storeCursor the wake pages');
  assert.ok(Number.isSafeInteger(waitCalls[0].timeoutMs) && waitCalls[0].timeoutMs > 0,
    'the held waitAfter carries a positive transport bound');
  assert.equal(result.storeCursor, waitCalls[0].afterSeq,
    'the honest empty echoes the store cursor the waiter held');
});

test('WAIT-PLAN-APPROVAL (§A D2.1): a plan awaiting approval wakes the waiter with plan_approval', async (t) => {
  const fx = await wakeFixture(t);
  const { owner, runId, started } = await startWaveRun(fx, { approve: false });
  const settled = await tracked(wake(fx, runId, { timeoutMs: 5000 }, owner));
  assert.ok(settled.ok,
    `stage[attention-wait-command-missing]: attention.wait must dispatch (threw ${settled.error?.code ?? ''})`);
  const result = settled.value;
  assert.equal(result.woken, true, 'a pending plan approval wakes the waiter');
  assert.deepEqual(Object.keys(result).sort(), WOKEN_KEYS, 'the woken payload has the exact key set');
  const approval = (result.actions ?? []).find((a) => a.kind === 'plan_approval' && a.runId === runId);
  assert.ok(approval, 'the wake carries plan_approval');
  assert.deepEqual(approval, {
    kind: 'plan_approval',
    runId,
    planDigest: started.plan.digest,
    answer: { command: 'run.approve', runId, planDigest: started.plan.digest },
  }, 'the advertised plan digest is the actionable identity');
});

// ===========================================================================
// Section B — the decision lane (D2): a decision park wakes, mirrors
// projectDecisionAttention verbatim plus the answer address, receipts applied /
// already_resolved, and a resolved decision is never delivered actionable.
// F7 reconciliation: DECISION-PARK-WAKES requires the park to wake, which it does via the
// REASON lane (answer_decision) — the park itself is store-invisible at HEAD (fold-2 F7,
// probe-confirmed), so the wake-worthy signal rides the reason mint, and W-9's
// store-visibility principle (§J) covers only the appending transitions. The two claims
// are consistent: wake-visible does not require store-appended.
// ===========================================================================

test('DECISION-PARK-WAKES (§B D2/W-1): a decision park wakes a waiter registered before the park', async (t) => {
  const fx = await wakeFixture(t, { adapter: new WorkflowAdapter(DECISION_SCENARIO) });
  const { owner, runId } = await startWaveRun(fx);
  const pending = tracked(wake(fx, runId, { timeoutMs: 5000 }, owner));
  const decision = await parkedDecision(fx, runId, owner);
  const settled = await pending;
  assert.ok(settled.ok,
    `stage[attention-wait-command-missing]: attention.wait must dispatch (threw ${settled.error?.code ?? ''})`);
  assert.equal(settled.value.woken, true, 'the decision park wakes the waiter in the same tick');
  const item = (settled.value.actions ?? []).find((a) => a.kind === 'answer_decision' && a.requestId === decision.requestId);
  assert.ok(item, 'the wake carries the parked decision as an actionable item');
});

test('DECISION-FIRST-SHAPE (§B D2.1): actions[0] mirrors projectDecisionAttention plus the answer address', async (t) => {
  const fx = await wakeFixture(t, { adapter: new WorkflowAdapter(DECISION_SCENARIO) });
  const { owner, runId } = await startWaveRun(fx);
  const decision = await parkedDecision(fx, runId, owner);
  const settled = await tracked(wake(fx, runId, { timeoutMs: 5000 }, owner));
  assert.ok(settled.ok,
    `stage[attention-wait-command-missing]: attention.wait must dispatch (threw ${settled.error?.code ?? ''})`);
  const result = settled.value;
  assert.equal(result.schemaVersion, 1, 'the woken payload is schemaVersion 1');
  assert.equal(result.woken, true, 'woken');
  assert.equal(result.timedOut, false, 'not timed out');
  assert.deepEqual(Object.keys(result).sort(), WOKEN_KEYS, 'the woken payload has the exact key set');
  const item = (result.actions ?? []).find((a) => a.kind === 'answer_decision' && a.requestId === decision.requestId);
  assert.ok(item, 'the answer_decision item rides the wake payload');
  assert.deepEqual(item, {
    kind: 'answer_decision',
    runId,
    workerId: decision.workerId,
    requestId: decision.requestId,
    question: decision.question,
    options: decision.options,
    allowFreeResponse: decision.allowFreeResponse,
    recommended: decision.recommended,
    deadlineAt: decision.deadlineAt,
    answer: { command: 'run.answer', runId, requestId: decision.requestId },
  }, 'the item mirrors projectDecisionAttention verbatim plus the direct-answer address');
  assert.ok(Number.isSafeInteger(decision.deadlineAt), 'deadlineAt is an epoch-ms number');
  assert.equal(result.wave?.state, 'open', 'the #132 registry row projects state open for a live wave');
  assert.equal(typeof result.wave?.waveId, 'string', 'the registry row names its wave');
  assert.ok(Array.isArray(result.waitingOn), 'waitingOn is an array of per-member deltas');
  for (const entry of result.waitingOn) {
    assert.equal(typeof entry.runId, 'string', 'each delta names its member run');
    assert.ok(entry.kind === null || typeof entry.kind === 'string', 'each delta carries kind|null');
  }
});

test('ANSWER-FROM-WAKE (§B D2.2/W-3): answering the wake item receipts applied', async (t) => {
  const fx = await wakeFixture(t, { adapter: new WorkflowAdapter(DECISION_SCENARIO) });
  const { owner, runId } = await startWaveRun(fx);
  const decision = await parkedDecision(fx, runId, owner);
  const settled = await tracked(wake(fx, runId, { timeoutMs: 5000 }, owner));
  assert.ok(settled.ok,
    `stage[attention-wait-command-missing]: attention.wait must dispatch (threw ${settled.error?.code ?? ''})`);
  const item = (settled.value.actions ?? []).find((a) => a.kind === 'answer_decision' && a.requestId === decision.requestId);
  assert.ok(item, 'the wake item carries the answer address');
  const view = await fx.application.command('run.answer', {
    runId, requestId: item.requestId, answer: { optionId: item.options[0].id },
  }, owner, null);
  assert.deepEqual(view.lastAction, { command: 'run.answer', requestId: item.requestId, result: 'applied' },
    'the answer is receipted applied');
});

test('ALREADY-RESOLVED (§B D2.2 PIN): the run.answer receipt path is byte-identical; a late answerer reads already_resolved', async (t) => {
  const fx = await wakeFixture(t, { adapter: new WorkflowAdapter(DECISION_SCENARIO) });
  const { owner, runId } = await startWaveRun(fx);
  const decision = await parkedDecision(fx, runId, owner);
  const first = await fx.application.command('run.answer', {
    runId, requestId: decision.requestId, answer: { optionId: 'opt-a' },
  }, owner, null);
  assert.deepEqual(first.lastAction, { command: 'run.answer', requestId: decision.requestId, result: 'applied' },
    'the first answer is applied (pinned)');
  const second = await fx.application.command('run.answer', {
    runId, requestId: decision.requestId, answer: { optionId: 'opt-b' },
  }, principalOf('late-answerer'), null);
  assert.equal(second.lastAction?.command, 'run.answer', 'the late answerer sees the same command');
  assert.equal(second.lastAction?.requestId, decision.requestId, 'the late answerer sees the same requestId');
  assert.equal(second.lastAction?.result, 'already_resolved',
    'a late answerer receipts already_resolved — a DISTINCT typed result, never a generic error (pinned)');
});

test('REVALIDATED (§B D2.3/F4): a decision answered between delivery trips is never re-delivered (stale-payload revalidation)', async (t) => {
  const fx = await wakeFixture(t, { adapter: new WorkflowAdapter(DECISION_SCENARIO) });
  const { owner, runId } = await startWaveRun(fx);
  const decision = await parkedDecision(fx, runId, owner);
  // Trip 1: the wake delivers the parked decision as an actionable item — the payload is held.
  const t1 = await tracked(wake(fx, runId, { storeCursor: 0, reasonsCursor: 0, timeoutMs: 5000 }, owner));
  assert.ok(t1.ok,
    `stage[attention-wait-command-missing]: attention.wait must dispatch (threw ${t1.error?.code ?? ''})`);
  const item = (t1.value.actions ?? []).find((a) => a.kind === 'answer_decision' && a.requestId === decision.requestId);
  assert.ok(item, 'the first trip delivers the parked decision');
  // The answer lands between the two delivery trips — the item is now resolved in the store.
  const answered = await fx.application.command('run.answer', {
    runId, requestId: decision.requestId, answer: { optionId: 'opt-a' },
  }, owner, null);
  assert.equal(answered.lastAction?.result, 'applied', 'the decision is answered before the re-trip');
  // Trip 2: re-wake with the SAME storeCursor (0) — the item is inside the page window, so a
  // revalidating impl must re-check its live state at delivery and filter the resolved item
  // (F4). A stale-cache impl that builds from a registration-time page re-delivers it.
  const t2 = await tracked(wake(fx, runId, { storeCursor: 0, reasonsCursor: 0, timeoutMs: 5000 }, owner));
  assert.ok(t2.ok, 'the re-trip wake must dispatch');
  const redelivered = (t2.value.actions ?? []).filter((a) => a.kind === 'answer_decision' && a.requestId === decision.requestId);
  assert.equal(redelivered.length, 0,
    'a decision answered between delivery trips is never re-delivered — the payload is revalidated, never a stale registration page (F4)');
});

// ===========================================================================
// Section C — the B1 cursor split and the D1.6 reasons notifier.
// ===========================================================================

test('CURSOR-SHAPE (§C B1): storeCursor and reasonsCursor are distinct continuation tokens', async (t) => {
  const fx = await wakeFixture(t, { adapter: new WorkflowAdapter(DECISION_SCENARIO) });
  const { owner, runId } = await startWaveRun(fx);
  const decision = await parkedDecision(fx, runId, owner);
  assert.ok(decision, 'the decision parks so the store has something to page');
  const settled = await tracked(wake(fx, runId, { storeCursor: 0, reasonsCursor: 0, timeoutMs: 5000 }, owner));
  assert.ok(settled.ok,
    `stage[attention-wait-command-missing]: attention.wait must dispatch (threw ${settled.error?.code ?? ''})`);
  const result = settled.value;
  assert.ok(Number.isSafeInteger(result.storeCursor) && result.storeCursor > 0,
    'the store cursor advances past the decision park');
  assert.ok(Number.isSafeInteger(result.reasonsCursor), 'the reasons cursor stays in its own space');
  assert.notEqual(result.storeCursor, result.reasonsCursor,
    'the two cursors are never folded into one token (B1)');
});

test('RETURN-TRIP (§C B1/D1.6): a return-trip orchestrator still sees member_terminal with the prior cursors', async (t) => {
  // F1 fold: the fixture clock is injected and ADVANCED past the 500ms storm-coalescing window
  // (ATTENTION_COALESCE_WINDOW_MS, coordinator.mjs:46) between the two emits — never a real
  // sleep(600) (the #7 class the brief bans). createDriver forwards `now` into the Coordinator
  // (index.mjs:1488), so the member-terminal mint timestamps are driven deterministically.
  const clock = controllableClock();
  const fx = await wakeFixture(t, { now: clock }); // quiet ScriptableAdapter; every epoch is harness-driven
  const { owner, runId } = await startWaveRun(fx);
  const worker = await dispatchedWorker(fx, runId);
  fx.adapter.emit({
    worker: worker.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed',
    actor: 'worker', payload: { status: 'completed', output: 'done' },
  });
  await flush(80);
  const s1 = await tracked(wake(fx, runId, { timeoutMs: 5000 }, owner));
  assert.ok(s1.ok,
    `stage[attention-wait-command-missing]: attention.wait must dispatch (threw ${s1.error?.code ?? ''})`);
  assert.equal(s1.value.woken, true, 'the terminal mint wakes the first trip');
  const r1 = (s1.value.reasons ?? []).find((r) => r.kind === 'member_terminal');
  assert.ok(r1, 'the first wake delivers the member_terminal reason');
  // Past ATTENTION_COALESCE_WINDOW_MS (500): the same worker is already terminal, so the
  // second turn_completed is a REASON-ONLY mint (D1.6) — no store append, a fresh reason seq.
  clock.advance(600);
  fx.adapter.emit({
    worker: worker.id, harness: 'mock@1.0.0', turnEpoch: 2, kind: 'lifecycle.turn_completed',
    actor: 'worker', payload: { status: 'completed', output: 'done' },
  });
  await flush(80);
  const s2 = await tracked(wake(fx, runId, {
    storeCursor: s1.value.storeCursor, reasonsCursor: s1.value.reasonsCursor, timeoutMs: 5000,
  }, owner));
  assert.ok(s2.ok, 'the return-trip wake must dispatch');
  assert.equal(s2.value.woken, true, 'the reason-only mint wakes the return-trip orchestrator (D1.6)');
  const r2 = (s2.value.reasons ?? []).find((r) => r.kind === 'member_terminal');
  assert.ok(r2, 'the return-trip wake still sees member_terminal (the mixed-cursor invisibility is dead)');
  assert.ok(r2.seq > r1.seq, 'the new reason carries a fresh seq past the prior reasonsCursor');
});

test('REASONS-ALONE (§C D1.3): a reason wake is reason-only, and the honest-empty continuation echoes the cursors', async (t) => {
  const fx = await wakeFixture(t);
  const { owner, runId } = await startWaveRun(fx);
  const worker = await dispatchedWorker(fx, runId);
  fx.adapter.emit({
    worker: worker.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed',
    actor: 'worker', payload: { status: 'completed', output: 'done' },
  });
  await flush(80);
  const s1 = await tracked(wake(fx, runId, { timeoutMs: 5000 }, owner));
  assert.ok(s1.ok,
    `stage[attention-wait-command-missing]: attention.wait must dispatch (threw ${s1.error?.code ?? ''})`);
  assert.equal(s1.value.woken, true, 'the terminal mint wakes the waiter');
  assert.deepEqual(s1.value.actions, [], 'a terminal mint carries no actionable item');
  const r1 = (s1.value.reasons ?? []).find((r) => r.kind === 'member_terminal');
  assert.ok(r1, 'the reason rides the wake payload');
  const s2 = await tracked(wake(fx, runId, {
    storeCursor: s1.value.storeCursor, reasonsCursor: s1.value.reasonsCursor, timeoutMs: 300,
  }, owner));
  assert.ok(s2.ok, 'the continuation wake must dispatch');
  assert.equal(s2.value.woken, false, 'nothing past the cursors — honest empty');
  assert.equal(s2.value.timedOut, true, 'the transport bound');
  assert.deepEqual(Object.keys(s2.value).sort(), HONEST_EMPTY_KEYS, 'the honest empty echoes the six sorted keys');
  assert.equal(s2.value.storeCursor, s1.value.storeCursor, 'the store cursor echoes unchanged');
  assert.equal(s2.value.reasonsCursor, s1.value.reasonsCursor, 'the reasons cursor echoes unchanged');
});

// ===========================================================================
// Section D — candidacy_review: B2's stable identity (minted once, refreshed in place).
// At HEAD _attentionPage mints it LIVE per page read (coordinator.mjs:7098-7117) — the B2
// defect. Every row fails at stage[attention-wait-command-missing] (no wake surface).
// ===========================================================================

test('CANDIDACY-WAKE (§D D1.2/B2): a board-close candidacy wakes the review authority', async (t) => {
  const fx = await wakeFixture(t);
  const { owner, runId } = await startWaveRun(fx);
  admitCandidacy(fx, 1);
  const queue = fx.coordination.knowledgeCandidateQueue({});
  assert.equal(queue.count, 1, 'the board-close admission lands in the repo-scoped candidacy queue');
  const settled = await tracked(wake(fx, runId, { timeoutMs: 5000 }, owner));
  assert.ok(settled.ok,
    `stage[attention-wait-command-missing]: attention.wait must dispatch (threw ${settled.error?.code ?? ''})`);
  assert.equal(settled.value.woken, true, 'the candidacy wakes the review authority');
  const reason = (settled.value.reasons ?? []).find((r) => r.kind === 'candidacy_review');
  assert.ok(reason, 'candidacy_review rides the wake as a reason');
  assert.equal(reason.runId, runId, 'the reason names its run');
  assert.ok(Array.isArray(reason.candidates), 'the reason carries the candidate list');
  assert.ok(reason.candidates.includes('knowledge:wake-cand-1'), 'the admitted candidate is disclosed');
});

test('CANDIDACY-HONEST-EMPTY (§D D1.3/B2): with a live candidacy queue the honest empty is REACHABLE', async (t) => {
  const fx = await wakeFixture(t);
  const { owner, runId } = await startWaveRun(fx);
  admitCandidacy(fx, 1);
  const s1 = await tracked(wake(fx, runId, { timeoutMs: 5000 }, owner));
  assert.ok(s1.ok,
    `stage[attention-wait-command-missing]: attention.wait must dispatch (threw ${s1.error?.code ?? ''})`);
  assert.equal(s1.value.woken, true, 'the first wake pages the candidacy');
  const r1 = (s1.value.reasons ?? []).find((r) => r.kind === 'candidacy_review');
  assert.ok(r1, 'the candidacy reason is delivered');
  // The second wake re-pages with the prior cursors. B2's stable-identity candidacy_review is
  // NOT re-minted, so nothing is past reasonsCursor -> honest empty. The live per-page mint
  // at HEAD would emit a fresh seq and wake again.
  const s2 = await tracked(wake(fx, runId, {
    storeCursor: s1.value.storeCursor, reasonsCursor: s1.value.reasonsCursor, timeoutMs: 300,
  }, owner));
  assert.ok(s2.ok, 'the continuation wake must dispatch');
  assert.equal(s2.value.woken, false, 'the stable-identity candidacy makes the honest empty reachable (B2)');
  assert.deepEqual(Object.keys(s2.value).sort(), HONEST_EMPTY_KEYS, 'the honest empty echoes the six sorted keys');
});

test('CANDIDACY-REFRESH (§D B2): a queue-count change refreshes the SAME candidacy_review in place', async (t) => {
  const fx = await wakeFixture(t);
  const { owner, runId } = await startWaveRun(fx);
  admitCandidacy(fx, 1);
  const s1 = await tracked(wake(fx, runId, { timeoutMs: 5000 }, owner));
  assert.ok(s1.ok,
    `stage[attention-wait-command-missing]: attention.wait must dispatch (threw ${s1.error?.code ?? ''})`);
  const r1 = (s1.value.reasons ?? []).find((r) => r.kind === 'candidacy_review');
  assert.ok(r1, 'the first wake pages the candidacy');
  assert.equal(r1.count, 1, 'the reason reports one candidate');
  admitCandidacy(fx, 2);
  assert.equal(fx.coordination.knowledgeCandidateQueue({}).count, 2, 'the second admission lands');
  // F9 fold: yield a macrotask so a B2 count-refresh delivered on a macrotask notifier lands
  // before the re-wake pages the stable-identity candidacy_review — a settled boundary, never a
  // clock or a workflow gate. The queue-count assert above already pins the admission.
  await yieldMacrotask();
  const s2 = await tracked(wake(fx, runId, { timeoutMs: 5000 }, owner));
  assert.ok(s2.ok, 'the re-wake must dispatch');
  const r2 = (s2.value.reasons ?? []).find((r) => r.kind === 'candidacy_review');
  assert.ok(r2, 'the candidacy rides the re-wake');
  assert.equal(r2.count, 2, 'the reason reports the refreshed count');
  assert.equal(r2.seq, r1.seq, 'the refresh keeps the SAME seq — the B2 stable identity, never a fresh mint');
});

// ===========================================================================
// Section E — D3 authority: wave-owner always; run-scoped admits the live lease holder;
// no claim-on-read (two waiters page the same item; the first answer wins).
// ===========================================================================

test('WORKER-REFUSED (§E D3/F5): a worker principal cannot call the wake — even claiming an orchestrator class', async (t) => {
  const fx = await wakeFixture(t);
  const { runId } = await startWaveRun(fx);
  const err = await laneError(() => wake(fx, runId, { timeoutMs: 2500 }, principalOf('worker-1')));
  assert.ok(err && err.code !== 'application_command_unavailable',
    `stage[attention-wait-command-missing]: the wake must exist to authorize (got ${err?.code ?? 'resolved'})`);
  assert.equal(err.code, 'attention_scope_forbidden',
    'a worker principal is refused by name — never a generic error');
  // F5 fold: the claimed orchestrator class rides the ACTOR field. normalizePrincipal
  // (application.mjs:1107) admits {actor, principalId, sessionId} and REJECTS unknown fields —
  // a `role` field would draw application_authority_invalid before the dispatch tail and break
  // the red-first property. The authority is the principal identity (wave-owner or the live
  // run-scoped lease), never a caller-claimed class.
  const claimed = { ...principalOf('worker-1'), actor: 'orchestrator:worker-1' };
  const err2 = await laneError(() => wake(fx, runId, { timeoutMs: 2500 }, claimed));
  assert.ok(err2 && err2.code !== 'application_command_unavailable',
    'the claimed-class worker wake must dispatch to authorize');
  assert.equal(err2.code, 'attention_scope_forbidden',
    'a worker claiming an orchestrator class in its actor is still refused by name (F5)');
});

test('AUTHORITY-RUN-SCOPED (§E D3/F5): a live lease on run A never authorizes run B\'s wake', async (t) => {
  const fx = await wakeFixture(t);
  const { runId: runA } = await startWaveRun(fx);
  const { runId: runB } = await startWaveRun(fx);
  authorityOn(fx, { runId: runA, principalId: 'lease-holder', sessionId: 'session-lease-holder' });
  const leasePrincipal = principalOf('lease-holder');
  // The live lease holder is admitted on its OWN run (lease.parent.runId === runId).
  const onA = await tracked(wake(fx, runA, { timeoutMs: 5000 }, leasePrincipal));
  assert.ok(onA.ok,
    `stage[attention-wait-command-missing]: attention.wait must dispatch for the lease holder (threw ${onA.error?.code ?? ''})`);
  // F5 fold: the authority is RUN-SCOPED — a lease on run A never admits run B's wake, even
  // though the holder holds *a* live lease (the any-live-lease attack dies here).
  const err = await laneError(() => wake(fx, runB, { timeoutMs: 2500 }, leasePrincipal));
  assert.equal(err.code, 'attention_scope_forbidden',
    'a run A lease never authorizes run B\'s wake — never any-live-lease (F5)');
});

test('TWO-WAITERS (§E D3): the wave-owner and a lease holder both wake; no claim-on-read', async (t) => {
  const fx = await wakeFixture(t, { adapter: new WorkflowAdapter(DECISION_SCENARIO) });
  const { owner, runId } = await startWaveRun(fx);
  authorityOn(fx, { runId, principalId: 'lease-holder', sessionId: 'session-lease-holder' });
  const leasePrincipal = principalOf('lease-holder');
  const w1 = tracked(wake(fx, runId, { timeoutMs: 5000 }, owner));
  const w2 = tracked(wake(fx, runId, { timeoutMs: 5000 }, leasePrincipal));
  const decision = await parkedDecision(fx, runId, owner);
  const [s1, s2] = [await w1, await w2];
  assert.ok(s1.ok && s2.ok,
    `stage[attention-wait-command-missing]: both waiters must dispatch (owner: ${s1.error?.code ?? 'ok'}, lease: ${s2.error?.code ?? 'ok'})`);
  assert.equal(s1.value.woken, true, 'the owner wakes');
  assert.equal(s2.value.woken, true, 'the live lease holder wakes');
  const item1 = (s1.value.actions ?? []).find((a) => a.kind === 'answer_decision' && a.requestId === decision.requestId);
  const item2 = (s2.value.actions ?? []).find((a) => a.kind === 'answer_decision' && a.requestId === decision.requestId);
  assert.ok(item1 && item2, 'both waiters page the same actionable item (no claim-on-read)');
  const first = await fx.application.command('run.answer', {
    runId, requestId: decision.requestId, answer: { optionId: 'opt-a' },
  }, owner, null);
  assert.equal(first.lastAction?.result, 'applied', 'the first answer wins');
  const second = await fx.application.command('run.answer', {
    runId, requestId: decision.requestId, answer: { optionId: 'opt-b' },
  }, leasePrincipal, null);
  assert.equal(second.lastAction?.result, 'already_resolved', 'the late answerer receipts already_resolved');
});

// ===========================================================================
// Section F — W-5: a reply-chain hop does not wake; a blocking escalation does.
// ===========================================================================

test('REPLY-NO-WAKE (§F W-5): a reply hop advances the store but the wake honest-empties', async (t) => {
  const fx = await wakeFixture(t);
  const { owner, runId } = await startWaveRun(fx);
  const worker = await dispatchedWorker(fx, runId);
  const headBefore = fx.coordination.events().length;
  const sent = await fx.driver.coordinator.sendMessage({
    kind: 'query', to: { workerId: worker.id }, body: 'request details?',
  }, { actor: 'orchestrator' });
  assert.ok(sent.messageId, 'the orchestrator message is admitted');
  fx.adapter.emit({
    worker: worker.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'message.send',
    actor: 'worker', payload: { inReplyTo: sent.messageId, body: 'here are the details' },
  });
  await flush(80);
  assert.ok(fx.coordination.events().length > headBefore, 'the send+reply hops advance the store seq');
  const settled = await tracked(wake(fx, runId, { timeoutMs: 300 }, owner));
  assert.ok(settled.ok,
    `stage[attention-wait-command-missing]: attention.wait must dispatch (threw ${settled.error?.code ?? ''})`);
  const result = settled.value;
  assert.deepEqual(Object.keys(result).sort(), HONEST_EMPTY_KEYS,
    'a reply-chain hop is never a wake reason (D1.2/D5) — the wake honest-empties');
  assert.equal(result.woken, false, 'no actionable item, no reason');
  assert.equal(result.timedOut, true, 'the transport bound');
  assert.equal(result.storeCursor, 0, 'the store cursor stays unchanged on the honest empty');
});

test('BLOCKING-ESCALATES (§F W-5): a blocking question escalates as an answer_question actionable item', async (t) => {
  const fx = await wakeFixture(t, { adapter: new WorkflowAdapter(BLOCKING_QUESTION_SCENARIO) });
  const { owner, runId } = await startWaveRun(fx);
  const parked = await parkedBlockingQuestion(fx, runId, owner);
  assert.equal(parked.kind, 'answer_question', 'the blocking question parks');
  const settled = await tracked(wake(fx, runId, { timeoutMs: 5000 }, owner));
  assert.ok(settled.ok,
    `stage[attention-wait-command-missing]: attention.wait must dispatch (threw ${settled.error?.code ?? ''})`);
  const item = (settled.value.actions ?? []).find((a) => a.kind === 'answer_question');
  assert.ok(item, 'the blocking escalation rides the wake as an answer_question item (D5.4)');
  assert.equal(item.runId, runId, 'the interaction resolves inside its own run');
  assert.equal(typeof item.requestId, 'string', 'the item carries the interaction identity');
  assert.ok(Buffer.byteLength(item.question) > 0, 'the question text rides the item');
  assert.deepEqual(item.answer, { command: 'run.answer', runId, requestId: item.requestId },
    'the direct-answer address is closed');
});

// ===========================================================================
// Section G — W-6 closed sets. WAKE_REASONS is RED (absent at HEAD); the other two are
// green-at-HEAD pins that MUST stay byte-unchanged.
// ===========================================================================

test('WAKE-REASONS-SET (§G W-6): the closed wake-reason set is the frozen ACTUAL-sorted eight', () => {
  assert.ok(applicationSemanticsNs.WAKE_REASONS,
    'stage[WAKE_REASONS-missing]: application-semantics.mjs must export WAKE_REASONS (RED — absent at HEAD)');
  assert.ok(Object.isFrozen(applicationSemanticsNs.WAKE_REASONS), 'WAKE_REASONS is frozen');
  assert.deepEqual([...applicationSemanticsNs.WAKE_REASONS], WAKE_REASONS_SORTED,
    'exactly the eight wake classes in ACTUAL sorted order (a sort()/localeCompare-derived order is a violation)');
});

test('WAITING-ON-KINDS-PIN (§G W-6): the #10 closed five are byte-unchanged', () => {
  assert.ok(Object.isFrozen(applicationSemanticsNs.WAITING_ON_KINDS), 'WAITING_ON_KINDS stays frozen');
  assert.deepEqual([...applicationSemanticsNs.WAITING_ON_KINDS], WAITING_ON_KINDS_SORTED,
    'the closed five stay in ACTUAL sorted order (decision_pending stays OUT — G7)');
});

test('ATTENTION-TYPES-PIN (§G W-6): the #10-era inbox vocabulary is byte-unchanged in ACTUAL order', () => {
  assert.ok(Object.isFrozen(ATTENTION_TYPES), 'ATTENTION_TYPES stays frozen');
  assert.deepEqual([...ATTENTION_TYPES], ATTENTION_TYPES_ACTUAL,
    'the closed five stay in ACTUAL order (G8)');
});

// ===========================================================================
// Section H — surfaces (D4): MCP tool + schema + capability, web envelope + ceiling, CLI.
// ===========================================================================

test('MCP-TOOL (§H D4): the ordinary MCP tool row advertises baton_attention_wait', () => {
  const names = mcpApplicationToolNames();
  assert.ok(names.includes('baton_attention_wait'),
    'stage[baton-attention-wait-tool-missing]: mcpApplicationToolNames() must include baton_attention_wait (RED — absent at HEAD)');
});

test('MCP-SCHEMA-CAPABILITY (§H D4): the wake tool carries the split-cursor schema and the observe capability', () => {
  const mcpSrc = readFileSync(new URL('../src/mcp-northbound.mjs', import.meta.url), 'utf8');
  assert.ok(/name:\s*'baton_attention_wait'/.test(mcpSrc),
    'stage[baton-attention-wait-tool-missing]: the ordinary MCP tool row must exist');
  assert.ok(/baton_attention_wait[\s\S]{0,5000}storeCursor[\s\S]{0,1000}reasonsCursor/.test(mcpSrc),
    'the wake inputSchema carries the B1 split cursor {storeCursor, reasonsCursor} (never one folded token)');
  assert.ok(/baton_attention_wait:\s*\['observe'\]/.test(mcpSrc),
    'the wake tool declares the observe capability (D4.1)');
});

test('WEB-ENVELOPE (§H D4): the web command envelope admits attention_wait', () => {
  const admission = validateWebCommandEnvelope(webEnvelope(1000));
  assert.notEqual(admission, 'unsupported command',
    `stage[web-envelope-missing]: the attention_wait envelope must be admitted (got: ${admission ?? 'null'})`);
  assert.equal(admission, null, 'a valid wake envelope validates clean');
});

test('WEB-CEILING (§H D4): a web wake past the 30s ceiling refuses by the pinned code', () => {
  const ceiling = validateWebCommandEnvelope(webEnvelope(30001));
  assert.notEqual(ceiling, 'unsupported command',
    `stage[web-envelope-missing]: the attention_wait envelope must be admitted before the ceiling applies (got: ${ceiling ?? 'null'})`);
  assert.equal(ceiling, 'application_attention_wait_timeout_exceeds_web_ceiling',
    'timeoutMs above the 30s web ceiling refuses by the wake-named code (D4.2)');
});

test('MCP-CEILING (§H D4/F3): the wake tool joins the TIGHT ceiling guard beside invalid_run_wait', () => {
  const mcpSrc = readFileSync(new URL('../src/mcp-northbound.mjs', import.meta.url), 'utf8');
  assert.ok(/invalid_run_wait[\s\S]{0,600}'baton_attention_wait'/.test(mcpSrc)
    || /'baton_attention_wait'[\s\S]{0,600}invalid_run_wait/.test(mcpSrc),
    'stage[baton-attention-wait-tool-missing]: baton_attention_wait must sit beside the invalid_run_wait ceiling guard (F3) — a timeoutMs past the 30s ceiling refuses by name through the MCP dispatch, never a generic error');
});

test('WAKE-ABORT (§H H7/F3): an in-flight wake aborted by the transport settles the wake-cancelled receipt', async (t) => {
  const fx = await wakeFixture(t); // quiet run — the wake genuinely parks on the store, then the transport aborts
  const { owner, runId } = await startWaveRun(fx);
  const ac = new AbortController();
  const pending = tracked(wake(fx, runId, {
    storeCursor: 0, reasonsCursor: 0, timeoutMs: 5000, signal: ac.signal,
  }, owner));
  await flush(80); // a settled boundary so the wake anchors its waitAfter on the store
  ac.abort();
  const settled = await pending;
  assert.ok(settled.error?.code !== 'application_command_unavailable',
    `stage[attention-wait-command-missing]: attention.wait must dispatch (got ${settled.error?.code ?? 'resolved'})`);
  assert.equal(settled.error?.code, 'application_attention_wait_cancelled',
    'an aborted in-flight wake settles the wake-cancelled receipt — never a generic error, never the raw coordination_wait_aborted (H7/F3)');
});

test('CLI-GRAMMAR (§H D4): baton run attention wait parses the wake verb with both cursors', () => {
  let parsed;
  try {
    parsed = parseBatonCli(['run', 'attention', 'wait', 'run:cli-wake',
      '--timeout', '1000', '--store-cursor', '3', '--reasons-cursor', '7', '--kind', 'answer_decision']);
  } catch (error) {
    parsed = { __threw: error };
  }
  assert.ok(!parsed.__threw,
    `stage[cli-grammar-missing]: baton run attention wait must parse (threw: ${parsed.__threw?.message})`);
  assert.equal(parsed.kind, 'command', 'the CLI emits a command');
  assert.equal(parsed.name, 'attention.wait', 'the CLI verb maps to the wake command name');
  assert.deepEqual(parsed.args, {
    runId: 'run:cli-wake', timeoutMs: 1000, storeCursor: 3, reasonsCursor: 7, kind: 'answer_decision',
  }, 'the flat grammar carries runId, timeoutMs, and both cursors');
});

// ===========================================================================
// Section I — limits (W-8): byte-unchanged frame pins, the oversize refusal, and the
// MAX_ATTENTION actions slice.
// ===========================================================================

test('LIMITS-PIN (§I W-8): the decision/view limits are byte-unchanged', () => {
  assert.equal(FRAME_LIMITS['decision.question'].value, 2048, 'decision.question stays 2048');
  assert.equal(FRAME_LIMITS['decision.option.label'].value, 160, 'decision.option.label stays 160');
  assert.equal(FRAME_LIMITS['decision.option.summary'].value, 512, 'decision.option.summary stays 512');
  assert.equal(FRAME_LIMITS['decision.text'].value, 4096, 'decision.text stays 4096');
  assert.equal(FRAME_LIMITS['view.attention_text.bytes'].value, 4096, 'view.attention_text.bytes stays 4096');
});

test('OVERSIZE-REFUSAL (§I D6): a wake whose serialized payload exceeds the frame cap refuses the pinned code', async (t) => {
  const fx = await wakeFixture(t, { adapter: new WorkflowAdapter(OVERSIZE_DECISION_SCENARIO), profile: PROFILE_TINY });
  const { owner, runId } = await startWaveRun(fx);
  const decision = await parkedDecision(fx, runId, owner);
  assert.ok(Buffer.byteLength(decision.question) < 2048, 'the question parks under the admission bound');
  const settled = await tracked(wake(fx, runId, { timeoutMs: 5000 }, owner));
  assert.ok(settled.error?.code !== 'application_command_unavailable',
    `stage[attention-wait-command-missing]: attention.wait must dispatch (got ${settled.error?.code ?? 'resolved'})`);
  assert.equal(settled.error?.code, 'application_attention_wait_oversize',
    'a payload past the frame cap refuses by the D6 oversize code');
});

test('ACTIONS-SLICE (§I H6/F6): the wake actions builder slices the ACTIONS operand to MAX_ATTENTION and spills the head+digest', () => {
  const appSrc = readFileSync(new URL('../src/application.mjs', import.meta.url), 'utf8');
  const dispatchIndex = appSrc.indexOf("'attention.wait'");
  assert.ok(dispatchIndex >= 0,
    'stage[attention-wait-command-missing]: the application dispatch must carry an attention.wait branch (RED — absent at HEAD)');
  const wakeRegion = appSrc.slice(dispatchIndex, dispatchIndex + 30000);
  // F6 fold: anchor the slice on the ACTIONS operand — slicing `reasons` (or `waitingOn`) to
  // MAX_ATTENTION inside the wake region must NOT pass the row.
  assert.ok(/actions:\s*[^.\n]*\.slice\(0,\s*MAX_ATTENTION\)/.test(wakeRegion),
    'the wake actions builder must slice the ACTIONS operand to MAX_ATTENTION (H6/F6) — never reasons, never waitingOn');
  assert.ok(/(spilled|digest)/.test(wakeRegion),
    'the bounded-actions head spills with a digest (H6/F6) — the remainder is disclosed, never silently dropped');
});

// ===========================================================================
// Section J — W-9 guarantee-pin (P5): no wake-worthy STORE change is store-invisible.
// Plan proposal + candidacy admission are verifiable at HEAD; a decision park is
// store-invisible at HEAD (probe-confirmed delta 0 — see fold-2 F7), so the pin covers
// only the two transitions that genuinely append. The F7 reconciliation: the park is
// wake-visible ONLY via the reason lane (answer_decision), and W-9's store-visibility
// principle applies to the two appending transitions; the park's store-invisibility is
// an accepted v1.1 boundary recorded in the draft notes, not a pin gap.
// ===========================================================================

test('STORE-VISIBLE (§J W-9 PIN): plan proposal and candidacy admission each advance the store seq', async (t) => {
  const fx = await wakeFixture(t, { adapter: new WorkflowAdapter(DECISION_SCENARIO) });
  const head = () => fx.coordination.events().length;
  const baseline = head();
  const { runId } = await startWaveRun(fx);
  const afterPropose = head();
  assert.ok(afterPropose > baseline, 'a plan proposal advances the store seq (plan.version_proposed)');
  admitCandidacy(fx, 1);
  const afterCandidacy = head();
  assert.ok(afterCandidacy > afterPropose, 'a candidacy admission advances the store seq (knowledge.node_added)');
  assert.ok(runId, 'the wave run exists');
});

// ===========================================================================
// Section K — the D6 refusal vocabulary and the H8 allowlist nuance.
// ===========================================================================

test('WAIT-INVALID (§K D6): the NEW attention_wait_invalid code is refused by name, never a generic code', async (t) => {
  const fx = await wakeFixture(t);
  const { owner, runId } = await startWaveRun(fx);
  const err = await laneError(() => wake(fx, 'not a run id', { timeoutMs: 1000 }, owner));
  assert.ok(err && err.code !== 'application_command_unavailable',
    `stage[attention-wait-command-missing]: the wake must exist to validate (got ${err?.code ?? 'resolved'})`);
  assert.equal(err.code, 'attention_wait_invalid',
    'a malformed runId draws the wake-specific code — never application_command_invalid');
  assert.ok(!String(err.code).startsWith('application_'),
    'attention_wait_invalid has no application_ prefix (H8: it needs its own allowlist row)');
});

test('MCP-ALLOWLIST (§K H8): the stateFailureCode allowlist carries attention_wait_invalid', () => {
  const mcpSrc = readFileSync(new URL('../src/mcp-northbound.mjs', import.meta.url), 'utf8');
  assert.ok(/attention_wait_invalid/.test(mcpSrc),
    'stage[mcp-allowlist-missing]: the stateFailureCode allowlist must carry attention_wait_invalid (H8 — RED at HEAD)');
});

test('EXISTING-PINS (§K PIN): attention_scope_forbidden and application_attention_watch_invalid survive', async (t) => {
  const fx = await wakeFixture(t);
  const { owner, runId } = await startWaveRun(fx);
  const scope = await laneError(() => fx.driver.coordinator.attentionFollow(
    { scope: { runId }, targets: [], afterCursor: 0, timeoutMs: 1 },
    principalOf('stranger'),
  ));
  assert.equal(scope?.code, 'attention_scope_forbidden',
    'attention_scope_forbidden survives — a stranger is refused by name (pinned)');
  const watch = await laneError(() => fx.application.command(
    'run.attention.watch', { runId, cursor: -1 }, owner, null,
  ));
  assert.equal(watch?.code, 'application_attention_watch_invalid',
    'application_attention_watch_invalid survives — the page-read normalizer is untouched (pinned)');
});
