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
    deploymentRoot: resolve(repo, '.baton', 's1-redteam-2026-07-31'),
    routes: [{ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

const OBJECTIVE = [
  'You are the adversarial red-team for docs/reference/evidence/control-surface-2026-07-31/s1-wave-grammar-amendment.md (v1).',
  'Deliverable: write docs/reference/evidence/control-surface-2026-07-31/s1-redteam-v1.md — verdict line + findings skeleton in your FIRST work turn, then deepen finding by finding.',
  'Verify EVERY citation against the live code: docs/36-unified-control-grammar.md:289-294/324-326/512-514 (L5 preset model + quiesce), application-semantics.mjs:1088-1105 (derivation rules), wave.mjs:157-296 (createWave/attachWave), application-client.mjs:1495-1507 (waves getter), application-deployment.mjs:1188-1195 (facade parity gap), application.mjs:144-167 (command table), mcp-northbound.mjs:7-9/63-93 (MCP application entries + capability map), web-northbound.mjs:14-73 (web entries + ARG_FIELDS), the W93 suite impl/test/wave-attach-red.test.mjs.',
  'Hunt: (1) the portability decision itself — is attach-as-portable sound given the binding proof is server-side, or does transporting it leak an authority the embedding-only posture deliberately holds; (2) preset-sugar registration — can waves.start register as a preset without forking the command-table model (R-CS-2 warned both ways); (3) hidden-by-declaration for mintWaveDetached/waveId — is the registry flag implementable without transport-specific schema hacks; (4) WG-1..WG-5 gaps — what ships green but broken; (5) the quiesce/digest discipline — is one-commit landing realistic.',
  'Format: verdict (SOUND / SOUND-WITH-FOLDS / UNSOUND) then findings R-WG-1..N each with severity (P0/P1/P2), grounding (file:line), the failure, and the minimal repair. End with a surviving-sections list.',
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
    evidencePath: resolve(repo, 'docs/reference/evidence/control-surface-2026-07-31/s1-redteam-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 's1-redteam-deepseek',
      objective: OBJECTIVE,
      exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
      scope: ['docs/reference/evidence/control-surface-2026-07-31/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('REDTEAM-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
