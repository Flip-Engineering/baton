// Red-team wave for the ATLAS epic contract v1: one glm-5.2@high adversarial seat under the shipped wave
// driver. Verdict + findings land in docs/reference/evidence/atlas-2026-07-31/redteam-v1.md inside the evidence dir. Usage: node run-redteam-wave.mjs
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[rt ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'atlas-redteam-2026-07-31'),
    routes: [{ harness: 'glm', model: 'glm-5.2', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

const OBJECTIVE = [
  'You are the adversarial red-team for docs/reference/evidence/atlas-2026-07-31/atlas-decisions.md (v1).',
  'Deliverable: write docs/reference/evidence/atlas-2026-07-31/redteam-v1.md — verdict line + findings skeleton in your FIRST work turn, then deepen finding by finding.',
  'Verify EVERY citation against the live code. Key seams: atlas-index.mjs:11-17/247-255 (language ceiling + carded ops), cartographer-quartermaster.mjs:361-369 (orientation.slice + epoch/overlay binding), coordinator.mjs:6360-6364/6547 (orientWorker + knowledge.map_served), atlas-representation-producer.mjs:13-18 (producer mapping + ceilings), index.mjs:1256-1284 (capabilityFactories wiring), adapter.mjs:96-117 (brief.tools), spec/capability-plane.md (ACI laws), coordinator.mjs:10818+ (trust gate).',
  'Hunt: (1) unsound rules — anything two competent implementers would build DIFFERENTLY while both claiming the contract; (2) contradictions with shipped machinery and sibling contracts (diagnostics v1 (run.debug surfaces), docs/28 audit ( ceilings), scratchpad #33 (grammar-family discipline for the deferred ATLAS_QUERY)); (3) fork risks in the rung decomposition; (4) red-row gaps — what ships green but broken; (5) overreach — scope that should be cut or deferred.',
  'Format: verdict (SOUND / SOUND-WITH-FOLDS / UNSOUND) then findings R-AT-1..N each with severity (P0/P1/P2), grounding (file:line), the failure, and the minimal repair. End with a surviving-sections list.',
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
    evidencePath: resolve(repo, 'docs/reference/evidence/atlas-2026-07-31/redteam-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 'atlas-redteam-glm',
      objective: OBJECTIVE,
      exact: { harness: 'glm', model: 'glm-5.2', effort: 'high' },
      scope: ['docs/reference/evidence/atlas-2026-07-31/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('REDTEAM-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
