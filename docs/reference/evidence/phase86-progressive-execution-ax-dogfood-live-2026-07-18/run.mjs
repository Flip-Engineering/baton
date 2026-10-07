import { execFileSync } from 'node:child_process';
import {
  mkdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase86-progressive-execution-ax-dogfood-live-2026-07-18';
const evidencePath = resolve(evidenceDir, 'evidence.json');
const kimi = Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'max' });
const glm = Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' });
const opus = Object.freeze({
  harness: 'claude-code', model: 'claude-opus-4-6', effort: 'xhigh',
});
const routes = Object.freeze([kimi, glm, opus]);
const reportPaths = Object.freeze([
  `${relativeRoot}/independent-review.md`, `${relativeRoot}/opus-review.md`,
]);

mkdirSync(evidenceDir, { recursive: true });
for (const path of [evidencePath, ...reportPaths.map((path) => resolve(repo, path))]) {
  rmSync(path, { force: true });
}

const baton = await openBaton({
  repo,
  advanced: {
    routes,
    verification: {
      command: 'node', arguments: [
        '--test',
        'impl/test/phase12-web-operator.test.mjs',
        'impl/test/phase67-change-aware-inspect.test.mjs',
        'impl/test/phase67-progressive-agent-experience.test.mjs',
        'impl/test/phase67-self-describing-continuation.test.mjs',
        'impl/test/phase67-run-terminality.test.mjs',
        'impl/test/phase78-concise-deployment-factory.test.mjs',
      ],
    },
  },
});

const controller = new AbortController();
const interrupt = () => controller.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
let group = null;
let record = null;
let failure = null;

try {
  const readiness = await baton.doctor();
  const selectedReadiness = routes.map((exact) => readiness.routes.find((candidate) => (
    candidate.harness === exact.harness && candidate.model === exact.model
      && candidate.effort === exact.effort
  )) ?? { ...exact, state: 'missing', code: 'route_missing' });
  const kimiReadiness = selectedReadiness.find(({ harness }) => harness === kimi.harness);
  const independent = kimiReadiness?.state === 'ready' ? kimi : glm;
  const assignments = Object.freeze([
    Object.freeze({
      role: independent === kimi ? 'kimi-ax-critic' : 'glm-ax-critic',
      exact: independent, path: reportPaths[0],
    }),
    Object.freeze({ role: 'opus-integrity-critic', exact: opus, path: reportPaths[1] }),
  ]);
  const selected = new Set(assignments.map(({ exact }) => JSON.stringify(exact)));
  const unavailable = selectedReadiness.find((candidate) => (
    selected.has(JSON.stringify({
      harness: candidate.harness, model: candidate.model, effort: candidate.effort,
    })) && candidate.state !== 'ready'
  ));
  if (unavailable) {
    throw Object.assign(new Error(
      `${unavailable.harness}/${unavailable.model}@${unavailable.effort} is ${unavailable.state}`,
    ), { code: unavailable.code ?? 'route_unavailable' });
  }

  group = await baton.startMany(assignments.map(({ role, exact, path }) => ({
    exact,
    scope: [path],
    objective: [
      `Act as the ${role} reviewing Baton's current progressive execution AX changes.`,
      'Inspect the actual dirty effective repository tree. Evaluate removal of public response bounds,',
      'deployment-derived run.inspect waiting, compact outline budget projection, sanitized application',
      'cards, browser continuation behavior, compatibility, stop/reap integrity, and whether internal',
      'circuit breakers remain correctly separated from agent-managed parameters. Identify only concrete',
      'P0/P1/P2 defects or state that none were found. Include exact source and test pointers.',
      `Write only ${path}; do not change any other path and do not invoke nested Baton.`,
    ].join(' '),
  })));

  const completed = await group.complete({ signal: controller.signal });
  const results = await group.inspect({ depth: 'section', section: 'result' });
  const materialized = [];
  for (let index = 0; index < assignments.length; index += 1) {
    const value = results[index]?.view?.section?.items?.[0]?.value;
    const sha = value?.sha;
    if (!/^[a-f0-9]{40,64}$/u.test(sha ?? '')) {
      throw new Error(`${assignments[index].role} produced no preserved result`);
    }
    const text = execFileSync('/usr/bin/git', ['show', `${sha}:${assignments[index].path}`], {
      cwd: repo, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    });
    writeFileSync(resolve(repo, assignments[index].path), text);
    materialized.push({ role: assignments[index].role, path: assignments[index].path, sha });
  }
  record = {
    schemaVersion: 1,
    routes: selectedReadiness.map(({ harness, model, effort, state, code = null }) => ({
      harness, model, effort, state, code,
    })),
    group: completed,
    materialized,
  };
} catch (error) {
  failure = error;
  record = {
    schemaVersion: 1,
    error: { name: error.name, code: error.code ?? null, message: error.message },
  };
} finally {
  const stops = [];
  if (group) {
    for (const run of group.runs) {
      try {
        const stopped = await run.stop('AX review captured; stop and reap this exact reviewer.');
        stops.push({ runId: run.id, stop: stopped.stop ?? null, resources: stopped.outline?.resources ?? null });
      } catch (error) {
        stops.push({ runId: run.id, error: { code: error.code ?? null, message: error.message } });
      }
    }
  }
  const close = await baton.close();
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  record = { ...record, cleanup: { stops, close: close.ownership } };
  writeFileSync(evidencePath, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

if (failure) throw failure;
