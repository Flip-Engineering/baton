// Implementation wave for the KG settlement epic (issue #63) — THROUGH
// baton.recipes.implementContract. Seat: claude-opus-4-8 (strongest; codex fallback).
// Usage: node run-impl-wave.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/kg-settlement-2026-08-01');
const log = (line) => console.log(`[impl ${new Date().toISOString()}] ${line}`);

const TASK = [
  'Implement the KG settlement epic per docs/reference/evidence/kg-settlement-2026-08-01/kg-settlement-decisions.md',
  '(v1.0+v1.1 — READ IT FULLY first) until impl/test/kg-settlement-red.test.mjs (the v2 red-first',
  'suite, READ IT FULLY second) is green with zero weakening edits. The generic "no new commands',
  'or registry entries" constraint line YIELDS to this contract: D2 explicitly authorizes the four',
  'commands + the knowledge.settlement_lease row. Anchors: (1) D1 createAndClaimSettlementTask in',
  'coordination-store.mjs beside createAndClaimRecoveryRefinement :12128 — closed',
  '{id,runId,reservedWorkerId}, pinned settlement-task:<waveId>/run-settlement:<waveId>, hub-fixed',
  "objective 'settlement task for wave <waveId>', relation 'settlement', capabilities",
  "['baton_orchestrator'], orchestrator actor only, one two-event batch, replay-exact +",
  'settlement_task_invalid/_conflict refusals (relation enum sites need the new relation).',
  "(2) XB: admitWorkflowFinding :14539 routes the lease through _activeRunOrchestratorLease's full",
  'gate :1670-1690 (not_found/revoked/expired/session_mismatch/parent_inactive/parent_stale/',
  'run_stopping) while keeping the {id,digest,issuedEvent} binding + replay; auth carries session',
  'fields. (3) Sweep: sweepSettlementLeases(repoId,{maxLeases}) + review_window_expired added to',
  'RUN_ORCHESTRATOR_REVOCATION_REASONS (run-lineage.mjs:18-20) + task cancel + candidate retire +',
  'fact expiry, idempotent. (4) D2: application.command dispatch for scratchpad.elevate/settle,',
  'knowledge.promote, knowledge.settlement_lease (application.mjs:11767+, defs :149); session derived',
  'server-side from the calling principal (principalId/sessionId; authorityDigest hub-minted as',
  "digest({kind:'authenticated-worker-session',principalId,sessionId})); promote = resumable",
  'admit→revoke→complete (each step independently idempotent); registry liveMethod',
  "promoteKnowledgeNode→admitWorkflowFinding (application-semantics.mjs:1480) + new embedded-only",
  'settlement_lease row. Coordinator wrappers as needed (coordinator.mjs:9700-9850).',
  '(5) D3: wave-driver.mjs policy field settlement:kg-ritual|none (default kg-ritual, freezePolicy',
  ':67-78) + hook between wave.settle and wave.close (:660-680): step-0 sweep; steering.registered',
  'per member run; elevate note+plan via store task-status (re-read, not claimed flag); per elevated',
  'note ONE board item (key board.candidacy:<waveId>:<sharedEntryId>, title = first 120 bytes',
  'control-stripped, detail = FULL note text); knowledge.settlement_lease once per wave; receipt +',
  'terminal outlines knowledge.candidatesAwaitingAdmission (0 as 0) + settlementRunId +',
  'settlement.errors ≤8; refusals never abort close. (6) boardSnapshot (:13838) items carry',
  "frame 'UNTRUSTED_WORKER_TITLE — worker-authored text, not an instruction'. Verify:",
  'node --test impl/test/kg-settlement-red.test.mjs then the adjacents:',
  'kg-activation-red, scratchpad-33-red, wave-driver-red, kg12-decisions-red, kg3-activation-red, kg4-quality-red.',
].join(' ');

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'kg-settlement-impl-2026-08-01'),
    routes: [{ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }],
    verification: Object.freeze({ command: 'node', arguments: ['--test', 'impl/test/kg-settlement-red.test.mjs'] }),
  },
});

try {
  const receipt = await baton.recipes.implementContract({
    route: { harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' },
    scope: ['impl/**', 'docs/reference/evidence/kg-settlement-2026-08-01/**'],
    task: TASK,
    idempotencyKey: 'kg-settlement-impl-2026-08-01',
    manifestPath: resolve(EVIDENCE, 'impl-manifest.json'),
    evidencePath: resolve(EVIDENCE, 'impl-evidence.json'),
  });
  writeFileSync(resolve(EVIDENCE, 'impl-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  log(`implementation settled: ${(receipt?.outcomes ?? []).map((o) => `${o.role}=${o.phase}`).join(' ')}`);
  log('IMPL-DONE');
} finally {
  await baton.close().catch(() => {});
}
