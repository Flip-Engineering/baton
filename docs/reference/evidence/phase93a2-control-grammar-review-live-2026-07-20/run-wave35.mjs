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
    'Contract documents (read first): docs/reference/evidence/',
    'phase93a2-control-grammar-review-live-2026-07-20/blue-review.md and redraft-redteam.md.',
    'Apply ALL of these eight orchestrator-approved decisions exactly:',
    '1. §93.9 clause 2 (settle-then-read): replace the blanket pure-data exemption with the same',
    '   transitive pure-data walk clause 1 carries — from each settle-then-read position walk the',
    '   collect-item closure and require every control producer so reached to lie in the',
    '   position settlement domain (value/context add no refs; pure-data leaves unrestricted).',
    '   Code: replace the early return in checkSettleThenRead with a walked-guarded stack',
    '   mirroring the demand walk. Tests: add the three laundered exploits to P93A2-D3',
    '   (sequence.result=col.value, branch arm result=col.value, parallel branch result=col.value)',
    '   plus a two-hop collect chain row, and fix the wrong D3 comment (pure-data reads are exempt',
    '   from the DOMINATOR check, not the settlement-domain check); keep the value-node green row.',
    '2. §93.9 settlement domain: key it per position on the governing control chain, matching the',
    '   shipped reference — sequence.result → the sequence domain (steps + step domains);',
    '   parallel.branches[b].result → branch b control-chain domain REGARDLESS of join kind;',
    '   branch.{then,otherwise}.result → that arm control-chain domain. Closure: chain head;',
    '   sequence steps recursively; all_terminal parallel branches chain domains; non-all_terminal',
    '   parallel and branch nodes contribute only themselves (branch value port only, never arm',
    '   internals). Cross-branch reads under all_terminal are REFUSED (per-branch domains). Amend',
    '   the spec text to say exactly this.',
    '3. §93.9: add effect-node input positions (call.input, map.input, reduce.inputs,',
    '   gate.candidate, notify.{target,message}, checkpoint.value, finish.{value,evidence}) to the',
    '   demand-edge relation (dominator-checked) as normative text so 93C cannot re-open the hole;',
    '   keep the two-relation claim true.',
    '4. §93.9/§93.8: in Program v1 every repeat/child body MUST be independently approved — delete',
    '   the "or within the parent envelope shape" alternative.',
    '5. §93.8: state that a content_ref template scopes MUST be covered by the envelope',
    '   repositoryScopes at approval time; until envelope authority exists (93E) the projection is',
    '   inline-only and an empty projection means NO repository access grant, never unconstrained.',
    '6. §93.20: state that the empty-reachable-role-set refusal AND the route-card/structural',
    '   minimum are both deferred to 93E, and that serial classification is per-Program (control-',
    '   reachable from that Program own root; repeat/child bodies are different Programs).',
    '7. §93.9/§93.20 + code: an UNREACHABLE (inert) parallel branch count is bounded by',
    '   policy.maxProgramNodes as an explicitly stated pure shape bound; a reachable parallel is',
    '   bounded by policy.maxParallelBranches. Move the branch-count check to the program-level',
    '   pass where reachability is known; fix the misleading error message in control-nodes.mjs.',
    '   Red rows: unreachable parallel over maxProgramNodes refused; unreachable at maxProgramNodes',
    '   accepted; reachable over maxParallelBranches refused (keep existing B1).',
    '8. Blue P1-3: register a second fixture object schema (collect_outer wrapping collect_result)',
    '   so colOuter <- colInner <- selT is constructible; add the true two-hop row to P93A2-D2',
    '   (a one-level-only walk must fail it) and the same two-hop shape to the D3 settle rows.',
    'Rules: red rows first and watch them fail; then implement to green; do NOT modify',
    'canonical-value.mjs, schema-values.mjs, context-program.mjs, worker-policy.mjs; do NOT git',
    'commit; NEVER write scratch or log files anywhere (including /tmp) — read output from stdout;',
    'run the pinned four suites, then the full suite `node impl/scripts/run-suite.mjs` from the',
    'worktree root, both green. Keep P93A2- test ids stable for amended rows; new rows continue',
    'the scheme. Digest literals in phase93a-digest-vectors.json must remain valid — if any',
    'shifts, that is a finding: regenerate ONLY via external shasum -a 256 over inspected bytes',
    'and note it in your final message.',
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
