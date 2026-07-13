#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CodexAppServerCli, GlmSessionCli, GrokAcpCli, createBrief, createDriver } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.env.BATON_REPO ?? resolve(HERE, '../../../..'));
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? HERE);
const LOG_DIR = mkdtempSync(join(tmpdir(), 'baton-phase51-review-'));
const GLM_AUTH = resolve(process.env.BATON_GLM_AUTH_FILE ?? resolve(REPO, 'glm_key.json'));
const CODEX_AUTH = join(homedir(), '.codex', 'auth.json');
const GROK_AUTH = join(homedir(), '.grok', 'auth.json');
function loginCommand(name, override) {
  if (override) return resolve(override);
  const output = execFileSync('/bin/zsh', ['-lic', `whence -p ${name}`], { encoding: 'utf8' });
  const candidates = output.split(/\r?\n/u)
    .map((line) => line.match(/(\/[^\u0007\u001b\r\n]+)$/u)?.[1] ?? null).filter(Boolean);
  const selected = candidates.at(-1);
  if (!selected || !existsSync(selected)) throw new Error(`login shell did not resolve ${name}`);
  return selected;
}
const CODEX_CMD = loginCommand('codex', process.env.BATON_CODEX_CMD);
const GROK_CMD = loginCommand('grok', process.env.BATON_GROK_CMD);
const CLAUDE_CMD = loginCommand('claude', process.env.BATON_CLAUDE_CMD);
const BASE_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
const RUN_ID = 'phase51-process-lifecycle-review';
const TASK_TYPE = 'phase51-process-lifecycle-implementation-review';
const TASKS = [
  { taskId: 'phase51-codex-review', harness: 'codex', model: 'gpt-5.6-sol', family: 'openai', target: 'reviews/dogfood/phase51-codex-review.md', tokens: 100_000, usd: 2.5, focus: 'generation and PID correlation, provider-ready ordering, replay, and exact kill confirmation' },
  { taskId: 'phase51-glm-review', harness: 'glm', model: 'glm-4.7', family: 'glm', target: 'reviews/dogfood/phase51-glm-review.md', tokens: 110_000, usd: 1.25, focus: 'cleanup and writer authority, poison/emergency behavior, non-disclosure, and bounded group reap' },
  { taskId: 'phase51-grok45-review', harness: 'grok', model: 'grok-4.5', family: 'grok', target: 'reviews/dogfood/phase51-grok45-review.md', tokens: 70_000, usd: 2, focus: 'Grok setup/authentication races, timeout first-cause, exact close, and repeated kill' },
  { taskId: 'phase51-grokbuild-review', harness: 'grok', model: 'grok-build', family: 'grok', target: 'reviews/dogfood/phase51-grokbuild-review.md', tokens: 70_000, usd: 2, focus: 'independent adversarial review of process descendants, forced disposition, recovery, and source attribution' },
];

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
const groupAlive = (pid) => { if (!pid) return false; try { process.kill(-pid, 0); return true; } catch { return false; } };
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const names = (path) => existsSync(path) ? readdirSync(path).sort() : [];
const processEvent = (events, kind) => events.find((event) => event.kind === kind && event.actor === 'worker') ?? null;

function ownershipSnapshot() {
  return {
    worktrees: git(['worktree', 'list', '--porcelain']).split('\n').filter((line) => line.startsWith('worktree ')).sort(),
    branches: git(['branch', '--list', 'baton/*']).split('\n').map((line) => line.trim()).filter(Boolean).sort(),
    worktreeEntries: names(join(REPO, '.baton', 'wt')),
    runtimeEntries: names(join(REPO, '.baton', 'runtime')),
  };
}

function credentialFact(path) {
  try { const stat = statSync(path); return { present: stat.isFile(), ownerOnly: (stat.mode & 0o077) === 0 }; }
  catch (error) { return { present: false, ownerOnly: false, error: error.code ?? 'stat_failed' }; }
}

async function until(fn, label, timeoutMs = 1_200_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function brief(task) {
  return createBrief({
    goal: `Adversarially review committed Baton Phase 51 at ${BASE_SHA.slice(0, 7)}, focusing on ${task.focus}. Read spec/phase51/pre-ready-process-lifecycle.md, impl/src/process-lifecycle.mjs, the four shipped session/CLI adapters, impl/src/coordinator.mjs, and impl/test/phase51-process-lifecycle.test.mjs. Write ${task.target} with exactly the headings "## Verdict", "## P0-P1 findings", and "## Required corrections".`,
    constraints: [
      `Edit only ${task.target}.`,
      'Keep the report under 1400 words and use at most 18 repository/tool calls.',
      'Ground confirmed defects in current source with a deterministic reproduction or violated contract.',
      'Do not inspect credentials/environment, use network tools, commit, push, deploy, or access homelab/project-manager.',
      'Treat later retained capabilities as future scope rather than Phase 51 defects.',
    ],
    pathScope: [task.target],
    definitionOfDone: 'The three headings exist and Verdict explicitly says PASS or REVISE.',
    verification: { command: `test -s ${task.target} && grep -Fq '## P0-P1 findings' ${task.target} && grep -Fq '## Required corrections' ${task.target}`, expectExit: 0, timeoutMs: 30_000 },
    budget: { tokens: task.tokens, usd: task.usd, wallMin: 16 },
  });
}

function bounded(events) {
  const allowed = new Set(['runtime.scope_created', 'lifecycle.process_started', 'lifecycle.process_ready', 'lifecycle.spawned', 'lifecycle.turn_started', 'lifecycle.turn_completed', 'lifecycle.process_closed', 'lifecycle.process_reap_unconfirmed', 'lifecycle.crashed', 'resource.tokens', 'verify.reverified', 'kill.requested', 'kill.confirmed', 'control.forced_stop']);
  return events.filter((event) => allowed.has(event.kind)).map((event) => ({
    seq: event.seq, ts: event.ts, actor: event.actor, kind: event.kind,
    harnessRequested: event.harnessRequested ?? null, harnessResolved: event.harnessResolved ?? null,
    modelRequested: event.modelRequested ?? event.payload?.modelRequested ?? null,
    modelResolved: event.modelResolved ?? null, modelObserved: event.modelObserved ?? event.payload?.modelObserved ?? null,
    effortRequested: event.effortRequested ?? null, effortResolved: event.effortResolved ?? null, effortObserved: event.effortObserved ?? null,
    payload: ['lifecycle.process_started', 'lifecycle.process_ready', 'lifecycle.process_closed'].includes(event.kind)
      ? event.payload
      : event.kind === 'lifecycle.spawned'
        ? { pid: event.payload?.pid ?? null, processGeneration: event.payload?.processGeneration ?? null, modelObserved: event.payload?.modelObserved ?? null }
        : event.kind === 'resource.tokens'
          ? { tokens: event.payload?.tokens ?? null, usd: event.payload?.usd ?? null, accounting: event.payload?.accounting ?? null }
          : event.kind === 'verify.reverified'
            ? { accept: event.payload?.accept ?? false, observedExit: event.payload?.verdict?.observedExit ?? null, captureSha: event.payload?.capture?.sha ?? null }
            : ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(event.kind)
              ? { status: event.payload?.status ?? event.payload?.result?.status ?? null, reason: String(event.payload?.error ?? event.payload?.reason ?? '').slice(0, 512) }
              : {},
  }));
}

if (git(['status', '--porcelain']) !== '') throw new Error('review host must be clean');
for (const path of [GLM_AUTH, CODEX_AUTH, GROK_AUTH]) if (!existsSync(path)) throw new Error(`missing credential file: ${path}`);
mkdirSync(OUTPUT, { recursive: true });
for (const file of ['events.jsonl', 'summary.json', ...TASKS.map((task) => `${task.taskId}.md`)]) rmSync(join(OUTPUT, file), { force: true });

let grokModels = ''; let grokAuthError = null;
try { grokModels = execFileSync(GROK_CMD, ['models'], { encoding: 'utf8' }).trim(); }
catch (error) { grokAuthError = String(error?.stderr ?? error?.message ?? error).slice(0, 800); }
const ownershipBefore = ownershipSnapshot();
const credentials = { glm: credentialFact(GLM_AUTH), codex: credentialFact(CODEX_AUTH), grok: credentialFact(GROK_AUTH) };
const dependencies = existsSync(join(REPO, 'impl', 'node_modules')) ? ['impl/node_modules'] : [];
const driver = createDriver({
  repoRoot: REPO, logDir: LOG_DIR,
  adapters: {
    codex: new CodexAppServerCli({ cmd: CODEX_CMD, requestTimeoutMs: 45_000, ceiling: 1 }),
    glm: new GlmSessionCli({ cmd: CLAUDE_CMD, authTokenFile: GLM_AUTH, authTokenJsonPointer: process.env.BATON_GLM_AUTH_JSON_POINTER ?? '/glm_key', model: 'glm-4.7', approvals: false, permissionMode: 'acceptEdits', args: ['--safe-mode', '--no-session-persistence', '--max-budget-usd', '1.25'], ceiling: 1, killGraceMs: 5_000 }),
    grok: new GrokAcpCli({ cmd: GROK_CMD, requestTimeoutMs: 45_000, ceiling: 2 }),
  },
  runtimeIsolation: { credentialFiles: { codex: [CODEX_AUTH], grok: [GROK_AUTH] } },
  workerDependencyDirs: dependencies, verifyDependencyDirs: dependencies,
  approvalTimeoutMs: 60_000, stopDeadlineMs: 15_000, watchdog: { stallMs: 600_000 },
});

const { coordinator, log } = driver;
const rows = []; const attempts = []; const responses = []; const kills = []; const overlapSamples = [];
let pumping = true; let fatal = null; let closed = false;
const pump = (async () => {
  const consumed = new Set();
  while (pumping) {
    for (const worker of coordinator.list()) {
      const requestId = worker.pendingApprovalId ?? worker.pendingQuestionId;
      if (requestId && !consumed.has(requestId)) {
        consumed.add(requestId);
        responses.push({ workerId: worker.id, requestId, ack: await coordinator.respond(requestId, worker.pendingApprovalId ? { decision: 'allow' } : { text: 'Finish only the scoped report.' }, 'orchestrator') });
      }
    }
    const groks = rows.filter((row) => row.harness === 'grok').map((row) => {
      const events = log.read(row.workerId); const started = processEvent(events, 'lifecycle.process_started'); const closedEvent = processEvent(events, 'lifecycle.process_closed'); const pid = started?.payload?.pid ?? null;
      return { taskId: row.taskId, workerId: row.workerId, pid, closed: Boolean(closedEvent), leaderAlive: alive(pid), groupAlive: groupAlive(pid) };
    });
    if (groks.length === 2 && groks.every((row) => row.pid && !row.closed && row.leaderAlive && row.groupAlive)) overlapSamples.push({ at: new Date().toISOString(), grok: groks });
    await sleep(25);
  }
})();

try {
  const admitted = await Promise.allSettled(TASKS.map(async (task) => {
    const handle = await coordinator.spawn(task.harness, brief(task), { taskId: task.taskId, taskType: TASK_TYPE, runId: RUN_ID, model: task.model, effort: 'low', modelPolicy: { allow: [task.model], allowFamilies: [task.family], reasoningEffort: 'low' } });
    const row = { ...task, workerId: handle.id, handle }; rows.push(row); return row;
  }));
  admitted.forEach((result, index) => attempts.push({ taskId: TASKS[index].taskId, admitted: result.status === 'fulfilled', error: result.status === 'rejected' ? String(result.reason?.stack ?? result.reason).slice(0, 1200) : null }));
  await Promise.all(rows.map((row) => until(async () => (await coordinator.result(row.workerId)).ready, `${row.taskId} result`)));
  for (const row of rows) {
    row.result = await coordinator.result(row.workerId); row.events = log.read(row.workerId); row.verify = row.events.findLast((event) => event.kind === 'verify.reverified') ?? null;
    const sha = row.verify?.payload?.capture?.sha;
    if (row.result.status === 'completed' && row.verify?.payload?.accept === true && sha) { try { row.report = git(['show', `${sha}:${row.target}`]); } catch { row.report = null; } }
  }
} catch (error) { fatal = String(error?.stack ?? error); }
finally {
  pumping = false; await pump.catch(() => {});
  for (const row of rows) {
    row.events = log.read(row.workerId); row.killFloorSeq = row.events.at(-1)?.seq ?? 0;
    try { kills.push({ taskId: row.taskId, floorSeq: row.killFloorSeq, ack: await coordinator.kill(row.workerId, 'policy') }); }
    catch (error) { kills.push({ taskId: row.taskId, error: String(error?.stack ?? error).slice(0, 1200) }); }
  }
}

try {
  await until(() => rows.every((row) => {
    const events = log.read(row.workerId); const started = processEvent(events, 'lifecycle.process_started'); const pid = started?.payload?.pid;
    return (!pid || (!alive(pid) && !groupAlive(pid))) && !existsSync(join(REPO, '.baton', 'wt', row.taskId)) && !existsSync(join(REPO, '.baton', 'runtime', row.workerId)) && git(['branch', '--list', `baton/${row.taskId}`]) === '';
  }), 'complete process and resource reap', 45_000);
  closed = driver.close();
} catch (error) { fatal = [fatal, String(error?.stack ?? error)].filter(Boolean).join('\n'); }

for (const row of rows) {
  row.events = log.read(row.workerId); row.handle = coordinator._publicHandle(coordinator._workers.get(row.workerId));
  row.processStarted = processEvent(row.events, 'lifecycle.process_started'); row.processClosed = processEvent(row.events, 'lifecycle.process_closed');
  row.providerReady = row.events.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker') ?? null;
  row.killRequested = row.events.find((event) => event.seq > row.killFloorSeq && event.kind === 'kill.requested') ?? null;
  row.killConfirmed = row.events.find((event) => event.seq > (row.killRequested?.seq ?? Number.MAX_SAFE_INTEGER) && event.kind === 'kill.confirmed') ?? null;
}

const exactRoute = (row) => {
  try { const tuple = JSON.parse(row.handle.routeKey); return Array.isArray(tuple) && tuple[2] === row.model && tuple[3] === 'low' && tuple[4] === row.family && tuple[5] === TASK_TYPE; }
  catch { return false; }
};
const routeProof = {
  allAdmitted: attempts.length === TASKS.length && attempts.every((attempt) => attempt.admitted),
  exactHarnessModelEffort: rows.length === TASKS.length && rows.every((row) => row.handle.harnessRequested === row.harness && row.handle.modelRequested === row.model && row.handle.modelResolved === row.model && row.handle.effortRequested === 'low' && row.handle.effortResolved === 'low' && exactRoute(row)),
  observationsHonest: rows.every((row) => (row.handle.modelObserved === null || row.handle.modelObserved === row.model) && (row.handle.effortObserved === null || row.handle.effortObserved === 'low')),
};
const processProof = {
  startedPidByTask: Object.fromEntries(TASKS.map((task) => [task.taskId, rows.find((row) => row.taskId === task.taskId)?.processStarted?.payload?.pid ?? null])),
  providerReadyByTask: Object.fromEntries(TASKS.map((task) => [task.taskId, Boolean(rows.find((row) => row.taskId === task.taskId)?.providerReady)])),
  exactCloseByTask: Object.fromEntries(TASKS.map((task) => { const row = rows.find((candidate) => candidate.taskId === task.taskId); return [task.taskId, Boolean(row?.processStarted && row?.processClosed && row.processStarted.payload.generation === row.processClosed.payload.generation && row.processStarted.payload.pid === row.processClosed.payload.pid)]; })),
  concurrentGrokProcessGroupsObserved: overlapSamples.length > 0,
  explicitKillConfirmedByTask: Object.fromEntries(TASKS.map((task) => { const row = rows.find((candidate) => candidate.taskId === task.taskId); return [task.taskId, Boolean(row?.killRequested && row?.killConfirmed)]; })),
};
const ownershipAfter = ownershipSnapshot();
const cleanup = {
  leadersGone: rows.every((row) => !row.processStarted?.payload?.pid || !alive(row.processStarted.payload.pid)),
  groupsGone: rows.every((row) => !row.processStarted?.payload?.processGroupId || !groupAlive(row.processStarted.payload.processGroupId)),
  taskWorktreesGone: TASKS.every((task) => !existsSync(join(REPO, '.baton', 'wt', task.taskId))),
  runtimesGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'runtime', row.workerId))),
  taskBranchesGone: TASKS.every((task) => git(['branch', '--list', `baton/${task.taskId}`]) === ''),
  ownershipSnapshotRestored: JSON.stringify(ownershipAfter) === JSON.stringify(ownershipBefore),
  writerReleased: closed && !existsSync(join(LOG_DIR, 'coordination', 'writer.lease')),
};
const reportBinding = (row) => Boolean(row.report && row.verify?.payload?.accept === true && row.report.includes('## Verdict') && row.report.includes('## P0-P1 findings') && row.report.includes('## Required corrections'));
const reviewProof = { verifiedReports: rows.filter(reportBinding).map((row) => row.taskId), baseShaPinned: git(['rev-parse', 'HEAD']) === BASE_SHA };
const implementationReviewPass = fatal === null && routeProof.exactHarnessModelEffort && routeProof.observationsHonest && reviewProof.verifiedReports.includes('phase51-glm-review') && Object.values(cleanup).every(Boolean);
const harnessMatrixPass = implementationReviewPass && rows.length === TASKS.length
  && rows.every((row) => row.processStarted && row.providerReady && row.processClosed)
  && processProof.concurrentGrokProcessGroupsObserved
  && Object.values(processProof.explicitKillConfirmedByTask).some(Boolean);

const summary = {
  at: new Date().toISOString(), baseSha: BASE_SHA, repoHead: git(['rev-parse', 'HEAD']), runId: RUN_ID,
  tooling: {
    codexVersion: execFileSync(CODEX_CMD, ['--version'], { encoding: 'utf8' }).trim(),
    grokVersion: execFileSync(GROK_CMD, ['--version'], { encoding: 'utf8' }).trim(),
    claudeVersion: execFileSync(CLAUDE_CMD, ['--version'], { encoding: 'utf8' }).trim(),
    executableSelection: 'absolute paths resolved through the logged-in shell',
  },
  interpretation: { implementationReviewPass: 'exact route attribution, at least the project-key GLM report freshly verified, and complete cleanup', harnessMatrixPass: 'implementationReviewPass plus provider readiness and exact start/close for every route, at least one explicit confirmed kill, and one simultaneous two-Grok live-group sample' },
  grokAuthProbe: { authenticated: grokAuthError === null && grokModels.length > 0 && !grokModels.includes('not authenticated'), output: grokModels, error: grokAuthError },
  credentials, ownershipBefore, ownershipAfter, overlapSamples, attempts,
  rows: rows.map((row) => ({ taskId: row.taskId, harness: row.harness, model: row.model, workerId: row.workerId, processStarted: row.processStarted?.payload ?? null, providerReady: Boolean(row.providerReady), processClosed: row.processClosed?.payload ?? null, result: row.result ? { ready: row.result.ready, status: row.result.status } : null, route: { harnessRequested: row.handle.harnessRequested, harnessResolved: row.handle.harnessResolved, modelRequested: row.handle.modelRequested, modelResolved: row.handle.modelResolved, modelObserved: row.handle.modelObserved, effortRequested: row.handle.effortRequested, effortResolved: row.handle.effortResolved, effortObserved: row.handle.effortObserved }, budgetUsed: row.handle.budgetUsed, verifyAccept: row.verify?.payload?.accept ?? false, reportCaptured: Boolean(row.report), killRequestedSeq: row.killRequested?.seq ?? null, killConfirmedSeq: row.killConfirmed?.seq ?? null, terminalReason: String(row.events.findLast((event) => event.kind === 'lifecycle.crashed')?.payload?.error ?? '').slice(0, 512) })),
  responses, kills, routeProof, processProof, cleanup, reviewProof, fatal, implementationReviewPass, harnessMatrixPass,
};

writeFileSync(join(OUTPUT, 'events.jsonl'), `${rows.flatMap((row) => bounded(row.events).map((event) => JSON.stringify({ taskId: row.taskId, requestedHarness: row.harness, requestedModel: row.model, requestedEffort: 'low', ...event }))).join('\n')}\n`);
writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
for (const row of rows) if (row.report) writeFileSync(join(OUTPUT, `${row.taskId}.md`), row.report);
if (fatal === null) rmSync(LOG_DIR, { recursive: true, force: true });
console.log(JSON.stringify({ implementationReviewPass, harnessMatrixPass, routeProof, processProof, cleanup, reviewProof, grokAuthProbe: summary.grokAuthProbe, fatal }, null, 2));
if (!harnessMatrixPass) process.exitCode = 1;
