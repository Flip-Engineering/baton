// Issue #200 — member task ids carry the wave namespace (row-task-namespace).
//
// RED at pre-change head: a wave member's run id derives from the objective digest WITHOUT the
// wave instance (application.mjs's `run-${digest({objective, profileDigest, route, scope, ...})}`
// — the deliberate-exclusion seam), so two distinct logical waves (different idempotencyKey →
// different waveId) with BYTE-IDENTICAL member objectives resolve to the SAME runId. The second
// drive's member then binds the FIRST wave's dead task: no steering.registered mint (the run
// already exists), approve on the dead run refuses, and the member verdicts failed with NO fresh
// spawn (the phantom-root #200 bind — the row brief's "binds the dead task and verdicts failed
// with no spawn").
//
// GREEN: the member run identity folds in the wave instance at the member mint (wave.mjs
// createWave — the additive salt at the member mint): the runId — and with it the dispatched
// task id (`baton-<digest({repoId, runId, planDigest, nodeKey, ...})>-<role>`, application.mjs
// _dispatchCurrent) — derives from (waveId, role, brief content). Two distinct-key waves with
// byte-identical briefs mint distinct member tasks, and the second drive spawns fresh. A same-key
// re-drive still dedupes (the 93B client-retry contract): same waveId + same role + same brief →
// same runId → idempotent run.start resume.
//
// The pin drives the interpreter seam (createWave) with byte-identical pre-rendered member
// objectives — the derivation, not a salt, must carry the namespace.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import { createWave } from '../src/wave.mjs';

const repoId = 'repo-wave-task-namespace';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-wave-ns-${label}-`));
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
      provenance: 'wave-task-namespace-test', refreshedAt: null,
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

function tasksByRun(driver, runId) {
  if (runId === null) return null;
  const tasks = driver.coordination.snapshot().tasks ?? [];
  return tasks.find((task) => task?.runId === runId) ?? null;
}

// The member run id is discoverable from the wave's OWN steering-registered record (the durable
// (waveId, waveRole) → runId binding the wave surfaces read) — present only when the member
// actually started a run of its own. A drive that binds a prior wave's dead task mints NO record
// for the second wave (run.start found the existing run), so this returns null at head.
function memberRunIdFor(driver, waveId, role) {
  const events = driver.coordination.eventsView() ?? [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const payload = events[index]?.payload ?? {};
    if (payload.kind === 'steering.registered'
      && payload.waveId === waveId && payload.waveRole === role
      && typeof payload.runId === 'string') {
      return payload.runId;
    }
  }
  return null;
}

test('NS-1: two waves with byte-identical member briefs and DISTINCT idempotency keys mint distinct member task ids — the second drive spawns fresh, never binding the prior wave dead task (#200)', async (t) => {
  const scenarios = {
    alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] },
  };
  const tracker = { calls: [] };
  const { baton, driver, repo } = harness(t, scenarios, tracker);
  // Byte-identical member brief across both drives — the namespace must come from the WAVE,
  // never from a per-drive salt (a salt change would mint a fresh run even at head).
  const brief = member('alpha', 'write the shared report');

  const first = await createWave(baton, {
    repoRoot: repo,
    members: [brief],
    idempotencyKey: 'ns-wave-a',
  });
  const firstRunId = memberRunIdFor(driver, first.waveId, 'alpha');
  assert.ok(firstRunId, 'wave A member run is registered to its wave');
  const firstOutcomes = await first.settle({ timeoutMs: 20_000 });
  const firstTask = tasksByRun(driver, firstRunId);
  assert.ok(firstTask, 'wave A member task is dispatched');
  assert.match(firstOutcomes[0]?.resultSha ?? '', /^[a-f0-9]{40}$/u, 'wave A member settled with a preserved result');
  await first.close({ reason: 'namespace wave A settled.' });

  const second = await createWave(baton, {
    repoRoot: repo,
    members: [brief],
    idempotencyKey: 'ns-wave-b',
  });
  const secondRunId = memberRunIdFor(driver, second.waveId, 'alpha');
  const secondOutcomes = await second.settle({ timeoutMs: 20_000 });
  const secondTask = tasksByRun(driver, secondRunId);
  await second.close({ reason: 'namespace wave B settled.' });

  // The member run identity carries the wave instance.
  assert.ok(secondRunId, 'wave B member started its OWN run — at head it binds the dead task and mints no run');
  assert.notEqual(secondRunId, firstRunId,
    'distinct keys → distinct member run ids — the runId folds in the wave namespace');
  // The task id (`baton-<sha24>-<role>`, application.mjs _dispatchCurrent) derives from the
  // runId, so distinct runs never share a task.
  assert.ok(secondTask, 'wave B member task is dispatched (the second drive spawns fresh)');
  assert.notEqual(secondTask.id, firstTask.id,
    'distinct keys → distinct member task ids — a same-brief re-drive NEVER collides with the prior attempt task id');
  // The second drive is a live member of ITS OWN wave, not the prior wave's dead task.
  assert.equal(secondOutcomes[0]?.phase, 'result_ready',
    'the second drive verdicts success on its own fresh run — at head it verdicts failed with no spawn');
  assert.match(secondOutcomes[0]?.resultSha ?? '', /^[a-f0-9]{40}$/u,
    'the second drive materializes its own result');
  assert.equal(tracker.calls.length, 2,
    'both drives spawned exactly once each — the re-drive spawns fresh instead of no-spawn binding the dead task');
});

test('NS-2: a SAME-key live-wave re-drive of the identical brief stays idempotent — the derived member run id dedupes on run.start (93B client-retry / driver ritual resume)', async (t) => {
  const scenarios = {
    alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] },
  };
  const tracker = { calls: [] };
  const { baton, driver, repo } = harness(t, scenarios, tracker);
  const brief = member('alpha', 'write the shared report');

  const first = await createWave(baton, {
    repoRoot: repo,
    members: [brief],
    idempotencyKey: 'ns-same-key',
  });
  const firstRunId = memberRunIdFor(driver, first.waveId, 'alpha');
  assert.ok(firstRunId, 'wave A member run is registered');

  // A same-key re-drive while the wave is still live (client retry / the driver's ritual resume,
  // allowTerminalReplay: true): the SAME waveId + role + brief derive the SAME run id, so
  // run.start resumes the existing run — no second task, no stranding, approve stays a no-op.
  const retry = await createWave(baton, {
    repoRoot: repo,
    members: [brief],
    idempotencyKey: 'ns-same-key',
    allowTerminalReplay: true,
  });
  const retryRunId = memberRunIdFor(driver, retry.waveId, 'alpha');
  assert.equal(retryRunId, firstRunId,
    'same key + same brief → same member run id — the re-drive dedupes idempotently');
  assert.equal(tasksByRun(driver, retryRunId)?.id, tasksByRun(driver, firstRunId)?.id,
    'one task for one logical member — the retry never mints a second, unreachable task');

  const firstOutcomes = await first.settle({ timeoutMs: 20_000 });
  assert.match(firstOutcomes[0]?.resultSha ?? '', /^[a-f0-9]{40}$/u, 'the shared member run settles to a preserved result');
  await first.close({ reason: 'namespace same-key wave settled.' });
  await retry.close({ reason: 'namespace same-key retry cleanup.' });
  assert.equal(tracker.calls.length, 1,
    'the same-key re-drive spawns NOTHING new — exactly one spawn for the one logical member');
});
