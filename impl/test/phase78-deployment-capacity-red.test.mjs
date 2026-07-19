import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, openBaton } from '../src/index.mjs';

const route = Object.freeze({ harness: 'mock-capacity', model: 'mock-capacity-1', effort: 'high' });

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase78-capacity-repo-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'phase78@example.invalid'], root);
  git(['config', 'user.name', 'Phase 78'], root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  git(['add', '.'], root);
  git(['commit', '-qm', 'base'], root);
  return root;
}

function exactBlockingAdapter() {
  const adapter = new MockAdapter({
    harness: route.harness,
    concurrencyCeiling: 4,
    scenario: {
      outcome: 'completed',
      edits: [{ path: 'held.txt', content: 'held\n', delayMs: 60_000 }],
    },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    authPosture: 'subscription',
    modelSelection: {
      mode: 'exact', configuredDefault: route.model, available: [route.model],
      family: route.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [route.effort], serviceTier: null,
      provenance: 'phase78-capacity-test', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: {
        supported: ['unattended'], default: 'unattended', perTask: false,
        observation: 'launch', mechanisms: ['test-unattended'],
      },
      access: {
        supported: ['full'], default: 'full', perTask: false,
        observation: 'launch', mechanisms: ['test-full-access'],
      },
      containment: {
        hostProcess: 'same_uid', guarantees: ['private_runtime'],
        configuredPreferences: [], observation: 'unavailable',
      },
    },
  });
  let spawnCalls = 0;
  let killCalls = 0;
  const spawn = adapter.spawn.bind(adapter);
  const kill = adapter.kill.bind(adapter);
  adapter.spawn = async (...args) => { spawnCalls += 1; return spawn(...args); };
  adapter.kill = async (...args) => { killCalls += 1; return kill(...args); };
  return {
    adapter,
    spawnCalls: () => spawnCalls,
    killCalls: () => killCalls,
    sessions: () => [...adapter._sessions.values()],
  };
}

function worktreeCount(repo) {
  return git(['worktree', 'list', '--porcelain'], repo)
    .split('\n').filter((line) => line.startsWith('worktree ')).length;
}

function capacityReservations(repo) {
  const path = join(repo, '.baton', 'capacity', 'reservations.json');
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf8')).reservations;
}

function runtimeCount(deploymentRoot) {
  const root = join(deploymentRoot, 'runtime');
  return existsSync(root) ? readdirSync(root).length : 0;
}

async function until(read, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timeout waiting for ${label}`);
}

test('DC1: deployment-owned capacity admits one parallel worker, refuses its sibling before effects, and stop/close reap exactly', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase78-capacity-deployment-'));
  const fixture = exactBlockingAdapter();
  const estimates = [];
  const observations = [];
  let observedPolicy = null;
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });

  deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot,
      routes: [route],
      adapters: { [route.harness]: fixture.adapter },
      verification: { command: 'true', arguments: [] },
      // This test-only observation seam constrains the host to exactly one estimated worker.
      // Baton still owns the actual byte/inode policy; callers cannot tune quota knobs.
      capacity: {
        estimate(request) {
          estimates.push(request);
          observedPolicy = request.policy;
          return { bytes: 60, inodes: 5 };
        },
        observe(request) {
          observations.push(request);
          assert.ok(observedPolicy, 'estimate must establish the deployment policy before observation');
          return {
            freeBytes: observedPolicy.minFreeBytes + 60,
            freeInodes: observedPolicy.minFreeInodes + 5,
          };
        },
      },
    },
  });

  const group = await deployment.startMany([
    { objective: 'Hold capacity worker A', exact: route },
    { objective: 'Hold capacity worker B', exact: route },
  ]);
  const admission = await Promise.allSettled(group.runs.map((run) => run.approve()));
  assert.equal(admission.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(admission.filter(({ status }) => status === 'rejected').length, 1);
  assert.equal(
    admission.find(({ status }) => status === 'rejected')?.reason?.code,
    'worktree_capacity_exceeded',
  );

  await until(() => capacityReservations(repo).length === 1, 'one capacity reservation');
  await until(() => worktreeCount(repo) === 2, 'one admitted private worktree');
  await until(() => runtimeCount(deploymentRoot) === 1, 'one admitted private runtime');
  assert.ok(observedPolicy, 'the factory must install a deployment-owned default policy');
  assert.deepEqual(
    Object.keys(observedPolicy).sort(),
    [
      'digest', 'maxReservedBytes', 'maxReservedInodes', 'minFreeBytes', 'minFreeInodes',
      'runtimeReserveBytes', 'runtimeReserveInodes',
    ],
  );
  assert.equal(estimates.length, 2, 'both candidates are preflighted');
  assert.equal(observations.length, 2, 'both candidates observe the same constrained host');
  assert.equal(fixture.spawnCalls(), 1, 'the refused sibling never reaches its provider adapter');
  assert.equal(fixture.sessions().length, 1, 'the refused sibling owns no process session');
  assert.equal(worktreeCount(repo), 2, 'only one worker Git worktree exists beside the caller');
  assert.equal(runtimeCount(deploymentRoot), 1, 'only one worker runtime exists');

  const accepted = group.runs[admission.findIndex(({ status }) => status === 'fulfilled')];
  const stopped = await accepted.stop('Release the exact accepted capacity owner.');
  assert.equal(stopped.outline.phase, 'stopped');
  await until(() => capacityReservations(repo).length === 0, 'capacity release');
  assert.equal(worktreeCount(repo), 1, 'Run stop removes its exact Git worktree');
  assert.equal(runtimeCount(deploymentRoot), 0, 'Run stop removes its exact private runtime');
  assert.equal(fixture.killCalls(), 1, 'Run stop kills the one admitted process session');
  assert.equal(fixture.sessions().every((session) => session.terminal), true);

  const closed = await deployment.close();
  assert.deepEqual(closed.ownership, { workers: 0, workerIds: [], closed: true });
  assert.deepEqual(capacityReservations(repo), []);
  assert.equal(worktreeCount(repo), 1);
  assert.equal(runtimeCount(deploymentRoot), 0);
  assert.equal(existsSync(join(deploymentRoot, 'state', 'coordination', 'writer.lease')), false);
});

test('DC2: deployment close drains an active capacity owner and releases every exact effect', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase78-capacity-close-'));
  const fixture = exactBlockingAdapter();
  let policy;
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });

  deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot,
      routes: [route],
      adapters: { [route.harness]: fixture.adapter },
      verification: { command: 'true', arguments: [] },
      capacity: {
        estimate(request) {
          policy = request.policy;
          return { bytes: 60, inodes: 5 };
        },
        observe() {
          return {
            freeBytes: policy.minFreeBytes + 600,
            freeInodes: policy.minFreeInodes + 50,
          };
        },
      },
    },
  });

  const run = await deployment.run('Hold one capacity owner until deployment close.', route);
  await run.approve();
  await until(() => capacityReservations(repo).length === 1, 'active close capacity reservation');
  await until(() => fixture.sessions().length === 1, 'active close provider session');
  const receipt = await deployment.close();

  assert.deepEqual(receipt.ownership, { workers: 0, workerIds: [], closed: true });
  assert.deepEqual(capacityReservations(repo), []);
  assert.equal(worktreeCount(repo), 1);
  assert.equal(runtimeCount(deploymentRoot), 0);
  assert.equal(fixture.killCalls(), 1);
  assert.equal(fixture.sessions().every((session) => session.terminal), true);
});

test('DC3: the advanced capacity seam is closed and callers cannot tune deployment ceilings', async (t) => {
  const repo = repository();
  const world = mkdtempSync(join(tmpdir(), 'baton-phase78-capacity-invalid-'));
  const deploymentRoot = join(world, 'deployment');
  const fixture = exactBlockingAdapter();
  t.after(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(world, { recursive: true, force: true });
  });
  const base = {
    deploymentRoot,
    routes: [route],
    adapters: { [route.harness]: fixture.adapter },
    verification: { command: 'true', arguments: [] },
  };

  for (const capacity of [
    { estimate() {}, observe() {}, maxReservedBytes: 1 },
    { estimate() {} },
    { estimate: 1, observe() {} },
  ]) {
    await assert.rejects(
      openBaton({ repo, advanced: { ...base, capacity } }),
      (error) => error?.code === 'deployment_config_invalid' && /capacity/u.test(error.message),
    );
    assert.equal(existsSync(deploymentRoot), false, 'invalid capacity refuses before deployment roots');
    assert.equal(existsSync(join(repo, '.baton')), false, 'invalid capacity refuses before repo capacity state');
  }
});

test('DC4: always-on capacity uses an attested dependency projection in private worktrees', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase78-capacity-projection-'));
  mkdirSync(join(repo, 'node_modules', 'phase78-dependency'), { recursive: true });
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(repo, 'package-lock.json'), JSON.stringify({
    name: 'phase78-capacity', lockfileVersion: 3, packages: {},
  }));
  writeFileSync(
    join(repo, 'node_modules', 'phase78-dependency', 'index.mjs'),
    "export const projected = 'attested';\n",
  );
  git(['add', '.gitignore', 'package-lock.json'], repo);
  git(['commit', '-qm', 'locked dependencies'], repo);
  const fixture = exactBlockingAdapter();
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });

  deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot,
      routes: [route],
      adapters: { [route.harness]: fixture.adapter },
      verification: { command: 'true', arguments: [] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
    },
  });
  const run = await deployment.run('Inspect the attested installed dependency projection.', route);
  await run.approve();
  await until(() => worktreeCount(repo) === 2, 'dependency projection worktree');
  const privateWorktree = git(['worktree', 'list', '--porcelain'], repo)
    .split('\n').filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length)).find((path) => path !== repo);
  assert.equal(
    readFileSync(join(privateWorktree, 'node_modules', 'phase78-dependency', 'index.mjs'), 'utf8'),
    "export const projected = 'attested';\n",
  );

  await deployment.close();
  assert.equal(worktreeCount(repo), 1);
  assert.deepEqual(capacityReservations(repo), []);
  assert.equal(git(['status', '--porcelain'], repo), '');
});
