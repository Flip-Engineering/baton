import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const evidenceRepoPath = 'docs/reference/evidence/phase85-role-catalog-dogfood-live-2026-07-18';
const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-role-catalog-'));
const controller = new AbortController();
const interrupt = () => controller.abort();
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

const codex = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const codexDeep = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
const scope = Object.freeze([
  'impl/src/application.mjs',
  'impl/src/coordination-store.mjs',
  'impl/src/context-runtime.mjs',
  'impl/src/workflow-definition.mjs',
  'impl/src/index.mjs',
  'impl/test/phase84-context-map-wave-red.test.mjs',
  'impl/test/phase85-context-role-catalog-red.test.mjs',
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
      deploymentRoot,
      routes: [codex, codexDeep],
      verification: {
        command: 'node',
        arguments: [
          '--test', '--test-name-pattern', '^CM84-W1:',
          'impl/test/phase84-context-map-wave-red.test.mjs',
        ],
      },
    },
  });
  const readiness = await baton.doctor();
  const team = [
    { role: 'role-catalog-builder', exact: codex },
    { role: 'role-catalog-adversary', exact: codexDeep },
  ];
  workflow = await baton.workflow([
    'Implement the bounded Phase 85 durable root role-catalog slice in Baton.',
    'The exact CM84-W1 test is intentionally red at Workflow definition schema v2.',
    'Introduce a closed content-addressed Workflow definition v3 that separates one immutable',
    'semantic roleCatalog from the generation-specific Attempt set. Canonicalize catalog roles;',
    'each role binds exact harness/model/effort plus a nodeTemplate containing definitionOfDone,',
    'pathScope, contextScope, risk, verification, capabilities, effects, requiredEffects, and',
    'workerPolicy. Exclude successor-specific key, objective, deps, budget, revision, and Context',
    'binding. Root lineage is generation 1 with null root/parent digests. A map successor retains',
    'the exact catalog, sets generation 2 with both root and parent bound to the root definition',
    'digest, and each synthetic Attempt names logicalRole plus the matching template digest.',
    'Keep schema v1/v2 historical definitions replay-readable but never infer a missing semantic',
    'role for a new recursive successor. Validate closed shapes, exact template instantiation,',
    'route equality, non-cyclic ancestry, Plan coverage, and digest substitution before provider',
    'effect. Do not weaken existing revision or Context authority. Work only in allowed scope, run',
    'the focused test, do not spawn subagents, and finish with code.',
  ].join(' '), { scope, team });

  await workflow.complete({ signal: controller.signal });
  const candidates = (await workflow.candidates()).section.items.map(({ value }) => value);
  const patches = candidates.map((candidate) => {
    const body = git([
      'diff-tree', '--no-commit-id', '--binary', '-p', `${candidate.resultSha}^`, candidate.resultSha,
    ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const name = `candidate-${candidate.role}.patch`;
    writeFileSync(join(evidenceDir, name), body);
    return {
      role: candidate.role,
      route: team.find((member) => member.role === candidate.role)?.exact ?? null,
      candidateId: candidate.candidateId,
      resultSha: candidate.resultSha,
      retainedResultRef: candidate.retainedResultRef,
      changedPaths: candidate.changedPaths,
      patch: {
        name,
        digest: createHash('sha256').update(body).digest('hex'),
        bytes: Buffer.byteLength(body),
      },
    };
  });
  const status = await workflow.status();
  record = {
    schemaVersion: 1,
    deploymentRoot,
    runId: workflow.id,
    outcome: controller.signal.aborted ? 'operator_interrupted' : 'selection_required',
    readiness: readiness.routes.map(({ harness, model, effort, state, code = null }) => ({
      harness, model, effort, state, code,
    })),
    selectedTeam: team,
    phase: status.phase,
    candidates: patches,
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
      await workflow.stop('Retain role-catalog Candidates, then stop and reap every descendant.');
      const status = await workflow.status();
      stopped = {
        state: status.stop?.state ?? null, receipt: status.stop?.receipt ?? null,
        ownership: status.ownership,
      };
      if (stopped.state !== 'stopped'
        || ![1, 3].includes(stopped.receipt?.schemaVersion)
        || stopped.receipt?.remainingCount !== 0
        || stopped.receipt?.counts?.processesObserved !== stopped.receipt?.counts?.processesClosed
        || status.ownership?.workers !== 0) {
        failure ??= new Error('Phase 85 role-catalog Run-stop proof is incomplete');
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
  if (!cleanup.callerStatusUnchanged || !cleanup.callerIndexUnchanged
    || (cleanup.closed && (cleanup.closed.closed !== true || cleanup.closed.workers !== 0))) {
    failure ??= new Error('Phase 85 role-catalog caller-isolation proof failed');
  }
}

if (failure) throw failure;
