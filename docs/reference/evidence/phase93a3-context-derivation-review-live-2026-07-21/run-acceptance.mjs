import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// 93a.3a acceptance: blue review seat (claude-opus-4-8) over the shipped
// derivation against the closed spec and all three red-team reports.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase93a3-context-derivation-review-live-2026-07-21';
const evidencePath = resolve(evidenceDir, 'evidence-acceptance.json');
const reportPath = `${relativeRoot}/acceptance-review.md`;
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
const exact = { harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' };

const baton = await openBaton({ repo, advanced: { routes: [exact], verification: VERIFY } });
const log = (line) => console.log(`[93a3-acc ${new Date().toISOString()}] ${line}`);
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
    'Act as the blue acceptance reviewer for the shipped Phase 93a.3a context result-schema',
    'derivation. READ-ONLY: never modify, create, or delete any file except the report; never',
    'write scratch or log files anywhere (including /tmp); read command output from stdout only.',
    'Read: (1) spec/phase93-closed-program-ir.md §93.9, §93.10, §93.10A, §93.20, §93.23 suite 5',
    'at HEAD; (2) impl/src/program-ir/context-derivation.mjs and its call sites in',
    'normalize-program.mjs; (3) impl/test/phase93a-context-purity-red.test.mjs and the CTX2',
    'rewrite in impl/test/phase93a-control-grammar-red.test.mjs; (4) the three adversarial',
    'reports in docs/reference/evidence/phase93a3-context-derivation-review-live-2026-07-21/',
    '(spec-redteam.md, evaluator-redteam.md, redraft-verify.md) and impl-decisions.md.',
    'Verify, row by row: (a) every finding in the three reports is closed in BOTH spec and code,',
    'or honestly deferred with a named rung; (b) run the derived Programs from the reports',
    '(heterogeneous collect, field-keyed chunk, misnamed registry, author child-ref substitution,',
    'renamed-label identity) against the shipped normalizeProgramSource and confirm exact',
    'refusals/acceptances; (c) the pinned-name preimage, bottom-up order independence, all-',
    'required vs project-optional, exact arity bounds, and the policy synthesis mapping; (d) run',
    'the five pinned suites; (e) independently recompute TWO of the regenerated digest literals in',
    'impl/test/fixtures/phase93a-digest-vectors.json with an external shasum -a 256 over bytes you',
    'produce yourself (the implementer flagged its regeneration for independent re-check) and',
    'report match/mismatch; (f) hunt NEW defects the derivation introduces (resolver cache,',
    'homogeneity check, policy synthesis corners, maxChildDepth=1 requirement).',
    `Write only ${reportPath} with EXACTLY these headings:`,
    '## Verdict',
    '## P0-P1 findings',
    '## Required corrections',
    'Do not invoke nested Baton. One shell command per call. Do not mutate credentials, harness',
    'installations, global configuration, or the main checkout. Run the pinned verification and',
    'finish.',
  ].join(' '), { exact, scope: [reportPath] });
  log(`acceptance reviewer started as ${run.id}`);
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
  const outcome = { role: 'acceptance' };
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
      const stopped = await run.stop('93a.3a acceptance settled.');
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
