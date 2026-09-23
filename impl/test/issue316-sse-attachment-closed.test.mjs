// issue316-sse-attachment-closed.test.mjs — Issue #316 (b), the SSE follow-up: the resident's OWN
// end is named on the SSE attachment too.
//
// What landed with #316 (d29e2b13): wake-stream.mjs owns ONE closed attachment-end reason set
// (`error`, `restart`, `transport_closed`) and the ONE typed final frame
// `baton.wake_attachment_closed {reason, at, resumeFrom}`; the loopback WebSocket binding writes it
// when an attachment ends; the CLI follow rides it on its ended row and delivers it as its only page
// when the attachment delivered nothing.
//
// What remained: `_handleWakes` (web-northbound.mjs) — the SSE leg the CLI actually follows — wrote
// no end marker at all. A resident that stopped mid-follow ended the socket silently, so a follower
// could only INFER transport_closed, and a resident shutdown that ended every attachment was
// indistinguishable from a client that walked away. The rows below pin the leg's end to the SAME ONE
// frame:
//
//   (a) a follow attached over the served SSE transport receives `baton.wake_attachment_closed
//       {reason: 'restart', resumeFrom}` when the resident shuts down mid-follow — resumeFrom is the
//       last seq the leg delivered, and the frame is the only page of an attachment that delivered
//       nothing;
//   (b) the leg's reasons come from the wake-stream export (ATTACHMENT_CLOSED_REASONS through
//       attachmentClosedReason/attachmentClosedFrame) — never a second reason set — and a stream that
//       fails mid-attachment names `error` that way too;
//   (c) the SSE leg and the loopback binding name the SAME end for one resident stop in one
//       process, so the two transports cannot tell a consumer two stories about one shutdown;
//   (d) the served host VALIDATES under either end of the ambient-root band a parallel gate hands
//       its files (#446): the fixture mints its socket root under the short system root instead of
//       measuring the ambient one — the derivation whose five-byte optimism made every row of this
//       file fail `Web host configuration is invalid` inside a gate and pass alone.
//
// Hermetic: temp dirs under os.tmpdir() — the socket root under the short system root, because the
// host refuses a bound path over the kernel's 103-byte sun_path — a real coordination ledger, the
// real authenticated Web host on an owner-only Unix socket, no provider process, no network beyond
// loopback. `git stash` is never used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BatonWebHost } from '../src/application-host.mjs';
import { BatonWebClient, followWakes } from '../src/application-cli.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { createLocalSocketFetch } from '../src/local-web-transport.mjs';
import { WebSessionStore } from '../src/web-auth.mjs';
import { WebNorthbound, createLocalAuthenticatedWebServer } from '../src/web-northbound.mjs';
import { ATTACHMENT_CLOSED_REASONS, WakeStream } from '../src/wake-stream.mjs';

const ORIGIN = 'https://baton.local';
const REPO_ID = 'repo-issue-316-sse';
const SWARM_ID = 'sse-316';

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-316sse-${label}-`));
  roots.push(root);
  return root;
}

async function until(predicate, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  throw new Error(`timed out waiting for ${label} (last: ${JSON.stringify(last)?.slice(0, 200)})`);
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** The SSE attachments the served resident has ADMITTED, read from its own audit trail: the leg
 * writes `wake_stream_connected` before it starts serving, so this is observable evidence that the
 * transport — not the leg's private bookkeeping — is live. Audit rows are not wake rows, so they
 * never wear a wake class and never reach a follower. */
function admittedAttachments(coordination) {
  return coordination.eventsView(0)
    .filter((event) => event.kind === 'web.audit' && event.payload?.kind === 'wake_stream_connected').length;
}

const wakeFrames = (messages) => messages.filter((message) => message.kind === 'baton.wake');

/** The REAL served host: the real authenticated Web transport (`WebNorthbound` + its owner-only
 * Unix socket server) under the real host that owns it, over a real coordination ledger and the real
 * wake stream. The application facade is the ONE stub (the host's own contract needs one; the #294
 * binding row does the same), because the wake surface this file pins never dispatches an
 * application command. */
async function servedResident(t, { stream = null, binding = null } = {}) {
  const directory = scratch('host');
  const coordination = new CoordinationStore(join(directory, 'coordination'));
  const sessions = new WebSessionStore(join(directory, 'sessions'));
  const issued = sessions.issue({
    userId: 'local-owner', authMethod: 'bearer',
    capabilities: ['observe', 'control'], repoIds: [REPO_ID], ttlMs: 600_000,
  }, { actor: 'deployment:resident' });
  const web = new WebNorthbound({
    coordinator: {}, coordination, sessions, repoIds: [REPO_ID], allowedOrigins: [ORIGIN],
    wakes: stream ?? new WakeStream({ coordination, pollMs: 25 }),
  });
  const server = createLocalAuthenticatedWebServer(web);
  // sun_path is bounded (104 bytes) and the host refuses a bound path over 103, so the socket root
  // is minted under the SHORT system temp root — the rule the resident fixtures already follow
  // (issue276/288/351/356/365/445/450) — never derived from the ambient one: `mkdtemp` appends SIX
  // random characters, so a probe that stands them in with one character reads five bytes short. An
  // ambient root of 65..69 bytes (a suite root minted under this host's system temp dir is 67) was
  // then admitted and minted a 104..108-byte socket path the host refused: every row of this file,
  // but only inside a gate that hands its files that root (#446; row 316-sse-d).
  const socketDir = mkdtempSync(join(tmpdir(), 'baton-316sse-'));
  roots.push(socketDir);
  const socketPath = join(socketDir, 'resident.sock');
  const host = new BatonWebHost({
    application: { ready: Promise.resolve(true), async shutdown() { return { state: 'closed' }; } },
    server,
    shutdownPrincipal: { actor: 'deployment:resident', principalId: 'local-owner', sessionId: 'local-owner-session' },
    listen: { path: socketPath }, webDrainMs: 2_000,
    ...(binding === null ? {} : { wakes: binding }),
  });
  t.after(async () => { try { await host.shutdown(); } catch { /* the fixture is already down */ } });
  await host.start();
  const client = new BatonWebClient({
    baseUrl: ORIGIN, origin: ORIGIN, repoId: REPO_ID, token: issued.token, socketPath,
    commandTimeoutMs: 15_000, pollMs: 10,
    fetchImpl: createLocalSocketFetch({ socketPath, baseUrl: ORIGIN }),
    clock: Date.now, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  return { coordination, web, host, client, token: issued.token, socketPath };
}

const FOLLOW = Object.freeze({ kinds: null, swarms: null, follow: true, stopOnClosedWake: false });

function recordSwarmRows(coordination) {
  coordination.recordSwarm('swarm.created', { swarmId: SWARM_ID, purpose: 'SSE attachment end' },
    { actor: 'test:root', key: '316sse:create' });
  coordination.recordSwarm('swarm.participant_joined', { swarmId: SWARM_ID, participantId: 'lane-1', role: 'builder' },
    { actor: 'test:root', key: '316sse:join' });
}

// ── (a) the SSE leg names the resident's own end ────────────────────────────────────────────────

test('316-sse-a: a follow over the served SSE leg is told the resident ended it — reason restart, resumeFrom the last seq it delivered', { timeout: 60_000 }, async (t) => {
  const resident = await servedResident(t);

  // One attachment follows the rows recorded after it; the second attaches AT the head those rows
  // left, so it has delivered nothing when the resident stops and is the empty-attachment case.
  const pages = [];
  const follow = followWakes({ ...FOLLOW, since: 0 }, resident.client,
    { onFollowPage: async (page) => { pages.push(page); } });
  await until(() => admittedAttachments(resident.coordination) >= 1, 'the admitted SSE attachment');
  recordSwarmRows(resident.coordination);
  await until(() => pages.length >= 2, 'the two wake frames over SSE');
  const lastSeq = resident.coordination.ledgerHeadSeq();

  const silentPages = [];
  const silent = followWakes({ ...FOLLOW, since: lastSeq }, resident.client,
    { onFollowPage: async (page) => { silentPages.push(page); } });
  await until(() => admittedAttachments(resident.coordination) >= 2, 'both admitted SSE attachments');

  await resident.host.shutdown();
  const ended = await follow;
  const silentEnded = await silent;

  assert.equal(ended.kind, 'baton.wake_stream_ended');
  assert.equal(ended.frames, 2, 'the attachment delivered both rows that landed after it attached');
  assert.equal(ended.cursor, lastSeq);
  assert.equal(ended.reason, 'resident_stopping',
    'the CLI follow reads the resident\u2019s own end as its reason, the vocabulary #356 opened');
  const frame = ended.attachmentClosed;
  assert.ok(frame, 'the ended row carries the attachment\u2019s typed final frame');
  assert.equal(frame.kind, 'baton.wake_attachment_closed');
  assert.equal(frame.reason, 'restart', 'the resident stopping for a shutdown names a restart, never silence');
  assert.equal(frame.resumeFrom, lastSeq, 'the frame names the last seq the SSE leg delivered');
  assert.ok(Number.isFinite(Date.parse(frame.at)), 'and the instant the attachment ended');
  assert.ok(ATTACHMENT_CLOSED_REASONS.includes(frame.reason), 'the reason is a member of the ONE closed set');
  assert.deepEqual(pages.map((page) => page.kind), ['baton.wake', 'baton.wake'],
    'the typed final frame ends the attachment, it is never delivered as a wake page');

  // An attachment that delivered NOTHING says why it ended as its only page (#356), and it still
  // names the resident\u2019s own end — the case that used to look like a bare transport close.
  assert.equal(silentEnded.frames, 0);
  assert.deepEqual(silentPages.map((page) => page.kind), ['baton.wake_stream_ended'],
    'an attachment that delivered nothing says why it ended as its only page');
  assert.equal(silentPages[0], silentEnded, 'and that page IS the ended row');
  assert.equal(silentEnded.attachmentClosed.reason, 'restart');
  assert.equal(silentEnded.attachmentClosed.resumeFrom, null, 'nothing was delivered, so nothing resumes from');
});

// ── (b) the SSE leg's reasons are the wake-stream export's ──────────────────────────────────────

test('316-sse-b: the SSE leg names its end through the wake-stream export — never a second reason set', { timeout: 60_000 }, async (t) => {
  // The grep row: the leg renders its end through the module's ONE mapping and frame builder, so a
  // second reason vocabulary cannot grow inside it unnoticed.
  const source = readFileSync(new URL('../src/web-northbound.mjs', import.meta.url), 'utf8');
  const legStart = source.indexOf('async _handleWakes(');
  const legEnd = source.indexOf('\n  get wakes()');
  assert.ok(legStart > 0 && legEnd > legStart, 'the SSE leg is where this issue names it');
  const leg = source.slice(legStart, legEnd);
  assert.match(source, /import \{[^}]*\battachmentClosedFrame\b[^}]*\} from '\.\/wake-stream\.mjs';/u,
    'the SSE leg imports the ONE typed-final-frame builder from the wake stream');
  assert.match(leg, /attachmentClosedReason\(/u, 'and maps its end through the ONE reason mapping');
  assert.match(leg, /attachmentClosedFrame\(/u, 'writing the ONE frame, never a hand-rolled body');
  assert.deepEqual([...ATTACHMENT_CLOSED_REASONS], ['error', 'restart', 'transport_closed'],
    'the set those reasons come from is closed, and it is the stream module\u2019s export');

  // The behavioural row for the third reason: a stream that FAILS mid-attachment names `error`
  // through the same mapping, and the failure is delivered before it is thrown.
  const failing = new WakeStream({
    coordination: {
      eventsView: () => [],
      swarms: () => [],
      eventCursor: () => { throw Object.assign(new Error('ledger unreadable'), { code: 'coordination_unreadable' }); },
    },
    pollMs: 25,
  });
  const resident = await servedResident(t, { stream: failing });
  const pages = [];
  await assert.rejects(
    followWakes({ ...FOLLOW, since: null }, resident.client,
      { onFollowPage: async (page) => { pages.push(page); } }),
    (error) => {
      const frame = error?.detail?.attachmentClosed;
      assert.ok(frame, 'the failure carries the typed final frame, not a bare throw');
      assert.equal(frame.kind, 'baton.wake_attachment_closed');
      assert.equal(frame.reason, 'error');
      assert.equal(frame.resumeFrom, null, 'an attachment that never saw a frame resumes from nowhere');
      assert.ok(Number.isFinite(Date.parse(frame.at)));
      assert.ok(ATTACHMENT_CLOSED_REASONS.includes(frame.reason));
      return true;
    },
  );
  assert.deepEqual(pages.map((page) => page.kind), ['baton.wake_attachment_closed'],
    'the failing attachment\u2019s frame reaches the page consumer before the refusal');
});

// ── (c) one stop, two transports, one end ───────────────────────────────────────────────────────

test('316-sse-c: the SSE leg and the loopback binding name the same end for one resident stop', { timeout: 60_000 }, async (t) => {
  const port = await freePort();
  const resident = await servedResident(t, { binding: { host: '127.0.0.1', port } });

  const pages = [];
  const follow = followWakes({ ...FOLLOW, since: 0 }, resident.client,
    { onFollowPage: async (page) => { pages.push(page); } });
  const wsFrames = [];
  const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/wakes?since=0`,
    { headers: { authorization: `Bearer ${resident.token}` } });
  socket.addEventListener('message', (event) => wsFrames.push(JSON.parse(event.data)));
  let wsRefusal = null;
  socket.addEventListener('error', () => { wsRefusal = 'the loopback wake binding refused the attachment'; });
  socket.addEventListener('close', (event) => {
    if (wsRefusal === null) wsRefusal = `the loopback wake binding closed the attachment (${event.code})`;
  });
  t.after(() => { try { socket.close(); } catch { /* already closed */ } });
  await until(() => admittedAttachments(resident.coordination) >= 1, 'the admitted SSE attachment');
  // The handshake is awaited by POLLING the socket: the open event can fire while the SSE
  // attachment above is still being admitted, and a listener attached afterwards would wait
  // forever on an event that already happened.
  await until(() => {
    if (socket.readyState === 1) return true;
    if (wsRefusal !== null) throw new Error(wsRefusal);
    return false;
  }, 'the loopback wake binding to answer the handshake');

  recordSwarmRows(resident.coordination);
  await until(() => pages.length >= 2 && wakeFrames(wsFrames).length >= 2, 'both attachments to receive the rows');
  const lastSeq = resident.coordination.ledgerHeadSeq();

  await resident.host.shutdown();
  const ended = await follow;
  await until(() => wsFrames.some((message) => message.kind === 'baton.wake_attachment_closed'),
    'the loopback binding\u2019s typed final frame');

  const sseFrame = ended.attachmentClosed;
  const wsFrame = wsFrames.find((message) => message.kind === 'baton.wake_attachment_closed');
  assert.deepEqual(Object.keys(sseFrame).sort(), Object.keys(wsFrame).sort(),
    'both transports write the ONE frame shape');
  assert.equal(wsFrame.reason, 'restart', 'the binding names the resident\u2019s own stop a restart');
  assert.equal(sseFrame.reason, wsFrame.reason, 'the SSE leg names the same end, never a second story');
  assert.equal(sseFrame.resumeFrom, lastSeq);
  assert.equal(wsFrame.resumeFrom, lastSeq, 'both resumeFrom the last seq each attachment delivered');
});

// ── (d) the served host survives the ambient root a gate hands it ───────────────────────────────

/** Issue #446: a parallel gate hands every file a TMPDIR of its own — the run's SUITE ROOT, which
 * is the gate's temp parent plus '/baton-suite-XXXXXX' (19 bytes). The band below is the ambient
 * root the #316 fixture could not survive: its guard measured the ambient root with a probe that
 * stood `mkdtemp`'s SIX random characters in with ONE — five bytes short — so a 65..69-byte
 * ambient root was admitted and minted a 104..108-byte socket path, past the host's 103-byte
 * sun_path bound, and EVERY row of this file failed `Web host configuration is invalid`; the same
 * file passed under the deeper root a solo run happens to have. Both ends are exercised: a
 * measure-then-fall-back derivation can re-admit one of them, never both. */
const AMBIENT_ROOT_BAND = Object.freeze([65, 69]);

test('316-sse-d: the served host validates under either end of the ambient-root band a gate hands it', { timeout: 60_000 }, async (t) => {
  const previous = process.env.TMPDIR;
  t.after(() => { process.env.TMPDIR = previous; });
  for (const bytes of AMBIENT_ROOT_BAND) {
    const root = join('/tmp', 'b'.repeat(bytes - '/tmp/'.length));
    assert.equal(Buffer.byteLength(root), bytes, 'the fixture root IS the ambient length under test');
    mkdirSync(root, { recursive: true, mode: 0o700 });
    roots.push(root);
    process.env.TMPDIR = root;
    // The host's own configuration validator is the assertion: it refuses a bound path over 103
    // bytes, so a fixture that answered here is a fixture a gate can hand any root to.
    const resident = await servedResident(t);
    const follow = followWakes({ ...FOLLOW, since: resident.coordination.ledgerHeadSeq() },
      resident.client, {});
    await until(() => admittedAttachments(resident.coordination) >= 1,
      `the served transport to admit a follower under a ${bytes}-byte ambient root`);
    await resident.host.shutdown();
    const ended = await follow;
    assert.equal(ended.kind, 'baton.wake_stream_ended',
      `the served attachment ends honestly under a ${bytes}-byte ambient root`);
  }
});
