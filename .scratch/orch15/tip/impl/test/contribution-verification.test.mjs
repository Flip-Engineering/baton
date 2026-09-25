import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyContribution } from '../src/contribution-verification.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function fixture(id = 'author-task') {
  const removed = [];
  const task = Object.freeze({
    id, status: 'paused', sessionContext: Object.freeze({ baseSha: 'base' }),
    brief: Object.freeze({ verification: Object.freeze({ command: 'check' }) }),
  });
  const capture = Object.freeze({ sha: 'contribution', changedPaths: ['src/change.mjs'] });
  const worktrees = {
    async createVerifyWorktree(key, sha) { return { path: `/verify/${key}/${sha}` }; },
    async createBaseVerifyWorktree(key, sha) { return { path: `/verify/${key}/${sha}` }; },
    removeVerifyWorktree(path) { removed.push(path); },
  };
  return { task, capture, worktrees, removed };
}

test('checks run independently and leave author and task lifetime untouched', async () => {
  const a = fixture('reviewer');
  const b = fixture('builder');
  const started = deferred();
  const release = deferred();
  const first = verifyContribution({ ...a, referee: async () => {
    started.resolve(); await release.promise; return { observedExit: 1 };
  } });
  await started.promise;
  const second = await verifyContribution({ ...b, referee: async (task, _, options) => {
    assert.equal(task, b.task);
    assert.equal(options.sandbox, '/verify/builder/contribution');
    assert.equal(options.baseSandbox, '/verify/builder/base');
    return { observedExit: 0 };
  } });
  assert.equal(second.observedVerdict.observedExit, 0);
  assert.equal(second.attempt.cleanup.state, 'closed');
  assert.equal(a.removed.length, 0, 'the active peer still owns its check workspaces');
  release.resolve();
  assert.equal((await first).observedVerdict.observedExit, 1);
  assert.equal(a.task.status, 'paused');
  assert.equal(b.task.status, 'paused');
  assert.equal(a.removed.length, 2);
  assert.equal(b.removed.length, 2);
});

test('sandbox setup failure reports unexecuted verification and uncertain creation', async () => {
  const f = fixture();
  const refused = Object.assign(new Error('materialization response lost'), { code: 'worktree_capacity_unavailable' });
  f.worktrees.createBaseVerifyWorktree = async () => { throw refused; };
  let calls = 0;
  await assert.rejects(verifyContribution({ ...f, referee: async () => { calls++; } }), (error) => {
    assert.equal(error.code, refused.code);
    assert.equal(error.cause, refused);
    assert.equal(error.verificationAttempt.phase, 'base_sandbox');
    assert.equal(error.verificationAttempt.verifierStarted, false);
    assert.equal(error.verificationAttempt.cleanup.state, 'unconfirmed');
    return true;
  });
  assert.equal(calls, 0);
  assert.deepEqual(f.removed, ['/verify/author-task/contribution']);
});

test('a cleanup failure does not erase a completed check or prevent cleanup of its peer sandbox', async () => {
  const f = fixture();
  f.worktrees.removeVerifyWorktree = (path) => {
    f.removed.push(path);
    if (path.endsWith('/contribution')) throw new Error('owned checkout busy');
  };
  const verdict = { observedExit: 0 };
  const result = await verifyContribution({ ...f, referee: async () => verdict });
  assert.equal(result.observedVerdict, verdict);
  assert.equal(result.attempt.verifierStarted, true);
  assert.equal(result.attempt.cleanup.state, 'incomplete');
  assert.equal(result.cleanupError.code, 'worktree_cleanup_failed');
  assert.equal(f.removed.length, 2);
});

test('execution failure retains the primary cause when cleanup also fails', async () => {
  const f = fixture();
  const executionError = Object.assign(new Error('cancelled by caller'), { code: 'verification_aborted' });
  f.worktrees.removeVerifyWorktree = () => { throw new Error('reap refused'); };
  await assert.rejects(verifyContribution({ ...f, referee: async () => { throw executionError; } }), (error) => {
    assert.equal(error.cause, executionError);
    assert.equal(error.code, 'verification_aborted');
    assert.equal(error.verificationAttempt.verifierStarted, true);
    assert.equal(error.cleanupError.causes.length, 2);
    return true;
  });
});
