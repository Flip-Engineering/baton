import { createHash } from 'node:crypto';

const ROOT_ADDRESSED_NEED = /^(?:the\s+)?root\s*:/i;
const own = (record, key) => Object.hasOwn(record ?? {}, key) ? record[key] : undefined;
const identity = (parts) => `attention:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;

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
      next: { command: 'swarm.check', ...base } });
  }
  const needs = contribution.body?.needsFromOthers;
  for (const ask of Array.isArray(needs) ? needs : []) {
    if (typeof ask !== 'string' || !ROOT_ADDRESSED_NEED.test(ask)) continue;
    rows.push({ ...base, owed: 'needs_root', ask,
      next: { command: 'swarm.view', swarmId: swarm.swarmId } });
  }
  return rows;
}

const sourceKey = (row) => identity([
  'contribution', row.swarmId, row.contributionId, row.owed, row.ask,
]);
const legacyMatch = (row, renderAsk) => JSON.stringify([
  row.contributionId, row.owed, row.ask === null ? null : renderAsk(row.ask),
]);

/** Project outstanding root attention from source state and historical delivery evidence.
 * The presentation callback cannot change obligation identity. Old transport receipts describe
 * an attempt; the source's business disposition alone settles its obligation. */
export function rootAttentionObligations(swarm, events, { renderAsk = (text) => text } = {}) {
  const obligations = new Map();
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
      const match = legacyMatch(row, renderAsk);
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
    const matches = legacyMatches.get(legacyMatch({ ...payload, ask: payload.ask ?? null }, renderAsk));
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
  return [...obligations.values()].sort((a, b) => a.seq - b.seq
    || (a.obligationId < b.obligationId ? -1 : a.obligationId === b.obligationId ? 0 : 1)).map((obligation) => {
    const receipts = obligation.legacySeqs.map((seq) => legacyReceipts.get(seq)).filter(Boolean);
    const last = receipts.sort((a, b) => a.receiptSeq - b.receiptSeq).at(-1);
    const { legacySeqs, ...row } = obligation;
    return {
      ...row, recipient: { kind: 'root' },
      ask: row.ask === null ? null : renderAsk(row.ask),
      delivery: last ? { state: last.state, code: last.code } : { state: 'none', code: null },
      ...(last ? { deliveryEvidence: { kind: 'legacy_transport_receipt', seq: last.receiptSeq } } : {}),
    };
  });
}
