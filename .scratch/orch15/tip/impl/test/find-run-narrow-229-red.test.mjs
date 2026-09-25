import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BatonApplication } from '../src/application.mjs';

// #229 red pin — the per-member full-store clone in the run-read path.
//
// Measured live (2026-08-20): one waves_list blocks the resident's event loop 139s
// (finite, measured with a healthz poll loop; healthz AND readyz starve the whole time —
// the production 'TCP accepts, HTTP never answers' signature). The wave page iterates
// members and resolves each run through _findRun; _findRun prefers the narrow
// goalPlanRun() read but FALLS BACK to coordination.snapshot() — a full-store deep clone
// (tasks, runs, lineage, receipts... the #210 furnace) — whenever the narrow read
// misses. Dead/phantom member runs (restart victims, probe runs) all take the fallback.
//
// The contract: on a MODERN store (goalPlanRun available), a narrow miss is AUTHORITATIVE
// — the run has no goal/plan state, and snapshot() would clone the entire world to learn
// the same nothing. The snapshot fallback exists only for stores that lack the narrow
// accessor entirely (pre-#227 deployments).
//
// RED   = a narrow miss falls back to snapshot() (the clone fires per member).
// GREEN = narrow accessor present + miss → no snapshot() call; absent accessor → fallback
//         still works (legacy path preserved).

function appWith({ narrowAvailable, narrowMisses }) {
  const app = Object.create(BatonApplication.prototype);
  let snapshotCalls = 0;
  app.repoId = 'repo-229';
  app.driver = {
    coordination: {
      ...(narrowAvailable ? {
        goalPlanRun: () => (narrowMisses ? null : { goal: { runId: 'run-x' }, plan: null, approval: null, dispatches: [], dispatch: null }),
      } : {}),
      snapshot: () => {
        snapshotCalls += 1;
        return { goalPlan: { goals: [], plans: [], approvals: [], dispatches: [] } };
      },
    },
  };
  return { app, snapshotCalls: () => snapshotCalls };
}
test('FIND-RUN-NARROW (#229): a modern store\'s narrow miss never pays the full-store snapshot clone', () => {
  const { app, snapshotCalls } = appWith({ narrowAvailable: true, narrowMisses: true });
  assert.throws(() => app._findRun('run-dead-beef', { allowUnavailableProfile: true }),
    (e) => e.code === 'application_run_not_found', 'the dead run refuses typed');
  assert.equal(snapshotCalls(), 0,
    `a narrow miss must be authoritative — snapshot() fired ${snapshotCalls()} times (the per-member full-store clone, the #229 furnace)`);
});

test('FIND-RUN-LEGACY: a store without the narrow accessor keeps the snapshot fallback', () => {
  const { app, snapshotCalls } = appWith({ narrowAvailable: false });
  assert.throws(() => app._findRun('run-any', { allowUnavailableProfile: true }),
    (e) => e.code === 'application_run_not_found', 'no goal state anywhere — typed refusal either way');
  assert.equal(snapshotCalls(), 1, 'the legacy path still consults the snapshot exactly once');
});
