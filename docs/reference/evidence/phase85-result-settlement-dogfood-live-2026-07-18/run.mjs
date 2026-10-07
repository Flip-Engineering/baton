import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const evidenceRepoPath = 'docs/reference/evidence/phase85-result-settlement-dogfood-live-2026-07-18';
const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-result-settlement-'));
const controller = new AbortController();
const interrupt = () => controller.abort();
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

const codex = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const codexDeep = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
const scope = Object.freeze([
  'impl/src/application.mjs',
  'impl/src/context-result.mjs',
  'impl/src/context-runtime.mjs',
  'impl/src/coordination-store.mjs',
  'impl/test/phase84-context-map-wave-red.test.mjs',
]);
const git = (args, options = {}) => execFileSync('/usr/bin/git', args, { cwd: repo, ...options });
const outsideEvidenceStatus = () => git([
  'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.',
  `:(exclude)${evidenceRepoPath}`,
]);
for (const name of readdirSync(evidenceDir)) {
  if (/^candidate-[a-z0-9-]+\.patch$/u.test(name)) rmSync(join(evidenceDir, name), { force: true });
}
const callerBefore = Object.freeze({
  status: outsideEvidenceStatus(),
  indexTree: git(['write-tree']),
});

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
          '--test', '--test-name-pattern', '^CM84-W4:',
          'impl/test/phase84-context-map-wave-red.test.mjs',
        ],
      },
    },
  });
  const readiness = await baton.doctor();
  const team = [
    { role: 'result-settlement-builder', exact: codex },
    { role: 'result-settlement-adversary', exact: codexDeep },
  ];
  workflow = await baton.workflow([
    'Implement the bounded Phase 85 capsule-settled Context map output slice in Baton.',
    'The exact CM84-W4 test is intentionally red. Preserve existing terminal child rows and their',
    'childDigest. After exact all-terminal resource release, derive every capsule only from the',
    'durable accepted child, canonical retained commit ref, selected route, accepted artifact set,',
    'cleanup receipt, call source tree, and exact successor node path scope. Avoid a digest cycle:',
    'store an ordered closed providerResults set beside unchanged children. Completed ContextValue',
    'items must be those safe provider-result refs; call evidence retains full children and both set',
    'digests. CAS writes may precede settlement, but attachment authority is the single atomic',
    'context.call_settled event. Reverify capsule and source CAS during settlement and replay.',
    'A failed call may retain refs only for accepted children and must keep outputRef null. Never',
    'fall back to task metadata as synthesis output or put raw report bytes in coordination.',
    'Work only in the allowed scope, run the focused test, do not spawn subagents, and finish with code.',
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
    schemaVersion: 1,
    deploymentRoot,
    runId: workflow?.id ?? null,
    outcome: 'failed',
    error: { name: error.name, code: error.code ?? null, message: error.message },
  };
} finally {
  let stopped = null;
  let closed = null;
  if (workflow) {
    try {
      await workflow.stop('Retain result-settlement Candidates, then stop and reap every descendant.');
      const status = await workflow.status();
      stopped = {
        state: status.stop?.state ?? null,
        receipt: status.stop?.receipt ?? null,
        ownership: status.ownership,
      };
      if (stopped.state !== 'stopped'
        || ![1, 3].includes(stopped.receipt?.schemaVersion)
        || stopped.receipt?.remainingCount !== 0
        || stopped.receipt?.counts?.processesObserved !== stopped.receipt?.counts?.processesClosed
        || status.ownership?.workers !== 0) {
        failure ??= new Error('Phase 85 result-settlement Run-stop proof is incomplete');
      }
    } catch (error) { failure ??= error; }
  }
  if (baton) {
    try { closed = (await baton.close()).ownership; }
    catch (error) { failure ??= error; }
  }
  const callerAfter = { status: outsideEvidenceStatus(), indexTree: git(['write-tree']) };
  const cleanup = {
    stopped,
    closed,
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
    failure ??= new Error('Phase 85 result-settlement caller-isolation proof failed');
  }
}

if (failure) throw failure;
