// W1.5 DeepSeek first live seat: one deepseek-v4-flash member driven by the SHIPPED wave
// driver (createWaveDriver, #46) with nudge-on-checkpoint steering + claim-on-stall
// finalization — the full orchestration loop, not a bare run. Task: draft the DeepSeek
// fleet-route docs section (real, bounded, in-scope). Usage: node seat-flash.mjs
import { resolve } from 'node:path';
import { createWaveDriver, openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const ATTEMPT = new Date().toISOString();
const log = (line) => console.log(`[seat ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'deepseek-seat-2026-07-31'),
    routes: [{ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'low' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

const OBJECTIVE = [
  'Draft the DeepSeek fleet-route documentation section as',
  'docs/reference/evidence/deepseek-2026-07-30/cli-fleet-section-draft.md (markdown, ~40 lines):',
  'the deepseek harness routes through the Anthropic-compatible endpoint',
  'https://api.deepseek.com/anthropic with credential file deepseek_key.json (JSON pointer',
  '/deepseek_key, mode 600, gitignored); deepseek-v4-flash is the primary model (efforts',
  'low..max); deepseek-v4-pro[1m] is a pre-update opt-in at low/medium only; doctor reports an',
  'honest blocked/authentication_required readiness when the key is absent. Cite',
  'impl/test/deepseek-routes-red.test.mjs rows DS-1..DS-4 as the pinning suite. Work in one',
  'continuous turn; write ONLY that one file.',
  `[attempt: ${ATTEMPT}]`,
].join(' ');

try {
  const driver = createWaveDriver(baton, {
    steering: 'nudge-on-checkpoint',
    finalization: 'claim-on-stall',
    pollIntervalMs: 15_000,
    stallTimeoutMs: 6 * 60_000,
    hardCapMs: 20 * 60_000,
    settleTimeoutMs: 15_000,
    saltObjectives: false,
    evidencePath: resolve(repo, 'docs/reference/evidence/deepseek-2026-07-30/seat-evidence.json'),
    onProgress: (line) => log(`progress ${line}`),
  });
  const receipt = await driver.run({
    members: [{
      role: 'deepseek-docs-drafter',
      objective: OBJECTIVE,
      exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'low' },
      scope: ['docs/reference/evidence/deepseek-2026-07-30/**'],
    }],
  });
  log(`receipt: ${JSON.stringify(receipt.outcomes ?? receipt, null, 1).slice(0, 1200)}`);
  log('SEAT-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
