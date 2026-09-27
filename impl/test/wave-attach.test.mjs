// Wave attach-and-harvest (93B contract v2) red suite: a wave's DRIVER is a process and can
// die; its member runs are durable. A fresh host re-attaches by waveId over the SAME runs
// (never re-started), harvests outcomes through the live handle, and refuses to guess.
// Rows pin: same-run attach with honest terminal phases (W93-1), turn.settled replay dedup
// taxonomy across attach (W93-2), idempotent settle on an all-terminal wave (W93-3),
// distinct waveIds per attempt + typed unknown-wave refusal (W93-4), and exactly-once
// wave.driver_detached across repeated attaches (W93-5).
//
// Deterministic: MockAdapter/PausableAdapter fixtures, no live providers, fixed roots.
// Documented fold (contract rule 2): the handle's startedAt seeds from the earliest MATCHED
// member's start rather than the wave.started record — the tight correct lower bound for
// pin disambiguation (a member result cannot be preserved before that member started), and
// readable through the client surface (wave.started lives in the coordination log, which
// the client facade deliberately does not expose).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';

const repoId = 'repo-wave-attach';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-wave-attach-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

function waveIdFor(idempotencyKey) {
  return `wave:${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`;
}

async function until(check, label, timeoutMs = 20_000, pollMs = 50) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label} never became true within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

// settle()'s own resting-or-dead condition (wave.mjs): `result_ready` is terminal-RESTING, never
// in the dead canonical set — progress().terminal alone would park the poll forever.
const settledish = (entry) => entry?.terminal === true || entry?.phase === 'result_ready';

// The stock mock whose spawn() selects a scenario by matching `(marker:<role>)` in the brief.
function markerAdapter(scenariosByMarker) {
  const adapter = new MockAdapter({ scenario: scenariosByMarker.default ?? { outcome: 'completed' } });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null,
      provenance: 'wave-attach-test', refreshedAt: null,
    },
  });
  const nativeSpawn = adapter.spawn.bind(adapter);
  adapter.spawn = (worker, brief, options) => {
    const goal = brief?.goal ?? '';
    const marker = Object.keys(scenariosByMarker).find((key) => key !== 'default' && goal.includes(key));
    const scenario = scenariosByMarker[marker] ?? scenariosByMarker.default;
    return nativeSpawn(worker, brief, { ...options, scenario });
  };
  return adapter;
}

// Pausable variant (W93-2): turnCompletion 'pausable', scripted turns, +1 wire epoch per
// nudge to stay in lockstep with the fence — the wave-driver-policy-red pattern, which
// exists precisely because the stock mock's constant wire epoch is rejected as stale on
// the second turn (coordinator.mjs:10159).
class PausableAdapter extends MockAdapter {
  constructor({ scriptsByMarker, ...config } = {}) {
    super(config);
    this._scriptsByMarker = scriptsByMarker ?? {};
  }

  card() {
    return {
      ...super.card(),
      turnCompletion: 'pausable',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
        family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low'], serviceTier: null,
        provenance: 'wave-attach-pausable', refreshedAt: null,
      },
    };
  }

  _markerIn(goal) {
    return Object.keys(this._scriptsByMarker).find((key) => key !== 'default' && goal.includes(`(marker:${key})`)) ?? 'default';
  }

  _scriptForMarker(marker) {
    return this._scriptsByMarker[marker] ?? this._scriptsByMarker.default ?? [{ edits: [] }];
  }

  async spawn(worker, brief, options = {}) {
    const goal = brief?.goal ?? '';
    const marker = this._markerIn(goal);
    this._markerByWorker = this._markerByWorker ?? new Map();
    this._markerByWorker.set(worker, marker);
    const script = this._scriptForMarker(marker);
    this._turnCount = this._turnCount ?? new Map();
    this._turnCount.set(worker, 0);
    return super.spawn(worker, brief, {
      ...options,
      scenario: this._scenarioForTurn(script, 0),
      turnEpoch: 0,
    });
  }

  _scenarioForTurn(script, index) {
    const turn = script[index] ?? script.at(-1) ?? { edits: [] };
    return {
      outcome: 'completed',
      summary: `pausable turn ${index}`,
      edits: (turn.edits ?? []).map((edit) => ({ ...edit })),
    };
  }

  async prompt(worker, message, mode) {
    if (mode === 'turn') {
      const script = this._scriptForMarker(this._markerByWorker?.get(worker) ?? 'default');
      const count = (this._turnCount?.get(worker) ?? 0) + 1;
      this._turnCount.set(worker, count);
      const session = this._sessions.get(worker);
      if (session) {
        session.terminal = false;
        session.runStarted = false;
        session.stopKind = null;
        session.crashed = false;
        session.timeoutHit = false;
        session.deniedApproval = false;
        session.askHandled = false;
        session.scenario = this._scenarioForTurn(script, count);
        session.opts = { ...session.opts, turnEpoch: count };
        this._startSession(session);
      }
    }
    return super.prompt(worker, message, mode);
  }
}

function checkpointOf(outline) {
  const attention = Array.isArray(outline?.attention) ? outline.attention : [];
  return attention.find((entry) => entry?.kind === 'turn_checkpoint' && typeof entry?.requestId === 'string')
    ?? null;
}

function openHost(repo, logDir, adapter) {
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
  return { application, baton, driver };
}

const member = (role, objective) => ({
  role,
  objective: `${objective} (marker:${role})`,
  harness: 'mock', model: 'mock-model', effort: 'low',
  scope: ['reports/**'],
  report: `reports/${role}.md`,
});

function driverEvents(driver, kind, waveId = null) {
  return driver.coordination.events().filter((event) => (
    event.kind === 'driver.recorded' && event.payload?.kind === kind
    && (waveId === null || event.payload?.waveId === waveId)
  ));
}

async function shutdown(host, actor = 'owner') {
  await host.application.shutdown(principal(actor));
}

test('W93-1: a wave whose driver dies mid-flight is attachable by a fresh host — same runs, honest terminal phases, harvested outcomes', async (t) => {
  const scenarios = {
    alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] },
    beta: { outcome: 'completed', edits: [{ path: 'reports/beta.md', content: 'beta report\n', delayMs: 60_000 }] },
  };
  const repo = root('w931-repo');
  const logDir = root('w931-log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  t.after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(logDir, { recursive: true, force: true }); });

  const host1 = openHost(repo, logDir, markerAdapter(scenarios));
  const waveId = waveIdFor('w93-1');
  const members = [member('alpha', 'write the alpha report'), member('beta', 'write the beta report')];
  const wave = await host1.baton.waves.start({ repoRoot: repo, idempotencyKey: 'w93-1', members });
  await until(async () => settledish((await wave.progress()).members.find((entry) => entry.role === 'alpha')),
    'alpha terminal pre-death');
  const before = await host1.baton.runs.list();
  const runIdsBefore = Object.fromEntries(before.items.map((item) => [item.objective, item.id]));
  assert.equal(Object.keys(runIdsBefore).length, 2, 'both member runs exist pre-death');

  // Driver death: no settle, no close — the loop simply stops existing.
  await shutdown(host1);

  const host2 = openHost(repo, logDir, markerAdapter(scenarios));
  t.after(async () => { await host2.application.shutdown(principal('cleanup')).catch(() => {}); });

  // wave.started minted pre-loop is durable across the death.
  const started = driverEvents(host2.driver, 'wave.started', waveId);
  assert.equal(started.length, 1, 'exactly one wave.started for this waveId');
  assert.deepEqual(started[0].payload.roster, ['alpha', 'beta']);
  assert.equal(started[0].payload.idempotencyKey, 'w93-1');

  const attached = await host2.baton.waves.attach(waveId, members, { repoRoot: repo });
  const after = await host2.baton.runs.list();
  const runIdsAfter = Object.fromEntries(after.items.map((item) => [item.objective, item.id]));
  assert.deepEqual(runIdsAfter, runIdsBefore, 'attach binds the SAME runs — nothing re-started');

  const progress = await attached.progress();
  for (const entry of progress.members) {
    assert.equal(settledish(entry), true, `${entry.role} reads its honest resting-or-dead phase, never 'continued'`);
  }
  assert.equal(progress.members.find((entry) => entry.role === 'beta')?.terminal, true,
    'beta died mid-flight — genuinely dead-terminal, never resting');
  const outcomes = await attached.settle({ timeoutMs: 5_000 });
  const alpha = outcomes.find((outcome) => outcome.role === 'alpha');
  const beta = outcomes.find((outcome) => outcome.role === 'beta');
  assert.match(alpha.resultSha ?? '', /^[a-f0-9]{40}$/u, 'alpha outcome harvested from the preserved result');
  assert.equal(beta.terminal, true);
  assert.equal(beta.resultSha, null, 'beta died mid-flight with nothing preserved — re-drive is rule 5');
  const closed = await attached.close({ reason: 'W93-1 harvested.' });
  assert.equal(closed.remainingCount, 0);
});

test('W93-2: turn.settled replay dedups steering across attach — a consumed pause refuses not_found, a terminalized pause refuses not_paused', async (t) => {
  const scripts = {
    alpha: [
      { edits: [{ path: 'reports/alpha-1.md', content: 'turn 0\n' }] },
      { edits: [{ path: 'reports/alpha-2.md', content: 'turn 1\n' }] },
    ],
  };
  const repo = root('w932-repo');
  const logDir = root('w932-log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  t.after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(logDir, { recursive: true, force: true }); });

  const host1 = openHost(repo, logDir, new PausableAdapter({ scriptsByMarker: scripts }));
  const waveId = waveIdFor('w93-2');
  const members = [member('alpha', 'pausable alpha member')];
  const wave = await host1.baton.waves.start({ repoRoot: repo, idempotencyKey: 'w93-2', members });
  const alphaRun = wave.runs.get('alpha');

  const p1 = await until(async () => {
    const status = await alphaRun.status();
    return checkpointOf(status?.view ?? status)?.requestId ?? null;
  }, 'first turn checkpoint parked');
  // The real driver lane: nudge through the advertised action. turn.settled {basis:'nudge',
  // pauseId:p1} lands durably and CONSUMES the p1 record; alpha re-parks at p2 (unacted).
  await alphaRun.act('nudge_turn', { message: 'continue into turn 1' });
  const p2 = await until(async () => {
    const status = await alphaRun.status();
    const requestId = checkpointOf(status?.view ?? status)?.requestId;
    return requestId && requestId !== p1 ? requestId : null;
  }, 'second turn checkpoint parked');
  await shutdown(host1);

  const host2 = openHost(repo, logDir, new PausableAdapter({ scriptsByMarker: scripts }));
  t.after(async () => { await host2.application.shutdown(principal('cleanup')).catch(() => {}); });
  await host2.baton.waves.attach(waveId, members, { repoRoot: repo });

  // p1's record was consumed by the pre-death nudge — replay never seeds it.
  const consumed = await host2.driver.coordinator.nudgeTurn(p1, 'post-attach nudge', { actor: 'test' });
  assert.equal(consumed.ok, false);
  assert.equal(consumed.result, 'not_found', 'consumed pause refuses not_found post-attach');
  // p2 survived as a dangling record on the recovery-terminalized member — reservation
  // succeeds but the task is no longer paused.
  const dangling = await host2.driver.coordinator.nudgeTurn(p2, 'post-attach nudge', { actor: 'test' });
  assert.equal(dangling.ok, false);
  assert.equal(dangling.result, 'not_paused', 'terminalized pause refuses not_paused post-attach');
});

test('W93-3: attach on an all-terminal wave is an idempotent settle — outcomes returned, close clean, zero recovery terminalization', async (t) => {
  const scenarios = {
    alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] },
    beta: { outcome: 'completed', edits: [{ path: 'reports/beta.md', content: 'beta report\n' }] },
  };
  const repo = root('w933-repo');
  const logDir = root('w933-log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  t.after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(logDir, { recursive: true, force: true }); });

  const host1 = openHost(repo, logDir, markerAdapter(scenarios));
  const waveId = waveIdFor('w93-3');
  const members = [member('alpha', 'write the alpha report'), member('beta', 'write the beta report')];
  const wave = await host1.baton.waves.start({ repoRoot: repo, idempotencyKey: 'w93-3', members });
  await until(async () => {
    const progress = await wave.progress();
    return progress.members.every((entry) => settledish(entry));
  }, 'all members terminal pre-death');
  await shutdown(host1);

  const host2 = openHost(repo, logDir, markerAdapter(scenarios));
  t.after(async () => { await host2.application.shutdown(principal('cleanup')).catch(() => {}); });
  const attached = await host2.baton.waves.attach(waveId, members, { repoRoot: repo });
  const outcomes = await attached.settle({ timeoutMs: 5_000 });
  assert.equal(outcomes.length, 2);
  for (const outcome of outcomes) {
    assert.match(outcome.resultSha ?? '', /^[a-f0-9]{40}$/u, `${outcome.role} outcome returned by the idempotent settle`);
  }
  const closed = await attached.close({ reason: 'W93-3 idempotent close.' });
  assert.equal(closed.remainingCount, 0);
  const recoveryEvents = host2.driver.coordination.events()
    .filter((event) => event.kind === 'control.recovery_terminalized');
  assert.equal(recoveryEvents.length, 0, 'an all-terminal wave replays zero recovery terminalization');
});

test('W93-4: waves.start mints distinct waveIds per idempotencyKey; an unknown or foreign waveId refuses with a typed error, never a silent new wave', async (t) => {
  const scenarios = {
    alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] },
  };
  const repo = root('w934-repo');
  const logDir = root('w934-log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  t.after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(logDir, { recursive: true, force: true }); });

  const host1 = openHost(repo, logDir, markerAdapter(scenarios));
  const waveA = await host1.baton.waves.start({
    repoRoot: repo, idempotencyKey: 'w93-4-a', members: [member('alpha', 'wave A alpha report')],
  });
  const waveB = await host1.baton.waves.start({
    repoRoot: repo, idempotencyKey: 'w93-4-b', members: [member('alpha', 'wave B alpha report')],
  });
  const started = driverEvents(host1.driver, 'wave.started');
  const mintedIds = new Set(started.map((event) => event.payload.waveId));
  assert.equal(mintedIds.size, 2, 'distinct idempotencyKeys mint distinct waveIds');
  assert.ok(mintedIds.has(waveIdFor('w93-4-a')) && mintedIds.has(waveIdFor('w93-4-b')),
    'waveId derivation is the deterministic idempotencyKey digest — a client retry attaches, never double-starts');
  await until(async () => settledish((await waveA.progress()).members[0])
    && settledish((await waveB.progress()).members[0]), 'both waves terminal');
  await shutdown(host1);

  const host2 = openHost(repo, logDir, markerAdapter(scenarios));
  t.after(async () => { await host2.application.shutdown(principal('cleanup')).catch(() => {}); });

  // Unknown waveId: no member runs carry the binding — typed refusal, hollow handle never returned.
  await assert.rejects(
    host2.baton.waves.attach('wave:0000000000000000000000000000000f', [member('alpha', 'wave A alpha report')]),
    (error) => error?.code === 'wave_attach_unknown_wave',
  );
  // Foreign waveId: wave A's runs exist but are bound to wave A — the binding check refuses
  // per member (application_wave_member_mismatch), and the zero-bound attach refuses.
  await assert.rejects(
    host2.baton.waves.attach(waveIdFor('w93-4-b'), [member('alpha', 'wave A alpha report')]),
    (error) => error?.code === 'wave_attach_unknown_wave',
  );
  // The binding refusal is directly observable at the application surface.
  const waveARun = (await host2.baton.runs.list()).items
    .find((item) => item.objective.includes('wave A alpha report'));
  await assert.rejects(
    host2.application.command('run.inspect', {
      runId: waveARun.id, mintWaveDetached: true, waveId: waveIdFor('w93-4-b'),
    }, principal('wave-owner')),
    (error) => error?.code === 'application_wave_member_mismatch',
  );
  // And the correct attach still succeeds (no false-positive from the binding check).
  const attached = await host2.baton.waves.attach(waveIdFor('w93-4-a'), [member('alpha', 'wave A alpha report')]);
  const outcomes = await attached.settle({ timeoutMs: 5_000 });
  assert.equal(outcomes.length, 1);
  assert.match(outcomes[0].resultSha ?? '', /^[a-f0-9]{40}$/u);
  await attached.close({ reason: 'W93-4 done.' });
});

test('W93-5: wave.driver_detached is recorded exactly once across repeated attaches of the same waveId', async (t) => {
  const scenarios = {
    alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] },
  };
  const repo = root('w935-repo');
  const logDir = root('w935-log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  t.after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(logDir, { recursive: true, force: true }); });

  const host1 = openHost(repo, logDir, markerAdapter(scenarios));
  const waveId = waveIdFor('w93-5');
  const members = [member('alpha', 'write the alpha report')];
  const wave = await host1.baton.waves.start({ repoRoot: repo, idempotencyKey: 'w93-5', members });
  await until(async () => settledish((await wave.progress()).members[0]), 'alpha terminal pre-death');
  // No settle, no close, and NO courtesy mint at close — the record must exist exactly
  // because an attach observed a driverless wave.
  assert.equal(driverEvents(host1.driver, 'wave.driver_detached', waveId).length, 0,
    'nothing mints driver_detached before any attach');
  await shutdown(host1);

  const host2 = openHost(repo, logDir, markerAdapter(scenarios));
  t.after(async () => { await host2.application.shutdown(principal('cleanup')).catch(() => {}); });
  const first = await host2.baton.waves.attach(waveId, members, { repoRoot: repo });
  const second = await host2.baton.waves.attach(waveId, members, { repoRoot: repo });
  const detached = driverEvents(host2.driver, 'wave.driver_detached', waveId);
  assert.equal(detached.length, 1, 'exactly one wave.driver_detached across repeated attaches (key-deduped)');
  const firstOutcomes = await first.settle({ timeoutMs: 5_000 });
  const secondOutcomes = await second.settle({ timeoutMs: 5_000 });
  assert.equal(firstOutcomes[0].resultSha, secondOutcomes[0].resultSha, 'repeated attach is idempotent');
  await first.close({ reason: 'W93-5 first.' });
  await second.close({ reason: 'W93-5 second.' });
});
