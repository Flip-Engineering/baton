// Issue #564 root-wake acceptance (scratch, not part of the contribution): a recorded
// root-addressed owned row must reach the operator's live Claude Code session through the landed
// attachment, with the target naming the session pid, so the session registry is never consulted.
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { CoordinationStore } from '../impl/src/coordination-store.mjs';
import { WebNorthbound } from '../impl/src/web-northbound.mjs';

const SESSION_ID = process.env.VERIFY_SESSION_ID;
const PID = Number(process.env.VERIFY_PID);
if (!SESSION_ID) throw new Error('VERIFY_SESSION_ID required');
if (!Number.isSafeInteger(PID) || PID <= 0) throw new Error('VERIFY_PID required');

const waitFor = async (read, predicate, label, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (predicate(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}: ${JSON.stringify(value).slice(0, 400)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const directory = mkdtempSync('/tmp/baton-564-pid-');
try {
  const store = new CoordinationStore(join(directory, 'coordination'));
  const coordinator = {
    list: () => [], pausedTurns: () => [], routeCards: () => [],
    guideParticipant: async () => ({ ok: true }),
  };
  const web = new WebNorthbound({
    coordinator, coordination: store, allowedOrigins: [], repoIds: [], pollMs: 5,
    // The operator declares the session and its pid: the agent registry lists background agents
    // only, so an interactive session has no other id-to-pid source.
    rootWakeDelivery: { target: { harness: 'claude-code', sessionId: SESSION_ID, from: 'baton-564', pid: PID } },
  });

  const owed = store.recordDriver('swarm.root_attention_owed', {
    swarmId: 'swarm-wake-20260924', participantId: 'wake-lead11', contributionId: 'contribution-32c5852874c3c4f3ffeb0aab7fd06e20',
    owed: 'needs_root',
    ask: 'the root: issue #564 acceptance - configure the resident with advanced.rootWake so Baton wakes this session instead of the cron heartbeat. This message is the wake itself; no action is needed beyond confirming it arrived.',
    next: { command: 'swarm.view', swarmId: 'swarm-wake-20260924' },
  }, { actor: 'baton-runtime', key: 'live-564-pid-1' });

  const receipts = await waitFor(
    () => store.eventsView().filter((event) =>
      ['wake.root_delivered', 'wake.root_undelivered'].includes(event.payload?.kind)),
    (rows) => rows.some((event) => event.payload.seq === owed.event.seq),
    'a root wake receipt',
  );
  console.log(JSON.stringify({
    owedSeq: owed.event.seq,
    receipts: receipts.map((event) => ({ kind: event.payload.kind, pid: event.payload.pid ?? null,
      code: event.payload.code ?? null, mechanism: event.payload.mechanism ?? null, at: event.payload.at })),
  }, null, 2));
  await web.shutdown({ drainMs: 50 });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
