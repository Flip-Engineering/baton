import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase88-plan-route-tuple-authority-dogfood-live-2026-07-18';
const evidencePath = resolve(evidenceDir, 'evidence.json');
const reportPath = `${relativeRoot}/glm-review.md`;
const exact = Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' });

mkdirSync(evidenceDir, { recursive: true });
rmSync(evidencePath, { force: true });
rmSync(resolve(repo, reportPath), { force: true });

const baton = await openBaton({
  repo,
  advanced: {
    routes: [exact],
    verification: {
      command: 'node',
      arguments: ['--test', 'impl/test/phase88-plan-route-authority.test.mjs'],
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
      'Adversarially review Phase 88 exact Plan route tuple authority as a bounded Baton worker.',
      'Inspect spec/phase88-plan-route-tuple-authority-v2.md; the route normalization/helpers in',
      'impl/src/goal-plan.mjs; Plan replay/live dispatch in impl/src/coordination-store.mjs;',
      'route generation, recovery, resume, and progressive projection in impl/src/application.mjs;',
      'workflow validation in impl/src/workflow-definition.mjs; Web/MCP Plan route schemas; and',
      'impl/test/phase88-plan-route-authority.test.mjs. Use no more than fourteen repository reads.',
      'Look specifically for Cartesian authority widening, locale-dependent digests, unsafe legacy',
      'migration, new dispatch from ambiguous historical authority, idempotent replay breakage,',
      'first-element selection, recovery/resume route substitution, or Web/MCP schema drift.',
      'Separate concrete defects from bounded follow-up gaps. Do not invoke nested Baton.',
      'Use rtk for every shell operation, exactly one command per call, with no pipes, &&,',
      'semicolons, or unwrapped shell commands. Do not mutate home state, credentials, toolchains,',
      'shims, caches, global configuration, runtime paths, or the main checkout.',
      `Write only ${reportPath}, then finish immediately. Do not change any other path.`,
    ].join(' '),
  }]);

  const completed = await group.complete();
  const result = await group.inspect({ depth: 'section', section: 'result' });
  const value = result[0]?.view?.section?.items?.[0]?.value;
  if (!/^[a-f0-9]{40,64}$/u.test(value?.sha ?? '')) {
    throw new Error('GLM route-authority review produced no preserved result');
  }
  const report = execFileSync('/usr/bin/git', ['show', `${value.sha}:${reportPath}`], {
    cwd: repo, encoding: 'utf8', maxBuffer: 512 * 1024,
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
        const stopped = await run.stop(
          'Phase 88 route-authority review settled; stop and reap this exact Run.',
        );
        stops.push({ runId: run.id, stop: stopped.stop ?? null,
          ownership: stopped.ownership ?? null });
      } catch (error) {
        stops.push({ runId: run.id,
          error: { code: error.code ?? null, message: error.message } });
      }
    }
  }
  const closed = await baton.close();
  record = { ...record, cleanup: { stops, closed: closed.ownership } };
  writeFileSync(evidencePath, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

if (failure) throw failure;
