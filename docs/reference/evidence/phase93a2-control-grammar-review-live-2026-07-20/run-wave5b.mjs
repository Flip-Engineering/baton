import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Wave 5b — responsive workflow round: reviewer/challenger over the wave-3.5
// fix commit, then typed feedback + revise_candidate successor round.
// Polls for verified candidates (the wave-5 one-shot scan raced verification).

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const evidencePath = resolve(evidenceDir, 'evidence-wave5b.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/phase93a-control-grammar-red.test.mjs'],
});
const SONNET = Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' });
const KIMI = Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' });

const baton = await openBaton({ repo, advanced: { routes: [SONNET, KIMI], verification: VERIFY } });
const log = (line) => console.log(`[wave5b ${new Date().toISOString()}] ${line}`);
const evidence = { schemaVersion: 1, events: [], stops: [], failure: null };
const startedAt = Date.now();
let failure = null;
let run = null;
try {
  const readiness = await baton.doctor();
  for (const exact of [SONNET, KIMI]) {
    const ready = readiness.routes.find((candidate) => (
      candidate.harness === exact.harness && candidate.model === exact.model && candidate.effort === exact.effort
    ));
    if (ready?.state !== 'ready') {
      throw Object.assign(new Error(ready?.summary ?? `${exact.harness} unavailable`), { code: ready?.code ?? 'route_unavailable' });
    }
  }
  run = await baton.review([
    'Review the wave-3.5 fix commit (git show 4cbc864) on the Phase 93a.2 Program-IR slice:',
    'the transitive settle-then-read walk in impl/src/program-ir/normalize-program.mjs and its',
    'spec amendment. Reviewer: confirm the collect-laundering hole is closed. Challenger: try',
    'to re-open it with a concrete Program. READ-ONLY; never write scratch files (including',
    '/tmp). Do not invoke nested Baton. Run the pinned verification.',
  ].join(' '), { routes: [SONNET, KIMI] });
  log(`review workflow started as ${run.id}`);
  await run.approve();
  log('approved');

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

  // Phase 1: poll for a verified candidate (deadline 30 min).
  let selectedRole = null;
  while (Date.now() - startedAt < 30 * 60 * 1000) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const candidates = await run.candidates();
    const items = candidates?.view?.section?.items ?? [];
    const ready = items.find((item) => item.state === 'verified');
    const view = await run.status();
    const phase = (view?.view ?? view)?.phase ?? '?';
    log(`poll ${Math.round((Date.now() - startedAt) / 1000)}s phase=${phase} candidates=${items.map((item) => item.state).join(',') || 'none'}`);
    if (ready) {
      selectedRole = ready.value?.role ?? ready.value?.attempt;
      break;
    }
    if (['stopped', 'failed', 'cancelled'].includes(phase)) break;
    armPump();
  }
  if (!selectedRole) throw new Error('no verified candidate within deadline');
  await run.select(selectedRole, 'Orchestrator selects the verified candidate for the responsive round.');
  evidence.events.push({ kind: 'selected', role: selectedRole, at: new Date().toISOString() });
  log(`selected ${selectedRole}`);

  // Phase 2: typed feedback + revise_candidate.
  await run.sendFeedback(selectedRole, {
    kind: 'operator_note',
    text: 'Responsive feedback: before acceptance, the revision must re-run the three collect-laundered exploit Programs through normalizeProgramSource and quote the exact refusal strings verbatim.',
  });
  evidence.events.push({ kind: 'feedback', role: selectedRole, at: new Date().toISOString() });
  log('typed feedback recorded');
  await run.revise('Orchestrator-issued revision round over typed feedback.');
  evidence.events.push({ kind: 'revise_admitted', at: new Date().toISOString() });
  log('revise_candidate admitted — successor round dispatched');

  // Phase 3: poll the revision round to a new verified candidate or terminal.
  const revisionDeadline = Date.now() + 30 * 60 * 1000;
  for (;;) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const rounds = await run.rounds();
    const roundItems = rounds?.view?.section?.items ?? [];
    const view = await run.status();
    const phase = (view?.view ?? view)?.phase ?? '?';
    log(`revision poll phase=${phase} rounds=${roundItems.map((item) => `${item.value?.round}:${item.value?.state ?? item.state}`).join(',')}`);
    if (phase === 'selection_required' || outlineTerminal(view) || Date.now() > revisionDeadline) {
      evidence.events.push({ kind: 'revision_settled', phase, at: new Date().toISOString() });
      break;
    }
    armPump();
  }
} catch (error) {
  failure = error;
  evidence.failure = { name: error.name, code: error.code ?? null, message: error.message };
} finally {
  if (run) {
    try {
      const stopped = await run.stop('wave-5b responsive round settled.');
      evidence.stops.push({ runId: run.id, stop: stopped.stop ?? null, ownership: stopped.ownership ?? null });
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
function outlineTerminal(view) {
  const outline = view?.view ?? view;
  return outline?.terminal === true || ['stopped', 'failed', 'cancelled', 'completed', 'work_completed'].includes(outline?.phase);
}
if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
