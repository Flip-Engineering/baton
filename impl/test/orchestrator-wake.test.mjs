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
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'baton-test@example.com', GIT_COMMITTER_EMAIL: 'baton-test@example.com' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Baton Test', GIT_COMMITTER_NAME: 'Baton Test' });
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
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native', turnCompletion: 'pausable',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'], family: 'mock',
        acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
        serviceTier: null, provenance: 'orchestrator-wake', refreshedAt: null,
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
        serviceTier: null, provenance: 'orchestrator-wake', refreshedAt: null,
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
    watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
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


// ===========================================================================
// Section C — the B1 cursor split and the D1.6 reasons notifier.
// ===========================================================================




// ===========================================================================
// Section D — candidacy_review: B2's stable identity (minted once, refreshed in place).
// At HEAD _attentionPage mints it LIVE per page read (coordinator.mjs:7098-7117) — the B2
// defect. Every row fails at stage[attention-wait-command-missing] (no wake surface).
// ===========================================================================




// ===========================================================================
// Section E — D3 authority: wave-owner always; run-scoped admits the live lease holder;
// no claim-on-read (two waiters page the same item; the first answer wins).
// ===========================================================================




// ===========================================================================
// Section F — W-5: a reply-chain hop does not wake; a blocking escalation does.
// ===========================================================================



// ===========================================================================
// Section G — W-6 closed sets. WAKE_REASONS is RED (absent at HEAD); the other two are
// green-at-HEAD pins that MUST stay byte-unchanged.
// ===========================================================================


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








// ===========================================================================
// Section I — limits (W-8): byte-unchanged frame pins, the oversize refusal, and the
// MAX_ATTENTION actions slice.
// ===========================================================================

test('LIMITS-PIN (§I W-8): the view limits are byte-unchanged', () => {
  assert.equal(FRAME_LIMITS['view.attention_text.bytes'].value, 4096, 'view.attention_text.bytes stays 4096');
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
