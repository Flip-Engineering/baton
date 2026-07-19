import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase86-progressive-execution-ax-dogfood-live-2026-07-18';
const evidencePath = resolve(evidenceDir, 'rerun-evidence.json');
const reportPath = `${relativeRoot}/glm-rerun-review.md`;
const exact = Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' });

rmSync(evidencePath, { force: true });
rmSync(resolve(repo, reportPath), { force: true });

const baton = await openBaton({
  repo,
  advanced: {
    routes: [exact],
    verification: {
      command: 'node', arguments: [
        '--test',
        'impl/test/adapter.test.mjs',
        'impl/test/claude-session.test.mjs',
        'impl/test/coordinator.test.mjs',
        'impl/test/credential-projection.test.mjs',
        'impl/test/phase66-result-export-adversarial.test.mjs',
        'impl/test/phase67-progressive-agent-experience.test.mjs',
        'impl/test/phase73-required-effects.test.mjs',
        'impl/test/phase78-deployment-readiness-red.test.mjs',
        'impl/test/runtime-isolation.test.mjs',
      ],
    },
  },
});

let group = null;
let record;
let failure = null;
try {
  const readiness = await baton.doctor();
  const route = readiness.routes.find((candidate) => (
    candidate.harness === exact.harness && candidate.model === exact.model
      && candidate.effort === exact.effort
  ));
  if (route?.state !== 'ready') {
    throw Object.assign(new Error(route?.summary ?? 'exact GLM route unavailable'), {
      code: route?.code ?? 'route_unavailable',
    });
  }
  group = await baton.startMany([{
    exact,
    scope: [reportPath],
    objective: [
      'Independently review the current Phase 86 Baton implementation in the effective repository snapshot.',
      'Concentrate on the progressive hidden-guard AX, two-restart stop/reap convergence, all-depth',
      'inspection finalization, atomic no-replace export helper hardening, projected-runtime Claude',
      'authentication readiness, provider auth classification, credential projection, captured Git',
      'path-scope enforcement, and whether the new Brief clearly separates full harness permission from',
      'write authority. Identify concrete correctness or security defects with exact source/test pointers;',
      'state explicitly when a reviewed acceptance point is sound. Do not invoke nested Baton.',
      'For every shell operation use rtk, exactly one command per call, with no pipes, &&, semicolons,',
      'or direct unwrapped shell commands. Never repair or mutate home state, credentials, toolchains,',
      'shims, caches, or global configuration; report an environmental blocker instead.',
      `Write only ${reportPath}. Do not change any other path.`,
    ].join(' '),
  }]);
  const completed = await group.complete();
  const result = await group.inspect({ depth: 'section', section: 'result' });
  const value = result[0]?.view?.section?.items?.[0]?.value;
  if (!/^[a-f0-9]{40,64}$/u.test(value?.sha ?? '')) {
    throw new Error('GLM review produced no preserved result');
  }
  const report = execFileSync('/usr/bin/git', ['show', `${value.sha}:${reportPath}`], {
    cwd: repo, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
  });
  writeFileSync(resolve(repo, reportPath), report);
  record = {
    schemaVersion: 1,
    route: { ...exact, state: route.state },
    group: completed,
    materialized: { path: reportPath, sha: value.sha },
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
        const stopped = await run.stop('Phase 86 rerun review captured; stop and reap this exact Run.');
        stops.push({ runId: run.id, stop: stopped.stop ?? null, ownership: stopped.ownership ?? null });
      } catch (error) {
        stops.push({ runId: run.id, error: { code: error.code ?? null, message: error.message } });
      }
    }
  }
  const closed = await baton.close();
  record = { ...record, cleanup: { stops, closed: closed.ownership } };
  writeFileSync(evidencePath, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

if (failure) throw failure;
