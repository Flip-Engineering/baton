// [attempt: 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc row-suite-164]
// row-suite-164 attempt 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc — red-first suite for the folded #164 blind-waits contract (v2).
// Authority: docs/reference/evidence/blind-waits-2026-08-13/blind-waits-contract.md (v1 DRAFT at HEAD) + the v2 fold directives
//   carried by the row dispatch — the wait-local terminal-truth helper per DR-1(a) with the durable-stop predicate extended to
//   the settle-block loop, the RA6/RA7 pins, the FP-05 unknown≡foreign pin, `application_wait_invalid` in the refusal table,
//   and the additive-only law. redteam-164.md and fold-164.md do not exist in this worktree (recorded in suite-draft-notes.md).
// Attempt echo: 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc · row-suite-164 · suite-draft-notes.md in the same evidence directory.
// FOLD (row-sf164, 2026-08-13): folded per the fold laws (docs/reference/evidence/fold-2026-08-13-c/foundry-brief.md)
//   against blue-team-2026-08-13-a/blueteam-164.md + blueteam-qa.md §#164; authority = the v2 FOLDED contract.
//   B1 → GREEN (H-4 fold: the loop-exit iteration IS a fresh status() re-read — no distinct return-seam
//   revalidation); P-MCP split (P-MCP RED four-verb recheck + P-MCP-ceiling GREEN); P-APP flipped to RED (D1.2(a)
//   app-layer renewal naming); A2-c/A2-d new RED rows (fleet_run_episode / fleet_run_workstreams, B3); A4 re-worked
//   to a found-anchored comment-stripped region scan; A1-a/A1-b over-stated "full clock" claim documented; P-PUBLISH
//   scoped as workflow evidence (temporally coupled to #158). Finding→resolution map: fold-suite-164.md in the same
//   evidence directory.

// ===========================================================================
// ROW INVENTORY (the stage is the HEAD failure seam, named per row; the split at
// the bottom was measured twice against the PRE-implementation tree and twice
// against the POST-fold tree)
// ===========================================================================
//
// §A — run.wait durable-stop truth (D1/D3.1/OQ2(a) — the wait-local terminal-truth helper)
//   A1-a  run.wait({until:'terminal'}) on a durably-stopped run (phase 'stopping', application.mjs:7598)
//         returns the already-projected terminal truth WITHOUT sleeping. (RED — at HEAD 'stopping' is outside
//         APPLICATION_RUN_TERMINAL_PHASES (application.mjs:160), so the loop sleeps across repeated cycles
//         (28ms actual) instead of returning on the first cycle. [blue-team SHALLOW: the v1 inventory's "burns
//         the full clock" was rhetorical — the test measures that a durably-stopped run still sleeps multiple
//         cycles, not the literal deadline; documented, not changed])
//   A1-b  run.wait({timeoutMs}) default settle-block on the SAME durably-stopped run must not sleep either —
//         the durable-stop predicate extends to the settle-block loop (the v2 fold of DR-1(a)). (RED — at HEAD
//         'stopping' is outside PROVIDER_EXECUTION_SETTLED_PHASES (application.mjs:157), same burn; same SHALLOW
//         doc note: 41ms actual across cycles, "full clock" is the rhetorical form)
//
// §B — terminal-truth pins (must stay green at HEAD)
//   A5    unknown run ids refuse application_run_not_found byte-identical, no clock (FP-05, G10 — resolve-then-authorize
//         at application.mjs:4799-4803; _findRun throws at :3486). (GREEN — kills an impl that moves the ordering or
//         conflates unknown with a dead authority)
//   A1-c  a run that terminalizes MID-wait returns the terminal view on the observing cycle — exactly ONE sleep, never
//         the deadline. (GREEN at HEAD: the per-cycle status() re-read (application.mjs:8000) observes the flip; kills a
//         snapshot-only impl that sleeps once and returns the pre-terminal view)
//   A8    terminal views carry waitingOn:null + the typed terminalCause (operator_stop for a stopped run), and the
//         canonical predicates own the vocabulary — applicationTerminal('stopping') stays FALSE (the wait-local helper
//         is ADDITIVE, never a canonical-predicate edit). (GREEN — kills an impl that edits the canonical predicates
//         instead of adding the wait-local helper)
//
// §C — transport refusals name the renewal path (D1.2/D2, G7/G8 — RED: both wait verbs + both B3 verbs each)
//   A2-a  MCP fleet_run_wait mid-wait revocation refuses `unauthenticated` AND names the renewal path. (RED — at HEAD
//         toolError(refused) is code-only, mcp-northbound.mjs:198-200 / :1505-1520)
//   A2-b  MCP fleet_run_follow — the SAME post-dispatch recheck seam, the second wait verb: the mid-wait revocation
//         refuses `unauthenticated` AND names the renewal path. (RED — an impl that fixes only fleet_run_wait leaves
//         fleet_run_follow code-only, so this row stays RED at the same stage mcp-refusal-renewal-missing)
//   A2-c  MCP fleet_run_episode — NEW RED row (fold-164 B3): a mid-wait revocation must refuse `unauthenticated` AND
//         name the renewal path on this verb too. (RED — at HEAD the post-dispatch recheck list
//         (mcp-northbound.mjs:1510) covers only fleet_run_follow/fleet_run_wait, so a mid-wait revocation on
//         fleet_run_episode is NOT refused — the dispatched value returns; stage mcp-refusal-renewal-missing)
//   A2-d  MCP fleet_run_workstreams — the second B3 verb: SAME recheck-list gap. (RED — an impl that extends the
//         recheck to episode only leaves workstreams unchecked, so this row stays RED at the same stage)
//   A3-a  web run_wait mid-wait expiry refuses 401 `unauthenticated` AND names /v1/auth/refresh. (RED — at HEAD
//         _postWaitAuthorization returns the bare error(401, unauthenticated), web-northbound.mjs:684-689)
//   A3-b  web run_follow — the SAME post-wait reauth seam (:895), the second wait verb: the mid-wait expiry refuses
//         401 `unauthenticated` AND names /v1/auth/refresh. (RED — an impl that fixes only run_wait leaves run_follow
//         bare, so this row stays RED at the same stage web-refusal-renewal-missing)
//
// §D — the return-seam + the driver pump loop (B1 GREEN per H-4; A4 RED)
//   B1    run.wait's settle-block loop exit IS a fresh status() re-read — the loop's exit iteration re-reads the
//         view and returns it directly, so NO distinct return-seam revalidation is required (H-4 fold of D2(b); the
//         v1 draft's "(b) distinct return-seam revalidation" was folded OUT as redundant and layer-confused).
//         (GREEN — pins the loop-exit shape: `await this.status(runId, observer, {}, context); } return view;` with
//         NO `_authorize` call between the last status() and `return view`; a wrong impl that re-adds the seam fails)
//   A4    the driver pump loop retries blind on a typed refusal — the #148 instance's shape at the driver layer.
//         (RED static — the wave-driver pump loop, wave-driver.mjs `for (;;)` → the hardCap break, blanket-swallows
//         every status failure as 'unavailable' (L5/D10 catch) with NO stop-on-repeated-auth-failure guard and NO
//         full-envelope log; the #164 acceptance is the #148 driver law landing as client discipline. [fold: re-anchored
//         to the FOUND loop-open + hardCap-break lines, scanned COMMENT-STRIPPED so a doc comment cannot game the
//         static scan — the v1 absolute line-window anchor is gone])
//
// §E — transport-principal discrimination (GREEN — the over-claim class the RED rows must not drift into)
//   A6    RA6 pin: run.inspect's continuation refuses after mid-wait lease invalidation, never projects (phase77:394-420).
//         (GREEN — the fail-loud landing must not break the landed lease-revalidation discipline)
//   A7    RA7 pin: run.follow revalidates after wait immediately before return (phase77:425-467). (GREEN — same)
//   D3.2  a dead authority refuses even when the run truth is terminal — the two per-cycle checks are INDEPENDENT
//         (D3.2). A mid-wait revocation at the same instant as a mid-wait terminalization produces the typed refusal,
//         never the terminal view. (GREEN at HEAD: the MCP post-dispatch recheck and the web _postWaitAuthorization
//         both run after dispatch regardless of the dispatched value — kills an impl that early-returns terminal
//         truth BEFORE the transport recheck, short-circuiting the authority check)
//   P-MCP the MCP post-dispatch transport recheck list must enumerate the FOUR wait-capable tools —
//         ['fleet_run_follow','fleet_run_wait'] PLUS ['fleet_run_episode','fleet_run_workstreams'] (fold-164 B3;
//         contract D2 MCP row + A2) — the typed `unauthenticated` code stays preserved (additive-only), and the
//         invalid_run_wait ceiling stays. (RED — at HEAD the list covers only the two wait verbs, so a mid-wait
//         revocation on episode/workstreams is not caught post-dispatch; stage mcp-recheck-episode-workstreams-missing;
//         this is the static shadow of A2-c/A2-d)
//   P-MCP-ceiling  invalid_run_wait stays the MCP wait-budget ceiling (A10/MCP pin). (GREEN behavioral — the
//         request-shape refusal is preserved even after the recheck list grows)
//   P-WEB the web wait refusal keeps the typed 401 `unauthenticated` / 403 `forbidden` codes AND the
//         application_wait_timeout_exceeds_web_ceiling token stays (web-northbound.mjs:417). (GREEN — the renewal naming
//         is ADDITIVE on the code, never a code swap)
//   P-CLI the CLI run view --until / run status --wait delegate to run.wait — no CLI-local wait seam of its own
//         (D2 seam map; application-cli.mjs:1655/:1712/:2030). (GREEN static — the delegation exists at HEAD; kills
//         an impl that patches the CLI dispatch instead of the verbs)
//   P-FORBIDDEN the `forbidden` refusal at the wait seams is the capability/repo-scope death, NOT a lifetime
//         renewal — it must never name /v1/auth/refresh (the refusal table; OQ3). (GREEN — the code is preserved and
//         no lifetime-refresh lane is claimed; kills an impl that blanket-names /v1/auth/refresh on EVERY refusal)
//   P-APP the APPLICATION layer's run.wait deployment-policy refusal keeps application_unauthorized AND names the
//         APP-layer renewal — the lease seat / the deployment-policy credential (D1.2(a); the refusal table) — and
//         never the transport /v1/auth/refresh lane. (RED — at HEAD the application refusal is code-only with no
//         renewal field, so a caller cannot learn the renewal lane; stage app-refusal-renewal-naming-missing. This is
//         the v2 fold of the blue-team's inverse pin: renewal naming is required on the application_unauthorized leg
//         itself, while the transport-principal over-claim — naming /v1/auth/refresh from the application layer — stays
//         killed)
//
// §F — additive-only + refusal-table pins (GREEN)
//   A9    the terminal/settled literal sets and the WAITING_ON_KINDS closed five stay byte-unchanged (additive-only law).
//         (GREEN — kills an impl that edits the phase or waitingOn vocabulary instead of adding the wait-local predicate)
//   A10   run.wait's request-shape refusal stays application_wait_invalid for an invalid timeoutMs/until (the refusal
//         table fold). (GREEN — kills an impl that renames or drops the wait-budget refusal)
//   A4-pin the #148 DRIVER LAW is documented in the friction ledger (Appendix D row 2 — "log the full non-ok envelope and
//         stop on repeated auth failure — never retry-blind") — the typed refusal + renewal naming is what makes the
//         stop actionable. (GREEN doc pin — the client discipline exists for the server-side refusals A2-a/A2-b/A2-c/
//         A2-d/A3-a/A3-b/P-APP pin)
//
// §G — workflow evidence (GREEN)
//   P-PUBLISH the shared-scratchpad publish lane (the #158 run.scratchpad.append verb) is NOT landed at HEAD — an attempt
//         to publish a `shared`-scope note refuses application_command_unavailable. The refusal is the publish-as-you-go
//         evidence the coordinator expects. (GREEN — the lane's absence is reproducible. [blue-team DECORATIVE: the pin
//         is workflow evidence, not a contract law; scoped as such, and it is temporally coupled to #158 — re-examine
//         when the publish lane lands])

// ===========================================================================
// VERIFIED SPLIT (measured twice per tree, from the repo root)
// ===========================================================================
//   BASELINE (pre-fold): tests 31 · pass 23 · fail 8
//     RED: A1-a terminal-truth-predicate-missing, A1-b settle-block-durable-stop-missing, A2-a
//     mcp-refusal-renewal-missing, A2-b mcp-refusal-renewal-missing, A3-a web-refusal-renewal-missing,
//     A3-b web-refusal-renewal-missing, A4 driver-stop-on-repeated-auth-missing,
//     B1 return-seam-revalidation-missing.
//   POST-FOLD (after the row-sf164 edits below): tests 34 · pass 23 · fail 11
//     RED: A1-a, A1-b, A2-a, A2-b, A2-c, A2-d, A3-a, A3-b, A4,
//     P-MCP mcp-recheck-episode-workstreams-missing, P-APP app-refusal-renewal-naming-missing.
//     (both splits stable across two runs each)

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MockAdapter } from '../src/adapter.mjs';
import {
  APPLICATION_RUN_TERMINAL_PHASES,
  BatonApplication,
  PROVIDER_EXECUTION_SETTLED_PHASES,
} from '../src/application.mjs';
import { applicationTerminal, providerSettled, WAITING_ON_KINDS } from '../src/application-semantics.mjs';
import {
  CoordinationStore, createDriver, McpFleetServer, WebNorthbound,
} from '../src/index.mjs';

const NOW = '2026-08-13T08:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const ORIGIN = 'https://blind-waits.test';
const REPO = 'repo-blind-waits-164';

// The closed literal sets and waitingOn vocabulary, in ACTUAL order (A9). These are the byte-stable
// invariants the fail-loud landing rides — a landed impl must leave them untouched.
const PINNED_PROVIDER_SETTLED = [
  'work_completed', 'selection_required', 'candidate_selected', 'completed', 'failed',
  'cancelled', 'denied', 'stopped',
];
const PINNED_APPLICATION_TERMINAL = ['completed', 'failed', 'cancelled', 'denied', 'stopped'];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const root = (label) => mkdtempSync(join(tmpdir(), `baton-164-${label}-`));
const principal = (principalId) => ({
  actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`,
});

// ---------------------------------------------------------------------------
// Application fixture (phase77-recursive-application-red idiom): a real
// createDriver + BatonApplication stack over a MockAdapter, a parent orchestrator
// task + recursive lease, so run.start/run.wait/run.follow/run.inspect run through
// the REAL seams. The only doubles are the coordinator.wait sleep (patched per row)
// and the fixture clock (a mutable fake for the RA6/RA7 expiry leg).
// ---------------------------------------------------------------------------
const runLineagePolicy = Object.freeze({
  schemaVersion: 1, maxDepth: 4, maxChildrenPerRun: 4, maxDescendantsPerRoot: 16, leaseTtlMs: 60_000,
});
const goalPlanPolicy = Object.freeze({
  schemaVersion: 1,
  repoId: REPO,
  mandatory: false,
  approvalTtlMs: 60 * 60 * 1_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});
const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});
const profile = Object.freeze({
  schemaVersion: 1,
  repoId: REPO,
  definitionOfDone: ['the recursive result is mechanically verified'],
  constraints: ['remain inside the approved repository scope'],
  risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'],
  verification,
  routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'],
  effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
  followPolicy: {
    mode: 'enabled', maxWaitMs: 1_000, maxChanges: 8,
    maxResponseBytes: 64 * 1024, maxScanEvents: 32,
  },
});

function configuredAdapter() {
  const adapter = new MockAdapter({
    harness: 'mock', scenario: { outcome: 'completed', delayMs: 25, summary: 'done', files: {} },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return adapter;
}

function createParentTask(store, label) {
  const runId = `run-${label}-parent`;
  const taskId = `task-${label}-parent`;
  const workerId = `worker-${label}-parent`;
  store.createTask({
    id: taskId,
    brief: { objective: 'Probe blind-waits fail-loud discipline.', capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'mock', modelRequested: 'model-a',
    modelPolicy: null, effortRequested: 'low', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${taskId}` });
  const task = store.claimTask(taskId, workerId, 1, {
    actor: 'orchestrator', key: `task.claimed:${taskId}`,
  }, {
    harnessRequested: 'mock', harnessResolved: 'mock@fixture',
    modelRequested: 'model-a', modelResolved: 'model-a', modelObserved: 'model-a',
    effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
    routeKey: '["mock","fixture","model-a","low"]',
  }).task;
  return { runId, taskId, workerId, task };
}

function issueLease(store, parent, recursivePrincipal) {
  const session = {
    principalId: recursivePrincipal.principalId,
    sessionId: recursivePrincipal.sessionId,
    authorityDigest: digest({
      kind: 'authenticated-recursive-session',
      principalId: recursivePrincipal.principalId,
      sessionId: recursivePrincipal.sessionId,
    }),
    expiresAt: '2026-08-13T09:00:00.000Z',
  };
  const identity = {
    repoId: REPO, parentRunId: parent.runId, parentTaskId: parent.taskId,
    parentTaskVersion: parent.task.version, workerId: parent.workerId,
    principalId: session.principalId, sessionId: session.sessionId,
    sessionAuthorityDigest: session.authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${digest(identity)}`;
  return store.issueRunOrchestratorLease({
    schemaVersion: 1, repoId: REPO,
    parentTask: { id: parent.taskId, version: parent.task.version }, session,
  }, { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` }).lease;
}

function recursiveContext(lease, requestId = 'recursive-request-1') {
  return {
    transport: 'direct', requestId,
    idempotencyKey: `direct.recursive:${requestId}`,
    sessionAuthority: {
      schemaVersion: 1,
      authorityDigest: lease.session.authorityDigest,
      expiresAt: lease.session.expiresAt,
      orchestratorLeaseId: lease.leaseId,
    },
  };
}

function mutableClock(initial = NOW) {
  let value = initial;
  return {
    now: () => value,
    set(next) { value = next; },
  };
}

function fixture(label, { clock = mutableClock(), authorize = async () => true } = {}) {
  const repository = root(`${label}-repo`);
  const logDir = root(`${label}-log`);
  execFileSync('git', ['init', '-q'], { cwd: repository });
  execFileSync('git', ['config', 'user.email', 'blind-waits@example.invalid'], { cwd: repository });
  execFileSync('git', ['config', 'user.name', 'Blind Waits 164'], { cwd: repository });
  writeFileSync(join(repository, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repository });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repository });
  const driver = createDriver({
    repoRoot: repository, repoId: REPO, logDir, now: () => Date.parse(clock.now()),
    adapters: { mock: configuredAdapter() }, runLineagePolicy,
    goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    stopDeadlineMs: 2_000,
    // Suite law #6: the stall watchdog is a valid positive integer in every fixture — pinned, never the default.
    watchdog: { stallMs: 60_000 },
  });
  const application = new BatonApplication({
    driver, repoId: REPO, profiles: { recursive: profile },
    principals: {
      planner: principal(`${label}-planner`), dispatcher: principal(`${label}-dispatcher`),
      observer: principal(`${label}-observer`),
    },
    authorize,
  });
  const parent = createParentTask(driver.coordination, label);
  const recursivePrincipal = principal(`${label}-recipient`);
  const lease = issueLease(driver.coordination, parent, recursivePrincipal);
  return {
    application, clock, driver, lease, logDir, parent, recursivePrincipal, repository,
  };
}

const intent = (runId) => ({
  runId,
  objective: 'Probe the blind-waits fail-loud discipline on one bounded run.',
  profile: 'recursive',
  route: { harness: 'mock', model: 'model-a', effort: 'low' },
  scope: ['impl/**'],
});

async function startRun(f, runId, label) {
  return f.application.command(
    'run.start', { intent: intent(runId) }, f.recursivePrincipal,
    recursiveContext(f.lease, `${label}-start`),
  );
}

function admitStop(f, runId, reason) {
  const reasonDigest = digest(reason);
  return f.driver.coordination.admitRunStop({
    schemaVersion: 1, repoId: REPO, runId, reasonDigest,
    requestDigest: digest({ repoId: REPO, runId, reasonDigest }),
  }, { actor: 'direct:blind-waits-164', key: `run.stop:${runId}` });
}

// The durable-stop receipt for a run with no dispatched workers (the admit computes an EMPTY
// target set), so the receipt's counts/checks/effects are the trivial zeros/truths. Verified
// against _validateRunStopCompletion (coordination-store.mjs:4697) with an empty target set.
function durableStopReceipt(stop) {
  const counts = {
    pendingCancelled: 0, killConfirmed: 0, alreadyTerminal: 0,
    processesObserved: 0, processesClosed: 0,
  };
  const checks = { dispatchClosed: true, interactionsResolved: true, runAuthorityReleased: true };
  const effects = { coordinatorClosed: false, writerReleased: false, transportsClosed: false };
  const core = {
    schemaVersion: stop.schemaVersion, state: 'stopped', scope: stop.scope ?? 'run',
    repoId: stop.repoId, runId: stop.runId,
    targetCount: stop.targetWorkerIds.length, remainingCount: 0, targetDigest: stop.targetDigest,
    counts, checks, effects,
  };
  return { ...core, receiptDigest: digest(core) };
}

async function cleanupFixture(f) {
  try { await f.application.shutdown(principal('blind-waits-164-shutdown')); } catch { /* RED failures may interrupt setup */ }
  rmSync(f.repository, { recursive: true, force: true });
  rmSync(f.logDir, { recursive: true, force: true });
}

// Count the blind coordinator.wait sleeps: the verb's own budget stays a wall-clock budget
// (campaign law — no clock as a control), but the SLEEP is doubled with an immediate resolve so
// the loop is observable without real waits. At HEAD the durable-stop loop calls it ≥1 time.
function countCoordinatorWait(f) {
  let calls = 0;
  f.driver.coordinator.wait = async () => { calls += 1; };
  return () => calls;
}

// ---------------------------------------------------------------------------
// MCP fixture (phase16-mcp-northbound idiom): McpFleetServer over a CoordinationStore
// with an injected principal + isPrincipalActive toggle, so a mid-wait revocation lands
// in the post-dispatch _authority recheck (mcp-northbound.mjs:1505-1520).
// ---------------------------------------------------------------------------
const runApplicationCard = () => ({
  schemaVersion: 1,
  repoId: REPO,
  commands: [
    'application.help', 'runs.list', 'run.start', 'run.inspect', 'run.episode',
    'run.workstreams', 'run.workstream.notify', 'run.workstream.stop', 'run.act',
    'run.status', 'run.follow', 'run.recover', 'run.approve', 'run.wait', 'run.answer',
    'run.feedback', 'run.steer', 'run.stop', 'run.evidence', 'run.adopt',
    'run.retry_verification', 'run.resume_work', 'run.review', 'run.integrate',
    'run.export', 'waves.attach', 'application.shutdown',
  ],
});

function mcpSetup({ application, isPrincipalActive, maxWaitMs = 25_000, principal: principalOverride } = {}) {
  const calls = [];
  const coordinator = {
    async spawn(harness, brief, opts) { calls.push(['spawn', harness, brief, opts]); return { id: 'worker-1', fence: 1 }; },
    async send(workerId, message, mode, opts) { calls.push(['send', workerId, message, mode, opts]); return { result: 'sent' }; },
    async wait(timeoutMs) { calls.push(['wait', timeoutMs]); return { events: [], cursor: 4, more: false }; },
    async respond(requestId, answer, actor) { calls.push(['respond', requestId, answer, actor]); return { result: 'responded' }; },
    async interrupt(workerId, then, actor, opts) { calls.push(['interrupt', workerId, then, actor, opts]); return { result: 'interrupted' }; },
    async result(workerId) { calls.push(['result', workerId]); return { id: workerId, state: 'working' }; },
    list() { calls.push(['list']); return [{ id: 'worker-1' }]; },
    capabilityCards() { calls.push(['capabilityCards']); return [{ name: 'atlas', ops: { 'atlas.inspect': {} } }]; },
    async invokeCapability(name, op, args, ctx) { calls.push(['invokeCapability', name, op, args, ctx]); return { op, status: 'ok', summary: 'invoked' }; },
    async resumeCapability(name, op, ref, cursor, ctx) { calls.push(['resumeCapability', name, op, ref, cursor, ctx]); return { op, status: 'ok', summary: 'resumed' }; },
    async reverifyCapability(name, op, claim, args, ctx) { calls.push(['reverifyCapability', name, op, claim, args, ctx]); return { op, status: 'ok', summary: 'reverified' }; },
    async orientWorker(workerId, args, note, ctx) { calls.push(['orientWorker', workerId, args, note, ctx]); return { ok: true, result: 'ok', sliceDigest: 'a'.repeat(64) }; },
    async decideReuse(decision, ctx) { calls.push(['decideReuse', decision, ctx]); return { ok: true, result: 'recorded', decision: { id: 'reuse-decision:test' } }; },
    async recheckReuseDecision(recheck, ctx) { calls.push(['recheckReuseDecision', recheck, ctx]); return { ok: true, result: 'guarded', targets: [] }; },
    async kill(workerId, actor, opts) { calls.push(['kill', workerId, actor, opts]); return { result: 'killed' }; },
  };
  const directory = root('mcp');
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW_MS).toISOString() });
  const server = new McpFleetServer({
    coordinator, coordination, application,
    surface: application ? 'combined' : undefined,
    shutdownPrincipal: application ? {
      actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session',
    } : undefined,
    isPrincipalActive,
    principal: principalOverride ?? {
      userId: 'mcp-op', sessionId: 'mcp-sess',
      capabilities: ['control', 'observe', 'approve', 'emergency_stop', 'adopt_result', 'review', 'integrate_result'],
      repoIds: [REPO], expiresAt: new Date(NOW_MS + 60_000).toISOString(), revoked: false,
    },
    repoIds: [REPO], now: () => NOW_MS,
    maxWaitMs,
    maxMessageBytes: 64 * 1024,
    takeToolQuota: async () => ({ ok: true }),
  });
  return { calls, coordinator, coordination, directory, server };
}
const mcpRequest = (server, id, method, params) => server.handle({
  jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }),
});
async function mcpInitialized(server) {
  const response = await mcpRequest(server, 1, 'initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'blind-waits-164', version: '0' },
  });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  assert.deepEqual(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
}

// ---------------------------------------------------------------------------
// Web fixture (phase12-web-command-status idiom): WebNorthbound over a
// CoordinationStore with an injected isPrincipalActive toggle, so a mid-wait expiry
// lands in the post-wait _postWaitAuthorization recheck (web-northbound.mjs:684-689).
// ---------------------------------------------------------------------------
class Response {
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  end(body = '') { this.rawBody = body; this.body = body ? JSON.parse(body) : null; }
}
function webSetup({ application, isPrincipalActive, principal: principalOverride } = {}) {
  const directory = root('web');
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW_MS).toISOString() });
  const web = new WebNorthbound({
    coordinator: { list() { return []; } },
    coordination,
    application,
    repoIds: [REPO],
    allowedOrigins: [ORIGIN],
    now: () => NOW_MS,
    isPrincipalActive,
  });
  const ctx = {
    principal: principalOverride ?? {
      userId: 'web-op', sessionId: 'web-sess', credentialId: 'web-cred',
      authMethod: 'local',
      capabilities: ['observe', 'control'],
      repoIds: [REPO],
      expiresAt: new Date(NOW_MS + 60_000).toISOString(), revoked: false,
    },
    origin: ORIGIN,
    csrfToken: 'csrf-164',
    remoteAddress: '127.0.0.1',
    transport: 'local',
  };
  return { directory, coordination, web, ctx };
}
function webEnvelope(command, args) {
  return {
    schemaVersion: 1, commandId: `c164-${command}-1`, idempotencyKey: `ik164-${command}-1`,
    command, args, repoId: REPO, origin: ORIGIN,
  };
}

// ---------------------------------------------------------------------------
// Static source helpers (NUL discipline: application.mjs / coordination-store.mjs
// are NEVER whole-file-read; every anchor uses grep -an / sed -n via execFileSync).
// ---------------------------------------------------------------------------
function srcAnchor(file, pattern) {
  const rootDir = fileURLToPath(new URL('../src/', import.meta.url));
  // -F fixed-string match: every anchor is an exact-text pin (the MCP recheck line is a
  // bracket-expression trap under BRE, so we never let regex interpretation decide an anchor).
  const out = execFileSync('/usr/bin/grep', ['-Fna', pattern, join(rootDir, file)], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  }).trim().split('\n').filter(Boolean);
  assert.ok(out.length > 0, `source anchor ${file} ~ ${pattern} not found`);
  const first = out[0];
  const colon = first.indexOf(':');
  return { line: Number(first.slice(0, colon)), text: first.slice(colon + 1) };
}
function srcRegion(file, fromLine, toLine) {
  const rootDir = fileURLToPath(new URL('../src/', import.meta.url));
  return execFileSync('/usr/bin/sed', ['-n', `${fromLine},${toLine}p`, join(rootDir, file)], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
}
function runWaitBody() {
  const start = srcAnchor('application.mjs', 'async wait(runId, rawObserver, options = {}, rawContext = null) {');
  const end = srcAnchor('application.mjs', '  _followCategory(event)');
  return srcRegion('application.mjs', start.line, end.line - 1);
}
// Fold hardening (row-sf164): the A4 scan must be gamed by CODE, never by a stray comment — strip
// `//`-to-EOL comments before the auth-stop guard regex runs, so a comment containing the guard's
// vocabulary (e.g. `unauthenticated` or `non-ok`) cannot turn the row green with zero behavior.
function stripJsComments(text) {
  return text.replace(/\/\/[^\n]*/gu, '');
}

// ===========================================================================
// §A — run.wait durable-stop truth (RED)
// ===========================================================================

test('A1-a RED: run.wait({until:"terminal"}) on a durably-stopped run burns the clock instead of returning the projected terminal truth', async (t) => {
  const f = fixture('a1a');
  t.after(() => cleanupFixture(f));
  const runId = 'run-blind-waits-a1a';
  await startRun(f, runId, 'a1a');
  const admitted = admitStop(f, runId, 'Stop the durably-stopped run.');
  assert.equal(admitted.stop.status, 'stopping', 'the stop admission is durable but not reaped');
  const waitCalls = countCoordinatorWait(f);

  const view = await f.application.command('run.wait', {
    runId, until: 'terminal', timeoutMs: 30,
  }, f.recursivePrincipal, recursiveContext(f.lease, 'a1a-wait'));

  assert.equal(waitCalls(), 0,
    'stage: terminal-truth-predicate-missing — a durably-stopped run reads phase "stopping" (application.mjs:7598), which is outside APPLICATION_RUN_TERMINAL_PHASES (application.mjs:160), so run.wait(until:"terminal") enters the blind coordinator.wait loop and burns the full clock (G2/G3) instead of returning the already-projected terminal truth on the first cycle');
  assert.equal(view.phase, 'stopping', 'the deadline view is the durably-stopped phase');
});

test('A1-b RED: run.wait settle-block on a durably-stopped run burns the clock too — the durable-stop predicate must extend to the settle-block loop', async (t) => {
  const f = fixture('a1b');
  t.after(() => cleanupFixture(f));
  const runId = 'run-blind-waits-a1b';
  await startRun(f, runId, 'a1b');
  admitStop(f, runId, 'Stop the settle-block durably-stopped run.');
  const waitCalls = countCoordinatorWait(f);

  const view = await f.application.command('run.wait', {
    runId, timeoutMs: 30,
  }, f.recursivePrincipal, recursiveContext(f.lease, 'a1b-wait'));

  assert.equal(waitCalls(), 0,
    'stage: settle-block-durable-stop-missing — the default settle-block loop (application.mjs:8003) consults PROVIDER_EXECUTION_SETTLED_PHASES, which also misses "stopping" (application.mjs:157); the v2 fold of DR-1(a) extends the durable-stop terminal-truth predicate to this loop, so a durably-stopped run must return immediately here too');
  assert.equal(view.phase, 'stopping');
});

// ===========================================================================
// §B — terminal-truth pins (GREEN)
// ===========================================================================

test('A5 GREEN: unknown run ids refuse application_run_not_found byte-identical, no clock (FP-05)', async (t) => {
  const f = fixture('a5');
  t.after(() => cleanupFixture(f));
  const unknown = 'run-blind-waits-never-exists';
  const waitCalls = countCoordinatorWait(f);

  const recursiveRefusal = await f.application.command('run.wait', {
    runId: unknown, timeoutMs: 30,
  }, f.recursivePrincipal, recursiveContext(f.lease, 'a5-wait')).catch((error) => error);
  assert.equal(recursiveRefusal?.code, 'application_run_not_found',
    'FP-05 — resolve-then-authorize (application.mjs:4799-4803): the first status() resolves _findRun before authorizing, so a never-existing run refuses application_run_not_found (application.mjs:3486) even for a lease-holding caller');
  assert.equal(waitCalls(), 0, 'no clock burned — the unknown run refuses on the first cycle');

  const foreignRefusal = await f.application.command('run.wait', {
    runId: unknown, timeoutMs: 30,
  }, principal('a5-foreign')).catch((error) => error);
  assert.equal(foreignRefusal?.code, 'application_run_not_found',
    'a foreign (authority-less) caller gets the SAME byte-identical code — unknown run ≡ foreign run (FP-05); the fail-loud law is additive on top, never a conflation with application_unauthorized');
  assert.equal(JSON.stringify(recursiveRefusal), JSON.stringify(foreignRefusal),
    'the two refusals are byte-identical');
});

test('A1-c GREEN: a run that terminalizes MID-wait returns the terminal view on the observing cycle — exactly one sleep, never the deadline', async (t) => {
  const f = fixture('a1c');
  t.after(() => cleanupFixture(f));
  const runId = 'run-blind-waits-a1c';
  const started = await startRun(f, runId, 'a1c');
  assert.equal(started.phase, 'awaiting_plan_approval');

  let fired = false;
  f.driver.coordinator.wait = async () => {
    if (!fired) {
      fired = true;
      const admitted = admitStop(f, runId, 'Terminalize the run mid-wait.');
      f.driver.coordination.completeRunStop(runId, durableStopReceipt(admitted.stop), {
        actor: 'direct:blind-waits-164', key: `run.stop.complete:${runId}`,
      });
    }
  };
  const view = await f.application.command('run.wait', {
    runId, until: 'terminal', timeoutMs: 100,
  }, f.recursivePrincipal, recursiveContext(f.lease, 'a1c-wait'));

  assert.equal(fired, true, 'the durable wait boundary was entered exactly once');
  assert.equal(view.phase, 'stopped',
    'the per-cycle status() re-read (application.mjs:8000) observes the mid-wait terminalization and returns the TERMINAL view on that cycle — a snapshot-only impl that returns the pre-wait view fails this pin');
  assert.equal(view.waitingOn, null);
  assert.deepEqual(view.terminalCause, { kind: 'operator_stop', code: 'operator_stop' });
});

test('A8 GREEN: terminal views carry waitingOn:null + the typed terminalCause, and the canonical predicates keep owning the vocabulary (additive-only)', async (t) => {
  const f = fixture('a8');
  t.after(() => cleanupFixture(f));
  const runId = 'run-blind-waits-a8';
  const started = await startRun(f, runId, 'a8');
  const admitted = admitStop(f, runId, 'Reach the stopped terminal view.');
  f.driver.coordination.completeRunStop(runId, durableStopReceipt(admitted.stop), {
    actor: 'direct:blind-waits-164', key: `run.stop.complete:${runId}`,
  });

  const view = await f.application.command('run.status', { runId }, f.recursivePrincipal, recursiveContext(f.lease, 'a8-status'));
  assert.equal(view.phase, 'stopped');
  assert.equal(view.waitingOn, null, 'G9 — the terminal view carries the honest null (waiting-vocabulary D2), never a fabricated kind');
  assert.deepEqual(view.terminalCause, { kind: 'operator_stop', code: 'operator_stop' },
    'the typed terminal cause rides the existing closed vocabulary (projectTypedTerminalCause, application-semantics.mjs:2134)');

  // The canonical predicates own the vocabulary — and 'stopping' stays NON-terminal in them:
  // the DR-1(a) fix is a WAIT-LOCAL helper (OQ2(a)), never an amendment of the canonical sets.
  assert.equal(applicationTerminal('stopped'), true, 'applicationTerminal owns "stopped"');
  assert.equal(providerSettled('stopped'), true, 'providerSettled owns "stopped"');
  assert.equal(applicationTerminal('stopping'), false,
    'the canonical predicate does NOT classify the durably-stopped "stopping" phase as terminal — the wait-local helper recognizes the durable stop WITHOUT editing the canonical vocabulary (additive-only law)');
  assert.equal(providerSettled('stopping'), false, 'same for providerSettled');
  assert.equal(APPLICATION_RUN_TERMINAL_PHASES.has('stopping'), false,
    'the literal terminal set is unchanged too');
});

// ===========================================================================
// §C — transport refusals name the renewal path (RED)
// ===========================================================================

test('A2-a RED: MCP fleet_run_wait refuses a mid-wait revocation with unauthenticated AND names the renewal path', async (t) => {
  let active = true;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let entered;
  const dispatched = new Promise((resolve) => { entered = resolve; });
  const application = {
    repoId: REPO, card: runApplicationCard, async authorizeReplay() { return true; },
    async command() { entered(); await blocked; return { schemaVersion: 1, runId: 'run-a2a', phase: 'running' }; },
  };
  const { server } = mcpSetup({ application, isPrincipalActive: () => active });
  await mcpInitialized(server);
  t.after(async () => { await server.close().catch(() => {}); });

  const pending = mcpRequest(server, 3, 'tools/call', {
    name: 'fleet_run_wait', arguments: { repoId: REPO, runId: 'run-a2a', timeoutMs: 5_000 },
  });
  await dispatched;
  active = false;
  release();
  const response = await pending;

  assert.equal(response.result.isError, true);
  const envelope = JSON.parse(response.result.content[0].text);
  assert.equal(envelope.ok, false, 'D1.3 — never silence: the refusal is not ok:true');
  assert.equal(envelope.error.code, 'unauthenticated',
    'the CE5/MN code is PRESERVED (additive-only — phase16-mcp-northbound.test.mjs:239-253 pins it; the #164 fold adds the renewal naming on top, never removes the code)');
  assert.equal(typeof envelope.error.renewal, 'object',
    'stage: mcp-refusal-renewal-missing — a mid-wait revocation must name the MCP re-authentication renewal path (D1.2/G7); at HEAD toolError(refused) is code-only (mcp-northbound.mjs:198-200) with no renewal field, so the caller cannot learn the renewal verb');
  assert.ok(typeof envelope.error.renewal?.path === 'string' || typeof envelope.error.renewal?.verb === 'string',
    'the renewal names a concrete lane (re-authenticate / refresh)');
  assert.notEqual(envelope.error.renewal?.path, '/v1/auth/refresh',
    'stage: mcp-refusal-renewal-names-mcp-lane — the MCP renewal names the MCP re-authentication lane (OQ3; refusal table `unauthenticated`: "MCP: re-authenticate the MCP session"), never the web /v1/auth/refresh lane; a shared web-lane renewal copied onto the MCP surface (a `renewal: { path: \'/v1/auth/refresh\' }` constant) fails this pin (blue-team A2-a SHALLOW → FOLDED)');
});

test('A2-b RED: MCP fleet_run_follow refuses a mid-wait revocation with unauthenticated AND names the renewal path', async (t) => {
  let active = true;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let entered;
  const dispatched = new Promise((resolve) => { entered = resolve; });
  const application = {
    repoId: REPO, card: runApplicationCard, async authorizeReplay() { return true; },
    async command() { entered(); await blocked; return { schemaVersion: 1, runId: 'run-a2b', phase: 'running', follow: { throughCursor: 7, changes: [] } }; },
  };
  const { server } = mcpSetup({ application, isPrincipalActive: () => active });
  await mcpInitialized(server);
  t.after(async () => { await server.close().catch(() => {}); });

  const pending = mcpRequest(server, 3, 'tools/call', {
    name: 'fleet_run_follow', arguments: { repoId: REPO, runId: 'run-a2b', afterCursor: 0, timeoutMs: 5_000 },
  });
  await dispatched;
  active = false;
  release();
  const response = await pending;

  assert.equal(response.result.isError, true);
  const envelope = JSON.parse(response.result.content[0].text);
  assert.equal(envelope.ok, false, 'D1.3 — never silence: the refusal is not ok:true');
  assert.equal(envelope.error.code, 'unauthenticated',
    'the CE5/MN code is PRESERVED for fleet_run_follow too (additive-only — the code survives the renewal naming)');
  assert.equal(typeof envelope.error.renewal, 'object',
    'stage: mcp-refusal-renewal-missing — fleet_run_follow rides the SAME post-dispatch recheck (mcp-northbound.mjs:1510) as fleet_run_wait; an impl that fixes only fleet_run_wait leaves fleet_run_follow code-only, so this row stays RED at the same stage');
  assert.ok(typeof envelope.error.renewal?.path === 'string' || typeof envelope.error.renewal?.verb === 'string',
    'the renewal names a concrete lane');
  assert.notEqual(envelope.error.renewal?.path, '/v1/auth/refresh',
    'stage: mcp-refusal-renewal-names-mcp-lane — the fleet_run_follow renewal also names the MCP re-authentication lane (OQ3), never the web /v1/auth/refresh lane; the shared web-lane renewal cheat fails this pin too (blue-team A2-b SHALLOW → FOLDED)');
});

test('A2-c RED: MCP fleet_run_episode refuses a mid-wait revocation with unauthenticated AND names the renewal path (A2/D2 fold — B3)', async (t) => {
  let active = true;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let entered;
  const dispatched = new Promise((resolve) => { entered = resolve; });
  const application = {
    repoId: REPO, card: runApplicationCard, async authorizeReplay() { return true; },
    async command() { entered(); await blocked; return { schemaVersion: 1, runId: 'run-a2c', phase: 'running' }; },
  };
  const { server } = mcpSetup({ application, isPrincipalActive: () => active });
  await mcpInitialized(server);
  t.after(async () => { await server.close().catch(() => {}); });

  const pending = mcpRequest(server, 3, 'tools/call', {
    name: 'fleet_run_episode', arguments: { repoId: REPO, runId: 'run-a2c', cursor: 0, waitMs: 5_000 },
  });
  await dispatched;
  active = false;
  release();
  const response = await pending;

  assert.equal(response.result.isError, true,
    'stage: mcp-refusal-renewal-missing — fleet_run_episode is a wait-capable MCP tool the v2 contract adds to the post-dispatch transport recheck (fold-164 B3; contract D2 MCP row + A2); at HEAD the recheck list (mcp-northbound.mjs:1510) covers only fleet_run_follow/fleet_run_wait, so a mid-wait revocation on fleet_run_episode is NOT refused and the dispatched value returns — the row stays RED until the recheck list extends AND the renewal is named (blue-team P-MCP fold: the missing episode/workstreams RED row; the cursor is required for a run.episode wait, application.mjs:1917)');
  const envelope = JSON.parse(response.result.content[0].text);
  assert.equal(envelope.ok, false, 'D1.3 — never silence: the refusal is not ok:true');
  assert.equal(envelope.error.code, 'unauthenticated', 'the typed code is preserved (additive-only)');
  assert.equal(typeof envelope.error.renewal, 'object',
    'the episode refusal names a concrete MCP re-authentication lane (D1.2/G7, OQ3)');
});

test('A2-d RED: MCP fleet_run_workstreams refuses a mid-wait revocation with unauthenticated AND names the renewal path (A2/D2 fold — B3)', async (t) => {
  let active = true;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let entered;
  const dispatched = new Promise((resolve) => { entered = resolve; });
  const application = {
    repoId: REPO, card: runApplicationCard, async authorizeReplay() { return true; },
    async command() { entered(); await blocked; return { schemaVersion: 1, runId: 'run-a2d', phase: 'running' }; },
  };
  const { server } = mcpSetup({ application, isPrincipalActive: () => active });
  await mcpInitialized(server);
  t.after(async () => { await server.close().catch(() => {}); });

  const pending = mcpRequest(server, 3, 'tools/call', {
    name: 'fleet_run_workstreams', arguments: { repoId: REPO, runId: 'run-a2d', cursor: 0, waitMs: 5_000 },
  });
  await dispatched;
  active = false;
  release();
  const response = await pending;

  assert.equal(response.result.isError, true,
    'stage: mcp-refusal-renewal-missing — fleet_run_workstreams is the second wait-capable MCP tool the v2 contract adds to the post-dispatch transport recheck (fold-164 B3; contract D2 MCP row + A2); at HEAD the recheck list covers only fleet_run_follow/fleet_run_wait, so a mid-wait revocation on fleet_run_workstreams is NOT refused — an impl that extends the recheck to episode only leaves this row RED at the same stage (the cursor is required for a run.workstreams wait, application.mjs:1935)');
  const envelope = JSON.parse(response.result.content[0].text);
  assert.equal(envelope.ok, false, 'D1.3 — never silence: the refusal is not ok:true');
  assert.equal(envelope.error.code, 'unauthenticated', 'the typed code is preserved (additive-only)');
  assert.equal(typeof envelope.error.renewal, 'object',
    'the workstreams refusal names a concrete MCP re-authentication lane (D1.2/G7, OQ3)');
});

test('A3-a RED: web run_wait refuses a mid-wait expiry with 401 unauthenticated AND names /v1/auth/refresh', async (t) => {
  let active = true;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let entered;
  const dispatched = new Promise((resolve) => { entered = resolve; });
  const application = {
    repoId: REPO, card: runApplicationCard, async authorizeReplay() { return true; },
    async command() { entered(); await blocked; return { schemaVersion: 1, runId: 'run-a3a', phase: 'running' }; },
  };
  const { web, ctx } = webSetup({ application, isPrincipalActive: () => active });

  const pending = web.execute(ctx, webEnvelope('run_wait', { runId: 'run-a3a', timeoutMs: 5_000 }));
  await dispatched;
  active = false;
  release();
  const res = await pending;

  assert.equal(res.status, 401, 'D1.3 — never silence: the refusal is a typed 401, never a 200 ok:true');
  assert.equal(res.body?.error?.code, 'unauthenticated',
    'the typed code is preserved (additive-only — the CE5-style code stays)');
  assert.equal(res.body?.error?.renewal?.path, '/v1/auth/refresh',
    'stage: web-refusal-renewal-missing — the 401 must name the /v1/auth/refresh lane (G8 AUTH_PATHS, web-northbound.mjs:166); at HEAD _postWaitAuthorization returns the bare error(401, unauthenticated) (web-northbound.mjs:684-689) with no renewal, so the caller re-probes blind');
});

test('A3-b RED: web run_follow refuses a mid-wait expiry with 401 unauthenticated AND names /v1/auth/refresh', async (t) => {
  let active = true;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let entered;
  const dispatched = new Promise((resolve) => { entered = resolve; });
  const application = {
    repoId: REPO, card: runApplicationCard, async authorizeReplay() { return true; },
    async command() { entered(); await blocked; return { schemaVersion: 1, runId: 'run-a3b', phase: 'running', follow: { throughCursor: 7, changes: [] } }; },
  };
  const { web, ctx } = webSetup({ application, isPrincipalActive: () => active });

  const pending = web.execute(ctx, webEnvelope('run_follow', { runId: 'run-a3b', afterCursor: 0, timeoutMs: 5_000 }));
  await dispatched;
  active = false;
  release();
  const res = await pending;

  assert.equal(res.status, 401, 'D1.3 — never silence: the refusal is a typed 401, never a 200 ok:true');
  assert.equal(res.body?.error?.code, 'unauthenticated',
    'the typed code is preserved for run_follow too (additive-only — the code survives the renewal naming)');
  assert.equal(res.body?.error?.renewal?.path, '/v1/auth/refresh',
    'stage: web-refusal-renewal-missing — run_follow rides the SAME post-wait reauth seam (:895) as run_wait; an impl that fixes only run_wait leaves run_follow bare, so this row stays RED at the same stage');
});

test('B1 GREEN: run.wait\'s loop exit iteration is always a fresh status() re-read — no distinct return-seam revalidation (H-4)', () => {
  const body = runWaitBody();
  const lastWhile = body.lastIndexOf('while (');
  assert.ok(lastWhile >= 0, 'the settle-block while loop exists in run.wait');
  const tail = body.slice(lastWhile);
  // Fold (row-sf164, blue-team B1 BROKEN → FOLDED): the v2 authority contract FOLDS OUT the v1
  // draft's (b) — a DISTINCT return-seam revalidation after the loop and before `return view` — as
  // redundant and layer-confused (contract D2 `run.wait` row + D1 closing; fold-164 H-4). The loop's
  // exit iteration is ALWAYS a fresh status() re-read, so its view IS the revalidated product; the
  // transport-principal revalidation belongs to the surface rows (D3.2), never a redundant
  // application-layer seam. A wrong impl that re-adds the seam (a `this._authorize` call between the
  // loop's close and `return view`) fails the adjacency + absence pins below.
  const exitIsFreshStatus = /await this\.status\(runId, observer, \{\}, context\);\s*\}\s*return view;/u.test(tail);
  assert.equal(exitIsFreshStatus, true,
    'the settle-block loop\'s last statement is a fresh status() re-read and `return view` follows it directly — the per-cycle re-check the v2 contract mandates (D1/D2); the exit iteration\'s view IS the revalidated product, so there is no post-wait-before-projection gap of the RA6/RA7 kind inside run.wait (H-4 folded)');
  const tailHasSeamRevalidation = /this\._authorize(?:RecursiveCommand)?\(/u.test(tail);
  assert.equal(tailHasSeamRevalidation, false,
    'the run.wait tail carries no distinct return-seam `_authorize` — the v1 (b) seam was folded OUT of the v2 authority as redundant and layer-confused (H-4); a wrong impl that reintroduces it fails this pin, and the per-cycle status() re-check remains the honest seam');
});

test('A4 RED: the driver pump loop L5/D10 catch blanket-swallows status failures — no auth-stop guard in the CODE (the #148 instance\'s shape)', () => {
  // Fold (row-sf164, blue-team A4 SHALLOW → FOLDED): the static scan is re-anchored on FOUND lines
  // (the pump loop's `for (;;)` open → the `waitForWake` line at the loop's tail) — no absolute
  // line-window anchor — and COMMENTS ARE STRIPPED so a stray comment containing the guard vocabulary
  // cannot turn the row green with zero behavior. (Re-anchored 2026-08-14: the hardCap break that
  // used to bound the loop is RETIRED under the #163 law — the loop is now clock-free.) The L4-L6
  // poll/steer loop is the wave-driver layer's pump over the bus; its per-member status read (the
  // L5/D10 catch) blanket-swallows EVERY failure as 'unavailable' — a typed auth refusal
  // (`application_unauthorized`, `unauthenticated`, a dead recursive lease) is invisible to the
  // loop, which keeps polling. The #164 acceptance (A4) is the #148 driver law landing as client
  // discipline: log the full non-ok envelope and STOP on repeated auth failure.
  const pump = srcAnchor('wave-driver.mjs', '      for (;;) {');
  const loopTail = srcAnchor('wave-driver.mjs', '        await waitForWake(liveMembers);');
  assert.ok(loopTail.line > pump.line, 'the waitForWake line bounds the pump loop region');
  const code = stripJsComments(srcRegion('wave-driver.mjs', pump.line, loopTail.line));
  assert.ok(!/hardCapMs|hard_cap/u.test(code),
    'the #163 law: the pump loop carries NO clock-cap exit (hardCapMs/hard_cap are retired)');
  const hasStopOnRepeatedAuth = /stop.*repeated.*auth|repeated.*auth.*fail|fail[ _-]?loud|retry[ _-]?blind|non-ok|authFailure|unauthenticated/u.test(code);
  assert.equal(hasStopOnRepeatedAuth, true,
    'stage: driver-stop-on-repeated-auth-missing — the wave-driver pump loop (wave-driver.mjs, the `for (;;)` L4-L6 poll/steer) must log the full non-ok envelope and stop on repeated auth failure (G1/#148 driver law, D2 driver row); at HEAD the L5/D10 catch swallows every status failure as `unavailable` and the CODE carries no auth-stop guard, so a typed refusal is pumped through to the deadline blind');
});

// ===========================================================================
// §E — transport-principal discrimination (GREEN)
// ===========================================================================

const waitInvalidationCases = Object.freeze([
  Object.freeze({
    label: 'expired', code: 'run_orchestrator_lease_expired',
    inactivate(f) { f.clock.set('2026-08-13T08:01:00.001Z'); },
  }),
  Object.freeze({
    label: 'revoked', code: 'run_orchestrator_lease_revoked',
    inactivate(f) {
      f.driver.coordination.revokeRunOrchestratorLease({
        schemaVersion: 1,
        leaseId: f.lease.leaseId,
        leaseDigest: f.lease.leaseDigest,
        reason: 'session_revoked',
      }, {
        actor: 'operator:blind-waits-164',
        key: `run.orchestrator_lease.revoke:${f.lease.leaseId}`,
      });
    },
  }),
]);

function invalidateRecipientWhenWaitWakes(f, runId, invalidation) {
  const coordination = f.driver.coordination;
  const waitAfter = coordination.waitAfter.bind(coordination);
  const marker = `post-${invalidation.label}-run-data-must-not-return`;
  let woke = false;
  coordination.waitAfter = async (afterCursor, timeoutMs, options) => {
    if (!woke) {
      woke = true;
      invalidation.inactivate(f);
      coordination.recordDriver('result.blind_waits_post_invalidation', {
        runId, marker,
      }, {
        actor: 'fixture:blind-waits-164',
        key: `blind-waits.post-invalidation:${runId}:${invalidation.label}`,
      });
    }
    return waitAfter(afterCursor, timeoutMs, options);
  };
  return {
    marker,
    woke: () => woke,
  };
}

test('A6 GREEN: run.inspect\'s continuation revalidates its recipient lease after wait and never projects (RA6 pin)', async (t) => {
  for (const invalidation of waitInvalidationCases) {
    await t.test(invalidation.label, async (t) => {
      const f = fixture(`a6-inspect-${invalidation.label}`);
      t.after(() => cleanupFixture(f));
      const runId = `run-blind-waits-a6-${invalidation.label}`;
      const started = await startRun(f, runId, `a6-${invalidation.label}`);
      const wake = invalidateRecipientWhenWaitWakes(f, runId, invalidation);
      const semanticEnvelope = f.application._semanticEnvelope.bind(f.application);
      let projectedAfterWait = false;
      f.application._semanticEnvelope = (...args) => {
        projectedAfterWait = true;
        return semanticEnvelope(...args);
      };

      let returned;
      let refusal;
      try {
        returned = await f.application.command('run.inspect', {
          runId, depth: 'outline', cursor: started.cursor, waitMs: 500,
        }, f.recursivePrincipal, recursiveContext(f.lease, `a6-inspect-wait-${invalidation.label}`));
      } catch (error) {
        refusal = error;
      }

      assert.equal(wake.woke(), true, 'the lease changes only inside the durable wait boundary');
      assert.equal(f.driver.coordination.events().some(
        (event) => event.payload?.marker === wake.marker,
      ), true, 'post-invalidation Run data exists and would be visible without revalidation');
      assert.equal(returned, undefined, 'no inspection projection is returned after authority changes (G4 law — the fail-loud landing must not break it)');
      assert.equal(refusal?.code, invalidation.code, 'the typed lease refusal is preserved');
      assert.equal(projectedAfterWait, false, 'semantic Run content is not projected after the recipient lease becomes inactive');
    });
  }
});

test('A7 GREEN: run.follow revalidates its recipient lease after wait and immediately before return (RA7 pin)', async (t) => {
  for (const invalidation of waitInvalidationCases) {
    await t.test(invalidation.label, async (t) => {
      const f = fixture(`a7-follow-${invalidation.label}`);
      t.after(() => cleanupFixture(f));
      const runId = `run-blind-waits-a7-${invalidation.label}`;
      const started = await startRun(f, runId, `a7-${invalidation.label}`);
      const wake = invalidateRecipientWhenWaitWakes(f, runId, invalidation);

      let returned;
      let refusal;
      try {
        returned = await f.application.command('run.follow', {
          runId, afterCursor: started.cursor, timeoutMs: 500,
        }, f.recursivePrincipal, recursiveContext(f.lease, `a7-follow-wait-${invalidation.label}`));
      } catch (error) {
        refusal = error;
      }

      assert.equal(wake.woke(), true, 'the lease changes only after follow enters durable wait');
      assert.equal(f.driver.coordination.events().some(
        (event) => event.payload?.marker === wake.marker,
      ), true, 'post-invalidation Run data exists and would otherwise satisfy follow');
      assert.equal(returned, undefined, 'no follow page is returned after authority changes');
      assert.equal(refusal?.code, invalidation.code, 'the typed lease refusal is preserved');
    });
  }
});

test('D3.2 GREEN: a dead authority refuses even when the run truth is terminal — the two per-cycle checks are independent', async (t) => {
  // D3.2: "a dead authority refuses even when the run truth is terminal" — the per-cycle authority
  // re-check and the per-cycle terminality re-check are INDEPENDENT. A mid-wait revocation at the
  // same instant as a mid-wait terminalization must produce the typed refusal, never the terminal
  // view. This kills the over-claim that fixing A1 (return terminal truth early) short-circuits the
  // transport recheck: an impl that returns the terminal view BEFORE the post-wait authority re-check
  // fails this pin at `authority-check-independent-of-terminality`.
  const terminalDispatch = { schemaVersion: 1, runId: 'run-d32', phase: 'stopped', waitingOn: null, terminalCause: { kind: 'operator_stop', code: 'operator_stop' } };

  await t.test('MCP leg — the post-dispatch recheck refuses even though the dispatched value was terminal', async (t) => {
    const application = {
      repoId: REPO, card: runApplicationCard, async authorizeReplay() { return true; },
      async command() { return terminalDispatch; },
    };
    const { server } = mcpSetup({ application, isPrincipalActive: () => false });
    await mcpInitialized(server);
    t.after(async () => { await server.close().catch(() => {}); });
    const response = await mcpRequest(server, 5, 'tools/call', {
      name: 'fleet_run_wait', arguments: { repoId: REPO, runId: 'run-d32', timeoutMs: 5_000 },
    });
    assert.equal(response.result.isError, true, 'the authority check wins over the terminal truth (D3.2)');
    assert.equal(JSON.parse(response.result.content[0].text).error.code, 'unauthenticated',
      'stage: authority-check-independent-of-terminality — the dead principal refuses even when the run terminalized mid-wait; an impl that early-returns terminal truth before the recheck projects instead of refusing');
  });

  await t.test('web leg — _postWaitAuthorization refuses even though the dispatched value was terminal', async (t) => {
    const application = {
      repoId: REPO, card: runApplicationCard, async authorizeReplay() { return true; },
      async command() { return terminalDispatch; },
    };
    const { web, ctx } = webSetup({ application, isPrincipalActive: () => false });
    const res = await web.execute(ctx, webEnvelope('run_wait', { runId: 'run-d32', timeoutMs: 5_000 }));
    assert.equal(res.status, 401, 'the authority check wins over the terminal truth (D3.2)');
    assert.equal(res.body?.error?.code, 'unauthenticated',
      'stage: authority-check-independent-of-terminality — the web post-wait reauth refuses even though the run terminalized mid-wait');
  });
});

test('P-MCP RED: the MCP post-dispatch recheck list must extend to fleet_run_episode/fleet_run_workstreams (fold-164 B3)', () => {
  // Fold (row-sf164, blue-team P-MCP BROKEN over-pin → FOLDED): the old pin froze the recheck list
  // at the two-verb form, which the folded authority contract requires EXTENDING to the four
  // wait-capable tools (fold-164 B3 → FOLDED; contract D2 MCP row: "extend it to
  // fleet_run_episode/fleet_run_workstreams"; A2). At HEAD the list is still the two-verb form
  // (mcp-northbound.mjs:1510), so the row stays RED until the extension lands — the A2-c/A2-d
  // behavioral rows pin the same gap.
  const recheck = srcAnchor('mcp-northbound.mjs', "const refused = ['fleet_run_follow', 'fleet_run_wait'].includes(name) ? this._authority(name, args) : null;");
  const list = recheck.text.match(/\[[^\]]*\]/u)?.[0] ?? '';
  assert.equal(
    ['fleet_run_follow', 'fleet_run_workstreams', 'fleet_run_episode', 'fleet_run_wait'].every((name) => list.includes(name)),
    true,
    'stage: mcp-recheck-episode-workstreams-missing — the MCP post-dispatch transport recheck list must enumerate the four wait-capable tools (fleet_run_follow/fleet_run_wait/fleet_run_episode/fleet_run_workstreams), per fold-164 B3 + contract D2 MCP row + A2; at HEAD the list covers only the two wait verbs, so a mid-wait revocation on fleet_run_episode/fleet_run_workstreams is not caught post-dispatch');
});

test('P-MCP-ceiling GREEN: invalid_run_wait stays the MCP wait-budget ceiling (A10/MCP pin)', async (t) => {
  // Split from the old P-MCP row (fold): the request-shape ceiling is a GREEN invariant — the #164
  // fold never touches the wait-budget ceiling, and a landed impl must not rename or drop it.
  const application = {
    repoId: REPO, card: runApplicationCard, async authorizeReplay() { return true; },
    async command() { throw new Error('the ceiling must refuse before dispatch'); },
  };
  const { server } = mcpSetup({ application, maxWaitMs: 25_000 });
  await mcpInitialized(server);
  t.after(async () => { await server.close().catch(() => {}); });
  const refused = await mcpRequest(server, 4, 'tools/call', {
    name: 'fleet_run_wait', arguments: { repoId: REPO, runId: 'run-pmcp', timeoutMs: 26_000 },
  });
  assert.equal(refused.result.isError, true);
  assert.equal(JSON.parse(refused.result.content[0].text).error.code, 'invalid_run_wait',
    'the request-shape refusal stays invalid_run_wait (mcp-northbound.mjs:954-955) — the #164 fold never touches the wait-budget ceiling');
});

test('P-WEB GREEN: the web wait refusal keeps the typed 401/403 codes and the application_wait_timeout_exceeds_web_ceiling token stays', async (t) => {
  const application = {
    repoId: REPO, card: runApplicationCard, async authorizeReplay() { return true; },
    async command() { throw new Error('the ceiling must refuse before dispatch'); },
  };
  const { web, ctx } = webSetup({ application });
  const res = await web.execute(ctx, webEnvelope('run_wait', { runId: 'run-pweb', timeoutMs: 31_000 }));
  assert.equal(res.status, 400);
  assert.equal(res.body?.error?.code, 'invalid_command', 'the ceiling is a validation token on the invalid_command body (additive-only — the code is not renamed)');
  assert.equal(res.body?.error?.message, 'application_wait_timeout_exceeds_web_ceiling',
    'the ceiling token stays byte-identical (web-northbound.mjs:417) — a landed impl must not rename or drop it');
});

test('P-CLI GREEN: the CLI run view --until / run status --wait delegate to run.wait — no CLI-local wait seam of its own', () => {
  // D2 seam map, CLI row: the CLI-facing obligation is delegation, not a wait seam of its own. The
  // landed impl must fix the VERBS (run.wait / run.follow), not re-dispatch in the CLI. This pins
  // the delegation at HEAD so a wrong impl that patches the CLI dispatch instead of the verbs is
  // caught, and the #148 driver law's "print the full non-ok envelope" stays a CLI printing duty.
  const viewUntil = srcAnchor('application-cli.mjs', "kind: 'command', name: 'run.wait',");
  const statusWait = srcAnchor('application-cli.mjs', ": { kind: 'command', name: 'run.wait', args: { runId, timeoutMs: duration(wait) }, idempotencyKey };");
  const serverBudget = srcAnchor('application-cli.mjs', "if (['run.follow', 'run.wait'].includes(name)) serverWaitMs = args.timeoutMs;");
  assert.equal(viewUntil.line < statusWait.line, true, 'run view --until (application-cli.mjs:1655) delegates to run.wait before run status --wait (:1712)');
  assert.equal(statusWait.line < serverBudget.line, true, 'the run.follow/run.wait server-side wait budget (:2030) rides the verb dispatch');
});

test('P-FORBIDDEN GREEN: the `forbidden` wait refusal is the capability/repo-scope death, never the lifetime /v1/auth/refresh lane', async (t) => {
  // The refusal table (OQ3): `forbidden` = the principal's capability/repo scope died — its renewal
  // is "re-request with the required capability/repo scope", NOT a lifetime `/v1/auth/refresh`. A
  // landed impl must not blanket-name `/v1/auth/refresh` on EVERY refusal (the over-claim). The code
  // is preserved and no lifetime lane is claimed at HEAD.
  const noObserve = {
    userId: 'mcp-op', sessionId: 'mcp-sess', capabilities: ['control', 'approve'],
    repoIds: [REPO], expiresAt: new Date(NOW_MS + 60_000).toISOString(), revoked: false,
  };

  await t.test('MCP leg — a wait verb from a principal lacking `observe` refuses `forbidden`, no /v1/auth/refresh', async (t) => {
    const application = {
      repoId: REPO, card: runApplicationCard, async authorizeReplay() { return true; },
      async command() { return { schemaVersion: 1, runId: 'run-pforbidden', phase: 'running' }; },
    };
    const { server } = mcpSetup({ application, principal: noObserve });
    await mcpInitialized(server);
    t.after(async () => { await server.close().catch(() => {}); });
    const response = await mcpRequest(server, 6, 'tools/call', {
      name: 'fleet_run_wait', arguments: { repoId: REPO, runId: 'run-pforbidden', timeoutMs: 5_000 },
    });
    assert.equal(response.result.isError, true);
    const envelope = JSON.parse(response.result.content[0].text);
    assert.equal(envelope.error.code, 'forbidden',
      'the scope/capability death refuses `forbidden` (MCP _authority, mcp-northbound.mjs:1333) — never `unauthenticated`');
    assert.notEqual(envelope.error.renewal?.path, '/v1/auth/refresh',
      'stage: forbidden-refusal-distinct-from-lifetime-renewal — a forbidden refusal NEVER names the lifetime refresh lane; the renewal is a scope re-request');
  });

  await t.test('web leg — a wait verb from a principal lacking `observe` refuses 403 `forbidden`, no /v1/auth/refresh', async (t) => {
    const application = {
      repoId: REPO, card: runApplicationCard, async authorizeReplay() { return true; },
      async command() { return { schemaVersion: 1, runId: 'run-pforbidden', phase: 'running' }; },
    };
    const { web, ctx } = webSetup({
      application,
      principal: {
        userId: 'web-op', sessionId: 'web-sess', credentialId: 'web-cred',
        authMethod: 'local', capabilities: ['control'], repoIds: [REPO],
        expiresAt: new Date(NOW_MS + 60_000).toISOString(), revoked: false,
      },
    });
    const res = await web.execute(ctx, webEnvelope('run_wait', { runId: 'run-pforbidden', timeoutMs: 5_000 }));
    assert.equal(res.status, 403, 'the scope/capability death refuses 403 `forbidden` (web _authorize, web-northbound.mjs:675)');
    assert.equal(res.body?.error?.code, 'forbidden');
    assert.notEqual(res.body?.error?.renewal?.path, '/v1/auth/refresh',
      'stage: forbidden-refusal-distinct-from-lifetime-renewal — the web forbidden refusal never names the lifetime lane');
  });
});

test('P-APP RED: the APPLICATION-layer run.wait refusal keeps application_unauthorized AND names the app-layer renewal — never the transport /v1/auth/refresh lane (D1.2(a))', async (t) => {
  const f = fixture('papp');
  t.after(() => cleanupFixture(f));
  const runId = 'run-blind-waits-papp';
  await startRun(f, runId, 'papp');

  // The run starts under the permissive policy; the APPLICATION-layer policy refusal for a
  // wait verb surfaces only at the deployment-policy boundary (authorizeReplay maps run.wait to
  // the read-only 'run.status' command, application.mjs:3432). Flip the policy AFTER the run is
  // live so the refusal is observed on the wait verb alone.
  f.application.authorize = async () => false;
  let refusal;
  try {
    await f.application.command('run.wait', {
      runId, timeoutMs: 30,
    }, f.recursivePrincipal, recursiveContext(f.lease, 'papp-wait'));
  } catch (error) {
    refusal = error;
  }

  assert.equal(refusal?.code, 'application_unauthorized',
    'the deployment-policy refusal stays application_unauthorized (application.mjs:3222) — the fail-loud law does not rename it');
  // Fold (row-sf164, blue-team P-APP BROKEN inverse pin → FOLDED): the v2 authority contract's
  // D1.2(a) requires the per-cycle APPLICATION legs — including the deployment policy — to "refuse
  // the typed code AND name the renewal path on the cycle that observes them"; the refusal table
  // marks application_unauthorized as "refusal naming added" (renew the deployment-policy
  // credential/seat; refresh the session when the principal's session is dead). At HEAD the
  // application refusal carries no renewal field, so the row stays RED until the naming lands.
  assert.equal(typeof refusal?.renewal, 'object',
    'stage: app-refusal-renewal-naming-missing — the application-layer application_unauthorized refusal must name the app-layer renewal lane (the deployment-policy credential/seat / the recursive-lease re-authorization, D1.2(a) + refusal table + OQ3); at HEAD the refusal is code-only, so a caller cannot learn the renewal lane');
  assert.ok(typeof refusal.renewal?.path === 'string' || typeof refusal.renewal?.verb === 'string' || typeof refusal.renewal?.seat === 'string',
    'the app-layer renewal names a concrete lane (lease seat / deployment-policy credential)');
  const serialized = JSON.stringify(refusal);
  assert.equal(serialized.includes('/v1/auth/refresh'), false,
    'the APPLICATION refusal never names the transport-principal /v1/auth/refresh lane — the web refresh path is a TRANSPORT-surface lane (web-northbound.mjs:166); the app-layer renewal names the lease seat / deployment-policy credential, never the web session refresh (the blue-team P-APP fold action)');
});

// ===========================================================================
// §F — additive-only + refusal-table pins (GREEN)
// ===========================================================================

test('A9 GREEN: the terminal/settled literal sets and WAITING_ON_KINDS stay byte-unchanged (additive-only law)', () => {
  assert.deepEqual([...PROVIDER_EXECUTION_SETTLED_PHASES].sort(), [...PINNED_PROVIDER_SETTLED].sort(),
    'PROVIDER_EXECUTION_SETTLED_PHASES is the pinned closed set (application.mjs:157) — a landed impl adds the wait-local predicate, never a phase literal');
  assert.deepEqual([...APPLICATION_RUN_TERMINAL_PHASES].sort(), [...PINNED_APPLICATION_TERMINAL].sort(),
    'APPLICATION_RUN_TERMINAL_PHASES is the pinned closed set (application.mjs:160)');
  assert.deepEqual([...WAITING_ON_KINDS].sort(), ['capacity_ceiling', 'dispatch_pending', 'plan_approval', 'provider_stalled', 'spawning'].sort(),
    'WAITING_ON_KINDS stays the closed five (application-semantics.mjs:59-61) — "stopping" is NEVER admitted to the waitingOn vocabulary');
  assert.equal(PROVIDER_EXECUTION_SETTLED_PHASES.has('stopping'), false, 'stopping stays outside the settled set');
  assert.equal(APPLICATION_RUN_TERMINAL_PHASES.has('stopping'), false, 'stopping stays outside the terminal set');
});

test('A10 GREEN: run.wait\'s request-shape refusal stays application_wait_invalid (the refusal-table fold)', async (t) => {
  const f = fixture('a10');
  t.after(() => cleanupFixture(f));
  const runId = 'run-blind-waits-a10';
  await startRun(f, runId, 'a10');
  for (const args of [
    { runId, timeoutMs: 0 },
    { runId, timeoutMs: 24 * 60 * 60 * 1000 + 1 },
    { runId, timeoutMs: 100, until: 'never' },
    { runId: 'bad/id', timeoutMs: 100 },
  ]) {
    await assert.rejects(
      f.application.command('run.wait', args, f.recursivePrincipal, recursiveContext(f.lease, `a10-${JSON.stringify(args)}`)),
      (error) => error.code === 'application_wait_invalid',
      `run.wait args ${JSON.stringify(args)} refuse application_wait_invalid (application.mjs:1974-1977)`,
    );
  }
});

test('A4-pin GREEN: the #148 DRIVER LAW is documented — the typed refusal + renewal naming is what makes the stop actionable', () => {
  const ledgerPath = fileURLToPath(new URL(
    '../../docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md',
    import.meta.url,
  ));
  const ledger = readFileSync(ledgerPath, 'utf8');
  assert.equal(ledger.includes('DRIVER LAW: any loop over the bus must log the full non-ok envelope and stop on repeated auth failure — never retry-blind'), true,
    'the #148 driver law (G1, ledger Appendix D row 2) is documented as client discipline — the server-side typed refusals A2-a/A2-b/A3-a/A3-b (renewal naming) are what make that stop actionable rather than a blind 25-iteration pump');
});

// ===========================================================================
// §G — workflow evidence (GREEN)
// ===========================================================================

test('P-PUBLISH (folded 2026-08-20): the shared-scratchpad publish lane (run.scratchpad.append, #158) IS landed — the verb validates, the publish-as-you-go law is satisfied', async (t) => {
  const f = fixture('ppublish');
  t.after(() => cleanupFixture(f));
  const runId = 'run-blind-waits-ppublish';
  await startRun(f, runId, 'ppublish');

  let refusal;
  try {
    await f.application.command('run.scratchpad.append', {
      scope: 'shared', kind: 'note', title: '#164', text: 'Publish-as-you-go refusal evidence for the shared scratchpad partition.',
      runId,
    }, f.recursivePrincipal, recursiveContext(f.lease, 'ppublish-append'));
  } catch (error) {
    refusal = error;
  }

  // #158 landed (b41edfed): the verb EXISTS and validates. This pin's original premise
  // (absence → application_command_unavailable) inverted with the landing; the temporally-
  // coupled re-examination the blue-team note demanded. The publish attempt now refuses at
  // VALIDATION (the fixture's shape — the landed envelope is {runId, scope, kind, body},
  // this fixture sends the retired {title, text} form), never at availability. The lane
  // is live: the publish-as-you-go law's workflow evidence is the verb's existence.
  assert.equal(refusal?.code, 'application_scratchpad_append_invalid',
    'the #158 publish verb is LIVE — attempts refuse at validation (retired envelope shape here), never application_command_unavailable. The publish-as-you-go lane exists.');
  assert.notEqual(refusal?.code, 'application_command_unavailable',
    'the ghost refusal would mean the lane regressed to unavailability');
});
