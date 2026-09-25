// BD-A3 implementation wave (kernel projections): one grok@high seat implements the
// (sonnet died 3x on this task — 2x #55 stall-kill pre-fix, 1x long-turn seat behavior;
// grok proved on the CS-1..CS-4 implementation. Same coordinate-rich objective.)
// bidirectional v2 contract's PROJECTION half red-first — durable pause-origin claim,
// sanitize pipeline, deadlineAt, tombstones, one-pending admission (BD-1/BD-2/BD-4/BD-5).
// Decomposed after the full-scope wave stalled mid-research with zero edits (issue #55).
// Usage: node run-impl-a-wave.mjs
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[bd ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'bidirectional-impl-a3-2026-07-31'),
    routes: [{ harness: 'grok', model: 'grok-4.5', effort: 'high' }],
    verification: Object.freeze({ command: 'node', arguments: ['--test', 'impl/test/bidirectional-driver-red.test.mjs'] }),
  },
});

const OBJECTIVE = [
  'Implement the KERNEL-PROJECTION half of the bidirectional v2 contract: docs/reference/evidence/bidirectional-2026-07-31/bidirectional-decisions.md v2 section, rules 1, 2, 4 and 5 ONLY + red rows BD-1/BD-2/BD-4/BD-5. The wave-driver rules (3, 6, 7) and rows BD-3/BD-6/BD-7/BD-8 are a LATER wave — do not touch wave-driver.mjs.',
  'COORDINATES (pre-digested reading list — go straight here, no broad exploration): turn.paused mint + pause record: coordinator.mjs:1986-2032 (_admitPauseRecord). pausedTurnStatus: coordinator.mjs:2043-2051. turn_checkpoint attention entry: application.mjs:7099-7110. projectDecisionAttention: application.mjs:337-357 (+ semantic action target :9073-9086, decisionList :8985-8999). Sanitize helpers: messages.mjs:367-377 (wrapProse) and :410-438 (scalar-aware byte bound). Decision admission (one-pending refusal lands here): coordinator.mjs:10695-10754. decision.settled/decision.expired durable events: coordinator.mjs:9029-9033 and :9074-9103. Test harness pattern to copy: impl/test/wave-driver-policy-red.test.mjs:39-140 (PausableAdapter). Decision script rows in the mock: impl/src/adapter.mjs:590-610.',
  'METHOD (red-first, skeleton FIRST): (1) your FIRST file action writes impl/test/bidirectional-driver-red.test.mjs with the BD-1/BD-2/BD-4/BD-5 rows (names + contract-pinned assertions; harness copied from wave-driver-policy-red.test.mjs). Run it; watch the rows fail for the right reason. (2) Implement row by row until green: durable origin field in the turn.paused payload at _admitPauseRecord (sanitized AT MINT exactly per rule 2: wrapProse(workerId, boundedAttentionText(summary, 240)), redact-before-truncate, shared messages.mjs sanitizer); pausedTurnStatus + the attention entry carry claim ONLY from the durable origin; projectDecisionAttention gains deadlineAt (+ action target + decisionList); the bounded decisionSettled tombstone projection from decision.settled/decision.expired; one-pending-decision admission refusal decision_already_pending (durable, typed). (3) VERIFY: node --test impl/test/bidirectional-driver-red.test.mjs impl/test/reflex1-decision-requests-red.test.mjs impl/test/turn-checkpoints-31b5-surface-red.test.mjs and the canonical suite node impl/scripts/run-suite.mjs FROM THE REPO ROOT — all green.',
  'HARD CONSTRAINTS: (a) wire_frame_oversize kills runs (issue #28) — never read a whole file over ~1500 lines; grep -an to locate, then read targeted ranges. application.mjs/coordinator.mjs/coordination-store.mjs contain literal NUL bytes — the Read tool refuses them; grep/sed via Bash only. (b) Bound every command output. (c) Do NOT git commit — the orchestrator harvests your worktree. (d) Match existing code style; minimal diffs; the pause state machine, trust gate, decision record semantics, and answer path are UNTOUCHED (projection + the one admission refusal only).',
  `[attempt: ${ATTEMPT}]`,
].join(' ');

try {
  const driver = createWaveDriver(baton, {
    steering: 'nudge-on-checkpoint',
    finalization: 'claim-on-stall',
    pollIntervalMs: 20_000,
    stallTimeoutMs: 15 * 60_000,
    hardCapMs: 3 * 3_600_000,
    settleTimeoutMs: 15_000,
    saltObjectives: false,
    evidencePath: resolve(repo, 'docs/reference/evidence/bidirectional-2026-07-31/impl-a3-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 'bd-a3-implementer-grok',
      objective: OBJECTIVE,
      exact: { harness: 'grok', model: 'grok-4.5', effort: 'high' },
      scope: ['impl/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('BD-WAVE-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
