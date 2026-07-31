// ATLAS implementation wave: one codex@high seat implements ATLAS v2 rungs AT-1..AT-3 red-first. Usage: node run-atlas-impl-wave.mjs
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[at ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'atlas-impl-2026-07-31'),
    routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }],
    verification: Object.freeze({ command: 'node', arguments: ['--test', 'impl/test/atlas-orientation-red.test.mjs'] }),
  },
});

const OBJECTIVE = [
  'Implement the ATLAS contract v2, rungs AT-1 + AT-2 + AT-3: docs/reference/evidence/atlas-2026-07-31/atlas-decisions.md — the v2 section at the top is your ONLY authority. AT-1: orientWorker gains a symbol-focus shape AND the registry invocation context carries per-call worktreeRoot (the registry authority-shape change). AT-2: the opted-in Atlas capability set {atlas-index, atlas-structural, cartographer} registers through createDriver real assembly path with budgets + ceilings, honest-empty for non-JS/TS repos. AT-3: on gate verification, diff.structural (R1) class via content-addressed artifact + ledger event, cited by run.evidence on read (NEVER written into it), verdict unchanged.',
  'COORDINATES (pre-digested): orientWorker push lane: coordinator.mjs:6359-6416 + knowledge.map_served event :6543-6550. Cartographer orientation.slice + epoch/overlay: cartographer-quartermaster.mjs:361-369. atlas-index carded ops + language ceiling: atlas-index.mjs:11-17/247-255 + overlay :172/:339. Producer mapping + the cards() single-card gate: atlas-representation-producer.mjs:13-17/143-145/289. capabilityFactories wiring: index.mjs:1256-1284. Registry invocation context to extend with worktreeRoot: capability-registry.mjs:54 + spec/capability-plane.md. atlas-structural (to register, currently test-only): atlas-structural.mjs:153/164-165. Enforcing ceiling: atlas-representation-ceiling.mjs:56-72. run.evidence read model (cite, never write): application.mjs:4428-4456. Fixture pattern for tiny JS repos: search impl/test/phase13* and impl/test/phase29* for the atlas fixtures.',
  'METHOD (red-first, skeleton FIRST): (1) your FIRST file action writes impl/test/atlas-orientation-red.test.mjs with the AT-1..AT-4 rows exactly as the v2 contract pins them (worktreeRoot in the registry context; composed NOT hand-wired deployment; cards() contains atlas-structural before any gate run; artifact+ledger with run.evidence citing the digest on read; honest empty ceiling). Run it; watch it fail for the right reasons. (2) Implement until green. (3) VERIFY: node --test impl/test/atlas-orientation-red.test.mjs and node impl/scripts/run-suite.mjs FROM THE REPO ROOT — all green.',
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
    evidencePath: resolve(repo, 'docs/reference/evidence/atlas-2026-07-31/impl-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 'atlas-implementer-codex',
      objective: OBJECTIVE,
      exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
      scope: ['impl/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('at-WAVE-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
