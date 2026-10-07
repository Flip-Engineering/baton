import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const evidenceRepoPath = 'docs/reference/evidence/phase85-context-lineage-dogfood-live-2026-07-18';
const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-lineage-'));
const controller = new AbortController();
const interrupt = () => controller.abort();
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

const codex = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const codexDeep = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
const kimi = Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'max' });
const scope = Object.freeze([
  'impl/src/context-lineage.mjs',
  'impl/src/context-program.mjs',
  'impl/src/context-runtime.mjs',
  'impl/src/coordination-store.mjs',
  'impl/test/phase85-context-lineage-red.test.mjs',
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
let candidatePatches = [];

try {
  baton = await openBaton({
    repo,
    advanced: {
      deploymentRoot,
      routes: [codex, codexDeep, kimi],
      verification: {
        command: 'node',
        arguments: ['--test', 'impl/test/phase85-context-lineage-red.test.mjs'],
      },
    },
  });
  const readiness = await baton.doctor();
  const kimiReady = readiness.routes.some((route) => (
    route.harness === kimi.harness && route.model === kimi.model
      && route.effort === kimi.effort && route.state === 'ready'
  ));
  const team = [
    { role: 'lineage-builder', exact: codex },
    { role: 'authority-adversary', exact: kimiReady ? kimi : codexDeep },
  ];

  workflow = await baton.workflow([
    'Complete the bounded Phase 85 per-output Context lineage slice in the current effective Baton tree.',
    'Work directly in the allowed source and test files. Finish or correct evidence schema v2 so every',
    'pure output item is bound to its exact item digest and canonical source coordinates through closed',
    'lineage digests. Prove sort/project coordinate preservation, deterministic replay, v2 tamper refusal,',
    'and legacy v1 durable-read compatibility while new execution emits v2 under a changed environment',
    'identity. Keep provider effects zero and do not broaden this slice into failed-task cleanup, map',
    'projection, docs, or later graph/RLM work. Add impl/test/phase85-context-lineage-red.test.mjs and run',
    'the focused test. Make the smallest authority-preserving implementation that passes it. Do not spawn',
    'subagents. Finish promptly with actual code, not a prose report.',
  ].join(' '), { scope, team });

  const settled = await workflow.complete({ signal: controller.signal });
  const candidateSection = await workflow.candidates();
  const candidates = candidateSection.section.items.map(({ value }) => value);
  if (!controller.signal.aborted && candidates.length !== team.length) {
    throw new Error(`expected ${team.length} verified Phase 85 Candidates, observed ${candidates.length}`);
  }
  candidatePatches = candidates.map((candidate) => {
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
  const evidence = await workflow.evidence();
  record = {
    schemaVersion: 1,
    runId: workflow.id,
    outcome: controller.signal.aborted ? 'operator_interrupted' : 'selection_required',
    readiness: readiness.routes.map(({ harness, model, effort, state, code = null }) => ({
      harness, model, effort, state, code,
    })),
    selectedTeam: team,
    phase: status.phase,
    settledPhase: settled.outline.phase,
    candidates: candidatePatches,
    attempts: status.attempts.map(({ role, state, route, taskId, candidateId }) => ({
      role, state, route, taskId, candidateId,
    })),
    evidence: {
      kind: evidence.kind,
      manifestDigest: evidence.manifestDigest,
      observedThroughSeq: evidence.observedThroughSeq,
      checks: evidence.checks,
    },
  };
} catch (error) {
  failure = error;
  record = {
    schemaVersion: 1,
    runId: workflow?.id ?? null,
    outcome: 'failed',
    error: { name: error.name, code: error.code ?? null, message: error.message },
  };
} finally {
  let stopped = null;
  let closed = null;
  if (workflow) {
    try {
      await workflow.stop(controller.signal.aborted
        ? 'Signal received; stop and reap every Phase 85 Candidate descendant.'
        : 'Candidate patches retained; stop and reap every Phase 85 descendant.');
      const status = await workflow.status();
      stopped = { state: status.stop?.state ?? null, receipt: status.stop?.receipt ?? null, ownership: status.ownership };
      if (stopped.state !== 'stopped' || ![1, 3].includes(stopped.receipt?.schemaVersion)
        || stopped.receipt?.remainingCount !== 0
        || stopped.receipt?.counts?.processesObserved !== stopped.receipt?.counts?.processesClosed
        || status.ownership?.workers !== 0) {
        failure ??= new Error('Phase 85 Baton Run-stop proof is incomplete');
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
  rmSync(deploymentRoot, { recursive: true, force: true });
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  if (!cleanup.callerStatusUnchanged || !cleanup.callerIndexUnchanged
    || (cleanup.closed && (cleanup.closed.closed !== true || cleanup.closed.workers !== 0))) {
    failure ??= new Error('Phase 85 Baton caller-isolation proof failed');
  }
}

if (failure) throw failure;
