// Regressions for the backend v1 bridge: stdin extraction and v2 event
// framing. Member order and the verbatim splice rule follow codec-wire
// event_frame; the refusal names follow the bridge contract.
//
//   node --test bend2/context/typescript/bridge.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeInvocationToRequest, frameProviderEvent } from './bridge.mjs';

test('canonical request bytes pass through untouched', () => {
  const answer = bridgeInvocationToRequest('{"version":1,"select":["symbols"]}');
  assert.equal(answer.status, 'request');
  assert.equal(answer.envelope, 'canonicalBytes');
  assert.equal(answer.request, '{"version":1,"select":["symbols"]}');
});

test('a requestCanonical frame unwraps to its bytes', () => {
  const answer = bridgeInvocationToRequest('{"requestCanonical":"{\\"version\\":1}"}');
  assert.equal(answer.status, 'request');
  assert.equal(answer.envelope, 'requestCanonical');
  assert.equal(answer.request, '{"version":1}');
});

test('a version-1 provider request flows through unchanged', () => {
  const text = '{"version":1,"engine":"typescript","subject":{"kind":"symbol"},"select":["symbols"]}';
  const answer = bridgeInvocationToRequest(text);
  assert.equal(answer.status, 'request');
  assert.equal(answer.envelope, 'providerRequestV1');
  assert.equal(answer.request, text);
});

test('a version-2 invocation extracts request, binding and identities', () => {
  const text = '{"version":2,"query":"q1","owner":"o1","moduleBinding":{"id":"typescript"},"request":"{\\"version\\":1}","inputIdentities":[],"operationPlan":[],"role":"","incarnation":""}';
  const answer = bridgeInvocationToRequest(text);
  assert.equal(answer.status, 'request');
  assert.equal(answer.envelope, 'invocationV2');
  assert.equal(answer.request, '{"version":1}');
  assert.equal(answer.binding, '{"id":"typescript"}');
  assert.equal(answer.query, 'q1');
  assert.equal(answer.owner, 'o1');
});

test('a version-2 invocation with value-form members extracts their canonical text', () => {
  // The wire carries the composite members as canonical JSON values, not
  // text (codec-wire invocation_frame): the bridge renders them to the text
  // the provider reads instead of refusing the frame.
  const text = '{"version":2,"query":"q1","owner":"o1","moduleBinding":{"id":"m"},"request":{"version":1},"inputIdentities":[],"operationPlan":[],"role":"r1","incarnation":"i1"}';
  const answer = bridgeInvocationToRequest(text);
  assert.equal(answer.status, 'request');
  assert.equal(answer.envelope, 'invocationV2');
  assert.equal(answer.request, '{"version":1}');
  assert.equal(answer.binding, '{"id":"m"}');
  assert.equal(answer.query, 'q1');
  assert.equal(answer.owner, 'o1');
});

test('an unknown version is refused by name', () => {
  const answer = bridgeInvocationToRequest('{"version":3,"request":"{}"}');
  assert.equal(answer.status, 'refused');
  assert.equal(answer.reason, 'wrongVersion');
});

test('a version-2 frame without a text request is refused', () => {
  const answer = bridgeInvocationToRequest('{"version":2,"query":"q1"}');
  assert.equal(answer.status, 'refused');
  assert.equal(answer.reason, 'invocationMissingRequest');
});

test('empty input is refused', () => {
  const answer = bridgeInvocationToRequest('');
  assert.equal(answer.status, 'refused');
  assert.equal(answer.reason, 'emptyInput');
});

test('a v1 result frames as an exact version-2 event', () => {
  const framed = frameProviderEvent({
    query: 'q1',
    owner: 'o1',
    producer: '{"id":"typescript"}',
    sequence: '0',
    frameType: 'result',
    payload: '{"facts":[]}',
  });
  assert.equal(typeof framed, 'string');
  assert.equal(
    framed,
    '{"version":2,"query":"q1","owner":"o1","moduleBinding":{"id":"typescript"},"runtime":"","role":"","incarnation":"","sequence":"0","type":"result","payload":{"facts":[]}}',
  );
});

test('binding and payload splice verbatim, including whitespace', () => {
  const framed = frameProviderEvent({
    query: 'q',
    owner: 'o',
    producer: '{ "id" : "typescript" }',
    sequence: '7',
    frameType: 'result',
    payload: '[1, 2]',
  });
  assert.ok(framed.includes('"moduleBinding":{ "id" : "typescript" }'));
  assert.ok(framed.endsWith('"payload":[1, 2]}'));
});

test('member order follows the wire contract exactly', () => {
  const framed = frameProviderEvent({ query: 'q', owner: 'o', producer: '{}', sequence: '0', frameType: 't', payload: '[]' });
  const members = [...framed.matchAll(/"([A-Za-z]+)":/g)].map((match) => match[1]);
  assert.deepEqual(members, ['version', 'query', 'owner', 'moduleBinding', 'runtime', 'role', 'incarnation', 'sequence', 'type', 'payload']);
});

test('special characters in identities escape as JSON strings', () => {
  const framed = frameProviderEvent({ query: 'q"1', owner: 'o\\x', producer: '{}', sequence: '0', frameType: 't', payload: '[]' });
  assert.ok(framed.includes('"query":"q\\"1"'));
  assert.ok(framed.includes('"owner":"o\\\\x"'));
});

test('non-JSON producer and payload are refused, never spliced', () => {
  assert.equal(frameProviderEvent({ query: 'q', owner: 'o', producer: 'nope', sequence: '0', frameType: 't', payload: '[]' }).reason, 'producerNotJson');
  assert.equal(frameProviderEvent({ query: 'q', owner: 'o', producer: '{}', sequence: '0', frameType: 't', payload: 'nope' }).reason, 'payloadNotJson');
  assert.equal(frameProviderEvent({ query: 'q', owner: 'o', producer: '{}', sequence: '', frameType: 't', payload: '[]' }).reason, 'eventSequenceMissing');
});
