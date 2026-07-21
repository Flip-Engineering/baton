// Wave driver surface (docs/31) red suite: first-class orchestration waves over any Baton
// command port. Every row pins one receipted bespoke-driver failure mode: passive-status
// stalls, pump-as-terminal kills, fail-fast cascades, terminal-taxonomy confusion, glob-scope
// misuse, pin-fallback ambiguity, stopMember dispatch races, and watchdog-skipped outcomes.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import { createWave } from '../src/wave.mjs';

const repoId = 'repo-wave-driver';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-wave-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

// One MockAdapter whose spawn() selects a scenario by matching the member marker in the brief.
function markerAdapter(scenariosByMarker, tracker = { calls: [] }) {
  const adapter = new MockAdapter({ scenario: scenariosByMarker.default ?? { outcome: 'completed' } });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null,
      provenance: 'wave-driver-test', refreshedAt: null,
    },
  });
  const nativeSpawn = adapter.spawn.bind(adapter);
  adapter.spawn = (worker, brief, options) => {
    const goal = brief?.goal ?? '';
    const marker = Object.keys(scenariosByMarker).find((key) => key !== 'default' && goal.includes(key));
    const scenario = scenariosByMarker[marker] ?? scenariosByMarker.default;
    tracker.calls.push({ worker, marker: marker ?? 'default' });
    return nativeSpawn(worker, brief, { ...options, scenario });
  };
  return adapter;
}

function harness(t, scenariosByMarker, tracker) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const adapters = { mock: markerAdapter(scenariosByMarker, tracker) };
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    adapters,
    stopDeadlineMs: 2_000,
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1,
        repoId,
        mandatory: true,
        approvalTtlMs: 60 * 60 * 1_000,
        riskClasses: ['low', 'medium', 'high', 'critical'],
        effectClasses: ['repository_edit', 'provider_call'],
        capabilityClasses: ['code', 'test'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
          maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
        }),
      }),
      authorize: async () => true,
    },
  });
  const application = new BatonApplication({
    driver,
    repoId,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1,
        repoId,
        definitionOfDone: ['deployment verification passes'],
        constraints: [],
        risk: 'low',
        goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
        pathScope: ['**'],
        verification: {
          command: 'true', arguments: [], cwd: '.', envAllowlist: [],
          expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536,
          requiredPredecessorEvidence: [],
        },
        routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
        capabilities: ['code', 'test'],
        effects: ['provider_call', 'repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      }),
    },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principal('wave-owner'));
  t.after(async () => {
    await driver.closeAuthority?.();
    await driver.coordination?.releaseWriterLease?.();
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo };
}

const member = (role, objective, options = {}) => ({
  role,
  objective: `${objective} (marker:${role})`,
  harness: 'mock', model: 'mock-model', effort: 'low',
  scope: ['reports/**'],
  report: `reports/${role}.md`,
  ...options,
});

test('W1: waves.start begins members individually and explicitly approves them — nothing parks at awaiting_plan_approval', async (t) => {
  const scenarios = {
    alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] },
    beta: { outcome: 'completed', edits: [{ path: 'reports/beta.md', content: 'beta report\n' }] },
  };
  const { baton, repo } = harness(t, scenarios);
  const wave = await createWave(baton, { repoRoot: repo, 
    members: [member('alpha', 'write the alpha report'), member('beta', 'write the beta report')],
  });
  const progress = await wave.progress();
  for (const entry of progress.members) {
    assert.notEqual(entry.phase, 'awaiting_plan_approval', `${entry.role} must not park on a silent authority gate`);
  }
  const outcomes = await wave.settle({ timeoutMs: 20_000 });
  assert.equal(outcomes.length, 2);
  for (const outcome of outcomes) {
    assert.ok(outcome.terminal === true || outcome.phase === 'work_completed', `${outcome.role} settled`);
    assert.match(outcome.resultSha ?? '', /^[a-f0-9]{40}$/u, `${outcome.role} preserved result`);
  }
  await wave.close({ reason: 'W1 settled.' });

  const parked = await createWave(baton, {
    members: [member('gamma', 'write the gamma report')],
    approve: false,
  });
  const parkedProgress = await parked.progress();
  assert.equal(parkedProgress.members[0].phase, 'awaiting_plan_approval');
  await parked.close({ reason: 'W1 unapproved cleanup.' });
});

test('W2: one member crashing changes nothing about the sibling lifecycle (no fail-fast cascade)', async (t) => {
  const scenarios = {
    alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] },
    beta: { outcome: 'completed', crashAfterMs: 50, edits: [{ path: 'reports/beta.md', content: 'beta report\n', delayMs: 1_000 }] },
  };
  const { baton, repo } = harness(t, scenarios);
  const wave = await createWave(baton, { repoRoot: repo, 
    members: [member('alpha', 'write the alpha report'), member('beta', 'crash immediately')],
  });
  const outcomes = await wave.settle({ timeoutMs: 20_000 });
  const alpha = outcomes.find((outcome) => outcome.role === 'alpha');
  const beta = outcomes.find((outcome) => outcome.role === 'beta');
  assert.match(alpha.resultSha ?? '', /^[a-f0-9]{40}$/u, 'sibling completes and preserves its result');
  assert.notEqual(beta.phase, 'work_completed');
  assert.notEqual(beta.resultSha ?? null, alpha.resultSha);
  const stop = await wave.close({ reason: 'W2 settled.' });
  assert.equal(stop.remainingCount, 0);
});

test('W3: settle always produces an outcome for every member, including a member that never finishes before the timeout', async (t) => {
  const scenarios = {
    alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] },
    beta: { outcome: 'completed', edits: [{ path: 'reports/beta.md', content: 'beta report\n', delayMs: 60_000 }] },
  };
  const { baton, repo } = harness(t, scenarios);
  const wave = await createWave(baton, { repoRoot: repo, 
    members: [member('alpha', 'write the alpha report'), member('beta', 'block forever')],
  });
  const outcomes = await wave.settle({ timeoutMs: 2_000 });
  assert.equal(outcomes.length, 2, 'every member gets an outcome even after the settle timeout');
  const alpha = outcomes.find((outcome) => outcome.role === 'alpha');
  const beta = outcomes.find((outcome) => outcome.role === 'beta');
  assert.match(alpha.resultSha ?? '', /^[a-f0-9]{40}$/u);
  assert.equal(beta.resultSha, null);
  assert.equal(beta.terminal, false);
  const stop = await wave.close({ reason: 'W3 watchdog cleanup.' });
  assert.equal(stop.remainingCount, 0);
});

test('W4: a blocked member surfaces attention through progress, never reads as completed', async (t) => {
  const scenarios = {
    alpha: {
      outcome: 'completed',
      edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }],
      ask: { kind: 'question', question: 'which section should this cover?', blocking: true },
    },
  };
  const { baton, repo } = harness(t, scenarios);
  const wave = await createWave(baton, { repoRoot: repo,  members: [member('alpha', 'block and wait')] });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const progress = await wave.progress();
  const alpha = progress.members[0];
  assert.notEqual(alpha.phase, 'work_completed');
  assert.notEqual(alpha.phase, 'completed');
  assert.ok(alpha.attention !== null && alpha.attention !== undefined && alpha.attention !== 'clear',
    'blocked members surface attention for the orchestrator');
  await wave.close({ reason: 'W4 cleanup.' });
});

test('W5: a bare-directory scope fails admission with the corrective glob form; glob scopes pass', async (t) => {
  const scenarios = {
    alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] },
  };
  const { baton, repo } = harness(t, scenarios);
  await assert.rejects(() => createWave(baton, {
    members: [member('alpha', 'write the alpha report', { scope: ['reports'] })],
  }), (error) => error.code === 'wave_scope_invalid' && /reports\/\*\*/u.test(error.message));
  const wave = await createWave(baton, { repoRoot: repo,  members: [member('alpha', 'write the alpha report')] });
  const outcomes = await wave.settle({ timeoutMs: 20_000 });
  assert.match(outcomes[0].resultSha ?? '', /^[a-f0-9]{40}$/u);
  await wave.close({ reason: 'W5 settled.' });
});

test('W6: stopMember stops exactly that member and the sibling continues to completion', async (t) => {
  const scenarios = {
    alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] },
    beta: { outcome: 'completed', edits: [{ path: 'reports/beta.md', content: 'beta report\n', delayMs: 30_000 }] },
  };
  const { baton, repo } = harness(t, scenarios);
  const wave = await createWave(baton, { repoRoot: repo, 
    members: [member('alpha', 'write the alpha report'), member('beta', 'write the beta report slowly')],
  });
  const stop = await wave.stopMember('beta', { reason: 'selective stop proof' });
  assert.ok(stop.admitted === true || stop.stopped === true, 'selective stop admitted');
  const outcomes = await wave.settle({ timeoutMs: 20_000 });
  const alpha = outcomes.find((outcome) => outcome.role === 'alpha');
  const beta = outcomes.find((outcome) => outcome.role === 'beta');
  assert.match(alpha.resultSha ?? '', /^[a-f0-9]{40}$/u, 'sibling completes after the selective stop');
  assert.notEqual(beta.phase, 'work_completed');
  const closeStop = await wave.close({ reason: 'W6 settled.' });
  assert.equal(closeStop.remainingCount, 0);
});

test('W7: materialized results disambiguate preserved pins by report path, never by newest-pin guessing', async (t) => {
  const scenarios = {
    alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] },
    beta: { outcome: 'completed', edits: [{ path: 'reports/beta.md', content: 'beta report\n' }] },
  };
  const { baton, repo } = harness(t, scenarios);
  const wave = await createWave(baton, { repoRoot: repo, 
    members: [member('alpha', 'write the alpha report'), member('beta', 'write the beta report')],
  });
  const outcomes = await wave.settle({ timeoutMs: 20_000 });
  for (const outcome of outcomes) {
    const listed = execFileSync('git', ['ls-tree', '-r', '--name-only', outcome.resultSha, '--', 'reports'], { cwd: repo, encoding: 'utf8' }).trim();
    assert.equal(listed, `reports/${outcome.role}.md`, `${outcome.role} result binds its own report path`);
    const body = execFileSync('git', ['show', `${outcome.resultSha}:reports/${outcome.role}.md`], { cwd: repo, encoding: 'utf8' });
    assert.match(body, new RegExp(`${outcome.role} report`, 'u'));
  }
  await wave.close({ reason: 'W7 settled.' });
});

test('W8: close returns per-member stops with ownership receipts and a zero-residue summary', async (t) => {
  const scenarios = {
    alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] },
    beta: { outcome: 'completed', edits: [{ path: 'reports/beta.md', content: 'beta report\n' }] },
  };
  const { baton, repo } = harness(t, scenarios);
  const wave = await createWave(baton, { repoRoot: repo, 
    members: [member('alpha', 'write the alpha report'), member('beta', 'write the beta report')],
  });
  await wave.settle({ timeoutMs: 20_000 });
  const stop = await wave.close({ reason: 'W8 settled.' });
  assert.equal(stop.stops.length, 2);
  assert.equal(stop.remainingCount, 0);
  const record = wave.evidence();
  assert.equal(record.members.length, 2);
  assert.ok(Array.isArray(record.outcomes) && Array.isArray(record.progress) && Array.isArray(record.stops));
});

test('W9: the baton.waves facade starts a wave through the client getter', async (t) => {
  const scenarios = {
    alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] },
  };
  const { baton, repo } = harness(t, scenarios);
  const wave = await baton.waves.start({
    repoRoot: repo,
    members: [member('alpha', 'write the alpha report')],
  });
  const outcomes = await wave.settle({ timeoutMs: 20_000 });
  assert.match(outcomes[0].resultSha ?? '', /^[a-f0-9]{40}$/u);
  await wave.close({ reason: 'W9 settled.' });
});
