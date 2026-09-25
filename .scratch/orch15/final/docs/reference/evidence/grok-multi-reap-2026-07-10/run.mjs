#!/usr/bin/env node
// Real multi-Grok kill/reap stress. Runs one adapter instance at its four-session ceiling.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDriver, createBrief, GrokAcpCli } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const RUN_ID = `grok-multi-reap-${Date.now()}`;
const LOG_DIR = join(tmpdir(), `${RUN_ID}-log`);
const TASKS = Array.from({ length: 4 }, (_, i) => `grok-reap-${i + 1}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const adapter = new GrokAcpCli({ requestTimeoutMs: 30000, ceiling: 4 });
const { coordinator, log } = createDriver({
  repoRoot: REPO,
  logDir: LOG_DIR,
  adapters: { grok: adapter },
  approvalTimeoutMs: 60000,
  stopDeadlineMs: 20000,
});

function brief(taskId) {
  return createBrief({
    goal: `Read SYSTEM.md and every file in impl/src carefully, then draft reviews/dogfood/${taskId}.md with a detailed architecture review. Do not rush or skip files; this task will be stopped by the coordinator as a lifecycle test.`,
    constraints: [`Edit only reviews/dogfood/${taskId}.md.`, 'Do not commit or push.', 'Do not use network access.'],
    pathScope: [`reviews/dogfood/${taskId}.md`],
    definitionOfDone: 'the review file exists and is substantive',
    verification: { command: `test -s reviews/dogfood/${taskId}.md`, expectExit: 0, timeoutMs: 120000 },
    budget: { tokens: 30000, usd: 2, wallMin: 5 },
  });
}

async function waitFor(workerId, pred, label, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = log.read(workerId).find(pred);
    if (event) return event;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label} on ${workerId}`);
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitForCleanup(handles, pids, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listed = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: REPO, encoding: 'utf8' });
    const dirsGone = handles.every((h) => !existsSync(join(REPO, '.baton', 'wt', h.taskId)) && !listed.includes(h.taskId));
    const pidsGone = pids.every((pid) => !pidAlive(pid));
    if (dirsGone && pidsGone) return { dirsGone, pidsGone };
    await sleep(100);
  }
  const listed = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: REPO, encoding: 'utf8' });
  return {
    dirsGone: handles.every((h) => !existsSync(join(REPO, '.baton', 'wt', h.taskId)) && !listed.includes(h.taskId)),
    pidsGone: pids.every((pid) => !pidAlive(pid)),
  };
}

const handles = [];
const stopResults = [];
let fatal = null;

try {
  const spawned = await Promise.all(TASKS.map(async (taskId) => {
    const h = await coordinator.spawn('grok', brief(taskId), { taskId, taskType: 'reap-stress' });
    const row = { ...h, taskId };
    handles.push(row);
    return row;
  }));

  await Promise.all(spawned.map((h) => waitFor(
    h.id,
    (e) => e.kind === 'lifecycle.turn_started' && e.actor === 'worker',
    'real Grok turn start',
  )));
  await sleep(1200);

  const interrupted = spawned.slice(0, 2);
  const killed = spawned.slice(2);
  const interruptRows = await Promise.all(interrupted.map(async (h) => ({
    taskId: h.taskId,
    phase: 'interrupt',
    ack: await coordinator.interrupt(h.id, undefined, 'human'),
  })));
  const killRows = await Promise.all(killed.map(async (h) => ({
    taskId: h.taskId,
    phase: 'direct-kill',
    ack: await coordinator.kill(h.id, 'human'),
  })));
  stopResults.push(...interruptRows, ...killRows);

  const reapInterrupted = await Promise.all(interrupted.map(async (h) => ({
    taskId: h.taskId,
    phase: 'post-interrupt-kill',
    ack: await coordinator.kill(h.id, 'policy'),
  })));
  stopResults.push(...reapInterrupted);
} catch (err) {
  fatal = String(err?.stack ?? err);
} finally {
  for (const h of handles) await Promise.resolve(coordinator.kill(h.id, 'policy')).catch(() => {});
}

const events = handles.flatMap((h) => log.read(h.id).map((e) => ({ taskId: h.taskId, ...e })));
const spawnedEvents = events.filter((e) => e.kind === 'lifecycle.spawned' && e.actor === 'worker' && e.payload?.pid);
const pids = [...new Set(spawnedEvents.map((e) => e.payload.pid))];
const cleanup = await waitForCleanup(handles, pids);
const statuses = await Promise.all(handles.map(async (h) => ({ taskId: h.taskId, workerId: h.id, result: await coordinator.result(h.id) })));

const stressBranches = TASKS.map((taskId) => `baton/${taskId}`);
const presentBeforeDelete = stressBranches.filter((branch) => {
  try { execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: REPO }); return true; } catch { return false; }
});
const branchDeleteErrors = [];
for (const branch of presentBeforeDelete) {
  try { execFileSync('git', ['branch', '-D', branch], { cwd: REPO, stdio: 'ignore' }); }
  catch (err) { branchDeleteErrors.push({ branch, error: String(err?.message ?? err) }); }
}
const branchesGone = stressBranches.every((branch) => {
  try { execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: REPO }); return false; } catch { return true; }
});

const checks = {
  noHarnessError: fatal === null,
  fourDistinctLivePids: pids.length === 4,
  fourTurnsStartedBeforeStop: handles.length === 4 && handles.every((h) => events.some((e) => e.worker === h.id && e.kind === 'lifecycle.turn_started' && e.actor === 'worker')),
  twoInterruptsConfirmed: stopResults.filter((r) => r.phase === 'interrupt').length === 2 && stopResults.filter((r) => r.phase === 'interrupt').every((r) => r.ack?.result === 'confirmed'),
  fourKillsConfirmed: stopResults.filter((r) => ['direct-kill', 'post-interrupt-kill'].includes(r.phase)).length === 4 && stopResults.filter((r) => ['direct-kill', 'post-interrupt-kill'].includes(r.phase)).every((r) => r.ack?.result === 'confirmed' || r.ack?.result === 'already_dead'),
  allProcessesGone: cleanup.pidsGone,
  allWorktreesReaped: cleanup.dirsGone,
  allTasksTerminal: statuses.length === 4 && statuses.every((s) => s.result.ready),
  stressBranchesCleaned: branchesGone && branchDeleteErrors.length === 0,
};
const summary = {
  runId: RUN_ID,
  at: new Date().toISOString(),
  repoHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(),
  grokVersion: execFileSync('grok', ['--version'], { encoding: 'utf8' }).trim(),
  pids,
  stopResults,
  statuses,
  cleanup: { ...cleanup, stressBranches, presentBeforeDelete, branchDeleteErrors, branchesGone },
  checks,
  fatal,
  pass: Object.values(checks).every(Boolean),
};

mkdirSync(HERE, { recursive: true });
writeFileSync(join(HERE, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
writeFileSync(join(HERE, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ pass: summary.pass, checks, pids, fatal }, null, 2));
if (!summary.pass) process.exitCode = 1;
