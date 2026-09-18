import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SWARM_EVENT_KINDS,
  SWARM_WORK_STATUSES,
  SWARM_ASSIGNMENT_STATUSES,
  SWARM_REVIEW_DECISIONS,
  SwarmRefusal,
  SwarmIntegrityError,
  swarmContextKey,
  validateSwarmEvent,
  foldSwarmEvent,
  readSwarm,
  swarmSnapshot,
} from '../src/swarm-state.mjs';

// ── helpers ───────────────────────────────────────────────────────────────────

const fresh = () => new Map();

function fold(swarms, events) {
  for (const event of events) foldSwarmEvent(swarms, event);
  return swarms;
}

function e(kind, payload, meta = {}) {
  return { kind, payload, ...meta };
}

function refusals(fn) {
  let threw = null;
  try { fn(); } catch (err) { threw = err; }
  assert.ok(threw instanceof SwarmRefusal, `expected SwarmRefusal, got ${threw?.constructor?.name}: ${threw?.message}`);
  return threw;
}

function integrity(fn) {
  let threw = null;
  try { fn(); } catch (err) { threw = err; }
  assert.ok(threw instanceof SwarmIntegrityError, `expected SwarmIntegrityError, got ${threw?.constructor?.name}: ${threw?.message}`);
  return threw;
}

// Build a minimal swarm with one participant for reuse.
function swarmWithParticipant(swarmId = 'sw1', participantId = 'p1') {
  const swarms = fresh();
  fold(swarms, [
    e('swarm.created', { swarmId, purpose: 'Test swarm' }),
    e('swarm.participant_joined', { swarmId, participantId }),
  ]);
  return swarms;
}

// ── SWARM_EVENT_KINDS ────────────────────────────────────────────────────────

describe('SWARM_EVENT_KINDS', () => {
  test('contains all 17 event kinds', () => {
    const expected = [
      'swarm.created', 'swarm.participant_joined', 'swarm.participant_bound',
      'swarm.participant_left', 'swarm.group_updated', 'swarm.work_updated',
      'swarm.assignment_updated', 'swarm.coupling_updated', 'swarm.coupling_writer_bypassed',
      'swarm.participant_runtime_lost',
      // Issues #422/#423: the joint coupling, claim and work-proposal families.
      'swarm.claim_updated', 'swarm.proposal_updated',
      'swarm.context_updated',
      'swarm.contribution_recorded', 'swarm.contribution_revision_attached', 'swarm.contribution_reviewed', 'swarm.closed',
    ];
    for (const kind of expected) assert.ok(SWARM_EVENT_KINDS.has(kind), `missing ${kind}`);
    assert.equal(SWARM_EVENT_KINDS.size, expected.length);
  });

  test('is frozen', () => {
    assert.ok(Object.isFrozen(SWARM_EVENT_KINDS));
  });
});

// ── validateSwarmEvent ───────────────────────────────────────────────────────

describe('validateSwarmEvent — shape errors', () => {
  test('unknown kind throws SwarmRefusal', () => {
    const err = refusals(() => validateSwarmEvent('swarm.bogus', { swarmId: 'x' }));
    assert.equal(err.code, 'unknown_event_kind');
  });

  test('non-object payload throws', () => {
    const err = refusals(() => validateSwarmEvent('swarm.created', 'bad'));
    assert.equal(err.code, 'invalid_payload');
  });

  test('missing swarmId throws', () => {
    const err = refusals(() => validateSwarmEvent('swarm.created', { purpose: 'x' }));
    assert.equal(err.code, 'invalid_payload');
  });

  test('swarm.created missing purpose throws', () => {
    const err = refusals(() => validateSwarmEvent('swarm.created', { swarmId: 'sw1' }));
    assert.equal(err.code, 'invalid_payload');
  });

  test('swarm.participant_joined missing participantId throws', () => {
    const err = refusals(() => validateSwarmEvent('swarm.participant_joined', { swarmId: 'sw1' }));
    assert.equal(err.code, 'invalid_payload');
  });

  test('swarm.participant_joined empty role throws', () => {
    const err = refusals(() => validateSwarmEvent('swarm.participant_joined', { swarmId: 'sw1', participantId: 'p1', role: '' }));
    assert.equal(err.code, 'invalid_payload');
  });

  test('swarm.participant_joined accepts runId and permissions', () => {
    assert.doesNotThrow(() => validateSwarmEvent('swarm.participant_joined', {
      swarmId: 'sw1', participantId: 'p1', runId: 'run-1', permissions: ['read', 'write'],
    }));
  });

  test('swarm.participant_joined rejects non-string permissions entry', () => {
    const err = refusals(() => validateSwarmEvent('swarm.participant_joined', {
      swarmId: 'sw1', participantId: 'p1', permissions: [42],
    }));
    assert.equal(err.code, 'invalid_payload');
  });

  test('swarm.participant_joined rejects non-array permissions', () => {
    const err = refusals(() => validateSwarmEvent('swarm.participant_joined', {
      swarmId: 'sw1', participantId: 'p1', permissions: 'read',
    }));
    assert.equal(err.code, 'invalid_payload');
  });

  test('swarm.participant_bound requires workerId and taskId', () => {
    refusals(() => validateSwarmEvent('swarm.participant_bound', { swarmId: 'sw1', participantId: 'p1' }));
    refusals(() => validateSwarmEvent('swarm.participant_bound', { swarmId: 'sw1', participantId: 'p1', workerId: 'w1' }));
    assert.doesNotThrow(() => validateSwarmEvent('swarm.participant_bound', {
      swarmId: 'sw1', participantId: 'p1', workerId: 'w1', taskId: 't1',
    }));
  });

  test('swarm.group_updated requires distinct non-empty members', () => {
    refusals(() => validateSwarmEvent('swarm.group_updated', { swarmId: 'sw1', groupId: 'g1' }));
    const err = refusals(() => validateSwarmEvent('swarm.group_updated', {
      swarmId: 'sw1', groupId: 'g1', members: ['p1', 'p1'],
    }));
    assert.equal(err.code, 'invalid_payload');
  });

  test('swarm.group_updated rejects invalid expectedVersion', () => {
    const err = refusals(() => validateSwarmEvent('swarm.group_updated', {
      swarmId: 'sw1', groupId: 'g1', members: ['p1'], expectedVersion: -1,
    }));
    assert.equal(err.code, 'invalid_payload');
  });

  test('swarm.work_updated requires valid status if present', () => {
    const err = refusals(() => validateSwarmEvent('swarm.work_updated', {
      swarmId: 'sw1', workId: 'w1', objective: 'do it', status: 'paused',
    }));
    assert.equal(err.code, 'invalid_payload');
  });

  test('swarm.assignment_updated rejects unknown status', () => {
    const err = refusals(() => validateSwarmEvent('swarm.assignment_updated', {
      swarmId: 'sw1', assignmentId: 'a1', participantId: 'p1', workId: 'w1', status: 'pending',
    }));
    assert.equal(err.code, 'invalid_payload');
  });

  test('swarm.contribution_reviewed rejects unknown decision', () => {
    const err = refusals(() => validateSwarmEvent('swarm.contribution_reviewed', {
      swarmId: 'sw1', contributionId: 'c1', decision: 'maybe',
    }));
    assert.equal(err.code, 'invalid_payload');
  });

  test('swarm.context_updated requires body', () => {
    refusals(() => validateSwarmEvent('swarm.context_updated', { swarmId: 'sw1', key: 'k' }));
    assert.doesNotThrow(() => validateSwarmEvent('swarm.context_updated', { swarmId: 'sw1', key: 'k', body: 'text' }));
    assert.doesNotThrow(() => validateSwarmEvent('swarm.context_updated', { swarmId: 'sw1', key: 'k', body: { x: 1 } }));
  });

  test('swarm.contribution_recorded rejects non-array refs', () => {
    const err = refusals(() => validateSwarmEvent('swarm.contribution_recorded', {
      swarmId: 'sw1', contributionId: 'c1', participantId: 'p1', refs: 'not-an-array',
    }));
    assert.equal(err.code, 'invalid_payload');
  });
});

// ── evolving empty swarm ─────────────────────────────────────────────────────

describe('evolving empty swarm', () => {
  test('swarm.created produces an empty swarm', () => {
    const swarms = fresh();
    foldSwarmEvent(swarms, e('swarm.created', { swarmId: 'sw1', purpose: 'Investigate X' }));
    const swarm = swarms.get('sw1');
    assert.equal(swarm.swarmId, 'sw1');
    assert.equal(swarm.purpose, 'Investigate X');
    assert.equal(swarm.status, 'open');
    assert.equal(Object.keys(swarm.participants).length, 0);
    assert.equal(Object.keys(swarm.groups).length, 0);
    assert.equal(Object.keys(swarm.work).length, 0);
    assert.equal(Object.keys(swarm.assignments).length, 0);
    assert.equal(Object.keys(swarm.context).length, 0);
    assert.equal(Object.keys(swarm.contributions).length, 0);
    assert.equal(Object.keys(swarm.reviews).length, 0);
  });

  test('duplicate swarm.created throws SwarmIntegrityError', () => {
    const swarms = fresh();
    foldSwarmEvent(swarms, e('swarm.created', { swarmId: 'sw1', purpose: 'x' }));
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.created', { swarmId: 'sw1', purpose: 'y' })));
    assert.equal(err.code, 'swarm_duplicate');
  });

  test('readSwarm on unknown id throws SwarmRefusal', () => {
    const err = refusals(() => readSwarm(fresh(), 'no-such-swarm'));
    assert.equal(err.code, 'swarm_not_found');
    assert.equal(err.detail?.swarmId, 'no-such-swarm');
  });

  test('readSwarm returns the live row', () => {
    const swarms = fresh();
    foldSwarmEvent(swarms, e('swarm.created', { swarmId: 'sw1', purpose: 'p' }));
    const row = readSwarm(swarms, 'sw1');
    assert.equal(row.swarmId, 'sw1');
  });

  test('swarm rows are frozen', () => {
    const swarms = fresh();
    foldSwarmEvent(swarms, e('swarm.created', { swarmId: 'sw1', purpose: 'p' }));
    const row = swarms.get('sw1');
    assert.ok(Object.isFrozen(row));
  });

  test('swarm.closed marks organizational closure, retains history', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'p' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'alice' }),
      e('swarm.closed', { swarmId: 'sw1', reason: 'done' }),
    ]);
    const swarm = swarms.get('sw1');
    assert.equal(swarm.status, 'closed');
    assert.equal(swarm.closedReason, 'done');
    // Participants still retained
    assert.ok(swarm.participants['alice']);
  });

  test('double close throws SwarmIntegrityError', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'p' }),
      e('swarm.closed', { swarmId: 'sw1' }),
    ]);
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.closed', { swarmId: 'sw1' })));
    assert.equal(err.code, 'swarm_already_closed');
  });
});

// ── recruitment / regrouping / overlapping roles ─────────────────────────────

describe('recruitment and regrouping', () => {
  test('participants join with optional role, parentId, runId, permissions', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'collab' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'root', role: 'coordinator', runId: 'run-root' }),
      e('swarm.participant_joined', {
        swarmId: 'sw1', participantId: 'scout', role: 'investigator',
        parentId: 'root', permissions: ['read', 'contribute'],
      }),
    ]);
    const swarm = swarms.get('sw1');
    assert.equal(swarm.participants['root'].role, 'coordinator');
    assert.equal(swarm.participants['root'].runId, 'run-root');
    assert.equal(swarm.participants['scout'].parentId, 'root');
    assert.deepEqual(swarm.participants['scout'].permissions, ['read', 'contribute']);
    assert.equal(swarm.participants['scout'].status, 'active');
  });

  test('participant with same id in two different swarms is independent', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'a' }),
      e('swarm.created', { swarmId: 'sw2', purpose: 'b' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'alice' }),
      e('swarm.participant_joined', { swarmId: 'sw2', participantId: 'alice' }),
    ]);
    assert.ok(swarms.get('sw1').participants['alice']);
    assert.ok(swarms.get('sw2').participants['alice']);
  });

  test('parentId referential integrity within same swarm', () => {
    const swarms = fresh();
    foldSwarmEvent(swarms, e('swarm.created', { swarmId: 'sw1', purpose: 'x' }));
    // parentId not yet joined
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.participant_joined', {
      swarmId: 'sw1', participantId: 'child', parentId: 'missing-parent',
    })));
    assert.equal(err.code, 'participant_not_found');
  });

  test('overlapping group membership — groups are not disjoint', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'x' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'a' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'b' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'c' }),
      e('swarm.group_updated', { swarmId: 'sw1', groupId: 'g1', members: ['a', 'b'], purpose: 'Impl' }),
      e('swarm.group_updated', { swarmId: 'sw1', groupId: 'g2', members: ['b', 'c'], purpose: 'Review' }),
    ]);
    const swarm = swarms.get('sw1');
    assert.deepEqual(swarm.groups['g1'].members, ['a', 'b']);
    assert.deepEqual(swarm.groups['g2'].members, ['b', 'c']);
    assert.equal(swarm.groups['g1'].version, 1);
    assert.equal(swarm.groups['g2'].version, 1);
  });

  test('group regrouping bumps version and updates members', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'x' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'a' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'b' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'c' }),
      e('swarm.group_updated', { swarmId: 'sw1', groupId: 'g1', members: ['a', 'b'] }),
      e('swarm.group_updated', { swarmId: 'sw1', groupId: 'g1', members: ['a', 'b', 'c'], expectedVersion: 1 }),
    ]);
    const group = swarms.get('sw1').groups['g1'];
    assert.equal(group.version, 2);
    assert.deepEqual(group.members, ['a', 'b', 'c']);
  });

  test('group update with wrong expectedVersion throws', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'x' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'a' }),
      e('swarm.group_updated', { swarmId: 'sw1', groupId: 'g1', members: ['a'] }),
    ]);
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.group_updated', {
      swarmId: 'sw1', groupId: 'g1', members: ['a'], expectedVersion: 99,
    })));
    assert.equal(err.code, 'version_conflict');
  });

  test('group member referential integrity: unknown participant refused', () => {
    const swarms = fresh();
    foldSwarmEvent(swarms, e('swarm.created', { swarmId: 'sw1', purpose: 'x' }));
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.group_updated', {
      swarmId: 'sw1', groupId: 'g1', members: ['nobody'],
    })));
    assert.equal(err.code, 'participant_not_found');
  });

  test('participant_left retains identity and history', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'x' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'alice' }),
      e('swarm.participant_left', { swarmId: 'sw1', participantId: 'alice', reason: 'task done' }),
    ]);
    const participant = swarms.get('sw1').participants['alice'];
    assert.equal(participant.status, 'left');
    assert.equal(participant.leftReason, 'task done');
    // identity retained
    assert.equal(participant.participantId, 'alice');
  });

  test('participant_left on unknown participant throws', () => {
    const swarms = fresh();
    foldSwarmEvent(swarms, e('swarm.created', { swarmId: 'sw1', purpose: 'x' }));
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.participant_left', {
      swarmId: 'sw1', participantId: 'nobody',
    })));
    assert.equal(err.code, 'participant_not_found');
  });
});

// ── participant_bound ────────────────────────────────────────────────────────

describe('participant_bound', () => {
  test('records current native binding and appends to history', () => {
    const swarms = swarmWithParticipant();
    fold(swarms, [
      e('swarm.participant_bound', { swarmId: 'sw1', participantId: 'p1', workerId: 'w1', taskId: 't1', sessionId: 's1' }, { seq: 5 }),
      e('swarm.participant_bound', { swarmId: 'sw1', participantId: 'p1', workerId: 'w2', taskId: 't2' }, { seq: 10 }),
    ]);
    const bindings = swarms.get('sw1').participants['p1'].bindings;
    assert.equal(bindings.length, 2);
    assert.equal(bindings[0].workerId, 'w1');
    assert.equal(bindings[0].sessionId, 's1');
    assert.equal(bindings[0].seq, 5);
    assert.equal(bindings[1].workerId, 'w2');
    assert.equal(bindings[1].sessionId, null);
    assert.equal(bindings[1].seq, 10);
  });

  test('binding an unknown participant throws', () => {
    const swarms = fresh();
    foldSwarmEvent(swarms, e('swarm.created', { swarmId: 'sw1', purpose: 'x' }));
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.participant_bound', {
      swarmId: 'sw1', participantId: 'nobody', workerId: 'w1', taskId: 't1',
    })));
    assert.equal(err.code, 'participant_not_found');
  });

  test('binding is scoped to swarm — cross-swarm participant not visible', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'a' }),
      e('swarm.created', { swarmId: 'sw2', purpose: 'b' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'alice' }),
    ]);
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.participant_bound', {
      swarmId: 'sw2', participantId: 'alice', workerId: 'w1', taskId: 't1',
    })));
    assert.equal(err.code, 'participant_not_found');
  });
});

// ── shared context version conflict ──────────────────────────────────────────

describe('context_updated version conflict', () => {
  test('first update sets version 1', () => {
    const swarms = swarmWithParticipant();
    foldSwarmEvent(swarms, e('swarm.context_updated', { swarmId: 'sw1', key: 'plan', body: 'v1' }, { actor: 'p1' }));
    const ctx = swarms.get('sw1').context[swarmContextKey('plan')];
    assert.equal(ctx.version, 1);
    assert.equal(ctx.body, 'v1');
    assert.equal(ctx.actor, 'p1');
  });

  test('update without expectedVersion bumps version freely', () => {
    const swarms = swarmWithParticipant();
    fold(swarms, [
      e('swarm.context_updated', { swarmId: 'sw1', key: 'k', body: 'a' }),
      e('swarm.context_updated', { swarmId: 'sw1', key: 'k', body: 'b' }),
    ]);
    assert.equal(swarms.get('sw1').context[swarmContextKey('k')].version, 2);
    assert.equal(swarms.get('sw1').context[swarmContextKey('k')].body, 'b');
  });

  test('context update with correct expectedVersion succeeds', () => {
    const swarms = swarmWithParticipant();
    fold(swarms, [
      e('swarm.context_updated', { swarmId: 'sw1', key: 'k', body: 'a' }),
      e('swarm.context_updated', { swarmId: 'sw1', key: 'k', body: 'b', expectedVersion: 1 }),
    ]);
    assert.equal(swarms.get('sw1').context[swarmContextKey('k')].version, 2);
  });

  test('context update with wrong expectedVersion throws version_conflict', () => {
    const swarms = swarmWithParticipant();
    foldSwarmEvent(swarms, e('swarm.context_updated', { swarmId: 'sw1', key: 'k', body: 'a' }));
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.context_updated', {
      swarmId: 'sw1', key: 'k', body: 'b', expectedVersion: 5,
    })));
    assert.equal(err.code, 'version_conflict');
  });

  test('context body can be plain text or JSON object', () => {
    const swarms = swarmWithParticipant();
    fold(swarms, [
      e('swarm.context_updated', { swarmId: 'sw1', key: 'text', body: 'plain text' }),
      e('swarm.context_updated', { swarmId: 'sw1', key: 'json', body: { x: 1, y: [2, 3] } }),
    ]);
    assert.equal(swarms.get('sw1').context[swarmContextKey('text')].body, 'plain text');
    assert.deepEqual(swarms.get('sw1').context[swarmContextKey('json')].body, { x: 1, y: [2, 3] });
  });

  test('context scoped to group — unknown groupId refused', () => {
    const swarms = swarmWithParticipant();
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.context_updated', {
      swarmId: 'sw1', key: 'k', body: 'data', groupId: 'no-such-group',
    })));
    assert.equal(err.code, 'group_not_found');
  });

  test('context scoped to an existing group is accepted', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'x' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'a' }),
      e('swarm.group_updated', { swarmId: 'sw1', groupId: 'g1', members: ['a'] }),
      e('swarm.context_updated', { swarmId: 'sw1', key: 'notes', body: 'hi', groupId: 'g1' }),
    ]);
    const ctx = swarms.get('sw1').context[swarmContextKey('notes', 'g1')];
    assert.equal(ctx.groupId, 'g1');
    assert.equal(ctx.version, 1);
  });
});

// ── work / assignments ───────────────────────────────────────────────────────

describe('work and assignment', () => {
  test('work_updated creates work with version 1', () => {
    const swarms = swarmWithParticipant();
    foldSwarmEvent(swarms, e('swarm.work_updated', { swarmId: 'sw1', workId: 'w1', objective: 'Build X' }));
    const work = swarms.get('sw1').work['w1'];
    assert.equal(work.workId, 'w1');
    assert.equal(work.objective, 'Build X');
    assert.equal(work.version, 1);
    assert.equal(work.status, 'open');
  });

  test('work evolves with open/completed/cancelled dispositions', () => {
    const swarms = swarmWithParticipant();
    fold(swarms, [
      e('swarm.work_updated', { swarmId: 'sw1', workId: 'w1', objective: 'Investigate' }),
      e('swarm.work_updated', { swarmId: 'sw1', workId: 'w1', objective: 'Investigate', status: 'open' }),
      e('swarm.work_updated', { swarmId: 'sw1', workId: 'w1', objective: 'Investigate', status: 'completed' }),
    ]);
    const work = swarms.get('sw1').work['w1'];
    assert.equal(work.status, 'completed');
    assert.equal(work.version, 3);
  });

  test('work version conflict throws', () => {
    const swarms = swarmWithParticipant();
    fold(swarms, [
      e('swarm.work_updated', { swarmId: 'sw1', workId: 'w1', objective: 'x' }),
    ]);
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.work_updated', {
      swarmId: 'sw1', workId: 'w1', objective: 'y', expectedVersion: 5,
    })));
    assert.equal(err.code, 'version_conflict');
  });

  test('several live assignments per participant; many participants per work', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'x' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'alice' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'bob' }),
      e('swarm.work_updated', { swarmId: 'sw1', workId: 'w1', objective: 'Fix bug' }),
      e('swarm.assignment_updated', { swarmId: 'sw1', assignmentId: 'a1', participantId: 'alice', workId: 'w1', status: 'active' }),
      e('swarm.assignment_updated', { swarmId: 'sw1', assignmentId: 'a2', participantId: 'bob', workId: 'w1', status: 'active' }),
      // alice also on another work item
      e('swarm.work_updated', { swarmId: 'sw1', workId: 'w2', objective: 'Write docs' }),
      e('swarm.assignment_updated', { swarmId: 'sw1', assignmentId: 'a3', participantId: 'alice', workId: 'w2', status: 'active' }),
    ]);
    const { assignments } = swarms.get('sw1');
    assert.equal(assignments['a1'].status, 'active');
    assert.equal(assignments['a2'].status, 'active');
    assert.equal(assignments['a3'].participantId, 'alice');
    assert.equal(Object.keys(assignments).length, 3);
  });

  test('assignment released without closing participant or work', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'x' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'alice' }),
      e('swarm.work_updated', { swarmId: 'sw1', workId: 'w1', objective: 'Task' }),
      e('swarm.assignment_updated', { swarmId: 'sw1', assignmentId: 'a1', participantId: 'alice', workId: 'w1', status: 'active' }),
      e('swarm.assignment_updated', { swarmId: 'sw1', assignmentId: 'a1', participantId: 'alice', workId: 'w1', status: 'released', expectedVersion: 1 }),
    ]);
    const swarm = swarms.get('sw1');
    assert.equal(swarm.assignments['a1'].status, 'released');
    assert.equal(swarm.participants['alice'].status, 'active');
    assert.equal(swarm.work['w1'].status, 'open');
  });

  test('assignment referential integrity: unknown participant refused', () => {
    const swarms = swarmWithParticipant();
    foldSwarmEvent(swarms, e('swarm.work_updated', { swarmId: 'sw1', workId: 'w1', objective: 'x' }));
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.assignment_updated', {
      swarmId: 'sw1', assignmentId: 'a1', participantId: 'nobody', workId: 'w1', status: 'active',
    })));
    assert.equal(err.code, 'participant_not_found');
  });

  test('assignment referential integrity: unknown work refused', () => {
    const swarms = swarmWithParticipant();
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.assignment_updated', {
      swarmId: 'sw1', assignmentId: 'a1', participantId: 'p1', workId: 'no-work', status: 'active',
    })));
    assert.equal(err.code, 'work_not_found');
  });
});

// ── persistent reviewer in several assignments ────────────────────────────────

describe('persistent reviewer in several assignments', () => {
  test('reviewer is active participant with multiple concurrent assignments', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'review suite' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'reviewer', role: 'reviewer' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'author1' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'author2' }),
      e('swarm.work_updated', { swarmId: 'sw1', workId: 'pr1', objective: 'Review PR 1' }),
      e('swarm.work_updated', { swarmId: 'sw1', workId: 'pr2', objective: 'Review PR 2' }),
      e('swarm.assignment_updated', { swarmId: 'sw1', assignmentId: 'ra1', participantId: 'reviewer', workId: 'pr1', status: 'active' }),
      e('swarm.assignment_updated', { swarmId: 'sw1', assignmentId: 'ra2', participantId: 'reviewer', workId: 'pr2', status: 'active' }),
      // Record contributions
      e('swarm.contribution_recorded', { swarmId: 'sw1', contributionId: 'c1', participantId: 'author1', workId: 'pr1', body: 'impl done' }),
      e('swarm.contribution_recorded', { swarmId: 'sw1', contributionId: 'c2', participantId: 'author2', workId: 'pr2', body: 'fix ready' }),
    ]);
    const swarm = swarms.get('sw1');
    // Reviewer is still active with two live assignments
    assert.equal(swarm.participants['reviewer'].status, 'active');
    assert.equal(swarm.assignments['ra1'].status, 'active');
    assert.equal(swarm.assignments['ra2'].status, 'active');
  });
});

// ── accepted contribution with author still active ────────────────────────────

describe('accepted contribution — author still active', () => {
  test('accept review does not close contributor, work, group, or swarm', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'impl' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'builder', role: 'developer' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'reviewer', role: 'reviewer' }),
      e('swarm.work_updated', { swarmId: 'sw1', workId: 'feat', objective: 'Implement feature' }),
      e('swarm.contribution_recorded', { swarmId: 'sw1', contributionId: 'c1', participantId: 'builder', workId: 'feat', body: 'code here' }),
      e('swarm.contribution_reviewed', { swarmId: 'sw1', contributionId: 'c1', reviewerId: 'reviewer', decision: 'accept', reason: 'LGTM' }),
    ]);
    const swarm = swarms.get('sw1');
    // Review is recorded
    const reviews = swarm.reviews['c1'];
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].decision, 'accept');
    assert.equal(reviews[0].reviewerId, 'reviewer');
    // Author is NOT closed
    assert.equal(swarm.participants['builder'].status, 'active');
    // Work is NOT closed (default status is 'open')
    assert.equal(swarm.work['feat'].status, 'open');
    // Swarm is NOT closed
    assert.equal(swarm.status, 'open');
  });

  test('opposing reviews are both retained — no last-review erasure', () => {
    const swarms = swarmWithParticipant();
    fold(swarms, [
      e('swarm.work_updated', { swarmId: 'sw1', workId: 'w1', objective: 'Task' }),
      e('swarm.contribution_recorded', { swarmId: 'sw1', contributionId: 'c1', participantId: 'p1', body: 'draft' }),
      // p1 is the only registered participant; reviewerId must be a known participant or omitted
      e('swarm.contribution_reviewed', { swarmId: 'sw1', contributionId: 'c1', reviewerId: 'p1', decision: 'accept' }),
      e('swarm.contribution_reviewed', { swarmId: 'sw1', contributionId: 'c1', decision: 'reject', reason: 'needs work' }),
      e('swarm.contribution_reviewed', { swarmId: 'sw1', contributionId: 'c1', decision: 'comment', reason: 'see also X' }),
    ]);
    const reviews = swarms.get('sw1').reviews['c1'];
    assert.equal(reviews.length, 3);
    assert.equal(reviews[0].decision, 'accept');
    assert.equal(reviews[1].decision, 'reject');
    assert.equal(reviews[2].decision, 'comment');
    assert.equal(reviews[2].reviewerId, null);
  });

  test('review on unknown contribution throws', () => {
    const swarms = swarmWithParticipant();
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.contribution_reviewed', {
      swarmId: 'sw1', contributionId: 'no-such', decision: 'accept',
    })));
    assert.equal(err.code, 'contribution_not_found');
  });

  test('contribution duplicate throws', () => {
    const swarms = swarmWithParticipant();
    foldSwarmEvent(swarms, e('swarm.contribution_recorded', { swarmId: 'sw1', contributionId: 'c1', participantId: 'p1', body: 'v1' }));
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.contribution_recorded', { swarmId: 'sw1', contributionId: 'c1', participantId: 'p1', body: 'v2' })));
    assert.equal(err.code, 'contribution_duplicate');
  });

  test('contribution with refs and without body both accepted', () => {
    const swarms = swarmWithParticipant();
    fold(swarms, [
      e('swarm.contribution_recorded', { swarmId: 'sw1', contributionId: 'c1', participantId: 'p1', refs: ['ref:a', 'ref:b'] }),
      e('swarm.contribution_recorded', { swarmId: 'sw1', contributionId: 'c2', participantId: 'p1' }),
    ]);
    const { contributions } = swarms.get('sw1');
    assert.deepEqual(contributions['c1'].refs, ['ref:a', 'ref:b']);
    assert.equal(contributions['c1'].body, null);
    assert.equal(contributions['c2'].refs, null);
  });

  test('contribution participant referential integrity', () => {
    const swarms = fresh();
    foldSwarmEvent(swarms, e('swarm.created', { swarmId: 'sw1', purpose: 'x' }));
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.contribution_recorded', {
      swarmId: 'sw1', contributionId: 'c1', participantId: 'nobody',
    })));
    assert.equal(err.code, 'participant_not_found');
  });

  test('contribution workId referential integrity', () => {
    const swarms = swarmWithParticipant();
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.contribution_recorded', {
      swarmId: 'sw1', contributionId: 'c1', participantId: 'p1', workId: 'no-work',
    })));
    assert.equal(err.code, 'work_not_found');
  });
});

// ── deterministic replay ─────────────────────────────────────────────────────

describe('deterministic replay', () => {
  test('replaying same event sequence produces byte-identical snapshot', () => {
    const events = [
      e('swarm.created', { swarmId: 'sw1', purpose: 'Implementation project' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'alice', role: 'lead', runId: 'run-alice' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'bob', parentId: 'alice', permissions: ['code'] }),
      e('swarm.work_updated', { swarmId: 'sw1', workId: 'w1', objective: 'Build feature', status: 'open' }),
      e('swarm.group_updated', { swarmId: 'sw1', groupId: 'g1', members: ['alice', 'bob'], purpose: 'Core team' }),
      e('swarm.assignment_updated', { swarmId: 'sw1', assignmentId: 'a1', participantId: 'bob', workId: 'w1', status: 'active' }),
      e('swarm.participant_bound', { swarmId: 'sw1', participantId: 'alice', workerId: 'wk1', taskId: 'tk1' }, { seq: 1, actor: 'system' }),
      e('swarm.context_updated', { swarmId: 'sw1', key: 'brief', body: { goal: 'Ship it' } }, { actor: 'alice', seq: 2 }),
      e('swarm.contribution_recorded', { swarmId: 'sw1', contributionId: 'c1', participantId: 'bob', workId: 'w1', body: 'WIP', refs: ['sha:abc'] }),
      e('swarm.contribution_reviewed', { swarmId: 'sw1', contributionId: 'c1', reviewerId: 'alice', decision: 'comment', reason: 'Keep going' }, { seq: 3 }),
      e('swarm.participant_left', { swarmId: 'sw1', participantId: 'bob', reason: 'handoff' }),
    ];

    const swarms1 = fresh();
    const swarms2 = fresh();
    for (const ev of events) {
      foldSwarmEvent(swarms1, ev);
      foldSwarmEvent(swarms2, ev);
    }

    const snap1 = swarmSnapshot(swarms1);
    const snap2 = swarmSnapshot(swarms2);
    assert.deepEqual(snap1, snap2);
    assert.equal(JSON.stringify(snap1), JSON.stringify(snap2));
  });

  test('snapshot keys are sorted deterministically', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'zebra', purpose: 'z' }),
      e('swarm.created', { swarmId: 'alpha', purpose: 'a' }),
    ]);
    const snap = swarmSnapshot(swarms);
    assert.equal(snap.swarms[0].swarmId, 'alpha');
    assert.equal(snap.swarms[1].swarmId, 'zebra');
  });

  test('snapshot participants are sorted by participantId', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'x' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'zed' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'ann' }),
    ]);
    const snap = swarmSnapshot(swarms);
    const ids = Object.keys(snap.swarms[0].participants);
    assert.deepEqual(ids, ['ann', 'zed']);
  });

  test('unknown event kind throws SwarmIntegrityError at fold', () => {
    const swarms = fresh();
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.frobnicate', { swarmId: 'sw1' })));
    assert.equal(err.code, 'unknown_event_kind');
  });
});

// ── cross-swarm references refused ──────────────────────────────────────────

describe('invalid cross-swarm references', () => {
  test('work in sw2 cannot reference participant from sw1', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'a' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'alice' }),
      e('swarm.created', { swarmId: 'sw2', purpose: 'b' }),
      e('swarm.work_updated', { swarmId: 'sw2', workId: 'w1', objective: 'x' }),
    ]);
    // alice is in sw1, not sw2
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.assignment_updated', {
      swarmId: 'sw2', assignmentId: 'a1', participantId: 'alice', workId: 'w1', status: 'active',
    })));
    assert.equal(err.code, 'participant_not_found');
  });

  test('context groupId must be a group in the same swarm', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'a' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'alice' }),
      e('swarm.group_updated', { swarmId: 'sw1', groupId: 'g1', members: ['alice'] }),
      e('swarm.created', { swarmId: 'sw2', purpose: 'b' }),
    ]);
    // g1 is in sw1, not sw2
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.context_updated', {
      swarmId: 'sw2', key: 'k', body: 'data', groupId: 'g1',
    })));
    assert.equal(err.code, 'group_not_found');
  });

  test('parent from different swarm is unknown identity', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'a' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'alice' }),
      e('swarm.created', { swarmId: 'sw2', purpose: 'b' }),
    ]);
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.participant_joined', {
      swarmId: 'sw2', participantId: 'bob', parentId: 'alice',
    })));
    assert.equal(err.code, 'participant_not_found');
  });
});

// ── no arbitrary caps ────────────────────────────────────────────────────────

describe('no arbitrary caps', () => {
  test('many participants join without limit', () => {
    const swarms = fresh();
    foldSwarmEvent(swarms, e('swarm.created', { swarmId: 'sw1', purpose: 'big' }));
    for (let i = 0; i < 50; i++) {
      foldSwarmEvent(swarms, e('swarm.participant_joined', { swarmId: 'sw1', participantId: `p${i}` }));
    }
    assert.equal(Object.keys(swarms.get('sw1').participants).length, 50);
  });

  test('many contributions recorded without limit', () => {
    const swarms = swarmWithParticipant();
    for (let i = 0; i < 30; i++) {
      foldSwarmEvent(swarms, e('swarm.contribution_recorded', {
        swarmId: 'sw1', contributionId: `c${i}`, participantId: 'p1', body: `item ${i}`,
      }));
    }
    assert.equal(Object.keys(swarms.get('sw1').contributions).length, 30);
  });
});

// ── exported constants ───────────────────────────────────────────────────────

describe('exported status constants', () => {
  test('SWARM_WORK_STATUSES contains expected values', () => {
    assert.deepEqual([...SWARM_WORK_STATUSES], ['open', 'completed', 'cancelled']);
  });

  test('SWARM_ASSIGNMENT_STATUSES contains expected values', () => {
    assert.deepEqual([...SWARM_ASSIGNMENT_STATUSES], ['active', 'released']);
  });

  test('SWARM_REVIEW_DECISIONS contains expected values', () => {
    assert.deepEqual([...SWARM_REVIEW_DECISIONS], ['accept', 'reject', 'comment']);
  });
});

// ── swarmSnapshot completeness ────────────────────────────────────────────────

describe('swarmSnapshot completeness', () => {
  test('snapshot of empty map returns empty swarms array', () => {
    const snap = swarmSnapshot(fresh());
    assert.deepEqual(snap, { swarms: [] });
  });

  test('full lifecycle snapshot has correct shape', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'Full test' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'alice', role: 'lead', runId: 'r1', permissions: ['write'] }),
      e('swarm.participant_bound', { swarmId: 'sw1', participantId: 'alice', workerId: 'wk1', taskId: 'tk1', sessionId: 'sess1' }, { seq: 1 }),
      e('swarm.work_updated', { swarmId: 'sw1', workId: 'w1', objective: 'Ship', status: 'open' }),
      e('swarm.group_updated', { swarmId: 'sw1', groupId: 'g1', members: ['alice'], purpose: 'Leads' }),
      e('swarm.assignment_updated', { swarmId: 'sw1', assignmentId: 'as1', participantId: 'alice', workId: 'w1', status: 'active' }),
      e('swarm.context_updated', { swarmId: 'sw1', key: 'readme', body: 'Hello', groupId: 'g1' }, { actor: 'alice', seq: 2 }),
      e('swarm.contribution_recorded', { swarmId: 'sw1', contributionId: 'c1', participantId: 'alice', workId: 'w1', body: 'done', refs: ['sha:xyz'] }),
      e('swarm.contribution_reviewed', { swarmId: 'sw1', contributionId: 'c1', reviewerId: 'alice', decision: 'accept' }, { seq: 3 }),
    ]);

    const snap = swarmSnapshot(swarms);
    const s = snap.swarms[0];

    assert.equal(s.swarmId, 'sw1');
    assert.equal(s.status, 'open');

    const alice = s.participants['alice'];
    assert.equal(alice.role, 'lead');
    assert.equal(alice.runId, 'r1');
    assert.deepEqual(alice.permissions, ['write']);
    assert.equal(alice.bindings[0].workerId, 'wk1');
    assert.equal(alice.bindings[0].seq, 1);

    assert.equal(s.work['w1'].status, 'open');
    assert.equal(s.groups['g1'].purpose, 'Leads');
    assert.equal(s.assignments['as1'].status, 'active');
    const ctxReadme = s.context[swarmContextKey('readme', 'g1')];
    assert.equal(ctxReadme.body, 'Hello');
    assert.equal(ctxReadme.groupId, 'g1');
    assert.equal(ctxReadme.actor, 'alice');
    assert.equal(s.contributions['c1'].body, 'done');
    assert.deepEqual(s.contributions['c1'].refs, ['sha:xyz']);
    assert.equal(s.reviews['c1'][0].decision, 'accept');
    assert.equal(s.reviews['c1'][0].reviewerId, 'alice');
  });
});

// ── new invariant tests ───────────────────────────────────────────────────────

describe('nested mutation resistance', () => {
  test('mutating body object after fold does not affect stored context', () => {
    const swarms = swarmWithParticipant();
    const body = { a: { b: 1 } };
    foldSwarmEvent(swarms, e('swarm.context_updated', { swarmId: 'sw1', key: 'k', body }));
    body.a.b = 999;
    body.extra = 'injected';
    const stored = swarms.get('sw1').context[swarmContextKey('k')].body;
    assert.equal(stored.a.b, 1, 'nested mutation must not affect stored body');
    assert.equal(stored.extra, undefined, 'injected key must not appear');
  });

  test('mutating body object after fold does not affect stored contribution', () => {
    const swarms = swarmWithParticipant();
    const body = { data: [1, 2, 3] };
    foldSwarmEvent(swarms, e('swarm.contribution_recorded', {
      swarmId: 'sw1', contributionId: 'c1', participantId: 'p1', body,
    }));
    body.data.push(4);
    const stored = swarms.get('sw1').contributions['c1'].body;
    assert.equal(stored.data.length, 3, 'array push must not affect stored body');
  });

  test('body with __proto__ own key roundtrips without prototype mutation', () => {
    const swarms = swarmWithParticipant();
    // JSON.parse produces a plain object with __proto__ as an own property.
    const body = JSON.parse('{"__proto__":{"evil":true},"safe":1}');
    assert.ok(Object.prototype.hasOwnProperty.call(body, '__proto__'), 'fixture has own __proto__');
    foldSwarmEvent(swarms, e('swarm.context_updated', { swarmId: 'sw1', key: 'k', body }));
    const stored = swarms.get('sw1').context[swarmContextKey('k')].body;
    // __proto__ must be preserved as an own data property, not silently dropped or as a setter side-effect.
    assert.ok(Object.prototype.hasOwnProperty.call(stored, '__proto__'), '__proto__ must survive as own property');
    assert.equal(stored.safe, 1);
    // The prototype of 'stored' must remain Object.prototype (not been mutated).
    assert.equal(Object.getPrototypeOf(stored), Object.prototype);
  });
});

describe('prototype-named participant ids', () => {
  test('__proto__ and constructor as participantIds work safely', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'proto test' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: '__proto__' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'constructor' }),
    ]);
    const swarm = swarms.get('sw1');
    assert.ok(Object.prototype.hasOwnProperty.call(swarm.participants, '__proto__'));
    assert.ok(Object.prototype.hasOwnProperty.call(swarm.participants, 'constructor'));
    assert.equal(swarm.participants['__proto__'].status, 'active');
    assert.equal(swarm.participants['constructor'].status, 'active');
  });

  test('participant with __proto__ id can receive a binding', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'x' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: '__proto__' }),
      e('swarm.participant_bound', { swarmId: 'sw1', participantId: '__proto__', workerId: 'w1', taskId: 't1' }),
    ]);
    const p = swarms.get('sw1').participants['__proto__'];
    assert.equal(p.bindings.length, 1);
    assert.equal(p.bindings[0].workerId, 'w1');
  });
});

describe('admission/replay parity', () => {
  test('shapes that validateSwarmEvent rejects are also rejected at fold', () => {
    const cases = [
      ['swarm.created', { swarmId: 'sw1' }],                   // missing purpose
      ['swarm.participant_joined', { swarmId: 'sw1' }],         // missing participantId
      ['swarm.work_updated', { swarmId: 'sw1', workId: 'w1' }], // missing objective
    ];
    for (const [kind, payload] of cases) {
      const swarms = fresh();
      const validateErr = refusals(() => validateSwarmEvent(kind, payload));
      const foldErr = integrity(() => foldSwarmEvent(swarms, { kind, payload }));
      assert.equal(foldErr.code, validateErr.code, `code mismatch for ${kind}`);
    }
  });
});

describe('expectedVersion: 0 create-if-absent CAS', () => {
  test('expectedVersion:0 on a new group succeeds (create-if-absent)', () => {
    const swarms = swarmWithParticipant();
    // version 0 = "I expect no row yet" — must not throw
    assert.doesNotThrow(() => foldSwarmEvent(swarms, e('swarm.group_updated', {
      swarmId: 'sw1', groupId: 'g1', members: ['p1'], expectedVersion: 0,
    })));
    assert.equal(swarms.get('sw1').groups['g1'].version, 1);
  });

  test('expectedVersion:0 on an existing group throws version_conflict', () => {
    const swarms = swarmWithParticipant();
    foldSwarmEvent(swarms, e('swarm.group_updated', { swarmId: 'sw1', groupId: 'g1', members: ['p1'] }));
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.group_updated', {
      swarmId: 'sw1', groupId: 'g1', members: ['p1'], expectedVersion: 0,
    })));
    assert.equal(err.code, 'version_conflict');
  });
});

describe('group context isolation', () => {
  test('same key in two different group scopes are independent', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'x' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'a' }),
      e('swarm.group_updated', { swarmId: 'sw1', groupId: 'g1', members: ['a'] }),
      e('swarm.group_updated', { swarmId: 'sw1', groupId: 'g2', members: ['a'] }),
      e('swarm.context_updated', { swarmId: 'sw1', key: 'notes', body: 'for g1', groupId: 'g1' }),
      e('swarm.context_updated', { swarmId: 'sw1', key: 'notes', body: 'for g2', groupId: 'g2' }),
      e('swarm.context_updated', { swarmId: 'sw1', key: 'notes', body: 'global' }),
    ]);
    const ctx = swarms.get('sw1').context;
    assert.equal(ctx[swarmContextKey('notes', 'g1')].body, 'for g1');
    assert.equal(ctx[swarmContextKey('notes', 'g2')].body, 'for g2');
    assert.equal(ctx[swarmContextKey('notes')].body, 'global');
    // Three separate entries
    assert.equal(Object.keys(ctx).length, 3);
  });

  test('same key in same group bumps version, not a second entry', () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'x' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'a' }),
      e('swarm.group_updated', { swarmId: 'sw1', groupId: 'g1', members: ['a'] }),
      e('swarm.context_updated', { swarmId: 'sw1', key: 'notes', body: 'v1', groupId: 'g1' }),
      e('swarm.context_updated', { swarmId: 'sw1', key: 'notes', body: 'v2', groupId: 'g1' }),
    ]);
    const ctx = swarms.get('sw1').context;
    assert.equal(Object.keys(ctx).length, 1);
    assert.equal(ctx[swarmContextKey('notes', 'g1')].version, 2);
    assert.equal(ctx[swarmContextKey('notes', 'g1')].body, 'v2');
  });
});

describe('reviewer referential validity', () => {
  test('reviewerId must be a known participant', () => {
    const swarms = swarmWithParticipant();
    foldSwarmEvent(swarms, e('swarm.contribution_recorded', {
      swarmId: 'sw1', contributionId: 'c1', participantId: 'p1',
    }));
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.contribution_reviewed', {
      swarmId: 'sw1', contributionId: 'c1', reviewerId: 'nobody', decision: 'accept',
    })));
    assert.equal(err.code, 'participant_not_found');
  });

  test('omitting reviewerId (anonymous review) is allowed', () => {
    const swarms = swarmWithParticipant();
    foldSwarmEvent(swarms, e('swarm.contribution_recorded', {
      swarmId: 'sw1', contributionId: 'c1', participantId: 'p1',
    }));
    assert.doesNotThrow(() => foldSwarmEvent(swarms, e('swarm.contribution_reviewed', {
      swarmId: 'sw1', contributionId: 'c1', decision: 'comment', reason: 'anon note',
    })));
    assert.equal(swarms.get('sw1').reviews['c1'][0].reviewerId, null);
  });
});

describe('body validation', () => {
  test('circular reference in body throws SwarmRefusal', () => {
    const a = {};
    a.self = a;
    const err = refusals(() => validateSwarmEvent('swarm.context_updated', { swarmId: 'sw1', key: 'k', body: a }));
    assert.equal(err.code, 'invalid_body');
  });

  test('function in body throws SwarmRefusal', () => {
    const err = refusals(() => validateSwarmEvent('swarm.context_updated', {
      swarmId: 'sw1', key: 'k', body: { fn: () => {} },
    }));
    assert.equal(err.code, 'invalid_body');
  });

  test('NaN in body throws SwarmRefusal', () => {
    const err = refusals(() => validateSwarmEvent('swarm.context_updated', {
      swarmId: 'sw1', key: 'k', body: { x: NaN },
    }));
    assert.equal(err.code, 'invalid_body');
  });

  test('Infinity in body throws SwarmRefusal', () => {
    const err = refusals(() => validateSwarmEvent('swarm.context_updated', {
      swarmId: 'sw1', key: 'k', body: { x: Infinity },
    }));
    assert.equal(err.code, 'invalid_body');
  });

  test('Date instance in body throws SwarmRefusal', () => {
    const err = refusals(() => validateSwarmEvent('swarm.context_updated', {
      swarmId: 'sw1', key: 'k', body: { d: new Date() },
    }));
    assert.equal(err.code, 'invalid_body');
  });

  test('Map instance in body throws SwarmRefusal', () => {
    const err = refusals(() => validateSwarmEvent('swarm.context_updated', {
      swarmId: 'sw1', key: 'k', body: new Map(),
    }));
    assert.equal(err.code, 'invalid_body');
  });

  test('Set instance in body throws SwarmRefusal', () => {
    const err = refusals(() => validateSwarmEvent('swarm.context_updated', {
      swarmId: 'sw1', key: 'k', body: { s: new Set() },
    }));
    assert.equal(err.code, 'invalid_body');
  });

  test('plain nested JSON object body is accepted', () => {
    assert.doesNotThrow(() => validateSwarmEvent('swarm.context_updated', {
      swarmId: 'sw1', key: 'k', body: { a: 1, b: [true, 'x', null], c: { d: 2.5 } },
    }));
  });
});

// ── declared coupling and dependencies (issue #263 item 2) ──────────────────

describe('work dependencies', () => {
  test('dependsOn is stored on the work row and preserved by later updates', () => {
    const swarms = swarmWithParticipant();
    fold(swarms, [e('swarm.work_updated', { swarmId: 'sw1', workId: 'W1', objective: 'one' })]);
    foldSwarmEvent(swarms, e('swarm.work_updated', { swarmId: 'sw1', workId: 'W2', objective: 'two', dependsOn: [{ workId: 'W1' }] }));
    assert.deepEqual(swarms.get('sw1').work.W2.dependsOn, [{ workId: 'W1' }]);
    foldSwarmEvent(swarms, e('swarm.work_updated', { swarmId: 'sw1', workId: 'W2', objective: 'two', status: 'completed' }));
    assert.deepEqual(swarms.get('sw1').work.W2.dependsOn, [{ workId: 'W1' }], 'a status-only update keeps the declared set');
    foldSwarmEvent(swarms, e('swarm.work_updated', { swarmId: 'sw1', workId: 'W2', objective: 'two', dependsOn: [] }));
    assert.deepEqual(swarms.get('sw1').work.W2.dependsOn, [], 'an explicit empty set replaces the declared dependencies');
  });

  test('rows written before the field existed carry no dependsOn key', () => {
    const swarms = swarmWithParticipant();
    foldSwarmEvent(swarms, e('swarm.work_updated', { swarmId: 'sw1', workId: 'W', objective: 'plain' }));
    assert.equal(Object.hasOwn(swarms.get('sw1').work.W, 'dependsOn'), false);
  });

  test('shape errors: non-array, ambiguous, and empty entries refuse', () => {
    const bad = [
      'nope',
      [{ workId: 'W1', artifact: 'a' }],
      [{}],
      ['W1'],
    ];
    for (const dependsOn of bad) {
      const err = refusals(() => validateSwarmEvent('swarm.work_updated', {
        swarmId: 'sw1', workId: 'W2', objective: 'x', dependsOn,
      }));
      assert.equal(err.code, 'invalid_payload');
    }
    assert.doesNotThrow(() => validateSwarmEvent('swarm.work_updated', {
      swarmId: 'sw1', workId: 'W2', objective: 'x', dependsOn: [{ artifact: 'iface' }],
    }));
  });

  test('unknown targets, self-dependency, and cycles refuse at the fold', () => {
    const swarms = swarmWithParticipant();
    fold(swarms, [
      e('swarm.work_updated', { swarmId: 'sw1', workId: 'W1', objective: 'one' }),
      e('swarm.work_updated', { swarmId: 'sw1', workId: 'W2', objective: 'two', dependsOn: [{ workId: 'W1' }] }),
    ]);
    let err = integrity(() => foldSwarmEvent(swarms, e('swarm.work_updated', {
      swarmId: 'sw1', workId: 'W3', objective: 'three', dependsOn: [{ workId: 'W9' }],
    })));
    assert.equal(err.code, 'work_not_found');
    err = integrity(() => foldSwarmEvent(swarms, e('swarm.work_updated', {
      swarmId: 'sw1', workId: 'W3', objective: 'three', dependsOn: [{ workId: 'W3' }],
    })));
    assert.equal(err.code, 'work_dependency_self');
    err = integrity(() => foldSwarmEvent(swarms, e('swarm.work_updated', {
      swarmId: 'sw1', workId: 'W1', objective: 'one', dependsOn: [{ workId: 'W2' }],
    })));
    assert.equal(err.code, 'work_dependency_cycle');
    assert.match(err.message, /W1 -> W2 -> W1/u, 'the refusal names the ring');
  });
});

describe('declared couplings', () => {
  const groupOfTwo = () => {
    const swarms = fresh();
    fold(swarms, [
      e('swarm.created', { swarmId: 'sw1', purpose: 'coupled' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'a' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'b' }),
      e('swarm.group_updated', { swarmId: 'sw1', groupId: 'g', members: ['a', 'b'] }),
    ]);
    return swarms;
  };

  test('a synchronization point records arrivals in order and releases with who and why', () => {
    const swarms = groupOfTwo();
    fold(swarms, [e('swarm.coupling_updated', {
      swarmId: 'sw1', couplingId: 'sync', coupling: 'synchronization', action: 'declare', groupId: 'g', name: 'freeze',
    })]);
    const record = swarms.get('sw1').couplings.sync;
    assert.deepEqual(record.arrivals, []);
    assert.equal(record.released, false);
    fold(swarms, [
      e('swarm.coupling_updated', { swarmId: 'sw1', couplingId: 'sync', coupling: 'synchronization', action: 'arrive', participantId: 'b' }, { seq: 7, ts: 'ts-7', actor: 'worker:w-b' }),
      e('swarm.coupling_updated', { swarmId: 'sw1', couplingId: 'sync', coupling: 'synchronization', action: 'arrive', participantId: 'a' }, { seq: 8, ts: 'ts-8', actor: 'worker:w-a' }),
      e('swarm.coupling_updated', { swarmId: 'sw1', couplingId: 'sync', coupling: 'synchronization', action: 'release', participantId: 'a', reason: 'all arrived' }),
    ]);
    const settled = swarms.get('sw1').couplings.sync;
    // An arrival names its seat, the actor that made the report, and WHEN it was made: the barrier
    // is answerable from the artifact, not from a watch log.
    assert.deepEqual(settled.arrivals, [
      { participantId: 'b', actor: 'worker:w-b', seq: 7, ts: 'ts-7' },
      { participantId: 'a', actor: 'worker:w-a', seq: 8, ts: 'ts-8' },
    ], 'arrival order is log order, each arrival carrying its actor and timestamp');
    assert.equal(settled.released, true);
    assert.equal(settled.releasedBy, 'a');
    assert.equal(settled.releaseReason, 'all arrived');
  });

  test('coupling state errors refuse with the missing fact named', () => {
    const swarms = groupOfTwo();
    const declare = (couplingId, extra = {}) => e('swarm.coupling_updated', {
      swarmId: 'sw1', couplingId, coupling: 'synchronization', action: 'declare', groupId: 'g', name: 'freeze', ...extra,
    });
    let err = integrity(() => foldSwarmEvent(swarms, declare('s', { groupId: 'nope' })));
    assert.equal(err.code, 'group_not_found');
    err = integrity(() => foldSwarmEvent(swarms, e('swarm.coupling_updated', {
      swarmId: 'sw1', couplingId: 's', coupling: 'synchronization', action: 'arrive', participantId: 'a',
    })));
    assert.equal(err.code, 'coupling_not_found');
    fold(swarms, [declare('s')]);
    err = integrity(() => foldSwarmEvent(swarms, e('swarm.coupling_updated', {
      swarmId: 'sw1', couplingId: 's', coupling: 'synchronization', action: 'arrive', participantId: 'stranger',
    })));
    assert.equal(err.code, 'participant_not_found');
    fold(swarms, [e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'stranger' })]);
    err = integrity(() => foldSwarmEvent(swarms, e('swarm.coupling_updated', {
      swarmId: 'sw1', couplingId: 's', coupling: 'synchronization', action: 'arrive', participantId: 'stranger',
    })));
    assert.equal(err.code, 'swarm_not_a_member');
    foldSwarmEvent(swarms, e('swarm.coupling_updated', {
      swarmId: 'sw1', couplingId: 's', coupling: 'synchronization', action: 'arrive', participantId: 'a',
    }));
    err = integrity(() => foldSwarmEvent(swarms, e('swarm.coupling_updated', {
      swarmId: 'sw1', couplingId: 's', coupling: 'synchronization', action: 'arrive', participantId: 'a',
    })));
    assert.equal(err.code, 'swarm_already_arrived');
    foldSwarmEvent(swarms, e('swarm.coupling_updated', {
      swarmId: 'sw1', couplingId: 's', coupling: 'synchronization', action: 'release', participantId: 'a', reason: 'done',
    }));
    err = integrity(() => foldSwarmEvent(swarms, e('swarm.coupling_updated', {
      swarmId: 'sw1', couplingId: 's', coupling: 'synchronization', action: 'arrive', participantId: 'b',
    })));
    assert.equal(err.code, 'swarm_coupling_released');
  });

  test('an exclusive writer claims the checkout its participant is recorded in; one writer per checkout', () => {
    const swarms = groupOfTwo();
    fold(swarms, [
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'sharer', parentId: 'a', workspaceId: 'ws-' + 'a'.repeat(32) }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'joiner', parentId: 'a', workspaceId: 'ws-' + 'a'.repeat(32) }),
    ]);
    foldSwarmEvent(swarms, e('swarm.coupling_updated', {
      swarmId: 'sw1', couplingId: 'writer', coupling: 'writer', action: 'declare', participantId: 'sharer',
    }));
    const record = swarms.get('sw1').couplings.writer;
    assert.equal(record.writer, 'sharer');
    let err = integrity(() => foldSwarmEvent(swarms, e('swarm.coupling_updated', {
      swarmId: 'sw1', couplingId: 'writer2', coupling: 'writer', action: 'declare', participantId: 'joiner',
    })));
    assert.equal(err.code, 'swarm_writer_conflict', 'the same checkout refuses a second writer');
    err = integrity(() => foldSwarmEvent(swarms, e('swarm.coupling_updated', {
      swarmId: 'sw1', couplingId: 'writer3', coupling: 'writer', action: 'declare',
    })));
    assert.equal(err.code, 'invalid_payload', 'a claim must name its writer');
    // A checkout the writer is not recorded in is not a resource this record may name: the claim
    // refuses instead of landing with no identity to enforce exclusivity over (audit #292).
    err = integrity(() => foldSwarmEvent(swarms, e('swarm.coupling_updated', {
      swarmId: 'sw1', couplingId: 'writer-private', coupling: 'writer', action: 'declare', participantId: 'b',
    }), { admission: true }));
    assert.equal(err.code, 'swarm_writer_workspace_unrecorded');
    assert.match(err.message, /participant b has no recorded checkout/u, 'the refusal names the unarmed claim');
    // The same row read back from a ledger written before the rule is history, not a request: it
    // folds as recorded (no checkout named) instead of refusing the resident its own past. Regression
    // 2026-09-14: a resident at the #292 landing could not start over a deployment whose ledger
    // carried such a claim.
    {
      const history = groupOfTwo();
      fold(history, [e('swarm.coupling_updated', {
        swarmId: 'sw1', couplingId: 'writer-private', coupling: 'writer', action: 'declare', participantId: 'b',
      })]);
      assert.equal(history.get('sw1').couplings['writer-private'].writer, 'b', 'recorded history folds');
      assert.equal(history.get('sw1').couplings['writer-private'].workspaceId, null, 'as it was admitted: no checkout named');
    }
    // A participant recorded in ANOTHER checkout is a different resource: one writer per checkout.
    fold(swarms, [e('swarm.participant_bound', { swarmId: 'sw1', participantId: 'b', workerId: 'w-b', taskId: 't-b',
      workspaceId: 'ws-' + 'b'.repeat(32) })]);
    foldSwarmEvent(swarms, e('swarm.coupling_updated', {
      swarmId: 'sw1', couplingId: 'writer-private', coupling: 'writer', action: 'declare', participantId: 'b',
    }));
    assert.equal(swarms.get('sw1').couplings['writer-private'].workspaceId, 'ws-' + 'b'.repeat(32));
    // Releasing the record frees the checkout, and the released checkout is claimable by the next
    // writer who is recorded in it.
    foldSwarmEvent(swarms, e('swarm.coupling_updated', {
      swarmId: 'sw1', couplingId: 'writer', coupling: 'writer', action: 'release', participantId: 'sharer',
    }));
    foldSwarmEvent(swarms, e('swarm.coupling_updated', {
      swarmId: 'sw1', couplingId: 'writer-next', coupling: 'writer', action: 'declare', participantId: 'joiner',
    }));
    assert.equal(swarms.get('sw1').couplings['writer-next'].writer, 'joiner');
    // The release names its ACTOR, not the seat the request happened to name.
    assert.equal(swarms.get('sw1').couplings.writer.releasedBy, 'sharer');
  });

  test('a failure policy is one per group until released', () => {
    const swarms = groupOfTwo();
    foldSwarmEvent(swarms, e('swarm.coupling_updated', {
      swarmId: 'sw1', couplingId: 'policy', coupling: 'failure', action: 'declare', groupId: 'g', policy: 'independent',
    }));
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.coupling_updated', {
      swarmId: 'sw1', couplingId: 'policy-2', coupling: 'failure', action: 'declare', groupId: 'g', policy: 'independent',
    })));
    assert.equal(err.code, 'swarm_coupling_conflict');
    assert.equal(swarms.get('sw1').couplings.policy.policy, 'independent');
  });

  test('re-declaring replaces the parameters and CARRIES the arrivals forward, saying so on the row', () => {
    const events = [
      e('swarm.created', { swarmId: 'sw1', purpose: 'replay' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'a' }),
      e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'b' }),
      e('swarm.group_updated', { swarmId: 'sw1', groupId: 'g', members: ['a', 'b'] }),
      e('swarm.work_updated', { swarmId: 'sw1', workId: 'W1', objective: 'one' }),
      e('swarm.work_updated', { swarmId: 'sw1', workId: 'W2', objective: 'two', dependsOn: [{ workId: 'W1' }] }),
      e('swarm.coupling_updated', { swarmId: 'sw1', couplingId: 'sync', coupling: 'synchronization', action: 'declare', groupId: 'g', name: 'freeze' }),
      e('swarm.coupling_updated', { swarmId: 'sw1', couplingId: 'sync', coupling: 'synchronization', action: 'arrive', participantId: 'a' }, { seq: 9, ts: 'ts-9' }),
      e('swarm.participant_bound', { swarmId: 'sw1', participantId: 'a', workerId: 'w-a', taskId: 't-a', workspaceId: 'ws-' + 'a'.repeat(32) }),
      e('swarm.coupling_updated', { swarmId: 'sw1', couplingId: 'writer', coupling: 'writer', action: 'declare', participantId: 'a' }),
    ];
    const first = fold(fresh(), events);
    const second = fold(fresh(), events);
    assert.equal(JSON.stringify(swarmSnapshot(first)), JSON.stringify(swarmSnapshot(second)),
      'the same event sequence folds byte-identically');
    fold(fresh(), events);
    foldSwarmEvent(first, e('swarm.coupling_updated', {
      swarmId: 'sw1', couplingId: 'sync', coupling: 'synchronization', action: 'declare', groupId: 'g', name: 'freeze-2',
    }, { seq: 11, ts: 'ts-11' }));
    const redeclared = first.get('sw1').couplings.sync;
    assert.equal(redeclared.name, 'freeze-2', 'the re-declare replaces the point\'s parameters');
    assert.deepEqual(redeclared.arrivals.map((arrival) => arrival.participantId), ['a'],
      'the arrival the member already reported survives the re-declare');
    assert.deepEqual(redeclared.carriedArrivals, ['a'],
      'and the record says which arrivals this declare carried forward');
    // A first declare carries nothing, and says exactly that: the field is only a re-declare fact.
    assert.equal(fold(fresh(), events.slice(0, 7)).get('sw1').couplings.sync.carriedArrivals, null);
  });
});
