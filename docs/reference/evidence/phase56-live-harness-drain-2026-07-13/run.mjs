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
});
const reviewArtifact = REVIEW_ARTIFACTS[REVIEW_PHASE];
if (!reviewArtifact && (!process.env.BATON_REVIEW_SPEC || !process.env.BATON_REVIEW_TEST)) throw new Error('PENDING-LIVE-review-artifact-mapping-required');
const REVIEW_SPEC = process.env.BATON_REVIEW_SPEC ?? `spec/phase${REVIEW_PHASE}/${reviewArtifact[0]}.md`;
const REVIEW_TEST = process.env.BATON_REVIEW_TEST ?? `impl/test/phase${REVIEW_PHASE}-${reviewArtifact[1]}.test.mjs`;
const TARGET_REPO = join(OWNER_ROOT, `phase${REVIEW_PHASE}-clean-target`);
const LOG_DIR = mkdtempSync(join(tmpdir(), `baton-phase${REVIEW_PHASE}-live-log-`));
const RUN_ID = REVIEW_PHASE === '56' ? 'phase56-live-harness-drain' : `phase${REVIEW_PHASE}-live-harness-governance`;
const TASK_TYPE = REVIEW_PHASE === '56' ? 'phase56-drain-adversarial-review' : `phase${REVIEW_PHASE}-governance-adversarial-review`;
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
  focus: (REVIEW_PHASE === '59' ? phase59Focus : REVIEW_PHASE === '57' ? phase57Focus : phase56Focus)[index],
}));
const selectedTaskIds = process.env.BATON_TASK_IDS ? new Set(process.env.BATON_TASK_IDS.split(',').filter(Boolean)) : null;
const TASKS = selectedTaskIds ? TASK_CATALOG.filter((task) => selectedTaskIds.has(task.taskId)) : TASK_CATALOG;
const REQUIRE_GROK_PAIR = TASKS.filter((task) => task.harness === 'grok').length === 2;
const GOVERNANCE_MODE = process.env.BATON_PROVIDER_GOVERNANCE_MODE ?? null;
const routeTokenBudget = (task) => Number(process.env.BATON_TASK_TOKEN_BUDGET
  ?? (REVIEW_PHASE === '56' ? 60_000 : task.harness === 'codex' ? 450_000 : 300_000));
const terminalReserveTokens = (task) => Number(process.env.BATON_TERMINAL_RESERVE_TOKENS ?? routeTokenBudget(task));
const providerGovernance = GOVERNANCE_MODE ? {
  schemaVersion: 1,
  maxWireFrameBytes: 1024 * 1024,
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
  return createBrief({
    goal: `Independently review committed Phase ${REVIEW_PHASE} at ${IMPLEMENTATION_SHA.slice(0, 7)}, focusing on ${task.focus}. Inspect ${REVIEW_SPEC} and its implementation/tests. Write ${task.target} with exactly the headings "## Verdict", "## P0-P1 findings", and "## Required corrections".`,
    constraints: [
      `Edit only ${task.target}.`,
      'Keep the report under 700 words and use at most 8 repository/tool calls.',
      'Ground confirmed defects in exact committed source and distinguish them from retained later scope.',
      'Do not inspect credentials or environment, use network tools, commit, push, deploy, or access homelab/project-manager.',
    ],
    pathScope: [task.target],
    definitionOfDone: 'All three headings exist and the verdict explicitly says PASS or REVISE.',
    verification: {
      command: `test -s ${task.target} && grep -Fq '## Verdict' ${task.target} && grep -Fq '## P0-P1 findings' ${task.target} && grep -Fq '## Required corrections' ${task.target} && node impl/scripts/run-evidence.mjs impl/scripts/run-suite.mjs ${REVIEW_TEST}`,
      expectExit: 0, timeoutMs: 180_000,
    },
    budget: { tokens: routeTokenBudget(task), usd: 3, wallMin: 14 },
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
  return {
    branches: git(['branch', '--list', 'baton/*']).split('\n').map((line) => line.trim()).filter(Boolean).sort(),
    worktreeEntries: names(join(TARGET_REPO, '.baton', 'wt')),
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
      codex: new CodexAppServerCli({ requestTimeoutMs: 45_000, ceiling: 1 }),
      claude: new ClaudeSessionCli({ approvals: true, permissionMode: 'default', ceiling: 1 }),
      glm: new GlmSessionCli({ authTokenFile: GLM_AUTH, authTokenJsonPointer: process.env.BATON_GLM_AUTH_JSON_POINTER ?? '/glm_key', model: 'glm-4.7', approvals: false, permissionMode: 'acceptEdits', args: ['--safe-mode', '--no-session-persistence', '--max-budget-usd', '3.00'], ceiling: 1, killGraceMs: 5_000 }),
      grok: new GrokAcpCli({ requestTimeoutMs: 45_000, ceiling: 2 }),
    },
    runtimeIsolation: { credentialFiles: runtimeCredentialFiles },
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
      if (liveGrok.length === 2 && liveGrok.every((row) => row.pid && row.processGroupId && !row.closed && row.leaderAlive && row.groupAlive)) simultaneousGrokSamples.push({ at: new Date().toISOString(), grok: liveGrok });
      await sleep(50);
    }
  })();

  const settled = await Promise.allSettled(TASKS.map(async (task) => {
    const handle = await coordinator.spawn(task.harness, brief(task), {
      taskId: task.taskId, taskType: TASK_TYPE, runId: RUN_ID, model: task.model, effort: 'low',
      modelPolicy: { allow: [task.model], allowFamilies: [task.family], reasoningEffort: 'low' },
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
      return Array.isArray(tuple) && tuple.length === 6 && `${tuple[0]}@${tuple[1]}` === row.handle.harnessResolved && tuple[2] === row.model && tuple[3] === 'low' && tuple[4] === row.family && tuple[5] === TASK_TYPE;
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
  const lifecyclePass = fatal === null && routeAdmission.allAdmitted && routeAdmission.exactRequestedResolved && routeAdmission.noObservedMismatch && routeAdmission.allGovernedBeforeEffect && providerProof.allSelectedProcessesStarted && (!REQUIRE_GROK_PAIR || providerProof.simultaneousActiveGrokPidSampleObserved) && providerProof.everyStartedProcessClosedExactly && providerProof.everyRequestedKillConfirmed && providerProof.zeroReapUnconfirmed && providerProof.everyStartedLeaderGone && providerProof.everyStartedGroupGone && Object.values(cleanup).every(Boolean);
  const matrixPass = lifecyclePass && routeAdmission.providerObservationComplete && reviewProof.allSelectedVerified && projectionProof.allWorkersBound && projectionProof.allVerifiersBound && projectionProof.sourcePathAbsentFromBoundedEvents;
  summary = {
    at: new Date().toISOString(), implementationSha: IMPLEMENTATION_SHA, runId: RUN_ID, selectedTaskIds: TASKS.map((task) => task.taskId),
    interpretation: { lifecyclePass: `all ${TASKS.length} selected exact routes admitted${REQUIRE_GROK_PAIR ? ', both Grok process groups sampled live simultaneously' : ''}, every started generation closed exactly, driver drain closed coordinator/writer, and all owned residue disappeared`, matrixPass: `lifecyclePass plus exact provider model observation, ${TASKS.length} fresh-verified report(s), and identical worker/verifier toolchain projection binding` },
    manualWorkerKills: false, legacyDriverClose: false, capacityPolicy: worktreeCapacity, closureReceipt,
    credentialMeasurements, simultaneousGrokSamples, attempts,
    rows: rows.map((row) => ({ taskId: row.taskId, harness: row.harness, model: row.model, workerId: row.workerId, pid: row.pid ?? null, processGroupId: row.processGroupId ?? null, result: row.result ? { status: row.result.status, ready: row.result.ready, observationOnly: row.result.observationOnly, providerGovernance: row.result.providerGovernance } : null, route: row.handle ? { harnessRequested: row.handle.harnessRequested, harnessResolved: row.handle.harnessResolved, modelRequested: row.handle.modelRequested, modelResolved: row.handle.modelResolved, modelObserved: row.handle.modelObserved, modelMismatch: row.handle.modelMismatch, effortRequested: row.handle.effortRequested, effortResolved: row.handle.effortResolved, effortObserved: row.handle.effortObserved } : null, providerPolicyDigest: row.handle?.providerPolicyDigest ?? null, providerTurn: row.handle?.providerTurn ?? null, budgetUsed: row.handle?.budgetUsed ?? null, verifyAccept: row.verify?.payload?.accept ?? false, budgetAdmission: row.verify?.payload?.budgetAdmission ?? null, providerGovernanceAdmission: row.verify?.payload?.providerGovernanceAdmission ?? null, reportCaptured: Boolean(row.report), processStartedSeq: row.processStarted?.seq ?? null, processClosedSeq: row.processClosed?.seq ?? null, terminalReason: String(row.events?.findLast((event) => ['lifecycle.crashed', 'model.mismatch'].includes(event.kind))?.payload?.error ?? row.events?.findLast((event) => event.kind === 'lifecycle.crashed')?.payload?.reason ?? row.events?.findLast((event) => event.kind === 'lifecycle.turn_completed')?.payload?.result?.summary ?? row.events?.findLast((event) => event.kind === 'lifecycle.turn_completed')?.payload?.summary ?? '').slice(0, 512) })),
    responses, routeAdmission, providerProof, cleanup, projectionProof, reviewProof, ownershipBefore, ownershipAfter, fatal, lifecyclePass, matrixPass,
  };
} catch (error) {
  fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n');
  summary = { at: new Date().toISOString(), implementationSha: IMPLEMENTATION_SHA, runId: RUN_ID, capacityPolicy: worktreeCapacity, fatal, lifecyclePass: false, matrixPass: false };
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
let ownerRootRemoved = false;
try {
  if (targetRemoved && existsSync(OWNER_ROOT) && readdirSync(OWNER_ROOT).length === 0) rmSync(OWNER_ROOT, { recursive: true, force: false });
  ownerRootRemoved = !existsSync(OWNER_ROOT);
} catch (error) {
  summary.fatal = [summary.fatal, String(error?.stack ?? error)].filter(Boolean).join('\n');
}
summary.ownerRootRemoved = ownerRootRemoved;
if (!ownerRootRemoved) { summary.lifecyclePass = false; summary.matrixPass = false; summary.fatal = [summary.fatal, 'owned evidence root removal incomplete'].filter(Boolean).join('\n'); }

writeFileSync(join(OUTPUT, 'events.jsonl'), `${rows.flatMap((row) => bounded(row.events ?? []).map((event) => JSON.stringify({ taskId: row.taskId, requestedHarness: row.harness, requestedModel: row.model, requestedEffort: 'low', ...event }))).join('\n')}\n`);
writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
for (const row of rows) if (row.report) writeFileSync(join(OUTPUT, `${row.taskId}.md`), row.report);
const diagnosticLogRetained = !summary.matrixPass && process.env.BATON_KEEP_FAILED_LOG === '1';
if (!diagnosticLogRetained) rmSync(LOG_DIR, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify({ lifecyclePass: summary.lifecyclePass, matrixPass: summary.matrixPass, routeAdmission: summary.routeAdmission, providerProof: summary.providerProof, cleanup: summary.cleanup, reviewProof: summary.reviewProof, fatal: summary.fatal, targetWorktreeRemoved: summary.targetWorktreeRemoved, ownerRootRemoved: summary.ownerRootRemoved, diagnosticLogDir: diagnosticLogRetained ? LOG_DIR : null }, null, 2)}\n`);
if (!summary.matrixPass) process.exitCode = 1;
