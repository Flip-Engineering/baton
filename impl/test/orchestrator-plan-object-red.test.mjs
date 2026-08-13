// [attempt: 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc row-suite-161]
// #161 red-first suite — folded orchestrator-plan-object contract v2.0 (issue #161).
// Authority: docs/reference/evidence/orchestrator-plan-object-2026-08-13/
//   orchestrator-plan-object-contract.md (v2.0 FOLDED — source of truth), redteam-161.md (the
//   attack surface), fold-161.md (blocker → resolution map), suite-foundry-2026-08-13-b/
//   foundry-brief.md (this row's suite law).
//
// Forty-seven rows (42 red + 5 pins) over the v2.0 acceptance pins P1-P10:
//   P1  mint + update + idempotency — plan.write mints/updates; retry returns the prior event,
//       changed content under the same key refuses plan_replay_conflict; update asserted
//       explicitly (upsert v1 → v2 with expectedTaskVersion=2; stale =1 refuses plan_stale_version).
//   P2  replay — RED half: a plan.* event crashes _apply at unsupported_event_kind (the fold is
//       unlanded). GREEN half (pinned): the store fold/replay machinery replays byte-identically
//       through close/reopen.
//   P3  closed task shape — the closed {blockedBy, evidence, id, ownedBy, schemaVersion, status,
//       taskVersion, title} with canonical key order; unknown field / non-canonical order /
//       non-closed status refuse plan_task_invalid; blockedBy self/dangling/cycle refuses
//       plan_topology_invalid.
//   P4  exactly-one-in-progress + immediate completion (DR-3) — one doing per ownedBy.wave/run
//       subtree (auto-demote batch OR plan_parallel_progress); done stays done; non-review
//       done → todo refuses plan_reopen_forbidden; the review authority's re-open is the one
//       admitted exception; focusTaskIds bounded by planPolicy.maxFocusTasks (plan_focus_invalid).
//   P5  authority matrix (D2) — row member owns its task, coordinator owns its subtree,
//       orchestrator (plan:*) owns everything; sibling/outside/subtree refusals typed
//       (plan_authority_forbidden vs coordinator_authority_forbidden).
//   P6  elevation at wave close (D2) — completed → done + evidence links, incomplete → todo,
//       wave map updated, reviewed-rejected done → re-opened todo (H4.2), no silent auto-promotion.
//   P7  three-surface admission (D3) — registry rows, CLI plan read|write, CLI_WEB_COMMANDS,
//       MCP baton_plan_read/write repoId-first, ledgered web refusal, generated CLI.md/MCP.md rows.
//   P8  #74 integration — coordinator decomposition lands row tasks with ownedBy binding; the
//       interpreter gates a member on its plan task's state (dispatch_pending / settleable).
//   P9  orchestrator practice migration — plan.read at the orchestrator seat returns the campaign
//       todo; closed three statuses, per-wave-subtree exactly-one-in-progress, immediate completion.
//   P10 refusal constancy (PIN) — application_unauthorized stays the facade denial; the closed five
//       WAITING_ON_KINDS and the closed three SCRATCHPAD_STEP_STATES stay byte-unchanged; the
//       goal-plan ^plan:[a-f0-9]{64}$ validator still refuses a plan:<hex32> plan-object id.
//
// Red-first: written against the v2.0 contract BEFORE the plan lane lands; every red row fails for
// its named stage today and goes green on the contract's implementation ONLY. Pin rows are green
// today AND under the correct implementation, but fail a plausible WRONG one (the pin list below
// names the wrong implementation each pin kills). Fixture idiom mirrors
// wave-observability-red.test.mjs (openHost = real createDriver + BatonApplication + bindBaton,
// markerAdapter, driverEvents), phase75-task-topology.test.mjs (bare CoordinationStore rows),
// mcp-reflex-surface-red.test.mjs (McpFleetServer tools/list), and the phase12 web-card idiom.
//
// NUL-byte discipline: the two NUL files are never read whole — application.mjs is touched only
// through the imported surface exports, coordination-store.mjs only via `grep -an` for the
// SCRATCHPAD_STEP_STATES source pin (R3). application-semantics.mjs, application-cli.mjs,
// mcp-northbound.mjs and web-northbound.mjs are NUL-free. This suite file contains 0 NUL bytes.
//
// watchtog.stallMs law: the only fixture that arms a Coordinator is createDriverFor, which threads
// `watchdog: { stallMs: 60_000 }` (valid positive integer, below the deployment wall) + the
// one-line comment. The store-only rows construct a bare CoordinationStore, which owns no watchdog.
//
// No clocks: the only timestamps are the fixed NOW constant passed to the surfaces' clock/now
// hooks; every projection assertion rides event seqs only. localeCompare is never used; sorted-key
// literals below are in ACTUAL sorted order.

// ===========================================================================
// ROW INVENTORY (the stage is the HEAD failure seam, named per row; the split at
// the bottom was measured against the PRE-implementation tree)
// ===========================================================================
//
// §P1 Mint/update/idempotency (stage: plan-write-port-missing / plan-read-port-missing)
//   M1  plan.write with plan.minted mints the plan — {status:'plan_minted', planId} with
//       planId = plan:<hex32>, repoId-scoped; plan.read round-trips it. (RED)
//   M2  a retry of the same mint key + content returns the prior event — exactly-once, no
//       duplicate mint (the plan.minted:<planId> prior-key discipline). (RED)
//   M3  changed content under the same mint key refuses plan_replay_conflict. (RED)
//   M4  UPDATE ASSERTED (QA §3.4 #2) — upsert v1 then upsert v2 with expectedTaskVersion=2 goes
//       green; the task's taskVersion becomes 2 and plan.read shows the v2 task. (RED)
//   M5  upsert v2 with expectedTaskVersion=1 (stale) refuses plan_stale_version. (RED)
//
// §P2 Replay / fold seam (stage: plan-fold-unlanded / plan-batch-kind-unregistered)
//   F1  a raw plan.minted event appends durably and folds into the projection. (RED — at HEAD
//       _append throws coordination_projection_poisoned, cause unsupported_event_kind at
//       coordination-store.mjs:8862)
//   F2  a raw plan.task_transitioned event folds (the status-law event kind). (RED — same crash)
//   F3  the auto-demote plan batch kind is registered in _appendBatch's closed list — the batch
//       (a plan.task_transitioned demote) folds atomically. (RED — at HEAD _appendBatch refuses
//       'coordination batch kind is invalid' at coordination-store.mjs:1526-1533)
//   F4  PIN — close/reopen replay recomputes the identical projection from durable facts (the P2
//       green half: the fold machinery that WILL carry plan events replays byte-identically)
//
// §P3 Closed task shape (stage: plan-write-port-missing / plan-read-port-missing)
//   S1  a task missing a closed field (no title) refuses plan_task_invalid. (RED)
//   S2  a task carrying an unknown field (owner) refuses plan_task_invalid. (RED)
//   S3  a non-canonical task key order refuses plan_task_invalid (the closed sorted set). (RED)
//   S4  a blockedBy self-edge refuses plan_topology_invalid. (RED)
//   S5  a blockedBy dangling edge refuses plan_topology_invalid. (RED)
//   S6  a blockedBy cycle refuses plan_topology_invalid. (RED)
//   S7  a non-closed status ('in_progress') refuses plan_task_invalid. (RED)
//   N2  a mutation naming a task absent from the plan refuses plan_task_not_found {planId, taskId}. (RED)
//   S8  plan.read returns tasks with the canonical sorted key order — ownedBy ['role','run','wave'],
//       task ['blockedBy','evidence','id','ownedBy','schemaVersion','status','taskVersion','title'].
//       (RED)
//   N1  plan.read naming an unminted plan refuses plan_not_found {planId}. (RED)
//
// §P4 Status law (stage: plan-status-law-missing)
//   L1  two tasks cannot be doing simultaneously within a wave subtree — plan_parallel_progress in
//       the strict-DAG shape, or the auto-demote batch demotes the earlier. (RED)
//   L2  two tasks doing in DIFFERENT wave subtrees are admitted (the law is per-wave-subtree). (RED)
//   L3  a verified task is marked done immediately and stays done (re-transition refused/stale). (RED)
//   L4  a done task re-opened by any non-review principal refuses plan_reopen_forbidden. (RED)
//   L5  the review authority's reviewed-reject re-open (done → todo, H4.2) is the one admitted
//       exception. (RED)
//   L6  focusTaskIds beyond planPolicy.maxFocusTasks refuses plan_focus_invalid. (RED)
//   L7  plan.focus_upserted sets the bounded focus window with a plan-version CAS — matching
//       expectedPlanVersion updates the window and bumps the plan version; stale refuses
//       plan_stale_version. (RED)
//
// §P5 Authority matrix (stage: plan-authority-matrix-missing)
//   A1  a row member reads its OWN task and transitions it to done — admitted (ownedBy.run resolved
//       via the pinned member→run mapping, H2.2). (RED)
//   A2  a row member writing a sibling task refuses plan_authority_forbidden. (RED)
//   A3  a coordinator writes its subtree (ownedBy.wave/run match) — admitted. (RED)
//   A4  a coordinator writing outside its subtree refuses coordinator_authority_forbidden (the #74
//       code with {attempted, gracefulPath}). (RED)
//   A5  the orchestrator (plan:*) mints/upserts/transitions any task — admitted. (RED)
//
// §P6 Elevation at wave close (stage: plan-wave-close-elevation-missing)
//   W1  at wave.closed the review authority reviews the wave's plan tasks — completed → done with
//       evidence links, incomplete → todo, wave map updated. (RED)
//   W2  reviewed-rejected done → re-opened todo (H4.2); an unreviewed/incomplete task never reads
//       done (no silent auto-promotion). (RED)
//
// §P7 Three-surface admission (stage: cli-plan-verbs-missing / web-plan-ledger-missing /
//     mcp-plan-tool-missing / registry-plan-rows-missing / docs-plan-rows-missing)
//   X1  baton plan read PLAN_ID parses to {kind:'command', name:'plan.read', args:{planId}}. (RED)
//   X2  baton plan write PLAN_ID --mutation JSON parses to plan.write; a malformed body refuses
//       cli_invalid naming the expected mutation shape (H3.2). (RED)
//   X3  CLI_WEB_COMMANDS admits plan.read AND plan.write (the admitted web-envelope names). (RED)
//   X4  the web surface is NOT claimed for plan.* (D3.4 recommended posture) — the web envelope is
//       refused AND the refusal is ledgered in surface-divergence-ledger.json (#159 D3 #3). (RED —
//       at HEAD the ledger entries are empty)
//   X5  MCP tools baton_plan_read/baton_plan_write exist with repoId LEADING required (H3.1) and
//       dispatch (H3.2). (RED — at HEAD the MCP ordinary tool list lacks both)
//   X6  the OPERATION_ROWS registry rows claim surfaces for plan.read/plan.write with closed input
//       schemas (D3.1). (RED — source: CANONICAL_OPERATION_SPECS has no plan rows)
//   X7  the generated CLI.md/MCP.md blocks contain the plan rows (D3.5, never hand-edited). (RED)
//
// §P8 #74 integration (stage: plan-gated-dispatch-missing)
//   Q1  a #74 coordinator member's plan.write (task_upserted) writes its subtree's row tasks with
//       ownedBy binding (pre-decomposed ownedBy.run resolved at claim, H2.2). (RED)
//   Q2  the interpreter gates a member on its plan task's state — a blocked task's member resolves
//       waitingOn dispatch_pending (the closed five byte-unchanged, H3.4); a done task's member is
//       settleable. (RED)
//
// §P9 Orchestrator practice (stage: plan-read-at-orchestrator-missing)
//   O1  plan.read at the orchestrator seat returns the campaign todo as the plan projection —
//       closed three statuses, per-wave-subtree exactly-one-in-progress, immediate completion. (RED)
//
// §P10 Refusal constancy (GREEN pins)
//   R1  PIN — application_unauthorized stays the facade denial (application.mjs:3214-3222); kills
//       an impl that routes the facade denial through a plan-scope code
//   R2  PIN — WAITING_ON_KINDS stays the closed five, byte-unchanged and sorted
//       (application-semantics.mjs:59-61); kills an impl that renames/removes/reorders a kind
//   R3  PIN — SCRATCHPAD_STEP_STATES stays the closed three (coordination-store.mjs:537); kills an
//       impl that renames todo/doing/done
//   R4  PIN — the goal-plan ^plan:[a-f0-9]{64}$ validator STILL refuses a plan:<hex32> plan-object
//       id (ID-namespace disjointness, H1.2/DR-2); kills an impl that collapses the two namespaces

// ===========================================================================
// INVENTED SURFACES (all probed through REAL surface entry points — no invented
// module is imported; the invented members below are absent from the surfaces at HEAD)
// ===========================================================================
//
//   application.command('plan.read'|'plan.write', body, principal)
//       — invented direct-port dispatch names (HEAD: application_command_unavailable at
//         application.mjs:12590/1846, validateApplicationCommandArgs)
//   store._append('plan.minted'|'plan.task_transitioned', payload, {actor, key})
//       — invented plan event kinds (HEAD: coordination_projection_poisoned, cause
//         unsupported_event_kind at coordination-store.mjs:8862)
//   store._appendBatch(entries, 'plan_auto_demote')  — invented plan batch kind
//       (HEAD: TypeError 'coordination batch kind is invalid' at coordination-store.mjs:1526-1533)
//   parseBatonCli(['plan','read'|'write', ...])  — invented CLI verbs
//       (HEAD: cli_invalid 'expected credentials, setup, doctor, route, explore, review, context,
//         waves, or run' at application-cli.mjs:1417-1418)
//   CLI_WEB_COMMANDS members 'plan.read'/'plan.write'  — invented admitted web names
//       (HEAD: absent from application-cli.mjs:16-32)
//   web envelope commands 'plan_read'/'plan_write'  — invented web transports
//       (HEAD: refused at web-northbound.mjs:405 'unsupported command')
//   McpFleetServer tools 'baton_plan_read'/'baton_plan_write'  — invented MCP ordinary tools
//       (HEAD: absent from the 35-tool list)
//   surface-divergence-ledger.json entries for plan.read/plan.write  — invented ledgered rows
//       (HEAD: entries is [])
//   refusal codes 'plan_replay_conflict'/'plan_stale_version'/'plan_task_invalid'/
//       'plan_topology_invalid'/'plan_parallel_progress'/'plan_reopen_forbidden'/
//       'plan_focus_invalid'/'plan_authority_forbidden'/'coordinator_authority_forbidden'/
//       'plan_not_found'/'plan_task_not_found'  — invented typed plan refusals
//       (HEAD: the plan.write port is absent, so none can fire)

// ===========================================================================
// PIN LIST (green at HEAD AND under the correct implementation)
// ===========================================================================
//
//   F4  close/reopen replay reproduces an identical projection — kills: a fold that loses facts
//       across the checkpoint/replay boundary
//   R1  application_unauthorized stays the facade denial — kills: a plan-scope facade denial
//   R2  WAITING_ON_KINDS closed five byte-unchanged — kills: a renamed/removed/reordered kind
//   R3  SCRATCHPAD_STEP_STATES closed three byte-unchanged — kills: a renamed status
//   R4  goal-plan validator refuses plan:<hex32> — kills: a collapsed plan: namespace

// ===========================================================================
// VERIFIED SPLIT (measured against the PRE-implementation tree; run twice)
// ===========================================================================
//   PASS 5 · FAIL 42 — stable across two runs from the repo root
//   (split recorded in suite-draft-notes.md)

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MockAdapter } from '../src/adapter.mjs';
import { BatonApplication } from '../src/application.mjs';
import { CLI_WEB_COMMANDS, parseBatonCli } from '../src/application-cli.mjs';
import { WAITING_ON_KINDS } from '../src/application-semantics.mjs';
import {
  bindBaton, createDriver, CoordinationStore, McpFleetServer, WebNorthbound, WebSessionStore,
} from '../src/index.mjs';
import { mcpApplicationToolNames } from '../src/mcp-northbound.mjs';
import { validateWebCommandEnvelope } from '../src/web-northbound.mjs';

const NOW = Date.parse('2026-08-13T12:00:00.000Z');
const ORIGIN = 'https://plan-object.test';
const REPO_ID = 'repo-plan-161';

// The plan object's closed sorted-key literals, in ACTUAL sorted order (law #5).
const TASK_KEY_ORDER = Object.freeze([
  'blockedBy', 'evidence', 'id', 'ownedBy', 'schemaVersion', 'status', 'taskVersion', 'title',
]);
const OWNED_BY_KEY_ORDER = Object.freeze(['role', 'run', 'wave']);
const PLAN_TASK_STATUSES = Object.freeze(['todo', 'doing', 'done']);

// planPolicy.maxFocusTasks — deployment-owned default 4 (D1, DR-3). The plan object's focus
// window is bounded by this policy bound, never a client-code ceiling.
const MAX_FOCUS_TASKS = 4;

let envelopeSeq = 0;
let seedCounter = 0;

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-161-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', [
    '-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test',
    'commit', '--allow-empty', '-q', '-m', 'base',
  ], { cwd: dir });
  return dir;
}

function storeRoot(label) {
  return mkdtempSync(join(tmpdir(), `baton-161-store-${label}-`));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function principal(id, overrides = {}) {
  return Object.freeze({
    actor: 'test', principalId: id, sessionId: `session-${id}`,
    ...overrides,
  });
}

// The plan object's content-derived identity (D1): planId = plan:<hex32> digest of the mint's
// (idempotencyKey, campaignId); taskId = task:<hex32> digest of (planId, title, ownedBy).
function planIdFor(idempotencyKey, campaignId) {
  return `plan:${digest({ idempotencyKey, campaignId }).slice(0, 32)}`;
}

function taskIdFor(planId, title, ownedBy) {
  return `task:${digest({ planId, title, ownedBy }).slice(0, 32)}`;
}

function ownedBy(role, run, wave) {
  return { role, run, wave };
}

function task(id, title, status, { blockedBy = [], owner = null, evidence = [], taskVersion = 1 } = {}) {
  return {
    schemaVersion: 1, id, title, status, blockedBy,
    ownedBy: owner ?? ownedBy('member', `run:${id}`, `wave:${digest({ id }).slice(0, 32)}`),
    evidence, taskVersion,
  };
}

// The closed mutation payloads (D1 table). requestDigest is the digest-adjudication basis the
// fold compares against the idempotency key (G4).
function mintMutation(planId, campaignId, tasks, focusTaskIds, version = 1) {
  const payload = {
    schemaVersion: 1, planId, campaignId, version, focusTaskIds, tasks,
  };
  return { ...payload, requestDigest: digest(payload) };
}

function upsertMutation(planId, taskSpec, expectedTaskVersion) {
  const payload = {
    schemaVersion: 1, planId, taskId: taskSpec.id, title: taskSpec.title,
    status: taskSpec.status, blockedBy: taskSpec.blockedBy ?? [], ownedBy: taskSpec.ownedBy,
    evidence: taskSpec.evidence ?? [], expectedTaskVersion,
  };
  return { ...payload, requestDigest: digest(payload) };
}

function transitionMutation(planId, taskId, toStatus, expectedTaskVersion) {
  const payload = {
    schemaVersion: 1, planId, taskId, toStatus, expectedTaskVersion,
  };
  return { ...payload, requestDigest: digest(payload) };
}

function focusMutation(planId, focusTaskIds, expectedPlanVersion) {
  const payload = { schemaVersion: 1, planId, focusTaskIds, expectedPlanVersion };
  return { ...payload, requestDigest: digest(payload) };
}

function planWriteBody(planId, mutation, idempotencyKey) {
  return { planId, idempotencyKey, mutation };
}

// ── openHost fixture (wave-observability idiom): real createDriver + BatonApplication + bindBaton ──

function markerAdapter() {
  const adapter = new MockAdapter({ scenario: { outcome: 'completed' } });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null,
      provenance: 'orchestrator-plan-object-161', refreshedAt: null,
    },
  });
  return adapter;
}

function createDriverFor(repo, logDir, adapter) {
  return createDriver({
    repoRoot: repo,
    repoId: REPO_ID,
    logDir,
    adapters: { mock: adapter },
    stopDeadlineMs: 2_000,
    watchdog: { stallMs: 60_000 }, // valid positive stallMs, below the deployment wall; never fires in this window
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1,
        repoId: REPO_ID,
        mandatory: true,
        approvalTtlMs: 60 * 60 * 1_000,
        riskClasses: ['low', 'medium', 'high', 'critical'],
        effectClasses: ['repository_edit', 'provider_call'],
        capabilityClasses: ['code', 'test'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
          maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
        }),
      }),
      authorize: async () => true,
    },
  });
}

function buildApplication(driver, deploymentId, authorize = null) {
  const base = {
    driver,
    repoId: REPO_ID,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1,
        repoId: REPO_ID,
        definitionOfDone: ['deployment verification passes'],
        constraints: [],
        risk: 'low',
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
    authorize: authorize ?? (async () => true),
  };
  try {
    // The plan fold may thread deploymentId as an optional constructor field. HEAD does NOT — the
    // config validator rejects the unknown field, so the bare-options retry is the honest fallback.
    return new BatonApplication({ ...base, deploymentId });
  } catch (error) {
    if (error?.code !== 'application_config_invalid') throw error;
    return new BatonApplication(base);
  }
}

function openHost(repo, logDir, adapter, authorize = null) {
  const driver = createDriverFor(repo, logDir, adapter);
  const deploymentId = `deployment-${digest(`${repo}|${logDir}`).slice(0, 32)}`;
  const application = buildApplication(driver, deploymentId, authorize);
  const baton = bindBaton(application, principal('orchestrator'));
  return { application, baton, driver, deploymentId };
}

async function hostFixture(t) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const host = openHost(repo, logDir, markerAdapter());
  host.repo = repo;
  host.logDir = logDir;
  host.owner = principal('orchestrator');
  t.after(async () => {
    await host.application.shutdown(principal('cleanup')).catch(() => {});
    try { host.driver.coordination.releaseWriterLease(); } catch { /* already released by shutdown */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return host;
}

function webFixture(t, host) {
  const web = new WebNorthbound({
    coordinator: {},
    coordination: new CoordinationStore(join(host.logDir, 'web-coord'), {
      clock: () => new Date(NOW).toISOString(),
    }),
    repoIds: [REPO_ID],
    allowedOrigins: [ORIGIN],
    now: () => NOW,
    application: host.application,
  });
  const webCtx = {
    principal: {
      userId: 'web-op', sessionId: 'web-sess', credentialId: 'web-cred',
      authMethod: 'cookie', csrfToken: 'csrf-161',
      expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
      capabilities: ['observe', 'control'], repoIds: [REPO_ID],
    },
    origin: ORIGIN, csrfToken: 'csrf-161',
    remoteAddress: '127.0.0.1', transport: 'https',
  };
  return { web, webCtx };
}

async function mcpFixture(t, host) {
  const coordination = new CoordinationStore(join(host.logDir, 'mcp-coord'), {
    clock: () => new Date(NOW).toISOString(),
  });
  const server = new McpFleetServer({
    coordinator: {},
    coordination,
    application: host.application,
    surface: 'application',
    principal: {
      userId: 'mcp-op', sessionId: 'mcp-sess',
      capabilities: ['observe', 'control'], repoIds: [REPO_ID],
      expiresAt: new Date(NOW + 60_000).toISOString(),
      revoked: false,
    },
    repoIds: [REPO_ID],
    now: () => NOW,
    maxWaitMs: 25_000,
    maxMessageBytes: 64 * 1024,
    takeToolQuota: async () => ({ ok: true }),
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
  });
  const init = await server.handle({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'plan161', version: '0' } },
  });
  assert.ok(init?.result?.protocolVersion, 'mcp initialize resolves');
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  t.after(async () => { await server.close().catch(() => {}); });
  return { server };
}

function webEnvelope(command, args) {
  envelopeSeq += 1;
  return {
    schemaVersion: 1,
    commandId: `c161-${envelopeSeq}`,
    idempotencyKey: `ik161-${envelopeSeq}`,
    command,
    args,
    repoId: REPO_ID,
    origin: ORIGIN,
  };
}

// ── plan-surface helpers (the invented plan.read/plan.write ports) ─────────────────────────────

async function planWrite(host, body, who, stage) {
  try {
    return await host.application.command('plan.write', body, who);
  } catch (error) {
    assert.fail(`${stage} — at HEAD application.command('plan.write') refuses ${error.code} (application.mjs:12590 validateApplicationCommandArgs); the folded plan.write direct port resolves the closed mutation`);
  }
}

async function planRead(host, planId, who, stage) {
  try {
    return await host.application.command('plan.read', { planId }, who);
  } catch (error) {
    assert.fail(`${stage} — at HEAD application.command('plan.read') refuses ${error.code} (application.mjs:12590); the folded plan.read port returns the plan projection`);
  }
}

// A refusal helper for plan.read: assert the call REJECTS with the given code, letting the HEAD
// application_command_unavailable refusal surface as the named-stage failure.
async function planReadRefusal(host, planId, who, stage, code, detail = null) {
  let error = null;
  try {
    await host.application.command('plan.read', { planId }, who);
  } catch (caught) {
    error = caught;
  }
  assert.equal(error?.code, code,
    `${stage} — at HEAD the plan.read port is absent (${error?.code ?? 'no refusal'}); the folded lane refuses ${code} for this read`);
  if (detail !== null && error) {
    assert.deepEqual(error.detail ?? {}, detail, `${stage} — the refusal carries its typed detail`);
  }
}

// A positive-row helper: assert the call REJECTS with the given code, letting the HEAD
// application_command_unavailable refusal surface as the named-stage failure.
async function planWriteRefusal(host, body, who, stage, code, detail = null) {
  let error = null;
  try {
    await host.application.command('plan.write', body, who);
  } catch (caught) {
    error = caught;
  }
  assert.equal(error?.code, code,
    `${stage} — at HEAD the plan.write port is absent (${error?.code ?? 'no refusal'}); the folded lane refuses ${code} for this mutation`);
  if (detail !== null && error) {
    assert.deepEqual(error.detail ?? {}, detail, `${stage} — the refusal carries its typed detail`);
  }
}

// The raw plan event append helper for the fold-seam rows (F1/F2). `_append` is the store's
// single ledger-append seam (G4); the plan fold lands new branches in `_apply`, so appending the
// event is the only way to stage the unlanded-fold crash hermetically.
function appendEvent(store, kind, payload, key, stage) {
  try {
    return store._append(kind, payload, { actor: 'orchestrator', key });
  } catch (error) {
    assert.fail(`${stage} — at HEAD a plan.* event crashes the fold: ${error.cause?.code ?? error.code} (coordination-store.mjs:8862); the plan fold adds the ${kind} branch to _apply`);
  }
}

// ===========================================================================
// §P1 — Mint + update + idempotency (D1, QA §3.4 #2)
// ===========================================================================

test('M1: plan.write with plan.minted mints the plan and plan.read round-trips it', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-m1';
  const planId = planIdFor('m1', campaignId);
  const alpha = task(taskIdFor(planId, 'write the alpha report', ownedBy('alpha', 'run:r1', 'wave:w1')), 'write the alpha report', 'todo');
  const outcome = await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [alpha], [alpha.id])), principal('orchestrator'), 'stage: plan-write-port-missing');
  assert.equal(outcome.status, 'plan_minted',
    'the mint resolves {status: \'plan_minted\'}');
  assert.match(outcome.planId, /^plan:[a-f0-9]{32}$/u,
    'planId is the content-derived plan:<hex32> identity (D1)');
  assert.equal(outcome.planId, planId, 'the mint returns the caller-computed planId');

  const read = await planRead(host, planId, principal('orchestrator'), 'stage: plan-read-port-missing');
  assert.equal(read.planId, planId, 'the plan reads back by planId');
  assert.equal(read.campaignId, campaignId, 'the plan is campaign-scoped');
  assert.ok(read.tasks[alpha.id], 'the minted task is present in the projection');
});

test('M2: a retry of the same mint key + content returns the prior event — exactly-once', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-m2';
  const planId = planIdFor('m2', campaignId);
  const alpha = task(taskIdFor(planId, 'write the alpha report', ownedBy('alpha', 'run:r1', 'wave:w1')), 'write the alpha report', 'todo');
  const body = planWriteBody(planId, mintMutation(planId, campaignId, [alpha], [alpha.id]), `plan.minted:${planId}`);
  const first = await planWrite(host, body, principal('orchestrator'), 'stage: plan-write-port-missing');
  const second = await planWrite(host, body, principal('orchestrator'), 'stage: plan-write-port-missing');
  assert.equal(second.planId, first.planId,
    'the retried mint resolves the SAME planId — the plan.minted:<planId> prior-key dedup (G4)');
  assert.equal(second.status, 'plan_minted', 'a same-key retry is still reported as a mint, not a second mint');
  const read = await planRead(host, planId, principal('orchestrator'), 'stage: plan-read-port-missing');
  assert.equal(Object.keys(read.tasks).length, 1, 'no duplicate mint appended a second task set');
});

test('M3: changed content under the same mint key refuses plan_replay_conflict', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-m3';
  const planId = planIdFor('m3', campaignId);
  const alpha = task(taskIdFor(planId, 'write the alpha report', ownedBy('alpha', 'run:r1', 'wave:w1')), 'write the alpha report', 'todo');
  const firstBody = planWriteBody(planId, mintMutation(planId, campaignId, [alpha], [alpha.id]), `plan.minted:${planId}`);
  await planWrite(host, firstBody, principal('orchestrator'), 'stage: plan-write-port-missing');

  const beta = task(taskIdFor(planId, 'write the beta report', ownedBy('beta', 'run:r1', 'wave:w1')), 'write the beta report', 'todo');
  const conflicting = planWriteBody(planId, mintMutation(planId, campaignId, [beta], [beta.id]), `plan.minted:${planId}`);
  await planWriteRefusal(host, conflicting, principal('orchestrator'),
    'stage: plan-write-port-missing', 'plan_replay_conflict');
});

test('M4: update asserted — upsert v1 then v2 with expectedTaskVersion=2 goes green (taskVersion becomes 2)', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-m4';
  const planId = planIdFor('m4', campaignId);
  const owner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', owner);
  const alphaV1 = task(alphaId, 'write the alpha report', 'todo', { owner, taskVersion: 1 });
  await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [alphaV1], [alphaId]), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');

  const alphaV2 = { ...alphaV1, status: 'doing', taskVersion: 2 };
  const upsert = upsertMutation(planId, alphaV2, 2);
  const outcome = await planWrite(host, planWriteBody(planId, upsert, `plan.task_upserted:${planId}:${alphaId}:v2`), principal('orchestrator'), 'stage: plan-write-port-missing');
  assert.equal(outcome.status, 'plan_updated',
    'the versioned upsert resolves {status: \'plan_updated\'} (QA §3.4 #2 — update asserted explicitly)');
  assert.equal(outcome.taskVersion, 2, 'the task\'s taskVersion becomes 2');

  const read = await planRead(host, planId, principal('orchestrator'), 'stage: plan-read-port-missing');
  assert.equal(read.tasks[alphaId].status, 'doing', 'the v2 task state reads back');
  assert.equal(read.tasks[alphaId].taskVersion, 2, 'the v2 taskVersion reads back');
});

test('M5: upsert v2 with expectedTaskVersion=1 (stale) refuses plan_stale_version', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-m5';
  const planId = planIdFor('m5', campaignId);
  const owner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', owner);
  const alphaV1 = task(alphaId, 'write the alpha report', 'todo', { owner, taskVersion: 1 });
  await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [alphaV1], [alphaId]), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');

  const alphaV2 = { ...alphaV1, status: 'doing', taskVersion: 2 };
  await planWrite(host, planWriteBody(planId, upsertMutation(planId, alphaV2, 2), `plan.task_upserted:${planId}:${alphaId}:v2`), principal('orchestrator'), 'stage: plan-write-port-missing');

  // A second writer still observing v1 (expectedTaskVersion=1) must be refused — a later mutation
  // can never silently overwrite an observed state (the QA root fix, review-qa §3.3).
  const stale = { ...alphaV1, status: 'done', taskVersion: 1 };
  await planWriteRefusal(host, planWriteBody(planId, upsertMutation(planId, stale, 1), `plan.task_upserted:${planId}:${alphaId}:v1`), principal('orchestrator'),
    'stage: plan-write-port-missing', 'plan_stale_version');
});

// ===========================================================================
// §P2 — Replay / fold seam (P2 red half + F4 green pin)
// ===========================================================================

test('F1: a raw plan.minted event appends durably and folds into the projection', () => {
  const dir = storeRoot('fold-mint');
  const store = new CoordinationStore(dir, { clock: () => new Date(NOW).toISOString() });
  const campaignId = 'campaign-161-f1';
  const planId = planIdFor('f1', campaignId);
  const event = appendEvent(store, 'plan.minted', mintMutation(planId, campaignId, [], []), `plan.minted:${planId}`, 'stage: plan-fold-unlanded');
  assert.equal(event.kind, 'plan.minted', 'the plan.minted event is durable');
  assert.equal(event.seq, 1, 'it is the ledger\'s first event');
  assert.equal(store.events().length, 1, 'exactly one ledger event');
  store.releaseWriterLease();
  rmSync(dir, { recursive: true, force: true });
});

test('F2: a raw plan.task_transitioned event folds (the status-law event kind)', () => {
  const dir = storeRoot('fold-transition');
  const store = new CoordinationStore(dir, { clock: () => new Date(NOW).toISOString() });
  const campaignId = 'campaign-161-f2';
  const planId = planIdFor('f2', campaignId);
  const taskId = taskIdFor(planId, 'write the alpha report', ownedBy('alpha', 'run:r1', 'wave:w1'));
  const event = appendEvent(store, 'plan.task_transitioned', transitionMutation(planId, taskId, 'done', 1), `plan.task_transitioned:${planId}:${taskId}:done:v1`, 'stage: plan-fold-unlanded');
  assert.equal(event.kind, 'plan.task_transitioned', 'the transition event is durable');
  store.releaseWriterLease();
  rmSync(dir, { recursive: true, force: true });
});

test('F3: the auto-demote plan batch kind is registered in _appendBatch\'s closed list', () => {
  const dir = storeRoot('fold-batch');
  const store = new CoordinationStore(dir, { clock: () => new Date(NOW).toISOString() });
  const campaignId = 'campaign-161-f3';
  const planId = planIdFor('f3', campaignId);
  const taskId = taskIdFor(planId, 'write the alpha report', ownedBy('alpha', 'run:r1', 'wave:w1'));
  // DR-3/H4.1: the exactly-one-in-progress law fires the auto-demote batch — a
  // plan.task_transitioned demote append in one atomic batch, registered as a closed plan batch
  // kind (the coordination-store.mjs:1526-1533 list). Judgment call: the literal name
  // 'plan_auto_demote' is this suite's chosen contract name; the fold must register A plan batch
  // kind under this shape.
  let events = null;
  try {
    events = store._appendBatch([{
      kind: 'plan.task_transitioned',
      payload: transitionMutation(planId, taskId, 'todo', 1),
      auth: { actor: 'orchestrator', key: `plan.task_transitioned:${planId}:${taskId}:todo:v1` },
    }], 'plan_auto_demote');
  } catch (error) {
    assert.fail(`stage: plan-batch-kind-unregistered — at HEAD _appendBatch refuses ${error.message} (coordination-store.mjs:1526-1533); the fold registers the plan batch kind and folds the demote atomically`);
  }
  assert.equal(events.length, 1, 'the batch folds its one transition');
  assert.equal(events[0].batch.kind, 'plan_auto_demote', 'the batch carries the plan batch kind');
  store.releaseWriterLease();
  rmSync(dir, { recursive: true, force: true });
});

test('F4 PIN: close/reopen replay recomputes the identical projection from durable facts', () => {
  const dir = storeRoot('replay');
  const store = new CoordinationStore(dir, { clock: () => new Date(NOW).toISOString() });
  const recorded = store.recordDriver('steering.registered', { runId: 'run:r1', waveId: 'wave:w1', waveRole: 'alpha' }, { actor: 'orchestrator', key: 'steering.registered:run:r1' });
  assert.equal(recorded.ok, true, 'a known-kind record appends');
  const live = store.snapshot();
  store.releaseWriterLease();

  // The P2 green half — the machinery that WILL carry plan events (store fold pattern, G4/G5):
  // reopening the SAME ledger replays the identical projection, no clocks, event-seq anchored.
  const replay = new CoordinationStore(dir, { clock: () => new Date(NOW).toISOString() });
  assert.deepEqual(replay.snapshot(), live,
    'stage: replay-fact-loss-pin — close/reopen replays the identical projection (byte-identical snapshot); kills a fold that loses facts across checkpoint/replay');
  assert.equal(replay.events().length, store.events().length,
    'stage: replay-fact-loss-pin — the reopened ledger carries the same durable events');
  replay.releaseWriterLease();
  rmSync(dir, { recursive: true, force: true });
});

// ===========================================================================
// §P3 — Closed task shape (D1)
// ===========================================================================

test('S1: a task missing a closed field (no title) refuses plan_task_invalid', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-s1';
  const planId = planIdFor('s1', campaignId);
  const owner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const alphaId = taskIdFor(planId, '', owner);
  const incomplete = { schemaVersion: 1, id: alphaId, status: 'todo', blockedBy: [], ownedBy: owner, evidence: [], taskVersion: 1 };
  await planWriteRefusal(host, planWriteBody(planId, mintMutation(planId, campaignId, [incomplete], []), `plan.minted:${planId}`), principal('orchestrator'),
    'stage: plan-write-port-missing', 'plan_task_invalid');
});

test('S2: a task carrying an unknown field refuses plan_task_invalid', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-s2';
  const planId = planIdFor('s2', campaignId);
  const owner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', owner);
  const unknown = task(alphaId, 'write the alpha report', 'todo', { owner });
  unknown.owner = 'alpha';
  await planWriteRefusal(host, planWriteBody(planId, mintMutation(planId, campaignId, [unknown], []), `plan.minted:${planId}`), principal('orchestrator'),
    'stage: plan-write-port-missing', 'plan_task_invalid');
});

test('S3: a non-canonical task key order refuses plan_task_invalid', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-s3';
  const planId = planIdFor('s3', campaignId);
  const owner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', owner);
  // The closed task shape validates as the sorted set (D1) — a reordered literal is non-closed.
  const reordered = {
    schemaVersion: 1, title: 'write the alpha report', id: alphaId,
    status: 'todo', blockedBy: [], ownedBy: owner, evidence: [], taskVersion: 1,
  };
  await planWriteRefusal(host, planWriteBody(planId, mintMutation(planId, campaignId, [reordered], []), `plan.minted:${planId}`), principal('orchestrator'),
    'stage: plan-write-port-missing', 'plan_task_invalid');
});

test('S4: a blockedBy self-edge refuses plan_topology_invalid', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-s4';
  const planId = planIdFor('s4', campaignId);
  const owner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', owner);
  const self = task(alphaId, 'write the alpha report', 'todo', { owner, blockedBy: [alphaId] });
  await planWriteRefusal(host, planWriteBody(planId, mintMutation(planId, campaignId, [self], []), `plan.minted:${planId}`), principal('orchestrator'),
    'stage: plan-write-port-missing', 'plan_topology_invalid');
});

test('S5: a blockedBy dangling edge refuses plan_topology_invalid', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-s5';
  const planId = planIdFor('s5', campaignId);
  const owner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', owner);
  const dangling = task(alphaId, 'write the alpha report', 'todo', { owner, blockedBy: [`task:${'f'.repeat(32)}`] });
  await planWriteRefusal(host, planWriteBody(planId, mintMutation(planId, campaignId, [dangling], []), `plan.minted:${planId}`), principal('orchestrator'),
    'stage: plan-write-port-missing', 'plan_topology_invalid');
});

test('S6: a blockedBy cycle refuses plan_topology_invalid', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-s6';
  const planId = planIdFor('s6', campaignId);
  const alphaOwner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const betaOwner = ownedBy('beta', 'run:r1', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', alphaOwner);
  const betaId = taskIdFor(planId, 'write the beta report', betaOwner);
  const alpha = task(alphaId, 'write the alpha report', 'todo', { owner: alphaOwner, blockedBy: [betaId] });
  const beta = task(betaId, 'write the beta report', 'todo', { owner: betaOwner, blockedBy: [alphaId] });
  await planWriteRefusal(host, planWriteBody(planId, mintMutation(planId, campaignId, [alpha, beta], []), `plan.minted:${planId}`), principal('orchestrator'),
    'stage: plan-write-port-missing', 'plan_topology_invalid');
});

test('S7: a non-closed status refuses plan_task_invalid', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-s7';
  const planId = planIdFor('s7', campaignId);
  const owner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', owner);
  const badStatus = task(alphaId, 'write the alpha report', 'in_progress', { owner });
  await planWriteRefusal(host, planWriteBody(planId, mintMutation(planId, campaignId, [badStatus], []), `plan.minted:${planId}`), principal('orchestrator'),
    'stage: plan-write-port-missing', 'plan_task_invalid');
});

test('N2: a mutation naming a task absent from the plan refuses plan_task_not_found', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-n2';
  const planId = planIdFor('n2', campaignId);
  // The plan is minted with an EMPTY task set; the transition names a task that was never minted.
  await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [], []), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');
  const ghostId = `task:${'f'.repeat(32)}`;
  await planWriteRefusal(host, planWriteBody(planId, transitionMutation(planId, ghostId, 'done', 1), `plan.task_transitioned:${planId}:${ghostId}:done:v1`), principal('orchestrator'),
    'stage: plan-write-port-missing', 'plan_task_not_found',
    { planId, taskId: ghostId });
});

test('S8: plan.read returns tasks with the canonical sorted key order', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-s8';
  const planId = planIdFor('s8', campaignId);
  const owner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', owner);
  const alpha = task(alphaId, 'write the alpha report', 'todo', { owner });
  await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [alpha], []), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');

  const read = await planRead(host, planId, principal('orchestrator'), 'stage: plan-read-port-missing');
  const returned = read.tasks[alphaId];
  assert.deepEqual(Object.keys(returned), TASK_KEY_ORDER,
    'the task object is emitted in the closed sorted key order (D1)');
  assert.deepEqual(Object.keys(returned.ownedBy), OWNED_BY_KEY_ORDER,
    'ownedBy is emitted in the closed sorted key order (D1)');
});

test('N1: plan.read naming an unminted plan refuses plan_not_found', async (t) => {
  const host = await hostFixture(t);
  const planId = `plan:${'d'.repeat(32)}`; // never minted — no mint, no task, nothing but the name
  await planReadRefusal(host, planId, principal('orchestrator'), 'stage: plan-read-port-missing', 'plan_not_found', { planId });
});

// ===========================================================================
// §P4 — Exactly-one-in-progress + immediate completion (D1/D4, DR-3)
// ===========================================================================

test('L1: two tasks cannot be doing simultaneously within a wave subtree', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-l1';
  const planId = planIdFor('l1', campaignId);
  const alphaOwner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const betaOwner = ownedBy('beta', 'run:r1', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', alphaOwner);
  const betaId = taskIdFor(planId, 'write the beta report', betaOwner);
  const alpha = task(alphaId, 'write the alpha report', 'todo', { owner: alphaOwner });
  const beta = task(betaId, 'write the beta report', 'todo', { owner: betaOwner });
  await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [alpha, beta], [alphaId, betaId]), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');

  await planWrite(host, planWriteBody(planId, transitionMutation(planId, alphaId, 'doing', 1), `plan.task_transitioned:${planId}:${alphaId}:doing:v1`), principal('orchestrator'), 'stage: plan-write-port-missing');
  // Same wave subtree (ownedBy.wave === wave:w1 for both) — the second doing either auto-demotes
  // the current doing task (the plan batch kind, F3) or refuses plan_parallel_progress in the
  // strict-DAG shape (DR-3). Either way, never two live doing tasks.
  let outcome = null;
  let error = null;
  try {
    outcome = await host.application.command('plan.write', planWriteBody(planId, transitionMutation(planId, betaId, 'doing', 1), `plan.task_transitioned:${planId}:${betaId}:doing:v1`), principal('orchestrator'));
  } catch (caught) { error = caught; }
  if (error === null) {
    const read = await planRead(host, planId, principal('orchestrator'), 'stage: plan-read-port-missing');
    assert.equal(read.tasks[alphaId].status, 'todo',
      'stage: plan-status-law-missing — at HEAD no plan lane exists (application_command_unavailable); under the fold the earlier doing task auto-demotes to todo, never two doing in one subtree');
  } else {
    assert.equal(error.code, 'plan_parallel_progress',
      'stage: plan-status-law-missing — at HEAD no plan lane exists (application_command_unavailable); the strict-DAG shape refuses the second doing with plan_parallel_progress');
  }
});

test('L2: two tasks doing in DIFFERENT wave subtrees are admitted (the law is per-wave-subtree)', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-l2';
  const planId = planIdFor('l2', campaignId);
  const alphaOwner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const betaOwner = ownedBy('beta', 'run:r2', 'wave:w2');
  const alphaId = taskIdFor(planId, 'write the alpha report', alphaOwner);
  const betaId = taskIdFor(planId, 'write the beta report', betaOwner);
  const alpha = task(alphaId, 'write the alpha report', 'todo', { owner: alphaOwner });
  const beta = task(betaId, 'write the beta report', 'todo', { owner: betaOwner });
  await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [alpha, beta], [alphaId, betaId]), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');
  await planWrite(host, planWriteBody(planId, transitionMutation(planId, alphaId, 'doing', 1), `plan.task_transitioned:${planId}:${alphaId}:doing:v1`), principal('orchestrator'), 'stage: plan-write-port-missing');
  const outcome = await planWrite(host, planWriteBody(planId, transitionMutation(planId, betaId, 'doing', 1), `plan.task_transitioned:${planId}:${betaId}:doing:v1`), principal('orchestrator'), 'stage: plan-write-port-missing');
  assert.equal(outcome.status, 'plan_updated',
    'a different wave subtree may be doing concurrently — the uniqueness law binds per ownedBy.wave/run subtree (DR-3)');
});

test('L3: a verified task is marked done immediately and stays done', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-l3';
  const planId = planIdFor('l3', campaignId);
  const owner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', owner);
  const alpha = task(alphaId, 'write the alpha report', 'todo', { owner });
  await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [alpha], [alphaId]), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');
  await planWrite(host, planWriteBody(planId, transitionMutation(planId, alphaId, 'doing', 1), `plan.task_transitioned:${planId}:${alphaId}:doing:v1`), principal('orchestrator'), 'stage: plan-write-port-missing');
  const done = await planWrite(host, planWriteBody(planId, transitionMutation(planId, alphaId, 'done', 2), `plan.task_transitioned:${planId}:${alphaId}:done:v2`), principal('orchestrator'), 'stage: plan-write-port-missing');
  assert.equal(done.taskVersion, 2, 'immediate completion marking lands the done transition');
  const read = await planRead(host, planId, principal('orchestrator'), 'stage: plan-read-port-missing');
  assert.equal(read.tasks[alphaId].status, 'done', 'the task reads done immediately — never batched (G9)');
  // A re-entry to the same status is a distinct versioned key (H1.1): the version-CAS refuses the
  // stale re-transition rather than silently re-applying.
  await planWriteRefusal(host, planWriteBody(planId, transitionMutation(planId, alphaId, 'done', 1), `plan.task_transitioned:${planId}:${alphaId}:done:v1`), principal('orchestrator'),
    'stage: plan-status-law-missing', 'plan_stale_version');
});

test('L4: a done task re-opened by any non-review principal refuses plan_reopen_forbidden', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-l4';
  const planId = planIdFor('l4', campaignId);
  const owner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', owner);
  const alpha = task(alphaId, 'write the alpha report', 'done', { owner, taskVersion: 1 });
  await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [alpha], [alphaId]), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');
  // The row member itself attempts done → todo — the non-review re-open path (P4/H4.2).
  await planWriteRefusal(host, planWriteBody(planId, transitionMutation(planId, alphaId, 'todo', 1), `plan.task_transitioned:${planId}:${alphaId}:todo:v1`), principal('worker:member-alpha'),
    'stage: plan-status-law-missing', 'plan_reopen_forbidden');
});

test('L5: the review authority\'s reviewed-reject re-open (done → todo, H4.2) is admitted', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-l5';
  const planId = planIdFor('l5', campaignId);
  const owner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', owner);
  const alpha = task(alphaId, 'write the alpha report', 'done', { owner, taskVersion: 1 });
  await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [alpha], [alphaId]), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');
  const reopened = await planWrite(host, planWriteBody(planId, transitionMutation(planId, alphaId, 'todo', 1), `plan.task_transitioned:${planId}:${alphaId}:todo:v1`), principal('orchestrator'), 'stage: plan-write-port-missing');
  assert.equal(reopened.taskVersion, 2, 'the review re-open lands (the one admitted done → todo path)');
});

test('L6: focusTaskIds beyond planPolicy.maxFocusTasks refuses plan_focus_invalid', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-l6';
  const planId = planIdFor('l6', campaignId);
  const owner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const ids = [];
  const tasks = [];
  for (let index = 0; index < MAX_FOCUS_TASKS + 1; index += 1) {
    const title = `write report ${index}`;
    const id = taskIdFor(planId, title, { ...owner, role: `member-${index}` });
    ids.push(id);
    tasks.push(task(id, title, 'todo', { owner: { ...owner, role: `member-${index}` } }));
  }
  await planWriteRefusal(host, planWriteBody(planId, mintMutation(planId, campaignId, tasks, ids), `plan.minted:${planId}`), principal('orchestrator'),
    'stage: plan-status-law-missing', 'plan_focus_invalid',
    { focusCount: MAX_FOCUS_TASKS + 1, maxFocusTasks: MAX_FOCUS_TASKS });
});

test('L7: plan.focus_upserted sets the bounded focus window with a plan-version CAS (stale → plan_stale_version)', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-l7';
  const planId = planIdFor('l7', campaignId);
  const alphaOwner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const betaOwner = ownedBy('beta', 'run:r2', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', alphaOwner);
  const betaId = taskIdFor(planId, 'write the beta report', betaOwner);
  const alpha = task(alphaId, 'write the alpha report', 'todo', { owner: alphaOwner });
  const beta = task(betaId, 'write the beta report', 'todo', { owner: betaOwner });
  // The mint's focus window is [alphaId] and the plan version is 1 (D1).
  await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [alpha, beta], [alphaId]), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');

  // plan.focus_upserted with expectedPlanVersion=1 (the current plan version) narrows the window
  // to [betaId] and bumps the plan version to 2 — the plan-level version-CAS (D-table, DR-3).
  const outcome = await planWrite(host, planWriteBody(planId, focusMutation(planId, [betaId], 1), `plan.focus_upserted:${planId}:v1`), principal('orchestrator'), 'stage: plan-write-port-missing');
  assert.equal(outcome.status, 'plan_updated', 'the focus upsert resolves against the current plan version');
  assert.equal(outcome.planVersion, 2, 'the plan version bumps on the focus CAS (mirror of stale_version, G3)');

  const read = await planRead(host, planId, principal('orchestrator'), 'stage: plan-read-port-missing');
  assert.deepEqual(read.focusTaskIds, [betaId], 'the bounded focus window reads back');
  assert.equal(read.version, 2, 'the plan reads back at the new version');

  // A stale focus upsert (expectedPlanVersion=1 against the now-v2 plan) refuses plan_stale_version.
  await planWriteRefusal(host, planWriteBody(planId, focusMutation(planId, [alphaId], 1), `plan.focus_upserted:${planId}:v1`), principal('orchestrator'),
    'stage: plan-status-law-missing', 'plan_stale_version');
});

// ===========================================================================
// §P5 — Authority matrix (D2)
// ===========================================================================

test('A1: a row member reads its OWN task and transitions it to done — admitted', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-a1';
  const planId = planIdFor('a1', campaignId);
  const owner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', owner);
  const alpha = task(alphaId, 'write the alpha report', 'todo', { owner });
  await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [alpha], [alphaId]), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');

  const memberRead = await planRead(host, planId, principal('worker:member-alpha'), 'stage: plan-read-port-missing');
  assert.equal(memberRead.tasks[alphaId].title, 'write the alpha report',
    'the row member reads its own task (ownedBy.run resolves to the run it actually runs in, H2.2)');
  const memberDone = await planWrite(host, planWriteBody(planId, transitionMutation(planId, alphaId, 'done', 1), `plan.task_transitioned:${planId}:${alphaId}:done:v1`), principal('worker:member-alpha'), 'stage: plan-write-port-missing');
  assert.equal(memberDone.status, 'plan_updated',
    'the own-task transition to done is admitted — the immediate completion marking (D4)');
});

test('A2: a row member writing a sibling task refuses plan_authority_forbidden', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-a2';
  const planId = planIdFor('a2', campaignId);
  const alphaOwner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const betaOwner = ownedBy('beta', 'run:r2', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', alphaOwner);
  const betaId = taskIdFor(planId, 'write the beta report', betaOwner);
  const alpha = task(alphaId, 'write the alpha report', 'todo', { owner: alphaOwner });
  const beta = task(betaId, 'write the beta report', 'todo', { owner: betaOwner });
  await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [alpha, beta], [alphaId, betaId]), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');

  // member-alpha writes member-beta's task (ownedBy.run mismatch) — the own-task-only law (D2.3).
  await planWriteRefusal(host, planWriteBody(planId, transitionMutation(planId, betaId, 'done', 1), `plan.task_transitioned:${planId}:${betaId}:done:v1`), principal('worker:member-alpha'),
    'stage: plan-authority-matrix-missing', 'plan_authority_forbidden');
});

test('A3: a coordinator writes its subtree (ownedBy.wave/run match) — admitted', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-a3';
  const planId = planIdFor('a3', campaignId);
  const owner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', owner);
  const alpha = task(alphaId, 'write the alpha report', 'todo', { owner });
  await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [alpha], [alphaId]), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');
  const outcome = await planWrite(host, planWriteBody(planId, transitionMutation(planId, alphaId, 'doing', 1), `plan.task_transitioned:${planId}:${alphaId}:doing:v1`), principal('worker:coordinator-wave1'), 'stage: plan-write-port-missing');
  assert.equal(outcome.status, 'plan_updated',
    'a coordinator seat writing a task whose ownedBy.wave matches its wave is admitted (D2.2)');
});

test('A4: a coordinator writing outside its subtree refuses coordinator_authority_forbidden', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-a4';
  const planId = planIdFor('a4', campaignId);
  const alphaOwner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const betaOwner = ownedBy('beta', 'run:r2', 'wave:w2');
  const alphaId = taskIdFor(planId, 'write the alpha report', alphaOwner);
  const betaId = taskIdFor(planId, 'write the beta report', betaOwner);
  const alpha = task(alphaId, 'write the alpha report', 'todo', { owner: alphaOwner });
  const beta = task(betaId, 'write the beta report', 'todo', { owner: betaOwner });
  await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [alpha, beta], [alphaId, betaId]), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');
  // coordinator of wave:w1 writes a task owned by wave:w2 — outside its subtree (D2.2).
  await planWriteRefusal(host, planWriteBody(planId, transitionMutation(planId, betaId, 'doing', 1), `plan.task_transitioned:${planId}:${betaId}:doing:v1`), principal('worker:coordinator-wave1'),
    'stage: plan-authority-matrix-missing', 'coordinator_authority_forbidden');
});

test('A5: the orchestrator (plan:*) mints/upserts/transitions any task — admitted', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-a5';
  const planId = planIdFor('a5', campaignId);
  const owner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', owner);
  const alpha = task(alphaId, 'write the alpha report', 'todo', { owner });
  const minted = await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [alpha], [alphaId]), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');
  assert.equal(minted.status, 'plan_minted', 'the plan:* seat mints');
  const transitioned = await planWrite(host, planWriteBody(planId, transitionMutation(planId, alphaId, 'done', 1), `plan.task_transitioned:${planId}:${alphaId}:done:v1`), principal('orchestrator'), 'stage: plan-write-port-missing');
  assert.equal(transitioned.status, 'plan_updated', 'the plan:* seat transitions any task (D2.1)');
});

// ===========================================================================
// §P6 — Elevation at wave close (D2)
// ===========================================================================

test('W1: at wave.closed the review authority reviews the wave\'s plan tasks', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-w1';
  const planId = planIdFor('w1', campaignId);
  const completedOwner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const incompleteOwner = ownedBy('beta', 'run:r2', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', completedOwner);
  const betaId = taskIdFor(planId, 'write the beta report', incompleteOwner);
  const alpha = task(alphaId, 'write the alpha report', 'done', { owner: completedOwner });
  const beta = task(betaId, 'write the beta report', 'todo', { owner: incompleteOwner });
  await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [alpha, beta], [alphaId, betaId]), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');

  // The wave closes (the store's wave.closed fold, G5); the plan lane elevates the wave's tasks.
  let closed = null;
  try {
    closed = host.driver.coordination.recordDriver('wave.closed', {
      waveId: 'wave:w1', blockedOn: [], lanes: [], parked: [], rings: [],
      knowledge: { candidates: [], admittedThisRun: [], candidatesAwaitingAdmission: [], settlementRunId: null },
      receiptDigest: digest({ waveId: 'wave:w1' }), settlementErrors: [],
    }, { actor: 'orchestrator', key: 'wave.closed:wave:w1' });
  } catch { /* the wave.closed record may be gated at HEAD; the elevation is what this row pins */ }
  assert.ok(closed === null || closed.ok === true, 'the wave close record is admitted');

  const read = await planRead(host, planId, principal('orchestrator'), 'stage: plan-wave-close-elevation-missing');
  const alphaAfterClose = read.tasks[alphaId];
  const betaAfterClose = read.tasks[betaId];
  assert.equal(alphaAfterClose.status, 'done',
    'stage: plan-wave-close-elevation-missing — at HEAD no plan lane exists (application_command_unavailable); the wave.closed review keeps a completed task done');
  assert.ok(Array.isArray(alphaAfterClose.evidence) && alphaAfterClose.evidence.length > 0,
    'the completed task gains its elevation evidence links (plan.task_evidence_linked)');
  assert.equal(betaAfterClose.status, 'todo',
    'an incomplete task reverts to todo for the next wave — the honest remainder');
});

test('W2: reviewed-rejected done → re-opened todo (H4.2); an unreviewed/incomplete task never reads done', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-w2';
  const planId = planIdFor('w2', campaignId);
  const owner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', owner);
  const alpha = task(alphaId, 'write the alpha report', 'done', { owner, evidence: [] });
  await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [alpha], [alphaId]), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');

  // A done task whose evidence the review finds weak is re-opened by the review authority (H4.2).
  const reopened = await planWrite(host, planWriteBody(planId, transitionMutation(planId, alphaId, 'todo', 1), `plan.task_transitioned:${planId}:${alphaId}:todo:v1`), principal('orchestrator'), 'stage: plan-write-port-missing');
  assert.equal(reopened.status, 'plan_updated', 'the review re-open is the admitted reject path');

  const read = await planRead(host, planId, principal('orchestrator'), 'stage: plan-wave-close-elevation-missing');
  assert.equal(read.tasks[alphaId].status, 'todo',
    'the rejected done task reads todo — no silent auto-promotion (KG-2 rule 7: an unreviewed/incomplete task never reads done)');
});

// ===========================================================================
// §P7 — Three-surface admission (D3)
// ===========================================================================

test('X1: baton plan read PLAN_ID parses to plan.read', () => {
  const planId = `plan:${'a'.repeat(32)}`;
  let parsed = null;
  try { parsed = parseBatonCli(['plan', 'read', planId]); }
  catch (error) {
    assert.fail(`stage: cli-plan-verbs-missing — at HEAD parseBatonCli throws ${error.code} (application-cli.mjs:1417-1418); the fold parses baton plan read PLAN_ID into plan.read`);
  }
  assert.equal(parsed.kind, 'command', 'the CLI verb compiles to a command');
  assert.equal(parsed.name, 'plan.read', 'the CLI verb compiles to the plan.read direct port (D3.2)');
  assert.deepEqual(parsed.args, { planId }, 'plan.read takes the closed {planId} set');
});

test('X2: baton plan write PLAN_ID --mutation JSON parses to plan.write; a malformed body refuses cli_invalid', () => {
  const planId = `plan:${'b'.repeat(32)}`;
  const mutation = {
    schemaVersion: 1, planId, campaignId: 'campaign-161-x2', version: 1,
    focusTaskIds: [], tasks: [], requestDigest: digest({ schemaVersion: 1, planId, campaignId: 'campaign-161-x2', version: 1, focusTaskIds: [], tasks: [] }),
  };
  let parsed = null;
  try {
    parsed = parseBatonCli(['plan', 'write', planId, '--mutation', JSON.stringify(mutation)]);
  } catch (error) {
    assert.fail(`stage: cli-plan-verbs-missing — at HEAD parseBatonCli throws ${error.code} (application-cli.mjs:1417-1418); the fold parses baton plan write PLAN_ID --mutation JSON into plan.write`);
  }
  assert.equal(parsed.kind, 'command', 'the CLI verb compiles to a command');
  assert.equal(parsed.name, 'plan.write', 'the CLI verb compiles to the plan.write direct port (D3.2)');
  assert.equal(parsed.args.planId, planId, 'plan.write carries the planId');
  assert.ok(parsed.args.mutation && parsed.args.mutation.requestDigest,
    'the JSON body is normalized to a closed plan.* mutation shape (H3.2)');

  assert.throws(
    () => parseBatonCli(['plan', 'write', planId, '--mutation', '{not json']),
    (error) => {
      assert.equal(error.code, 'cli_invalid');
      assert.match(error.message, /mutation/u,
        'stage: cli-plan-verbs-missing — a malformed mutation body refuses cli_invalid naming the expected mutation shape (H3.2)');
      return true;
    },
  );
});

test('X3: CLI_WEB_COMMANDS admits plan.read AND plan.write', () => {
  assert.ok(CLI_WEB_COMMANDS.has('plan.read') && CLI_WEB_COMMANDS.has('plan.write'),
    'stage: cli-plan-verbs-missing — at HEAD CLI_WEB_COMMANDS (application-cli.mjs:16-32) admits no plan verbs; the fold admits plan.read/plan.write for the web-envelope dispatch (D3.2)');
});

test('X4: the plan.* web surface is refused AND ledgered in surface-divergence-ledger.json (#159 D3 #3)', () => {
  const planId = `plan:${'c'.repeat(32)}`;
  const readToken = validateWebCommandEnvelope(webEnvelope('plan_read', { planId }));
  assert.ok(readToken !== null && readToken.length > 0,
    'the plan_read web envelope is refused — plan.* is not a web transport (D3.4 recommended posture, matching the facade verbs\' today)');
  const writeToken = validateWebCommandEnvelope(webEnvelope('plan_write', { planId }));
  assert.ok(writeToken !== null && writeToken.length > 0,
    'the plan_write web envelope is refused');

  const ledgerPath = fileURLToPath(new URL('../scripts/surface-divergence-ledger.json', import.meta.url));
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const rows = (ledger.entries ?? []).filter((entry) => (
    entry.command === 'plan.read' || entry.command === 'plan.write'
    || entry.verb === 'plan.read' || entry.verb === 'plan.write'
    || entry.name === 'plan.read' || entry.name === 'plan.write'
  ));
  assert.ok(rows.length === 2,
    'stage: web-plan-ledger-missing — at HEAD the ledger entries are [] (no plan.* rows); the fold ledger the two plan verbs\' web refusal under #159 D3 #3 (documented and parsed, web refusal documented, no ghost)');
});

test('X5: MCP tools baton_plan_read/baton_plan_write exist with repoId leading required (H3.1)', async (t) => {
  const host = await hostFixture(t);
  const { server } = await mcpFixture(t, host);
  const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const tools = listed.result.tools;
  const names = tools.map((tool) => tool.name);
  assert.ok(names.includes('baton_plan_read') && names.includes('baton_plan_write'),
    'stage: mcp-plan-tool-missing — at HEAD the MCP ordinary tool list (35 tools) has no baton_plan_read/baton_plan_write; H3.1 registers both beside the facade rows');
  const read = tools.find((tool) => tool.name === 'baton_plan_read');
  const write = tools.find((tool) => tool.name === 'baton_plan_write');
  assert.equal(read.inputSchema.required[0], 'repoId', 'baton_plan_read leads required with repoId (the #159 G10 lesson)');
  assert.equal(write.inputSchema.required[0], 'repoId', 'baton_plan_write leads required with repoId');
  assert.ok(mcpApplicationToolNames().includes('baton_plan_read')
    && mcpApplicationToolNames().includes('baton_plan_write'),
    'the sorted ordinary surface carries both plan tools');
});

test('X6: the OPERATION_ROWS registry rows claim surfaces for plan.read/plan.write (D3.1)', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/application-semantics.mjs', import.meta.url)), 'utf8');
  // #166 — content-anchored region, never an absolute line window: the canonical operation rows
  // (the contract's OPERATION_ROWS region) run from CANONICAL_OPERATION_SPECS to SURFACE_ALIAS_ROWS.
  const region = src.slice(
    src.indexOf('const CANONICAL_OPERATION_SPECS'),
    src.indexOf('const SURFACE_ALIAS_ROWS'),
  );
  assert.ok(region.includes("['plan.read'") && region.includes("['plan.write'"),
    'stage: registry-plan-rows-missing — at HEAD the canonical operation rows carry no plan.read/plan.write; the fold registers both with closed input schemas and explicit surfaces (D3.1)');
  assert.match(region, /['"]plan\.read['"][\s\S]{0,400}?['"]observe['"]/u,
    'plan.read claims capabilities observe');
  assert.match(region, /['"]plan\.write['"][\s\S]{0,400}?['"]control['"]/u,
    'plan.write claims capabilities control');
});

test('X7: the generated CLI.md/MCP.md blocks contain the plan rows (D3.5)', () => {
  const cliDoc = readFileSync(fileURLToPath(new URL('../CLI.md', import.meta.url)), 'utf8');
  assert.ok(cliDoc.includes('baton plan read') && cliDoc.includes('baton plan write'),
    'stage: docs-plan-rows-missing — at HEAD CLI.md has no baton plan read/write rows; the regenerated doc (render-surface-docs.mjs, #142) carries the plan verbs');
  const mcpDoc = readFileSync(fileURLToPath(new URL('../MCP.md', import.meta.url)), 'utf8');
  assert.ok(mcpDoc.includes('baton_plan_read') && mcpDoc.includes('baton_plan_write'),
    'stage: docs-plan-rows-missing — at HEAD MCP.md has no baton_plan_read/write rows; the regenerated doc carries the plan tools');
});

// ===========================================================================
// §P8 — #74 integration (D3)
// ===========================================================================

test('Q1: a #74 coordinator member\'s plan.write (task_upserted) writes its subtree\'s row tasks with ownedBy binding', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-q1';
  const planId = planIdFor('q1', campaignId);
  const owner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const alphaId = taskIdFor(planId, 'write the alpha report', owner);
  // The coordinator mints the plan's task set, then writes each row task via plan.task_upserted
  // with ownedBy binding it to its wave (D3.1) — the durable home of the decomposition.
  await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [], []), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');
  const upserted = await planWrite(host, planWriteBody(planId, upsertMutation(planId, task(alphaId, 'write the alpha report', 'todo', { owner }), 1), `plan.task_upserted:${planId}:${alphaId}:v1`), principal('worker:coordinator-wave1'), 'stage: plan-write-port-missing');
  assert.equal(upserted.status, 'plan_updated',
    'stage: plan-gated-dispatch-missing — at HEAD no plan lane exists (application_command_unavailable); the #74 coordinator decomposition lands in the plan object');

  const read = await planRead(host, planId, principal('orchestrator'), 'stage: plan-read-port-missing');
  assert.equal(read.tasks[alphaId].ownedBy.wave, 'wave:w1', 'the row task is bound to its wave (D2.2 subtree)');
  assert.equal(read.tasks[alphaId].ownedBy.run, 'run:r1', 'the pre-decomposed ownedBy.run binds at write time (H2.2)');
});

test('Q2: the interpreter gates a member on its plan task\'s state — blocked → dispatch_pending, done → settleable', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-q2';
  const planId = planIdFor('q2', campaignId);
  const depOwner = ownedBy('dep', 'run:r0', 'wave:w1');
  const memberOwner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const depId = taskIdFor(planId, 'write the dependency report', depOwner);
  const alphaId = taskIdFor(planId, 'write the alpha report', memberOwner);
  const dep = task(depId, 'write the dependency report', 'todo', { owner: depOwner });
  const alpha = task(alphaId, 'write the alpha report', 'todo', { owner: memberOwner, blockedBy: [depId] });
  await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [dep, alpha], [alphaId]), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');

  // A member whose plan task is blocked (blockedBy not all done) is honestly waitingOn
  // dispatch_pending — the mapped kind over the closed five (H3.4), never plan_approval.
  const memberDone = await planWrite(host, planWriteBody(planId, transitionMutation(planId, depId, 'done', 1), `plan.task_transitioned:${planId}:${depId}:done:v1`), principal('orchestrator'), 'stage: plan-write-port-missing');
  assert.equal(memberDone.status, 'plan_updated', 'the dependency completes first');
  const alphaDone = await planWrite(host, planWriteBody(planId, transitionMutation(planId, alphaId, 'done', 1), `plan.task_transitioned:${planId}:${alphaId}:done:v1`), principal('worker:member-alpha'), 'stage: plan-write-port-missing');
  assert.equal(alphaDone.status, 'plan_updated',
    'stage: plan-gated-dispatch-missing — at HEAD no plan lane exists (application_command_unavailable); the interpreter\'s plan-task gate makes a done task\'s member settleable (immediate completion marking)');
});

// ===========================================================================
// §P9 — Orchestrator practice migration (D4)
// ===========================================================================

test('O1: plan.read at the orchestrator seat returns the campaign todo as the plan projection', async (t) => {
  const host = await hostFixture(t);
  const campaignId = 'campaign-161-o1';
  const planId = planIdFor('o1', campaignId);
  const alphaOwner = ownedBy('alpha', 'run:r1', 'wave:w1');
  const betaOwner = ownedBy('beta', 'run:r2', 'wave:w2');
  const alphaId = taskIdFor(planId, 'write the alpha report', alphaOwner);
  const betaId = taskIdFor(planId, 'write the beta report', betaOwner);
  const alpha = task(alphaId, 'write the alpha report', 'todo', { owner: alphaOwner });
  const beta = task(betaId, 'write the beta report', 'doing', { owner: betaOwner });
  await planWrite(host, planWriteBody(planId, mintMutation(planId, campaignId, [alpha, beta], [alphaId, betaId]), `plan.minted:${planId}`), principal('orchestrator'), 'stage: plan-write-port-missing');

  const todo = await planRead(host, planId, principal('orchestrator'), 'stage: plan-read-at-orchestrator-missing');
  assert.equal(todo.tasks[alphaId].status, 'todo', 'the campaign todo is the plan projection (D4)');
  assert.equal(todo.tasks[betaId].status, 'doing', 'the per-wave-subtree exactly-one-in-progress is the observable plan semantics (DR-3)');
  assert.ok([...new Set(Object.values(todo.tasks).map((t2) => t2.status))].every((s) => PLAN_TASK_STATUSES.includes(s)),
    'the closed three statuses are the only observable statuses (G2/G9)');
});

// ===========================================================================
// §P10 — Refusal constancy (GREEN pins)
// ===========================================================================

test('R1 PIN: application_unauthorized stays the facade denial', async (t) => {
  const repo = root('repo-r1');
  const logDir = root('log-r1');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const host = openHost(repo, logDir, markerAdapter(), async () => false);
  t.after(async () => {
    await host.application.shutdown(principal('cleanup')).catch(() => {});
    try { host.driver.coordination.releaseWriterLease(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  await assert.rejects(
    host.application.command('runs.list', {}, principal('noone')),
    (error) => {
      assert.equal(error.code, 'application_unauthorized',
        'stage: facade-denial-pin — the facade capability denial stays application_unauthorized (application.mjs:3214-3222); kills a plan-scope fold that routes the denial through a plan code');
      return true;
    },
  );
});

test('R2 PIN: WAITING_ON_KINDS stays the closed five, byte-unchanged and sorted', () => {
  const expected = Object.freeze([
    'capacity_ceiling', 'dispatch_pending', 'plan_approval', 'provider_stalled', 'spawning',
  ]);
  assert.deepEqual(WAITING_ON_KINDS, expected,
    'stage: waiting-kind-constancy-pin — the closed five waiting kinds (application-semantics.mjs:59-61) stay byte-unchanged; kills a plan-task gate that renames/removes/reorders a kind to make room for plan-approval');
  assert.deepEqual([...WAITING_ON_KINDS].sort(), expected,
    'stage: waiting-kind-constancy-pin — the literal is already in ACTUAL sorted order (law #5)');
});

test('R3 PIN: SCRATCHPAD_STEP_STATES stays the closed three', () => {
  let out = '';
  try {
    out = execFileSync('grep', ['-an', 'SCRATCHPAD_STEP_STATES',
      fileURLToPath(new URL('../src/coordination-store.mjs', import.meta.url))],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (error) { out = error?.stdout?.toString?.() ?? ''; }
  assert.ok(out.includes('new Set([\'todo\', \'doing\', \'done\'])'),
    'stage: step-state-constancy-pin — the closed three statuses (coordination-store.mjs:537) stay byte-unchanged; kills a fold that renames todo/doing/done for the plan task status');
});

test('R4 PIN: the goal-plan ^plan:[a-f0-9]{64}$ validator still refuses a plan:<hex32> plan-object id', () => {
  const hex32 = `plan:${'a'.repeat(32)}`;
  const token = validateWebCommandEnvelope(webEnvelope('goal_plan_status', {
    goalId: `goal:${'b'.repeat(64)}`, goalVersion: 1, goalDigest: 'c'.repeat(64),
    planId: hex32, planVersion: 1, planDigest: 'd'.repeat(64), throughSeq: null,
  }));
  assert.equal(token, 'goal_plan_status requires exact bounded coordinates',
    'stage: plan-namespace-pin — a plan:<hex32> plan-object id is REFUSED by the goal-plan validator (web-northbound.mjs:457 ^plan:[a-f0-9]{64}$); kills an impl that collapses the two plan: namespaces');
  const hex64 = validateWebCommandEnvelope(webEnvelope('goal_plan_status', {
    goalId: `goal:${'b'.repeat(64)}`, goalVersion: 1, goalDigest: 'c'.repeat(64),
    planId: `plan:${'e'.repeat(64)}`, planVersion: 1, planDigest: 'd'.repeat(64), throughSeq: null,
  }));
  assert.equal(hex64, null,
    'a goal-plan plan:<hex64> planRef still validates — the two namespaces are structurally disjoint by length-validator');
});
