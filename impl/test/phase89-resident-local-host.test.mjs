import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  CoordinationStore, MockAdapter, bindBatonPort, connectBaton, inspectBatonConnection, openBaton,
} from '../src/index.mjs';

const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });

function repository(t) {
  const root = mkdtempSync('/tmp/bt89-resident-repo-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'phase89@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Phase 89'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    private: true, scripts: { test: 'node --test' },
  }));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test', 'smoke.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('smoke', () => assert.equal(1, 1));",
    '',
  ].join('\n'));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function adapter() {
  const value = new MockAdapter({
    harness: ROUTE.harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'resident fixture' },
  });
  const card = value.card.bind(value);
  value.card = () => ({
    ...card(),
    authPosture: 'subscription',
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model],
      family: ROUTE.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'phase89-resident-local', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' },
  });
  return value;
}

function options(t, repo) {
  const deploymentRoot = mkdtempSync('/tmp/bt89-resident-deployment-');
  const configRoot = mkdtempSync('/tmp/bt89-resident-config-');
  const home = mkdtempSync('/tmp/bt89-resident-home-');
  t.after(() => rmSync(deploymentRoot, { recursive: true, force: true }));
  t.after(() => rmSync(configRoot, { recursive: true, force: true }));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { XDG_CONFIG_HOME: configRoot, HOME: home };
  return {
    repo,
    advanced: {
      deploymentRoot,
      adapters: { codex: adapter() },
      routes: [ROUTE],
      verification: { command: 'node', arguments: ['--test'] },
      resident: { env, home, webDrainMs: 2_000, sessionTtlMs: 60_000 },
    },
    connection: { repo, advanced: { env, home } },
    deploymentRoot,
    configRoot,
  };
}

test('RLH1: ordinary host publishes one authenticated local resident and connectBaton attaches', async (t) => {
  const repo = repository(t);
  const configured = options(t, repo);
  const owner = await openBaton({ repo, advanced: configured.advanced });
  t.after(async () => { try { await owner.close(); } catch {} });

  const first = await owner.host();
  const replay = await owner.host();
  assert.deepEqual(replay, first);
  assert.equal(first.state, 'published');
  assert.equal(first.transport, 'local');
  for (const hidden of ['socketPath', 'token', 'tokenFile', 'sessionId', 'pid', 'lease']) {
    assert.equal(JSON.stringify(first).includes(hidden), false, hidden);
  }

  const selectorPath = join(repo, '.git', 'baton', 'connection.json');
  const selector = JSON.parse(readFileSync(selectorPath, 'utf8'));
  assert.equal(selector.schemaVersion, 2);
  assert.equal(selector.deploymentId, first.deploymentId);
  assert.equal(selector.incarnation, first.incarnation);
  assert.equal(inspectBatonConnection({
    cwd: repo, env: configured.connection.advanced.env,
    home: configured.connection.advanced.home,
  }).state, 'configured');
  const connected = await connectBaton(configured.connection);
  assert.deepEqual(await connected.runs.list(), {
    schemaVersion: 1,
    items: [],
    continuation: null,
    registryDigest: owner.card().agentExperience.registryDigest,
  });

  const closed = await owner.close();
  assert.equal(closed.state, 'closed');
  assert.equal(closed.resident.state, 'closed');
  assert.equal(existsSync(selectorPath), false);
});

test('RLH2: restart preserves deployment identity, rotates incarnation, and removes stale publication', async (t) => {
  const repo = repository(t);
  const configured = options(t, repo);
  const firstOwner = await openBaton({ repo, advanced: configured.advanced });
  const first = await firstOwner.host();
  await firstOwner.close();

  const secondOwner = await openBaton({ repo, advanced: {
    ...configured.advanced,
    adapters: { codex: adapter() },
  } });
  t.after(async () => { try { await secondOwner.close(); } catch {} });
  const second = await secondOwner.host();
  assert.equal(second.deploymentId, first.deploymentId);
  assert.notEqual(second.incarnation, first.incarnation);
  const connected = await connectBaton(configured.connection);
  assert.deepEqual((await connected.runs.list()).items, []);
  await secondOwner.close();
  assert.equal(existsSync(join(repo, '.git', 'baton', 'connection.json')), false);
});

test('RLH3: failed publication rolls back the listener and lease, leaves Runs usable, and retries fresh', async (t) => {
  const repo = repository(t);
  const configured = options(t, repo);
  const owner = await openBaton({ repo, advanced: configured.advanced });
  t.after(async () => { try { await owner.close(); } catch {} });
  const selectorPath = join(repo, '.git', 'baton', 'connection.json');
  mkdirSync(join(repo, '.git', 'baton'), { recursive: true, mode: 0o700 });
  writeFileSync(selectorPath, `${JSON.stringify({
    schemaVersion: 1, profile: 'intentional-remote', repoId: owner.card().repoId,
  })}\n`, { mode: 0o600 });

  await assert.rejects(owner.host(), (error) => error?.code === 'application_host_publication_conflict');
  assert.equal(existsSync(join(configured.deploymentRoot, 'resident', 'host.lease')), false);
  assert.deepEqual((await owner.runs.list()).items, []);

  rmSync(selectorPath);
  const hosted = await owner.host();
  assert.equal(hosted.state, 'published');
  assert.equal(hosted.transport, 'local');
});

test('RLH4: v2 coordination writer ownership distinguishes a reused live PID by process start', (t) => {
  const directory = mkdtempSync('/tmp/bt89-writer-reuse-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  writeFileSync(join(directory, 'writer.lease'), `${JSON.stringify({
    schemaVersion: 2, pid: process.pid, pidStart: 'definitely-not-this-process-start',
    token: 'stale-token', acquiredAt: new Date().toISOString(),
  })}\n`, { mode: 0o600 });
  const lease = store.claimWriterLease();
  t.after(() => { try { store.releaseWriterLease(); } catch {} });
  const persisted = JSON.parse(readFileSync(lease.path, 'utf8'));
  assert.equal(persisted.schemaVersion, 2);
  assert.equal(persisted.pid, process.pid);
  assert.notEqual(persisted.pidStart, 'definitely-not-this-process-start');
  assert.equal(store.releaseWriterLease({ requireOwned: true }), true);
});

test('RLH5: every high-level handle calls exactly one two-argument command port', async () => {
  const arities = [];
  const client = bindBatonPort({
    command: function command(name, args) {
      arities.push({ name, length: arguments.length, args });
      return { schemaVersion: 1, items: [], continuation: null };
    },
  });
  await client.runs.list();
  assert.deepEqual(arities, [{ name: 'runs.list', length: 2, args: {} }]);
});

test('RLH6: delayed close cannot remove publication records replaced by a successor incarnation', async (t) => {
  const repo = repository(t);
  const configured = options(t, repo);
  const owner = await openBaton({ repo, advanced: configured.advanced });
  const hosted = await owner.host();
  const selectorPath = join(repo, '.git', 'baton', 'connection.json');
  const selector = JSON.parse(readFileSync(selectorPath, 'utf8'));
  const profilePath = join(configured.configRoot, 'baton', 'connections', `${selector.profile}.json`);
  const tokenPath = join(configured.configRoot, 'baton', 'connections', `${selector.profile}.token`);
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  const successor = 'instance-successor-incarnation';
  writeFileSync(selectorPath, `${JSON.stringify({ ...selector, incarnation: successor })}\n`, { mode: 0o600 });
  writeFileSync(profilePath, `${JSON.stringify({ ...profile, incarnation: successor })}\n`, { mode: 0o600 });
  writeFileSync(tokenPath, 'successor-private-bearer-that-is-not-the-old-token\n', { mode: 0o600 });

  const closed = await owner.close();
  assert.equal(closed.state, 'closed');
  assert.equal(hosted.incarnation === successor, false);
  assert.equal(JSON.parse(readFileSync(selectorPath, 'utf8')).incarnation, successor);
  assert.equal(JSON.parse(readFileSync(profilePath, 'utf8')).incarnation, successor);
  assert.equal(readFileSync(tokenPath, 'utf8').startsWith('successor-private'), true);
});
