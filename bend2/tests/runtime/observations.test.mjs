// Unit laws for one-epoch observation assembly against recorded CDP frame
// shapes: strict production-decision admission with identity validation,
// the sampled same-epoch capture binding, the awaited captureScopes
// acquisition with before-read/after-read/publication checks, records-only
// summary rendering, stack mapping provenance with retained async chains,
// exception source separation, worker inventory with sessionId-mapped
// detaches, capture identity, and runtime evidence with explicit nulls.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mapStackFrames,
  scopeSummaries,
  captureScopes,
  captureException,
  workerInventory,
  captureIdentity,
  staleRefRefusal,
  admissionOutcome,
  createCaptureBinding,
  isValidRefIdentity,
  runtimeEvidence,
} from '../../context/runtime/observations.mjs';

const IDENTITY = {
  runtime: 'rt:q7',
  adapter: '0',
  thread: 'main:0',
  epoch: '12',
  mutationGeneration: '3',
  kind: 'object',
  handle: 'obj-1',
};
const LIVE = { runtime: 'rt:q7', adapter: '0', epoch: '12', mutationGeneration: '3' };

// Harness stand-in for the production admission (same decision shape); the
// production module itself is exercised by cdp-composition.test.mjs.
function admitRef(identity, live) {
  if (identity.runtime !== live.runtime) return { decision: 'refused', condition: 'foreignRuntime' };
  if (identity.epoch !== live.epoch) return { decision: 'refused', condition: 'staleReference' };
  if (identity.mutationGeneration !== live.mutationGeneration) return { decision: 'refused', condition: 'refRetiredByMutation' };
  return { decision: 'admitted', ok: true, identity };
}

function pauseCallFrames() {
  return [
    { functionName: 'probe', callFrameId: 'cf:1', location: { scriptId: '42', lineNumber: 10, columnNumber: 4 } },
    { functionName: '', callFrameId: 'cf:2', location: { scriptId: '42', lineNumber: 0, columnNumber: 0 } },
    { functionName: 'timer', callFrameId: 'cf:3', location: { scriptId: '42', lineNumber: 30, columnNumber: 2 } },
  ];
}

test('identity validation is a strict member shape with canonical decimal counters', () => {
  assert.equal(isValidRefIdentity(IDENTITY), true);
  assert.equal(isValidRefIdentity({ ...IDENTITY, epoch: '0' }), true);
  assert.equal(isValidRefIdentity({ ...IDENTITY, epoch: '4294967296' }), true);
  for (const bad of [
    null,
    undefined,
    'identity',
    42,
    [],
    {},
    { ...IDENTITY, runtime: '' },
    { ...IDENTITY, epoch: '01' },
    { ...IDENTITY, epoch: '+1' },
    { ...IDENTITY, epoch: '1.5' },
    { ...IDENTITY, epoch: '1e3' },
    { ...IDENTITY, mutationGeneration: '-1' },
    { ...IDENTITY, kind: 7 },
  ]) {
    assert.equal(isValidRefIdentity(bad), false, JSON.stringify(bad));
  }
});

test('only the asserted admitted shape with a valid identity admits; both outcomes carry the admitted member', () => {
  const ok = admissionOutcome({ decision: 'admitted', ok: true, identity: IDENTITY });
  assert.equal(ok.admitted, true);
  assert.deepEqual(ok.identity, IDENTITY);
  assert.equal(staleRefRefusal({ decision: 'admitted', ok: true, identity: IDENTITY }), null);

  // An admitted decision whose identity is an empty object, an array, or
  // missing members refuses; it can never bypass the shape contract.
  for (const identity of [{}, [], { runtime: 'rt:q7' }, { ...IDENTITY, epoch: '01' }]) {
    const outcome = admissionOutcome({ decision: 'admitted', ok: true, identity });
    assert.equal(outcome.admitted, false);
    assert.equal(outcome.refused, true);
    assert.equal(outcome.condition, 'refDecisionMalformed');
    assert.equal(staleRefRefusal({ decision: 'admitted', ok: true, identity }).condition, 'refDecisionMalformed');
  }

  // Admitted with ok:false is contradictory by name.
  const contradictory = admissionOutcome({ decision: 'admitted', ok: false, identity: IDENTITY });
  assert.equal(contradictory.admitted, false);
  assert.equal(contradictory.condition, 'refDecisionContradictory');

  // The split of rejecting shapes: no decision member -> refDecisionRefused;
  // a wrong decision -> refDecisionMalformed; a refusal without its own
  // condition -> refDecisionRefused.
  for (const candidate of [null, undefined, 'admitted', 42, { ok: true }, { ok: false, condition: 'staleReference' }]) {
    assert.equal(admissionOutcome(candidate).condition, 'refDecisionRefused');
  }
  for (const candidate of [{ decision: 'admitted' }, { decision: 'admitted', identity: IDENTITY }, { decision: 'maybe' }]) {
    assert.equal(admissionOutcome(candidate).condition, 'refDecisionMalformed');
  }
  assert.equal(admissionOutcome({ decision: 'refused' }).condition, 'refDecisionRefused');
  assert.equal(admissionOutcome({ decision: 'refused', condition: 'refStopNotLive' }).condition, 'refStopNotLive');

  // Production refusals render their own conditions with the admitted member
  // explicit on the refusal.
  for (const condition of ['refMalformed', 'foreignRuntime', 'foreignAdapter', 'staleReference', 'refRetiredByMutation', 'refOutsidePause', 'refStopNotLive', 'refThreadUnknown']) {
    const refusal = admissionOutcome({ decision: 'refused', condition });
    assert.equal(refusal.admitted, false);
    assert.equal(refusal.refused, true);
    assert.equal(refusal.condition, condition);
  }
});

test('an injected production normalizer decides alone; its refusals render verbatim', () => {
  const requireAdmittedRef = (decision) => {
    if (decision && decision.decision === 'admitted' && decision.ok === true) return decision.identity;
    const error = new Error('refused by production');
    error.condition = 'refThreadUnknown';
    error.detail = 'thread not live';
    throw error;
  };
  const ok = admissionOutcome({ decision: 'admitted', ok: true, identity: { arbitrary: true, nested: { a: 1 } } }, { requireAdmittedRef });
  assert.equal(ok.admitted, true, 'the production normalizer owns admission; no second validator runs');
  const refused = admissionOutcome({ decision: 'refused' }, { requireAdmittedRef });
  assert.equal(refused.admitted, false);
  assert.equal(refused.condition, 'refThreadUnknown');
  assert.equal(refused.detail, 'thread not live');
});

test('stack frames keep generated positions and name their mapping provenance', () => {
  const mapped = mapStackFrames({
    callFrames: pauseCallFrames(),
    resolveOriginal: (scriptId, line, column) =>
      scriptId === '42' && line === 10
        ? { path: '/work/src/main.ts', line: 13, column: 2, name: null, mapDigest: 'digest-1' }
        : null,
  });
  assert.equal(mapped.condition, undefined);
  assert.equal(mapped.frames.length, 3);
  const first = mapped.frames[0];
  assert.deepEqual(first.generated, { scriptId: '42', line: 10, column: 4, url: null });
  assert.deepEqual(first.original, { path: '/work/src/main.ts', line: 13, column: 2, name: null, mapDigest: 'digest-1' });
  assert.equal(first.provenance, 'mapped');
  assert.equal(first.thread, 'main:0');
  assert.equal(mapped.frames[1].provenance, 'unmapped');
  assert.equal(mapped.frames[2].provenance, 'unmapped');
  assert.equal(mapStackFrames({ callFrames: 'nope' }).condition, 'malformedCallFrames');
});

test('async chains are retained and mapped with parent provenance, not reduced to a flag', () => {
  const mapped = mapStackFrames({
    callFrames: pauseCallFrames(),
    asyncStackTrace: {
      description: 'await',
      callFrames: [{ functionName: 'tick', scriptId: '42', lineNumber: 5, columnNumber: 0 }],
      parent: { description: 'timer', callFrames: [{ functionName: 'fire', scriptId: '42', lineNumber: 7, columnNumber: 2 }] },
    },
    asyncCaptureEnabled: true,
    resolveOriginal: (scriptId, line) =>
      scriptId === '42' && line === 5 ? { path: '/work/src/tick.ts', line: 9, column: 0, name: null, mapDigest: 'digest-2' } : null,
  });
  assert.equal(mapped.async.present, true);
  assert.equal(mapped.async.captureEnabled, true);
  assert.equal(mapped.async.note, null);
  assert.equal(mapped.async.chain.description, 'await');
  const tick = mapped.async.chain.frames[0];
  assert.equal(tick.async, true);
  assert.equal(tick.asyncDepth, 0);
  assert.equal(tick.provenance, 'mapped');
  assert.equal(tick.original.path, '/work/src/tick.ts');
  assert.equal(mapped.async.chain.parent.description, 'timer');
  assert.equal(mapped.async.chain.parent.frames[0].asyncDepth, 1);
  const unenabled = mapStackFrames({ callFrames: pauseCallFrames(), asyncStackTrace: { callFrames: [] }, asyncCaptureEnabled: false });
  assert.equal(unenabled.async.captureEnabled, false);
  assert.ok(unenabled.async.note.length > 0);
});

test('the capture binding requires a live sampler and samples the current session', () => {
  assert.equal(createCaptureBinding({ admitRef, ref: 'ref' }).sample().condition, 'refDecisionMalformed');
  assert.equal(createCaptureBinding({ liveNow: () => LIVE }).sample().condition, 'refDecisionMalformed');
  assert.equal(createCaptureBinding({ admitRef, ref: null, liveNow: () => LIVE }).sample().condition, 'refDecisionMalformed');

  let samples = 0;
  const binding = createCaptureBinding({
    admitRef: (identity, live) => {
      samples += 1;
      return admitRef(identity, live);
    },
    ref: IDENTITY,
    liveNow: () => {
      samples += 1;
      return { ...LIVE };
    },
  });
  assert.equal(binding.sample().admitted, true);
  assert.equal(samples, 2, 'each sample calls the sampler and the admission once');
});

test('captureScopes admits before and after every read and at publication', async () => {
  const scopeChain = [
    { type: 'local', name: '', object: { type: 'object', objectId: 'obj-1' } },
    { type: 'global', name: 'global', object: { type: 'object', objectId: 'obj-2' } },
  ];
  let live = { ...LIVE };
  let reads = 0;
  const settled = await captureScopes({
    scopeChain,
    identity: IDENTITY,
    loadScope: async (scope) => {
      reads += 1;
      return { result: [{ name: 'a', value: { type: 'number', value: 1, description: '1' } }], internalProperties: [] };
    },
    binding: createCaptureBinding({ admitRef, ref: IDENTITY, liveNow: () => live }),
  });
  assert.equal(settled.condition, undefined);
  assert.equal(reads, 2);
  assert.equal(settled.scopes.length, 2);
  assert.equal(settled.scopes[0].expansion.complete, true);
  assert.ok(settled.records instanceof Map);
  assert.equal(settled.records.size, 2);
  void scopeChain;
});

test('an identity change across a read is named at stage afterRead with the raw record retained', async () => {
  let live = { ...LIVE };
  const rawRecord = { result: [{ name: 'sneaky', value: { type: 'number', value: 7, description: '7' } }], internalProperties: [] };
  const changed = await captureScopes({
    scopeChain: [{ type: 'local', name: '', object: { type: 'object', objectId: 'obj-1' } }],
    identity: IDENTITY,
    loadScope: async () => {
      live = { ...live, mutationGeneration: '4' };
      return rawRecord;
    },
    binding: createCaptureBinding({ admitRef, ref: IDENTITY, liveNow: () => live }),
  });
  assert.equal(changed.condition, 'changedDuringCapture');
  assert.equal(changed.stage, 'afterRead');
  assert.equal(changed.refusal.condition, 'refRetiredByMutation');
  assert.deepEqual(changed.changedRecord, rawRecord, 'the raw pre-change record is retained as evidence');
  assert.deepEqual(changed.scopes, [], 'no scope is reported complete across the change');
});

test('a change at publication refuses the whole capture after all reads admitted', async () => {
  let live = { ...LIVE };
  let reads = 0;
  const changed = await captureScopes({
    scopeChain: [
      { type: 'local', name: '', object: { type: 'object', objectId: 'obj-1' } },
      { type: 'global', name: '', object: { type: 'object', objectId: 'obj-2' } },
    ],
    identity: IDENTITY,
    loadScope: async () => {
      reads += 1;
      if (reads === 2) live = { ...live, epoch: '13' };
      return { result: [], internalProperties: [] };
    },
    binding: createCaptureBinding({ admitRef, ref: IDENTITY, liveNow: () => live }),
  });
  assert.equal(changed.condition, 'changedDuringCapture');
  assert.equal(changed.stage, 'publication');
  assert.equal(changed.refusal.condition, 'staleReference');
  assert.equal(changed.scopes.length, 2, 'the admitted prefix is listed but nothing is complete');
});

test('a scope read refusal stops the capture with scopeReadRefused', async () => {
  const refused = await captureScopes({
    scopeChain: [{ type: 'local', name: '', object: { type: 'object', objectId: 'obj-1' } }],
    identity: IDENTITY,
    loadScope: async () => ({ condition: 'cdpError' }),
    binding: createCaptureBinding({ admitRef, ref: IDENTITY, liveNow: () => ({ ...LIVE }) }),
  });
  assert.equal(refused.condition, 'scopeReadRefused');
  assert.equal(refused.refusal.condition, 'cdpError');
});

test('captureScopes refuses missing loaders, bindings and malformed chains before any read', async () => {
  let reads = 0;
  const loadScope = async () => {
    reads += 1;
    return { result: [], internalProperties: [] };
  };
  assert.equal((await captureScopes({ scopeChain: [], loadScope })).condition, 'admissionRequired');
  assert.equal((await captureScopes({ scopeChain: [], binding: createCaptureBinding({ admitRef, ref: IDENTITY, liveNow: () => ({ ...LIVE }) }) })).condition, 'loadScopeRequired');
  assert.equal((await captureScopes({ scopeChain: 'x', loadScope, binding: createCaptureBinding({ admitRef, ref: IDENTITY, liveNow: () => ({ ...LIVE }) }) })).condition, 'malformedScopeChain');
  assert.equal(reads, 0, 'no backend read happened without admission');
});

test('summary rendering consumes acquired records and performs no reads', () => {
  const scopeChain = [{ type: 'local', name: '', object: { type: 'object', objectId: 'obj-1' } }];
  const record = { result: [{ name: 'six', value: { type: 'object', objectId: 'obj-six', preview: { type: 'object', properties: [], overflow: true } } }], internalProperties: [{ name: '[[Prototype]]', value: { type: 'object', className: 'Object' } }] };
  const rendered = scopeSummaries({ scopeChain, identity: IDENTITY, records: new Map([[scopeChain[0], record]]) });
  assert.equal(rendered.condition, undefined);
  assert.equal(rendered.scopes[0].expansion.complete, true);
  assert.equal(rendered.scopes[0].expansion.accessorExecuted, false);
  assert.equal(rendered.scopes[0].internalProperties[0].name, '[[Prototype]]');
  assert.deepEqual(rendered.scopes[0].objectPayload, { kind: 'object', handle: 'obj-1', identity: IDENTITY });

  const withoutRecord = scopeSummaries({ scopeChain, identity: IDENTITY, records: new Map() });
  assert.equal(withoutRecord.scopes[0].expansion.complete, false);
  assert.equal(withoutRecord.scopes[0].expansion.reason, 'recordAbsent');
  const noRecordsAtAll = scopeSummaries({ scopeChain, identity: IDENTITY });
  assert.equal(noRecordsAtAll.scopes[0].expansion.reason, 'recordAbsent');
  assert.equal(scopeSummaries({ scopeChain: 'x', records: new Map() }).condition, 'malformedScopeChain');
});

test('during a pause the exception value is paused.data; exceptionThrown is the unpaused source', () => {
  const atPause = captureException({ paused: true, pausedData: { type: 'object', description: 'Error: boom', className: 'Error' } });
  assert.equal(atPause.source, 'paused.data');
  assert.equal(atPause.value.description, 'Error: boom');
  const unpaused = captureException({
    paused: false,
    exceptionThrownEvent: { exceptionDetails: { text: 'Uncaught', exception: { type: 'object', description: 'Error: thrown-later' } } },
  });
  assert.equal(unpaused.source, 'exceptionThrown');
  const conflict = captureException({ paused: true, pausedData: { type: 'object' }, exceptionThrownEvent: { exceptionDetails: {} } });
  assert.equal(conflict.condition, 'conflictingExceptionSources');
  assert.equal(captureException({}).condition, 'noExceptionObserved');
});

test('worker inventory maps detaches through the session id and records unmatched detaches', () => {
  const inventory = workerInventory({
    attached: [{ workerInfo: { workerId: '1', type: 'dedicated', title: 'w', url: 'file:///work/worker.mjs' }, sessionId: 'sess-worker-1' }],
    detachedFromWorker: [{ sessionId: 'sess-worker-1', reason: 'closed' }],
  });
  assert.equal(inventory.workers.length, 1);
  assert.equal(inventory.workers[0].state, 'detached', 'a detached session is never reported attached');
  assert.deepEqual(inventory.workers[0].detached, { sessionId: 'sess-worker-1', reason: 'closed' });
  assert.deepEqual(inventory.limits, ['workerBreakpointsUnavailable', 'workerScopesUnavailable', 'workerExceptionsUnavailable']);

  const unknownDetach = workerInventory({
    attached: [{ workerInfo: { workerId: '2', type: 'dedicated', title: 'kept', url: 'u' }, sessionId: 'sess-kept' }],
    detachedFromWorker: [{ sessionId: 'sess-unknown', reason: 'closed' }],
  });
  assert.equal(unknownDetach.workers.length, 2);
  assert.equal(unknownDetach.workers[0].state, 'attached');
  assert.equal(unknownDetach.workers[1].sessionId, 'sess-unknown');
  assert.ok(unknownDetach.workers[1].note.includes('without a recorded attached event'));
});

test('capture identity fixes both event identities, per-response consistency and unverified exclusivity', () => {
  const record = captureIdentity({
    startEvent: { method: 'Debugger.paused', sequence: 4 },
    endEvent: { method: 'Runtime.getProperties', sequence: 9 },
    epoch: '12',
  });
  assert.deepEqual(record, {
    startEvent: { method: 'Debugger.paused', sequence: 4 },
    endEvent: { method: 'Runtime.getProperties', sequence: 9 },
    consistency: 'per-response',
    controlExclusivity: 'unverified',
    epoch: '12',
  });
  assert.equal(captureIdentity({ startEvent: { method: 'Debugger.paused' }, endEvent: null, epoch: '1' }).condition, 'captureIncomplete');
});

test('runtime evidence keeps every field with explicit nulls and refuses missing identity', () => {
  const minimal = runtimeEvidence({ runtime: 'rt:q7', epoch: '0' });
  assert.deepEqual(minimal, { kind: 'runtime', runtime: 'rt:q7', epoch: '0', thread: null, script: null, generated: null, original: null });
  assert.equal('original' in minimal, true);
  assert.equal(runtimeEvidence({ epoch: '0' }).condition, 'missingRuntimeIdentity');
  assert.equal(runtimeEvidence({ runtime: 'rt:q7' }).condition, 'missingEpoch');
});
