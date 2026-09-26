// Issue #608: an ORPHANED handle is the historical record of a worker that died with an earlier
// incarnation (#364) — its process status is a record, not a process. `holdsWorkspace` counted
// every orphaned handle as a live holder of its own checkout (its cleanup was by definition not
// finalized), so the recovered startup's workspace reclamation consulted a custody holder that
// was the very dead owner it was deciding over, and every crash-recovered checkout was retained
// forever (observed 2026-09-26: `workspace_other_holder_live_retained` on both dead workers'
// worktrees; the git registrations never pruned). The law now: an orphaned handle holds its
// checkout only while a kernel-start-bound process generation is proven to have survived the
// restart and still owns it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { holdsWorkspace } from '../src/shared-workspace-custody.mjs';

const base = {
  id: 'w-1', status: 'orphaned',
  worktree: '/repo/.baton/wt/ws-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  sessionContext: { ownerTaskId: 'ws-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
};

test('608-h1: an orphaned handle whose process death is proven is not a holder of its own checkout', () => {
  assert.equal(holdsWorkspace({
    ...base,
    processRef: { state: 'closed' },
    recoveredProcessAuthority: false,
  }), false, 'the dead owner must not block the startup reclamation of its own workspace');
});

test('608-h2: an orphaned handle keeps its hold while a recovered process generation still owns it', () => {
  assert.equal(holdsWorkspace({
    ...base,
    processRef: { state: 'unconfirmed_after_restart' },
    recoveredProcessAuthority: true,
  }), true, 'a kernel-start-bound generation that survived the restart still works in it');
});

test('608-h3: once the pass settles the recovered generation as absent, the hold ends', () => {
  assert.equal(holdsWorkspace({
    ...base,
    processRef: { state: 'closed' },
    recoveredProcessAuthority: false,
  }), false);
});

test('608-h4: an orphaned handle whose cleanup finalized is not a holder either way', () => {
  assert.equal(holdsWorkspace({
    ...base,
    processRef: { state: 'unconfirmed_after_restart' },
    recoveredProcessAuthority: true,
    physicalWorkspaceCleanupCompleted: true,
  }), false, 'a finalized cleanup is a released hold');
});

test('608-h5: the live-holder statuses keep holding exactly as before', () => {
  for (const status of ['pending', 'working', 'blocked', 'stopping', 'idle']) {
    assert.equal(holdsWorkspace({ ...base, status }), true, `${status} still holds`);
  }
});
