import test from 'node:test';
import assert from 'node:assert/strict';
import { SwarmNativeAccess } from '../src/swarm-native-access.mjs';
import { SWARM_BRIDGE_ENV_KEYS } from '../src/swarm-native-bridge.mjs';

test('stop during native access preparation cannot install credentials after revocation', async (t) => {
  const registrations = new Map();
  const access = new SwarmNativeAccess({
    coordinator: { registerParticipantRuntime: (id, entry) => registrations.set(id, entry),
      unregisterParticipantRuntime: (id) => registrations.delete(id) },
    dispatch: async () => ({}),
  });
  t.after(() => access.close());
  const pending = access.prepare({ swarmId: 'swarm', participantId: 'builder', runId: 'run' });
  access.revoke('run');
  await assert.rejects(pending, { code: 'swarm_native_access_revoked' });
  assert.equal(registrations.size, 0);
  assert.equal(access.bridge.inspect().capabilities.length, 0);
});

test('the seat\'s declared wake narrowing rides the issued bridge environment (docs/54 §4.1)', async (t) => {
  const registrations = new Map();
  const access = new SwarmNativeAccess({
    coordinator: { registerParticipantRuntime: (id, entry) => registrations.set(id, entry),
      unregisterParticipantRuntime: (id) => registrations.delete(id) },
    dispatch: async () => ({}),
  });
  t.after(() => access.close());

  await access.prepare({ swarmId: 'swarm', participantId: 'builder', runId: 'run-529',
    autoWake: Object.freeze({ kinds: Object.freeze(['dead']), participants: null }) });
  assert.equal(registrations.get('run-529').env[SWARM_BRIDGE_ENV_KEYS.autoWake],
    '{"kinds":["dead"]}',
    'the narrowing is published beside the seat\'s swarm coordinates, where its entry reads it');

  await access.prepare({ swarmId: 'swarm', participantId: 'other', runId: 'run-plain' });
  assert.equal(Object.hasOwn(registrations.get('run-plain').env, SWARM_BRIDGE_ENV_KEYS.autoWake), false,
    'a seat recruited without a narrowing publishes no key — absence is the whole-stream default');
});


test('turn-end reports retain the registered participant identity', async (t) => {
  const registrations = new Map();
  const reports = [];
  const access = new SwarmNativeAccess({
    coordinator: { registerParticipantRuntime: (id, entry) => registrations.set(id, entry),
      unregisterParticipantRuntime: (id) => registrations.delete(id) },
    dispatch: async () => ({}),
    onTurnCompleted: async (report) => reports.push(report),
  });
  t.after(() => access.close());
  await access.prepare({ swarmId: 'swarm', participantId: 'builder', runId: 'run-report' });
  await registrations.get('run-report').onTurnCompleted({ swarmId: 'wrong',
    participantId: 'wrong', workerId: 'w-1', turnSeq: 3, report: { summary: 'Ready' } });
  assert.deepEqual(reports, [{ swarmId: 'swarm', participantId: 'builder', workerId: 'w-1',
    turnSeq: 3, report: { summary: 'Ready' } }]);
});
