import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBrief, createDriver, GrokAcpCli } from '../src/index.mjs';

const FAKE_GROK = fileURLToPath(new URL('./fixtures/fake-grok-acp.mjs', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function until(fn, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(10);
  }
  throw new Error(`timeout waiting for ${label}`);
}

test('CK9: two Grok ACP processes run concurrently, confirm kill, and are fully reaped', async (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'baton-two-grok-repo-'));
  const logDir = mkdtempSync(join(tmpdir(), 'baton-two-grok-log-'));
  t.after(() => {
    try { rmSync(repo, { recursive: true, force: true }); } catch {}
    try { rmSync(logDir, { recursive: true, force: true }); } catch {}
  });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'baton-test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Baton Test'], { cwd: repo });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'base'], { cwd: repo });

  const adapter = new GrokAcpCli({
    cmd: process.execPath,
    args: [FAKE_GROK, '--serve'],
    requestTimeoutMs: 1000,
    ceiling: 2,
    versionProbe: () => '0.1.216-fake',
  });
  const { coordinator, coordination, log } = createDriver({
    repoRoot: repo,
    logDir,
    adapters: { grok: adapter },
    stopDeadlineMs: 1000,
    watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
  });
  const brief = (id) => createBrief({
    goal: `FAKE:STAY_OPEN concurrent lifecycle probe ${id}`,
    constraints: ['Do not edit files.'],
    pathScope: [],
    definitionOfDone: 'the coordinator stops this deliberately open turn',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 1000, usd: 1, wallMin: 1 },
  });

  const taskIds = ['two-grok-a', 'two-grok-b'];
  const handles = await Promise.all(taskIds.map((taskId) => coordinator.spawn('grok', brief(taskId), { taskId, taskType: 'reap-test' })));
  await until(() => handles.every((handle) => log.read(handle.id).some((event) => event.kind === 'lifecycle.turn_started' && event.actor === 'worker')), 'both Grok turns');
  const pids = handles.map((handle) => log.read(handle.id).find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker')?.payload?.pid);
  assert.equal(new Set(pids).size, 2);
  assert.equal(pids.every((pid) => Number.isInteger(pid) && pidAlive(pid)), true);

  const stopped = await Promise.all(handles.map((handle) => coordinator.kill(handle.id, 'human')));
  assert.equal(stopped.every((ack) => ack.result === 'confirmed'), true);
  await until(() => pids.every((pid) => !pidAlive(pid))
    && taskIds.every((taskId) => !existsSync(join(repo, '.baton', 'wt', taskId))
      && execFileSync('git', ['branch', '--list', `baton/${taskId}`], { cwd: repo, encoding: 'utf8' }).trim() === ''), 'process/worktree/branch reap');

  const results = await Promise.all(handles.map((handle) => coordinator.result(handle.id)));
  assert.equal(results.every((result) => result.ready && result.status === 'cancelled'), true);
  assert.deepEqual(taskIds.map((taskId) => coordination.task(taskId).status), ['cancelled', 'cancelled']);
  assert.equal(handles.every((handle) => log.read(handle.id).filter((event) => event.kind === 'kill.confirmed').length === 1), true);
});
