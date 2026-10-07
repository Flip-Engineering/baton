import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { openBaton } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase89-resident-application-dogfood-live-2026-07-18';
const evidencePath = resolve(evidenceDir, 'evidence.json');
const requests = Object.freeze([
  Object.freeze({
    role: 'resident-architecture',
    report: `${relativeRoot}/glm-resident-review.md`,
    exact: Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' }),
  }),
  Object.freeze({
    role: 'application-ax-security',
    report: `${relativeRoot}/codex-application-review.md`,
    exact: Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'medium' }),
  }),
]);

mkdirSync(evidenceDir, { recursive: true });
rmSync(evidencePath, { force: true });
for (const request of requests) rmSync(resolve(repo, request.report), { force: true });

const baton = await openBaton({
  repo,
  advanced: {
    routes: requests.map(({ exact }) => exact),
    verification: {
      command: 'node',
      arguments: ['--test', 'impl/test/phase89-resident-application-red.test.mjs'],
    },
  },
});

let group = null;
let failure = null;
let record;
try {
  const readiness = await baton.doctor();
  const selected = requests.map((request) => ({
    ...request,
    ready: readiness.routes.find((candidate) => (
      candidate.harness === request.exact.harness
      && candidate.model === request.exact.model
      && candidate.effort === request.exact.effort
    )),
  }));
  const blocked = selected.find(({ ready }) => ready?.state !== 'ready');
  if (blocked) {
    throw Object.assign(new Error(blocked.ready?.summary ?? `${blocked.role} route unavailable`), {
      code: blocked.ready?.code ?? 'route_unavailable',
    });
  }

  group = await baton.runs.startMany(requests.map((request) => ({
    exact: request.exact,
    scope: [request.report],
    objective: [
      `Act as the independent ${request.role} reviewer for Baton's Phase 89 resident application.`,
      'Inspect spec/phase89-authenticated-resident-application.md,',
      'spec/phase89-authenticated-resident-security-matrix.md, impl/src/application.mjs,',
      'impl/src/application-client.mjs, impl/src/application-deployment.mjs,',
      'impl/src/application-cli.mjs, impl/src/application-host.mjs,',
      'impl/src/web-northbound.mjs, and impl/test/phase89-resident-application-red.test.mjs.',
      'Review the new bounded runs.list, validating attach, exposed deployment.runs, common Web',
      'command-port binding, connectBaton handshake, progress timing, and the ordered resident-host',
      'plan. Identify concrete correctness/security/AX defects separately from later acceptance-red',
      'gaps. Prefer the smallest integrated fix that advances openBaton().host() and connectBaton()',
      'without weakening TLS/auth/repository/semantic authority or exposing caller budgets/limits.',
      'Do not invoke nested Baton. Use rtk for every shell operation, exactly one command per call,',
      'with no pipes, &&, semicolons, or unwrapped shell commands. Do not mutate home state,',
      'credentials, harness installations, toolchains, caches, global configuration, runtime paths,',
      `or the main checkout. Write only ${request.report}, then finish immediately.`,
    ].join(' '),
  })));

  const completed = await group.complete();
  const results = await group.inspect({ depth: 'section', section: 'result' });
  const materialized = [];
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index];
    const value = results[index]?.view?.section?.items?.[0]?.value;
    if (!/^[a-f0-9]{40,64}$/u.test(value?.sha ?? '')) {
      throw new Error(`${request.role} produced no preserved result`);
    }
    const report = execFileSync('/usr/bin/git', ['show', `${value.sha}:${request.report}`], {
      cwd: repo, encoding: 'utf8', maxBuffer: 512 * 1024,
    });
    writeFileSync(resolve(repo, request.report), report);
    materialized.push({ role: request.role, route: request.exact, path: request.report, sha: value.sha });
  }
  record = { schemaVersion: 1, completed, materialized };
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
        const stopped = await run.stop('Phase 89 parallel review settled; stop and reap this Run.');
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
