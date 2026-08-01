// #11 post-landing live receipt: the first real single-flight refresh through the baton
// facade. Reads the credential cache metadata, invokes credentials.refresh('claude') (the
// explicit consent ceremony), and records before/after + the observed vendor write-back
// target. Isolated deployment root; never touches worker runtimes. Usage: node live-refresh-receipt.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const OUT = resolve(repo, 'docs/reference/evidence/setup-token-2026-07-31/LIVE-REFRESH-RECEIPT.json');
const log = (line) => console.log(`[live ${new Date().toISOString()}] ${line}`);
const receipt = { at: new Date().toISOString(), steps: [] };

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'setup-token-live-receipt-2026-08-01'),
    routes: [{ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'low' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

try {
  const doctorBefore = await baton.doctor();
  const claudeBefore = doctorBefore.routes.find((route) => route.harness === 'claude-code');
  receipt.steps.push({ step: 'doctor-before', credential: claudeBefore?.credential ?? null, state: claudeBefore?.state ?? null });
  log(`before: state=${claudeBefore?.state}, credential=${JSON.stringify(claudeBefore?.credential ?? null)}`);

  log('invoking credentials.refresh(claude) — the explicit single-flight');
  const refreshed = await baton.credentials.refresh('claude');
  receipt.steps.push({ step: 'refresh-result', result: refreshed ?? null });
  log(`refresh result: ${JSON.stringify(refreshed ?? null).slice(0, 500)}`);

  const doctorAfter = await baton.doctor();
  const claudeAfter = doctorAfter.routes.find((route) => route.harness === 'claude-code');
  receipt.steps.push({ step: 'doctor-after', credential: claudeAfter?.credential ?? null, state: claudeAfter?.state ?? null });
  log(`after: state=${claudeAfter?.state}, credential=${JSON.stringify(claudeAfter?.credential ?? null)}`);
} catch (error) {
  receipt.steps.push({ step: 'error', code: error?.code ?? null, message: String(error?.message ?? error) });
  log(`error: ${error?.code ?? ''} ${String(error?.message ?? error).slice(0, 300)}`);
} finally {
  await baton.close().catch(() => {});
}
writeFileSync(OUT, `${JSON.stringify(receipt, null, 2)}\n`);
log(`receipt written: ${OUT}`);
