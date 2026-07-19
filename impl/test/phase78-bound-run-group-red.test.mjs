import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as batonModule from '../src/index.mjs';
import * as clientModule from '../src/application-client.mjs';

const { MockAdapter } = batonModule;
const { BatonRun, BatonRuns, bindBaton } = clientModule;
const driveAvailable = typeof BatonRun.prototype.drive === 'function'
  && typeof BatonRun.prototype.complete === 'function';
const groupAvailable = typeof clientModule.BatonRunGroup === 'function'
  && typeof BatonRuns.prototype.startMany === 'function';

const principal = Object.freeze({
  actor: 'phase78:test', principalId: 'phase78-test', sessionId: 'phase78-session',
});
const routeA = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
const routeB = Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'high' });

function action(kind, actionId, { required = [], priority = 'recommended' } = {}) {
  return Object.freeze({
    kind, actionId, priority,
    destructive: kind === 'stop', irreversible: false,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(required.map((field) => [field, { type: 'string' }])),
      required,
      additionalProperties: false,
    },
  });
}

function view(runId, digestCharacter, phase, {
  actions = [], continuation = false, terminal = false, cursor = 0,
  requestedRoute = null, stage = null,
} = {}) {
  return Object.freeze({
    schemaVersion: 1,
    runId,
    viewDigest: digestCharacter.repeat(64),
    cursor,
    changed: true,
    terminal,
    outline: {
      phase,
      attention: {
        count: actions.filter((candidate) => candidate.kind.startsWith('answer_')).length,
        state: actions.some((candidate) => candidate.kind.startsWith('answer_')) ? 'required' : 'clear',
      },
      actions,
      ...(requestedRoute ? { route: { requested: requestedRoute } } : {}),
      ...(stage ? { progress: { current: stage } } : {}),
    },
    ...(continuation ? {
      continuation: {
        operation: 'run.inspect', arguments: { runId, depth: 'outline', cursor, waitMs: 25 },
      },
    } : {}),
  });
}

function driveApplication() {
  const calls = [];
  const approve = action('approve_plan', 'approve-plan');
  const question = action('answer_question', 'answer-question', {
    required: ['text'], priority: 'required',
  });
  let inspectCount = 0;
  return {
    calls,
    question,
    application: {
      async command(name, args) {
        calls.push({ name, args });
        if (name === 'run.start') {
          return view('run-drive', 'a', 'awaiting_plan_approval', { actions: [approve] });
        }
        if (name === 'run.act' && args.actionId === approve.actionId) {
          return view('run-drive', 'b', 'running', { continuation: true, cursor: 1 });
        }
        if (name === 'run.inspect' && inspectCount++ === 0) {
          return view('run-drive', 'c', 'running', {
            actions: [question], continuation: true, cursor: 2,
          });
        }
        if (name === 'run.act' && args.actionId === question.actionId) {
          return view('run-drive', 'd', 'running', { continuation: true, cursor: 3 });
        }
        if (name === 'run.inspect') {
          return view('run-drive', 'e', 'completed', { terminal: true, cursor: 4 });
        }
        throw new Error(`unexpected ${name}`);
      },
    },
  };
}

function concurrentApplication() {
  const calls = [];
  let activeStarts = 0;
  let peakStarts = 0;
  let releaseStarts;
  const bothStarted = new Promise((resolve) => { releaseStarts = resolve; });
  return {
    calls,
    get peakStarts() { return peakStarts; },
    application: {
      async command(name, args) {
        calls.push({ name, args });
        if (name === 'run.start') {
          activeStarts += 1;
          peakStarts = Math.max(peakStarts, activeStarts);
          if (activeStarts === 2) releaseStarts();
          await bothStarted;
          const runId = args.intent.objective.endsWith('A') ? 'run-a' : 'run-b';
          activeStarts -= 1;
          return view(runId, runId === 'run-a' ? 'a' : 'b', 'running', {
            continuation: true, cursor: 1,
          });
        }
        if (name === 'run.inspect') {
          await new Promise((resolve) => setTimeout(resolve, args.runId === 'run-a' ? 5 : 1));
          return view(args.runId, args.runId === 'run-a' ? 'c' : 'd', 'completed', {
            terminal: true, cursor: 2,
          });
        }
        if (name === 'run.stop') {
          return view(args.runId, args.runId === 'run-a' ? 'e' : 'f', 'stopped', {
            terminal: true, cursor: 3,
          });
        }
        throw new Error(`unexpected ${name}`);
      },
    },
  };
}

test('RD0: a bound Run exposes one-step drive and loop-until-pause complete', () => {
  assert.equal(typeof BatonRun.prototype.drive, 'function');
  assert.equal(typeof BatonRun.prototype.complete, 'function');
  assert.equal(typeof BatonRun.prototype.apply, 'function');
});

test('RD1: drive follows an advertised input-free action; complete follows continuations and pauses on attention', {
  skip: !driveAvailable,
}, async () => {
  const fixture = driveApplication();
  const run = await bindBaton(fixture.application, principal).runs.start('Drive the advertised semantics');

  const progressed = await run.drive();
  assert.equal(progressed.outline.phase, 'running');
  assert.deepEqual(fixture.calls.slice(0, 2).map(({ name }) => name), ['run.start', 'run.act']);
  assert.deepEqual(fixture.calls[1].args, {
    runId: 'run-drive', actionId: 'approve-plan', inputs: {},
  });

  const paused = await run.complete();
  assert.equal(paused.outline.attention.state, 'required');
  assert.deepEqual(paused.outline.actions.map(({ kind }) => kind), ['answer_question']);
  assert.equal(
    fixture.calls.some(({ name, args }) => name === 'run.act' && args.actionId === 'answer-question'),
    false,
    'completion must never invent an answer to user attention',
  );

  await run.act('answer_question', { text: 'Continue with the bounded task.' });
  const completed = await run.complete();
  assert.equal(completed.terminal, true);
  assert.equal(completed.outline.phase, 'completed');
  assert.deepEqual(fixture.calls.map(({ name }) => name), [
    'run.start', 'run.act', 'run.inspect', 'run.act', 'run.inspect',
  ]);
});

test('RD2: complete adopts but never applies implicitly; apply selects the advertised safe default', async () => {
  const calls = [];
  const integrate = Object.freeze({
    kind: 'integrate', actionId: 'apply-adopted-result', priority: 'recommended',
    destructive: true, irreversible: false, choices: ['ff-only', 'structured'],
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['strategy', 'reason'],
      properties: {
        strategy: { type: 'string', enum: ['ff-only', 'structured'], default: 'ff-only' },
        reason: {
          type: 'string', minLength: 1, maxLength: 1024,
          default: 'Apply the adopted verified result.',
        },
      },
    },
  });
  const application = {
    async command(name, args) {
      calls.push({ name, args });
      if (name === 'run.start') {
        return view('run-apply', 'a', 'work_completed', { actions: [integrate] });
      }
      if (name === 'run.act' && args.actionId === integrate.actionId) {
        return view('run-apply', 'b', 'completed', { terminal: true, cursor: 1 });
      }
      throw new Error(`unexpected ${name}`);
    },
  };
  const run = await bindBaton(application, principal).runs.start('Apply one adopted result');

  const paused = await run.complete();
  assert.equal(paused.outline.phase, 'work_completed');
  assert.deepEqual(calls.map(({ name }) => name), ['run.start'],
    'complete must not cross the explicit caller-repository edit boundary');

  const applied = await run.apply();
  assert.equal(applied.outline.phase, 'completed');
  assert.deepEqual(calls[1], {
    name: 'run.act',
    args: {
      runId: 'run-apply', actionId: integrate.actionId,
      inputs: { strategy: 'ff-only', reason: 'Apply the adopted verified result.' },
    },
  });
});

test('RD3: apply accepts progressive strategy detail and rejects unadvertised authority locally', async () => {
  const calls = [];
  const integrate = Object.freeze({
    kind: 'integrate', actionId: 'apply-structured', priority: 'recommended',
    destructive: true, irreversible: false, choices: ['ff-only', 'structured'],
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['strategy', 'reason'],
      properties: {
        strategy: { type: 'string', enum: ['ff-only', 'structured'], default: 'ff-only' },
        reason: { type: 'string', default: 'Apply the adopted verified result.' },
      },
    },
  });
  const application = {
    async command(name, args) {
      calls.push({ name, args });
      if (name === 'run.start') return view('run-apply-detail', 'a', 'work_completed', { actions: [integrate] });
      if (name === 'run.act') return view('run-apply-detail', 'b', 'completed', { terminal: true });
      throw new Error(`unexpected ${name}`);
    },
  };
  const baton = bindBaton(application, principal);
  const rejected = await baton.runs.start('Reject unadvertised apply detail');
  await assert.rejects(
    rejected.apply({ strategy: 'octopus' }),
    (error) => error?.code === 'application_action_input_invalid',
  );
  assert.deepEqual(calls.map(({ name }) => name), ['run.start']);

  const applied = await rejected.apply({
    strategy: 'structured', reason: 'Use the explicitly selected structured merge.',
  });
  assert.equal(applied.outline.phase, 'completed');
  assert.deepEqual(calls[1].args.inputs, {
    strategy: 'structured', reason: 'Use the explicitly selected structured merge.',
  });
});

test('RG0: startMany returns one public BatonRunGroup of ordinary bound Runs', () => {
  assert.equal(typeof clientModule.BatonRunGroup, 'function');
  assert.equal(typeof BatonRuns.prototype.startMany, 'function');
});

test('RG1: startMany launches exact routes concurrently without accepting caller budgets or storage limits', {
  skip: !groupAvailable,
}, async () => {
  const fixture = concurrentApplication();
  const baton = bindBaton(fixture.application, principal);
  const group = await baton.runs.startMany([
    { objective: 'Parallel objective A', exact: routeA },
    { objective: 'Parallel objective B', exact: routeB },
  ]);

  assert.ok(group instanceof clientModule.BatonRunGroup);
  assert.deepEqual(group.ids, ['run-a', 'run-b']);
  assert.deepEqual(group.runs.map(({ id }) => id), group.ids);
  assert.equal(fixture.peakStarts, 2, 'both run.start effects must overlap');
  assert.deepEqual(
    fixture.calls.filter(({ name }) => name === 'run.start').map(({ args }) => args.intent.route),
    [routeA, routeB],
  );

  for (const forbidden of ['budget', 'tokenBudget', 'wallMinutes', 'providerTurns', 'exportMaxBytes']) {
    const before = fixture.calls.length;
    await assert.rejects(
      baton.runs.startMany([{ objective: 'Caller policy is forbidden', exact: routeA, [forbidden]: 1 }]),
      (error) => error?.code === 'application_client_invalid' && error.message.includes(forbidden),
      forbidden,
    );
    assert.equal(fixture.calls.length, before, `${forbidden} must fail before any Run admission`);
  }
});

test('RG2: a partial parallel-start failure stops every admitted Run before rejecting', {
  skip: !groupAvailable,
}, async () => {
  const order = [];
  const application = {
    async command(name, args) {
      if (name === 'run.start' && args.intent.objective === 'Admitted first') {
        order.push('admitted');
        return view('run-admitted', 'a', 'awaiting_plan_approval');
      }
      if (name === 'run.start') {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push('start-refused');
        throw Object.assign(new Error('exact route refused'), { code: 'application_route_not_allowed' });
      }
      if (name === 'run.stop') {
        order.push(`stopped:${args.runId}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(`reaped:${args.runId}`);
        return view(args.runId, 'b', 'stopped', { terminal: true });
      }
      throw new Error(`unexpected ${name}`);
    },
  };
  const baton = bindBaton(application, principal);
  await assert.rejects(
    baton.runs.startMany([
      { objective: 'Admitted first', exact: routeA },
      { objective: 'Refused second', exact: routeB },
    ]),
    (error) => error?.code === 'application_route_not_allowed',
  );
  order.push('rejected-to-caller');
  assert.deepEqual(order, [
    'admitted', 'start-refused', 'stopped:run-admitted', 'reaped:run-admitted', 'rejected-to-caller',
  ]);
});

test('RG3: group inspect and changes preserve Run identity while multiplexing ordinary bound operations', {
  skip: !groupAvailable,
}, async () => {
  const inspectFixture = concurrentApplication();
  const inspectedGroup = await bindBaton(inspectFixture.application, principal).runs.startMany([
    { objective: 'Parallel objective A', exact: routeA },
    { objective: 'Parallel objective B', exact: routeB },
  ]);
  const inspected = await inspectedGroup.inspect();
  assert.deepEqual(inspected.map(({ runId }) => runId).sort(), ['run-a', 'run-b']);
  assert.equal(inspected.every(({ runId, view: inspectedView }) => runId === inspectedView.runId), true);

  const changesFixture = concurrentApplication();
  const changedGroup = await bindBaton(changesFixture.application, principal).runs.startMany([
    { objective: 'Parallel objective A', exact: routeA },
    { objective: 'Parallel objective B', exact: routeB },
  ]);
  const changes = [];
  for await (const changed of changedGroup.changes({ depth: 'members' })) changes.push(changed);
  assert.deepEqual([...new Set(changes.map(({ runId }) => runId))].sort(), ['run-a', 'run-b']);
  for (const runId of ['run-a', 'run-b']) {
    assert.deepEqual(
      changes.filter((changed) => changed.runId === runId).map(({ view: changedView }) => changedView.outline.phase),
      ['running', 'completed'],
    );
  }
});

test('RG4: stopping one Run never stops its sibling; group stop returns identity-bound receipts', {
  skip: !groupAvailable,
}, async () => {
  const fixture = concurrentApplication();
  const group = await bindBaton(fixture.application, principal).runs.startMany([
    { objective: 'Parallel objective A', exact: routeA },
    { objective: 'Parallel objective B', exact: routeB },
  ]);

  await group.runs[0].stop('Stop only A.');
  assert.deepEqual(
    fixture.calls.filter(({ name }) => name === 'run.stop').map(({ args }) => args.runId),
    ['run-a'],
  );
  const sibling = await group.runs[1].inspect();
  assert.equal(sibling.outline.phase, 'completed');

  const stopped = await group.stop('Stop and reap the whole group.');
  assert.deepEqual(stopped.targets, ['run-a', 'run-b']);
  assert.deepEqual(stopped.members.map(({ runId }) => runId).sort(), ['run-a', 'run-b']);
});

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase78-group-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'phase78@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Phase 78'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function exactAdapter(harness, model, effort) {
  const adapter = new MockAdapter({
    harness,
    scenario: {
      outcome: 'completed',
      edits: [{ path: `${harness}.txt`, content: `${harness}\n`, delayMs: 60_000 }],
    },
  });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    authPosture: 'subscription',
    modelSelection: {
      mode: 'exact', configuredDefault: model, available: [model], family: harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [effort],
      serviceTier: null, provenance: 'phase78-group-test', refreshedAt: null,
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
  return adapter;
}

test('RG5: the repository deployment forwards startMany and close drains all active group workers', {
  skip: !groupAvailable || typeof batonModule.openBaton !== 'function',
}, async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase78-group-deployment-'));
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await batonModule.openBaton({
    repo,
    advanced: {
      deploymentRoot,
      routes: [routeA, routeB],
      adapters: {
        codex: exactAdapter(routeA.harness, routeA.model, routeA.effort),
        grok: exactAdapter(routeB.harness, routeB.model, routeB.effort),
      },
      verification: { command: 'node', arguments: ['--test'] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
    },
  });
  assert.equal(typeof deployment.startMany, 'function');
  const group = await deployment.startMany([
    { objective: 'Keep Codex active until deployment close', exact: routeA },
    { objective: 'Keep Grok active until deployment close', exact: routeB },
  ]);
  await Promise.all(group.runs.map((run) => run.approve()));

  const stopped = await group.runs[0].stop('Prove one-Run stop isolation.');
  assert.equal(stopped.outline.phase, 'stopped');
  const sibling = await group.runs[1].inspect();
  assert.notEqual(sibling.outline.phase, 'stopped');

  const closed = await deployment.close();
  assert.deepEqual(closed.ownership, { workers: 0, workerIds: [], closed: true });
});

test('RG6: group status and complete expose compact aggregate progress without receipt choreography', {
  skip: !groupAvailable,
}, async () => {
  const fixture = concurrentApplication();
  const group = await bindBaton(fixture.application, principal).runs.startMany([
    { objective: 'Parallel objective A', exact: routeA },
    { objective: 'Parallel objective B', exact: routeB },
  ]);

  const completed = await group.complete();
  assert.deepEqual(completed.counts, {
    total: 2,
    active: 0,
    waiting: 0,
    ready: 0,
    completed: 2,
    failed: 0,
    stopped: 0,
    terminal: 2,
    attention: 0,
    cleanupIncomplete: 0,
    byPhase: { completed: 2 },
  });
  assert.equal(completed.state, 'completed');
  assert.deepEqual(completed.members.map(({ runId, phase }) => ({ runId, phase })), [
    { runId: 'run-a', phase: 'completed' },
    { runId: 'run-b', phase: 'completed' },
  ]);
  assert.equal(Object.hasOwn(completed.members[0], 'outline'), false);
  assert.equal(Object.hasOwn(completed.members[0], 'receipts'), false);
  assert.equal(completed.members[0].objective, 'Parallel objective A');
  assert.equal(typeof group._summary, 'undefined', 'internal summary construction is not public AX');
});

test('RG7: group changes emits compact asymmetric progress and suppresses unchanged snapshots', {
  skip: !groupAvailable,
}, async () => {
  const inspections = new Map();
  const application = {
    async command(name, args) {
      if (name === 'run.start') {
        const runId = args.intent.objective.endsWith('A') ? 'run-a' : 'run-b';
        return view(runId, runId === 'run-a' ? 'a' : 'b', 'running', {
          continuation: true, cursor: 1, requestedRoute: args.intent.route, stage: 'provider',
        });
      }
      if (name === 'run.inspect') {
        const count = (inspections.get(args.runId) ?? 0) + 1;
        inspections.set(args.runId, count);
        if (args.runId === 'run-a') {
          return view('run-a', 'c', 'work_completed', {
            cursor: 2, requestedRoute: routeA, stage: 'adoption',
          });
        }
        if (count === 1) {
          return view('run-b', 'd', 'running', {
            continuation: true, cursor: 2, requestedRoute: routeB, stage: 'provider',
          });
        }
        return view('run-b', 'e', 'completed', {
          terminal: true, cursor: 3, requestedRoute: routeB, stage: 'complete',
        });
      }
      throw new Error(`unexpected ${name}`);
    },
  };
  const group = await bindBaton(application, principal).runs.startMany([
    { objective: 'Parallel objective A', exact: routeA },
    { objective: 'Parallel objective B', exact: routeB },
  ]);

  const progress = [];
  for await (const summary of group.changes()) progress.push(summary);

  assert.equal(progress.length, 2);
  assert.deepEqual(progress[0].counts, {
    total: 2, active: 1, waiting: 0, ready: 1, completed: 0, failed: 0,
    stopped: 0, terminal: 0, attention: 0, cleanupIncomplete: 0,
    byPhase: { running: 1, work_completed: 1 },
  });
  assert.equal(progress[0].state, 'active');
  assert.deepEqual(progress[0].members.map(({ route }) => route), [
    { requested: routeA }, { requested: routeB },
  ]);
  assert.deepEqual(progress[1].counts, {
    total: 2, active: 0, waiting: 0, ready: 1, completed: 1, failed: 0,
    stopped: 0, terminal: 1, attention: 0, cleanupIncomplete: 0,
    byPhase: { completed: 1, work_completed: 1 },
  });
  assert.equal(progress[1].state, 'ready');
});

test('RG8: member and stopMembers derive exact selection and leave siblings active', {
  skip: !groupAvailable,
}, async () => {
  const calls = [];
  const states = new Map();
  const application = {
    async command(name, args) {
      calls.push({ name, args });
      if (name === 'run.start') {
        const runId = args.intent.objective.endsWith('A') ? 'run-a' : 'run-b';
        const current = view(runId, runId === 'run-a' ? 'a' : 'b', 'running', {
          continuation: true, cursor: 1,
        });
        states.set(runId, current);
        return current;
      }
      if (name === 'run.stop') {
        const stopped = view(args.runId, args.runId === 'run-a' ? 'c' : 'd', 'stopped', {
          terminal: true, cursor: 2,
        });
        states.set(args.runId, stopped);
        return stopped;
      }
      if (name === 'run.inspect') return states.get(args.runId);
      throw new Error(`unexpected ${name}`);
    },
  };
  const group = await bindBaton(application, principal).runs.startMany([
    { objective: 'Parallel objective A', exact: routeA },
    { objective: 'Parallel objective B', exact: routeB },
  ]);
  assert.equal(group.member('run-b').id, 'run-b');

  const before = calls.length;
  for (const selection of [['run-missing'], ['run-a', 'run-a'], []]) {
    await assert.rejects(group.stopMembers(selection), (error) => (
      error?.code === 'application_client_invalid'
      || error?.code === 'application_group_member_unavailable'
    ));
  }
  assert.equal(calls.length, before, 'invalid selections fail before stop or inspect effects');

  const status = await group.stopMembers(['run-a'], 'Stop and reap only selected A.');
  assert.deepEqual(
    calls.filter(({ name }) => name === 'run.stop').map(({ args }) => args.runId),
    ['run-a'],
  );
  assert.deepEqual(status.counts, {
    total: 1, active: 0, waiting: 0, ready: 0, completed: 0, failed: 0,
    stopped: 1, terminal: 1, attention: 0, cleanupIncomplete: 0,
    byPhase: { stopped: 1 },
  });
  assert.deepEqual(status.targets, ['run-a']);
  const sibling = await group.member('run-b').inspect();
  assert.equal(sibling.outline.phase, 'running');
});

test('RG9: startMany validates the complete batch before admitting any Run', {
  skip: !groupAvailable,
}, async () => {
  const fixture = concurrentApplication();
  const baton = bindBaton(fixture.application, principal);
  await assert.rejects(
    baton.runs.startMany([
      { objective: 'Otherwise valid A', exact: routeA },
      { objective: '', exact: routeB },
    ]),
    (error) => error?.code === 'application_client_invalid',
  );
  assert.deepEqual(fixture.calls, []);

  await assert.rejects(
    baton.runs.startMany([
      { objective: 'Otherwise valid A', exact: routeA },
      { objective: 'Invalid exact route B', exact: { harness: 'grok', model: 'grok-4.5' } },
    ]),
    (error) => error?.code === 'application_client_invalid',
  );
  assert.deepEqual(fixture.calls, []);
});

test('RG10: group stop joins every selected stop before reporting cleanup-incomplete', {
  skip: !groupAvailable,
}, async () => {
  const order = [];
  let releaseSlow;
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  const application = {
    async command(name, args) {
      if (name === 'run.start') {
        const runId = args.intent.objective.endsWith('A') ? 'run-a' : 'run-b';
        return view(runId, runId === 'run-a' ? 'a' : 'b', 'running');
      }
      if (name === 'run.stop' && args.runId === 'run-a') {
        order.push('a-failed');
        releaseSlow();
        throw Object.assign(new Error('A reap failed'), { code: 'reap_failed' });
      }
      if (name === 'run.stop') {
        await slow;
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push('b-reaped');
        return view('run-b', 'c', 'stopped', { terminal: true });
      }
      throw new Error(`unexpected ${name}`);
    },
  };
  const group = await bindBaton(application, principal).runs.startMany([
    { objective: 'Parallel objective A', exact: routeA },
    { objective: 'Parallel objective B', exact: routeB },
  ]);
  await assert.rejects(
    group.stop('Join every requested member.'),
    (error) => {
      assert.equal(error?.code, 'application_group_stop_incomplete');
      assert.deepEqual(error.outcome, {
        state: 'cleanup_incomplete', targets: ['run-a', 'run-b'],
        completed: ['run-b'], failed: [{ runId: 'run-a', code: 'reap_failed' }],
      });
      return true;
    },
  );
  order.push('returned');
  assert.deepEqual(order, ['a-failed', 'b-reaped', 'returned']);
});

test('RG11: partial admission cleanup failure reports exact admitted and unsettled identities', {
  skip: !groupAvailable,
}, async () => {
  const application = {
    async command(name, args) {
      if (name === 'run.start' && args.intent.objective === 'Admitted first') {
        return view('run-admitted', 'a', 'awaiting_plan_approval');
      }
      if (name === 'run.start') {
        throw Object.assign(new Error('route refused'), { code: 'application_route_not_allowed' });
      }
      if (name === 'run.stop') {
        throw Object.assign(new Error('reap failed'), { code: 'reap_failed' });
      }
      throw new Error(`unexpected ${name}`);
    },
  };
  await assert.rejects(
    bindBaton(application, principal).runs.startMany([
      { objective: 'Admitted first', exact: routeA },
      { objective: 'Refused second', exact: routeB },
    ]),
    (error) => {
      assert.equal(error?.code, 'application_group_cleanup_incomplete');
      assert.equal(error.cause?.code, 'application_route_not_allowed');
      assert.deepEqual(error.outcome, {
        admitted: ['run-admitted'], cleaned: [],
        failed: [{ runId: 'run-admitted', code: 'reap_failed' }],
      });
      return true;
    },
  );
});

test('RG12: compact group projection refuses cross-wired member identity and malformed digests', {
  skip: !groupAvailable,
}, async () => {
  for (const malformed of [
    view('run-b', 'a', 'running'),
    { ...view('run-a', 'a', 'running'), viewDigest: 'not-a-digest' },
  ]) {
    const application = {
      async command(name) {
        if (name === 'run.start') return view('run-a', 'b', 'running');
        if (name === 'run.inspect') return malformed;
        throw new Error(`unexpected ${name}`);
      },
    };
    const group = await bindBaton(application, principal).runs.startMany([
      { objective: 'Identity-bound A', exact: routeA },
    ]);
    await assert.rejects(group.status(), (error) => (
      error?.code === 'application_group_view_mismatch'
      || error?.code === 'application_client_invalid'
    ));
  }
});

test('RG13: failure truth outranks a ready sibling in compact group state', {
  skip: !groupAvailable,
}, async () => {
  const modes = new Map([
    ['run-a', view('run-a', 'c', 'work_completed')],
    ['run-b', view('run-b', 'd', 'failed', { terminal: true })],
  ]);
  const application = {
    async command(name, args) {
      if (name === 'run.start') {
        const runId = args.intent.objective.endsWith('A') ? 'run-a' : 'run-b';
        return view(runId, runId === 'run-a' ? 'a' : 'b', 'running');
      }
      if (name === 'run.inspect') return modes.get(args.runId);
      throw new Error(`unexpected ${name}`);
    },
  };
  const group = await bindBaton(application, principal).runs.startMany([
    { objective: 'State objective A', exact: routeA },
    { objective: 'State objective B', exact: routeB },
  ]);
  const status = await group.status();
  assert.equal(status.state, 'failed');
  assert.equal(status.counts.ready, 1);
  assert.equal(status.counts.failed, 1);
});
