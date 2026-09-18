// Issue #469 (docs/46 §7 cost rule; the #465 breakdown's largest kind): a
// `swarm.operation_completed` row carried the seat's WHOLE objective three times — the measured
// `swarm_stop` row was 998 271 B, each copy 320 602 B, at `result.result.objective`,
// `result.result.planPreview.objective` and `result.result.planPreview.node.objective` — and 473
// such rows held 56 MB of the primary ledger's 180 MB parsed window. Every cold open replays each
// row and folds the projection it feeds.
//
// The objective is ONE durable fact: the `swarm.participant_joined` row the seat's join wrote,
// which the fold already mints as the participant row's `role` / `roleBytes` / `roleRef` (#464).
// The operation receipt now carries that REFERENCE and the objective's FIRST LINE — bounded by the
// same ONE `view.role.head` registry row the participant row's `role` is cut by — and never the
// text.
//
// Rows:
//   a  a stop receipt for a seat with a 300 KB objective records a row under a bound DERIVED from
//      the registry (the row's fixed fields + `view.role.head` + the reference pair's own
//      spelling), carrying `objectiveRef`/`objectiveBytes` with no copy of the text anywhere;
//   b  the CLI's `swarm stop` rendering and the view's seat row show the objective's FIRST LINE,
//      reached through the reference (the seat row's own `role`/`roleRef`), never the text;
//   c  a ledger row in the OLD shape — the text three times — still folds: the pin applies to NEW
//      writes, and replay never refuses history;
//   d  the driver row's schema names the reference pair and refuses to describe the objective.
//
// Red-first at HEAD (observed before the change, output recorded in the contribution): (a) the
// view carries the objective verbatim at all three spellings and the row measures ~300 KB over the
// derived bound; (b) the CLI's rendering prints the whole objective (there is no reference to
// resolve, and `objective` on the wrapped view IS the text); (c) is green at HEAD by construction
// (the OLD shape is what HEAD writes) and stays here as the pin that replay never refuses a row a
// previous build recorded; (d) there is no `swarm.operation_completed` schema at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { SWARM_DRIVER_EVENT_PAYLOAD_SCHEMAS } from '../src/swarm-event-schemas.mjs';
import { parseBatonCli, runBatonCli } from '../src/application-cli.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
// The ONE bound the objective's carried line draws (`view.role.head`, #464): the registry row the
// participant row's `role` — and so the receipt's `planPreview.objective` — is cut by.
const ROLE_HEAD = FRAME_LIMITS['view.role.head'];
// The objective the issue measured (320 602 B a copy): a 300 KB body the FIRST LINE introduces.
const OBJECTIVE_BYTES = 300 * 1024;
const BODY = 'objective body '.repeat(Math.ceil(OBJECTIVE_BYTES / 15)).slice(0, OBJECTIVE_BYTES);
const OBJECTIVE = `Seat: hold the operation row's budget (#469).\n${BODY}`;
const FIRST_LINE = OBJECTIVE.slice(0, OBJECTIVE.indexOf('\n'));

/** The run view a real `swarm.stop` receipt wraps (application.mjs `_buildView`): the objective is
 * spelled at `objective`, `planPreview.objective` and `planPreview.node.objective` — the three
 * copies the issue measured — beside the fixed fields a stop answers with. */
function runView() {
  return {
    schemaVersion: 1,
    runId: 'run-seat-big',
    objective: OBJECTIVE,
    resultIntent: 'change',
    phase: 'stopped',
    planPreview: {
      objective: OBJECTIVE,
      definitionOfDone: ['The stop settles the seat'],
      node: { key: 'work', objective: OBJECTIVE, pathScope: ['impl/src'] },
      profileDigest: 'a'.repeat(64),
      planDigest: 'b'.repeat(64),
    },
    stop: { state: 'stopped', receipt: { remainingCount: 0 } },
    nodes: [{ key: 'work', state: 'accepted' }],
  };
}

function fixture(t, { stopReceipt = () => runView() } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue469-'));
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
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working', paused: true, vendor: 'mock-session' });
    },
    stopRun: async (runId) => {
      workers.find((row) => row.runId === runId).status = 'dead';
      return stopReceipt();
    },
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(['view', 'watch'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }), ...args }, caller);
  const recruit = (participantId, objective) => call('recruit', { participantId, objective });
  return { directory, store, runtime, call, recruit };
}

/** The operation rows this deployment recorded for a stop, in ledger order. */
const stopRows = (store) => store.eventsView().filter((event) => event.kind === 'driver.recorded'
  && event.payload?.kind === 'swarm.operation_completed' && event.payload.command === 'swarm.stop');

const joinSeq = (store, participantId) => store.eventsView()
  .find((event) => event.kind === 'swarm.participant_joined'
    && event.payload?.participantId === participantId)?.seq ?? null;

/** The row's FIXED fields, as the bound's derivation measures them: the same payload with the
 * objective-derived bytes taken out — the reference pair and the ONE bounded line it carries. */
function fixedPart(payload) {
  const envelope = payload.result;
  const view = { ...envelope.result };
  const reference = { objectiveRef: view.objectiveRef, objectiveBytes: view.objectiveBytes };
  delete view.objectiveRef;
  delete view.objectiveBytes;
  view.planPreview = { ...view.planPreview, objective: '' };
  return { reference,
    bytes: Buffer.byteLength(JSON.stringify({ ...payload, result: { ...envelope, result: view } }), 'utf8') };
}

// ── 469-a: the row carries the reference, under a bound derived from the registry ───────────────

test('469-a: a stop receipt records the objective by reference, under the registry bound', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'The operation row budget (#469)' });
  await f.recruit('seat-big', OBJECTIVE);
  const answer = await f.call('stop', { participantId: 'seat-big', reason: 'Session no longer needed' });

  const row = stopRows(f.store).at(-1) ?? null;
  assert.ok(row, 'the stop recorded its operation row');
  const payload = row.payload;
  // The issue's own path: body.result.result.objective.
  const view = payload.result.result;
  const seat = f.store.swarm('baton').participants['seat-big'];
  const seq = joinSeq(f.store, 'seat-big');

  assert.deepEqual(view.objectiveRef, { kind: 'swarm.participant_joined', seq },
    'the row names the seat\'s join row — the same `roleRef` the participant row mints (#464)');
  assert.equal(view.objectiveBytes, seat.roleBytes,
    'objectiveBytes is the length the row did NOT carry, the same pair `roleBytes` reports');
  assert.equal(view.objective, undefined,
    'the wrapped receipt carries no objective text at all: the reference is the only restatement');

  assert.equal(view.planPreview.objective, seat.role,
    'planPreview carries the objective\'s FIRST LINE — the line the participant row carries as `role`');
  assert.equal(view.planPreview.objective, FIRST_LINE, 'the first line, not a second derivation of it');
  assert.ok(Buffer.byteLength(view.planPreview.objective, 'utf8') <= ROLE_HEAD.value,
    `the carried line respects ${ROLE_HEAD.lane} (${ROLE_HEAD.value} ${ROLE_HEAD.unit})`);
  assert.equal(view.planPreview.node.key, 'work', 'the node id stays');
  assert.equal(view.planPreview.node.objective, undefined,
    'and the node\'s own copy of the objective does not (#469 item 1)');

  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes(BODY), false,
    'no copy of the objective body survives anywhere in the row');
  assert.equal(serialized.includes(OBJECTIVE), false, 'and never the whole text');

  // The bound's derivation, stated: the row's FIXED fields (measured on the same payload with the
  // objective-derived bytes removed) plus the ONE bounded line the registry allows
  // (`view.role.head`) plus the reference pair's own JSON spelling — never a hand-typed ceiling.
  const fixed = fixedPart(payload);
  const referenceBytes = Buffer.byteLength(JSON.stringify(fixed.reference), 'utf8');
  const bound = fixed.bytes + ROLE_HEAD.value + referenceBytes;
  const bytes = Buffer.byteLength(serialized, 'utf8');
  assert.ok(bytes <= bound,
    `the row measures ${bytes} B against a ${bound} B bound: fixed ${fixed.bytes} B + ${ROLE_HEAD.lane} ${ROLE_HEAD.value} B + reference ${referenceBytes} B (the 300 KB objective is reached through the join row, never restated)`);
  assert.ok(bytes < OBJECTIVE_BYTES,
    `the row is smaller than ONE copy of the objective it points at (${bytes} B against ${OBJECTIVE_BYTES} B)`);

  // The live answer the caller reads is the same referenced receipt — a root never receives the
  // 300 KB the row no longer carries either.
  assert.deepEqual(answer.result.objectiveRef, view.objectiveRef,
    'the stop ANSWER carries the reference too, not a second copy of the text');
  assert.equal(answer.result.objective, undefined, 'and the view\'s own objective field is gone');
  assert.equal(answer.result.planPreview.objective, seat.role, 'the answer shows the same bounded line');
  assert.equal(JSON.stringify(answer).includes(BODY), false, 'the whole answer carries no copy of the body');
});

// ── 469-b: the CLI rendering and the view's seat row reach the line by the reference ────────────

test('469-b: the CLI stop rendering shows the first line, reached by the reference', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'The CLI renders the line, not the text (#469)' });
  await f.recruit('seat-big', OBJECTIVE);
  const answer = await f.call('stop', { participantId: 'seat-big', reason: 'Session no longer needed' });
  const seat = f.store.swarm('baton').participants['seat-big'];
  const seq = joinSeq(f.store, 'seat-big');

  // The CLI's own leg: `baton swarm stop <swarm> <participant> <reason>`, answered with the receipt
  // the resident just served.
  const parsed = parseBatonCli(['swarm', 'stop', 'baton', 'seat-big', 'Session no longer needed',
    '--idempotency-key', 'stop-seat-big']);
  assert.equal(parsed.name, 'swarm.stop');
  const calls = [];
  const rendered = await runBatonCli(parsed, {
    async command(name, args, idempotencyKey) {
      calls.push({ name, args, idempotencyKey });
      return answer;
    },
  });
  assert.deepEqual(calls.map((call) => call.name), ['swarm.stop'],
    'the rendering resolves from the answer the stop already served — no second read');
  assert.equal(rendered.result.objective, seat.role,
    'the CLI prints the objective\'s FIRST LINE: the line the participant row the reference names carries');
  assert.equal(rendered.result.objective, FIRST_LINE);
  assert.deepEqual(rendered.result.objectiveRef, { kind: 'swarm.participant_joined', seq },
    'beside the reference that reaches the whole text');
  assert.equal(JSON.stringify(rendered).includes(BODY), false,
    'the printed answer carries no copy of the objective body');

  // The view's own rows: the seat row carries the line and the reference, and the operation row
  // names the SAME reference — a reader joins them by seq.
  const row = stopRows(f.store).at(-1).payload.result.result;
  assert.deepEqual(row.objectiveRef, seat.roleRef,
    'the operation row and the seat row agree on ONE reference (#464\'s derivation)');
  const participants = (await f.call('view', { projection: 'participants' })).participants;
  const printed = participants.find((participant) => participant.participantId === 'seat-big') ?? null;
  assert.ok(printed, 'the roster still carries the settled seat');
  assert.equal(printed.role, FIRST_LINE, 'whose row carries the objective\'s first line');
  assert.deepEqual(printed.roleRef, row.objectiveRef, 'and the same reference the operation row names');
  assert.equal(printed.roleBytes, Buffer.byteLength(OBJECTIVE, 'utf8'),
    'roleBytes reports the length the row did not carry');
});

// ── 469-c: an old row still folds ───────────────────────────────────────────────────────────────

test('469-c: a ledger row in the OLD shape still folds — the pin is on new writes', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Old rows still fold (#469)' });
  await f.recruit('seat-old', OBJECTIVE);
  // A row recorded BEFORE #469: the same text three times, written straight through the store the
  // way the pre-#469 runtime composed it.
  f.store.recordDriver('swarm.operation_completed', {
    swarmId: 'baton', command: 'swarm.stop', operationKey: 'swarm-operation:legacy-469',
    participantId: 'seat-old',
    result: { participantId: 'seat-old', result: runView(), leftReason: 'stopped', writes: [] },
  }, { actor: 'owner', key: 'swarm-operation:legacy-469:completed' });

  // Reopening on that ledger replays it: the fold consumes the history without refusing, and the
  // old row keeps the text it recorded — nothing is rewritten in the past.
  const reopened = new CoordinationStore(f.directory);
  const runtime = new SwarmRuntime({
    store: reopened,
    coordinator: { list: () => [], pausedTurns: () => [], routeCards: () => [] },
    authorize: async () => {}, prepareRun: async () => {}, startRun: async () => {},
    stopRun: async () => ({ state: 'closed' }),
  });
  try {
    const view = await runtime.command('swarm.view', { swarmId: 'baton' }, owner);
    assert.equal(view.status, 'open', 'the replay served the swarm the old row was recorded in');
    const seatRow = (view.participants ?? []).find((participant) => participant.participantId === 'seat-old') ?? null;
    assert.ok(seatRow, 'and the seat the old row names');
    assert.equal(seatRow.role, FIRST_LINE, 'whose row carries the objective\'s first line (#464)');
    const legacy = stopRows(reopened).at(-1) ?? null;
    assert.ok(legacy, 'the old operation row is still on the ledger');
    assert.equal(legacy.payload.result.result.objective, OBJECTIVE,
      'and it still carries the text it was recorded with: the pin applies to NEW writes, never to history');
  } finally {
    runtime.close();
  }
});

// ── 469-d: the driver row's schema names the reference, never the objective ─────────────────────

test('469-d: the operation row schema pins the reference and refuses the objective field', () => {
  const schema = SWARM_DRIVER_EVENT_PAYLOAD_SCHEMAS['swarm.operation_completed'] ?? null;
  assert.ok(schema, 'the runtime\'s own operation receipt is described by the schema table');
  for (const field of ['objectiveRef', 'objectiveBytes']) {
    assert.ok(Object.hasOwn(schema.fields, field), `the schema names ${field}`);
    assert.ok(Object.hasOwn(schema.example, field), `and its example carries ${field}`);
  }
  assert.equal(Object.hasOwn(schema.fields, 'objective'), false,
    'the objective itself is not a field the row can carry: the old shape is refused, not described');
  const reference = schema.fields.objectiveRef;
  assert.match(JSON.stringify(reference), /swarm\.participant_joined/u,
    'the reference names the join row it resolves from');
  assert.match(schema.example.objectiveRef.kind, /^swarm\.participant_joined$/u);
  assert.equal(JSON.stringify(schema.example).includes(BODY), false,
    'no example copies an objective');
});
