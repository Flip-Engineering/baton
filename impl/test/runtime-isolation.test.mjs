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
  assert.equal(statSync(scope.paths.root).mode & 0o777, 0o700);
  assert.deepEqual(scope.posture, {
    schemaVersion: 1,
    family: 'codex',
    credential: { mechanism: 'environment', state: 'materialized', count: 1 },
    permissions: { directories: '0700', credentialFiles: '0600' },
    sandboxPolicy: 'wire-workspaceWrite-network-deny',
    active: true,
  });
  assert.equal(JSON.stringify(scope.posture).includes('scoped-secret'), false);
  assert.equal(JSON.stringify(scope.posture).includes(repoRoot), false);
  assert.equal(JSON.stringify(scope.posture).includes('OPENAI_API_KEY'), false);
  isolation.remove('w-1');
  assert.equal(statSync(isolation.root).isDirectory(), true);
});

test('GV6: explicit credential files are copied mode 0600 without exposing content in posture', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'baton-runtime-file-'));
  const source = join(repoRoot, 'auth.json');
  writeFileSync(source, '{"token":"file-secret"}');
  const isolation = new RuntimeIsolation({ repoRoot, baseEnv: { PATH: '/bin' }, credentialFiles: { grok: [source] } });
  const scope = isolation.create('w-2', 'grok');
  assert.equal(scope.paths.config.endsWith('/w-2/home/.grok'), true);
  const target = join(scope.paths.config, 'auth.json');
  assert.equal(statSync(target).mode & 0o777, 0o600);
  assert.deepEqual(scope.posture, {
    schemaVersion: 1,
    family: 'grok',
    credential: { mechanism: 'file', state: 'materialized', count: 1 },
    permissions: { directories: '0700', credentialFiles: '0600' },
    sandboxPolicy: 'native-workspace-profile',
    active: true,
  });
  assert.equal(JSON.stringify(scope.posture).includes('file-secret'), false);
  assert.equal(JSON.stringify(scope.posture).includes(repoRoot), false);
  assert.equal(JSON.stringify(scope.posture).includes('auth.json'), false);
});

test('GV6: public posture is a closed path-free credential summary for absent and mixed projection', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'baton-runtime-posture-'));
  const source = join(repoRoot, 'credential.fixture');
  writeFileSync(source, 'fixture-secret');
  const isolation = new RuntimeIsolation({
    repoRoot,
    baseEnv: { PATH: '/bin', HOME: '/operator', DATABASE_PASSWORD: 'ambient-secret' },
    credentialEnv: { glm: { ANTHROPIC_AUTH_TOKEN: 'scoped-secret' } },
    credentialFiles: { glm: [source] },
  });

  const absent = isolation.create('w-absent', 'claude');
  assert.deepEqual(absent.posture.credential, { mechanism: 'none', state: 'absent', count: 0 });
  const mixed = isolation.create('w-mixed', 'glm');
  assert.deepEqual(mixed.posture.credential, { mechanism: 'mixed', state: 'materialized', count: 2 });
  assert.deepEqual(Object.keys(mixed.posture).sort(), ['active', 'credential', 'family', 'permissions', 'sandboxPolicy', 'schemaVersion'].sort());
  assert.deepEqual(Object.keys(mixed.posture.credential).sort(), ['count', 'mechanism', 'state']);
  const publicJson = JSON.stringify(mixed.posture);
  for (const forbidden of [repoRoot, source, 'credential.fixture', 'ANTHROPIC_AUTH_TOKEN', 'DATABASE_PASSWORD', 'scoped-secret', 'ambient-secret']) {
    assert.equal(publicJson.includes(forbidden), false, `public posture must not contain ${forbidden}`);
  }
});

test('GV6: secret-name classifier covers provider credentials but not ordinary settings', () => {
  assert.equal(isSecretEnvName('ANTHROPIC_AUTH_TOKEN'), true);
  assert.equal(isSecretEnvName('XAI_API_KEY'), true);
  assert.equal(isSecretEnvName('DATABASE_PASSWORD'), true);
  assert.equal(isSecretEnvName('PATH'), false);
});
