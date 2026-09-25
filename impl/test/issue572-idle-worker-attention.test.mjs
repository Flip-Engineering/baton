import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IdleWorkerAttention, observeIdleWorker, observeIdlePressure } from '../src/idle-worker-attention.mjs';

function observation(worker, memory = 1024, disk = 2048) {
  return { observedAt: '2026-09-24T00:00:00.000Z',
    git: { head: 'committed-head', uncommitted: { count: 1, entries: [{ status: ' M', path: 'src/file.mjs' }] } },
    resources: {
      process: { held: true, residentBytes: memory },
      worktree: { held: true, path: `/worktrees/${worker}`, allocatedBytes: disk },
      runtimeHome: { held: true, path: `/runtime/${worker}`, home: `/runtime/${worker}/home`, allocatedBytes: 512 },
    } };
}

function fixture(t) {
  const records = [];
  const deliveries = [];
  const events = new Map();
  const resources = new Map();
  let dimensions = [];
  let timer;
  const coordinator = {
    _workers: new Map(), _tasks: new Map(), _drainState: 'open', _now: () => 0,
    _coordination: { eventCursor: () => records.length,
      recordDriver: (kind, payload, options) => {
        let event = records.find((row) => row.key === options.key);
        if (!event) { event = { seq: records.length + 1, kind, payload, ...options }; records.push(event); }
        return { event };
      } },
    _log: { byKind: (id, kind) => (events.get(id) ?? []).filter((row) => row.kind === kind) },
    _reportRunTurn: (handle, event, report) => deliveries.push({ worker: handle.id, report, attention: event.attention }),
    _trackAuthorityPromise: (fn) => Promise.resolve().then(fn),
    _noteFailure: (_kind, error) => { throw error; },
  };
  const service = new IdleWorkerAttention(coordinator, {
    observe: async (_coordinator, handle) => resources.get(handle.id), pressure: async () => dimensions,
    schedule: (fn) => { timer = fn; return { unref() {} }; }, cancel: () => { timer = null; },
  });
  t.after(() => service.close());
  function worker(id, memory = 1024, disk = 2048) {
    const handle = { id, taskId: `task-${id}`, status: 'working', turnTerminalObserved: true,
      turnInFlight: false, reportedTurnEpoch: 1 };
    coordinator._workers.set(id, handle);
    coordinator._tasks.set(handle.taskId, { status: 'working' });
    resources.set(id, observation(id, memory, disk));
    const event = { seq: 3, kind: 'lifecycle.turn_completed', turnEpoch: 1,
      payload: { status: 'completed', summary: `Report from ${id}` } };
    events.set(id, [event]);
    return { handle, event, report: event.payload };
  }
  async function report(worker) {
    return service.report(worker.handle, worker.event, worker.report,
      (report, attention) => deliveries.push({ worker: worker.handle.id, report, attention }));
  }
  return { coordinator, service, records, deliveries, resources, worker, report,
    pressure: (value) => { dimensions = value; }, tick: () => timer?.() };
}

test('the retained-turn prompt carries the original report, committed state, changes, and held resources', async (t) => {
  const f = fixture(t);
  const worker = f.worker('builder');
  worker.report.summary = 'x'.repeat(20000);
  worker.report.output = 'Review the implementation';
  await f.report(worker);
  const report = f.deliveries[0].report;
  assert.match(report.summary.slice(0, 400), /Choose continue or stop.*HEAD committed-head.*uncommitted entries 1.*Process memory 1024 bytes/s);
  assert.equal(report.output, worker.report.output);
  assert.equal(report.operatorDecision.originalSummary, worker.report.summary);
  assert.deepEqual(report.operatorDecision.choices, ['continue', 'stop']);
  assert.equal(report.operatorDecision.git.uncommitted.entries[0].path, 'src/file.mjs');
  assert.equal(report.operatorDecision.resources.runtimeHome.home, '/runtime/builder/home');
  assert.equal(worker.handle.status, 'working');
  assert.equal(f.records.length, 0);
});

test('memory pressure re-raises idle workers in RSS order and excludes a continued worker', async (t) => {
  const f = fixture(t);
  const small = f.worker('small', 10);
  const large = f.worker('large', 100);
  const active = f.worker('continued', 1000);
  await f.report(small); await f.report(large); await f.report(active);
  active.handle.turnInFlight = true;
  active.handle.turnTerminalObserved = false;
  f.pressure([{ kind: 'memory', availableBytes: 1, requiredBytes: 1024 }]);
  await f.service.check();
  const raised = f.deliveries.filter((row) => row.attention);
  assert.deepEqual(raised.map((row) => row.worker), ['large', 'small']);
  assert.deepEqual(raised[0].attention.ranking.map((row) => [row.workerId, row.value]), [['large', 100], ['small', 10]]);
  assert.match(raised[0].report.summary, /1\. large \(100 bytes\); 2\. small \(10 bytes\)/);
  assert.equal(f.records[0].kind, 'worker.idle_pressure_observed');
  assert.equal(f.records[0].seq, raised[0].attention.seq);
  await f.service.check();
  assert.equal(f.deliveries.length, 5, 'the same pressure episode produces one prompt per idle turn');
  f.pressure([]); await f.service.check();
  f.pressure([{ kind: 'memory' }]); await f.service.check();
  assert.equal(f.records.length, 2, 'pressure returning after relief raises a new decision');
});

test('disk pressure ranks allocations and marks unmeasured holdings unknown', async (t) => {
  const f = fixture(t);
  const small = f.worker('small', 1000, 10);
  const large = f.worker('large', 1, 100);
  const unknown = f.worker('unknown', 999, null);
  await f.report(small); await f.report(large); await f.report(unknown);
  f.pressure([{ kind: 'disk', freeBytes: 0 }]);
  await f.service.check();
  const ranking = f.records[0].payload.ranking;
  assert.deepEqual(ranking.map((row) => row.workerId), ['large', 'small', 'unknown']);
  assert.equal(ranking[0].metric, 'allocated_disk_bytes');
  assert.equal(ranking[0].value, 612);
  assert.equal(ranking[2].value, null);
});

test('pressure retry keeps its event identity after a delivery failure', async (t) => {
  const f = fixture(t);
  const worker = f.worker('builder');
  await f.report(worker);
  const entry = f.service.entries.get(worker.handle.id);
  const deliver = entry.deliver;
  let failed = false;
  entry.deliver = (...args) => { if (!failed) { failed = true; throw new Error('delivery unavailable'); } return deliver(...args); };
  f.pressure([{ kind: 'memory' }]);
  await assert.rejects(f.service.check(), /delivery unavailable/);
  f.resources.set('builder', observation('builder', 999999));
  await f.service.check();
  assert.equal(f.records.length, 1);
  assert.equal(f.deliveries.at(-1).attention.seq, f.records[0].seq);
  assert.equal(f.deliveries.at(-1).attention.ranking[0].value, 1024);
  assert.equal(f.deliveries.at(-1).report.operatorDecision.resources.process.residentBytes, 1024);
});

test('a recreated attention service finds retained turns in the worker log and re-raises them', async (t) => {
  const f = fixture(t);
  f.worker('retained');
  const active = f.worker('active'); active.handle.turnInFlight = true;
  const stopped = f.worker('stopped'); stopped.handle.status = 'dead';
  f.pressure([{ kind: 'memory' }]);
  await f.service.check();
  assert.deepEqual(f.deliveries.map((row) => row.worker), ['retained']);
  assert.equal(f.deliveries[0].report.operatorDecision.originalSummary, 'Report from retained');
});

test('an initial delivery failure is retried on the next observation even without pressure', async (t) => {
  const f = fixture(t);
  const worker = f.worker('builder');
  let attempts = 0;
  await assert.rejects(f.service.report(worker.handle, worker.event, worker.report, (report) => {
    if (++attempts === 1) throw new Error('delivery unavailable');
    f.deliveries.push({ report });
  }), /delivery unavailable/);
  await f.service.check();
  assert.equal(attempts, 2);
  assert.equal(f.deliveries.length, 1);
  assert.equal(f.records.length, 0);
});

test('real metadata observation records Git changes, allocations, and identity-checked process-group RSS', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'baton-idle-worker-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const worktree = join(dir, 'worktree'); const home = join(dir, 'runtime', 'home');
  mkdirSync(worktree); mkdirSync(home, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: worktree, encoding: 'utf8' }).trim();
  git('init', '-q');
  writeFileSync(join(worktree, 'tracked.txt'), 'committed');
  git('add', '.'); git('-c', 'user.name=Baton test', '-c', 'user.email=baton@example.test', 'commit', '-qm', 'Fixture');
  const head = git('rev-parse', 'HEAD');
  writeFileSync(join(worktree, 'tracked.txt'), 'modified');
  writeFileSync(join(worktree, 'untracked.txt'), 'uncommitted');
  writeFileSync(join(home, 'held.data'), 'x'.repeat(8192));
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  await once(child, 'spawn');
  t.after(async () => { const exited = once(child, 'exit'); child.kill(); await exited; });
  const pidStart = execFileSync('/bin/ps', ['-p', String(child.pid), '-o', 'lstart='], { encoding: 'utf8' }).trim();
  const handle = { taskId: 'task', worktree, runtimeLease: { paths: { root: join(dir, 'runtime'), home } },
    processRef: { pid: child.pid, processGroupId: child.pid, generation: 1, state: 'ready' },
    processAuthority: { pid: child.pid, processGroupId: child.pid, generation: 1, pidStart } };
  const coordinator = { _tasks: new Map([['task', { worktreeBaseSha: head }]]), _now: () => 0 };
  const observed = await observeIdleWorker(coordinator, handle);
  assert.equal(observed.git.head, head);
  assert.equal(observed.git.commitsAhead, 0);
  assert.deepEqual(observed.git.uncommitted.entries.map((entry) => entry.path).sort(), ['tracked.txt', 'untracked.txt']);
  assert.ok(observed.resources.worktree.allocatedBytes > 0);
  assert.ok(observed.resources.runtimeHome.allocatedBytes >= 8192);
  assert.ok(observed.resources.process.residentBytes > 0);
  assert.equal(observed.resources.process.metric, 'process_group_rss_bytes');
  handle.processAuthority.pidStart = 'stale identity';
  const stale = await observeIdleWorker(coordinator, handle);
  assert.equal(stale.resources.process.residentBytes, null);
  assert.equal(stale.resources.process.observation, 'unavailable');
});

test('host and disk observations independently report capacity pressure', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'baton-idle-pressure-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const coordinator = { _workers: new Map([['worker', { worktree: dir }]]),
    _hostCapacity: { observeNow: () => ({ capacity: { memoryTight: true, availableBytes: 1, suiteBytes: 2 } }) },
    _worktrees: { capacitySnapshot: () => ({ floor: { bytes: Number.MAX_SAFE_INTEGER, inodes: 0 }, outstanding: { bytes: 0, inodes: 0 } }) } };
  assert.deepEqual((await observeIdlePressure(coordinator)).map((row) => row.kind), ['memory', 'disk']);
  coordinator._hostCapacity.observeNow = () => { throw new Error('unavailable'); };
  assert.deepEqual((await observeIdlePressure(coordinator)).map((row) => row.kind), ['disk']);
});

test('the runtime observation timer raises pressure prompts without a claim or nudge', async (t) => {
  const f = fixture(t);
  const worker = f.worker('builder');
  await f.report(worker);
  f.pressure([{ kind: 'memory' }]);
  await f.tick();
  assert.equal(f.deliveries.length, 2);
  assert.equal(f.deliveries[1].attention.ranking[0].workerId, 'builder');
  f.coordinator._closed = true;
  await f.tick();
  assert.equal(f.service.entries.size, 0);
  assert.equal(f.service.timer, null);
});

test('a newer turn completing during resource observation preserves both turn reports', async (t) => {
  const f = fixture(t);
  const worker = f.worker('builder');
  const resolves = [];
  f.service.observe = () => new Promise((resolve) => resolves.push(resolve));
  const first = f.report(worker);
  const secondEvent = { ...worker.event, seq: 5, turnEpoch: 2 };
  worker.handle.reportedTurnEpoch = 2;
  const second = f.service.report(worker.handle, secondEvent, { status: 'completed', summary: 'Second turn' },
    (report) => f.deliveries.push({ report }));
  resolves[1](observation('builder'));
  await second;
  resolves[0](observation('builder'));
  await first;
  assert.equal(f.deliveries.length, 2);
  assert.equal(f.deliveries[0].report.operatorDecision.originalSummary, 'Second turn');
  assert.equal(f.deliveries[1].report.summary, 'Report from builder');
  assert.equal(f.service.entries.get('builder').event.turnEpoch, 2);
});
