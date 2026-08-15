import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBaton } from '../src/index.mjs';

// #230 red pin — the DEPLOYMENT-level approval→dispatch seam on omp seats. Measured 2026-08-15:
// every wave fired at the migrated resident (six wave-b packs + probes) minted goal→plan→approval
// and then NEVER plan.node_dispatched/task.created; the interpreter quiescence-stopped the
// approved-undispatched run and the fleet exited 0. The swallowed error (surfaced via an
// openBaton in-process repro) is:
//   WorkerPolicySelectionError: harness "omp" cannot satisfy the requested worker permission
//   policy — coordinator._spawn:4600 ← _dispatchCurrent:4435 ← approve:4789.
// The deployment profile's DEFAULT_WORKER_POLICY_REQUEST (autonomy unattended, access full,
// containment workspace_preferred/private_runtime) meets every sibling card's workerPolicy
// advertisement; the omp card carries NONE — so coordinator.spawn refuses after approval.
//
// RED   = run.approve throws worker_policy_invalid (or dispatch never mints).
// GREEN = approve completes; plan.node_dispatched + task.created mint with vendor 'omp'.

const root = (prefix) => mkdtempSync(join(tmpdir(), `baton-${prefix}-`));

async function buildDeployment() {
  const repo = root('omp-deploy-repo');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'omp@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Omp Pin'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  return openBaton({
    repo,
    advanced: {
      routes: [{ harness: 'omp', model: 'deepseek/deepseek-v4-flash', effort: 'high' }],
      verification: Object.freeze({ command: 'true', arguments: [] }),
    },
  });
}

test('DEPLOYMENT-DISPATCH: the omp deployment seat admits dispatch after approval (worker policy satisfies the deployment default)', async () => {
  const baton = await buildDeployment();
  try {
    const handle = await baton.runs.start('Deployment dispatch pin: admit the plan dispatch', {
      runId: 'run-omp-deploy-1',
      harness: 'omp', model: 'deepseek/deepseek-v4-flash', effort: 'high',
    });
    // The facade handle carries approve; the advertised plan digest rides status.
    const status = await handle.status();
    const planDigest = status?.view?.plan?.digest ?? status?.plan?.digest ?? handle?.plan?.digest;
    assert.ok(planDigest, 'run.start must advertise a plan digest');
    await handle.approve();

    // THE SEAM: approval must have dispatched the plan node onto the omp seat.
    const coordination = baton.fleet?.coordination ?? baton.runs?._coordination ?? null;
    // The deployment exposes the driver's coordination ledger through its close receipt; the
    // honest observable is the run view: a dispatched node has a taskId and leaves 'planning'.
    const settled = await handle.status();
    const view = settled?.view ?? settled;
    const phase = view.phase ?? view.outline?.phase;
    const hasTask = Boolean(view.taskId ?? view.outline?.taskId);
    assert.ok(hasTask || !['planning', 'awaiting_approval'].includes(phase),
      `approval must dispatch the node on the omp seat (phase=${phase}, taskId=${view.taskId ?? view.outline?.taskId ?? 'none'})`);
  } finally {
    await baton.close?.();
  }
});
