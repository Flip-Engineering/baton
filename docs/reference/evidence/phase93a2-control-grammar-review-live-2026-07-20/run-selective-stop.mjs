import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Selective-stop proof: a two-replica homogeneous workflow; stopMember one
// member EARLY (while definitely active), prove the sibling completes, and
// record exact stop/zero-residue receipts.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase93a2-control-grammar-review-live-2026-07-20';
const evidencePath = resolve(evidenceDir, 'evidence-selective-stop.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/phase93a-control-grammar-red.test.mjs'],
});
const KIMI = Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' });

const baton = await openBaton({ repo, advanced: { routes: [KIMI], verification: VERIFY } });
const log = (line) => console.log(`[selstop ${new Date().toISOString()}] ${line}`);
const evidence = { schemaVersion: 1, stopReceipt: null, sibling: null, stops: [], failure: null };
let failure = null;
let run = null;
const startedAt = Date.now();
try {
  const readiness = await baton.doctor();
  const ready = readiness.routes.find((candidate) => (
    candidate.harness === KIMI.harness && candidate.model === KIMI.model && candidate.effort === KIMI.effort
  ));
  if (ready?.state !== 'ready') {
    throw Object.assign(new Error(ready?.summary ?? 'kimi route unavailable'), { code: ready?.code ?? 'route_unavailable' });
  }
  const team = ['alpha', 'beta'].map((role) => ({ role, exact: KIMI }));
  run = await baton.workflow([
    'You are one of two identical kimi-code/k3/high replicas. Perform a THOROUGH, unhurried',
    'review of impl/src/program-ir/normalize-program.mjs against spec/phase93-closed-program-ir.md',
    '§93.9: read every function, trace the demand walk and settlement domains by hand, and write',
    'a detailed report of at least 60 lines covering conformance, corner cases, and anything',
    'suspicious. Work slowly and carefully; this is a deliberate long task.',
    `Write ONLY ${relativeRoot}/selstop-<YOUR-ROLE>.md with headings: ## Verdict,`,
    '## P0-P1 findings, ## Required corrections. READ-ONLY otherwise; never write scratch files',
    '(including /tmp). Do not invoke nested Baton. Run the pinned verification before finishing.',
  ].join(' '), { team, scope: [`${relativeRoot}/selstop-*`] });
  log(`workflow started as ${run.id}`);
  await run.approve();
  log('approved; waiting for both members active, then selective stop on beta');
  await new Promise((resolveWait) => setTimeout(resolveWait, 75000));
  try {
    await run.stopMember('beta', 'Selective member stop: sibling-survival proof.');
    evidence.stopReceipt = { state: 'admitted', at: new Date().toISOString() };
    log('stopMember beta admitted');
  } catch (error) {
    evidence.stopReceipt = { state: 'failed', code: error.code ?? null, message: error.message };
    log(`stopMember beta failed: ${error.code ?? error.message}`);
  }
  const pumpArm = { active: false };
  const armPump = () => {
    if (pumpArm.active) return;
    pumpArm.active = true;
    run.complete().then(
      () => { pumpArm.active = false; },
      () => { pumpArm.active = false; },
    );
  };
  armPump();
  let done = false;
  while (!done && Date.now() - startedAt < 45 * 60 * 1000) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const view = await run.status();
    const outline = view?.view ?? view;
    const phase = outline?.phase ?? '?';
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s phase=${phase}`);
    if (outline?.terminal === true || ['stopped', 'failed', 'cancelled', 'completed', 'work_completed', 'selection_required'].includes(phase)) {
      done = true;
      evidence.sibling = { phase, narrative: outline?.narrative ?? null };
    } else {
      armPump();
    }
  }
} catch (error) {
  failure = error;
  evidence.failure = { name: error.name, code: error.code ?? null, message: error.message };
} finally {
  if (run) {
    try {
      const stopped = await run.stop('selective-stop proof settled.');
      evidence.stops.push({ runId: run.id, stop: stopped.stop ?? null, ownership: stopped.ownership ?? null });
      log(`run stopped: ${JSON.stringify(stopped.ownership ?? stopped.stop ?? null).slice(0, 200)}`);
    } catch (error) {
      evidence.stops.push({ runId: run.id, error: { code: error.code ?? null, message: error.message } });
    }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  log(`evidence written; failure=${failure ? (failure.code ?? failure.message) : 'none'}`);
}
if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
