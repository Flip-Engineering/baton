// Issue #564 live verification: a real root-addressed wake is delivered to a live, idle
// Claude Code session through the real discovery (`claude agents --json`) and the real
// transport (/tmp/cc-socks/<pid>.sock), exactly once, with a durable receipt.
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { CoordinationStore } from '../impl/src/coordination-store.mjs';
import { SwarmRuntime } from '../impl/src/swarm-runtime.mjs';
import { WebNorthbound } from '../impl/src/web-northbound.mjs';
import { deliverRootWakeFrame } from '../impl/src/wake-delivery.mjs';
import { deriveWakeFrame } from '../impl/src/wake-stream.mjs';

const SESSION_ID = process.env.VERIFY_SESSION_ID;
if (!SESSION_ID) throw new Error('VERIFY_SESSION_ID required');

const waitFor = async (read, predicate, label, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (predicate(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}: ${JSON.stringify(value).slice(0, 400)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const directory = mkdtempSync('/tmp/baton-564-live-');
try {
  const store = new CoordinationStore(join(directory, 'coordination'));
  const coordinator = {
    list: () => [], pausedTurns: () => [], routeCards: () => [],
    guideParticipant: async () => ({ ok: true }),
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async () => {}, stopRun: async () => ({ state: 'closed' }),
  });
  const target = { harness: 'claude-code', sessionId: SESSION_ID, from: 'baton-564-verify' };
  const web = new WebNorthbound({
    coordinator, coordination: store, allowedOrigins: [], repoIds: [], pollMs: 5,
    rootWakeDelivery: { target },
  });

  const owed = store.recordDriver('swarm.root_attention_owed', {
    swarmId: 'swarm-live-564', participantId: 'wake-lead10', contributionId: 'contribution-live-564',
    owed: 'needs_root',
    ask: 'Issue #564 live verification: Baton root wake delivery wrote this cross-session message to prove a recorded root-addressed wake starts a turn in an idle Claude Code session. No action is needed.',
    next: { command: 'swarm.view', swarmId: 'swarm-live-564' },
  }, { actor: 'baton-runtime', key: 'live-564-owed-1' });

  const delivered = await waitFor(
    () => store.eventsView().filter((event) => event.payload?.kind === 'wake.root_delivered'),
    (rows) => rows.some((event) => event.payload.seq === owed.event.seq),
    'wake.root_delivered',
  );

  // Replay: the same frame identity delivered again must be a durable duplicate, not a resend.
  const frame = deriveWakeFrame(owed.event);
  const replay = await deliverRootWakeFrame({ store, frame, target });

  const receipts = store.eventsView().filter((event) =>
    event.payload?.kind === 'wake.root_delivered' || event.payload?.kind === 'wake.root_undelivered');

  console.log(JSON.stringify({
    owedSeq: owed.event.seq,
    deliveredRows: receipts.filter((event) => event.payload.kind === 'wake.root_delivered').length,
    undeliveredRows: receipts.filter((event) => event.payload.kind === 'wake.root_undelivered').length,
    deliveredPayload: receipts.find((event) => event.payload.kind === 'wake.root_delivered')?.payload ?? null,
    replay,
  }, null, 2));

  await web.shutdown({ drainMs: 50 });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
