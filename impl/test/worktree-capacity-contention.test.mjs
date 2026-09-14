// Independent deployment processes open one repository and mutate one reservation ledger at the
// same time. These contracts pin the cross-process coordination repair:
//
//   * ordinary live lock contention is WAITED OUT (bounded by `lockWaitMs`) instead of refused,
//   * a live holder is never stolen from, and a live holder that never releases produces a typed
//     PRE-EFFECT refusal naming the deadline — never an unbounded wait,
//   * a proved-dead holder is reaped exactly once by contending deployments,
//   * an abandoned reaper gate (a reaper killed mid-reap) is inert but never stolen: reclamation
//     of the dead lock it blocks refuses at the deadline with the gate untouched, and removing
//     the gate (an operator action) restores reclamation,
//   * corrupt or ambiguous lock artifacts refuse immediately and are never deleted,
//   * reconcile() settles a verifier only when its owner process is proved dead — an own live
//     verification keeps its reservation (it may be running in this process), a LIVE FOREIGN
//     controller's verifier is preserved byte-for-byte (same pid or not), while the generation
//     whose active worker the caller adopts counts as superseded.
// Every concurrency case drives REAL child processes through a filesystem barrier, so overlap is
// real rather than an in-process simulation. The children hold the critical section open with an
// injected `observe` that blocks on `Atomics.wait`: the lock is held across real syscalls, so the
// contention is deterministic instead of timing-dependent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WorktreeCapacityAuthority, loadOrCreateWorktreeCapacityIntegrityKey } from '../src/worktree-capacity.mjs';

const SOURCE_URL = new URL('../src/worktree-capacity.mjs', import.meta.url).href;
const REFUSAL_CODE = 'worktree_capacity_unavailable';
const LOCK_WAIT_CEILING = 3_600_000; // any non-negative safe integer is accepted: no platform cap

const POLICY = Object.freeze({
  maxReservedBytes: 10_000_000, maxReservedInodes: 100_000,
  minFreeBytes: 100, minFreeInodes: 10,
  runtimeReserveBytes: 20, runtimeReserveInodes: 2,
});
const REQUEST = Object.freeze({
  baseSha: 'a'.repeat(40),
  sparseCheckoutIdentity: { digest: 'b'.repeat(64) },
  toolchainProjection: null,
  toolchainProjectionTargetParents: [],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(fn, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(5);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function repoWorld(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-capacity-contention-${label}-`));
  const repo = join(dir, 'repo');
  mkdirSync(repo, { mode: 0o700 });
  return {
    dir, repo, capacity: join(repo, '.baton', 'capacity'),
    barrier: join(dir, 'barrier'), fixture: join(dir, 'child.mjs'),
  };
}

// The child fixture is one real deployment: it builds the production authority against the shared
// repository, synchronizes on a filesystem barrier with its peers, and reports its outcome as data.
function childSource() {
  return `
import fs from 'node:fs';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { WorktreeCapacityAuthority, loadOrCreateWorktreeCapacityIntegrityKey } from ${JSON.stringify(SOURCE_URL)};

const [repoArg, planPath, barrierDir, outPath] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const napBuffer = new Int32Array(new SharedArrayBuffer(4));
const nap = (ms) => { Atomics.wait(napBuffer, 0, 0, ms); };
const peers = plan.peers ?? 1;

// Announce, then spin until every peer has arrived, so the reservations below overlap for real.
function barrier(name) {
  // Always announce (a lone child's 'booted' announcement is the parent's timing signal); only a
  // real peer set spins for the others.
  fs.writeFileSync(join(barrierDir, name + '.' + process.pid), '');
  if (peers <= 1) return;
  const deadline = Date.now() + 30000;
  for (;;) {
    const arrived = fs.readdirSync(barrierDir).filter((entry) => entry.startsWith(name + '.')).length;
    if (arrived >= peers) return;
    if (Date.now() > deadline) throw new Error('barrier ' + name + ' timed out');
    nap(5);
  }
}

function awaitPath(path, label) {
  const deadline = Date.now() + 30000;
  while (!fs.existsSync(path)) {
    if (Date.now() > deadline) throw new Error(label + ' timed out');
    nap(5);
  }
}

// A deterministic instantiation of the ordinary race this protocol must absorb: the artifact is
// observed (stat succeeds) and then vanishes (a holder releases, a reaper renames it away) before
// it is read. Patching the read removes the timing dependence, exactly as the capacity-key suite
// does for its creation races, and the flag proves the race actually fired.
let sabotageFired = false;
if (plan.sabotage) {
  const capacityRoot = join(fs.realpathSync(repoArg), '.baton', 'capacity');
  const target = plan.sabotage === 'gate' ? join(capacityRoot, 'lock.reaper') : join(capacityRoot, 'lock');
  const realReadFileSync = fs.readFileSync;
  fs.readFileSync = (path, ...rest) => {
    if (!sabotageFired && path === target) { sabotageFired = true; fs.rmSync(target, { force: true }); }
    return realReadFileSync(path, ...rest);
  };
  syncBuiltinESMExports();
}

const started = Date.now();
// The parent polls this file while the child is still running, so every report lands by rename:
// a reader sees the previous complete report or the new one, never a partial write (WCC8/WCC9
// failed with "Unexpected end of JSON input" under host load when a poll landed mid-write).
const write = (value) => {
  const staged = outPath + '.' + process.pid + '.tmp';
  fs.writeFileSync(staged, JSON.stringify({ ...value, elapsed: Date.now() - started, completedAt: Date.now(), pid: process.pid, sabotageFired }));
  fs.renameSync(staged, outPath);
};
// Alive and about to contend: the parent measures any hold it stages from this signal, never from
// its own spawn call (the authority may take the lock as early as its construction).
barrier('booted');
const authority = new WorktreeCapacityAuthority({
  repoRoot: fs.realpathSync(repoArg),
  policy: plan.policy,
  integrityKey: loadOrCreateWorktreeCapacityIntegrityKey(repoArg),
  // The estimate runs before the lock; the observation runs INSIDE it. Blocking here therefore
  // holds the critical section open across real syscalls, which is the overlap under test.
  estimate: () => ({ bytes: plan.bytes, inodes: plan.inodes }),
  observe: () => { nap(plan.holdMs ?? 0); return { freeBytes: plan.freeBytes, freeInodes: plan.freeInodes }; },
  ...(plan.lockWaitMs === undefined ? {} : { lockWaitMs: plan.lockWaitMs }),
});

barrier('ready');
const tokens = [];
try {
  if (plan.mode === 'materialize') {
    const token = authority.reserve(plan.ids[0], plan.request);
    tokens.push(token.id);
    write({ ok: true, stage: 'reserved', tokens });
    awaitPath(plan.goPath, 'go');
    const materialized = authority.materialize(token, plan.resourcePath);
    write({ ok: true, stage: 'materialized', tokens, materializedAt: materialized.materializedAt });
    awaitPath(plan.donePath, 'done');
  } else {
    for (const id of plan.ids) {
      const token = authority.reserve(id, plan.request);
      tokens.push(token.id);
      if (plan.holdAfterReserveMs) nap(plan.holdAfterReserveMs);
      authority.release(token);
    }
    write({ ok: true, tokens });
  }
} catch (error) {
  write({
    ok: false, tokens, code: error?.code ?? null, name: error?.name ?? null,
    message: String(error?.message ?? error), lockContention: error?.lockContention === true,
    holderPid: error?.holderPid ?? null,
  });
}
`;
}

function writePlan(world, plan) {
  const path = join(world.dir, `plan-${plan.label ?? 'run'}.json`);
  writeFileSync(path, JSON.stringify({
    policy: POLICY, request: REQUEST, freeBytes: 10_000_000, freeInodes: 100_000,
    bytes: 60, inodes: 5, ...plan,
  }));
  return path;
}

function launch(world, planPath, outName, children) {
  const outPath = join(world.dir, outName);
  const child = spawn(process.execPath, [world.fixture, world.repo, planPath, world.barrier, outPath], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  children.push(child);
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const settled = new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: -1, stderr: String(error) }));
    child.once('close', (code) => resolve({ code, stderr }));
  });
  return {
    child, outPath, settled,
    outcome: () => JSON.parse(readFileSync(outPath, 'utf8')),
    report: () => (existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : null),
  };
}

function prepareWorld(world, children) {
  mkdirSync(world.barrier, { recursive: true, mode: 0o700 });
  writeFileSync(world.fixture, childSource());
  children.push({ kill: () => {} });
}

function authorityFor(repo, { lockWaitMs } = {}) {
  return new WorktreeCapacityAuthority({
    repoRoot: repo, policy: POLICY, integrityKey: loadOrCreateWorktreeCapacityIntegrityKey(repo),
    estimate: () => ({ bytes: 60, inodes: 5 }),
    observe: () => ({ freeBytes: 10_000_000, freeInodes: 100_000 }),
    ...(lockWaitMs === undefined ? {} : { lockWaitMs }),
  });
}

function ownerRecord({ pid = process.pid, ownerId = 'c'.repeat(32), generation = 'd'.repeat(32) } = {}) {
  return `${JSON.stringify({ schemaVersion: 1, pid, ownerId, generation })}\n`;
}

function plantArtifact(world, name, payload, { mode = 0o600 } = {}) {
  mkdirSync(world.capacity, { recursive: true, mode: 0o700 });
  const path = join(world.capacity, name);
  writeFileSync(path, payload, { mode });
  return { path, payload };
}

function deadPid() {
  // A real, provably dead pid: spawn a trivial process and wait for it to be reaped.
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  assert.equal(child.status, 0);
  return child.pid;
}

function disposable(world, children) {
  return () => {
    for (const child of children) { try { child.kill('SIGKILL'); } catch { /* already exited */ } }
    rmSync(world.dir, { recursive: true, force: true });
  };
}

function cleanCapacityRoot(world) {
  assert.deepEqual(readdirSync(world.capacity).sort(), ['integrity.key', 'reservations.json'],
    'no lock, gate, tombstone, or publication temp may survive a completed deployment');
}

test('WCC1: simultaneous deployments reserve and release through live contention without a refusal', { timeout: 60_000 }, async (t) => {
  const world = repoWorld('simultaneous');
  const children = [];
  t.after(disposable(world, children));
  prepareWorld(world, children);

  const deployments = 4;
  const cycles = 3;
  const base = { peers: deployments, holdMs: 15, label: 'simultaneous' };
  const runs = [];
  for (let index = 0; index < deployments; index += 1) {
    const planPath = writePlan(world, {
      ...base, label: `simultaneous-${index}`,
      ids: Array.from({ length: cycles }, (_, cycle) => `worker:deployment-${index}-${cycle}`),
    });
    runs.push(launch(world, planPath, `out-${index}.json`, children));
  }
  const settlements = await Promise.all(runs.map((run) => run.settled));
  settlements.forEach((settlement, index) => assert.equal(settlement.code, 0, settlement.stderr));
  for (const run of runs) {
    const outcome = run.outcome();
    assert.equal(outcome.ok, true,
      `a deployment refused ordinary live contention: ${outcome.code} ${outcome.message ?? ''}`);
  }

  const observed = authorityFor(world.repo).snapshot();
  assert.deepEqual(observed.reservations, [], 'every concurrent reservation was released exactly once');
  assert.deepEqual(observed.totals, { bytes: 0, inodes: 0 });
  cleanCapacityRoot(world);
});

test('WCC2: live contention is waited out, and the live holder keeps its lock', { timeout: 60_000 }, async (t) => {
  const world = repoWorld('wait-live');
  const children = [];
  const planted = plantArtifact(world, 'lock', ownerRecord());
  let observedWhileHeld = null;
  let releasedAt = null;
  let release = null;
  t.after(() => { if (release) clearTimeout(release); disposable(world, children)(); });
  prepareWorld(world, children);

  const planPath = writePlan(world, { holdMs: 0, ids: ['worker:waited'], lockWaitMs: 20_000 });
  const run = launch(world, planPath, 'waited.json', children);
  // The hold is measured from the moment the child is booted and about to contend — never from
  // the parent's spawn call: under host load Node's boot ate the 400ms and the child arrived after
  // the release (#257 WCC2). The proof of waiting is one clock, not two: the child completed after
  // the parent released.
  await until(() => readdirSync(world.barrier).some((entry) => entry.startsWith('booted.')), 'the booted child');
  release = setTimeout(() => {
    observedWhileHeld = readFileSync(planted.path, 'utf8');
    rmSync(planted.path, { force: true });
    releasedAt = Date.now();
  }, 400);
  await run.settled;
  const outcome = run.outcome();
  assert.equal(outcome.ok, true,
    `a bounded wait must absorb a 400ms live hold: ${outcome.code} ${outcome.message ?? ''}`);
  assert.equal(observedWhileHeld, planted.payload,
    'the live holder record is untouched for as long as it appears live');
  assert.equal(typeof releasedAt, 'number', 'the holder was released while the child stood at the lock');
  assert.ok(outcome.completedAt >= releasedAt,
    `the deployment must wait for the holder (completed ${outcome.completedAt - releasedAt}ms after the release; elapsed ${outcome.elapsed}ms)`);
});

test('WCC3: a live holder past the deadline refuses pre-effect, untouched and never stolen', { timeout: 60_000 }, async (t) => {
  const world = repoWorld('deadline');
  const children = [];
  const planted = plantArtifact(world, 'lock', ownerRecord());
  t.after(disposable(world, children));
  prepareWorld(world, children);

  const planPath = writePlan(world, { holdMs: 0, ids: ['worker:timeout'], lockWaitMs: 250 });
  const run = launch(world, planPath, 'timeout.json', children);
  await run.settled;
  const outcome = run.outcome();
  assert.equal(outcome.ok, false, 'a holder that never releases is refused, never adopted');
  assert.equal(outcome.code, REFUSAL_CODE);
  assert.equal(outcome.name, 'WorktreeCapacityError');
  assert.equal(outcome.lockContention, true, 'the refusal is identified as pre-effect lock contention');
  assert.equal(outcome.holderPid, process.pid);
  assert.match(outcome.message, /wait deadline/u);
  assert.ok(outcome.elapsed >= 250 && outcome.elapsed < 10_000,
    `the wait is bounded by the deadline, never unlimited (elapsed ${outcome.elapsed}ms)`);
  assert.equal(readFileSync(planted.path, 'utf8'), planted.payload, 'the live lock is never modified or reaped');
  assert.equal(existsSync(join(world.capacity, 'reservations.json')), false,
    'the refusal is PRE-effect: no ledger byte was written');

  rmSync(planted.path, { force: true });
  const retry = launch(world, planPath, 'retry.json', children);
  await retry.settled;
  assert.equal(retry.outcome().ok, true, 'capacity is available again the moment the live holder releases');
});

test('WCC4: concurrent deployments reap one proved-dead holder exactly once and converge', { timeout: 60_000 }, async (t) => {
  const world = repoWorld('reap-dead');
  const children = [];
  t.after(disposable(world, children));
  prepareWorld(world, children);

  const planted = plantArtifact(world, 'lock', ownerRecord({ pid: deadPid() }));
  const base = { peers: 2, holdMs: 10, label: 'reap-dead' };
  const runs = [];
  for (let index = 0; index < 2; index += 1) {
    const planPath = writePlan(world, { ...base, label: `reap-dead-${index}`, ids: [`worker:reaper-${index}`] });
    runs.push(launch(world, planPath, `reaper-${index}.json`, children));
  }
  const settlements = await Promise.all(runs.map((run) => run.settled));
  settlements.forEach((settlement, index) => assert.equal(settlement.code, 0, settlement.stderr));
  for (const run of runs) {
    const outcome = run.outcome();
    assert.equal(outcome.ok, true,
      `a proved-dead holder must be reaped, not refused: ${outcome.code} ${outcome.message ?? ''}`);
  }
  assert.equal(existsSync(planted.path), false, 'the proved-dead generation is reaped');
  assert.deepEqual(authorityFor(world.repo).snapshot().reservations, []);
  cleanCapacityRoot(world);
});

test('WCC5: an abandoned reaper gate is never stolen; the dead lock it blocks refuses at the deadline', { timeout: 60_000 }, async (t) => {
  const abandoned = repoWorld('abandoned-gate');
  const abandonedChildren = [];
  t.after(disposable(abandoned, abandonedChildren));
  prepareWorld(abandoned, abandonedChildren);

  const dead = deadPid();
  const gate = plantArtifact(abandoned, 'lock.reaper', ownerRecord({ pid: dead }));
  const stale = plantArtifact(abandoned, 'lock', ownerRecord({ pid: dead, ownerId: 'e'.repeat(32), generation: 'f'.repeat(32) }));
  const wedgedPlan = writePlan(abandoned, {
    holdMs: 0, ids: ['worker:behind-abandoned-gate'], lockWaitMs: 250, label: 'wedged',
  });
  const wedged = launch(abandoned, wedgedPlan, 'wedged.json', abandonedChildren);
  await wedged.settled;
  const outcome = wedged.outcome();
  assert.equal(outcome.ok, false, 'reclamation behind a dead gate is refused, never stolen');
  assert.equal(outcome.code, REFUSAL_CODE);
  assert.match(outcome.message, /dead reaper gate/u, 'the refusal names the abandoned gate');
  assert.ok(outcome.elapsed >= 250 && outcome.elapsed < 10_000,
    `the refusal is bounded by the deadline (elapsed ${outcome.elapsed}ms)`);
  assert.equal(readFileSync(gate.path, 'utf8'), gate.payload, 'the abandoned gate is preserved byte-for-byte');
  assert.equal(readFileSync(stale.path, 'utf8'), stale.payload, 'the dead lock is preserved byte-for-byte');
  assert.equal(existsSync(join(abandoned.capacity, 'reservations.json')), false,
    'the refusal is PRE-effect: no ledger byte was written');

  // The gate is inert, so only an operator can remove it; the next deployment then reclaims the
  // dead lock and proceeds — the wedge is precise, diagnosable, and repairable.
  rmSync(gate.path, { force: true });
  const healedPlan = writePlan(abandoned, {
    holdMs: 0, ids: ['worker:after-gate-removal'], lockWaitMs: 20_000, label: 'healed',
  });
  const healed = launch(abandoned, healedPlan, 'healed.json', abandonedChildren);
  await healed.settled;
  const recovery = healed.outcome();
  assert.equal(recovery.ok, true, `gate removal restores reclamation: ${recovery.code} ${recovery.message ?? ''}`);
  assert.equal(existsSync(stale.path), false, 'the stale generation is reaped once the gate is gone');
  cleanCapacityRoot(abandoned);

  const corrupt = repoWorld('corrupt-gate');
  const corruptChildren = [];
  t.after(disposable(corrupt, corruptChildren));
  prepareWorld(corrupt, corruptChildren);
  const artifact = plantArtifact(corrupt, 'lock.reaper', 'not a gate record\n');
  const corruptPlan = writePlan(corrupt, { holdMs: 0, ids: ['worker:corrupt-gate'], lockWaitMs: 20_000 });
  const refused = launch(corrupt, corruptPlan, 'corrupt.json', corruptChildren);
  await refused.settled;
  const refusal = refused.outcome();
  assert.equal(refusal.ok, false);
  assert.equal(refusal.code, REFUSAL_CODE);
  assert.equal(readFileSync(artifact.path, 'utf8'), artifact.payload,
    'an ambiguous gate artifact is never deleted by the deployment that refuses it');
});

test('WCC6: corrupt or ambiguous locks refuse at once without waiting and are never deleted', { timeout: 120_000 }, async (t) => {
  const artifacts = [
    { label: 'directory', place: (path) => mkdirSync(path, { mode: 0o700 }) },
    { label: 'permissive mode', place: (path) => writeFileSync(path, ownerRecord(), { mode: 0o644 }) },
    { label: 'unreadable record', place: (path) => writeFileSync(path, '{not json', { mode: 0o600 }) },
    { label: 'oversized record', place: (path) => writeFileSync(path, 'x'.repeat(4097), { mode: 0o600 }) },
    {
      label: 'unknown schema',
      place: (path) => writeFileSync(path, `${JSON.stringify({
        schemaVersion: 2, pid: process.pid, ownerId: 'c'.repeat(32), generation: 'd'.repeat(32),
      })}\n`, { mode: 0o600 }),
    },
  ];
  for (const artifact of artifacts) {
    const world = repoWorld(`ambiguous-${artifact.label.replaceAll(' ', '-')}`);
    const children = [];
    t.after(disposable(world, children));
    prepareWorld(world, children);
    mkdirSync(world.capacity, { recursive: true, mode: 0o700 });
    const lockPath = join(world.capacity, 'lock');
    artifact.place(lockPath);

    const planPath = writePlan(world, { holdMs: 0, ids: ['worker:ambiguous'], lockWaitMs: 20_000 });
    const run = launch(world, planPath, 'ambiguous.json', children);
    await run.settled;
    const outcome = run.outcome();
    assert.equal(outcome.ok, false, `${artifact.label}: an ambiguous lock is never adopted`);
    assert.equal(outcome.code, REFUSAL_CODE, `${artifact.label}: typed refusal`);
    assert.ok(outcome.elapsed < 5_000,
      `${artifact.label}: ambiguity refuses immediately instead of burning the wait deadline (elapsed ${outcome.elapsed}ms)`);
    assert.equal(existsSync(lockPath), true, `${artifact.label}: the artifact is preserved, never deleted`);
  }
});

test('WCC7: the lock wait deadline is explicit, bounded, and configurable to fail fast', { timeout: 60_000 }, async (t) => {
  const world = repoWorld('config');
  const children = [];
  t.after(disposable(world, children));
  prepareWorld(world, children);

  const failFast = authorityFor(world.repo, { lockWaitMs: 0 });
  const token = failFast.reserve('worker:fail-fast', REQUEST);
  assert.equal(failFast.release(token), true, 'an uncontended reservation never waits');

  const planted = plantArtifact(world, 'lock', ownerRecord());
  const started = Date.now();
  assert.throws(() => failFast.reserve('worker:fail-fast-again', REQUEST), (error) => (
    error?.code === REFUSAL_CODE && error?.lockContention === true && error?.holderPid === process.pid
  ));
  assert.ok(Date.now() - started < 1_000, 'lockWaitMs 0 refuses at once instead of waiting');
  rmSync(planted.path, { force: true });

  for (const value of [-1, 1.5, '250', null]) {
    assert.throws(() => authorityFor(world.repo, { lockWaitMs: value }), TypeError,
      `lockWaitMs ${String(value)} must be refused at construction`);
  }
  assert.equal(authorityFor(world.repo, { lockWaitMs: LOCK_WAIT_CEILING }).lockWaitMs, LOCK_WAIT_CEILING,
    'the deadline is operator-configurable with no platform cap');
});

test('WCC8: reconcile preserves a live foreign verifier and its materialize still succeeds', { timeout: 60_000 }, async (t) => {
  const world = repoWorld('foreign-verifier');
  const children = [];
  t.after(disposable(world, children));
  prepareWorld(world, children);

  const verifyRoot = join(world.repo, '.baton', 'verify');
  const resourcePath = join(verifyRoot, 'claim-verification-abc123');
  mkdirSync(resourcePath, { recursive: true, mode: 0o700 });
  const goPath = join(world.dir, 'go');
  const donePath = join(world.dir, 'done');
  const planPath = writePlan(world, {
    mode: 'materialize', holdMs: 0, peers: 1, label: 'foreign-verifier',
    ids: ['verify:claim-verification:1'], goPath, donePath, resourcePath,
  });
  const verifier = launch(world, planPath, 'verifier.json', children);

  // The foreign controller is live and holds an unmaterialized verification reservation.
  const reserved = await until(() => {
    const report = verifier.report();
    return report?.stage === 'reserved' ? report : null;
  }, 'the foreign verification reservation');
  const before = authorityFor(world.repo).snapshot().reservations;
  assert.equal(before.length, 1);
  assert.equal(before[0].pid, reserved.pid, 'the reservation names the live foreign controller process');
  assert.equal(before[0].materializedAt, null);

  // A NEW deployment opens the same repository and reconciles while that controller is verifying.
  const report = authorityFor(world.repo).reconcile([]);
  assert.deepEqual(report.removed, [], 'a live foreign verifier is not this deployment\'s to settle');
  assert.deepEqual(report.retainedVerifiers, ['verify:claim-verification:1'],
    'the preserved verifier is reported, not silently kept');
  assert.deepEqual(authorityFor(world.repo).snapshot().reservations, before,
    'the live foreign verifier is preserved byte-for-byte');

  // The exact reported failure: materialize() after a concurrent deployment startup.
  writeFileSync(goPath, '');
  const materialized = await until(() => {
    const state = verifier.report();
    return state?.stage === 'materialized' ? state : null;
  }, 'the foreign materialization');
  assert.equal(typeof materialized.materializedAt, 'string',
    'the live foreign controller materializes its own reservation after the other deployment reconciled');
  writeFileSync(donePath, '');
  await verifier.settled;
});

test('WCC9: reconcile keeps a live verifier and still settles a proved-dead one', { timeout: 60_000 }, async (t) => {
  const world = repoWorld('verifier-settlement');
  const children = [];
  t.after(disposable(world, children));
  prepareWorld(world, children);

  // G-35: this authority's own verification may be running in this process right now, so its
  // reservation is live capacity — reconcile keeps it byte-for-byte until its owner releases it.
  const deployment = authorityFor(world.repo);
  const owned = deployment.reserve('verify:owned:1', REQUEST);
  const ownedBefore = deployment.snapshot().reservations;
  const ownedReport = deployment.reconcile([]);
  assert.deepEqual(ownedReport.removed, [],
    'a live verification of this authority is not reconcile\'s to settle');
  assert.deepEqual(ownedReport.retainedVerifiers, ['verify:owned:1']);
  assert.deepEqual(deployment.snapshot().reservations, ownedBefore,
    'the live reservation survives byte-for-byte');
  assert.equal(deployment.release(owned), true, 'its owner releases it');
  assert.deepEqual(authorityFor(world.repo).snapshot().reservations, []);

  // A verifier whose process is gone is settled: capacity is never leaked by the preservation rule.
  const planPath = writePlan(world, {
    mode: 'materialize', holdMs: 0, peers: 1, label: 'crashed-verifier',
    ids: ['verify:crashed-verification:1'], goPath: join(world.dir, 'never'),
    donePath: join(world.dir, 'never-2'), resourcePath: join(world.repo, '.baton', 'verify', 'crashed-verification-x'),
  });
  const crashed = launch(world, planPath, 'crashed.json', children);
  const reserved = await until(() => {
    const report = crashed.report();
    return report?.stage === 'reserved' ? report : null;
  }, 'the crashed verification reservation');
  crashed.child.kill('SIGKILL');
  await crashed.settled;

  const crashReport = authorityFor(world.repo).reconcile([]);
  assert.deepEqual(crashReport.removed, ['verify:crashed-verification:1'],
    `a dead foreign verifier is settled (pid ${reserved.pid} is gone)`);
  assert.deepEqual(crashReport.retainedVerifiers, []);
  assert.deepEqual(authorityFor(world.repo).snapshot().reservations, []);
  assert.equal(lstatSync(world.capacity).isDirectory(), true);
});

test('WCC10: an artifact that vanishes between stat and read is a race, not corruption', { timeout: 60_000 }, async (t) => {
  // The reported failure class in its sharpest form: a holder releasing its lock or a reaper
  // renaming it away lands between another deployment's stat and read. That is ordinary
  // coordination, so the deployment must retry and win — never refuse as if the repository were
  // corrupt, and never delete anything it did not publish.
  for (const target of ['lock', 'gate']) {
    const world = repoWorld(`vanishing-${target}`);
    const children = [];
    t.after(disposable(world, children));
    prepareWorld(world, children);
    if (target === 'gate') plantArtifact(world, 'lock.reaper', ownerRecord({ pid: deadPid() }));
    else plantArtifact(world, 'lock', ownerRecord({ pid: deadPid() }));

    const planPath = writePlan(world, {
      holdMs: 0, peers: 1, label: `vanishing-${target}`,
      sabotage: target, ids: [`worker:vanishing-${target}`],
    });
    const run = launch(world, planPath, `vanishing-${target}.json`, children);
    await run.settled;
    const outcome = run.outcome();
    assert.equal(outcome.sabotageFired, true, `${target}: the stat/read race under test really fired`);
    assert.equal(outcome.ok, true,
      `${target}: a vanished artifact is retried, not refused as corrupt (${outcome.code} ${outcome.message ?? ''})`);
    cleanCapacityRoot(world);
  }
});

test('WCC11: a verifier is settled by exact owner identity, never by a shared pid', (t) => {
  const world = repoWorld('same-pid-verifier');
  t.after(disposable(world, []));

  const first = authorityFor(world.repo);
  first.reserve('verify:claim-verification:1', REQUEST);
  const untouched = first.snapshot().reservations;
  const second = authorityFor(world.repo); // a distinct deployment generation in the SAME process
  assert.equal(untouched[0].pid, process.pid, 'the scenario is real: foreign owner, identical pid');
  assert.notEqual(untouched[0].ownerId, second.ownerId);

  const report = second.reconcile([]);
  assert.deepEqual(report.removed, [], 'a shared pid is not ownership: the live foreign generation is preserved');
  assert.deepEqual(report.retainedVerifiers, ['verify:claim-verification:1'],
    'the preserved verifier is reported, not silently kept');
  assert.deepEqual(second.snapshot().reservations, untouched, 'preserved byte-for-byte');

  // Adopting a worker transfers that resource alone. A live controller's unrelated verifier
  // still has exact ownership and may be between reserve and materialize.
  first.reserve('worker:superseded', REQUEST);
  const superseding = second.reconcile(['superseded']);
  assert.deepEqual(superseding.removed, [],
    'worker adoption does not settle a foreign live verifier');
  assert.equal(superseding.adopted.length, 1);
  assert.equal(superseding.adopted[0].ownerId, second.ownerId);
  assert.deepEqual(second.snapshot().reservations.map((row) => row.id).sort(),
    ['verify:claim-verification:1', 'worker:superseded']);
});
