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
const LOG_DIR = join(tmpdir(), `baton-web-stream-hardening-${Date.now()}`);
const TASK_ID = 'codex-web-stream-hardening';
const MODEL = 'gpt-5.6-sol';
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
  repoRoot: REPO,
  logDir: LOG_DIR,
  adapters: { codex: adapter },
  runtimeIsolation: { credentialFiles: { codex: [AUTH] } },
  verifyDependencyDirs: ['impl/node_modules'],
  approvalTimeoutMs: 60_000,
  stopDeadlineMs: 15_000,
  budgetPolicy: { terminalGraceMs: 2_000 },
  watchdog: { stallMs: 240_000 },
});
const TARGETS = [
  'impl/src/web-stream.mjs',
  'impl/src/web-northbound.mjs',
  'impl/src/coordination-store.mjs',
  'impl/test/phase12-web-stream.test.mjs',
  'impl/test/phase12-web-northbound.test.mjs',
  'impl/test/phase11-coordination-store.test.mjs',
];
const brief = createBrief({
  goal: 'Adversarially harden the accepted WN6 SSE vertical to the newly pinned Phase 12 contract. Make ticket and connection audit ordering fail closed; prune and cap ticket state; cap active connections; reject multi-repository relabeling over one coordination authority; bound the initial snapshot before headers; preserve a separately bounded lag control frame; distinguish authoritative event ordering from claimed/derived/mixed content trust; and make sequential coordination replay proportional to returned events. Add red-first regression tests for every seam and HTTP adapter integration where useful.',
  constraints: [
    `Edit only: ${TARGETS.join(', ')}.`,
    'Use Node built-ins only; no new dependencies.',
    'Preserve exact origin/session/credential/repository binding, stable cursors, at-least-once reconnect, no-store CORS, and browser-disconnect-without-fleet-control semantics.',
    'A ticket is not live until its issuance audit commits; no SSE success headers or snapshot bytes precede the connection audit.',
    'Never emit an initial frame larger than the configured data ceiling and never allow lag metadata to be unbounded.',
    'A single unpartitioned CoordinationStore cannot be relabeled as multiple repoIds.',
    'Trust metadata must preserve the difference between authoritative event occurrence and claimed, derived, or mixed content.',
    'Do not add homelab/deployment integration.',
    'Do not commit, push, or use network tools.',
    'Ground implementation in spec/phase12/authenticated-web-northbound.md WN1/WN2/WN5/WN6/WN7/WN9.',
  ],
  pathScope: TARGETS,
  definitionOfDone: 'Pinned tests prove fail-closed audit ordering, no live ticket on audit failure, ticket pruning/ceilings, active connection ceiling, one-repo authority, bounded initial snapshot/control lag, content trust framing, ordered reconnect, and disconnect/reap non-effects',
  verification: {
    command: 'node --test impl/test/phase12-web-stream.test.mjs impl/test/phase12-web-northbound.test.mjs impl/test/phase12-web-auth.test.mjs impl/test/phase11-coordination-store.test.mjs',
    expectExit: 0,
    timeoutMs: 120_000,
  },
  budget: { tokens: 400_000, usd: 4, wallMin: 10 },
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
      approvals.push({ id, response: await coordinator.respond(id, worker.pendingApprovalId ? { decision: 'allow' } : { text: 'Proceed within the pinned hardening scope.' }, 'human') });
    }
    if (workerId && !steer && log.read(workerId).some((event) => event.kind === 'resource.budget_threshold' && event.payload?.threshold >= 0.8)) {
      steer = await coordinator.send(workerId, 'Budget steer: finish the red-first hardening tests and scoped implementation, run only the pinned verification, then return.', 'steer', { actor: 'orchestrator' });
    }
    await sleep(100);
  }
})();

try {
  const handle = await coordinator.spawn('codex', brief, {
    taskId: TASK_ID,
    taskType: 'implementation',
    model: MODEL,
    modelPolicy: { allow: [MODEL], allowFamilies: ['openai'], reasoningEffort: 'low' },
  });
  workerId = handle.id;
  const spawned = await until(() => log.read(workerId).find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker'), 'native spawn');
  pid = spawned.payload?.pid ?? null;
  await until(async () => (await coordinator.result(workerId)).ready, 'verified hardening');
  result = await coordinator.result(workerId);
  if (result.status !== 'completed') throw new Error(`hardening failed trust gate: ${JSON.stringify(result)}`);
  integration = await coordinator.integrate(workerId, { strategy: 'ff-only', actor: 'orchestrator' });
} catch (error) {
  fatal = String(error?.stack ?? error);
} finally {
  pumping = false;
  await pump.catch(() => {});
  if (workerId) await Promise.resolve(coordinator.kill(workerId, 'policy')).catch(() => {});
  if (workerId) {
    try {
      await until(() => (!pid || !alive(pid))
        && !existsSync(join(REPO, '.baton', 'wt', TASK_ID))
        && !existsSync(join(REPO, '.baton', 'runtime', workerId))
        && git(['branch', '--list', `baton/${TASK_ID}`]) === '', 'full reap', 30_000);
    } catch (error) {
      fatal = `${fatal ?? ''}\ncleanup:${error?.stack ?? error}`.trim();
    }
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
  killConfirmed: events.some((event) => event.kind === 'kill.confirmed'),
  processGone: !!pid && !alive(pid),
  worktreeGone: !existsSync(join(REPO, '.baton', 'wt', TASK_ID)),
  runtimeGone: workerId ? !existsSync(join(REPO, '.baton', 'runtime', workerId)) : false,
  branchGone: git(['branch', '--list', `baton/${TASK_ID}`]) === '',
};
const summary = {
  at: new Date().toISOString(), repoHead: git(['rev-parse', 'HEAD']), workerId, pid, model: MODEL,
  result, integration, approvals, steer, checks, fatal, pass: Object.values(checks).every(Boolean),
};
mkdirSync(HERE, { recursive: true });
writeFileSync(join(HERE, 'events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''));
writeFileSync(join(HERE, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ pass: summary.pass, checks, pid, fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
