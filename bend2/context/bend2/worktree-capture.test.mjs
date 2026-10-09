import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
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
  const selectedBytes = Buffer.from('selected runtime bytes');
  writeFileSync(join(selected, 'base.bend'), selectedBytes);
  writeFileSync(join(outside, 'foreign.bend'), 'foreign bytes');
  symlinkSync(join(outside, 'foreign.bend'), join(root, 'src', 'escape.bend'));
  const state = createRetainedWorktreeCapture({
    owner: 'query-1', worktree: root,
    packages: [{ id: 'selected-provider', path: selected,
      artifacts: [{ path: 'base.bend', sha256: sha256(selectedBytes) }] }],
  });
  assert.equal(state.status, 'ready');

  assert.equal(state.acquisition.resolve(join(root, 'src', 'root.bend')).exists, true);
  assert.equal(state.acquisition.resolve(join(selected, 'base.bend')).exists, true);
  assert.equal(state.acquisition.resolve(join(selected, 'unselected.bend')).reason, 'sourceNotInSelectedPayload');
  const escaped = state.acquisition.resolve(join(root, 'src', 'escape.bend'));
  assert.equal(escaped.status, 'refused');
  assert.equal(escaped.reason, 'sourceOutsideAdmittedRoots');
  assert.equal(state.acquisition.resolve(join(outside, 'foreign.bend')).reason, 'sourceOutsideAdmittedRoots');
});

test('frontend aliases retain their canonical source bytes and identity', (t) => {
  const root = repository(t);
  const target = join(root, 'target.bend');
  const alias = join(root, 'alias.bend');
  writeFileSync(target, 'def target(): 7\n');
  symlinkSync(target, alias);
  const state = createRetainedWorktreeCapture({ owner: 'query-alias', worktree: root });
  const resolved = state.acquisition.resolve(alias);
  assert.equal(resolved.identity, target);
  const captured = state.acquisition.read(resolved.identity);
  assert.equal(captured.bytes.toString('utf8'), 'def target(): 7\n');
  assert.deepEqual(state.capture.descriptors().map((row) => [row.kind, row.path, row.real]), [
    ['file', target, target], ['symlink', alias, target],
  ]);
  assert.equal(state.capture.readBytes(alias), captured.bytes);
});

test('a selected package artifact must match the digest admitted by its module', (t) => {
  const root = repository(t);
  const selected = mkdtempSync(join(tmpdir(), 'baton-context-package-digest-'));
  t.after(() => rmSync(selected, { recursive: true, force: true }));
  const source = join(selected, 'frontend.ts');
  writeFileSync(source, 'export const version = 2;');
  const state = createRetainedWorktreeCapture({ owner: 'query-digest', worktree: root,
    packages: [{ id: 'bend2-provider', path: selected,
      artifacts: [{ path: 'frontend.ts', sha256: '0'.repeat(64) }] }] });
  assert.equal(state.status, 'ready');
  const resolved = state.acquisition.resolve(source);
  assert.equal(resolved.exists, true);
  assert.equal(state.acquisition.read(resolved.identity).reason, 'selectedPackageDigestMismatch');
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
