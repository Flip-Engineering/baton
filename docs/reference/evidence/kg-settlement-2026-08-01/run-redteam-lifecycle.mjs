// Re-drive of the lifecycle red-team member (deepseek stream-death, skeleton-only report) —
// glm-5.2 seat, same brief, THROUGH baton.recipes.run.
// Usage: node run-redteam-lifecycle.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/kg-settlement-2026-08-01');
const log = (line) => console.log(`[rt-lc ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'kg-settlement-redteam-lc-2026-08-01'),
    routes: [{ harness: 'glm', model: 'glm-5.2', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

try {
  const receipt = await baton.recipes.run({
    name: 'kg-settlement-contract-redteam-lifecycle',
    version: '0.9',
    members: [{
      role: 'lifecycle-attacker',
      exact: { harness: 'glm', model: 'glm-5.2', effort: 'high' },
      scope: ['docs/reference/evidence/kg-settlement-2026-08-01/**'],
      objectiveTemplate: {
        task: [
          'Adversarially red-team the KG settlement contract v0.9 (LIFECYCLE + ORDERING angle).',
          'Ground every claim in file:line. Anchors: coordination-store.mjs createTask :12103,',
          'createAndClaimRecoveryRefinement :12128, elevateTaskScratchpad :13181,',
          'settleWorkflowScratchpad :13330, issueRunOrchestratorLease :1770, _assertRunAdmissionOpen',
          ':7234, admitWorkflowFinding :14539, board candidacy :13717; coordinator.mjs wrappers',
          ':9700/:9727/:9831; wave-driver.mjs settle window :660-680; run-lineage.mjs TTL :22-28.',
          'Contract: docs/reference/evidence/kg-settlement-2026-08-01/kg-settlement-decisions.md.',
          'Gap receipts: docs/reference/evidence/kg-tiered-loop-2026-08-01/kg-loop-verdict.md.',
          'Attack: (1) Can a member be claimed-terminal while its scratchpad partition still has',
          'pending writes (paused at a checkpoint)? Trace wave-driver.mjs:660-680 vs turn.paused.',
          '(2) The settlement task stays working after driver exit — what reaps it if promote never',
          'comes? Lease TTL 30min — lingering task/lease rows acceptable? (3) Default-on ledger',
          'growth per wave: compute the worst case with MAX_SCRATCHPAD_SHARED_ENTRIES (grep it).',
          '(4) D4 skips plan+link — issue #59 wants re-drive continuity from dead attempts: does',
          'skipping plan destroy that? (5) Crash mid-hook: walk a crash between steps 2-3 and',
          'between lease and board post — do waveId/runId keys make re-drive exactly-once?',
          '(6) Doubts elevate but never candidate — silent knowledge sink?',
          'Verdict each: CONFIRMED-HOLE / DEFENDED / NEEDS-AMENDMENT + amendment text.',
        ].join(' '),
        constraints: [
          'Write the report skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
          'Work in ONE continuous turn to completion; the trust gate kills no-diff workers.',
          'Read-only review: do not edit impl/ files; your only write target is your report path.',
          'Name the report redteam-lifecycle.md (overwrite any skeleton).',
        ],
      },
      report: 'docs/reference/evidence/kg-settlement-2026-08-01/redteam-lifecycle.md',
    }],
    policy: { steering: 'nudge-on-checkpoint', finalization: 'claim-on-stall' },
  }, {
    task: 'Red-team the KG settlement contract v0.9 lifecycle angle',
    idempotencyKey: 'kg-settlement-redteam-lc-2026-08-01',
    manifestPath: resolve(EVIDENCE, 'redteam-lc-manifest.json'),
    evidencePath: resolve(EVIDENCE, 'redteam-lc-evidence.json'),
  });
  writeFileSync(resolve(EVIDENCE, 'redteam-lc-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  log(`lifecycle red-team settled: ${(receipt?.outcomes ?? []).map((o) => `${o.role}=${o.phase}`).join(' ')}`);
  log('RT-LC-DONE');
} finally {
  await baton.close().catch(() => {});
}
