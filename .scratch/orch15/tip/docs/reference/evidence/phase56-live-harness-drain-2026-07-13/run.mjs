#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ClaudeSessionCli, CodexAppServerCli, GlmSessionCli, GrokAcpCli,
  createBrief, createDriver, inspectToolchainProjection,
} from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_REPO = realpathSync(resolve(process.env.BATON_SOURCE_REPO ?? resolve(HERE, '../../../..')));
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? HERE);
const OWNER_ROOT = realpathSync(resolve(process.env.BATON_EVIDENCE_OWNER_ROOT ?? ''));
const GLM_AUTH = resolve(process.env.BATON_GLM_AUTH_FILE ?? join(SOURCE_REPO, 'glm_key.json'));
const CODEX_AUTH = join(homedir(), '.codex', 'auth.json');
const GROK_AUTH = join(homedir(), '.grok', 'auth.json');
const IMPLEMENTATION_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: SOURCE_REPO, encoding: 'utf8' }).trim();
const REVIEW_PHASE = process.env.BATON_REVIEW_PHASE ?? '56';
const REVIEW_ARTIFACTS = Object.freeze({
  56: ['public-drain-and-close', 'drain-and-close'],
  57: ['provider-governance', 'provider-governance'],
  58: ['capacity-aware-sparse-workers', 'sparse-worker-worktree'],
  59: ['worktree-capacity-authority', 'worktree-capacity-authority'],
  60: ['attach-only-native-recovery', 'coordination-recovery'],
  61: ['graph-backed-representations', 'representation-producer'],
  62: ['goal-plan-web-authority', 'goal-plan-authority'],
});
const reviewArtifact = REVIEW_ARTIFACTS[REVIEW_PHASE];
if (!reviewArtifact && (!process.env.BATON_REVIEW_SPEC || !process.env.BATON_REVIEW_TEST)) throw new Error('PENDING-LIVE-review-artifact-mapping-required');
const REVIEW_SPEC = process.env.BATON_REVIEW_SPEC ?? `spec/phase${REVIEW_PHASE}/${reviewArtifact[0]}.md`;
const REVIEW_TEST = process.env.BATON_REVIEW_TEST ?? `impl/test/phase${REVIEW_PHASE}-${reviewArtifact[1]}.test.mjs`;
const REVIEW_TESTS = Object.freeze(REVIEW_TEST.trim().split(/\s+/u).filter(Boolean));
if (REVIEW_TESTS.length === 0) throw new Error('PENDING-LIVE-review-test-set-required');
const TARGET_REPO = join(OWNER_ROOT, `phase${REVIEW_PHASE}-clean-target`);
const LOG_DIR = mkdtempSync(join(tmpdir(), `baton-phase${REVIEW_PHASE}-live-log-`));
const RUN_ID = REVIEW_PHASE === '56' ? 'phase56-live-harness-drain' : REVIEW_PHASE === '60' ? 'phase60-native-recovery-review' : REVIEW_PHASE === '61' ? 'phase61-graph-representation-review' : REVIEW_PHASE === '62' ? 'phase62-goal-plan-authority-review' : `phase${REVIEW_PHASE}-live-harness-governance`;
const TASK_TYPE = REVIEW_PHASE === '56' ? 'phase56-drain-adversarial-review' : REVIEW_PHASE === '60' ? 'phase60-native-recovery-adversarial-review' : REVIEW_PHASE === '61' ? 'phase61-representation-adversarial-review' : REVIEW_PHASE === '62' ? 'phase62-goal-plan-adversarial-review' : `phase${REVIEW_PHASE}-governance-adversarial-review`;
const phase57Focus = [
  'callback provenance, exact route binding, and forged policy/orchestrator authority',
  'dimension-complete usage seals, metric binding, and post-acceptance revocation',
  'admission/release accounting, replay across policy changes, and observation-only truth',
  'logical provider/tool call identity and phase bounds plus exact process reaping',
  'reflexive Baton-on-Baton friction, concurrent Grok cleanup, and remaining completion scope',
];
const phase59Focus = [
  'pre-effect sparse tree, immutable toolchain, runtime byte/inode estimation and max-plus-one refusal',
  'repo-scoped HMAC ledger integrity, generation locks, concurrent reservations, and restart adoption',
  'project-key GLM route isolation, exact capacity release, provider refusal, and runtime rollback',
  'concurrent Grok capacity admission, every process generation correlation, and exact drain/reap',
  'reflexive Baton-on-Baton capacity friction, honest quota limits, and retained completion scope',
];
const phase60Focus = [
  'attach-only identity proof, no-prompt-before-commit ordering, and exact model and effort recovery',
  'durable continuation intent, accepted/refused/unknown dispositions, replay, and no automatic redelivery',
  'project-key GLM route isolation, private credential projection, recovery refusal, and exact cleanup',
  'concurrent Grok recovery authority, process-generation correlation, interrupt, kill, and exact reap',
  'reflexive Baton-on-Baton recovery friction plus retained Phase 61 representation and Phase 62 Goal/Plan scope',
];
const phase61Focus = [
  'fixed producer mapping, exact source-card and environment binding, stable identity, and authority denial',
  'immediate source reverify, primary artifact selection, honest resume, receipt integrity, and preflight ordering',
  'project-key GLM isolation, graph transaction replay, causal endpoints, and request-bound idempotency',
  'concurrent Grok review authority, route/model/effort specificity, process correlation, kill, and exact reap',
  'reflexive Baton-on-Baton representation friction plus retained R4-R7 and Phase 62 Goal/Plan scope',
];
const phase62Focus = [
  'append-only goal and plan canonicalization, bounded DAG and budget authority, and immutable plan-owned verification',
  'distinct proposer and approver authority, stale or rejected decisions, policy drift, and exact approval replay',
  'project-key GLM isolation, authoritative Brief derivation, pre-effect node dispatch CAS, and restart reconciliation',
  'concurrent Grok route/model/effort constraints, atomic dispatch/task batches, process correlation, kill, and exact reap',
  'authenticated web and MCP parity, status/event truth, reflexive Baton-on-Baton friction, and retained later authority',
];
const phase56Focus = [
  'drain fencing, exact async ownership, deadline truth, and driver close ordering',
  'durable replay, actor binding, receipt validation, and crash recovery',
  'closed capacity, startup readiness, historical cleanup, and path privacy',
  'kill/process-close correlation, process-group convergence, and late process events',
  'reflexive Baton-on-Baton friction, evidence ownership, drain retries, and recursive cleanup',
];
const routes = [
  { suffix: 'codex-review', harness: 'codex', model: 'gpt-5.6-sol', family: 'openai' },
  { suffix: 'claude-review', harness: 'claude', model: 'claude-opus-4-6', family: 'claude' },
  { suffix: 'glm-review', harness: 'glm', model: 'glm-4.7', family: 'glm' },
  { suffix: 'grok45-review', harness: 'grok', model: 'grok-4.5', family: 'grok' },
  { suffix: 'grokbuild-review', harness: 'grok', model: 'grok-build', family: 'grok' },
];
const TASK_CATALOG = routes.map((route, index) => ({
  ...route,
  taskId: `phase${REVIEW_PHASE}-${route.suffix}`,
  target: `reviews/dogfood/phase${REVIEW_PHASE}-${route.suffix}.md`,
  focus: ({ 56: phase56Focus, 57: phase57Focus, 59: phase59Focus, 60: phase60Focus, 61: phase61Focus, 62: phase62Focus }[REVIEW_PHASE] ?? phase56Focus)[index],
}));
const selectedTaskIds = process.env.BATON_TASK_IDS ? new Set(process.env.BATON_TASK_IDS.split(',').filter(Boolean)) : null;
const TASKS = selectedTaskIds ? TASK_CATALOG.filter((task) => selectedTaskIds.has(task.taskId)) : TASK_CATALOG;
const REQUIRE_GROK_PAIR = TASKS.filter((task) => task.harness === 'grok').length === 2;
const GOVERNANCE_MODE = process.env.BATON_PROVIDER_GOVERNANCE_MODE ?? null;
const MAX_WIRE_FRAME_BYTES = Number(process.env.BATON_MAX_WIRE_FRAME_BYTES ?? 16 * 1024 * 1024);
if (!Number.isSafeInteger(MAX_WIRE_FRAME_BYTES) || MAX_WIRE_FRAME_BYTES <= 0 || MAX_WIRE_FRAME_BYTES > 16 * 1024 * 1024) {
  throw new Error('PENDING-LIVE-baton-max-wire-frame-bytes-invalid');
}
const routeTokenBudget = (task) => Number(process.env.BATON_TASK_TOKEN_BUDGET
  ?? (REVIEW_PHASE === '56' ? 60_000 : task.harness === 'codex' ? 450_000 : 300_000));
const terminalReserveTokens = (task) => Number(process.env.BATON_TERMINAL_RESERVE_TOKENS ?? routeTokenBudget(task));
const providerGovernance = GOVERNANCE_MODE ? {
  schemaVersion: 1,
  maxWireFrameBytes: MAX_WIRE_FRAME_BYTES,
  maxProviderCallsPerTurn: 100,
  maxToolCallsPerTurn: 100,
  routes: TASK_CATALOG.map((task) => ({
    harness: task.harness,
    model: task.model,
    effort: 'low',
    terminalReserve: {
      tokens: terminalReserveTokens(task),
      usd: ['claude', 'glm'].includes(task.harness) ? Number(process.env.BATON_TERMINAL_RESERVE_USD ?? 2.5) : 0,
    },
    mode: GOVERNANCE_MODE,
  })),
} : null;
const LIMITS = Object.freeze({ maxMappings: 1, maxFiles: 50_000, maxDirectories: 10_000, maxBytes: 512 * 1024 * 1024, maxFileBytes: 64 * 1024 * 1024, maxPathBytes: 2_048, maxDepth: 64 });
const boundedInteger = (name, fallback) => {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`PENDING-LIVE-${name.toLowerCase()}-invalid`);
  return value;
};
const capacityEnabled = process.env.BATON_WORKTREE_CAPACITY === '1';
const worktreeCapacity = capacityEnabled ? Object.freeze({
  maxReservedBytes: boundedInteger('BATON_CAPACITY_MAX_BYTES', 8 * 1024 * 1024 * 1024),
  maxReservedInodes: boundedInteger('BATON_CAPACITY_MAX_INODES', 1_000_000),
  minFreeBytes: boundedInteger('BATON_CAPACITY_MIN_FREE_BYTES', 2 * 1024 * 1024 * 1024),
  minFreeInodes: boundedInteger('BATON_CAPACITY_MIN_FREE_INODES', 100_000),
  runtimeReserveBytes: boundedInteger('BATON_CAPACITY_RUNTIME_BYTES', 64 * 1024 * 1024),
  runtimeReserveInodes: boundedInteger('BATON_CAPACITY_RUNTIME_INODES', 10_000),
}) : null;
const PHASE62_REPO_ID = 'baton-phase62-live';
const PHASE62_NODE_PROVIDER_TURNS = 100;
const phase62GoalPlanPolicy = REVIEW_PHASE === '62' ? Object.freeze({
  schemaVersion: 1,
  repoId: PHASE62_REPO_ID,
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1000,
  riskClasses: Object.freeze(['low', 'medium', 'high', 'critical']),
  effectClasses: Object.freeze(['provider_call', 'repository_edit']),
  capabilityClasses: Object.freeze(['code', 'test']),
  limits: Object.freeze({
    maxGoalVersions: 8, maxPlanVersions: 8, maxNodes: 8, maxDepsPerNode: 8,
    maxTextBytes: 8 * 1024, maxItems: 32, maxScopePaths: 8, maxRouteValues: 8,
    maxGoalBytes: 128 * 1024, maxPlanBytes: 512 * 1024, maxStatusBytes: 512 * 1024,
    maxTokens: 10_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
}) : null;
const PHASE62_AUTHORITY = Object.freeze({
  goal_define: Object.freeze({ power: 'goal:define', principalId: 'phase62-goal-owner' }),
  plan_propose: Object.freeze({ power: 'plan:propose', principalId: 'phase62-planner' }),
  plan_approve: Object.freeze({ power: 'plan:approve', principalId: 'phase62-approver' }),
  plan_dispatch: Object.freeze({ power: 'plan:dispatch', principalId: 'phase62-dispatcher' }),
  goal_plan_status: Object.freeze({ power: 'goal:observe', principalId: 'phase62-observer' }),
});
const phase62Authorize = async ({ operation, power, principalId, repoId, runId }) => {
  const expected = PHASE62_AUTHORITY[operation];
  return REVIEW_PHASE === '62' && expected?.power === power && expected.principalId === principalId
    && repoId === PHASE62_REPO_ID && runId === RUN_ID;
};
const phase62Context = (operation, idempotencyKey) => {
  const authority = PHASE62_AUTHORITY[operation];
  if (!authority) throw new Error(`PENDING-LIVE-phase62-authority-${operation}-invalid`);
  return {
    actor: `direct:${authority.principalId}`,
    principalId: authority.principalId,
    sessionId: `${authority.principalId}-session`,
    powers: [authority.power],
    repoId: PHASE62_REPO_ID,
    runId: RUN_ID,
    idempotencyKey,
  };
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => { try { if (!pid) return false; process.kill(pid, 0); return true; } catch { return false; } };
const groupAlive = (pgid) => { try { if (!pgid) return false; process.kill(-pgid, 0); return true; } catch { return false; } };
const names = (path) => existsSync(path) ? readdirSync(path).sort() : [];
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sourceGit = (args) => execFileSync('git', args, { cwd: SOURCE_REPO, encoding: 'utf8' }).trim();
let targetCreated = false;
let targetAttempted = false;
let targetRemoved = false;
let removalError = null;
let projectionIdentity = null;

function credentialFact(path) {
  try {
    const stat = statSync(path);
    return { present: stat.isFile(), ownerOnly: (stat.mode & 0o077) === 0, ownedByRunnerUser: typeof process.getuid !== 'function' || stat.uid === process.getuid() };
  } catch (error) { return { present: false, ownerOnly: false, ownedByRunnerUser: false, error: error.code ?? 'stat_failed' }; }
}

async function until(fn, label, timeoutMs = 900_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(100); }
  throw new Error(`timeout waiting for ${label}`);
}

function brief(task) {
  const phase62Constraints = [
    'Do not inspect credentials or environment, use network tools, commit, push, deploy, or access homelab/project-manager.',
    'Write a Markdown document at exactly the path named in the node objective; do not rename it, change its extension, or make it executable source code.',
    'Edit only the single repository path in this approved plan node scope and leave every other path unchanged.',
    'Ground confirmed defects in exact committed source and distinguish them from retained later scope.',
    'Keep the report under 700 words and use at most 8 repository/tool calls.',
  ].sort();
  const verificationScript = [
    "const { execFileSync } = require('node:child_process');",
    "const { readFileSync } = require('node:fs');",
    "const [target, ...testFiles] = process.argv.slice(1);",
    "const report = readFileSync(target, 'utf8');",
    "for (const heading of ['## Verdict', '## P0-P1 findings', '## Required corrections']) if (!report.includes(heading)) process.exit(1);",
    "execFileSync(process.execPath, ['impl/scripts/run-evidence.mjs', 'impl/scripts/run-suite.mjs', ...testFiles], { stdio: 'inherit' });",
  ].join(' ');
  return createBrief({
    goal: `Independently review committed Phase ${REVIEW_PHASE} at ${IMPLEMENTATION_SHA.slice(0, 7)}, focusing on ${task.focus}. Inspect ${REVIEW_SPEC} and its implementation/tests. Write ${task.target} with exactly the headings "## Verdict", "## P0-P1 findings", and "## Required corrections".`,
    constraints: REVIEW_PHASE === '62' ? phase62Constraints : [
      `Edit only ${task.target}.`,
      'Keep the report under 700 words and use at most 8 repository/tool calls.',
      'Ground confirmed defects in exact committed source and distinguish them from retained later scope.',
      'Do not inspect credentials or environment, use network tools, commit, push, deploy, or access homelab/project-manager.',
    ],
    pathScope: [task.target],
    definitionOfDone: 'All three headings exist and the verdict explicitly says PASS or REVISE.',
    verification: {
      command: 'node', arguments: ['-e', verificationScript, task.target, ...REVIEW_TESTS], cwd: '.',
      envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code', timeoutMs: 180_000,
      maxOutputBytes: 2 * 1024 * 1024, requiredPredecessorEvidence: [],
    },
    budget: { tokens: routeTokenBudget(task), usd: 3, wallMin: 14 },
    ...(REVIEW_PHASE === '62' ? {
      providerTurns: PHASE62_NODE_PROVIDER_TURNS,
      capabilities: ['code', 'test'],
      effects: ['provider_call', 'repository_edit'],
    } : {}),
  });
}

function bounded(events) {
  const keep = new Set(['worktree.ready', 'lifecycle.spawned', 'lifecycle.turn_started', 'lifecycle.turn_completed', 'lifecycle.crashed', 'error', 'resource.tokens', 'resource.provider_turn_admitted', 'resource.provider_turn_refused', 'resource.provider_turn_released', 'resource.provider_governance_exceeded', 'resource.provider_telemetry_invalid', 'model.mismatch', 'verify.reverified', 'kill.requested', 'kill.confirmed', 'lifecycle.process_started', 'lifecycle.process_closed', 'lifecycle.process_reap_unconfirmed']);
  return events.filter((event) => keep.has(event.kind)).map((event) => ({
    seq: event.seq, ts: event.ts, actor: event.actor, kind: event.kind,
    harnessRequested: event.harnessRequested ?? null, harnessResolved: event.harnessResolved ?? null,
    modelRequested: event.modelRequested ?? event.payload?.modelRequested ?? null, modelResolved: event.modelResolved ?? null,
    modelObserved: event.modelObserved ?? event.payload?.modelObserved ?? event.payload?.modelId ?? null,
    effortRequested: event.effortRequested ?? null, effortResolved: event.effortResolved ?? null, effortObserved: event.effortObserved ?? null,
    payload: event.kind === 'worktree.ready' ? { projectionDigest: event.payload?.toolchainProjection?.projectionDigest ?? null }
      : event.kind === 'verify.reverified' ? { accept: event.payload?.accept ?? false, observedExit: event.payload?.verdict?.observedExit ?? null, providerGovernanceAdmission: event.payload?.providerGovernanceAdmission ?? null, captureSha: event.payload?.capture?.sha ?? null, workerProjectionDigest: event.payload?.capture?.toolchainProjection?.projectionDigest ?? null, verifierProjectionDigest: event.payload?.capture?.verifierToolchainProjection?.projectionDigest ?? null }
        : event.kind.startsWith('resource.provider_') ? { phase: event.payload?.phase ?? null, code: event.payload?.code ?? null, policyDigest: event.payload?.policyDigest ?? null, routeDigest: event.payload?.routeDigest ?? null, mode: event.payload?.mode ?? null, admissionSeq: event.payload?.admissionSeq ?? null }
        : ['lifecycle.process_started', 'lifecycle.process_closed'].includes(event.kind) ? { pid: event.payload?.pid ?? null, processGroupId: event.payload?.processGroupId ?? null, generation: event.payload?.generation ?? null, closeReason: event.payload?.closeReason ?? null }
          : event.kind === 'error' ? { code: String(event.payload?.code ?? '').slice(0, 128), message: String(event.payload?.message ?? '').slice(0, 512) }
            : ['lifecycle.turn_completed', 'lifecycle.crashed', 'model.mismatch'].includes(event.kind) ? { status: event.payload?.status ?? event.payload?.result?.status ?? null, reason: String(event.payload?.error ?? event.payload?.reason ?? '').slice(0, 512), requested: event.payload?.requested ?? null, observed: event.payload?.observed ?? null }
            : {},
  }));
}

function targetOwnership(git) {
  const worktreeEntries = names(join(TARGET_REPO, '.baton', 'wt'));
  const localTaskIds = new Set(worktreeEntries.map((entry) => entry
    .replace(/\.meta\.json$/u, '').replace(/\.projection\.exclude$/u, '')));
  return {
    branches: [...localTaskIds].flatMap((taskId) => git(['branch', '--list', `baton/${taskId}`]).split('\n').map((line) => line.trim()).filter(Boolean)).sort(),
    worktreeEntries,
    runtimeEntries: names(join(TARGET_REPO, '.baton', 'runtime')),
    verifyEntries: names(join(TARGET_REPO, '.baton', 'verify')),
    integrateEntries: names(join(TARGET_REPO, '.baton', 'integrate')),
  };
}

if (!process.env.BATON_EVIDENCE_OWNER_ROOT) throw new Error('PENDING-LIVE-owned-evidence-root-required');
if (TASKS.length === 0 || (selectedTaskIds && TASKS.length !== selectedTaskIds.size)) throw new Error('PENDING-LIVE-selected-task-set-invalid');
if (!existsSync(join(SOURCE_REPO, 'impl', 'node_modules'))) throw new Error('PENDING-LIVE-no-source-toolchain');
if (!existsSync(GLM_AUTH)) throw new Error('PENDING-LIVE-no-project-glm-key');
if (!existsSync(CODEX_AUTH)) throw new Error('PENDING-LIVE-no-codex-auth');
if (REQUIRE_GROK_PAIR && !existsSync(GROK_AUTH)) throw new Error('PENDING-LIVE-no-grok-auth');
for (const [name, path] of [['glm', GLM_AUTH], ['codex', CODEX_AUTH], ...(REQUIRE_GROK_PAIR ? [['grok', GROK_AUTH]] : [])]) {
  const fact = credentialFact(path);
  if (!fact.present || !fact.ownerOnly || !fact.ownedByRunnerUser) throw new Error(`PENDING-LIVE-${name}-credential-posture-invalid`);
}
mkdirSync(OUTPUT, { recursive: true });
for (const file of ['events.jsonl', 'summary.json', ...TASKS.map((task) => `${task.taskId}.md`)]) rmSync(join(OUTPUT, file), { force: true });

const credentialMeasurements = { glm: credentialFact(GLM_AUTH), codex: credentialFact(CODEX_AUTH), grok: credentialFact(GROK_AUTH) };
const attempts = []; const rows = []; const responses = []; const simultaneousGrokSamples = [];
let ownershipBefore = null; let ownershipAfter = null; let closureReceipt = null; let fatal = null; let driver = null; let pumping = true;
let pump = Promise.resolve();
let phase62AuthoritySetup = null; let phase62Status = null; let phase62Proof = null;

try {
  const sparseWorkerPaths = Number(REVIEW_PHASE) >= 57 ? ['impl', `spec/phase${REVIEW_PHASE}`, 'reviews/dogfood'] : [];
  targetAttempted = true;
  sourceGit(['worktree', 'add', '--detach', ...(sparseWorkerPaths.length ? ['--no-checkout'] : []), TARGET_REPO, IMPLEMENTATION_SHA]); targetCreated = true;
  if (sparseWorkerPaths.length) {
    execFileSync('git', ['sparse-checkout', 'set', '--no-cone', '--stdin'], {
      cwd: TARGET_REPO, input: `${sparseWorkerPaths.map((path) => `/${path}`).join('\n')}\n`, encoding: 'utf8',
    });
    execFileSync('git', ['checkout', '--detach', IMPLEMENTATION_SHA], { cwd: TARGET_REPO, stdio: 'pipe' });
  }
  const targetGit = (args) => execFileSync('git', args, { cwd: TARGET_REPO, encoding: 'utf8' }).trim();
  if (targetGit(['status', '--porcelain']) !== '') throw new Error('PENDING-LIVE-target-must-be-clean');
  if (existsSync(join(TARGET_REPO, 'impl', 'node_modules'))) throw new Error('PENDING-LIVE-target-already-has-toolchain');
  ownershipBefore = targetOwnership(targetGit);

  const projectionDescriptor = Object.freeze({
    schemaVersion: 1, sourceRoot: SOURCE_REPO, sourceId: 'baton-local-node-toolchain',
    mappings: Object.freeze([{ sourcePath: 'impl/node_modules', targetPath: 'impl/node_modules' }]), limits: LIMITS,
  });
  projectionIdentity = inspectToolchainProjection(projectionDescriptor);
  const runtimeCredentialFiles = { codex: [CODEX_AUTH], ...(existsSync(GROK_AUTH) ? { grok: [GROK_AUTH] } : {}) };
  driver = createDriver({
    repoRoot: TARGET_REPO, logDir: LOG_DIR, repoId: `baton-phase${REVIEW_PHASE}-live`,
    adapters: {
      codex: new CodexAppServerCli({ requestTimeoutMs: 45_000, maxWireFrameBytes: MAX_WIRE_FRAME_BYTES, ceiling: 1 }),
      claude: new ClaudeSessionCli({ approvals: true, permissionMode: 'default', maxWireFrameBytes: MAX_WIRE_FRAME_BYTES, ceiling: 1 }),
      glm: new GlmSessionCli({ authTokenFile: GLM_AUTH, authTokenJsonPointer: process.env.BATON_GLM_AUTH_JSON_POINTER ?? '/glm_key', model: 'glm-4.7', approvals: false, permissionMode: 'acceptEdits', args: ['--safe-mode', '--no-session-persistence', '--max-budget-usd', '3.00'], maxWireFrameBytes: MAX_WIRE_FRAME_BYTES, ceiling: 1, killGraceMs: 5_000 }),
      grok: new GrokAcpCli({ requestTimeoutMs: 45_000, maxWireFrameBytes: MAX_WIRE_FRAME_BYTES, ceiling: 2 }),
    },
    runtimeIsolation: { credentialFiles: runtimeCredentialFiles },
    ...(phase62GoalPlanPolicy ? { goalPlanAuthority: { policy: phase62GoalPlanPolicy, authorize: phase62Authorize } } : {}),
    ...(providerGovernance ? { providerGovernance } : {}),
    ...(worktreeCapacity ? { worktreeCapacity } : {}),
    toolchainProjection: { ...projectionDescriptor, expectedManifestDigest: projectionIdentity.manifestDigest },
    workerSparsePaths: sparseWorkerPaths,
    verifySparsePaths: process.env.BATON_SPARSE_VERIFY === '1' ? ['impl', 'reviews/dogfood'] : [],
    approvalTimeoutMs: 60_000, stopDeadlineMs: 15_000,
    drainPolicy: { maxWorkers: TASKS.length, timeoutMs: 90_000, pollMs: 10 },
    budgetPolicy: { terminalGraceMs: 2_000 }, watchdog: { stallMs: 720_000 },
  });
  await driver.ready;
  const { coordinator, log } = driver;
  if (REVIEW_PHASE === '62') {
    const taskBriefs = TASK_CATALOG.map((task) => ({ task, brief: brief(task) }));
    const goalBudget = taskBriefs.reduce((sum, row) => ({
      tokens: sum.tokens + row.brief.budget.tokens,
      usd: sum.usd + row.brief.budget.usd,
      wallMin: sum.wallMin + row.brief.budget.wallMin,
      providerTurns: sum.providerTurns + PHASE62_NODE_PROVIDER_TURNS,
    }), { tokens: 0, usd: 0, wallMin: 0, providerTurns: 0 });
    const goalResult = await coordinator.defineGoal({
      objective: `Independently review committed Phase 62 at ${IMPLEMENTATION_SHA.slice(0, 7)} across all five exact provider routes under mandatory Goal/Plan authority.`,
      definitionOfDone: ['All three headings exist and the verdict explicitly says PASS or REVISE.'],
      constraints: [...taskBriefs[0].brief.constraints],
      risk: 'high',
      budget: goalBudget,
      predecessor: null,
    }, phase62Context('goal_define', 'phase62:goal:define'));
    const goal = goalResult.goal;
    const goalRef = { goalId: goal.goalId, version: goal.version, digest: goal.digest };
    const planResult = await coordinator.proposePlan({
      goal: goalRef,
      predecessor: null,
      nodes: taskBriefs.map(({ task, brief: taskBrief }) => ({
        key: task.taskId,
        objective: taskBrief.goal,
        definitionOfDone: [taskBrief.definitionOfDone],
        deps: [],
        pathScope: [...taskBrief.pathScope],
        risk: 'high',
        budget: { ...taskBrief.budget, providerTurns: PHASE62_NODE_PROVIDER_TURNS },
        verification: { ...taskBrief.verification },
        routes: { harnesses: [task.harness], models: [task.model], efforts: ['low'] },
        capabilities: ['code', 'test'],
        effects: ['provider_call', 'repository_edit'],
      })),
    }, phase62Context('plan_propose', 'phase62:plan:propose'));
    const plan = planResult.plan;
    const planRef = { planId: plan.planId, version: plan.version, digest: plan.digest };
    const approvalResult = await coordinator.approvePlan({
      goal: goalRef, plan: planRef, expectedDisposition: null, disposition: 'approved',
    }, phase62Context('plan_approve', 'phase62:plan:approve'));
    const approval = approvalResult.approval;
    const gates = Object.fromEntries(plan.nodes.map((node) => [node.key, Object.freeze({
      goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
      planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
      nodeKey: node.key, expectedDispatchVersion: 0,
      capabilities: [...node.capabilities], effects: [...node.effects],
    })]));
    phase62AuthoritySetup = Object.freeze({ goal, plan, approval, gates });
  }
  pump = (async () => {
    const consumed = new Set();
    while (pumping) {
      for (const worker of coordinator.list()) {
        const requestId = worker.pendingApprovalId ?? worker.pendingQuestionId;
        if (!requestId || consumed.has(requestId)) continue;
        consumed.add(requestId);
        responses.push({ workerId: worker.id, requestId, ack: await coordinator.respond(requestId, worker.pendingApprovalId ? { decision: 'allow' } : { text: 'Finish only the scoped report.' }, `orchestrator:phase${REVIEW_PHASE}-live`) });
      }
      const liveGrok = rows.filter((row) => row.harness === 'grok').map((row) => {
        const events = log.read(row.workerId); const started = events.findLast((event) => event.kind === 'lifecycle.process_started');
        const closed = started ? events.find((event) => event.kind === 'lifecycle.process_closed' && event.payload?.generation === started.payload?.generation) : null;
        return { taskId: row.taskId, workerId: row.workerId, pid: started?.payload?.pid ?? null, processGroupId: started?.payload?.processGroupId ?? null, generation: started?.payload?.generation ?? null, closed: Boolean(closed), leaderAlive: alive(started?.payload?.pid), groupAlive: groupAlive(started?.payload?.processGroupId) };
      });
      if (simultaneousGrokSamples.length < 64 && liveGrok.length === 2 && liveGrok.every((row) => row.pid && row.processGroupId && !row.closed && row.leaderAlive && row.groupAlive)) simultaneousGrokSamples.push({ at: new Date().toISOString(), grok: liveGrok });
      await sleep(50);
    }
  })();

  const settled = await Promise.allSettled(TASKS.map(async (task) => {
    const handle = await coordinator.spawn(task.harness, brief(task), {
      taskId: task.taskId, ...(REVIEW_PHASE === '62' ? {} : { taskType: TASK_TYPE }),
      runId: RUN_ID, model: task.model, effort: 'low',
      ...(REVIEW_PHASE === '62' ? {} : { modelPolicy: { allow: [task.model], allowFamilies: [task.family], reasoningEffort: 'low' } }),
      ...(REVIEW_PHASE === '62' ? {
        goalPlan: phase62AuthoritySetup.gates[task.taskId],
        actor: 'direct:phase62-dispatcher', principalId: 'phase62-dispatcher', sessionId: 'phase62-dispatcher-session',
        powers: ['plan:dispatch'], idempotencyKey: `phase62:dispatch:${task.taskId}`,
      } : {}),
    });
    const row = { ...task, workerId: handle.id, handle }; rows.push(row); return row;
  }));
  settled.forEach((result, index) => attempts.push({ taskId: TASKS[index].taskId, admitted: result.status === 'fulfilled', error: result.status === 'rejected' ? String(result.reason?.stack ?? result.reason).slice(0, 1_200) : null }));
  if (rows.length > 0) await Promise.all(rows.map((row) => until(async () => (await coordinator.result(row.workerId)).ready, `${row.taskId} terminal result`)));
  for (const row of rows) {
    row.result = await coordinator.result(row.workerId); row.events = log.read(row.workerId);
    row.ready = row.events.find((event) => event.kind === 'worktree.ready') ?? null;
    row.verify = row.events.findLast((event) => event.kind === 'verify.reverified') ?? null;
    const sha = row.verify?.payload?.capture?.sha;
    if (row.result.status === 'completed' && row.verify?.payload?.accept === true && sha) {
      try { row.report = targetGit(['show', `${sha}:${row.target}`]); } catch { row.report = null; }
    }
  }
  if (REVIEW_PHASE === '62') {
    phase62Status = await coordinator.goalPlanStatus({
      goalId: phase62AuthoritySetup.goal.goalId,
      goalVersion: phase62AuthoritySetup.goal.version,
      goalDigest: phase62AuthoritySetup.goal.digest,
      planId: phase62AuthoritySetup.plan.planId,
      planVersion: phase62AuthoritySetup.plan.version,
      planDigest: phase62AuthoritySetup.plan.digest,
      throughSeq: null,
    }, phase62Context('goal_plan_status', 'phase62:goal-plan:status'));
    const coordinationEvents = driver.coordination.events();
    const bySeq = new Map(coordinationEvents.map((event) => [event.seq, event]));
    const bindings = TASKS.map((task) => {
      const dispatch = coordinationEvents.find((event) => event.kind === 'plan.node_dispatched' && event.payload?.binding?.nodeKey === task.taskId);
      const created = dispatch ? bySeq.get(dispatch.seq + 1) : null;
      const durableTask = driver.coordination.task(task.taskId);
      const statusNode = phase62Status.nodes.find((node) => node.key === task.taskId) ?? null;
      const planNode = phase62AuthoritySetup.plan.nodes.find((node) => node.key === task.taskId) ?? null;
      const gate = phase62AuthoritySetup.gates[task.taskId];
      const binding = durableTask?.brief?.goalPlan ?? null;
      const bindingExact = binding?.goalId === gate.goalId && binding?.goalVersion === gate.goalVersion && binding?.goalDigest === gate.goalDigest
        && binding?.planId === gate.planId && binding?.planVersion === gate.planVersion && binding?.planDigest === gate.planDigest
        && binding?.nodeKey === gate.nodeKey && binding?.approvalDigest === phase62AuthoritySetup.approval.digest
        && binding?.policyDigest === phase62AuthoritySetup.goal.policyDigest && binding?.dispatchVersion === 1;
      const authoritativeBriefExact = same(durableTask?.brief?.verification, planNode?.verification)
        && same(durableTask?.brief?.budget, planNode ? { tokens: planNode.budget.tokens, usd: planNode.budget.usd, wallMin: planNode.budget.wallMin } : null)
        && same(durableTask?.brief?.constraints, phase62AuthoritySetup.goal.constraints)
        && same(durableTask?.brief?.pathScope, planNode?.pathScope)
        && durableTask?.brief?.goal === planNode?.objective && durableTask?.brief?.providerTurns === planNode?.budget?.providerTurns;
      const batchExact = dispatch?.batch?.kind === 'goal_plan_node_dispatch' && dispatch.batch.index === 0 && dispatch.batch.count === 2
        && created?.kind === 'task.created' && created?.payload?.id === task.taskId
        && created?.batch?.kind === dispatch.batch.kind && created?.batch?.id === dispatch.batch.id
        && created?.batch?.index === 1 && created?.batch?.count === 2 && created?.ts === dispatch.ts
        && created?.actor === dispatch.actor && created?.idempotencyKey === `${dispatch.idempotencyKey}:task`;
      const statusExact = statusNode?.taskId === task.taskId && statusNode?.dispatchVersion === 1
        && ['accepted', 'failed', 'cancelled', 'dispatched'].includes(statusNode?.state)
        && (['accepted', 'failed', 'cancelled'].includes(statusNode?.state)
          ? ['held', 'settled'].includes(statusNode?.budget?.status)
          : statusNode?.budget?.status === 'pending');
      return {
        taskId: task.taskId,
        binding,
        bindingExact,
        authoritativeBriefExact,
        status: statusNode,
        statusExact,
        batch: dispatch && created ? {
          id: dispatch.batch?.id ?? null,
          dispatchSeq: dispatch.seq,
          taskSeq: created.seq,
          kind: dispatch.batch?.kind ?? null,
          count: dispatch.batch?.count ?? null,
        } : null,
        batchExact,
      };
    });
    phase62Proof = {
      configuredMandatory: phase62GoalPlanPolicy?.mandatory === true,
      goal: {
        goalId: phase62AuthoritySetup.goal.goalId,
        version: phase62AuthoritySetup.goal.version,
        digest: phase62AuthoritySetup.goal.digest,
        policyDigest: phase62AuthoritySetup.goal.policyDigest,
      },
      plan: {
        planId: phase62AuthoritySetup.plan.planId,
        version: phase62AuthoritySetup.plan.version,
        digest: phase62AuthoritySetup.plan.digest,
        nodeCount: phase62AuthoritySetup.plan.nodes.length,
        exactRoutes: phase62AuthoritySetup.plan.nodes.map((node) => ({ key: node.key, routes: node.routes, verification: node.verification })),
      },
      approval: {
        digest: phase62AuthoritySetup.approval.digest,
        disposition: phase62AuthoritySetup.approval.disposition,
        proposerPrincipalId: phase62AuthoritySetup.plan.proposerPrincipalId,
        approverPrincipalId: phase62AuthoritySetup.approval.principalId,
        distinctPrincipal: phase62AuthoritySetup.plan.proposerPrincipalId !== phase62AuthoritySetup.approval.principalId,
      },
      status: phase62Status,
      bindings,
    };
    phase62Proof.pass = phase62Proof.configuredMandatory && phase62Proof.plan.nodeCount === 5
      && phase62Proof.approval.disposition === 'approved' && phase62Proof.approval.distinctPrincipal
      && bindings.length === TASKS.length && bindings.every((row) => row.bindingExact && row.authoritativeBriefExact && row.batchExact && row.statusExact);
  }
} catch (error) {
  fatal = String(error?.stack ?? error);
} finally {
  pumping = false; await pump.catch(() => {});
  if (driver) {
    try { closureReceipt = await driver.drainAndClose(`orchestrator:phase${REVIEW_PHASE}-live`); }
    catch (error) { fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n'); }
  }
}

let summary;
try {
  const targetGit = targetCreated && existsSync(TARGET_REPO) ? (args) => execFileSync('git', args, { cwd: TARGET_REPO, encoding: 'utf8' }).trim() : null;
  if (driver && targetGit) {
    const { coordinator, log } = driver;
    for (const row of rows) {
      row.events = log.read(row.workerId); row.handle = coordinator._publicHandle(coordinator._workers.get(row.workerId));
      row.processGenerations = row.events.filter((event) => event.kind === 'lifecycle.process_started').map((started) => {
        const closes = row.events.filter((event) => event.kind === 'lifecycle.process_closed' && event.payload?.generation === started.payload?.generation);
        const killRequested = row.events.filter((event) => event.kind === 'kill.requested' && (!event.payload?.generation || event.payload.generation === started.payload?.generation));
        const killConfirmed = row.events.filter((event) => event.kind === 'kill.confirmed' && (!event.payload?.generation || event.payload.generation === started.payload?.generation));
        return { started, closes, killRequested, killConfirmed };
      });
      row.processStarted = row.processGenerations.at(-1)?.started ?? null;
      row.processClosed = row.processStarted ? row.events.findLast((event) => event.kind === 'lifecycle.process_closed' && event.payload?.generation === row.processStarted.payload?.generation) ?? null : null;
      row.pid = row.processStarted?.payload?.pid ?? null; row.processGroupId = row.processStarted?.payload?.processGroupId ?? null;
    }
    ownershipAfter = targetOwnership(targetGit);
  }
  const exactRoute = (row) => {
    try {
      const tuple = JSON.parse(row.handle.routeKey);
      return Array.isArray(tuple) && tuple.length === 6 && `${tuple[0]}@${tuple[1]}` === row.handle.harnessResolved && tuple[2] === row.model && tuple[3] === 'low' && tuple[4] === row.family && tuple[5] === (REVIEW_PHASE === '62' ? 'general' : TASK_TYPE);
    } catch { return false; }
  };
  const routeAdmission = {
    allAttempted: attempts.length === TASKS.length,
    allAdmitted: attempts.length === TASKS.length && attempts.every((attempt) => attempt.admitted),
    exactRequestedResolved: rows.length === TASKS.length && rows.every((row) => row.handle?.harnessRequested === row.harness && row.handle?.modelRequested === row.model && row.handle?.modelResolved === row.model && row.handle?.effortRequested === 'low' && row.handle?.effortResolved === 'low' && exactRoute(row)),
    noObservedMismatch: rows.length === TASKS.length && rows.every((row) => row.handle?.modelMismatch === null && (row.handle?.effortObserved === null || row.handle?.effortObserved === 'low')),
    providerObservationComplete: rows.length === TASKS.length && rows.every((row) => row.handle?.modelObserved === row.model),
    providerGovernanceMode: GOVERNANCE_MODE,
    allGovernedBeforeEffect: !providerGovernance || (rows.length === TASKS.length && rows.every((row) => {
      const admission = row.events?.find((event) => event.kind === 'resource.provider_turn_admitted');
      const processStart = row.events?.find((event) => event.kind === 'lifecycle.process_started');
      return admission?.payload?.mode === GOVERNANCE_MODE && (!processStart || admission.seq < processStart.seq);
    })),
  };
  const generations = rows.flatMap((row) => (row.processGenerations ?? []).map((generation) => ({ row, ...generation })));
  const correlatedClose = ({ started, closes }) => closes.length === 1 && closes[0].payload?.pid === started.payload?.pid && closes[0].payload?.processGroupId === started.payload?.processGroupId && closes[0].payload?.generation === started.payload?.generation;
  const providerProof = {
    startedProcessCount: generations.length,
    allSelectedProcessesStarted: rows.length === TASKS.length && rows.every((row) => (row.processGenerations?.length ?? 0) > 0),
    simultaneousActiveGrokPidSampleObserved: simultaneousGrokSamples.length > 0,
    everyStartedProcessClosedExactly: generations.every(correlatedClose),
    everyRequestedKillConfirmed: generations.every(({ killRequested, killConfirmed }) => killRequested.length === 0 || killConfirmed.length > 0),
    zeroReapUnconfirmed: rows.every((row) => !row.events?.some((event) => event.kind === 'lifecycle.process_reap_unconfirmed')),
    everyStartedLeaderGone: generations.every(({ started }) => !alive(started.payload?.pid)),
    everyStartedGroupGone: generations.every(({ started }) => !groupAlive(started.payload?.processGroupId)),
  };
  const cleanup = {
    closureReceiptPresent: closureReceipt?.state === 'closed',
    coordinatorClosed: closureReceipt?.authority?.coordinatorClosed === true,
    writerReleased: closureReceipt?.authority?.writerReleased === true && !existsSync(join(LOG_DIR, 'coordination', 'writer.lease')),
    taskWorktreesGone: TASKS.every((task) => !existsSync(join(TARGET_REPO, '.baton', 'wt', task.taskId)) && !existsSync(join(TARGET_REPO, '.baton', 'wt', `${task.taskId}.meta.json`)) && !existsSync(join(TARGET_REPO, '.baton', 'wt', `${task.taskId}.projection.exclude`))),
    runtimesGone: rows.every((row) => !existsSync(join(TARGET_REPO, '.baton', 'runtime', row.workerId))),
    taskBranchesGone: targetGit ? TASKS.every((task) => targetGit(['branch', '--list', `baton/${task.taskId}`]) === '') : false,
    targetDependencyAbsent: !existsSync(join(TARGET_REPO, 'impl', 'node_modules')),
    ownershipSnapshotRestored: same(ownershipAfter, ownershipBefore),
    capacityReceiptPresent: !worktreeCapacity || (closureReceipt?.capacity?.ownedReservations === 0 && /^[a-f0-9]{64}$/u.test(closureReceipt?.capacity?.stateDigest ?? '')),
    capacityFleetZero: !worktreeCapacity || (closureReceipt?.capacity?.fleetTotals?.bytes === 0 && closureReceipt?.capacity?.fleetTotals?.inodes === 0),
  };
  const reportBinding = (row) => row.result?.status === 'completed' && row.verify?.payload?.accept === true && Boolean(row.report) && row.report.includes('## Verdict') && row.report.includes('## P0-P1 findings') && row.report.includes('## Required corrections');
  const reviewProof = { terminalTaskCount: rows.filter((row) => row.result?.ready === true).length, verifiedReports: rows.filter(reportBinding).map((row) => row.taskId), allSelectedVerified: rows.length === TASKS.length && rows.every(reportBinding) };
  const projectionProof = {
    identity: projectionIdentity,
    allWorkersBound: rows.length === TASKS.length && rows.every((row) => same(row.ready?.payload?.toolchainProjection, projectionIdentity)),
    allVerifiersBound: rows.filter((row) => row.verify).every((row) => same(row.verify.payload?.capture?.toolchainProjection, projectionIdentity) && same(row.verify.payload?.capture?.verifierToolchainProjection, projectionIdentity)),
    sourcePathAbsentFromBoundedEvents: rows.every((row) => !JSON.stringify(bounded(row.events ?? [])).includes(SOURCE_REPO)),
  };
  const lifecyclePass = fatal === null && routeAdmission.allAdmitted && routeAdmission.exactRequestedResolved && routeAdmission.allGovernedBeforeEffect && providerProof.allSelectedProcessesStarted && (!REQUIRE_GROK_PAIR || providerProof.simultaneousActiveGrokPidSampleObserved) && providerProof.everyStartedProcessClosedExactly && providerProof.everyRequestedKillConfirmed && providerProof.zeroReapUnconfirmed && providerProof.everyStartedLeaderGone && providerProof.everyStartedGroupGone && Object.values(cleanup).every(Boolean) && (REVIEW_PHASE !== '62' || phase62Proof?.pass === true);
  const matrixPass = lifecyclePass && routeAdmission.noObservedMismatch && routeAdmission.providerObservationComplete && reviewProof.allSelectedVerified && projectionProof.allWorkersBound && projectionProof.allVerifiersBound && projectionProof.sourcePathAbsentFromBoundedEvents;
  summary = {
    at: new Date().toISOString(), implementationSha: IMPLEMENTATION_SHA, runId: RUN_ID, selectedTaskIds: TASKS.map((task) => task.taskId),
    interpretation: { lifecyclePass: `all ${TASKS.length} selected exact routes admitted${REVIEW_PHASE === '62' ? ' through one mandatory approved five-node Goal/Plan with exact authoritative Brief and atomic dispatch/task batch proof' : ''}${REQUIRE_GROK_PAIR ? ', both Grok process groups sampled live simultaneously' : ''}, every started generation closed exactly, driver drain closed coordinator/writer, and all owned residue disappeared`, matrixPass: `lifecyclePass plus exact provider model observation, ${TASKS.length} fresh-verified report(s), and identical worker/verifier toolchain projection binding` },
    manualWorkerKills: false, legacyDriverClose: false, capacityPolicy: worktreeCapacity, closureReceipt,
    credentialMeasurements, simultaneousGrokSamples, attempts,
    rows: rows.map((row) => ({ taskId: row.taskId, harness: row.harness, model: row.model, workerId: row.workerId, pid: row.pid ?? null, processGroupId: row.processGroupId ?? null, result: row.result ? { status: row.result.status, ready: row.result.ready, observationOnly: row.result.observationOnly, providerGovernance: row.result.providerGovernance } : null, route: row.handle ? { harnessRequested: row.handle.harnessRequested, harnessResolved: row.handle.harnessResolved, modelRequested: row.handle.modelRequested, modelResolved: row.handle.modelResolved, modelObserved: row.handle.modelObserved, modelMismatch: row.handle.modelMismatch, effortRequested: row.handle.effortRequested, effortResolved: row.handle.effortResolved, effortObserved: row.handle.effortObserved } : null, providerPolicyDigest: row.handle?.providerPolicyDigest ?? null, providerTurn: row.handle?.providerTurn ?? null, budgetUsed: row.handle?.budgetUsed ?? null, verifyAccept: row.verify?.payload?.accept ?? false, budgetAdmission: row.verify?.payload?.budgetAdmission ?? null, providerGovernanceAdmission: row.verify?.payload?.providerGovernanceAdmission ?? null, reportCaptured: Boolean(row.report), processStartedSeq: row.processStarted?.seq ?? null, processClosedSeq: row.processClosed?.seq ?? null, terminalReason: String(row.events?.findLast((event) => ['lifecycle.crashed', 'model.mismatch'].includes(event.kind))?.payload?.error ?? row.events?.findLast((event) => event.kind === 'lifecycle.crashed')?.payload?.reason ?? row.events?.findLast((event) => event.kind === 'lifecycle.turn_completed')?.payload?.result?.summary ?? row.events?.findLast((event) => event.kind === 'lifecycle.turn_completed')?.payload?.summary ?? '').slice(0, 512) })),
    responses, routeAdmission, providerProof, cleanup, projectionProof, reviewProof, ...(REVIEW_PHASE === '62' ? { goalPlanProof: phase62Proof } : {}), ownershipBefore, ownershipAfter, fatal, lifecyclePass, matrixPass,
  };
} catch (error) {
  fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n');
  summary = { at: new Date().toISOString(), implementationSha: IMPLEMENTATION_SHA, runId: RUN_ID, capacityPolicy: worktreeCapacity, ...(REVIEW_PHASE === '62' ? { goalPlanProof: phase62Proof } : {}), fatal, lifecyclePass: false, matrixPass: false };
}

if (targetAttempted) {
  try {
    const registeredBeforeRemoval = sourceGit(['worktree', 'list', '--porcelain']).includes(TARGET_REPO);
    if (registeredBeforeRemoval) sourceGit(['worktree', 'remove', '--force', TARGET_REPO]);
    else rmSync(TARGET_REPO, { recursive: true, force: true });
    sourceGit(['worktree', 'prune']);
    targetRemoved = !existsSync(TARGET_REPO) && !sourceGit(['worktree', 'list', '--porcelain']).includes(TARGET_REPO);
    if (!targetRemoved) throw new Error('clean target worktree remained registered');
  } catch (error) { removalError = String(error?.stack ?? error); }
}
summary.targetWorktreeRemoved = targetRemoved;
summary.removalError = removalError;
if (!targetRemoved || removalError) { summary.lifecyclePass = false; summary.matrixPass = false; summary.fatal = [summary.fatal, removalError ?? 'target worktree removal incomplete'].filter(Boolean).join('\n'); }
const diagnosticLogRetained = !summary.matrixPass && process.env.BATON_KEEP_FAILED_LOG === '1';
if (!diagnosticLogRetained) rmSync(LOG_DIR, { recursive: true, force: true });
let ownerRootReadyForSupervisorReap = false;
try {
  ownerRootReadyForSupervisorReap = targetRemoved && existsSync(OWNER_ROOT) && readdirSync(OWNER_ROOT).length === 0;
} catch (error) {
  summary.fatal = [summary.fatal, String(error?.stack ?? error)].filter(Boolean).join('\n');
}
summary.ownerRootReadyForSupervisorReap = ownerRootReadyForSupervisorReap;
if (!ownerRootReadyForSupervisorReap) { summary.lifecyclePass = false; summary.matrixPass = false; summary.fatal = [summary.fatal, 'owned evidence root retained child residue'].filter(Boolean).join('\n'); }

writeFileSync(join(OUTPUT, 'events.jsonl'), `${rows.flatMap((row) => bounded(row.events ?? []).map((event) => JSON.stringify({ taskId: row.taskId, requestedHarness: row.harness, requestedModel: row.model, requestedEffort: 'low', ...event }))).join('\n')}\n`);
writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
for (const row of rows) if (row.report) writeFileSync(join(OUTPUT, `${row.taskId}.md`), row.report);
process.stdout.write(`${JSON.stringify({ lifecyclePass: summary.lifecyclePass, matrixPass: summary.matrixPass, routeAdmission: summary.routeAdmission, providerProof: summary.providerProof, cleanup: summary.cleanup, reviewProof: summary.reviewProof, ...(REVIEW_PHASE === '62' ? { goalPlanProof: summary.goalPlanProof } : {}), fatal: summary.fatal, targetWorktreeRemoved: summary.targetWorktreeRemoved, ownerRootReadyForSupervisorReap: summary.ownerRootReadyForSupervisorReap, diagnosticLogDir: diagnosticLogRetained ? LOG_DIR : null }, null, 2)}\n`);
if (!summary.matrixPass) process.exitCode = 1;
