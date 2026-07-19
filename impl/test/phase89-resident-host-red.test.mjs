import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as batonModule from '../src/index.mjs';

// This RED gate deliberately stops before resident lease/epoch takeover, UDS, browser reconnect,
// bearer rotation, and durable steer/interrupt reconciliation. It proves the smaller integration
// seam required before those authorities can be added: one deployment-owned authenticated HTTPS
// host, private connection discovery, and a resource-shaped remote client.

const ROUTE = Object.freeze({
  harness: 'codex', model: 'gpt-5.6-sol', effort: 'high',
});
const SECRET = 'phase89-private-bearer-that-must-never-be-returned';

function repository(t, name) {
  const root = mkdtempSync(join(tmpdir(), `baton-phase89-${name}-`));
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

function exactAdapter() {
  const adapter = new batonModule.MockAdapter({
    harness: ROUTE.harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'unused resident fixture' },
  });
  const rawCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...rawCard(),
    authPosture: 'subscription',
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model],
      family: ROUTE.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'phase89-resident-red', refreshedAt: null,
    },
    permissions: {
      mode: 'unattended-full',
      boundary: 'Fixture-only same-UID host access',
    },
  });
  return adapter;
}

function deploymentAdvanced(t, name) {
  const deploymentRoot = mkdtempSync(join(tmpdir(), `baton-phase89-${name}-deployment-`));
  t.after(() => rmSync(deploymentRoot, { recursive: true, force: true }));
  return {
    deploymentRoot,
    adapters: { codex: exactAdapter() },
    routes: [ROUTE],
    verification: { command: 'node', arguments: ['--test'] },
  };
}

class SecureFixtureServer extends EventEmitter {
  constructor() {
    super();
    this.listenCount = 0;
    this.shutdownCount = 0;
    // A fixture auth assembly may retain a secret internally. The deployment host must never
    // project the server, this value, or any equivalent credential into public results or logs.
    this.authenticationToken = SECRET;
  }

  listen(port, host) {
    this.listenCount += 1;
    this.bound = { host, port: port === 0 ? 9443 : port };
    queueMicrotask(() => this.emit('listening'));
  }

  address() {
    return {
      address: this.bound.host, port: this.bound.port,
      family: this.bound.host.includes(':') ? 'IPv6' : 'IPv4',
    };
  }

  async batonShutdown(options) {
    this.shutdownCount += 1;
    this.shutdownOptions = options;
    return { ok: true, result: 'closed' };
  }
}

function secureHostAdvanced(server, overrides = {}) {
  return {
    server,
    security: { transport: 'https', authenticated: true },
    listen: { host: '127.0.0.1', port: 0 },
    origin: 'https://127.0.0.1:9443',
    webDrainMs: 5_000,
    publishConnection: async () => {},
    ...overrides,
  };
}

test('RH1 RED: deployment.host owns one secure listener without exposing application internals or credentials', async (t) => {
  const repo = repository(t, 'owned-host');
  const deployment = await batonModule.openBaton({
    repo, advanced: deploymentAdvanced(t, 'owned-host'),
  });
  t.after(async () => { try { await deployment.close(); } catch {} });

  assert.equal(typeof deployment.host, 'function',
    'the repository deployment should assemble its own resident Web host');
  const server = new SecureFixtureServer();
  const published = [];
  const logLines = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...values) => { logLines.push(values.join(' ')); };
  console.log = (...values) => { logLines.push(values.join(' ')); };
  let host;
  let first;
  let replay;
  try {
    host = await deployment.host({
      advanced: secureHostAdvanced(server, {
        publishConnection: async (connection) => { published.push(connection); },
      }),
    });
    first = await host.start();
    replay = await host.start();
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }

  assert.deepEqual(replay, first, 'host start must join one authoritative startup');
  assert.equal(server.listenCount, 1);
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.state, 'listening');
  assert.equal(first.connection.repoId, deployment.card().repoId);
  assert.equal(new URL(first.connection.baseUrl).protocol, 'https:');
  assert.equal(first.connection.origin, 'https://127.0.0.1:9443');
  assert.deepEqual(published, [first.connection]);
  assert.equal(JSON.stringify({ first, replay, published, logLines }).includes(SECRET), false);

  for (const privateField of [
    'application', 'coordination', 'driver', 'principal', 'server', 'sessions', 'token',
  ]) {
    assert.equal(host[privateField], undefined, `resident host leaked ${privateField}`);
  }

  const [hostClosed, deploymentClosed] = await Promise.all([
    host.close(), deployment.close(),
  ]);
  assert.deepEqual(hostClosed, deploymentClosed,
    'host and deployment close must join one exact ownership result');
  assert.equal(hostClosed.state, 'closed');
  assert.equal(server.shutdownCount, 1);
  assert.equal(server.shutdownOptions.drainMs, 5_000);
  assert.equal(JSON.stringify(hostClosed).includes(SECRET), false);
});

test('RH2 RED: resident host refuses wildcard, cleartext, or unauthenticated assembly before bind', async (t) => {
  const deployment = await batonModule.openBaton({
    repo: repository(t, 'secure-boundary'),
    advanced: deploymentAdvanced(t, 'secure-boundary'),
  });
  t.after(async () => { try { await deployment.close(); } catch {} });

  const attempts = [
    secureHostAdvanced(new SecureFixtureServer(), {
      listen: { host: '0.0.0.0', port: 9443 },
    }),
    secureHostAdvanced(new SecureFixtureServer(), {
      security: { transport: 'http', authenticated: true },
      origin: 'http://127.0.0.1:9443',
    }),
    secureHostAdvanced(new SecureFixtureServer(), {
      security: { transport: 'https', authenticated: false },
    }),
  ];

  for (const advanced of attempts) {
    await assert.rejects(
      Promise.resolve().then(() => deployment.host({ advanced })),
      (error) => error?.code === 'application_host_security_invalid',
    );
    assert.equal(advanced.server.listenCount, 0,
      'unsafe resident configuration must fail before listener effects');
  }
});

function connectionFixture(t) {
  const repo = repository(t, 'remote-connect');
  const repoId = `repo-${createHash('sha256').update(realpathSync(join(repo, '.git')))
    .digest('hex').slice(0, 32)}`;
  const configRoot = mkdtempSync(join(tmpdir(), 'baton-phase89-connect-config-'));
  t.after(() => rmSync(configRoot, { recursive: true, force: true }));
  const commonBaton = join(repo, '.git', 'baton');
  const profiles = join(configRoot, 'baton', 'connections');
  mkdirSync(commonBaton, { recursive: true, mode: 0o700 });
  mkdirSync(profiles, { recursive: true, mode: 0o700 });
  writeFileSync(join(commonBaton, 'connection.json'), JSON.stringify({
    schemaVersion: 1, profile: 'resident', repoId,
  }), { mode: 0o600 });
  writeFileSync(join(profiles, 'resident.token'), `${SECRET}\n`, { mode: 0o600 });
  writeFileSync(join(profiles, 'resident.json'), JSON.stringify({
    schemaVersion: 1,
    url: 'https://127.0.0.1:9443',
    origin: 'https://127.0.0.1:9443',
    tokenFile: 'resident.token',
  }), { mode: 0o600 });
  return { repo, repoId, configRoot };
}

test('RH3 RED: connectBaton discovers an authenticated resident and returns a remote Run resource, not its token', async (t) => {
  assert.equal(typeof batonModule.connectBaton, 'function',
    'export one resource-shaped authenticated remote connection');
  const fixture = connectionFixture(t);
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    requests.push({ url, options });
    if (parsed.pathname === '/readyz') {
      return { ok: true, async json() { return { ready: true }; } };
    }
    if (parsed.pathname === '/v1/application-card') {
      return { ok: true, async json() { return { ok: true, application: {
        schemaVersion: 1,
        repoId: fixture.repoId,
        commands: ['application.help', 'runs.list', 'run.start', 'run.inspect', 'run.episode',
          'run.workstreams', 'run.workstream.notify', 'run.workstream.stop', 'run.act', 'run.stop'],
        agentExperience: {
          registryVersion: batonModule.APPLICATION_SEMANTIC_REGISTRY.version,
          registryDigest: batonModule.APPLICATION_SEMANTIC_REGISTRY.digest,
        },
        defaults: { profile: 'default', route: ROUTE },
        profiles: [],
      } }; } };
    }
    if (parsed.pathname === '/v1/session') {
      return { ok: true, async json() { return {
        ok: true,
        identity: {
          userId: 'operator', sessionId: 'resident-session',
          capabilities: ['observe', 'control', 'emergency_stop'],
          repoIds: [fixture.repoId],
        },
        expiresAt: '2099-01-01T00:00:00.000Z',
      }; } };
    }
    if (parsed.pathname === '/v1/commands' && options.method === 'POST') {
      const envelope = JSON.parse(options.body);
      assert.equal(envelope.command, 'run_inspect');
      assert.deepEqual(envelope.args, { runId: 'run-existing', depth: 'outline' });
      return { ok: true, async json() { return { ok: true, result: {
        schemaVersion: 1, runId: 'run-existing', depth: 'outline', cursor: 7,
        registryDigest: batonModule.APPLICATION_SEMANTIC_REGISTRY.digest,
        terminal: false, changed: true, viewDigest: 'b'.repeat(64),
        outline: {
          objective: 'The remote Run', phase: 'running',
          narrative: 'The remote Run remains active.', actions: [],
        },
      } }; } };
    }
    throw new Error(`unexpected resident request ${parsed.pathname}`);
  };

  const baton = await batonModule.connectBaton({
    repo: fixture.repo,
    advanced: {
      env: { XDG_CONFIG_HOME: fixture.configRoot },
      fetchImpl,
    },
  });
  assert.ok(baton.runs);
  assert.equal(typeof baton.runs.open, 'function');
  assert.equal(baton.application, undefined);
  assert.equal(baton.driver, undefined);
  assert.equal(baton.token, undefined);

  const view = await baton.runs.open('run-existing').inspect({ depth: 'outline' });
  assert.equal(view.runId, 'run-existing');
  assert.equal(view.outline.phase, 'running');
  assert.equal(JSON.stringify({ baton, view }).includes(SECRET), false);

  const authenticated = requests.filter(({ url }) => new URL(url).pathname !== '/readyz');
  assert.equal(authenticated.length, 3);
  for (const request of authenticated) {
    assert.equal(request.options.headers.authorization, `Bearer ${SECRET}`);
    assert.equal(request.url.includes(SECRET), false);
    assert.equal(String(request.options.body ?? '').includes(SECRET), false);
  }
  assert.equal(statSync(join(fixture.configRoot, 'baton', 'connections', 'resident.token')).mode & 0o077, 0);
  assert.equal(readFileSync(join(fixture.repo, '.git', 'baton', 'connection.json'), 'utf8').includes(SECRET), false);
});

test('RH4 RED: baton serve may select deployment-owned hosting without a user-authored module while retaining compatibility', () => {
  assert.deepEqual(batonModule.parseBatonCli(['serve']), {
    kind: 'serve', configPath: null,
  });
  assert.deepEqual(batonModule.parseBatonCli(['serve', './advanced-host.mjs']), {
    kind: 'serve', configPath: './advanced-host.mjs',
  });
});
