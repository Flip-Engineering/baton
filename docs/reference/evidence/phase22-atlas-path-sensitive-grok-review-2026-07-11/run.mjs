#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrief, createDriver, GrokAcpCli } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.env.BATON_REPO ?? resolve(HERE, '../../../..'));
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? HERE);
const AUTH = join(homedir(), '.grok', 'auth.json');
const LOG_DIR = mkdtempSync(join(tmpdir(), 'baton-cpg-path-review-'));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const TASKS = [
  { taskId: 'grok-cpg-path-review-45', model: 'grok-4.5', path: 'reviews/dogfood/grok-cpg-path-review-45.md' },
  { taskId: 'grok-cpg-path-review-composer', model: 'grok-composer-2.5-fast', path: 'reviews/dogfood/grok-cpg-path-review-composer.md' },
];

async function until(fn, label, timeoutMs = 300000) {
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
    goal: `Independently review Baton's shipped Phase 18-20 CPG, delta/impact, and lexical taint implementation. Design the smallest honest next path-sensitive R3 vertical. Write ${task.path} with exact headings "## Verdict", "## Unsoundness and false-positive matrix", "## Numbered contract proposal", and "## Red tests". Ground every claim in current source/tests. Distinguish path feasibility from aliases, heap flow, implicit flow, interprocedural returns, exceptions, and dynamic dispatch. Identify any current-gate defect separately from new scope.`,
    constraints: [
      `Edit only ${task.path}.`,
      'Read spec/phase18 through phase20 plus the corresponding impl/src and impl/test files.',
      'Do not edit source, tests, specs, existing reviews, or evidence.',
      'Do not commit, push, deploy, access homelab, use network tools, or read credentials.',
      'Keep the report under 2200 words and propose deterministic bounded acceptance tests.',
    ],
    pathScope: [task.path],
    definitionOfDone: 'The four exact headings exist and the report separates shipped defects from the proposed path-sensitive increment',
    verification: { command: `test -s ${task.path} && grep -Fq '## Numbered contract proposal' ${task.path} && grep -Fq '## Red tests' ${task.path}`, expectExit: 0, timeoutMs: 10000 },
    budget: { tokens: 50000, usd: 3, wallMin: 8 },
  });
}

if (!existsSync(AUTH)) throw new Error('PENDING-LIVE-no-grok-auth-file');
const adapter = new GrokAcpCli({ requestTimeoutMs: 30000, ceiling: 2 });
const { coordinator, log } = createDriver({
  repoRoot: REPO,
  logDir: LOG_DIR,
  adapters: { grok: adapter },
  runtimeIsolation: { credentialFiles: { grok: [AUTH] } },
  approvalTimeoutMs: 60000,
  stopDeadlineMs: 15000,
  watchdog: { stallMs: 300000 },
});

const rows = [];
const approvals = [];
const stopResults = [];
let pumping = true;
let fatal = null;
const pump = (async () => {
  const consumed = new Set();
  while (pumping) {
    for (const worker of coordinator.list()) {
      const requestId = worker.pendingApprovalId ?? worker.pendingQuestionId;
      if (!requestId || consumed.has(requestId)) continue;
      consumed.add(requestId);
      const response = worker.pendingApprovalId ? { decision: 'allow' } : { text: 'Finish the scoped report-only review.' };
      approvals.push({ workerId: worker.id, requestId, ack: await coordinator.respond(requestId, response, 'human') });
    }
    await sleep(100);
  }
})();

try {
  const spawned = await Promise.all(TASKS.map(async (task) => {
    const handle = await coordinator.spawn('grok', brief(task), {
      taskId: task.taskId,
      taskType: 'adversarial-design-review',
      model: task.model,
      modelPolicy: { allow: [task.model], allowFamilies: ['grok'] },
    });
    const row = { ...task, workerId: handle.id };
    rows.push(row);
    return row;
  }));
  await Promise.all(spawned.map((row) => until(async () => (await coordinator.result(row.workerId)).ready, `${row.taskId} verified result`)));
  for (const row of spawned) {
    row.result = await coordinator.result(row.workerId);
    row.handle = coordinator.list().find((worker) => worker.id === row.workerId);
    const events = log.read(row.workerId);
    row.pid = events.find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker')?.payload?.pid ?? null;
    row.verify = events.find((event) => event.kind === 'verify.reverified') ?? null;
    const sha = row.verify?.payload?.capture?.sha;
    row.review = sha ? git(['show', `${sha}:${row.path}`]) : null;
    if (row.result.status !== 'completed') throw new Error(`${row.taskId} failed trust gate: ${JSON.stringify(row.result)}`);
  }
  stopResults.push(...await Promise.all(spawned.map(async (row) => ({ taskId: row.taskId, ack: await coordinator.kill(row.workerId, 'policy') }))));
  await until(() => spawned.every((row) => !alive(row.pid)
    && !existsSync(join(REPO, '.baton', 'wt', row.taskId))
    && !existsSync(join(REPO, '.baton', 'wt', `${row.taskId}.meta.json`))
    && !existsSync(join(REPO, '.baton', 'runtime', row.workerId))
    && git(['branch', '--list', `baton/${row.taskId}`]) === ''), 'both review workers fully reaped', 30000);
} catch (error) {
  fatal = String(error?.stack ?? error);
} finally {
  pumping = false;
  await pump.catch(() => {});
  for (const row of rows) await Promise.resolve(coordinator.kill(row.workerId, 'policy')).catch(() => {});
}

for (const row of rows) row.events = log.read(row.workerId);
const starts = rows.map((row) => row.events.find((event) => event.kind === 'lifecycle.turn_started' && event.actor === 'worker')).filter(Boolean);
const terminals = rows.map((row) => row.events.find((event) => ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(event.kind))).filter(Boolean);
const checks = {
  noHarnessError: fatal === null,
  twoReviews: rows.length === 2,
  distinctLivePids: new Set(rows.map((row) => row.pid).filter(Boolean)).size === 2,
  concurrentTurns: starts.length === 2 && terminals.length === 2 && Math.max(...starts.map((event) => Date.parse(event.ts))) <= Math.min(...terminals.map((event) => Date.parse(event.ts))),
  exactModelsObserved: rows.every((row) => row.handle?.modelRequested === row.model && row.handle?.modelResolved === row.model && row.handle?.modelObserved === row.model),
  bothFreshVerified: rows.every((row) => row.result?.status === 'completed' && row.verify?.payload?.accept === true),
  reportsCaptured: rows.every((row) => typeof row.review === 'string' && row.review.includes('## Numbered contract proposal') && row.review.includes('## Red tests')),
  bothKillsConfirmed: stopResults.length === 2 && stopResults.every((row) => ['confirmed', 'already_dead'].includes(row.ack?.result)),
  processesGone: rows.every((row) => row.pid == null || !alive(row.pid)),
  worktreesGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'wt', row.taskId))),
  runtimeGone: rows.every((row) => !existsSync(join(REPO, '.baton', 'runtime', row.workerId))),
  branchesGone: rows.every((row) => git(['branch', '--list', `baton/${row.taskId}`]) === ''),
};
const summary = { at: new Date().toISOString(), repoHead: git(['rev-parse', 'HEAD']), grokVersion: execFileSync('grok', ['--version'], { encoding: 'utf8' }).trim(), rows: rows.map(({ events, ...row }) => row), approvals, stopResults, checks, fatal, pass: Object.values(checks).every(Boolean) };
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(join(OUTPUT, 'events.jsonl'), rows.flatMap((row) => row.events.map((event) => JSON.stringify({ taskId: row.taskId, requestedModel: row.model, ...event }))).join('\n') + '\n');
writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
rmSync(LOG_DIR, { recursive: true, force: true });
console.log(JSON.stringify({ pass: summary.pass, checks, models: rows.map((row) => ({ requested: row.model, observed: row.handle?.modelObserved })), fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
