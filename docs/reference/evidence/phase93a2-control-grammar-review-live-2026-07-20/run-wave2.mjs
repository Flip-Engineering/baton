import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Wave 2 of the Phase 93a.2 methodology, driven through Baton itself.
// Seat 1 (Claude Sonnet 5): apply the two red-team reports' required
//   corrections — red-first test rows, then implementation fixes — against
//   the re-drafted spec (17c7eea).
// Seat 2 (GLM 5.2): adversarially red-team the spec re-draft itself.
// Driver v3 lessons applied: explicit approve, per-member complete() pumps,
// attention surfacing, outcome materialization even after watchdog.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase93a2-control-grammar-review-live-2026-07-20';
const evidencePath = resolve(evidenceDir, 'evidence-wave2.json');
const steerDir = '/tmp/baton-wave2-steer';
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

const requests = Object.freeze([
  Object.freeze({
    role: 'implementer',
    report: null,
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    scope: Object.freeze([
      'impl/src/program-ir',
      'impl/test/phase93a-control-grammar-red.test.mjs',
      'impl/test/fixtures/phase93a-program-fixtures.mjs',
      'impl/test/fixtures/phase93a-digest-vectors.json',
    ]),
    objective: [
      'Apply the Phase 93a.2 wave-1 review corrections to the Baton Program-IR slice. You are the',
      'implementation seat; two adversarial reports and a re-drafted spec are your contract.',
      'Read FIRST, in order: (1) docs/reference/evidence/',
      'phase93a2-control-grammar-review-live-2026-07-20/spec-redteam.md and tests-redteam.md;',
      '(2) spec/phase93-closed-program-ir.md sections 93.5, 93.8, 93.9, 93.20, 93.24 AS AMENDED',
      '(demand-edge dominance + settle-then-read settlement domains, effectKinds own-nodes',
      'projection, inline-only repositoryScopes with [0..] bound, bound.policyDigest preimage,',
      'ceiling-authority split, reachable-parallel classification); (3) the implementation',
      'modules impl/src/program-ir/{normalize-program,approval-template,role-catalog,',
      'control-nodes,program-policy}.mjs; (4) impl/test/phase93a-control-grammar-red.test.mjs and',
      'impl/test/fixtures/phase93a-program-fixtures.mjs.',
      'Work RED-FIRST: for every correction, extend the red suite with rows that fail for the',
      'stated reason, then fix the implementation to green. Apply ALL of:',
      'A. Every "Required corrections" item in tests-redteam.md (digest-literal vectors via an',
      '   external tool — create impl/test/fixtures/phase93a-digest-vectors.json with literals',
      '   produced by `shasum -a 256` over the exact canonical byte strings, including at least',
      '   one non-BMP object key; S1 deep-equals; preference permutation identity rows;',
      '   duplicate-name refusals; all_verified selector rows; await/repeat/child and predicate',
      '   dominance refusals; two-hop collect chain; policy maxProgramBytes; verificationContracts',
      '   rows; control-node coalescing; boundary-positive rows; full policy field matrix; N1',
      '   missing-field exhaustion; nested impure context op; unsorted repositoryScopes;',
      '   two-role catalog; content_ref mismatch; await-target control-producer refusal;',
      '   requiredVerification not_required positive).',
      'B. Every "Required corrections" item in spec-redteam.md that needs implementation change:',
      '   settle-then-read settlement-domain validation for sequence.result,',
      '   parallel.branches[].result, and branch arm results (the three P0-1 exploits MUST be',
      '   refused and the R1 natural form MUST stay accepted); repositoryScopes [0..] with',
      '   content_ref rule; reachable-parallel serial classification (unreachable parallel does',
      '   not force non-null maxParallelBranches).',
      'C. Do NOT modify the spec, impl/src/context-program.mjs, impl/src/worker-policy.mjs,',
      '   impl/src/program-ir/canonical-value.mjs, or impl/src/program-ir/schema-values.mjs.',
      '   Do NOT git commit. Do NOT modify files outside your scope.',
      'Keep test ids stable (P93A2-…) for amended rows; new rows continue the scheme. Run the',
      'pinned verification (all four phase93a suites) until green, then also run the full suite',
      'with `node impl/scripts/run-suite.mjs` from the repo root worktree and make it green.',
      'Finish with the worktree containing the complete corrected slice.',
    ].join(' '),
  }),
  Object.freeze({
    role: 'redraft-redteam',
    report: `${relativeRoot}/redraft-redteam.md`,
    exact: Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' }),
    scope: Object.freeze([`${relativeRoot}/redraft-redteam.md`]),
    objective: [
      'Act as the adversarial red team for the Phase 93a.2 SPEC RE-DRAFT. Your wave-1 sibling',
      'reports are docs/reference/evidence/phase93a2-control-grammar-review-live-2026-07-20/',
      'spec-redteam.md and tests-redteam.md. The re-draft landed in',
      'spec/phase93-closed-program-ir.md: demand-edge dominance vs settle-then-read settlement',
      'domains (§93.9), effectKinds own-nodes projection (§93.8), inline-only repositoryScopes',
      'with content_ref rule and [0..] bound (§93.8), bound.policyDigest preimage (§93.9),',
      'value-authority vs ProgramPolicy ceiling split (§93.5), and reachable-parallel serial',
      'classification plus the 93a.2 shape-only maxParallelBranches note (§93.20).',
      'Attack the RE-DRAFT: for each of the six amendments, either confirm it closes its wave-1',
      'finding without new contradictions, or show a concrete counterexample Program it still',
      'admits or wrongly rejects. Pay special attention to the settlement-domain definition:',
      'recursion termination, sequence/parallel/branch nesting corners, collect chains crossing',
      'domains, and whether the R1 natural form stays accepted while all three P0-1 exploits are',
      'refused. Also attack the [0..] repositoryScopes rule (does an empty-scope envelope',
      'over-grant?) and the body-envelope effectKinds rule (can a body widen effect authority',
      'without the parent noticing?). Cite section numbers; no style nits.',
      'Write only the report at the scoped path with EXACTLY these headings:',
      '## Verdict',
      '## P0-P1 findings',
      '## Required corrections',
      'Do not invoke nested Baton. One shell command per call. Do not mutate credentials, harness',
      'installations, global configuration, or the main checkout. Read-only review: do not modify',
      'any file other than the report. Run the pinned verification and finish.',
    ].join(' '),
  }),
]);

mkdirSync(steerDir, { recursive: true });
rmSync(evidencePath, { force: true });
for (const request of requests) if (request.report) rmSync(resolve(repo, request.report), { force: true });

const baton = await openBaton({
  repo,
  advanced: {
    routes: [...new Map(requests.map(({ exact }) => [JSON.stringify(exact), exact])).values()],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[wave2 ${new Date().toISOString()}] ${line}`);
let failure = null;
const runs = new Map();
const outcomes = [];
const steering = [];
const progress = [];
const attentionLog = [];
const startedAt = Date.now();
const WATCHDOG_MS = 100 * 60 * 1000;
try {
  const readiness = await baton.doctor();
  for (const request of requests) {
    const ready = readiness.routes.find((candidate) => (
      candidate.harness === request.exact.harness
      && candidate.model === request.exact.model
      && candidate.effort === request.exact.effort
    ));
    if (ready?.state !== 'ready') {
      throw Object.assign(new Error(ready?.summary ?? `${request.role} route unavailable`), {
        code: ready?.code ?? 'route_unavailable',
      });
    }
  }
  log('both routes ready; starting members individually');

  for (const request of requests) {
    const run = await baton.runs.start(request.objective, {
      exact: request.exact,
      scope: [...request.scope],
    });
    runs.set(request.role, { request, run });
    log(`started ${request.role} as ${run.id}`);
  }
  for (const [role, { run }] of runs) {
    await run.approve();
    log(`approved ${role}`);
  }
  // complete()/drive() is a client-action pump, never a terminal signal: it returns whenever the
  // RunView quiesces. Re-arm it periodically to push through gates (approval, answers, result
  // acceptance) while polling status() for the true terminal state. (Wave-2 v3 killed a healthy
  // implementer by treating pump settlement as terminal.)
  const pumpArm = new Map();
  const armPump = (role, run) => {
    if (pumpArm.get(role) === true) return;
    pumpArm.set(role, true);
    run.complete().then(
      (view) => { pumpArm.set(role, false); log(`pump ${role} returned phase=${view?.outline?.phase ?? view?.phase ?? '?'}`); },
      (error) => { pumpArm.set(role, false); log(`pump ${role} failed: ${error.code ?? error.message}`); },
    );
  };
  for (const [role, { run }] of runs) armPump(role, run);

  const terminal = new Set();
  while (terminal.size < runs.size) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    for (const [role, { run }] of runs) {
      const steerFile = join(steerDir, `${role}.txt`);
      if (existsSync(steerFile)) {
        const message = readFileSync(steerFile, 'utf8').trim();
        rmSync(steerFile, { force: true });
        if (message.length > 0) {
          try {
            await run.send(message, { delivery: 'now' });
            steering.push({ role, at: new Date().toISOString(), delivery: 'now', message: message.slice(0, 2000), state: 'sent' });
            log(`steered ${role}: ${message.slice(0, 120)}`);
          } catch (error) {
            steering.push({ role, at: new Date().toISOString(), message: message.slice(0, 2000), state: 'failed', code: error.code ?? null });
            log(`steer ${role} failed: ${error.code ?? error.message}`);
          }
        }
      }
    }
    const line = [];
    for (const [role, { run }] of runs) {
      if (terminal.has(role)) { line.push(`${role}=terminal`); continue; }
      try {
        const view = await run.status();
        const outline = view?.view ?? view;
        const phase = outline?.phase ?? '?';
        const attention = outline?.attention;
        if (Array.isArray(attention) ? attention.length > 0 : (attention && attention !== 'clear')) {
          attentionLog.push({ role, at: new Date().toISOString(), attention });
          log(`ATTENTION ${role}: ${JSON.stringify(attention).slice(0, 200)}`);
        }
        const isTerminal = outline?.terminal === true
          || ['stopped', 'failed', 'cancelled', 'completed'].includes(phase);
        if (isTerminal) {
          terminal.add(role);
          line.push(`${role}=${phase}(terminal)`);
        } else {
          line.push(`${role}=${phase}`);
          armPump(role, run);
        }
      } catch { line.push(`${role}=?`); }
    }
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s ${line.join(' ')}`);
    progress.push({ at: new Date().toISOString(), line: line.join(' ') });
    if (Date.now() - startedAt > WATCHDOG_MS) {
      log('watchdog expired; proceeding to outcomes for whatever is terminal');
      break;
    }
  }

  for (const [role, { request, run }] of runs) {
    const outcome = { role, route: request.exact };
    try {
      const view = await run.status();
      const outline = view?.view ?? view;
      outcome.phase = outline?.phase ?? null;
      outcome.narrative = outline?.narrative ?? null;
      const results = await run.inspect({ depth: 'section', section: 'result' });
      const items = results?.view?.section?.items ?? [];
      const value = items[0]?.value;
      if (/^[a-f0-9]{40,64}$/u.test(value?.sha ?? '')) {
        outcome.resultSha = value.sha;
        if (request.report) {
          const report = execFileSync('/usr/bin/git', ['show', `${value.sha}:${request.report}`], {
            cwd: repo, encoding: 'utf8', maxBuffer: 512 * 1024,
          });
          writeFileSync(resolve(repo, request.report), report);
          outcome.materialized = request.report;
        }
        log(`${role} result sha ${value.sha}`);
      } else {
        outcome.resultSha = null;
        log(`${role} produced no preserved result (${outcome.narrative ?? 'no narrative'})`);
      }
    } catch (error) {
      outcome.error = { code: error.code ?? null, message: error.message };
    }
    outcomes.push(outcome);
  }
} catch (error) {
  failure = error;
} finally {
  const stops = [];
  for (const [role, { run }] of runs) {
    try {
      const stopped = await run.stop('Phase 93a.2 wave-2 settled.');
      stops.push({ role, runId: run.id, stop: stopped.stop ?? null, ownership: stopped.ownership ?? null });
    } catch (error) {
      stops.push({ role, runId: run.id, error: { code: error.code ?? null, message: error.message } });
    }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* close is best-effort after failure */ }
  writeFileSync(evidencePath, `${JSON.stringify({
    schemaVersion: 3,
    failure: failure ? { name: failure.name, code: failure.code ?? null, message: failure.message } : null,
    outcomes,
    steering,
    attentionLog,
    stops,
    progress: progress.slice(-40),
  }, null, 2)}\n`);
  log(`evidence written; failure=${failure ? (failure.code ?? failure.message) : 'none'}; results=${outcomes.filter((o) => o.resultSha).length}/${requests.length}`);
}
if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
