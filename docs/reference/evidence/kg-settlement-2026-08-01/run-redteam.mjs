// Red-team wave for the KG settlement contract v0.9 — two adversarial reviewers against the
// codebase, THROUGH baton.recipes.run (data recipe, no bespoke driver).
// Usage: node run-redteam.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/kg-settlement-2026-08-01');
const log = (line) => console.log(`[rt ${new Date().toISOString()}] ${line}`);

const ANCHORS = [
  'Ground every claim in file:line. Anchors: coordination-store.mjs createTask :12103,',
  'createAndClaimRecoveryRefinement :12128, elevateTaskScratchpad :13181, settleWorkflowScratchpad',
  ':13330, issueRunOrchestratorLease :1770, _assertRunAdmissionOpen :7234, admitWorkflowFinding',
  ':14539, board candidacy :13717; coordinator.mjs wrappers :9700/:9727/:9831; application.mjs',
  'dispatch :11767; application-semantics.mjs S-3 rows :1436-1510; wave-driver.mjs settle window',
  ':660-680. Contract: docs/reference/evidence/kg-settlement-2026-08-01/kg-settlement-decisions.md.',
  'Gap receipts: docs/reference/evidence/kg-tiered-loop-2026-08-01/kg-loop-verdict.md.',
].join(' ');

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'kg-settlement-redteam-2026-08-01-b'),
    routes: [
      { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
      { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
    ],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

try {
  const receipt = await baton.recipes.run({
    name: 'kg-settlement-contract-redteam',
    version: '0.9',
    members: [
      {
        role: 'authority-attacker',
        exact: { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
        scope: ['docs/reference/evidence/kg-settlement-2026-08-01/**'],
        objectiveTemplate: {
          task: [
            'Adversarially red-team the KG settlement contract v0.9 (AUTHORITY + INJECTION angle).',
            ANCHORS,
            'Attack: (1) D1 bypasses plan-mandatory — weaker than the recovery-refinement precedent?',
            '(2) knowledge.settlement_lease returns {id, digest, issuedEvent} — is the digest an',
            'admission secret leaking to any embedded caller? Compare run.stop/run.answer trust tier.',
            '(3) Injection: board titles derive from worker note text (120B) — can a worker smuggle',
            'orchestrator-directed prose into candidacy? Is the hub-fixed ≤512B objective enough?',
            '(4) knowledge.promote auto-revokes lease + completes the task — what breaks on partial',
            'failure between admit and revoke? (5) Crash-retry idempotency: can a retried hook',
            'double-mint leases/items/elevations? (6) Find ≥1 authority hole the contract missed.',
            'Verdict each: CONFIRMED-HOLE / DEFENDED / NEEDS-AMENDMENT + amendment text.',
          ].join(' '),
          constraints: [
            'Write the report skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
            'Work in ONE continuous turn to completion; the trust gate kills no-diff workers.',
            'Read-only review: do not edit impl/ files; your only write target is your report path.',
          ],
        },
        report: 'docs/reference/evidence/kg-settlement-2026-08-01/redteam-authority.md',
      },
      {
        role: 'lifecycle-attacker',
        exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
        scope: ['docs/reference/evidence/kg-settlement-2026-08-01/**'],
        objectiveTemplate: {
          task: [
            'Adversarially red-team the KG settlement contract v0.9 (LIFECYCLE + ORDERING angle).',
            ANCHORS,
            'Attack: (1) Can a member be claimed-terminal while its scratchpad partition still has',
            'pending writes (paused at a checkpoint)? Trace wave-driver.mjs:660-680 vs turn.paused.',
            '(2) The settlement task stays working after driver exit — what reaps it if promote never',
            'comes? Lease TTL 30min (run-lineage.mjs:22-28) — lingering task/lease rows acceptable?',
            '(3) Default-on ledger growth per wave: compute the worst case with',
            'MAX_SCRATCHPAD_SHARED_ENTRIES. (4) D4 skips plan+link — issue #59 wants re-drive',
            'continuity from dead attempts: does skipping plan destroy that? (5) Crash mid-hook:',
            'walk a crash between steps 2-3 and between lease and board post — do waveId/runId keys',
            'make re-drive exactly-once? (6) Doubts elevate but never candidate — silent sink?',
            'Verdict each: CONFIRMED-HOLE / DEFENDED / NEEDS-AMENDMENT + amendment text.',
          ].join(' '),
          constraints: [
            'Write the report skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
            'Work in ONE continuous turn to completion; the trust gate kills no-diff workers.',
            'Read-only review: do not edit impl/ files; your only write target is your report path.',
          ],
        },
        report: 'docs/reference/evidence/kg-settlement-2026-08-01/redteam-lifecycle.md',
      },
    ],
    policy: { steering: 'nudge-on-checkpoint', finalization: 'claim-on-stall' },
  }, {
    task: 'Red-team the KG settlement contract v0.9 against the codebase',
    idempotencyKey: 'kg-settlement-redteam-2026-08-01',
    manifestPath: resolve(EVIDENCE, 'redteam-manifest.json'),
    evidencePath: resolve(EVIDENCE, 'redteam-evidence.json'),
  });
  writeFileSync(resolve(EVIDENCE, 'redteam-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  const outcomes = (receipt?.outcomes ?? []).map((o) => `${o.role}=${o.phase}`).join(' ');
  log(`red-team settled: ${outcomes}`);
  log('RT-DONE');
} finally {
  await baton.close().catch(() => {});
}
