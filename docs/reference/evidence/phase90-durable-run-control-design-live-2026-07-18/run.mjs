import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase90-durable-run-control-design-live-2026-07-18';
const evidencePath = resolve(evidenceDir, 'evidence.json');
const requests = Object.freeze([
  Object.freeze({
    role: 'durable-control-authority',
    report: `${relativeRoot}/glm-control-authority-review.md`,
    exact: Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' }),
  }),
  Object.freeze({
    role: 'progressive-run-control-AX',
    report: `${relativeRoot}/codex-run-control-ax-review.md`,
    exact: Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }),
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
      arguments: [
        '--test',
        'impl/test/phase64-integrated-run-application.test.mjs',
        'impl/test/phase89-resident-application-red.test.mjs',
      ],
    },
  },
});

let group = null;
let failure = null;
let record;
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

  group = await baton.runs.startMany(requests.map((request) => ({
    exact: request.exact,
    scope: [request.report],
    objective: [
      `Act as Baton's independent ${request.role} designer for the next resident application slice.`,
      'Inspect the authenticated resident application and security-matrix specs, application',
      'semantic registry, client, application dispatcher, coordinator control paths, coordination',
      'ledger patterns, Web command reconciliation, progressive AX tests, and Slate assessment.',
      'Design the smallest implementation-ready vertical for ordinary run.send(message, options)',
      'and run.interrupt(options), followed by Run-scoped resumable event/output/progress streams.',
      'The ordinary surface must resolve semantic recipients such as work, workflow role, or review',
      'server-side; callers never manage worker IDs, fences, request IDs, event limits, budgets, or',
      'transport details. Bind durable admission to semantic recipient, resolved worker and current',
      'fence at effect time, delivery mode, message/reason digests, actor/session, registry digest,',
      'and provider request identity. Specify exact confirmed/refused/outcome_unknown settlement,',
      'restart reconciliation, response-loss replay, concurrent send ordering, send/interrupt and',
      'interrupt/stop races, selective-session preservation, Web/direct parity, and exact stop/reap.',
      'Prefer one Pythonic cascading Run API and context-sensitive help. Do not invent a second',
      'control plane or expose internal receipts. Identify exact source seams and RED tests, critique',
      'overengineering, and preserve later recursive/shared-task/RLM/Slate/Atlas/Cairn composition.',
      'Do not invoke nested Baton. Use rtk for every shell command, one command per call. Do not',
      'mutate credentials, harness installations, global configuration, or the main checkout.',
      `Write only ${request.report}, run the pinned verification, and finish.`,
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
        const stopped = await run.stop('Phase 90 durable-control design review settled.');
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
