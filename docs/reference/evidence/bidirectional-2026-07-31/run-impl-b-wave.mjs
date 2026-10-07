// BD-B driver ergonomics wave: one opus@high seat implements the bidirectional v2
// contract's DRIVER half (BD-3/BD-6/BD-7/BD-8) red-first — onDecision lifecycle,
// followOnce wake laws, ordered reducer controlling steering, no-regression battery.
// BD-A (the projections it consumes) is landed. Usage: node run-impl-b-wave.mjs
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[bdb ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'bidirectional-impl-b-2026-07-31'),
    routes: [{ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }],
    verification: Object.freeze({ command: 'node', arguments: ['--test', 'impl/test/bidirectional-driver-red.test.mjs'] }),
  },
});

const OBJECTIVE = [
  'Implement the DRIVER-ERGONOMICS half of the bidirectional v2 contract: docs/reference/evidence/bidirectional-2026-07-31/bidirectional-decisions.md v2 section, rules 3, 6, 7 and 8 ONLY + red rows BD-3/BD-6/BD-7/BD-8. The kernel projections (rules 1, 2, 4, 5) are LANDED — claim rides the turn_checkpoint attention entry, deadlineAt and decisionSettled tombstones are in the views; consume them, never rebuild them. Your edit surface is impl/src/wave-driver.mjs + impl/src/application-client.mjs (followOnce) + impl/test/bidirectional-driver-red.test.mjs (add the BD-3/BD-6/BD-7/BD-8 rows to the landed BD-1/2/4/5 file).',
  'COORDINATES (pre-digested): driver policy closure: wave-driver.mjs:29-104 (your onDecision policy field enters here — async, awaited, at-most-once per (runId, requestId), closed return union {optionId}|{text}|undefined, throws caught as evidence never wave-closing). checkpointOf extractor (your sibling interaction extractor lives beside it): wave-driver.mjs:134-138. The poll loop you extend: wave-driver.mjs:262-403 (status reads :262-286, marker :290-296, paused steering :298-355, sleep :403). followOnce to add on BatonRun (riding run.follow, NOT the changes() iterator which wakes on initial inspect): application-client.mjs:911-949 for the iterator to avoid, and the run.follow command at application.mjs:7535-7607 with its filtering caveat. run.answer for the answer path: application-client.mjs:1163-1170 + application.mjs:11245-11264. The landed projections you consume: the turn_checkpoint attention entry claim (application.mjs:7099-7110), decisionSettled tombstones + deadlineAt (projectDecisionAttention :337-357 region). Red-row patterns to mirror: the landed impl/test/bidirectional-driver-red.test.mjs + impl/test/wave-driver-policy-red.test.mjs:39-140 (PausableAdapter).',
  'METHOD (red-first): (1) add the BD-3/BD-6/BD-7/BD-8 rows to impl/test/bidirectional-driver-red.test.mjs exactly as the v2 contract pins them (async onDecision awaited + exactly-once per requestId + invalid-return and throw as evidence with wave unclosed + normalized outcome union; wake-before-interval on decision park + no-early-wake on unrelated traffic + active-follows-return-to-zero + cursor monotonicity + unavailable-downgrades-once + terminal members excluded; reducer precedence decision>checkpoint+claim>checkpoint>working with NO nudge/claim while any blocking interaction is pending + question/approval distinct classes + multi-interaction stable order; L6 no-regression). Run them red. (2) Implement until green. (3) VERIFY: node --test impl/test/bidirectional-driver-red.test.mjs impl/test/wave-driver-policy-red.test.mjs impl/test/wave-driver-red.test.mjs impl/test/wave-attach-red.test.mjs and node impl/scripts/run-suite.mjs FROM THE REPO ROOT — all green.',
  'HARD CONSTRAINTS: (a) wire_frame_oversize kills runs (issue #28) — never read a whole file over ~1500 lines; grep -an to locate, then read targeted ranges. application.mjs/coordinator.mjs/coordination-store.mjs contain literal NUL bytes — the Read tool refuses them; grep/sed via Bash only. (b) Bound every command output. (c) Do NOT git commit — the orchestrator harvests your worktree. (d) Match existing code style; minimal diffs; the pause state machine, trust gate, decision records, and answer path are UNTOUCHED.',
  `[attempt: ${ATTEMPT}]`,
].join(' ');

try {
  const driver = createWaveDriver(baton, {
    steering: 'nudge-on-checkpoint',
    finalization: 'claim-on-stall',
    pollIntervalMs: 20_000,
    stallTimeoutMs: 20 * 60_000,
    hardCapMs: 3 * 3_600_000,
    settleTimeoutMs: 15_000,
    saltObjectives: false,
    evidencePath: resolve(repo, 'docs/reference/evidence/bidirectional-2026-07-31/impl-b-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 'bd-b-implementer-opus',
      objective: OBJECTIVE,
      exact: { harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' },
      scope: ['impl/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('BDB-WAVE-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
