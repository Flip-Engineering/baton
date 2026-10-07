import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Wave 3.5 — single implementer seat (claude-sonnet-5) closing the converged
// wave-3 findings (blue-review P0-1/P1-2/P1-3 + redraft-redteam CE1/CE2/P1-3..6)
// red-first, per the orchestrator's eight design decisions. Driver v4 semantics.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase93a2-control-grammar-review-live-2026-07-20';
const evidencePath = resolve(evidenceDir, 'evidence-wave35.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: [
    '--test',
    'impl/test/phase93a-canonical-identity-red.test.mjs',
    'impl/test/phase93a-schema-values-red.test.mjs',
    'impl/test/phase93a-source-schema-red.test.mjs',
    'impl/test/phase93a-control-grammar-red.test.mjs',
  ],
});

const baton = await openBaton({
  repo,
  advanced: {
    routes: [{ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[wave3.5 ${new Date().toISOString()}] ${line}`);
const evidence = { schemaVersion: 1, outcomes: [], stops: [], progress: [], steering: [], failure: null };
const startedAt = Date.now();
let failure = null;
let run = null;
try {
  const readiness = await baton.doctor();
  const exact = { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' };
  const ready = readiness.routes.find((candidate) => (
    candidate.harness === exact.harness && candidate.model === exact.model && candidate.effort === exact.effort
  ));
  if (ready?.state !== 'ready') {
    throw Object.assign(new Error(ready?.summary ?? 'route unavailable'), { code: ready?.code ?? 'route_unavailable' });
  }
  run = await baton.runs.start([
    'Close the converged wave-3 review findings on the Phase 93a.2 Program-IR slice, RED-FIRST.',
    'Your binding contract is docs/reference/evidence/phase93a2-control-grammar-review-live-',
    '2026-07-20/wave35-fix-decisions.md — eight numbered decisions plus rules; ground truth is',
    'blue-review.md and redraft-redteam.md in the same directory. Read all three first. Apply',
    'every decision exactly, red rows first (watch them fail), then implement to green. The',
    'decision doc rules are normative: no git commits, no scratch/log writes anywhere (including',
    '/tmp), pinned four suites plus full suite green, stable P93A2- ids, external-only digest',
    'regeneration. Your scope already includes the spec, the program-ir modules, the red suite,',
    'and the fixtures.',
  ].join(' '), {
    exact,
    scope: [
      'spec/phase93-closed-program-ir.md',
      'impl/src/program-ir',
      'impl/test/phase93a-control-grammar-red.test.mjs',
      'impl/test/fixtures',
    ],
  });
  log(`implementer started as ${run.id}`);
  await run.approve();
  log('approved');
  const pumpArm = { active: false };
  const armPump = () => {
    if (pumpArm.active) return;
    pumpArm.active = true;
    run.complete().then(
      (view) => { pumpArm.active = false; log(`pump returned phase=${view?.outline?.phase ?? view?.phase ?? '?'}`); },
      (error) => { pumpArm.active = false; log(`pump failed: ${error.code ?? error.message}`); },
    );
  };
  armPump();
  let terminal = false;
  while (!terminal && Date.now() - startedAt < 90 * 60 * 1000) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const view = await run.status();
    const outline = view?.view ?? view;
    const phase = outline?.phase ?? '?';
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s phase=${phase}`);
    evidence.progress.push({ at: new Date().toISOString(), phase });
    if (outline?.terminal === true || ['stopped', 'failed', 'cancelled', 'completed', 'work_completed'].includes(phase)) {
      terminal = true;
    } else {
      armPump();
    }
  }
  const outcome = { role: 'implementer' };
  const view = await run.status();
  outcome.phase = (view?.view ?? view)?.phase ?? null;
  const results = await run.inspect({ depth: 'section', section: 'result' });
  const value = results?.view?.section?.items?.[0]?.value;
  outcome.resultSha = /^[a-f0-9]{40,64}$/u.test(value?.sha ?? '') ? value.sha : null;
  if (!outcome.resultSha) {
    const pins = execFileSync('/usr/bin/git', ['for-each-ref', 'refs/baton/results/', '--format=%(objectname) %(committerdate:unix)'], { cwd: repo, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
      .map((row) => ({ sha: row.split(' ')[0], at: Number(row.split(' ')[1]) }))
      .filter((pin) => pin.at * 1000 >= startedAt - 60000)
      .sort((a, b) => b.at - a.at);
    outcome.resultSha = pins[0]?.sha ?? null;
    if (outcome.resultSha) outcome.materializedVia = 'refs/baton/results fallback';
  }
  log(`implementer result: ${outcome.resultSha ?? 'none'} (phase ${outcome.phase})`);
  evidence.outcomes.push(outcome);
} catch (error) {
  failure = error;
  evidence.failure = { name: error.name, code: error.code ?? null, message: error.message };
} finally {
  if (run) {
    try {
      const stopped = await run.stop('wave-3.5 fix seat settled.');
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
if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
