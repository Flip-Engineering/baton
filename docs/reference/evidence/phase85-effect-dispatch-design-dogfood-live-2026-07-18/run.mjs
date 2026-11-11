import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const evidenceRepoPath = 'docs/reference/evidence/phase85-effect-dispatch-design-dogfood-live-2026-07-18';
const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-effect-dispatch-design-'));
mkdirSync(evidenceDir, { recursive: true });
const git = (args, options = {}) => execFileSync('/usr/bin/git', args, { cwd: repo, ...options });
const codex = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
const glm = Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' });
const outsideEvidenceStatus = () => git([
  'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.',
  `:(exclude)${evidenceRepoPath}`,
]);
const callerBefore = Object.freeze({ status: outsideEvidenceStatus(), indexTree: git(['write-tree']) });
const workerActivity = () => {
  const state = join(deploymentRoot, 'state');
  return readdirSync(state).filter((name) => (
    name.startsWith('w-wave-') && name.endsWith('.jsonl')
  )).map((name) => {
    const rows = readFileSync(join(state, name), 'utf8').trim().split('\n')
      .filter(Boolean).map((line) => JSON.parse(line));
    return {
      workerLog: name, eventCount: rows.length,
      toolEvents: rows.filter((row) => row.kind === 'content.tool_call').length,
      editEvents: rows.filter((row) => row.kind === 'content.file_edit').length,
      editedPaths: [...new Set(rows.filter((row) => row.kind === 'content.file_edit')
        .flatMap((row) => row.payload?.paths ?? [])
        .map((path) => path.split('/.baton/wt/').at(-1)?.split('/').slice(1).join('/')))],
      lastKind: rows.at(-1)?.kind ?? null, lastAt: rows.at(-1)?.ts ?? null,
    };
  });
};
let baton; let workflow; let failure = null; let record = null;
try {
  baton = await openBaton({
    repo,
    advanced: {
      deploymentRoot, routes: [codex, glm],
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
    { role: 'dispatch-design-architect', exact: codex },
    { role: 'dispatch-design-adversary', exact: glm },
  ];
  workflow = await baton.workflow([
    'Do not implement code. Inspect the current effective Baton tree and write one bounded technical',
    `proposal at ${evidenceRepoPath}/proposal.md for the next Phase 85 gate: generic`,
    'context_reduce proposal, exact successor Plan reconciliation, separate approval, one provider',
    'dispatch with verified call-source input, restart idempotency, and stop/reap, stopping before',
    'settlement or retry. Preserve one event/store authority and historical map replay. Explicitly',
    'identify which existing map functions should be generalized, which must remain compatibility',
    'adapters, the minimum new tests, failure codes, and any flaws in the current schema-v2 admission',
    'implementation. Also critique the earlier failed implementation shape: do not cargo-cult its',
    'surface. The note must be self-contained, specific to current functions, and under 2500 words.',
    'Run the two focused existing test files, do not spawn subagents, and finish with only that note.',
  ].join(' '), {
    scope: [
      'impl/src/context-call.mjs', 'impl/src/context-map.mjs', 'impl/src/goal-plan.mjs',
      'impl/src/coordination-store.mjs', 'impl/src/coordinator.mjs', 'impl/src/application.mjs',
      'impl/src/application-semantics.mjs', 'impl/src/application-client.mjs',
      'impl/test/phase85-context-effect-admission-red.test.mjs',
      'impl/test/phase85-context-call-envelope-red.test.mjs',
      `${evidenceRepoPath}/proposal.md`,
    ],
    team,
  });
  await workflow.complete();
  const status = await workflow.status();
  const candidates = (await workflow.candidates()).section.items.map(({ value }) => value);
  const patches = candidates.map((candidate) => {
    const body = git([
      'diff-tree', '--no-commit-id', '--binary', '-p', `${candidate.resultSha}^`, candidate.resultSha,
    ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const name = `candidate-${candidate.role}.patch`;
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
    selectedTeam: team, phase: status.phase,
    attempts: status.attempts.map(({ role, state, route, taskId, candidateId }) => ({
      role, state, route, taskId, candidateId,
    })),
    workerActivity: workerActivity(), candidates: patches,
  };
} catch (error) {
  failure = error;
  record = {
    schemaVersion: 1, deploymentRoot, runId: workflow?.id ?? null,
    error: { name: error.name, code: error.code ?? null, message: error.message },
    workerActivity: workerActivity(),
  };
} finally {
  let stopped = null; let closed = null;
  if (workflow) {
    try {
      await workflow.stop('Retain dispatch-design Candidates and reap every exact descendant.');
      const status = await workflow.status();
      stopped = { stop: status.stop, ownership: status.ownership };
      if (status.stop?.receipt?.remainingCount !== 0 || status.ownership?.workers !== 0) {
        failure ??= new Error('Phase 85 dispatch-design stop proof is incomplete');
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
  writeFileSync(join(evidenceDir, 'evidence.json'),
    `${JSON.stringify({ record, cleanup }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ record, cleanup })}\n`);
  if (closed?.closed === true && closed?.workers === 0) {
    rmSync(deploymentRoot, { recursive: true, force: true });
  }
  if (!cleanup.callerStatusUnchanged || !cleanup.callerIndexUnchanged) {
    failure ??= new Error('Phase 85 dispatch-design caller-isolation proof failed');
  }
}
if (failure) throw failure;
