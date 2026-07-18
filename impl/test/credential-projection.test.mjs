import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectCredentialTree } from '../src/credential-projection.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'baton-credential-source-'));
  chmodSync(root, 0o700);
  mkdirSync(join(root, 'credentials'), { mode: 0o700 });
  writeFileSync(join(root, 'config.toml'), 'api_key = "config-secret-value"\n', { mode: 0o600 });
  writeFileSync(join(root, 'credentials', 'kimi-code.json'), JSON.stringify({ access_token: 'subscription-secret-value' }), { mode: 0o600 });
  const target = mkdtempSync(join(tmpdir(), 'baton-credential-target-'));
  chmodSync(target, 0o700);
  return { root, target };
}

test('credential projection copies only allow-listed files privately and redacts nested frames', () => {
  const { root, target } = fixture();
  const projected = projectCredentialTree({ sourceRoot: root, targetRoot: target, relativeFiles: ['config.toml', 'credentials/kimi-code.json'] });
  assert.equal(projected.count, 2);
  assert.equal(lstatSync(join(target, 'credentials')).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(target, 'credentials', 'kimi-code.json')).mode & 0o777, 0o600);
  assert.match(readFileSync(join(target, 'config.toml'), 'utf8'), /config-secret-value/);
  assert.deepEqual(projected.redactProviderFrame({ text: 'config-secret-value and subscription-secret-value' }), { text: '[REDACTED] and [REDACTED]' });
});

test('credential projection refuses symlinks and source mutation', () => {
  const { root, target } = fixture();
  symlinkSync(join(root, 'config.toml'), join(root, 'linked'));
  assert.throws(() => projectCredentialTree({ sourceRoot: root, targetRoot: join(target, 'one'), relativeFiles: ['linked'] }), (error) => error.code === 'source_file_unsafe');
  assert.throws(() => projectCredentialTree({
    sourceRoot: root, targetRoot: join(target, 'two'), relativeFiles: ['config.toml'],
    afterRead() { writeFileSync(join(root, 'config.toml'), 'changed = true\n'); },
  }), (error) => error.code === 'source_file_changed');
});

test('credential projection refuses traversal and unsafe source directories', () => {
  const { root, target } = fixture();
  assert.throws(() => projectCredentialTree({ sourceRoot: root, targetRoot: join(target, 'one'), relativeFiles: ['../outside'] }), (error) => error.code === 'relative_path_invalid');
  chmodSync(join(root, 'credentials'), 0o777);
  assert.throws(() => projectCredentialTree({ sourceRoot: root, targetRoot: join(target, 'two'), relativeFiles: ['credentials/kimi-code.json'] }), (error) => error.code === 'source_directory_writable');
});
