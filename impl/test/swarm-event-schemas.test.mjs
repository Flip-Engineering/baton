// Cluster — swarm-event-schemas.mjs. Pins the discovery contract for swarm.update payloads: the
// declarative schemas cover exactly the public event kinds, every shipped example is admitted by
// the durable-state validator (validateSwarmEvent, root-owned) once the runtime injects its
// identity fields, and the contract's early admission refuses exactly the caller-supplied fields
// the schemas name — with {field, event, expectation} detail — while never demanding an auto-filled
// field, tightening a body into a fixed record, or declaring any size/count cap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SWARM_EVENT_KINDS, validateSwarmCommand } from '../src/swarm-contract.mjs';
import { SWARM_EVENT_PAYLOAD_SCHEMAS, SWARM_EVENT_EXAMPLES, swarmEventAgentRequiredFields,
  swarmEventAutoFilledFields, swarmEventRequiredFields, swarmEventFieldExpectation,
  swarmUpdatePayloadDetails, swarmUpdatePayloadSummary } from '../src/swarm-event-schemas.mjs';
import { validateSwarmEvent } from '../src/swarm-state.mjs';

const update = (event, payload) => ({ swarmId: 'swarm-1', event, idempotencyKey: 'probe-key',
  ...(payload === undefined ? {} : { payload }) });

/** The runtime's injection, mirrored from the schemas' own autoFilled markers: payload.swarmId
 * comes from the request scope and auto-filled identity fields are derived — so the shipped
 * examples can stay caller-shaped (swarmId omitted) and still be checked against the store. */
const atStore = (event, payload) => {
  const schema = SWARM_EVENT_PAYLOAD_SCHEMAS[event];
  const injected = { ...payload, swarmId: 'swarm-1' };
  for (const field of swarmEventAutoFilledFields(event)) {
    if (field === 'swarmId') continue;
    if (injected[field] === undefined) injected[field] = schema.fields[field].example ?? 'probe-example';
  }
  return injected;
};

test('the payload schemas describe exactly the public swarm.update event kinds', () => {
  assert.deepEqual(Object.keys(SWARM_EVENT_PAYLOAD_SCHEMAS).sort(), [...SWARM_EVENT_KINDS].sort());
  for (const kind of SWARM_EVENT_KINDS) {
    const schema = SWARM_EVENT_PAYLOAD_SCHEMAS[kind];
    assert.equal(typeof schema.summary, 'string');
    assert.ok(Object.keys(schema.fields).length > 0, `${kind} describes its fields`);
    assert.equal(schema.fields.swarmId.required, true);
    assert.ok(schema.fields.swarmId.autoFilled, `${kind} marks swarmId as runtime-filled`);
    for (const field of swarmEventRequiredFields(kind)) {
      assert.equal(typeof swarmEventFieldExpectation(kind, field), 'string');
    }
  }
});

test('every shipped example is a valid store payload once the runtime injects identity', () => {
  for (const kind of SWARM_EVENT_KINDS) {
    assert.doesNotThrow(() => validateSwarmEvent(kind, atStore(kind, SWARM_EVENT_EXAMPLES[kind])),
      `${kind} example must satisfy validateSwarmEvent`);
  }
});

test('every store-required field is real: dropping it is refused by the state validator', () => {
  for (const kind of SWARM_EVENT_KINDS) {
    for (const field of swarmEventRequiredFields(kind)) {
      const payload = atStore(kind, SWARM_EVENT_EXAMPLES[kind]);
      delete payload[field];
      assert.throws(() => validateSwarmEvent(kind, payload),
        (error) => error.code === 'invalid_payload', `${kind} without ${field}`);
    }
  }
});

test('contract admission refuses exactly the caller-supplied fields, naming field and expectation', () => {
  for (const kind of SWARM_EVENT_KINDS) {
    for (const field of swarmEventAgentRequiredFields(kind)) {
      const payload = { ...SWARM_EVENT_EXAMPLES[kind] };
      delete payload[field];
      assert.throws(() => validateSwarmCommand('swarm.update', update(kind, payload)),
        (error) => error.code === 'swarm_command_invalid'
          && error.detail.field === `payload.${field}`
          && error.detail.event === kind
          && error.detail.required.includes(field)
          && error.detail.expectation === swarmEventFieldExpectation(kind, field),
        `${kind} without ${field} is refused with field detail`);
    }
  }
  // The G3 audit probe: a plausible context update missing its body now refuses before any
  // authority check, naming the offending payload field.
  assert.throws(() => validateSwarmCommand('swarm.update', update('swarm.context_updated', { key: 'probe-missing-body' })),
    (error) => error.code === 'swarm_command_invalid'
      && /payload\.body is required for swarm\.context_updated/u.test(error.message)
      && error.detail.field === 'payload.body');
  // An absent payload for a kind that needs caller fields names the whole required set.
  assert.throws(() => validateSwarmCommand('swarm.update', update('swarm.work_updated')),
    (error) => error.detail.field === 'payload'
      && error.detail.required.join('\0') === ['workId', 'objective'].join('\0'));
});

test('auto-filled fields are never demanded: text contributions, self-leaves, and closes pass', () => {
  assert.equal(validateSwarmCommand('swarm.update',
    update('swarm.contribution_recorded', 'a plain-text finding')), true);
  assert.equal(validateSwarmCommand('swarm.update',
    update('swarm.contribution_recorded', {})), true); // author and id are minted later
  assert.equal(validateSwarmCommand('swarm.update', update('swarm.participant_left')), true);
  assert.equal(validateSwarmCommand('swarm.update', update('swarm.closed', {})), true);
  for (const kind of SWARM_EVENT_KINDS) {
    for (const field of swarmEventAutoFilledFields(kind)) {
      const payload = { ...SWARM_EVENT_EXAMPLES[kind] };
      assert.equal(Object.hasOwn(payload, field), false, `${kind} example omits auto-filled ${field}`);
    }
  }
});

test('bodies stay arbitrary and no size or count cap is declared anywhere', () => {
  assert.match(SWARM_EVENT_PAYLOAD_SCHEMAS['swarm.context_updated'].fields.body.expectation, /any JSON value/u);
  assert.match(SWARM_EVENT_PAYLOAD_SCHEMAS['swarm.contribution_recorded'].fields.body.expectation, /plain text/u);
  assert.equal(JSON.stringify(SWARM_EVENT_PAYLOAD_SCHEMAS).includes('"max'), false);
  // ...and the long-body admission the surface suite pins still holds through the update path.
  const long = 'x'.repeat(12_000);
  assert.equal(validateSwarmCommand('swarm.update',
    update('swarm.contribution_recorded', long)), true);
});

test('the help renderers name every public kind for agents who cannot read code', () => {
  for (const kind of SWARM_EVENT_KINDS) {
    assert.ok(swarmUpdatePayloadSummary().includes(kind), `summary names ${kind}`);
    assert.ok(swarmUpdatePayloadDetails().includes(kind), `details name ${kind}`);
  }
  assert.match(swarmUpdatePayloadDetails(), /arbitrary JSON or plain text/u);
});
