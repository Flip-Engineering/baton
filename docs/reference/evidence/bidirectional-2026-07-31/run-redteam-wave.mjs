// Red-team wave for the bidirectional ergonomics contract v1: one codex@high adversarial
// seat under the shipped wave driver. Verdict + findings land in redteam-v1.md inside the
// evidence dir. Usage: node run-redteam-wave.mjs
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[rt ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'bidirectional-redteam-2026-07-31'),
    routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

const OBJECTIVE = [
  'You are the adversarial red-team for docs/reference/evidence/bidirectional-2026-07-31/bidirectional-decisions.md (v1).',
  'Deliverable: write docs/reference/evidence/bidirectional-2026-07-31/redteam-v1.md — begin the file with the verdict line and the findings skeleton in your FIRST work turn, then deepen it finding by finding.',
  'Verify EVERY citation against the live code (coordinator.mjs:2006/2046-2050/2277-2284/2502-2503/9074-9103/10695-10754, application.mjs:337-357/7102-7109/7535-7607/10954-10966, application-semantics.mjs:31-62, application-client.mjs:911-949/1163, wave-driver.mjs:128-138/262-403, wave.mjs:107-127/316/484-486, adapter.mjs:505-610, claude-session.mjs:1007-1015). Note coordinator.mjs is Read-able; application.mjs/coordination-store.mjs contain NUL bytes (use grep -an/sed via Bash).',
  'Hunt: (1) unsound rules — anything two competent implementers would build DIFFERENTLY while both claiming the contract; (2) the claim-bit rule 1: is absence-of-claim really unambiguous across ALL park paths (crash-park? watchdog park? claim-after-crash?), and does the bounded summary leak anything the attention posture forbids; (3) rule 3 onDecision: what happens on a callback THROW, on two decisions pending at once on one member, on a decision raised while another is being answered; is the expiry-progress-line rule implementable exactly-once; (4) rule 5 wake: what breaks when follow returns on an UNRELATED event (spin risk), cursor management across polls, follow disabled mid-wave; (5) red-row gaps: what failure mode would ship green despite BD-1..BD-6; (6) overreach vs the sibling control-surface v2 contract (scope collisions).',
  'Format: verdict (SOUND / SOUND-WITH-FOLDS / UNSOUND) then findings R-BD-1..N each with severity (P0/P1/P2), grounding (file:line), the failure, and the minimal repair. End with a surviving-sections list.',
  'HARD CONSTRAINT (wire_frame_oversize kills runs, issue #28): never read a whole file over ~1500 lines — grep to locate, then read targeted ranges. Bound every command output.',
  `[attempt: ${ATTEMPT}]`,
].join(' ');

try {
  const driver = createWaveDriver(baton, {
    steering: 'nudge-on-checkpoint',
    finalization: 'claim-on-stall',
    pollIntervalMs: 20_000,
    stallTimeoutMs: 12 * 60_000,
    hardCapMs: 50 * 60_000,
    settleTimeoutMs: 15_000,
    saltObjectives: false,
    evidencePath: resolve(repo, 'docs/reference/evidence/bidirectional-2026-07-31/redteam-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 'bidirectional-redteam-codex',
      objective: OBJECTIVE,
      exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
      scope: ['docs/reference/evidence/bidirectional-2026-07-31/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('REDTEAM-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
