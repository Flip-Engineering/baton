#!/usr/bin/env node
// Provider-backed CI3 smoke: real Grok ACP child -> wall timeout -> policy reap.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBrief, createDriver, GrokAcpCli } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const TASK_ID = 'phase11-grok-timeout-reap';
const LOG_DIR = join(tmpdir(), `${TASK_ID}-${Date.now()}-log`);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function git(args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function until(fn, label, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label}`);
}

const adapter = new GrokAcpCli({ requestTimeoutMs: 30000, ceiling: 1 });
const { coordinator, log } = createDriver({
  repoRoot: REPO,
  logDir: LOG_DIR,
  adapters: { grok: adapter },
  stopDeadlineMs: 10000,
});

const brief = createBrief({
  goal: 'This is a lifecycle probe. First run the shell command `sleep 60`. Only after it returns, write reviews/dogfood/phase11-timeout-probe.md explaining that it finished.',
  constraints: [
    'Do not skip or shorten the sleep command.',
    'Edit only reviews/dogfood/phase11-timeout-probe.md.',
    'Do not commit, push, deploy, or use network access.',
  ],
  pathScope: ['reviews/dogfood/phase11-timeout-probe.md'],
  definitionOfDone: 'the sleep completed and the probe file exists',
  verification: { command: 'test -s reviews/dogfood/phase11-timeout-probe.md', expectExit: 0, timeoutMs: 5000 },
  budget: { tokens: 5000, usd: 1, wallMin: 0.1 },
});

let handle;
let pid;
let policyKill;
let fatal = null;

try {
  handle = await coordinator.spawn('grok', brief, { taskId: TASK_ID, taskType: 'lifecycle-probe' });
  const spawned = await until(
    () => log.read(handle.id).find((e) => e.kind === 'lifecycle.spawned' && e.actor === 'worker' && e.payload?.pid),
    'real Grok child spawn',
  );
  pid = spawned.payload.pid;
  await until(
    () => log.read(handle.id).find((e) => e.kind === 'lifecycle.turn_started' && e.actor === 'worker'),
    'real Grok turn start',
  );
  await until(
    () => log.read(handle.id).find((e) => e.kind === 'lifecycle.crashed' && e.payload?.phase === 'timeout'),
    'coordinator wall timeout',
  );
  await until(() => !pidAlive(pid), 'Grok process reap');
  policyKill = await coordinator.kill(handle.id, 'policy');
  await until(
    () => !existsSync(join(REPO, '.baton', 'wt', TASK_ID))
      && !existsSync(join(REPO, '.baton', 'wt', `${TASK_ID}.meta.json`))
      && git(['branch', '--list', `baton/${TASK_ID}`]) === '',
    'worktree, metadata, and branch reap',
  );
} catch (err) {
  fatal = String(err?.stack ?? err);
} finally {
  if (handle) await Promise.resolve(coordinator.kill(handle.id, 'policy')).catch(() => {});
}

const events = handle ? log.read(handle.id) : [];
const result = handle ? await coordinator.result(handle.id).catch(() => null) : null;
const checks = {
  noHarnessError: fatal === null,
  providerChildSpawned: Number.isInteger(pid) && pid > 0,
  providerTurnStarted: events.some((e) => e.kind === 'lifecycle.turn_started' && e.actor === 'worker'),
  oneTimeoutCrash: events.filter((e) => e.kind === 'lifecycle.crashed' && e.payload?.phase === 'timeout').length === 1,
  processGone: Number.isInteger(pid) && !pidAlive(pid),
  boundedPolicyKill: policyKill?.result === 'already_dead',
  taskFailedHonestly: result?.ready === true && result?.status === 'failed',
  worktreeGone: !existsSync(join(REPO, '.baton', 'wt', TASK_ID)),
  metadataGone: !existsSync(join(REPO, '.baton', 'wt', `${TASK_ID}.meta.json`)),
  branchGone: git(['branch', '--list', `baton/${TASK_ID}`]) === '',
};
const summary = {
  at: new Date().toISOString(),
  repoHead: git(['rev-parse', 'HEAD']),
  grokVersion: execFileSync('grok', ['--version'], { encoding: 'utf8' }).trim(),
  taskId: TASK_ID,
  workerId: handle?.id ?? null,
  pid: pid ?? null,
  policyKill,
  result,
  checks,
  fatal,
  pass: Object.values(checks).every(Boolean),
};

mkdirSync(HERE, { recursive: true });
writeFileSync(join(HERE, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''));
writeFileSync(join(HERE, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ pass: summary.pass, checks, pid, fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
