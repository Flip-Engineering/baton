import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// 93a.3 re-draft verification: one kimi seat attacks the f5bea63 decisions
// (pinned derived names, homogeneous-only collect/finish, bottom-up resolution,
// chunk key, project all-optional, registrable bounds).

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase93a3-context-derivation-review-live-2026-07-21';
const evidencePath = resolve(evidenceDir, 'evidence-redraft-verify.json');
const reportPath = `${relativeRoot}/redraft-verify.md`;
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
const exact = { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' };

const baton = await openBaton({ repo, advanced: { routes: [exact], verification: VERIFY } });
const log = (line) => console.log(`[93a3-rv ${new Date().toISOString()}] ${line}`);
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
    'Act as the verification red team for the RE-DRAFTED Phase 93a.3a (commit f5bea63). Your two',
    'sibling reports are docs/reference/evidence/phase93a3-context-derivation-review-live-2026-07-21/',
    'spec-redteam.md and evaluator-redteam.md; the re-drafted §93.10A in',
    'spec/phase93-closed-program-ir.md answers them. Attack the ANSWERS, decision by decision:',
    '(1) pinned derived names "baton.derived."+H(structural definition)[0:16] v1 — can identity',
    'still leak (via name/version inside a child SchemaRef feeding parent bytes?), can the pinned',
    'name computation be gamed or collide, does the §93.5 digest actually cover name/version as',
    'claimed; (2) homogeneous-only collect/finish — is the §93.5 inexpressibility claim correct, is',
    'the homogeneous rule itself implementable at normalization (when do two inputs derive',
    'byte-different envelopes?), does it wrongly reject valuable natural chains; (3) bottom-up',
    'resolution with pinned-name filter and author-ref refusal — any residual weak-schema path;',
    '(4) chunk key = by-field schema union null, by:item Digest, required-property rule — against',
    'the real evaluator (context-program.mjs:796-812); (5) project all-optional vs silent omission',
    '(828-833); (6) sourceBranches/items on maxJoinMembers — registrable on the fixture policy and',
    'on a policy where maxEvidenceRefs > maxJoinMembers; (7) repository item formats (text',
    'whitespace/empty, gitMode enum, language text) — do real chunks now validate; (8) reserved-name',
    '"repository" selection — any acceptance of a non-chunk branch or refusal of a legitimate one',
    'that matters for 93a.3a. Verify each claim against the CURRENT spec text and code with line',
    'citations; run normalizations in memory (never write scratch files, including /tmp).',
    `Write only ${reportPath} with EXACTLY these headings:`,
    '## Verdict',
    '## P0-P1 findings',
    '## Required corrections',
    'READ-ONLY otherwise. Do not invoke nested Baton. One shell command per call. Do not mutate',
    'credentials, harness installations, global configuration, or the main checkout. Run the',
    'pinned verification and finish.',
  ].join(' '), { exact, scope: [reportPath] });
  log(`redraft verifier started as ${run.id}`);
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
  const outcome = { role: 'redraft-verify' };
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
      const stopped = await run.stop('93a.3 redraft verify settled.');
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
