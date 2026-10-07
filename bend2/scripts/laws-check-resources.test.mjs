import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import {
  aggregateProcessGroup,
  createProcessGroupSampler,
  parseDarwinProcessSnapshot,
  parseLinuxProcStat,
  parseLinuxProcStatus,
  parseProcessCpuTime,
} from './laws-check-resources.mjs';

function statFixture({ pid = 321, command = 'fixture ) with spaces', processGroup = 77, userTicks = 120, systemTicks = 34 } = {}) {
  const fields = Array(22).fill('0');
  fields[0] = 'S';
  fields[1] = '1';
  fields[2] = String(processGroup);
  fields[11] = String(userTicks);
  fields[12] = String(systemTicks);
  return `${pid} (${command}) ${fields.join(' ')}`;
}

test('Linux stat parsing uses the final command delimiter and CPU tick fields', () => {
  assert.deepEqual(parseLinuxProcStat(statFixture()), {
    pid: 321, processGroup: 77, cpuTicks: 154,
  });
});

test('Linux stat parsing retains a negative process-group sentinel for later filtering', () => {
  assert.deepEqual(parseLinuxProcStat(statFixture({ processGroup: -1 })), {
    pid: 321, processGroup: -1, cpuTicks: 154,
  });
});

test('Linux RSS parsing converts KiB to bytes and treats absent VmRSS as zero', () => {
  assert.equal(parseLinuxProcStatus('Name: fixture\nVmRSS: 1536 kB\n', 42), 1_572_864);
  assert.equal(parseLinuxProcStatus('Name: kernel-thread\n', 43), 0);
});

test('process CPU time parsing preserves seconds across Darwin ps formats', () => {
  assert.equal(parseProcessCpuTime('00:00.75'), 0.75);
  assert.equal(parseProcessCpuTime('218:08.33'), 13_088.33);
  assert.equal(parseProcessCpuTime('89:17.92'), 5_357.92);
  assert.equal(parseProcessCpuTime('02:03:04.50'), 7_384.5);
  assert.equal(parseProcessCpuTime('1-02:03:04.50'), 93_784.5);
  for (const value of ['', '1::02', ':00', '1:02:', '-1:02.00', '1.5-00:00:00',
    '1:2.5:03', '1:60:00', '1-24:00:00', '1:02:-3', '1:02:03.x']) {
    assert.throws(() => parseProcessCpuTime(value), /invalid process CPU time/);
  }
});

test('Darwin ps snapshots parse units and aggregate only the requested process group', () => {
  const rows = parseDarwinProcessSnapshot([
    '101 50 12 00:00.30',
    '102 50 24 00:01.20',
    '201 60 900 4-00:00:00.00',
    '302 60 800 218:08.33',
  ].join('\n'));
  assert.deepEqual(aggregateProcessGroup(rows, 50), {
    rssBytes: 36 * 1024,
    cpuSecondsByPid: new Map([[101, 0.3], [102, 1.2]]),
    processCount: 2,
  });
  assert.equal(aggregateProcessGroup(rows, 70).processCount, 0);
  assert.throws(() => parseDarwinProcessSnapshot('101 50 12'), /malformed Darwin ps row/);
});

test('one timer snapshot serves every tracked process group', async () => {
  let snapshots = 0;
  const sampledGroups = [];
  const sampler = createProcessGroupSampler({
    intervalMs: 20,
    snapshotProvider: (groups) => {
      snapshots += 1;
      sampledGroups.push([...groups].sort((left, right) => left - right));
      return [
        { pid: 10, processGroup: 10, rssBytes: 100, cpuSeconds: 1 },
        { pid: 11, processGroup: 10, rssBytes: 200, cpuSeconds: 2 },
        { pid: 20, processGroup: 20, rssBytes: 300, cpuSeconds: 3 },
      ];
    },
  });
  const first = sampler.track(10);
  const second = sampler.track(20);
  snapshots = 0;
  sampledGroups.length = 0;
  try {
    await new Promise((resolve) => setTimeout(resolve, 55));
    assert.ok(snapshots >= 1, 'expected the shared sampler to take a process snapshot');
    assert.ok(sampledGroups.every((groups) => groups.length === 2 && groups[0] === 10 && groups[1] === 20));
    assert.equal(first.usage().rssBytes, 300);
    assert.equal(first.usage().processCount, 2);
    assert.deepEqual(second.usage().cpuSecondsByPid, new Map([[20, 3]]));
  } finally {
    first.close();
    second.close();
    sampler.close();
  }
});

test('sampling errors are reported to each tracked group', () => {
  const sampler = createProcessGroupSampler({ snapshotProvider: () => { throw new Error('fixture snapshot failure'); } });
  const group = sampler.track(55);
  try {
    assert.throws(() => group.usage(), /process-group sampling failed: fixture snapshot failure/);
  } finally {
    group.close();
    sampler.close();
  }
});

test('Linux sampler filters unrelated process groups during a real proc snapshot', {
  skip: process.platform !== 'linux',
}, () => {
  const sampler = createProcessGroupSampler({ intervalMs: 100 });
  const group = sampler.track(2_000_000_000);
  try {
    assert.deepEqual(group.usage(), { rssBytes: 0, cpuSecondsByPid: new Map(), processCount: 0 });
  } finally {
    group.close();
    sampler.close();
  }
});

test('Linux sampler measures a child process group and excludes an unrelated group', {
  skip: process.platform !== 'linux',
}, async (t) => {
  const worker = [
    "const { spawn } = require('node:child_process');",
    "const memory = Buffer.alloc(8 * 1024 * 1024, 1);",
    "const load = spawn(process.execPath, ['-e', 'const memory = Buffer.alloc(20 * 1024 * 1024, 2); setInterval(() => { let value = 0; for (let i = 0; i < 400000; i++) value += Math.sqrt(i); if (value < 0) process.exit(3); }, 5)'], { stdio: 'ignore' });",
    'setInterval(() => { if (memory[0] !== 1 || load.killed) process.exit(4); }, 100);',
  ].join('\n');
  const child = spawn(process.execPath, ['-e', worker], { detached: true, stdio: 'ignore' });
  assert.ok(child.pid);
  const sampler = createProcessGroupSampler({ intervalMs: 25 });
  const group = sampler.track(child.pid);
  let closed = false;
  child.once('close', () => { closed = true; });
  try {
    let usage;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      usage = group.usage();
      if (usage.processCount >= 2 && [...usage.cpuSecondsByPid.values()].some((seconds) => seconds >= 0.05)) break;
    }
    assert.ok(usage.processCount >= 2, `expected parent and worker in group, got ${usage.processCount}`);
    assert.ok(usage.rssBytes >= 20 * 1024 * 1024, `expected summed RSS above 20 MiB, got ${usage.rssBytes}`);
    assert.ok([...usage.cpuSecondsByPid.values()].some((seconds) => seconds >= 0.05), 'expected cumulative CPU time for a group process');
    t.diagnostic(JSON.stringify({
      processGroup: child.pid,
      processCount: usage.processCount,
      rssBytes: usage.rssBytes,
      cpuSecondsByPid: Object.fromEntries(usage.cpuSecondsByPid),
    }));
    const unrelated = aggregateProcessGroup([
      { pid: child.pid, processGroup: child.pid, rssBytes: 99, cpuSeconds: 9 },
      { pid: child.pid + 1, processGroup: child.pid + 1, rssBytes: 1234, cpuSeconds: 15 },
    ], child.pid);
    assert.equal(unrelated.rssBytes, 99);
    assert.equal(unrelated.processCount, 1);
  } finally {
    if (!closed) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      await Promise.race([
        new Promise((resolve) => child.once('close', resolve)),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }
    group.close();
    sampler.close();
  }
});
