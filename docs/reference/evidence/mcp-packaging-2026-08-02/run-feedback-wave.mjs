// WORKER-FEEDBACK wave v2 (post-epics): downstream workers review the INTEGRATED experience
// after #62/#63/#64 — the user asked "have you consulted the downstream baton workers yet?"
// THROUGH baton.recipes.run. Three reviewers, three angles, one honest verdict each.
// Usage: node run-feedback-wave.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/mcp-packaging-2026-08-02');
const log = (line) => console.log(`[fb ${new Date().toISOString()}] ${line}`);

const COMMON = [
  'You are a DOWNSTREAM BATON WORKER reviewing your own integrated experience (post #62 write-',
  'failure visibility, #63 KG settlement, #64 trust-gate steering). Be candid and receipt-',
  'grounded: file:line where you can, concrete failure/friction stories where you cannot.',
  'Evidence to consult: docs/PROGRESS.md (the arc), docs/reference/evidence/kg-tiered-loop-',
  '2026-08-01/kg-loop-verdict.md, docs/reference/evidence/trust-gate-steering-2026-08-02/,',
  'docs/reference/evidence/kg-settlement-2026-08-01/. Score each area 1-5 (1=hostile,',
  '5=invisible-in-a-good-way) with one line of justification each.',
].join(' ');

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'worker-feedback-2026-08-02'),
    routes: [
      { harness: 'glm', model: 'glm-5.2', effort: 'high' },
      { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
      { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
    ],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

try {
  const receipt = await baton.recipes.run({
    name: 'worker-feedback-v2',
    version: '2.0',
    members: [
      {
        role: 'worker-experience-reviewer',
        exact: { harness: 'glm', model: 'glm-5.2', effort: 'high' },
        scope: ['docs/reference/evidence/mcp-packaging-2026-08-02/**'],
        objectiveTemplate: {
          task: [
            COMMON,
            'YOUR ANGLE: the WORKER-side experience, up and down. (1) The up-channel: scratchpad',
            'writes (wire grammar, one-per-message), decision requests, attention — natural or',
            'ceremony? (2) The down-channel: steering nudges (provenance-marked now), verdict',
            'surface (TG4), objectives — do you learn what you need, when you need it? (3) The',
            'trust gate post-#64: does the checkpoint/nudge/cycle shape match how you actually work',
            '(read-heavy turns, chunked deliverables)? Any remaining way it could kill you wrongly?',
            '(4) Knowledge poverty: you cannot read the KG, boards, or each other\'s scratchpads —',
            'rank the three most valuable READ capabilities you lack. (5) One concrete change that',
            'would most improve your per-task output quality.',
          ].join(' '),
          constraints: [
            'Write the report skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
            'Work in ONE continuous turn to completion.',
            'Read-only review: do not edit impl/ files; your only write target is your report path.',
          ],
        },
        report: 'docs/reference/evidence/mcp-packaging-2026-08-02/feedback-worker.md',
      },
      {
        role: 'orchestrator-experience-reviewer',
        exact: { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
        scope: ['docs/reference/evidence/mcp-packaging-2026-08-02/**'],
        objectiveTemplate: {
          task: [
            COMMON,
            'YOUR ANGLE: the ORCHESTRATOR-side experience. (1) The unified control surface post-',
            'grammar-M5: is start/steer/watch/diagnose/settle coherent or still fragmented across',
            'facade/driver/store levels? Where does an orchestrator still hand-roll node -e',
            'scripts? (2) Failure diagnosis: run.debug + attention + progressClass + write-failure',
            'visibility — what class of failure still requires archaeology? (3) The attention',
            'inbox gap: today the orchestrator POLLS — what would waking-with-decisions-pending',
            'require, and which existing primitive (followOnce cursors? decision.list deadlines?)',
            'is closest? (4) Setup ceremony: openBaton + deploymentRoot + routes + verification',
            'per wave — what should the 5-line version look like? (5) Rate the wave-driver pattern',
            'as a productized shape vs bespoke drives for novel compositions.',
          ].join(' '),
          constraints: [
            'Write the report skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
            'Work in ONE continuous turn to completion.',
            'Read-only review: do not edit impl/ files; your only write target is your report path.',
          ],
        },
        report: 'docs/reference/evidence/mcp-packaging-2026-08-02/feedback-orchestrator.md',
      },
      {
        role: 'frontier-features-reviewer',
        exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
        scope: ['docs/reference/evidence/mcp-packaging-2026-08-02/**'],
        objectiveTemplate: {
          task: [
            COMMON,
            'YOUR ANGLE: the FRONTIER features — integrated or siloed? (1) The KG loop (scratchpad',
            '→ elevation → candidacy → admission → ambient serving): is it a living system yet or',
            'a mechanism awaiting habit? What closes the habit loop? (2) Boards (S-2): shared-',
            'task-list reality vs KG-ritual-only usage. (3) REPL (manifest/binding/cite): the',
            'original vision was shared objects, scripting, context passing across the',
            'orchestration layer — what fraction is realized, and what is the ONE use that would',
            'make it load-bearing? (4) ATLAS/cartographer + the context program (cells/calls):',
            'verification aid vs daily context engineering — why do orchestrators not reach for',
            'them? (5) Worker-to-worker channels: today everything routes through the',
            'orchestrator — is the shared-scratchpad relay enough, or do workers need a first-',
            'class channel, and through which existing primitive should it ride?',
          ].join(' '),
          constraints: [
            'Write the report skeleton (all headings + stubs) FIRST so an in-scope diff exists from your first minutes, then deepen.',
            'Work in ONE continuous turn to completion.',
            'Read-only review: do not edit impl/ files; your only write target is your report path.',
          ],
        },
        report: 'docs/reference/evidence/mcp-packaging-2026-08-02/feedback-frontier.md',
      },
    ],
    policy: { steering: 'nudge-on-checkpoint', finalization: 'claim-on-stall' },
  }, {
    task: 'Post-epics integrated-experience feedback from downstream workers',
    idempotencyKey: 'worker-feedback-v2-2026-08-02',
    manifestPath: resolve(EVIDENCE, 'feedback-manifest.json'),
    evidencePath: resolve(EVIDENCE, 'feedback-evidence.json'),
  });
  writeFileSync(resolve(EVIDENCE, 'feedback-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  log(`feedback settled: ${(receipt?.outcomes ?? []).map((o) => `${o.role}=${o.phase}`).join(' ')}`);
  log('FB-DONE');
} finally {
  await baton.close().catch(() => {});
}
