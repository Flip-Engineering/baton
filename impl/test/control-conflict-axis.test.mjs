import { after as afterFixtureCleanup } from 'node:test';
import { rmSync as removeFixtureDirectory } from 'node:fs';
// U-F14 (issue #313, the #288 web2 leftover): an idempotency conflict on the Run control lane
// used to be ONE refusal for seven different facts — a retrying agent could not tell a changed
// message from a changed session. The web layer has named the moved axis since #288
// (web-northbound.mjs movedAxis); the application layer now names it too: the refusal says WHICH
// axis moved and carries detail.movedAxis, under the same application_control_conflict code.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication, MockAdapter, createDriver } from '../src/index.mjs';

const mintedFixtureDirectories = [];

function mintFixtureDirectory(...args) {
  const directory = mkdtempSync(...args);
  mintedFixtureDirectories.push(directory);
  return directory;
}

afterFixtureCleanup(() => {
  for (const directory of mintedFixtureDirectories) {
    removeFixtureDirectory(directory, { recursive: true, force: true });
  }
});

const root = (name) => mintFixtureDirectory(join(tmpdir(), `baton-f14-${name}-`));
const policy = Object.freeze({
  schemaVersion: 1, repoId: 'repo-f14', mandatory: true, approvalTtlMs: 3_600_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'], capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});
const profile = Object.freeze({
  schemaVersion: 1, repoId: 'repo-f14', definitionOfDone: ['done'],
  constraints: [], risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'], verification: {
    command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
    expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024, requiredPredecessorEvidence: [],
  },
  routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});
const principal = (principalId) => ({ actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session` });

function fixture(name) {
  const repo = root(`${name}-repo`);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'f14@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'F14'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = new MockAdapter({ harness: 'mock', scenario: { outcome: 'completed', delayMs: 1_500, summary: 'f14 run', files: {} } });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(), modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  const driver = createDriver({
    repoRoot: repo, repoId: 'repo-f14', logDir: root(`${name}-log`), adapters: { mock: adapter },
    goalPlanAuthority: { policy, authorize: async () => true }, stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver, repoId: 'repo-f14', profiles: { 'safe-code': profile },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: async () => true,
  });
  return { application, driver };
}

async function startedRun(application, runId, objective) {
  const proposed = await application.start({
    runId, objective, profile: 'safe-code',
    route: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'],
  }, principal('owner'));
  await application.approve(proposed.runId, proposed.plan.digest, principal('approver'));
  const outline = await application.inspect({ runId: proposed.runId, depth: 'outline' }, principal('sender'));
  const send = outline.outline.actions.find((action) => action.kind === 'send');
  assert.ok(send, 'the running Run advertises the send action');
  return send.actionId;
}

test('U-F14: a replayed control with a different message names the axis that moved', async () => {
  const { application } = fixture('replay');
  const actionId = await startedRun(application, 'run-f14', 'F14 axis naming');
  const act = (inputs, idempotencyKey) => application.command('run.act', {
    runId: 'run-f14', actionId, inputs,
  }, principal('sender'), { transport: 'direct', requestId: `f14-${idempotencyKey}`, idempotencyKey });

  await act({ message: 'first guidance' }, 'f14-key');
  const refusal = await act({ message: 'second guidance' }, 'f14-key').then(() => null, (error) => error);
  assert.equal(refusal?.code, 'application_control_conflict');
  assert.match(refusal.message, /the message moved/u,
    'the refusal names WHICH axis moved (a changed message), never one undifferentiated conflict');
  assert.equal(refusal.detail?.movedAxis, 'message');
  await application.shutdown(principal('shutdown'));
});

test('U-F14: a replayed control with a different session names the session, not the message', async () => {
  const { application } = fixture('session');
  const actionId = await startedRun(application, 'run-f14-session', 'F14 session axis');
  const inputs = { message: 'same words' };
  await application.command('run.act', { runId: 'run-f14-session', actionId, inputs },
    principal('sender'), { transport: 'direct', requestId: 'f14-session-first', idempotencyKey: 'f14-session-key' });
  const otherSession = { actor: 'direct:sender', principalId: 'sender', sessionId: 'a-different-session' };
  const refusal = await application.command('run.act', {
    runId: 'run-f14-session', actionId, inputs,
  }, otherSession, { transport: 'direct', requestId: 'f14-session-second', idempotencyKey: 'f14-session-key' }).then(() => null, (error) => error);
  assert.equal(refusal?.code, 'application_control_conflict');
  assert.match(refusal.message, /the source\.sessionId moved/u,
    'a changed session reads differently from a changed message — that is the whole point of U-F14');
  assert.equal(refusal.detail?.movedAxis, 'source.sessionId');
  await application.shutdown(principal('shutdown'));
});
