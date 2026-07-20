import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, openBaton } from '../src/index.mjs';
import { Coordinator } from '../src/coordinator.mjs';

const routeA = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const routeB = Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'medium' });
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase79-workflow-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'phase79@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Phase 79'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function adapter(route, path, tracker, delayMs = 40, outcome = 'completed') {
  const value = new MockAdapter({
    harness: route.harness,
    scenario: {
      outcome,
      edits: outcome === 'completed' ? [{ path, content: `${route.harness}\n`, delayMs }] : [],
    },
  });
  const baseCard = value.card.bind(value);
  value.card = () => ({
    ...baseCard(),
    authPosture: 'subscription',
    modelSelection: {
      mode: 'exact', configuredDefault: route.model, available: [route.model],
      family: route.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [route.effort], serviceTier: null,
      provenance: 'phase79-workflow-test', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: {
        supported: ['unattended'], default: 'unattended', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      access: {
        supported: ['full'], default: 'full', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      containment: {
        hostProcess: 'same_uid', guarantees: ['private_runtime'],
        configuredPreferences: [], observation: 'unavailable',
      },
    },
  });
  const nativeSpawn = value.spawn.bind(value);
  value.spawn = (...args) => {
    tracker.active += 1;
    tracker.peak = Math.max(tracker.peak, tracker.active);
    tracker.calls.push({ workerId: args[0], model: args[2]?.model, effort: args[2]?.reasoningEffort });
    const result = nativeSpawn(...args);
    queueMicrotask(() => { tracker.active -= 1; });
    return result;
  };
  return value;
}

function latchedAdapter(route, path, tracker) {
  const value = adapter(route, path, tracker, 0);
  const nativeRunSession = value._runSession.bind(value);
  let markEntered;
  let open;
  let opened = false;
  const entered = new Promise((resolve) => { markEntered = resolve; });
  const released = new Promise((resolve) => { open = resolve; });
  value._runSession = async (session, turn = {}) => {
    markEntered();
    const haltSignal = turn.haltSignal ?? session.haltSignal;
    if (!opened && !haltSignal.aborted) {
      await Promise.race([
        released,
        new Promise((resolve) => haltSignal.addEventListener('abort', resolve, { once: true })),
      ]);
    }
    if (!opened) return;
    await nativeRunSession(session, turn);
  };
  return {
    value,
    entered,
    release() {
      if (opened) return;
      opened = true;
      open();
    },
  };
}

test('WF79-1: deployment workflow compiles one durable multi-node Plan and starts no provider before approval', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase79-workflow-deployment-'));
  const tracker = { active: 0, peak: 0, calls: [] };
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
      routes: [routeA, routeB],
      adapters: {
        codex: adapter(routeA, 'candidate-a.txt', tracker),
        grok: adapter(routeB, 'candidate-b.txt', tracker),
      },
      verification: { command: 'node', arguments: ['--test'] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
    },
  });
  assert.equal(typeof deployment.workflow, 'function');
  const workflow = await deployment.workflow('Produce two attributable candidate improvements.', {
    team: [
      { role: 'builder', exact: routeA },
      { role: 'challenger', exact: routeB },
    ],
  });
  assert.equal(tracker.calls.length, 0, 'Plan preview must precede provider effects');

  assert.equal((await workflow.outline()).depth, 'outline');
  assert.equal((await workflow.index()).depth, 'index');
  assert.equal((await workflow.help()).topic, 'workflow');

  const plan = await workflow.inspect({ depth: 'section', section: 'plan' });
  assert.equal(plan.section.itemCount, 2);
  assert.deepEqual(plan.section.items.map(({ value }) => value.role).sort(), ['builder', 'challenger']);
  assert.deepEqual(plan.section.items.map(({ value }) => value.route).sort((a, b) => (
    a.harness < b.harness ? -1 : 1
  )), [routeA, routeB]);

  const settled = await workflow.complete();
  assert.equal(settled.outline.phase, 'selection_required', JSON.stringify(settled.outline));
  assert.equal(settled.outline.attention.state, 'required');
  assert.equal(settled.outline.route.state, 'multiple');
  assert.equal(tracker.peak, 2, 'Wave tick must make both exact root Attempts dispatchable together');
  assert.deepEqual(tracker.calls.map(({ model, effort }) => ({ model, effort })).sort((a, b) => (
    a.model < b.model ? -1 : 1
  )), [
    { model: 'gpt-5.6-sol', effort: 'high' },
    { model: 'grok-4.5', effort: 'medium' },
  ]);

  const candidates = await workflow.candidates();
  assert.equal(candidates.section.itemCount, 2);
  assert.equal(new Set(candidates.section.items.map(({ value }) => value.candidateId)).size, 2);
  assert.deepEqual(candidates.section.items.map(({ value }) => value.role).sort(), [
    'builder', 'challenger',
  ]);

  await workflow.act('send_feedback', { role: 'builder', feedback: {
    summary: 'Keep the candidate but document the changed path before synthesis.',
    findings: [{
      kind: 'suggestion', severity: 'medium',
      message: 'Preserve the attributable builder delta as the selected basis.',
      path: 'candidate-a.txt', line: 1,
    }],
  } });
  await workflow.sendFeedback('builder', {
    summary: 'Keep the candidate but document the changed path before synthesis.',
    findings: [{
      kind: 'suggestion', severity: 'medium',
      message: 'Preserve the attributable builder delta as the selected basis.',
      path: 'candidate-a.txt', line: 1,
    }],
  });
  const feedback = await workflow.feedback();
  assert.equal(feedback.section.itemCount, 1, 'identical feedback is idempotent');
  assert.equal(feedback.section.items[0].value.target.role, 'builder');
  assert.deepEqual(feedback.section.items[0].value.target.changedPaths, ['candidate-a.txt']);
  assert.equal(feedback.section.items[0].value.target.retainedResultRef,
    `refs/baton/results/${feedback.section.items[0].value.target.resultSha}`);
  assert.match(feedback.section.items[0].value.target.treeIdentityDigest, /^[a-f0-9]{64}$/u);
  await assert.rejects(workflow.sendFeedback('builder', {
    summary: 'This attempts to point outside the exact Candidate delta.',
    findings: [{
      kind: 'defect', severity: 'high', message: 'Reject this stale path anchor.',
      path: 'not-in-candidate.txt', line: 1,
    }],
  }), (error) => error?.code === 'application_workflow_feedback_anchor_invalid');

  const selectedAction = await workflow.select('builder', 'The builder Candidate is the preferred verified basis.');
  assert.equal(selectedAction.outline.phase, 'candidate_selected');
  const selected = await workflow.status();
  assert.equal(selected.phase, 'candidate_selected');
  assert.equal(selected.result.state, 'selected');
  assert.equal(selected.result.candidate.role, 'builder');
  assert.equal(selected.selection.comparedCandidates.length, 2);
  assert.equal(selected.result.preservation.state, 'pinned');
  const evidence = await workflow.evidence();
  assert.equal(evidence.kind, 'baton.workflow.evidence');
  assert.equal(evidence.resultIntent, 'change');
  assert.deepEqual(Object.keys(evidence), [
    'schemaVersion', 'kind', 'state', 'repoId', 'runId', 'resultIntent',
    'observedThroughSeq', 'bindings', 'phase', 'progress', 'attempts', 'candidates',
    'feedback', 'memberStops', 'selection', 'rounds', 'result', 'verification', 'stop',
    'ownership', 'checks', 'manifestDigest',
  ]);
  const { manifestDigest, ...evidenceCore } = evidence;
  assert.equal(manifestDigest, digest(evidenceCore));
  assert.equal(evidence.state, 'provider_settled');
  assert.equal(evidence.candidates.length, 2);
  assert.equal(evidence.feedback.length, 1);
  assert.equal(evidence.selection.candidate.role, 'builder');
  assert.equal(evidence.checks.candidatesMechanicallyVerified, true);
  assert.equal(evidence.checks.feedbackTargetsBound, true);
  assert.equal(evidence.checks.selectionBound, true);
  assert.equal(evidence.checks.candidatesRetained, true);
  assert.equal(evidence.checks.selectedResultRefReverified, true);
  assert.equal(evidence.checks.applicationTerminal, false);

  const adopted = await workflow.adopt('Adopt the selected verified Workflow Candidate.');
  assert.equal(adopted.outline.phase, 'candidate_selected');
  const adoptedStatus = await workflow.status();
  assert.equal(adoptedStatus.result.state, 'adopted');
  const integrated = await workflow.apply({
    strategy: 'ff-only', reason: 'Apply the explicitly selected and adopted Candidate.',
  });
  assert.equal(integrated.outline.phase, 'completed');
  assert.equal(readFileSync(join(repo, 'candidate-a.txt'), 'utf8'), 'codex\n');

  const events = readFileSync(join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  const wave = events.filter((event) => event.batch?.kind === 'goal_plan_wave_dispatch');
  assert.equal(wave.length, 4);
  assert.deepEqual(wave.map((event) => event.kind), [
    'plan.node_dispatched', 'task.created', 'plan.node_dispatched', 'task.created',
  ]);
  assert.equal(new Set(wave.map((event) => event.batch.id)).size, 1);
  assert.equal(events.filter((event) => (
    event.payload?.kind === 'application.workflow_feedback_recorded'
  )).length, 1);
  assert.equal(events.filter((event) => (
    event.payload?.kind === 'application.workflow_candidate_selected'
  )).length, 1);

  const stopped = await workflow.stop('Stop and reap the complete Workflow ownership tree.');
  assert.equal(stopped.outline.phase, 'stopped');
  const closed = await deployment.close();
  assert.deepEqual(closed.ownership, { workers: 0, workerIds: [], closed: true });
  deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot,
      routes: [routeA, routeB],
      adapters: {
        codex: adapter(routeA, 'candidate-a.txt', tracker),
        grok: adapter(routeB, 'candidate-b.txt', tracker),
      },
      verification: { command: 'node', arguments: ['--test'] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
    },
  });
  const replayed = await deployment.open(workflow.id).status();
  assert.equal(replayed.phase, 'stopped');
  assert.equal(replayed.result.state, 'integrated');
  assert.equal(replayed.result.candidate.role, 'builder');
  assert.equal(replayed.result.retainedResultRef, `refs/baton/results/${replayed.result.sha}`);
  const replayEvidence = await deployment.open(workflow.id).evidence();
  assert.equal(replayEvidence.state, 'terminal');
  assert.equal(replayEvidence.checks.candidatesRetained, true);
  assert.deepEqual((await deployment.close()).ownership, { workers: 0, workerIds: [], closed: true });
});

test('WF79-2: unsupported shared multiwriter and malformed teams fail before application effects', async () => {
  const calls = [];
  const application = { async command(name, args) { calls.push({ name, args }); } };
  const { bindBaton } = await import('../src/application-client.mjs');
  const baton = bindBaton(application, {
    actor: 'phase79:test', principalId: 'phase79', sessionId: 'phase79-session',
  });
  for (const options of [
    { workspace: 'shared_multiwriter', team: [{ role: 'a', exact: routeA }, { role: 'b', exact: routeB }] },
    { team: [{ role: 'same', exact: routeA }, { role: 'same', exact: routeB }] },
    { team: [{ role: 'a', exact: routeA }] },
  ]) {
    await assert.rejects(baton.workflow('Reject unsafe composition.', options), (error) => (
      error?.code === 'application_client_invalid'
    ));
  }
  assert.deepEqual(calls, []);
});

test('WF79-3: an over-capacity Workflow wave refuses all candidates before task, worktree, or provider effects', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase79-workflow-capacity-'));
  const tracker = { active: 0, peak: 0, calls: [] };
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
      routes: [routeA, routeB],
      adapters: {
        codex: adapter(routeA, 'candidate-a.txt', tracker),
        grok: adapter(routeB, 'candidate-b.txt', tracker),
      },
      verification: { command: 'true', arguments: [] },
      capacity: {
        estimate(request) {
          policy = request.policy;
          return { bytes: 60, inodes: 5 };
        },
        observe() {
          return {
            freeBytes: policy.minFreeBytes + 60,
            freeInodes: policy.minFreeInodes + 5,
          };
        },
      },
    },
  });
  const workflow = await deployment.workflow('Refuse the whole constrained candidate wave.', {
    team: [
      { role: 'builder', exact: routeA },
      { role: 'challenger', exact: routeB },
    ],
  });

  await assert.rejects(workflow.complete(), (error) => error?.code === 'worktree_capacity_exceeded');
  assert.equal(tracker.calls.length, 0);
  assert.equal(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' })
    .split('\n').filter((line) => line.startsWith('worktree ')).length, 1);
  const events = readFileSync(join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.some((event) => event.batch?.kind === 'goal_plan_wave_dispatch'), false);

  const stopped = await workflow.stop('Close the refused Workflow authority.');
  assert.equal(stopped.outline.phase, 'stopped');
  const closed = await deployment.close();
  assert.deepEqual(closed.ownership, { workers: 0, workerIds: [], closed: true });
});

test('WF79-4: whole-Workflow stop reaps an active Wave and leaves no owned process or worktree', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase79-workflow-active-stop-'));
  const tracker = { active: 0, peak: 0, calls: [] };
  const codex = adapter(routeA, 'active-a.txt', tracker, 60_000);
  const grok = adapter(routeB, 'active-b.txt', tracker, 60_000);
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot, routes: [routeA, routeB], adapters: { codex, grok },
      verification: { command: 'true', arguments: [] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
    },
  });
  const workflow = await deployment.workflow('Stop and reap an active two-member Wave.', {
    team: [
      { role: 'builder', exact: routeA },
      { role: 'challenger', exact: routeB },
    ],
  });
  await workflow.approve();
  assert.equal(tracker.calls.length, 2);
  const active = await workflow.status();
  assert.equal(active.phase, 'running');
  assert.equal(active.ownership.workers, 2);
  assert.equal(active.attempts.every((attempt) => attempt.activity?.lastEventAt), true);
  assert.equal(active.attempts.every((attempt) => Number.isSafeInteger(attempt.activity?.lastEventSeq)), true);

  const stopped = await workflow.stop('Stop every active Workflow member and reap its ownership.');
  assert.equal(stopped.outline.phase, 'stopped');
  assert.equal([...codex._sessions.values(), ...grok._sessions.values()].every((session) => session.terminal), true);
  assert.equal(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' })
    .split('\n').filter((line) => line.startsWith('worktree ')).length, 1);
  const closed = await deployment.close();
  assert.deepEqual(closed.ownership, { workers: 0, workerIds: [], closed: true });
});

test('WF79-5: operator-selected join preserves and selects a verified survivor after a sibling failure', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase79-workflow-survivor-'));
  const tracker = { active: 0, peak: 0, calls: [] };
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot, routes: [routeA, routeB],
      adapters: {
        codex: adapter(routeA, 'survivor.txt', tracker),
        grok: adapter(routeB, 'failed.txt', tracker, 0, 'failed'),
      },
      verification: { command: 'true', arguments: [] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
    },
  });
  const workflow = await deployment.workflow('Keep a verified survivor selectable.', {
    team: [
      { role: 'builder', exact: routeA },
      { role: 'challenger', exact: routeB },
    ],
  });
  const paused = await workflow.complete();
  assert.equal(paused.outline.phase, 'selection_required');
  const candidates = await workflow.candidates();
  assert.equal(candidates.section.itemCount, 1);
  assert.equal(candidates.section.items[0].value.role, 'builder');
  const selected = await workflow.select('builder', 'Select the sole mechanically verified survivor.');
  assert.equal(selected.outline.phase, 'candidate_selected');
  await workflow.stop('Reap the survivor Workflow fixture.');
  const closed = await deployment.close();
  assert.deepEqual(closed.ownership, { workers: 0, workerIds: [], closed: true });
});

test('WF79-6: role-addressed member stop is durable, exact, and leaves a sibling Attempt running', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase79-workflow-member-stop-'));
  const tracker = { active: 0, peak: 0, calls: [] };
  const builder = latchedAdapter(routeA, 'surviving-member.txt', tracker);
  const codex = builder.value;
  const grok = adapter(routeB, 'stopped-member.txt', tracker, 60_000);
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot, routes: [routeA, routeB], adapters: { codex, grok },
      verification: { command: 'true', arguments: [] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
    },
  });
  const workflow = await deployment.workflow('Stop only one active role and preserve its sibling.', {
    team: [
      { role: 'builder', exact: routeA },
      { role: 'challenger', exact: routeB },
    ],
  });
  const active = await workflow.approve();
  assert.equal(active.outline.phase, 'running');
  assert.deepEqual(active.outline.actions.find((action) => action.kind === 'stop_member').choices,
    ['builder', 'challenger']);
  await builder.entered;

  const memberStopped = await workflow.stopMember('challenger', 'The challenger is no longer needed.');
  assert.notEqual(memberStopped.outline.phase, 'stopped');
  assert.equal([...grok._sessions.values()].every((session) => session.terminal), true);
  assert.equal([...codex._sessions.values()].some((session) => !session.terminal), true,
    'the sibling provider session remains active after selective stop');

  builder.release();
  const paused = await workflow.complete();
  assert.equal(paused.outline.phase, 'selection_required');
  const status = await workflow.status();
  assert.equal(status.memberStops.length, 1);
  assert.equal(status.memberStops[0].role, 'challenger');
  assert.equal(status.memberStops[0].status, 'stopped');
  assert.equal(status.attempts.find((attempt) => attempt.role === 'challenger').state, 'cancelled');
  assert.equal(status.attempts.find((attempt) => attempt.role === 'builder').state, 'accepted');
  const candidates = await workflow.candidates();
  assert.deepEqual(candidates.section.items.map(({ value }) => value.role), ['builder']);

  const events = readFileSync(join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  const stopEvents = events.filter((event) => [
    'application.workflow_member_stop_admitted',
    'application.workflow_member_stop_completed',
  ].includes(event.payload?.kind));
  assert.deepEqual(stopEvents.map((event) => event.payload.kind), [
    'application.workflow_member_stop_admitted',
    'application.workflow_member_stop_completed',
  ]);
  assert.equal(stopEvents[0].payload.workerId, stopEvents[1].payload.workerId);
  assert.equal(stopEvents[0].payload.targetDigest, stopEvents[1].payload.targetDigest);

  await workflow.select('builder', 'Select the surviving mechanically verified builder Candidate.');
  const evidence = await workflow.evidence();
  assert.equal(evidence.memberStops.length, 1);
  assert.equal(evidence.memberStops[0].status, 'stopped');
  await workflow.stop('Close the remaining Workflow authority after the member-stop test.');
  assert.equal(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' })
    .split('\n').filter((line) => line.startsWith('worktree ')).length, 1);
  const closed = await deployment.close();
  assert.deepEqual(closed.ownership, { workers: 0, workerIds: [], closed: true });
});

test('WF79-7: a post-ledger Wave launch failure compensates every admitted member before rejection', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase79-workflow-compensate-'));
  const tracker = { active: 0, peak: 0, calls: [] };
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot, routes: [routeA, routeB],
      adapters: {
        codex: adapter(routeA, 'never-a.txt', tracker),
        grok: adapter(routeB, 'never-b.txt', tracker),
      },
      verification: { command: 'true', arguments: [] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
    },
  });
  const workflow = await deployment.workflow('Compensate a fault after durable Wave admission.', {
    team: [
      { role: 'builder', exact: routeA },
      { role: 'challenger', exact: routeB },
    ],
  });

  const originalTick = Coordinator.prototype.tick;
  let injected = false;
  Coordinator.prototype.tick = function faultAfterWaveLedger(...args) {
    if (!injected) {
      injected = true;
      throw Object.assign(new Error('injected post-ledger launch fault'), {
        code: 'injected_wave_launch_failure',
      });
    }
    return originalTick.apply(this, args);
  };
  try {
    await assert.rejects(workflow.approve(), (error) => (
      error?.code === 'plan_wave_dispatch_failed'
      && error.cleanupReceipt?.outcome?.remainingCount === 0
    ));
  } finally {
    Coordinator.prototype.tick = originalTick;
  }
  assert.equal(tracker.calls.length, 0, 'no provider is launched after the injected ledger boundary');
  const status = await workflow.status();
  assert.equal(status.phase, 'failed');
  assert.equal(status.attempts.every((attempt) => attempt.state === 'cancelled'), true);
  assert.equal(status.ownership.workers, 0);
  assert.equal(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' })
    .split('\n').filter((line) => line.startsWith('worktree ')).length, 1);
  const events = readFileSync(join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  const cleanup = events.filter((event) => event.payload?.kind === 'plan.wave_cleanup_completed');
  assert.equal(cleanup.length, 1);
  assert.equal(cleanup[0].payload.failureCode, 'injected_wave_launch_failure');
  assert.equal(cleanup[0].payload.outcome.targetCount, 2);
  assert.equal(cleanup[0].payload.outcome.remainingCount, 0);
  assert.equal(cleanup[0].payload.outcome.counts.pendingCancelled, 2);
  assert.deepEqual((await deployment.close()).ownership, { workers: 0, workerIds: [], closed: true });
});
