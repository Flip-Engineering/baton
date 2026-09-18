// Issue #395 — swarm.group_updated refuses unless every named member is still active, forcing
// silent eviction rewrites on unrelated roster edits. A seat that LEFT (swarm.participant_left,
// #350 settles status left with reason stopped|completed) stayed in every group it belonged to,
// so any later group_updated that carried the existing member list (an unrelated edit: rename,
// add one seat, change the failure policy) was refused with participant_not_active on a seat the
// edit did not touch — until the caller silently rewrote the roster to drop every departed seat
// first. The repair converges on #350's settled-status seam: the participant_left fold evicts the
// departed seat from every group it is a member of, recording the eviction on the group row
// (departed: [{participantId, at, seq}] — ONE shape) and bumping the group version, so a group's
// members always lists seats that can act. group_updated still refuses a seat that never existed
// (participant_not_found) and a seat that is not active (participant_not_active), but the
// departed-seat refusal now carries the repairable coordinates: detail
// {groupId, participantId, status, sinceSeq} and a remedy naming the exact members array to
// resend (the current active set). No silent rewrite by the fold — the fold only ever evicts on
// the leave itself, never on an unrelated caller's edit.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SwarmIntegrityError,
  foldSwarmEvent,
  swarmSnapshot,
} from '../src/swarm-state.mjs';

// ── helpers (swarm-state.test.mjs fold fixtures) ─────────────────────────────

const fresh = () => new Map();

function fold(swarms, events) {
  for (const event of events) foldSwarmEvent(swarms, event);
  return swarms;
}

function e(kind, payload, meta = {}) {
  return { kind, payload, ...meta };
}

function integrity(fn) {
  let threw = null;
  try { fn(); } catch (err) { threw = err; }
  assert.ok(threw instanceof SwarmIntegrityError,
    `expected SwarmIntegrityError, got ${threw?.constructor?.name}: ${threw?.message}`);
  return threw;
}

// Two seats (a, b) share group g1; b and c share g2. Every event carries its log position so the
// departed rows can be pinned to the leave's seq.
function swarmWithGroups() {
  const swarms = fresh();
  fold(swarms, [
    e('swarm.created', { swarmId: 'sw1', purpose: 'roster honesty' }, { seq: 1, ts: 100 }),
    e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'a' }, { seq: 2, ts: 200 }),
    e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'b' }, { seq: 3, ts: 300 }),
    e('swarm.participant_joined', { swarmId: 'sw1', participantId: 'c' }, { seq: 4, ts: 400 }),
    e('swarm.group_updated', { swarmId: 'sw1', groupId: 'g1', members: ['a', 'b'], purpose: 'Impl' }, { seq: 5, ts: 500 }),
    e('swarm.group_updated', { swarmId: 'sw1', groupId: 'g2', members: ['b', 'c'], purpose: 'Review' }, { seq: 6, ts: 600 }),
  ]);
  return swarms;
}

// a leaves (the #350 stop settles membership through this same fold: status left, reason stopped).
function aLeaves(swarms) {
  foldSwarmEvent(swarms, e('swarm.participant_left',
    { swarmId: 'sw1', participantId: 'a', reason: 'stopped' }, { seq: 7, ts: 700 }));
}

// ── the fold evicts a departed seat from its groups ──────────────────────────

describe('issue395: group eviction on leave', () => {
  test('395a: a seat that leaves is evicted from its groups with the departed row and a version bump', () => {
    const swarms = swarmWithGroups();
    aLeaves(swarms);
    const swarm = swarms.get('sw1');

    // The seat settled (the #350 shape) ...
    assert.equal(swarm.participants.a.status, 'left');
    assert.equal(swarm.participants.a.leftReason, 'stopped');

    // ... and g1 no longer names it: the eviction is recorded on the group row with the ONE
    // departed shape and the roster version moves, so a concurrent caller's expectedVersion
    // collides honestly instead of silently rewriting over the eviction.
    assert.deepEqual(swarm.groups.g1.members, ['b']);
    assert.equal(swarm.groups.g1.version, 2);
    assert.deepEqual(swarm.groups.g1.departed, [{ participantId: 'a', at: 700, seq: 7 }]);

    // A group the seat did not belong to is untouched — eviction follows membership.
    assert.deepEqual(swarm.groups.g2.members, ['b', 'c']);
    assert.equal(swarm.groups.g2.version, 1);
    assert.deepEqual(swarm.groups.g2.departed, []);
  });

  test('395b: a later group_updated carrying only the remaining active members is accepted without any caller-side rewrite', () => {
    const swarms = swarmWithGroups();
    aLeaves(swarms);
    // The unrelated edit the issue opens with: a purpose rename that resends the member list the
    // view already shows. Before the fold evicted on leave, this was refused
    // participant_not_active on seat a — an edit that never touched a — until the caller
    // silently rewrote the roster first.
    foldSwarmEvent(swarms, e('swarm.group_updated',
      { swarmId: 'sw1', groupId: 'g1', members: ['b'], purpose: 'Impl, now reviewed', expectedVersion: 2 },
      { seq: 8, ts: 800 }));

    const swarm = swarms.get('sw1');
    assert.equal(swarm.groups.g1.purpose, 'Impl, now reviewed');
    assert.deepEqual(swarm.groups.g1.members, ['b']);
    assert.equal(swarm.groups.g1.version, 3);
    // The eviction record is history: a rewrite of the live roster never un-records who left.
    assert.deepEqual(swarm.groups.g1.departed, [{ participantId: 'a', at: 700, seq: 7 }]);
  });

  test('395c: a group_updated naming the departed seat refuses participant_not_active with the detail and remedy', () => {
    const swarms = swarmWithGroups();
    aLeaves(swarms);
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.group_updated',
      { swarmId: 'sw1', groupId: 'g1', members: ['a', 'b'] }, { seq: 8, ts: 800 })));
    assert.equal(err.code, 'participant_not_active');
    // The repairable coordinates: which group, which seat, the settled status, since which log
    // position — and the exact members array to resend (the current active set). No silent
    // rewrite by the fold: the caller repairs, the fold never rewrites on their behalf.
    assert.deepEqual(err.detail, {
      groupId: 'g1',
      participantId: 'a',
      status: 'left',
      sinceSeq: 7,
      remedy: { members: ['b'], note: 'resend exactly these members — the current active set of this group' },
    });
    assert.match(err.message, /g1/);
    assert.match(err.message, /\ba\b/);
    // Nothing was folded: the roster is unchanged.
    assert.deepEqual(swarms.get('sw1').groups.g1.members, ['b']);
  });

  test('395c2: a member that never existed still refuses participant_not_found', () => {
    const swarms = swarmWithGroups();
    const err = integrity(() => foldSwarmEvent(swarms, e('swarm.group_updated',
      { swarmId: 'sw1', groupId: 'g1', members: ['nobody'] }, { seq: 7, ts: 700 })));
    assert.equal(err.code, 'participant_not_found');
  });

  test('395d: the view projects departed beside members', () => {
    const swarms = swarmWithGroups();
    aLeaves(swarms);
    const view = swarmSnapshot(swarms);
    const swarm = view.swarms.find((row) => row.swarmId === 'sw1');
    assert.deepEqual(swarm.groups.g1.members, ['b']);
    assert.deepEqual(swarm.groups.g1.departed, [{ participantId: 'a', at: 700, seq: 7 }]);
    // The ONE shape everywhere: a group that never lost a member renders an empty departed row.
    assert.deepEqual(swarm.groups.g2.departed, []);
  });
});
