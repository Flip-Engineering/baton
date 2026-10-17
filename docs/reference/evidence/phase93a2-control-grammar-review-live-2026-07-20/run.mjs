import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Wave 1.5 of the Phase 93a.2 methodology, driven through Baton itself.
// v1 lesson: codex is rate-limited until 2026-07-26, and group.complete() is
// fail-fast, so one crashed seat cascaded into orchestrator stops of healthy
// siblings. v2: per-member start, per-member settle wait, per-member outcome.
// Steering lane: /tmp/baton-wave1-steer/<role>.txt -> run.send(delivery "now").

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase93a2-control-grammar-review-live-2026-07-20';
const evidencePath = resolve(evidenceDir, 'evidence.json');
const steerDir = '/tmp/baton-wave1-steer';
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
    exact: Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' }),
    objective: [
      'Act as the adversarial red team for the Baton Phase 93a.2 Program-IR spec slice.',
      'Read spec/phase93-closed-program-ir.md sections 93.3-93.9, 93.20, 93.23 (suite 4), and',
      '93.24 (93a.2 entry), then impl/src/program-ir/{program-policy,role-catalog,approval-template,',
      'control-nodes,normalize-program}.mjs and impl/src/program-ir/{canonical-value,schema-values}.mjs.',
      'Attack the SPEC, not the implementation: find contradictions between the amended projection',
      'rules and the rest of the document, under-specified digest preimages, dominance rules that',
      'reject natural programs or admit undominated reads, collect/schema-derivation gaps,',
      'serial/parallel policy inconsistencies, coalescing or Kahn-order identity games, and any',
      'place where builder-emitted bytes could be trusted instead of recomputed. Verify every claim',
      'against the actual spec text and cite section numbers. No style nits, no roadmap wishes.',
      'Write only the report at the scoped path with EXACTLY these headings:',
      '## Verdict',
      '## P0-P1 findings',
      '## Required corrections',
      'Severity order findings; each finding cites the spec section and gives a concrete exploit or',
      'counterexample Program. Do not invoke nested Baton. One shell command per call. Do not',
      'mutate credentials, harness installations, global configuration, or the main checkout.',
      `Write only ${relativeRoot}/spec-redteam.md, run the pinned verification, and finish.`,
    ].join(' '),
  }),
  Object.freeze({
    role: 'tests-redteam',
    report: `${relativeRoot}/tests-redteam.md`,
    exact: Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' }),
    objective: [
      'Act as the adversarial red team for the Baton Phase 93a.2 test suite.',
      'Read impl/test/phase93a-control-grammar-red.test.mjs, impl/test/fixtures/',
      'phase93a-program-fixtures.mjs, the five new modules under impl/src/program-ir/, and',
      'spec/phase93-closed-program-ir.md sections 93.4, 93.9, and 93.23 suite 4.',
      'Attack the TESTS: find spec rows suite 4 names that are not pinned, assertions too weak to',
      'catch a plausible violation (e.g. digest compared only for existence, order asserted without',
      'bytes), fixtures that hard-code what the implementation should compute (digest literals',
      'produced by the implementation itself), tests that pass for the wrong reason, missing',
      'hostile-input rows, and dominance/cycle cases that are structurally vacuous. For each',
      'finding, name the exact test id and show the violating input that would slip through.',
      'Write only the report at the scoped path with EXACTLY these headings:',
      '## Verdict',
      '## P0-P1 findings',
      '## Required corrections',
      'Do not invoke nested Baton. One shell command per call. Do not mutate credentials, harness',
      'installations, global configuration, or the main checkout.',
      `Write only ${relativeRoot}/tests-redteam.md, run the pinned verification, and finish.`,
    ].join(' '),
  }),
  Object.freeze({
    role: 'impl-review',
    report: `${relativeRoot}/impl-review.md`,
    exact: Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' }),
    objective: [
      'Act as the blue-team implementation reviewer for the Baton Phase 93a.2 slice.',
      'Read spec/phase93-closed-program-ir.md sections 93.3-93.9 and the new modules',
      'impl/src/program-ir/{program-policy,role-catalog,approval-template,control-nodes,',
      'normalize-program}.mjs. Walk the implementation section by section against the spec and',
      'confirm or refute exact conformance: field sets, digest preimages and exclusion sets, array',
      'classifications (semantic/canonical-integer/topological/set-like), coalescing and Kahn',
      'order, collect derivation byte equality, dominance construction, policy serial/parallel',
      'consistency, and fail-closed context handling. Confirm the suite passes for the RIGHT',
      'reasons by spot-running it and mutating one fixture input by hand (in your own worktree',
      'copy only) to watch the matching test fail. List any implementation deviation from spec',
      'text, however small, with file:line citations.',
      'Write only the report at the scoped path with EXACTLY these headings:',
      '## Verdict',
      '## P0-P1 findings',
      '## Required corrections',
      'Do not invoke nested Baton. One shell command per call. Do not mutate credentials, harness',
      'installations, global configuration, or the main checkout.',
      `Write only ${relativeRoot}/impl-review.md, run the pinned verification, and finish.`,
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

const log = (line) => console.log(`[wave1.5 ${new Date().toISOString()}] ${line}`);
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
  log('all three routes ready; starting members individually');

  for (const request of requests) {
    const run = await baton.runs.start(request.objective, {
      exact: request.exact,
      scope: [request.report],
    });
    runs.set(request.role, { request, run });
    log(`started ${request.role} as ${run.id}`);
  }
  // Plan approval is a distinct recorded authority: status() is passive observation and
  // nothing dispatches without it (the wave-1.5 stall). Approve each member explicitly.
  for (const [role, { run }] of runs) {
    await run.approve();
    log(`approved ${role}`);
  }

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
        const isTerminal = outline?.terminal === true || ['stopped', 'complete', 'failed'].includes(phase);
        if (isTerminal) {
          terminal.add(role);
          line.push(`${role}=${phase}(terminal)`);
        } else line.push(`${role}=${phase}`);
      } catch { line.push(`${role}=?`); }
    }
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s ${line.join(' ')}`);
    progress.push({ at: new Date().toISOString(), line: line.join(' ') });
    if (Date.now() - startedAt > WATCHDOG_MS) {
      throw Object.assign(new Error('wave1.5 watchdog expired'), { code: 'watchdog_expired' });
    }
  }

  for (const [role, { request, run }] of runs) {
    const outcome = { role, route: request.exact, path: request.report };
    try {
      const view = await run.status();
      const outline = view?.view ?? view;
      outcome.phase = outline?.phase ?? null;
      outcome.narrative = outline?.narrative ?? null;
      outcome.terminalCause = outline?.terminalCause ?? null;
      const results = await run.inspect({ depth: 'section', section: 'result' });
      const value = results?.view?.section?.items?.[0]?.value;
      if (/^[a-f0-9]{40,64}$/u.test(value?.sha ?? '')) {
        const report = execFileSync('/usr/bin/git', ['show', `${value.sha}:${request.report}`], {
          cwd: repo, encoding: 'utf8', maxBuffer: 512 * 1024,
        });
        writeFileSync(resolve(repo, request.report), report);
        outcome.resultSha = value.sha;
        outcome.materialized = true;
        log(`materialized ${role} report at ${value.sha}`);
      } else {
        outcome.materialized = false;
        log(`${role} produced no preserved result (${outcome.narrative ?? 'no narrative'})`);
      }
    } catch (error) {
      outcome.materialized = false;
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
      const stopped = await run.stop('Phase 93a.2 review wave settled.');
      stops.push({ role, runId: run.id, stop: stopped.stop ?? null, ownership: stopped.ownership ?? null });
    } catch (error) {
      stops.push({ role, runId: run.id, error: { code: error.code ?? null, message: error.message } });
    }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* close is best-effort after failure */ }
  writeFileSync(evidencePath, `${JSON.stringify({
    schemaVersion: 2,
    failure: failure ? { name: failure.name, code: failure.code ?? null, message: failure.message } : null,
    outcomes,
    steering,
    stops,
    progress: progress.slice(-40),
  }, null, 2)}\n`);
  log(`evidence written; failure=${failure ? (failure.code ?? failure.message) : 'none'}; materialized=${outcomes.filter((o) => o.materialized).length}/3`);
}
if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
