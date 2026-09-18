// Issue #445: the root's bounded watch died `cli_transport_failed` under load, over the owner
// socket, while the resident was alive (ledger rows every second, `swarm list` answering — in 15 s
// where an idle resident answers in 0.2 s). The watch that failed was the one whose wait spanned a
// resident stall. The issue inferred the cause: the CLI's request rode Node's HTTP agent (the
// process-global one, `timeout: 5000` since v19) and the agent's idle timer killed the in-flight
// request. These rows test that inference and the contract it owes.
//
//   445-a  a served handler that holds its answer past the agent's idle timer but inside the web
//          wait ceiling answers the CLI's BOUNDED WATCH with the wake — never a transport failure.
//          GREEN at the pre-fix head, and that is the finding: in Node 22 an idle socket timer only
//          EMITS `timeout` while a request is in flight — nothing severs the request — so the
//          inferred cause is refuted here instead of proven. The timer itself is real, and 445-c
//          pins where it came from.
//   445-b  a resident that really dies mid-request draws `cli_transport_failed` whose ONE cause
//          composition names the socket's own code AND how long the request had been waiting — the
//          fact the incident could not read without `NODE_DEBUG`. RED at the pre-fix head: the
//          elapsed wait was dropped.
//   445-c  the bound the transport applies is the registry derivation (`web.wait_ceiling_ms` plus
//          the `transport.idle_margin_ms` row), never a literal and never shorter than the ceiling
//          it must outlast; no socket of this transport parks in the process-global agent (observed
//          there: Node's own 4000 ms idle timer, below the ceiling). RED at the pre-fix head: the
//          transport had no bound of its own and left its socket in that pool.
//
// The fixture is the served resident: a real owner-only Unix socket, the real Web northbound over
// it, and the real swarm runtime behind the application seam, so the wake the CLI's bounded watch
// meets is the resident's own fold — not a stub's shape.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { globalAgent } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS, APPLICATION_SEMANTIC_REGISTRY, BatonWebHost, BatonWebClient,
  CoordinationStore, WebNorthbound, WebSessionStore, createLocalAuthenticatedWebServer,
  createLocalSocketFetch,
} from '../src/index.mjs';
import { parseBatonCli, runBatonCli } from '../src/application-cli.mjs';
import { FRAME_LIMITS, WEB_WAIT_DEFAULT_MS } from '../src/limits.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const REPO = 'repo-issue445';
const SWARM_ID = 's-445';
const ORIGIN = 'https://baton.local';
// The stall the issue's failing watches spanned: longer than the idle timer the issue names (Node's
// global agent declares 5000 ms, and its pooled-reuse path re-arms 4000 ms), inside the 30 s
// ceiling the resident's own wait arm is bounded by.
const STALL_MS = 6_500;

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch() {
  // A Unix socket path is bounded (sun_path, 104 bytes) and this deployment's tmpdir alone is 75
  // bytes deep, so the fixture mints its directory directly under /tmp.
  const directory = mkdtempSync('/tmp/baton-445-');
  roots.push(directory);
  return directory;
}

/** The served resident: a real owner-only Unix socket, the real Web northbound over it, the real
 * swarm runtime behind the application seam (with one contribution already recorded), and a hold
 * the served handler applies to every command — the resident's loop held past the transport's. */
async function servedResident(t, { holdMs = 0 } = {}) {
  const directory = scratch();
  const coordination = new CoordinationStore(join(directory, 'coordination'),
    { clock: () => new Date().toISOString() });
  const sessions = new WebSessionStore(join(directory, 'sessions'));
  const issued = sessions.issue({
    userId: 'issue445-operator', authMethod: 'bearer',
    capabilities: ['observe', 'control', 'approve', 'emergency_stop'],
    repoIds: [REPO], ttlMs: 600_000,
  }, { actor: 'issue445-fixture' });
  const swarmRuntime = new SwarmRuntime({
    store: coordination,
    coordinator: { list: () => [] },
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async () => { throw new Error('no native runs in this fixture'); },
    stopRun: async () => {},
  });
  t.after(() => { try { swarmRuntime.close(); } catch {} });
  const root = { actor: 'issue445-root', principalId: 'issue445-root', sessionId: 'issue445-root' };
  await swarmRuntime.command('swarm.create', {
    swarmId: SWARM_ID, purpose: 'issue445 transport fixture', idempotencyKey: 'issue445:create',
  }, root);
  await coordination.recordSwarm('swarm.participant_joined', {
    swarmId: SWARM_ID, participantId: 'ds-445', role: 'builder',
  }, { actor: root.actor, key: 'issue445:join:ds-445' });
  // The cursor sits past the join so the FIRST watch round meets the wake the filter waits for:
  // this row is about the transport's bound, not about the filter's re-arm (#339's own rows).
  const afterSeq = coordination.ledgerHeadSeq();
  await coordination.recordSwarm('swarm.contribution_recorded', {
    swarmId: SWARM_ID, participantId: 'ds-445', contributionId: 'c-445', body: 'the work landed',
  }, { actor: root.actor, key: 'issue445:contribution:c-445' });
  const application = {
    repoId: REPO,
    ready: Promise.resolve(),
    card() {
      return {
        schemaVersion: 1, repoId: REPO, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS),
        agentExperience: { registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest },
      };
    },
    async authorizeReplay() { return true; },
    async command(name, args, sessionPrincipal, context) {
      // The resident's held loop: no byte of a swarm command's answer leaves until the hold is
      // over. The handshake reads (doctor/session) are not the held fold, so they stay cheap.
      if (holdMs > 0 && name.startsWith('swarm.')) await new Promise((resolve) => setTimeout(resolve, holdMs));
      return swarmRuntime.command(name, args, {
        actor: `web:${sessionPrincipal.userId}:${sessionPrincipal.sessionId}`,
        principalId: sessionPrincipal.userId, sessionId: sessionPrincipal.sessionId,
      }, context);
    },
    async shutdown() { return { schemaVersion: 1, state: 'closed', ownership: { workers: 0 } }; },
  };
  const web = new WebNorthbound({
    coordinator: new Proxy({}, { get: () => () => [] }),
    coordination, sessions, application, repoIds: [REPO], allowedOrigins: [ORIGIN],
  });
  const server = createLocalAuthenticatedWebServer(web);
  const live = new Set();
  server.on('connection', (socket) => { live.add(socket); socket.on('close', () => live.delete(socket)); });
  const socketPath = join(directory, 'resident.sock');
  const host = new BatonWebHost({
    application, server,
    shutdownPrincipal: {
      actor: 'issue445-fixture', principalId: 'issue445-operator', sessionId: 'issue445-operator',
    },
    listen: { path: socketPath }, webDrainMs: 2_000,
  });
  t.after(async () => { try { await host.shutdown(); } catch {} });
  const started = await host.start();
  assert.equal(started.state, 'listening', 'the served resident listens on its owner-only socket');
  const fetchImpl = createLocalSocketFetch({ socketPath, baseUrl: ORIGIN });
  const client = new BatonWebClient({
    baseUrl: ORIGIN, origin: ORIGIN, repoId: REPO, token: issued.token,
    commandTimeoutMs: 30_000, pollMs: 20, fetchImpl,
    clock: () => Date.now(),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  });
  return {
    afterSeq, client, fetchImpl,
    /** The resident dying mid-request: every accepted connection ends under the request it carries. */
    killConnections() { for (const socket of [...live]) socket.destroy(); },
  };
}

test('445-a: a stall past the idle timer, inside the ceiling, answers the bounded watch', async (t) => {
  const resident = await servedResident(t, { holdMs: STALL_MS });
  const started = Date.now();
  const answer = await runBatonCli(parseBatonCli([
    'swarm', 'watch', SWARM_ID, '--after-seq', String(resident.afterSeq),
    '--wake-class', 'contribution_recorded', '--timeout-ms', '60000',
  ]), resident.client);
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= STALL_MS, `the answered wait spanned the stall (${elapsed} ms)`);
  assert.equal(answer.watch.reason, 'event', 'the bounded watch answers a wake, never a transport failure');
  assert.equal(answer.watch.event.kind, 'swarm.contribution_recorded');
  assert.equal(answer.watch.event.wakeClass, 'contribution_recorded', 'the filtered class rides the wake');
  assert.equal(answer.projection, 'outline', 'the watch answer keeps its bounded default projection');
});

test('445-b: a resident that dies mid-request names the socket cause and the elapsed wait', async (t) => {
  const resident = await servedResident(t, { holdMs: 500 });
  await resident.client.command('swarm.view', { swarmId: SWARM_ID }, 'issue445-b:first');
  const pending = resident.client.command('swarm.view', { swarmId: SWARM_ID }, 'issue445-b:second');
  await new Promise((resolve) => setTimeout(resolve, 100));
  resident.killConnections();
  const refusal = await pending.then(() => null, (error) => error);
  assert.equal(refusal?.code, 'cli_transport_failed', 'a connection dying under its request is a transport failure');
  assert.equal(refusal.cause, 'web_transport_failed', 'the composed cause row is unchanged');
  assert.deepEqual(Object.keys(refusal.detail.socket).sort(), ['code', 'message'],
    'the refusal keeps the ONE socket detail shape');
  assert.equal(refusal.detail.socket.code, 'ECONNRESET', 'the socket\u2019s own code reaches the operator');
  assert.match(refusal.detail.socket.message, /socket hang up/u, 'the socket\u2019s own message is kept');
  assert.match(refusal.detail.socket.message, /after \d+ ms/u,
    'the refusal names how long the request had been waiting');
});

test('445-c: the transport applies the registry derivation, never a literal agent default', async (t) => {
  const resident = await servedResident(t);
  await resident.client.command('swarm.view', { swarmId: SWARM_ID }, 'issue445-c:first');
  const marginRow = FRAME_LIMITS['transport.idle_margin_ms'];
  assert.ok(marginRow, 'the registry declares the transport idle margin row');
  const ceiling = FRAME_LIMITS['web.wait_ceiling_ms'].value;
  const derived = ceiling + marginRow.value;
  assert.equal(marginRow.unit, 'ms');
  assert.equal(marginRow.value, ceiling - WEB_WAIT_DEFAULT_MS,
    'the margin is the resident\u2019s own delivery headroom: the ceiling minus the default wait');
  assert.equal(resident.fetchImpl.idleTimeoutMs, derived,
    'the bound the transport applies is the registry derivation');
  assert.ok(derived > ceiling, `the applied bound (${derived} ms) is never shorter than the web wait ceiling`);
  const globals = [
    ...Object.values(globalAgent.freeSockets).flat(), ...Object.values(globalAgent.sockets).flat(),
  ];
  assert.deepEqual(globals.map((socket) => socket.timeout), [],
    'no socket of this transport rides the process-global agent (whose idle timer is Node\u2019s own, below the ceiling)');
});
