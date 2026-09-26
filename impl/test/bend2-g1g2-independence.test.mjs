// Bend2 application lane B: G1 and G2 applied to the runtime.
//
// G1 (docs/bend2/examples/laws-annotation-independence.bend) states: for the same validated
// semantic request, authenticated authority, observed resources and external events, changing
// administrative annotations about work cannot change the runtime's selected checks, derived
// decision inputs, admission, refusal, management permissions, required prerequisites or
// continuation transitions. The model's other three laws are proved here too: the positive
// behavior law (an authorized request whose resource is available IS admitted — an
// always-refusing runtime fails it), the observation's provenance (the observation the runtime
// reads is the specified observation, never one computed from an annotation), and the decision's
// source (the decision is the derivation over the specified observation).
//
// G2 (docs/bend2/examples/laws-prerequisite-enabling.bend) states: for a valid authorized work
// request with its required semantic inputs, the runtime imposes no agent-maintained status,
// census, convergence or completion declaration as a prerequisite for admission or continued
// execution; a blocked continuation names the actual missing resource, authority, semantic input
// or explicit operator/orchestrator decision that enables it; each prerequisite names its
// enabling effect; and the runtime wakes the party the prerequisite names.
//
// The annotations this file varies are the ones the adopted statement lists: a convergence
// declaration, an expected-failure allowance, an incidental code census and a status declaration
// with no corresponding semantic effect. Where they enter the record they enter through the
// runtime's own surface, so a decision that read one would move.
//
// SUITE LAW: temp dirs, a scripted coordinator, a real git repository, no provider process, no
// network. No count or line number of other code is asserted; every assertion names a behavior.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SWARM_RESUME_CONTINUATION_MODES, resumeDecisionPending } from '../src/swarm-state.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { selectAffectedTests, selectFromRepository } from '../src/verification-selection.mjs';
import { allocatePhysicalWorkspaceOwner, createFromBase } from '../src/worktree.mjs';
import {
  defaultSuiteParallelism, deriveHostCapacity, hostCapacityObservation, hostCapacityShortfall,
} from '../src/host-capacity.mjs';

const SWARM_ID = 'independence';
const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const workerPrincipal = (workerId) => ({
  actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId,
});
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const deployment = {
  deploymentId: createHash('sha256').update('bend2-independence-deployment').digest('hex'),
  controllerId: createHash('sha256').update('bend2-independence-controller').digest('hex'),
  pid: process.pid, pidStart: 'bend2-independence-instance',
};

/** The administrative annotations the adopted G1 statement names. Each is a row an agent
 * maintains about work and none of them describes an effect, a measurement or an authenticated
 * grant: a convergence declaration, an expected-failure allowance, an incidental code census and
 * a status declaration. They are recorded through the runtime's own `swarm.update` surface, where
 * a row carrying no work is admitted as a note — never a seeded shortcut around admission. */
const ANNOTATION_TEXTS = Object.freeze([
  'convergence declaration: every selected file is declared converged at this commit',
  'expected-failure allowance: 417 contracts are allowed to fail',
  'incidental code census: impl/src holds 47 modules',
  'status declaration: the lane is recorded as finished',
]);

// ── the runtime fixture ───────────────────────────────────────────────────────────────────────

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-bend2-independence-'));
  const repo = join(directory, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q']);
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Bend2 independence', GIT_COMMITTER_NAME: 'Bend2 independence' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'bend2-independence@example.invalid', GIT_COMMITTER_EMAIL: 'bend2-independence@example.invalid' });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'base']);
  const baseSha = git(repo, ['rev-parse', 'HEAD']);
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const store = new CoordinationStore(join(directory, 'coordination'));
  const workers = [];
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
    routeCards: () => [],
    guideParticipant: async (workerId, message, options = {}) => {
      guides.push({ workerId, message, priority: options.priority ?? null });
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
    store, coordinator, hostCapacity: capacity,
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
        status: 'working', paused: false, terminalCause: null, sessionContext, worktree });
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
      ...(['view', 'watch', 'list'].includes(command) ? {} : { idempotencyKey: `independence-${++key}` }),
      ...args }, caller);
  const eventsOf = (kind, participantId) => store.eventsView()
    .filter((event) => (event.kind === 'driver.recorded' ? event.payload?.kind : event.kind) === kind
      && (participantId === undefined || event.payload?.participantId === participantId));
  return {
    store, runtime, repo, baseSha, workers, guides, capacity, call, eventsOf,
    seat: (participantId) => store.swarm(SWARM_ID)?.participants?.[participantId] ?? null,
    workerOf: (participantId) => {
      const row = store.swarm(SWARM_ID)?.participants?.[participantId] ?? null;
      return row === null ? null : workers.find((entry) => entry.runId === row.runId) ?? null;
    },
    checkoutOf: (participantId) => {
      const row = store.swarm(SWARM_ID).participants[participantId];
      return [...checkouts.values()].find((entry) => entry.workspaceId === row.workspaceId) ?? null;
    },
    recruit: (participantId, options = {}, caller = owner) => call('recruit', {
      participantId, objective: options.objective ?? `Continue the lane as ${participantId}`,
      ...(options.resumeFrom === undefined ? {} : { resumeFrom: options.resumeFrom }),
      ...(options.permissions === undefined ? {} : { permissions: options.permissions }),
    }, caller),
    /** Record every administrative annotation the statement names, through the runtime's own
     * update surface. Returns the kinds the runtime admitted them as. */
    annotate: async (caller = owner) => {
      const kinds = [];
      for (const text of ANNOTATION_TEXTS) {
        const recorded = await call('update',
          { event: 'swarm.contribution_recorded', payload: { body: text } }, caller);
        kinds.push(recorded.kind);
      }
      return kinds;
    },
  };
}

/** One seat interrupted mid-lane: recruited, one changed path in its checkout, settled by the
 * root's own stop. The recovery shape the resume decision answers. */
async function interruptedSeat(t) {
  const f = fixture(t);
  await f.call('create', { purpose: 'A recovered seat asks whether to continue' });
  await f.recruit('alpha');
  writeFileSync(join(f.checkoutOf('alpha').worktree, 'alpha-work.txt'), 'alpha work\n');
  await f.call('stop', { participantId: 'alpha', reason: 'Interrupted mid-lane' });
  return { f };
}

/** The observable admission and continuation facts of one seat: what a decision produced. */
const seatFacts = (f, participantId) => {
  const seat = f.seat(participantId);
  return {
    status: seat.status,
    resumeFrom: seat.resumeFrom ?? null,
    parentId: seat.parentId ?? null,
    bindings: (seat.bindings ?? []).length,
    worker: f.workerOf(participantId) !== null,
    leases: f.capacity.acquired.filter((row) => row.holder.endsWith(`:${participantId}`)).length,
  };
};

// ── G1: the selected checks ───────────────────────────────────────────────────────────────────

/** A checkout shaped like this repository's suite graph: one module under impl/src and the two
 * test files that could cover it. */
function selectionRepo(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-bend2-selection-'));
  const repo = join(directory, 'repo');
  mkdirSync(join(repo, 'impl', 'src'), { recursive: true });
  mkdirSync(join(repo, 'impl', 'test'), { recursive: true });
  writeFileSync(join(repo, 'impl', 'src', 'subject.mjs'), 'export const subject = 1;\n');
  writeFileSync(join(repo, 'impl', 'test', 'subject.test.mjs'),
    "import { subject } from '../src/subject.mjs';\nexport const check = subject;\n");
  writeFileSync(join(repo, 'impl', 'test', 'unrelated.test.mjs'), 'export const unrelated = 1;\n');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return repo;
}

test('G1 selected checks: the change\'s selected test files are the same under every administrative annotation', (t) => {
  const repo = selectionRepo(t);
  const select = () => selectFromRepository({ root: repo, changedPaths: ['impl/src/subject.mjs'] });
  const before = select();
  assert.deepEqual(before.files, ['impl/test/subject.test.mjs'],
    'the importing test is what the change selects');

  // The administrative annotations, as this repository keeps them: an expected-failure allowance
  // and a convergence list as a committed document, an incidental code census as a second one,
  // and a status declaration written into the graph the selector reads.
  mkdirSync(join(repo, 'impl', 'scripts'), { recursive: true });
  writeFileSync(join(repo, 'impl', 'scripts', 'expected-red.json'), JSON.stringify({
    contracts: ['impl/test/subject.test.mjs'], converged: ['impl/test/unrelated.test.mjs'],
  }));
  writeFileSync(join(repo, 'impl', 'scripts', 'seam-inventory.json'), JSON.stringify({
    seams: [{ file: 'impl/src/subject.mjs', members: ['subject'], count: 1 }], total: 47,
  }));
  writeFileSync(join(repo, 'impl', 'test', 'declaration.test.mjs'),
    'export const declaration = { converged: true, expectedFailures: 417, census: 47 };\n');

  assert.deepEqual(select(), before,
    'the selected checks are derived from the changed paths and the import graph alone');

  // The selector is not always-empty: a different changed path selects the test that imports it.
  assert.deepEqual(selectFromRepository({ root: repo, changedPaths: ['impl/test/unrelated.test.mjs'] }).files,
    ['impl/test/unrelated.test.mjs'], 'a changed test file selects itself');
});

test('G1 selected checks: the pure selector answers the same selection for the same graph', () => {
  const graph = new Map([
    ['impl/src/subject.mjs', { path: 'impl/src/subject.mjs', imports: new Set(), text: '' }],
    ['impl/test/subject.test.mjs', { path: 'impl/test/subject.test.mjs',
      imports: new Set(['impl/src/subject.mjs']), text: "from '../src/subject.mjs'" }],
    ['impl/test/declaration.test.mjs', { path: 'impl/test/declaration.test.mjs',
      imports: new Set(), text: 'export const converged = true;' }],
  ]);
  const selected = selectAffectedTests({ changedPaths: ['impl/src/subject.mjs'], graph });
  assert.deepEqual(selected.files, ['impl/test/subject.test.mjs']);
  assert.deepEqual(selected.provenance, [
    { path: 'impl/test/subject.test.mjs', reason: 'imports', via: 'impl/src/subject.mjs' },
  ], 'the selection names why each file runs and the path it was reached through');
});

// ── G1: the derived decision inputs ───────────────────────────────────────────────────────────

test('G1 derived decision inputs: the capacity derivation reads the specified observation and no annotation', () => {
  const measured = { cores: 8, totalBytes: 32e9, freeBytes: 30e9, availableBytes: 30e9, load1m: 0.5 };
  const observation = hostCapacityObservation(measured);
  const capacity = deriveHostCapacity(measured);

  // the provenance law: the observation the runtime reads is the specified observation.
  assert.deepEqual(hostCapacityObservation({ ...measured, converged: true, expectedFailures: 417 }),
    observation, 'an annotation riding the observation changes no observed resource');
  // the decision's source: the derivation is the derivation over that observation.
  assert.deepEqual(deriveHostCapacity(observation), capacity, 'the plan derives from the observation');
  // and the annotation changes no derived input.
  assert.deepEqual(deriveHostCapacity({ ...measured, converged: true, expectedFailures: 417 }), capacity,
    'the derived decision inputs are the same for every annotation');

  // the positive behavior law: an authorized request whose resource is available is admitted.
  assert.equal(hostCapacityShortfall('verify', capacity, { cores: 0, bytes: 0 }), null,
    'an available host refuses nothing');
  assert.ok(defaultSuiteParallelism(measured) >= 1);
  assert.equal(defaultSuiteParallelism({ ...measured, converged: true }), defaultSuiteParallelism(measured),
    'the suite width is the observation\'s, never an annotation\'s');

  // the derivation is not constant: a different measurement decides differently (an always-
  // refusing or always-admitting runtime fails this).
  const loaded = deriveHostCapacity({ ...measured, freeBytes: 1e6, availableBytes: 1e6 });
  assert.equal(loaded.memoryTight, true, 'an observation that cannot fund one verdict says so');
  assert.deepEqual(hostCapacityShortfall('verify', loaded, { cores: 0, bytes: 0 }),
    { dimension: 'memory', observed: 1e6, required: loaded.suiteBytes, unit: 'bytes' },
    'the blocked request names the measured dimension, what was observed and what was required');
});

// ── G1: admission ─────────────────────────────────────────────────────────────────────────────

test('G1 admission: a validated recruit is admitted identically with and without administrative annotations', async (t) => {
  const { f } = await interruptedSeat(t);
  await f.recruit('baseline');
  const clean = seatFacts(f, 'baseline');
  assert.deepEqual(clean, { status: 'active', resumeFrom: null, parentId: null,
    bindings: 1, worker: true, leases: 1 }, 'the unannotated admission binds the seat and takes its lease');

  const kinds = await f.annotate();
  assert.ok(kinds.every((kind) => kind === 'note'),
    'every annotation was admitted as a note — a row carrying no work');

  await f.recruit('annotated');
  assert.deepEqual(seatFacts(f, 'annotated'), clean,
    'the admission decision is the same for the same validated request under every annotation');
});

// ── G1: refusal ───────────────────────────────────────────────────────────────────────────────

test('G1 refusal: the refusal a declaration would have bought is the same refusal', async (t) => {
  const { f } = await interruptedSeat(t);
  await f.call('update', { event: 'swarm.work_updated',
    payload: { workId: 'W-1', objective: 'The lane the seat was carrying' } });

  const refusals = [];
  const completionRefusal = () => f.call('update', { event: 'swarm.work_updated',
    payload: { workId: 'W-1', status: 'completed' } })
    .then(() => null, (error) => error);
  refusals.push(await completionRefusal());
  await f.annotate();
  refusals.push(await completionRefusal());

  for (const refusal of refusals) {
    assert.equal(refusal?.code, 'swarm_completion_unproven',
      'a declared completion with no accepted contribution refuses');
    assert.deepEqual(refusal.detail, { workId: 'W-1', accepted: [] },
      'the refusal is the same refusal, with the same evidence it read');
  }
});

// ── G1: management permissions ────────────────────────────────────────────────────────────────

test('G1 management permissions: the permission a caller holds over a seat is the same under every annotation', async (t) => {
  const { f } = await interruptedSeat(t);
  await f.recruit('beta');
  const betaWorker = f.workerOf('beta');
  const asBeta = workerPrincipal(betaWorker.id);

  const view = await f.call('view', {}, asBeta);
  assert.ok(view.updates !== undefined, 'the view carries the caller\'s admissible update kinds');
  const clean = { updates: view.updates, actions: view.availableActions };

  const crossSeatStop = () => f.call('stop', { participantId: 'alpha', reason: 'not mine to stop' }, asBeta)
    .then(() => null, (error) => error);
  const before = await crossSeatStop();
  assert.equal(before?.code, 'swarm_permission_required',
    'a seat that does not lead alpha cannot stop it');

  await f.annotate();

  const after = await crossSeatStop();
  assert.equal(after?.code, before.code, 'the permission decision is unchanged');
  assert.deepEqual(after?.detail, before?.detail, 'and names the same permission and seat');
  const annotated = await f.call('view', {}, asBeta);
  assert.deepEqual({ updates: annotated.updates, actions: annotated.availableActions }, clean,
    'the admissible acts a view advertises are unchanged');
});

// ── G1: required prerequisites ────────────────────────────────────────────────────────────────

test('G1 required prerequisites: the prerequisite the runtime demands is the same, and is never bookkeeping', async (t) => {
  const { f } = await interruptedSeat(t);
  await f.call('update', { event: 'swarm.work_updated',
    payload: { workId: 'W-2', objective: 'A second lane' } });
  await f.annotate();

  const refusal = await f.call('update', { event: 'swarm.work_updated',
    payload: { workId: 'W-2', status: 'completed' } }).then(() => null, (error) => error);
  assert.equal(refusal?.code, 'swarm_completion_unproven',
    'no status, census, convergence or completion declaration is a prerequisite for completion');

  // The prerequisite the runtime named is the actual missing need — an accepted contribution
  // referencing the work — and satisfying it makes progress with no administrative act.
  await f.call('update', { event: 'swarm.contribution_recorded',
    payload: { contributionId: 'c-W2', participantId: 'alpha', workId: 'W-2', body: 'Lane two done' } });
  await f.call('update', { event: 'swarm.contribution_reviewed',
    payload: { contributionId: 'c-W2', decision: 'accept', reason: 'verified' } });
  await f.call('update', { event: 'swarm.work_updated',
    payload: { workId: 'W-2', status: 'completed' } });
  assert.equal(f.store.swarm(SWARM_ID).work['W-2'].status, 'completed',
    'the satisfied prerequisite completes the work without a separate acknowledgment');
});

// ── G1: continuation transitions ──────────────────────────────────────────────────────────────

test('G1 continuation transitions: the recovery decision is pending under every annotation', async (t) => {
  const { f } = await interruptedSeat(t);
  await f.recruit('baseline', { resumeFrom: 'alpha' });
  const clean = seatFacts(f, 'baseline');
  assert.deepEqual(clean, { status: 'active', resumeFrom: 'alpha', parentId: null,
    bindings: 0, worker: false, leases: 0 },
  'under manual continuation the successor asks before it works, holding no lease');
  assert.equal(f.seat('baseline').resumeDecision.requested.predecessor, 'alpha');
  assert.equal(resumeDecisionPending(f.seat('baseline')), true);

  await f.annotate();

  await f.recruit('annotated', { resumeFrom: 'alpha' });
  assert.deepEqual(seatFacts(f, 'annotated'), clean,
    'the continuation transition is the same under every annotation');
  assert.equal(f.seat('annotated').resumeDecision.requested.predecessor, 'alpha');

  // The predicate reads the row's own events: an answer settles it, an annotation never does.
  const row = { ...f.seat('annotated'), converged: true, expectedFailures: 417, census: 47 };
  assert.equal(resumeDecisionPending(row), true, 'an annotation on the row changes no pending state');
  assert.equal(resumeDecisionPending({ ...row, resumeDecision: { requested: row.resumeDecision.requested,
    answered: { at: '2026-09-25T00:00:00.000Z' } } }), false,
  'the orchestrator\'s answer is what settles it');
  assert.equal(resumeDecisionPending({ ...row, status: 'left' }), false,
    'a seat that left is not decision-pending');
  assert.deepEqual([...SWARM_RESUME_CONTINUATION_MODES], ['manual', 'auto'],
    'the posture is the operator\'s own closed decision axis');
});

// ── G2: a blocked continuation names the missing decision, its party and its enabling acts ────

test('G2 blocked continuation: the row names the missing decision, the party that answers and both acts that enable it', async (t) => {
  const { f } = await interruptedSeat(t);
  await f.recruit('bravo', { resumeFrom: 'alpha' });

  const view = await f.call('view');
  const row = (view.attention ?? []).find((entry) => entry.kind === 'resume_decision_required'
    && entry.participantId === 'bravo');
  assert.ok(row, 'the blocked continuation is one attention row');
  assert.equal(row.predecessor, 'alpha', 'the row names what the recovery resumes');
  assert.equal(row.since, f.seat('bravo').resumeDecision.requested.at,
    'and when the question was asked');
  assert.ok(row.responsibleParticipant === null ? row.responsibleActor !== null
    : row.responsibleParticipant !== null,
  'the row names the party that must answer — a seat or the swarm\'s actor, never nobody');
  assert.equal(row.next?.continue?.command, 'swarm.guide',
    'one enabling act is the answer that continues the seat');
  assert.equal(row.next?.continue?.participantId, 'bravo');
  assert.equal(row.next?.stop?.command, 'swarm.stop',
    'the other is the decision not to continue');
  assert.equal(row.next?.stop?.participantId, 'bravo');

  const request = f.eventsOf('swarm.resume_decision_requested', 'bravo');
  assert.equal(request.length, 1, 'the question is one durable row, never only an attention row');
  assert.equal(request[0].payload.carry?.how, 'bound', 'it names the carry the answer would take');
});

// ── G2: no administrative declaration satisfies a prerequisite ────────────────────────────────

test('G2 no administrative declaration satisfies a prerequisite', async (t) => {
  const { f } = await interruptedSeat(t);
  await f.call('update', { event: 'swarm.work_updated',
    payload: { workId: 'W-3', objective: 'A lane whose completion must be evidenced' } });
  await f.recruit('bravo', { resumeFrom: 'alpha' });

  // Every annotation the statement names is now in the record, including a status declaration
  // that says the work is finished and a convergence declaration that says it is converged.
  await f.annotate();

  const refusal = await f.call('update', { event: 'swarm.work_updated',
    payload: { workId: 'W-3', status: 'completed' } }).then(() => null, (error) => error);
  assert.equal(refusal?.code, 'swarm_completion_unproven',
    'a declaration is not the accepted contribution the prerequisite names');
  assert.deepEqual(refusal.detail, { workId: 'W-3', accepted: [] });

  assert.equal(f.seat('bravo').resumeDecision.answered ?? null, null,
    'an annotation is not the orchestrator\'s answer, so the seat stays pending');
  assert.equal(f.workerOf('bravo'), null, 'and it is not started by one');
  assert.equal(resumeDecisionPending(f.seat('bravo')), true);

  // A declaration is not the prerequisite even when it cites work: only an unrevoked accept is.
  const cited = await f.call('update', { event: 'swarm.work_updated',
    payload: { workId: 'W-3', status: 'completed', basis: { contributionIds: ['the convergence declaration'] } } })
    .then(() => null, (error) => error);
  assert.equal(cited?.code, 'swarm_completion_unproven',
    'a cited declaration names no contribution, so the prerequisite is still unsatisfied');
  assert.deepEqual(cited.detail.problems, [{ contributionId: 'the convergence declaration', problem: 'unknown contribution' }],
    'and the refusal names what the cited basis failed to be');
});

// ── G2: each prerequisite names its enabling effect ───────────────────────────────────────────

test('G2 enabling effect: every prerequisite the runtime demands names the act that enables it', async (t) => {
  const { f } = await interruptedSeat(t);
  await f.call('update', { event: 'swarm.work_updated',
    payload: { workId: 'W-4', objective: 'A lane awaiting its evidence' } });
  await f.recruit('bravo', { resumeFrom: 'alpha' });

  const refusal = await f.call('update', { event: 'swarm.work_updated',
    payload: { workId: 'W-4', status: 'completed' } }).then(() => null, (error) => error);
  assert.match(refusal.message, /Record an accept review on a contribution that names it/,
    'the refusal names the act that enables completion');
  assert.match(refusal.message, /cite accepted contributions with basis\.contributionIds/,
    'and the second act that does');

  const view = await f.call('view');
  const row = (view.attention ?? []).find((entry) => entry.kind === 'resume_decision_required'
    && entry.participantId === 'bravo');
  assert.ok(row, 'the pending recovery is the runtime\'s other blocked continuation');
  assert.ok(Object.keys(row.next ?? {}).length === 2,
    'the blocked continuation names exactly the acts that enable it, and nothing else');

  // A measured prerequisite names its dimension and numbers, never a bare refusal.
  const capacity = deriveHostCapacity({ cores: 8, totalBytes: 32e9, freeBytes: 1e6, availableBytes: 1e6, load1m: 0.5 });
  const shortfall = hostCapacityShortfall('verify', capacity, { cores: 0, bytes: 0 });
  assert.deepEqual(Object.keys(shortfall).sort(), ['dimension', 'observed', 'required', 'unit'],
    'a blocked admission names why, what was observed and what was required');
});

// ── G2: the runtime wakes the party the prerequisite names ───────────────────────────────────

test('G2 wake: the ask reaches the party the row names responsible', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'A recovery decision finds the level that recruited the seat' });
  await f.recruit('sub', { permissions: ['read', 'communicate', 'contribute', 'recruit'] });
  const subWorker = f.workerOf('sub');
  assert.ok(subWorker !== null);
  await f.recruit('alpha', {}, workerPrincipal(subWorker.id));
  assert.equal(f.seat('alpha').parentId, 'sub', 'the sub-orchestrator leads its recruit');
  writeFileSync(join(f.checkoutOf('alpha').worktree, 'alpha-work.txt'), 'alpha work\n');
  await f.call('stop', { participantId: 'alpha', reason: 'Interrupted mid-lane' });

  await f.recruit('bravo', { resumeFrom: 'alpha' });
  const row = (await f.call('view')).attention
    .find((entry) => entry.kind === 'resume_decision_required' && entry.participantId === 'bravo');
  assert.ok(row, 'the question pages as one attention row');
  assert.equal(row.responsibleParticipant, 'sub',
    'the row names the sub-orchestrator as the party that answers');
  assert.equal(f.seat('bravo').parentId, 'sub',
    'the join names the same party, so the seat a question pages and the seat its ask reaches are one');

  const ask = f.guides.find((entry) => entry.workerId === subWorker.id
    && /Resume decision for bravo/.test(entry.message));
  assert.ok(ask, 'the runtime woke the party the prerequisite names');
  assert.match(ask.message, /baton swarm guide independence bravo/,
    'the ask names the enabling act');
  assert.match(ask.message, /baton swarm stop independence bravo/,
    'and the other act that settles the question');
});
