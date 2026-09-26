import { createHash } from 'node:crypto';
import { contributionNeeds } from './contribution-needs.mjs';

export const attentionRecipientKey = (recipient) => recipient.kind === 'root' ? 'root'
  : JSON.stringify([recipient.swarmId, recipient.participantId]);

const own = (record, key) => Object.hasOwn(record ?? {}, key) ? record[key] : undefined;
const identity = (parts) => `attention:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;

export function turnReportAsk(payload) {
  const report = payload?.report;
  if (typeof report === 'string' && report.length > 0) return report;
  if (typeof report?.summary === 'string' && report.summary.length > 0) return report.summary;
  return typeof payload?.deliveryFailure?.reason === 'string' ? payload.deliveryFailure.reason : null;
}

export function effectiveAttentionRecipient(swarm, participantId) {
  const seen = new Set();
  let current = participantId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const seat = own(swarm.participants, current);
    if (seat?.status === 'active') return { kind: 'seat', swarmId: swarm.swarmId, participantId: current };
    const successors = Object.values(swarm.participants ?? {}).filter((row) => row.resumeFrom === current);
    const successor = successors.sort((a, b) => b.seq - a.seq)[0];
    current = successor?.participantId ?? seat?.parentId ?? null;
  }
  return { kind: 'root' };
}

export function turnAttentionObligations(swarm, events) {
  const rows = new Map();
  for (const event of events) {
    const p = event.kind === 'driver.recorded' ? event.payload : null;
    if (p?.kind !== 'swarm.turn_reported' || p.swarmId !== swarm.swarmId) continue;
    const recipient = effectiveAttentionRecipient(swarm, p.parentId);
    const obligationId = identity(['turn', swarm.swarmId, p.participantId, p.workerId ?? null,
      p.turnEpoch ?? null, p.turnSeq ?? event.seq]);
    rows.set(obligationId, {
      obligationId, swarmId: swarm.swarmId, participantId: p.participantId, contributionId: null,
      owed: 'turn_reported', ask: turnReportAsk(p), recipient,
      source: { kind: 'swarm.turn_reported', seq: event.seq }, seq: event.seq,
      next: { command: 'swarm.guide', swarmId: swarm.swarmId, participantId: p.participantId, inReplyTo: event.seq },
      delivery: { state: 'none', code: null },
    });
  }
  return [...rows.values()];
}

/** Source facts for the work a contribution currently addresses to the root. */
export function rootContributionAttention(swarm, contribution) {
  const author = contribution.participantId;
  const reviewed = (own(swarm.reviews, contribution.contributionId) ?? [])
    .some((review) => review.decision !== 'comment');
  const reviewerAvailable = Object.values(swarm.participants ?? {}).some((seat) => (
    seat.status === 'active' && seat.participantId !== author && seat.permissions?.includes('review')
  ));
  const base = { swarmId: swarm.swarmId, participantId: author, contributionId: contribution.contributionId };
  const rows = [];
  if (!reviewed && !reviewerAvailable) {
    rows.push({ ...base, owed: 'review_owed', ask: null,
      next: { command: 'swarm.view', swarmId: swarm.swarmId } });
  }
  for (const { to, ask, needId } of contributionNeeds(contribution)) {
    if (to !== 'root') continue;
    rows.push({ ...base, owed: 'needs_root', ask, needId,
      next: { command: 'swarm.view', swarmId: swarm.swarmId } });
  }
  return rows;
}

const sourceKey = (row) => identity([
  'contribution', row.swarmId, row.contributionId, row.owed, row.ask,
]);
const legacyMatch = (row, legacyAsk = (text) => text) => JSON.stringify([
  row.contributionId, row.owed, row.ask === null ? null : legacyAsk(row.ask),
]);

/** Project outstanding root attention from source state and historical delivery evidence.
 * legacyAsk matches historical rows whose producer truncated the source ask. Every derived
 * notice retains the complete source text. Delivery observations retain the transport result. */
export function rootAttentionObligations(swarm, events, { legacyAsk = (text) => text } = {}) {
  const obligations = new Map();
  const exactMatches = new Map();
  const legacyMatches = new Map();
  const legacyReceipts = new Map();
  const legacyOwed = [];
  for (const contribution of Object.values(swarm.contributions ?? {})) {
    for (const row of rootContributionAttention(swarm, contribution)) {
      const obligationId = sourceKey(row);
      if (obligations.has(obligationId)) continue;
      const obligation = {
        ...row, obligationId, source: { kind: 'swarm.contribution_recorded', seq: contribution.seq },
        seq: contribution.seq, legacySeqs: [],
      };
      obligations.set(obligationId, obligation);
      exactMatches.set(legacyMatch(row), obligation);
      const match = legacyMatch(row, legacyAsk);
      const matches = legacyMatches.get(match) ?? [];
      matches.push(obligation);
      legacyMatches.set(match, matches);
    }
  }
  for (const event of events) {
    const payload = event.kind === 'driver.recorded' ? event.payload : null;
    if (payload?.swarmId !== swarm.swarmId) continue;
    if (payload.kind === 'swarm.root_attention_owed') legacyOwed.push(event);
    if (['wake.root_delivered', 'wake.root_undelivered'].includes(payload.kind)
      && payload.wakeClass === 'root_owed' && Number.isSafeInteger(payload.seq)) {
      legacyReceipts.set(payload.seq, {
        state: payload.kind === 'wake.root_delivered' ? 'transport_reported' : 'failed',
        code: payload.kind === 'wake.root_undelivered' ? payload.code ?? null : null,
        receiptSeq: event.seq,
      });
    }
  }
  for (const event of legacyOwed) {
    const payload = event.payload;
    if (payload.owed === 'turn_reported') {
      const sourceExists = events.some((row) => row.kind === 'driver.recorded'
        && row.payload?.kind === 'swarm.turn_reported' && row.payload.swarmId === swarm.swarmId
        && (payload.reportSeq !== undefined ? row.seq === payload.reportSeq
          : row.payload.participantId === payload.participantId && turnReportAsk(row.payload) === (payload.ask ?? null)));
      if (sourceExists) continue;
    }
    const match = legacyMatch({ ...payload, ask: payload.ask ?? null });
    const exact = exactMatches.get(match);
    const matches = exact ? [exact] : legacyMatches.get(match);
    if (matches) {
      for (const obligation of matches) {
        obligation.legacySeqs.push(event.seq);
        if (obligation.legacySeqs.length === 1) obligation.seq = event.seq;
      }
      continue;
    }
    // A known contribution supplies its current routing and review disposition. A legacy row
    // with an unavailable source remains visible for diagnosis; delivery cannot erase it.
    if (['review_owed', 'needs_root'].includes(payload.owed)
      && own(swarm.contributions, payload.contributionId)) continue;
    const obligationId = identity(['legacy', swarm.swarmId, event.seq]);
    obligations.set(obligationId, {
      swarmId: swarm.swarmId, participantId: payload.participantId ?? null,
      contributionId: payload.contributionId ?? null, owed: payload.owed ?? null,
      ask: payload.ask ?? null, next: payload.next, obligationId,
      source: { kind: 'swarm.root_attention_owed', seq: event.seq },
      seq: event.seq, legacySeqs: [event.seq],
    });
  }
  const contributionRows = [...obligations.values()].sort((a, b) => a.seq - b.seq
    || (a.obligationId < b.obligationId ? -1 : a.obligationId === b.obligationId ? 0 : 1)).map((obligation) => {
    const receipts = obligation.legacySeqs.map((seq) => legacyReceipts.get(seq)).filter(Boolean);
    const last = receipts.sort((a, b) => a.receiptSeq - b.receiptSeq).at(-1);
    const { legacySeqs, ...row } = obligation;
    return {
      ...row, recipient: { kind: 'root' },
      delivery: last ? { state: last.state, code: last.code } : { state: 'none', code: null },
      ...(last ? { deliveryEvidence: { kind: 'legacy_transport_receipt', seq: last.receiptSeq } } : {}),
    };
  });
  const delivered = new Map();
  for (const event of events) {
    const p = event.kind === 'driver.recorded' ? event.payload : null;
    if (p?.kind === 'attention.delivered') {
      const key = attentionRecipientKey(p.recipient);
      delivered.set(key, Math.max(delivered.get(key) ?? 0, p.cursor));
    }
  }
  return [...contributionRows, ...turnAttentionObligations(swarm, events).filter((row) => row.recipient.kind === 'root')]
    .filter((row) => {
      const source = events.find((event) => event.seq === row.source.seq);
      const parentId = source?.payload?.kind === 'swarm.turn_reported' ? source.payload.parentId : null;
      const recipient = parentId ? { kind: 'seat', swarmId: swarm.swarmId, participantId: parentId } : { kind: 'root' };
      return row.source.seq > (delivered.get(attentionRecipientKey(recipient)) ?? 0);
    })
    .sort((a, b) => a.seq - b.seq);
}
