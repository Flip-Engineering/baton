// Issue #515: a read-only CLI command locks itself out of its own running resident the moment the
// checkout moves one commit ahead — `baton swarm view` refused with
// `repository_selector_registry_digest_drift` purely because the CLI's authority digest differs from
// the selector the resident published. Read-only commands tolerate registry digest drift; mutating
// commands still refuse.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as cliModule from '../src/application-cli.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';

const { discoverBatonConnection, parseBatonCli } = cliModule;

const CLI_REGISTRY_DIGEST = APPLICATION_SEMANTIC_REGISTRY.digest;
const DRIFTED_DIGEST = 'a'.repeat(64);
const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue515-${label}-`));
  roots.push(root);
  return root;
}

function repository(label) {
  const repo = join(scratch(`${label}-repo`), 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  return repo;
}

function driftedAuthority(label) {
  const repo = repository(label);
  const repoId = `repo-${createHash('sha256').update(realpathSync(join(repo, '.git')))
    .digest('hex').slice(0, 32)}`;
  const home = scratch(`${label}-home`);
  const configRoot = join(home, 'config');
  const profilesRoot = join(configRoot, 'baton', 'connections');
  const authorityRoot = join(repo, '.git', 'baton');
  mkdirSync(profilesRoot, { recursive: true });
  mkdirSync(authorityRoot, { recursive: true });
  const profileName = `issue515-${label}`;
  writeFileSync(join(authorityRoot, 'connection.json'), JSON.stringify({
    schemaVersion: 2, profile: profileName, repoId,
    deploymentId: 'deploy-issue515', incarnation: 'incarnation-issue515', transport: 'local',
    registryDigest: DRIFTED_DIGEST, startedAt: '2026-09-20T00:00:00.000Z',
  }), { mode: 0o600 });
  writeFileSync(join(profilesRoot, `${profileName}.json`), JSON.stringify({
    schemaVersion: 2,
    url: 'https://resident.baton.test', origin: 'https://control.baton.test',
    tokenFile: `${profileName}.token`, transport: 'local', socketPath: '/tmp/b515.sock',
    deploymentId: 'deploy-issue515', incarnation: 'incarnation-issue515',
    registryDigest: DRIFTED_DIGEST, startedAt: '2026-09-20T00:00:00.000Z',
  }), { mode: 0o600 });
  writeFileSync(join(profilesRoot, `${profileName}.token`), 'issue515-private-bearer\n', { mode: 0o600 });
  return {
    repo, repoId, home, configRoot, profileName,
    env: { HOME: home, XDG_CONFIG_HOME: configRoot },
  };
}

// ─── 515-1: baseline — drift refuses today ───────────────────────────────────
test('515-1: discoverBatonConnection refuses on registry digest drift', () => {
  const f = driftedAuthority('baseline');
  const refusal = (() => {
    try { discoverBatonConnection({ cwd: f.repo, env: f.env, home: f.home }); return null; }
    catch (error) { return error; }
  })();
  assert.notEqual(refusal, null, 'a drift must refuse');
  assert.equal(refusal.cause, 'repository_selector_registry_digest_drift');
  assert.equal(refusal.code, 'cli_config_invalid');
  assert.equal(refusal.detail.residentRegistryDigest, DRIFTED_DIGEST);
  assert.equal(refusal.detail.cliRegistryDigest, CLI_REGISTRY_DIGEST);
});

// ─── 515-2: tolerateRegistryDrift lets reads through ─────────────────────────
test('515-2: discoverBatonConnection with tolerateRegistryDrift succeeds despite drift', () => {
  const f = driftedAuthority('tolerate');
  assert.equal(typeof discoverBatonConnection, 'function',
    'discoverBatonConnection is exported');
  const connection = discoverBatonConnection({
    cwd: f.repo, env: f.env, home: f.home, tolerateRegistryDrift: true,
  });
  assert.equal(connection.authority, 'repository-user-profile');
  assert.equal(connection.repoId, f.repoId);
  assert.notEqual(connection.registryDrift, null, 'the drift is recorded on the connection');
  assert.equal(connection.registryDrift.selectorDigest, DRIFTED_DIGEST);
  assert.equal(connection.registryDrift.cliDigest, CLI_REGISTRY_DIGEST);
});

// ─── 515-3: no drift → registryDrift is null ─────────────────────────────────
test('515-3: a matching digest produces registryDrift null', () => {
  const f = driftedAuthority('matching');
  const selectorPath = join(f.repo, '.git', 'baton', 'connection.json');
  writeFileSync(selectorPath, JSON.stringify({
    schemaVersion: 2, profile: f.profileName, repoId: f.repoId,
    deploymentId: 'deploy-issue515', incarnation: 'incarnation-issue515', transport: 'local',
    registryDigest: CLI_REGISTRY_DIGEST, startedAt: '2026-09-20T00:00:00.000Z',
  }), { mode: 0o600 });
  const profilePath = join(f.configRoot, 'baton', 'connections', `${f.profileName}.json`);
  writeFileSync(profilePath, JSON.stringify({
    schemaVersion: 2,
    url: 'https://resident.baton.test', origin: 'https://control.baton.test',
    tokenFile: `${f.profileName}.token`, transport: 'local', socketPath: '/tmp/b515.sock',
    deploymentId: 'deploy-issue515', incarnation: 'incarnation-issue515',
    registryDigest: CLI_REGISTRY_DIGEST, startedAt: '2026-09-20T00:00:00.000Z',
  }), { mode: 0o600 });
  const connection = discoverBatonConnection({
    cwd: f.repo, env: f.env, home: f.home, tolerateRegistryDrift: true,
  });
  assert.equal(connection.registryDrift, null);
});

// ─── 515-4: isReadOnlyCliDispatch classification ─────────────────────────────
test('515-4: isReadOnlyCliDispatch classifies read-only commands correctly', () => {
  const { isReadOnlyCliDispatch } = cliModule;
  assert.equal(typeof isReadOnlyCliDispatch, 'function',
    'isReadOnlyCliDispatch is exported from application-cli.mjs');
  const reads = [
    ['swarm', 'view', 'test-swarm'],
    ['swarm', 'list'],
    ['swarm', 'watch', 'test-swarm'],
    ['runs', 'list'],
    ['run', 'view', 'test-run'],
    ['evidence', 'search', 'test-swarm'],
    ['services', 'list'],
  ];
  for (const argv of reads) {
    const parsed = parseBatonCli(argv);
    assert.equal(isReadOnlyCliDispatch(parsed), true,
      `${argv.join(' ')} is read-only`);
  }
  const mutations = [
    ['swarm', 'create', 'test purpose'],
    ['swarm', 'update', 'test-swarm', 'swarm.contribution_recorded', '--payload', '{}'],
  ];
  for (const argv of mutations) {
    const parsed = parseBatonCli(argv);
    assert.equal(isReadOnlyCliDispatch(parsed), false,
      `${argv.join(' ')} is mutating`);
  }
});

// ─── 515-5: follow and wake_watch are read-only ──────────────────────────────
test('515-5: follow and wake_watch kinds are classified as read-only', () => {
  const { isReadOnlyCliDispatch } = cliModule;
  assert.equal(typeof isReadOnlyCliDispatch, 'function',
    'isReadOnlyCliDispatch must exist for this test');
  const follow = parseBatonCli(['run', 'status', 'test-run', '--follow']);
  assert.equal(follow.kind, 'follow');
  assert.equal(isReadOnlyCliDispatch(follow), true, 'run status --follow is read-only');
  const wakeWatch = parseBatonCli(['deployment', 'watch', '--follow']);
  assert.equal(wakeWatch.kind, 'wake_watch');
  assert.equal(isReadOnlyCliDispatch(wakeWatch), true, 'deployment watch --follow is read-only');
});
