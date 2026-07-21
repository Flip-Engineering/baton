import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase89-resident-host-closure-live-2026-07-18';
const evidencePath = resolve(evidenceDir, 'evidence.json');
const requests = Object.freeze([
  Object.freeze({
    role: 'resident-host-authority',
    report: `${relativeRoot}/glm-host-authority-review.md`,
    exact: Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' }),
  }),
  Object.freeze({
    role: 'post-fix-command-port-and-AX',
    report: `${relativeRoot}/codex-postfix-review.md`,
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
        'impl/test/phase89-resident-application-red.test.mjs',
        'impl/test/phase89-resident-host-red.test.mjs',
      ],
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
      `Act as Baton's independent ${request.role} reviewer after the first Phase 89 fixes.`,
      'Inspect the Phase 89 specifications, assessment, application/client/deployment/CLI/host/Web',
      'implementation, and both Phase 89 tests. Confirm or refute each claimed post-fix property.',
      'Then design the smallest next ordinary openBaton().host() vertical that owns a private local',
      'transport, private session authority, stable deployment ID, fresh incarnation, fenced writer',
      'lease, readiness-before-publication, authenticated connection challenge, and CAS cleanup.',
      'Separate invariants, implementation seams, adversarial tests, and intentionally deferred',
      'network/send/interrupt/stream work. Look specifically for principal/idempotency confusion,',
      'token or path leakage, PID reuse, symlink/permission attacks, duplicate hosts, stale selector',
      'takeover, partial start rollback, and host/application close ownership. Prefer an integrated',
      'Pythonic owner/connected Runs surface; do not expose budgets, limits, sockets, tokens, leases,',
      'or receipts to ordinary callers. Do not invoke nested Baton. Use rtk for every shell command,',
      'one command per call. Do not mutate credentials, harness installations, global configuration,',
      `or the main checkout. Write only ${request.report}, run the pinned verification, and finish.`,
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
        const stopped = await run.stop('Phase 89 resident-host closure review settled.');
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
