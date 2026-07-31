// CS implementation wave: one grok@high seat implements the control-surface contract v2
// (CS-1..CS-4) red-first. Decorrelated from the codex red-team. Orchestrator harvests the
// worktree on completion. Usage: node run-impl-wave.mjs
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[cs ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'cs-impl-2026-07-31'),
    routes: [{ harness: 'grok', model: 'grok-4.5', effort: 'high' }],
    verification: Object.freeze({ command: 'node', arguments: ['--test', 'impl/test/cli-dead-paths-red.test.mjs'] }),
  },
});

const OBJECTIVE = [
  'Implement the control-surface contract v2: read docs/reference/evidence/control-surface-2026-07-31/control-surface-decisions.md — ONLY the v2 section at the top (the v1 tail is superseded). Its Rules 1-5, Rungs CS-1..CS-4, and Red-first section are your authority.',
  'METHOD (red-first): (1) write the three red suites exactly as the contract pins them — impl/test/control-surface-truth-red.test.mjs, impl/test/cli-dead-paths-red.test.mjs, impl/test/run-debug-surface-red.test.mjs — run each and watch it fail for the right reason. (2) Implement until green: CS-1 executable per-profile inventories + docs regenerated from them (CLI.md/MCP.md generated regions only; hand inventories deleted) + executable main in impl/scripts/surface-conformance.mjs + prose-inventory lint; CS-2 run.resume dispatched to run.resume_work + the five web-admitted verbs added to the CLI web-client whitelist + context eval parse-time typed refusal (or host dispatch if one is already wired — pin by test) + baton_runs advertised on the MCP application surface OR removed from dispatch (pin by test); CS-3 run.debug canonical registry row (key run.debug, profile ordinary, surfaces {embedded, cli}, effect observe, mapping application.mjs:10503) + BatonRun.debug() accessor + baton run debug dispatch; CS-4 deterministic checked-inventory artifact regenerating byte-stable. (3) VERIFY: node --test the three red suites, node impl/scripts/surface-conformance.mjs, and the canonical suite node impl/scripts/run-suite.mjs FROM THE REPO ROOT (never cd impl first) — all green.',
  'HARD CONSTRAINTS: (a) wire_frame_oversize kills runs (issue #28) — never read a whole file over ~1500 lines; grep -an to locate, then read targeted ranges. application.mjs, coordinator.mjs and coordination-store.mjs contain literal NUL bytes — the Read tool refuses them; use grep/sed via Bash for those. (b) Bound every command output. (c) Do NOT git commit — the orchestrator harvests your worktree. (d) Match existing code style; minimal diffs; no refactors beyond the contract.',
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
    evidencePath: resolve(repo, 'docs/reference/evidence/control-surface-2026-07-31/impl-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 'cs-implementer-grok',
      objective: OBJECTIVE,
      exact: { harness: 'grok', model: 'grok-4.5', effort: 'high' },
      scope: ['impl/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('CS-WAVE-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
