// Red-team wave for the diagnostics epic contract v1: one grok@high adversarial seat under the shipped wave
// driver. Verdict + findings land in docs/reference/evidence/diagnostics-2026-07-31/redteam-v1.md inside the evidence dir. Usage: node run-redteam-wave.mjs
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[rt ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'diagnostics-redteam-2026-07-31'),
    routes: [{ harness: 'grok', model: 'grok-4.5', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

const OBJECTIVE = [
  'You are the adversarial red-team for docs/reference/evidence/diagnostics-2026-07-31/diagnostics-decisions.md (v1).',
  'Deliverable: write docs/reference/evidence/diagnostics-2026-07-31/redteam-v1.md — verdict line + findings skeleton in your FIRST work turn, then deepen finding by finding.',
  'Verify EVERY citation against the live code. Key seams: application.mjs:10433-10503 (run.debug + _debugMember), verifier-diagnostics.mjs:5-39 (sanitization), wave-driver.mjs:11-19 (liveness heuristics), issue28-decisions.md:50-52 (the deferral), issue53-decisions.md:19-46 (debug contract + bounded discipline), coordinator.mjs:10818+ (trust gate), application-cli.mjs:1577-1590 (revise/feedback channel), contextEval at application.mjs:8821.',
  'Hunt: (1) unsound rules — anything two competent implementers would build DIFFERENTLY while both claiming the contract; (2) contradictions with shipped machinery and sibling contracts (bidirectional v2 (the claim-bit DIAG-1 rides), control-surface v2 (run.debug registration), issue #53 contract); (3) fork risks in the rung decomposition; (4) red-row gaps — what ships green but broken; (5) overreach — scope that should be cut or deferred.',
  'Format: verdict (SOUND / SOUND-WITH-FOLDS / UNSOUND) then findings R-DG-1..N each with severity (P0/P1/P2), grounding (file:line), the failure, and the minimal repair. End with a surviving-sections list.',
  'HARD CONSTRAINT (wire_frame_oversize kills runs, issue #28): never read a whole file over ~1500 lines — grep to locate, then read targeted ranges. application.mjs/coordinator.mjs/coordination-store.mjs contain NUL bytes: grep -an/sed via Bash only. Bound every command output.',
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
    evidencePath: resolve(repo, 'docs/reference/evidence/diagnostics-2026-07-31/redteam-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 'diagnostics-redteam-grok',
      objective: OBJECTIVE,
      exact: { harness: 'grok', model: 'grok-4.5', effort: 'high' },
      scope: ['docs/reference/evidence/diagnostics-2026-07-31/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('REDTEAM-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
