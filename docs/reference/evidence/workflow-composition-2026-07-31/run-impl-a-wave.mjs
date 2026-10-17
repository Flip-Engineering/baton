// RC-A recipes implementation wave: one glm-5.2@high seat implements the composition v2
// contract's FIRST rung (recipe schema + renderer + invocation manifest + implementContract
// preset + same-key run/attach) red-first. Usage: node run-impl-a-wave.mjs
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[rca ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'recipes-impl-a-2026-07-31'),
    routes: [{ harness: 'glm', model: 'glm-5.2', effort: 'high' }],
    verification: Object.freeze({ command: 'node', arguments: ['--test', 'impl/test/recipes-red.test.mjs'] }),
  },
});

const OBJECTIVE = [
  'Implement rung RC-A of the composition v2 contract: docs/reference/evidence/workflow-composition-2026-07-31/composition-decisions.md — the v2 section (and the v2.1 amendment) at the top is your ONLY authority (v1 below is fold context; rungs RC-B/RC-C/RC-D are LATER, do not build them). Scope: the normative recipe schema (rule 1), the renderer (rule 2), baton.recipes embedded-facade library (rule 3), the invocation manifest identity boundary, and the implementContract preset + same-key run/attach behavior — with the RC-1..RC-3 + RC-5 + RC-6 red rows.',
  'COORDINATES (pre-digested): the driver you wrap: impl/src/wave-driver.mjs:140-166 (createWaveDriver + run(options) + policy closure :29-104 — your data-only policy allowlist maps onto it). Wave start/attach: impl/src/wave.mjs:157-296. The facade where baton.recipes lands (get waves() pattern): impl/src/application-client.mjs:1495-1507. Idempotency-key → deterministic waveId: wave.mjs:172-179. W93 attach taxonomy to honor: impl/test/wave-attach-red.test.mjs. The bespoke scripts this retires (reference patterns for implementContract — the member shape, evidence path, deployment root): docs/reference/evidence/control-surface-2026-07-31/run-impl-wave.mjs and docs/reference/evidence/bidirectional-2026-07-31/run-impl-b-wave.mjs. The v2.1 acceptance law: no new orchestration wave may require a new script file.',
  'METHOD (red-first, skeleton FIRST): (1) your FIRST file action writes impl/test/recipes-red.test.mjs with the RC-1/RC-2/RC-3/RC-5/RC-6 rows exactly as the v2 contract pins them (schema battery incl. function-value refusal; renderer salt-as-input; manifest mint/load/attach with identical runIds + zero additional starts on same-key retry; run options never entering the digest; override allowlist merge + post-merge revalidation; implementContract over a MockAdapter seat returning the createWaveDriver receipt shape). Run it; watch it fail for the right reasons. (2) Implement until green: impl/src/recipes.mjs + the facade accessor (bindBaton surface, embedded-only per rule 3). (3) VERIFY: node --test impl/test/recipes-red.test.mjs impl/test/wave-driver-red.test.mjs impl/test/wave-attach-red.test.mjs and node impl/scripts/run-suite.mjs FROM THE REPO ROOT — all green.',
  'HARD CONSTRAINTS: (a) wire_frame_oversize kills runs (issue #28) — never read a whole file over ~1500 lines; grep -an to locate, then read targeted ranges. application.mjs/coordinator.mjs/coordination-store.mjs contain literal NUL bytes — the Read tool refuses them; grep/sed via Bash only. (b) Bound every command output. (c) Do NOT git commit — the orchestrator harvests your worktree. (d) Match existing code style; minimal diffs; NO new application commands, NO registry entries, MCP/CLI/web untouched.',
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
    evidencePath: resolve(repo, 'docs/reference/evidence/workflow-composition-2026-07-31/rc-a-impl-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 'recipes-implementer-glm',
      objective: OBJECTIVE,
      exact: { harness: 'glm', model: 'glm-5.2', effort: 'high' },
      scope: ['impl/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('RCA-WAVE-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
