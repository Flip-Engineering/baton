// runtime-recovery.test.mjs — issue #259, slice 8. Pins the module the coordinator's recovery
// bucket moved into (impl/src/runtime-recovery.mjs) against the injected recorder port (slice 6),
// and the coordinator that now delegates to it. Five claims are load-bearing:
//
//   1. ONE-WAY IMPORT, NO IMPLICIT RECEIVER — the module imports neither monolith, and every
//      `this` access in it belongs to the one relocated error-class constructor; the moved member
//      bodies read the coordinator through the explicit `coordinator` parameter and record through
//      the explicit `recorder` parameter, exactly as their map target's receiver declares.
//   2. SAME NAME, SAME ARITY, SAME PORT — every member the seam map shows as a `recovery_port`
//      delegate keeps the member's own parameter list on both sides of the boundary, and every
//      delegate hands the class's recorder (`this._recorder`) to the module function.
//   3. THE RECORDER IS THE ONLY RECORDING PATH — a fake recorder driving `_replay` observes every
//      recording act the fold performs (log appends, evidence mapping, recordDriver rows, durable
//      task transitions), and the durable event a `log.append` returns is what the write keys are
//      built from — the property the replay gap keys and the refinement receipts depend on.
//   4. THE PRIMITIVES MOVED ONCE — the 28 relocated declarations are exported by the module,
//      imported back by the coordinator, and the coordinator's export surface is unchanged
//      (SessionSelectionError stays reachable from `coordinator.mjs` and is the same class object).
//   5. THE MAP SEES THE MOVE — the committed seam artifact carries the runtime-recovery target, and
//      every delegate it shows with `recovery:recovery_port` evidence classifies as `recovery`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import * as runtimeRecovery from '../src/runtime-recovery.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { memberSource } from './seam-member-source.mjs';

const require = createRequire(import.meta.url);
const { Lang, parse } = require('@ast-grep/napi');

const MEMBER_FILE = 'impl/src/runtime-recovery.mjs';
const COORD_FILE = 'impl/src/coordinator.mjs';
const OBSERVATION_FILE = 'impl/src/runtime-observation.mjs';
const MAP_FILE = 'impl/scripts/seam-inventory.json';
const read = (relative) => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');
const parseOf = (text) => parse(Lang.JavaScript, text).root();

const RELOCATED_PRIMITIVES = Object.freeze([
  'KILL_RULES', 'LOGICAL_CALL_PHASES', 'PUSH_REFUSAL_CODES', 'REARM_KINDS',
  'RUN_TIMELINE_OPERATIONAL_KINDS', 'SessionSelectionError', 'TERMINAL_TASK_STATUSES',
  'addSafeTokenCounts', 'boundedProcessObservation', 'canonical', 'canonicalDigest',
  'cardSupportsSession', 'decisionRef', 'deepFreeze', 'logicalCallTransition', 'minimalBrief',
  'normalizeSessionRequest', 'officialCoordinateMatches', 'providerProcessingFailureCode',
  'replayProviderGovernanceRoute', 'startupReconcilerNext', 'startupReconcilerRecord',
  'throwIfProviderCancelled', 'typedTerminalCode', 'validLogicalCallId', 'validLogicalCallPhase',
  'validWorkspaceOwnerBoundPayload', 'workspaceOwnerExpectation',
  // slice 12's base-layer relocations (the shared declarations the effect and admission modules
  // both read; effects may import admission, never the reverse, so these live here)
  'IntegrationError', 'ORIENTATION_DELIVERY', 'noop', 'closedVerificationVerdict',
]);
const REEXPORTED = Object.freeze(['PUSH_REFUSAL_CODES', 'REARM_KINDS', 'IntegrationError', 'SessionSelectionError']);
/** Slice 12: defined here, but read back through runtime-observation.mjs's unchanged surface
 * (the coordinator's import of them names the observation module, per slice 10's table). */
const OBSERVATION_REEXPORTED = Object.freeze(['noop', 'closedVerificationVerdict']);

test('RR1: the recovery module imports neither monolith and keeps no implicit receiver', () => {
  const text = read(MEMBER_FILE);
  const root = parseOf(text);
  const importSources = root.findAll({ rule: { kind: 'import_statement' } })
    .map((node) => node.field('source').text());
  for (const source of importSources) {
    assert.ok(!/coordinator\.mjs|application\.mjs/.test(source), `one-way import violated: ${source}`);
  }
  // The only `this` accesses in the module live inside the relocated error-class constructors
  // (SessionSelectionError; slice 12 added IntegrationError) — the same exemption the store's
  // moved modules pin (CI1). Every moved member body reads `coordinator` and `recorder`
  // explicitly.
  const thisSites = [];
  const walk = (node, owner) => {
    if (node.kind() === 'function_declaration' || node.kind() === 'class_declaration') {
      owner = node.field('name') ? node.field('name').text() : owner;
    }
    if (node.kind() === 'member_expression' && node.field('object').text() === 'this') {
      thisSites.push({ owner, text: node.text() });
    }
    for (const child of node.children()) walk(child, owner);
  };
  walk(root, '(module scope)');
  const outside = thisSites.filter((site) => !['SessionSelectionError', 'IntegrationError'].includes(site.owner));
  assert.equal(outside.length, 0, `implicit receivers outside the relocated error class: ${outside.map((s) => `${s.owner}.${s.text}`).join(', ')}`);
});

test('RR2: every recovery_port delegate keeps the member name, parameter list, and hands over the recorder', () => {
  const map = JSON.parse(read(MAP_FILE));
  const coordinatorFile = map.files.find((file) => file.file === COORD_FILE);
  const delegated = coordinatorFile.members
    .filter((member) => member.evidence.includes('recovery:recovery_port'))
    .map((member) => member.name);
  assert.ok(delegated.length >= 42, `expected the 42 moved delegates in the map, found ${delegated.length}`);
  const memberRoot = parseOf(read(MEMBER_FILE));
  const memberParams = new Map();
  for (const fn of [...memberRoot.findAll({ rule: { kind: 'function_declaration' } }), ...memberRoot.findAll({ rule: { kind: 'generator_function_declaration' } })]) {
    const params = fn.field('parameters');
    memberParams.set(fn.field('name').text(), params ? params.text() : '()');
  }
  const coordText = read(COORD_FILE);
  const coordRoot = parseOf(coordText);
  const cls = coordRoot.findAll({ rule: { kind: 'class_declaration' } })
    .find((node) => node.field('name').text() === 'Coordinator');
  const delegateParams = new Map();
  const delegatePort = new Map();
  for (const method of cls.field('body').children().filter((n) => n.kind() === 'method_definition')) {
    const name = method.field('name').text();
    if (!delegated.includes(name)) continue;
    const params = method.field('parameters');
    delegateParams.set(name, params ? params.text() : '()');
    delegatePort.set(name, method.text().includes('this._recorder'));
  }
  for (const name of delegated) {
    assert.ok(memberParams.has(name), `module function missing for delegate ${name}`);
    // The module function carries the two injected boundary parameters first; the rest must be
    // the member's own list.
    const moduleOwn = memberParams.get(name).replace(/^\(coordinator, recorder,?\s*/, '(');
    assert.equal(
      delegateParams.get(name),
      moduleOwn,
      `${name}: the delegate's parameter list must be the member's own (module takes coordinator, recorder first)`,
    );
    assert.ok(delegatePort.get(name), `${name}: the delegate must hand the class recorder (this._recorder) to the module`);
    assert.ok(
      coordText.includes(`runtimeRecovery.${name}(this, this._recorder`),
      `${name}: the delegate must call the module function with (this, this._recorder, ...)`,
    );
  }
});

test('RR3: a fake recorder observes exactly what _replay records, and log.append return values key the writes', async () => {
  // The fold's recording surface, exercised over two workers and one unmarked lane receipt:
  //   w1 — a durable working task whose replayed turn COMPLETED: the coordination-gap path
  //        (log.append control.recovery_terminalized -> mapEvent -> coordination.transitionTask,
  //        keyed by the appended event's seq);
  //   w2 — a replay that never reattached: the session_not_reattached path (the same acts, plus
  //        the scratch/board claim expiry the terminal transition carries);
  //   the message lane — an unmarked alias receipt: one recordDriver row keyed by the row it names.
  const appended = [];
  const acts = [];
  const fakeLog = {
    workers: () => ['w1', 'w2'],
    read: (workerId) => workerId === 'w1'
      ? [{
          seq: 10, worker: 'w1', kind: 'lifecycle.spawned', actor: 'worker', turnEpoch: 2,
          payload: { taskId: 'task-1', threadId: 'native-1', vendorResolved: 'fake' },
        }, {
          seq: 11, worker: 'w1', kind: 'lifecycle.turn_completed', actor: 'worker', turnEpoch: 2,
          payload: { status: 'completed' },
        }, {
          seq: 12, worker: 'w1', kind: 'verify.reverified', actor: 'policy', payload: { accept: true, verdict: { outcome: 'accepted' } },
        }]
      : [{
          seq: 20, worker: 'w2', kind: 'lifecycle.spawned', actor: 'worker', turnEpoch: 1,
          payload: { taskId: 'task-2', threadId: 'native-2', vendorResolved: 'fake' },
        }],
    append: (frame) => {
      const event = { seq: 100 + appended.length + 1, worker: frame.worker, kind: frame.kind, actor: frame.actor, payload: frame.payload };
      appended.push(event);
      acts.push({ recorder: 'log.append', kind: frame.kind, actor: frame.actor });
      return event;
    },
  };
  const durableTasks = [
    { id: 'task-1', status: 'working', version: 3, deps: [], reservedWorkerId: 'w1', assignee: 'w1', createdEvent: 1 },
    { id: 'task-2', status: 'working', version: 4, deps: [], reservedWorkerId: 'w2', assignee: 'w2', createdEvent: 2 },
  ];
  const transitions = [];
  const recordedRows = [];
  const fakeCoordination = {
    snapshot: () => ({ tasks: durableTasks }),
    events: () => [],
    task: (taskId) => durableTasks.find((task) => task.id === taskId) ?? null,
    mapOperationalEvent: (event, { key }) => {
      acts.push({ recorder: 'mapEvent', eventKind: event.kind, key });
      return { evidence: { coordinationSeq: event.seq, reason: event.payload?.reason ?? null } };
    },
    transitionTask: (taskId, to, expectedVersion, { actor, key }, evidence) => {
      transitions.push({ taskId, to, expectedVersion, actor, key, evidence });
      acts.push({ recorder: 'coordination.transitionTask', taskId, to, key });
      const task = durableTasks.find((row) => row.id === taskId);
      task.status = to;
      task.version = expectedVersion + 1;
      return { task: { ...task, version: expectedVersion + 1 } };
    },
    eventsView: () => [{
      seq: 30, kind: 'message.sent', idempotencyKey: 'message.sent:<wrong>',
      payload: { messageId: `message:${'a'.repeat(64)}`, body: 'orphan root', from: 'orchestrator' },
    }],
    recordDriver: (kind, payload, { actor, key }) => {
      recordedRows.push({ kind, payload, actor, key });
      acts.push({ recorder: 'recordDriver', kind, key });
      return { event: { seq: 900 + recordedRows.length } };
    },
  };
  const recorder = Object.freeze({
    log: fakeLog,
    coordination: fakeCoordination,
    route: null,
    mapEvent: (event) => {
      if (!event) return null;
      return fakeCoordination.mapOperationalEvent(event, { actor: 'policy', key: `evidence:${event.worker}:${event.seq}` }).evidence;
    },
    recordDriver: (kind, payload, key, actor = 'policy') => fakeCoordination.recordDriver(kind, payload, { actor, key }).event,
  });
  const fenceEpochs = new Map();
  const receiver = {
    _log: fakeLog,
    _coordination: fakeCoordination,
    _adapters: {},
    _now: () => 1_000,
    _approvalTimeoutMs: 60_000,
    _harnessOf: (vendor) => vendor,
    _deriveWorkerStatus: (status) => status,
    _providerFaultOf: () => null,
    _bestEffortSync: (operation) => operation(),
    _expireScratchClaims: (...args) => acts.push({ recorder: 'expireScratchClaims', args: args.at(-1) }),
    _expireBoardClaims: (...args) => acts.push({ recorder: 'expireBoardClaims', args: args.at(-1) }),
    _bumpInteractionGeneration: () => {},
    _bumpDecisionSettleCount: () => {},
    _replayedIds: { workers: new Set(), requests: new Set(), tasks: new Set() },
    _workers: new Map(),
    _tasks: new Map([['task-2', { id: 'task-2', coordinationVersion: 4 }]]),
    _taskOrder: [],
    _pending: new Map(),
    _pausedTurns: new Map(),
    _activeInteractionIds: new Set(),
    _messages: new Map(),
    // A real fence advances when bumped; the fold raises each worker's turnEpoch to its max.
    _fences: {
      register() {},
      current: (id) => ({ turnEpoch: fenceEpochs.get(id) ?? 0 }),
      bumpTurn: (id) => { fenceEpochs.set(id, (fenceEpochs.get(id) ?? 0) + 1); },
    },
  };
  for (const frame of runtimeRecovery._replay(receiver, recorder)) await frame; // drain the yielding fold

  const recordingActs = acts.filter((act) => 'recorder' in act);
  assert.deepEqual(
    [...new Set(recordingActs.map((act) => act.recorder))],
    ['log.append', 'mapEvent', 'coordination.transitionTask', 'expireScratchClaims', 'expireBoardClaims', 'recordDriver'],
    'the fold records only through the port surface (log.append, mapEvent, recordDriver) and the raw store transitions',
  );
  // The gap path appended ONE policy row per worker and keyed each durable failure by its seq.
  assert.equal(appended.length, 2);
  assert.ok(appended.every((event) => event.kind === 'control.recovery_terminalized' && event.actor === 'policy'));
  assert.deepEqual(transitions.map((t) => [t.taskId, t.to, t.actor]), [
    ['task-1', 'failed', 'policy'],
    ['task-2', 'failed', 'policy'],
  ]);
  const [gapWrite, replayWrite] = transitions;
  assert.equal(gapWrite.key, `task.failed:task-1:coordination_gap:${appended[0].seq}`, 'the gap write is keyed by the appended event the port returned');
  assert.equal(replayWrite.key, `task.failed:task-2:replay:${appended[1].seq}`, 'the replay failure is keyed by the appended event the port returned');
  assert.equal(gapWrite.expectedVersion, 3);
  assert.equal(replayWrite.expectedVersion, 4);
  // The not-reattached worker expires its claims with the replay_failed reason — the terminal
  // transition's coordinator-side tail.
  assert.ok(recordingActs.some((act) => act.recorder === 'expireScratchClaims' && act.args === 'replay_failed'));
  assert.ok(recordingActs.some((act) => act.recorder === 'expireBoardClaims' && act.args === 'replay_failed'));
  // The unmarked lane receipt recorded exactly one durable finding keyed by the row it names.
  assert.equal(recordedRows.length, 1);
  assert.equal(recordedRows[0].kind, 'replay.message_alias_unmarked');
  assert.equal(recordedRows[0].key, 'driver.replay.message_alias_unmarked:30');
  // The replayed identifiers are reserved by value, and the fold rebuilt both workers as orphans.
  assert.ok(receiver._replayedIds.workers.has('w1') && receiver._replayedIds.workers.has('w2'));
  assert.equal(receiver._workers.get('w1').status, 'orphaned');
  assert.equal(receiver._workers.get('w2').status, 'orphaned');
});

test('RR4: the relocated primitives moved once and the coordinator export surface is unchanged', () => {
  for (const name of RELOCATED_PRIMITIVES) {
    assert.ok(name in runtimeRecovery, `runtime-recovery.mjs must export the relocated primitive ${name}`);
  }
  const coordText = read(COORD_FILE);
  // The coordinator imports every relocated primitive back from the module.
  const importBlock = coordText.match(/import \{([^}]+)\} from '\.\/runtime-recovery\.mjs';/);
  assert.ok(importBlock, 'coordinator.mjs must import the relocated primitives from runtime-recovery.mjs');
  const imported = new Set(importBlock[1].split(',').map((name) => name.trim()));
  for (const name of RELOCATED_PRIMITIVES) {
    if (REEXPORTED.includes(name)) continue; // re-exported, not imported
    if (OBSERVATION_REEXPORTED.includes(name)) continue; // slice 12: read back through runtime-observation's surface
    assert.ok(imported.has(name), `coordinator.mjs must import ${name} back from runtime-recovery.mjs`);
  }
  // The names the base exported from coordinator.mjs are re-exported, so every existing
  // import path still resolves to the same binding (slice 12 added IntegrationError).
  assert.ok(
    /export \{ PUSH_REFUSAL_CODES, REARM_KINDS, IntegrationError, SessionSelectionError \} from '\.\/runtime-recovery\.mjs';/.test(coordText),
    'coordinator.mjs must re-export the relocated names its export surface carried',
  );
});

test('RR7 (slice 12): the base-layer declarations are defined once, and the observation surface holds by identity', async () => {
  const observation = await import('../src/runtime-observation.mjs');
  // noop and the closed-verdict family moved here because _integrate's effect remainder reads
  // closedVerificationVerdict and the acyclic order forbids effects -> observation (observation
  // already imports effects). runtime-observation re-exports them, so its surface is unchanged.
  for (const name of OBSERVATION_REEXPORTED) {
    assert.equal(observation[name], runtimeRecovery[name],
      `${name}: runtime-observation's surface is the same binding, not a copy`);
  }
  const observationText = read(OBSERVATION_FILE);
  assert.ok(!/export function noop\b/u.test(observationText)
    && !/export function closedVerificationVerdict\b/u.test(observationText),
  'the moved declarations are defined in runtime-recovery.mjs only');
  // The verdict computation itself is intact across the move.
  const verdict = runtimeRecovery.closedVerificationVerdict(
    { passed: true, observedExit: 0 }, { expectExit: 0 },
  );
  assert.equal(verdict.outcome, 'passed');
  assert.equal(verdict.execution.state, 'completed');
});

test('RR5: the map sees the move — every recovery_port delegate is recovery, and the module is a target', () => {
  const map = JSON.parse(read(MAP_FILE));
  assert.ok(
    map.files.some((file) => file.file === MEMBER_FILE),
    'the committed seam artifact must carry the runtime-recovery.mjs target',
  );
  const coordinatorFile = map.files.find((file) => file.file === COORD_FILE);
  const delegated = coordinatorFile.members.filter((member) => member.evidence.includes('recovery:recovery_port'));
  // 43 = the 42 moved members plus the #542 deferred-cleanup read, which reaches the same module
  // function through the same port.
  assert.equal(delegated.length, 43, 'every member that reaches the recovery port delegates through it');
  for (const member of delegated) {
    assert.equal(member.seam, 'recovery', `${member.name} must classify as recovery through the port evidence`);
  }
  const moduleFile = map.files.find((file) => file.file === MEMBER_FILE);
  const bySeam = {};
  for (const member of moduleFile.members) bySeam[member.seam] = (bySeam[member.seam] ?? 0) + 1;
  assert.ok(bySeam.recovery >= 42, `the module target must classify its moved members recovery, got ${JSON.stringify(bySeam)}`);
});

test('RR6: the coordinator wires the port and the public verbs keep their shape', () => {
  const proto = Coordinator.prototype;
  const publicVerbs = ['recover', 'recoverPlanBound', 'resumePreservedWork', 'resumeOrphans', 'reconcileProviderSource', 'reconcileDueProviderProcessing', 'reconcileProviderProcessing', 'reapRunScratchpads', 'startupReady', 'startupReconstructionStatus', 'startupWorkerFleet', 'orphanedCapacityReservations', 'completeDeferredStartup'];
  for (const name of publicVerbs) {
    assert.equal(typeof proto[name], 'function', `${name} must stay a coordinator method`);
  }
  assert.equal(proto.recover.length, 1, 'recover(workerId, opts = {}) keeps its arity');
  assert.equal(proto.resumeOrphans.length, 0, 'resumeOrphans({ liveWorkers = [] } = {}) keeps its arity');
  // issue #259 slice 11: the constructor — the admission-classified composition root — moved to
  // runtime-admission.mjs, so the port-wiring lines are read off the member, wherever they live
  // (memberSource normalizes the module's `coordinator.` receiver back to `this.`).
  const coordText = memberSource('constructor');
  assert.ok(
    coordText.includes('this._recorder = opts.recorderPort'),
    'the coordinator takes the injected recorder port',
  );
  assert.ok(
    coordText.includes('recorderPort.createRecorderPort({ log: this._log, coordination: this._coordination, route: this._route })'),
    'the bare-constructor path builds the same default port from its own authorities',
  );
});
