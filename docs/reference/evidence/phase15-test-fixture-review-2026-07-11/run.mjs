#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CodexAppServerCli, createBrief, createDriver } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const AUTH = join(homedir(), '.codex', 'auth.json');
const LOG_DIR = mkdtempSync(join(tmpdir(), 'baton-tf-review-log-'));
const TASK_ID = 'codex-test-fixture-review';
const MODEL = 'gpt-5.6-sol';
const EFFORT = 'low';
const REPORT = 'docs/reference/evidence/phase15-test-fixture-review-2026-07-11/review.md';
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function until(fn, label, timeoutMs = 700000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label}`);
}

if (!existsSync(AUTH)) throw new Error('PENDING-LIVE-no-codex-auth-file');
const adapter = new CodexAppServerCli({ requestTimeoutMs: 30000, ceiling: 1 });
const { coordinator, log } = createDriver({
  repoRoot: REPO,
  logDir: LOG_DIR,
  adapters: { codex: adapter },
  runtimeIsolation: { credentialFiles: { codex: [AUTH] } },
  workerDependencyDirs: ['impl/node_modules'],
  verifyDependencyDirs: ['impl/node_modules'],
  approvalTimeoutMs: 60000,
  stopDeadlineMs: 15000,
  watchdog: { stallMs: 300000 },
});
const brief = createBrief({
  goal: 'Independently adversarially review TF1-TF4. Trace suite-root confinement, pass/fail/spawn/signal truth, leader-versus-process-group reap, TERM/KILL timing, cleanup failure behavior, Node discovery, cross-platform ceilings, and canonical npm integration. Write exact severity/source/failure/regression findings or explicitly none.',
  constraints: [
    `Write only ${REPORT}.`,
    'Review the Phase 15 spec, package scripts, run-suite implementation, and test-runner contracts; do not read prior evidence logs.',
    'Separate explicit SIGKILL/startup-reconciliation future scope from defects in claimed observable terminal paths.',
    'No source edits, commit, network, homelab, or fleet actions.',
  ],
  pathScope: [REPORT],
  definitionOfDone: 'Every TF1-TF4 lifecycle seam is reviewed with actionable findings or an explicit clean verdict',
  verification: {
    command: `test -s ${REPORT} && npm --prefix impl test -- test/test-runner.test.mjs`,
    expectExit: 0,
    timeoutMs: 240000,
  },
  budget: { tokens: 300000, usd: 5, wallMin: 10 },
});

let workerId = null;
let pid = null;
let result = null;
let integration = null;
let fatal = null;
let pumping = true;
const pump = (async () => {
  const seen = new Set();
  while (pumping) {
    for (const worker of coordinator.list()) {
      const requestId = worker.pendingApprovalId ?? worker.pendingQuestionId;
      if (!requestId || seen.has(requestId)) continue;
      seen.add(requestId);
      const answer = worker.pendingApprovalId
        ? { decision: 'allow' }
        : { text: 'Finish the report-only TF1-TF4 review.' };
      await coordinator.respond(requestId, answer, 'human');
    }
    await sleep(100);
  }
})();

try {
  const handle = await coordinator.spawn('codex', brief, {
    taskId: TASK_ID,
    taskType: 'review',
    model: MODEL,
    effort: EFFORT,
    modelPolicy: { allow: [MODEL], allowFamilies: ['openai'] },
  });
  workerId = handle.id;
  const spawned = await until(
    () => log.read(workerId).find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker'),
    'worker spawn',
  );
  pid = spawned.payload?.pid ?? null;
  await until(async () => (await coordinator.result(workerId)).ready, 'review result');
  result = await coordinator.result(workerId);
  if (result.status !== 'completed') throw new Error(`review failed ${JSON.stringify(result)}`);
  integration = await coordinator.integrate(workerId, { strategy: 'ff-only', actor: 'orchestrator' });
} catch (error) {
  fatal = String(error?.stack ?? error);
} finally {
  pumping = false;
  await pump.catch(() => {});
  if (workerId) await Promise.resolve(coordinator.kill(workerId, 'policy')).catch(() => {});
  if (workerId) {
    try {
      await until(
        () => (!pid || !alive(pid))
          && !existsSync(join(REPO, '.baton', 'wt', TASK_ID))
          && !existsSync(join(REPO, '.baton', 'runtime', workerId))
          && git(['branch', '--list', `baton/${TASK_ID}`]) === '',
        'complete reap',
        30000,
      );
    } catch (error) {
      fatal = `${fatal ?? ''}\ncleanup:${error?.stack ?? error}`.trim();
    }
  }
}

const events = workerId ? log.read(workerId) : [];
const handle = workerId ? coordinator.list().find((worker) => worker.id === workerId) : null;
const card = `${adapter.card().harness}@${adapter.card().version}`;
const checks = {
  noHarnessError: fatal === null,
  exactTupleHonest: handle?.harnessResolved === card
    && handle?.modelRequested === MODEL
    && handle?.modelResolved === MODEL
    && handle?.modelObserved === MODEL
    && handle?.effortRequested === EFFORT
    && handle?.effortResolved === EFFORT
    && (handle?.effortObserved == null || handle?.effortObserved === EFFORT),
  freshVerified: result?.status === 'completed'
    && events.some((event) => event.kind === 'verify.reverified' && event.payload?.accept === true),
  integrated: integration?.ok === true,
  integrationIntent: events.some((event) => event.kind === 'integration.completed'),
  killConfirmed: events.some((event) => event.kind === 'kill.confirmed'),
  processGone: pid == null || !alive(pid),
  worktreeGone: !existsSync(join(REPO, '.baton', 'wt', TASK_ID)),
  runtimeGone: workerId ? !existsSync(join(REPO, '.baton', 'runtime', workerId)) : false,
  branchGone: git(['branch', '--list', `baton/${TASK_ID}`]) === '',
};
const summary = {
  at: new Date().toISOString(), workerId, pid, result, integration, checks, fatal,
  pass: Object.values(checks).every(Boolean),
};
mkdirSync(HERE, { recursive: true });
writeFileSync(join(HERE, 'events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''));
writeFileSync(join(HERE, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
rmSync(LOG_DIR, { recursive: true, force: true });
console.log(JSON.stringify({ pass: summary.pass, checks, fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
