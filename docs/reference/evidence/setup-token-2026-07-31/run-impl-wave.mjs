// W3.5 implementation wave: one codex@high seat implements the issue #11 contract v3
// (durable headless credential projection) red-first. Usage: node run-impl-wave.mjs
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[w35 ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'setup-token-impl-2026-07-31'),
    routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }],
    verification: Object.freeze({ command: 'node', arguments: ['--test', 'impl/test/claude-credential-projection-red.test.mjs'] }),
  },
});

const OBJECTIVE = [
  'Implement the issue #11 contract v3 (durable headless credential projection): docs/reference/evidence/setup-token-2026-07-31/setup-token-decisions.md — the v3 section at the top is your ONLY authority (v2/v1 below are fold context). Rules 1-7 as amended by v3 + the CC-1..CC-5+ red battery.',
  'COORDINATES (pre-digested): full-file registration to DELETE: application-deployment.mjs:598 (credentialFiles.claude). Env projection mechanism: runtime-isolation.mjs:104-111 (credentialEnv family loop). kimi schema-refusal discipline: application-deployment.mjs:363-372. Per-vendor summary functions to mirror (new claudeAuthenticationSummary): application-deployment.mjs:316 (kimi) and :390 (grok); wire it at claude-session.mjs:322. Guidance table that STAYS vendor-agnostic: application-semantics.mjs:1634. authenticationProbe injection seam: claude-session.mjs:370. Wire shapes for the fixture executable: claude-session.mjs:332-338. Canary (egress only): claude-session.mjs:854-884. workspaceProbe per-read pattern: application-deployment.mjs:1204/:1538. kimi seconds precedent: :353/:377.',
  'METHOD (red-first, skeleton FIRST): (1) your FIRST file action writes impl/test/claude-credential-projection-red.test.mjs with the CC-1..CC-5+ rows (names + contract-pinned assertions; the v3 doc enumerates them, including CC-2+ monotonicity/schema-gate cases, CC-4+ positive credentialFiles.claude absence + projection-tree refreshToken scan, CC-5+ revocation latch / no-second-flight / spawn-TTL-gate / vendor-agnostic guidance source-scan / lockfile + Keychain-mtime CAS). Run it; watch it fail for the right reasons. (2) Implement until green: the deployment credential cache (read once at open, Keychain-preferred via the shim seam, file fallback), credentialEnv.claude = { CLAUDE_CODE_OAUTH_TOKEN } with the :598 deletion, single-flight per-credential refresh (advisory lockfile + Keychain-mtime CAS + harvest from every write-back target with strictly-fresher-than-incumbent adoption after schema gating), revocation latch to expired_needs_login, spawn-time TTL gate, retry-once on authentication_refresh_required, doctor credential metadata {expiresAt, refreshTokenExpiresAt, state: fresh|stale|expired_needs_login, ms epoch, refresh-unverified label, Keychain-only-vs-absent typed code}, claudeAuthenticationSummary remedy. (3) VERIFY: node --test impl/test/claude-credential-projection-red.test.mjs and the canonical suite node impl/scripts/run-suite.mjs FROM THE REPO ROOT — all green.',
  'HARD CONSTRAINTS: (a) wire_frame_oversize kills runs (issue #28) — never read a whole file over ~1500 lines; grep -an to locate, then read targeted ranges. application.mjs/coordinator.mjs/coordination-store.mjs contain literal NUL bytes — the Read tool refuses them; grep/sed via Bash only. (b) Bound every command output. (c) Do NOT git commit — the orchestrator harvests your worktree. (d) Match existing code style; minimal diffs. (e) NEVER touch the real ~/.claude credentials or the macOS Keychain — fixtures and shims only.',
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
    evidencePath: resolve(repo, 'docs/reference/evidence/setup-token-2026-07-31/impl-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 'setup-token-implementer-codex',
      objective: OBJECTIVE,
      exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
      scope: ['impl/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('W35-WAVE-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
