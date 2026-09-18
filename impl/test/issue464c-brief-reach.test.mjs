// Issue #464 (the THIRD half, lane ds-464c) — a participant row carries the brief's REACH, never
// its text; the participantId-scoped read carries the text.
//
// MEASURED live (primary at bb5640bd, 39-seat swarm, 2026-09-18 13:05Z): the participants page
// served 24 of 39 rows in 494 693 bytes, and the rows' `brief` fields summed to 421 920 of the
// 471 164-byte participants array (~17.5 KB per row). Halves 1 and 2 (#464 role head 75bc9a76;
// the commit tail bb5640bd) bounded the OTHER two per-row fields; `brief` — the composed brief
// text a seat is recruited with — was still copied onto every roster row.
//
// The law this file pins (issue #464's Required items 1–3, the lane contract's rows a–d):
//   (a) a roster row's `brief` is the REACH `{bytes, seq, exposure}` — the composed text's length,
//       the `swarm.participant_joined` ledger row that holds it, and the class that decided what
//       this caller may see; the participantId-scoped read's own row carries the TEXT, whose byte
//       length is exactly the roster reach's `bytes`;
//   (b) the class is ONE derivation (docs/46 §4.1): the roster row and the scoped read answer the
//       SAME class for the same caller — pinned for the organizer (root), a peer, and the seat
//       itself, then the delegation edge from both ends, a shared group roster and a shared
//       recorded checkout (the stronger relation wins);
//   (c) a 39-seat fixture whose every brief is at least the 17 KB the probe measured answers its
//       participants projection in ONE frame through the real bridge — served 39, no cursor;
//   (d) the seat's own read still renders its brief text end to end, and the roster the same
//       token reads carries the reach instead — the text is never on a roster row.
//
// Red-first at HEAD (bb5640bd): (a) `brief` is the composed text string on every row (null under a
// scope) and no `{bytes, seq, exposure}` exists anywhere; (b) no exposure class exists to compare;
// (c) the fixture's roster exceeds the frame and the bridge PAGES it, so a seat's first look
// answers part of its peers.
// (d)'s FIRST clause is green at HEAD by construction — the scoped read already carried the
// scope's own brief (2026-09-14 audit S-F3) — and stays here as the pin that the reach never
// becomes the only reading of a seat's own brief; its SECOND clause (the same token's roster
// carries no text) is red at HEAD, which is the whole change.
//
// NOTE ON THE LANE CONTRACT'S (d): the contract named `run.member.view` as the seat-side read that
// must keep rendering the brief text. That verb is `run.workstreams` (application.mjs
// `workstreams`), a RUN-side episode read over the run's own goal/workstreams — it never read a
// swarm participant row and has no `brief` field to break, and the swarm seat's own read of its
// member row is `swarm.view {swarmId, participantId}` (the verb the bridge issues a seat). (d)
// therefore drives the real bridge with the seat's OWN token, which is the read the contract's
// sentence protects; no reader of a participant row's `brief` exists outside this projection
// (`run.peers.read` and the recruit brief's situation lines read `role`, bounded by #464 half 1).
//
// Hermetic: a real CoordinationStore and the real SwarmRuntime (plus the real native bridge for
// (c)/(d)); no adapter, no git, no run handle beyond the fixture's own.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
// The closed set is read through the module NAMESPACE so that at HEAD — where it does not exist
// yet — the four rows below report their own failures instead of the whole file failing to link
// (the issue464b pattern). `undefined` is exactly the red-first fact this file observes.
import * as swarmRuntime from '../src/swarm-runtime.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { createSwarmNativeBridge, swarmBridgeCommand } from '../src/swarm-native-bridge.mjs';

const { SwarmRuntime, SWARM_PERMISSIONS } = swarmRuntime;
const SWARM_BRIEF_EXPOSURE_CLASSES = swarmRuntime.SWARM_BRIEF_EXPOSURE_CLASSES ?? [];

const owner = { actor: 'direct:issue464c-root', principalId: 'issue464c-root', sessionId: 'issue464c-root' };
const workerPrincipal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });
const SWARM = 'brief-reach-464c';
/** The bridge ceiling the issue was measured against — the registry's own wire frame, never a literal. */
const WIRE_FRAME = FRAME_LIMITS['wire.frame'].value;
/** The live shape the issue measured: ~17.5 KB of composed brief per participant row. */
const LIVE_BRIEF_BYTES = 17 * 1024;
/** The reach's own fixed shape — small, so a roster row's brief cannot be the reason a page cuts. */
const REACH_KEYS = ['bytes', 'exposure', 'seq'];
/** A marker no projection may ever carry by accident: it sits at the END of a one-line objective,
 * past the 160 B role head (#464 half 1), and names its own seat — so "this marker is absent"
 * proves a seat's composed brief text never rode the read, and "this OTHER seat's marker is
 * absent" proves a scoped read carried no peer's text. */
const MARKER = (seat) => `::464c-BRIEF-TAIL-${seat}::`;
const DEFAULT_OBJECTIVE_BYTES = 512;

/** One objective of `size` bytes that is ONE line (no newline): the role head (#464 half 1) is
 * bounded at 160 B, so the whole text lives on as the composed brief — which is exactly the load
 * this lane is about. The marker lands past the role bound by construction. */
const objective = (seat, size) => {
  const head = `Seat ${seat}: `;
  const marker = MARKER(seat);
  return `${head}${'x'.repeat(Math.max(1, size - head.length - marker.length))}${marker}`;
};

/** One physical checkout identity per seat — the 35-character `ws-<32 hex>` the binding records. */
const wsId = (index) => `ws-${String(index).padStart(2, '0').repeat(16)}`.slice(0, 35);

/** One attributed commit row as the runtime's fold reads it: the payload the projected git
 * wrapper's spool drain records (`worktree.commit_recorded`). The fixture pays the live row's
 * OTHER load too (the #464 commit tail), so the roster measured below is the live shape the
 * probe measured — not a fixture from which the expensive half was quietly removed. */
const commitPayload = (participantId, workspaceId, index) => ({
  swarmId: SWARM, participantId, workspaceId,
  sha: `${String(index).padStart(8, '0')}${'a'.repeat(32)}`,
  paths: [`impl/src/part-${index}.mjs`],
  at: new Date(Date.UTC(2026, 8, 18, 12, 0, index % 60)).toISOString(),
});

/** The light runtime harness (the issue464b fixture pattern): no adapter, no git. */
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue464c-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const runtime = new SwarmRuntime({
    store,
    coordinator: {
      list: () => workers,
      pausedTurns: () => [],
      liveWorkspaceHolders: () => [],
      // The binding's own durable workspace identity: a seat's row derives its checkout from it,
      // and the commit tail rides that workspace (`workspaceAttachment`, the 464b fixture seam).
      workspaceAttachment: (workerId) => {
        const index = workers.findIndex((candidate) => candidate.id === workerId);
        return index < 0 ? null : { workspaceId: wsId(index), holderCount: 1 };
      },
    },
    authorize: async () => {},
    prepareRun: async (request) => request,
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working' });
    },
    stopRun: async () => ({ state: 'closed' }),
  });
  t.after(() => runtime.close());

  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: SWARM, ...(command === 'view' ? {} : { idempotencyKey: `i464c:${++key}` }), ...args }, caller);
  /** The worker handle a participant's principal resolves through — the seat a test drives. */
  const workerOf = (participantId) => workers.find((row) => row.runId === store.swarm(SWARM).participants[participantId].runId);
  const asParticipant = (participantId) => workerPrincipal(workerOf(participantId).id);
  const seatName = (index) => (index === 0 ? 'alpha' : `p${index}`);
  const recruit = (index, size = DEFAULT_OBJECTIVE_BYTES, caller = owner) => call('recruit', {
    participantId: seatName(index), objective: objective(seatName(index), size), permissions: SWARM_PERMISSIONS,
  }, caller);
  const recordCommits = (index, count) => {
    for (let commit = 0; commit < count; commit += 1) {
      store.recordDriver('worktree.commit_recorded',
        commitPayload(seatName(index), wsId(index), commit), { actor: 'baton-runtime', key: `i464c:commit:${index}:${commit}` });
    }
  };
  return { directory, store, workers, runtime, call, workerOf, asParticipant, recruit, recordCommits, seatName };
}

/** The real runtime behind the real native bridge — the seam the probe measured through. The
 * bridge carries one JSON frame per direction, and its paging derivation measures the answer
 * MIRRORED (the MCP envelope counts the content twice); the live probe's page cut at ~24 of 39
 * rows of ~20 KB each. `commitsPerSeat` lets a fixture carry the live row's WHOLE load — the
 * ~17 KB composed brief beside the #464 commit tail — instead of only the half under test. */
async function linked(t, { seats = 1, objectiveBytes = DEFAULT_OBJECTIVE_BYTES, commitsPerSeat = 0, maxFrameBytes = WIRE_FRAME } = {}) {
  const f = fixture(t);
  await f.call('create', { purpose: 'A participant row carries the brief reach (#464)' });
  for (let index = 0; index < seats; index += 1) await f.recruit(index, objectiveBytes);
  for (let index = 0; index < seats; index += 1) f.recordCommits(index, commitsPerSeat);
  const bridge = createSwarmNativeBridge({
    dispatch: ({ command, args, principal, context }) => f.runtime.command(command, args, principal, context),
    maxFrameBytes,
  });
  t.after(async () => { await bridge.close(); });
  const runId = f.store.swarm(SWARM).participants.alpha.runId;
  const issued = await bridge.issue({ swarmId: SWARM, participantId: 'alpha', runId });
  const send = (command, args) => swarmBridgeCommand({ command, args }, { env: issued.env });
  return { ...f, bridge, issued, send, runId };
}

const rowOf = (view, participantId) => view.participants.find((row) => row.participantId === participantId);
/** Every join row, in ledger order — the durable record of what each seat was told. */
const joinRows = (store) => store.eventsView().filter((event) => event.kind === 'swarm.participant_joined');
const composedBrief = (store, participantId) => joinRows(store)
  .find((event) => event.payload?.participantId === participantId)?.payload?.brief ?? null;

/** A roster row's `brief`, asserted to BE the reach before its keys are read: at HEAD it is the
 * composed text string, and the difference should read as that — not as a string's character
 * indices. */
function assertReach(row, label) {
  assert.equal(typeof row.brief, 'object',
    `${label}: a roster row carries the reach object {bytes, seq, exposure}, never the composed text`);
  assert.deepEqual(Object.keys(row.brief).sort(), REACH_KEYS, `${label}: the reach is exactly {bytes, seq, exposure}`);
  return row.brief;
}

/** The reach of a row, in whichever home the projection put it: `brief` where the text did not
 * ride, `briefReach` beside the text where it did. */
const reachOf = (row) => (typeof row.brief === 'string' ? row.briefReach : row.brief);

// ── 464c-a: the roster carries the reach; the scoped read carries the text it measures ─────────

test('464c-a: a roster row\'s `brief` is the reach {bytes, seq, exposure}; the scoped read\'s is the text', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'The brief reach (#464)' });
  await f.recruit(0);
  const alpha = f.asParticipant('alpha');
  await f.recruit(1, DEFAULT_OBJECTIVE_BYTES, alpha);
  const joins = joinRows(f.store);
  const join = joins.find((event) => event.payload?.participantId === 'alpha');
  const composed = join.payload.brief;
  assert.ok(Buffer.byteLength(composed, 'utf8') > 0, 'the fixture really composed a brief (the ledger row holds it)');
  assert.ok(composed.includes(MARKER('alpha')), 'the fixture really carries the tail marker the roster must never show');

  const roster = await f.call('view', { projection: 'participants' });
  const row = rowOf(roster, 'alpha');
  assertReach(row, 'alpha');
  assert.equal(row.brief.bytes, Buffer.byteLength(composed, 'utf8'),
    'the reach names the length of the text the row did NOT carry');
  assert.equal(row.brief.seq, join.seq,
    'the reach names the swarm.participant_joined row that holds the text — the pointer, not a second copy');
  assert.ok(SWARM_BRIEF_EXPOSURE_CLASSES.includes(row.brief.exposure),
    `the class is one of the closed docs/46 §4.1 set: ${row.brief.exposure}`);
  assert.equal(Object.hasOwn(row, 'briefReach'), false,
    'the reach has ONE home per row (the fold mints briefBytes/briefRef; the projection composes the reach)');
  assert.equal(JSON.stringify(roster).includes(MARKER('alpha')), false,
    'no byte of the composed text rides the roster — a bridge page or a whole record cannot pay it either');
  assert.equal(JSON.stringify(roster).includes(MARKER('p1')), false, 'and no peer\'s text does either');

  const scoped = await f.call('view', { participantId: 'alpha' });
  const scopedRow = rowOf(scoped, 'alpha');
  assert.equal(scopedRow.brief, composed,
    'the participantId-scoped read carries the text whole — today\'s rule, unchanged');
  assert.equal(Buffer.byteLength(scopedRow.brief, 'utf8'), row.brief.bytes,
    'and its byte length is exactly the bytes the roster reach named');
  assert.deepEqual(scopedRow.briefReach, row.brief,
    'the reach rides BESIDE the text, the same object the roster row carries as `brief`');

  // A child's row in the same scoped read carries the reach — the withholding is the text only.
  const child = rowOf(scoped, 'p1');
  assertReach(child, 'p1');
  assert.equal(child.briefWithheld, true, 'withheld is said, not silently dropped');
  assert.equal(child.brief.bytes, Buffer.byteLength(composedBrief(f.store, 'p1'), 'utf8'),
    'and it measures the peer\'s own brief, not ours');
  assert.ok(JSON.stringify(scoped).includes(MARKER('alpha')), 'the scoped read really renders the scope\'s OWN text');
  assert.equal(JSON.stringify(scoped).includes(MARKER('p1')), false,
    'the scoped read carries no other seat\'s text either');
});

// ── 464c-b: ONE exposure derivation — the roster row's class is the scoped read's class ────────

test('464c-b: the roster class equals the scoped read\'s class for the root, a peer and the seat itself', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'One exposure derivation (#464)' });
  await f.recruit(0);   // alpha, top level
  await f.recruit(1);   // p1, top level — alpha's peer
  const alpha = f.asParticipant('alpha');
  await f.call('recruit', { participantId: 'leaf', objective: objective('leaf', DEFAULT_OBJECTIVE_BYTES),
    permissions: SWARM_PERMISSIONS }, alpha);

  const rosterClass = async (caller) =>
    reachOf(rowOf(await f.call('view', { projection: 'participants' }, caller), 'alpha')).exposure;
  const scopedClass = async (caller, seat) =>
    reachOf(rowOf(await f.call('view', { participantId: seat }, caller), 'alpha')).exposure;

  // The organizer (no seat): the recruiter of every seat — docs/46 §5 makes the root every
  // subtree's ancestor, so it stands in the delegation class to a top-level seat and to a child.
  assert.equal(await rosterClass(owner), 'subtree', 'the root stands in the delegation class');
  assert.equal(await scopedClass(owner, 'alpha'), 'subtree', 'and the scoped read answers the SAME class');

  // A peer: same swarm, no delegation edge, no shared checkout, no shared group (the fixture's p1
  // is top level, so it is NOT the seat's descendant — siblings are never `subtree`).
  const peer = f.asParticipant('p1');
  assert.equal(await rosterClass(peer), 'swarm', 'a peer stands in the swarm class');
  assert.equal(await scopedClass(peer, 'alpha'), 'swarm', 'and the scoped read answers the SAME class');

  // The seat itself, off its own roster read and off its own scoped read.
  assert.equal(await rosterClass(alpha), 'self', 'the seat reads itself as `self`');
  assert.equal(await scopedClass(alpha, 'alpha'), 'self', 'the scoped read applies the SAME class');

  // The delegation edge is real, from both ends: alpha's child is `subtree` to alpha.
  const leaf = f.asParticipant('leaf');
  assert.equal((await rosterClass(leaf)), 'subtree',
    'a delegating parent is an ancestor — the walk is parentId, never the roster');
  assert.equal(reachOf(rowOf(await f.call('view', { projection: 'participants' }, alpha), 'leaf')).exposure, 'subtree',
    'and the relation reads the same from the child\'s side');

  // The ladder's remaining classes derive from the fold's own rows — a shared roster and a
  // shared recorded checkout — and the stronger relation wins.
  await f.call('update', { event: 'swarm.group_updated', payload: { groupId: 'impl', members: ['alpha', 'p1'] } });
  assert.equal(await rosterClass(peer), 'group', 'a shared group roster reads as `group`');
  assert.equal(await scopedClass(peer, 'alpha'), 'group', 'and the scoped read answers the SAME class');
  await f.call('recruit', { participantId: 'twin', objective: objective('twin', DEFAULT_OBJECTIVE_BYTES),
    permissions: SWARM_PERMISSIONS, shareWorkspaceWith: 'alpha' });
  const twin = f.asParticipant('twin');
  assert.equal(reachOf(rowOf(await f.call('view', { projection: 'participants' }, twin), 'alpha')).exposure, 'checkout',
    'a seat sharing the recorded checkout reads as `checkout` — stronger than group');
});

// ── 464c-c: a 39-seat roster of live-size rows answers ONE frame through the bridge ────────────

test('464c-c: a 39-seat swarm whose briefs are the live ~17 KB answers its participants projection in ONE frame', async (t) => {
  // The LIVE row: the ~17 KB composed brief the probe measured, beside the #464 commit tail the
  // second half bounded. At HEAD this roster is 951 489 B of JSON before a single commit row —
  // plus ~14 KB of tail per seat — so the bridge's frame cut it and served the walk instead.
  const f = await linked(t, { seats: 39, objectiveBytes: LIVE_BRIEF_BYTES, commitsPerSeat: 200, maxFrameBytes: WIRE_FRAME });
  const joins = joinRows(f.store);
  assert.equal(joins.length, 39, 'the fixture really holds a 39-seat roster');
  const briefBytes = joins.map((event) => Buffer.byteLength(event.payload.brief, 'utf8'));
  assert.ok(Math.min(...briefBytes) >= LIVE_BRIEF_BYTES,
    `every seat's composed brief is at least the ${LIVE_BRIEF_BYTES} B the probe measured (min ${Math.min(...briefBytes)})`);
  // The measure the bridge PAGES by counts an answer twice (its own note: "the MCP envelope
  // mirrors it"), so the roster's brief text alone — which every row paid before this change —
  // is over the frame by the bridge's own arithmetic.
  assert.ok(2 * briefBytes.reduce((sum, bytes) => sum + bytes, 0) > WIRE_FRAME,
    'the roster\'s brief text, counted the way the bridge counts an answer, exceeds the frame — the measured load is really in this fixture');

  const answer = await f.send('swarm.view', { swarmId: SWARM, projection: 'participants' });
  assert.equal(answer.projection, 'participants');
  assert.equal(answer.participants.length, 39, 'every seat answers in the ONE frame');
  assert.equal(answer.page?.next ?? null, null,
    'no cursor: the roster did not have to be walked — a seat\'s first look answers every peer (#464 item 2)');
  assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, result: answer }), 'utf8') <= WIRE_FRAME,
    `and the answer fits the ${FRAME_LIMITS['wire.frame'].lane} frame it was measured against`);
  for (const row of answer.participants) {
    assertReach(row, row.participantId);
    assert.equal(row.workspace.commitsTotal, 200, `${row.participantId}: the live row load really rides this fixture`);
    assert.equal(row.workspace.commits.length, FRAME_LIMITS['view.workspace.commits'].value,
      `${row.participantId}: the #464 commit tail is carried beside the brief reach`);
  }
  assert.equal(JSON.stringify(answer).includes(MARKER('p38')), false, 'and no row carries the text back onto the page');
});

// ── 464c-d: the seat's own read still renders the text; no roster read carries it ──────────────

test('464c-d: the seat\'s own read renders its brief text, and its roster read carries the reach', async (t) => {
  const f = await linked(t, { seats: 3 });
  const composed = composedBrief(f.store, 'alpha');
  const peerBrief = composedBrief(f.store, 'p1');

  // The seat's own read, through the seat's OWN bridge token — the read the lane contract's (d)
  // protects (see the header note: `run.member.view` is a run-side episode read and never carried
  // a participant brief; this is the swarm seat's own member read).
  const mine = await f.send('swarm.view', { swarmId: SWARM, participantId: 'alpha' });
  const own = rowOf(mine, 'alpha');
  assert.equal(own.brief, composed, 'the seat\'s own read renders the brief text whole');
  assert.equal(own.briefReach.exposure, 'self', 'under the class its own relationship earns');
  assert.equal(own.briefReach.bytes, Buffer.byteLength(composed, 'utf8'));

  // The same token, unscoped: the roster it reads carries the reach — never the text.
  const roster = await f.send('swarm.view', { swarmId: SWARM, projection: 'participants' });
  const mineOnRoster = rowOf(roster, 'alpha');
  assertReach(mineOnRoster, 'alpha');
  assert.equal(JSON.stringify(roster).includes(MARKER('alpha')), false,
    'and no roster read carries the text at all — the reach is the only thing a roster pays');
  const peer = rowOf(roster, 'p1');
  assert.equal(peer.brief.bytes, Buffer.byteLength(peerBrief, 'utf8'),
    'a peer\'s reach measures the peer\'s own brief, so a reader can tell whose text it is pointing at');
});
