import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase87-semantic-action-authority-dogfood-live-2026-07-18';
const evidencePath = resolve(evidenceDir, 'glm-closure-evidence.json');
const reportPath = `${relativeRoot}/glm-closure-review.md`;
const exact = Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' });

rmSync(evidencePath, { force: true });
rmSync(resolve(repo, reportPath), { force: true });

const baton = await openBaton({
  repo,
  advanced: {
    routes: [exact],
    verification: {
      command: 'node',
      arguments: ['--test', 'impl/test/phase87-semantic-action-authority.test.mjs'],
    },
  },
});

let group = null;
let completed = null;
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
      'Perform a narrow closure review of the Phase 87 MCP-over-Web replay fix.',
      'Read the concrete defect section in glm-review.md, the authorizeReplay implementation in',
      'impl/src/mcp-web-bridge.mjs, the relevant completed-replay path in',
      'impl/src/mcp-northbound.mjs, and the bridge/MCP assertions in',
      'impl/test/phase87-semantic-action-authority.test.mjs. Use no more than six repository reads.',
      'Decide whether current capabilities, persisted semantic authority, action identity, registry',
      'effect/capabilities, digest, and opaque MCP transport authority are all checked before a cached',
      'completed result is returned. Identify any remaining concrete bypass separately from test gaps.',
      'Do not invoke nested Baton or run the full suite. Use rtk for every shell operation, exactly',
      'one command per call, with no pipes, &&, semicolons, or unwrapped shell commands.',
      'Do not mutate home state, credentials, toolchains, shims, caches, global configuration,',
      `runtime paths, or main checkout. Write only ${reportPath}, then finish immediately.`,
    ].join(' '),
  }]);
  completed = await group.complete();
  const result = await group.inspect({ depth: 'section', section: 'result' });
  const value = result[0]?.view?.section?.items?.[0]?.value;
  if (!/^[a-f0-9]{40,64}$/u.test(value?.sha ?? '')) {
    throw new Error('GLM closure review produced no preserved result');
  }
  const report = execFileSync('/usr/bin/git', ['show', `${value.sha}:${reportPath}`], {
    cwd: repo, encoding: 'utf8', maxBuffer: 512 * 1024,
  });
  writeFileSync(resolve(repo, reportPath), report);
  record = {
    schemaVersion: 1, route: { ...exact, state: route.state }, group: completed,
    materialized: { path: reportPath, sha: value.sha },
  };
} catch (error) {
  failure = error;
  record = { schemaVersion: 1, error: {
    name: error.name, code: error.code ?? null, message: error.message,
  }, ...(completed ? { group: completed } : {}) };
} finally {
  const stops = [];
  if (group) {
    for (const run of group.runs) {
      try {
        const stopped = await run.stop(
          'Phase 87 closure review settled; stop and reap this exact Run.',
        );
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
