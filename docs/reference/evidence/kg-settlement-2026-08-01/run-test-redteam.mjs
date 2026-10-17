// Red-team wave for the KG settlement red-first suite — two adversarial reviewers against the
// contract + the tests, THROUGH baton.recipes.run.
// Usage: node run-test-redteam.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/kg-settlement-2026-08-01');
const log = (line) => console.log(`[trt ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'kg-settlement-test-redteam-2026-08-01'),
    routes: [
      { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
      { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
    ],
    verification: Object.freeze({ command: 'node', arguments: ['--test', 'impl/test/kg-settlement-red.test.mjs'] }),
  },
});

try {
  const receipt = await baton.recipes.run({
    name: 'kg-settlement-test-redteam',
    version: '1.0',
    members: [
      {
        role: 'false-green-hunter',
        exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
        scope: ['docs/reference/evidence/kg-settlement-2026-08-01/**'],
        objectiveTemplate: {
          task: [
            'Adversarially red-team the KG settlement RED-FIRST TEST SUITE (false-green angle).',
            'Suite: impl/test/kg-settlement-red.test.mjs. Contract: docs/reference/evidence/',
            'kg-settlement-2026-08-01/kg-settlement-decisions.md (v1.0). Ground every claim in',
            'file:line. Hunt: (1) rows that PASS with a WRONG implementation (vacuous or',
            'under-specified assertions — e.g. KS3 only checks the error code is not',
            'application_command_unavailable: what wrong implementations still satisfy it?).',
            '(2) Fixture-authority bugs: does settlementFixture prove anything the implementation',
            'could fake (the lease/candidate are hand-built — could an implementation pass the',
            'rows without the real wiring)? (3) KS5 re-drive: does the second ritualWave call',
            'actually exercise a second hook pass, or does it dedup upstream and prove nothing?',
            '(4) KS7: does the row distinguish the command doing the teardown from the test',
            'doing it? (5) Any row whose red-failure today is for a DIFFERENT reason than the',
            'contract gap it names (staged-red contamination). For each: VERDICT',
            'VACUOUS / STAGED-RED / SOUND + the concrete fix (assertion, fixture, or row).',
          ].join(' '),
          constraints: [
            'Write the report skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
            'Work in ONE continuous turn to completion; the trust gate kills no-diff workers.',
            'Read-only review: do not edit impl/ files; your only write target is your report path.',
          ],
        },
        report: 'docs/reference/evidence/kg-settlement-2026-08-01/test-redteam-falsegreen.md',
      },
      {
        role: 'coverage-mapper',
        exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
        scope: ['docs/reference/evidence/kg-settlement-2026-08-01/**'],
        objectiveTemplate: {
          task: [
            'Adversarially red-team the KG settlement RED-FIRST TEST SUITE (coverage angle).',
            'Suite: impl/test/kg-settlement-red.test.mjs. Contract: docs/reference/evidence/',
            'kg-settlement-2026-08-01/kg-settlement-decisions.md (v1.0) + the two red-team',
            'reports (redteam-authority.md, redteam-lifecycle.md). Map EVERY v1.0 decision',
            'point (D1 closed shape + hub-fixed objective + waveId-pinned ids + replay; D2 four',
            'commands + session-derived lease + XB enforcement + resumable teardown +',
            'liveMethod fix + structural embedded-only gate; D3 sweep + store-status gating +',
            'full-text detail + pinned keys + no-settle-at-close + receipt surfacing +',
            'honest-empty + default-on; D4 note+plan vs doubt+link lanes; D5 non-goals) to the',
            'row(s) covering it. List every decision point with NO row or a row too weak to',
            'fail under a partial implementation. Also: refusal-code precision (are the exact',
            'codes from _activeRunOrchestratorLease :1670-1690 asserted?), and the acceptance',
            'criteria in the contract — is each one testable as written? Verdict per gap:',
            'MISSING-ROW / WEAK-ROW / COVERED + the row text to add.',
          ].join(' '),
          constraints: [
            'Write the report skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
            'Work in ONE continuous turn to completion; the trust gate kills no-diff workers.',
            'Read-only review: do not edit impl/ files; your only write target is your report path.',
          ],
        },
        report: 'docs/reference/evidence/kg-settlement-2026-08-01/test-redteam-coverage.md',
      },
    ],
    policy: { steering: 'nudge-on-checkpoint', finalization: 'claim-on-stall' },
  }, {
    task: 'Red-team the KG settlement red-first test suite',
    idempotencyKey: 'kg-settlement-test-redteam-2026-08-01',
    manifestPath: resolve(EVIDENCE, 'test-redteam-manifest.json'),
    evidencePath: resolve(EVIDENCE, 'test-redteam-evidence.json'),
  });
  writeFileSync(resolve(EVIDENCE, 'test-redteam-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  log(`test red-team settled: ${(receipt?.outcomes ?? []).map((o) => `${o.role}=${o.phase}`).join(' ')}`);
  log('TRT-DONE');
} finally {
  await baton.close().catch(() => {});
}
