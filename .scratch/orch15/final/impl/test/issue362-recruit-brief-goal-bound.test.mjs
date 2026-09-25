// Issue #362: every swarm.recruit refused goal_plan_invalid after #358 — a recruit's run objective
// is its whole composed brief (17–132 KB measured on the live ledgers), admitted up to the
// run.objective lane, but the deployment's goal-plan policy carried a 16 KiB `maxTextBytes`
// literal below that lane; and the refusal crossed the web lane as the numberless
// "goal/plan precondition failed". These rows pin: (a) the policy's text bound IS the objective
// lane's value and its goal/plan byte bounds are the goal-plan substrate's own ceilings; (b) a
// text over the bound refuses naming the field, the observed bytes and the bound, with a detail
// record; (c) that refusal crosses the web lane with its own message and detail (#335 rule).
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { deploymentGoalPlanAuthority } from '../src/application-deployment.mjs';
import {
  GOAL_PLAN_CEILINGS, GoalPlanValidationError, normalizeGoalPlanPolicy, normalizeGoalRequest,
} from '../src/goal-plan.mjs';
import { APPLICATION_COMMAND_DEFINITIONS, CoordinationStore, WebNorthbound, WebSessionStore } from '../src/index.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

const REPO = 'repo-issue362';
const NOW = Date.parse('2026-09-18T02:00:00.000Z');
const ORIGIN = 'https://control.example.test';
const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

// The same real northbound path the #288/#335 envelope rows drive: a WebNorthbound over a
// scratch session store and an application whose command throws the cause under test.
class Response {
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  end(body = '') { this.rawBody = body; this.body = body ? JSON.parse(body) : null; }
}
async function send(web, { path, body, headers = {} }) {
  const req = new EventEmitter();
  Object.assign(req, {
    method: 'POST', url: path, headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    socket: { encrypted: true, remoteAddress: '127.0.0.1' }, destroy() {},
  });
  const res = new Response();
  const pending = web.handle(req, res);
  queueMicrotask(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); });
  await pending;
  return res;
}
async function throughWeb(cause, suffix) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue362-'));
  roots.push(directory);
  const sessions = new WebSessionStore(join(directory, 'sessions'), { now: () => NOW });
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const application = {
    repoId: REPO, card: () => ({ schemaVersion: 1, repoId: REPO, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
    async authorizeReplay() { return true; },
    async command() { throw cause; },
  };
  const web = new WebNorthbound({ coordinator: {}, coordination, sessions, application, repoIds: [REPO], allowedOrigins: [ORIGIN], now: () => NOW });
  const issued = sessions.issue({ userId: 'issue362-operator', authMethod: 'bearer', capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: [REPO], ttlMs: 60_000 }, { actor: 'issue362-fixture' });
  return send(web, {
    path: '/v1/commands',
    body: { schemaVersion: 1, commandId: `issue362-cmd-${suffix}`, idempotencyKey: `issue362-key-${suffix}`, command: 'run_status', args: { runId: 'run-issue362' }, repoId: REPO, origin: ORIGIN },
    headers: { authorization: `Bearer ${issued.token}` },
  });
}

function goalRequest(objective) {
  return {
    objective,
    definitionOfDone: ['one contribution recorded'],
    constraints: [],
    risk: 'low',
    budget: { tokens: 1000, usd: 1, wallMin: 10, providerTurns: 4 },
    predecessor: null,
  };
}

test('#362 (a): the deployment goal-plan policy admits the whole run.objective lane — its text bound is the lane value, its byte bounds the goal-plan ceilings', () => {
  const { policy } = deploymentGoalPlanAuthority(REPO);
  assert.equal(policy.limits.maxTextBytes, FRAME_LIMITS['run.objective'].value,
    'the goal text bound is the objective lane value, never a literal below it');
  assert.equal(policy.limits.maxGoalBytes, GOAL_PLAN_CEILINGS.goalBytes, 'the goal byte bound is the substrate ceiling');
  assert.equal(policy.limits.maxPlanBytes, GOAL_PLAN_CEILINGS.planBytes, 'the plan byte bound is the substrate ceiling');
  const normalized = normalizeGoalPlanPolicy(policy);
  assert.equal(normalized.limits.maxTextBytes, policy.limits.maxTextBytes, 'the validator admits the derived policy');
  // The measured live case: a 132,304-byte composed recruit brief as the run objective.
  const brief = 'x'.repeat(132_304);
  const goal = normalizeGoalRequest(goalRequest(brief), normalized);
  assert.equal(goal.objective, brief, 'a 132 KB recruit brief is admitted whole as the goal objective');
});

test('#362 (b): a text over the policy bound refuses naming the field, the observed bytes and the bound, with a detail record', () => {
  const { policy } = deploymentGoalPlanAuthority(REPO);
  const normalized = normalizeGoalPlanPolicy(policy);
  const oversize = 'y'.repeat(normalized.limits.maxTextBytes + 1);
  let caught = null;
  try { normalizeGoalRequest(goalRequest(oversize), normalized); } catch (error) { caught = error; }
  assert.ok(caught instanceof GoalPlanValidationError, 'the refusal is the typed goal-plan error');
  assert.equal(caught.code, 'goal_plan_invalid');
  assert.equal(caught.field, 'objective', 'the refusal names the field');
  assert.deepEqual(caught.detail, { field: 'objective', bytes: normalized.limits.maxTextBytes + 1, limit: normalized.limits.maxTextBytes },
    'the detail record carries the observed bytes and the bound');
  assert.match(caught.message, /objective exceeds the goal\/plan policy text bound: \d+ bytes observed, \d+ allowed \(limits\.maxTextBytes\)/u,
    'the message teaches the numbers and the policy row that bounds them');
  assert.throws(() => normalizeGoalRequest(goalRequest('   '), normalized),
    (error) => error.code === 'goal_plan_invalid' && error.detail === undefined, 'an empty text keeps the plain refusal (nothing was measured)');
});

test('#362 (c): a goal-plan refusal that measured something crosses the web lane with its own message and detail; one without detail keeps the fixed class message', async () => {
  const detail = { field: 'objective', bytes: 132_304, limit: 16_384 };
  const message = 'objective exceeds the goal/plan policy text bound: 132304 bytes observed, 16384 allowed (limits.maxTextBytes)';
  const taught = await throughWeb(Object.assign(new Error(message), { code: 'goal_plan_invalid', detail }), '1');
  assert.equal(taught.status, 400);
  assert.equal(taught.body.error.code, 'goal_plan_invalid', 'the code crosses as itself');
  assert.equal(taught.body.error.message, message, 'the mint site\'s own teaching crosses byte-identically');
  assert.equal(taught.body.error.field, 'objective');
  assert.deepEqual(taught.body.error.detail, detail, 'bytes and bound cross in detail');
  const bare = await throughWeb(Object.assign(new Error('internal text'), { code: 'goal_plan_invalid' }), '2');
  assert.equal(bare.status, 400);
  assert.equal(bare.body.error.message, 'goal/plan precondition failed', 'no detail — the fixed class message stands');
  assert.equal(bare.body.error.detail, undefined);
});
