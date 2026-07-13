import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { WebEventStream } from '../src/web-stream.mjs';

const ORIGIN = 'https://control.test';
const REPO = 'repo-stream';
const GOAL_ID = `goal:${'a'.repeat(64)}`;
const PLAN_ID = `plan:${'b'.repeat(64)}`;
const GOAL_DIGEST = 'c'.repeat(64);
const PLAN_DIGEST = 'd'.repeat(64);
const APPROVAL_DIGEST = 'e'.repeat(64);
const PRIVATE = Object.freeze({
  goalPrincipal: 'principal-goal-private', proposerPrincipal: 'principal-plan-private',
  approvalPrincipal: 'principal-approval-private', sessionDigest: 'session-digest-private',
  credentialDigest: 'credential-digest-private', user: 'stream-user-private',
  session: 'stream-session-private', credential: 'stream-credential-private',
});

const binding = Object.freeze({
  schemaVersion: 1, goalId: GOAL_ID, goalVersion: 1, goalDigest: GOAL_DIGEST,
  planId: PLAN_ID, planVersion: 1, planDigest: PLAN_DIGEST, nodeKey: 'implement',
  approvalDigest: APPROVAL_DIGEST, policyDigest: 'f'.repeat(64), dispatchVersion: 1,
});
const goal = Object.freeze({
  schemaVersion: 1, goalId: GOAL_ID, version: 1, digest: GOAL_DIGEST, objective: 'Ship stream privacy',
  definitionOfDone: ['privacy tests pass'], constraints: ['No authority identity disclosure'],
  principalId: PRIVATE.goalPrincipal,
});
const plan = Object.freeze({
  schemaVersion: 1, planId: PLAN_ID, version: 1, digest: PLAN_DIGEST, goal: { goalId: GOAL_ID, version: 1, digest: GOAL_DIGEST },
  proposerPrincipalId: PRIVATE.proposerPrincipal,
  nodes: [{ key: 'implement', objective: 'Implement privacy projection', deps: [] }],
});
const approval = Object.freeze({
  schemaVersion: 1, goal: { goalId: GOAL_ID, version: 1, digest: GOAL_DIGEST },
  plan: { planId: PLAN_ID, version: 1, digest: PLAN_DIGEST }, disposition: 'approved', digest: APPROVAL_DIGEST,
  principalId: PRIVATE.approvalPrincipal, sessionDigest: PRIVATE.sessionDigest,
});

class CoordinationFixture {
  constructor() {
    this.reads = [];
    this.commands = new Map([['goal-command', { command: 'goal_define' }]]);
    this.calls = new Map([['goal-call', { tool: 'fleet_plan_propose' }]]);
    this.rows = [];
    this.rows.push(this.event('goal.version_defined', { schemaVersion: 1, requestDigest: '1'.repeat(64), goal }, `direct:${PRIVATE.goalPrincipal}`));
    this.rows.push(this.event('plan.version_proposed', { schemaVersion: 1, requestDigest: '2'.repeat(64), plan }, `direct:${PRIVATE.proposerPrincipal}`));
    this.rows.push(this.event('plan.approval_decided', { schemaVersion: 1, requestDigest: '3'.repeat(64), approval }, `direct:${PRIVATE.approvalPrincipal}`));
    this.rows.push(this.event('plan.node_dispatched', { schemaVersion: 1, requestDigest: '4'.repeat(64), binding, taskId: 'task-bound' }, `web:${PRIVATE.user}:${PRIVATE.session}`));
    this.rows.push(this.event('task.created', { id: 'task-bound', brief: { goal: 'Implement privacy projection', goalPlan: binding } }, `web:${PRIVATE.user}:${PRIVATE.session}`));
    this.rows.push(this.event('web.command_admitted', { commandId: 'goal-command', command: 'goal_define', userId: PRIVATE.user, sessionId: PRIVATE.session, credentialId: PRIVATE.credential }, `web:${PRIVATE.user}:${PRIVATE.session}`));
    this.rows.push(this.event('web.command_completed', { commandId: 'goal-command', outcome: { body: { result: { goal } } } }, `web:${PRIVATE.user}:${PRIVATE.session}`));
    this.rows.push(this.event('mcp.call_admitted', { callId: 'goal-call', tool: 'fleet_plan_propose', userId: PRIVATE.user, sessionId: PRIVATE.session }, `mcp:${PRIVATE.user}:${PRIVATE.session}`));
    this.rows.push(this.event('mcp.call_completed', { callId: 'goal-call', outcome: { structuredContent: { plan } } }, `mcp:${PRIVATE.user}:${PRIVATE.session}`));
    this.rows.push(this.event('web.audit', { kind: 'ordinary-visible-event', credentialDigest: PRIVATE.credentialDigest, userId: PRIVATE.user, sessionId: PRIVATE.session }, `web:${PRIVATE.user}:${PRIVATE.session}`));
  }

  event(kind, payload, actor) {
    return { schemaVersion: 1, seq: (this.rows?.length ?? 0) + 1, ts: '2026-07-13T12:00:00.000Z', kind, actor, idempotencyKey: `event-${(this.rows?.length ?? 0) + 1}`, payload };
  }

  snapshot() {
    return {
      tasks: [{ id: 'task-bound', brief: { goal: 'Implement privacy projection', goalPlan: binding }, status: 'pending' }],
      goalPlan: {
        goals: [goal], plans: [plan], approvals: [approval],
        dispatches: [{ binding, taskId: 'task-bound', requestDigest: '4'.repeat(64) }],
      },
      authorityDebug: { principalId: PRIVATE.goalPrincipal, sessionDigest: PRIVATE.sessionDigest, credentialDigest: PRIVATE.credentialDigest },
      lastSeq: this.rows.length,
    };
  }

  events(fromSeq = 1, limit = null) {
    this.reads.push(fromSeq);
    const rows = this.rows.slice(Math.max(0, fromSeq - 1));
    return limit === null ? rows : rows.slice(0, limit);
  }

  recordWebAudit(fields, auth) {
    const event = {
      schemaVersion: 1, seq: this.rows.length + 1, ts: '2026-07-13T12:00:00.000Z', kind: 'web.audit',
      actor: auth.actor, idempotencyKey: auth.key, payload: JSON.parse(JSON.stringify(fields)),
    };
    this.rows.push(event);
    return event;
  }

  webCommand(id) { return this.commands.get(id) ?? null; }
  mcpCall(id) { return this.calls.get(id) ?? null; }
}

class Response extends EventEmitter {
  constructor() { super(); this.output = ''; this.writableLength = 0; }
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  write(value) { this.output += value; return true; }
  end() { this.ended = true; }
}

const principal = (goalObserve = false) => ({
  userId: PRIVATE.user, sessionId: PRIVATE.session, credentialId: PRIVATE.credential,
  expiresAt: '2099-01-01T00:00:00.000Z', capabilities: ['observe', ...(goalObserve ? ['goal:observe'] : [])], repoIds: [REPO],
});
function fixture(opts = {}) {
  const coordination = new CoordinationFixture();
  const stream = new WebEventStream({
    coordination, allowedOrigins: [ORIGIN], repoIds: [REPO], now: () => Date.parse('2026-07-13T12:00:00.000Z'),
    credentialDigest: () => PRIVATE.credentialDigest, maxFrameBytes: 256 * 1024, maxBufferedBytes: 256 * 1024,
    pollMs: 5, ...opts,
  });
  return { coordination, stream };
}
function open(stream, candidate, cursor) {
  const output = new Response();
  const ticket = stream.issue(candidate, ORIGIN, REPO).body.ticket;
  assert.equal(stream.open({ ticket, principal: candidate, origin: ORIGIN, ...(cursor === undefined ? {} : { cursor }) }, output), null);
  return output;
}
function assertPrivateAuthorityAbsent(output) {
  for (const marker of Object.values(PRIVATE)) assert.equal(output.includes(marker), false, `stream leaked ${marker}`);
  for (const field of ['principalId', 'proposerPrincipalId', 'sessionDigest', 'credentialDigest', 'credentialId', 'sessionId', 'userId']) {
    assert.equal(output.includes(`"${field}"`), false, `stream retained ${field}`);
  }
}

test('GP6/GP7: generic observe receives neither Goal/Plan snapshot state, events, nor task bindings', async () => {
  const { stream } = fixture({ maxEventsPerPump: 2 });
  const candidate = principal(false);
  const snapshot = open(stream, candidate);
  assert.match(snapshot.output, /event: snapshot/);
  assert.match(snapshot.output, /task-bound/);
  assert.doesNotMatch(snapshot.output, /goalPlan|goal\.version_defined|plan\.version_proposed|plan\.node_dispatched/);
  assert.equal(snapshot.output.includes(GOAL_ID), false);
  assert.equal(snapshot.output.includes(PLAN_ID), false);
  assertPrivateAuthorityAbsent(snapshot.output);
  snapshot.emit('close');

  const replay = open(stream, candidate, 0);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.match(replay.output, /ordinary-visible-event/);
  assert.doesNotMatch(replay.output, /goal\.version_defined|plan\.version_proposed|plan\.approval_decided|plan\.node_dispatched|task\.created|goal_define|fleet_plan_propose/);
  assert.equal(replay.output.includes(GOAL_ID), false);
  assert.equal(replay.output.includes(PLAN_ID), false);
  assertPrivateAuthorityAbsent(replay.output);
  replay.emit('close');
});

test('GP6/GP7: goal:observe receives sanitized Goal/Plan content and exact task binding without authority identities', () => {
  const { stream } = fixture();
  const candidate = principal(true);
  const snapshot = open(stream, candidate);
  assert.match(snapshot.output, /"goalPlan"/);
  assert.match(snapshot.output, /Ship stream privacy/);
  assert.match(snapshot.output, new RegExp(GOAL_ID));
  assert.match(snapshot.output, new RegExp(PLAN_ID));
  assert.match(snapshot.output, /"taskId":"task-bound"/);
  assert.match(snapshot.output, /"nodeKey":"implement"/);
  assert.doesNotMatch(snapshot.output, /"requestDigest"|"scopeKey"/);
  assertPrivateAuthorityAbsent(snapshot.output);
  snapshot.emit('close');

  const replay = open(stream, candidate, 0);
  assert.match(replay.output, /goal\.version_defined/);
  assert.match(replay.output, /plan\.version_proposed/);
  assert.match(replay.output, /plan\.approval_decided/);
  assert.match(replay.output, /plan\.node_dispatched/);
  assert.match(replay.output, /"actor":"goal-plan:authorized"/);
  assert.doesNotMatch(replay.output, /"requestDigest"|"scopeKey"/);
  assertPrivateAuthorityAbsent(replay.output);
  replay.emit('close');
});

test('GP6/GP8: hidden events advance the internal replay cursor and are never reread in a polling loop', async () => {
  const { coordination, stream } = fixture({ maxEventsPerPump: 2 });
  const output = open(stream, principal(false), 0);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(coordination.reads[0], 1);
  assert.deepEqual(coordination.reads, [...coordination.reads].sort((a, b) => a - b));
  assert.equal(new Set(coordination.reads).size, coordination.reads.length, `cursor was reread: ${coordination.reads.join(',')}`);
  assert.ok(coordination.reads.some((value) => value > 10), `cursor did not advance through hidden prefix: ${coordination.reads.join(',')}`);
  assert.match(output.output, /ordinary-visible-event/);
  output.emit('close');
});
