// DEMO v2 phase-2 child driver: verifier (glm) + skeptic (codex) with the onDecision gate
// answered by the driver (BD-B, live). Writes phase2-rendered.json (exact salted members,
// for the parent's 93B attach) + phase2-evidence.json. Expected to be KILLED mid-flight by
// the parent (the driver-death showcase). Usage: node phase2-driver.mjs <attemptIso> <idempotencyKey>
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const [attempt, idempotencyKey] = process.argv.slice(2);
const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/dynamic-workflow-2026-08-01');
const salt = `phase2-${Date.now()}`;
const log = (line) => console.log(`[p2 ${new Date().toISOString()}] ${line}`);

const renderedMembers = [
  {
    role: 'verifier',
    exact: { harness: 'glm', model: 'glm-5.2', effort: 'high' },
    scope: ['docs/reference/evidence/dynamic-workflow-2026-08-01/**'],
    objective: [
      `[attempt: ${salt} verifier]`,
      'Read docs/reference/evidence/dynamic-workflow-2026-08-01/surveyor-map.md (a surveyor\'s map of impl/src/wave.mjs) AND docs/reference/evidence/dynamic-workflow-2026-08-01/phase2-relay.json (the orchestrator\'s relay of the surveyor\'s shared-layer scratchpad — the findings it recorded via SCRATCHPAD_WRITE). Verify the SECOND finding against the actual code (grep -an + targeted ranges — never whole-file): is it a real defect or a non-issue? Write docs/reference/evidence/dynamic-workflow-2026-08-01/verifier-verdict.md with your verdict, the evidence, and a line on whether the scratchpad relay changed your read.',
      'CRITICAL: before finalizing, RAISE A DECISION by printing one line: DECISION_REQUEST: {"question":"Finding #2: ship a fix now, mark not-a-bug, or gather more evidence first?","options":[{"id":"fix-now","label":"Fix now"},{"id":"not-a-bug","label":"Not a bug"},{"id":"more-evidence","label":"Gather more evidence first"}],"recommended":"more-evidence","deadlineMs":600000} — DECISION_REQUEST is TEXT you print, never a tool. Then WAIT for the orchestrator\'s answer and act on it.',
      'Work continuously; write the verdict skeleton first, then deepen.',
    ].join(' '),
  },
  {
    role: 'skeptic',
    exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
    scope: ['docs/reference/evidence/dynamic-workflow-2026-08-01/**'],
    objective: [
      `[attempt: ${salt} skeptic]`,
      'Adversarially review docs/reference/evidence/dynamic-workflow-2026-08-01/surveyor-map.md (a surveyor\'s map of impl/src/wave.mjs). Try to BREAK each of its three findings: is the cited line real, is the risk overblown, is the suggested check wrong? Write docs/reference/evidence/dynamic-workflow-2026-08-01/skeptic-review.md with a break/confirm verdict per finding and the strongest counter-argument.',
      'Work continuously; write the review skeleton first, then deepen.',
    ].join(' '),
  },
];

writeFileSync(resolve(EVIDENCE, 'phase2-rendered.json'), `${JSON.stringify({ schemaVersion: 1, salt, renderedMembers }, null, 2)}\n`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'dynamic-workflow-2026-08-01'),
    routes: [
      { harness: 'glm', model: 'glm-5.2', effort: 'high' },
      { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
    ],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

const decisionLog = [];
try {
  const driver = createWaveDriver(baton, {
    steering: 'nudge-on-checkpoint', finalization: 'claim-on-stall',
    pollIntervalMs: 15_000, stallTimeoutMs: 20 * 60_000, hardCapMs: 3 * 3_600_000,
    settleTimeoutMs: 15_000, saltObjectives: false, preflight: true,
    onProgress: (line) => log(`progress ${line}`),
    // BD-B live: the orchestrator answers the verifier's gate through the callback.
    onDecision: async ({ role, requestId, question, options, recommended }) => {
      decisionLog.push({ role, requestId, question: question?.slice(0, 160), options, recommended });
      log(`DECISION GATED from ${role}: ${question?.slice(0, 120)} — answering 'more-evidence'`);
      return { optionId: 'more-evidence' };
    },
  });
  const receipt = await driver.run({ members: renderedMembers, idempotencyKey });
  writeFileSync(resolve(EVIDENCE, 'phase2-evidence.json'), `${JSON.stringify({ ...receipt, decisionLog }, null, 2)}\n`);
  log('PHASE2-OK');
} catch (error) {
  writeFileSync(resolve(EVIDENCE, 'phase2-evidence.json'), `${JSON.stringify({ error: String(error?.message ?? error), decisionLog }, null, 2)}\n`);
  throw error;
} finally {
  await baton.shutdown?.().catch(() => {});
}
