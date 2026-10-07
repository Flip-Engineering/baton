// Red-team wave for the dynamic workflow composition contract v1: one codex@high adversarial seat under the shipped wave
// driver. Verdict + findings land in docs/reference/evidence/workflow-composition-2026-07-31/redteam-v1.md inside the evidence dir. Usage: node run-redteam-wave.mjs
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[rt ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'semantic-progress-redteam-2026-07-31'),
    routes: [{ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

const OBJECTIVE = [
  'You are the adversarial red-team for docs/reference/evidence/semantic-progress-2026-07-31/semantic-progress-decisions.md (v1).',
  'Deliverable: write docs/reference/evidence/semantic-progress-2026-07-31/redteam-v1.md — verdict line + findings skeleton in your FIRST work turn, then deepen finding by finding.',
  'Verify EVERY citation against the live code: application.mjs:321-331 (projectBlockedInteraction), :7441-7470 (_progressTiming), :7373-7398 (_followCategory noise filter), :9073-9103 (_semanticActions), :10686-10716 (runs.list item projection), wave.mjs:107-127 (attentionFrom), issue #10 via gh. Check the provider-result taxonomy for what rate-limit rows actually exist (application-semantics.mjs guidance tables + claude-session.mjs:322-337 classification) — the rate_limited class MUST ride an existing taxonomy row or stay honest.',
  'Hunt: (1) the progressClass reducer — are the boundaries total and mutually exclusive (what wins: blocked_interaction vs rate_limited vs no_progress when two hold)?; (2) requiredAction — is top-blocking-item selection well-defined across the attention array order, and is advertised-actionId presence pinned honestly (what if the action is NOT advertised)?; (3) rate_limited honesty — does an existing taxonomy row actually classify provider rate limits, or does the contract accidentally license prose-guessing; (4) SP-1..4 gaps — what ships green but broken; (5) vocabulary-identity realism across outline/list/wave/debug (MAX_RUN_VIEW_BYTES, wave progress byte cap).',
  'Format: verdict (SOUND / SOUND-WITH-FOLDS / UNSOUND) then findings R-SP-1..N each with severity (P0/P1/P2), grounding (file:line), the failure, and the minimal repair. End with a surviving-sections list.',
  'HARD CONSTRAINT (wire_frame_oversize kills runs, issue #28): never read a whole file over ~1500 lines — grep to locate, then read targeted ranges. application.mjs/coordinator.mjs/coordination-store.mjs contain NUL bytes: grep -an/sed via Bash only. Bound every command output.',
  `[attempt: ${ATTEMPT}]`,
].join(' ');

try {
  const driver = createWaveDriver(baton, {
    steering: 'nudge-on-checkpoint',
    finalization: 'claim-on-stall',
    pollIntervalMs: 20_000,
    stallTimeoutMs: 12 * 60_000,
    hardCapMs: 50 * 60_000,
    settleTimeoutMs: 15_000,
    saltObjectives: false,
    evidencePath: resolve(repo, 'docs/reference/evidence/semantic-progress-2026-07-31/redteam-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 'semantic-progress-redteam-deepseek',
      objective: OBJECTIVE,
      exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
      scope: ['docs/reference/evidence/semantic-progress-2026-07-31/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('REDTEAM-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
