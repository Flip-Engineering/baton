import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const evidenceRepoPath = 'docs/reference/evidence/phase85-effect-admission-dogfood-live-2026-07-18';
mkdirSync(evidenceDir, { recursive: true });
const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-effect-admission-'));
const controller = new AbortController();
const interrupt = () => controller.abort();
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

const high = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const xhigh = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
const scope = Object.freeze([
  'impl/src/context-call.mjs',
  'impl/src/goal-plan.mjs',
  'impl/src/coordination-store.mjs',
  'impl/src/coordinator.mjs',
  'impl/src/application.mjs',
  'impl/src/index.mjs',
  'impl/test/phase85-context-effect-admission-red.test.mjs',
  'impl/test/phase85-context-call-envelope-red.test.mjs',
  'spec/phase85-context-lineage-recursive-synthesis.md',
]);
const git = (args, options = {}) => execFileSync('/usr/bin/git', args, { cwd: repo, ...options });
const outsideEvidenceStatus = () => git([
  'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.',
  `:(exclude)${evidenceRepoPath}`,
]);
for (const name of readdirSync(evidenceDir)) {
  if (/^candidate-[a-z0-9-]+\.patch$/u.test(name)) rmSync(join(evidenceDir, name), { force: true });
}
const callerBefore = Object.freeze({ status: outsideEvidenceStatus(), indexTree: git(['write-tree']) });

let baton = null;
let workflow = null;
let record = null;
let failure = null;

try {
  baton = await openBaton({
    repo,
    advanced: {
      deploymentRoot, routes: [high, xhigh],
      verification: {
        command: 'node', arguments: [
          '--test', 'impl/test/phase85-context-effect-admission-red.test.mjs',
          'impl/test/phase85-context-call-envelope-red.test.mjs',
        ],
      },
    },
  });
  const readiness = await baton.doctor();
  const team = [
    { role: 'effect-admission-builder', exact: high },
    { role: 'effect-admission-adversary', exact: xhigh },
  ];
  workflow = await baton.workflow([
    'Implement the next bounded Phase 85 gate: sole-authority durable generic Context effect-call',
    'admission, with focused red tests. Preserve context.call_admitted as the only event/store',
    'authority: historical Phase 84 map admission payload schema v1 must replay unchanged; a new',
    'schema v2 payload admits one normalized baton.context_effect_call generation 1. Do not dual-write',
    'a map event or create another call ledger. Use the existing discriminated contextCall Plan-node',
    'field and exact context_effect_child binding. Reverify service plus requester authority, current',
    'predecessor Plan, Workflow definition v3 role catalog/template/route, source identity, exact unit',
    'coverage, Plan digest, idempotency, replay, and stop fencing. Map sources require completed v2',
    'cells; reduce sources require contextCompletedCallSource from a fully reverified successful',
    'call-evidence v3 settlement. Historical completed v2 and failed/nonterminal/cross-Run/stale',
    'sources fail typed before append. Store generic and legacy calls in the same projection and make',
    'map-specific reconciliation ignore generic calls safely. This slice stops after durable admission',
    'and Plan prebinding: no reduce dispatch, provider effect, generic settlement, retry, transport',
    'surface, caller budgets, or second orchestration API. Work only in scope, add the focused test,',
    'run both focused tests, do not spawn subagents, and finish with code.',
  ].join(' '), { scope, team });

  await workflow.complete({ signal: controller.signal });
  const candidates = (await workflow.candidates()).section.items.map(({ value }) => value);
  const patches = candidates.map((candidate) => {
    const body = git([
      'diff-tree', '--no-commit-id', '--binary', '-p', `${candidate.resultSha}^`, candidate.resultSha,
    ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const name = `candidate-${candidate.role}.patch`;
    writeFileSync(join(evidenceDir, name), body);
    return {
      role: candidate.role,
      route: team.find((member) => member.role === candidate.role)?.exact ?? null,
      candidateId: candidate.candidateId, resultSha: candidate.resultSha,
      retainedResultRef: candidate.retainedResultRef, changedPaths: candidate.changedPaths,
      patch: {
        name, digest: createHash('sha256').update(body).digest('hex'),
        bytes: Buffer.byteLength(body),
      },
    };
  });
  const status = await workflow.status();
  record = {
    schemaVersion: 1, deploymentRoot, runId: workflow.id,
    outcome: controller.signal.aborted ? 'operator_interrupted' : 'selection_required',
    readiness: readiness.routes.map(({ harness, model, effort, state, code = null }) => ({
      harness, model, effort, state, code,
    })),
    selectedTeam: team, phase: status.phase, candidates: patches,
    attempts: status.attempts.map(({ role, state, route, taskId, candidateId }) => ({
      role, state, route, taskId, candidateId,
    })),
  };
} catch (error) {
  failure = error;
  record = {
    schemaVersion: 1, deploymentRoot, runId: workflow?.id ?? null, outcome: 'failed',
    error: { name: error.name, code: error.code ?? null, message: error.message },
  };
} finally {
  let stopped = null;
  let closed = null;
  if (workflow) {
    try {
      await workflow.stop('Retain effect-admission Candidates, then stop and reap every descendant.');
      const status = await workflow.status();
      stopped = {
        state: status.stop?.state ?? null, receipt: status.stop?.receipt ?? null,
        ownership: status.ownership,
      };
      if (stopped.state !== 'stopped' || stopped.receipt?.remainingCount !== 0
        || stopped.receipt?.counts?.processesObserved !== stopped.receipt?.counts?.processesClosed
        || status.ownership?.workers !== 0) {
        failure ??= new Error('Phase 85 effect-admission Run-stop proof is incomplete');
      }
    } catch (error) { failure ??= error; }
  }
  if (baton) {
    try { closed = (await baton.close()).ownership; }
    catch (error) { failure ??= error; }
  }
  const callerAfter = { status: outsideEvidenceStatus(), indexTree: git(['write-tree']) };
  const cleanup = {
    stopped, closed,
    callerStatusUnchanged: callerBefore.status.equals(callerAfter.status),
    callerIndexUnchanged: callerBefore.indexTree.equals(callerAfter.indexTree),
  };
  writeFileSync(join(evidenceDir, 'evidence.json'), `${JSON.stringify({ record, cleanup }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ record, cleanup })}\n`);
  if (closed?.closed === true && closed?.workers === 0) {
    rmSync(deploymentRoot, { recursive: true, force: true });
  }
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  if (!cleanup.callerStatusUnchanged || !cleanup.callerIndexUnchanged) {
    failure ??= new Error('Phase 85 effect-admission caller-isolation proof failed');
  }
}

if (failure) throw failure;
