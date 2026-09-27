// Phase 92 RED contracts for stale resident publication recovery. The dead-owner records are
// deterministic fixtures; they are not evidence that a real provider or process was reaped.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { inspectBatonConnection } from '../src/application-cli.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { ResidentAuthority } from '../src/resident-authority.mjs';

const ownerUid = typeof process.getuid === 'function' ? process.getuid() : null;
const repoId = 'repo-phase92-resident';
const profileName = `resident-${createHash('sha256').update(repoId).digest('hex').slice(0, 16)}`;

function fixture(t, label) {
  const root = mkdtempSync(join(tmpdir(), `baton-phase92-authority-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const commonDir = join(root, '.git');
  const configRoot = join(root, 'config');
  const home = join(root, 'home');
  mkdirSync(join(commonDir, 'baton'), { recursive: true, mode: 0o700 });
  mkdirSync(join(configRoot, 'baton', 'connections'), { recursive: true, mode: 0o700 });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root, commonDir, configRoot, home,
    env: { XDG_CONFIG_HOME: configRoot, HOME: home },
  };
}

async function listen(authority) {
  const server = createServer(() => {});
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(authority.socketPath, resolve);
  });
  chmodSync(authority.socketPath, 0o600);
  authority.confirmSocket();
  return server;
}

test('P92-RA1: a stale different-deployment selector is diagnosed and exactly replaced', async (t) => {
  const f = fixture(t, 'stale');
  const startedAt = '2026-07-19T12:00:00.000Z';
  const staleSocket = `/tmp/bt92-absent-${process.pid}.sock`;
  const selectorPath = join(f.commonDir, 'baton', 'connection.json');
  const profilePath = join(f.configRoot, 'baton', 'connections', `${profileName}.json`);
  writeFileSync(selectorPath, `${JSON.stringify({
    schemaVersion: 2, profile: profileName, repoId,
    deploymentId: 'deployment-stale', incarnation: 'instance-stale', transport: 'local',
    registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest, startedAt,
  })}\n`, { mode: 0o600 });
  writeFileSync(profilePath, `${JSON.stringify({
    schemaVersion: 2, transport: 'local', socketPath: staleSocket,
    url: 'https://baton.local', origin: 'https://baton.local', tokenFile: `${profileName}.token`,
    deploymentId: 'deployment-stale', incarnation: 'instance-stale',
    registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest, startedAt,
  })}\n`, { mode: 0o600 });
  writeFileSync(join(f.configRoot, 'baton', 'connections', `${profileName}.token`),
    `${'1'.repeat(64)}\n`, { mode: 0o600 });

  const diagnosis = inspectBatonConnection({
    cwd: f.root, env: f.env, home: f.home, ownerUid,
  });
  assert.equal(diagnosis.state, 'stale', JSON.stringify(diagnosis));
  assert.equal(diagnosis.outline.remote, 'absent');

  const authority = new ResidentAuthority({
    deploymentRoot: join(f.root, 'fresh-deployment'), commonDir: f.commonDir,
    repoId, env: f.env, home: f.home, ownerUid,
    now: () => Date.parse('2026-07-19T12:01:00.000Z'),
  });
  const server = await listen(authority);
  t.after(() => { try { authority.close(); } catch {} });
  t.after(() => { try { server.close(); } catch {} });
  const published = authority.publish({
    token: '2'.repeat(64), registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
  });
  assert.equal(published.state, 'published');
  assert.notEqual(published.deploymentId, 'deployment-stale');
  assert.equal(JSON.parse(readFileSync(selectorPath, 'utf8')).deploymentId, published.deploymentId);
});

test('P92-RA2: a fresh deployment cannot replace a live different-deployment authority', async (t) => {
  const f = fixture(t, 'live');
  const first = new ResidentAuthority({
    deploymentRoot: join(f.root, 'first-deployment'), commonDir: f.commonDir,
    repoId, env: f.env, home: f.home, ownerUid,
  });
  const server = await listen(first);
  first.publish({ token: '3'.repeat(64), registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest });
  const selectorPath = join(f.commonDir, 'baton', 'connection.json');
  const before = readFileSync(selectorPath);
  let second = null;
  let secondServer = null;
  try {
    await assert.rejects(async () => {
      second = new ResidentAuthority({
        deploymentRoot: join(f.root, 'second-deployment'), commonDir: f.commonDir,
        repoId, env: f.env, home: f.home, ownerUid,
      });
      secondServer = await listen(second);
      second.publish({ token: '4'.repeat(64), registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest });
    }, (error) => ['application_host_busy', 'application_host_publication_conflict'].includes(error?.code));
    assert.deepEqual(readFileSync(selectorPath), before);
  } finally {
    try { second?.close(); } catch {}
    try { secondServer?.close(); } catch {}
    try { first.close(); } catch {}
    server.close();
  }
});
