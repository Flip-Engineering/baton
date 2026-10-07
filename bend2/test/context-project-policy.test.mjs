import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeProjectPolicy } from '../scripts/context-project-policy.mjs';

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-project-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', root]);
  return root;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('policy observation retains exact bytes and their digest under the query owner', (t) => {
  const worktree = repository(t);
  const bytes = Buffer.from('{"schema":"baton2-context-project-v1","disabled":[],"preferred":[]}\n');
  mkdirSync(join(worktree, '.baton'));
  writeFileSync(join(worktree, '.baton/context.json'), bytes);

  const observed = observeProjectPolicy({ owner: 'query-1', worktree });
  assert.equal(observed.status, 'present');
  assert.equal(observed.owner, 'query-1');
  assert.equal(observed.path, join(worktree, '.baton/context.json'));
  assert.equal(observed.bytes, bytes.toString('utf8'));
  assert.equal(observed.sha256, sha256(bytes));
  assert.deepEqual(observed.retainedReadSet.descriptors, [{
    kind: 'file', path: observed.path, real: observed.path, sha256: sha256(bytes),
  }]);
});

test('only a captured missing policy path produces an absent observation', (t) => {
  const worktree = repository(t);
  const observed = observeProjectPolicy({ owner: 'query-absent', worktree });
  assert.equal(observed.status, 'absent');
  assert.equal(observed.marker, 'absent');
  assert.equal(observed.path, join(worktree, '.baton/context.json'));
  assert.deepEqual(observed.retainedReadSet.descriptors, [{
    kind: 'absent', path: observed.path, real: observed.path,
  }]);
});

test('a policy symlink that resolves outside the owner worktree refuses', (t) => {
  const worktree = repository(t);
  const outside = mkdtempSync(join(tmpdir(), 'baton-project-policy-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  mkdirSync(join(worktree, '.baton'));
  writeFileSync(join(outside, 'context.json'), '{"schema":"baton2-context-project-v1","disabled":[],"preferred":[]}');
  symlinkSync(join(outside, 'context.json'), join(worktree, '.baton/context.json'));

  const observed = observeProjectPolicy({ owner: 'query-escape', worktree });
  assert.equal(observed.status, 'refused');
  assert.equal(observed.reason, 'projectPolicyPathUnavailable');
});

test('present policy bytes must have the exact schema and unique nonempty module IDs', (t) => {
  const worktree = repository(t);
  mkdirSync(join(worktree, '.baton'));
  const path = join(worktree, '.baton/context.json');
  for (const bytes of [
    '{',
    '{"schema":"baton2-context-project-v1","disabled":[],"preferred":[],"extra":true}',
    '{"schema":"baton2-context-project-v1","disabled":["mod","mod"],"preferred":[]}',
    '{"schema":"baton2-context-project-v1","schema":"baton2-context-project-v1","disabled":[],"preferred":[]}',
    '{"schema":"baton2-context-project-v1","disabled":[""],"preferred":[]}',
    '{"schema":"baton2-context-project-v1","disabled":"mod","preferred":[]}',
  ]) {
    writeFileSync(path, bytes);
    assert.equal(observeProjectPolicy({ owner: 'query-invalid', worktree }).reason,
      'projectPolicyMalformed', bytes);
  }
});

test('missing owner or worktree authority refuses before reading policy', () => {
  assert.equal(observeProjectPolicy({ worktree: '/tmp' }).reason, 'projectPolicyAuthorityMissing');
  assert.equal(observeProjectPolicy({ owner: 'query-1' }).reason, 'projectPolicyAuthorityMissing');
});
