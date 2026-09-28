// Issue #433, landed (this file was the red-before pin `issue433-contributions-projection-red`):
// the contributions projection with its review state, the bounded watch's multi-wake frame, and
// the `unreviewed_contribution` attention row — as specified by docs/46-swarm-visibility.md §2 and
// §3.
//
// What the issue observed (2026-09-18): the root's bounded watch answered its FIRST wake and
// exited, a seat recorded its contribution three minutes later while no watch was armed, the root
// re-armed PAST it and never saw it, and the seat's own view carried no "unreviewed contribution"
// signal — the root found it 25 minutes later by grepping the ledger. Each row below pins one half
// of the fix:
//   a  the contributions projection carries `reviewState` from the ONE derivation (derived, never
//      stored: a later review re-derives the state on the next read);
//   b  the bounded watch carries EVERY admitted row since `afterSeq` — the wake frame holds no
//      byte bound (#627), so `pendingSince` is always null and `matchedSeq` is the LAST row;
//   b2 a frame whose rows alone exceed the ceiling the bridge enforced until #627 still carries
//      all of them, and re-arming at `matchedSeq` finds nothing left behind it (no gap, no
//      duplicate);
//   c  the `unreviewed_contribution` attention row appears on the AUTHOR after one recruit-brief
//      cadence and clears on a settling review;
//   d  the whole contributions read over the web bridge reproduces every contribution row in ONE
//      answer — no gap, no duplicate;
//   e  the CLI's bounded leg under `--wake-class contribution_recorded` answers a frame whose
//      `events` carries both contributions, `matchedSeq` the second;
//   f  a spent bounded watch answers an EMPTY frame: events [], matchedSeq null, pendingSince null;
//   g  the contributions projection spawns no git at all — the read path rule of docs/46 §7.
//
// Fixtures: the light SwarmRuntime harness (swarm-runtime.test.mjs) for the rows that need no
// transport; the real runtime behind WebNorthbound for the web-bridge and CLI rows; the same
// PATH-shim git instrument issue438-view-no-spawn uses for the no-spawn row (the spy is the
// OS-level spawn, so it cannot be fooled by a second authority).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APPLICATION_COMMAND_DEFINITIONS,
  CoordinationStore,
  WebNorthbound,
} from '../src/index.mjs';
import {
  SWARM_REVIEW_STATES,
  SwarmRuntime,
  contributionLedgerRows,
  swarmContributionReviewState,
} from '../src/swarm-runtime.mjs';
import { RuntimeIsolation } from '../src/runtime-isolation.mjs';
import { parseBatonCli, watchSwarmFiltered } from '../src/application-cli.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const principal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });
const WEB_REPO = 'repo-a';
const WEB_ORIGIN = 'https://control.example.test';

/** The light harness every non-transport row shares: no adapter, no git, no run. A `clock` may be
 * injected so a row can record two contributions exactly one second apart (issue #433's premise)
 * without spending that second. */
function fixture(t, { clock = null } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue433-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = clock === null ? new CoordinationStore(directory) : new CoordinationStore(directory, { clock });
  const workers = [];
  const starts = [];
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
      starts.push(request);
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working', paused: true, vendor: 'mock-session' });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(['view', 'watch'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }), ...args }, caller);
  const recruit = (participantId, permissions) => call('recruit', {
    participantId, objective: `Continue working as ${participantId}`, ...(permissions ? { permissions } : {}),
  });
  return { directory, store, runtime, workers, starts, call, recruit };
}

// ── 433-a: the contributions projection carries reviewState from the ONE derivation ────────────

test('433-a: the contributions projection carries reviewState from the ONE derivation', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Review visibility (#433)' });
  await f.recruit('builder');
  await f.recruit('reviewer', ['read', 'review', 'communicate']);
  const builder = principal('w-1');
  const reviewer = principal('w-2');
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'c1', participantId: 'builder', body: 'First slice.',
  } }, builder);
  const states = async () => {
    const projection = await f.call('view', { projection: 'contributions' });
    const full = await f.call('view');
    const row = (projection.contributions ?? []).find((entry) => entry.contributionId === 'c1');
    const whole = (full.contributions ?? []).find((entry) => entry.contributionId === 'c1');
    assert.ok(row, 'the contributions projection lists every recorded contribution (docs/46 §2)');
    assert.ok(whole, 'the whole record carries the same contribution row');
    assert.equal(row.reviewState, whole.reviewState,
      'the projection and the whole record read the SAME derivation — one fact, never two');
    assert.ok(SWARM_REVIEW_STATES.includes(row.reviewState),
      `reviewState is one of the closed set ${SWARM_REVIEW_STATES.join(' | ')} (docs/46 §2.1)`);
    return row.reviewState;
  };
  assert.equal(await states(), 'unreviewed',
    'land reviewState on every contribution row: no settling review reads unreviewed (docs/46 §2.1)');
  // A comment settles nothing: the row stays unreviewed until a decision lands.
  await f.call('update', { event: 'swarm.contribution_reviewed', payload: {
    contributionId: 'c1', decision: 'comment', reason: 'Reading it now.',
  } }, reviewer);
  assert.equal(await states(), 'unreviewed', 'a comment never settles (docs/46 §2.1)');
  await f.call('update', { event: 'swarm.contribution_reviewed', payload: {
    contributionId: 'c1', decision: 'accept', reason: 'Looks right.',
  } }, reviewer);
  assert.equal(await states(), 'accepted',
    'land reviewState: an unrevoked accept reads accepted (the _acceptedContribution reading, docs/46 §2.1)');
  await f.call('update', { event: 'swarm.contribution_reviewed', payload: {
    contributionId: 'c1', decision: 'reject', reason: 'Changed my mind.',
  } }, reviewer);
  assert.equal(await states(), 'rejected',
    'land reviewState: the LATEST settling review wins — a later reject reads rejected (docs/46 §2.1)');
  await f.call('update', { event: 'swarm.contribution_reviewed', payload: {
    contributionId: 'c1', decision: 'accept', reason: 'Addressed.',
  } }, reviewer);
  assert.equal(await states(), 'accepted',
    'land reviewState: a still-later accept re-derives accepted — derived, never stored (docs/46 §2.1)');
  // ONE derivation: the exported reader every surface shares agrees with the rows above, and the
  // completion evidence `_acceptedContribution` (which reads `accepted`) rides the same function.
  const swarm = f.store.swarm('baton');
  assert.deepEqual(swarmContributionReviewState(swarm.reviews.c1), 'accepted',
    'swarmContributionReviewState IS the derivation the rows read');
  assert.deepEqual(contributionLedgerRows(swarm).map((row) => [row.contributionId, row.reviewState]),
    [['c1', 'accepted']], 'run.contributions.read derives the same state from the same rows');
  assert.equal(f.runtime._acceptedContribution(swarm, 'c1'), true,
    'the completion evidence reads accepted through the ONE derivation — never a second reading');
});

// ── 433-b: every wake row since afterSeq rides the answer ───────────────────────────────────────

test('433-b: the bounded watch carries EVERY wake row since afterSeq', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'No lost wakes (#433)' });
  await f.recruit('alpha');
  const alpha = principal('w-1');
  const before = (await f.call('view', { projection: 'outline' })).cursor;
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'c1', participantId: 'alpha', body: 'One.',
  } }, alpha);
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'c2', participantId: 'alpha', body: 'Two.',
  } }, alpha);
  const wake = (await f.call('watch', { afterSeq: before, timeoutMs: 5000 })).watch;
  assert.equal(wake.reason, 'event');
  assert.ok(Array.isArray(wake.events),
    'land watch.events: every swarm-relevant wake row at seq > afterSeq, in seq order — not only the first (docs/46 §3.1)');
  const contributions = wake.events.filter((row) => row.kind === 'swarm.contribution_recorded');
  assert.equal(contributions.length, 2,
    'land watch.events: both contributions recorded between wakes are carried — nothing is lost between a watch return and the next --after-seq re-arm (docs/46 §3)');
  assert.ok(contributions[0].seq < contributions[1].seq, 'watch.events read in ledger order (docs/46 §3.1)');
  assert.deepEqual(wake.event, wake.events[0],
    'watch.event keeps its meaning for one release: the FIRST row of the frame (docs/46 §3.4)');
  assert.equal(wake.matchedSeq, wake.events.at(-1).seq,
    'land matchedSeq as the LAST carried row: re-arming with --after-seq matchedSeq loses nothing (docs/46 §3.3)');
  assert.equal(wake.pendingSince, null,
    'land pendingSince: docs/46 §3.2 read it as the first row a frame bound could not carry; the frame holds no bound now (#627), so it is always null');
});

// ── 433-b2: a frame larger than the retired bound still carries every admitted row ─────────────

test('433-b2: every admitted row rides one answer, and pendingSince stays null', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'A frame carries every admitted row (#433)' });
  const before = (await f.call('view', { projection: 'outline' })).cursor;
  // Admission rows whose scope text alone exceeds the ceiling the bridge enforced until #627: the
  // frame this row reads is the size that bound used to cut.
  const TOTAL = 120;
  const scope = Array.from({ length: 500 }, (_, index) => `impl/src/lane-${index}/**/*.mjs`);
  for (let index = 0; index < TOTAL; index += 1) {
    await f.store.recordSwarm('swarm.participant_joined',
      { swarmId: 'baton', participantId: `seat-${index}`, scope },
      { actor: owner.actor, key: `433:join:${index}` });
  }
  const frame = (await f.call('watch', { afterSeq: before, timeoutMs: 5000 })).watch;
  assert.equal(frame.reason, 'event');
  assert.equal(frame.events.length, TOTAL,
    'every admitted row since afterSeq rides the one frame — the answer holds no byte bound (#627)');
  assert.deepEqual(frame.events.map((row) => row.seq),
    Array.from({ length: TOTAL }, (_, index) => before + 1 + index),
    'the carried rows are the whole admitted run, in ledger order, with no gap');
  assert.equal(frame.matchedSeq, frame.events.at(-1).seq,
    'matchedSeq is the LAST carried row, so the caller resumes exactly where the frame stopped');
  assert.equal(frame.pendingSince, null,
    'pendingSince is always null: nothing is left behind the answer for a caller to come back for');
  const rest = (await f.call('watch', { afterSeq: frame.matchedSeq, timeoutMs: 50 })).watch;
  assert.deepEqual(rest.events, [],
    're-arming at matchedSeq finds nothing: the whole admitted run was already carried');
  assert.equal(rest.pendingSince, null);
});

// ── 433-c: the unreviewed_contribution attention row ──────────────────────────────────────────

test('433-c: an unreviewed_contribution attention row after one recruit-brief cadence', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Unreviewed work pages (#433)' });
  await f.recruit('builder');
  await f.recruit('reviewer', ['read', 'review', 'communicate']);
  const builder = principal('w-1');
  const reviewer = principal('w-2');
  const attentionRows = async (projection = 'attention') => {
    const view = await f.call('view', { projection });
    const rows = Array.isArray(view.attention) ? view.attention : view.attention?.rows;
    return rows ?? [];
  };
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'c1', participantId: 'builder', body: 'Waiting for review.',
  } }, builder);
  const contributionSeq = f.store.swarm('baton').contributions.c1.seq;
  assert.equal((await attentionRows()).some((row) => row.kind === 'unreviewed_contribution'), false,
    'no cadence has crossed the contribution yet: a brief composed after it is what makes it page (docs/46 §2.3 rule 1)');
  // The cadence without a clock: a recruit brief composed AFTER the contribution (the join's seq
  // crosses it) while reviewState is still unreviewed (docs/46 §2.3).
  await f.recruit('latecomer');
  const rows = await attentionRows();
  const row = rows.find((entry) => entry.kind === 'unreviewed_contribution' && entry.contributionId === 'c1');
  assert.ok(row,
    'land the unreviewed_contribution attention row on the author once a recruit-brief cadence has crossed the contribution (docs/46 §2.3)');
  assert.equal(row.participantId, 'builder',
    'the row attaches to the AUTHOR — the seat reading paused is the seat that gets named (docs/46 §2.3 rule 2)');
  assert.equal(row.seq, contributionSeq, 'the row names the contribution\'s own ledger seq');
  assert.equal(typeof row.waitingSince, 'string', 'the row names when the wait began (its recorded ts)');
  assert.ok(row.cadence && row.cadence.crossedBy === 'swarm.participant_joined' && Number.isSafeInteger(row.cadence.seq),
    'the row names the join that crossed the cadence — derived from rows, never from elapsed time (docs/46 §2.3 rule 1, #163)');
  assert.ok(row.cadence.seq > row.seq, 'the crossing join is LATER than the contribution');
  assert.deepEqual(row.next, { command: 'swarm.view', swarmId: 'baton', participantId: 'builder', contributionId: 'c1' },
    'the row carries the act that settles it (docs/46 §2.3)');
  // The row is derived, never stored: a settling review clears it on the next read.
  await f.call('update', { event: 'swarm.contribution_reviewed', payload: {
    contributionId: 'c1', decision: 'accept',
  } }, reviewer);
  assert.equal((await attentionRows()).some((entry) => entry.kind === 'unreviewed_contribution' && entry.contributionId === 'c1'), false,
    'a settling review clears the derived row on the next view — nothing to retract (docs/46 §2.3 rule 3)');
  // A reject settles it too: the row is about an UNREVIEWED contribution, not about an unaccepted one.
  await f.call('update', { event: 'swarm.contribution_reviewed', payload: {
    contributionId: 'c1', decision: 'reject',
  } }, reviewer);
  assert.equal((await attentionRows()).some((entry) => entry.kind === 'unreviewed_contribution' && entry.contributionId === 'c1'), false,
    'the latest settling review decides: a rejected contribution pages nobody — it has been acted on');
  // A scoped read carries the row to the subtree that can act on it (docs/46 §2.3 rule 2).
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'c2', participantId: 'builder', body: 'Still waiting.',
  } }, builder);
  await f.recruit('later-still');
  const scoped = await attentionRows('attention');
  assert.ok(scoped.some((entry) => entry.kind === 'unreviewed_contribution' && entry.contributionId === 'c2'),
    'the second unreviewed contribution raises its own row once a later brief crosses it');
  const scopedView = await f.call('view', { participantId: 'builder', projection: 'attention' });
  const scopedRows = Array.isArray(scopedView.attention) ? scopedView.attention : scopedView.attention?.rows ?? [];
  assert.ok(scopedRows.some((entry) => entry.kind === 'unreviewed_contribution' && entry.contributionId === 'c2'),
    'a scoped read carries the author\'s own row');
});

// ── 433-d: the whole contributions read over the web bridge, in ONE answer ─────────────────────

const webContext = () => ({
  principal: {
    userId: 'root', sessionId: 'session-1', credentialId: 'cred-1', authMethod: 'cookie',
    csrfToken: 'csrf-1', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false,
    capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: [WEB_REPO],
  },
  origin: WEB_ORIGIN, csrfToken: 'csrf-1', remoteAddress: '127.0.0.1', transport: 'https',
});

/** The REAL runtime behind the web bridge (the seam a root's MCP read crosses), so the answer below
 * is the owner's own view, whole. */
function webFixture(t) {
  const f = fixture(t);
  const web = new WebNorthbound({
    coordinator: {},
    coordination: f.store,
    repoIds: [WEB_REPO],
    allowedOrigins: [WEB_ORIGIN],
    now: () => Date.parse('2026-09-18T04:29:37.000Z'),
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
  const read = async (args, step = 0) => {
    const response = await web.execute(webContext(), {
      schemaVersion: 1, commandId: `cmd-read-${step}`, idempotencyKey: `read-${step}`,
      command: 'swarm_view', repoId: WEB_REPO, origin: WEB_ORIGIN,
      args: { swarmId: 'baton', ...args },
    });
    assert.equal(response.status, 200, `the read is served (step ${step})`);
    return response.body.result;
  };
  return { ...f, web, read };
}

test('433-d: the web bridge answers every contribution row in ONE read, once each', async (t) => {
  const f = webFixture(t);
  await f.call('create', { purpose: 'The whole contributions read (#433)' });
  await f.recruit('builder');
  const builder = principal('w-1');
  // Enough recorded material that the answer is far larger than the ceiling the bridge enforced
  // until #627: this read paged under that bound, and one answer carries the family now.
  const ROWS = 60;
  for (let index = 0; index < ROWS; index += 1) {
    await f.call('update', { event: 'swarm.contribution_recorded', payload: {
      contributionId: `c-${String(index).padStart(2, '0')}`, participantId: 'builder',
      body: `${index}`.padEnd(20_000, 'x'),
    } }, builder);
  }
  const whole = await f.call('view', { projection: 'contributions' });
  const expected = (whole.contributions ?? []).map((row) => row.contributionId).sort();
  assert.equal(expected.length, ROWS, 'the swarm really holds every contribution');

  const served = await f.read({ projection: 'contributions' }, 1);
  for (const row of served.contributions ?? []) {
    assert.ok(SWARM_REVIEW_STATES.includes(row.reviewState),
      'every row of the answer carries the review state (docs/46 §2.1)');
  }
  assert.equal(Object.hasOwn(served, 'page'), false,
    'a whole answer carries no page record: the read is not a step of a walk');
  assert.equal(Object.hasOwn(served, 'narrowed'), false, 'and it is not a narrowed slice either');
  const walked = (served.contributions ?? []).map((row) => row.contributionId);
  assert.equal(walked.length, ROWS, 'the one answer carries every contribution row');
  assert.deepEqual([...walked].sort(), expected,
    'and the rows are the whole contributions list — no gap (docs/46 §2.2)');
  assert.equal(new Set(walked).size, walked.length, 'and no duplicate');
});

// ── 433-e / 433-f: the CLI's bounded leg renders the whole frame ───────────────────────────────

/** The CLI's client over the light runtime: the ONE transport seam `watchSwarmFiltered` uses. */
const runtimeClient = (f) => ({
  command: (name, args) => f.call(name.replace(/^swarm\./u, ''), args),
});

test('433-e: --wake-class contribution_recorded answers both contributions, matchedSeq the second', async (t) => {
  let clockMs = Date.parse('2026-09-18T04:29:37.000Z');
  const f = fixture(t, { clock: () => new Date(clockMs).toISOString() });
  await f.call('create', { purpose: 'Two wakes, one call (#433)' });
  await f.recruit('alpha');
  const alpha = principal('w-1');
  const before = (await f.call('view', { projection: 'outline' })).cursor;
  const contributions = [];
  for (const contributionId of ['c1', 'c2']) {
    await f.call('update', { event: 'swarm.contribution_recorded', payload: {
      contributionId, participantId: 'alpha', body: `Body ${contributionId}.`,
    } }, alpha);
    contributions.push(f.store.swarm('baton').contributions[contributionId]);
    clockMs += 1000; // the second lands one second later — the issue's window
  }
  assert.equal(Date.parse(contributions[1].ts) - Date.parse(contributions[0].ts), 1000,
    'the fixture really recorded two contributions one second apart (issue #433)');
  const answer = await watchSwarmFiltered(parseBatonCli([
    'swarm', 'watch', 'baton', '--after-seq', String(before), '--timeout-ms', '5000',
    '--wake-class', 'contribution_recorded',
  ]), runtimeClient(f));
  const rows = answer.watch.events ?? [];
  const carried = rows.filter((row) => row.kind === 'swarm.contribution_recorded');
  assert.equal(carried.length, 2,
    'the CLI answers the WHOLE frame: a second contribution inside the same call is carried, never lost (docs/46 §3.4)');
  assert.deepEqual(carried.map((row) => row.seq), [contributions[0].seq, contributions[1].seq],
    'the rows ride in ledger order');
  assert.equal(answer.watch.matchedSeq, contributions[1].seq,
    'matchedSeq is the LAST carried row, so the next re-arm resumes past both');
  assert.equal(answer.watch.wakeClass, 'contribution_recorded',
    'the answer names the class it woke on, over the same closed table the follow leg prints');
  assert.equal(answer.watch.pendingSince, null, 'the answer holds no byte bound: nothing is left behind it');
  assert.equal(answer.projection, 'outline', 'a wake is not a view read: the outline default stands');
});

test('433-e2: a matching row behind a row outside the filter still answers the watch', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Filter the whole frame (#433)' });
  await f.recruit('alpha');
  const alpha = principal('w-1');
  const before = (await f.call('view', { projection: 'outline' })).cursor;
  // The exact shape of the issue: the row that lands FIRST is outside the caller's filter and the
  // row the filter names lands SECOND, inside the same watch call.
  await f.call('update', { event: 'swarm.context_updated', payload: { key: 'notes', body: 'Outside the filter.' } });
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'c1', participantId: 'alpha', body: 'Inside the filter.',
  } }, alpha);
  const answer = await watchSwarmFiltered(parseBatonCli([
    'swarm', 'watch', 'baton', '--after-seq', String(before), '--timeout-ms', '50',
    '--wake-class', 'contribution_recorded',
  ]), runtimeClient(f));
  assert.equal(answer.watch.reason, 'event',
    'the row the filter names answered the watch — a row outside it never re-arms past a match (docs/46 §3.5)');
  assert.equal(answer.watch.wakeClass, 'contribution_recorded',
    'the class named is the matching row\'s, never the first frame row\'s when a later one matched');
  assert.deepEqual((answer.watch.events ?? []).map((row) => row.kind), ['swarm.contribution_recorded'],
    'the filtered frame carries the admitted row, not the row this caller did not ask for');
  assert.equal(answer.watch.event.kind, 'swarm.contribution_recorded',
    'the wake names the row that woke it');
  assert.equal(answer.watch.matchedSeq, f.store.swarm('baton').contributions.c1.seq,
    'and resumes past the row it answered on');
});

test('433-f: a spent bounded watch answers an empty frame under the same filter', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'No fabricated wake (#433)' });
  await f.recruit('alpha');
  const before = (await f.call('view', { projection: 'outline' })).cursor;
  const answer = await watchSwarmFiltered(parseBatonCli([
    'swarm', 'watch', 'baton', '--after-seq', String(before), '--timeout-ms', '50',
    '--wake-class', 'contribution_recorded',
  ]), runtimeClient(f));
  assert.equal(answer.watch.reason, 'timeout', 'the deadline is reported, never a fabricated wake');
  assert.deepEqual(answer.watch.events, [], 'a spent watch carries an EMPTY frame (docs/46 §3.3)');
  assert.equal(answer.watch.matchedSeq, null);
  assert.equal(answer.watch.pendingSince, null);
  assert.equal(answer.watch.event, null, 'the first-row compatibility field stays null on a timeout');
  assert.equal(answer.watch.wakeClass, undefined, 'a timeout row never claims a wake class (#339)');
});

// ── 433-g: the contributions projection spawns no git ─────────────────────────────────────────

const HAVE_GIT = (() => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const needsGit = { skip: HAVE_GIT ? false : 'git binary unavailable' };
const REAL_GIT = (() => {
  const found = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' });
  const path = (found.stdout ?? '').trim();
  return path.length > 0 ? path : null;
})();
const wsId = () => `ws-${'0a'.repeat(16)}`.slice(0, 35);

/** A real repository with one real lane worktree behind a PATH shim that counts every git spawn the
 * runtime makes (the issue438 instrument): a seat whose checkout is live is exactly the fixture in
 * which a read path that spawns would show up. */
function spawnFixture(t) {
  const world = mkdtempSync(join(tmpdir(), 'baton-issue433-git-'));
  const repo = join(world, 'repo');
  const bin = join(world, 'bin');
  const spool = join(world, 'git-spawns.log');
  mkdirSync(repo); mkdirSync(bin);
  writeFileSync(spool, '');
  const git = (args, cwd = repo) => execFileSync(REAL_GIT, args, {
    cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trim();
  git(['init', '-q']);
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 433', GIT_COMMITTER_NAME: 'Issue 433' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue433@example.invalid', GIT_COMMITTER_EMAIL: 'issue433@example.invalid' });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(['add', 'base.txt']);
  git(['commit', '-qm', 'base']);
  const shim = join(bin, 'git');
  writeFileSync(shim, `#!/bin/sh
printf 'spawn\\n' >> ${JSON.stringify(spool)}
exec ${JSON.stringify(REAL_GIT)} "$@"
`);
  chmodSync(shim, 0o755);
  const priorPath = process.env.PATH;
  process.env.PATH = `${bin}:${priorPath ?? ''}`;
  t.after(() => {
    process.env.PATH = priorPath;
    rmSync(world, { recursive: true, force: true });
  });
  const store = new CoordinationStore(world);
  const workers = [];
  const scopes = new RuntimeIsolation({
    repoRoot: repo,
    baseEnv: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/nonexistent-operator-home', LANG: 'C' },
  });
  const runtime = new SwarmRuntime({
    store,
    coordinator: {
      list: () => workers,
      pausedTurns: () => [],
      liveWorkspaceHolders: () => [],
      workspaceAttachment: () => ({ workspaceId: wsId(), holderCount: 1 }),
      _runtimeScopes: scopes,
    },
    authorize: async () => {},
    prepareRun: async (request) => request,
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length}`, taskId: `t-${workers.length}`, runId: request.runId, status: 'working' });
    },
    stopRun: async () => ({ state: 'closed' }),
  });
  t.after(() => { runtime.close(); try { store.releaseWriterLease({ requireOwned: true }); } catch { /* swept */ } });
  const call = (command, args = {}) => runtime.command(`swarm.${command}`, { swarmId: 'baton', ...args }, owner);
  const recruit = async () => {
    await call('recruit', { participantId: 'builder', objective: 'Work as builder', idempotencyKey: '433:recruit' });
    const worker = workers[workers.length - 1];
    const branch = 'baton/builder';
    const worktree = join(repo, '.baton', 'wt', wsId());
    mkdirSync(join(repo, '.baton', 'wt'), { recursive: true });
    git(['worktree', 'add', '-b', branch, worktree, 'HEAD']);
    worker.sessionContext = {
      worktree, repoRoot: repo, ownerTaskId: wsId(), branch,
      baseSha: git(['rev-parse', 'HEAD'], worktree), ownerReceiptDigest: null,
    };
    store.recordSwarm('swarm.participant_bound', {
      swarmId: 'baton', participantId: 'builder', workerId: worker.id, taskId: worker.taskId,
    }, { actor: owner.actor, key: '433:bind' });
    return worker;
  };
  const spawns = () => readFileSync(spool, 'utf8').split('\n').filter((line) => line.length > 0).length;
  return { world, repo, git, store, runtime, call, recruit, spawns };
}

test('433-g: the contributions projection spawns no git at all (docs/46 §7)', needsGit, async (t) => {
  const f = spawnFixture(t);
  await f.call('create', { purpose: 'A read spawns nothing (#433)', idempotencyKey: '433:create' });
  await f.recruit();
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'c1', participantId: 'builder', body: 'Landed.',
  }, idempotencyKey: '433:contribution' }, principal('w-0'));
  const before = f.spawns();
  const view = await f.call('view', { projection: 'contributions' });
  assert.equal(f.spawns() - before, 0,
    'the contributions projection spawns no git: the row derives from the fold and the ONE review-state derivation (docs/46 §7, #438)');
  const row = (view.contributions ?? []).find((entry) => entry.contributionId === 'c1');
  assert.ok(row, 'the projection still answers the rows it prices nothing for');
  assert.equal(row.reviewState, 'unreviewed');
  // The fixture is not inert: the same seat's checkout is readable, so a read path that ASKED for
  // the working tree would have spawned (the shim is the OS-level spawn, not a module seam).
  const worktree = join(f.repo, '.baton', 'wt', wsId());
  assert.equal(f.git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree), 'baton/builder',
    'the seat really holds a live checkout the runtime could have read');
});
