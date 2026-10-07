import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// 93a.3 wave-1: adversarial red-team of the §93.10A context derivation draft.
// Seat 1 (claude-opus-4-8): spec-semantics attack. Seat 2 (kimi-k3): evaluator
// conformance attack (draft shapes vs the shipped StatelessContextBench).
// Driver v4 semantics: explicit approve, re-armed drive pumps, true-terminal
// detection, per-member outcome materialization.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase93a3-context-derivation-review-live-2026-07-21';
const evidencePath = resolve(evidenceDir, 'evidence-wave1.json');
const steerDir = '/tmp/baton-93a3-steer';
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
    role: 'spec-redteam',
    report: `${relativeRoot}/spec-redteam.md`,
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }),
    objective: [
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
      'Write only the report at the scoped path with EXACTLY these headings:',
      '## Verdict',
      '## P0-P1 findings',
      '## Required corrections',
      'READ-ONLY otherwise; never write scratch files (including /tmp). Do not invoke nested Baton.',
      'One shell command per call. Do not mutate credentials, harness installations, global',
      'configuration, or the main checkout. Run the pinned verification and finish.',
    ].join(' '),
  }),
  Object.freeze({
    role: 'evaluator-redteam',
    report: `${relativeRoot}/evaluator-redteam.md`,
    exact: Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' }),
    objective: [
      'Act as the evaluator-conformance red team for the Phase 93a.3a derivation draft.',
      'Read spec/phase93-closed-program-ir.md §93.10A, then impl/src/context-program.mjs',
      '(normalizeExpression, StatelessContextBench._evaluate, outputValue, meta helpers) and',
      'impl/src/context-runtime.mjs (repository item construction) and impl/src/coordination-store.mjs',
      '(source item validation). Row by row, check the draft\'s claimed shapes against what the',
      'evaluator ACTUALLY produces: envelope field types and bounds; outline fields element type',
      '(are they SafeId or arbitrary strings?); index value wrapping; chunk key construction and',
      'type; slice indices/field_equals selector shapes; project undefined-omission per item;',
      'sort every-key-required; unique first-occurrence; join item wrapping and missing-key failures;',
      'collect envelope-of-envelopes; coverage singleton field types (sourceBranches array vs count);',
      'finish grounding/evidence shapes; repository chunk field types (gitMode, language, chunk).',
      'For each mismatch name the draft line and the code line. Also attack: can two op chains with',
      'different meaning derive byte-identical schemas (identity collapse), or one chain derive a',
      'schema no cell can validate against (unsatisfiable derivation)?',
      'Write only the report at the scoped path with EXACTLY these headings:',
      '## Verdict',
      '## P0-P1 findings',
      '## Required corrections',
      'READ-ONLY otherwise; never write scratch files (including /tmp). Do not invoke nested Baton.',
      'One shell command per call. Do not mutate credentials, harness installations, global',
      'configuration, or the main checkout. Run the pinned verification and finish.',
    ].join(' '),
  }),
]);

mkdirSync(evidenceDir, { recursive: true });
mkdirSync(steerDir, { recursive: true });
rmSync(evidencePath, { force: true });
for (const request of requests) rmSync(resolve(repo, request.report), { force: true });

const baton = await openBaton({
  repo,
  advanced: {
    routes: [...new Map(requests.map(({ exact }) => [JSON.stringify(exact), exact])).values()],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[93a3-w1 ${new Date().toISOString()}] ${line}`);
let failure = null;
const runs = new Map();
const outcomes = [];
const steering = [];
const progress = [];
const startedAt = Date.now();
const WATCHDOG_MS = 90 * 60 * 1000;
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
      scope: [request.report],
    });
    runs.set(request.role, { request, run });
    log(`started ${request.role} as ${run.id}`);
  }
  for (const [role, { run }] of runs) {
    await run.approve();
    log(`approved ${role}`);
  }
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
    if (Date.now() - startedAt > WATCHDOG_MS) { log('watchdog expired'); break; }
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
      let sha = /^[a-f0-9]{40,64}$/u.test(value?.sha ?? '') ? value.sha : null;
      if (!sha) {
        const pins = execFileSync('/usr/bin/git', ['for-each-ref', 'refs/baton/results/', '--format=%(objectname) %(committerdate:unix)'], { cwd: repo, encoding: 'utf8' })
          .trim().split('\n').filter(Boolean)
          .map((row) => ({ sha: row.split(' ')[0], at: Number(row.split(' ')[1]) }))
          .filter((pin) => pin.at * 1000 >= startedAt - 60000)
          .sort((a, b) => b.at - a.at);
        const used = outcomes.map((other) => other.resultSha).filter(Boolean);
        sha = pins.find((pin) => !used.includes(pin.sha))?.sha ?? null;
        if (sha) outcome.materializedVia = 'refs/baton/results fallback';
      }
      if (sha) {
        try {
          const report = execFileSync('/usr/bin/git', ['show', `${sha}:${request.report}`], {
            cwd: repo, encoding: 'utf8', maxBuffer: 512 * 1024,
          });
          writeFileSync(resolve(repo, request.report), report);
          outcome.resultSha = sha;
          outcome.materialized = request.report;
          log(`${role} report materialized at ${sha}`);
        } catch {
          outcome.resultSha = null;
          log(`${role}: pin ${sha} does not carry the report path`);
        }
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
      const stopped = await run.stop('93a.3 wave-1 settled.');
      stops.push({ role, runId: run.id, stop: stopped.stop ?? null, ownership: stopped.ownership ?? null });
    } catch (error) {
      stops.push({ role, runId: run.id, error: { code: error.code ?? null, message: error.message } });
    }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
  writeFileSync(evidencePath, `${JSON.stringify({
    schemaVersion: 1,
    failure: failure ? { name: failure.name, code: failure.code ?? null, message: failure.message } : null,
    outcomes,
    steering,
    stops,
    progress: progress.slice(-40),
  }, null, 2)}\n`);
  log(`evidence written; failure=${failure ? (failure.code ?? failure.message) : 'none'}; results=${outcomes.filter((o) => o.resultSha).length}/${requests.length}`);
}
if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
