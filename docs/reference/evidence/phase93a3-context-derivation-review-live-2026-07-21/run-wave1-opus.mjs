import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// 93a.3 wave-1 follow-up: the opus spec-redteam seat (its first attempt died
// pre-work on a Claude 401). Single seat, driver v4 semantics.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase93a3-context-derivation-review-live-2026-07-21';
const evidencePath = resolve(evidenceDir, 'evidence-wave1-opus.json');
const reportPath = `${relativeRoot}/spec-redteam.md`;
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
const exact = { harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' };

const baton = await openBaton({ repo, advanced: { routes: [exact], verification: VERIFY } });
const log = (line) => console.log(`[93a3-w1o ${new Date().toISOString()}] ${line}`);
const evidence = { schemaVersion: 1, outcome: null, stops: [], failure: null };
const startedAt = Date.now();
let failure = null;
let run = null;
try {
  const readiness = await baton.doctor();
  const ready = readiness.routes.find((candidate) => (
    candidate.harness === exact.harness && candidate.model === exact.model && candidate.effort === exact.effort
  ));
  if (ready?.state !== 'ready') {
    throw Object.assign(new Error(ready?.summary ?? 'route unavailable'), { code: ready?.code ?? 'route_unavailable' });
  }
  rmSync(resolve(repo, reportPath), { force: true });
  run = await baton.runs.start([
    'Act as the adversarial red team for the Phase 93a.3a context result-schema derivation draft.',
    'Read spec/phase93-closed-program-ir.md §93.9 (context node), §93.10, §93.10A (the new draft),',
    '§93.4, §93.5, and §93.23 suite 5, then impl/src/program-ir/{normalize-program,control-nodes}.mjs',
    'and impl/src/context-program.mjs. Attack the DRAFT: the closed ContextCellValue envelope, the',
    'checked-in repository item shape, the per-op transformer table, the no-manifest-reads rule, and',
    'registry byte-match resolution. Find: shape/field-type claims about the evaluator that are wrong;',
    'transformers that cannot be computed at normalization time; op chains whose derived schema is',
    'unsatisfiable or never matches real cells; identity/canonicalization games (envelope field bounds,',
    'sorted vs semantic arrays); the project undefined-omission vs required-fields tension; and any',
    'way an author could get a weaker schema registered than the derivation demands. Verify every',
    'claim against spec text and the evaluator code with section/line citations; construct',
    'counterexample programs where possible (in-memory only, never write scratch files).',
    `Write only ${reportPath} with EXACTLY these headings:`,
    '## Verdict',
    '## P0-P1 findings',
    '## Required corrections',
    'READ-ONLY otherwise; never write scratch files (including /tmp). Do not invoke nested Baton.',
    'One shell command per call. Do not mutate credentials, harness installations, global',
    'configuration, or the main checkout. Run the pinned verification and finish.',
  ].join(' '), { exact, scope: [reportPath] });
  log(`opus spec-redteam started as ${run.id}`);
  await run.approve();
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
  let done = false;
  while (!done && Date.now() - startedAt < 60 * 60 * 1000) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const view = await run.status();
    const outline = view?.view ?? view;
    const phase = outline?.phase ?? '?';
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s phase=${phase}`);
    if (outline?.terminal === true || ['stopped', 'failed', 'cancelled', 'completed', 'work_completed'].includes(phase)) {
      done = true;
    } else {
      armPump();
    }
  }
  const outcome = { role: 'spec-redteam' };
  const view = await run.status();
  outcome.phase = (view?.view ?? view)?.phase ?? null;
  const results = await run.inspect({ depth: 'section', section: 'result' });
  const value = results?.view?.section?.items?.[0]?.value;
  let sha = /^[a-f0-9]{40,64}$/u.test(value?.sha ?? '') ? value.sha : null;
  if (!sha) {
    const pins = execFileSync('/usr/bin/git', ['for-each-ref', 'refs/baton/results/', '--format=%(objectname) %(committerdate:unix)'], { cwd: repo, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
      .map((row) => ({ sha: row.split(' ')[0], at: Number(row.split(' ')[1]) }))
      .filter((pin) => pin.at * 1000 >= startedAt - 60000)
      .sort((a, b) => b.at - a.at);
    sha = pins[0]?.sha ?? null;
    if (sha) outcome.materializedVia = 'refs/baton/results fallback';
  }
  if (sha) {
    const body = execFileSync('/usr/bin/git', ['show', `${sha}:${reportPath}`], { cwd: repo, encoding: 'utf8', maxBuffer: 512 * 1024 });
    writeFileSync(resolve(repo, reportPath), body);
    outcome.resultSha = sha;
    outcome.materialized = reportPath;
    log(`report materialized at ${sha}`);
  } else {
    outcome.resultSha = null;
    log('no preserved result');
  }
  evidence.outcome = outcome;
} catch (error) {
  failure = error;
  evidence.failure = { name: error.name, code: error.code ?? null, message: error.message };
} finally {
  if (run) {
    try {
      const stopped = await run.stop('93a.3 wave-1 opus seat settled.');
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
