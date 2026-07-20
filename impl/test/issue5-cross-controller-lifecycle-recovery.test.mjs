import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { BatonApplication, GlmSessionCli, createDriver, openBaton } from '../src/index.mjs';
import {
  observeProcessGroupIdentity, processAuthorityState, processGroupAlive,
} from '../src/process-lifecycle.mjs';
import { physicalWorkspaceOwnerReceipt } from '../src/worktree.mjs';

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
const diagnostic = (label, value) => `${label}: ${JSON.stringify(value, null, 2)}`;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function sealedOwnerReceipt(value) {
  const { receiptDigest: _prior, ...core } = value;
  return {
    ...core,
    receiptDigest: createHash('sha256').update(JSON.stringify(canonical(core))).digest('hex'),
  };
}

function eventInventory(events) {
  return events.reduce((inventory, event) => {
    inventory[event.kind] = (inventory[event.kind] ?? 0) + 1;
    return inventory;
  }, {});
}

async function until(read, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await sleep(10);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function adapter({ lifecycleBarrier = null } = {}) {
  return new GlmSessionCli({
    cmd: process.execPath,
    args: [FAKE_CLAUDE],
    authToken: 'fixture-only',
    model: route.model,
    ...(lifecycleBarrier ? { env: { FAKE_CLAUDE_LIFECYCLE_BARRIER: lifecycleBarrier } } : {}),
    killGraceMs: 20,
    versionProbe: () => 'fixture',
  });
}

function readJsonLine(child, label, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => finish(new Error(`timeout waiting for ${label}`)), timeoutMs);
    const finish = (error, value) => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('error', onError);
      child.off('close', onClose);
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk) => {
      stdout += chunk;
      const newline = stdout.indexOf('\n');
      if (newline < 0) return;
      try { finish(null, JSON.parse(stdout.slice(0, newline))); } catch (error) { finish(error); }
    };
    const onError = (error) => finish(error);
    const onClose = (code, signal) => finish(new Error(
      `${label} controller closed before its barrier (code=${code}, signal=${signal})`,
    ));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', onData);
    child.once('error', onError);
    child.once('close', onClose);
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
  const ancestorBaseSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repo, encoding: 'utf8',
  }).trim();
  writeFileSync(join(repo, 'second.txt'), 'second\n');
  execFileSync('git', ['add', 'second.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'second base'], { cwd: repo });

  const lifecycleBarrier = '.issue5-live-process.sock';
  const firstAdapter = adapter({ lifecycleBarrier });
  const firstDriver = driver(repo, logDir, firstAdapter);
  const firstApplication = application(firstDriver);
  let recoveredDriver = null;
  let recoveredApplication = null;
  let pid = null;
  let durableProcessAuthority = null;
  let exactWorkspaceExpectation = null;
  let exactOwnerReceipt = null;
  let ownerReceiptPath = null;
  const priorControllerEvents = [];
  t.after(async () => {
    const cleanupProcessRef = durableProcessAuthority ? {
      generation: durableProcessAuthority.generation,
      pid: durableProcessAuthority.pid,
      processGroupId: durableProcessAuthority.processGroupId,
    } : null;
    if (cleanupProcessRef
      && processAuthorityState(cleanupProcessRef, durableProcessAuthority) === 'active') {
      try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
      await until(() => processAuthorityState(cleanupProcessRef, durableProcessAuthority) === 'absent',
        'fixture emergency exact-identity reap').catch(() => {});
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
  const physicalOwnerId = live.sessionContext.ownerTaskId;
  const worktree = live.worktree;
  const branch = live.sessionContext.branch;
  const runtime = join(repo, '.baton', 'runtime', workerId);
  const lifecycleBarrierPath = join(worktree, lifecycleBarrier);
  await until(() => existsSync(lifecycleBarrierPath), 'live provider lifecycle barrier');
  assert.equal(processGroupAlive(pid), true);
  assert.equal(existsSync(worktree), true);
  assert.equal(existsSync(runtime), true);
  durableProcessAuthority = firstDriver.log.read(workerId)
    .find((event) => event.kind === 'lifecycle.process_authority')?.payload ?? null;
  assert.equal(processAuthorityState(live.processRef, durableProcessAuthority), 'active',
    diagnostic('initial exact provider identity at lifecycle barrier', {
      expected: durableProcessAuthority, observed: observeProcessGroupIdentity(pid),
      lifecycleBarrierPath, barrierExists: existsSync(lifecycleBarrierPath),
    }));
  const firstCapacity = firstDriver.worktreeCapacity.snapshot();
  assert.equal(firstCapacity.reservations.length, 1,
    diagnostic('initial live-generation capacity reservations', firstCapacity));
  const liveLifecycle = firstDriver.log.read(workerId);
  const ownerBound = liveLifecycle.find((event) => event.kind === 'worktree.owner_bound');
  const processStarted = liveLifecycle.find((event) => event.kind === 'lifecycle.process_started');
  assert.ok(ownerBound);
  assert.ok(processStarted);
  ownerReceiptPath = join(repo, '.git', 'baton', 'workspace-owners', `${physicalOwnerId}.json`);
  exactOwnerReceipt = JSON.parse(readFileSync(ownerReceiptPath, 'utf8'));
  assert.deepEqual({
    physicalOwnerId: ownerBound.payload.physicalOwnerId,
    receiptDigest: ownerBound.payload.receiptDigest,
    logicalTaskId: ownerBound.payload.logicalTaskId,
    runId: ownerBound.payload.runId,
    attemptId: ownerBound.payload.attemptId,
    branch: ownerBound.payload.branch,
    worktree: ownerBound.payload.worktree,
    baseSha: ownerBound.payload.baseSha,
    processGeneration: ownerBound.payload.processGeneration,
    deploymentId: ownerBound.payload.deploymentId,
    controllerId: ownerBound.payload.controllerId,
  }, {
    physicalOwnerId,
    receiptDigest: exactOwnerReceipt.receiptDigest,
    logicalTaskId: taskId,
    runId,
    attemptId: workerId,
    branch,
    worktree,
    baseSha: live.sessionContext.baseSha,
    processGeneration: processStarted.payload.generation,
    deploymentId: exactOwnerReceipt.deploymentId,
    controllerId: exactOwnerReceipt.controllerId,
  });
  assert.equal(processStarted.payload.generation, live.processRef.generation);
  assert.equal(durableProcessAuthority.generation, processStarted.payload.generation);
  exactWorkspaceExpectation = {
    expectationId: workerId,
    handleRunId: runId,
    physicalOwnerId,
    binding: {
      physicalOwnerId,
      receiptDigest: exactOwnerReceipt.receiptDigest,
      logicalTaskId: taskId,
      runId,
      attemptId: workerId,
      processGeneration: processStarted.payload.generation,
      branch,
      worktree,
      baseSha: live.sessionContext.baseSha,
      ownerBound: ownerBound.payload,
    },
  };

  // Simulate abrupt controller death: its detached child stays alive, but its in-memory adapter
  // callback and timers can no longer write lifecycle facts. Durable writer authority transfers
  // to the recovered controller exactly as it would after host-process death.
  firstAdapter.onEvent((event) => priorControllerEvents.push(event));
  for (const session of firstAdapter._sessions.values()) {
    if (session.wallTimer) { clearTimeout(session.wallTimer); session.wallTimer = null; }
  }
  for (const handle of firstDriver.coordinator._workers.values()) {
    firstDriver.coordinator._clearWatchdog(handle);
    if (handle.budgetStopTimer) { clearTimeout(handle.budgetStopTimer); handle.budgetStopTimer = null; }
  }
  firstDriver.coordinator._closed = true;
  assert.equal(firstDriver.coordination.releaseWriterLease({ requireOwned: true }), true);

  const seededCapacityOwner = firstCapacity.reservations[0];
  const bindingMismatches = [
    ['receipt-digest', (binding) => { binding.receiptDigest = '0'.repeat(64); }],
    ['physical-owner', (binding) => { binding.physicalOwnerId = `ws-${'1'.repeat(32)}`; }],
    ['logical-owner', (binding) => { binding.logicalTaskId = 'mismatched-logical-task'; }],
    ['attempt-worker', (binding) => { binding.attemptId = 'mismatched-worker'; }],
    ['run', (binding) => { binding.runId = 'mismatched-run'; }],
    ['branch', (binding) => { binding.branch = 'baton/ws-mismatched'; }],
    ['worktree', (binding) => { binding.worktree = join(world, 'mismatched-worktree'); }],
    ['base', (binding) => { binding.baseSha = '2'.repeat(40); }],
    ['process-generation', (binding) => { binding.processGeneration += 1; }],
    ['owner-bound-controller', (binding) => { binding.ownerBound.controllerId = '3'.repeat(64); }],
    ['owner-bound-deployment', (binding) => { binding.ownerBound.deploymentId = '4'.repeat(64); }],
  ];
  for (const [label, mutate] of bindingMismatches) {
    const candidate = structuredClone(exactWorkspaceExpectation);
    mutate(candidate.binding);
    const report = firstDriver.coordinator._worktrees.reconcile([candidate]);
    assert.deepEqual(report.validatedExpectedOwners, [], label);
    assert.deepEqual(report.retainedExpectedOwners, [physicalOwnerId], label);
    assert.ok(report.diagnostics.some((row) => (
      row.code === 'workspace_owner_binding_mismatch'
      && row.physicalOwnerId === physicalOwnerId && row.retained === true
    )), diagnostic(`typed ${label} retention`, report));
    assert.equal(existsSync(worktree), true, label);
    const retainedCapacity = firstDriver.worktreeCapacity.snapshot().reservations[0];
    assert.deepEqual({ ownerId: retainedCapacity.ownerId, nonce: retainedCapacity.nonce }, {
      ownerId: seededCapacityOwner.ownerId, nonce: seededCapacityOwner.nonce,
    }, `${label} must not adopt capacity`);
  }
  const missingOwnerBound = structuredClone(exactWorkspaceExpectation);
  missingOwnerBound.binding.ownerBound = null;
  const missingOwnerBoundReport = firstDriver.coordinator._worktrees.reconcile([missingOwnerBound]);
  assert.deepEqual(missingOwnerBoundReport.validatedExpectedBindings, []);
  assert.deepEqual(missingOwnerBoundReport.retainedExpectedBindings, [workerId]);
  assert.ok(missingOwnerBoundReport.diagnostics.some((row) => (
    row.code === 'workspace_owner_binding_missing' && row.expectationId === workerId
  )));
  const duplicateExpectation = structuredClone(exactWorkspaceExpectation);
  duplicateExpectation.expectationId = `${workerId}-duplicate`;
  const duplicateReport = firstDriver.coordinator._worktrees.reconcile([
    exactWorkspaceExpectation, duplicateExpectation,
  ]);
  assert.deepEqual(duplicateReport.validatedExpectedBindings, []);
  assert.deepEqual(new Set(duplicateReport.retainedExpectedBindings), new Set([
    workerId, `${workerId}-duplicate`,
  ]));
  assert.ok(duplicateReport.diagnostics.some((row) => (
    row.code === 'workspace_owner_binding_ambiguous' && row.physicalOwnerId === physicalOwnerId
  )));
  assert.equal(firstDriver.worktreeCapacity.snapshot().reservations[0].nonce,
    seededCapacityOwner.nonce);

  const replayHandle = firstDriver.coordinator._workers.get(workerId);
  const replayTask = firstDriver.coordinator._tasks.get(taskId);
  const crossGrantRows = [
    {
      label: 'same-Run handle B cannot carry handle A allocation authority',
      expectationId: `${workerId}-substitute`, handleRunId: runId,
    },
    {
      label: 'cross-Run handle cannot carry another Run allocation authority',
      expectationId: workerId, handleRunId: 'run-issue5-cross-controller-substitute',
    },
  ];
  for (const row of crossGrantRows) {
    await t.test(`P92.2-PO3: ${row.label}`, () => {
      const substituted = structuredClone(exactWorkspaceExpectation);
      substituted.expectationId = row.expectationId;
      substituted.handleRunId = row.handleRunId;
      const report = firstDriver.coordinator._worktrees.reconcile([substituted]);
      assert.deepEqual(report.validatedExpectedOwners, []);
      assert.deepEqual(report.validatedExpectedBindings, []);
      assert.deepEqual(report.retainedExpectedOwners, [physicalOwnerId]);
      assert.deepEqual(report.retainedExpectedBindings, [row.expectationId]);
      assert.ok(report.diagnostics.some((diagnosticRow) => (
        diagnosticRow.code === 'workspace_owner_handle_mismatch'
        && diagnosticRow.expectationId === row.expectationId
        && diagnosticRow.physicalOwnerId === physicalOwnerId
        && diagnosticRow.retained === true
      )), diagnostic(row.label, report));
      assert.equal(existsSync(worktree), true);
      const retainedCapacity = firstDriver.worktreeCapacity.snapshot().reservations[0];
      assert.deepEqual({ ownerId: retainedCapacity.ownerId, nonce: retainedCapacity.nonce }, {
        ownerId: seededCapacityOwner.ownerId, nonce: seededCapacityOwner.nonce,
      });
      const substitutedHandle = {
        ...replayHandle,
        id: row.expectationId,
        runId: row.handleRunId,
        workspaceOwnerBindingValid: false,
        ownedWorktreeAuthority: false,
      };
      assert.equal(
        firstDriver.coordinator._recoveryDispatchRefusal(substitutedHandle, replayTask),
        'workspace_owner_binding_unproven',
      );
    });
  }

  await t.test('P92.2-PO3: caller-selected mock vendor cannot replace PID-start authority', () => {
    const forged = {
      ...replayHandle,
      vendor: 'mock', processRef: null, processAuthority: null,
      currentIncarnation: true, localAuthority: true,
      workspaceOwnerBinding: ownerBound.payload,
      workspaceOwnerBindingValid: true,
      workspaceOwnerProcessAuthorityValid: false,
      ownedWorktreeAuthority: false,
    };
    assert.equal(
      firstDriver.coordinator._restoreRecoveredPhysicalWorkspaceAuthority(
        forged, live.sessionContext,
      ),
      false,
    );
    assert.equal(forged.ownedWorktreeAuthority, false);
    assert.equal(forged.workspaceOwnerProcessAuthorityValid, false);
    assert.equal(forged.workspaceOwnerBindingDiagnostic,
      'workspace_owner_process_authority_unproven');
    assert.equal(existsSync(worktree), true);
  });

  const metadataPath = `${worktree}.meta.json`;
  const exactMetadata = readFileSync(metadataPath, 'utf8');
  writeFileSync(metadataPath, '{"schemaVersion":0}\n', { mode: 0o600 });
  const corruptMetadataReport = firstDriver.coordinator._worktrees.reconcile([
    exactWorkspaceExpectation,
  ]);
  assert.deepEqual(corruptMetadataReport.validatedExpectedBindings, []);
  assert.deepEqual(corruptMetadataReport.retainedExpectedBindings, [workerId]);
  assert.ok(corruptMetadataReport.diagnostics.some((row) => (
    row.code === 'workspace_owner_checkout_invalid' && row.expectationId === workerId
  )));
  assert.equal(existsSync(worktree), true);
  assert.equal(firstDriver.worktreeCapacity.snapshot().reservations[0].nonce,
    seededCapacityOwner.nonce);
  writeFileSync(metadataPath, exactMetadata, { mode: 0o600 });

  await t.test('P92.2-PO3: schema-valid ancestor metadata base cannot grant recovery authority', async () => {
    const tamperedMetadata = JSON.parse(exactMetadata);
    tamperedMetadata.baseSha = ancestorBaseSha;
    writeFileSync(metadataPath, `${JSON.stringify(tamperedMetadata, null, 2)}\n`, { mode: 0o600 });
    const invalidSession = await firstDriver.coordinator._worktrees.validateSessionContext(
      live.sessionContext,
    );
    assert.equal(invalidSession.ok, false);
    assert.match(invalidSession.reason, /base metadata disagrees/u);
    const tamperedReport = firstDriver.coordinator._worktrees.reconcile([
      exactWorkspaceExpectation,
    ]);
    assert.deepEqual(tamperedReport.validatedExpectedBindings, []);
    assert.deepEqual(tamperedReport.retainedExpectedBindings, [workerId]);
    assert.ok(tamperedReport.diagnostics.some((row) => (
      row.code === 'workspace_owner_checkout_invalid'
      && row.expectationId === workerId && row.retained === true
    )));
    assert.equal(existsSync(worktree), true);
    const retainedCapacity = firstDriver.worktreeCapacity.snapshot().reservations[0];
    assert.deepEqual({ ownerId: retainedCapacity.ownerId, nonce: retainedCapacity.nonce }, {
      ownerId: seededCapacityOwner.ownerId, nonce: seededCapacityOwner.nonce,
    });

    const rejected = driver(repo, logDir, adapter());
    try {
      await rejected.coordinator.startupReady();
      const replay = rejected.coordinator._workers.get(workerId);
      const task = rejected.coordinator._tasks.get(taskId);
      assert.equal(replay.workspaceOwnerBindingValid, false);
      assert.equal(replay.ownedWorktreeAuthority, false);
      assert.equal(replay.workspaceOwnerBindingDiagnostic, 'workspace_owner_checkout_invalid');
      assert.equal(
        rejected.coordinator._recoveryDispatchRefusal(replay, task),
        'workspace_owner_binding_unproven',
      );
      const unadopted = rejected.worktreeCapacity.snapshot().reservations[0];
      assert.deepEqual({ ownerId: unadopted.ownerId, nonce: unadopted.nonce }, {
        ownerId: seededCapacityOwner.ownerId, nonce: seededCapacityOwner.nonce,
      });
    } finally {
      rejected.coordinator._closed = true;
      rejected.coordination.releaseWriterLease({ requireOwned: true });
      writeFileSync(metadataPath, exactMetadata, { mode: 0o600 });
    }
  });

  const writeOwnerReceipt = (receipt) => writeFileSync(
    ownerReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 },
  );
  const foreignDeployment = createHash('sha256').update('foreign-deployment').digest('hex');
  const foreignController = createHash('sha256').update('foreign-controller').digest('hex');
  const replayRefusals = [
    {
      label: 'missing', code: 'workspace_owner_receipt_missing',
      install: () => rmSync(ownerReceiptPath, { force: true }),
    },
    {
      label: 'malformed', code: 'workspace_owner_receipt_invalid',
      install: () => writeOwnerReceipt({ schemaVersion: 1 }),
    },
    {
      label: 'mismatched', code: 'workspace_owner_binding_mismatch',
      install: () => writeOwnerReceipt(sealedOwnerReceipt({
        ...exactOwnerReceipt, logicalTaskId: 'mismatched-logical-task',
      })),
    },
    {
      label: 'foreign', code: 'workspace_owner_live_foreign',
      install: () => writeOwnerReceipt(sealedOwnerReceipt({
        ...exactOwnerReceipt, deploymentId: foreignDeployment, controllerId: foreignController,
      })),
    },
  ];
  for (const refusal of replayRefusals) {
    refusal.install();
    const rejected = driver(repo, logDir, adapter());
    try {
      await rejected.coordinator.startupReady();
      const replay = rejected.coordinator._workers.get(workerId);
      const replayTask = rejected.coordinator._tasks.get(taskId);
      assert.equal(replay.workspaceOwnerBindingValid, false, refusal.label);
      assert.equal(replay.ownedWorktreeAuthority, false, refusal.label);
      assert.equal(replay.workspaceOwnerBindingDiagnostic, refusal.code, refusal.label);
      assert.equal(
        rejected.coordinator._recoveryDispatchRefusal(replay, replayTask),
        'workspace_owner_binding_unproven',
        refusal.label,
      );
      replay.workspaceOwnerBindingValid = null;
      assert.equal(
        rejected.coordinator._recoveryDispatchRefusal(replay, replayTask),
        'workspace_owner_binding_unproven',
        `${refusal.label} unknown/null owner authority`,
      );
      replay.workspaceOwnerBindingValid = false;
      await assert.rejects(
        rejected.coordinator._removeOwnedTaskWorktree(replay, replayTask),
        (error) => error?.code === 'workspace_owner_binding_unproven',
      );
      if (refusal.label === 'malformed') {
        const retainedPath = replay.worktree;
        replay.worktree = null;
        replay.cleanupPending = false;
        replay.physicalWorkspaceCleanupCompleted = false;
        await assert.rejects(
          rejected.coordinator._removeOwnedTaskWorktree(replay, replayTask),
          (error) => error?.code === 'workspace_owner_binding_unproven',
          'null presentation state cannot claim cleanup over retained unproven ownership',
        );
        replay.worktree = retainedPath;
      }
      assert.equal(existsSync(worktree), true, refusal.label);
      const retainedCapacity = rejected.worktreeCapacity.snapshot().reservations[0];
      assert.deepEqual({ ownerId: retainedCapacity.ownerId, nonce: retainedCapacity.nonce }, {
        ownerId: seededCapacityOwner.ownerId, nonce: seededCapacityOwner.nonce,
      }, `${refusal.label} replay must not adopt capacity`);
    } finally {
      rejected.coordinator._closed = true;
      rejected.coordination.releaseWriterLease({ requireOwned: true });
      writeOwnerReceipt(exactOwnerReceipt);
    }
  }

  const recoveredAdapter = adapter();
  recoveredDriver = driver(repo, logDir, recoveredAdapter);
  recoveredApplication = application(recoveredDriver);
  await recoveredApplication.ready;

  const replayed = recoveredDriver.coordinator.list().find((candidate) => candidate.id === workerId);
  const recoveredInternal = recoveredDriver.coordinator._workers.get(workerId);
  assert.equal(recoveredInternal.workspaceOwnerBindingValid, true);
  assert.equal(recoveredInternal.ownedWorktreeAuthority, true);
  assert.equal(replayed.processRef.state, 'unconfirmed_after_restart');
  assert.equal(replayed.processRef.generation, live.processRef.generation);
  assert.equal(replayed.processRef.pid, pid);
  assert.equal(processGroupAlive(pid), true, 'the detached process group survives controller death');
  assert.equal(existsSync(worktree), true, 'startup replay must not reap a live process-owned worktree');
  assert.equal(existsSync(runtime), true, 'startup replay must retain the live process runtime');
  assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: worktree, encoding: 'utf8' }).trim(), branch);
  const activeCapacity = recoveredDriver.worktreeCapacity.snapshot();
  assert.deepEqual(activeCapacity.reservations.map((row) => row.id), [`worker:${physicalOwnerId}`],
    diagnostic('replayed live-generation capacity reservations', activeCapacity));
  assert.equal(activeCapacity.reservations[0].ownerId, recoveredDriver.worktreeCapacity.ownerId);
  const adoptedNonce = activeCapacity.reservations[0].nonce;
  const exactRetry = recoveredDriver.coordinator._worktrees.reconcile([exactWorkspaceExpectation]);
  assert.deepEqual(exactRetry.validatedExpectedOwners, [physicalOwnerId]);
  assert.equal(exactRetry.diagnostics.some((row) => row.physicalOwnerId === physicalOwnerId), false);
  const retryReceipt = JSON.parse(readFileSync(ownerReceiptPath, 'utf8'));
  const retryCapacity = recoveredDriver.worktreeCapacity.snapshot().reservations[0];
  assert.deepEqual({
    physicalOwnerId: retryReceipt.physicalOwnerId,
    receiptDigest: retryReceipt.receiptDigest,
    processGeneration: retryReceipt.processGeneration,
    capacityNonce: retryCapacity.nonce,
    ownerBoundCount: recoveredDriver.log.read(workerId)
      .filter((event) => event.kind === 'worktree.owner_bound').length,
  }, {
    physicalOwnerId,
    receiptDigest: exactOwnerReceipt.receiptDigest,
    processGeneration: processStarted.payload.generation,
    capacityNonce: adoptedNonce,
    ownerBoundCount: 1,
  });

  const beforeStop = await recoveredApplication.status(runId, principal('owner'));
  assert.equal(beforeStop.ownership.workers, 1,
    diagnostic('run ownership before recovered stop', beforeStop.ownership));
  assert.equal(beforeStop.progress.stages.find((stage) => stage.key === 'cleanup').state, 'active');
  const outline = await recoveredApplication.command(
    'run.inspect', { runId, depth: 'outline' }, principal('owner'),
  );
  assert.equal(outline.outline.resources.ownedCount, 1,
    diagnostic('run outline resources before recovered stop', outline.outline.resources));
  assert.equal(outline.outline.resources.state, 'active');

  let groupAliveWhenWorktreeRemoveStarted = null;
  const remove = recoveredDriver.coordinator._worktrees.remove.bind(recoveredDriver.coordinator._worktrees);
  recoveredDriver.coordinator._worktrees.remove = async (...args) => {
    groupAliveWhenWorktreeRemoveStarted = processGroupAlive(pid);
    return remove(...args);
  };

  const processIdentityAtStop = observeProcessGroupIdentity(pid);
  assert.equal(processAuthorityState(replayed.processRef, durableProcessAuthority), 'active',
    diagnostic('exact recovered process identity at stop barrier', {
      expected: durableProcessAuthority, observed: processIdentityAtStop,
    }));

  const stopped = await recoveredApplication.stop(
    runId, 'Stop the exact recovered provider generation.', principal('owner'),
  );
  const stoppedLifecycle = recoveredDriver.log.read(workerId);
  const stoppedProcessContext = {
    workerId,
    expectedAuthority: durableProcessAuthority,
    identityAtStop: processIdentityAtStop,
    identityAfterStop: observeProcessGroupIdentity(pid),
    groupAliveAfterStop: processGroupAlive(pid),
    priorControllerEvents,
    inventory: eventInventory(stoppedLifecycle),
    closureEvents: stoppedLifecycle.filter((event) => [
      'lifecycle.process_closed', 'control.recovery_process_absent',
      'control.recovery_process_reaped', 'control.recovery_terminalized',
    ].includes(event.kind)),
    receipt: stopped.stop.receipt,
  };
  assert.equal(stopped.phase, 'stopped');
  assert.equal(stopped.stop.receipt.targetCount, 1,
    diagnostic('recovered stop target count', stoppedProcessContext));
  assert.equal(stopped.stop.receipt.remainingCount, 0,
    diagnostic('recovered stop remaining count', stoppedProcessContext));
  assert.equal(stopped.stop.receipt.counts.killConfirmed, 1,
    diagnostic('recovered stop kill-confirmed count', stoppedProcessContext));
  assert.equal(stopped.stop.receipt.counts.processesObserved, 1,
    diagnostic('recovered stop observed-process count', stoppedProcessContext));
  assert.equal(stopped.stop.receipt.counts.processesClosed, 1,
    diagnostic('recovered stop closed-process count', stoppedProcessContext));
  assert.equal(groupAliveWhenWorktreeRemoveStarted, false, 'worktree reap waits for exact group closure');
  assert.equal(processGroupAlive(pid), false);
  assert.equal(existsSync(worktree), false);
  assert.equal(existsSync(runtime), false);
  assert.equal(execFileSync('git', ['branch', '--list', branch], { cwd: repo, encoding: 'utf8' }).trim(), '');
  const stoppedCapacity = recoveredDriver.worktreeCapacity.snapshot();
  assert.deepEqual(stoppedCapacity.reservations, [],
    diagnostic('capacity reservations after recovered stop', stoppedCapacity));
  const recoveredLifecycle = stoppedLifecycle;
  const authority = recoveredLifecycle.filter((event) => event.kind === 'lifecycle.process_authority');
  const reaped = recoveredLifecycle.filter((event) => event.kind === 'control.recovery_process_reaped');
  assert.equal(authority.length, 1,
    diagnostic('durable process-authority event count', {
      workerId, pid, inventory: eventInventory(recoveredLifecycle), authority,
    }));
  assert.equal(reaped.length, 1,
    diagnostic('recovered process-reap event count', {
      workerId, pid, inventory: eventInventory(recoveredLifecycle), reaped,
    }));
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
  const nativeProcessClosed = await until(
    () => priorControllerEvents.find((event) => event.kind === 'lifecycle.process_closed'),
    'prior transport exact process closure observation',
  );
  assert.deepEqual({
    ownerBoundGeneration: ownerBound.payload.processGeneration,
    processStartedGeneration: processStarted.payload.generation,
    processAuthorityGeneration: authority[0].payload.generation,
    unconfirmedGeneration: replayed.processRef.generation,
    nativeProcessClosedGeneration: nativeProcessClosed.payload.generation,
    recoveredCloseGeneration: reaped[0].payload.generation,
    ownerBoundCount: recoveredLifecycle.filter((event) => event.kind === 'worktree.owner_bound').length,
  }, {
    ownerBoundGeneration: 1,
    processStartedGeneration: 1,
    processAuthorityGeneration: 1,
    unconfirmedGeneration: 1,
    nativeProcessClosedGeneration: 1,
    recoveredCloseGeneration: 1,
    ownerBoundCount: 1,
  });
  assert.equal(recoveredLifecycle.some((event) => event.kind === 'control.recovery_process_absent'), false);

  const afterStop = await recoveredApplication.status(runId, principal('owner'));
  assert.equal(afterStop.ownership.workers, 0,
    diagnostic('run ownership after recovered stop', afterStop.ownership));
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
    diagnostic('late completion cannot enter the recovered generation history', {
      before: eventInventory(eventsBeforeLateCompletion),
      after: eventInventory(eventsAfterLateCompletion),
      lastEvent: eventsAfterLateCompletion.at(-1),
    }));
  assert.equal(eventsAfterLateCompletion.at(-1).kind, 'control.stale_rejected');
  assert.equal(recoveredDriver.coordination.task(taskId).status, terminalStatusBeforeLateCompletion);
  const locallyOwnedAfterStop = recoveredDriver.coordinator.list().filter((handle) => (
    recoveredDriver.coordinator.localResourceOwnership(handle.id).owned
  ));
  assert.equal(locallyOwnedAfterStop.length, 0,
    diagnostic('locally owned workers after recovered stop', locallyOwnedAfterStop));

  const closed = await recoveredApplication.shutdown(principal('shutdown'));
  assert.equal(closed.state, 'closed');
  assert.equal(closed.receipt.fleet.remainingCount, 0,
    diagnostic('shutdown fleet remaining count', closed.receipt));
  assert.equal(closed.receipt.capacity.ownedReservations, 0,
    diagnostic('shutdown owned-capacity count', closed.receipt));
  assert.equal(recoveredDriver.coordination._writerLease, null);
  assert.equal(existsSync(join(logDir, 'coordination', 'writer.lease')), false);
});

test('P92.2-PO3: absent process cannot erase retained malformed workspace cleanup authority', async (t) => {
  const world = mkdtempSync(join(tmpdir(), 'baton-phase92-absent-retained-owner-'));
  const repo = join(world, 'repo'); const logDir = join(world, 'log');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase92-absent@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 92 Absent Fixture'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const firstAdapter = adapter({ lifecycleBarrier: '.phase92-absent.sock' });
  const first = driver(repo, logDir, firstAdapter);
  let second; let pid = null; let receiptPath = null; let exactReceipt = null;
  t.after(async () => {
    if (pid) try { process.kill(-pid, 'SIGKILL'); } catch { /* absent */ }
    if (receiptPath && exactReceipt) {
      try { writeFileSync(receiptPath, `${JSON.stringify(exactReceipt, null, 2)}\n`, { mode: 0o600 }); } catch {}
    }
    try {
      const owner = second?.coordinator.list()[0]?.sessionContext?.ownerTaskId;
      if (owner) await second.coordinator._worktrees.remove(owner);
    } catch {}
    try { second?.coordination.releaseWriterLease(); } catch {}
    try { first.coordination.releaseWriterLease(); } catch {}
    rmSync(world, { recursive: true, force: true });
  });
  const firstApp = application(first);
  const runId = 'run-phase92-absent-retained';
  const proposed = await firstApp.start({
    runId, objective: 'HOLD_UNTIL_INTERRUPT before malformed retained-owner replay.',
    profile: 'recovery', route, scope: ['**'],
  }, principal('owner'));
  await firstApp.approve(runId, proposed.plan.digest, principal('approver'));
  const live = await until(() => {
    const row = first.coordinator.list()[0];
    return row?.processRef?.state === 'ready' && row.worktree ? row : null;
  }, 'absent retained-owner live process');
  pid = live.processRef.pid;
  const workerId = live.id; const physicalOwnerId = live.sessionContext.ownerTaskId;
  const worktree = live.worktree;
  receiptPath = join(repo, '.git', 'baton', 'workspace-owners', `${physicalOwnerId}.json`);
  exactReceipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const capacityBefore = first.worktreeCapacity.snapshot().reservations[0];
  firstAdapter.onEvent(() => {});
  for (const session of firstAdapter._sessions.values()) {
    if (session.wallTimer) { clearTimeout(session.wallTimer); session.wallTimer = null; }
  }
  for (const handle of first.coordinator._workers.values()) {
    first.coordinator._clearWatchdog(handle);
    if (handle.budgetStopTimer) { clearTimeout(handle.budgetStopTimer); handle.budgetStopTimer = null; }
  }
  first.coordinator._closed = true;
  first.coordination.releaseWriterLease({ requireOwned: true });
  try { process.kill(-pid, 'SIGKILL'); } catch { /* already absent */ }
  await until(() => !processGroupAlive(pid), 'absent retained-owner process group');
  writeFileSync(receiptPath, '{"schemaVersion":1}\n', { mode: 0o600 });

  second = driver(repo, logDir, adapter());
  await second.coordinator.startupReady();
  const replay = second.coordinator._workers.get(workerId);
  assert.equal(replay.workspaceOwnerBindingValid, false);
  assert.equal(replay.workspaceOwnerBindingDiagnostic, 'workspace_owner_receipt_invalid');
  assert.equal(replay.worktree, worktree,
    'retained unproven checkout coordinate cannot be cleared by process absence');
  assert.equal(replay.physicalWorkspaceCleanupCompleted, false);
  assert.equal(replay.cleanupPending, true);
  assert.equal(existsSync(worktree), true);
  const capacityAfter = second.worktreeCapacity.snapshot().reservations[0];
  assert.deepEqual({ ownerId: capacityAfter.ownerId, nonce: capacityAfter.nonce }, {
    ownerId: capacityBefore.ownerId, nonce: capacityBefore.nonce,
  });
  let stopOutcome;
  try { stopOutcome = await second.coordinator.kill(workerId, 'policy'); }
  catch (error) { stopOutcome = { ok: false, result: error?.code }; }
  assert.equal(stopOutcome.ok, false,
    'same-controller stop cannot report clean over retained unproven workspace authority');
  assert.ok(['session_not_attached', 'workspace_owner_binding_unproven'].includes(
    stopOutcome.result,
  ));
  assert.equal(existsSync(worktree), true);
  assert.equal(readFileSync(receiptPath, 'utf8'), '{"schemaVersion":1}\n');
});

test('P92.2-PO3: immutable gen1 workspace owner binds a separately proven live gen2 recovery', async (t) => {
  const world = mkdtempSync(join(tmpdir(), 'baton-phase92-gen2-owner-'));
  const repo = join(world, 'repo');
  const logDir = join(world, 'log');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase92-gen2@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 92 Gen2 Fixture'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  let first; let second; let third; let firstPid = null; let secondPid = null;
  const detachController = (selectedDriver, selectedAdapter) => {
    selectedAdapter.onEvent(() => {});
    for (const session of selectedAdapter._sessions.values()) {
      if (session.wallTimer) { clearTimeout(session.wallTimer); session.wallTimer = null; }
    }
    for (const handle of selectedDriver.coordinator._workers.values()) {
      selectedDriver.coordinator._clearWatchdog(handle);
      if (handle.budgetStopTimer) {
        clearTimeout(handle.budgetStopTimer); handle.budgetStopTimer = null;
      }
    }
    selectedDriver.coordinator._closed = true;
    selectedDriver.coordination.releaseWriterLease({ requireOwned: true });
  };
  t.after(async () => {
    for (const pid of [firstPid, secondPid].filter(Boolean)) {
      try { process.kill(-pid, 'SIGKILL'); } catch { /* already absent */ }
    }
    for (const selected of [third, second, first]) {
      try { selected?.coordination.releaseWriterLease(); } catch { /* already released */ }
    }
    rmSync(world, { recursive: true, force: true });
  });

  const runId = 'run-phase92-gen2-owner';
  const firstAdapter = adapter({ lifecycleBarrier: '.phase92-gen1.sock' });
  first = driver(repo, logDir, firstAdapter);
  const firstApp = application(first);
  const proposed = await firstApp.start({
    runId,
    objective: 'HOLD_UNTIL_INTERRUPT while a recovered process generation keeps one workspace.',
    profile: 'recovery', route, scope: ['**'],
  }, principal('owner'));
  await firstApp.approve(runId, proposed.plan.digest, principal('approver'));
  const gen1 = await until(() => {
    const row = first.coordinator.list()[0];
    return row?.processRef?.state === 'ready' && row.worktree ? row : null;
  }, 'gen1 workspace/process authority');
  firstPid = gen1.processRef.pid;
  const workerId = gen1.id;
  const physicalOwnerId = gen1.sessionContext.ownerTaskId;
  const worktree = gen1.worktree;
  const ownerBound = first.log.read(workerId).find((event) => event.kind === 'worktree.owner_bound');
  assert.equal(ownerBound.payload.processGeneration, 1);
  const ownerReceiptPath = join(
    repo, '.git', 'baton', 'workspace-owners', `${physicalOwnerId}.json`,
  );
  const immutableReceipt = JSON.parse(readFileSync(ownerReceiptPath, 'utf8'));

  const preserved = await first.coordinator.interrupt(
    workerId, undefined, 'semantic:owner', {
      expectedFence: first.coordinator.list()[0].fence,
      controlId: `control:${'a'.repeat(64)}`,
      preserveTurn: true,
    },
  );
  assert.equal(preserved.preservation?.state, 'preserved');
  detachController(first, firstAdapter);
  try { process.kill(-firstPid, 'SIGKILL'); } catch { /* already absent */ }
  await until(() => !processGroupAlive(firstPid), 'gen1 transport absence');

  const secondAdapter = adapter({ lifecycleBarrier: '.phase92-gen2.sock' });
  second = driver(repo, logDir, secondAdapter);
  await second.coordinator.startupReady();
  assert.equal(existsSync(worktree), true, 'preserved owner survives gen1 process absence');
  const attached = await second.coordinator.recover(workerId);
  assert.equal(attached.ok, true);
  const gen2 = await until(() => {
    const row = second.coordinator.list().find((candidate) => candidate.id === workerId);
    return row?.processRef?.generation === 2 && row.processRef.state === 'ready' ? row : null;
  }, 'gen2 recovered process authority');
  secondPid = gen2.processRef.pid;
  assert.notEqual(secondPid, firstPid);
  assert.equal(second.log.read(workerId).filter((event) => event.kind === 'worktree.owner_bound').length, 1);
  assert.deepEqual(JSON.parse(readFileSync(ownerReceiptPath, 'utf8')), immutableReceipt);
  detachController(second, secondAdapter);

  const thirdAdapter = adapter();
  third = driver(repo, logDir, thirdAdapter);
  await third.coordinator.startupReady();
  const replay = third.coordinator._workers.get(workerId);
  assert.equal(replay.processRef.generation, 2);
  assert.equal(replay.processRef.state, 'unconfirmed_after_restart');
  assert.equal(replay.workspaceOwnerBinding.processGeneration, 1);
  assert.equal(replay.workspaceOwnerBindingValid, true);
  assert.equal(replay.workspaceOwnerProcessAuthorityValid, true);
  assert.equal(replay.ownedWorktreeAuthority, true);
  assert.equal(processAuthorityState(replay.processRef, replay.processAuthority), 'active');
  assert.equal(replay.sessionContext.ownerTaskId, physicalOwnerId);
  assert.deepEqual(JSON.parse(readFileSync(ownerReceiptPath, 'utf8')), immutableReceipt);
  assert.deepEqual(third.worktreeCapacity.snapshot().reservations.map((row) => row.resourceId), [
    physicalOwnerId,
  ]);

  const stopped = await application(third).stop(
    runId, 'Close exact gen2 while reaping the immutable gen1 workspace owner.', principal('owner'),
  );
  assert.equal(stopped.phase, 'stopped');
  assert.equal(processGroupAlive(secondPid), false);
  assert.equal(existsSync(worktree), false);
  assert.equal(physicalWorkspaceOwnerReceipt(repo, physicalOwnerId), null);
  assert.deepEqual(third.worktreeCapacity.snapshot().reservations, []);
  assert.equal(third.log.read(workerId).filter((event) => event.kind === 'worktree.owner_bound').length, 1);
});

test('P92.2-PO3: controller2 exact gen2 recovery restores authority for same-controller stop', async (t) => {
  const world = mkdtempSync(join(tmpdir(), 'baton-phase92-gen2-same-controller-stop-'));
  const repo = join(world, 'repo');
  const logDir = join(world, 'log');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase92-gen2-stop@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 92 Gen2 Stop Fixture'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  let first; let second; let firstPid = null; let secondPid = null;
  const detachController = (selectedDriver, selectedAdapter) => {
    selectedAdapter.onEvent(() => {});
    for (const session of selectedAdapter._sessions.values()) {
      if (session.wallTimer) { clearTimeout(session.wallTimer); session.wallTimer = null; }
    }
    for (const handle of selectedDriver.coordinator._workers.values()) {
      selectedDriver.coordinator._clearWatchdog(handle);
      if (handle.budgetStopTimer) {
        clearTimeout(handle.budgetStopTimer); handle.budgetStopTimer = null;
      }
    }
    selectedDriver.coordinator._closed = true;
    selectedDriver.coordination.releaseWriterLease({ requireOwned: true });
  };
  t.after(async () => {
    for (const pid of [firstPid, secondPid].filter(Boolean)) {
      try { process.kill(-pid, 'SIGKILL'); } catch { /* already absent */ }
    }
    for (const selected of [second, first]) {
      try { selected?.coordination.releaseWriterLease(); } catch { /* already released */ }
    }
    rmSync(world, { recursive: true, force: true });
  });

  const runId = 'run-phase92-gen2-same-controller-stop';
  const firstAdapter = adapter({ lifecycleBarrier: '.phase92-gen1-same-controller.sock' });
  first = driver(repo, logDir, firstAdapter);
  const firstApp = application(first);
  const proposed = await firstApp.start({
    runId,
    objective: 'HOLD_UNTIL_INTERRUPT before exact gen2 recovery and same-controller stop.',
    profile: 'recovery', route, scope: ['**'],
  }, principal('owner'));
  await firstApp.approve(runId, proposed.plan.digest, principal('approver'));
  const gen1 = await until(() => {
    const row = first.coordinator.list()[0];
    return row?.processRef?.state === 'ready' && row.worktree ? row : null;
  }, 'same-controller gen1 workspace/process authority');
  firstPid = gen1.processRef.pid;
  const workerId = gen1.id;
  const physicalOwnerId = gen1.sessionContext.ownerTaskId;
  const worktree = gen1.worktree;
  const immutableReceipt = physicalWorkspaceOwnerReceipt(repo, physicalOwnerId);
  assert.equal(immutableReceipt.processGeneration, 1);

  const preserved = await first.coordinator.interrupt(
    workerId, undefined, 'semantic:owner', {
      expectedFence: first.coordinator.list()[0].fence,
      controlId: `control:${'b'.repeat(64)}`,
      preserveTurn: true,
    },
  );
  assert.equal(preserved.preservation?.state, 'preserved');
  detachController(first, firstAdapter);
  try { process.kill(-firstPid, 'SIGKILL'); } catch { /* already absent */ }
  await until(() => !processGroupAlive(firstPid), 'same-controller gen1 transport absence');

  const secondAdapter = adapter({ lifecycleBarrier: '.phase92-gen2-same-controller.sock' });
  second = driver(repo, logDir, secondAdapter);
  await second.coordinator.startupReady();
  const replayBeforeRecovery = second.coordinator._workers.get(workerId);
  assert.equal(replayBeforeRecovery.worktree, worktree,
    'dead-generation startup must retain the checkout coordinate until recovery proves authority');
  assert.equal(replayBeforeRecovery.ownedWorktreeAuthority, false);
  assert.equal(replayBeforeRecovery.physicalWorkspaceCleanupCompleted, false);
  const attached = await second.coordinator.recover(workerId);
  assert.equal(attached.ok, true);
  const gen2 = await until(() => {
    const row = second.coordinator.list().find((candidate) => candidate.id === workerId);
    return row?.processRef?.generation === 2 && row.processRef.state === 'ready' ? row : null;
  }, 'same-controller gen2 recovered process authority');
  secondPid = gen2.processRef.pid;

  const recovered = second.coordinator._workers.get(workerId);
  assert.equal(recovered.workspaceOwnerBinding.processGeneration, 1);
  assert.equal(recovered.workspaceOwnerBindingValid, true);
  assert.equal(recovered.workspaceOwnerProcessAuthorityValid, true);
  assert.equal(recovered.processRef.generation, 2);
  assert.equal(processAuthorityState(recovered.processRef, recovered.processAuthority), 'active');
  assert.equal(recovered.worktree, worktree);
  assert.equal(recovered.ownedWorktreeAuthority, true);
  assert.deepEqual(physicalWorkspaceOwnerReceipt(repo, physicalOwnerId), immutableReceipt);
  assert.deepEqual(second.worktreeCapacity.snapshot().reservations.map((row) => row.resourceId), [
    physicalOwnerId,
  ]);

  const stopped = await application(second).stop(
    runId, 'Close exact gen2 and its immutable gen1 workspace on controller2.', principal('owner'),
  );
  assert.equal(stopped.phase, 'stopped');
  assert.equal(processGroupAlive(secondPid), false);
  assert.equal(existsSync(worktree), false);
  assert.equal(physicalWorkspaceOwnerReceipt(repo, physicalOwnerId), null);
  assert.deepEqual(second.worktreeCapacity.snapshot().reservations, []);
  assert.equal(second.log.read(workerId).filter((event) => event.kind === 'worktree.owner_bound').length, 1);
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
  const ownedProcesses = [];
  let seedController = null;
  const deploymentRoute = Object.freeze({
    harness: 'glm-via-claude-session', model: route.model, effort: route.effort,
  });
  t.after(async () => {
    for (const { processRef, authority } of ownedProcesses) {
      if (processAuthorityState(processRef, authority) !== 'active') continue;
      try { process.kill(-processRef.processGroupId, 'SIGKILL'); } catch { /* already gone */ }
    }
    if (seedController?.exitCode === null && seedController?.signalCode === null) seedController.kill('SIGKILL');
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
    `const readyWorkers = new Set();`,
    `let resolveReady;`,
    `const providersReady = new Promise((resolve) => { resolveReady = resolve; });`,
    `const deliver = adapter._cb;`,
    `adapter.onEvent((event) => { deliver(event); if (event.kind === 'lifecycle.spawned') { readyWorkers.add(event.worker); if (readyWorkers.size === 2) resolveReady(); } });`,
    `const group = await deployment.startMany([`,
    `  { runId: 'run-issue5-dead-a', objective: 'HOLD_UNTIL_INTERRUPT dead generation A', exact: route },`,
    `  { runId: 'run-issue5-dead-b', objective: 'HOLD_UNTIL_INTERRUPT dead generation B', exact: route },`,
    `]);`,
    `await Promise.all(group.runs.map((run) => run.approve()));`,
    `await Promise.race([providersReady, new Promise((_, reject) => setTimeout(() => reject(new Error('seed providers did not become ready')), 5000))]);`,
    `process.stdout.write(JSON.stringify({ runs: group.runs.map((run) => run.id), sessions: [...adapter._sessions.values()].map((session) => ({ workerId: session.worker, pid: session.pid, generation: session.processGeneration })) }) + '\\n');`,
    `process.stdin.setEncoding('utf8');`,
    `for await (const command of process.stdin) { if (command.trim() === 'crash') process.exit(0); }`,
  ].join('\n');
  seedController = spawn(process.execPath, ['--input-type=module', '--eval', seed], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const seeded = await readJsonLine(seedController, 'two-provider seed');
  assert.equal(seeded.sessions.length, 2,
    diagnostic('seeded detached provider session count', seeded));
  assert.deepEqual(seeded.runs, ['run-issue5-dead-a', 'run-issue5-dead-b']);
  for (const { workerId, pid, generation } of seeded.sessions) {
    const events = readFileSync(join(
      deploymentRoot, 'state', `${workerId}.jsonl`,
    ), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const authority = events.find((event) => event.kind === 'lifecycle.process_authority')?.payload;
    const processRef = { generation, pid, processGroupId: pid };
    ownedProcesses.push({ processRef, authority });
    assert.equal(processAuthorityState(processRef, authority), 'active',
      diagnostic('seeded provider exact-identity barrier', {
        workerId, processRef, authority, observed: observeProcessGroupIdentity(pid),
      }));
  }
  const seedClose = once(seedController, 'close');
  seedController.stdin.end('crash\n');
  const [seedCode, seedSignal] = await seedClose;
  assert.deepEqual({ seedCode, seedSignal }, { seedCode: 0, seedSignal: null },
    diagnostic('seed controller crash barrier', { seedCode, seedSignal, seeded }));
  await until(() => ownedProcesses.every(({ processRef, authority }) => (
    processAuthorityState(processRef, authority) === 'absent'
  )), 'both seeded exact process identities to be absent');

  const staleWorktrees = readdirSync(join(repo, '.baton', 'wt'))
    .filter((name) => !name.includes('.'));
  assert.equal(staleWorktrees.length, 2,
    diagnostic('stale worktrees before recovered startup', {
      seeded, staleWorktrees,
      worktreeList: execFileSync('git', ['worktree', 'list', '--porcelain'], {
        cwd: repo, encoding: 'utf8',
      }),
    }));
  const staleRuntimeScopes = readdirSync(join(deploymentRoot, 'runtime'));
  assert.equal(staleRuntimeScopes.length, 2,
    diagnostic('stale runtime scopes before recovered startup', { seeded, staleRuntimeScopes }));

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
  const recoveredRuntimeScopes = readdirSync(join(deploymentRoot, 'runtime'));
  assert.deepEqual(recoveredRuntimeScopes, [],
    diagnostic('runtime scopes after recovered startup', recoveredRuntimeScopes));
  const recoveredWorktreeList = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repo, encoding: 'utf8',
  }).split('\n').filter((line) => line.startsWith('worktree '));
  assert.equal(recoveredWorktreeList.length, 1,
    diagnostic('git worktrees after recovered startup', recoveredWorktreeList));
  const capacity = JSON.parse(readFileSync(
    join(repo, '.baton', 'capacity', 'reservations.json'), 'utf8',
  ));
  assert.deepEqual(capacity.reservations, [],
    diagnostic('capacity reservations after recovered startup', capacity));
  for (const { workerId, pid, generation } of seeded.sessions) {
    const events = readFileSync(join(
      deploymentRoot, 'state', `${workerId}.jsonl`,
    ), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const terminalized = events.filter((event) => event.kind === 'control.recovery_terminalized');
    assert.equal(terminalized.length, 1,
      diagnostic('recovery-terminalized event count', {
        workerId, pid, generation, inventory: eventInventory(events), terminalized,
      }));
    const absent = events.filter((event) => event.kind === 'control.recovery_process_absent');
    assert.equal(absent.length, 1,
      diagnostic('recovery-process-absent event count', {
        workerId, pid, generation, inventory: eventInventory(events), absent,
      }));
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
  assert.deepEqual(closed.ownership, { workers: 0, workerIds: [], closed: true },
    diagnostic('deployment ownership after recovered close', closed.ownership));
  recovered = null;
  assert.equal(existsSync(join(deploymentRoot, 'state', 'coordination', 'writer.lease')), false);
});
