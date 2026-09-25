// Scratch probe (not part of the contribution): does WebNorthbound's root-wake attachment
// deliver an owed row that was already on the ledger when the resident was constructed?
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { CoordinationStore } from '../impl/src/coordination-store.mjs';
import { WebNorthbound } from '../impl/src/web-northbound.mjs';

const directory = mkdtempSync('/tmp/baton-564-replay-');
try {
  const store = new CoordinationStore(join(directory, 'coordination'));
  const coordinator = { list: () => [], pausedTurns: () => [], routeCards: () => [], guideParticipant: async () => ({ ok: true }) };
  const owed = store.recordDriver('swarm.root_attention_owed', {
    swarmId: 'swarm-probe', participantId: 'lead', owed: 'needs_root',
    ask: 'probe: recorded BEFORE the resident was constructed',
    next: { command: 'swarm.view', swarmId: 'swarm-probe' },
  }, { actor: 'baton-runtime', key: 'probe-owed-1' });

  const sent = [];
  const web = new WebNorthbound({
    coordinator, coordination: store, allowedOrigins: [], repoIds: [], pollMs: 5,
    rootWakeDelivery: {
      target: { harness: 'claude-code', sessionId: 'probe-session', from: 'probe' },
      discovery: async () => JSON.stringify([{ sessionId: 'probe-session', pid: 564 }]),
      transport: async ({ line }) => { sent.push(line); },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  const receipts = store.eventsView()
    .filter((event) => ['wake.root_delivered', 'wake.root_undelivered'].includes(event.payload?.kind))
    .map((event) => ({ kind: event.payload.kind, seq: event.payload.seq, code: event.payload.code ?? null }));
  console.log(JSON.stringify({ owedSeq: owed.event.seq, sends: sent.length, receipts }, null, 2));
  await web.shutdown({ drainMs: 50 });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
