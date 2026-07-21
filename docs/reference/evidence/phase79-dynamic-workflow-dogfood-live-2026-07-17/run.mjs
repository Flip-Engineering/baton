import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const controller = new AbortController();
const interrupt = () => controller.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

const codex = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const grok = Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'high' });
const reportPath = 'reviews/dogfood/phase79-dynamic-workflow-live-review.md';
const baton = await openBaton({
  repo,
  advanced: {
    routes: [codex, grok],
    verification: {
      command: 'node',
      arguments: [
        '--test',
        'impl/test/phase79-workflow-composition-red.test.mjs',
        'impl/test/phase79-workflow-definition-authority-red.test.mjs',
        'impl/test/phase79-plan-wave-replay-red.test.mjs',
      ],
    },
  },
});

let workflow = null;
try {
  workflow = await baton.workflow([
    'Independently red-team the current Baton dynamic Workflow implementation as a candidate for production use.',
    'Evaluate atomic parallel dispatch, exact harness/model/effort routing, isolated shared-task composition, immutable Candidate evidence, typed feedback, operator selection, selective member stop/reap, whole-Run stop, restart/replay integrity, and the progressive agent experience.',
    'Identify concrete correctness, security, lifecycle, or usability defects with exact source pointers and propose dependency-ordered red tests and fixes.',
    `Write only ${reportPath}. Do not modify production code or any other file.`,
  ].join(' '), {
    scope: [reportPath],
    team: [
      { role: 'architect', exact: codex },
      { role: 'grok-critic', exact: grok },
      { role: 'grok-failure-hunter', exact: grok },
    ],
  });

  const paused = await workflow.complete({ signal: controller.signal });
  const candidateSection = await workflow.candidates();
  const candidates = candidateSection.section.items.map(({ value }) => value);
  for (const candidate of candidates) {
    await workflow.act('send_feedback', {
      role: candidate.role,
      feedback: {
        summary: 'Preserve exact evidence and distinguish implemented behavior from proposed follow-on work.',
        findings: [{
          kind: 'observation', severity: 'info',
          message: 'This Candidate is retained as an attributable independent review input.',
          path: reportPath, line: null,
        }],
      },
    });
  }
  const preferred = candidates.find((candidate) => candidate.role === 'grok-failure-hunter')
    ?? candidates.find((candidate) => candidate.role.startsWith('grok-'))
    ?? candidates[0];
  if (!preferred) throw new Error('dynamic Workflow produced no mechanically verified Candidate');
  await workflow.select(preferred.role,
    'Select an independently routed failure-hunting Candidate after comparing the verified set.');
  const status = await workflow.status();
  const evidence = await workflow.evidence();
  process.stdout.write(`${JSON.stringify({
    runId: workflow.id,
    pausedPhase: paused.outline.phase,
    finalPhase: status.phase,
    attempts: status.attempts.map(({ role, state, route, candidateId }) => ({
      role, state, route, candidateId,
    })),
    candidateCount: candidates.length,
    selectedRole: status.selection.candidate.role,
    feedbackCount: status.feedback.length,
    evidence: {
      kind: evidence.kind,
      manifestDigest: evidence.manifestDigest,
      observedThroughSeq: evidence.observedThroughSeq,
      checks: evidence.checks,
    },
  })}\n`);
} finally {
  if (workflow) {
    await workflow.stop(controller.signal.aborted
      ? 'Signal received; stop and reap the dynamic Workflow.'
      : 'Dogfood evidence captured; stop and reap every Workflow-owned resource.').catch(() => {});
  }
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  process.stdout.write(`${JSON.stringify({ close: (await baton.close()).ownership })}\n`);
}
