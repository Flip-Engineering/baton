// Verification red-team for the issue #11 contract v2 (the R11R fold): one opus@high
// adversarial seat. Verdict + findings land in redteam-v2.md inside the evidence dir.
// Usage: node run-redteam2-wave.mjs
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[rt2 ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'setup-token-redteam2-2026-07-31'),
    routes: [{ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

const OBJECTIVE = [
  'You are the adversarial verification red-team for docs/reference/evidence/setup-token-2026-07-31/setup-token-decisions.md — the v2 section at the top ONLY (the v1 tail is the fold ledger).',
  'Deliverable: write docs/reference/evidence/setup-token-2026-07-31/redteam-v2.md — verdict line + findings skeleton in your FIRST work turn, then deepen finding by finding.',
  'v2 folded a 12-finding red-team (R11R-1..12). Your job: (1) verify every fold actually answers its finding — map each R11R number to the v2 rule/test and flag any that survives in substance; (2) hunt NEW holes in the v2 design: the deployment credential cache (staleness vs revocation, multi-deployment races on the single flight, cache lifetime), access-token-only projection via CLAUDE_CODE_OAUTH_TOKEN (does the vendor CLI actually run to expiry with no refreshToken in the runtime — check the binary strings and claude-session.mjs:332-338/854-884 + runtime-isolation.mjs:104-111 for the exact env contract; what happens at expiry mid-turn?), the harvest-from-any-target refresh (can the harvest adopt a STALER credential than the cache? a malformed one? is max(expiresAt) the right freshness rule?), retry-once (what if the 401 is revocation, not expiry — does retry-once loop a dead credential?), CC-1..CC-5 test gaps (what ships green but broken?); (3) check the citations (application-semantics.mjs:1621, runtime-isolation.mjs:104-111, claude-session.mjs:371/854-884, application-deployment.mjs:352/1457-1462, grammar-m2-red.test.mjs:36, issue53-run-debug-red.test.mjs:203).',
  'Format: verdict (SOUND / SOUND-WITH-FOLDS / UNSOUND) then findings R11V-1..N each with severity (P0/P1/P2), grounding (file:line), the failure, and the minimal repair. End with a fold-verdict table (R11R-1..12 → folded/survives).',
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
    evidencePath: resolve(repo, 'docs/reference/evidence/setup-token-2026-07-31/redteam2-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 'setup-token-redteam2-opus',
      objective: OBJECTIVE,
      exact: { harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' },
      scope: ['docs/reference/evidence/setup-token-2026-07-31/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('REDTEAM2-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
