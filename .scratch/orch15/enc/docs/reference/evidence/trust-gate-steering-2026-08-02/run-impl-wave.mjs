// Implementation wave for the trust-gate steering epic (issues #64/#61) — THROUGH
// baton.recipes.implementContract. Seat: deepseek-v4-flash@high — the epic-scale test of
// deepseek as an implementer (operator question 2026-08-02).
// Usage: node run-impl-wave.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/trust-gate-steering-2026-08-02');
const log = (line) => console.log(`[impl ${new Date().toISOString()}] ${line}`);

const TASK = [
  'Implement the trust-gate steering epic per docs/reference/evidence/trust-gate-steering-2026-08-02/',
  'trust-gate-steering-decisions.md (v1.0+v1.0.1 — READ IT FULLY first) until',
  'impl/test/trust-gate-steering-red.test.mjs (the v1.2 red-first suite, READ IT FULLY second) is',
  'green with zero weakening edits. Anchors (verify each before editing — some files contain NUL,',
  'use grep -an + sed -n): (1) TG1 taxonomy at coordinator.mjs:10791-10806 (turn_completed',
  'dispatch) + _admitPauseRecord :2003-2063 — a pausable turn_completed with no registered driver',
  'must NOT auto-settle into _runTrustGate dispatch; it holds the pause and arms TG3\'s cycle.',
  '(2) TG3: one bounded steering cycle per pause record — policy nudge via the worker control lane',
  '(provenance prefix \'baton-progress-check:\', sanitized through messages.mjs\'s 6-pattern SECRET',
  'pipeline + NFKC + bounds), bounded window from a NEW Coordinator opts knob progressNudgeWindowMs',
  '(default 300_000; deployment wires it in application-deployment.mjs near :1710); answers: diff',
  'capture, TG2-class receipt, resumed turn, or claim; on expiry unanswered the pause settles and',
  'the FULL gate runs with steered:{nudgeId,answered:false} durable on the verdict event (kind',
  '\'error\', the :11460+ mint). Once per record (epoch-keyed); drivered runs unchanged (the',
  'hasDriver path at :2051 stays); claimTurn counts as the answer and never mints the expiry',
  'receipt. (3) TG2 evidence rules at the cycle\'s answer detection: scratchpad.write_result',
  'ok:true receipts dedupe by content digest (one distinct answers); question.asked/',
  'decision.requested/approval.requested count only when resolved inside the window; pending or',
  'past-deadline interactions never count. (4) TG4: the terminal cause keeps naming the gate',
  '(policy_failure + exact code — coordinator.mjs:12051-12055 region) and the verdict event',
  'carries sanitized {gate, detail} (digests, never path strings). (5) TG5: analysis:true as a',
  'closed plan-node field — goal-plan.mjs normalizeNode (:296 area) accepts it, a node omitting',
  'required repository_edit WITHOUT it fails GoalPlanValidationError with an analysis-named',
  'message, and the gate\'s required_effect phase (coordinator.mjs:11160-11175) skips nodes whose',
  'brief carries analysis:true while every other phase runs unchanged (T14c: path_scope still',
  'fires). (6) The mid-window worker is ALIVE (no verdict before window expiry — T7b/T8b assert',
  'the timing). Verify: node --test impl/test/trust-gate-steering-red.test.mjs, then adjacents:',
  'decision-gate-trust-gate-red, phase73-required-effects, reflex1-decision-requests-red,',
  'diagnostics-red, wave-driver-red — all from the repo root.',
].join(' ');

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'trust-gate-steering-impl-2026-08-02'),
    routes: [{ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }],
    verification: Object.freeze({ command: 'node', arguments: ['--test', 'impl/test/trust-gate-steering-red.test.mjs'] }),
  },
});

try {
  const receipt = await baton.recipes.implementContract({
    route: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
    scope: ['impl/**', 'docs/reference/evidence/trust-gate-steering-2026-08-02/**'],
    task: TASK,
    idempotencyKey: 'trust-gate-steering-impl-2026-08-02',
    manifestPath: resolve(EVIDENCE, 'impl-manifest.json'),
    evidencePath: resolve(EVIDENCE, 'impl-evidence.json'),
  });
  writeFileSync(resolve(EVIDENCE, 'impl-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  log(`implementation settled: ${(receipt?.outcomes ?? []).map((o) => `${o.role}=${o.phase}`).join(' ')}`);
  log('IMPL-DONE');
} finally {
  await baton.close().catch(() => {});
}
