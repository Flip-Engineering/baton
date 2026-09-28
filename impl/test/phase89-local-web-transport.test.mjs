import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { fixtureSocketRoot } from './fixture-root.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { Worker } from 'node:worker_threads';
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
  const directory = fixtureSocketRoot('bt89-local-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function fixture(t) {
  const directory = root(t);
  const coordination = new CoordinationStore(join(directory, 'coordination'));
  const sessions = new WebSessionStore(join(directory, 'sessions'));
  const issued = sessions.issue({
    userId: 'local-owner', authMethod: 'bearer',
    capabilities: ['observe', 'control', 'approve', 'emergency_stop'],
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

test('636: an owner-local recruit queued during a resident stall reaches dispatch', async (t) => {
  const f = fixture(t);
  await f.host.start();
  // The 2026-09-28 23:47Z successor batch lost six POSTs while resident 23592 was
  // busy. A separate client can write during the resident event-loop stall.
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { BatonWebClient, createLocalSocketFetch } = await import(workerData.module);
      const client = new BatonWebClient({
        baseUrl: workerData.origin, origin: workerData.origin,
        repoId: workerData.repoId, token: workerData.token,
        commandTimeoutMs: null, pollMs: 1,
        fetchImpl: createLocalSocketFetch({ socketPath: workerData.socketPath }),
        clock: Date.now, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      });
      await client.doctor();
      parentPort.postMessage({ ready: true });
      parentPort.once('message', async () => {
        try {
          const answer = await client.command('swarm.recruit', {
            swarmId: 's-636', participantId: 'successor-636', objective: 'Continue the retained work',
            idempotencyKey: 'recruit-636',
          }, 'recruit-636');
          parentPort.postMessage({ answer });
        } catch (error) {
          parentPort.postMessage({ error: { code: error.code, detail: error.detail } });
        }
      });
    })().catch(error => { throw error; });
  `, { eval: true, workerData: {
    module: new URL('../src/index.mjs', import.meta.url).href,
    origin: ORIGIN, repoId: REPO, token: f.issued.token, socketPath: f.socketPath,
  } });
  t.after(async () => {
    await worker.terminate();
    await f.host.shutdown();
  });
  assert.deepEqual((await once(worker, 'message'))[0], { ready: true });
  const response = once(worker, 'message');
  const defaults = createServer();
  const idleWindow = defaults.keepAliveTimeout + (defaults.keepAliveTimeoutBuffer ?? 0);
  worker.postMessage('recruit');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, idleWindow);
  const [received] = await response;
  assert.equal(received.error, undefined, JSON.stringify(received.error));
  assert.deepEqual(received.answer, { schemaVersion: 1, items: [], continuation: null });
  assert.deepEqual(f.calls.map(call => [call.name, call.args.participantId]),
    [['swarm.recruit', 'successor-636']]);
});

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
