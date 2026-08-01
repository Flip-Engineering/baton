// S-1 v2 wave grammar implementation wave: one grok@high seat implements
// (re-seated from glm — glm is on RC-A; grok proved on CS-1..CS-4 registry machinery) the S-1 v2 wave grammar amendment red-first. Usage: node run-impl-wave.mjs
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[wg ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'wave-grammar-impl-2026-07-31'),
    routes: [{ harness: 'grok', model: 'grok-4.5', effort: 'high' }],
    verification: Object.freeze({ command: 'node', arguments: ['--test', 'impl/test/wave-grammar-red.test.mjs'] }),
  },
});

const OBJECTIVE = [
  'Implement the S-1 v2 wave grammar amendment: docs/reference/evidence/control-surface-2026-07-31/s1-wave-grammar-amendment.md — the v2 amendment section at the top is your ONLY authority. waves.attach (ONLY) registers as a canonical operation + atomic transport attach-and-harvest + server-side binding proof + transportHidden mechanism + WG-1..WG-5 red rows.',
  'COORDINATES (pre-digested): registry rows: application-semantics.mjs:1088-1105 (derivation) and CANONICAL_OPERATION_SPECS :1130-1303 + buildCanonicalOperation :1547. attach machinery: wave.mjs:230-296 (attachWave), application-client.mjs:1495-1507 (waves getter), application-deployment.mjs:1188-1195 (facade parity gap). Server-side binding proof: application.mjs:10147-10158 (mint site + _runWaveId :10640). Command table: application.mjs:144-167. MCP application entries + capability map + argument validation: mcp-northbound.mjs:7-9/63-93/644-647. Web entries + ARG_FIELDS derivation (must learn transportHidden): web-northbound.mjs:14-73. Conformance harness: impl/scripts/surface-conformance.mjs. W93 suite (the taxonomy to preserve): impl/test/wave-attach-red.test.mjs. CS v2 suites for conformance reuse: impl/test/control-surface-truth-red.test.mjs.',
  'METHOD (red-first, skeleton FIRST): (1) your FIRST file action writes impl/test/wave-grammar-red.test.mjs with the WG-1..WG-5 rows exactly as the v2 amendment pins them. Run it; watch it fail for the right reasons. (2) Implement until green: the registry row (exact key waves.attach, profile ordinary, surfaces {embedded, cli, mcp, web}, closed schema, transportHidden [mintWaveDetached] + run.inspect side-channel waveId), atomic attach-and-harvest over MCP/web/CLI (attach, validate each binding server-side, settle, return {outcomes, waveDriverDetached} — NO live handle, NO emergency_stop authority transported), per-run observe authorization for the calling principal, deployment-facade waves.attach parity, the two-commit landing (registry first, transports second — mark each in the test file header). (3) VERIFY: node --test impl/test/wave-grammar-red.test.mjs impl/test/wave-attach-red.test.mjs impl/test/control-surface-truth-red.test.mjs + node impl/scripts/surface-conformance.mjs + node impl/scripts/run-suite.mjs FROM THE REPO ROOT — all green.',
  `[attempt: ${ATTEMPT}]`,
].join(' ');

try {
  const driver = createWaveDriver(baton, {
    steering: 'nudge-on-checkpoint',
    finalization: 'claim-on-stall',
    pollIntervalMs: 20_000,
    stallTimeoutMs: 20 * 60_000,
    hardCapMs: 3 * 3_600_000,
    settleTimeoutMs: 15_000,
    saltObjectives: false,
    evidencePath: resolve(repo, 'docs/reference/evidence/control-surface-2026-07-31/wg-impl-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 'wave-grammar-implementer-grok',
      objective: OBJECTIVE,
      exact: { harness: 'grok', model: 'grok-4.5', effort: 'high' },
      scope: ['impl/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('wg-WAVE-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
