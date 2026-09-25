// Red-team wave for the dynamic workflow composition contract v1: one codex@high adversarial seat under the shipped wave
// driver. Verdict + findings land in docs/reference/evidence/workflow-composition-2026-07-31/redteam-v1.md inside the evidence dir. Usage: node run-redteam-wave.mjs
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[rt ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'composition-redteam-2026-07-31'),
    routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

const OBJECTIVE = [
  'You are the adversarial red-team for docs/reference/evidence/workflow-composition-2026-07-31/composition-decisions.md (v1).',
  'Deliverable: write docs/reference/evidence/workflow-composition-2026-07-31/redteam-v1.md — verdict line + findings skeleton in your FIRST work turn, then deepen finding by finding.',
  'Verify EVERY citation against the live code. Key seams: wave-driver.mjs:29-104 (policy closure), wave.mjs:484-486 (wave.runs), coordinator.mjs:9704-9760 (board ops), coordination-store.mjs:13374-13555 (board store hub incl. item record shape for the nesting field), application.mjs:368-412 (projectBoardView), application-client.mjs:1483-1577 (facade shape for baton.recipes), the 93B attach surface (wave.mjs:230-296, application.mjs:10139-10158).',
  'Hunt: (1) unsound rules — anything two competent implementers would build DIFFERENTLY while both claiming the contract; (2) contradictions with shipped machinery and sibling contracts (control-surface v2 (S-1/S-2/S-3 fences), bidirectional v2 (driver callbacks), 93B v2 (attach/redrive)); (3) fork risks in the rung decomposition; (4) red-row gaps — what ships green but broken; (5) overreach — scope that should be cut or deferred.',
  'Format: verdict (SOUND / SOUND-WITH-FOLDS / UNSOUND) then findings R-DC-1..N each with severity (P0/P1/P2), grounding (file:line), the failure, and the minimal repair. End with a surviving-sections list.',
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
    evidencePath: resolve(repo, 'docs/reference/evidence/workflow-composition-2026-07-31/redteam-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 'composition-redteam-codex',
      objective: OBJECTIVE,
      exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
      scope: ['docs/reference/evidence/workflow-composition-2026-07-31/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('REDTEAM-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
