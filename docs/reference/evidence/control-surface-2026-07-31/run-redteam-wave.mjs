// Red-team wave for the control-surface contract v1: one adversarial seat under
// (codex gpt-5.6-sol@high — claude seats capped until the 22:10 UTC session reset, receipt in
// state log 2026-07-31; decorrelated vendor from the kimi orchestrator-drafted contract)
// the shipped wave driver (nudge-on-checkpoint + claim-on-stall). Verdict + findings land in
// redteam-v1.md inside the evidence dir. Usage: node run-redteam-wave.mjs
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[rt ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'control-surface-redteam-codex-2026-07-31'),
    routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

const OBJECTIVE = [
  'You are the adversarial red-team for docs/reference/evidence/control-surface-2026-07-31/control-surface-decisions.md (v1).',
  'Deliverable: write docs/reference/evidence/control-surface-2026-07-31/redteam-v1.md — begin the file with the verdict line and the findings skeleton in your FIRST work turn, then deepen it finding by finding.',
  'Verify EVERY citation in the contract against the live code (application-cli.mjs, mcp-northbound.mjs, application-client.mjs, application-deployment.mjs, application-semantics.mjs, coordination-store.mjs, coordinator.mjs, render-surface-docs.mjs, surface-conformance.mjs, docs/36-unified-control-grammar.md).',
  'Hunt: (1) unsound rules — anything two competent implementers would build DIFFERENTLY while both claiming the contract; (2) contradictions with docs/36 v2.1 and the landed M0-M4b machinery (the registry, deriveSurfaceNames, the conformance harness, the divergence ledger); (3) fork risks in the rung decomposition CS-1..CS-4 (orderings that cannot land green-at-every-commit); (4) missing authority hazards — especially rule 5 (moving lease/fence enforcement into the command path) and rule 4 (kernel-profile surfacing of boards/REPL/knowledge): what breaks if a facade caller without the MCP lease posture posts to a board?; (5) overreach — anything in scope that should be cut or deferred.',
  'Format: verdict (SOUND / SOUND-WITH-FOLDS / UNSOUND) then findings R-CS-1..N each with severity (P0/P1/P2), grounding (file:line), the failure, and the minimal repair. End with a surviving-sections list.',
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
    evidencePath: resolve(repo, 'docs/reference/evidence/control-surface-2026-07-31/redteam-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 'control-surface-redteam-codex',
      objective: OBJECTIVE,
      exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
      scope: ['docs/reference/evidence/control-surface-2026-07-31/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('REDTEAM-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
