// cli-crash-stderr-tail.test.mjs — issue #326 rendering: the redacted stderr tail a CLI
// worker dies with must be visible where the crash reason already reads — the run.debug
// member failure leg and the swarm.view participant row. Hermetic: a MockAdapter-driven
// application (the issue53 red-suite pattern) plus a fixture SwarmRuntime; no provider
// process beyond the adapter unit rows in muse-adapter.test.mjs, no network, no quota.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime, lastCrashOf } from '../src/swarm-runtime.mjs';

const repoId = 'repo-crash-stderr-tail';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-crash-tail-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

class CrashAdapter extends MockAdapter {
  emit(event) {
    const session = this._sessions.get(event.worker);
    if (session) this._emit(session, event.kind, event.payload ?? {});
  }
}

function harness(t) {
  const repo = root('repo');
  const logDir = root('log');
  const adapter = new CrashAdapter({ harness: 'mock', scenario: { outcome: 'completed', edits: [] } });
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    adapters: { mock: adapter },
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 3_600_000,
        riskClasses: ['low'], effectClasses: ['repository_edit', 'provider_call'], capabilityClasses: ['code', 'test'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
          maxGoalBytes: 65_536, maxPlanBytes: 262_144, maxStatusBytes: 262_144,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 1_440, maxProviderTurns: 10_000,
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
        schemaVersion: 1, repoId,
        definitionOfDone: ['deployment verification passes'],
        constraints: [], risk: 'low',
        goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
        pathScope: ['**'],
        verification: { command: 'true', arguments: [], cwd: '.', envAllowlist: [], expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65_536, requiredPredecessorEvidence: [] },
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
    try { await application.shutdown(principal('cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, adapter };
}

async function startRun(baton) {
  const run = await baton.runs.start('crash tail fixture (marker:x)', {
    exact: { harness: 'mock', model: 'mock-model', effort: 'low' },
    scope: ['reports/**'], driverKind: 'wave',
  });
  await run.approve();
  const status = await run.status();
  const view = status?.view ?? status ?? {};
  const workerId = (Array.isArray(view.attention) ? view.attention : []).find((item) => typeof item?.workerId === 'string')?.workerId
    ?? view?.outline?.workerId ?? 'w-1';
  return { run, workerId, runId: run.id ?? status?.runId ?? view?.runId };
}

const emit = (adapter, workerId, kind, payload) => adapter.emit({
  worker: workerId, harness: 'mock@1.0.0', turnEpoch: 1, kind, actor: 'worker', payload,
});

test('#326: run.debug failure carries the crash stderrTail beside the exit error', async (t) => {
  const { application, baton, adapter } = harness(t);
  const { workerId, runId } = await startRun(baton);
  emit(adapter, workerId, 'lifecycle.crashed', {
    error: 'exited 1 (null)', stderrTail: 'muse: error: invalid API key (fake-render)',
  });

  const debug = await application.debug({ runId }, principal('observer'));
  const member = debug.members[0];
  assert.equal(member.failure.kind, 'lifecycle.crashed');
  assert.equal(member.failure.message, 'exited 1 (null)');
  assert.equal(member.failure.stderrTail, 'muse: error: invalid API key (fake-render)');
});

test('#326: run.debug failure omits stderrTail when the crash carries none', async (t) => {
  const { application, baton, adapter } = harness(t);
  const { workerId, runId } = await startRun(baton);
  emit(adapter, workerId, 'lifecycle.crashed', { error: 'exited 1 (null)' });

  const debug = await application.debug({ runId }, principal('observer'));
  assert.equal(debug.members[0].failure.message, 'exited 1 (null)');
  assert.ok(!('stderrTail' in debug.members[0].failure), 'absence reads as absence, never an empty guess');
});

test('#326: the wired swarm lastCrash reads the seat ledger — error and tail, null when unreadable', async (t) => {
  const { application, baton, adapter } = harness(t);
  const { workerId } = await startRun(baton);
  emit(adapter, workerId, 'lifecycle.crashed', {
    error: 'exited 1 (null)', stderrTail: 'muse: error: invalid API key (fake-wired)',
  });

  const runtime = application._swarmRuntime();
  assert.deepEqual(runtime.lastCrash(workerId), {
    error: 'exited 1 (null)', stderrTail: 'muse: error: invalid API key (fake-wired)',
  });
  assert.equal(runtime.lastCrash('no-such-worker'), null);
  assert.equal(runtime.lastCrash(null), null);
});

test('#326: lastCrashOf projects the last crash only — null without one', () => {
  assert.equal(lastCrashOf([]), null);
  assert.equal(lastCrashOf(null), null);
  assert.equal(
    lastCrashOf([{ kind: 'content.message', payload: { text: 'hi' } }]),
    null,
  );
  assert.deepEqual(
    lastCrashOf([
      { kind: 'lifecycle.crashed', payload: { error: 'first' } },
      { kind: 'content.message', payload: { text: 'later' } },
      { kind: 'lifecycle.crashed', payload: { error: 'exited 1 (null)', stderrTail: 'tail-line' } },
    ]),
    { error: 'exited 1 (null)', stderrTail: 'tail-line' },
  );
  assert.deepEqual(
    lastCrashOf([{ kind: 'lifecycle.crashed', payload: { error: 'bare' } }]),
    { error: 'bare', stderrTail: null },
  );
});

function swarmFixture(t, { lastCrash = null } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-crash-tail-swarm-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
  };
  const runtime = new SwarmRuntime({
    store,
    coordinator,
    authorize: async () => {},
    prepareRun: async () => {},
    startRun: async (request) => {
      workers.push({
        id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working',
      });
    },
    stopRun: async () => ({ state: 'closed' }),
    ...(lastCrash === null ? {} : { lastCrash }),
  });
  const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...(command === 'list' ? {} : { swarmId: 'tail' }),
      ...(['list', 'view', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `tail-${++key}` }),
      ...args }, caller);
  return { store, workers, coordinator, runtime, owner, call };
}

test('#326: swarm.view participant rows carry the crash beside the dead runtime state', async (t) => {
  const crashes = new Map();
  const f = swarmFixture(t, { lastCrash: (workerId) => crashes.get(workerId) ?? null });
  await f.call('create', { purpose: 'Crash row' });
  await f.call('recruit', { participantId: 'crashed-seat', objective: 'Die loudly' });
  const worker = f.workers[0];
  crashes.set(worker.id, { error: 'exited 1 (null)', stderrTail: 'muse: error: gone (fake-row)' });
  worker.status = 'dead';

  const view = await f.call('view');
  const row = view.participants.find((entry) => entry.participantId === 'crashed-seat');
  assert.equal(row.runtime.state, 'dead');
  assert.deepEqual(row.crash, { error: 'exited 1 (null)', stderrTail: 'muse: error: gone (fake-row)' });
});

test('#326: swarm.view participant rows read crash null when no authority is wired', async (t) => {
  const f = swarmFixture(t);
  await f.call('create', { purpose: 'No crash authority' });
  await f.call('recruit', { participantId: 'plain-seat', objective: 'Die quietly' });
  f.workers[0].status = 'dead';

  const view = await f.call('view');
  const row = view.participants.find((entry) => entry.participantId === 'plain-seat');
  assert.equal(row.runtime.state, 'dead');
  assert.equal(row.crash, null);
});
