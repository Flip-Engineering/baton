// Grammar M5 (alias sunset) — launched THROUGH baton.recipes.implementContract.
// (re-seated from grok — grok's token 401'd at turn time, its short-TTL pattern + #47's gap;
// deepseek proved implementation depth on P1-C. New deployment root: fresh state.)
//
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const log = (line) => console.log(`[m5 ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'grammar-m5-impl-ds-2026-08-01'),
    routes: [{ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }],
    verification: Object.freeze({ command: 'node', arguments: ['--test', 'impl/test/grammar-m5-red.test.mjs'] }),
  },
});

try {
  const receipt = await baton.recipes.implementContract({
    route: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
    scope: ['impl/**', 'GLOSSARY.md', 'docs/36-unified-control-grammar.md'],
    task: [
      'Implement grammar M5 (alias sunset): docs/36-unified-control-grammar.md §9 M5 paragraph (line ~542) + acceptance contracts C1-C9 are your authority. Scope: (a) the divergence ledger to empty — retire the one remaining row (per-deployment MCP schema mutation, retiresIn M4, impl/scripts/surface-divergence-ledger.json) by either fixing the underlying mutation or removing the row with the retirement pinned; (b) a banned-token lint generated from docs/36 §4.1 with token normalization, promoted to red in the canonical suite (the M0 conformance harness at impl/scripts/surface-conformance.mjs is its home); (c) legacy phase strings grep-clean (the legacy map application-semantics.mjs:37-49 is the only sanctioned mapping site — all other literal occurrences of the legacy strings deleted or routed through it); (d) run.steer DELETED as a surface alias (canonical run.send stays: the alias rows at application-semantics.mjs:1627-1628 (cli), :1724 (mcp.fleet), :1738 (web) + the registry row at :873 + the cli.commands membership at :1000 — canonical run.send and its derived names at those sites stay); (e) GLOSSARY.md updated to the post-sunset vocabulary.',
      'COORDINATES (pre-digested): the ledger + monotone rule: impl/scripts/surface-conformance.mjs:205-246/292-299. The MCP schema mutation the ledger row names: mcp-northbound.mjs:824-864. Legacy phase map + canonical phases: application-semantics.mjs:19-53. run.send canonical rows near :1627. The C4 banned-token acceptance text: docs/36 §10 C4. M4b vocabulary flip context: docs/36 §9 M2. Conformance harness main: impl/scripts/surface-conformance.mjs.',
      'METHOD (red-first, skeleton FIRST): (1) your FIRST file action writes impl/test/grammar-m5-red.test.mjs with rows for each scope item (ledger empty + retirement pinned; banned-token lint rejects a fixture + passes the clean tree; legacy phase strings only at the sanctioned map; run.steer aliases absent with canonical run.send intact — baton run steer refuses with the corrective naming run send; GLOSSARY vocabulary). Run it; watch it fail for the right reasons. (2) Implement until green. (3) VERIFY: node --test impl/test/grammar-m5-red.test.mjs impl/test/grammar-m0-red.test.mjs impl/test/grammar-m1-red.test.mjs impl/test/grammar-m2-red.test.mjs impl/test/grammar-m3-red.test.mjs impl/test/grammar-m4-red.test.mjs + node impl/scripts/surface-conformance.mjs + node impl/scripts/run-suite.mjs FROM THE REPO ROOT — all green.',
    ].join(' '),
    idempotencyKey: `grammar-m5-${new Date().toISOString().slice(0, 10)}`,
    manifestPath: resolve(repo, 'docs/reference/evidence/control-surface-2026-07-31/m5-manifest.json'),
    evidencePath: resolve(repo, 'docs/reference/evidence/control-surface-2026-07-31/m5-impl-evidence.json'),
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('M5-RECIPES-OK');
} finally {
  await baton.close().catch(() => {});
}
