import { createHash } from 'node:crypto';
import { SWARM_EVENT_KINDS, foldSwarmEvent } from './swarm-state.mjs';
import { rootAttentionObligations, turnAttentionObligations, effectiveAttentionRecipient } from './attention-obligations.mjs';
import { contributionNeeds } from './contribution-needs.mjs';

/** This projection consumes only rows covered by a coordination commit cursor. */
export class AttentionSource {
  #swarms = new Map();
  #events = [];
  cursor = 0;

  consume(events) {
    for (const event of events) {
      if (SWARM_EVENT_KINDS.has(event.kind)) foldSwarmEvent(this.#swarms, event);
      if (event.kind === 'driver.recorded') {
        if (['swarm.turn_reported', 'swarm.root_attention_owed', 'wake.root_delivered', 'wake.root_undelivered',
          'swarm.guidance_sent', 'swarm.guidance_parked'].includes(event.payload?.kind)) this.#events.push(event);
      }
      this.cursor = event.seq;
    }
  }

  obligations() {
    const rows = [];
    for (const swarm of this.#swarms.values()) {
      rows.push(...rootAttentionObligations(swarm, this.#events));
      rows.push(...turnAttentionObligations(swarm, this.#events).filter((row) => row.recipient.kind === 'seat'));
      for (const contribution of Object.values(swarm.contributions)) {
        for (const need of contributionNeeds(contribution)) {
          if (need.to !== 'participant' || Object.hasOwn(contribution.answers ?? {}, need.needId)) continue;
          const obligationId = `attention:${createHash('sha256').update(JSON.stringify([
            swarm.swarmId, contribution.contributionId, need.needId,
          ])).digest('hex')}`;
          rows.push({ obligationId, swarmId: swarm.swarmId, contributionId: contribution.contributionId,
            participantId: contribution.participantId, needId: need.needId, owed: 'needs_participant', ask: need.ask,
            source: { kind: 'swarm.contribution_recorded', seq: contribution.seq }, seq: contribution.seq,
            recipient: effectiveAttentionRecipient(swarm, need.participantId),
            next: { command: 'swarm.update', event: 'swarm.need_answered', swarmId: swarm.swarmId,
              payload: { contributionId: contribution.contributionId, needId: need.needId } },
          });
        }
      }
    }
    return rows.sort((a, b) => a.seq - b.seq || (a.obligationId < b.obligationId ? -1 : a.obligationId === b.obligationId ? 0 : 1));
  }

}
