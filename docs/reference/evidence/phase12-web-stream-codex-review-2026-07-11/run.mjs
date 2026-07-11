#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexAppServerCli, createBrief, createDriver } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const AUTH = join(homedir(), '.codex', 'auth.json');
const LOG_DIR = join(tmpdir(), `baton-web-stream-review-${Date.now()}`);
const TASK_ID = 'codex-web-stream-review';
const MODEL = 'gpt-5.6-sol';
const REPORT = 'docs/reference/evidence/phase12-web-stream-codex-review-2026-07-11/review.md';
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(fn, label, timeout = 600_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(100); }
  throw new Error(`timeout waiting for ${label}`);
}

if (!existsSync(AUTH)) throw new Error('PENDING-LIVE-no-codex-auth-file');
const adapter = new CodexAppServerCli({ requestTimeoutMs: 30_000, ceiling: 1 });
const { coordinator, log } = createDriver({
  repoRoot: REPO, logDir: LOG_DIR, adapters: { codex: adapter },
  runtimeIsolation: { credentialFiles: { codex: [AUTH] } },
  workerDependencyDirs: ['impl/node_modules'],
  verifyDependencyDirs: ['impl/node_modules'], approvalTimeoutMs: 60_000, stopDeadlineMs: 15_000,
  budgetPolicy: { terminalGraceMs: 2_000 }, watchdog: { stallMs: 240_000 },
});
const brief = createBrief({
  goal: 'Perform an independent adversarial review of the current authenticated WN6 SSE vertical after the WN6-1 live-expiry/revocation correction. Trace HTTP authentication and CORS into ticket issue/consume, snapshot/reconnect cursor semantics, replay retention, audit failure ordering, repository scope, trust/provenance framing, backpressure and setup failure, authorization lifetime, timer/connection cleanup, and coordination-store interaction. Look for CSRF/IDOR/replay/confused-deputy/token leakage/privilege escalation/DoS seams and test false positives. Write a concise but exhaustive report with severity, exact source locations, exploit/failure sequence, and missing regression. If no actionable findings remain, say so explicitly and list residual Phase 12 scope that is not a WN6 defect.',
  constraints: [
    `Write only ${REPORT}; do not edit source, tests, specs, or other evidence.`,
    'Review actual current files and tests, not only prior reports.',
    'Limit review reads to spec/phase12/authenticated-web-northbound.md, impl/src/web-{stream,northbound,auth}.mjs, impl/src/coordination-store.mjs, and their Phase 11/12 tests; do not scan prior evidence logs.',
    'Treat authoritative event occurrence separately from payload claim grounding.',
    'Do not add homelab/deployment integration.',
    'Do not commit, push, or use network tools.',
    'Do not call the review independent across vendors; this is an independent turn on the same Codex model family.',
  ],
  pathScope: [REPORT],
  definitionOfDone: 'Review artifact covers all named trust seams, identifies actionable findings with precise evidence or explicitly reports none, and separates residual WN2/WN5/WN8/WN9 work from WN6 defects',
  verification: {
    command: `test -s ${REPORT} && node --test impl/test/phase12-web-stream.test.mjs impl/test/phase12-web-northbound.test.mjs impl/test/phase12-web-auth.test.mjs impl/test/phase11-coordination-store.test.mjs`,
    expectExit: 0, timeoutMs: 120_000,
  },
  budget: { tokens: 450_000, usd: 4, wallMin: 8 },
});

let workerId = null; let pid = null; let result = null; let integration = null;
let fatal = null; let pumping = true; let steer = null; const approvals = [];
const pump = (async () => {
  const seen = new Set();
  while (pumping) {
    for (const worker of coordinator.list()) {
      const id = worker.pendingApprovalId ?? worker.pendingQuestionId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      approvals.push({ id, response: await coordinator.respond(id, worker.pendingApprovalId ? { decision: 'allow' } : { text: 'Complete the scoped report-only review.' }, 'human') });
    }
    if (workerId && !steer && log.read(workerId).some((event) => event.kind === 'resource.budget_threshold' && event.payload?.threshold >= 0.8)) {
      steer = await coordinator.send(workerId, 'Budget steer: stop exploring, finish the evidence-backed report, run the pinned verification, then return.', 'steer', { actor: 'orchestrator' });
    }
    await sleep(100);
  }
})();

try {
  const handle = await coordinator.spawn('codex', brief, {
    taskId: TASK_ID, taskType: 'review', model: MODEL,
    modelPolicy: { allow: [MODEL], allowFamilies: ['openai'], reasoningEffort: 'low' },
  });
  workerId = handle.id;
  const spawned = await until(() => log.read(workerId).find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker'), 'native spawn');
  pid = spawned.payload?.pid ?? null;
  await until(async () => (await coordinator.result(workerId)).ready, 'verified review');
  result = await coordinator.result(workerId);
  if (result.status !== 'completed') throw new Error(`review failed trust gate: ${JSON.stringify(result)}`);
  integration = await coordinator.integrate(workerId, { strategy: 'ff-only', actor: 'orchestrator' });
} catch (error) {
  fatal = String(error?.stack ?? error);
} finally {
  pumping = false; await pump.catch(() => {});
  if (workerId) await Promise.resolve(coordinator.kill(workerId, 'policy')).catch(() => {});
  if (workerId) {
    try {
      await until(() => (!pid || !alive(pid))
        && !existsSync(join(REPO, '.baton', 'wt', TASK_ID))
        && !existsSync(join(REPO, '.baton', 'runtime', workerId))
        && git(['branch', '--list', `baton/${TASK_ID}`]) === '', 'full reap', 30_000);
    } catch (error) { fatal = `${fatal ?? ''}\ncleanup:${error?.stack ?? error}`.trim(); }
  }
}

const events = workerId ? log.read(workerId) : [];
const handle = workerId ? coordinator.list().find((worker) => worker.id === workerId) : null;
const checks = {
  noHarnessError: fatal === null,
  exactModelObserved: handle?.modelRequested === MODEL && handle?.modelResolved === MODEL && handle?.modelObserved === MODEL,
  freshVerified: result?.status === 'completed' && events.some((event) => event.kind === 'verify.reverified' && event.payload?.accept === true),
  integrated: integration?.ok === true,
  integrationIntent: events.some((event) => event.kind === 'integration.completed'),
  killConfirmed: events.some((event) => event.kind === 'kill.confirmed'), processGone: !!pid && !alive(pid),
  worktreeGone: !existsSync(join(REPO, '.baton', 'wt', TASK_ID)),
  runtimeGone: workerId ? !existsSync(join(REPO, '.baton', 'runtime', workerId)) : false,
  branchGone: git(['branch', '--list', `baton/${TASK_ID}`]) === '',
};
const summary = { at: new Date().toISOString(), repoHead: git(['rev-parse', 'HEAD']), workerId, pid, model: MODEL, result, integration, approvals, steer, checks, fatal, pass: Object.values(checks).every(Boolean) };
mkdirSync(HERE, { recursive: true });
writeFileSync(join(HERE, 'events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''));
writeFileSync(join(HERE, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ pass: summary.pass, checks, pid, fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
