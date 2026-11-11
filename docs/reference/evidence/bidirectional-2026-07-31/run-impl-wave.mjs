// Bidirectional implementation wave: one sonnet@high seat implements the bidirectional
// ergonomics contract (BD-1..BD-6) red-first. LAUNCH ONLY after the codex red-team fold is
// committed (the contract's v2 section is the authority). Usage: node run-impl-wave.mjs
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[bd ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'bidirectional-impl-2026-07-31'),
    routes: [{ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }],
    verification: Object.freeze({ command: 'node', arguments: ['--test', 'impl/test/bidirectional-driver-red.test.mjs'] }),
  },
});

const OBJECTIVE = [
  'Implement the bidirectional ergonomics contract: read docs/reference/evidence/bidirectional-2026-07-31/bidirectional-decisions.md — the LATEST version section at the top is your authority (v1 plus any fold notes; if a v2 section exists it supersedes).',
  'METHOD (red-first): (1) write impl/test/bidirectional-driver-red.test.mjs with rows BD-1..BD-6 exactly as the contract pins them (claim-bit projection in pausedTurnStatus + the turn_checkpoint attention entry; driver classification of decision-parked/parked-done/parked-working/working; onDecision gating through run.answer with the full refusal taxonomy; deadlineAt projection; follow-based wake with the disabled-fallback; L6 no-regression). Run it, watch every row fail for the right reason. (2) Implement until green, projection-side only: coordinator.mjs pausedTurnStatus (bounded sanitized claim from record.workerResult — claim field ABSENT for non-completed parks), application.mjs turn_checkpoint attention entry + projectDecisionAttention deadlineAt, wave-driver.mjs extractors/classification/policy.onDecision/follow-raced sleep. (3) VERIFY: node --test impl/test/bidirectional-driver-red.test.mjs impl/test/wave-driver-policy-red.test.mjs impl/test/wave-driver-red.test.mjs impl/test/wave-attach-red.test.mjs and the canonical suite node impl/scripts/run-suite.mjs FROM THE REPO ROOT — all green.',
  'HARD CONSTRAINTS: (a) wire_frame_oversize kills runs (issue #28) — never read a whole file over ~1500 lines; grep -an to locate, then read targeted ranges. application.mjs/coordinator.mjs/coordination-store.mjs contain literal NUL bytes — the Read tool refuses them; grep/sed via Bash only. (b) Bound every command output. (c) Do NOT git commit — the orchestrator harvests your worktree. (d) Match existing code style; minimal diffs; the pause state machine, trust gate, decision records, and answer path are UNTOUCHED (projection additions only).',
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
    evidencePath: resolve(repo, 'docs/reference/evidence/bidirectional-2026-07-31/impl-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 'bidirectional-implementer-sonnet',
      objective: OBJECTIVE,
      exact: { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
      scope: ['impl/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('BD-WAVE-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
