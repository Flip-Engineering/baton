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
    deploymentRoot: resolve(repo, '.baton', 's2-redteam-2026-07-31'),
    routes: [{ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

const OBJECTIVE = [
  'You are the adversarial SECURITY red-team for docs/reference/evidence/control-surface-2026-07-31/s2-board-authority-subcontract.md (v1).',
  'Deliverable: write docs/reference/evidence/control-surface-2026-07-31/s2-redteam-v1.md — verdict line + findings skeleton in your FIRST work turn, then deepen finding by finding.',
  'Verify EVERY citation against the live code: mcp-northbound.mjs:1332-1361/1430-1448 (the current adapter guards), coordination-store.mjs:1759-1889 (lease machinery incl. :1818-1842 revalidation), coordination-store.mjs:13374-13555 (board hub), coordination-store.mjs:9325-9450 (packages), coordinator.mjs:9703-9760 (board wrappers + actor default), application-semantics.mjs:1231-1289/1501-1526 (ghost rows + profile/surface defaults), application.mjs:368-412 (projectBoardView). This is a SECURITY review: your standard is whether an adversarial caller (malicious worker, confused deputy facade, replay attacker, cross-session impersonator) can mutate a board or package without the lease, with a stale fence, with a forged actor, or across a TOCTOU gap.',
  'Hunt: (1) bypass paths — any route to a board/package mutation that skips the primitive (worker claim/report paths, package admit from a Context Program, the store hubs called directly); (2) envelope forgeries — actor/session/principal confusion the closed shape misses; (3) lease lifecycle holes — acquisition races, revocation lag on Run close, TTL edges, cross-Run lease reuse; (4) fence/CAS gaps — board-fence vs item-version vs worker-fence confusion, the exact serialization point; (5) refusal-order leaks — existence/timing oracles the pinned order misses; (6) BA-1..BA-10 gaps — what ships green but broken; (7) facade acquisition honesty — can a facade principal escalate past its lease.',
  'Format: verdict (SOUND / SOUND-WITH-FOLDS / UNSOUND) then findings R-BA-1..N each with severity (P0/P1/P2), grounding (file:line), the failure, and the minimal repair. End with a surviving-sections list.',
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
    evidencePath: resolve(repo, 'docs/reference/evidence/control-surface-2026-07-31/s2-redteam-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 's2-redteam-opus',
      objective: OBJECTIVE,
      exact: { harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' },
      scope: ['docs/reference/evidence/control-surface-2026-07-31/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('REDTEAM-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
