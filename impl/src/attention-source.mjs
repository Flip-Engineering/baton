import { createHash } from 'node:crypto';
import { SWARM_EVENT_KINDS, foldSwarmEvent } from './swarm-state.mjs';
import { rootContributionAttention, turnAttentionObligations, effectiveAttentionRecipient, attentionRecipientKey } from './attention-obligations.mjs';
import { contributionNeeds } from './contribution-needs.mjs';

export { attentionRecipientKey };

const rootRows = (swarm) => swarm ? Object.values(swarm.contributions).flatMap((row) => rootContributionAttention(swarm, row)) : [];
const noticeKey = (row) => JSON.stringify([row.contributionId, row.owed, row.ask]);

/** Read notices and delivery cursors from the committed coordination ledger. */
export class AttentionSource {
  #swarms = new Map();
  #notices = [];
  cursor = 0;

  consume(events) {
    for (const event of events) {
      const p = event.payload;
      const swarmChanged = SWARM_EVENT_KINDS.has(event.kind);
      const before = swarmChanged ? new Set(rootRows(this.#swarms.get(p?.swarmId)).map(noticeKey)) : null;
      if (swarmChanged) foldSwarmEvent(this.#swarms, event);
      const swarm = this.#swarms.get(p?.swarmId);
      const rows = swarmChanged ? rootRows(swarm).filter((row) => !before.has(noticeKey(row)))
        .map((row) => ({ ...row, recipient: { kind: 'root' } })) : [];
      if (event.kind === 'swarm.contribution_recorded') {
        const contribution = swarm.contributions[p.contributionId];
        for (const need of contributionNeeds(contribution)) {
          if (need.to === 'participant') rows.push({
            swarmId: swarm.swarmId, contributionId: p.contributionId, participantId: p.participantId,
            owed: 'needs_participant', ask: need.ask,
            recipient: { kind: 'seat', swarmId: swarm.swarmId, participantId: need.participantId },
            next: { command: 'swarm.view', swarmId: swarm.swarmId },
          });
        }
      }
      if (event.kind === 'driver.recorded' && p.kind === 'swarm.turn_reported' && swarm) {
        rows.push(...turnAttentionObligations(swarm, [event]).map((row) => ({ ...row,
          recipient: p.parentId ? { kind: 'seat', swarmId: p.swarmId, participantId: p.parentId } : { kind: 'root' },
        })));
      }
      if (event.kind === 'driver.recorded' && p.kind === 'swarm.root_attention_owed'
        && !swarm?.contributions[p.contributionId]
        && !this.#notices.some((row) => row.swarmId === p.swarmId && row.owed === p.owed
          && row.participantId === p.participantId && row.ask === (p.ask ?? null))) {
        rows.push({ ...p, recipient: { kind: 'root' } });
      }
      for (const row of rows) this.#notices.push({ ...row, seq: event.seq,
        source: { kind: event.kind === 'driver.recorded' ? p.kind : event.kind, seq: event.seq },
        obligationId: row.obligationId ?? `attention:${createHash('sha256').update(JSON.stringify([
          event.seq, row.owed, row.recipient, row.ask,
        ])).digest('hex')}`,
      });
      if (event.kind === 'driver.recorded' && p.kind === 'attention.delivered') {
        const key = attentionRecipientKey(p.recipient);
        this.#notices = this.#notices.filter((row) => attentionRecipientKey(row.recipient) !== key || row.seq > p.cursor);
      }
      this.cursor = event.seq;
    }
  }

  obligations() { return this.#notices; }

  recipientFor(recipient) {
    if (recipient.kind === 'root') return recipient;
    return effectiveAttentionRecipient(this.#swarms.get(recipient.swarmId), recipient.participantId);
  }
}
