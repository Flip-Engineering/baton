// DEMO v2b — the decision gate end-to-end: one glm verifier raises DECISION_REQUEST early;
// the driver's onDecision (BD-B, live) answers it; the member acts on the answer and
// completes. Proves the worker→orchestrator upward gate with the full lifecycle receipt.
// Usage: node run-gate-demo.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/dynamic-workflow-2026-08-01');
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[gate ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'dynamic-workflow-gate-2026-08-01'),
    routes: [{ harness: 'glm', model: 'glm-5.2', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

const decisionLog = [];
try {
  const driver = createWaveDriver(baton, {
    steering: 'nudge-on-checkpoint', finalization: 'claim-on-stall',
    pollIntervalMs: 15_000, stallTimeoutMs: 20 * 60_000, hardCapMs: 40 * 60_000,
    settleTimeoutMs: 15_000, saltObjectives: false, preflight: true,
    onProgress: (line) => log(`progress ${line}`),
    onDecision: async ({ role, requestId, question, options, recommended, expiresInMs }) => {
      decisionLog.push({ role, requestId, question: question?.slice(0, 200), options, recommended, expiresInMs });
      log(`DECISION GATED from ${role} (expiresIn ${expiresInMs}ms): ${question?.slice(0, 120)}`);
      log(`answering 'more-evidence' — the worker must do one more verification pass`);
      return { optionId: 'more-evidence' };
    },
  });
  const receipt = await driver.run({
    members: [{
      role: 'verifier',
      exact: { harness: 'glm', model: 'glm-5.2', effort: 'high' },
      scope: ['docs/reference/evidence/dynamic-workflow-2026-08-01/**'],
      objective: [
        `[attempt: gate-${ATTEMPT}]`,
        'Read docs/reference/evidence/dynamic-workflow-2026-08-01/surveyor-map.md (a surveyor\'s map of impl/src/wave.mjs). In your FIRST work turn: (1) write docs/reference/evidence/dynamic-workflow-2026-08-01/gate-verdict.md with a one-line stub verdict, and (2) print exactly one line: DECISION_REQUEST: {"question":"Finding #2 in the surveyor map: should the verifier ship a fix now, mark it not-a-bug, or gather more evidence first?","options":[{"id":"fix-now","label":"Fix now"},{"id":"not-a-bug","label":"Not a bug"},{"id":"more-evidence","label":"Gather more evidence first"}],"recommended":"more-evidence","deadlineMs":600000} — DECISION_REQUEST is TEXT you print, never a tool you call.',
        'Then WAIT for the orchestrator\'s answer. If the answer is more-evidence: do ONE more verification pass against impl/src/wave.mjs (grep -an + targeted ranges), deepen gate-verdict.md with the extra evidence, and finish. If it is fix-now or not-a-bug, say why in the file and finish.',
        `[gate demo ${ATTEMPT}]`,
      ].join(' '),
    }],
  });
  const outcome = receipt.outcomes?.[0] ?? {};
  writeFileSync(resolve(EVIDENCE, 'gate-receipt.json'), `${JSON.stringify({ outcome: { phase: outcome.phase, resultSha: outcome.resultSha ?? null }, decisionLog, nudges: receipt.nudges?.length ?? 0, claims: receipt.claims ?? [] }, null, 2)}\n`);
  log(`outcome: ${outcome.phase}, result ${outcome.resultSha ?? 'none'}, decisions answered: ${decisionLog.length}`);
  log('GATE-OK');
} finally {
  await baton.close().catch(() => {});
}
