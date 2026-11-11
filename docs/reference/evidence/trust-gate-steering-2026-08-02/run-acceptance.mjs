// #64 QUALITATIVE ACCEPTANCE — the retry-4 kill scenario re-run: a read-heavy glm surveyor
// with report-LAST ordering (turn 1 = reads + scratchpad writes, NO in-scope diff) and ZERO
// skeleton-first coaching anywhere in its objective. Pre-epic this worker died at the
// trust gate (required_effect_absent at its first checkpoint). Post-epic it must live:
// checkpoint → driver claim cadence (or the policy cycle) → completes with its real deliverable.
// Usage: node run-acceptance.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton, createWaveDriver } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/trust-gate-steering-2026-08-02');
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[accept ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'trust-gate-acceptance-2026-08-02'),
    routes: [{ harness: 'glm', model: 'glm-5.2', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

try {
  const driver = createWaveDriver(baton, {
    steering: 'nudge-on-checkpoint', finalization: 'claim-on-stall',
    pollIntervalMs: 15_000, stallTimeoutMs: 20 * 60_000, hardCapMs: 40 * 60_000,
    settleTimeoutMs: 15_000, saltObjectives: false, preflight: true,
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 'reader',
      exact: { harness: 'glm', model: 'glm-5.2', effort: 'high' },
      scope: ['docs/reference/evidence/trust-gate-steering-2026-08-02/**'],
      objective: [
        `[attempt: steering-acceptance-${ATTEMPT}]`,
        'You are a read-heavy surveyor. Read impl/src/coordinator.mjs lines 11119-11200 (the trust gate) and lines 2003-2063 (the pause record).',
        'In your FIRST turn, do analysis ONLY — do NOT write any file yet. Instead print exactly one SCRATCHPAD_WRITE line (TEXT you print, never a tool you call):',
        'SCRATCHPAD_WRITE: {"entry":{"kind":"note","text":"The gate evaluates capture, forbidden effects, path scope, required effects, environment, and structural evidence at dispatch; its required_effect phase is the progress judgment."},"expectedFence":"current","idempotencyKey":"tgs-accept-note-1"}',
        'Keep reading across as many turns as you need. ONLY in your FINAL turn, write docs/reference/evidence/trust-gate-steering-2026-08-02/acceptance-reader-report.md: three short sections (What the gate checks / When it fires / Why mid-workflow analysis is legitimate work), each grounded in the lines you read.',
      ].join(' '),
    }],
  });
  const outcome = receipt.outcomes?.[0] ?? {};
  writeFileSync(resolve(EVIDENCE, 'acceptance-receipt.json'), `${JSON.stringify({
    attempt: ATTEMPT,
    outcome: { phase: outcome.phase, resultSha: outcome.resultSha ?? null },
    basis: receipt.basis ?? null,
    nudges: receipt.nudges?.length ?? 0,
    claims: receipt.claims ?? [],
    knowledge: receipt.knowledge ?? null,
  }, null, 2)}\n`);
  log(`outcome: ${outcome.phase}, result ${outcome.resultSha ?? 'none'}, nudges ${receipt.nudges?.length ?? 0}, claims ${(receipt.claims ?? []).length}`);
  log(outcome.phase === 'result_ready' ? 'ACCEPTANCE-OK' : 'ACCEPTANCE-INCOMPLETE');
} finally {
  await baton.close().catch(() => {});
}
