import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Minimal live probe: is grok-4.5/low provider-alive tonight?
const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase93a2-control-grammar-review-live-2026-07-20';
const GROK = Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'low' });
const baton = await openBaton({ repo, advanced: { routes: [GROK] } });
const log = (line) => console.log(`[grokprobe ${new Date().toISOString()}] ${line}`);
let failure = null;
let run = null;
const startedAt = Date.now();
try {
  const readiness = await baton.doctor();
  const ready = readiness.routes.find((candidate) => (
    candidate.harness === GROK.harness && candidate.model === GROK.model && candidate.effort === GROK.effort
  ));
  if (ready?.state !== 'ready') {
    throw Object.assign(new Error(ready?.summary ?? 'grok unavailable'), { code: ready?.code ?? 'route_unavailable' });
  }
  run = await baton.runs.start(
    `Write the single line "grok live" to ${relativeRoot}/grok-probe.txt and finish.`,
    { exact: GROK, scope: [`${relativeRoot}/grok-probe.txt`] },
  );
  log(`probe run started as ${run.id}`);
  await run.approve();
  let phase = '?';
  while (Date.now() - startedAt < 8 * 60 * 1000) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 15000));
    const view = await run.status();
    const outline = view?.view ?? view;
    phase = outline?.phase ?? '?';
    log(`phase=${phase} (${Math.round((Date.now() - startedAt) / 1000)}s)`);
    if (outline?.terminal === true || ['stopped', 'failed', 'cancelled', 'completed', 'work_completed'].includes(phase)) break;
  }
  log(`terminal phase: ${phase}`);
} catch (error) {
  failure = error;
  log(`failure: ${error.code ?? error.message}`);
} finally {
  if (run) {
    try { await run.stop('grok probe settled.'); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
