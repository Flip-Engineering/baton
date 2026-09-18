// Issue #383: a local-transport client closing its socket mid-response is ordinary, but Node
// emits the failed write as 'error' on that connection's socket, and an unhandled socket 'error'
// is an uncaught exception — it took the clone resident (and every worker under it) down twice
// on 2026-09-18 with `Error: write EPIPE … Emitted 'error' event on Socket instance`. These rows
// pin, through the real BatonWebHost over a real Unix socket: (a) a connection whose socket
// errors ends only that connection — the host counts it, narrates once, and still answers the
// next request; (b) a malformed request (`clientError`) is closed the same way; (c) the host
// exposes the count so a flood of disconnects is visible without a crash.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';
import {
  APPLICATION_COMMAND_DEFINITIONS, APPLICATION_SEMANTIC_REGISTRY, BatonWebHost, CoordinationStore,
  WebNorthbound, WebSessionStore, createLocalAuthenticatedWebServer,
} from '../src/index.mjs';

const REPO = 'repo-issue383';
const ORIGIN = 'https://baton.local';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture(t) {
  const directory = mkdtempSync('/tmp/bt383-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const coordination = new CoordinationStore(join(directory, 'coordination'));
  const sessions = new WebSessionStore(join(directory, 'sessions'));
  const commands = Object.entries(APPLICATION_COMMAND_DEFINITIONS).filter(([, d]) => d.web).map(([name]) => name);
  const application = {
    repoId: REPO,
    ready: Promise.resolve(),
    card() { return { schemaVersion: 1, repoId: REPO, commands, agentExperience: { registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest } }; },
    async authorizeReplay() { return true; },
    async command() { return { schemaVersion: 1, items: [], continuation: null }; },
    async shutdown() { return { schemaVersion: 1, state: 'closed', ownership: { workers: 0 } }; },
  };
  const web = new WebNorthbound({
    coordinator: new Proxy({}, { get: () => () => [] }), coordination, sessions, application, repoIds: [REPO], allowedOrigins: [ORIGIN],
  });
  const server = createLocalAuthenticatedWebServer(web);
  const socketPath = join(directory, 'resident.sock');
  const lines = [];
  const host = new BatonWebHost({
    application, server, listen: { path: socketPath }, webDrainMs: 2_000, report: (line) => lines.push(line),
    shutdownPrincipal: { actor: 'deployment:resident', principalId: 'local-owner', sessionId: 'local-owner-session' },
  });
  return { host, server, socketPath, lines };
}

/** One raw HTTP request over the Unix socket; resolves with the status line the server answered. */
function rawRequest(socketPath, text) {
  return new Promise((resolve, reject) => {
    const client = connect(socketPath);
    let data = '';
    client.on('connect', () => client.write(text));
    client.on('data', (chunk) => { data += chunk; });
    client.on('end', () => resolve(data.split('\r\n')[0]));
    client.on('close', () => resolve(data.split('\r\n')[0]));
    client.on('error', reject);
  });
}

test('#383 (a): a connection whose socket errors ends only that connection; the host counts it, narrates once and still answers', async (t) => {
  const { host, server, socketPath, lines } = fixture(t);
  await host.start();
  t.after(() => host.shutdown?.({ trigger: { kind: 'test' } }).catch(() => {}));
  const accepted = new Promise((resolve) => server.once('connection', resolve));
  const client = connect(socketPath);
  const serverSide = await accepted;
  // The same failure Node raised on the resident: a write error surfaced as 'error' on the
  // accepted socket. Unhandled, `emit` throws right here — the red-before shape of the crash.
  const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE', errno: -32, syscall: 'write' });
  assert.doesNotThrow(() => serverSide.emit('error', epipe), 'the accepted socket has an error handler (unhandled, this is the resident crash)');
  client.destroy();
  await sleep(20);
  assert.equal(host.clientSocketErrors, 1, 'the host counted the ended connection');
  assert.ok(lines.some((line) => /client connection ended by EPIPE \(1 so far\); the resident goes on/u.test(line)),
    `the host narrated the ended connection once: ${JSON.stringify(lines)}`);
  const status = await rawRequest(socketPath, 'GET /v1/session HTTP/1.1\r\nHost: baton.local\r\nConnection: close\r\n\r\n');
  assert.match(status, /^HTTP\/1\.1 \d{3}/u, 'the resident still answers the next request');
});

test('#383 (b): a malformed client request is closed as a clientError; the resident goes on', async (t) => {
  const { host, socketPath, lines } = fixture(t);
  await host.start();
  t.after(() => host.shutdown?.({ trigger: { kind: 'test' } }).catch(() => {}));
  await rawRequest(socketPath, 'THIS IS NOT HTTP\r\n\r\n');
  await sleep(20);
  assert.equal(host.clientSocketErrors, 1, 'the malformed request counted as one ended connection');
  assert.ok(lines.some((line) => /malformed client request ended by/u.test(line)), `narrated: ${JSON.stringify(lines)}`);
  const status = await rawRequest(socketPath, 'GET /v1/session HTTP/1.1\r\nHost: baton.local\r\nConnection: close\r\n\r\n');
  assert.match(status, /^HTTP\/1\.1 \d{3}/u, 'the resident still answers after a malformed request');
});

test('#383 (c): the host starts with zero client socket errors and the counter is its own field', async (t) => {
  const { host } = fixture(t);
  assert.equal(host.clientSocketErrors, 0);
});
