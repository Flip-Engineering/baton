// L2 CROSS-REVIEW storm — the four storm-drafted contracts red-teamed in PARALLEL with
// cross-seats (each reviewer attacks a contract it did not write): glm → #78 (codex's),
// codex → #81 (glm's), sonnet → readiness (deepseek's), deepseek → browser-use (sonnet's).
// Usage: node run-crossreview-storm.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const SWEEP = resolve(repo, 'docs/reference/evidence/frontier-sweep-2026-08-03');
const log = (line) => console.log(`[xrt ${new Date().toISOString()}] ${line}`);

const SHAPE = [
  'Adversarially red-team the assigned epic contract against the shipped codebase. Every claim',
  'grounded in file:line (grep -an + sed -n for NUL-containing files; never whole-file reads',
  '>1500 lines). For each decision in the contract: CONFIRMED-HOLE / DEFENDED / NEEDS-AMENDMENT',
  '+ the amendment text. Attack authority (identity derivation, injection lanes, replay/',
  'idempotency, scope leaks), lifecycle (ordering, crash recovery, retention, freshness), and',
  'completeness (what the contract forgot — name at least one missed hole). The campaign control',
  'law is binding: controls must be eval-able, constructive, or conversational — never clocks or',
  'turn-limits. Verify the contract HONORS it everywhere.',
].join(' ');

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'crossreview-storm-2026-08-03'),
    routes: [
      { harness: 'glm', model: 'glm-5.2', effort: 'high' },
      { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
      { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
      { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
    ],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

try {
  const receipt = await baton.recipes.run({
    name: 'l2-crossreview-storm',
    version: '1.0',
    members: [
      {
        role: 'board-workerhalf-reviewer',
        exact: { harness: 'glm', model: 'glm-5.2', effort: 'high' },
        scope: ['docs/reference/evidence/frontier-sweep-2026-08-03/**'],
        objectiveTemplate: {
          task: [
            SHAPE,
            'TARGET: docs/reference/evidence/frontier-sweep-2026-08-03/board-workerhalf-contract.md',
            '(#78, codex-drafted). Anchors: application-semantics.mjs:1407-1419 (the ghost rows),',
            'coordination-store.mjs:13495+ (the S-2 admitBoardCommand envelope), :13671-13800',
            '(postBoardItem/closeBoardItem/CAS), the board claim machinery (requestBoardClaim).',
            'Report: docs/reference/evidence/frontier-sweep-2026-08-03/board-workerhalf-redteam.md',
          ].join(' '),
          constraints: [
            'Write the report skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
            'Work in ONE continuous turn to completion.',
            'Read-only review: do not edit impl/ files; your only write target is your report path.',
          ],
        },
        report: 'docs/reference/evidence/frontier-sweep-2026-08-03/board-workerhalf-redteam.md',
      },
      {
        role: 'orientation-reviewer',
        exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
        scope: ['docs/reference/evidence/frontier-sweep-2026-08-03/**'],
        objectiveTemplate: {
          task: [
            SHAPE,
            'TARGET: docs/reference/evidence/frontier-sweep-2026-08-03/orientation-contract.md',
            '(#81, glm-drafted). Anchors: impl/src/atlas-index.mjs, cartographer-quartermaster.mjs,',
            'application-semantics.mjs (UNTRUSTED framing), the KG candidacy machinery',
            '(coordination-store.mjs:13717+), context-runtime.mjs (the citation seams).',
            'Report: docs/reference/evidence/frontier-sweep-2026-08-03/orientation-redteam.md',
          ].join(' '),
          constraints: [
            'Write the report skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
            'Work in ONE continuous turn to completion.',
            'Read-only review: do not edit impl/ files; your only write target is your report path.',
          ],
        },
        report: 'docs/reference/evidence/frontier-sweep-2026-08-03/orientation-redteam.md',
      },
      {
        role: 'readiness-reviewer',
        exact: { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
        scope: ['docs/reference/evidence/frontier-sweep-2026-08-03/**'],
        objectiveTemplate: {
          task: [
            SHAPE,
            'TARGET: docs/reference/evidence/frontier-sweep-2026-08-03/readiness-credentials-contract.md',
            '(#47+#83+#84, deepseek-drafted). Anchors: claude-credential-cache.mjs (the #11 pattern),',
            'application-deployment.mjs readiness assembly + grokAuthenticationState :400-410,',
            'the route-learning store (routePolicy/routeObservations), issue #47/#83/#84 texts (gh issue view).',
            'Report: docs/reference/evidence/frontier-sweep-2026-08-03/readiness-redteam.md',
          ].join(' '),
          constraints: [
            'Write the report skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
            'Work in ONE continuous turn to completion.',
            'Read-only review: do not edit impl/ files; your only write target is your report path.',
          ],
        },
        report: 'docs/reference/evidence/frontier-sweep-2026-08-03/readiness-redteam.md',
      },
      {
        role: 'browser-use-reviewer',
        exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
        scope: ['docs/reference/evidence/frontier-sweep-2026-08-03/**'],
        objectiveTemplate: {
          task: [
            SHAPE,
            'TARGET: docs/reference/evidence/frontier-sweep-2026-08-03/browser-use-contract.md',
            '(#85, sonnet-drafted). Anchors: messages.mjs (wrapProse/sanitization), the TG5',
            'analysis machinery (goal-plan.mjs:347-353 + coordinator.mjs:11359), the TG2 evidence',
            'classes (coordinator.mjs:11046), application-deployment.mjs normalizeAtlasDeployment',
            '(the capability posture), SECRET_SHAPED_TEXT patterns.',
            'Report: docs/reference/evidence/frontier-sweep-2026-08-03/browser-use-redteam.md',
          ].join(' '),
          constraints: [
            'Write the report skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
            'Work in ONE continuous turn to completion.',
            'Read-only review: do not edit impl/ files; your only write target is your report path.',
          ],
        },
        report: 'docs/reference/evidence/frontier-sweep-2026-08-03/browser-use-redteam.md',
      },
    ],
    policy: { steering: 'nudge-on-checkpoint', finalization: 'claim-on-stall' },
  }, {
    task: 'Cross-review red-team the four storm-drafted L2 contracts in parallel',
    idempotencyKey: 'l2-crossreview-storm-2026-08-03',
    manifestPath: resolve(SWEEP, 'crossreview-manifest.json'),
    evidencePath: resolve(SWEEP, 'crossreview-evidence.json'),
  });
  writeFileSync(resolve(SWEEP, 'crossreview-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  log(`cross-review settled: ${(receipt?.outcomes ?? []).map((o) => `${o.role}=${o.phase}`).join(' ')}`);
  log('XRT-DONE');
} finally {
  await baton.close().catch(() => {});
}
