// Issue #40: an abnormally killed run-suite (SIGKILL-class parent death — harness task-stop,
// OOM, crash) runs no cleanup handler, so its detached test group kept working headless and its
// baton-suite-* temp root leaked (91MiB observed live on a disk with ~300MiB free). These
// contracts pin the two halves of the repair: a dead-owner sweeper that reclaims exactly the
// roots whose recorded owner process is gone, and an orphan watchdog that makes the detached
// child terminate itself once its parent disappears.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { sweepStaleSuiteRoots, writeSuiteOwnerReceipt } from '../scripts/suite-hygiene.mjs';

function deadPid() {
  // A real, provably dead pid: spawn a trivial process and wait for it to exit.
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  assert.equal(child.status, 0);
  return child.pid;
}

test('SH1 (#40): the sweeper removes exactly the suite roots whose recorded owner is dead', (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'baton-hygiene-parent-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));

  const dead = join(parent, 'baton-suite-dead01');
  const alive = join(parent, 'baton-suite-alive1');
  const unowned = join(parent, 'baton-suite-noown1');
  const foreign = join(parent, 'not-a-suite-root');
  for (const dir of [dead, alive, unowned, foreign]) mkdirSync(dir);
  writeFileSync(join(dead, 'residue.txt'), 'leaked bytes');

  writeSuiteOwnerReceipt(dead);
  const receipt = JSON.parse(readFileSync(join(dead, 'suite-owner.json'), 'utf8'));
  assert.equal(receipt.pid, process.pid, 'the receipt records the writing owner');
  writeFileSync(join(dead, 'suite-owner.json'), JSON.stringify({ ...receipt, pid: deadPid() }));

  writeSuiteOwnerReceipt(alive); // owner: this live test process
  writeFileSync(join(unowned, 'suite-owner.json'), 'not json at all');

  const swept = sweepStaleSuiteRoots(parent);
  assert.deepEqual(swept, [dead], 'exactly the dead-owner root is reclaimed');
  assert.equal(existsSync(dead), false);
  assert.equal(existsSync(alive), true, 'a live owner is never swept');
  assert.equal(existsSync(unowned), true, 'an unreadable receipt is never treated as proof of death');
  assert.equal(existsSync(foreign), true, 'non-suite directories are untouchable');
});

test('SH2 (#40): the sweeper tolerates a missing parent directory and an empty one', (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'baton-hygiene-empty-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  assert.deepEqual(sweepStaleSuiteRoots(join(parent, 'never-created')), []);
  assert.deepEqual(sweepStaleSuiteRoots(parent), []);
});

test('SH3 (#40): a watchdog-armed child terminates itself after its parent dies unhandled', async (t) => {
  const watchdog = new URL('../scripts/suite-orphan-watchdog.mjs', import.meta.url).href;
  // parent -> child chain: the parent starts a watchdog-armed child that would otherwise idle
  // forever, prints the child pid, and then idles. SIGKILL on the parent (no handlers run, the
  // exact leak shape) must leave the child self-terminating via the watchdog.
  const parentSource = `
    import { spawn } from 'node:child_process';
    const child = spawn(process.execPath, [
      '--import', ${JSON.stringify(watchdog)}, '-e', 'setInterval(() => {}, 1000);',
    ], { stdio: 'ignore', env: {
      ...process.env, BATON_SUITE_WATCHDOG: '1', BATON_SUITE_WATCHDOG_POLL_MS: '100',
      BATON_SUITE_WATCHDOG_PPID: String(process.pid),
    } });
    console.log(String(child.pid));
    // Hold until the child proves it armed with a live parent, then idle: SH3 pins the
    // orphaned-AFTER-boot shape, so the kill must land after arming (SH4 pins the boot race).
    setInterval(() => {}, 1000);
  `;
  const parent = spawn(process.execPath, ['-e', parentSource], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => { try { parent.kill('SIGKILL'); } catch {} });

  const childPid = await new Promise((resolvePid, rejectPid) => {
    let buffer = '';
    parent.stdout.on('data', (chunk) => {
      buffer += chunk;
      const line = buffer.split('\n')[0];
      if (line && /^\d+$/.test(line.trim())) resolvePid(Number(line.trim()));
    });
    parent.once('close', () => rejectPid(new Error('parent exited before reporting its child pid')));
  });
  t.after(() => { try { process.kill(childPid, 'SIGKILL'); } catch {} });

  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  assert.equal(alive(childPid), true, 'the child idles while its parent lives');

  // Let the child finish booting and arm against its live parent before the parent dies —
  // killing earlier exercises the SH4 boot-race shape instead of this one.
  await new Promise((resolveSettle) => setTimeout(resolveSettle, 750));
  parent.kill('SIGKILL');
  const deadline = Date.now() + 10_000;
  while (alive(childPid) && Date.now() < deadline) {
    await new Promise((resolveTick) => setTimeout(resolveTick, 50));
  }
  assert.equal(alive(childPid), false, 'the orphaned child reaps itself without any parent cleanup');
});

test('SH4 (#40): a child orphaned before its watchdog can even arm still reaps itself (the boot race)', async (t) => {
  const watchdog = new URL('../scripts/suite-orphan-watchdog.mjs', import.meta.url).href;
  // The parent spawns the watchdog-armed child and SIGKILLs itself IMMEDIATELY — the child is
  // still booting, so by the time the watchdog module loads, ppid is already the reaper and a
  // change-only watchdog would idle forever (the exact failure this contract was written red
  // against). BATON_SUITE_WATCHDOG_PPID names the intended parent, making boot orphanhood
  // detectable at arm time.
  const parentSource = `
    import { spawn } from 'node:child_process';
    const child = spawn(process.execPath, [
      '--import', ${JSON.stringify(watchdog)}, '-e', 'setInterval(() => {}, 1000);',
    ], { stdio: 'ignore', env: {
      ...process.env, BATON_SUITE_WATCHDOG: '1', BATON_SUITE_WATCHDOG_POLL_MS: '100',
      BATON_SUITE_WATCHDOG_PPID: String(process.pid),
    } });
    console.log(String(child.pid));
    process.kill(process.pid, 'SIGKILL');
  `;
  const parent = spawn(process.execPath, ['-e', parentSource], { stdio: ['ignore', 'pipe', 'inherit'] });
  const childPid = await new Promise((resolvePid, rejectPid) => {
    let buffer = '';
    parent.stdout.on('data', (chunk) => {
      buffer += chunk;
      const line = buffer.split('\n')[0];
      if (line && /^\d+$/.test(line.trim())) resolvePid(Number(line.trim()));
    });
    parent.once('close', () => rejectPid(new Error('parent exited before reporting its child pid')));
  });
  t.after(() => { try { process.kill(childPid, 'SIGKILL'); } catch {} });

  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const deadline = Date.now() + 10_000;
  while (alive(childPid) && Date.now() < deadline) {
    await new Promise((resolveTick) => setTimeout(resolveTick, 50));
  }
  assert.equal(alive(childPid), false, 'boot-orphaned children terminate at arm time, not never');
});
