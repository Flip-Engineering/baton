// Issue #268 (remainder) / #364 (view half) / #274 (issue-274 lane, 2026-09-22): activity and
// usage on the participant row, the ONE liveness derivation's closed state set, the root as a
// participant row, the attention coverage envelope, the brief exposure ladder, and the view's
// no-process-spawn cost rule — as specified by docs/46-swarm-visibility.md §1, §4, §5, §6 and §7.
//
// LANDED (lane ds-268b, 2026-09-18): the activity/usage row — a participant row carries
// `activity {lastEventKind, lastEventAt, turnsCompleted, contributions}` and
// `usage {tokens|'unavailable', providerCalls|'unavailable'}` from the ONE derivation
// (swarm-runtime.mjs `_seatActivity`, the same rows `run.peers.read` projects), and its manifest
// row is retired. The no-spawn cost rule (gap d, #438) landed before it.
//
// LANDED (issue-274 lane, 2026-09-22) — the three standing gaps, and the manifest rows for them
// are retired with the landing (docs/44):
//   • #364 view half — `SWARM_PARTICIPANT_RUNTIME_STATES` is exported (with `lost` and `root`),
//     and the brief's peer lines derive liveness from the ONE derivation, so a gone seat is
//     never listed as a working peer;
//   • root standing gap b (§5) — the synthesized `root` participant row on every view in every
//     scope, the reserved name, and the VIEW's attribution rendering (`reviewerId`/`actor`
//     'root' for an external principal; the durable row keeps the null and the principal);
//   • root standing gap c (§6) — `attention` is the `{rows, coverage}` envelope, `rows`
//     byte-identical to the former array, `coverage` naming examined seats and the seats a
//     check skipped (`worktree_unreadable`);
//   • brief exposure by relationship (§4) — `_peerExposure` classifies (seat, peer) and the
//     recruit brief grades every peer line by class, gone seats named once as settled history.
//
// Fixture: the light SwarmRuntime harness (swarm-runtime.test.mjs) — no adapter. The no-spawn row
// shims `git` on PATH: any spawn lands in the spy log, and exit 1 reads as absence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import * as swarmRuntime from '../src/swarm-runtime.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const principal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });

function fixture(t, { prepareRun = null } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue268-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const starts = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => (workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : []),
    routeCards: () => [],
    guideParticipant: async () => ({ ok: true }),
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: prepareRun ?? (async () => {}),
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
  const participantRow = async (participantId) => {
    const view = await call('view', { projection: 'participants' });
    return (view.participants ?? []).find((row) => row.participantId === participantId) ?? null;
  };
  return { store, runtime, workers, starts, call, recruit, participantRow, directory };
}

test('#268: the participant row carries activity and usage from folded rows', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Activity and usage visibility (#268)' });
  await f.recruit('builder');
  const builder = principal('w-1');
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'c1', participantId: 'builder', body: 'Visible work.',
  } }, builder);
  const row = await f.participantRow('builder');
  assert.ok(row.activity,
    'land activity {lastEventKind, lastEventAt, turnsCompleted, contributions} on the participant row — derived from rows the store already folds, never a worker-log scan (docs/46 §1.2)');
  assert.equal(row.activity.contributions, 1,
    'activity.contributions counts the fold\'s swarm.contributions rows for the seat (docs/46 §1.2 rule 1)');
  assert.equal(row.activity.turnsCompleted, 0,
    'activity.turnsCompleted counts the seat\'s attributed lifecycle.turn_completed rows — zero recorded here (docs/46 §1.2 rule 1)');
  assert.equal(typeof row.activity.lastEventKind, 'string',
    'activity.lastEventKind names the latest ledger row attributed to the seat (docs/46 §1.2 rule 1)');
  assert.deepEqual(row.usage, { tokens: 'unavailable', providerCalls: 'unavailable' },
    'land usage {tokens|unavailable, providerCalls|unavailable}: absence is labelled per field, never zero-filled (docs/46 §1.2 rule 2)');
});

test('#364 RED (stage: SWARM_PARTICIPANT_RUNTIME_STATES not exported): the closed runtime state set is exported and every surface reads the ONE derivation', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'One liveness (#364 view half)' });
  await f.recruit('alpha');
  await f.recruit('beta');
  assert.ok(Array.isArray(swarmRuntime.SWARM_PARTICIPANT_RUNTIME_STATES),
    'land SWARM_PARTICIPANT_RUNTIME_STATES: the exported closed set every surface validates runtime.state against (docs/46 §1.1)');
  for (const state of ['pending', 'working', 'blocked', 'idle', 'stopping', 'dead', 'exited', 'completed', 'lost', 'unbound', 'root']) {
    assert.ok(swarmRuntime.SWARM_PARTICIPANT_RUNTIME_STATES.includes(state),
      `land '${state}' in the closed runtime state set — 'lost' is the #364 restart reading, 'root' the §5 actor row (docs/46 §1.1, §5.2)`);
  }
  // A dead seat's view row and the next recruit's brief agree: the ONE derivation, so the 40
  // dead seats of 2026-09-18 can never ride a Peers section again (docs/46 §1.1 rule 3, §4.2).
  f.workers.find((row) => row.id === 'w-2').status = 'dead';
  const dead = await f.participantRow('beta');
  assert.equal(dead.runtime.live, false, 'a seat whose worker died reads live: false from the ONE liveness derivation');
  await f.recruit('gamma');
  const brief = f.starts.at(-1).objective;
  // The peer LINES only: the situation section's other blocks (wake rows, the history count)
  // may legitimately name the seat as settled history, never as a working peer.
  const peersBlock = (brief.split('Peers (the seats already working beside you):')[1] ?? '')
    .split('\n').filter((line) => line.startsWith('- beta — ')).join('\n');
  assert.equal(peersBlock, '',
    'land the brief fix: a seat _canAct rejects is never listed as a working peer (docs/46 §4.2 rule 1)');
});

test('#268 RED (stage: the root participant row not landed): the root is a participant row and its acts render attributed', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'The root has an actor row (root standing gap b)' });
  await f.recruit('builder');
  const builder = principal('w-1');
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'c1', participantId: 'builder', body: 'For the root to review.',
  } }, builder);
  // The orchestrator (no seat) reviews: the durable row keeps reviewerId null with actor 'owner';
  // the VIEW renders the attribution against the root row (docs/46 §5.3).
  await f.call('update', { event: 'swarm.contribution_reviewed', payload: {
    contributionId: 'c1', decision: 'accept', reason: 'Accepted by the root.',
  } }, owner);
  const root = await f.participantRow('root');
  assert.ok(root,
    'land the synthesized root participant row on every view\'s participants array (docs/46 §5.1)');
  assert.equal(root.status, 'active', 'the root row reads active while the resident answers (docs/46 §5.2)');
  assert.deepEqual([...root.permissions].sort(),
    ['communicate', 'contribute', 'organize', 'read', 'recruit', 'review', 'stop'],
    'the root row carries the whole permission grant set (docs/46 §5.1)');
  assert.equal(root.runtime?.state, 'root', 'the root row\'s runtime state is root (docs/46 §5.2)');
  const view = await f.call('view', { projection: 'contributions' });
  const reviews = view.reviews?.c1 ?? [];
  assert.equal(reviews[0]?.reviewerId, 'root',
    'land attribution rendering: an orchestrator review lands with reviewerId root — the null never reaches a reader (docs/46 §5.3)');
  await assert.rejects(f.recruit('root'), /root/,
    'root is a reserved participant name: it is derived, never recruited (docs/46 §5.1)');
});

test('#268 RED (stage: the attention coverage envelope not landed): attention carries its coverage — examined seats are named', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Attention coverage (root standing gap c)' });
  await f.recruit('builder');
  const view = await f.call('view', { projection: 'attention' });
  assert.ok(view.attention && !Array.isArray(view.attention) && Array.isArray(view.attention.rows),
    'land the attention envelope {rows, coverage}: rows keep today\'s array content (docs/46 §6.1)');
  assert.ok(Array.isArray(view.attention.coverage?.examined) && Array.isArray(view.attention.coverage?.unexamined),
    'land attention.coverage {examined, unexamined}: an empty rows list is distinguishable from an unexamined one (docs/46 §6.3)');
  assert.ok(view.attention.coverage.examined.includes('builder'),
    'coverage.examined names every participant the attention derivation evaluated this read (docs/46 §6.2)');
});

test('#268: swarm.view --projection participants spawns no process (#438)', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'A read never spawns (#438, docs/46 §7)' });
  await f.recruit('builder');
  // Give the seat a recorded checkout so TODAY's inspect() would shell out: the live branch/HEAD/
  // status reads, participantBase, and worktreeChangedPaths all key on checkoutOf(worker).
  f.workers[0].sessionContext = { worktree: f.directory, repoRoot: f.directory };
  // The spy: a `git` shim on PATH that logs every invocation and exits 1 (reads as absence).
  // Any process spawn during the view lands in the log — the design's cost rule admits none.
  const shim = join(f.directory, 'shim');
  const spyLog = join(f.directory, 'git-spy.log');
  mkdirSync(shim);
  writeFileSync(join(shim, 'git'), `#!/bin/sh\necho "$@" >> "${spyLog}"\nexit 1\n`);
  chmodSync(join(shim, 'git'), 0o755);
  const priorPath = process.env.PATH;
  process.env.PATH = `${shim}:${priorPath}`;
  t.after(() => { process.env.PATH = priorPath; });
  await f.call('view', { projection: 'participants' });
  let spawns = '';
  try { spawns = readFileSync(spyLog, 'utf8'); } catch { /* no log: no spawn */ }
  assert.equal(spawns, '',
    'land the cost rule: a view read derives from folded rows and change-maintained caches — NO per-seat git spawn on a read (docs/46 §7; today inspect() shells out per seat: branch/HEAD/status, participantBase, worktreeChangedPaths)'
    + (spawns ? ` — spawned: ${spawns.trim().split('\n').join(' | ')}` : ''));
});

test('#268 RED (stage: the brief exposure ladder not landed): the recruit brief exposes peers by relationship (docs/46 §4)', async (t) => {
  const f = fixture(t, { prepareRun: async (request) => ({ ...request, scope: ['impl/**'] }) });
  await f.call('create', { purpose: 'Brief exposure by relationship (#274, docs/46 §4)' });
  await f.call('update', { event: 'swarm.work_updated', payload: {
    workId: 'work-1', objective: 'Hold the scope guard',
  } }, owner);
  await f.recruit('holder');
  await f.call('update', { event: 'swarm.assignment_updated', payload: {
    assignmentId: 'a-1', participantId: 'holder', workId: 'work-1', status: 'active',
  } }, owner);
  await f.recruit('scoped');
  await f.recruit('delta');
  // The peer LINES only — the situation section's other blocks (wake rows, the history count)
  // may legitimately name a seat, never as a working peer line.
  const peerLinesOf = (brief, id) => (brief.split('Peers (the seats already working beside you):')[1] ?? '')
    .split('\n').filter((line) => line.startsWith(`- ${id} — `));
  const peersBlock = peerLinesOf(f.starts.at(-1).objective, 'holder')
    .concat(peerLinesOf(f.starts.at(-1).objective, 'scoped')).join('\n');
  assert.ok(/^- holder — /mu.test(peersBlock), 'the block lists the live peer');
  assert.ok(/^- holder — Continue working as holder; working$/mu.test(peersBlock),
    'a `swarm`-class peer renders identity, role and the liveness word — the word verbatim from swarmParticipantLiveness (docs/46 §4.2)');
  assert.equal(peersBlock.includes('work-1'), false,
    'held work never rides a `swarm`-class peer line (docs/46 §4.2)');
  assert.equal(peersBlock.includes('scope:'), false,
    'scope never rides a `swarm`-class peer line (docs/46 §4.2)');
  assert.ok(peersBlock.includes('- scoped — Continue working as scoped; working'),
    'a peer whose only relationship is the swarm itself reads the same capped line');
  // A seat the ONE derivation calls gone is named once, as settled history — never as a
  // working peer (docs/46 §4.2 rule 1).
  f.workers.find((row) => row.id === 'w-1').status = 'dead';
  await f.recruit('epsilon');
  const nextBrief = f.starts.at(-1).objective;
  assert.equal(peerLinesOf(nextBrief, 'holder').length, 0,
    'a gone seat is never listed as a working peer (docs/46 §4.2 rule 1)');
  assert.match(nextBrief, /\b1 seat\b[^\n]*\bgone/mu,
    'the settled-history line gains the gone-not-settled count when it is non-zero (docs/46 §4.2 rule 1)');
});

test('#268 RED (stage: _peerExposure not landed): the relationship classes are ONE derivation (docs/46 §4.1)', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'The ONE relationship derivation (docs/46 §4.1)' });
  assert.deepEqual([...swarmRuntime.SWARM_BRIEF_EXPOSURE_CLASSES],
    ['self', 'subtree', 'checkout', 'group', 'swarm', 'repository'],
    'the closed relationship set of docs/46 §4.1 (already landed with #464) is the ladder vocabulary');
  const world = {
    swarmId: 'baton',
    participants: {
      seat: { participantId: 'seat', parentId: 'lead', workspaceId: 'ws-shared' },
      lead: { participantId: 'lead', parentId: null, workspaceId: null },
      sharer: { participantId: 'sharer', parentId: null, workspaceId: 'ws-shared' },
      mate: { participantId: 'mate', parentId: null, workspaceId: null },
      far: { participantId: 'far', parentId: null, workspaceId: null },
    },
    groups: { g1: { groupId: 'g1', members: ['seat', 'mate'] } },
  };
  const seat = { participantId: 'seat', parentId: 'lead', workspaceId: 'ws-shared', groups: new Set(['g1']) };
  assert.equal(f.runtime._peerExposure(world, seat, world.participants.seat), 'self',
    'the brief own seat reads self — the resumeFrom successor seam (docs/46 §4.1)');
  assert.equal(f.runtime._peerExposure(world, seat, world.participants.lead), 'subtree',
    'a delegating parent reads subtree — ancestor by parentId (docs/46 §4.1)');
  world.participants.child = { participantId: 'child', parentId: 'seat', workspaceId: null };
  assert.equal(f.runtime._peerExposure(world, seat, world.participants.child), 'subtree',
    'a delegated child reads subtree — descendant by parentId (docs/46 §4.1)');
  assert.equal(f.runtime._peerExposure(world, seat, world.participants.sharer), 'checkout',
    'a seat on the recorded checkout reads checkout (docs/46 §4.1)');
  assert.equal(f.runtime._peerExposure(world, seat, world.participants.mate), 'group',
    'a shared group roster reads group (docs/46 §4.1)');
  assert.equal(f.runtime._peerExposure(world, seat, world.participants.far), 'swarm',
    'none of the above reads swarm — the same-swarm default (docs/46 §4.1)');
});

test('#268 RED (stage: the root row extras not landed): the root row is an actor row in every scope, and its acts render attributed', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'The root row is an actor row (docs/46 §5)' });
  await f.recruit('builder');
  const builder = principal('w-1');
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'c1', participantId: 'builder', body: 'For the root to review.',
  } }, builder);
  await f.call('update', { event: 'swarm.contribution_reviewed', payload: {
    contributionId: 'c1', decision: 'accept', reason: 'Accepted by the root.',
  } }, owner);
  // The root row rides a SCOPED view too (docs/46 §5.5), with the whole §5.1 runtime spelling
  // and none of the seat-only fields — absent, not null-filled (docs/46 §5.4).
  const scoped = await f.call('view', { participantId: 'builder' });
  const root = (scoped.participants ?? []).find((row) => row.participantId === 'root');
  assert.ok(root,
    'the root row appears in every scope, so a seat can attribute a root review from its own view (docs/46 §5.5)');
  assert.deepEqual(root.runtime, { workerId: null, state: 'root', live: true, turn: null },
    "the root row's runtime is the whole {workerId: null, state: 'root', live: true, turn: null} (docs/46 §5.1)");
  for (const field of ['runId', 'workspace', 'activity', 'usage']) {
    assert.equal(field in root, false,
      `the root row carries no ${field} — absent, not null-filled: it has no worker log (docs/46 §5.4)`);
  }
  // Durable rows stay untouched; the VIEW renders the attribution (docs/46 §5.3).
  const durable = f.store.swarm('baton').reviews.c1[0];
  assert.equal(durable.reviewerId, null,
    'the durable review row keeps reviewerId null (docs/46 §5.3: swarm-state assertAttribution unchanged)');
  assert.equal(durable.actor, 'owner', 'the durable row keeps the acting principal (docs/46 §5.3)');
  const view = await f.call('view', {});
  const rendered = (view.reviews?.c1 ?? [])[0];
  assert.equal(rendered?.reviewerId, 'root', 'the VIEW renders reviewerId root (docs/46 §5.3)');
  assert.equal(rendered?.actor, 'root', 'the VIEW renders actor root for the external principal (docs/46 §5.3)');
});

test('#268 RED (stage: the attention coverage derivation not landed): coverage names the seats a check skipped', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Attention coverage names what was unreadable (docs/46 §6)' });
  await f.recruit('builder');
  await f.recruit('reader');
  // A seat with a recorded checkout that cannot be read: the git shim exits 1, so the change
  // set is unreadable — exactly the fact whose silence today passes for examined (docs/46 §6.2).
  f.workers[1].sessionContext = { worktree: f.directory, repoRoot: f.directory };
  const shim = join(f.directory, 'shim');
  mkdirSync(shim);
  writeFileSync(join(shim, 'git'), '#!/bin/sh\nexit 1\n');
  chmodSync(join(shim, 'git'), 0o755);
  const priorPath = process.env.PATH;
  process.env.PATH = `${shim}:${priorPath}`;
  t.after(() => { process.env.PATH = priorPath; });
  const view = await f.call('view', { projection: 'attention' });
  assert.ok(view.attention && !Array.isArray(view.attention) && Array.isArray(view.attention.rows),
    'attention is the {rows, coverage} envelope (docs/46 §6.1)');
  assert.deepEqual(view.attention.coverage.unexamined,
    [{ participantId: 'reader', checks: ['worktree_foreign_changes', 'turn_ended_without_contribution'], reason: 'worktree_unreadable' }],
    'a seat whose worktree read failed is named with its skipped checks and reason worktree_unreadable (docs/46 §6.2)');
  assert.ok(view.attention.coverage.examined.includes('builder'),
    'a seat whose facts were readable is examined (docs/46 §6.2)');
  const whole = await f.call('view', {});
  assert.deepEqual(view.attention.rows, whole.attention.rows,
    'rows are the same derivation on every projection that carries them — byte-identical content (docs/46 §6.1)');
  // Scoped views scope coverage exactly as they scope rows (docs/46 §6.4).
  const scoped = await f.call('view', { participantId: 'builder', projection: 'attention' });
  assert.deepEqual(scoped.attention.coverage, { examined: ['builder'], unexamined: [] },
    'the subtree filter applied to rows applies to examined/unexamined (docs/46 §6.4)');
});
