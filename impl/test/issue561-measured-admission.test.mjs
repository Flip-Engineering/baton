// Issue #561: worker and suite admission must be memory- and disk-aware.
//
// A restarted swarm drove this 16 GB host to swap exhaustion: the resident reported
// `memoryTight: true` while it held 39 worker leases, because a worker lease weighed NOTHING in
// the budget (`roomFor('worker')` answered true unconditionally), and a suite a worker seat
// started took the degraded answer — no verify lease at all — because the standing-tight escape
// fires before any wait. This file pins the measured-admission law:
//
//   observation   the host's swap (darwin vm.swapusage, linux /proc/meminfo) and the free disk of
//                 the lease root's filesystem are measured beside RAM; a STAGED observation reads
//                 only its own numbers, never the machine
//   derivation    the swap headroom the OS can actually use is capped by the disk that must back
//                 it (`swapGrowthBytes = min(swapFree, diskFree)`), `pagingBytes` adds it to
//                 available memory, and a verdict's memory entitlement is ONE core share — the
//                 every-core-shares number was a hardware analogy, retired for workers by the
//                 2026-09-18 ruling and now for suites by #561
//   admission     a worker's weight is the MEASURED mean bytes of the measured worker leases, so
//                 the 39th queued seat is visible in the budget it exhausted; an unmeasured first
//                 worker is admitted weight-free (the host learns the footprint from the workers
//                 it runs); `observeWorkerBytes` is how a measurement lands on an admitted lease
//   suites        a verify request may name itself `durable`: a standing-tight host then queues
//                 the request (no deadline) instead of answering degraded — a suite a worker seat
//                 started takes the same verify lease as a landing gate
//
// Red-before: written before the implementation; rows M561-1..M561-9 fail at HEAD (no swap/disk
// parse, no measured worker accounting, no durable admission, no observeWorkerBytes) and pass
// once the mechanism lands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  HostCapacityAuthority,
  deriveHostCapacity,
  hostCapacityObservation,
  hostCapacityShortfall,
  parseMemInfoAvailable,
  parseSwapUsage,
  parseMemInfoSwap,
} from '../src/host-capacity.mjs';
import { suiteLeaseDurable } from '../scripts/suite-host-lease.mjs';

const G = 1024 ** 3;
const M = 1024 ** 2;
const NOW = Date.parse('2026-09-23T04:00:00.000Z');

function leaseRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-m561-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** A fully staged observation: the machine is never read (the swap/disk readers, when this file
 * exercises the measurement layer, throw if they are reached). */
function stagedObservation(host) {
  return () => ({
    cores: 4, totalBytes: 32 * G, freeBytes: host.availableBytes,
    availableBytes: host.availableBytes, load1m: 1,
    ...(host.swapTotalBytes !== undefined ? { swapTotalBytes: host.swapTotalBytes } : {}),
    ...(host.swapFreeBytes !== undefined ? { swapFreeBytes: host.swapFreeBytes } : {}),
    ...(host.diskFreeBytes !== undefined ? { diskFreeBytes: host.diskFreeBytes } : {}),
    ...(host.diskTotalBytes !== undefined ? { diskTotalBytes: host.diskTotalBytes } : {}),
  });
}

function stageLease(root, { kind, holder, bytes, acquiredAt }) {
  const nonce = randomBytes(16).toString('hex');
  const record = {
    schemaVersion: 1, kind, holder, nonce, pid: process.pid,
    residentId: 'deployment-m561', acquiredAt,
    ...(bytes !== undefined ? { bytes } : {}),
  };
  const dir = join(root, 'leases');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `lease-${kind}-${nonce}.json`);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return Object.freeze(record);
}

function authority(root, host, extra = {}) {
  return new HostCapacityAuthority({
    root, residentId: 'deployment-m561', observation: stagedObservation(host),
    now: () => NOW, pollMs: 10, ...extra,
  });
}

// ── M561-1: the swap reports parse ────────────────────────────────────────────────────────────────

test('M561-1: darwin vm.swapusage and linux /proc/meminfo swap lines parse to bytes', () => {
  const darwin = parseSwapUsage(
    'vm_swapusage: total = 10240.00M  used = 9216.00M  free = 1024.00M  (encrypted)',
  );
  assert.deepStrictEqual(darwin, {
    totalBytes: 10 * G, usedBytes: 9 * G, freeBytes: 1 * G,
  });
  assert.strictEqual(parseSwapUsage('not a swap report'), null);

  const linux = parseMemInfoSwap(
    'MemTotal:       16384000 kB\nSwapTotal:       2097152 kB\nSwapFree:        1048576 kB\n',
  );
  assert.deepStrictEqual(linux, {
    totalBytes: 2 * G, freeBytes: 1 * G, usedBytes: 1 * G,
  });
  assert.strictEqual(parseMemInfoSwap('MemTotal:       16384000 kB\n'), null);
  // The existing MemAvailable parse stays exactly what it was.
  assert.strictEqual(parseMemInfoAvailable('MemAvailable:    2684354 kB\n'), 2684354 * 1024);
});

// ── M561-2: the observation measures swap and disk, and honors the staged law ─────────────────────

test('M561-2: observation reads swap and disk through its injectable readers only', () => {
  const calls = [];
  const fail = (name) => () => { calls.push(name); throw new Error(`${name} must not be read`); };
  // Staged: freeBytes names a number, so the staged law applies — the machine is never reached,
  // and swap/disk read as unmeasured (null) unless the caller stages them.
  const staged = hostCapacityObservation({
    cores: 4, totalBytes: 32 * G, freeBytes: 8 * G, load1m: 0,
    vmStat: fail('vm_stat'), memInfo: fail('/proc/meminfo'),
    swapUsage: fail('vm.swapusage'), statfs: fail('statfs'),
  });
  assert.strictEqual(staged.swapFreeBytes, null);
  assert.strictEqual(staged.diskFreeBytes, null);
  assert.deepStrictEqual(calls, []);

  // Memory terms staged explicitly (the RAM path is not this row's subject); swap and disk are
  // measured through the injected platform readers, never the real machine.
  const measured = hostCapacityObservation({
    cores: 4, totalBytes: 32 * G, load1m: 0, availableBytes: 8 * G,
    swapUsage: () => 'vm_swapusage: total = 2048.00M  used = 512.00M  free = 1536.00M (encrypted)',
    statfs: () => ({ blocks: 100 * G / 512, bsize: 512, bavail: 40 * G / 512 }),
  });
  assert.strictEqual(measured.availableBytes, 8 * G);
  assert.strictEqual(measured.swapFreeBytes, 1536 * M);
  assert.strictEqual(measured.diskFreeBytes, 40 * G);
  assert.strictEqual(measured.diskTotalBytes, 100 * G);
});

// ── M561-3: the derivation couples swap to disk and sizes one verdict at one share ───────────────

test('M561-3: pagingBytes caps swap by disk; suiteBytes is one core share; tightness derives', () => {
  // 4 cores, 32 GiB: one share 8 GiB. available 2 GiB, swap free 6 GiB, disk free 4 GiB —
  // the swap the OS could actually page into is the disk-capped 4 GiB, so paging is 6 GiB.
  const capacity = deriveHostCapacity(stagedObservation({
    availableBytes: 2 * G, swapTotalBytes: 8 * G, swapFreeBytes: 6 * G,
    diskFreeBytes: 4 * G, diskTotalBytes: 64 * G,
  })());
  assert.strictEqual(capacity.coreShareBytes, 8 * G);
  assert.strictEqual(capacity.suiteBytes, 8 * G, 'one verdict is entitled to ONE core share of memory');
  assert.strictEqual(capacity.swapGrowthBytes, 4 * G);
  assert.strictEqual(capacity.pagingBytes, 6 * G);
  assert.strictEqual(capacity.memoryTight, true, '6 GiB of paging headroom does not fund an 8 GiB share');
  assert.strictEqual(capacity.diskTight, true, '4 GiB of free disk does not back one 8 GiB verdict');

  // The incident shape: available near zero, swap nearly full, disk nearly empty — the paging
  // headroom collapses to what the disk can still back, and both dimensions read tight.
  const exhausted = deriveHostCapacity(stagedObservation({
    availableBytes: 1 * G, swapTotalBytes: 10 * G, swapFreeBytes: 1 * G,
    diskFreeBytes: 512 * M, diskTotalBytes: 64 * G,
  })());
  assert.strictEqual(exhausted.swapGrowthBytes, 512 * M);
  assert.strictEqual(exhausted.memoryTight, true);
  assert.strictEqual(exhausted.diskTight, true);
  // Unmeasured swap or disk claims no headroom: the derivation falls back to RAM only, the
  // behavior every pre-#561 staged observation already had.
  const unmeasured = deriveHostCapacity(stagedObservation({ availableBytes: 2 * G })());
  assert.strictEqual(unmeasured.swapGrowthBytes, 0);
  assert.strictEqual(unmeasured.pagingBytes, 2 * G);
  assert.strictEqual(unmeasured.diskTight, false);
});

// ── M561-4: a worker weighs the measured mean bytes of the measured worker leases ────────────────

test('M561-4: measured worker leases enter the byte budget and an over-budget worker queues', async (t) => {
  const root = leaseRoot(t);
  // usable budget = 32 GiB − 8 GiB share = 24 GiB. 24 measured workers at 512 MiB hold exactly
  // 12 GiB... the interesting case is the budget edge, so stage the full 24 GiB: the next worker
  // finds no room and must WAIT, with the measured mean as the weight it names.
  const host = { availableBytes: 8 * G };
  const auth = authority(root, host);
  for (let index = 0; index < 48; index += 1) {
    stageLease(root, {
      kind: 'worker', holder: `participant:swarm:seat-${index}`, bytes: 512 * M,
      acquiredAt: new Date(NOW + index).toISOString(),
    });
  }
  const usedNow = auth.observeNow().used;
  assert.strictEqual(usedNow.leases.worker, 48);
  assert.strictEqual(usedNow.bytes, 48 * 512 * M, 'the measured bytes the admitted workers hold enter the budget');
  assert.strictEqual(auth.observeNow().roomForWorker, false, '24 GiB held against a 24 GiB budget: no room');

  const queued = [];
  const pending = auth.acquire('worker', {
    holder: 'participant:swarm:seat-48',
    onQueued: (row) => queued.push(row),
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(queued.length >= 1, 'the queued row was reported');
  assert.strictEqual(queued[0].shortfall.dimension, 'budget');
  assert.strictEqual(queued[0].shortfall.unit, 'bytes');
  assert.strictEqual(queued[0].shortfall.required, 512 * M, 'the weight is the measured mean per worker');

  // Forty leases return to the budget: the queued seat is admitted in order, still against
  // the measured mean weight of the fleet that remains.
  for (let index = 0; index < 40; index += 1) {
    rmSync(join(root, 'leases', readdirSync(join(root, 'leases')).sort()[0]), { force: true });
  }
  const outcome = await pending;
  assert.ok(outcome.token, 'the queued worker is admitted once the budget funds it');
});

// ── M561-5: the first worker is weight-free — the host learns the footprint from its workers ─────

test('M561-5: an unmeasured worker fleet admits the first worker free', async (t) => {
  const root = leaseRoot(t);
  const host = { availableBytes: 1 * G };
  const auth = authority(root, host);
  const outcome = await auth.acquire('worker', { holder: 'participant:swarm:first' });
  assert.ok(outcome.token, 'no measurement exists yet, so the budget names no weight to wait on');
});

// ── M561-6: observeWorkerBytes lands a measurement on an admitted worker lease ───────────────────

test('M561-6: observeWorkerBytes rewrites the lease measurement and the budget follows', async (t) => {
  const root = leaseRoot(t);
  const host = { availableBytes: 8 * G };
  const auth = authority(root, host);
  const admitted = await auth.acquire('worker', { holder: 'participant:swarm:seat' });
  assert.ok(admitted.token);

  assert.strictEqual(
    await auth.observeWorkerBytes('participant:swarm:seat', admitted.token.nonce, 400 * M),
    true, 'this resident owns the lease, so the measurement lands',
  );
  const observed = auth.observeNow();
  assert.strictEqual(observed.used.bytes, 400 * M);
  assert.strictEqual(observed.used.workerMeasured, 1);

  assert.strictEqual(
    await auth.observeWorkerBytes('participant:swarm:seat', admitted.token.nonce, 600 * M),
    true, 'a fresh measurement replaces the stale one',
  );
  assert.strictEqual(auth.observeNow().used.bytes, 600 * M);

  const stranger = new HostCapacityAuthority({
    root, residentId: 'another-resident', observation: stagedObservation(host),
    now: () => NOW, pollMs: 10,
  });
  assert.strictEqual(
    await stranger.observeWorkerBytes('participant:swarm:seat', admitted.token.nonce, 1 * G),
    false, 'a lease another resident owns is not ours to rewrite',
  );
  assert.strictEqual(auth.observeNow().used.bytes, 600 * M);
});

// ── M561-7: a durable verify request queues on a standing-tight host; a plain one degrades ───────

test('M561-7: durable verify waits out standing tightness; plain verify keeps the degraded answer', async (t) => {
  const root = leaseRoot(t);
  const host = { availableBytes: 1 * G, swapFreeBytes: 0, diskFreeBytes: 8 * G };
  const auth = authority(root, host, { pollMs: 10 });
  // 1 GiB RAM + 0 swap against an 8 GiB share: standing tight.

  const degraded = await auth.acquire('verify', { holder: 'run-suite:1' });
  assert.strictEqual(degraded.token, null);
  assert.ok(degraded.degraded, 'a runner outside a swarm proceeds at once, the shortfall named');

  const queued = [];
  const pending = auth.acquire('verify', {
    holder: 'participant:swarm:verifier', durable: true,
    onQueued: (row) => queued.push(row),
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(queued.length >= 1, 'the durable request is queued, not degraded');

  // The host gets room (a paging wave completes): the queued request is admitted in order.
  host.availableBytes = 16 * G;
  host.swapFreeBytes = 8 * G;
  const outcome = await pending;
  assert.ok(outcome.token, 'the durable request is admitted when the host can fund it');
});

// ── M561-8: the shortfall names the paging numbers ───────────────────────────────────────────────

test('M561-8: a memory shortfall reads observed paging bytes and required share', () => {
  const capacity = deriveHostCapacity(stagedObservation({
    availableBytes: 1 * G, swapTotalBytes: 2 * G, swapFreeBytes: 512 * M,
    diskFreeBytes: 8 * G, diskTotalBytes: 64 * G,
  })());
  const shortfall = hostCapacityShortfall('verify', capacity, { cores: 0, bytes: 0 });
  assert.strictEqual(shortfall.dimension, 'memory');
  assert.strictEqual(shortfall.observed, 1 * G + 512 * M, 'the observed number is the paging headroom');
  assert.strictEqual(shortfall.required, 8 * G);
  assert.strictEqual(shortfall.unit, 'bytes');
});

// ── M561-9: the runner names its suite durable exactly when a worker seat started it ─────────────

test('M561-9: suiteLeaseDurable is true for a participant holder and false otherwise', () => {
  assert.strictEqual(
    suiteLeaseDurable({ BATON_SWARM_BRIDGE_SWARM_ID: 'swarm-x', BATON_SWARM_BRIDGE_PARTICIPANT_ID: 'seat-1' }),
    true, 'a suite a worker seat started waits for the same lease a landing gate takes',
  );
  assert.strictEqual(suiteLeaseDurable({}), false, 'a runner outside a swarm keeps the degraded answer');
  assert.strictEqual(suiteLeaseDurable('run-suite:4242'), false, 'the pid holder is not a seat');
});
