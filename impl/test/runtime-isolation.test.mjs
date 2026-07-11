import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RuntimeIsolation, isSecretEnvName } from '../src/runtime-isolation.mjs';

test('GV6: runtime scope strips ambient secrets and creates private vendor homes', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'baton-runtime-'));
  const isolation = new RuntimeIsolation({
    repoRoot,
    baseEnv: { PATH: '/bin', LANG: 'C', HOME: '/operator', OPENAI_API_KEY: 'ambient-secret', RANDOM_FLAG: 'safe' },
    credentialEnv: { codex: { OPENAI_API_KEY: 'scoped-secret' } },
  });
  const scope = isolation.create('w-1', 'codex');
  assert.equal(scope.env.HOME.endsWith('/w-1/home'), true);
  assert.equal(scope.env.CODEX_HOME.endsWith('/w-1/config/codex'), true);
  assert.equal(scope.env.OPENAI_API_KEY, 'scoped-secret');
  assert.equal(scope.env.RANDOM_FLAG, 'safe');
  assert.equal(statSync(scope.posture.root).mode & 0o777, 0o700);
  assert.deepEqual(scope.posture.projectedEnvKeys, ['OPENAI_API_KEY']);
  assert.equal(JSON.stringify(scope.posture).includes('scoped-secret'), false);
  isolation.remove('w-1');
  assert.equal(statSync(isolation.root).isDirectory(), true);
});

test('GV6: explicit credential files are copied mode 0600 without exposing content in posture', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'baton-runtime-file-'));
  const source = join(repoRoot, 'auth.json');
  writeFileSync(source, '{"token":"file-secret"}');
  const isolation = new RuntimeIsolation({ repoRoot, baseEnv: { PATH: '/bin' }, credentialFiles: { grok: [source] } });
  const scope = isolation.create('w-2', 'grok');
  const target = join(scope.posture.config, 'auth.json');
  assert.equal(statSync(target).mode & 0o777, 0o600);
  assert.deepEqual(scope.posture.projectedFiles, ['auth.json']);
  assert.equal(JSON.stringify(scope.posture).includes('file-secret'), false);
});

test('GV6: secret-name classifier covers provider credentials but not ordinary settings', () => {
  assert.equal(isSecretEnvName('ANTHROPIC_AUTH_TOKEN'), true);
  assert.equal(isSecretEnvName('XAI_API_KEY'), true);
  assert.equal(isSecretEnvName('DATABASE_PASSWORD'), true);
  assert.equal(isSecretEnvName('PATH'), false);
});
