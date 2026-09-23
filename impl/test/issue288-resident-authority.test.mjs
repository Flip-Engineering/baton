// Issue #288's resident items: U-E12/U-I10 (a disturbed lease is reported only after the
// publication is withdrawn), U-E13 (a failed publication leaves no orphan token), U-E14 (an errno
// on the resident's directory is refused by errno and path, never as a busy resident), and
// U-F10/U-I11 (a dead resident is diagnosed from the published owner fields — never a network
// refusal). The last one is exercised through `baton doctor` as a real child, because that is the
// surface the operator reads.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { ResidentAuthority } from '../src/resident-authority.mjs';
import { inspectBatonConnection } from '../src/application-cli.mjs';

const SCRIPT = new URL('../scripts/baton.mjs', import.meta.url).pathname;
const ownerUid = typeof process.getuid === 'function' ? process.getuid() : null;
const repoId = 'repo-issue288-resident';

// A short absolute root: the resident bounds a socket path to sun_path (103 bytes).
function fixtureRoot(t, label) {
  const root = mkdtempSync(join(tmpdir(), `bt288-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function fixture(t, label) {
  const root = fixtureRoot(t, label);
  execFileSync('git', ['init', '-q'], { cwd: root });
  const commonDir = join(root, '.git');
  const configRoot = join(root, 'config');
  const home = join(root, 'home');
  mkdirSync(join(commonDir, 'baton'), { recursive: true, mode: 0o700 });
  mkdirSync(join(configRoot, 'baton', 'connections'), { recursive: true, mode: 0o700 });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  return {
    root, commonDir, configRoot, home,
    deploymentRoot: join(root, 'deployment'),
    env: { XDG_CONFIG_HOME: configRoot, HOME: home },
  };
}

function authorityFor(f, overrides = {}) {
  return new ResidentAuthority({
    deploymentRoot: f.deploymentRoot, commonDir: f.commonDir, repoId,
    env: f.env, home: f.home, ownerUid, ...overrides,
  });
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

function publishedPaths(authority, f) {
  const selector = JSON.parse(readFileSync(authority.selectorPath, 'utf8'));
  const profilePath = join(f.configRoot, 'baton', 'connections', `${selector.profile}.json`);
  return {
    selectorPath: authority.selectorPath,
    profilePath,
    tokenPath: join(f.configRoot, 'baton', 'connections', `${selector.profile}.token`),
    socketPath: authority.socketPath,
  };
}

test('RA1 (U-E12/U-I10, #276(3)): a disturbed lease is reported only AFTER the publication is withdrawn', async (t) => {
  const f = fixture(t, 'close-order');
  const authority = authorityFor(f);
  const server = await listen(authority);
  t.after(() => { try { server.close(); } catch {} });
  const published = authority.publish({
    token: '2'.repeat(64), registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
  });
  assert.equal(published.state, 'published');
  const paths = publishedPaths(authority, f);
  for (const path of [paths.selectorPath, paths.profilePath, paths.tokenPath, paths.socketPath]) {
    assert.equal(existsSync(path), true, `${path} must exist while the resident runs`);
  }

  // The lease is disturbed exactly as a competing recovery would: the holder directory is gone.
  rmSync(join(f.deploymentRoot, 'resident', 'host.lease'), { recursive: true, force: true });

  assert.throws(() => authority.close(), (error) => {
    assert.equal(error?.code, 'application_host_lease_lost',
      'the disturbed lease is still reported — the refusal is the caller’s to reconcile');
    return true;
  });
  // ...but the publication is gone: no client may follow a selector/profile/token/socket into a
  // process that is exiting (the state that turns a later SIGKILL into "check your network").
  assert.equal(existsSync(paths.selectorPath), false, 'the selector survives a disturbed lease');
  assert.equal(existsSync(paths.profilePath), false, 'the private profile survives a disturbed lease');
  assert.equal(existsSync(paths.tokenPath), false, 'the private token survives a disturbed lease');
  assert.equal(existsSync(paths.socketPath), false, 'the socket survives a disturbed lease');
});

test('RA2 (U-E13): a publication that fails after it wrote its private files leaves no orphan token', async (t) => {
  const f = fixture(t, 'orphan');
  const authority = authorityFor(f);
  const server = await listen(authority);
  t.after(() => { try { server.close(); } catch {} });

  // The profile coordinate cannot be replaced by a file (a directory stands there), so the
  // publication fails AFTER the token write — the exact window that accumulated orphan tokens.
  mkdirSync(authority.profilePath, { mode: 0o700 });

  await assert.rejects(async () => authority.publish({
    token: '3'.repeat(64), registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
  }), (error) => {
    assert.equal(typeof error?.withdrawal, 'object', 'the failure reports what it withdrew');
    assert.equal(error.withdrawal.token, 'removed', 'the token this call wrote was withdrawn');
    return true;
  });
  assert.equal(existsSync(authority.tokenPath), false, 'a failed publication may not orphan its token');
  assert.equal(existsSync(authority.selectorPath), false, 'a failed publication publishes no selector');
  assert.equal(authority.publicOutline().state, 'private');

  // The same authority can still publish once the obstruction is gone.
  rmSync(authority.profilePath, { recursive: true, force: true });
  assert.equal(authority.publish({
    token: '4'.repeat(64), registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
  }).state, 'published');
  assert.equal(readFileSync(authority.tokenPath, 'utf8').trim(), '4'.repeat(64));
  authority.close();
});

test('RA3 (U-E14): an errno on the resident’s directory is refused by errno and path — never as a busy resident', async (t) => {
  const { authorityDirectoryRefusal } = await import('../src/resident-authority.mjs');
  // Every errno the refusal knows names itself, the path it happened at, and the remedy that
  // repairs THAT condition.
  for (const errno of ['EACCES', 'ENOSPC', 'EROFS', 'ENOTDIR', 'ENOENT']) {
    const error = authorityDirectoryRefusal(Object.assign(new Error(`${errno}: refused`), { code: errno, syscall: 'mkdir' }), '/tmp/baton-x/host.lease');
    assert.equal(error.code, 'application_host_lease_unavailable', `${errno} must not be reported as a busy resident`);
    assert.notEqual(error.code, 'application_host_busy');
    assert.equal(error.detail.errno, errno);
    assert.equal(error.detail.path, '/tmp/baton-x/host.lease');
    assert.equal(error.detail.syscall, 'mkdir');
    assert.match(error.message, new RegExp(errno, 'u'));
    assert.match(error.detail.remedy, /\/tmp\/baton-x/u, 'the remedy names the path it is about');
  }

  // Reachable integration: a file where a directory must be is ENOTDIR, at the resident root.
  const f = fixture(t, 'errno');
  writeFileSync(f.deploymentRoot, 'not a directory', { mode: 0o600 });
  assert.throws(() => authorityFor(f), (error) => {
    assert.equal(error?.code, 'application_host_lease_unavailable');
    assert.equal(error.detail.errno, 'ENOTDIR');
    assert.match(error.detail.remedy, /non-directory/u);
    assert.match(error.message, /ENOTDIR/u);
    return true;
  });

  // EEXIST stays what it is: the holder path. A file at the lease coordinate is an ambiguous
  // owner, refused busy — the refusal that used to swallow every other errno is unchanged.
  const g = fixture(t, 'eexist');
  const first = authorityFor(g);
  first.close();
  writeFileSync(join(g.deploymentRoot, 'resident', 'host.lease'), 'occupied', { mode: 0o600 });
  assert.throws(() => authorityFor(g), (error) => error?.code === 'application_host_busy');
});

test('RA4 (U-F10/U-I11): inspectBatonConnection diagnoses the resident from its published owner fields', (t) => {
  const f = fixture(t, 'doctor-owner');
  const profileName = `resident-${createHash('sha256').update(repoId).digest('hex').slice(0, 16)}`;
  const socketPath = join(f.root, 'unserved.sock');
  const startedAt = '2026-08-14T00:00:00.000Z';
  const writePublication = (extraProfileFields = {}) => {
    writeFileSync(join(f.commonDir, 'baton', 'connection.json'), `${JSON.stringify({
      schemaVersion: 2, profile: profileName, repoId,
      deploymentId: 'deployment-issue288', incarnation: 'instance-issue288',
      transport: 'local', registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest, startedAt,
    })}\n`, { mode: 0o600 });
    writeFileSync(join(f.configRoot, 'baton', 'connections', `${profileName}.json`), `${JSON.stringify({
      schemaVersion: 2, transport: 'local', socketPath,
      url: 'https://baton.local', origin: 'https://baton.local', tokenFile: `${profileName}.token`,
      deploymentId: 'deployment-issue288', incarnation: 'instance-issue288',
      registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest, startedAt,
      ...extraProfileFields,
    })}\n`, { mode: 0o600 });
  };
  const inspect = () => inspectBatonConnection({
    cwd: f.root, env: f.env, home: f.home, ownerUid, depth: 'evidence',
  });

  // (a) A publication whose owner process is gone — the release-then-SIGKILL state.
  const dead = spawnSync(process.execPath, ['-e', '']);
  assert.equal(dead.status, 0);
  writePublication({ ownerPid: dead.pid, ownerPidStart: 'Mon Jan  1 00:00:00 2024' });
  const gone = inspect();
  assert.equal(gone.state, 'stale', JSON.stringify(gone));
  assert.equal(gone.code, 'cli_resident_gone');
  assert.equal(gone.detail.ownerPid, dead.pid);
  assert.equal(gone.detail.ownerState, 'stale');
  assert.equal(gone.detail.publishedAt, startedAt);
  assert.equal(gone.detail.deploymentId, 'deployment-issue288');
  assert.equal(gone.detail.incarnation, 'instance-issue288');
  assert.equal(gone.detail.transport, 'local');
  assert.equal(gone.outline.remote, 'absent');
  assert.equal(gone.evidence.owner, 'gone');
  assert.equal(gone.next[0].command, 'baton serve', 'recovery is to republish, not to debug a network');
  assert.match(JSON.stringify(gone), new RegExp(String(dead.pid), 'u'), 'the pid is named');
  assert.doesNotMatch(JSON.stringify(gone), /network/iu);

  // (b) The socket file is still there (a SIGKILL leaves it) — still the same diagnosis.
  const linger = createServer(() => {});
  const listening = new Promise((resolve) => linger.listen(socketPath, resolve));
  t.after(() => { try { linger.close(); } catch {} });
  return listening.then(() => {
    chmodSync(socketPath, 0o600);
    const unserved = inspect();
    assert.equal(unserved.code, 'cli_resident_gone');
    assert.equal(unserved.detail.socket, 'ready');
    assert.equal(unserved.outline.remote, 'unserved');
    assert.equal(unserved.next[0].command, 'baton serve');
    rmSync(socketPath, { force: true });
  }).then(() => {
    // (c) A LIVE owner whose socket is not answering is a distinct row: the resident is not gone,
    // so the remedy is not a second resident.
    const pidStart = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(process.pid)], { encoding: 'utf8' }).trim();
    writePublication({ ownerPid: process.pid, ownerPidStart: pidStart });
    const alive = inspect();
    assert.equal(alive.state, 'stale');
    assert.equal(alive.code, 'cli_resident_unresponsive');
    assert.notEqual(alive.code, 'cli_resident_gone');
    assert.equal(alive.detail.ownerState, 'active');
    assert.equal(alive.evidence.owner, 'live');
    assert.equal(alive.next[0].command, 'baton doctor');

    // (d) A profile from before the owner fields keeps the historical row exactly (PT-10's pin).
    writePublication();
    const unobserved = inspect();
    assert.equal(unobserved.state, 'stale');
    assert.equal(unobserved.code, undefined);
    assert.equal(unobserved.outline.connection, 'stale_authority');
    assert.equal(unobserved.next[0].command, 'baton serve');
  });
});

test('RA5 (U-F10): `baton doctor` prints the gone diagnosis for a dead resident — never a network refusal', async (t) => {
  const f = fixture(t, 'doctor-cli');
  const profileName = `resident-${createHash('sha256').update(repoId).digest('hex').slice(0, 16)}`;
  const startedAt = '2026-08-14T00:00:00.000Z';
  writeFileSync(join(f.commonDir, 'baton', 'connection.json'), `${JSON.stringify({
    schemaVersion: 2, profile: profileName, repoId,
    deploymentId: 'deployment-issue288', incarnation: 'instance-issue288',
    transport: 'local', registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest, startedAt,
  })}\n`, { mode: 0o600 });
  const dead = spawnSync(process.execPath, ['-e', '']);
  writeFileSync(join(f.configRoot, 'baton', 'connections', `${profileName}.json`), `${JSON.stringify({
    schemaVersion: 2, transport: 'local', socketPath: join(f.root, 'gone.sock'),
    url: 'https://baton.local', origin: 'https://baton.local', tokenFile: `${profileName}.token`,
    deploymentId: 'deployment-issue288', incarnation: 'instance-issue288',
    registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest, startedAt,
    ownerPid: dead.pid, ownerPidStart: 'Mon Jan  1 00:00:00 2024',
  })}\n`, { mode: 0o600 });

  const child = spawn(process.execPath, [SCRIPT, 'doctor'], {
    cwd: f.root,
    env: { ...process.env, HOME: f.home, XDG_CONFIG_HOME: f.configRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  const exit = await new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));

  assert.deepEqual(exit, { code: 0, signal: null }, stderr);
  const diagnosis = JSON.parse(stdout);
  assert.equal(diagnosis.code, 'cli_resident_gone');
  assert.equal(diagnosis.state, 'stale');
  assert.equal(diagnosis.detail.ownerPid, dead.pid);
  assert.equal(diagnosis.next[0].command, 'baton serve');
  assert.doesNotMatch(stdout, /check your network/u);
  assert.doesNotMatch(stdout, /cli_transport_failed/u);
});
