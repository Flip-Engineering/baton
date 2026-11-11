import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const evidenceRepoPath = 'docs/reference/evidence/phase85-context-call-dogfood-live-2026-07-18';
const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-context-call-'));
const controller = new AbortController();
const interrupt = () => controller.abort();
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

const codex = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const codexDeep = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
const scope = Object.freeze([
  'impl/src/context-call.mjs',
  'impl/src/context-map.mjs',
  'impl/src/index.mjs',
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
      deploymentRoot,
      routes: [codex, codexDeep],
      verification: {
        command: 'node',
        arguments: ['--test', 'impl/test/phase85-context-call-envelope-red.test.mjs'],
      },
    },
  });
  const readiness = await baton.doctor();
  const team = [
    { role: 'context-call-builder', exact: codex },
    { role: 'context-call-adversary', exact: codexDeep },
  ];
  workflow = await baton.workflow([
    'Implement the bounded CLR3 generic Context effect-call normalization core in Baton.',
    'The focused CC85 test is red because impl/src/context-call.mjs does not exist.',
    'Implement one closed content-addressed baton.context_effect_call envelope for map and reduce.',
    'Derive exact unit, logical request, and execution call identities without cycles. Bind the',
    'Context service principal and authenticated requester separately, plus session, manifest, tree,',
    'environment, policy, Workflow definition, role catalog, profile, and predecessor Plan authority.',
    'Map accepts one or more canonical one-input units from a completed v2 cell. Reduce accepts one',
    'unit selecting every output of a completed call in canonical order. Keep generation 1 only in',
    'this slice; retry generations remain closed. Add the Phase 84 context-map compatibility adapter',
    'without changing its durable schema. Reject unknown fields and every source, authority, grouping,',
    'unit, request, and call substitution. Do not add caller budget/byte knobs, transport commands,',
    'provider effects, or a second orchestration surface. Work only in the allowed scope, run the',
    'focused test, do not spawn subagents, and finish with code.',
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
      await workflow.stop('Retain Context-call Candidates, then stop and reap every descendant.');
      const status = await workflow.status();
      stopped = {
        state: status.stop?.state ?? null, receipt: status.stop?.receipt ?? null,
        ownership: status.ownership,
      };
      if (stopped.state !== 'stopped' || stopped.receipt?.remainingCount !== 0
        || stopped.receipt?.counts?.processesObserved !== stopped.receipt?.counts?.processesClosed
        || status.ownership?.workers !== 0) {
        failure ??= new Error('Phase 85 Context-call Run-stop proof is incomplete');
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
    failure ??= new Error('Phase 85 Context-call caller-isolation proof failed');
  }
}

if (failure) throw failure;
