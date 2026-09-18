// Issue #433 red-before skeleton (stage: design-not-landed): the contributions projection with
// its review state, the bounded watch's multi-wake frame, and the unreviewed_contribution
// attention row — as specified by docs/46-swarm-visibility.md §2 and §3.
//
// Every row asserts the behaviour docs/46 specifies against the CURRENT runtime and is expected
// RED: today a contribution row carries no reviewState, the bounded watch answers on its FIRST
// wake row only (watch.event, no watch.events/pendingSince), and no attention kind says
// "unreviewed contribution" (2026-09-18: omp-373's contribution at seq 14840 went unseen for 25
// minutes). Each row's message names what the implementer must land. When a row goes green the
// expected-red manifest entry for it is stale and is retired with the landing (docs/44).
//
// Manifest plan (docs/44 rule 5): these rows list with reason #433. The manifest
// (impl/scripts/expected-red-tests.json) is outside this design lane's path scope; listing the
// rows is the implementing lane's first act, named in docs/46 §11.
//
// Fixture: the light SwarmRuntime harness (swarm-runtime.test.mjs) — no adapter, no git.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const principal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue433-'));
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
  return { store, runtime, workers, starts, call, recruit };
}

test('#433 RED (stage: design-not-landed): the contributions projection carries reviewState from the ONE derivation', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Review visibility (#433)' });
  await f.recruit('builder');
  await f.recruit('reviewer', ['read', 'review', 'communicate']);
  const builder = principal('w-1');
  const reviewer = principal('w-2');
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'c1', participantId: 'builder', body: 'First slice.',
  } }, builder);
  const reviewState = async () => {
    const view = await f.call('view', { projection: 'contributions' });
    const row = (view.contributions ?? []).find((entry) => entry.contributionId === 'c1');
    assert.ok(row, 'the contributions projection lists every recorded contribution (docs/46 §2)');
    return row.reviewState;
  };
  assert.equal(await reviewState(), 'unreviewed',
    'land reviewState on every contribution row: no settling review reads unreviewed (docs/46 §2.1)');
  await f.call('update', { event: 'swarm.contribution_reviewed', payload: {
    contributionId: 'c1', decision: 'accept', reason: 'Looks right.',
  } }, reviewer);
  assert.equal(await reviewState(), 'accepted',
    'land reviewState: an unrevoked accept reads accepted (the _acceptedContribution reading, docs/46 §2.1)');
  await f.call('update', { event: 'swarm.contribution_reviewed', payload: {
    contributionId: 'c1', decision: 'reject', reason: 'Changed my mind.',
  } }, reviewer);
  assert.equal(await reviewState(), 'rejected',
    'land reviewState: the LATEST settling review wins — a later reject reads rejected (docs/46 §2.1)');
  await f.call('update', { event: 'swarm.contribution_reviewed', payload: {
    contributionId: 'c1', decision: 'accept', reason: 'Addressed.',
  } }, reviewer);
  assert.equal(await reviewState(), 'accepted',
    'land reviewState: a still-later accept re-derives accepted — derived, never stored (docs/46 §2.1)');
});

test('#433 RED (stage: design-not-landed): the bounded watch carries EVERY wake row since afterSeq, or names pendingSince', async (t) => {
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
  const wake = await f.call('watch', { afterSeq: before, timeoutMs: 5000 });
  assert.equal(wake.watch.reason, 'event');
  assert.ok(Array.isArray(wake.watch.events),
    'land watch.events: every swarm-relevant wake row at seq > afterSeq, in seq order — not only the first (docs/46 §3.1)');
  const contributions = wake.watch.events.filter((row) => row.kind === 'swarm.contribution_recorded');
  assert.equal(contributions.length, 2,
    'land watch.events: both contributions recorded between wakes are carried — nothing is lost between a watch return and the next --after-seq re-arm (docs/46 §3)');
  assert.ok(contributions[0].seq < contributions[1].seq, 'watch.events read in ledger order (docs/46 §3.1)');
  assert.equal(wake.watch.matchedSeq, wake.watch.events.at(-1).seq,
    'land matchedSeq as the LAST carried row: re-arming with --after-seq matchedSeq loses nothing (docs/46 §3.3)');
  assert.equal(wake.watch.pendingSince, null,
    'land pendingSince: null when the frame bound cut nothing; the first uncarried row\'s seq when it did (docs/46 §3.2)');
});

test('#433 RED (stage: design-not-landed): an unreviewed_contribution attention row after one recruit-brief cadence', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Unreviewed work pages (#433)' });
  await f.recruit('builder');
  await f.recruit('reviewer', ['read', 'review', 'communicate']);
  const builder = principal('w-1');
  const reviewer = principal('w-2');
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'c1', participantId: 'builder', body: 'Waiting for review.',
  } }, builder);
  // The cadence without a clock: a recruit brief composed AFTER the contribution (the join's seq
  // crosses it) while reviewState is still unreviewed (docs/46 §2.3).
  await f.recruit('latecomer');
  const view = await f.call('view', { projection: 'attention' });
  const attentionRows = Array.isArray(view.attention) ? view.attention : view.attention?.rows;
  const row = (attentionRows ?? []).find((entry) => entry.kind === 'unreviewed_contribution' && entry.contributionId === 'c1');
  assert.ok(row,
    'land the unreviewed_contribution attention row on the author once a recruit-brief cadence has crossed the contribution (docs/46 §2.3)');
  assert.equal(row.participantId, 'builder',
    'the row attaches to the AUTHOR — the seat reading paused is the seat that gets named (docs/46 §2.3 rule 2)');
  assert.ok(row.cadence && Number.isSafeInteger(row.cadence.seq),
    'the row names the join that crossed the cadence — derived from rows, never from elapsed time (docs/46 §2.3 rule 1, #163)');
  await f.call('update', { event: 'swarm.contribution_reviewed', payload: {
    contributionId: 'c1', decision: 'accept',
  } }, reviewer);
  const settled = await f.call('view', { projection: 'attention' });
  const settledRows = Array.isArray(settled.attention) ? settled.attention : settled.attention?.rows;
  assert.equal((settledRows ?? []).some((entry) => entry.kind === 'unreviewed_contribution' && entry.contributionId === 'c1'), false,
    'a settling review clears the derived row on the next view — nothing to retract (docs/46 §2.3 rule 3)');
});
