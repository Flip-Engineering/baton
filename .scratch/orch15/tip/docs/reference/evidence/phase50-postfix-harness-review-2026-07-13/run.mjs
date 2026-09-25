#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CodexAppServerCli,
  GlmSessionCli,
  GrokAcpCli,
  createBrief,
  createDriver,
} from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.env.BATON_REPO ?? resolve(HERE, '../../../..'));
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? HERE);
const LOG_DIR = mkdtempSync(join(tmpdir(), 'baton-phase50-postfix-review-'));
const GLM_AUTH = resolve(process.env.BATON_GLM_AUTH_FILE ?? resolve(REPO, 'glm_key.json'));
const CODEX_AUTH = join(homedir(), '.codex', 'auth.json');
const GROK_AUTH = join(homedir(), '.grok', 'auth.json');
const RUN_ID = 'phase50-postfix-harness-review';
const BASE_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
const TASKS = [
  {
    taskId: 'phase50-postfix-codex-review', harness: 'codex', model: 'gpt-5.6-sol', family: 'openai',
    target: 'reviews/dogfood/phase50-postfix-codex-review.md', tokens: 160_000, usd: 3,
    focus: 'northbound token authority, exact request/reverify binding, prefix CAS, and cancellation linearization',
  },
  {
    taskId: 'phase50-postfix-glm-review', harness: 'glm', model: 'glm-4.7', family: 'glm',
    target: 'reviews/dogfood/phase50-postfix-glm-review.md', tokens: 140_000, usd: 1.25,
    focus: 'oracle provenance, exact route commitments, release/supersede/retract derivation, replay, and non-disclosure',
  },
  {
    taskId: 'phase50-postfix-grok45-review', harness: 'grok', model: 'grok-4.5', family: 'grok',
    target: 'reviews/dogfood/phase50-postfix-grok45-review.md', tokens: 90_000, usd: 2,
    focus: 'web/MCP task-plane parity, hub-derived Scratch identity, oracle non-integration, and kill/reap behavior',
  },
  {
    taskId: 'phase50-postfix-grokbuild-review', harness: 'grok', model: 'grok-build', family: 'grok',
    target: 'reviews/dogfood/phase50-postfix-grokbuild-review.md', tokens: 90_000, usd: 2,
    focus: 'independence, evidence substitution, exact contamination, bounds, restart tamper, and retained scope',
  },
];

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const alive = (pid) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const groupAlive = (pid) => {
  if (!pid) return false;
  try { process.kill(-pid, 0); return true; } catch { return false; }
};
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
function names(path) { return existsSync(path) ? readdirSync(path).sort() : []; }
function ownershipSnapshot() {
  return {
    worktrees: git(['worktree', 'list', '--porcelain']).split('\n').filter((line) => line.startsWith('worktree ')).sort(),
    branches: git(['branch', '--list', 'baton/*']).split('\n').map((line) => line.trim()).filter(Boolean).sort(),
    worktreeEntries: names(join(REPO, '.baton', 'wt')),
    runtimeEntries: names(join(REPO, '.baton', 'runtime')),
  };
}
function credentialFact(path) {
  try {
    const stat = statSync(path);
    return { present: stat.isFile(), ownerOnly: (stat.mode & 0o077) === 0, ownedByRunnerUser: typeof process.getuid !== 'function' || stat.uid === process.getuid() };
  } catch (error) { return { present: false, ownerOnly: false, ownedByRunnerUser: false, error: error.code ?? 'stat_failed' }; }
}
async function until(fn, label, timeoutMs = 1_200_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function brief(task) {
  return createBrief({
    goal: `Adversarially review committed Phase 50 implementation at ${BASE_SHA.slice(0, 7)}, focusing on ${task.focus}. Read spec/phase50/cairn-scratch-correction-oracle.md, impl/src/coordinator.mjs, impl/src/coordination-store.mjs, impl/src/cairn-run-scorecard.mjs, impl/src/northbound-capability-authority.mjs, impl/src/web-northbound.mjs, impl/src/mcp-northbound.mjs, and impl/test/phase50-cairn-scratch-correction.test.mjs. Write ${task.target} with exactly the headings "## Verdict", "## P0-P1 findings", and "## Required corrections".`,
    constraints: [
      `Edit only ${task.target}.`,
      'Keep the report under 1600 words and use at most 16 repository/tool calls.',
      'Ground every confirmed defect in exact current source and include a deterministic reproduction or contract violation.',
      'Treat absent later-scope features as retained work, not as an implementation defect.',
      'Do not inspect credentials or environment, use network tools, commit, push, deploy, or access homelab/project-manager.',
    ],
    pathScope: [task.target],
    definitionOfDone: 'All three headings exist and the verdict explicitly says PASS or REVISE.',
    verification: {
      command: `test -s ${task.target} && grep -Fq '## P0-P1 findings' ${task.target} && grep -Fq '## Required corrections' ${task.target}`,
      expectExit: 0,
      timeoutMs: 30_000,
    },
    budget: { tokens: task.tokens, usd: task.usd, wallMin: 18 },
  });
}

function terminalEvent(events) {
  return events.findLast((event) => ['lifecycle.turn_completed', 'lifecycle.crashed', 'kill.confirmed'].includes(event.kind)) ?? null;
}

function bounded(events) {
  const kinds = new Set([
    'runtime.scope_created', 'lifecycle.spawned', 'lifecycle.turn_started', 'lifecycle.turn_completed',
    'lifecycle.crashed', 'resource.tokens', 'resource.budget_threshold', 'verify.reverified',
    'kill.requested', 'kill.confirmed',
  ]);
  return events.filter((event) => kinds.has(event.kind)).map((event) => ({
    seq: event.seq,
    ts: event.ts,
    actor: event.actor,
    kind: event.kind,
    harnessRequested: event.harnessRequested ?? null,
    harnessResolved: event.harnessResolved ?? null,
    modelRequested: event.modelRequested ?? event.payload?.modelRequested ?? null,
    modelResolved: event.modelResolved ?? null,
    modelObserved: event.modelObserved ?? event.payload?.modelObserved ?? null,
    effortRequested: event.effortRequested ?? null,
    effortResolved: event.effortResolved ?? null,
    effortObserved: event.effortObserved ?? null,
    payload: event.kind === 'lifecycle.spawned'
      ? { pid: event.payload?.pid ?? null, modelObserved: event.payload?.modelObserved ?? null }
      : event.kind === 'resource.tokens'
        ? { tokens: event.payload?.tokens ?? null, usd: event.payload?.usd ?? null, accounting: event.payload?.accounting ?? null }
        : event.kind === 'verify.reverified'
          ? { accept: event.payload?.accept ?? false, observedExit: event.payload?.verdict?.observedExit ?? null, captureSha: event.payload?.capture?.sha ?? null }
          : ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(event.kind)
            ? { status: event.payload?.status ?? event.payload?.result?.status ?? null, reason: String(event.payload?.error ?? event.payload?.reason ?? '').slice(0, 512) }
            : {},
  }));
}

if (git(['status', '--porcelain']) !== '') throw new Error('PENDING-LIVE-review-host-must-be-clean');
if (!existsSync(GLM_AUTH)) throw new Error('PENDING-LIVE-no-project-glm-key');
if (!existsSync(CODEX_AUTH)) throw new Error('PENDING-LIVE-no-codex-auth');
if (!existsSync(GROK_AUTH)) throw new Error('PENDING-LIVE-no-grok-auth-file');
mkdirSync(OUTPUT, { recursive: true });
for (const file of ['events.jsonl', 'summary.json', ...TASKS.map((task) => `${task.taskId}.md`)]) rmSync(join(OUTPUT, file), { force: true });
let grokModels = ''; let grokAuthProbeError = null;
try { grokModels = execFileSync('grok', ['models'], { encoding: 'utf8' }).trim(); }
catch (error) { grokAuthProbeError = String(error?.stderr ?? error?.message ?? error).slice(0, 1200); }
const dependencies = existsSync(join(REPO, 'impl', 'node_modules')) ? ['impl/node_modules'] : [];
const ownershipBefore = ownershipSnapshot();
const credentialMeasurements = { glm: credentialFact(GLM_AUTH), codex: credentialFact(CODEX_AUTH), grok: credentialFact(GROK_AUTH) };
const driver = createDriver({
  repoRoot: REPO,
  logDir: LOG_DIR,
  adapters: {
    codex: new CodexAppServerCli({ requestTimeoutMs: 45_000, ceiling: 1 }),
    glm: new GlmSessionCli({
      authTokenFile: GLM_AUTH,
      authTokenJsonPointer: process.env.BATON_GLM_AUTH_JSON_POINTER ?? '/glm_key',
      model: 'glm-4.7',
      approvals: false,
      permissionMode: 'acceptEdits',
      args: ['--safe-mode', '--no-session-persistence', '--max-budget-usd', '1.25'],
      ceiling: 1,
      killGraceMs: 5_000,
    }),
    grok: new GrokAcpCli({ requestTimeoutMs: 45_000, ceiling: 2 }),
  },
  runtimeIsolation: { credentialFiles: { codex: [CODEX_AUTH], grok: [GROK_AUTH] } },
  workerDependencyDirs: dependencies,
  verifyDependencyDirs: dependencies,
  approvalTimeoutMs: 60_000,
  stopDeadlineMs: 15_000,
  watchdog: { stallMs: 720_000 },
});

const { coordinator, log } = driver;
const attempts = [];
const rows = [];
const responses = [];
const kills = [];
const nativeSamples = [];
let pumping = true;
let fatal = null;
let closed = false;
const pump = (async () => {
  const consumed = new Set();
  while (pumping) {
    for (const worker of coordinator.list()) {
      const requestId = worker.pendingApprovalId ?? worker.pendingQuestionId;
      if (!requestId || consumed.has(requestId)) continue;
      consumed.add(requestId);
      responses.push({
        workerId: worker.id,
        requestId,
        ack: await coordinator.respond(
          requestId,
          worker.pendingApprovalId ? { decision: 'allow' } : { text: 'Finish only the scoped report.' },
          'orchestrator',
        ),
      });
    }
    const grokActive = rows.filter((row) => row.harness === 'grok').map((row) => {
      const events = log.read(row.workerId); const spawn = events.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker');
      const started = events.some((event) => event.kind === 'lifecycle.turn_started' && event.actor === 'worker');
      const terminal = events.some((event) => ['lifecycle.turn_completed', 'lifecycle.crashed', 'lifecycle.exited', 'kill.confirmed'].includes(event.kind));
      const pid = spawn?.payload?.pid ?? null;
      return { taskId: row.taskId, workerId: row.workerId, pid, started, terminal, alive: alive(pid), groupAlive: groupAlive(pid) };
    });
    if (grokActive.length === 2 && grokActive.every((row) => row.pid && row.started && !row.terminal && row.alive && row.groupAlive)) nativeSamples.push({ at: new Date().toISOString(), grok: grokActive });
    await sleep(100);
  }
})();

try {
  const settled = await Promise.allSettled(TASKS.map(async (task) => {
    const handle = await coordinator.spawn(task.harness, brief(task), {
      taskId: task.taskId,
      taskType: 'phase50-scratch-correction-implementation-review',
      runId: RUN_ID,
      model: task.model,
      effort: 'low',
      modelPolicy: { allow: [task.model], allowFamilies: [task.family], reasoningEffort: 'low' },
    });
    const row = { ...task, workerId: handle.id, handle };
    rows.push(row);
    return row;
  }));
  settled.forEach((result, index) => attempts.push({
    taskId: TASKS[index].taskId,
    admitted: result.status === 'fulfilled',
    error: result.status === 'rejected' ? String(result.reason?.stack ?? result.reason).slice(0, 1200) : null,
  }));
  if (rows.length > 0) {
    await Promise.all(rows.map((row) => until(async () => (await coordinator.result(row.workerId)).ready, `${row.taskId} terminal result`)));
  }
  for (const row of rows) {
    row.result = await coordinator.result(row.workerId);
    row.events = log.read(row.workerId);
    row.spawn = row.events.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker') ?? null;
    row.pid = row.spawn?.payload?.pid ?? null;
    row.verify = row.events.findLast((event) => event.kind === 'verify.reverified') ?? null;
    const sha = row.verify?.payload?.capture?.sha;
    if (row.result.status === 'completed' && row.verify?.payload?.accept === true && sha) {
      try { row.report = git(['show', `${sha}:${row.target}`]); } catch { row.report = null; }
    }
  }
} catch (error) {
  fatal = String(error?.stack ?? error);
} finally {
  pumping = false;
  await pump.catch(() => {});
  for (const row of rows) {
    row.events = log.read(row.workerId);
    row.spawn ??= row.events.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker') ?? null;
    row.pid ??= row.spawn?.payload?.pid ?? null;
    row.killFloorSeq = row.events.at(-1)?.seq ?? 0;
    try { kills.push({ taskId: row.taskId, floorSeq: row.killFloorSeq, ack: await coordinator.kill(row.workerId, 'policy') }); }
    catch (error) { kills.push({ taskId: row.taskId, error: String(error?.stack ?? error) }); }
  }
}

let reapWaitError = null;
try {
  await until(() => rows.every((row) => (
    !alive(row.pid)
    && !existsSync(join(REPO, '.baton', 'wt', row.taskId))
    && !existsSync(join(REPO, '.baton', 'wt', `${row.taskId}.meta.json`))
    && !existsSync(join(REPO, '.baton', 'runtime', row.workerId))
    && git(['branch', '--list', `baton/${row.taskId}`]) === ''
  )), 'all workers fully reaped', 30_000);
} catch (error) {
  reapWaitError = String(error?.stack ?? error);
} finally {
  try { closed = driver.close(); }
  catch (error) { fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n'); }
}
if (reapWaitError) {
  try {
    await until(() => TASKS.every((task) => (
      !existsSync(join(REPO, '.baton', 'wt', task.taskId))
      && !existsSync(join(REPO, '.baton', 'wt', `${task.taskId}.meta.json`))
      && git(['branch', '--list', `baton/${task.taskId}`]) === ''
    )), 'post-close task ownership reap', 30_000);
  } catch (error) { fatal = [fatal, reapWaitError, String(error?.stack ?? error)].filter(Boolean).join('\n'); }
}

for (const row of rows) {
  row.events = log.read(row.workerId);
  row.handle = coordinator._publicHandle(coordinator._workers.get(row.workerId));
  row.terminal = terminalEvent(row.events);
  row.killRequested = row.events.find((event) => event.seq > row.killFloorSeq && event.kind === 'kill.requested') ?? null;
  row.killConfirmation = row.events.find((event) => event.seq > (row.killRequested?.seq ?? Number.MAX_SAFE_INTEGER) && event.kind === 'kill.confirmed') ?? null;
}
const grokRows = rows.filter((row) => row.harness === 'grok');
const coordinationRoot = join(LOG_DIR, 'coordination');
const exactRoute = (row) => {
  let tuple;
  try { tuple = JSON.parse(row.handle.routeKey); } catch { return false; }
  return Array.isArray(tuple) && tuple.length === 6
    && tuple.every((value) => typeof value === 'string')
    && `${tuple[0]}@${tuple[1]}` === row.handle.harnessResolved
    && tuple[2] === row.model && tuple[3] === 'low' && tuple[4] === row.family
    && tuple[5] === 'phase50-scratch-correction-implementation-review';
};
const routeAdmission = {
  allAttempted: attempts.length === TASKS.length,
  allAdmitted: attempts.length === TASKS.length && attempts.every((attempt) => attempt.admitted),
  exactRequestedResolved: rows.length === TASKS.length && rows.every((row) => (
    row.handle.harnessRequested === row.harness
    && row.handle.modelRequested === row.model
    && row.handle.modelResolved === row.model
    && row.handle.effortRequested === 'low'
    && row.handle.effortResolved === 'low'
    && exactRoute(row)
  )),
  observedIdentityHonest: rows.every((row) => (row.handle.modelObserved === null || row.handle.modelObserved === row.model) && (row.handle.effortObserved === null || row.handle.effortObserved === 'low')),
  glmProviderObservedExact: rows.find((row) => row.harness === 'glm')?.handle.modelObserved === 'glm-4.7',
};
const killIsCorrelated = (row) => {
  const kill = kills.find((candidate) => candidate.taskId === row.taskId);
  return Boolean(row.pid && row.killRequested && row.killConfirmation && ['confirmed', 'forced'].includes(kill?.ack?.result));
};
const providerProof = {
  providerReadyPidByTask: Object.fromEntries(TASKS.map((task) => [task.taskId, rows.find((row) => row.taskId === task.taskId)?.pid ?? null])),
  allProviderReadyPidsObserved: rows.length === TASKS.length && rows.every((row) => Boolean(row.pid)),
  twoGrokProviderReadyPidsObserved: grokRows.length === 2 && grokRows.every((row) => Boolean(row.pid)),
  simultaneousActiveGrokPidSampleObserved: nativeSamples.length > 0,
  correlatedKillByTask: Object.fromEntries(TASKS.map((task) => { const row = rows.find((candidate) => candidate.taskId === task.taskId); return [task.taskId, row ? killIsCorrelated(row) : false]; })),
  allProviderKillsCorrelated: rows.length === TASKS.length && rows.every(killIsCorrelated),
};
const ownershipAfter = ownershipSnapshot();
const cleanup = {
  observedProcessLeadersGone: rows.every((row) => !row.pid || !alive(row.pid)),
  observedProcessGroupsGone: rows.every((row) => !row.pid || !groupAlive(row.pid)),
  taskWorktreesGone: TASKS.every((task) => !existsSync(join(REPO, '.baton', 'wt', task.taskId)) && !existsSync(join(REPO, '.baton', 'wt', `${task.taskId}.meta.json`))),
  runtimesGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'runtime', row.workerId))),
  taskBranchesGone: TASKS.every((task) => git(['branch', '--list', `baton/${task.taskId}`]) === ''),
  ownershipSnapshotRestored: JSON.stringify(ownershipAfter) === JSON.stringify(ownershipBefore),
  writerReleased: closed
    && !existsSync(join(coordinationRoot, 'writer.lease'))
    && (!existsSync(coordinationRoot) || !readdirSync(coordinationRoot).some((name) => name.startsWith('writer.claim.'))),
};
function reportBinding(row) {
  const sha = row.verify?.payload?.capture?.sha;
  if (row.result?.status !== 'completed' || row.verify?.payload?.accept !== true || !sha || !row.report) return false;
  let ancestor = false; let changed = [];
  try { execFileSync('git', ['merge-base', '--is-ancestor', BASE_SHA, sha], { cwd: REPO }); ancestor = true; changed = git(['diff', '--name-only', `${BASE_SHA}..${sha}`]).split('\n').filter(Boolean); } catch { return false; }
  return ancestor && changed.length === 1 && changed[0] === row.target
    && row.report.includes('## Verdict') && row.report.includes('## P0-P1 findings') && row.report.includes('## Required corrections')
    && /## Verdict\s+[\s\S]{0,300}\b(PASS|REVISE)\b/.test(row.report);
}
const reviewProof = {
  allTerminal: rows.length === TASKS.length && rows.every((row) => row.result?.ready === true),
  verifiedReports: rows.filter(reportBinding).map((row) => row.taskId),
  baseShaPinned: git(['rev-parse', 'HEAD']) === BASE_SHA,
};
reviewProof.glmVerifiedReport = reviewProof.verifiedReports.includes('phase50-postfix-glm-review');
reviewProof.atLeastOneVerifiedReport = reviewProof.verifiedReports.length > 0;
const implementationReviewPass = fatal === null
  && routeAdmission.exactRequestedResolved
  && routeAdmission.observedIdentityHonest
  && routeAdmission.glmProviderObservedExact
  && reviewProof.glmVerifiedReport
  && reviewProof.baseShaPinned
  && Object.values(cleanup).every(Boolean);
const harnessMatrixPass = implementationReviewPass
  && providerProof.allProviderReadyPidsObserved
  && providerProof.simultaneousActiveGrokPidSampleObserved
  && providerProof.allProviderKillsCorrelated;

const summary = {
  at: new Date().toISOString(),
  baseSha: BASE_SHA,
  repoHead: git(['rev-parse', 'HEAD']),
  runId: RUN_ID,
  interpretation: {
    implementationReviewPass: 'exact routes plus a fresh-verified project-key GLM implementation report and complete cleanup',
    harnessMatrixPass: 'implementationReviewPass plus provider-ready PID observation for every route, one real-time sample with both Grok turns active and both process groups alive, and a correlated requested kill/confirmation for every route',
  },
  grokAuthProbe: { authenticated: grokAuthProbeError === null && grokModels.length > 0 && !grokModels.includes('not authenticated'), output: grokModels, error: grokAuthProbeError },
  credentialMeasurements,
  ownershipBefore,
  ownershipAfter,
  nativeSamples,
  attempts,
  rows: rows.map((row) => ({
    taskId: row.taskId,
    harness: row.harness,
    model: row.model,
    workerId: row.workerId,
    pid: row.pid,
    result: row.result ? { status: row.result.status, ready: row.result.ready } : null,
    route: {
      harnessRequested: row.handle.harnessRequested,
      harnessResolved: row.handle.harnessResolved,
      modelRequested: row.handle.modelRequested,
      modelResolved: row.handle.modelResolved,
      modelObserved: row.handle.modelObserved,
      effortRequested: row.handle.effortRequested,
      effortResolved: row.handle.effortResolved,
      effortObserved: row.handle.effortObserved,
    },
    budgetUsed: row.handle.budgetUsed,
    verifyAccept: row.verify?.payload?.accept ?? false,
    reportCaptured: Boolean(row.report),
    killRequestedSeq: row.killRequested?.seq ?? null,
    killConfirmationSeq: row.killConfirmation?.seq ?? null,
    terminalReason: String(row.events.findLast((event) => ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(event.kind))?.payload?.error ?? '').slice(0, 512),
  })),
  responses,
  kills,
  routeAdmission,
  providerProof,
  cleanup,
  reviewProof,
  fatal,
  implementationReviewPass,
  harnessMatrixPass,
};

writeFileSync(join(OUTPUT, 'events.jsonl'), `${rows.flatMap((row) => bounded(row.events).map((event) => JSON.stringify({
  taskId: row.taskId,
  requestedHarness: row.harness,
  requestedModel: row.model,
  requestedEffort: 'low',
  ...event,
}))).join('\n')}\n`);
writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
for (const row of rows) if (row.report) writeFileSync(join(OUTPUT, `${row.taskId}.md`), row.report);
if (fatal === null) rmSync(LOG_DIR, { recursive: true, force: true });
console.log(JSON.stringify({ implementationReviewPass, harnessMatrixPass, routeAdmission, providerProof, cleanup, reviewProof, fatal }, null, 2));
if (!harnessMatrixPass) process.exitCode = 1;
