// S-2 v2 board authority implementation wave: one codex@high seat implements the S-2 v2 board/package authority primitive red-first. Usage: node run-s2-impl-wave.mjs
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[ba ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'board-authority-impl-2026-07-31'),
    routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }],
    verification: Object.freeze({ command: 'node', arguments: ['--test', 'impl/test/board-authority-red.test.mjs'] }),
  },
});

const OBJECTIVE = [
  'Implement the S-2 v2 board/package authority primitive: docs/reference/evidence/control-surface-2026-07-31/s2-board-authority-subcontract.md — the v2 section at the top is your ONLY authority (v1 below is fold context). One shared admission primitive in the serialized command path + proof-of-principal envelope + board→run binding + CAS inside the store append + the BA battery incl. the v2 amendments.',
  'COORDINATES (pre-digested): current adapter guards to retire: mcp-northbound.mjs:1332-1361/1430-1448. Lease machinery: coordination-store.mjs:1759-1889 (the by-identifier lookup :1811-1842 — its session-digest check is TAUTOLOGICAL at :1837/:1664, see the contract R-BA-1; your admission must compare a CALLER-SUPPLIED authority proof). sessionAuthority token path: mcp-northbound.mjs:1408-1428. Board store hub: coordination-store.mjs:13374-13555 (the _boardSuccessor atomic CAS seam the worker path already uses :13465-13509). Board coordinator wrappers (actor default to delete): coordinator.mjs:9703-9760. Packages: coordination-store.mjs:9325-9450. Ghost registry rows: application-semantics.mjs:1231-1289. reflex2 harness pattern for tests: impl/test/reflex2-boards-red.test.mjs.',
  'METHOD (red-first, skeleton FIRST): (1) your FIRST file action writes impl/test/board-authority-red.test.mjs with BA-1..BA-10 + the v2 amendments (BA-2+ impersonation via forged sessionAuthority, BA-4+ foreign-run binding refusal, BA-5+ instrumented interleaving inside the append seam, BA-6+ drop guarded, BA-7+ read posture, BA-8+ key+content idempotency, BA-9+ existence placement) exactly as the v2 contract pins them. Run it; watch it fail for the right reasons. (2) Implement until green: the closed envelope {sessionAuthority, runId, board, item, mutation, expectedBoardFence, idempotencyKey}; the NEW admission entry comparing caller-supplied proof to lease.session.authorityDigest (NEVER feeding the lease its own digest); board→runId binding at creation + one-time recorded adoption for pre-v2 boards; the five mutations through the primitive with CAS inside the store append; refusal order exactly per the contract (shape → authority → run state → item existence → fence → parent → replay); MCP guards retired to thin adapters (source-scan pinned); facade lease acquisition path. (3) VERIFY: node --test impl/test/board-authority-red.test.mjs impl/test/reflex2-boards-red.test.mjs impl/test/mcp-reflex-board-package-red.test.mjs impl/test/reflex3-packages-red.test.mjs and node impl/scripts/run-suite.mjs FROM THE REPO ROOT — all green.',
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
    evidencePath: resolve(repo, 'docs/reference/evidence/control-surface-2026-07-31/ba-impl-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 'board-authority-implementer-codex',
      objective: OBJECTIVE,
      exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
      scope: ['impl/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('ba-WAVE-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
