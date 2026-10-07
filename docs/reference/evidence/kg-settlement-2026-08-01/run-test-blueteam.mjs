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
    name: 'kg-settlement-test-blueteam-v2',
    version: '2.1',
    members: [{
      role: 'remediation-verifier',
      exact: { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
      scope: ['docs/reference/evidence/kg-settlement-2026-08-01/**'],
      objectiveTemplate: {
        task: [
          'BLUE-TEAM RE-VERIFY the KG settlement suite v2.1 against your own GATE-NOT-READY report.',
          'Prior report: docs/reference/evidence/kg-settlement-2026-08-01/test-blueteam.md (its',
          'blocking items: FG-10 unsatisfiable control assertion, KS7 missing admit+revoke-done',
          'partial state, FG-8/C9 missing link kind + not-ready row, KS5 vacuousness, C3 return',
          'shape + command→promote end-to-end, C7 errors shape + outline surfacing, FG-9/C8',
          'recursive-gate dynamic half, C1 mislabeled stale block, C6 one-sided title bound,',
          'FG-3 weak spy rows, FG-1 hand-derived lease identity in KS6/KS7). Suite v2.1:',
          'impl/test/kg-settlement-red.test.mjs at HEAD. For EACH blocking item: verify REPAIRED',
          'or still-BLOCKING with the v2.1 line(s). Then re-run the vacuousness hunt on the NEW',
          'assertions (KS5 replay-discipline, KS9b, the KS3 normalized-args rows): can a wrong',
          'implementation still pass? Close with GATE-READY or GATE-NOT-READY + blocking items.',
          'Ground every claim in file:line.',
        ].join(' '),
        constraints: [
          'Write the report skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
          'Work in ONE continuous turn to completion; the trust gate kills no-diff workers.',
          'Read-only review: do not edit impl/ files; your only write target is your report path.',
          'Name the report test-blueteam-v2.md.',
        ],
      },
      report: 'docs/reference/evidence/kg-settlement-2026-08-01/test-blueteam-v2.md',
    }],
    policy: { steering: 'nudge-on-checkpoint', finalization: 'claim-on-stall' },
  }, {
    task: 'Blue-team re-verify the KG settlement v2.1 suite remediation',
    idempotencyKey: 'kg-settlement-test-blueteam-v2-2026-08-01',
    manifestPath: resolve(EVIDENCE, 'test-blueteam-v2-manifest.json'),
    evidencePath: resolve(EVIDENCE, 'test-blueteam-v2-evidence.json'),
  });
  writeFileSync(resolve(EVIDENCE, 'test-blueteam-v2-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  log(`blue-team settled: ${(receipt?.outcomes ?? []).map((o) => `${o.role}=${o.phase}`).join(' ')}`);
  log('BT-DONE');
} finally {
  await baton.close().catch(() => {});
}
