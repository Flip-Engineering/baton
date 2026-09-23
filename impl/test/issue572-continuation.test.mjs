// Issue #572: resumed seats continue and turn reports reach their parents.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { deliverRootWakeFrame } from '../src/wake-delivery.mjs';
import { SwarmRuntime, SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';
import { allocatePhysicalWorkspaceOwner, createFromBase } from '../src/worktree.mjs';

const SWARM_ID = 'recovery-543';
const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
// A seat's TWO identities, exactly as the native bridge mints them (#273): the actor carries the
// `swarm-native:<swarm>:<participant>` spelling the provenance derivation reads, and the principalId
// carries the worker the membership resolves through.
const seatPrincipal = (workerId, participantId) => ({ actor: `swarm-native:${SWARM_ID}:${participantId}`,
  principalId: `worker:${workerId}`, sessionId: workerId });
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const deployment = {
  deploymentId: createHash('sha256').update('issue543-deployment').digest('hex'),
  controllerId: createHash('sha256').update('issue543-controller').digest('hex'),
  pid: process.pid, pidStart: 'issue543-instance',
};

function fixture(t, { midTurn = 'supported' } = {}) {
  const directory = mkdtempSync(join(process.cwd(), '.baton-issue572-'));
  const repo = join(directory, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Issue 543']);
  git(repo, ['config', 'user.email', 'issue543@example.invalid']);
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'base']);
  const baseSha = git(repo, ['rev-parse', 'HEAD']);
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const store = new CoordinationStore(join(directory, 'coordination'));
  const workers = [];
  const vendor = midTurn === 'unsupported' ? 'one-shot' : 'mock';
  const capacity = {
    acquired: [], released: [],
    acquire: async (kind, { holder }) => {
      capacity.acquired.push({ kind, holder });
      return { token: { kind, nonce: `${capacity.acquired.length}`.padStart(32, '0'),
        residentId: deployment.controllerId } };
    },
    release: async (token) => { capacity.released.push(token); return true; },
    releaseWorkersExcept: async () => 0,
  };
  const checkouts = new Map();
  const guides = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    routeCards: () => (midTurn === 'unsupported'
      ? [{ name: vendor, card: { verbs: { prompt: 'unsupported', steer: 'unsupported' } } }]
      : []),
    guideParticipant: async (workerId, message, options = {}) => {
      guides.push({ workerId, message, priority: options.priority ?? null });
      if (midTurn === 'unsupported') return { ok: false, result: 'unsupported' };
      const worker = workers.find((row) => row.id === workerId);
      if (worker) worker.delivered.push(message);
      return { ok: true };
    },
    workspaceAttachment: (workerId) => checkouts.get(workerId) ?? null,
    liveWorkspaceHolders: () => [],
    predecessorWorkspaceContext: (workspaceId) => {
      const row = [...checkouts.values()].find((entry) => entry.workspaceId === workspaceId);
      return row === undefined ? null : { sessionContext: row.sessionContext, holders: [] };
    },
  };
  const runtime = new SwarmRuntime({
    store,
    coordinator,
    hostCapacity: capacity,
    authorize: async () => {},
    prepareRun: async (request) => ({ ...request }),
    situationGit: { repoRoot: repo },
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      const carried = request.workspace ?? null;
      const carriedCheckout = carried?.workspaceId === undefined
        ? null : join(repo, '.baton', 'wt', carried.workspaceId);
      let workspaceId = carried?.workspaceId ?? null;
      let worktree = carriedCheckout !== null && existsSync(carriedCheckout) ? carriedCheckout : null;
      if (worktree === null) {
        const receipt = allocatePhysicalWorkspaceOwner(repo, {
          runId: request.runId, attemptId: `attempt-${workers.length + 1}`,
          logicalTaskId: request.participantId, processGeneration: 1, baseSha,
        }, deployment);
        workspaceId = receipt.physicalOwnerId;
        worktree = (await createFromBase(repo, workspaceId, baseSha, { ownerReceipt: receipt })).dir;
      }
      const workerId = `w-${workers.length + 1}`;
      const sessionContext = carried?.sessionContext
        ?? { ownerTaskId: workspaceId, worktree, branch: `baton/${workspaceId}`, baseSha };
      checkouts.set(workerId, { workspaceId, worktree, sessionContext });
      workers.push({ id: workerId, taskId: `t-${workers.length + 1}`, runId: request.runId,
        status: 'working', paused: false, terminalCause: null, vendor, delivered: [],
        sessionContext, worktree });
    },
    stopRun: async (runId) => {
      workers.find((row) => row.runId === runId).status = 'dead';
      return { state: 'closed' };
    },
    lastCrash: () => null,
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: SWARM_ID,
      ...(['view', 'watch', 'list'].includes(command) ? {} : { idempotencyKey: `ask543-${++key}` }),
      ...args }, caller);
  const eventsOf = (kind, participantId) => store.eventsView()
    .filter((event) => (event.kind === 'driver.recorded' ? event.payload?.kind : event.kind) === kind
      && (participantId === undefined || event.payload?.participantId === participantId));
  const workerOf = (participantId) => {
    const row = store.swarm(SWARM_ID)?.participants?.[participantId] ?? null;
    return row === null ? null : workers.find((entry) => entry.runId === row.runId) ?? null;
  };
  return {
    store, runtime, repo, baseSha, workers, guides, capacity, call, eventsOf, workerOf,
    asSeat: (participantId) => seatPrincipal(workerOf(participantId).id, participantId),
    seat: (participantId) => store.swarm(SWARM_ID)?.participants?.[participantId] ?? null,
    recruit: (participantId, options = {}, caller = owner) => call('recruit', {
      participantId, objective: options.objective ?? `Continue the lane as ${participantId}`,
      ...(options.resumeFrom === undefined ? {} : { resumeFrom: options.resumeFrom }),
      ...(options.permissions === undefined ? {} : { permissions: options.permissions }),
    }, caller),
  };
}

/** One interrupted seat in the tree of a sub-orchestrator: `lead` recruited `alpha`, alpha was
 * interrupted mid-lane, and the interruption is what a successor resumes (docs/52 D4's tree). */
async function interruptedLane(t, options = {}) {
  const f = fixture(t, options);
  await f.call('create', { purpose: 'A recovered seat asks its lead whether to continue' });
  await f.recruit('lead', { permissions: [...SWARM_PERMISSIONS] });
  await f.recruit('alpha', {}, f.asSeat('lead'));
  const checkout = [...f.workerOf('alpha').worktree ? [{ worktree: f.workerOf('alpha').worktree }] : []][0];
  writeFileSync(join(checkout.worktree, 'alpha-work.txt'), 'alpha work\n');
  await f.call('stop', { participantId: 'alpha', reason: 'Interrupted mid-lane' });
  assert.equal(f.seat('alpha').status, 'left');
  return f;
}

test('572-a: a successor starts immediately under the default policy', async (t) => {
  const f = await interruptedLane(t);
  await f.recruit('bravo', { resumeFrom: 'alpha' }, f.asSeat('lead'));
  assert.equal(f.seat('bravo').parentId, 'lead');
  assert.equal(f.seat('bravo').bindings.length, 1);
  assert.ok(f.workerOf('bravo'));
  assert.equal(f.eventsOf('swarm.resume_decision_requested').length, 0);
  assert.equal(f.capacity.acquired.filter((row) => row.holder.endsWith(':bravo')).length, 1);
});

test('572-b: a stored manual policy continues a successor', async (t) => {
  const f = await interruptedLane(t);
  f.store.recordSwarm('swarm.policy_updated', { swarmId: SWARM_ID,
    resumeContinuation: 'manual' }, { actor: 'owner', key: 'legacy-manual' });
  await f.recruit('bravo', { resumeFrom: 'alpha' });
  assert.ok(f.workerOf('bravo'));
  assert.equal(f.eventsOf('swarm.resume_decision_requested').length, 0);
});

test('572-c: a turn report reaches the parent once', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Report turns' });
  await f.recruit('lead', { permissions: [...SWARM_PERMISSIONS] });
  await f.recruit('alpha', {}, f.asSeat('lead'));
  const report = { swarmId: SWARM_ID, participantId: 'alpha',
    workerId: f.workerOf('alpha').id, turnSeq: 10, turnEpoch: 1,
    report: { status: 'completed', summary: 'Implemented continuation' } };
  await Promise.all([f.runtime.reportTurnEnd(report), f.runtime.reportTurnEnd(report)]);
  assert.equal(f.guides.length, 1);
  assert.equal(f.guides[0].workerId, f.workerOf('lead').id);
  assert.match(f.guides[0].message, /Implemented continuation/);
  assert.equal(f.eventsOf('swarm.turn_reported').length, 1);
  assert.equal(f.eventsOf('swarm.turn_report_delivered').length, 1);
});

test('572-d: a top-level turn records a root-addressed report', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Report top-level turns' });
  await f.recruit('alpha');
  await f.runtime.reportTurnEnd({ swarmId: SWARM_ID, participantId: 'alpha',
    workerId: f.workerOf('alpha').id, turnSeq: 10, turnEpoch: 1,
    report: { status: 'completed', summary: 'Work continues' } });
  assert.equal(f.eventsOf('swarm.turn_reported')[0].payload.parentId, null);
});

test('572-e: an older pending successor starts on recovery', async (t) => {
  const f = await interruptedLane(t);
  f.store.recordSwarm('swarm.participant_joined', {
    swarmId: SWARM_ID, participantId: 'bravo', runId: 'run-legacy-bravo',
    role: 'Continue alpha', resumeFrom: 'alpha', parentId: 'lead',
    permissions: ['read', 'communicate', 'contribute'],
  }, { actor: 'owner', key: 'legacy-bravo-join' });
  f.store.recordSwarm('swarm.resume_decision_requested', {
    swarmId: SWARM_ID, participantId: 'bravo', predecessor: 'alpha',
    carry: { how: 'bound' }, plan: { options: {} },
  }, { actor: 'owner', key: 'legacy-bravo-request' });
  await f.call('view');
  assert.ok(f.workerOf('bravo'));
  assert.equal(f.eventsOf('swarm.resume_decision_answered', 'bravo')[0].payload.guidance.automatic, true);
  await f.call('view');
  assert.equal(f.eventsOf('swarm.resume_decision_answered', 'bravo').length, 1);
});

test('572-f: default participants can review peers and land contributions', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Delegate review and landing' });
  await f.recruit('alpha');
  await f.recruit('beta');
  const view = await f.call('view', {}, f.asSeat('alpha'));
  assert.ok(view.availableActions.includes('swarm.integrate'));
  assert.ok(view.availableActions.includes('swarm.check'));
  assert.deepEqual(view.actionTargets['swarm.check'].participantIds, ['beta']);
});


test('572-g: unavailable guidance records the delivery refusal', async (t) => {
  const f = fixture(t, { midTurn: 'unsupported' });
  await f.call('create', { purpose: 'Report delivery truth' });
  await f.recruit('alpha');
  const answer = await f.call('guide', { participantId: 'alpha', message: 'Continue this task' });
  assert.equal(answer.guide.delivery.state, 'refused');
  assert.equal(answer.guide.delivery.reason, 'unsupported');
  assert.equal(f.eventsOf('swarm.guidance_parked').length, 0);
  assert.equal(f.eventsOf('swarm.guidance_sent')[0].payload.message, 'Continue this task');
});


test('572-h: a refused parent delivery addresses the report to root', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Recover report delivery' });
  await f.recruit('lead', { permissions: [...SWARM_PERMISSIONS] });
  await f.recruit('alpha', {}, f.asSeat('lead'));
  f.runtime.coordinator.guideParticipant = async () => { throw Object.assign(new Error('gone'), { code: 'worker_not_active' }); };
  await f.runtime.reportTurnEnd({ swarmId: SWARM_ID, participantId: 'alpha',
    workerId: f.workerOf('alpha').id, turnSeq: 10, turnEpoch: 1,
    report: { status: 'completed', summary: 'Ready for review' } });
  const rootReport = f.eventsOf('swarm.turn_reported').at(-1);
  assert.equal(rootReport.payload.parentId, null);
  assert.equal(rootReport.payload.deliveryFailure.reason, 'worker_not_active');
});


test('572-i: an invalid turn identity refuses before recording or delivery', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Validate turn reports' });
  await f.recruit('alpha');
  await assert.rejects(f.runtime.reportTurnEnd({ swarmId: SWARM_ID, participantId: 'alpha',
    workerId: f.workerOf('alpha').id, turnEpoch: 1, report: { status: 'completed' } }),
  { code: 'swarm_payload_invalid' });
  assert.equal(f.eventsOf('swarm.turn_reported').length, 0);
  assert.equal(f.guides.length, 0);
});


for (const status of ['dead', 'stopping']) {
  test(`572-j: a ${status} parent routes the report to root`, async (t) => {
    const f = fixture(t);
    await f.call('create', { purpose: 'Recover unavailable parents' });
    await f.recruit('lead', { permissions: [...SWARM_PERMISSIONS] });
    await f.recruit('alpha', {}, f.asSeat('lead'));
    f.workerOf('lead').status = status;
    const receipt = await f.runtime.reportTurnEnd({ swarmId: SWARM_ID, participantId: 'alpha',
      workerId: f.workerOf('alpha').id, turnSeq: 10, turnEpoch: 1,
      report: { status: 'completed', summary: 'Ready for review' } });
    assert.equal(receipt.delivery.state, 'root_addressed');
    assert.equal(receipt.event.payload.parentId, null);
    assert.equal(f.guides.length, 0);
  });
}


test('572-k: the root reconciler runs at the report boundary', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Wake root immediately' });
  await f.recruit('alpha');
  const observed = [];
  f.runtime._reconcileTurnReportedRows = () => observed.push(f.eventsOf('swarm.turn_reported').length);
  await f.runtime.reportTurnEnd({ swarmId: SWARM_ID, participantId: 'alpha',
    workerId: f.workerOf('alpha').id, turnSeq: 10, turnEpoch: 1, report: { status: 'completed' } });
  assert.deepEqual(observed, [1]);
});


test('572-l: a failed successor wakes root and preserves recovery for other seats', async (t) => {
  const f = await interruptedLane(t);
  for (const participantId of ['bravo', 'charlie']) {
    f.store.recordSwarm('swarm.participant_joined', {
      swarmId: SWARM_ID, participantId, runId: `legacy-${participantId}`,
      role: 'Continue work', resumeFrom: 'alpha', parentId: 'lead',
      permissions: ['read', 'communicate', 'contribute'],
    }, { actor: 'owner', key: `join-${participantId}` });
    f.store.recordSwarm('swarm.resume_decision_requested', {
      swarmId: SWARM_ID, participantId, predecessor: 'alpha',
      carry: { how: 'bound' }, plan: { options: {} },
    }, { actor: 'owner', key: `request-${participantId}` });
  }
  const start = f.runtime.startRun;
  f.runtime.startRun = async (request, ...args) => {
    if (request.participantId === 'bravo') {
      throw Object.assign(new Error('Workspace observation unavailable'), { code: 'workspace_unavailable' });
    }
    return start(request, ...args);
  };
  await f.call('view');
  assert.equal(f.workerOf('bravo'), null);
  assert.ok(f.workerOf('charlie'));
  assert.equal(f.eventsOf('swarm.resume_decision_answered', 'bravo').length, 0);
  const owed = f.eventsOf('swarm.root_attention_owed', 'bravo');
  assert.equal(owed.length, 1);
  assert.equal(owed[0].payload.owed, 'continuation_failed');
  assert.equal(JSON.parse(owed[0].payload.ask).code, 'workspace_unavailable');
  let body;
  await deliverRootWakeFrame({ store: f.store,
    frame: { seq: owed[0].seq, wakeClass: 'root_owed', swarmId: SWARM_ID },
    target: { harness: 'claude-code', sessionId: 'root-session' },
    deliver: async (message) => { body = message.body; return { delivered: true }; },
  });
  assert.match(body, /continuation_failed/);
  await f.call('view');
  assert.equal(f.eventsOf('swarm.root_attention_owed', 'bravo').length, 1);
  f.runtime.startRun = start;
  await f.call('view');
  assert.ok(f.workerOf('bravo'));
  assert.equal(f.eventsOf('swarm.resume_decision_answered', 'bravo').length, 1);
});
