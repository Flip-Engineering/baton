import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore, McpFleetServer, MockAdapter, createDriver } from '../src/index.mjs';

const NOW = Date.parse('2026-07-13T18:00:00.000Z');
const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase62-mcp-${name}-`));
const policy = Object.freeze({
  schemaVersion: 1, repoId: 'repo-phase62-mcp', mandatory: true, approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'], effectClasses: ['repository_edit', 'provider_call'], capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 1440, maxProviderTurns: 10_000,
  }),
});
const principal = (userId, capabilities) => ({
  userId, sessionId: `${userId}-session`, capabilities, repoIds: ['repo-phase62-mcp'],
  expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
});
const rpc = (server, id, name, args) => server.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
async function initialize(server) {
  await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase62-test', version: '1' } } });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
}
function server(coordinator, coordination, injectedPrincipal) {
  return new McpFleetServer({
    coordinator, coordination, principal: injectedPrincipal, repoIds: ['repo-phase62-mcp'], now: () => NOW,
    maxWaitMs: 25_000, maxMessageBytes: 64 * 1024, takeToolQuota: async () => ({ ok: true }),
  });
}
function makeDriver(authorizations) {
  const repoRoot = root('repo');
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.email', 'phase62@example.invalid'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.name', 'Phase 62'], { cwd: repoRoot });
  writeFileSync(join(repoRoot, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repoRoot });
  const adapter = new MockAdapter({ harness: 'mock', scenario: { outcome: 'completed', delayMs: 1, summary: 'done', files: {} } });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({ ...baseCard(), modelSelection: { mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock', acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'test', refreshedAt: null } });
  return createDriver({
    repoRoot, repoId: 'repo-phase62-mcp', logDir: root('log'),
    adapters: { mock: adapter },
    goalPlanAuthority: { policy, authorize: async (request) => { authorizations.push(request); return true; } },
  });
}
const budget = { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 };
const verification = { command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code', timeoutMs: 60_000, maxOutputBytes: 1_000_000, requiredPredecessorEvidence: [] };
const statusCoordinates = (goal, plan) => ({
  goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
  planId: plan.planId, planVersion: plan.version, planDigest: plan.digest, throughSeq: null,
});

test('GP1/GP4/GP7: MCP Goal/Plan tools expose closed schemas and bind exact principal powers', async () => {
  const authorizations = []; const driver = makeDriver(authorizations);
  const owner = server(driver.coordinator, driver.coordination, principal('owner', ['goal:define', 'plan:propose']));
  const approver = server(driver.coordinator, driver.coordination, principal('approver', ['plan:approve']));
  const observer = server(driver.coordinator, driver.coordination, principal('observer', ['goal:observe']));
  await Promise.all([initialize(owner), initialize(approver), initialize(observer)]);

  const listed = await owner.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const names = listed.result.tools.map((tool) => tool.name);
  assert.equal(names.filter((name) => ['fleet_goal_define', 'fleet_plan_propose', 'fleet_plan_approve', 'fleet_goal_plan_status'].includes(name)).length, 4);
  for (const name of ['fleet_goal_define', 'fleet_plan_propose', 'fleet_plan_approve', 'fleet_goal_plan_status']) {
    assert.equal(listed.result.tools.find((tool) => tool.name === name).inputSchema.additionalProperties, false);
  }
  const planSchema = listed.result.tools.find((tool) => tool.name === 'fleet_plan_propose').inputSchema;
  assert.equal(planSchema.properties.goal.additionalProperties, false);
  assert.equal(planSchema.properties.nodes.items.additionalProperties, false);
  assert.equal(planSchema.properties.nodes.items.properties.verification.additionalProperties, false);

  const goalArgs = {
    repoId: 'repo-phase62-mcp', idempotencyKey: 'goal-one', objective: 'Ship MCP Goal Plan authority',
    definitionOfDone: ['node --test passes'], constraints: ['No network access'], risk: 'high', budget, predecessor: null,
  };
  const goalResponse = await rpc(owner, 3, 'fleet_goal_define', goalArgs);
  assert.equal(goalResponse.result.isError, false);
  assert.doesNotMatch(JSON.stringify(goalResponse.result), /actor|idempotencyKey|principalId|proposerPrincipalId|sessionDigest/);
  const goal = goalResponse.result.structuredContent.goal;
  const replay = await rpc(owner, 4, 'fleet_goal_define', goalArgs);
  assert.deepEqual(replay.result, goalResponse.result);

  const planResponse = await rpc(owner, 5, 'fleet_plan_propose', {
    repoId: 'repo-phase62-mcp', idempotencyKey: 'plan-one', goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest }, predecessor: null,
    nodes: [{
      key: 'implement', objective: 'Implement MCP Goal Plan authority', definitionOfDone: ['node --test passes'], deps: [], pathScope: ['impl/**'],
      risk: 'high', budget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 }, verification,
      routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] }, capabilities: ['code', 'test'], effects: ['repository_edit'],
    }],
  });
  assert.equal(planResponse.result.isError, false, JSON.stringify(planResponse.result));
  assert.doesNotMatch(JSON.stringify(planResponse.result), /actor|idempotencyKey|principalId|proposerPrincipalId|sessionDigest/);
  const plan = planResponse.result.structuredContent.plan;

  const approvalResponse = await rpc(approver, 6, 'fleet_plan_approve', {
    repoId: 'repo-phase62-mcp', idempotencyKey: 'approve-one',
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest },
    plan: { planId: plan.planId, version: plan.version, digest: plan.digest }, expectedDisposition: null, disposition: 'approved',
  });
  assert.equal(approvalResponse.result.isError, false);
  assert.doesNotMatch(JSON.stringify(approvalResponse.result), /actor|idempotencyKey|principalId|proposerPrincipalId|sessionDigest/);

  const statusResponse = await rpc(observer, 7, 'fleet_goal_plan_status', {
    repoId: 'repo-phase62-mcp', ...statusCoordinates(goal, plan),
  });
  assert.equal(statusResponse.result.isError, false);
  assert.equal(statusResponse.result.structuredContent.goal.digest, goal.digest);
  assert.equal(statusResponse.result.structuredContent.plan.digest, plan.digest);
  assert.equal(statusResponse.result.structuredContent.approval.disposition, 'approved');
  assert.deepEqual(authorizations.map(({ operation, power, principalId }) => ({ operation, power, principalId })), [
    { operation: 'goal_define', power: 'goal:define', principalId: 'owner' },
    { operation: 'plan_propose', power: 'plan:propose', principalId: 'owner' },
    { operation: 'plan_approve', power: 'plan:approve', principalId: 'approver' },
    { operation: 'goal_plan_status', power: 'goal:observe', principalId: 'observer' },
  ]);
  const crossRun = await rpc(observer, 8, 'fleet_goal_plan_status', {
    repoId: 'repo-phase62-mcp', runId: 'other-run', ...statusCoordinates(goal, plan),
  });
  assert.equal(crossRun.result.isError, true); assert.match(crossRun.result.content[0].text, /not_found/);
  const crossRepo = await rpc(observer, 9, 'fleet_goal_plan_status', {
    repoId: 'other-repo', ...statusCoordinates(goal, plan),
  });
  assert.equal(crossRepo.result.isError, true); assert.match(crossRepo.result.content[0].text, /forbidden/);
  driver.close();
});

test('GP5/GP7: fleet_spawn carries one closed Goal/Plan gate and transport-derived dispatch identity', async () => {
  const calls = [];
  const coordinator = { async spawn(harness, brief, opts) { calls.push({ harness, brief, opts }); return { id: 'worker-1', fence: 1 }; } };
  const coordination = new CoordinationStore(root('spawn-coordination'));
  const transportPrincipal = principal('dispatcher', ['control', 'plan:dispatch']);
  const mcp = server(coordinator, coordination, transportPrincipal); await initialize(mcp);
  const goalPlan = {
    goalId: `goal:${'a'.repeat(64)}`, goalVersion: 1, goalDigest: 'b'.repeat(64),
    planId: `plan:${'c'.repeat(64)}`, planVersion: 2, planDigest: 'd'.repeat(64),
    nodeKey: 'implement', expectedDispatchVersion: 0, capabilities: ['code', 'test'], effects: ['repository_edit'],
  };
  const response = await rpc(mcp, 2, 'fleet_spawn', {
    repoId: 'repo-phase62-mcp', idempotencyKey: 'spawn-plan-one', harness: 'mock', model: 'gpt-5.6-sol', effort: 'low', brief: {}, goalPlan,
  });
  assert.equal(response.result.isError, false);
  assert.deepEqual(calls[0].opts.goalPlan, goalPlan);
  assert.equal(calls[0].opts.principalId, 'dispatcher'); assert.equal(calls[0].opts.sessionId, 'dispatcher-session');
  assert.deepEqual(calls[0].opts.powers, ['control', 'plan:dispatch']);
  assert.equal(JSON.stringify(calls[0]).includes('spawn-plan-one'), false);

  const forged = await rpc(mcp, 3, 'fleet_spawn', {
    repoId: 'repo-phase62-mcp', idempotencyKey: 'spawn-plan-forged', harness: 'mock', brief: {}, goalPlan,
    principalId: 'forged',
  });
  assert.equal(forged.result.isError, true); assert.match(forged.result.content[0].text, /unknown_argument_field/);
  const malformed = await rpc(mcp, 4, 'fleet_spawn', {
    repoId: 'repo-phase62-mcp', idempotencyKey: 'spawn-plan-malformed', harness: 'mock', brief: {}, goalPlan: { ...goalPlan, effects: undefined },
  });
  assert.equal(malformed.result.isError, true); assert.match(malformed.result.content[0].text, /invalid_goal_plan/);
  assert.equal(calls.length, 1);
});

test('GP7/GP8: admitted Goal mutation replay reconciles through the original durable call identity', async () => {
  const authorizations = []; const driver = makeDriver(authorizations);
  const owner = server(driver.coordinator, driver.coordination, principal('owner', ['goal:define'])); await initialize(owner);
  const complete = driver.coordination.completeMcpCall.bind(driver.coordination);
  driver.coordination.completeMcpCall = () => { throw new Error('completion append unavailable'); };
  const args = {
    repoId: 'repo-phase62-mcp', idempotencyKey: 'goal-lost-response', objective: 'Survive a lost MCP completion append',
    definitionOfDone: ['one goal version exists'], constraints: [], risk: 'low', budget, predecessor: null,
  };
  const first = await rpc(owner, 2, 'fleet_goal_define', args);
  assert.equal(first.result.isError, true); assert.match(first.result.content[0].text, /temporarily_unavailable/);
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'goal.version_defined').length, 1);
  driver.coordination.completeMcpCall = complete;
  const reconciled = await rpc(owner, 3, 'fleet_goal_define', args);
  assert.equal(reconciled.result.isError, false);
  assert.doesNotMatch(JSON.stringify(reconciled.result), /actor|idempotencyKey|principalId|proposerPrincipalId|sessionDigest/);
  assert.match(reconciled.result.structuredContent.goal.goalId, /^goal:[a-f0-9]{64}$/);
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'goal.version_defined').length, 1);
  const completedReplay = await rpc(owner, 4, 'fleet_goal_define', args);
  assert.equal(completedReplay.result.isError, false);
  assert.doesNotMatch(JSON.stringify(completedReplay.result), /actor|idempotencyKey|principalId|proposerPrincipalId|sessionDigest/);
  assert.deepEqual(completedReplay.result, reconciled.result);
  driver.close();
});

test('GP5/GP7/GP8: admitted plan-gated fleet_spawn replay returns the one original durable admission', async () => {
  const authorizations = []; const driver = makeDriver(authorizations);
  const spawnContexts = [];
  const spawn = driver.coordinator.spawn.bind(driver.coordinator);
  driver.coordinator.spawn = (...args) => { spawnContexts.push(args[2]); return spawn(...args); };
  const directAuth = (principalId, powers, idempotencyKey) => ({
    actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`, powers,
    repoId: 'repo-phase62-mcp', runId: null, idempotencyKey,
  });
  const { goal } = await driver.coordinator.defineGoal({
    objective: 'Reconcile one MCP plan-gated spawn', definitionOfDone: ['one worker admission exists'],
    constraints: [], risk: 'high', budget, predecessor: null,
  }, directAuth('owner', ['goal:define'], 'goal:spawn-reconcile'));
  const { plan } = await driver.coordinator.proposePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest }, predecessor: null,
    nodes: [{
      key: 'implement', objective: 'Implement the one admitted node', definitionOfDone: ['one worker admission exists'],
      deps: [], pathScope: ['impl/**'], risk: 'high', budget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
      verification, routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] }, capabilities: ['code'], effects: ['repository_edit'],
    }],
  }, directAuth('planner', ['plan:propose'], 'plan:spawn-reconcile'));
  await driver.coordinator.approvePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest },
    plan: { planId: plan.planId, version: plan.version, digest: plan.digest }, expectedDisposition: null, disposition: 'approved',
  }, directAuth('approver', ['plan:approve'], 'approval:spawn-reconcile'));

  const dispatcherPrincipal = principal('dispatcher', ['control', 'plan:dispatch']);
  const dispatcher = server(driver.coordinator, driver.coordination, dispatcherPrincipal); await initialize(dispatcher);
  const gate = {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey: 'implement', expectedDispatchVersion: 0, capabilities: ['code'], effects: ['repository_edit'],
  };
  const matchingBrief = {
    goal: 'Implement the one admitted node', constraints: [], pathScope: ['impl/**'], definitionOfDone: 'one worker admission exists',
    verification, budget: { tokens: 10_000, usd: 1, wallMin: 5 },
  };
  const beforeConflicts = driver.coordination.events().length;
  for (const [index, conflict] of [{ providerTurns: 3 }, { capabilities: ['test'] }, { effects: [] }].entries()) {
    const refused = await rpc(dispatcher, 20 + index, 'fleet_spawn', {
      repoId: 'repo-phase62-mcp', idempotencyKey: `spawn-conflict-${index}`, taskId: `mcp-plan-conflict-${index}`,
      harness: 'mock', model: 'model-a', effort: 'low', brief: { ...matchingBrief, ...conflict }, goalPlan: gate,
    });
    assert.equal(refused.result.isError, true); assert.match(refused.result.content[0].text, /plan_brief_mismatch/);
  }
  assert.equal(driver.coordination.events().filter((event) => ['plan.node_dispatched', 'task.created'].includes(event.kind)).length, 0);
  assert.equal(driver.coordination.events().length, beforeConflicts + 6, 'each MCP refusal records only call admission and closed failure');
  const args = {
    repoId: 'repo-phase62-mcp', idempotencyKey: 'spawn-lost-response', taskId: 'mcp-plan-reconcile', harness: 'mock', model: 'model-a', effort: 'low', brief: {},
    goalPlan: gate,
  };
  const complete = driver.coordination.completeMcpCall.bind(driver.coordination);
  driver.coordination.completeMcpCall = () => { throw new Error('completion append unavailable'); };
  const first = await rpc(dispatcher, 2, 'fleet_spawn', args);
  assert.equal(first.result.isError, true); assert.match(first.result.content[0].text, /temporarily_unavailable/);
  const durable = driver.coordination.task('mcp-plan-reconcile');
  assert.ok(durable); assert.match(durable.reservedWorkerId, /^w-/);
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'task.created' && event.payload.id === 'mcp-plan-reconcile').length, 1);
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'plan.node_dispatched' && event.payload.taskId === 'mcp-plan-reconcile').length, 1);

  driver.coordination.completeMcpCall = complete;
  const restartedTransport = server(driver.coordinator, driver.coordination, { ...dispatcherPrincipal, sessionId: 'dispatcher-rotated-session' }); await initialize(restartedTransport);
  const reconciled = await rpc(restartedTransport, 3, 'fleet_spawn', args);
  assert.equal(reconciled.result.isError, false);
  assert.equal(reconciled.result.structuredContent.id, durable.reservedWorkerId);
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'task.created' && event.payload.id === 'mcp-plan-reconcile').length, 1);
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'plan.node_dispatched' && event.payload.taskId === 'mcp-plan-reconcile').length, 1);
  assert.equal(driver.coordinator.list().filter((worker) => worker.taskId === 'mcp-plan-reconcile').length, 1);
  assert.equal(spawnContexts.length, 5);
  assert.equal(spawnContexts[4].actor, 'mcp:dispatcher:dispatcher-session');
  assert.equal(spawnContexts[4].sessionId, 'dispatcher-session');
  assert.equal(spawnContexts[4].idempotencyKey, spawnContexts[3].idempotencyKey);
  await driver.coordinator.kill(reconciled.result.structuredContent.id, 'test');
  await driver.coordinator.drain({ actor: 'test', repoId: 'repo-phase62-mcp', idempotencyKey: 'drain:spawn-reconcile' });
  driver.close();
});

test('GP7/GP8: MCP Goal/Plan refusals are stable, scoped, and do not dispatch', async () => {
  const calls = [];
  const coordinator = {
    async defineGoal() { calls.push('define'); throw Object.assign(new Error('private goal details'), { code: 'goal_weakened' }); },
    async goalPlanStatus() { calls.push('status'); throw Object.assign(new Error('private status details'), { code: 'goal_plan_status_invalid' }); },
  };
  const coordination = new CoordinationStore(root('refusal-coordination'));
  const authorized = server(coordinator, coordination, principal('owner', ['goal:define', 'goal:observe'])); await initialize(authorized);
  const denied = server(coordinator, coordination, principal('denied', ['observe'])); await initialize(denied);
  const goalArgs = {
    repoId: 'repo-phase62-mcp', idempotencyKey: 'goal-weakened', objective: 'Cannot weaken', definitionOfDone: ['test'], constraints: [],
    risk: 'high', budget, predecessor: null,
  };
  const weakened = await rpc(authorized, 2, 'fleet_goal_define', goalArgs);
  assert.equal(weakened.result.isError, true); assert.match(weakened.result.content[0].text, /goal_weakened/);
  assert.equal(weakened.result.content[0].text.includes('private goal details'), false);
  const status = await rpc(authorized, 3, 'fleet_goal_plan_status', {
    repoId: 'repo-phase62-mcp',
    goalId: `goal:${'a'.repeat(64)}`, goalVersion: 1, goalDigest: 'c'.repeat(64),
    planId: `plan:${'b'.repeat(64)}`, planVersion: 1, planDigest: 'd'.repeat(64), throughSeq: null,
  });
  assert.equal(status.result.isError, true); assert.match(status.result.content[0].text, /goal_plan_status_invalid/);
  const forbidden = await rpc(denied, 4, 'fleet_goal_define', { ...goalArgs, idempotencyKey: 'goal-forbidden' });
  assert.equal(forbidden.result.isError, true); assert.match(forbidden.result.content[0].text, /forbidden/);
  const unknown = await rpc(authorized, 5, 'fleet_goal_define', { ...goalArgs, idempotencyKey: 'goal-unknown', eventKind: 'goal.rewritten' });
  assert.equal(unknown.result.isError, true); assert.match(unknown.result.content[0].text, /unknown_argument_field/);
  assert.deepEqual(calls, ['define', 'status']);
});
