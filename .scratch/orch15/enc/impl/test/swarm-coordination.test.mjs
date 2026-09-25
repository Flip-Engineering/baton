import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { swarmContextKey } from '../src/swarm-state.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-swarm-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  let serial = 0;
  const write = (kind, payload, key = `mutation-${++serial}`) => store.recordSwarm(kind,
    { swarmId: 'self-build', ...payload }, { actor: 'owner', key });
  write('swarm.created', { purpose: 'Build Baton with continuing collaborators' });
  return { directory, store, write };
}

test('one coordination log preserves evolving groups, work and reviews across replay', (t) => {
  const { directory, store, write } = fixture(t);
  write('swarm.participant_joined', { participantId: 'builder', runId: 'run-builder' });
  write('swarm.participant_joined', { participantId: 'reviewer', runId: 'run-reviewer', role: 'Persistent reviewer' });
  write('swarm.group_updated', { groupId: 'runtime', members: ['builder', 'reviewer'], expectedVersion: 0 });
  write('swarm.group_updated', { groupId: 'interface', members: ['reviewer'], expectedVersion: 0 });
  for (const workId of ['first', 'second']) {
    write('swarm.work_updated', { workId, objective: `Investigate ${workId}` });
    write('swarm.assignment_updated', { assignmentId: `review-${workId}`,
      participantId: 'reviewer', workId, status: 'active' });
  }
  write('swarm.contribution_recorded', { contributionId: 'finding', participantId: 'builder', body: 'A partial finding' });
  write('swarm.contribution_reviewed', { contributionId: 'finding', reviewerId: 'reviewer', decision: 'accept' });
  const state = store.swarm('self-build');
  assert.equal(state.participants.builder.status, 'active');
  assert.equal(state.participants.reviewer.status, 'active');
  assert.equal(state.work.first.status, 'open');
  assert.equal(state.assignments['review-second'].status, 'active');
  const replay = new CoordinationStore(directory);
  assert.deepEqual(replay.swarms(), store.swarms());
  assert.deepEqual(replay.snapshot().swarms, store.snapshot().swarms);
  assert.equal(replay.hasSwarmParticipantRun('run-reviewer'), true);
});

test('conflicting and invalid mutations leave the durable log and projection usable', (t) => {
  const { directory, store, write } = fixture(t);
  const payload = { key: 'decision', body: { state: 'tentative' }, expectedVersion: 0 };
  const first = write('swarm.context_updated', payload, 'decision-1');
  assert.deepEqual(write('swarm.context_updated', payload, 'decision-1'), first);
  const before = readFileSync(join(directory, 'events.jsonl'), 'utf8');
  assert.throws(() => write('swarm.context_updated', { ...payload, body: 'different' }, 'decision-1'),
    { code: 'swarm_replay_conflict' });
  assert.throws(() => write('swarm.context_updated', { ...payload, body: 'stale' }),
    { code: 'version_conflict' });
  assert.throws(() => write('swarm.group_updated', { groupId: 'outsiders', members: ['unknown'] }));
  assert.equal(readFileSync(join(directory, 'events.jsonl'), 'utf8'), before);
  write('swarm.context_updated', { key: 'decision', body: 'revised', expectedVersion: 1 });
  const replay = new CoordinationStore(directory);
  assert.equal(replay.swarm('self-build').context[swarmContextKey('decision')].body, 'revised');
});

test('closing organizational membership never changes an existing participant turn protocol', (t) => {
  const { directory, store, write } = fixture(t);
  write('swarm.participant_joined', { participantId: 'reviewer', runId: 'run-reviewer' });
  write('swarm.participant_left', { participantId: 'reviewer', reason: 'Moving to another group' });
  write('swarm.closed', { reason: 'This group no longer needs coordination' });
  assert.equal(store.hasSwarmParticipantRun('run-reviewer'), true);
  assert.equal(store.hasSwarmParticipantRun('unrelated'), false);
  assert.equal(new CoordinationStore(directory).hasSwarmParticipantRun('run-reviewer'), true);
});

test('shared JSON context preserves prototype-named keys and distinguishes them during retries', (t) => {
  const { store, write } = fixture(t);
  const body = JSON.parse('{"nested":{"__proto__":{"fact":1},"constructor":"data"}}');
  write('swarm.context_updated', { key: 'facts', body }, 'facts-1');
  write('swarm.context_updated', { key: 'facts', body }, 'facts-1');
  assert.deepEqual(store.swarm('self-build').context[swarmContextKey('facts')].body, body);
  const different = JSON.parse('{"nested":{"__proto__":{"fact":2},"constructor":"data"}}');
  assert.throws(() => write('swarm.context_updated', { key: 'facts', body: different }, 'facts-1'),
    { code: 'swarm_replay_conflict' });
  write('swarm.context_updated', { key: 'unknown', body: null });
  assert.equal(store.swarm('self-build').context[swarmContextKey('unknown')].body, null);
  assert.equal(store.swarm('self-build').actor, 'owner');
});
