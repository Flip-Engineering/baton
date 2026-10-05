// Unit laws for one-epoch observation assembly against recorded CDP frame
// shapes: production-decision admission gating, same-epoch capture binding,
// stack mapping provenance with retained async chains, scope summaries with
// safe preloaded records and the changedDuringCapture refusal, exception
// source separation, worker inventory with sessionId-mapped detaches,
// capture identity, and runtime evidence with explicit nulls.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mapStackFrames,
  scopeSummaries,
  captureException,
  workerInventory,
  captureIdentity,
  staleRefRefusal,
  admissionOutcome,
  createCaptureBinding,
  runtimeEvidence,
} from '../../context/runtime/observations.mjs';

const IDENTITY = { runtime: 'rt:q7', adapter: '0', thread: 'main:0', epoch: '12', mutationGeneration: '3' };

function pauseCallFrames() {
  return [
    { functionName: 'probe', callFrameId: 'cf:1', location: { scriptId: '42', lineNumber: 10, columnNumber: 4 } },
    { functionName: '', callFrameId: 'cf:2', location: { scriptId: '42', lineNumber: 0, columnNumber: 0 } },
    { functionName: 'timer', callFrameId: 'cf:3', location: { scriptId: '42', lineNumber: 30, columnNumber: 2 } },
  ];
}

// Harness stand-in for the production admission (same decision shape); the
// production module itself is exercised by cdp-composition.test.mjs.
function admitRef(identity, live) {
  if (identity.runtime !== live.runtime) return { decision: 'refused', condition: 'foreignRuntime' };
  if (identity.epoch !== live.epoch) return { decision: 'refused', condition: 'staleReference' };
  if (identity.mutationGeneration !== live.mutationGeneration) return { decision: 'refused', condition: 'refRetiredByMutation' };
  return { decision: 'admitted', ok: true, identity };
}

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
  assert.equal(mapped.frames[1].original, null);
  assert.equal(mapped.frames[2].provenance, 'unmapped');
});

test('frames without a script identity stay unknownScript; thread labels pass through', () => {
  const mapped = mapStackFrames({
    callFrames: [{ functionName: 'x', callFrameId: 'cf:9', location: { lineNumber: 0, columnNumber: 0 } }],
    thread: 'worker:2',
  });
  assert.equal(mapped.frames[0].provenance, 'unknownScript');
  assert.equal(mapped.frames[0].thread, 'worker:2');
  assert.equal(mapStackFrames({ callFrames: 'nope' }).condition, 'malformedCallFrames');
});

test('async chains are retained and mapped with parent provenance, not reduced to a flag', () => {
  const mapped = mapStackFrames({
    callFrames: pauseCallFrames(),
    asyncStackTrace: {
      description: 'await',
      callFrames: [{ functionName: 'tick', scriptId: '42', lineNumber: 5, columnNumber: 0 }],
      parent: {
        description: 'timer',
        callFrames: [{ functionName: 'fire', scriptId: '42', lineNumber: 7, columnNumber: 2 }],
      },
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
  assert.deepEqual(tick.generated, { scriptId: '42', line: 5, column: 0, url: null });
  assert.equal(tick.provenance, 'mapped');
  assert.equal(tick.original.path, '/work/src/tick.ts');
  assert.equal(mapped.async.chain.parent.description, 'timer');
  const fire = mapped.async.chain.parent.frames[0];
  assert.equal(fire.asyncDepth, 1);
  assert.equal(fire.provenance, 'unmapped');
  assert.equal(fire.original, null);
});

test('an async chain captured without the earlier enable says so', () => {
  const unenabled = mapStackFrames({ callFrames: pauseCallFrames(), asyncStackTrace: { callFrames: [] }, asyncCaptureEnabled: false });
  assert.equal(unenabled.async.present, true);
  assert.equal(unenabled.async.captureEnabled, false);
  assert.ok(unenabled.async.note.length > 0);
  assert.deepEqual(unenabled.async.chain.frames, []);
  const absent = mapStackFrames({ callFrames: pauseCallFrames(), asyncStackTrace: null, asyncCaptureEnabled: false });
  assert.equal(absent.async.present, false);
  assert.equal(absent.async.chain, null);
});

test('scope summaries keep one-level descriptors, internal properties and expansion payloads apart', () => {
  const scopeChain = [
    { type: 'local', name: '', object: { type: 'object', objectId: 'scope-obj-1' } },
    { type: 'global', name: 'global', object: { type: 'object', objectId: 'scope-obj-2' } },
  ];
  const summarized = scopeSummaries({
    scopeChain,
    identity: IDENTITY,
    loadScope: (scope) =>
      scope.object.objectId === 'scope-obj-1'
        ? {
            result: [
              { name: 'sixProps', value: { type: 'object', objectId: 'obj-six', preview: { type: 'object', properties: [], overflow: true } } },
              { name: 'count', value: { type: 'number', value: -2, description: '-2' } },
            ],
            internalProperties: [{ name: '[[Prototype]]', value: { type: 'object', className: 'Object' } }],
          }
        : { result: [], internalProperties: [] },
  });
  assert.equal(summarized.condition, undefined);
  const local = summarized.scopes[0];
  assert.equal(local.type, 'local');
  assert.deepEqual(local.objectPayload, { kind: 'object', handle: 'scope-obj-1', identity: IDENTITY });
  assert.equal(local.properties[0].value.objectId, 'obj-six');
  assert.equal(local.expansion.complete, true);
  assert.equal(local.expansion.accessorExecuted, false);
  assert.equal(local.internalProperties[0].name, '[[Prototype]]');
  assert.equal(summarized.scopes[1].objectPayload.handle, 'scope-obj-2');
});

test('an unsettled promise record refuses instead of being dereferenced', () => {
  const summarized = scopeSummaries({
    scopeChain: [{ type: 'local', name: '', object: { type: 'object', objectId: 'obj-1' } }],
    identity: IDENTITY,
    loadScope: () => Promise.resolve({ result: [] }),
  });
  assert.equal(summarized.scopes[0].expansionRefusal.condition, 'asyncScopeRecordUnresolved');
  assert.deepEqual(summarized.scopes[0].properties, []);
});

test('a refused or malformed response record never dereferences a missing result list', () => {
  const refused = scopeSummaries({
    scopeChain: [{ type: 'local', name: '', object: { type: 'object', objectId: 'obj-1' } }],
    identity: IDENTITY,
    loadScope: () => ({ condition: 'cdpError' }),
  });
  assert.equal(refused.scopes[0].expansionRefusal.condition, 'cdpError');
  assert.deepEqual(refused.scopes[0].properties, []);

  const malformed = scopeSummaries({
    scopeChain: [{ type: 'local', name: '', object: { type: 'object', objectId: 'obj-1' } }],
    identity: IDENTITY,
    loadScope: () => ({ exceptionDetails: { text: 'Uncaught' } }),
  });
  assert.equal(malformed.scopes[0].expansion.complete, false);
  assert.equal(malformed.scopes[0].expansion.reason, 'malformedExpansionResponse');
  assert.deepEqual(malformed.scopes[0].properties, []);
});

test('the admission binding refuses mid-capture with an explicit changedDuringCapture result', () => {
  const binding = createCaptureBinding({ admitRef, ref: '["runtime","rt:q7","0","main:0","12","3","object","obj-1"]' });
  assert.equal(binding.check({ runtime: 'rt:q7', epoch: '12', mutationGeneration: '3' }).admitted, true);

  // After an evaluation the mutation generation advanced: the same capture
  // ref now refuses, and the summary names the change with the scopes
  // collected so far instead of asserting a coherent capture.
  const afterEvaluate = { runtime: 'rt:q7', epoch: '12', mutationGeneration: '4' };
  const changed = binding.check(afterEvaluate);
  assert.equal(changed.admitted, false);
  assert.equal(changed.condition, 'refRetiredByMutation');
  const partial = scopeSummaries({
    scopeChain: [
      { type: 'local', name: '', object: { type: 'object', objectId: 'obj-1' } },
      { type: 'closure', name: '', object: { type: 'object', objectId: 'obj-2' } },
    ],
    identity: IDENTITY,
    loadScope: () => ({ result: [], internalProperties: [] }),
    admission: binding,
    live: afterEvaluate,
  });
  assert.equal(partial.condition, 'changedDuringCapture');
  assert.equal(partial.refusal.condition, 'refRetiredByMutation');
  assert.equal(partial.scopes.length, 1, 'the scope read before the change is retained');

  // A malformed or missing admission refuses the capture outright.
  const noAdmission = scopeSummaries({
    scopeChain: [{ type: 'local', name: '', object: { type: 'object', objectId: 'obj-1' } }],
    identity: IDENTITY,
    loadScope: () => ({ result: [], internalProperties: [] }),
    admission: { check: () => null },
    live: {},
  });
  assert.equal(noAdmission.condition, 'changedDuringCapture');
  assert.equal(noAdmission.refusal.condition, 'refDecisionMalformed');
});

test('scopes without an object and malformed chains refuse explicitly', () => {
  const summarized = scopeSummaries({ scopeChain: [{ type: 'block', object: undefined }], identity: IDENTITY });
  assert.equal(summarized.scopes[0].object.condition, 'missingScopeObject');
  assert.equal(scopeSummaries({ scopeChain: 'x' }).condition, 'malformedScopeChain');
});

test('during a pause the exception value is paused.data; exceptionThrown is the unpaused source', () => {
  const atPause = captureException({ paused: true, pausedData: { type: 'object', description: 'Error: boom', className: 'Error' } });
  assert.equal(atPause.source, 'paused.data');
  assert.equal(atPause.value.description, 'Error: boom');

  const unpaused = captureException({
    paused: false,
    exceptionThrownEvent: {
      exceptionDetails: {
        text: 'Uncaught',
        exception: { type: 'object', className: 'Error', description: 'Error: thrown-later' },
        stackTrace: { callFrames: [] },
      },
    },
  });
  assert.equal(unpaused.source, 'exceptionThrown');
  assert.equal(unpaused.text, 'Uncaught');
  assert.deepEqual(unpaused.stackTrace, { callFrames: [] });

  const detailsOnly = captureException({ paused: false, exceptionThrownEvent: { exceptionDetails: { text: 'Uncaught TypeError: x is not a function' } } });
  assert.equal(detailsOnly.source, 'exceptionThrown');
  assert.equal(detailsOnly.value.description, 'Uncaught TypeError: x is not a function');
});

test('exception sources refuse to merge and refuse to be absent', () => {
  const data = { type: 'object', description: 'Error: boom' };
  assert.equal(captureException({ paused: true, pausedData: data, exceptionThrownEvent: { exceptionDetails: {} } }).condition, 'conflictingExceptionSources');
  assert.equal(captureException({ paused: false, pausedData: data, exceptionThrownEvent: { exceptionDetails: {} } }).condition, 'conflictingExceptionSources');
  assert.equal(captureException({ paused: true }).condition, 'noExceptionObserved');
  assert.equal(captureException({ paused: false, exceptionThrownEvent: {} }).condition, 'noExceptionObserved');
  assert.equal(captureException({}).condition, 'noExceptionObserved');
});

test('worker inventory maps detaches through the session id and records unmatched detaches', () => {
  const inventory = workerInventory({
    attached: [{ workerInfo: { workerId: '1', type: 'dedicated', title: 'w', url: 'file:///work/worker.mjs' }, sessionId: 'sess-worker-1' }],
    detachedFromWorker: [{ sessionId: 'sess-worker-1', reason: 'closed' }],
  });
  assert.equal(inventory.workers.length, 1);
  const worker = inventory.workers[0];
  assert.equal(worker.workerId, '1');
  assert.equal(worker.state, 'detached', 'a detached session is never reported attached');
  assert.deepEqual(worker.detached, { sessionId: 'sess-worker-1', reason: 'closed' });
  assert.deepEqual(inventory.limits, ['workerBreakpointsUnavailable', 'workerScopesUnavailable', 'workerExceptionsUnavailable']);

  const unknownDetach = workerInventory({
    attached: [{ workerInfo: { workerId: '2', type: 'dedicated', title: 'kept', url: 'u' }, sessionId: 'sess-kept' }],
    detachedFromWorker: [{ sessionId: 'sess-unknown', reason: 'closed' }],
  });
  assert.equal(unknownDetach.workers.length, 2);
  assert.equal(unknownDetach.workers[0].state, 'attached');
  assert.equal(unknownDetach.workers[1].state, 'detached');
  assert.equal(unknownDetach.workers[1].sessionId, 'sess-unknown');
  assert.equal(unknownDetach.workers[1].workerId, null);
  assert.ok(unknownDetach.workers[1].note.includes('without a recorded attached event'));

  const allAttached = workerInventory({
    attached: [{ workerInfo: { workerId: '3', type: 'dedicated', title: 'w', url: 'u' }, sessionId: 'sess-3' }],
    detachedFromWorker: [],
  });
  assert.equal(allAttached.workers[0].state, 'attached');
  assert.equal(allAttached.workers[0].detached, null);
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

test('only an explicit admitted decision permits access; everything else refuses by name', () => {
  const live = { runtime: 'rt:q7', epoch: '12', mutationGeneration: '3' };
  // The asserted admitted shape admits.
  assert.equal(staleRefRefusal(admitRef(IDENTITY, live)), null);
  assert.deepEqual(admissionOutcome({ decision: 'admitted', ok: true, identity: IDENTITY }), { admitted: true, identity: IDENTITY });

  // Production refusals render their own conditions.
  for (const condition of ['refMalformed', 'foreignRuntime', 'foreignAdapter', 'staleReference', 'refRetiredByMutation', 'refOutsidePause', 'refStopNotLive', 'refThreadUnknown']) {
    const refusal = staleRefRefusal({ decision: 'refused', condition });
    assert.equal(refusal.refused, true);
    assert.equal(refusal.condition, condition);
    assert.ok(refusal.note.includes('runtimeBusy'), 'the refusal note names the runtimeBusy policy');
  }

  // An admitted candidate carrying ok:false is contradictory and refuses by
  // its own condition, never as admission.
  const contradictory = admissionOutcome({ decision: 'admitted', ok: false, identity: IDENTITY });
  assert.equal(contradictory.admitted, undefined);
  assert.equal(contradictory.refused, true);
  assert.equal(contradictory.condition, 'refDecisionContradictory');
  assert.equal(staleRefRefusal({ decision: 'admitted', ok: false, identity: IDENTITY }).condition, 'refDecisionContradictory');

  // Anything that is not the asserted admitted shape refuses before any
  // backend access: null, undefined, strings, legacy ok shapes, admitted
  // without the asserted members, refused without condition.
  for (const candidate of [
    null,
    undefined,
    'admitted',
    42,
    { ok: true },
    { ok: false, condition: 'staleReference' },
    { decision: 'admitted' },
    { decision: 'admitted', identity: IDENTITY },
    { decision: 'refused' },
  ]) {
    const refusal = staleRefRefusal(candidate);
    assert.equal(refusal.refused, true, `candidate ${JSON.stringify(candidate)} must refuse`);
    assert.equal(refusal.condition, 'refDecisionMalformed');
  }
  assert.equal(admissionOutcome({ decision: 'refused', condition: 'refStopNotLive' }).condition, 'refStopNotLive');
  assert.equal(admissionOutcome('admitted').condition, 'refDecisionMalformed');
});

test('a capture binding without production admission or a ref refuses instead of admitting', () => {
  const noAdmission = createCaptureBinding({});
  assert.equal(noAdmission.check({}).condition, 'refDecisionMalformed');
  const noRef = createCaptureBinding({ admitRef });
  assert.equal(noRef.check({ runtime: 'rt:q7', epoch: '12', mutationGeneration: '3' }).condition, 'refDecisionMalformed');
});

test('runtime evidence keeps every field with explicit nulls and refuses missing identity', () => {
  const full = runtimeEvidence({ runtime: 'rt:q7', epoch: '12', thread: 'worker:1', script: '42', generated: 'gen.js:10:4', original: 'src/main.ts:13:2' });
  assert.deepEqual(full, {
    kind: 'runtime', runtime: 'rt:q7', epoch: '12', thread: 'worker:1', script: '42', generated: 'gen.js:10:4', original: 'src/main.ts:13:2',
  });
  const minimal = runtimeEvidence({ runtime: 'rt:q7', epoch: '0' });
  assert.deepEqual(minimal, { kind: 'runtime', runtime: 'rt:q7', epoch: '0', thread: null, script: null, generated: null, original: null });
  assert.equal('original' in minimal, true);
  assert.equal(runtimeEvidence({ epoch: '0' }).condition, 'missingRuntimeIdentity');
  assert.equal(runtimeEvidence({ runtime: 'rt:q7' }).condition, 'missingEpoch');
});
