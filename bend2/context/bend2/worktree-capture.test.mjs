import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRetainedWorktreeCapture } from './worktree-capture.mjs';

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-context-capture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', root]);
  return root;
}

test('the frontend read captures once and later reads use the retained bytes', (t) => {
  const root = repository(t);
  const source = join(root, 'src.bend');
  const owner = 'query-owned-by-coordinator';
  const state = createRetainedWorktreeCapture({ owner, worktree: root });
  assert.equal(state.status, 'ready');

  writeFileSync(source, 'def answer(): 1\n');
  const read = state.acquisition.read;
  const resolution = state.acquisition.resolve(source);
  assert.deepEqual(resolution, { status: 'resolved', identity: source, exists: true });
  const captured = read(resolution.identity);
  assert.equal(captured.status, 'captured');
  assert.equal(captured.bytes.toString('utf8'), 'def answer(): 1\n');
  const digest = captured.sha256;
  assert.deepEqual(state.capture.basePin(source), { path: source, sha256: digest });

  writeFileSync(source, 'def answer(): 2\n');
  assert.equal(read(resolution.identity).bytes.toString('utf8'), 'def answer(): 1\n');
  assert.equal(read(resolution.identity).sha256, digest);
  assert.equal(state.capture.readBytes(source).toString('utf8'), 'def answer(): 1\n');
});

test('resolution admits only actual frontend paths under the checkout and selected package roots', (t) => {
  const root = repository(t);
  const selected = mkdtempSync(join(tmpdir(), 'baton-context-package-'));
  const outside = mkdtempSync(join(tmpdir(), 'baton-context-outside-'));
  t.after(() => rmSync(selected, { recursive: true, force: true }));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'root.bend'), 'root bytes');
  writeFileSync(join(selected, 'base.bend'), 'selected runtime bytes');
  writeFileSync(join(outside, 'foreign.bend'), 'foreign bytes');
  symlinkSync(join(outside, 'foreign.bend'), join(root, 'src', 'escape.bend'));
  const state = createRetainedWorktreeCapture({
    owner: 'query-1', worktree: root, packages: [{ id: 'selected-provider', path: selected }],
  });
  assert.equal(state.status, 'ready');

  assert.equal(state.acquisition.resolve(join(root, 'src', 'root.bend')).exists, true);
  assert.equal(state.acquisition.resolve(join(selected, 'base.bend')).exists, true);
  const escaped = state.acquisition.resolve(join(root, 'src', 'escape.bend'));
  assert.equal(escaped.status, 'refused');
  assert.equal(escaped.reason, 'sourceOutsideAdmittedRoots');
  assert.equal(state.acquisition.resolve(join(outside, 'foreign.bend')).reason, 'sourceOutsideAdmittedRoots');
});

test('a relative frontend read requires its importing source identity', (t) => {
  const root = repository(t);
  const state = createRetainedWorktreeCapture({ owner: 'query-2', worktree: root });
  const answer = state.acquisition.resolve('./dependency.bend');
  assert.equal(answer.status, 'refused');
  assert.equal(answer.reason, 'sourceBaseMissing');
});

test('the retained read set is scoped to its query owner and seals after the invocation', (t) => {
  const root = repository(t);
  const source = join(root, 'source.bend');
  writeFileSync(source, 'def source(): 1\n');
  const state = createRetainedWorktreeCapture({ owner: 'query-3', worktree: root });
  assert.equal(state.capture.forOwner('query-foreign').resolve(source).reason, 'queryOwnerMismatch');

  const resolved = state.acquisition.resolve(source);
  assert.equal(state.acquisition.read(resolved.identity).status, 'captured');
  assert.equal(state.capture.seal('query-3').status, 'sealed');
  assert.equal(state.acquisition.read(resolved.identity).reason, 'queryClosed');
  assert.equal(state.capture.readBytes(source).toString('utf8'), 'def source(): 1\n');
});

test('a relative nested root is refused as the worktree identity', (t) => {
  const root = repository(t);
  const nested = join(root, 'nested');
  mkdirSync(nested);
  assert.equal(createRetainedWorktreeCapture({ owner: 'query-4', worktree: nested }).reason, 'worktreeRootMismatch');
});
