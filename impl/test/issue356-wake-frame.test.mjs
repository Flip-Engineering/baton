// Issue #356, the RESIDENT half: the wake primitives answered the whole swarm view instead of a
// wake. The bounded watch (`baton swarm watch <swarm> [--wake-class ...] --timeout-ms N`) returned
// the refreshed FULL view — megabytes on a busy swarm — and its watch row named only the row kind,
// never the #272 wake facts (class, subject, next, terminal). `baton.wake_stream_ended` carried no
// reason, so a follow that ended at once on a live swarm was undiagnosable, and the CLI never
// printed the ended frame at all when frames had been delivered. A transport error surfaced as the
// bare "the Baton Web connection failed" with the socket's own cause (ECONNRESET, ENOENT, the
// local transport's codes) discarded.
//
// The contract now: the bounded watch answers a WAKE FRAME first — the watch row's event enriched
// through the ONE wake classification (wake-stream's deriveWakeFrame) into
// {kind, seq, ts, actor, subject, wakeClass, terminal, next} — plus the view under the requested
// --projection, which defaults to outline for the watch. The wake stream's ends name a closed
// reason set, the CLI prints the ended frame, and a transport refusal carries the underlying
// socket cause in its detail.
//
// Red-first: at HEAD the bounded watch answers the full view with an impoverished watch row, the
// ended frame has no reason and is not printed, and the socket cause is dropped.
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS, CoordinationStore, WebNorthbound, WebSessionStore,
} from '../src/index.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import {
  BatonWebClient, followWakes, parseBatonCli, runBatonCli, watchSwarmFiltered,
} from '../src/application-cli.mjs';
import { openWakeStream, WAKE_STREAM_END_REASONS } from '../src/wake-stream.mjs';
import { createLocalSocketFetch } from '../src/local-web-transport.mjs';
import { fixtureSocketRoot } from './fixture-root.mjs';

const NOW = Date.parse('2026-09-17T12:00:00.000Z');
const ORIGIN = 'https://control.example.test';
const REPO_ID = 'repo-issue356';
const SWARM_ID = 's-356';
const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue356-${label}-`));
  roots.push(root);
  return root;
}

class Response {
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  end(body = '') { this.rawBody = body; this.body = body ? JSON.parse(body) : null; }
}
async function send(web, { method = 'POST', path, body, headers = {} }) {
  const req = new EventEmitter();
  Object.assign(req, {
    method, url: path, headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    socket: { encrypted: true, remoteAddress: '127.0.0.1' }, destroy() {},
  });
  const res = new Response();
  const pending = web.handle(req, res);
  queueMicrotask(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  await pending;
  return res;
}

const principal = { actor: 'direct:issue356-root', principalId: 'issue356-root', sessionId: 'issue356-root' };

/** The REAL swarm stack behind the web seam (the issue288/#336 harness): the watch answer the CLI
 * meets is the one the runtime folds, and the ledger row the arm re-reads is a real stored row. */
function fixture() {
  const directory = scratch('web');
  const sessions = new WebSessionStore(join(directory, 'sessions'), { now: () => NOW });
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const swarmRuntime = new SwarmRuntime({
    store: coordination,
    coordinator: { list: () => [] },
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async () => { throw new Error('no native runs in this fixture'); },
    stopRun: async () => {},
  });
  const application = {
    repoId: REPO_ID,
    card: () => ({ schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
    async authorizeReplay() { return true; },
    async command(name, args, sessionPrincipal, context) {
      return swarmRuntime.command(name, args, {
        actor: `web:${sessionPrincipal.userId}:${sessionPrincipal.sessionId}`,
        principalId: sessionPrincipal.userId, sessionId: sessionPrincipal.sessionId,
      }, context);
    },
    async actionAuthority() {
      return {
        schemaVersion: 1, actionId: 'act-1', kind: 'approve', effect: 'plan_approval',
        requiredCapabilities: ['observe'], authorityDigest: 'a'.repeat(64),
      };
    },
  };
  const web = new WebNorthbound({
    coordinator: {}, coordination, sessions, application,
    repoIds: [REPO_ID], allowedOrigins: [ORIGIN], now: () => NOW,
  });
  const issued = sessions.issue({
    userId: 'issue356-operator', authMethod: 'bearer',
    capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: [REPO_ID], ttlMs: 600_000,
  }, { actor: 'issue356-fixture' });
  const client = new BatonWebClient({
    baseUrl: 'https://baton.local/', origin: ORIGIN, repoId: REPO_ID, token: issued.token,
    commandTimeoutMs: 30_000, pollMs: 20,
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url);
      const response = await send(web, {
        method: init.method ?? 'GET', path: `${parsed.pathname}${parsed.search}`,
        body: init.body === undefined ? undefined : JSON.parse(init.body), headers: init.headers ?? {},
      });
      return {
        ok: response.status >= 200 && response.status < 300, status: response.status,
        text: async () => response.rawBody ?? '',
      };
    },
    clock: () => NOW, sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  });
  return { coordination, web, swarmRuntime, issued, client };
}

async function seedSwarm(coordination, swarmRuntime, { contextRows = 0, contextBytes = 24_000 } = {}) {
  await swarmRuntime.command('swarm.create', {
    swarmId: SWARM_ID, purpose: 'issue356 wake frame', idempotencyKey: 'issue356:create',
  }, principal);
  const actor = principal.actor;
  const record = (kind, payload, key) => coordination.recordSwarm(kind, { swarmId: SWARM_ID, ...payload }, { actor, key });
  await record('swarm.participant_joined', { participantId: 'builder-a', role: 'builder' }, 'issue356:join:builder-a');
  await record('swarm.participant_joined', { participantId: 'builder-b', role: 'builder' }, 'issue356:join:builder-b');
  for (let index = 0; index < contextRows; index += 1) {
    await record('swarm.context_updated', { key: `notes:${index}`, body: 'x'.repeat(contextBytes) }, `issue356:context:${index}`);
  }
  const afterSeq = coordination.ledgerHeadSeq();
  await record('swarm.contribution_recorded', {
    participantId: 'builder-a', contributionId: 'c-1', body: 'the work landed',
  }, 'issue356:contribution:c-1');
  return { afterSeq };
}

// ── 356-a: the bounded watch answers a wake frame first, plus an outline ───────────────────────

test('356-a: a bounded watch on a swarm larger than the old ceiling answers the enriched wake frame plus an outline', async () => {
  const { coordination, swarmRuntime, client } = fixture();
  const { afterSeq } = await seedSwarm(coordination, swarmRuntime, { contextRows: 120 });

  // The fixture really is the size that made the old answer unusable.
  const fullView = await client.command('swarm.view', { swarmId: SWARM_ID });
  const fullBytes = Buffer.byteLength(JSON.stringify(fullView));
  assert.ok(fullBytes > 2_000_000, `the fixture full view is ${fullBytes} bytes — past the old 2 MB ceiling`);
  const outline = await client.command('swarm.view', { swarmId: SWARM_ID, projection: 'outline' });
  const outlineBytes = Buffer.byteLength(JSON.stringify(outline));
  assert.ok(outlineBytes < 100_000, `the outline alone is ${outlineBytes} bytes`);

  const parsed = parseBatonCli([
    'swarm', 'watch', SWARM_ID, '--after-seq', String(afterSeq),
    '--timeout-ms', '5000', '--wake-class', 'contribution_recorded',
  ]);
  const answer = await watchSwarmFiltered(parsed, client);

  // The wake frame is the headline: printed before the view, carrying the #272 facts.
  assert.equal(Object.keys(answer)[0], 'watch', 'the wake frame rides first, before the view');
  assert.equal(answer.watch.reason, 'event');
  assert.equal(answer.watch.event.kind, 'swarm.contribution_recorded');
  assert.equal(answer.watch.event.seq, afterSeq + 1);
  assert.equal(answer.watch.event.wakeClass, 'contribution_recorded');
  assert.equal(answer.watch.event.terminal, true, 'contribution_recorded is a terminal class');
  assert.equal(typeof answer.watch.event.ts, 'string', 'the wake names when the row landed');
  assert.equal(typeof answer.watch.event.actor, 'string', 'the wake names the actor');
  assert.deepEqual(answer.watch.event.subject, { kind: 'contribution', id: 'c-1' });
  assert.match(answer.watch.event.next ?? '', /swarm check/, 'the wake names the next command');

  // The view under the DEFAULT projection — outline, not the megabyte full record.
  assert.equal(answer.projection, 'outline', 'the bounded watch defaults the projection to outline');
  assert.equal(Object.hasOwn(answer, 'context'), false, 'the outline carries no context families');
  const answerBytes = Buffer.byteLength(JSON.stringify(answer));
  assert.ok(answerBytes <= outlineBytes + 4096,
    `the watch answer is ${answerBytes} bytes — bounded by the outline's ${outlineBytes} plus the frame`);
});

// ── 356-b: an explicit --projection on the watch carries the rows AND the wake frame ───────────

test('356-b: --projection participants on the watch carries the rows and the enriched wake frame', async () => {
  const { coordination, swarmRuntime, client } = fixture();
  const { afterSeq } = await seedSwarm(coordination, swarmRuntime);

  const parsed = parseBatonCli([
    'swarm', 'watch', SWARM_ID, '--after-seq', String(afterSeq),
    '--timeout-ms', '5000', '--wake-class', 'contribution_recorded', '--projection', 'participants',
  ]);
  const answer = await watchSwarmFiltered(parsed, client);

  assert.equal(answer.projection, 'participants', 'an explicit projection rides');
  assert.ok(Array.isArray(answer.participants) && answer.participants.length === 2,
    'the participants rows ride the watch answer');
  assert.ok(answer.participants.every((row) => typeof row.participantId === 'string'));
  assert.equal(answer.watch.event.wakeClass, 'contribution_recorded');
  assert.deepEqual(answer.watch.event.subject, { kind: 'contribution', id: 'c-1' },
    'the wake frame is enriched under a wide projection too');
  assert.equal(answer.watch.event.terminal, true);
  assert.equal(typeof answer.watch.event.next, 'string');
});

// ── 356-c: wake_stream_ended carries a closed reason, and the CLI prints it ────────────────────

function stubWakeClient(outcome, { frames = [] } = {}) {
  return {
    wakes({ onFrame }) {
      for (const frame of frames) queueMicrotask(() => onFrame(frame));
      return { close: () => {}, done: Promise.resolve(outcome) };
    },
  };
}

test('356-c: the ended frame carries a closed reason — server-named, swarm-closed, caller, or transport — and the CLI prints it', async () => {
  assert.deepEqual([...WAKE_STREAM_END_REASONS],
    ['swarm_closed', 'stream_cursor_behind_archive', 'transport_closed', 'caller_closed', 'resident_stopping'],
    'the end-reason vocabulary is the closed set the issue names');

  const print = [];
  const ended = await followWakes(
    { swarms: [SWARM_ID], kinds: null, since: null, follow: true, stopOnClosedWake: true },
    stubWakeClient({ status: 'ended' }),
    { onFollowPage: async (page) => { print.push(page); } },
  );
  assert.equal(ended.kind, 'baton.wake_stream_ended');
  assert.equal(ended.reason, 'transport_closed',
    'a clean end the resident did not name is a transport close, never an unnamed one');
  assert.equal(print.at(-1)?.reason, 'transport_closed', 'the CLI prints the ended frame (as the final page)');

  const named = await followWakes(
    { swarms: [SWARM_ID], kinds: null, since: null, follow: true, stopOnClosedWake: true },
    stubWakeClient({ status: 'ended', reason: 'resident_stopping' }),
    { onFollowPage: async () => {} },
  );
  assert.equal(named.reason, 'resident_stopping', 'a reason the resident named rides verbatim');

  const behindArchive = await followWakes(
    { swarms: [SWARM_ID], kinds: null, since: null, follow: true, stopOnClosedWake: true },
    stubWakeClient({ status: 'ended', reason: 'stream_cursor_behind_archive' }),
    { onFollowPage: async () => {} },
  );
  assert.equal(behindArchive.reason, 'stream_cursor_behind_archive',
    'the --since-cursor-behind-the-archive end names itself');

  const closedWake = {
    schemaVersion: 1, kind: 'baton.wake', seq: 7, wakeClass: 'closed', swarmId: SWARM_ID,
    participantId: null, workerId: null, runId: null, actor: 'root', subject: null, next: null,
    observation: false, row: { seq: 7, kind: 'swarm.closed' },
  };
  const closed = await followWakes(
    { swarms: [SWARM_ID], kinds: null, since: null, follow: true, stopOnClosedWake: true },
    stubWakeClient({ status: 'stopped' }, { frames: [closedWake] }),
    { onFollowPage: async () => {} },
  );
  assert.equal(closed.reason, 'swarm_closed', 'the swarm\u2019s own closed wake names the end');
  assert.deepEqual(closed.closed, { swarmId: SWARM_ID, seq: 7 });

  const controller = new AbortController();
  controller.abort();
  const caller = await followWakes(
    { swarms: [SWARM_ID], kinds: null, since: null, follow: true, stopOnClosedWake: true },
    stubWakeClient({ status: 'stopped' }),
    { signal: controller.signal, onFollowPage: async () => {} },
  );
  assert.equal(caller.reason, 'caller_closed', 'the caller\u2019s own stop names itself');
});

test('356-c2: an SSE `event: ended` frame from the resident names the reason, and never reads as a wake', async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' });
    response.write('id: 4\nevent: wake\ndata: {"schemaVersion":1,"kind":"baton.wake","seq":4,"wakeClass":"recruited"}\n\n');
    response.write('event: ended\ndata: '
      + `${JSON.stringify({ schemaVersion: 1, kind: 'baton.wake_stream_ended', reason: 'stream_cursor_behind_archive' })}\n\n`);
    response.end();
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  try {
    const frames = [];
    const attachment = openWakeStream({
      baseUrl: `http://127.0.0.1:${port}`, token: 't', onFrame: (frame) => { frames.push(frame); },
    });
    const outcome = await attachment.done;
    assert.equal(outcome.status, 'ended');
    assert.equal(frames.length, 1, 'the ended marker is never delivered as a wake frame');
  } finally {
    server.close();
  }
});

// ── 356-d: a transport error names the real socket cause ───────────────────────────────────────

test('356-d: a transport error carries the underlying socket cause (code and message) in its detail', async () => {
  const client = new BatonWebClient({
    baseUrl: 'https://baton.local/', origin: ORIGIN, repoId: REPO_ID, token: 't',
    commandTimeoutMs: 30_000, pollMs: 20,
    fetchImpl: async () => {
      throw Object.assign(new Error('connect ECONNRESET 127.0.0.1:7777'), { code: 'ECONNRESET' });
    },
    clock: () => NOW, sleep: () => Promise.resolve(),
  });
  await assert.rejects(client.command('swarm.view', { swarmId: SWARM_ID }), (error) => {
    assert.equal(error.code, 'cli_transport_failed');
    assert.equal(error.cause, 'web_transport_failed', 'the composed cause row is unchanged');
    assert.deepEqual(error.detail.socket, {
      code: 'ECONNRESET', message: 'connect ECONNRESET 127.0.0.1:7777',
    }, 'the socket\u2019s own cause rides the detail instead of being discarded');
    return true;
  });
});

test('356-d2: the local transport\u2019s typed refusal code names itself in the socket cause', async () => {
  // A Unix socket path is bounded (sun_path, 104 bytes) and the transport validator refuses a
  // longer one with the wrong code, so the fixture root goes through the measure-then-fall-back
  // derivation (fixture-root.mjs) and is cleaned with the rest.
  const directory = fixtureSocketRoot('baton-issue356-socket-');
  roots.push(directory);
  const localFetch = createLocalSocketFetch({ socketPath: join(directory, 'resident.sock') });
  const client = new BatonWebClient({
    baseUrl: 'https://baton.local/', origin: ORIGIN, repoId: REPO_ID, token: 't',
    commandTimeoutMs: 30_000, pollMs: 20, fetchImpl: localFetch,
    clock: () => NOW, sleep: () => Promise.resolve(),
  });
  await assert.rejects(client.command('swarm.view', { swarmId: SWARM_ID }), (error) => {
    assert.equal(error.code, 'cli_transport_failed');
    assert.equal(error.detail.socket?.code, 'local_transport_unavailable',
      'the local transport\u2019s own code (the socket is unavailable) reaches the refusal');
    return true;
  });
});

// ── 356-e: the timeout answer carries watch.reason timeout and the outline ─────────────────────

test('356-e: a spent bounded watch answers watch.reason timeout under the outline default', async () => {
  const { coordination, swarmRuntime, client } = fixture();
  await seedSwarm(coordination, swarmRuntime, { contextRows: 120 });
  const outline = await client.command('swarm.view', { swarmId: SWARM_ID, projection: 'outline' });
  const outlineBytes = Buffer.byteLength(JSON.stringify(outline));

  const answer = await runBatonCli(
    parseBatonCli(['swarm', 'watch', SWARM_ID, '--timeout-ms', '50']),
    client,
  );
  assert.equal(answer.watch.reason, 'timeout', 'the deadline is reported, never a fabricated wake');
  assert.equal(answer.watch.event, null);
  assert.equal(answer.projection, 'outline', 'the timeout answer is bounded by the outline default too');
  assert.equal(Object.hasOwn(answer, 'context'), false);
  assert.equal(Object.keys(answer)[0], 'watch', 'the timeout wake frame rides first');
  const answerBytes = Buffer.byteLength(JSON.stringify(answer));
  assert.ok(answerBytes <= outlineBytes + 4096,
    `the timeout answer is ${answerBytes} bytes — bounded by the outline's ${outlineBytes}`);
});
