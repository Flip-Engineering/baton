// Unit laws for one-epoch observation assembly against recorded CDP frame
// shapes: stack mapping provenance, async capture honesty, scope summaries
// with expansion payloads, exception source separation, worker inventory
// limits, capture identity, stale-ref refusals and runtime evidence with
// explicit nulls.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mapStackFrames,
  scopeSummaries,
  captureException,
  workerInventory,
  captureIdentity,
  staleRefRefusal,
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
  assert.deepEqual(first.generated, { scriptId: '42', line: 10, column: 4 });
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

test('async chains state whether capture was enabled before the chain formed', () => {
  const unenabled = mapStackFrames({ callFrames: pauseCallFrames(), asyncStackTrace: { frames: [] }, asyncCaptureEnabled: false });
  assert.equal(unenabled.async.present, true);
  assert.equal(unenabled.async.captureEnabled, false);
  assert.ok(unenabled.async.note.length > 0);

  const enabled = mapStackFrames({ callFrames: pauseCallFrames(), asyncStackTrace: { frames: [] }, asyncCaptureEnabled: true });
  assert.equal(enabled.async.captureEnabled, true);
  assert.equal(enabled.async.note, null);

  const absent = mapStackFrames({ callFrames: pauseCallFrames(), asyncStackTrace: null, asyncCaptureEnabled: false });
  assert.equal(absent.async.present, false);
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

test('scope summaries record expansion refusals instead of inventing descriptors', () => {
  const summarized = scopeSummaries({
    scopeChain: [{ type: 'local', name: '', object: { type: 'object', objectId: 'obj-1' } }],
    identity: IDENTITY,
    loadScope: () => ({ condition: 'transportClosed' }),
  });
  assert.deepEqual(summarized.scopes[0].expansionRefusal, { condition: 'transportClosed' });
  assert.deepEqual(summarized.scopes[0].properties, []);
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

test('worker inventory carries distinct identities and the unavailability limits', () => {
  const inventory = workerInventory({
    attached: [{ workerInfo: { workerId: '1', type: 'dedicated', title: 'w', url: 'file:///work/worker.mjs' }, sessionId: 'sess-worker-1' }],
    detached: [],
  });
  assert.deepEqual(inventory.workers, [
    { workerId: '1', type: 'dedicated', title: 'w', url: 'file:///work/worker.mjs', sessionId: 'sess-worker-1', state: 'attached' },
  ]);
  assert.deepEqual(inventory.limits, ['workerBreakpointsUnavailable', 'workerScopesUnavailable', 'workerExceptionsUnavailable']);

  const detached = workerInventory({
    attached: [{ workerInfo: { workerId: '1', type: 'dedicated', title: 'w', url: 'u' }, sessionId: 's1' }],
    detached: [{ workerInfo: { workerId: '1' } }],
  });
  assert.equal(detached.workers[0].state, 'detached');
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

test('stale refs refuse by name before any backend request; admitted refs produce no refusal', () => {
  const refusal = staleRefRefusal({ ok: false, condition: 'refRetiredByMutation' });
  assert.equal(refusal.refused, true);
  assert.equal(refusal.condition, 'refRetiredByMutation');
  assert.ok(refusal.note.includes('mutation generation'));
  assert.equal(staleRefRefusal({ ok: true }), null);
  assert.equal(staleRefRefusal(undefined), null);
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
