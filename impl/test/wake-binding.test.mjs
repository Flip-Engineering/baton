// Issue #294 item 3: the external binding.
//
// An operator may declare ONE loopback WebSocket port in the serve config; the resident then serves
// the SAME wake stream there, principal-authenticated from the handshake's authorization header
// (never a token in a URL, where it lands in logs and process tables), for clients that speak ws://
// or receive server notifications. The frames on it are the frames the HTTP feed carries — one
// stream, two transports.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { BatonWebHost } from '../src/application-host.mjs';
import { ResidentAuthority } from '../src/resident-authority.mjs';
import { WakeStream } from '../src/wake-stream.mjs';

/** A real coordination ledger with real swarm rows: no fixture stands in for the store. */
function ledger(t, { swarmId = 'swarm-binding' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bt-waking-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new CoordinationStore(join(root, 'coordination'));
  store.recordSwarm('swarm.created', { swarmId, purpose: 'binding proof' }, { actor: 'test:root', key: 'binding:1' });
  store.recordSwarm('swarm.participant_joined', { swarmId, participantId: 'worker', role: 'builder' },
    { actor: 'test:root', key: 'binding:2' });
  return { store, swarmId };
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** The application surface the host owns: ready, shuttable, and honest about both. */
function applicationStub() {
  return { ready: Promise.resolve(true), async shutdown() { return { state: 'closed' }; } };
}

function upgradeOutcome(url, headers) {
  return new Promise((resolve) => {
    const socket = headers === undefined ? new WebSocket(url) : new WebSocket(url, { headers });
    socket.addEventListener('open', () => { resolve('opened'); socket.close(); });
    socket.addEventListener('error', () => resolve('refused'));
    socket.addEventListener('close', () => resolve('refused'));
    const timer = setTimeout(() => resolve('timeout'), 5_000);
    timer.unref?.();
  });
}

test('a declared loopback binding serves the same wake stream to an authenticated WebSocket client, and refuses an anonymous one', { timeout: 60_000 }, async (t) => {
  const { store, swarmId } = ledger(t);
  const stream = new WakeStream({ coordination: store, pollMs: 25 });
  t.after(() => stream.close());
  // The northbound publishes the stream and its principal authority on the server it owns; a serve
  // config declares only the port.
  const server = createServer();
  const principals = new Map([['t0ken-resident-principal', { userId: 'root', sessionId: 's1' }]]);
  server.batonWakes = stream;
  server.batonAuthenticate = (req) => principals.get(`${req.headers.authorization ?? ''}`.replace(/^Bearer /u, '')) ?? null;
  server.batonShutdown = async () => ({ ok: true, result: 'closed' });
  t.after(() => new Promise((resolve) => { try { server.closeAllConnections?.(); server.close(() => resolve()); } catch { resolve(); } }));
  // The host refuses a Unix-socket path past the kernel's 103-byte sun_path bound, so a fixture
  // under a deep ambient TMPDIR (a deployment runtime dir, or the suite root a parallel gate hands
  // every file) would fail configuration, not the binding contract under test. The socket root is
  // minted directly under the short system root — the rule the resident fixtures follow (#446: a
  // measured fall-back with a one-character stand-in for mkdtemp's six missed a 68..72-byte band).
  const socketDir = mkdtempSync('/tmp/bt-waking-sock-');
  t.after(() => rmSync(socketDir, { recursive: true, force: true }));

  const port = await freePort();
  const host = new BatonWebHost({
    application: applicationStub(), server,
    shutdownPrincipal: { actor: 'test:host', principalId: 'host', sessionId: 'host-session' },
    listen: { path: join(socketDir, 'resident.sock') },
    webDrainMs: 1_000, wakes: { host: '127.0.0.1', port },
  });
  const started = await host.start();
  t.after(async () => { try { await host.shutdown(); } catch { /* closed by the test */ } });
  assert.equal(started.wakeBinding.state, 'listening');
  assert.deepEqual(
    { host: started.wakeBinding.host, port: started.wakeBinding.port, path: started.wakeBinding.path },
    { host: '127.0.0.1', port, path: '/v1/wakes' },
    'the binding reports the resource the operator declared',
  );

  assert.equal(await upgradeOutcome(`ws://127.0.0.1:${port}/v1/wakes`), 'refused',
    'a binding without a principal never opens');
  assert.equal(await upgradeOutcome(`ws://127.0.0.1:${port}/v1/wakes?kinds=not_a_class`,
    { authorization: 'Bearer t0ken-resident-principal' }), 'refused',
  'an unknown wake class refuses the attachment instead of opening onto a silent feed');

  const frames = [];
  const socket = new WebSocket(
    `ws://127.0.0.1:${port}/v1/wakes?kinds=contribution_recorded,recruited&swarms=${swarmId}&since=0`,
    { headers: { authorization: 'Bearer t0ken-resident-principal' } },
  );
  socket.addEventListener('message', (event) => frames.push(JSON.parse(event.data)));
  t.after(() => { try { socket.close(); } catch { /* already closed */ } });
  await new Promise((resolve) => socket.addEventListener('open', resolve));
  store.recordSwarm('swarm.contribution_recorded',
    { swarmId, participantId: 'worker', contributionId: 'contribution-1', body: 'over the binding' },
    { actor: 'test:worker', key: 'binding:3' });
  const deadline = Date.now() + 20_000;
  while (!frames.some((frame) => frame.wakeClass === 'contribution_recorded')) {
    if (Date.now() > deadline) throw new Error(`no frame crossed the binding: ${JSON.stringify(frames)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const contribution = frames.find((frame) => frame.wakeClass === 'contribution_recorded');
  assert.equal(contribution.swarmId, swarmId);
  assert.equal(contribution.subject.id, 'contribution-1');
  assert.equal(contribution.next, `baton swarm check ${swarmId} worker contribution-1 CHECK_ID`);

  // The filter is the same one the HTTP feed reads: a class outside it never crosses the binding.
  store.recordSwarm('swarm.closed', { swarmId, reason: 'proof complete' }, { actor: 'test:root', key: 'binding:4' });
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.deepEqual([...new Set(frames.map((frame) => frame.wakeClass))].sort(),
    ['contribution_recorded', 'recruited'], 'only the filtered classes cross the binding');

  socket.close();
  await host.shutdown();
  assert.equal(await upgradeOutcome(`ws://127.0.0.1:${port}/v1/wakes`,
    { authorization: 'Bearer t0ken-resident-principal' }), 'refused',
  'the declared binding is released with the host');
});

test('the publication record names the stream endpoints, and refuses an unusable binding declaration', { timeout: 60_000 }, async (t) => {
  const { authority, configRoot } = await residentAuthority(t, 'repo-binding');
  const published = authority.publish({
    token: 'a'.repeat(48), registryDigest: 'b'.repeat(64),
    streams: { websocket: { host: '127.0.0.1', port: 46_100, path: '/v1/wakes' } },
  });
  assert.deepEqual(published.streams, {
    wakes: '/v1/wakes', events: '/v1/events',
    websocket: { host: '127.0.0.1', port: 46_100, path: '/v1/wakes' },
  }, 'the publication names the stream endpoints an orchestrator attaches to');
  const written = JSON.parse(readFileSync(authority.profilePath, 'utf8'));
  assert.deepEqual(written.streams, published.streams, 'the published record carries the endpoints on disk');
  assert.throws(
    () => authority.publish({ token: 'a'.repeat(48), registryDigest: 'b'.repeat(64), streams: { websocket: { host: '', port: 0, path: '/v1/wakes' } } }),
    (error) => error.code === 'application_host_authority_invalid',
    'a binding that names no usable host and port is refused',
  );
});

// A deployment that declares no binding keeps the profile's exact key set, so every reader of the
// published record (the CLI, the Web MCP bridge) sees a profile it already knows how to validate.
test('an undeclared publication writes exactly the profile keys every reader already knows', { timeout: 60_000 }, async (t) => {
  const { authority, configRoot } = await residentAuthority(t, 'repo-plain');
  const published = authority.publish({ token: 'c'.repeat(48), registryDigest: 'd'.repeat(64) });
  assert.equal(published.streams, undefined, 'no binding is declared, so none is recorded');
  const profile = JSON.parse(readFileSync(authority.profilePath, 'utf8'));
  assert.deepEqual(Object.keys(profile).sort(), ['deploymentId', 'incarnation', 'origin', 'ownerPid', 'ownerPidStart',
    'registryDigest', 'schemaVersion', 'socketPath', 'startedAt', 'tokenFile', 'transport', 'url'].sort(),
  'an undeclared publication keeps the profile the readers already validate');
});

/** A real ResidentAuthority whose socket coordinate is bound, so publication can confirm it. */
async function residentAuthority(t, repoId) {
  const deploymentRoot = mkdtempSync(join(tmpdir(), `bt-waking-${repoId}-deployment-`));
  const commonDir = mkdtempSync(join(tmpdir(), `bt-waking-${repoId}-common-`));
  const configRoot = mkdtempSync(join(tmpdir(), `bt-waking-${repoId}-config-`));
  for (const dir of [deploymentRoot, commonDir, configRoot]) t.after(() => rmSync(dir, { recursive: true, force: true }));
  const authority = new ResidentAuthority({
    deploymentRoot, commonDir, repoId, env: { XDG_CONFIG_HOME: configRoot }, home: configRoot,
  });
  t.after(() => { try { authority.close(); } catch { /* closed by the test */ } });
  mkdirSync(authority.socketRoot, { recursive: true, mode: 0o700 });
  const socketServer = createServer();
  await new Promise((resolve) => socketServer.listen(authority.socketPath, resolve));
  t.after(() => new Promise((resolve) => socketServer.close(resolve)));
  chmodSync(authority.socketPath, 0o600); // the authority admits only an owner-only socket (#288 E14)
  assert.ok(lstatSync(authority.socketPath).isSocket(), 'the fixture binds a real socket at the published coordinate');
  authority.confirmSocket();
  return { authority, configRoot };
}
