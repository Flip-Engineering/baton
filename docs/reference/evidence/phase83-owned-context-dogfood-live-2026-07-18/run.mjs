import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase83-dogfood-'));
const controller = new AbortController();
const interrupt = () => controller.abort();
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

const codex = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const codexDeep = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
const reportPath = 'reviews/dogfood/phase83-owned-context-runtime-review.md';
const git = (args, options = {}) => execFileSync('/usr/bin/git', args, { cwd: repo, ...options });
const callerBefore = Object.freeze({
  status: git(['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  indexTree: git(['write-tree']),
});

let baton = null;
let workflow = null;
let failure = null;
let record = null;

try {
  baton = await openBaton({
    repo,
    advanced: {
      deploymentRoot,
      routes: [codex, codexDeep],
      verification: {
        command: 'node',
        arguments: [
          '--test',
          'impl/test/phase82-context-durability-red.test.mjs',
          'impl/test/phase83-context-application-red.test.mjs',
          'impl/test/phase83-context-runtime-red.test.mjs',
        ],
      },
    },
  });
  const readiness = await baton.doctor({ depth: 'connection', check: true });
  workflow = await baton.workflow([
    'Independently audit the current effective-tree Baton implementation after the Phase 83 owned',
    'Context process, shutdown-admission, source-provenance, and durable-abort changes.',
    'Inspect spec/phase81-context-program-rlm.md plus the Context runtime, worker, coordination,',
    'application, client, and Phase 81-83 tests. Evaluate actual kill/reap ordering, child-process',
    'ownership, environment credential isolation, Git authority, source-coordinate attestation,',
    'restart behavior, five-operation AX, and exact orchestrator-selected harness/model/effort.',
    'Separate launch blockers from later Layer C AST/map/reduce/review/verify/knowledge-graph work.',
    'Give concrete source pointers, adversarial counterexamples, and the smallest dependency-ordered',
    'next patch/test sequence. Do not spawn subagents or run verification; Baton verifies the result.',
    `Write only ${reportPath}; do not modify production code or any other file.`,
  ].join(' '), {
    scope: [reportPath],
    team: [
      { role: 'codex-lifecycle-auditor', exact: codex },
      { role: 'codex-provenance-adversary', exact: codexDeep },
    ],
  });
  await workflow.approve();
  const contextCell = await workflow.context().search('context_execution_reap_failed', {
    role: 'codex-lifecycle-auditor',
  });
  const contextOutput = await contextCell.output();
  const completed = await workflow.complete({ signal: controller.signal });
  const candidates = (await workflow.candidates()).section.items.map(({ value }) => value);
  if (candidates.length !== 2 && !controller.signal.aborted) {
    throw new Error(`expected two Candidates, observed ${candidates.length}`);
  }
  const reports = {};
  for (const candidate of candidates) {
    reports[candidate.role] = git(['show', `${candidate.resultSha}:${reportPath}`], {
      encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    });
    writeFileSync(join(evidenceDir, `${candidate.role}.md`), reports[candidate.role]);
  }
  const status = await workflow.status();
  const manifest = await workflow.evidence();
  record = {
    schemaVersion: 1,
    runId: workflow.id,
    phase: completed.outline.phase,
    outcome: controller.signal.aborted ? 'operator_interrupted_before_candidate' : 'verified_candidates',
    readiness: readiness.routes.map(({ harness, model, effort, state, code = null }) => ({
      harness, model, effort, state, code,
    })),
    attempts: status.attempts.map(({ role, state, route, candidateId }) => ({
      role, state, route, candidateId,
    })),
    context: {
      cellId: contextCell.id,
      matchedItems: contextOutput.items.length,
      paths: [...new Set(contextOutput.items.map(({ path }) => path))].sort(),
    },
    candidates: candidates.map(({ role, candidateId, resultSha, evidenceDigest }) => ({
      role, candidateId, resultSha, evidenceDigest,
    })),
    manifestDigest: manifest.manifestDigest,
    checks: manifest.checks,
  };
} catch (error) {
  failure = error;
} finally {
  let stopped = null;
  let closed = null;
  if (workflow) {
    try {
      await workflow.stop(controller.signal.aborted
        ? 'Signal received; fence and reap the Phase 83 dogfood Workflow.'
        : 'Phase 83 evidence captured; fence and reap every Workflow descendant.');
      const status = await workflow.status();
      stopped = {
        state: status.stop?.state ?? null,
        receiptDigest: status.stop?.receipt?.receiptDigest ?? null,
        ownership: status.ownership,
      };
    } catch (error) { failure ??= error; }
  }
  if (baton) {
    try { closed = (await baton.close()).ownership; }
    catch (error) { failure ??= error; }
  }
  const callerAfter = {
    status: git(['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    indexTree: git(['write-tree']),
  };
  const cleanup = {
    stopped,
    closed,
    callerStatusUnchanged: callerBefore.status.equals(callerAfter.status),
    callerIndexUnchanged: callerBefore.indexTree.equals(callerAfter.indexTree),
  };
  const evidence = { record, cleanup };
  writeFileSync(join(evidenceDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  rmSync(deploymentRoot, { recursive: true, force: true });
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  if (!cleanup.callerStatusUnchanged || !cleanup.callerIndexUnchanged
    || (cleanup.closed && (cleanup.closed.closed !== true || cleanup.closed.workers !== 0))) {
    failure ??= new Error('Phase 83 dogfood cleanup proof failed');
  }
}

if (failure) throw failure;
