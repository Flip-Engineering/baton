// Unit laws for RemoteObject value observation against recorded CDP response
// shapes. These pin general JSON value semantics (negative/fractional values,
// unserializableValue forms, the null/undefined/JSON-null distinction),
// conservative preview incompleteness, accessor descriptors without
// execution, and expansion payload/completeness records.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PREVIEW_NOTE,
  VALUE_LIMITS,
  describeRemoteObject,
  nullKind,
  previewCompleteness,
  propertyDescriptorSummary,
  internalPropertiesSummary,
  expansionPayload,
  expansionCompleteness,
} from '../../context/runtime/values.mjs';

test('described RemoteObjects preserve type, subtype, class, description and value verbatim', () => {
  assert.deepEqual(
    describeRemoteObject({ type: 'object', subtype: 'null', className: 'Object', description: 'null', value: null }),
    { type: 'object', subtype: 'null', className: 'Object', description: 'null', value: null },
  );
  assert.deepEqual(
    describeRemoteObject({ type: 'number', value: -1.5, description: '-1.5' }),
    { type: 'number', subtype: null, className: null, description: '-1.5', value: -1.5 },
  );
});

test('unserializableValue forms are carried verbatim and survive beside any value field', () => {
  for (const spelling of ['NaN', 'Infinity', '-Infinity', '-0', '9007199254740993n']) {
    const described = describeRemoteObject({ type: 'number', unserializableValue: spelling, description: spelling });
    assert.equal(described.unserializableValue, spelling);
  }
  const bigint = describeRemoteObject({ type: 'bigint', unserializableValue: '18446744073709551617n', description: '18446744073709551617n' });
  assert.equal(bigint.unserializableValue, '18446744073709551617n');
});

test('null subtype, the undefined type and a JSON null value remain three distinct observations', () => {
  assert.equal(nullKind({ type: 'object', subtype: 'null' }), 'null');
  assert.equal(nullKind({ type: 'undefined' }), 'undefined');
  assert.equal(nullKind({ type: 'object', value: null }), 'jsonNullValue');
  assert.equal(nullKind({ type: 'object', subtype: 'error', value: null }), null);
  assert.equal(nullKind({ type: 'number', value: 0 }), null);
});

test('handles and previews pass through; malformed input refuses', () => {
  const described = describeRemoteObject({ type: 'object', className: 'Object', description: 'Object', objectId: 'obj-1', preview: { type: 'object', properties: [] } });
  assert.equal(described.objectId, 'obj-1');
  assert.deepEqual(described.preview, { type: 'object', properties: [] });
  assert.equal(describeRemoteObject(null).condition, 'malformedRemoteObject');
  assert.equal(describeRemoteObject('x').condition, 'malformedRemoteObject');
});

test('any preview is conservatively incomplete regardless of its own flags', () => {
  const overflowing = previewCompleteness({
    type: 'object',
    description: 'Object',
    overflow: true,
    properties: [
      { name: 'a', type: 'number', value: '1' },
      { name: 'f', type: 'number', value: '6' },
    ],
  });
  assert.equal(overflowing.complete, false);
  assert.equal(overflowing.overflow, true);
  assert.equal(overflowing.reason, VALUE_LIMITS.previewIncomplete);
  assert.equal(overflowing.note, PREVIEW_NOTE);

  const ellipsised = previewCompleteness({
    type: 'string',
    description: 'x'.repeat(99) + '\u2026',
    overflow: false,
    properties: [],
  });
  assert.equal(ellipsised.complete, false);
  assert.equal(ellipsised.overflow, false);
  assert.equal(ellipsised.truncationSuspected, true);

  // The conservative rule does not depend on the recorded fixture thresholds:
  // a short preview with overflow:false and no ellipsis still stays incomplete.
  const shortPlain = previewCompleteness({
    type: 'object',
    description: 'Object',
    overflow: false,
    properties: [{ name: 'a', type: 'number', value: '1' }],
  });
  assert.equal(shortPlain.complete, false);
  assert.equal(shortPlain.truncationSuspected, false);

  assert.equal(previewCompleteness(undefined).condition, 'noPreview');
});

test('data property descriptors keep their described value; symbol names stay described objects', () => {
  const data = propertyDescriptorSummary({
    name: 'a',
    value: { type: 'number', value: 1, description: '1' },
    writable: true,
    enumerable: true,
    configurable: false,
    isOwn: true,
  });
  assert.equal(data.kind, 'data');
  assert.equal(data.writable, true);
  assert.deepEqual(data.value, { type: 'number', subtype: null, className: null, description: '1', value: 1 });

  const symbol = propertyDescriptorSummary({
    name: { type: 'symbol', description: 'Symbol(s)', objectId: undefined },
    value: { type: 'number', value: 2, description: '2' },
  });
  assert.deepEqual(symbol.name, { type: 'symbol', subtype: null, className: null, description: 'Symbol(s)' });
});

test('accessor descriptors keep their getter and setter as descriptors and never execute them', () => {
  const accessor = propertyDescriptorSummary({
    name: 'v',
    get: { type: 'function', className: 'Function', description: 'get v()', objectId: 'handle-get-1' },
    set: undefined,
    enumerable: true,
    configurable: true,
  });
  assert.equal(accessor.kind, 'accessor');
  assert.equal(accessor.get.objectId, 'handle-get-1');
  assert.equal(accessor.set, null);
  assert.equal(accessor.value, undefined);
  assert.equal('writable' in accessor, false);

  const accessorSetter = propertyDescriptorSummary({
    name: 'v',
    get: { type: 'function', description: 'get v()' },
    set: { type: 'function', description: 'set v()' },
  });
  assert.equal(accessorSetter.kind, 'accessor');
  assert.equal(accessorSetter.get.objectId, undefined);
  assert.deepEqual(accessorSetter.set, { type: 'function', subtype: null, className: null, description: 'set v()' });

  assert.equal(propertyDescriptorSummary(null).condition, 'malformedPropertyDescriptor');
});

test('internal properties stay a separate list beside the descriptor list', () => {
  const summary = internalPropertiesSummary([
    { name: '[[Prototype]]', value: { type: 'object', className: 'Object', description: 'Object' } },
    { name: '[[FunctionLocation]]' },
  ]);
  assert.equal(summary[0].name, '[[Prototype]]');
  assert.equal(summary[0].value.className, 'Object');
  assert.deepEqual(summary[1], { name: '[[FunctionLocation]]', value: null });
  assert.deepEqual(internalPropertiesSummary(undefined), []);
});

test('expansion payloads name the handle and the identity members without encoding the ref', () => {
  const identity = { runtime: 'rt:q7', adapter: '0', thread: 'main:0', epoch: '12', mutationGeneration: '3' };
  const fromValue = expansionPayload({ name: 'big', value: { type: 'object', objectId: 'obj-9' } }, identity);
  assert.deepEqual(fromValue, { kind: 'object', handle: 'obj-9', identity });
  const fromGetter = expansionPayload({ name: 'v', get: { type: 'function', objectId: 'handle-get-1' } }, identity);
  assert.equal(fromGetter.handle, 'handle-get-1');
  assert.equal(expansionPayload({ name: 'plain', value: { type: 'number', value: 1 } }, identity), null);
  assert.equal(expansionPayload(null, identity), null);
});

test('full expansion is complete only without an exception, and never claims an executed accessor', () => {
  const ok = expansionCompleteness({ result: new Array(6).fill({ name: 'k', value: {} }), internalProperties: [{}] });
  assert.equal(ok.complete, true);
  assert.equal(ok.reason, 'fullExpansion');
  assert.equal(ok.propertyCount, 6);
  assert.equal(ok.internalPropertyCount, 1);
  assert.equal(ok.accessorExecuted, false);

  const refused = expansionCompleteness({ exceptionDetails: { text: 'Uncaught', exception: { type: 'object' } } });
  assert.equal(refused.complete, false);
  assert.equal(refused.reason, VALUE_LIMITS.expansionRefused);

  assert.equal(expansionCompleteness({ result: 'nope' }).reason, 'malformedExpansionResponse');
  assert.equal(expansionCompleteness(null).reason, 'malformedExpansionResponse');
});
