// Blue-team wave for the KG settlement v2 suite — verify the v1 red-team's remediation matrix
// is actually repaired, THROUGH baton.recipes.run.
// Usage: node run-test-blueteam.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/kg-settlement-2026-08-01');
const log = (line) => console.log(`[bt ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'kg-settlement-test-blueteam-2026-08-01'),
    routes: [{ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

try {
  const receipt = await baton.recipes.run({
    name: 'kg-settlement-test-blueteam',
    version: '2.0',
    members: [{
      role: 'remediation-verifier',
      exact: { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
      scope: ['docs/reference/evidence/kg-settlement-2026-08-01/**'],
      objectiveTemplate: {
        task: [
          'BLUE-TEAM verify the KG settlement red-first suite v2 against the two red-team reports.',
          'Suite v2: impl/test/kg-settlement-red.test.mjs (current HEAD). Reports:',
          'docs/reference/evidence/kg-settlement-2026-08-01/test-redteam-falsegreen.md (codex,',
          'remediation matrix at the end) and test-redteam-coverage.md (deepseek, decision-point',
          'map). For EVERY row of both remediation matrices (codex P0/P1 items, deepseek C1-C12),',
          'verify against the v2 suite text whether the defect is REPAIRED, PARTIALLY repaired,',
          'or UNREPAIRED — quote the v2 line(s) that repair it or state exactly what is still',
          'missing. Be adversarial: a repair that renamed the assertion without changing its',
          'strength is UNREPAIRED. Also re-run the vacuousness hunt on the NEW rows (KS5 crash',
          'walk, KS7 partial states, KS3 spy rows, KS4 event-log diffs): can any wrong',
          'implementation still pass them? Close with: GATE-READY or GATE-NOT-READY + the',
          'blocking items. Ground every claim in file:line.',
        ].join(' '),
        constraints: [
          'Write the report skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
          'Work in ONE continuous turn to completion; the trust gate kills no-diff workers.',
          'Read-only review: do not edit impl/ files; your only write target is your report path.',
        ],
      },
      report: 'docs/reference/evidence/kg-settlement-2026-08-01/test-blueteam.md',
    }],
    policy: { steering: 'nudge-on-checkpoint', finalization: 'claim-on-stall' },
  }, {
    task: 'Blue-team verify the KG settlement v2 suite remediation',
    idempotencyKey: 'kg-settlement-test-blueteam-2026-08-01',
    manifestPath: resolve(EVIDENCE, 'test-blueteam-manifest.json'),
    evidencePath: resolve(EVIDENCE, 'test-blueteam-evidence.json'),
  });
  writeFileSync(resolve(EVIDENCE, 'test-blueteam-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  log(`blue-team settled: ${(receipt?.outcomes ?? []).map((o) => `${o.role}=${o.phase}`).join(' ')}`);
  log('BT-DONE');
} finally {
  await baton.close().catch(() => {});
}
