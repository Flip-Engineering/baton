import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { BatonApplication, GlmSessionCli, createDriver, openBaton } from '../src/index.mjs';
import { processGroupAlive } from '../src/process-lifecycle.mjs';

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const repoId = 'repo-issue5-cross-controller';
const route = Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'low' });
const budget = Object.freeze({ tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 8 });
const capacityPolicy = Object.freeze({
  maxReservedBytes: 64 * 1024 * 1024,
  maxReservedInodes: 10_000,
  minFreeBytes: 1,
  minFreeInodes: 1,
  runtimeReserveBytes: 4 * 1024,
  runtimeReserveInodes: 4,
});
const goalPlanPolicy = Object.freeze({
  schemaVersion: 1,
  repoId,
  mandatory: true,
  approvalTtlMs: 60_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: {
    maxGoalVersions: 8, maxPlanVersions: 8, maxNodes: 8, maxDepsPerNode: 8,
    maxTextBytes: 8_192, maxItems: 32, maxScopePaths: 32, maxRouteValues: 16,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 128 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: budget.tokens, maxUsd: budget.usd, maxWallMin: budget.wallMin,
    maxProviderTurns: budget.providerTurns,
  },
});
const profile = Object.freeze({
  schemaVersion: 1,
  repoId,
  definitionOfDone: ['The recovered controller closes the exact detached provider generation.'],
  constraints: ['Keep the fixture inside its Baton-owned worktree.'],
  risk: 'high',
  goalBudget: budget,
  nodeBudget: budget,
  pathScope: ['**'],
  verification: {
    command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
    expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
    requiredPredecessorEvidence: [],
  },
  routes: [route],
  capabilities: ['code', 'test'],
  effects: ['repository_edit', 'provider_call'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
  followPolicy: {
    mode: 'enabled', maxWaitMs: 2_000, maxChanges: 16,
    maxResponseBytes: 64 * 1024, maxScanEvents: 128,
  },
});

const principal = (id) => ({
  actor: `issue5:${id}`, principalId: id, sessionId: `${id}-session`,
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(read, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await sleep(10);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function adapter() {
  return new GlmSessionCli({
    cmd: process.execPath,
    args: [FAKE_CLAUDE],
    authToken: 'fixture-only',
    model: route.model,
    killGraceMs: 20,
    versionProbe: () => 'fixture',
  });
}

function driver(repo, logDir, selectedAdapter) {
  return createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    adapters: { glm: selectedAdapter },
    goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    worktreeCapacity: capacityPolicy,
    worktreeCapacityEstimate: () => ({ bytes: 16 * 1024, inodes: 32 }),
    worktreeCapacityObserve: () => ({ freeBytes: 1024 * 1024 * 1024, freeInodes: 1_000_000 }),
    stopDeadlineMs: 2_000,
    drainPolicy: { maxWorkers: 32, timeoutMs: 2_000, pollMs: 10 },
  });
}

function application(selectedDriver) {
  return new BatonApplication({
    driver: selectedDriver,
    repoId,
    profiles: { recovery: profile },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'),
      observer: principal('observer'),
    },
    authorize: async () => true,
  });
}

test('issue 5: cross-controller replay retains exact live process/worktree authority and one Run stop reaps all residue', async (t) => {
  const world = mkdtempSync(join(tmpdir(), 'baton-issue5-cross-controller-'));
  const repo = join(world, 'repo');
  const logDir = join(world, 'log');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'issue5@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Issue 5 Fixture'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  const firstAdapter = adapter();
  const firstDriver = driver(repo, logDir, firstAdapter);
  const firstApplication = application(firstDriver);
  let recoveredDriver = null;
  let recoveredApplication = null;
  let pid = null;
  t.after(async () => {
    if (pid && processGroupAlive(pid)) {
      try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
      await until(() => !processGroupAlive(pid), 'fixture emergency group reap').catch(() => {});
    }
    if (recoveredApplication) {
      try { await recoveredApplication.shutdown(principal('cleanup')); } catch {
        try { recoveredDriver?.coordination.releaseWriterLease(); } catch { /* best effort */ }
      }
    } else {
      try { firstDriver.coordination.releaseWriterLease(); } catch { /* best effort */ }
    }
    rmSync(world, { recursive: true, force: true });
  });

  const runId = 'run-issue5-cross-controller';
  const proposed = await firstApplication.start({
    runId,
    objective: 'HOLD_UNTIL_INTERRUPT while controller recovery preserves exact lifecycle ownership.',
    profile: 'recovery', route, scope: ['**'],
  }, principal('owner'));
  await firstApplication.approve(runId, proposed.plan.digest, principal('approver'));

  const live = await until(() => {
    const candidate = firstDriver.coordinator.list()[0];
    return candidate?.processRef?.state === 'ready' && candidate.worktree ? candidate : null;
  }, 'live detached fixture process and worktree');
  pid = live.processRef.pid;
  const workerId = live.id;
  const taskId = live.taskId;
  const worktree = live.worktree;
  const branch = live.sessionContext.branch;
  const runtime = join(repo, '.baton', 'runtime', workerId);
  assert.equal(processGroupAlive(pid), true);
  assert.equal(existsSync(worktree), true);
  assert.equal(existsSync(runtime), true);
  assert.equal(firstDriver.worktreeCapacity.snapshot().reservations.length, 1);

  // Simulate abrupt controller death: its detached child stays alive, but its in-memory adapter
  // callback and timers can no longer write lifecycle facts. Durable writer authority transfers
  // to the recovered controller exactly as it would after host-process death.
  firstAdapter.onEvent(() => {});
  for (const session of firstAdapter._sessions.values()) {
    if (session.wallTimer) { clearTimeout(session.wallTimer); session.wallTimer = null; }
  }
  for (const handle of firstDriver.coordinator._workers.values()) {
    firstDriver.coordinator._clearWatchdog(handle);
    if (handle.budgetStopTimer) { clearTimeout(handle.budgetStopTimer); handle.budgetStopTimer = null; }
  }
  firstDriver.coordinator._closed = true;
  assert.equal(firstDriver.coordination.releaseWriterLease({ requireOwned: true }), true);

  const recoveredAdapter = adapter();
  recoveredDriver = driver(repo, logDir, recoveredAdapter);
  recoveredApplication = application(recoveredDriver);
  await recoveredApplication.ready;

  const replayed = recoveredDriver.coordinator.list().find((candidate) => candidate.id === workerId);
  assert.equal(replayed.processRef.state, 'unconfirmed_after_restart');
  assert.equal(replayed.processRef.generation, live.processRef.generation);
  assert.equal(replayed.processRef.pid, pid);
  assert.equal(processGroupAlive(pid), true, 'the detached process group survives controller death');
  assert.equal(existsSync(worktree), true, 'startup replay must not reap a live process-owned worktree');
  assert.equal(existsSync(runtime), true, 'startup replay must retain the live process runtime');
  assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: worktree, encoding: 'utf8' }).trim(), branch);
  const activeCapacity = recoveredDriver.worktreeCapacity.snapshot();
  assert.deepEqual(activeCapacity.reservations.map((row) => row.id), [`worker:${taskId}`]);
  assert.equal(activeCapacity.reservations[0].ownerId, recoveredDriver.worktreeCapacity.ownerId);

  const beforeStop = await recoveredApplication.status(runId, principal('owner'));
  assert.equal(beforeStop.ownership.workers, 1);
  assert.equal(beforeStop.progress.stages.find((stage) => stage.key === 'cleanup').state, 'active');
  const outline = await recoveredApplication.command(
    'run.inspect', { runId, depth: 'outline' }, principal('owner'),
  );
  assert.equal(outline.outline.resources.ownedCount, 1);
  assert.equal(outline.outline.resources.state, 'active');

  let groupAliveWhenWorktreeRemoveStarted = null;
  const remove = recoveredDriver.coordinator._worktrees.remove.bind(recoveredDriver.coordinator._worktrees);
  recoveredDriver.coordinator._worktrees.remove = async (...args) => {
    groupAliveWhenWorktreeRemoveStarted = processGroupAlive(pid);
    return remove(...args);
  };

  const stopped = await recoveredApplication.stop(
    runId, 'Stop the exact recovered provider generation.', principal('owner'),
  );
  assert.equal(stopped.phase, 'stopped');
  assert.equal(stopped.stop.receipt.targetCount, 1);
  assert.equal(stopped.stop.receipt.remainingCount, 0);
  assert.equal(stopped.stop.receipt.counts.killConfirmed, 1);
  assert.equal(stopped.stop.receipt.counts.processesObserved, 1);
  assert.equal(stopped.stop.receipt.counts.processesClosed, 1);
  assert.equal(groupAliveWhenWorktreeRemoveStarted, false, 'worktree reap waits for exact group closure');
  assert.equal(processGroupAlive(pid), false);
  assert.equal(existsSync(worktree), false);
  assert.equal(existsSync(runtime), false);
  assert.equal(execFileSync('git', ['branch', '--list', branch], { cwd: repo, encoding: 'utf8' }).trim(), '');
  assert.deepEqual(recoveredDriver.worktreeCapacity.snapshot().reservations, []);
  const recoveredLifecycle = recoveredDriver.log.read(workerId);
  const authority = recoveredLifecycle.filter((event) => event.kind === 'lifecycle.process_authority');
  const reaped = recoveredLifecycle.filter((event) => event.kind === 'control.recovery_process_reaped');
  assert.equal(authority.length, 1);
  assert.equal(reaped.length, 1);
  assert.deepEqual({
    generation: reaped[0].payload.generation,
    pid: reaped[0].payload.pid,
    processGroupId: reaped[0].payload.processGroupId,
    pidStart: reaped[0].payload.pidStart,
  }, {
    generation: authority[0].payload.generation,
    pid: authority[0].payload.pid,
    processGroupId: authority[0].payload.processGroupId,
    pidStart: authority[0].payload.pidStart,
  });
  assert.equal(recoveredLifecycle.some((event) => event.kind === 'control.recovery_process_absent'), false);

  const afterStop = await recoveredApplication.status(runId, principal('owner'));
  assert.equal(afterStop.ownership.workers, 0);
  assert.equal(afterStop.progress.stages.find((stage) => stage.key === 'cleanup').state, 'complete');

  const eventsBeforeLateCompletion = recoveredLifecycle;
  const terminalStatusBeforeLateCompletion = recoveredDriver.coordination.task(taskId).status;
  recoveredAdapter._cb({
    worker: workerId, harness: 'glm', actor: 'worker',
    turnEpoch: replayed.turnEpoch,
    kind: 'lifecycle.turn_completed',
    payload: {
      pid, result: { status: 'completed', summary: 'late prior-controller completion' },
      usageSeal: { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null },
    },
  });
  const eventsAfterLateCompletion = recoveredDriver.log.read(workerId);
  assert.equal(eventsAfterLateCompletion.filter((event) => event.kind === 'lifecycle.turn_completed').length,
    eventsBeforeLateCompletion.filter((event) => event.kind === 'lifecycle.turn_completed').length,
    'a late completion cannot enter the recovered generation history');
  assert.equal(eventsAfterLateCompletion.at(-1).kind, 'control.stale_rejected');
  assert.equal(recoveredDriver.coordination.task(taskId).status, terminalStatusBeforeLateCompletion);
  assert.equal(recoveredDriver.coordinator.list().filter((handle) => (
    recoveredDriver.coordinator.localResourceOwnership(handle.id).owned
  )).length, 0);

  const closed = await recoveredApplication.shutdown(principal('shutdown'));
  assert.equal(closed.state, 'closed');
  assert.equal(closed.receipt.fleet.remainingCount, 0);
  assert.equal(closed.receipt.capacity.ownedReservations, 0);
  assert.equal(recoveredDriver.coordination._writerLease, null);
  assert.equal(existsSync(join(logDir, 'coordination', 'writer.lease')), false);
});

test('issue 5: one deployment startup terminalizes two already-dead owned generations and reaps all stale resources', async (t) => {
  const world = mkdtempSync(join(tmpdir(), 'baton-issue5-dead-generations-'));
  const repo = join(world, 'repo');
  const deploymentRoot = join(world, 'deployment');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'issue5@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Issue 5 Fixture'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  let recovered = null;
  const ownedPids = [];
  const deploymentRoute = Object.freeze({
    harness: 'glm-via-claude-session', model: route.model, effort: route.effort,
  });
  t.after(async () => {
    for (const pid of ownedPids) {
      if (!processGroupAlive(pid)) continue;
      try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    try { await recovered?.close(); } catch { /* assertions retain the primary failure */ }
    rmSync(world, { recursive: true, force: true });
  });

  const moduleUrl = new URL('../src/index.mjs', import.meta.url).href;
  const seed = [
    `const { GlmSessionCli, openBaton } = await import(${JSON.stringify(moduleUrl)});`,
    `const route = ${JSON.stringify(deploymentRoute)};`,
    `const adapter = new GlmSessionCli({ cmd: process.execPath, args: [${JSON.stringify(FAKE_CLAUDE)}], authToken: 'fixture-only', model: route.model, killGraceMs: 20, versionProbe: () => '1.0.0' });`,
    `const card = adapter.card.bind(adapter); adapter.card = () => ({ ...card(), concurrencyCeiling: 2 });`,
    `const deployment = await openBaton({ repo: ${JSON.stringify(repo)}, advanced: { deploymentRoot: ${JSON.stringify(deploymentRoot)}, routes: [route], adapters: { [route.harness]: adapter }, verification: { command: 'true', arguments: [] } } });`,
    `const group = await deployment.startMany([`,
    `  { runId: 'run-issue5-dead-a', objective: 'HOLD_UNTIL_INTERRUPT dead generation A', exact: route },`,
    `  { runId: 'run-issue5-dead-b', objective: 'HOLD_UNTIL_INTERRUPT dead generation B', exact: route },`,
    `]);`,
    `await Promise.all(group.runs.map((run) => run.approve()));`,
    `const deadline = Date.now() + 5000;`,
    `while ([...adapter._sessions.values()].filter((session) => session.spawnedEmitted && !session.terminal).length !== 2) {`,
    `  if (Date.now() >= deadline) throw new Error('seed providers did not become ready');`,
    `  await new Promise((resolve) => setTimeout(resolve, 10));`,
    `}`,
    `process.stdout.write(JSON.stringify({ runs: group.runs.map((run) => run.id), sessions: [...adapter._sessions.values()].map((session) => ({ workerId: session.worker, pid: session.pid, generation: session.processGeneration })) }));`,
    `process.exit(0);`,
  ].join('\n');
  const seeded = JSON.parse(execFileSync(process.execPath, [
    '--input-type=module', '--eval', seed,
  ], { encoding: 'utf8' }));
  assert.equal(seeded.sessions.length, 2);
  assert.deepEqual(seeded.runs, ['run-issue5-dead-a', 'run-issue5-dead-b']);
  for (const { pid } of seeded.sessions) {
    ownedPids.push(pid);
    assert.equal(processGroupAlive(pid), true);
    process.kill(-pid, 'SIGKILL');
  }
  await until(() => seeded.sessions.every(({ pid }) => !processGroupAlive(pid)),
    'both seeded process groups to be absent');

  const staleWorktrees = readdirSync(join(repo, '.baton', 'wt'))
    .filter((name) => !name.includes('.'));
  assert.equal(staleWorktrees.length, 2);
  assert.equal(readdirSync(join(deploymentRoot, 'runtime')).length, 2);

  const recoveredAdapter = adapter();
  const recoveredCard = recoveredAdapter.card.bind(recoveredAdapter);
  recoveredAdapter.card = () => ({ ...recoveredCard(), version: '1.0.0', concurrencyCeiling: 2 });
  recovered = await openBaton({
    repo,
    advanced: {
      deploymentRoot,
      routes: [deploymentRoute],
      adapters: { [deploymentRoute.harness]: recoveredAdapter },
      verification: { command: 'true', arguments: [] },
    },
  });

  const readiness = await recovered.doctor();
  assert.equal(readiness.routes.find((candidate) => (
    candidate.harness === deploymentRoute.harness
  )).state, 'ready', 'the first recovered deployment is immediately usable');
  assert.deepEqual(readdirSync(join(deploymentRoot, 'runtime')), []);
  assert.equal(execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repo, encoding: 'utf8',
  }).split('\n').filter((line) => line.startsWith('worktree ')).length, 1);
  const capacity = JSON.parse(readFileSync(
    join(repo, '.baton', 'capacity', 'reservations.json'), 'utf8',
  ));
  assert.deepEqual(capacity.reservations, []);
  for (const { workerId, pid, generation } of seeded.sessions) {
    const events = readFileSync(join(
      deploymentRoot, 'state', `${workerId}.jsonl`,
    ), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(events.filter((event) => event.kind === 'control.recovery_terminalized').length, 1);
    const absent = events.filter((event) => event.kind === 'control.recovery_process_absent');
    assert.equal(absent.length, 1);
    assert.deepEqual({
      generation: absent[0].payload.generation,
      pid: absent[0].payload.pid,
      processGroupId: absent[0].payload.processGroupId,
    }, { generation, pid, processGroupId: pid });
    assert.equal(events.some((event) => event.kind === 'lifecycle.process_closed'), false,
      'restart absence is policy-observed closure, never a fabricated worker close');
  }
  for (const runId of seeded.runs) {
    const stopped = await recovered.runs.open(runId).stop('Converge recovered dead ownership.');
    assert.equal(stopped.outline.phase, 'stopped');
  }

  const closed = await recovered.close();
  assert.deepEqual(closed.ownership, { workers: 0, workerIds: [], closed: true });
  recovered = null;
  assert.equal(existsSync(join(deploymentRoot, 'state', 'coordination', 'writer.lease')), false);
});
