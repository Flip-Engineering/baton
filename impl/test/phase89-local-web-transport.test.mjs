import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS,
  APPLICATION_SEMANTIC_REGISTRY,
  BatonWebClient,
  BatonWebHost,
  CoordinationStore,
  WebNorthbound,
  WebSessionStore,
  createLocalAuthenticatedWebServer,
  createLocalSocketFetch,
} from '../src/index.mjs';

const REPO = 'repo-phase89-local';
const ORIGIN = 'https://baton.local';

function root(t) {
  const directory = mkdtempSync('/tmp/bt89-local-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function fixture(t) {
  const directory = root(t);
  const coordination = new CoordinationStore(join(directory, 'coordination'));
  const sessions = new WebSessionStore(join(directory, 'sessions'));
  const issued = sessions.issue({
    userId: 'local-owner', authMethod: 'bearer',
    capabilities: ['observe', 'control', 'approve', 'emergency_stop', 'export_result'],
    repoIds: [REPO], ttlMs: 60_000,
  }, { actor: 'deployment:resident' });
  const commands = Object.entries(APPLICATION_COMMAND_DEFINITIONS)
    .filter(([, definition]) => definition.web)
    .map(([name]) => name);
  const calls = [];
  const application = {
    repoId: REPO,
    ready: Promise.resolve(),
    card() {
      return {
        schemaVersion: 1,
        repoId: REPO,
        commands,
        agentExperience: { registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest },
      };
    },
    async authorizeReplay() { return true; },
    async command(name, args, principal, context) {
      calls.push({ name, args, principal, context });
      return { schemaVersion: 1, items: [], continuation: null };
    },
    async shutdown() { return { schemaVersion: 1, state: 'closed', ownership: { workers: 0 } }; },
  };
  const web = new WebNorthbound({
    coordinator: new Proxy({}, { get: () => () => [] }),
    coordination,
    sessions,
    application,
    repoIds: [REPO],
    allowedOrigins: [ORIGIN],
  });
  const server = createLocalAuthenticatedWebServer(web);
  const socketPath = join(directory, 'resident.sock');
  const host = new BatonWebHost({
    application,
    server,
    shutdownPrincipal: {
      actor: 'deployment:resident', principalId: 'local-owner', sessionId: 'local-owner-session',
    },
    listen: { path: socketPath },
    webDrainMs: 2_000,
  });
  return { calls, host, issued, socketPath };
}

test('RL1: authenticated Web commands traverse one owner-only Unix socket without TCP', async (t) => {
  const f = fixture(t);
  t.after(async () => { try { await f.host.shutdown(); } catch {} });
  const started = await f.host.start();
  assert.equal(started.state, 'listening');
  assert.equal(started.address, f.socketPath);
  assert.equal(statSync(f.socketPath).isSocket(), true);
  assert.equal(statSync(f.socketPath).mode & 0o077, 0);

  const fetchImpl = createLocalSocketFetch({ socketPath: f.socketPath, baseUrl: ORIGIN });
  const client = new BatonWebClient({
    baseUrl: ORIGIN,
    origin: ORIGIN,
    repoId: REPO,
    token: f.issued.token,
    commandTimeoutMs: 5_000,
    pollMs: 10,
    fetchImpl,
    clock: Date.now,
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  });
  const [doctor, session] = await Promise.all([client.doctor(), client.session()]);
  assert.equal(doctor.ready, true);
  assert.equal(session.identity.userId, 'local-owner');
  assert.deepEqual(await client.command('runs.list', {}), {
    schemaVersion: 1, items: [], continuation: null,
  });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, 'runs.list');
  assert.equal(f.calls[0].context.transport, 'web');
  assert.equal(JSON.stringify({ started, doctor, session }).includes(f.issued.token), false);
});

test('RL2: local fetch refuses a replaced non-socket coordinate before sending credentials', async (t) => {
  const f = fixture(t);
  await f.host.start();
  const fetchImpl = createLocalSocketFetch({ socketPath: f.socketPath, baseUrl: ORIGIN });
  await f.host.shutdown();
  await assert.rejects(
    fetchImpl(`${ORIGIN}/readyz`, { headers: { authorization: `Bearer ${f.issued.token}` } }),
    (error) => ['local_transport_unavailable', 'local_transport_invalid'].includes(error?.code),
  );
});
