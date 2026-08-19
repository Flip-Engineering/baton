// #199 root pin (row-spawn-window): no failed-verdict inside the spawn-confirmation window.
//
// Reproduces the issue's event shape — claim -> lifecycle.spawned -> process_started ->
// turn_started -> a SECOND lifecycle.spawned (the harness double-spawn) — and asserts the
// member is NOT verdict-failed while its evidence advances (the turn completes and the result
// materializes). Before the root fix, the second spawned failed the coordinator's provider-ready
// gate (invalid_provider_ready), killed the member, and failed its task while the provider kept
// working orphaned — the wave then verdict-failed the member.

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

const repoId = 'repo-spawn-window';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-spawn-window-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

const member = (role, objective) => ({
  role,
  objective: `${objective} (marker:${role})`,
  harness: 'mock', model: 'mock-model', effort: 'low',
  scope: ['reports/**'],
  report: `reports/${role}.md`,
});

// A MockAdapter whose spawn additionally emits the exact provider lifecycle the omp harness
// attests — a session-bound lifecycle.spawned carrying no session identity (the member IS the
// attestation), then process_started/process_ready, then — once the member is confirmed — a
// SECOND lifecycle.spawned: the harness double-spawn that races the spawn-confirmation window.
class DoubleSpawnAdapter extends MockAdapter {
  constructor(config = {}) {
    super(config);
    this.doubleSpawn = config.doubleSpawn !== false;
    this._nextPid = 4242;
  }

  async spawn(worker, brief, opts = {}) {
    const ack = await super.spawn(worker, brief, opts);
    if (!ack.ok) return ack;
    if (!this.doubleSpawn) return ack;
    const session = this._sessions.get(worker);
    if (!session) return ack;
    const generation = opts.processGeneration ?? 1;
    const pid = this._nextPid;
    this._nextPid += 7;
    session.processGeneration = generation;
    session.processPid = pid;
    session.processStarted = true;
    // First spawned + the exact process lifecycle telemetry (process-lifecycle payload shapes).
    this._emit(session, 'lifecycle.spawned', { phase: 'spawn' });
    this._emit(session, 'lifecycle.process_started', {
      schemaVersion: 1, generation, pid, processGroupId: pid, phase: 'initializing',
    });
    this._emit(session, 'lifecycle.process_ready', {
      schemaVersion: 1, generation, pid, processGroupId: pid,
    });
    session.processReady = true;
    // The harness double-spawn: a SECOND lifecycle.spawned after the dispatch stack settles —
    // the coordinator's processRef is confirmed (ready) and the member is working, exactly the
    // window where the pre-fix gate refused the re-attestation and killed the member.
    queueMicrotask(() => {
      const live = this._sessions.get(worker);
      if (live && !live.terminal) this._emit(live, 'lifecycle.spawned', { phase: 'spawn' });
    });
    return ack;
  }

  // A confirmed process generation closes exactly like a real adapter's kill: process_closed
  // (correlated to the started/ready generation) before the kill confirmation, so the
  // coordinator's exact-close validation can finalize the two-phase stop.
  _finalizeStop(worker) {
    const session = this._sessions.get(worker);
    if (session && session.processStarted) {
      this._emit(session, 'lifecycle.process_closed', {
        schemaVersion: 1, generation: session.processGeneration,
        pid: session.processPid, processGroupId: session.processPid,
        code: null, signal: 'SIGTERM', ready: session.processReady === true,
      });
    }
    super._finalizeStop(worker);
  }
}

function harness(t, adapter) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    adapters: { mock: adapter },
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

test('spawn-window: the harness double-spawn binds to the same member — never a failed verdict while evidence advances', async (t) => {
  const adapter = new DoubleSpawnAdapter({
    scenario: {
      outcome: 'completed',
      edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }],
    },
  });
  const { baton, repo } = harness(t, adapter);
  const wave = await createWave(baton, {
    repoRoot: repo,
    members: [member('alpha', 'write the alpha report')],
  });
  let t0 = Date.now();
  const outcomes = await wave.settle({ timeoutMs: 20_000 });
  console.log(`[timing] settle ${Date.now() - t0}ms`); t0 = Date.now();
  const alpha = outcomes.find((outcome) => outcome.role === 'alpha');
  assert.notEqual(alpha.phase, 'failed',
    'the double-spawned member must not be verdict-failed by a status read racing the spawn-confirmation window');
  assert.notEqual(alpha.phase, 'cancelled',
    'the double-spawn must not cancel the claimed task');
  assert.ok(alpha.terminal === true || alpha.phase === 'result_ready',
    `the member settles terminal/result_ready while evidence advances (got ${alpha.phase})`);
  assert.match(alpha.resultSha ?? '', /^[a-f0-9]{40}$/u,
    'the member keeps working after the second spawned and its result materializes');
  const stop = await wave.close({ reason: 'spawn-window settled.' });
  console.log(`[timing] close ${Date.now() - t0}ms remaining=${stop?.remainingCount}`);
});

test('spawn-window: without the double-spawn the same lifecycle settles result_ready (control)', async (t) => {
  const adapter = new DoubleSpawnAdapter({
    doubleSpawn: false,
    scenario: {
      outcome: 'completed',
      edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }],
    },
  });
  const { baton, repo } = harness(t, adapter);
  const wave = await createWave(baton, {
    repoRoot: repo,
    members: [member('alpha', 'write the alpha report')],
  });
  const outcomes = await wave.settle({ timeoutMs: 20_000 });
  const alpha = outcomes.find((outcome) => outcome.role === 'alpha');
  assert.ok(alpha.terminal === true || alpha.phase === 'result_ready', `control member settles (${alpha.phase})`);
  assert.match(alpha.resultSha ?? '', /^[a-f0-9]{40}$/u, 'control member result materializes');
  await wave.close({ reason: 'spawn-window control settled.' });
});
