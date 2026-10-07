// DIAG DG-1 implementation — launched THROUGH baton.recipes.implementContract. Seat: grok@high.
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const log = (line) => console.log(`[dg ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'diagnostics-impl-2026-08-01'),
    routes: [{ harness: 'grok', model: 'grok-4.5', effort: 'high' }],
    verification: Object.freeze({ command: 'node', arguments: ['--test', 'impl/test/diagnostics-red.test.mjs'] }),
  },
});

try {
  const receipt = await baton.recipes.implementContract({
    route: { harness: 'grok', model: 'grok-4.5', effort: 'high' },
    scope: ['impl/**'],
    task: [
      'Implement the diagnostics contract v2, rung DG-1 ONLY (DIAG-3 + DIAG-2): docs/reference/evidence/diagnostics-2026-07-31/diagnostics-decisions.md — the v2 section at the top is your ONLY authority. DG-1a: wire.frame_degraded + stream-death land in run.debug failure/writeReceipts legs as whitelisted summaries (the #28 deferral). DG-1b: trust-gate rejection diagnosis {gate, detail} honestly shaped (scope → digests+counts, NEVER path strings; red_green/coverage → sanitized tail via verifier-diagnostics.mjs; unknown fallback) in run.debug failure leg + the SAME payload to the worker via run.feedback.',
      'COORDINATES (pre-digested): run.debug + _debugMember: application.mjs:10433-10550 (the legs to extend — the #53 closed shapes get a whitelist AMENDMENT, see contract rule 4). wire.frame_degraded emission: grep -an "frame_degraded" impl/src/*.mjs. Sanitizer to reuse verbatim: impl/src/verifier-diagnostics.mjs:5-39. Trust-gate gate codes (the LIVE set to pin): coordinator.mjs:10818-10936 + the pathScopeEvidence digests-only shape :10860-10872 (deliberate — do NOT reopen it). run.feedback channel: application-client.mjs:1128 + application.mjs run.feedback handler. #53 contract (whitelist discipline): docs/reference/evidence/issue53-run-debug-2026-07-24/issue53-decisions.md. #28 deferral text: docs/reference/evidence/issue28-wire-degrade-2026-07-24/issue28-decisions.md:50-52.',
      'METHOD (red-first, skeleton FIRST): (1) your FIRST file action writes impl/test/diagnostics-red.test.mjs with the DG-1a/DG-1b rows exactly as the v2 contract pins them (whitelisted summaries never raw frames; scope → {gate:scope, detail:{digests, counts}}; red_green → sanitized tail; secret-shaped fixture never leaks; run.feedback carries the same payload; the #53 closed-shape amendment pinned by source-scan). Run it; watch it fail for the right reasons. (2) Implement until green — projection-side only. (3) VERIFY: node --test impl/test/diagnostics-red.test.mjs impl/test/issue53-run-debug-red.test.mjs and node impl/scripts/run-suite.mjs FROM THE REPO ROOT — all green.',
    ].join(' '),
    idempotencyKey: `diag-dg1-${new Date().toISOString().slice(0, 10)}`,
    manifestPath: resolve(repo, 'docs/reference/evidence/diagnostics-2026-07-31/dg1-manifest.json'),
    evidencePath: resolve(repo, 'docs/reference/evidence/diagnostics-2026-07-31/impl-evidence.json'),
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('DG-RECIPES-OK');
} finally {
  await baton.close().catch(() => {});
}
