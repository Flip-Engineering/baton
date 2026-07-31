// P1-C implementation wave: one deepseek-v4-flash@high seat implements the semantic
// progress contract v2 (progressClass + requiredAction) red-first — deepseek's first
// implementation seat (bounded projection work, coordinate-rich). Usage: node run-impl-wave.mjs
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[sp ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'semantic-progress-impl-2026-07-31'),
    routes: [{ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }],
    verification: Object.freeze({ command: 'node', arguments: ['--test', 'impl/test/semantic-progress-red.test.mjs'] }),
  },
});

const OBJECTIVE = [
  'Implement the P1-C semantic progress contract v2: docs/reference/evidence/semantic-progress-2026-07-31/semantic-progress-decisions.md — the v2 section at the top is your ONLY authority (v1 below is fold context). progressClass closed enum (terminal:<cause> > blocked_interaction:<detail> > silent > progressing) + requiredAction honestly sourced + the SP-1+..SP-5 red battery.',
  'COORDINATES (pre-digested): single-attempt view assembly: application.mjs:7256 (add fields there). projectBlockedInteraction (LIVE strings — decision, approve_plan, select_candidate; summary-less for the phase kinds): application.mjs:321-331. _progressTiming + silenceMs: application.mjs:7441-7490. _followCategory noise filter: :7373-7398. _semanticActions + _semanticActionId (view-digest-dependent actionId): application.mjs:9058-9235 and :7606-7620. runs.list item projection: :10686-10736. Semantics registry enum tables: application-semantics.mjs:19-90. wave-side LEGACY classification strings (legacy-only, do not reuse): wave.mjs:107-127. Web/MCP view serialization whitelist spots to update in the same commit: find them with grep -an "progressClass\\|requiredAction\\|attentionTruncated" impl/src/web-northbound.mjs impl/src/mcp-northbound.mjs impl/src/application-semantics.mjs. The activity field recently landed in the same view (application.mjs:7256 region, issue #55) — follow its additive pattern.',
  'METHOD (red-first, skeleton FIRST): (1) your FIRST file action writes impl/test/semantic-progress-red.test.mjs with the SP-1+..SP-5 rows exactly as the v2 contract pins them (awaiting_plan_approval with EMPTY attention → blocked_interaction:approve_plan; priority phase-over-attention; requiredAction per kind with canonical summaries; actionId iff advertised; end-to-end act resolution; vocabulary identity outline+runs.list; wire whitelist round-trips; silent at the named threshold; NO rate_limited member source-scan). Run it; watch it fail for the right reasons. (2) Implement until green — additive projections only. (3) VERIFY: node --test impl/test/semantic-progress-red.test.mjs impl/test/wave-driver-red.test.mjs impl/test/issue53-run-debug-red.test.mjs impl/test/issue55-stall-liveness-red.test.mjs and the canonical suite node impl/scripts/run-suite.mjs FROM THE REPO ROOT — all green.',
  'HARD CONSTRAINTS: (a) wire_frame_oversize kills runs (issue #28) — never read a whole file over ~1500 lines; grep -an to locate, then read targeted ranges. application.mjs/coordinator.mjs/coordination-store.mjs contain literal NUL bytes — the Read tool refuses them; grep/sed via Bash only. (b) Bound every command output. (c) Do NOT git commit — the orchestrator harvests your worktree. (d) Match existing code style; minimal diffs; additive projections only (no authority moves, no new events).',
  `[attempt: ${ATTEMPT}]`,
].join(' ');

try {
  const driver = createWaveDriver(baton, {
    steering: 'nudge-on-checkpoint',
    finalization: 'claim-on-stall',
    pollIntervalMs: 15_000,
    stallTimeoutMs: 20 * 60_000,
    hardCapMs: 2 * 3_600_000,
    settleTimeoutMs: 15_000,
    saltObjectives: false,
    evidencePath: resolve(repo, 'docs/reference/evidence/semantic-progress-2026-07-31/impl-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 'semantic-progress-implementer-deepseek',
      objective: OBJECTIVE,
      exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
      scope: ['impl/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('SP-WAVE-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
