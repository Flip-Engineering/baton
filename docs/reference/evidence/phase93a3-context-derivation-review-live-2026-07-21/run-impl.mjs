import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// 93a.3a implementation seat (claude-sonnet-5): the closed context
// result-schema derivation per impl-decisions.md, red-first. Driver v4 semantics.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase93a3-context-derivation-review-live-2026-07-21';
const evidencePath = resolve(evidenceDir, 'evidence-impl.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: [
    '--test',
    'impl/test/phase93a-canonical-identity-red.test.mjs',
    'impl/test/phase93a-schema-values-red.test.mjs',
    'impl/test/phase93a-source-schema-red.test.mjs',
    'impl/test/phase93a-control-grammar-red.test.mjs',
    'impl/test/phase93a-context-purity-red.test.mjs',
  ],
});
const exact = { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' };

const baton = await openBaton({ repo, advanced: { routes: [exact], verification: VERIFY } });
const log = (line) => console.log(`[93a3-impl ${new Date().toISOString()}] ${line}`);
const evidence = { schemaVersion: 1, outcome: null, stops: [], progress: [], failure: null };
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
  run = await baton.runs.start([
    'Implement the Phase 93a.3a closed context result-schema derivation, RED-FIRST. Your binding',
    'contract is docs/reference/evidence/phase93a3-context-derivation-review-live-2026-07-21/',
    'impl-decisions.md (12 numbered rules); ground truth is spec/phase93-closed-program-ir.md',
    '§93.9 (context node + collect derivation), §93.10, §93.10A (current HEAD), §93.23 suite 5.',
    'Read all three first, plus impl/src/program-ir/{normalize-program,control-nodes,schema-values,',
    'canonical-value}.mjs, impl/src/context-program.mjs (purity helper + evaluator shapes), and',
    'impl/test/phase93a-control-grammar-red.test.mjs (the CTX2 temporary-refusal rows you must',
    'rewrite into acceptance rows). Deliverables and rules are exactly per impl-decisions.md:',
    'new impl/src/program-ir/context-derivation.mjs; contextNodeRefusal replaced with real',
    'normalization (grammar/policy mapping per rule 1, purity gate, per-op transformers, pinned',
    'baton.derived names, bottom-up resolution, homogeneous-only collect/finish with exact arity,',
    'by:"item"-only chunk); collect pinned-name back-port; author-aid exports; new suite',
    'impl/test/phase93a-context-purity-red.test.mjs; CTX2 rewrite; fixtures via the author aid',
    'ONLY (never hand-computed digests). Red rows first and watch them fail; then green; then the',
    'pinned five suites; then the full suite `node impl/scripts/run-suite.mjs` — all green.',
    'NEVER write scratch or log files anywhere (including /tmp) — read output from stdout. Do NOT',
    'git commit. Do NOT modify canonical-value.mjs, schema-values.mjs, context-program.mjs, or',
    'worker-policy.mjs. Do NOT modify the spec. If a rule in impl-decisions.md conflicts with the',
    'spec text, the spec text wins — stop and report the conflict in your final message.',
  ].join(' '), {
    exact,
    scope: [
      'impl/src/program-ir/**',
      'impl/test/phase93a-context-purity-red.test.mjs',
      'impl/test/phase93a-control-grammar-red.test.mjs',
      'impl/test/fixtures/**',
    ],
  });
  log(`implementer started as ${run.id}`);
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
  while (!done && Date.now() - startedAt < 100 * 60 * 1000) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const view = await run.status();
    const outline = view?.view ?? view;
    const phase = outline?.phase ?? '?';
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s phase=${phase}`);
    evidence.progress.push({ at: new Date().toISOString(), phase });
    if (outline?.terminal === true || ['stopped', 'failed', 'cancelled', 'completed', 'work_completed'].includes(phase)) {
      done = true;
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
  evidence.outcome = outcome;
} catch (error) {
  failure = error;
  evidence.failure = { name: error.name, code: error.code ?? null, message: error.message };
} finally {
  if (run) {
    try {
      const stopped = await run.stop('93a.3a implementer settled.');
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
