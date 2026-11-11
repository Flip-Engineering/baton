import { copyFileSync, cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const snapshot = mkdtempSync(join(tmpdir(), 'baton-phase79-recursion-design-'));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: source,
}).toString().split('\0').filter(Boolean);
for (const relative of files) {
  mkdirSync(dirname(join(snapshot, relative)), { recursive: true });
  copyFileSync(join(source, relative), join(snapshot, relative));
}
execFileSync('git', ['init', '--quiet'], { cwd: snapshot });
execFileSync('git', ['config', 'user.email', 'baton-dogfood@example.invalid'], { cwd: snapshot });
execFileSync('git', ['config', 'user.name', 'Baton Dogfood'], { cwd: snapshot });
execFileSync('git', ['add', '--all'], { cwd: snapshot });
execFileSync('git', ['commit', '--quiet', '-m', 'snapshot current Baton workspace'], { cwd: snapshot });
cpSync(resolve(source, 'impl/node_modules'), join(snapshot, 'impl/node_modules'), {
  recursive: true, dereference: true,
});

const controller = new AbortController();
const interrupt = () => controller.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

const high = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const medium = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'medium' });
const reportPath = 'reviews/dogfood/phase79-recursive-feedback-design.md';
const baton = await openBaton({
  repo: snapshot,
  advanced: {
    routes: [high, medium],
    verification: {
      command: 'node',
      arguments: ['--test', 'impl/test/phase79-workflow-composition-red.test.mjs'],
    },
  },
});

let workflow = null;
try {
  workflow = await baton.workflow([
    'Analyze the CURRENT SNAPSHOT implementation, not just its phase specification.',
    'Design the smallest safe production vertical that turns immutable Candidate feedback into a recursively admitted revision Attempt, while preserving Goal/Plan authority, exact retained-result base identity, route and effort authority, idempotent recovery, selective stop/reap, and the isolated-writer rule.',
    'Compare at least three implementation approaches against the actual coordinator, coordination store, application, and worktree APIs. Identify which existing authority can be reused and which new durable events or methods are unavoidable.',
    'Give dependency-ordered red tests and source-level changes. Explicitly reject any shortcut that relabels review authority, mutates an old Plan, launches without Plan authority, or lets two workers write one checkout.',
    `Write only ${reportPath}. Do not modify production code or any other file.`,
  ].join(' '), {
    scope: [reportPath],
    team: [
      { role: 'authority-designer', exact: high },
      { role: 'failure-designer', exact: medium },
    ],
  });

  const paused = await workflow.complete({ signal: controller.signal });
  const candidates = (await workflow.candidates()).section.items.map(({ value }) => value);
  for (const candidate of candidates) {
    await workflow.sendFeedback(candidate.role,
      'Ground the recommendation in current source authority and name every unsafe shortcut.');
  }
  const preferred = candidates.find(({ role }) => role === 'authority-designer') ?? candidates[0];
  if (!preferred) throw new Error('recursive-design Workflow produced no verified Candidate');
  await workflow.select(preferred.role,
    'Select the higher-effort authority design after retaining both independently produced reports.');
  const status = await workflow.status();
  process.stdout.write(`${JSON.stringify({
    snapshot, runId: workflow.id, pausedPhase: paused.outline.phase,
    attempts: status.attempts.map(({ role, state, route }) => ({ role, state, route })),
    candidates: candidates.map(({ role, resultSha, retainedResultRef }) => ({
      role, resultSha, retainedResultRef,
    })),
    selected: status.selection.candidate,
  })}\n`);
} finally {
  if (workflow) await workflow.stop('Design evidence captured; stop and reap the Workflow.').catch(() => {});
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  process.stdout.write(`${JSON.stringify({ close: (await baton.close()).ownership, snapshot })}\n`);
}
