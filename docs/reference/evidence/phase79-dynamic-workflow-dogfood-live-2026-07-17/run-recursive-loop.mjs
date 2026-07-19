import { copyFileSync, cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const snapshot = mkdtempSync(join(tmpdir(), 'baton-phase80-recursive-loop-'));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: source,
}).toString().split('\0').filter(Boolean)
  // Historical captured provider streams are evidence for humans, not implementation context.
  // Omitting them keeps every Git worker/verifier checkout small on a constrained development disk.
  .filter((relative) => !relative.startsWith('docs/reference/evidence/'));
for (const relative of files) {
  mkdirSync(dirname(join(snapshot, relative)), { recursive: true });
  copyFileSync(join(source, relative), join(snapshot, relative));
}
execFileSync('git', ['init', '--quiet'], { cwd: snapshot });
execFileSync('git', ['config', 'user.email', 'baton-dogfood@example.invalid'], { cwd: snapshot });
execFileSync('git', ['config', 'user.name', 'Baton Dogfood'], { cwd: snapshot });
execFileSync('git', ['add', '--all'], { cwd: snapshot });
execFileSync('git', ['commit', '--quiet', '-m', 'snapshot recursive Baton vertical'], { cwd: snapshot });
cpSync(resolve(source, 'impl/node_modules'), join(snapshot, 'impl/node_modules'), {
  recursive: true, dereference: true,
});

const controller = new AbortController();
const interrupt = () => controller.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

const low = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' });
const medium = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'medium' });
const reportPath = 'reviews/dogfood/phase80-recursive-workflow-audit.md';
const baton = await openBaton({
  repo: snapshot,
  advanced: {
    routes: [low, medium],
    verification: {
      command: 'node',
      arguments: ['--test',
        'impl/test/phase80-workflow-revision.test.mjs',
        'impl/test/phase80-plan-revision-store.test.mjs'],
    },
    // This evidence run is executing on a nearly-full development volume. Preserve the production
    // 2 GiB reserve and inject deterministic test capacity here; the snapshot is temporary and the
    // final ownership receipt still proves exact worktree/process cleanup.
    capacity: {
      estimate: () => ({ bytes: 64 * 1024 * 1024, inodes: 10_000 }),
      observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
    },
  },
});

let workflow = null;
try {
  workflow = await baton.workflow([
    'Inspect the CURRENT SNAPSHOT Phase 79 and Phase 80 implementation and tests.',
    'Write a concise engineering audit, no more than 100 lines, of the recursive feedback and parallel-composition vertical.',
    'Distinguish what is already implemented from the next missing production capability; identify unsafe shared-writer shortcuts; give dependency-ordered red tests and exact source-level changes for the next vertical.',
    'Ground every claim in current files and do not claim that bounded one-round revision is unbounded recursion.',
    `Write only ${reportPath}. Do not modify production code or any other file.`,
  ].join(' '), {
    scope: [reportPath],
    team: [
      { role: 'authority-auditor', exact: low },
      { role: 'failure-auditor', exact: medium },
    ],
  });

  const initial = await workflow.complete({ signal: controller.signal });
  const firstCandidates = (await workflow.candidates()).section.items.map(({ value }) => value);
  const preferred = firstCandidates.find(({ role }) => role === 'authority-auditor') ?? firstCandidates[0];
  if (!preferred) throw new Error('recursive Workflow produced no initial Candidate');
  await workflow.sendFeedback(preferred.role, {
    summary: 'Revise the exact report into a more operational next-vertical design.',
    findings: [{
      kind: 'defect', severity: 'high', path: reportPath, line: 1,
      message: 'Separate verified current capability from proposed work, add recovery and stop/reap failure tests, and make the next implementation boundary executable without implying shared mutable worktrees or unbounded recursion.',
    }],
  });
  await workflow.select(preferred.role,
    'Use the concise authority audit as the immutable basis for one feedback-driven correction round.');

  const callsBeforeApproval = (await workflow.status()).attempts.length;
  const proposed = await workflow.revise(
    'Apply the recorded feedback to the selected immutable Candidate in one bounded correction round.');
  if (proposed.outline.phase !== 'awaiting_plan_approval') {
    throw new Error(`revision proposal did not stop for approval: ${proposed.outline.phase}`);
  }
  await workflow.approve();
  const revised = await workflow.complete({ signal: controller.signal });
  const revisionCandidates = (await workflow.candidates()).section.items.map(({ value }) => value);
  const revision = revisionCandidates[0];
  if (!revision) throw new Error('recursive Workflow produced no revision Candidate');
  await workflow.select(revision.role,
    'Retain the mechanically verified feedback-driven revision as the Workflow outcome.');
  const rounds = (await workflow.rounds()).section.items.map(({ value }) => value);
  const status = await workflow.status();
  process.stdout.write(`${JSON.stringify({
    snapshot, runId: workflow.id,
    initialPhase: initial.outline.phase,
    proposedPhase: proposed.outline.phase,
    revisedPhase: revised.outline.phase,
    callsBeforeApproval,
    initialCandidates: firstCandidates.map(({ role, resultSha, retainedResultRef }) => ({
      role, resultSha, retainedResultRef,
    })),
    revisionCandidate: {
      role: revision.role, resultSha: revision.resultSha,
      retainedResultRef: revision.retainedResultRef,
    },
    rounds: rounds.map((round) => ({
      number: round.number, kind: round.kind, planDigest: round.plan.digest,
      predecessorDigest: round.plan.predecessor?.digest ?? null,
      candidateCount: round.candidates.length,
      feedbackCount: round.feedback.length,
    })),
    selected: status.selection.candidate,
  })}\n`);
} finally {
  if (workflow) await workflow.stop('Recursive dogfood evidence captured; stop and reap the Workflow.').catch(() => {});
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  process.stdout.write(`${JSON.stringify({ close: (await baton.close()).ownership, snapshot })}\n`);
}
