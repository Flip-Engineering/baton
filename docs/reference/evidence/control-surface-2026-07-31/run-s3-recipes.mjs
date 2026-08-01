// S-3 surfacing matrix implementation — launched THROUGH baton.recipes.implementContract
// (the recipes pattern: no bespoke driver). Seat: codex@high. Launches when fleet clears.
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const log = (line) => console.log(`[s3 ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'surfacing-matrix-impl-2026-08-01'),
    routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }],
    verification: Object.freeze({ command: 'node', arguments: ['--test', 'impl/test/surfacing-matrix-red.test.mjs'] }),
  },
});

try {
  const receipt = await baton.recipes.implementContract({
    route: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
    scope: ['impl/**'],
    task: [
      'Implement the S-3 surfacing matrix v1: docs/reference/evidence/control-surface-2026-07-31/s3-surfacing-matrix.md — the 19-row registry-delta table is your normative authority (canonical key · profile · surfaces · effect · live-method mapping · authority notes), plus rules 1-5 and the SM-1..SM-5 red battery. The S-2 v2 primitive is LANDED (board mutations ride its envelope); the CS v2 conformance harness is live (impl/scripts/surface-conformance.mjs).',
      'COORDINATES (pre-digested): ghost rows to reconcile: application-semantics.mjs:1231-1289. Registry-delta construction: application-semantics.mjs:1501-1526 (profile/surface defaults) + CANONICAL_OPERATION_SPECS :1130-1303. Live methods per row: projectScratchpadView application.mjs:512+ (folded :6970-6973), decisionList :8985-8999, boardSnapshot + projectBoardView :368-412, the S-2 admission primitive (board mutations), elevateTaskScratchpad coordination-store.mjs:13090, settleWorkflowScratchpad :13233, admitContextPackage/attachContextPackage :9342-9448, contextPackageBranch :9325 + projectContextPackageBranch application.mjs:289-302, admitReplManifest coordinator.mjs:9766, admitReplBinding/dropReplBinding :9924-9940, resolveReplCitation store :13824, promoteKnowledgeNode store :14308, recallKnowledge coordinator.mjs:9555, horizons :9837-9907. MCP reflex table that must DERIVE from the rows (source-scan): mcp-northbound.mjs:461-555. The run.scratchpad documented contract to honor verbatim: impl/CLI.md:26-28.',
      'METHOD (red-first, skeleton FIRST): (1) your FIRST file action writes impl/test/surfacing-matrix-red.test.mjs with the SM-1..SM-5 rows exactly as the matrix contract pins them (schema truth per row; surface honesty negative inventory; S-2 riding for mutations; read rows incl. the CLI.md:26-28 scratchpad contract and deadlineAt on decision.list; conformance rows + the MCP reflex table generated not hand-maintained). Run it; watch it fail for the right reasons. (2) Implement until green — registry rows + derivations only, NO new shared-layer features, sequencing law: read rows may land first, mutation rows only ride the S-2 primitive. (3) VERIFY: node --test impl/test/surfacing-matrix-red.test.mjs impl/test/board-authority-red.test.mjs impl/test/reflex2-boards-red.test.mjs impl/test/reflex3-packages-red.test.mjs + node impl/scripts/surface-conformance.mjs + node impl/scripts/run-suite.mjs FROM THE REPO ROOT — all green.',
    ].join(' '),
    idempotencyKey: `s3-surfacing-${new Date().toISOString().slice(0, 10)}`,
    manifestPath: resolve(repo, 'docs/reference/evidence/control-surface-2026-07-31/s3-manifest.json'),
    evidencePath: resolve(repo, 'docs/reference/evidence/control-surface-2026-07-31/sm-impl-evidence.json'),
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('S3-RECIPES-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
