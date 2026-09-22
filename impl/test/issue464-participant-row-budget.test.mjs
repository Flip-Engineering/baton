// Issue #464 (docs/46 §7 cost rule; the #268 remainder): a participant row carried the recruit's
// whole objective — `role` verbatim, and the same text AGAIN through every later seat's brief,
// whose `## Swarm situation` line renders each peer's role. Measured live (36-seat swarm,
// 2026-09-18, probe-457): the participants page served 6 of 36 rows inside one frame. Measured
// here on a 36-seat fixture whose objectives are 3 KB each with NO line break (the worst case:
// the "first line" IS the whole objective): 2.3 MB of participant rows, a 4.66 MB whole record.
//
// The row a reader DECIDES on now carries the objective's FIRST LINE and names the rest: `role`
// (bounded by the ONE `view.role.head` registry row), `roleBytes` (the length it did not get) and
// `roleRef` (the `swarm.participant_joined` ledger row that holds the whole text). One derivation
// — the fold's participant row — so the view, `run.peers.read`, the recruit brief's situation
// line and the checkpoint all read the same bounded line.
//
// Rows:
//   a  a row's `role` is its first line, byte-bounded, beside `roleBytes` and `roleRef`; the
//      ledger row still carries the whole objective — nothing is lost, only pointed at;
//   b  the 36-seat fixture's participants projection fits ONE frame: all 36 rows, no cursor;
//   c  the CLI's full view of that fixture (the read that declares no frame) fits the frame too;
//   d  an attention row naming a seat carries no copy of the objective: the reach is the
//      participant row's own reference.
//
// Red-first at HEAD (observed before the change, output recorded in the contribution): (a)
// `role` is the whole objective and `roleBytes`/`roleRef` do not exist; (b) the projection
// measures 2.3 MB against a 1 MiB frame, so the answer is NARROWED and carries no participant
// rows at all; (c) the whole record measures 4.66 MB — over the frame; (d) fails on its second
// clause (there is no `roleRef` to reach the text by). (d)'s first clause is green at HEAD by
// construction — the attention rows reference the participant by id and were MEASURED to carry
// no objective text (11 KB across a 37-seat live swarm, the #441c (d) precedent for a
// green-at-HEAD guard) — and it stays here as the pin that the issue's "the same text again"
// never starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APPLICATION_COMMAND_DEFINITIONS,
  CoordinationStore,
  WebNorthbound,
} from '../src/index.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { swarmViewBridgeFrameBytes } from '../src/web-northbound.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const WEB_REPO = 'repo-a';
const WEB_ORIGIN = 'https://control.example.test';
const CEILING = FRAME_LIMITS['wire.frame'];
// The ONE bound the row's role draws (`view.role.head`): a role is the objective's first line.
const ROLE_HEAD = FRAME_LIMITS['view.role.head'];
const SEATS = 36;
const OBJECTIVE_BYTES = 3072;
const body = (index) => `goal body ${index} `.repeat(Math.ceil(OBJECTIVE_BYTES / 16)).slice(0, OBJECTIVE_BYTES);
// A multi-line objective: the FIRST line is the seat's title, the body is what a row must not carry.
const objective = (index) => `Seat ${index}: hold the participant row's budget (#464).\n${body(index)}`;
const firstLine = (index) => objective(index).slice(0, objective(index).indexOf('\n'));
// The worst case the roster must still fit: a 3 KB objective with NO line break, so its "first
// line" IS the whole objective and the registry bound is the only thing keeping the roster inside
// one frame.
const objectiveOneLine = (index) => `Seat ${index}: ${'x'.repeat(OBJECTIVE_BYTES - 8 - String(index).length)}`;

/** The light runtime harness (the swarm-runtime.test.mjs pattern): no adapter, no git, no run. */
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue464-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => (workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : []),
    routeCards: () => [],
    guideParticipant: async () => ({ ok: true }),
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working', paused: true, vendor: 'mock-session' });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(['view', 'watch'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }), ...args }, caller);
  const recruit = (participantId, objectiveText) => call('recruit', { participantId, objective: objectiveText });
  return { directory, store, runtime, call, recruit };
}

/** The REAL runtime behind the web bridge — the seam the bridge's own paging/narrowing answers
 * through (`WebNorthbound`), so the byte measures below are the ones a root's read crosses. */
function webFixture(t) {
  const f = fixture(t);
  const web = new WebNorthbound({
    coordinator: {},
    coordination: f.store,
    repoIds: [WEB_REPO],
    allowedOrigins: [WEB_ORIGIN],
    now: () => Date.parse('2026-09-18T12:17:00.000Z'),
    application: {
      repoId: WEB_REPO,
      card: () => ({ schemaVersion: 1, repoId: WEB_REPO, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
      async authorizeReplay() { return true; },
      async command(name, args, sessionPrincipal, context) {
        return f.runtime.command(name, args, {
          actor: `web:${sessionPrincipal.userId}:${sessionPrincipal.sessionId}`,
          principalId: sessionPrincipal.userId, sessionId: sessionPrincipal.sessionId,
        }, context);
      },
    },
  });
  const context = () => ({
    principal: {
      userId: 'root', sessionId: 'session-1', credentialId: 'cred-1', authMethod: 'cookie',
      csrfToken: 'csrf-1', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false,
      capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: [WEB_REPO],
    },
    origin: WEB_ORIGIN, csrfToken: 'csrf-1', remoteAddress: '127.0.0.1', transport: 'https',
  });
  // `frame` declared is what the bridge sends (a paged/narrowed answer); `frame` omitted is what
  // the CLI's own web client sends (the whole record).
  const read = async (args, { frame = true, step = 0 } = {}) => {
    const response = await web.execute(context(), {
      schemaVersion: 1, commandId: `cmd-464-${step}`, idempotencyKey: `request-464-${step}`,
      command: 'swarm_view', repoId: WEB_REPO, origin: WEB_ORIGIN,
      args: { swarmId: 'baton', ...args },
      ...(frame ? { frame: { lane: 'wire.frame' } } : {}),
    });
    assert.equal(response.status, 200, `the read is served (step ${step})`);
    return response.body.result;
  };
  return { ...f, web, read };
}

/** Every seat's join row, in ledger order, matched to the objective that was recruited with it. */
function joinRows(store) {
  return store.eventsView().filter((event) => event.kind === 'swarm.participant_joined');
}

// ── 464-a: the row's role is its FIRST LINE, bounded, and the rest is a reference ──────────────

test('464-a: a participant row carries the objective\'s first line, roleBytes and roleRef', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'The participant row budget (#464)' });
  await f.recruit('lead', 'Continue as lead');
  await f.recruit('lane', objective(1));
  await f.recruit('wide', 'one '.repeat(2000).trim());
  await f.recruit('unicode', '\u2603'.repeat(100));

  const view = await f.call('view');
  const rowOf = (id) => (view.participants ?? []).find((row) => row.participantId === id) ?? null;
  const joins = joinRows(f.store);
  const joinSeq = (id) => joins.find((event) => event.payload?.participantId === id)?.seq ?? null;

  const lane = rowOf('lane');
  assert.ok(lane, 'the seat is on the roster');
  assert.equal(lane.role, firstLine(1),
    'land the bounded role: the row carries the objective\'s FIRST LINE, never the whole objective (#464 item 1)');
  assert.equal(lane.roleBytes, Buffer.byteLength(objective(1)),
    'land roleBytes: the length of the text the row did NOT carry, so a reader knows what it is missing');
  assert.deepEqual(lane.roleRef, { kind: 'swarm.participant_joined', seq: joinSeq('lane') },
    'land roleRef: the ledger row that holds the whole objective — the reach, never a second copy');
  const ledgerRole = joins.find((event) => event.payload?.participantId === 'lane')?.payload?.role;
  assert.equal(ledgerRole, objective(1),
    'the ledger row still carries the objective verbatim: the bound moved no durable text, it named it (#464 item 1)');

  const wide = rowOf('wide');
  assert.equal(Buffer.byteLength(wide.role), ROLE_HEAD.value,
    `a first line longer than the registry bound is CUT at ${ROLE_HEAD.lane} (${ROLE_HEAD.value} ${ROLE_HEAD.unit}) — never carried whole`);
  assert.ok(wide.role.length > 0 && wide.role.startsWith('one '), 'and the cut keeps the objective\'s own opening');
  assert.ok(Buffer.byteLength(wide.role) < wide.roleBytes,
    'roleBytes > the carried bytes is how a reader sees the cut');
  assert.equal(wide.roleBytes, Buffer.byteLength('one '.repeat(2000).trim()), 'the full length is measured in bytes, not characters');

  const lead = rowOf('lead');
  assert.equal(lead.role, 'Continue as lead',
    'a role that fits the bound is untouched: the row reads exactly what the recruiter wrote');
  // A role is text a seat reads: the cut lands on a code-point boundary, never inside a character.
  const unicode = rowOf('unicode');
  assert.ok(Buffer.byteLength(unicode.role) <= ROLE_HEAD.value, `the multi-byte role respects ${ROLE_HEAD.lane}`);
  assert.ok(!unicode.role.includes('\uFFFD'),
    'the cut backs off to a code-point boundary — a 3-byte scalar is never split into a replacement character');
  assert.equal(Buffer.byteLength(unicode.role) % 3, 0, 'and what is carried stays whole characters');
  assert.equal(unicode.roleBytes, 300, 'roleBytes counts bytes, not characters');
  assert.equal(lead.roleBytes, Buffer.byteLength('Continue as lead'));
  assert.equal(lead.roleRef.seq, joinSeq('lead'));
  // The bound's own derivation, pinned: a seat's brief renders every peer's role line (`##
  // Swarm situation`) and the bridge counts an answer TWICE (the MCP envelope mirrors it).
  assert.ok(2 * SEATS * (SEATS - 1) * ROLE_HEAD.value <= CEILING.value,
    `2 × ${SEATS} seats × ${SEATS - 1} peer lines × ${ROLE_HEAD.value} B ≤ the ${CEILING.value} B ${CEILING.lane} — the quadratic, mirror-counted composition the bound is derived from`);
});

// ── 464-b / 464-c: the roster fits ONE frame, through the bridge and through the CLI's read ────

test('464-b: a 36-seat swarm\'s participants projection fits one frame', async (t) => {
  const f = webFixture(t);
  await f.call('create', { purpose: 'A roster inside one frame (#464)' });
  for (let index = 0; index < SEATS; index += 1) await f.recruit(`seat-${index}`, objectiveOneLine(index));
  const answer = await f.read({ projection: 'participants' });
  const bytes = swarmViewBridgeFrameBytes(answer);
  assert.ok(bytes <= CEILING.value,
    `the participants projection of a ${SEATS}-seat swarm fits the ${CEILING.lane} frame (measured ${bytes} B against ${CEILING.value} B) — measured 2.3 MB at HEAD`);
  assert.equal((answer.participants ?? []).length, SEATS + 1,
    'the whole roster is served, the synthesized root row included (docs/46 §5.1): a seat\'s first look answers every peer (#464 item 2)');
  assert.equal(answer.page?.next ?? null, null,
    'and no cursor is left: the roster did not have to be walked in pages');
  const roles = (answer.participants ?? []).map((row) => Buffer.byteLength(row.role ?? ''));
  assert.ok(Math.max(...roles) <= ROLE_HEAD.value, `every row's role is inside ${ROLE_HEAD.lane}`);
  assert.equal(answer.narrowed ?? null, null,
    'no narrowing record: the answer IS the projection that was asked for (#457 untouched)');
});

test('464-c: the CLI\'s full view of that fixture stays under the frame', async (t) => {
  const f = webFixture(t);
  await f.call('create', { purpose: 'A whole record inside one frame (#464)' });
  for (let index = 0; index < SEATS; index += 1) await f.recruit(`seat-${index}`, objectiveOneLine(index));
  // The CLI's own read: no declared frame, no projection — the whole record (the bridge's
  // `declaredRow === null` arm), which is the answer `baton swarm view` renders.
  const answer = await f.read({}, { frame: false, step: 1 });
  const bytes = swarmViewBridgeFrameBytes(answer);
  assert.ok(bytes <= CEILING.value,
    `the CLI's full view of a ${SEATS}-seat swarm stays under the ${CEILING.lane} frame (measured ${bytes} B against ${CEILING.value} B) — measured 4.66 MB at HEAD`);
  assert.equal((answer.participants ?? []).length, SEATS + 1, 'and it carries every seat plus the root row (docs/46 §5.1)');
});

// ── 464-d: no attention row re-renders a seat's objective ──────────────────────────────────────

test('464-d: an attention row names its seat; the objective is reached by reference', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Attention points, never copies (#464)' });
  for (let index = 0; index < 6; index += 1) await f.recruit(`seat-${index}`, objective(index));
  // One contribution crossed by a LATER join: the `unreviewed_contribution` attention row (docs/46
  // §2.3) — a row that names the authoring seat, so it is the row this pin is about.
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'c1', participantId: 'seat-0', body: 'First slice.',
  } }, { actor: 'worker:w-1', principalId: 'worker:w-1', sessionId: 'w-1' });
  await f.recruit('seat-6', objective(6));

  const view = await f.call('view', { projection: 'attention' });
  const rows = view.attention?.rows ?? [];
  const notice = rows.find((row) => row.kind === 'unreviewed_contribution' && row.participantId === 'seat-0') ?? null;
  assert.ok(notice, 'the attention row for the seat exists (the fixture really mints one)');
  for (const row of rows) {
    const text = JSON.stringify(row);
    for (let index = 0; index < 7; index += 1) {
      assert.ok(!text.includes(body(index)),
        `an attention row carries no copy of seat-${index}'s objective — the objective rides no attention row (#464 item 2)`);
    }
  }
  const roster = await f.call('view', { projection: 'participants' });
  const author = (roster.participants ?? []).find((row) => row.participantId === notice.participantId) ?? null;
  assert.ok(author, 'the attention row names a seat the roster carries');
  assert.equal(author.role, firstLine(0), 'and that seat\'s row carries the objective\'s first line');
  assert.deepEqual(author.roleRef, { kind: 'swarm.participant_joined', seq: joinRows(f.store).find((event) => event.payload?.participantId === 'seat-0')?.seq ?? null },
    'the objective\'s reach from an attention row is the participant row\'s OWN reference — never a second copy');
  assert.ok(author.roleBytes >= Buffer.byteLength(firstLine(0)), 'roleBytes names what the row did not carry');
});
