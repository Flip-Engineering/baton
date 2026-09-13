import test from 'node:test';
import assert from 'node:assert/strict';
import { SwarmNativeAccess } from '../src/swarm-native-access.mjs';

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
