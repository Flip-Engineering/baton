// KG-A activation implementation — launched THROUGH baton.recipes.implementContract when fleet clears.
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const log = (line) => console.log(`[kg ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'kg-activation-impl-2026-08-01'),
    routes: [{ harness: 'glm', model: 'glm-5.2', effort: 'high' }],
    verification: Object.freeze({ command: 'node', arguments: ['--test', 'impl/test/kg-activation-red.test.mjs'] }),
  },
});

try {
  const receipt = await baton.recipes.implementContract({
    route: { harness: 'glm', model: 'glm-5.2', effort: 'high' },
    scope: ['impl/**'],
    task: [
      'Implement the KG activation contract v1: docs/reference/evidence/kg-activation-2026-07-31/kg-activation-decisions.md — all five rules + the KG-A1..KG-A5 red battery. Ambient knowledge serving into briefs (bounded, provenance-wrapped, honest-empty), the first-class candidacy queue projection, ritual hooks (candidacy counts in receipts/terminal outlines), horizon digests in wave rows, gate honesty (NO auto-promotion — the orchestrator-admit gate stays the only promotion path).',
      'COORDINATES (pre-digested): renderBrief (the serving seam): adapter.mjs:96-117. recallKnowledge: coordinator.mjs:9555 (+ recallKnowledgeBounded store :14865). The candidate-minting paths to READ from (never extend): board close :13430-13448, package admit, scratchpad settle. admitWorkflowFinding (the gate, untouched): store :14253-14285 + coordinator wrapper :9788-9795. The horizons + fence-tuple cache: coordinator.mjs:9823-9907. The wave member row to extend: wave.mjs:300-322. The terminal outline + receipt hook points: application.mjs:7256 (view assembly) + impl/src/wave-driver.mjs receipt. Validity windows on nodes: store :14286+ validation. The S-3 knowledge rows (surfacing, landed): knowledge.recall/horizon canonical ops.',
      'METHOD (red-first, skeleton FIRST): (1) your FIRST file action writes impl/test/kg-activation-red.test.mjs with the KG-A1..KG-A5 rows exactly as the contract pins them (ambient serving bounded + provenance + honest-empty + expired-never-serves + byte cap; candidacy queue per source kind + admit-removes + capped ordered; receipt/terminal candidacy counts incl. zero; horizon digest changes on admit not on unrelated state; the gate lease binding + refusal taxonomy unchanged source-scan + no auto-admit path exists source-scan). Run it; watch it fail for the right reasons. (2) Implement until green — additive projections and brief serving only. (3) VERIFY: node --test impl/test/kg-activation-red.test.mjs impl/test/reflex2-boards-red.test.mjs impl/test/reflex3-packages-red.test.mjs and node impl/scripts/run-suite.mjs FROM THE REPO ROOT — all green.',
    ].join(' '),
    idempotencyKey: `kg-activation-${new Date().toISOString().slice(0, 10)}`,
    manifestPath: resolve(repo, 'docs/reference/evidence/kg-activation-2026-07-31/kg-manifest.json'),
    evidencePath: resolve(repo, 'docs/reference/evidence/kg-activation-2026-07-31/impl-evidence.json'),
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('KG-RECIPES-OK');
} finally {
  await baton.close().catch(() => {});
}
