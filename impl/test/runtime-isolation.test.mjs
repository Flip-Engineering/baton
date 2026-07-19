import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
    authPosture: 'unknown',
    credential: { mechanism: 'environment', state: 'materialized', count: 1 },
    permissions: { directories: '0700', credentialFiles: '0600' },
    sandboxPolicy: 'full-access-private-runtime-only',
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
    authPosture: 'unknown',
    credential: { mechanism: 'file', state: 'materialized', count: 1 },
    permissions: { directories: '0700', credentialFiles: '0600' },
    sandboxPolicy: 'full-access-private-runtime-only',
    active: true,
  });
  assert.equal(JSON.stringify(scope.posture).includes('file-secret'), false);
  assert.equal(JSON.stringify(scope.posture).includes(repoRoot), false);
  assert.equal(JSON.stringify(scope.posture).includes('auth.json'), false);
  assert.deepEqual(scope.redactProviderFrame({ error: 'token=file-secret' }), {
    error: 'token=[REDACTED]',
  });
});

test('GV6: explicit credential-file projection refuses a symbolic-link source', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'baton-runtime-file-link-'));
  const sourceRoot = mkdtempSync(join(tmpdir(), 'baton-runtime-file-link-source-'));
  const actual = join(sourceRoot, 'actual.json');
  const link = join(sourceRoot, 'auth.json');
  writeFileSync(actual, '{"token":"file-secret"}', { mode: 0o600 });
  symlinkSync(actual, link);
  const isolation = new RuntimeIsolation({
    repoRoot, baseEnv: { PATH: '/bin' }, credentialFiles: { grok: [link] },
  });
  assert.throws(
    () => isolation.create('w-link', 'grok'),
    (error) => error?.code === 'source_file_unsafe',
  );
  isolation.remove('w-link');
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
  assert.deepEqual(Object.keys(mixed.posture).sort(), ['active', 'authPosture', 'credential', 'family', 'permissions', 'sandboxPolicy', 'schemaVersion'].sort());
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

test('KK4: Kimi receives its own private Claude-compatible runtime scope', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'baton-runtime-kimi-'));
  const isolation = new RuntimeIsolation({ repoRoot, baseEnv: { PATH: '/bin' } });
  const scope = isolation.create('w-kimi', { card: {
    harness: 'claude-code', authPosture: 'api_key',
    modelSelection: { family: 'kimi' }, providerCompatibility: { credentialState: 'available' },
  } });
  assert.equal(scope.posture.family, 'kimi');
  assert.equal(scope.posture.authPosture, 'api_key');
  assert.equal(scope.paths.config.endsWith('/config/kimi'), true);
  assert.equal(scope.env.CLAUDE_CONFIG_DIR, scope.paths.config);
  assert.deepEqual(scope.posture.credential, { mechanism: 'adapter', state: 'materialized', count: 1 });
});

test('KK4/KK8: Kimi-through-Claude runtime creation and removal leave global Claude state byte-for-byte untouched', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'baton-runtime-kimi-global-'));
  const operatorHome = mkdtempSync(join(tmpdir(), 'baton-operator-home-'));
  const globalConfig = join(operatorHome, '.claude');
  const globalSettings = join(globalConfig, 'settings.json');
  mkdirSync(globalConfig, { recursive: true, mode: 0o700 });
  const original = '{"operator":"unchanged"}\n';
  writeFileSync(globalSettings, original, { mode: 0o600 });
  const before = statSync(globalSettings);
  const isolation = new RuntimeIsolation({
    repoRoot,
    baseEnv: { PATH: '/bin', HOME: operatorHome, CLAUDE_CONFIG_DIR: globalConfig, ANTHROPIC_API_KEY: 'ambient-must-not-cross' },
  });
  const scope = isolation.create('w-kimi-global', { card: {
    harness: 'claude-code', authPosture: 'api_key',
    modelSelection: { family: 'kimi' }, providerCompatibility: { credentialState: 'available' },
  } });
  assert.notEqual(scope.env.HOME, operatorHome);
  assert.notEqual(scope.env.CLAUDE_CONFIG_DIR, globalConfig);
  assert.equal(scope.env.ANTHROPIC_API_KEY, undefined);
  isolation.remove('w-kimi-global');
  const after = statSync(globalSettings);
  assert.equal(readFileSync(globalSettings, 'utf8'), original);
  assert.equal(after.mode & 0o777, before.mode & 0o777);
  assert.equal(after.ino, before.ino);
});

test('KC4: native Kimi gets a private KIMI_CODE_HOME and minimal subscription tree with redaction', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'baton-runtime-native-kimi-repo-'));
  const sourceRoot = mkdtempSync(join(tmpdir(), 'baton-runtime-native-kimi-source-'));
  mkdirSync(join(sourceRoot, 'credentials'), { mode: 0o700 });
  mkdirSync(join(sourceRoot, 'oauth'), { mode: 0o700 });
  writeFileSync(join(sourceRoot, 'config.toml'), 'default_model = "kimi-code/k3"\n', { mode: 0o600 });
  writeFileSync(join(sourceRoot, 'device_id'), 'fixture-device', { mode: 0o600 });
  writeFileSync(join(sourceRoot, 'credentials', 'kimi-code.json'), JSON.stringify({ access_token: 'native-subscription-secret' }), { mode: 0o600 });
  writeFileSync(join(sourceRoot, 'oauth', 'kimi-code'), '', { mode: 0o600 });
  const isolation = new RuntimeIsolation({
    repoRoot, baseEnv: { PATH: '/bin', KIMI_API_KEY: 'ambient-must-not-cross' },
    credentialTrees: { 'kimi-code': [{
      sourceRoot,
      relativeFiles: ['config.toml', 'device_id', 'credentials/kimi-code.json', 'oauth/kimi-code'],
    }] },
  });
  const scope = isolation.create('w-native-kimi', { card: {
    harness: 'kimi-code', authPosture: 'subscription', modelSelection: { family: 'kimi' },
  } });
  assert.equal(scope.env.KIMI_CODE_HOME, scope.paths.config);
  assert.equal(scope.env.KIMI_API_KEY, undefined);
  assert.equal(scope.env.KIMI_DISABLE_TELEMETRY, '1');
  assert.equal(scope.env.KIMI_CODE_NO_AUTO_UPDATE, '1');
  assert.equal(scope.env.KIMI_CODE_BACKGROUND_KEEP_ALIVE_ON_EXIT, '0');
  assert.equal(statSync(join(scope.paths.config, 'credentials')).mode & 0o777, 0o700);
  assert.equal(statSync(join(scope.paths.config, 'credentials', 'kimi-code.json')).mode & 0o777, 0o600);
  assert.deepEqual(scope.posture.credential, { mechanism: 'file', state: 'materialized', count: 4 });
  assert.deepEqual(scope.redactProviderFrame({ text: 'native-subscription-secret' }), { text: '[REDACTED]' });
  assert.equal(JSON.stringify(scope.posture).includes(sourceRoot), false);
});

test('KC4: native Kimi credential projection refuses repository-owned sources', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'baton-runtime-native-kimi-inrepo-'));
  const sourceRoot = join(repoRoot, 'credentials');
  mkdirSync(sourceRoot, { mode: 0o700 });
  writeFileSync(join(sourceRoot, 'config.toml'), 'safe = true\n', { mode: 0o600 });
  const isolation = new RuntimeIsolation({
    repoRoot, baseEnv: { PATH: '/bin' },
    credentialTrees: { 'kimi-code': [{ sourceRoot, relativeFiles: ['config.toml'] }] },
  });
  assert.throws(
    () => isolation.create('w-refuse', { card: { harness: 'kimi-code', authPosture: 'subscription', modelSelection: { family: 'kimi' } } }),
    (error) => error.code === 'credential_source_in_repository',
  );
});
