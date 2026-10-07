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
const TARGET_REPO = realpathSync(resolve(process.env.BATON_REPO ?? SOURCE_REPO));
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? HERE);
const LOG_DIR = mkdtempSync(join(tmpdir(), 'baton-phase55-projection-review-'));
const GLM_AUTH = resolve(process.env.BATON_GLM_AUTH_FILE ?? join(SOURCE_REPO, 'glm_key.json'));
const CODEX_AUTH = join(homedir(), '.codex', 'auth.json');
const GROK_AUTH = join(homedir(), '.grok', 'auth.json');
const RUN_ID = 'phase55-toolchain-projection-review';
const TASK_TYPE = 'phase55-toolchain-projection-implementation-review';
const BASE_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: TARGET_REPO, encoding: 'utf8' }).trim();
const TASKS = [
  { taskId: 'phase55-codex-review', harness: 'codex', model: 'gpt-5.6-sol', family: 'openai', target: 'reviews/dogfood/phase55-codex-review.md', tokens: 100_000, usd: 3, focus: 'TOCTOU resistance, content identity, target isolation, and capture refusal' },
  { taskId: 'phase55-claude-review', harness: 'claude', model: 'claude-opus-4-6', family: 'claude', target: 'reviews/dogfood/phase55-claude-review.md', tokens: 80_000, usd: 2, focus: 'worker/verifier separation, trust-gate provenance, replay, and legacy compatibility' },
  { taskId: 'phase55-glm-review', harness: 'glm', model: 'glm-4.7', family: 'glm', target: 'reviews/dogfood/phase55-glm-review.md', tokens: 100_000, usd: 3.5, focus: 'closed configuration, max-plus-one ceilings, path privacy, and cleanup completeness' },
  { taskId: 'phase55-grok45-review', harness: 'grok', model: 'grok-4.5', family: 'grok', target: 'reviews/dogfood/phase55-grok45-review.md', tokens: 70_000, usd: 2, focus: 'adversarial filesystem entry handling, source mutation, and exact route evidence' },
  { taskId: 'phase55-grokbuild-review', harness: 'grok', model: 'grok-build', family: 'grok', target: 'reviews/dogfood/phase55-grokbuild-review.md', tokens: 70_000, usd: 2, focus: 'recursive dogfood friction, lifecycle kill/reap, and retained full-system scope' },
];
const LIMITS = Object.freeze({ maxMappings: 1, maxFiles: 50_000, maxDirectories: 10_000, maxBytes: 512 * 1024 * 1024, maxFileBytes: 64 * 1024 * 1024, maxPathBytes: 2_048, maxDepth: 64 });
const projectionDescriptor = Object.freeze({
  schemaVersion: 1, sourceRoot: SOURCE_REPO, sourceId: 'baton-local-node-toolchain',
  mappings: Object.freeze([{ sourcePath: 'impl/node_modules', targetPath: 'impl/node_modules' }]), limits: LIMITS,
});
const projectionIdentity = inspectToolchainProjection(projectionDescriptor);
const toolchainProjection = Object.freeze({ ...projectionDescriptor, expectedManifestDigest: projectionIdentity.manifestDigest });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => { try { if (!pid) return false; process.kill(pid, 0); return true; } catch { return false; } };
const groupAlive = (pid) => { try { if (!pid) return false; process.kill(-pid, 0); return true; } catch { return false; } };
const git = (args) => execFileSync('git', args, { cwd: TARGET_REPO, encoding: 'utf8' }).trim();
const names = (path) => existsSync(path) ? readdirSync(path).sort() : [];
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const credentialFact = (path) => {
  try { const stat = statSync(path); return { present: stat.isFile(), ownerOnly: (stat.mode & 0o077) === 0, ownedByRunnerUser: typeof process.getuid !== 'function' || stat.uid === process.getuid() }; }
  catch (error) { return { present: false, ownerOnly: false, ownedByRunnerUser: false, error: error.code ?? 'stat_failed' }; }
};
function ownershipSnapshot() {
  const redact = (line) => line.replaceAll(SOURCE_REPO, '<source-repo>').replaceAll(TARGET_REPO, '<target-repo>');
  return {
    worktrees: git(['worktree', 'list', '--porcelain']).split('\n').filter((line) => line.startsWith('worktree ')).map(redact).sort(),
    branches: git(['branch', '--list', 'baton/*']).split('\n').map((line) => line.trim()).filter(Boolean).sort(),
    worktreeEntries: names(join(TARGET_REPO, '.baton', 'wt')),
    runtimeEntries: names(join(TARGET_REPO, '.baton', 'runtime')),
  };
}
async function until(fn, label, timeoutMs = 1_200_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(100); }
  throw new Error(`timeout waiting for ${label}`);
}
function brief(task) {
  return createBrief({
    goal: `Independently review committed Phase 55 at ${BASE_SHA.slice(0, 7)}, focusing on ${task.focus}. Read spec/phase55/immutable-toolchain-projection.md, impl/src/toolchain-projection.mjs, the projection seams in impl/src/worktree.mjs, impl/src/index.mjs, and impl/src/coordinator.mjs, plus impl/test/phase55-toolchain-projection.test.mjs. Write ${task.target} with exactly the headings "## Verdict", "## P0-P1 findings", and "## Required corrections".`,
    constraints: [
      `Edit only ${task.target}.`, 'Keep the report under 1000 words and use at most 10 repository/tool calls.',
      'Ground confirmed defects in exact current source and give a deterministic reproduction or violated contract.',
      'Treat explicitly retained later-scope features as retained work, not Phase 55 defects.',
      'Do not inspect credentials or environment, use network tools, commit, push, deploy, or access homelab/project-manager.',
    ],
    pathScope: [task.target], definitionOfDone: 'All three headings exist and the verdict explicitly says PASS or REVISE.',
    verification: { command: `test -s ${task.target} && grep -Fq '## P0-P1 findings' ${task.target} && grep -Fq '## Required corrections' ${task.target} && node --test impl/test/phase55-toolchain-projection.test.mjs`, expectExit: 0, timeoutMs: 120_000 },
    budget: { tokens: task.tokens, usd: task.usd, wallMin: 16 },
  });
}
function bounded(events) {
  const kinds = new Set(['worktree.ready', 'runtime.scope_created', 'lifecycle.spawned', 'lifecycle.turn_started', 'lifecycle.turn_completed', 'lifecycle.crashed', 'resource.tokens', 'resource.budget_threshold', 'verify.reverified', 'kill.requested', 'kill.confirmed', 'lifecycle.process_started', 'lifecycle.process_closed']);
  return events.filter((event) => kinds.has(event.kind)).map((event) => ({
    seq: event.seq, ts: event.ts, actor: event.actor, kind: event.kind,
    harnessRequested: event.harnessRequested ?? null, harnessResolved: event.harnessResolved ?? null,
    modelRequested: event.modelRequested ?? event.payload?.modelRequested ?? null, modelResolved: event.modelResolved ?? null,
    modelObserved: event.modelObserved ?? event.payload?.modelObserved ?? null, effortRequested: event.effortRequested ?? null,
    effortResolved: event.effortResolved ?? null, effortObserved: event.effortObserved ?? null,
    payload: event.kind === 'worktree.ready' ? { projectionDigest: event.payload?.toolchainProjection?.projectionDigest ?? null }
      : event.kind === 'lifecycle.spawned' ? { pid: event.payload?.pid ?? null, modelObserved: event.payload?.modelObserved ?? null }
        : event.kind === 'resource.tokens' ? { tokens: event.payload?.tokens ?? null, usd: event.payload?.usd ?? null, accounting: event.payload?.accounting ?? null }
          : event.kind === 'verify.reverified' ? { accept: event.payload?.accept ?? false, observedExit: event.payload?.verdict?.observedExit ?? null, captureSha: event.payload?.capture?.sha ?? null, workerProjectionDigest: event.payload?.capture?.toolchainProjection?.projectionDigest ?? null, verifierProjectionDigest: event.payload?.capture?.verifierToolchainProjection?.projectionDigest ?? null }
            : ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(event.kind) ? { status: event.payload?.status ?? event.payload?.result?.status ?? null, reason: String(event.payload?.error ?? event.payload?.reason ?? '').slice(0, 512) }
              : ['lifecycle.process_started', 'lifecycle.process_closed'].includes(event.kind) ? { pid: event.payload?.pid ?? null, processGroupId: event.payload?.processGroupId ?? null, generation: event.payload?.generation ?? null, closeReason: event.payload?.closeReason ?? null } : {},
  }));
}

if (!existsSync(join(SOURCE_REPO, 'impl', 'node_modules'))) throw new Error('PENDING-LIVE-no-source-toolchain');
if (existsSync(join(TARGET_REPO, 'impl', 'node_modules'))) throw new Error('PENDING-LIVE-target-already-has-toolchain');
if (git(['status', '--porcelain']) !== '') throw new Error('PENDING-LIVE-target-must-be-clean');
if (!existsSync(GLM_AUTH)) throw new Error('PENDING-LIVE-no-project-glm-key');
if (!existsSync(CODEX_AUTH)) throw new Error('PENDING-LIVE-no-codex-auth');
mkdirSync(OUTPUT, { recursive: true });
for (const file of ['events.jsonl', 'summary.json', ...TASKS.map((task) => `${task.taskId}.md`)]) rmSync(join(OUTPUT, file), { force: true });
let grokModels = ''; let grokProbeError = null;
try { grokModels = execFileSync('grok', ['models'], { encoding: 'utf8' }).trim(); }
catch (error) { grokProbeError = String(error?.stderr ?? error?.message ?? error).slice(0, 1_200); }
const credentialMeasurements = { glm: credentialFact(GLM_AUTH), codex: credentialFact(CODEX_AUTH), grok: credentialFact(GROK_AUTH) };
const ownershipBefore = ownershipSnapshot();
const runtimeCredentialFiles = { codex: [CODEX_AUTH], ...(existsSync(GROK_AUTH) ? { grok: [GROK_AUTH] } : {}) };
const driver = createDriver({
  repoRoot: TARGET_REPO, logDir: LOG_DIR,
  adapters: {
    codex: new CodexAppServerCli({ requestTimeoutMs: 45_000, ceiling: 1 }),
    claude: new ClaudeSessionCli({ approvals: true, permissionMode: 'default', ceiling: 1 }),
    glm: new GlmSessionCli({ authTokenFile: GLM_AUTH, authTokenJsonPointer: process.env.BATON_GLM_AUTH_JSON_POINTER ?? '/glm_key', model: 'glm-4.7', approvals: false, permissionMode: 'acceptEdits', args: ['--safe-mode', '--no-session-persistence', '--max-budget-usd', '3.50'], ceiling: 1, killGraceMs: 5_000 }),
    grok: new GrokAcpCli({ requestTimeoutMs: 45_000, ceiling: 2 }),
  },
  runtimeIsolation: { credentialFiles: runtimeCredentialFiles }, toolchainProjection,
  approvalTimeoutMs: 60_000, stopDeadlineMs: 15_000, budgetPolicy: { terminalGraceMs: 2_000 }, watchdog: { stallMs: 720_000 },
});

const { coordinator, log } = driver;
const attempts = []; const rows = []; const responses = []; const kills = []; const simultaneousGrokSamples = [];
let pumping = true; let fatal = null; let closed = false;
const pump = (async () => {
  const consumed = new Set();
  while (pumping) {
    for (const worker of coordinator.list()) {
      const requestId = worker.pendingApprovalId ?? worker.pendingQuestionId;
      if (!requestId || consumed.has(requestId)) continue;
      consumed.add(requestId);
      responses.push({ workerId: worker.id, requestId, ack: await coordinator.respond(requestId, worker.pendingApprovalId ? { decision: 'allow' } : { text: 'Finish only the scoped report.' }, 'orchestrator') });
    }
    const active = rows.filter((row) => row.harness === 'grok').map((row) => {
      const events = log.read(row.workerId); const spawn = events.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker');
      const started = events.some((event) => event.kind === 'lifecycle.turn_started' && event.actor === 'worker');
      const terminal = events.some((event) => ['lifecycle.turn_completed', 'lifecycle.crashed', 'kill.confirmed'].includes(event.kind));
      const pid = spawn?.payload?.pid ?? null; return { taskId: row.taskId, workerId: row.workerId, pid, started, terminal, alive: alive(pid), groupAlive: groupAlive(pid) };
    });
    if (active.length === 2 && active.every((row) => row.pid && row.started && !row.terminal && row.alive && row.groupAlive)) simultaneousGrokSamples.push({ at: new Date().toISOString(), grok: active });
    await sleep(100);
  }
})();

try {
  const settled = await Promise.allSettled(TASKS.map(async (task) => {
    const handle = await coordinator.spawn(task.harness, brief(task), { taskId: task.taskId, taskType: TASK_TYPE, runId: RUN_ID, model: task.model, effort: 'low', modelPolicy: { allow: [task.model], allowFamilies: [task.family], reasoningEffort: 'low' } });
    const row = { ...task, workerId: handle.id, handle }; rows.push(row); return row;
  }));
  settled.forEach((result, index) => attempts.push({ taskId: TASKS[index].taskId, admitted: result.status === 'fulfilled', error: result.status === 'rejected' ? String(result.reason?.stack ?? result.reason).slice(0, 1_200) : null }));
  if (rows.length > 0) await Promise.all(rows.map((row) => until(async () => (await coordinator.result(row.workerId)).ready, `${row.taskId} terminal result`)));
  for (const row of rows) {
    row.result = await coordinator.result(row.workerId); row.events = log.read(row.workerId);
    row.spawn = row.events.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker') ?? null;
    row.processStarted = row.events.find((event) => event.kind === 'lifecycle.process_started') ?? null;
    row.processClosed = row.events.findLast((event) => event.kind === 'lifecycle.process_closed') ?? null;
    row.pid = row.spawn?.payload?.pid ?? row.processStarted?.payload?.pid ?? row.processClosed?.payload?.pid ?? null;
    row.ready = row.events.find((event) => event.kind === 'worktree.ready') ?? null; row.verify = row.events.findLast((event) => event.kind === 'verify.reverified') ?? null;
    const sha = row.verify?.payload?.capture?.sha;
    if (row.result.status === 'completed' && row.verify?.payload?.accept === true && sha) try { row.report = git(['show', `${sha}:${row.target}`]); } catch { row.report = null; }
  }
} catch (error) { fatal = String(error?.stack ?? error); }
finally {
  pumping = false; await pump.catch(() => {});
  for (const row of rows) {
    row.events = log.read(row.workerId); row.spawn ??= row.events.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker') ?? null;
    row.processStarted ??= row.events.find((event) => event.kind === 'lifecycle.process_started') ?? null;
    row.processClosed ??= row.events.findLast((event) => event.kind === 'lifecycle.process_closed') ?? null;
    row.pid ??= row.spawn?.payload?.pid ?? row.processStarted?.payload?.pid ?? row.processClosed?.payload?.pid ?? null; row.killFloorSeq = row.events.at(-1)?.seq ?? 0;
    try { kills.push({ taskId: row.taskId, floorSeq: row.killFloorSeq, ack: await coordinator.kill(row.workerId, 'policy') }); }
    catch (error) { kills.push({ taskId: row.taskId, error: String(error?.stack ?? error).slice(0, 1_200) }); }
  }
}

let reapWaitError = null;
try {
  await until(() => rows.every((row) => !alive(row.pid) && !existsSync(join(TARGET_REPO, '.baton', 'wt', row.taskId)) && !existsSync(join(TARGET_REPO, '.baton', 'wt', `${row.taskId}.meta.json`)) && !existsSync(join(TARGET_REPO, '.baton', 'wt', `${row.taskId}.projection.exclude`)) && !existsSync(join(TARGET_REPO, '.baton', 'runtime', row.workerId)) && git(['branch', '--list', `baton/${row.taskId}`]) === ''), 'all workers fully reaped', 45_000);
} catch (error) { reapWaitError = String(error?.stack ?? error); }
finally { try { closed = driver.close(); } catch (error) { fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n'); } }
if (reapWaitError) fatal = [fatal, reapWaitError].filter(Boolean).join('\n');

for (const row of rows) {
  row.events = log.read(row.workerId); row.handle = coordinator._publicHandle(coordinator._workers.get(row.workerId));
  row.processStarted = row.events.find((event) => event.kind === 'lifecycle.process_started') ?? row.processStarted ?? null;
  row.processClosed = row.events.findLast((event) => event.kind === 'lifecycle.process_closed') ?? row.processClosed ?? null;
  row.pid ??= row.processStarted?.payload?.pid ?? row.processClosed?.payload?.pid ?? null;
  row.killRequested = row.events.findLast((event) => event.kind === 'kill.requested') ?? null;
  row.killConfirmation = row.events.find((event) => event.seq > (row.killRequested?.seq ?? Number.MAX_SAFE_INTEGER) && event.kind === 'kill.confirmed') ?? null;
}
const exactRoute = (row) => {
  try { const tuple = JSON.parse(row.handle.routeKey); return Array.isArray(tuple) && tuple.length === 6 && `${tuple[0]}@${tuple[1]}` === row.handle.harnessResolved && tuple[2] === row.model && tuple[3] === 'low' && tuple[4] === row.family && tuple[5] === TASK_TYPE; }
  catch { return false; }
};
const routeAdmission = {
  allAttempted: attempts.length === TASKS.length, allAdmitted: attempts.length === TASKS.length && attempts.every((attempt) => attempt.admitted),
  exactRequestedResolved: rows.length === TASKS.length && rows.every((row) => row.handle.harnessRequested === row.harness && row.handle.modelRequested === row.model && row.handle.modelResolved === row.model && row.handle.effortRequested === 'low' && row.handle.effortResolved === 'low' && exactRoute(row)),
  observedIdentityHonest: rows.every((row) => (row.handle.modelObserved === null || row.handle.modelObserved === row.model) && (row.handle.effortObserved === null || row.handle.effortObserved === 'low')),
};
const killIsCorrelated = (row) => {
  const kill = kills.find((candidate) => candidate.taskId === row.taskId);
  return Boolean(row.pid && row.killRequested && row.killConfirmation && row.processClosed
    && ['confirmed', 'forced', 'already_dead'].includes(kill?.ack?.result));
};
const startedRows = rows.filter((row) => row.pid);
const grokRows = rows.filter((row) => row.harness === 'grok' && row.processStarted && row.processClosed);
const grokIntervalsOverlap = grokRows.length === 2
  && Date.parse(grokRows[0].processStarted.ts) <= Date.parse(grokRows[1].processClosed.ts)
  && Date.parse(grokRows[1].processStarted.ts) <= Date.parse(grokRows[0].processClosed.ts);
const providerProof = {
  providerReadyPidByTask: Object.fromEntries(TASKS.map((task) => [task.taskId, rows.find((row) => row.taskId === task.taskId)?.pid ?? null])),
  startedProcessCount: startedRows.length, simultaneousActiveGrokPidSampleObserved: simultaneousGrokSamples.length > 0,
  overlappingGrokProcessIntervalsObserved: grokIntervalsOverlap,
  correlatedKillByStartedTask: Object.fromEntries(startedRows.map((row) => [row.taskId, killIsCorrelated(row)])),
  everyStartedProcessKilled: startedRows.length > 0 && startedRows.every(killIsCorrelated), everyStartedProcessClosed: startedRows.every((row) => Boolean(row.processClosed)),
};
const ownershipAfter = ownershipSnapshot();
const cleanup = {
  observedProcessLeadersGone: startedRows.every((row) => !alive(row.pid)), observedProcessGroupsGone: startedRows.every((row) => !groupAlive(row.pid)),
  taskWorktreesGone: TASKS.every((task) => !existsSync(join(TARGET_REPO, '.baton', 'wt', task.taskId)) && !existsSync(join(TARGET_REPO, '.baton', 'wt', `${task.taskId}.meta.json`)) && !existsSync(join(TARGET_REPO, '.baton', 'wt', `${task.taskId}.projection.exclude`))),
  runtimesGone: rows.every((row) => !existsSync(join(TARGET_REPO, '.baton', 'runtime', row.workerId))), taskBranchesGone: TASKS.every((task) => git(['branch', '--list', `baton/${task.taskId}`]) === ''),
  projectionAbsentFromTarget: !existsSync(join(TARGET_REPO, 'impl', 'node_modules')), ownershipSnapshotRestored: same(ownershipAfter, ownershipBefore),
  writerReleased: closed && !existsSync(join(LOG_DIR, 'coordination', 'writer.lease')),
};
const projectionProof = {
  identity: projectionIdentity, noManualDependencyStage: true, targetDependencyAbsentBeforeAndAfter: cleanup.projectionAbsentFromTarget,
  allAdmittedWorkersBound: rows.length > 0 && rows.every((row) => same(row.ready?.payload?.toolchainProjection, projectionIdentity)),
  allFreshVerificationsBound: rows.filter((row) => row.verify).every((row) => same(row.verify.payload?.capture?.toolchainProjection, projectionIdentity) && same(row.verify.payload?.capture?.verifierToolchainProjection, projectionIdentity)),
  sourceRootAbsentFromEvents: rows.every((row) => !JSON.stringify(row.events).includes(SOURCE_REPO)),
};
const reportBinding = (row) => row.result?.status === 'completed' && row.verify?.payload?.accept === true && Boolean(row.report) && row.report.includes('## Verdict') && row.report.includes('## P0-P1 findings') && row.report.includes('## Required corrections');
const reviewProof = { allTerminal: rows.length === TASKS.length && rows.every((row) => row.result?.ready === true), verifiedReports: rows.filter(reportBinding).map((row) => row.taskId), exactBaseShaPreserved: git(['rev-parse', 'HEAD']) === BASE_SHA };
const lifecyclePass = fatal === null && routeAdmission.exactRequestedResolved && routeAdmission.observedIdentityHonest && providerProof.everyStartedProcessKilled && providerProof.everyStartedProcessClosed && Object.values(cleanup).every(Boolean);
const projectionPass = lifecyclePass && projectionProof.allAdmittedWorkersBound && projectionProof.allFreshVerificationsBound && projectionProof.sourceRootAbsentFromEvents && projectionProof.targetDependencyAbsentBeforeAndAfter;
const matrixPass = projectionPass && grokProbeError === null && grokModels.length > 0 && !grokModels.includes('not authenticated')
  && (providerProof.simultaneousActiveGrokPidSampleObserved || providerProof.overlappingGrokProcessIntervalsObserved)
  && reviewProof.verifiedReports.length > 0;
const summary = {
  at: new Date().toISOString(), sourceImplementationSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: SOURCE_REPO, encoding: 'utf8' }).trim(), targetBaseSha: BASE_SHA, targetHead: git(['rev-parse', 'HEAD']), runId: RUN_ID,
  interpretation: { lifecyclePass: 'exact route admission plus an explicit post-terminal kill acknowledgement, correlated kill/close evidence, and full ownership reap for every started provider process', projectionPass: 'lifecyclePass plus path-free identical projection binding in every admitted worker and fresh verification, with no dependency stage in the clean target', matrixPass: 'projectionPass plus authenticated overlapping two-Grok provider processes and at least one fresh-verified implementation report' },
  grokAuthProbe: { authenticated: grokProbeError === null && grokModels.length > 0 && !grokModels.includes('not authenticated'), output: grokModels, error: grokProbeError },
  credentialMeasurements, ownershipBefore, ownershipAfter, simultaneousGrokSamples, attempts,
  rows: rows.map((row) => ({ taskId: row.taskId, harness: row.harness, model: row.model, workerId: row.workerId, pid: row.pid, result: row.result ? { status: row.result.status, ready: row.result.ready } : null, route: { harnessRequested: row.handle.harnessRequested, harnessResolved: row.handle.harnessResolved, modelRequested: row.handle.modelRequested, modelResolved: row.handle.modelResolved, modelObserved: row.handle.modelObserved, effortRequested: row.handle.effortRequested, effortResolved: row.handle.effortResolved, effortObserved: row.handle.effortObserved }, budgetUsed: row.handle.budgetUsed, verifyAccept: row.verify?.payload?.accept ?? false, reportCaptured: Boolean(row.report), readyProjectionDigest: row.ready?.payload?.toolchainProjection?.projectionDigest ?? null, verifierProjectionDigest: row.verify?.payload?.capture?.verifierToolchainProjection?.projectionDigest ?? null, killRequestedSeq: row.killRequested?.seq ?? null, killConfirmationSeq: row.killConfirmation?.seq ?? null, processClosedSeq: row.processClosed?.seq ?? null, terminalReason: String(row.events.findLast((event) => ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(event.kind))?.payload?.error ?? '').slice(0, 512) })),
  responses, kills, routeAdmission, providerProof, cleanup, projectionProof, reviewProof, fatal, lifecyclePass, projectionPass, matrixPass,
};

writeFileSync(join(OUTPUT, 'events.jsonl'), `${rows.flatMap((row) => bounded(row.events).map((event) => JSON.stringify({ taskId: row.taskId, requestedHarness: row.harness, requestedModel: row.model, requestedEffort: 'low', ...event }))).join('\n')}\n`);
writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
for (const row of rows) if (row.report) writeFileSync(join(OUTPUT, `${row.taskId}.md`), row.report);
if (fatal === null) rmSync(LOG_DIR, { recursive: true, force: true });
console.log(JSON.stringify({ lifecyclePass, projectionPass, matrixPass, routeAdmission, providerProof, cleanup, projectionProof, reviewProof, fatal }, null, 2));
if (!matrixPass) process.exitCode = 1;
