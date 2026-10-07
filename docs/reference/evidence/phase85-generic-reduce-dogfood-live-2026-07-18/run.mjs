import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-generic-reduce-'));
mkdirSync(evidenceDir, { recursive: true });

const codex = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
const high = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const team = Object.freeze([
  { role: 'reduce-contract-reviewer', exact: codex },
  { role: 'reduce-ax-adversary', exact: high },
]);

let baton; let workflow; let failure = null; let record = null;
try {
  baton = await openBaton({
    repo,
    advanced: {
      deploymentRoot, routes: [codex, high],
      verification: {
        command: 'node', arguments: [
          '--test', 'impl/test/phase85-context-effect-admission-red.test.mjs',
          'impl/test/phase84-context-map-wave-red.test.mjs',
        ],
      },
    },
  });
  const readiness = await baton.doctor();
  workflow = await baton.workflow([
    'Adversarially review the current effective Baton implementation of public context_reduce and',
    'generic effect-call dispatch. Inspect the actual code and focused tests. Verify that admission',
    'has zero provider effects, restart proposes exactly once, approval dispatches exactly once on',
    'the selected harness/model/effort, the physical Brief revalidates result ref to capsule to',
    'private source content, historical map replay remains compatible, and stop/reap closes the',
    'generic worker. Look for integrity, replay, requester-authority, AX, and secret-boundary flaws.',
    'If you find a concrete defect, implement the smallest scoped fix with a red/green test; otherwise',
    'write a concise evidence note at',
    'docs/reference/evidence/phase85-generic-reduce-dogfood-live-2026-07-18/review.md.',
    'Do not broaden into generic settlement, retries, or another API. Run the focused tests and finish.',
  ].join(' '), {
    scope: [
      'impl/src/context-call.mjs', 'impl/src/coordination-store.mjs',
      'impl/src/application.mjs', 'impl/src/application-client.mjs',
      'impl/src/application-semantics.mjs', 'impl/src/index.mjs',
      'impl/test/phase85-context-effect-admission-red.test.mjs',
      'impl/test/phase84-context-map-wave-red.test.mjs',
      'docs/reference/evidence/phase85-generic-reduce-dogfood-live-2026-07-18/review.md',
    ],
    team,
  });
  await workflow.complete();
  const status = await workflow.status();
  const candidates = (await workflow.candidates()).section.items.map(({ value }) => ({
    role: value.role, candidateId: value.candidateId, resultSha: value.resultSha,
    retainedResultRef: value.retainedResultRef, changedPaths: value.changedPaths,
  }));
  record = {
    schemaVersion: 1, deploymentRoot, runId: workflow.id,
    readiness: readiness.routes.map(({ harness, model, effort, state, code = null }) => ({
      harness, model, effort, state, code,
    })),
    team, phase: status.phase,
    attempts: status.attempts.map(({ role, state, route, taskId, candidateId }) => ({
      role, state, route, taskId, candidateId,
    })),
    candidates,
  };
} catch (error) {
  failure = error;
  record = {
    schemaVersion: 1, deploymentRoot, runId: workflow?.id ?? null,
    error: { name: error.name, code: error.code ?? null, message: error.message },
  };
} finally {
  let stopped = null; let closed = null;
  if (workflow) {
    try {
      await workflow.stop('Retain review Candidates and reap every exact descendant.');
      const status = await workflow.status();
      stopped = { stop: status.stop, ownership: status.ownership };
      if (status.stop?.receipt?.remainingCount !== 0 || status.ownership?.workers !== 0) {
        failure ??= new Error('Generic reduce dogfood stop proof is incomplete');
      }
    } catch (error) { failure ??= error; }
  }
  if (baton) {
    try { closed = (await baton.close()).ownership; }
    catch (error) { failure ??= error; }
  }
  writeFileSync(join(evidenceDir, 'evidence-codex.json'),
    `${JSON.stringify({ record, cleanup: { stopped, closed } }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ record, cleanup: { stopped, closed } })}\n`);
  if (closed?.closed === true && closed?.workers === 0) {
    rmSync(deploymentRoot, { recursive: true, force: true });
  }
}
if (failure) throw failure;
