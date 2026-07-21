import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as baton from '../src/index.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';

const CHILD_RELATIONS = Object.freeze([
  'follow_up', 'oracle', 'preserved_resume', 'recovery', 'review', 'revision',
]);

const POLICY = Object.freeze({
  schemaVersion: 1,
  maxDepth: 2,
  maxChildrenPerTask: 3,
  maxTasksPerRun: 6,
  maxChildrenByRelation: Object.freeze({
    follow_up: 2,
    review: 1,
    oracle: 1,
    recovery: 1,
    preserved_resume: 1,
    revision: 1,
  }),
});

const root = (label) => mkdtempSync(join(tmpdir(), `baton-phase75-${label}-`));
const auth = (key) => ({ actor: 'orchestrator', key: `phase75:${key}` });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fields(id, {
  runId = 'run-a', refines = null, relation = refines === null ? 'root' : 'follow_up',
} = {}) {
  return {
    id,
    brief: { goal: id },
    deps: [],
    refines,
    relation,
    runId,
    taskType: relation,
    reservedWorkerId: `worker-${id}`,
  };
}

function create(store, id, options = {}) {
  return store.createTask(fields(id, options), auth(`create:${id}`));
}

function refusalCode(fn) {
  try { fn(); return null; }
  catch (error) { return error?.code ?? error?.name ?? 'unknown_error'; }
}

test('TT1: deployment taskTopologyPolicy is normalized, closed, deterministic, and deeply immutable', () => {
  assert.equal(typeof baton.normalizeTaskTopologyPolicy, 'function');
  const normalized = baton.normalizeTaskTopologyPolicy(structuredClone(POLICY));
  assert.deepEqual(baton.TASK_TOPOLOGY_RELATIONS, CHILD_RELATIONS);
  assert.deepEqual(normalized.maxChildrenByRelation, POLICY.maxChildrenByRelation);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.maxChildrenByRelation), true);
  assert.deepEqual(
    baton.normalizeTaskTopologyPolicy(structuredClone(POLICY)),
    normalized,
  );

  for (const invalid of [
    { ...POLICY, extra: true },
    { ...POLICY, maxDepth: -1 },
    { ...POLICY, maxChildrenPerTask: 0 },
    { ...POLICY, maxTasksPerRun: 0 },
    { ...POLICY, maxChildrenByRelation: { ...POLICY.maxChildrenByRelation, surprise: 1 } },
    { ...POLICY, maxChildrenByRelation: { ...POLICY.maxChildrenByRelation, oracle: -1 } },
    { ...POLICY, maxChildrenByRelation: { ...POLICY.maxChildrenByRelation, review: POLICY.maxChildrenPerTask + 1 } },
  ]) {
    assert.throws(
      () => baton.normalizeTaskTopologyPolicy(invalid),
      (error) => error?.code === 'task_topology_policy_invalid',
    );
  }

  assert.equal(baton.inferTaskTopologyRelation(fields('root')), 'root');
  for (const relation of CHILD_RELATIONS) {
    assert.equal(
      baton.inferTaskTopologyRelation(fields(`child-${relation}`, { refines: 'root', relation }), relation),
      relation,
    );
  }
});

test('TT2: CoordinationStore admits a valid root and refinement and exposes the deployment policy', () => {
  const store = new CoordinationStore(root('valid'), { taskTopologyPolicy: POLICY });
  const rootTask = create(store, 'root');
  const child = create(store, 'child', { refines: 'root', relation: 'follow_up' });

  assert.equal(rootTask.task.relation, 'root');
  assert.equal(child.task.relation, 'follow_up');
  assert.deepEqual(store.taskTopologyPolicy(), baton.normalizeTaskTopologyPolicy(POLICY));
  store.releaseWriterLease();
});

const storeRefusals = [
  {
    label: 'dangling refines target',
    code: 'task_topology_parent_missing',
    arrange: () => {},
    attempt: (store) => create(store, 'dangling', { refines: 'absent', relation: 'follow_up' }),
  },
  {
    label: 'self refinement',
    code: 'task_topology_self_refinement',
    arrange: () => {},
    attempt: (store) => create(store, 'self', { refines: 'self', relation: 'follow_up' }),
  },
  {
    label: 'cross-Run refinement',
    code: 'task_topology_run_mismatch',
    arrange: (store) => create(store, 'parent', { runId: 'run-a' }),
    attempt: (store) => create(store, 'cross', { runId: 'run-b', refines: 'parent', relation: 'follow_up' }),
  },
  {
    label: 'unknown relation',
    code: 'task_topology_relation_invalid',
    arrange: (store) => create(store, 'parent'),
    attempt: (store) => create(store, 'unknown', { refines: 'parent', relation: 'delegate' }),
  },
  {
    label: 'maximum depth',
    code: 'task_topology_depth_limit',
    arrange: (store) => {
      create(store, 'depth-0');
      create(store, 'depth-1', { refines: 'depth-0' });
      create(store, 'depth-2', { refines: 'depth-1' });
    },
    attempt: (store) => create(store, 'depth-3', { refines: 'depth-2' }),
  },
  {
    label: 'total child fanout',
    code: 'task_topology_fanout_limit',
    arrange: (store) => {
      create(store, 'parent');
      create(store, 'child-follow', { refines: 'parent', relation: 'follow_up' });
      create(store, 'child-review', { refines: 'parent', relation: 'review' });
      create(store, 'child-oracle', { refines: 'parent', relation: 'oracle' });
    },
    attempt: (store) => create(store, 'child-overflow', { refines: 'parent', relation: 'preserved_resume' }),
  },
  {
    label: 'per-relation child fanout',
    code: 'task_topology_relation_limit',
    arrange: (store) => {
      create(store, 'parent');
      create(store, 'oracle-1', { refines: 'parent', relation: 'oracle' });
    },
    attempt: (store) => create(store, 'oracle-2', { refines: 'parent', relation: 'oracle' }),
  },
  {
    label: 'tasks per Run',
    code: 'task_topology_run_limit',
    arrange: (store) => {
      for (let index = 0; index < POLICY.maxTasksPerRun; index += 1) create(store, `root-${index}`);
    },
    attempt: (store) => create(store, 'root-overflow'),
  },
];

for (const scenario of storeRefusals) {
  test(`TT3: CoordinationStore refuses ${scenario.label} without appending the attempted task`, () => {
    const store = new CoordinationStore(root(`store-${scenario.label.replaceAll(' ', '-')}`), {
      taskTopologyPolicy: POLICY,
    });
    scenario.arrange(store);
    const before = store.snapshot();
    const code = refusalCode(() => scenario.attempt(store));

    assert.deepEqual(
      { code, lastSeq: store.snapshot().lastSeq, taskIds: store.snapshot().tasks.map((task) => task.id) },
      { code: scenario.code, lastSeq: before.lastSeq, taskIds: before.tasks.map((task) => task.id) },
    );
    store.releaseWriterLease();
  });
}

test('TT4: policy adoption rejects a legacy refinement cycle instead of blessing it on replay', () => {
  const directory = root('cycle');
  const legacy = new CoordinationStore(directory);
  create(legacy, 'cycle-a', { refines: 'cycle-b', relation: 'follow_up' });
  create(legacy, 'cycle-b', { refines: 'cycle-a', relation: 'follow_up' });
  legacy.releaseWriterLease();

  assert.throws(
    () => new CoordinationStore(directory, { taskTopologyPolicy: POLICY }),
    (error) => error instanceof baton.CoordinationIntegrityError
      && error.code === 'task_topology_parent_missing',
  );
});

function effectFixture(label, arrange) {
  const log = new Log(root(`effects-log-${label}`));
  const coordination = new CoordinationStore(root(`effects-coordination-${label}`), {
    taskTopologyPolicy: POLICY,
    operationalRead: (worker, seq) => log.read(worker, seq).find((event) => event.seq === seq) ?? null,
  });
  arrange(coordination);
  const effects = { reserveCapacity: 0, createWorktree: 0, adapterSpawn: 0, adapterPrompt: 0 };
  const adapter = {
    onEvent() {},
    card: () => ({
      harness: 'stub', version: '1', authPosture: 'none', concurrencyCeiling: 1, maxContext: 100_000,
      verbs: {
        spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native',
        answer: 'native', kill: 'native', pause: 'unsupported',
      },
      sessions: { multiTurn: 'native', resume: 'unsupported', fork: 'unsupported' },
    }),
    async spawn() { effects.adapterSpawn += 1; return { ok: false, reason: 'phase75 boundary fixture' }; },
    async prompt() { effects.adapterPrompt += 1; return { ok: false }; },
    async interrupt() { return { ok: true }; },
    async kill() { return { ok: true }; },
    async approve() { return { ok: true }; },
    async answer() { return { ok: true }; },
  };
  const coordinator = new Coordinator({
    log,
    coordination,
    repoId: 'repo-phase75',
    fences: new FenceTable(),
    adapters: { stub: adapter },
    taskTopologyPolicy: POLICY,
    worktrees: {
      async reserveCapacity() { effects.reserveCapacity += 1; return null; },
      async create(taskId) { effects.createWorktree += 1; return { path: `/tmp/phase75-${taskId}` }; },
      async remove() {},
      async releaseCapacity() {},
      async reconcile() {},
    },
    referee: async () => ({ reverified: true, observedExit: 0 }),
    route: () => 'stub',
    watchdog: { stallMs: 0 },
    stopDeadlineMs: 10,
  });
  return { label, coordination, coordinator, effects, localTaskIds: new Set() };
}

async function closeEffectFixture(fixture) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const live = fixture.coordinator.list().filter((handle) => fixture.localTaskIds.has(handle.taskId)).filter((handle) => {
      const status = fixture.coordination.task(handle.taskId)?.status;
      return !['cancelled', 'completed', 'failed'].includes(status);
    });
    if (live.length === 0) break;
    await sleep(5);
  }
  if (Date.now() >= deadline) throw new Error('phase75 Coordinator fixture did not settle before teardown');
  await fixture.coordinator.drain({
    actor: 'phase75', repoId: 'repo-phase75',
    idempotencyKey: `phase75-close-${fixture.label}`,
  });
  fixture.coordinator.closeAuthority();
  fixture.coordination.releaseWriterLease();
}

const coordinatorRefusals = storeRefusals.filter((scenario) => ![
  'total child fanout',
].includes(scenario.label));

const workerBrief = () => ({
  goal: 'topology admission', constraints: [], pathScope: ['**'],
  definitionOfDone: 'topology admitted or refused before effects',
  verification: { command: 'true', expectExit: 0 },
  budget: { tokens: 100, usd: 1, wallMin: 1 },
});

test('TT5: Coordinator accepts and durably preserves an explicit valid follow-up refinement', async (t) => {
  const fixture = effectFixture('valid-follow-up', (store) => create(store, 'parent'));
  t.after(() => closeEffectFixture(fixture));
  fixture.localTaskIds.add('coordinator-child');
  let error = null;
  try {
    await fixture.coordinator.spawn('stub', workerBrief(), {
      taskId: 'coordinator-child', runId: 'run-a', refines: 'parent',
      relation: 'follow_up', taskType: 'follow_up',
    });
  } catch (caught) { error = caught; }
  const child = fixture.coordination.task('coordinator-child');

  assert.deepEqual(
    { code: error?.code ?? null, relation: child?.relation ?? null, refines: child?.refines ?? null },
    { code: null, relation: 'follow_up', refines: 'parent' },
  );
});

for (const scenario of coordinatorRefusals) {
  test(`TT5: Coordinator refuses ${scenario.label} before capacity, worktree, or provider effects`, async (t) => {
    const fixture = effectFixture(scenario.label.replaceAll(' ', '-'), scenario.arrange);
    t.after(() => closeEffectFixture(fixture));
    const attemptFields = fields('coordinator-attempt', scenario.label === 'self refinement'
      ? { refines: 'coordinator-attempt', relation: 'follow_up' }
      : scenario.label === 'tasks per Run'
        ? {}
        : scenario.label === 'maximum depth'
          ? { refines: 'depth-2', relation: 'follow_up' }
          : scenario.label === 'per-relation child fanout'
            ? { refines: 'parent', relation: 'oracle' }
            : scenario.label === 'cross-Run refinement'
              ? { runId: 'run-b', refines: 'parent', relation: 'follow_up' }
              : scenario.label === 'unknown relation'
                ? { refines: 'parent', relation: 'delegate' }
                : { refines: 'absent', relation: 'follow_up' });
    let code = null;
    fixture.localTaskIds.add(attemptFields.id);
    try {
      await fixture.coordinator.spawn('stub', workerBrief(), {
        taskId: attemptFields.id,
        runId: attemptFields.runId,
        refines: attemptFields.refines,
        relation: attemptFields.relation,
        taskType: attemptFields.taskType,
      });
    } catch (error) { code = error?.code ?? error?.name ?? 'unknown_error'; }
    const observed = { code, effects: { ...fixture.effects } };

    assert.deepEqual(observed, {
      code: scenario.code,
      effects: { reserveCapacity: 0, createWorktree: 0, adapterSpawn: 0, adapterPrompt: 0 },
    });
  });
}

test('TT6: replay recomputes the identical bounded topology projection from durable task facts', () => {
  const directory = root('projection');
  const store = new CoordinationStore(directory, { taskTopologyPolicy: POLICY });
  create(store, 'root');
  create(store, 'follow', { refines: 'root', relation: 'follow_up' });
  create(store, 'review', { refines: 'root', relation: 'review' });
  create(store, 'oracle', { refines: 'follow', relation: 'oracle' });
  const live = store.taskTopology('run-a');

  assert.deepEqual(live, {
    schemaVersion: 1,
    runId: 'run-a',
    policyDigest: live.policyDigest,
    tasks: [
      {
        schemaVersion: 1, taskId: 'follow', runId: 'run-a', relation: 'follow_up',
        parentTaskId: 'root', depth: 1, ancestors: ['root'], childCount: 1,
        childrenByRelation: { follow_up: 0, oracle: 1, preserved_resume: 0, recovery: 0, review: 0, revision: 0 },
      },
      {
        schemaVersion: 1, taskId: 'oracle', runId: 'run-a', relation: 'oracle',
        parentTaskId: 'follow', depth: 2, ancestors: ['root', 'follow'], childCount: 0,
        childrenByRelation: { follow_up: 0, oracle: 0, preserved_resume: 0, recovery: 0, review: 0, revision: 0 },
      },
      {
        schemaVersion: 1, taskId: 'review', runId: 'run-a', relation: 'review',
        parentTaskId: 'root', depth: 1, ancestors: ['root'], childCount: 0,
        childrenByRelation: { follow_up: 0, oracle: 0, preserved_resume: 0, recovery: 0, review: 0, revision: 0 },
      },
      {
        schemaVersion: 1, taskId: 'root', runId: 'run-a', relation: 'root',
        parentTaskId: null, depth: 0, ancestors: [], childCount: 2,
        childrenByRelation: { follow_up: 1, oracle: 0, preserved_resume: 0, recovery: 0, review: 1, revision: 0 },
      },
    ],
  });
  assert.match(live.policyDigest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(store.taskTopologyNode('oracle'), live.tasks[1]);
  store.releaseWriterLease();

  const replay = new CoordinationStore(directory, { taskTopologyPolicy: POLICY });
  assert.deepEqual(replay.taskTopology('run-a'), live);
  replay.releaseWriterLease();
});
