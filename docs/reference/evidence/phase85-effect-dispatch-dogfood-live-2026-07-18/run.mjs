import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const evidenceRepoPath = 'docs/reference/evidence/phase85-effect-dispatch-dogfood-live-2026-07-18';
const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-effect-dispatch-'));
mkdirSync(evidenceDir, { recursive: true });
const git = (args, options = {}) => execFileSync('/usr/bin/git', args, { cwd: repo, ...options });
const high = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const xhigh = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
const scope = Object.freeze([
  'impl/src/context-call.mjs',
  'impl/src/context-map.mjs',
  'impl/src/goal-plan.mjs',
  'impl/src/coordination-store.mjs',
  'impl/src/coordinator.mjs',
  'impl/src/application.mjs',
  'impl/src/application-semantics.mjs',
  'impl/src/application-client.mjs',
  'impl/src/index.mjs',
  'impl/test/phase85-context-effect-dispatch-red.test.mjs',
  'impl/test/phase85-context-effect-admission-red.test.mjs',
  'spec/phase85-context-lineage-recursive-synthesis.md',
]);
const outsideEvidenceStatus = () => git([
  'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.',
  `:(exclude)${evidenceRepoPath}`,
]);
const callerBefore = Object.freeze({
  status: outsideEvidenceStatus(),
  indexTree: git(['write-tree']),
});
let baton; let workflow; let failure = null; let record = null;
try {
  baton = await openBaton({
    repo,
    advanced: {
      deploymentRoot,
      verification: {
        command: 'node', arguments: [
          '--test', 'impl/test/phase85-context-effect-dispatch-red.test.mjs',
          'impl/test/phase85-context-effect-admission-red.test.mjs',
          'impl/test/phase85-context-call-envelope-red.test.mjs',
        ],
      },
    },
  });
  const readiness = await baton.doctor();
  const team = [
    { role: 'effect-dispatch-builder', exact: high },
    { role: 'effect-dispatch-adversary', exact: xhigh },
  ];
  workflow = await baton.workflow([
    'Implement the next bounded Phase 85 gate on the current effective tree: one generic Context',
    'reduce proposal and provider-dispatch path using the sole schema-v2 context.call_admitted',
    'authority that already exists. Add the concise immutable client/application action',
    'context_reduce {callId, instruction, role?}. It must derive only from a fully reverified',
    'completed call-evidence-v3 source, use the preserved Workflow v3 catalog and exact',
    'harness/model/effort route, admit and prebind one context_effect_child unit, then propose the',
    'same successor Plan. Admission/proposal must perform zero provider effects and survive restart',
    'idempotently. A separate existing Plan approval may dispatch exactly one provider Attempt whose',
    'Brief contains only the immutable verified reduce input/capsule refs and exact lineage—not raw',
    'caller data or map-only partition assumptions. Generic plan_pending calls must reconcile through',
    'their own discriminator; historical map schema-v1 replay and map reconciliation remain stable.',
    'Stop/reap must cover the generic Attempt. This slice stops before generic result settlement,',
    'failure settlement, retry generations, deeper recursion, transport-specific APIs, or another',
    'ledger. Add focused red/green tests, run the three focused files, do not spawn subagents, and',
    'finish with code. Prefer a small discriminated generalization over copying map machinery.',
  ].join(' '), { scope, team });
  await workflow.complete();
  const candidates = (await workflow.candidates()).section.items.map(({ value }) => value);
  const patches = candidates.map((candidate) => {
    const body = git([
      'diff-tree', '--no-commit-id', '--binary', '-p', `${candidate.resultSha}^`, candidate.resultSha,
    ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const name = `rerun-candidate-${candidate.role}.patch`;
    writeFileSync(join(evidenceDir, name), body);
    return {
      role: candidate.role, candidateId: candidate.candidateId,
      resultSha: candidate.resultSha, retainedResultRef: candidate.retainedResultRef,
      changedPaths: candidate.changedPaths,
      patch: {
        name, digest: createHash('sha256').update(body).digest('hex'),
        bytes: Buffer.byteLength(body),
      },
    };
  });
  record = {
    schemaVersion: 1, deploymentRoot, runId: workflow.id,
    readiness: readiness.routes.map(({ harness, model, effort, state, code = null }) => ({
      harness, model, effort, state, code,
    })),
    selectedTeam: team, candidates,
  };
} catch (error) {
  failure = error;
  record = {
    schemaVersion: 1, deploymentRoot, runId: workflow?.id ?? null,
    error: { name: error.name, code: error.code ?? null, message: error.message },
  };
} finally {
  let stopped = null; let closed = null;
  if (workflow) {
    try {
      await workflow.stop('Retain dispatch Candidates and reap every exact descendant.');
      const status = await workflow.status();
      stopped = { stop: status.stop, ownership: status.ownership };
      if (status.stop?.receipt?.remainingCount !== 0 || status.ownership?.workers !== 0) {
        failure ??= new Error('Phase 85 effect-dispatch stop proof is incomplete');
      }
    } catch (error) { failure ??= error; }
  }
  if (baton) {
    try { closed = (await baton.close()).ownership; }
    catch (error) { failure ??= error; }
  }
  const callerAfter = {
    status: outsideEvidenceStatus(),
    indexTree: git(['write-tree']),
  };
  const cleanup = {
    stopped, closed,
    callerStatusUnchanged: callerBefore.status.equals(callerAfter.status),
    callerIndexUnchanged: callerBefore.indexTree.equals(callerAfter.indexTree),
  };
  writeFileSync(join(evidenceDir, 'evidence-rerun.json'),
    `${JSON.stringify({ record, cleanup }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ record, cleanup })}\n`);
  if (closed?.closed === true && closed?.workers === 0) {
    rmSync(deploymentRoot, { recursive: true, force: true });
  }
  if (!cleanup.callerStatusUnchanged || !cleanup.callerIndexUnchanged) {
    failure ??= new Error('Phase 85 effect-dispatch caller-isolation proof failed');
  }
}
if (failure) throw failure;
