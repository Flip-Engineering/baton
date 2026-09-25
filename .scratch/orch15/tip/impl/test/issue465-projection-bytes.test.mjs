// Issue #465 — the projection checkpoint's bytes are MEASURED by family, and the largest family
// the body carries is bounded by the rule the views already follow (#464: the fold keeps facts,
// not renderings).
//
// OBSERVED LIVE (clone, 51 327 rows / 107 535 399-byte ledger, 2026-09-18): the checkpoint rewrite
// at open measured 288 671 406 bytes — 2.7× the ledger it summarises — and the release at the next
// stop skipped (`release_checkpoint_unbounded`; cost bound 16 777 216), so every open paid a
// 289 MB parse. The issue asked for a measured breakdown before anyone acted on a guess. Measured
// on that checkpoint's own bytes through the SAME serializer the cost gate uses (v8, one entry per
// payload family, stream attribution):
//
//   _events        180 159 961 B (62.4% of the projection)   _byKey      181 829 690 B standalone
//   _webCommands    39 206 146 B (13.6%)                     _tasks       12 141 185 B (4.2%)
//   _swarms         18 041 949 B (6.2%)                      _plans       12 071 920 B (4.2%)
//   _goals          11 971 429 B (4.1%)                      _evidence     6 520 056 B (2.3%)
//   _spills          5 845 234 B (2.0%)                      _byKey's STREAM cost: 2 068 144 B
//
// `_swarms` is the body's largest RENDERING family: 17 421 312 B of its 18.04 MB is the per-seat
// rows, and 99.3% of those rows (17 303 682 B) is ONE field — the composed recruit brief, byte-
// identical in all 114 rows to the `swarm.participant_joined` payload that holds it. The projection
// is 101 payload keys long, and `_byKey`'s standalone 181.83 MB is the trap the breakdown exists to
// expose: it re-references the events `_events` already wrote (179.76 MB of the 204.03 MB total
// sharing), so a reader without `sharedBytes` would bound the wrong family.
//
// Rows (red-first at HEAD, observed before the change):
//   a  every checkpoint outcome that reached a measurement carries `bytesByFamily` — one entry per
//      family of the payload the cost gate judged, each a measurement under the same serializer —
//      and the breakdown closes EXACTLY on the measured bytes (Σ families + baseline − shared);
//   b  a 36-seat fixture (17 KB briefs, 200 commits per seat) serializes its participants family
//      inside the bound the registry rows derive, and no seat's brief text rides the projection:
//      `briefBytes` reports the length and `briefRef` names the ledger row that holds it (#464's
//      rule, third half). HEAD measures ~630 KB against a 147 456-byte bound;
//   c  a checkpoint written by that bounded projection reconstructs the same view as replay — the
//      store served by the cache and the store served by the ledger alone agree (the #290 rule),
//      and the live fold row still renders the whole brief (the projection is what carries the
//      reference).
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialize } from 'node:v8';

import { CoordinationStore } from '../src/index.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const actor = 'test:issue465';
const CHECKPOINT = 'projection.checkpoint';
const SEATS = 36;
const COMMITS_PER_SEAT = 200;
const BRIEF_BYTES = 17 * 1024;
// The ONE registry row the participants family's bound derives from: `view.attention_text.bytes`
// is the registry's own ceiling for one row of a frame's text — the same row the checkpoint's own
// cost ceiling (`checkpoint.projection_bytes = view.wake_replay.items × view.attention_text.bytes`)
// is derived from. A participant row IS one row of the projection, so a roster of N seats may
// serialize at most N × that row: no hand-typed ceiling, and no separate declaration of it.
const ROW_TEXT = FRAME_LIMITS['view.attention_text.bytes'].value;
const FAMILY_BOUND = SEATS * ROW_TEXT;

/** The composer's objective: what the recruiter writes, and the text the composed brief carries. */
const objective = (index) => `Seat ${index}: hold the projection's participant budget (#465).\n${'x'.repeat(BRIEF_BYTES - 64)}`;

function directoryFor(t, label) {
  const directory = mkdtempSync(join(tmpdir(), `baton-issue465-${label}-`));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** The light runtime harness (the issue464 fixture pattern): no adapter, no git, no run. */
function fixture(t, label) {
  const directory = directoryFor(t, label);
  const store = new CoordinationStore(directory, { checkpointInterval: 100_000 });
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    routeCards: () => [],
    guideParticipant: async () => ({ ok: true }),
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({
        id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId,
        status: 'working', paused: true, vendor: 'mock-session',
      });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(command === 'view' ? {} : { idempotencyKey: `request-${++key}` }), ...args }, caller);
  return { directory, store, runtime, call };
}

/** Every participant row the checkpoint BODY carries, across the swarms of one swarm family. */
function bodyParticipants(payload) {
  const rows = [];
  for (const swarm of payload._swarms.values()) {
    for (const row of Object.values(swarm.participants)) rows.push(row);
  }
  return rows;
}

// ── 465-a: the breakdown rides the outcome and closes exactly on the measured bytes ─────────────

test('465-a: a checkpoint row carries the projection\'s bytes by family, closing on the measured bytes', (t) => {
  const directory = directoryFor(t, 'breakdown');
  const store = new CoordinationStore(directory, { checkpointInterval: 100_000 });
  for (let index = 0; index < 24; index += 1) {
    store.recordDriver('issue465.fixture', { index, body: 'y'.repeat(2_048) }, { actor, key: `issue465:a:${index}` });
  }
  store.releaseWriterLease({ requireOwned: true });

  const release = store.checkpointReleaseState();
  assert.equal(release?.state, 'written', 'the release wrote the checkpoint');
  assert.ok(Number.isSafeInteger(release.bytes) && release.bytes > 0);
  assert.ok(release.bytesByFamily && typeof release.bytesByFamily === 'object',
    'land the breakdown: the row names the bytes of every family it measured, so the next reader does not guess (#465 item 1)');

  // The families are the payload's OWN keys — the same object the cost gate serialized — never a
  // hand-typed list beside it.
  const payload = store._projectionCheckpointPayload();
  const families = Object.keys(payload);
  assert.deepEqual(Object.keys(release.bytesByFamily).sort(), [...families].sort(),
    'one entry per family of the payload the gate judged');
  for (const family of families) {
    assert.equal(release.bytesByFamily[family], serialize(payload[family]).byteLength,
      `${family} carries its own measured bytes, under the same serializer the ceiling is applied to`);
  }
  assert.equal(release.bytes, serialize(payload).byteLength,
    'the measured bytes ARE the projection these families break down');
  const summed = families.reduce((total, family) => total + release.bytesByFamily[family], 0);
  assert.equal(summed + release.projectionBaselineBytes - release.sharedBytes, release.bytes,
    'the breakdown closes exactly on the measured bytes: Σ families + baseline − shared === bytes');
  assert.ok(release.projectionBaselineBytes > 0, 'the framing the body pays for its own key set is measured, not assumed');
  assert.ok(release.sharedBytes >= 0, 'a family that re-references an earlier family\'s objects is reported, never hidden');
});

// ── 465-b: the participants family is bounded by the registry rows, not by the briefs ───────────

test('465-b: a 36-seat fixture serializes its participants family inside its derived bound', async (t) => {
  const f = fixture(t, 'participants');
  await f.call('create', { purpose: 'The projection participants budget (#465)' });
  for (let seat = 0; seat < SEATS; seat += 1) {
    await f.call('recruit', { participantId: `seat-${seat}`, objective: objective(seat) });
  }
  // 200 commit attributions per seat: the ledger rows the VIEW pages through
  // `view.workspace.commits` (#464b) and the activity a real roster carries. They ride the view
  // row and the ledger; what the checkpoint pays for is the projection's participant rows, which
  // is what the row below measures.
  for (let seat = 0; seat < SEATS; seat += 1) {
    for (let commit = 0; commit < COMMITS_PER_SEAT; commit += 1) {
      f.store.recordDriver('worktree.commit_recorded', {
        swarmId: 'baton', participantId: `seat-${seat}`, workspaceId: `ws-${seat}`,
        sha: `${seat.toString(16).padStart(2, '0')}${commit.toString(16).padStart(38, '0')}`,
        at: '2026-09-18T12:00:00.000Z', paths: [],
      }, { actor, key: `issue465:commit:${seat}:${commit}` });
    }
  }

  const rows = bodyParticipants(f.store._projectionCheckpointPayload());
  assert.equal(rows.length, SEATS, 'every recruited seat is on the projection');
  const measured = rows.reduce((total, row) => total + serialize(row).byteLength, 0);
  assert.ok(measured < FAMILY_BOUND,
    `the participants family is bounded by the registry row a projection row's text draws (${SEATS} seats × `
    + `view.attention_text.bytes ${ROW_TEXT} = ${FAMILY_BOUND}): measured ${measured}`);

  // The reference, not the copy: the brief lives on the ledger row the row names.
  const seat = rows.find((row) => row.participantId === 'seat-0');
  assert.equal(seat.brief, null, 'no seat\'s composed brief text rides the projection');
  const join = f.store.eventsView().find((event) => event.kind === 'swarm.participant_joined'
    && event.payload.participantId === 'seat-0');
  assert.ok(join, 'the join row is on the ledger');
  assert.equal(seat.briefBytes, Buffer.byteLength(join.payload.brief, 'utf8'),
    'briefBytes reports the length the projection did not carry');
  assert.deepEqual(seat.briefRef, { kind: 'swarm.participant_joined', seq: join.seq },
    'briefRef names the ledger row that holds the whole text — the reach, never a second copy');
  assert.ok(join.payload.brief.length > BRIEF_BYTES,
    `the ledger row still carries the whole brief (${join.payload.brief.length} chars), so nothing is lost, only pointed at`);
});

// ── 465-c: the bounded projection reconstructs the same view as replay ──────────────────────────

test('465-c: a checkpoint written by the bounded projection reconstructs the replay view', async (t) => {
  const f = fixture(t, 'shape');
  await f.call('create', { purpose: 'The bounded projection reconstructs (#465)' });
  for (let seat = 0; seat < 6; seat += 1) {
    await f.call('recruit', { participantId: `seat-${seat}`, objective: objective(seat) });
  }
  f.store.releaseWriterLease({ requireOwned: true });
  assert.equal(f.store.checkpointReleaseState()?.state, 'written', 'the release wrote the checkpoint');

  const servedDirectory = `${f.directory}-served`;
  const replayDirectory = `${f.directory}-replay`;
  t.after(() => {
    rmSync(servedDirectory, { recursive: true, force: true });
    rmSync(replayDirectory, { recursive: true, force: true });
  });
  cpSync(f.directory, servedDirectory, { recursive: true });
  cpSync(f.directory, replayDirectory, { recursive: true });
  unlinkSync(join(replayDirectory, CHECKPOINT));

  const served = new CoordinationStore(servedDirectory);
  const replay = new CoordinationStore(replayDirectory);
  assert.equal(served.startupStatus().checkpoint, 'valid', 'the first open is served by the cache it found');
  assert.equal(replay.startupStatus().checkpoint, 'absent', 'the second open has no cache: it replays the ledger');
  assert.deepEqual(served.swarm('baton'), replay.swarm('baton'),
    'the checkpoint serves the SAME view a full replay builds (the #290 shape rule)');

  // The bound is the projection's, not the view's: the fold row the live view reads still renders
  // the whole brief, and the projection carries the reference to the row that holds it.
  const seat = served.swarm('baton').participants['seat-0'];
  const servedRow = bodyParticipants(served._projectionCheckpointPayload())
    .find((row) => row.participantId === 'seat-0');
  assert.equal(typeof seat.brief, 'string', 'the live fold row still renders the whole brief');
  assert.equal(servedRow.brief, null, 'while the projection carries the reference');
  assert.equal(servedRow.briefBytes, Buffer.byteLength(seat.brief, 'utf8'),
    'and the reference reports exactly the length the projection did not carry');
});
