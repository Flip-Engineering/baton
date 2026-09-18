// Issues #297 and #307: the host is the throttle, and the workspace floor is a record.
//
// #297: one host-wide capacity authority — derived from cores, memory and the load average, never
// a constant — is shared by every resident on the machine through a host-scoped lease directory
// (the host-wide sibling of the per-repo `.baton/capacity` files). It admits verification runs and
// full-suite verdicts by capacity, queues the rest IN ORDER with a visible {position, ahead}, and
// `swarm.recruit` / `swarm.check` report their admission as a typed row instead of starting work
// that would be starved. The suite runner's default parallelism derives from the same derivation,
// with `BATON_SUITE_PARALLELISM` as the documented operator override.
//
// #307: the workspace capacity floor is derived — the largest checkout estimate the deployment
// has recorded (its ledger high-water) plus its measured runtime footprint — configurable, shown
// on the doctor beside the observation, named in the refusal (free, reserved, estimate, floor,
// remedy), and carried as a deployment-level fact on the swarm view's deployment summary
// (`capacityPressure` is the one predicate the wake stream lane imports).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  deriveHostCapacity, hostCapacityObservation, HostCapacityAuthority, defaultSuiteParallelism,
  parseVmStat, parseMemInfoAvailable, hostAvailableMemoryBytes, hostCapacityShortfall, HOST_CAPACITY_BYPASS,
} from '../src/host-capacity.mjs';
import { WAKE_CLASSES } from '../src/wake-stream.mjs';
import {
  deriveWorktreeCapacityFloor, loadOrCreateWorktreeCapacityIntegrityKey,
  WorktreeCapacityAuthority, workspaceCapacityPressure,
} from '../src/worktree-capacity.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const G = 1024 ** 3;
const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const SHA = 'a'.repeat(40);

function leaseRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-host-capacity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// ── #297.1: the derivation, and the shared host-scoped authority ────────────────────────────────

test('HC-1: every host admission threshold is a derivation from the measurement, never a constant', () => {
  const capacity = deriveHostCapacity(hostCapacityObservation({
    cores: 10, totalBytes: 16 * G, freeBytes: 15 * G, load1m: 3,
  }));
  assert.equal(capacity.hubCores, 1, 'the hub is one event loop: one core');
  assert.equal(capacity.suiteCores, 9, 'a full suite takes every core but the hub\'s');
  assert.equal(capacity.verdictLanes, 1, 'one host-wide verdict lane on the default derivation');
  assert.equal('workerSlots' in capacity, false, 'no worker slot count: a recruited seat is not a core');
  assert.equal(capacity.coreShareBytes, Math.floor((16 * G) / 10), 'memory is shared per core');
  assert.equal(capacity.suiteBytes, 9 * Math.floor((16 * G) / 10), 'a suite is entitled to its cores\' share');
  assert.equal(capacity.saturated, false, 'load 3 on 10 cores is not saturated');
  assert.equal(capacity.memoryTight, false);
  const loaded = deriveHostCapacity(hostCapacityObservation({
    cores: 10, totalBytes: 16 * G, freeBytes: 15 * G, load1m: 24,
  }));
  assert.equal(loaded.saturated, true, 'the operator\'s uptime read, derived: load 24 on 10 cores queues');

  const tight = deriveHostCapacity(hostCapacityObservation({
    cores: 4, totalBytes: 8 * G, freeBytes: 1 * G, load1m: 1,
  }));
  assert.equal(tight.memoryTight, true, 'free memory below one verdict\'s share queues');

  const tiny = deriveHostCapacity(hostCapacityObservation({
    cores: 2, totalBytes: 4 * G, freeBytes: 3 * G, load1m: 1,
  }));
  assert.ok(tiny.usableCores >= 1 && tiny.verdictLanes >= 1,
    'the derivation never collapses below one lane');
});

test('HC-2: two residents share one host lease directory; a worker holds no slot, only a saturated host queues (FIFO, visible position, in-order drainage), and a verify charges the suite budget', async (t) => {
  const root = leaseRoot(t);
  const host = { load1m: 1 };
  const observation = () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: host.load1m });
  const mk = (residentId) => new HostCapacityAuthority({
    root, residentId, observation, pollMs: 15, waitMs: 5_000,
  });
  const first = mk('deployment-a');
  const second = mk('deployment-b');

  // Workers are not core slots (operator ruling, 2026-09-18): five workers on a 4-core fixture
  // all admit, charge no core and no byte, and leave room for a sixth.
  const leases = [];
  for (const holder of ['p1', 'p2', 'p3', 'p4', 'p5']) {
    leases.push((await first.acquire('worker', { holder })).token);
  }
  const shared = await second.observe();
  assert.equal(shared.used.leases.worker, 5, 'every worker lease is visible to the other resident');
  assert.deepEqual({ cores: shared.used.cores, bytes: shared.used.bytes }, { cores: 0, bytes: 0 }, 'a worker charges no budget');
  assert.equal(shared.roomForWorker, true, 'a sixth worker has room on a 4-core host');

  // Only the host's own load reading queues a worker; the queued row names that dimension.
  host.load1m = 9;
  let queuedRow = null;
  const queuedAcquire = second.acquire('worker', {
    holder: 'p6', onQueued: (row) => { queuedRow = row; },
  });
  await new Promise((resolve) => { setTimeout(resolve, 150); });
  assert.deepEqual(queuedRow, {
    position: 1, ahead: 0, running: 0, workerLeases: 5,
    shortfall: { dimension: 'load', observed: 9, required: 4, unit: 'load1m' },
  },
    'the queued request reports its visible place in the host queue and the load it waits on');

  const snapshot = await second.observe();
  assert.equal(snapshot.queue.length, 1, 'the queue is visible to every resident');
  assert.equal(snapshot.queue[0].position, 1);
  assert.equal(snapshot.queue[0].ahead, 0);
  assert.equal(snapshot.queue[0].holder, 'p6');

  // FIFO drainage: the load falls, and exactly the queued head is admitted.
  host.load1m = 1;
  const admitted = await queuedAcquire;
  assert.equal((await first.observe()).queue.length, 0, 'the drained head left the queue');

  // A verify charges the whole verdict budget: it admits beside six workers (they hold
  // nothing), a second verify queues behind it on budget, a worker still admits beside it,
  // and the second verify drains when the verdict releases.
  const verify = await first.acquire('verify', { holder: 'check-1' });
  let secondQueued = null;
  const secondPending = second.acquire('verify', { holder: 'check-2', onQueued: (row) => { secondQueued = row; } });
  await new Promise((resolve) => { setTimeout(resolve, 120); });
  assert.deepEqual(secondQueued?.shortfall, { dimension: 'budget', observed: 0, required: 3, unit: 'cores' },
    'the second verify waits on the cores the first verdict holds');
  const beside = await second.acquire('worker', { holder: 'p7' });
  assert.ok(beside.token, 'a worker admits while a verify holds the whole budget');
  await first.release(verify.token);
  const drained = await secondPending;
  for (const token of [...leases, admitted.token, beside.token, drained.token]) {
    await (token.residentId === 'deployment-a' ? first : second).release(token);
  }
  assert.deepEqual((await first.observe()).used.leases, { verify: 0, worker: 0 });
});

test('HC-3: a proved-dead holder\'s lease returns to the budget, and a bounded wait refuses pre-effect naming the queue', async (t) => {
  const root = leaseRoot(t);
  const observation = () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: 1 });
  const authority = new HostCapacityAuthority({
    root, residentId: 'resident-live', observation, pollMs: 15, waitMs: 200,
  });
  const deadLease = {
    schemaVersion: 1, kind: 'worker', holder: 'p-dead', nonce: '0'.repeat(32), pid: 2_147_483_647,
    residentId: 'resident-dead', acquiredAt: new Date().toISOString(),
  };
  mkdirSync(join(root, 'leases'), { recursive: true, mode: 0o700 });
  const deadPath = join(root, 'leases', `lease-worker-${deadLease.nonce}.json`);
  writeFileSync(deadPath, `${JSON.stringify(deadLease, null, 2)}\n`, { mode: 0o600 });
  chmodSync(deadPath, 0o600);
  const swept = await authority.acquire('worker', { holder: 'p-fresh' });
  assert.equal(swept.token.holder, 'p-fresh', 'a dead resident\'s lease never starves a live one');
  assert.equal(await authority.release(swept.token), true);
  assert.equal(await authority.release({ kind: 'worker', nonce: 'f'.repeat(32), residentId: 'resident-live', holder: 'x', pid: 1 }), false,
    'a release naming a lease this resident does not own is a no-op');

  // A saturated host queues; the bounded wait ends in a typed pre-effect refusal with the facts.
  const loaded = new HostCapacityAuthority({
    root, residentId: 'resident-loaded',
    observation: () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: 9 }),
    pollMs: 15, waitMs: 150,
  });
  let queued = null;
  await assert.rejects(
    loaded.acquire('verify', { holder: 'check-x', onQueued: (row) => { queued = row; } }),
    (error) => error.code === 'host_capacity_queue_timeout' && error.queuePosition === 1,
  );
  assert.deepEqual(queued, {
    position: 1, ahead: 0, running: 0, workerLeases: 0,
    // #329: a saturated host names load as the dimension, with the observed and required numbers.
    shortfall: { dimension: 'load', observed: 9, required: 4, unit: 'load1m' },
  },
    'the typed queued row is reported even when the wait is refused at the deadline');
});

// ── #297.2: recruit reports a typed admission row ───────────────────────────────────────────────

function swarmFixture(t, { hostCapacity = null } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-host-capacity-swarm-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, hostCapacity,
    prepareRun: async (request) => request,
    startRun: async (request) => {
      if (!workers.some((row) => row.runId === request.runId)) {
        workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
          runId: request.runId, status: 'working', paused: false });
      }
    },
    stopRun: async (runId) => {
      workers.find((row) => row.runId === runId).status = 'dead';
      return { state: 'closed' };
    },
  });
  let key = 0;
  const call = (command, args = {}) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(['view'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }), ...args }, owner);
  return { store, runtime, workers, call };
}

test('HC-4: swarm.recruit reports a typed admission row; a recruit holds no slot, and a seat the load queues records the durable queue row and starts only when admitted', async (t) => {
  const root = leaseRoot(t);
  const host = { load1m: 1 };
  const observation = () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: host.load1m });
  const authority = new HostCapacityAuthority({
    root, residentId: 'deployment-x', observation, pollMs: 15, waitMs: 5_000,
  });
  const f = swarmFixture(t, { hostCapacity: authority });
  await f.call('create', { purpose: 'Recruit by host capacity' });

  const first = await f.call('recruit', { participantId: 'p1', objective: 'One' });
  assert.deepEqual(first.admission, { state: 'admitted', authority: 'host' },
    'the response carries the typed admitted row');

  // Workers are not core slots: on a 4-core fixture the fourth recruit admits like the first.
  await f.call('recruit', { participantId: 'p2', objective: 'Two' });
  await f.call('recruit', { participantId: 'p3', objective: 'Three' });
  await f.call('recruit', { participantId: 'p4', objective: 'Four' });
  assert.equal(f.workers.length, 4, 'four seats on four cores: no derived slot count refused one');

  // Only the host's load queues a recruit; the queued row is durable and the seat does not start.
  host.load1m = 9;
  const queuedRecruit = f.call('recruit', { participantId: 'p5', objective: 'Five' });
  await new Promise((resolve) => { setTimeout(resolve, 150); });
  assert.equal(f.workers.length, 4, 'the queued seat has NOT started starved work');
  const queuedRows = f.store.eventsView().filter((event) => event.kind === 'driver.recorded'
    && event.payload.kind === 'swarm.admission_queued');
  assert.equal(queuedRows.length, 1, 'the queued recruit recorded exactly one durable queued row');
  assert.equal(queuedRows[0].payload.position, 1);
  assert.equal(queuedRows[0].payload.ahead, 0);
  assert.equal(queuedRows[0].payload.participantId, 'p5');
  assert.equal(queuedRows[0].payload.leaseKind, 'worker');
  assert.equal(queuedRows[0].payload.shortfall.dimension, 'load');

  host.load1m = 1;
  const fifth = await queuedRecruit;
  assert.equal(fifth.admission.state, 'admitted');
  assert.equal(fifth.admission.position, 1, 'the drained recruit reports admitted with its wait facts');
  assert.ok('queuedAt' in fifth.admission, 'the drained recruit carries its queue facts');
  const admittedRows = f.store.eventsView().filter((event) => event.kind === 'driver.recorded'
    && event.payload.kind === 'swarm.admission_admitted');
  assert.equal(admittedRows.length, 1, 'the queue-to-admit timeline is durable');
  assert.equal(f.workers.length, 5, 'the queued seat started only when the host admitted it');
});

test('HC-5: without a host authority the runtime is honestly unwired — admission names it, nothing queues', async (t) => {
  const f = swarmFixture(t);
  await f.call('create', { purpose: 'Unwired admission' });
  const first = await f.call('recruit', { participantId: 'solo', objective: 'One' });
  assert.deepEqual(first.admission, { state: 'admitted', authority: 'unwired' },
    'a bare runtime names its unwired admission instead of pretending');
});

// ── #297.3: the suite runner's default parallelism is the shared derivation ─────────────────────

test('HC-6: run-suite.mjs defaults its parallelism from the derivation; BATON_SUITE_PARALLELISM is the override', async (t) => {
  const implRoot = fileURLToPath(new URL('../', import.meta.url));
  const runner = join(implRoot, 'scripts', 'run-suite.mjs');

  // A staged host: 8 cores, plenty of memory → the derivation answers 7 lanes.
  assert.equal(defaultSuiteParallelism({ cores: 8, totalBytes: 32 * G, freeBytes: 31 * G, load1m: 0 }), 7);
  // The runner's source must read the derivation, with the env var as the only override.
  const source = readFileSync(runner, 'utf8');
  assert.match(source, /defaultSuiteParallelism\(\)/u, 'the unset case derives from the host');
  assert.match(source, /BATON_SUITE_PARALLELISM/u, 'the operator override survives, documented');

  // The live runner prints the lane count it resolved; with no env override it is the
  // derivation's answer for this machine.
  const env = { ...process.env };
  delete env.BATON_SUITE_PARALLELISM;
  const child = spawn(process.execPath, [runner, 'test/adapter-card-contract.test.mjs'], {
    cwd: implRoot, env, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => { child.once('close', (exitCode) => resolve(exitCode)); });
  const line = stderr.match(/parallel lane \(x(\d+)\)/u);
  assert.ok(line, `the runner reports its lane count: ${stderr.split('\n')[0]}`);
  assert.equal(Number(line[1]), defaultSuiteParallelism(),
    `the default lane count is the derivation (stderr said x${line[1]})`);
  assert.equal(code, 0);
}, { timeout: 120_000 });

// ── #307: the derived workspace floor, the typed refusal, and the deployment fact ────────────────

test('HC-7: the floor derivation is the largest recorded estimate plus the measured footprint', () => {
  assert.deepEqual(deriveWorktreeCapacityFloor({
    estimateHighWaterBytes: 700, estimateHighWaterInodes: 4,
    runtimeFootprintBytes: 500, runtimeFootprintInodes: 10,
  }), { bytes: 1200, inodes: 14 });
  assert.throws(() => deriveWorktreeCapacityFloor({
    estimateHighWaterBytes: -1, estimateHighWaterInodes: 0, runtimeFootprintBytes: 0, runtimeFootprintInodes: 0,
  }), TypeError);
});

function worktreeFixture(t, { observe, estimate, policy, runtimeFootprint }) {
  const repo = mkdtempSync(join(tmpdir(), 'baton-host-capacity-wt-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', repo]);
  return new WorktreeCapacityAuthority({
    repoRoot: repo,
    // The raw policy: the constructor normalizes and digests it.
    policy: {
      maxReservedBytes: null, maxReservedInodes: null,
      minFreeBytes: null, minFreeInodes: null,
      runtimeReserveBytes: 0, runtimeReserveInodes: 0, ...policy,
    },
    integrityKey: loadOrCreateWorktreeCapacityIntegrityKey(repo),
    observe, estimate, runtimeFootprint,
  });
}

test('HC-8: the derived floor admits by record, and the refusal names free, reserved, estimate, floor and the remedy', async (t) => {
  let freeBytes = 1_000;
  let freeInodes = 100;
  const authority = worktreeFixture(t, {
    observe: () => ({ freeBytes, freeInodes }),
    estimate: () => ({ bytes: 700, inodes: 4 }),
    runtimeFootprint: () => ({ bytes: 500, inodes: 10 }),
  });

  // Floor = high-water (0) + footprint (500). Free 1000 − wave 700 = 300 < 500 → refuse, naming
  // every number the operator asked for.
  const request = { baseSha: SHA, sparsePaths: [], sparseCheckoutIdentity: { mode: 'full', paths: [], digest: '0'.repeat(64) }, toolchainProjection: null };
  await assert.rejects(
    async () => authority.reserve('worker:first', request),
    (error) => {
      assert.equal(error.code, 'worktree_capacity_exceeded');
      assert.match(error.message, /1000 bytes and 100 inodes free/u);
      assert.match(error.message, /0 bytes and 0 inodes reserved outstanding/u);
      assert.match(error.message, /estimates 700 bytes and 4 inodes/u);
      assert.match(error.message, /the derived floor is 500 bytes and 10 inodes/u);
      assert.equal(error.freeBytes, 1_000);
      assert.equal(error.estimateBytes, 700);
      assert.match(error.message, /free at least 200 bytes and 0 inodes/u, 'the remedy names what would admit this request');
      assert.equal(error.floorBytes, 500);
      assert.equal(error.floorSource, 'derived');
      assert.equal(error.deficitBytes, 200);
      return true;
    },
  );

  // Admitting grows the ledger's high-water: the next floor remembers the largest checkout.
  freeBytes = 1_500;
  freeInodes = 150;
  await authority.reserve('worker:first', request);
  const floor = authority.floor();
  assert.equal(floor.source, 'derived');
  assert.deepEqual(floor.estimateHighWater, { bytes: 700, inodes: 4 },
    'the ledger high-water records the largest estimate the deployment has made');
  assert.equal(floor.bytes, 1_200, 'floor = high-water 700 + footprint 500');
  assert.equal(authority.snapshot().estimateHighWater.bytes, 700);

  // Release does not shrink the high-water: "largest this deployment has made" is a record.
  await authority.releaseAbsent('worker:first');
  assert.equal(authority.floor().estimateHighWater.bytes, 700);

  // An operator-pinned floor replaces the derivation for its field and says so.
  const configured = worktreeFixture(t, {
    observe: () => ({ freeBytes: 1_500, freeInodes: 150 }),
    // First wave 700/4; the refusal wave estimates 900 — beyond the pinned floor's headroom.
    estimate: (() => {
      let call = 0;
      return () => {
        call += 1;
        return call === 1 ? { bytes: 700, inodes: 4 } : { bytes: 900, inodes: 4 };
      };
    })(),
    runtimeFootprint: () => ({ bytes: 500, inodes: 10 }),
    policy: { minFreeBytes: 20 },
  });
  const token = await configured.reserve('worker:pinned', request);
  assert.equal(configured.floor().source, 'mixed');
  assert.equal(configured.floor().bytes, 20, 'the configured bytes floor wins for its field');
  await assert.rejects(
    async () => configured.reserve('worker:second', request),
    (error) => {
      assert.match(error.message, /the configured floor is 20 bytes and 14 inodes/u);
      assert.match(error.message, /advanced\.capacity\.policy\.minFreeBytes\/minFreeInodes/u);
      return true;
    },
  );
  await configured.release(token);
});

// ── #297.4 / #307.2-4: the doctor and the view carry the facts ──────────────────────────────────

test('HC-9: the deployment summary predicate answers capacity pressure', () => {
  assert.equal(workspaceCapacityPressure(null), false);
  assert.equal(workspaceCapacityPressure({ state: 'ready', freeBytes: 100, floorBytes: 50 }), false);
  assert.equal(workspaceCapacityPressure({ state: 'blocked', code: 'worktree_capacity_exceeded' }), true,
    'a blocked typed observation is pressure');
  assert.equal(workspaceCapacityPressure({ freeBytes: 40, floorBytes: 50, freeInodes: 10, floorInodes: 5 }), true,
    'free below the derived floor is pressure — the fact the wake stream lane imports');
  assert.equal(workspaceCapacityPressure({ freeBytes: 40, floorBytes: 50 }), true);
  assert.equal(workspaceCapacityPressure({ freeBytes: 60, floorBytes: 50, freeInodes: 3, floorInodes: 5 }), true,
    'either resource crossing the floor is pressure');
});

test('HC-10: swarm.view carries the deployment summary rows with host capacity, queue and the pressure fact', async (t) => {
  const root = leaseRoot(t);
  const observation = () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: 1 });
  const authority = new HostCapacityAuthority({
    root, residentId: 'deployment-view', observation, pollMs: 15, waitMs: 5_000,
  });
  const f = swarmFixture(t, { hostCapacity: authority });
  f.runtime.deploymentSummary = () => ({
    workspace: {
      state: 'blocked', code: 'worktree_capacity_exceeded', freeBytes: 900, freeInodes: 90,
      floorBytes: 1_200, floorInodes: 14, floorSource: 'derived',
      estimateHighWater: { bytes: 700, inodes: 4 }, runtimeFootprint: { bytes: 500, inodes: 10 },
      pressure: true,
    },
    hostCapacity: authority.observeNow(),
  });
  await f.call('create', { purpose: 'The view carries deployment facts' });
  await f.call('recruit', { participantId: 'solo', objective: 'One' });
  const view = await f.call('view');
  assert.equal(view.deployment.workspace.pressure, true);
  assert.equal(workspaceCapacityPressure(view.deployment.workspace), true,
    'the view\'s own summary answers the wake lane\'s predicate');
  assert.equal(view.deployment.hostCapacity.capacity.cores, 4);
  assert.equal(view.deployment.hostCapacity.used.leases.worker, 1,
    'the summary shows the live lease beside the queue');
  // The deployment rows ride the frame: every projection carries them.
  const outlined = await f.call('view', { projection: 'outline' });
  assert.equal(outlined.deployment.workspace.floorBytes, 1_200);
});

// ── #329: available memory, not free pages; a worker judged against ITS share; visible queueing ──

// Captured on the 10-core / 16 GB development Mac, 2026-09-16 (page size 16384): 0.10 GB "free",
// 3.68 GB inactive — the host that queued every recruit to host_capacity_queue_timeout.
const VM_STAT_CAPTURED = [
  'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
  'Pages free:                                6644.',
  'Pages active:                            229400.',
  'Pages inactive:                          241055.',
  'Pages speculative:                          807.',
  'Pages throttled:                              0.',
  'Pages wired down:                        119907.',
  'Pages purgeable:                           1200.',
  '"Translation faults":                 123456789.',
  'Pages stored in compressor:              787539.',
  'Pages occupied by compressor:            434501.',
  '',
].join('\n');

test('HC-11 (#329): darwin available memory derives from vm_stat (free + inactive + speculative + purgeable), linux from MemAvailable, else os.freemem — never a throw', () => {
  const parsed = parseVmStat(VM_STAT_CAPTURED);
  assert.equal(parsed.pageSize, 16384);
  assert.equal(parsed.freeBytes, 6644 * 16384);
  assert.equal(parsed.inactiveBytes, 241055 * 16384);
  assert.equal(parsed.availableBytes, (6644 + 241055 + 807 + 1200) * 16384);
  assert.ok(parsed.availableBytes > 3.7 * G && parsed.freeBytes < 0.11 * G, 'the captured Mac had ~3.8 GB available and ~0.1 GB free');
  assert.equal(parseVmStat('not a report'), null);
  assert.equal(parseVmStat(null), null);
  assert.equal(parseMemInfoAvailable('MemTotal:       16000000 kB\nMemFree:          100000 kB\nMemAvailable:    4000000 kB\n'), 4000000 * 1024);
  assert.equal(parseMemInfoAvailable('MemTotal: 1 kB'), null);

  const darwin = hostAvailableMemoryBytes({ platform: 'darwin', freeBytes: 6644 * 16384, totalBytes: 16 * G, vmStat: () => VM_STAT_CAPTURED });
  assert.equal(darwin, (6644 + 241055 + 807 + 1200) * 16384);
  const linux = hostAvailableMemoryBytes({ platform: 'linux', freeBytes: 100 * 1024 * 1024, totalBytes: 16 * G, memInfo: () => 'MemAvailable:    4000000 kB\n' });
  assert.equal(linux, 4000000 * 1024);
  const unreadable = hostAvailableMemoryBytes({ platform: 'darwin', freeBytes: 123, totalBytes: 16 * G, vmStat: () => { throw new Error('no vm_stat'); } });
  assert.equal(unreadable, 123, 'an unreadable platform report falls back to os.freemem honestly');
  const other = hostAvailableMemoryBytes({ platform: 'win32', freeBytes: 456, totalBytes: 16 * G });
  assert.equal(other, 456);
  const capped = hostAvailableMemoryBytes({ platform: 'linux', freeBytes: 1, totalBytes: 10, memInfo: () => 'MemAvailable: 100 kB\n' });
  assert.equal(capped, 10, 'available never exceeds total');
});

test('HC-12 (#329, revised 2026-09-18): a staged observation names its own numbers; a verify is judged against the suite share, a worker against load alone and never against a budget', () => {
  const staged = hostCapacityObservation({ cores: 10, totalBytes: 16 * G, freeBytes: 15 * G, load1m: 1 });
  assert.equal(staged.availableBytes, 15 * G, 'a staged observation without availableBytes reads it as freeBytes — never the real machine');
  // The captured Mac: 0.10 GB free, ~3.9 GB available, 10 cores / 16 GB.
  const mac = deriveHostCapacity(hostCapacityObservation({
    cores: 10, totalBytes: 16 * G, freeBytes: Math.floor(0.1 * G), availableBytes: Math.floor(3.9 * G), load1m: 1.5,
  }));
  assert.equal(mac.coreShareBytes, Math.floor((16 * G) / 10));
  assert.equal('workerMemoryTight' in mac, false, 'no worker memory share is derived — a worker holds no slot');
  assert.equal('workerSlots' in mac, false, 'no worker slot count is derived — seats are not cores');
  assert.equal(mac.memoryTight, true, '3.9 GB available cannot fund a full-suite verdict (14.4 GB)');
  const none = { cores: 0, bytes: 0, leases: { verify: 0, worker: 0 } };
  const shortfall = hostCapacityShortfall('verify', mac, none);
  assert.deepEqual(shortfall, { dimension: 'memory', observed: Math.floor(3.9 * G), required: mac.suiteBytes, unit: 'bytes' });
  assert.equal(hostCapacityShortfall('worker', mac, none), null, 'a worker fits');
  const loaded = deriveHostCapacity(hostCapacityObservation({ cores: 10, totalBytes: 16 * G, freeBytes: 15 * G, load1m: 12 }));
  assert.equal(hostCapacityShortfall('worker', loaded, none).dimension, 'load');
  assert.equal(hostCapacityShortfall('worker', mac, { cores: 0, bytes: 0, leases: { verify: 0, worker: 9 } }), null,
    'nine live workers on a 10-core host hold no budget: the tenth fits');
  const verifyHeld = { cores: mac.suiteCores, bytes: mac.suiteBytes, leases: { verify: 1, worker: 0 } };
  assert.equal(hostCapacityShortfall('worker', mac, verifyHeld), null,
    'a worker fits beside a live verify that holds the whole verdict budget');
  const fresh = deriveHostCapacity(hostCapacityObservation({ cores: 10, totalBytes: 16 * G, freeBytes: 15 * G, load1m: 1 }));
  assert.deepEqual(hostCapacityShortfall('verify', fresh, verifyHeld),
    { dimension: 'budget', observed: 0, required: fresh.suiteCores, unit: 'cores' },
    'a second verify waits on the cores the first verdict holds — the one budget that remains');
});

test('HC-13 (#329): the authority admits a worker on the captured Mac while a verify queues, and the timeout names the dimension, the numbers and the bypass', async (t) => {
  const root = leaseRoot(t);
  const observation = () => ({ cores: 10, totalBytes: 16 * G, freeBytes: Math.floor(0.1 * G), availableBytes: Math.floor(3.9 * G), load1m: 1.5 });
  const authority = new HostCapacityAuthority({ root, residentId: 'mac', observation, pollMs: 10, waitMs: 80 });
  const worker = await authority.acquire('worker', { holder: 'participant:s:p1' });
  assert.ok(worker.token, 'a worker lease is admitted with ~4 GB available');
  const observed = await authority.observe();
  assert.equal(observed.roomForWorker, true);
  assert.equal(observed.roomForVerify, false);
  let queued = null;
  await assert.rejects(
    authority.acquire('verify', { holder: 'verdict', onQueued: (row) => { queued = row; } }),
    (error) => {
      assert.equal(error.code, 'host_capacity_queue_timeout');
      assert.equal(error.leaseKind, 'verify');
      assert.equal(error.shortfall.dimension, 'memory');
      assert.equal(error.shortfall.observed, Math.floor(3.9 * G));
      assert.equal(error.shortfall.required, 9 * Math.floor((16 * G) / 10));
      assert.equal(error.bypass, HOST_CAPACITY_BYPASS);
      assert.match(error.message, /waiting on memory: \d+ bytes observed, \d+ required/u);
      assert.match(error.message, /BATON_HOST_CAPACITY_DISABLED=1/u);
      return true;
    },
  );
  assert.equal(queued.shortfall.dimension, 'memory', 'the queued row already names the dimension');
  assert.equal(authority.observeNow().queue.length, 0,
    'a spent wait withdraws its own queue record — no phantom entry survives the refusal (read without the sweep)');
  authority.release(worker.token);
});

test('HC-14 (#329): a recruit the host cannot admit is visible on swarm.view — recruit_queued while waiting, recruit_queue_timeout after, with the seat, the dimension and the bypass — and both ride the wake classes', async (t) => {
  assert.ok(WAKE_CLASSES.includes('queued'), 'the queue-to-admit timeline is a wake class');
  const root = leaseRoot(t);
  // A saturated host (load 9 on 4 cores): every recruit queues on load and times out. Memory
  // never gates a worker — it holds no derived share.
  const observation = () => ({ cores: 4, totalBytes: 8 * G, freeBytes: 1 * G, availableBytes: 1 * G, load1m: 9 });
  const authority = new HostCapacityAuthority({ root, residentId: 'tight', observation, pollMs: 10, waitMs: 120 });
  const f = swarmFixture(t, { hostCapacity: authority });
  await f.call('create', { purpose: 'Recruit on a tight host' });
  const pending = f.call('recruit', { participantId: 'starved', objective: 'Cannot start' });
  await new Promise((resolve) => { setTimeout(resolve, 40); });
  const waiting = await f.call('view', {});
  const queuedRow = waiting.attention.find((row) => row.kind === 'recruit_queued');
  assert.ok(queuedRow, 'while queued, the view names the seat that waits');
  assert.equal(queuedRow.participantId, 'starved');
  assert.equal(queuedRow.shortfall.dimension, 'load');
  assert.equal(waiting.admission.find((row) => row.participantId === 'starved').state, 'queued');
  await assert.rejects(pending, (error) => error.code === 'host_capacity_queue_timeout');
  assert.equal(authority.observeNow().queue.length, 0, 'the refused recruit left no queue record behind');
  const timeoutRows = f.store.eventsView().filter((event) => event.kind === 'driver.recorded' && event.payload.kind === 'swarm.admission_timeout');
  assert.equal(timeoutRows.length, 1, 'the spent wait is recorded against the seat');
  assert.equal(timeoutRows[0].payload.participantId, 'starved');
  assert.equal(timeoutRows[0].payload.shortfall.dimension, 'load');
  assert.equal(timeoutRows[0].payload.bypass, HOST_CAPACITY_BYPASS);
  const after = await f.call('view', {});
  const timeoutRow = after.attention.find((row) => row.kind === 'recruit_queue_timeout');
  assert.ok(timeoutRow, 'after the wait, the view says the host refused this seat');
  assert.equal(timeoutRow.participantId, 'starved');
  assert.equal(timeoutRow.code, 'host_capacity_queue_timeout');
  assert.equal(timeoutRow.shortfall.dimension, 'load');
  assert.equal(timeoutRow.bypass, HOST_CAPACITY_BYPASS);
  assert.deepEqual(timeoutRow.next, { command: 'swarm.recruit', swarmId: 'baton', participantId: 'starved' });
  assert.equal(after.admission.find((row) => row.participantId === 'starved').state, 'timed_out');
  assert.equal(f.workers.length, 0, 'no starved work ever started');
});
