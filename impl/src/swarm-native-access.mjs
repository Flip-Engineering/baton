import { fileURLToPath } from 'node:url';
import { createSwarmNativeBridge } from './swarm-native-bridge.mjs';

/** Connect native participant tools to the live deployment without copying owner authority.
 * Credentials belong to a participant, independently of its current transport incarnation. */
export class SwarmNativeAccess {
  constructor({ coordinator, dispatch }) {
    this.coordinator = coordinator;
    this.bridge = createSwarmNativeBridge({ dispatch });
    this.participants = new Map();
    this.clientPath = fileURLToPath(new URL('./swarm-native-bridge.mjs', import.meta.url));
  }

  async prepare({ swarmId, participantId, runId }) {
    if (!this.participants.has(runId)) {
      const entry = { revoked: false, promise: null };
      entry.promise = this.bridge.issue({ swarmId, participantId, runId }).then((issued) => {
        if (entry.revoked) {
          this.bridge.revoke(issued.token);
          throw Object.assign(new Error('Participant access was revoked during preparation'), { code: 'swarm_native_access_revoked' });
        }
        const extension = Object.freeze({
          env: Object.freeze({ ...issued.env, BATON_SWARM_CLIENT: this.clientPath }),
          redactProviderFrame: (frame) => JSON.parse(JSON.stringify(frame,
            (_key, value) => typeof value === 'string' ? value.replaceAll(issued.token, '[REDACTED]') : value)),
        });
        this.coordinator.registerParticipantRuntime(runId, extension);
        return issued;
      });
      this.participants.set(runId, entry);
      entry.promise.catch(() => { if (this.participants.get(runId) === entry) this.participants.delete(runId); });
    }
    await this.participants.get(runId).promise;
  }

  revoke(runId) {
    const entry = this.participants.get(runId);
    if (entry) entry.revoked = true;
    this.bridge.revoke({ runId });
    this.coordinator.unregisterParticipantRuntime(runId);
    this.participants.delete(runId);
  }

  async close() {
    for (const entry of this.participants.values()) entry.revoked = true;
    await this.bridge.close();
    await Promise.allSettled([...this.participants.values()].map((entry) => entry.promise));
    for (const runId of this.participants.keys()) this.coordinator.unregisterParticipantRuntime(runId);
    this.participants.clear();
  }
}

export const SWARM_NATIVE_GUIDANCE = [
  'Your native tools, skills, and delegation remain available. You can coordinate directly with this swarm using your own granted authority.',
  'Run node "$BATON_SWARM_CLIENT" swarm.inspect to see participants, shared context, available actions, and your current permissions.',
  'Run node "$BATON_SWARM_CLIENT" swarm.update with JSON arguments {"event":"swarm.contribution_recorded","payload":"your finding"} to publish a finding. Group, work, context, and review updates use the permitted event kinds shown by inspect.',
  'Use swarm.guide to speak to a participant, swarm.recruit to bring in help when granted, and swarm.watch to await relevant updates. These commands use participant names; no worker, fence, pause, or approval choreography is required.',
  'The client fills your swarm identity and a per-call idempotency key. Supply an explicit idempotencyKey when replaying the same mutation. Keep the bridge credential private; never print environment variables containing tokens.',
].join('\n\n');
