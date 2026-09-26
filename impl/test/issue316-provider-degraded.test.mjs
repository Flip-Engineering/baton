// issue316-provider-degraded.test.mjs — Issue #316: a provider fault class that kills N seats is
// ONE deployment-level fact, a watcher attachment that ends names why it ended, and a resident
// whose served commit is behind says so on every wake frame header.
//
// The observed failure (2026-09-14): every running participant on two residents ended a turn with
// `omp_error: OpenAI completions stream timed out while waiting for the first event`, was killed by
// policy within 50 ms and became a dead runtime — nine lanes, one provider fault class, forty
// minutes. The root learned of the deaths only by asking `swarm view` an hour later; the per-swarm
// watch attachments emitted nothing. #295 typed the faults and retries before the kill; #356 gave
// a stream end a reason. This file pins the three remainders:
//
//   (a) three seats dying on ONE route with the same fault class inside the deployment's own
//       provider-failure window fold to ONE `provider_degraded` attention row (the route, the
//       window, the fault class, every participant, and `next` = pause recruits until a probe
//       succeeds) — and the window bound is the deployment's DECLARED policy, so a deployment that
//       declares a narrower bound folds nothing it should not. The route then reads degraded in
//       the deployment's route table and a recruit on it refuses `route_degraded` until a later
//       successful turn on that route retires the episode.
//   (b) an attachment that ends delivers the typed final frame
//       `baton.wake_attachment_closed {reason, at, resumeFrom}` — over the real web transport (the
//       SSE attachment the CLI follows) and over the loopback WebSocket binding (the bridge), from
//       ONE closed reason set, never silence, and the CLI renders it.
//   (c) every wake frame header carries `served: {commit, behind}` derived from the repository the
//       resident serves, read once at publish and refreshed on the deployment-observation cadence
//       — never per frame.
//
// Hermetic: temp dirs under os.tmpdir(), fixture adapters, real git checkouts, no provider process,
// no network beyond loopback. `git stash` is never used.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore, coordinationForLog } from '../src/coordination-store.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { MockAdapter, createDriver } from '../src/index.mjs';
import * as deploymentModule from '../src/application-deployment.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import * as wakeStreamModule from '../src/wake-stream.mjs';
import { WAKE_STREAM_END_REASONS, WakeStream, attachWakeWebSocket, openWakeStream, parseWakeFilter } from '../src/wake-stream.mjs';
import { followWakes } from '../src/application-cli.mjs';

const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });
const STALL_CODE = 'provider_turn_failed';
const STALL_TEXT = 'OpenAI completions stream timed out while waiting for the first event';
const T0 = Date.parse('2026-09-14T20:00:00Z');
const MIN = 60_000;

const dirs = [];
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });
function tmpDir(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-issue316-${label}-`));
  dirs.push(dir);
  return dir;
}

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const waveOwner = { principalId: 'wave-owner', sessionId: 'session-wave-owner' };

// ── the coordinator half: the provider-fault fold ───────────────────────────────────────────────

/** A scriptable adapter whose card resolves ONE exact route, so a spawn says which route it speaks. */
class RouteAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null,
      maxContext: 100000, verbs: { spawn: 'native', prompt: 'native', interrupt: 'native', kill: 'native' },
      modelSelection: {
        mode: 'exact', family: 'mock', configuredDefault: 'mock-model', available: ['mock-model'],
        acceptedAliases: [], acceptedPrefixes: [], reasoningEffort: ['low'], configuredEffort: 'low',
        serviceTier: null,
      },
    };
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn() { return { ok: true }; }
  async prompt() { return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async kill() { return { ok: true }; }
}

function coordinatorFixture(t, { watchdog } = {}) {
  const root = tmpDir('coord');
  const log = new Log(join(root, 'log'));
  const adapter = new RouteAdapter();
  let clock = T0;
  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees: {
      pathFor: (taskId) => join(root, `wt-${taskId}`),
      async create(taskId) {
        const path = join(root, `wt-${taskId}`);
        mkdirSync(path, { recursive: true });
        writeFileSync(join(path, 'work.mjs'), '// the member produced this\n');
        return { path, branch: `baton/${taskId}`, baseSha: 'b'.repeat(40) };
      },
      async reconcile() { return { errors: [], retained: [] }; },
      worktreeAvailable: () => true,
    },
    referee: async (task) => ({ reverified: true, observedExit: task.brief.verification.expectExit,
      matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' }),
    route: () => 'mock',
    now: () => clock,
    ...(watchdog === undefined ? {} : { watchdog }),
  });
  return { coordinator, adapter, log, advance: (ms) => { clock += ms; } };
}

const brief = () => ({
  goal: 'do the thing', constraints: [], pathScope: ['.'], definitionOfDone: 'tests pass',
  verification: { command: 'true', expectExit: 0 }, budget: { tokens: 100000, usd: 5, wallMin: 30 },
});

/** The stall the deployment actually observed (2026-09-14): the provider never sent a first event,
 * the adapter typed the fault on the crash cert with the exact route it was speaking. */
function stallOut(adapter, handle) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.crashed', actor: 'worker',
    payload: { phase: 'provider', code: STALL_CODE, error: STALL_TEXT, detail: { route: ROUTE, resetAt: null } },
  });
}

/** One seat's death: the crash cert, the policy kill it draws, and the settlement the kill
 * confirms — the #295 path three seats took on 2026-09-14. */
async function seatStalls(coordinator, adapter, handle) {
  stallOut(adapter, handle);
  await coordinator.wait(25);
  const stopped = coordinator.kill(handle.id, 'policy');
  adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'kill.confirmed', actor: 'worker', payload: {} });
  await stopped;
  await coordinator.wait(25);
}

const reasonsFor = async (coordinator, runId) => {
  const page = await coordinator.attentionFollow({ scope: { runId }, afterCursor: 0 }, waveOwner);
  return page?.reasons ?? page?.wakes ?? [];
};

test('316-a1: three seats stalling on one route inside the declared window fold to ONE provider_degraded row', async (t) => {
  const { coordinator, adapter, log, advance } = coordinatorFixture(t, { watchdog: { stallMs: 10 * MIN } });

  const seats = [];
  for (const index of [1, 2, 3]) {
    const handle = await coordinator.spawn('mock', brief(), { runId: `run:316-a1-${index}` });
    seats.push(handle);
    await seatStalls(coordinator, adapter, handle);
    advance(MIN);
  }

  // Every death still lands as its own run-level row (the #295 contract is untouched) …
  const deaths = (await reasonsFor(coordinator, 'run:316-a1-1')).filter((row) => row.kind === 'provider_fault_death');
  assert.equal(deaths.length, 1, 'the seat\'s own death is still its run-level row');

  // … and the three of them are ONE deployment-level fact.
  const degraded = (await reasonsFor(coordinator, 'run:316-a1-1')).filter((row) => row.kind === 'provider_degraded');
  assert.equal(degraded.length, 1, 'one provider fault class is ONE provider_degraded row, never one per death');
  const row = degraded[0];
  assert.equal(row.runId, null, 'the row is deployment-level: the fault is about the route, not the run');
  assert.deepEqual(row.route, ROUTE, 'the row names the exact route that stalled');
  assert.equal(row.faultClass, STALL_CODE, 'the row names the typed fault class the provider answered with');
  assert.deepEqual(row.participants.slice().sort(), seats.map((handle) => handle.id).sort(),
    'every stalled seat is named on the one row, never dropped');
  assert.equal(row.count, 3, 'the row carries the number of deaths it folds');
  assert.equal(row.window.from, new Date(T0).toISOString(), 'the window opens at the first stall');
  assert.equal(row.window.to, new Date(T0 + 2 * MIN).toISOString(), 'and closes at the last one');
  assert.equal(row.next.action, 'pause_recruits_until_probe',
    'the next act pauses recruits on that route until a probe succeeds');
  assert.deepEqual(row.next.route, ROUTE);

  // The deployment-level row is visible from EVERY run's attention page — the root that was not
  // watching the dead seat's run still sees the route degrade.
  for (const index of [1, 2, 3]) {
    const seen = (await reasonsFor(coordinator, `run:316-a1-${index}`)).filter((entry) => entry.kind === 'provider_degraded');
    assert.equal(seen.length, 1, `run ${index} reads the deployment-level degrade`);
    assert.equal(seen[0].seq, row.seq, 'and reads the SAME row, never a per-run copy');
  }

  // The fold is durable evidence: the deployment derives its route state from the ledger, so the
  // episode lands as a typed row there rather than living in this process's memory.
  const durableKinds = new Set();
  for (const worker of log.workers()) for (const event of log.read(worker)) durableKinds.add(event.kind);
  assert.equal(durableKinds.has('provider.degraded'), true,
    'the fold lands a typed durable row for the deployment to derive its route state from');
});

test('316-a2: the fold window is the deployment\'s DECLARED bound, never a literal of this fold', async (t) => {
  // The SAME three deaths, 90 seconds apart, under two declared provider-failure windows.
  const wide = coordinatorFixture(t, { watchdog: { stallMs: 10 * MIN } });
  const narrow = coordinatorFixture(t, { watchdog: { stallMs: 60_000 } });

  for (const fixture of [wide, narrow]) {
    for (const label of ['x', 'y', 'z']) {
      const handle = await fixture.coordinator.spawn('mock', brief(), { runId: `run:316-a2-${label}` });
      await seatStalls(fixture.coordinator, fixture.adapter, handle);
      fixture.advance(90_000);
    }
  }

  const wideRows = (await reasonsFor(wide.coordinator, 'run:316-a2-x')).filter((row) => row.kind === 'provider_degraded');
  assert.equal(wideRows.length, 1, 'inside a ten-minute declared window the three deaths are one episode');
  assert.equal(wideRows[0].count, 3);

  const narrowRows = (await reasonsFor(narrow.coordinator, 'run:316-a2-x')).filter((row) => row.kind === 'provider_degraded');
  assert.equal(narrowRows.length, 3,
    'the same deaths under a one-minute declared window are three episodes — the bound is read, not invented');
  assert.deepEqual(narrowRows.map((row) => row.count), [1, 1, 1]);
  assert.deepEqual(narrowRows.map((row) => row.window.from),
    [T0, T0 + 90_000, T0 + 180_000].map((at) => new Date(at).toISOString()));
});

// ── (a) the deployment half: the route table reads degraded, and a recruit is refused ───────────

const DEGRADED_ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const READY_ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' });

function gitRepo(t, label) {
  const root = tmpDir(label);
  execFileSync('git', ['init', '-q'], { cwd: root });
  // The branch the resident is started from is the target the doctor measures the served commit
  // against, so the fixture names it instead of inheriting the host's init.defaultBranch.
  execFileSync('git', ['checkout', '-q', '-b', 'master'], { cwd: root });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue316@example.invalid', GIT_COMMITTER_EMAIL: 'issue316@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 316', GIT_COMMITTER_NAME: 'Issue 316' });
  writeFileSync(join(root, 'README.md'), '# issue 316\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function codexAdapter(routes) {
  const adapter = new MockAdapter({
    harness: 'codex',
    scenario: { outcome: 'completed', delayMs: 1, summary: 'fixture', files: {} },
  });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    authPosture: 'subscription',
    concurrencyCeiling: 4,
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      mode: 'exact', configuredDefault: routes[0].model,
      available: [...new Set(routes.map((route) => route.model))], family: 'codex',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [...new Set(routes.map((route) => route.effort))],
      serviceTier: null, provenance: 'issue316-fixture', refreshedAt: null,
    },
    // The readiness substrate every real route card carries: without it the static derivation
    // blocks the route for `route_policy_unsupported`, which is not what this file measures.
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: [] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: [] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], configuredPreferences: [], observation: 'unavailable' },
    },
  });
  return adapter;
}

async function openDeployment(t, label, routes) {
  const repo = gitRepo(t, `${label}-repo`);
  const root = join(tmpDir(`${label}-owner`), 'deployment');
  mkdirSync(join(root, '..'), { recursive: true });
  let driverOptions = null;
  const adapter = codexAdapter(routes);
  const deployment = await openBatonDeployment({
    repo,
    advanced: {
      deploymentRoot: root,
      adapters: { codex: adapter },
      routes,
      verification: { command: process.execPath, arguments: ['--version'] },
    },
  }, (options) => { driverOptions = options; return createDriver(options); });
  t.after(async () => { try { await deployment.close(); } catch { /* closed by the test */ } });
  return { deployment, driverOptions, adapter, repo };
}

/** The provider.degraded row the coordinator's fold lands, as the doctor reads it off the ledger. */
function degradedRow(route, { from = T0, to = T0 + 2 * MIN, participants = ['w-1', 'w-2', 'w-3'] } = {}) {
  return {
    worker: participants[0],
    harness: `${route.harness}@1.0.0`,
    turnEpoch: 1,
    kind: 'provider.degraded',
    actor: 'policy',
    harnessResolved: route.harness, modelResolved: route.model, effortResolved: route.effort,
    payload: {
      route: Object.freeze({ ...route }),
      faultClass: STALL_CODE,
      participants: Object.freeze([...participants]),
      window: Object.freeze({ from: new Date(from).toISOString(), to: new Date(to).toISOString() }),
      count: participants.length,
      next: Object.freeze({ action: 'pause_recruits_until_probe', route: Object.freeze({ ...route }) }),
    },
  };
}

const usageRowFor = (rows, route) => rows.find((row) => (
  row.route.harness === route.harness && row.route.model === route.model && row.route.effort === route.effort));

test('316-a3: a degraded route reads degraded on the doctor and refuses a recruit until a later turn on it succeeds', async (t) => {
  const { deployment, driverOptions } = await openDeployment(t, 'degrade', [DEGRADED_ROUTE, READY_ROUTE]);
  const log = new Log(driverOptions.logDir);

  // The typed fold row the coordinator lands when three seats stalled on the route.
  log.append(degradedRow(DEGRADED_ROUTE, { participants: ['w-1', 'w-2', 'w-3'] }));

  const doctor = await deployment.doctor();
  const degraded = usageRowFor(doctor.routeUsage, DEGRADED_ROUTE);
  assert.ok(degraded.degraded, 'the route its provider degraded carries the degrade on its usage row');
  assert.equal(degraded.degraded.state, 'degraded');
  assert.equal(degraded.degraded.faultClass, STALL_CODE);
  assert.deepEqual(degraded.degraded.participants, ['w-1', 'w-2', 'w-3']);
  assert.equal(degraded.degraded.next.action, 'pause_recruits_until_probe');
  assert.equal(degraded.state, 'degraded', 'and the row itself reads degraded, not ready');
  assert.ok(usageRowFor(doctor.routeUsage, READY_ROUTE).degraded,
    '#523: a sibling effort of the same scope shares the episode (codex/gpt-5.6-sol@low is the same codex subscription)');

  // A recruit on the degraded route refuses BEFORE any effect, typed, naming the route and its
  // `next` act — never a silent admission onto a route that is killing seats. The runtime reads
  // the deployment's OWN route table (the doctor rows above), so the row an operator sees is the
  // row the recruit is refused by.
  let spawns = 0;
  const adapter = Object.values(driverOptions.adapters)[0];
  const originalSpawn = adapter.spawn.bind(adapter);
  adapter.spawn = (...args) => { spawns += 1; return originalSpawn(...args); };
  const store = new CoordinationStore(join(tmpDir('degrade-swarm'), 'coordination'));
  const workers = [];
  const runtime = new SwarmRuntime({
    store, coordinator: { list: () => workers, pausedTurns: () => [] }, authorize: async () => {},
    deploymentSummary: () => deployment.doctorReadiness(),
    prepareRun: async (request) => ({ ...request, route: request.options?.exact ?? null }),
    startRun: async (request) => {
      if (!workers.some((row) => row.runId === request.runId)) {
        workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
          runId: request.runId, status: 'working', paused: false });
      }
    },
    stopRun: async (runId) => {
      const row = workers.find((candidate) => candidate.runId === runId);
      if (row) row.status = 'dead';
      return { state: 'closed' };
    },
  });
  await runtime.command('swarm.create',
    { swarmId: 'degraded', purpose: 'degraded route', idempotencyKey: 'issue316-a3-0' }, owner);

  await assert.rejects(
    runtime.command('swarm.recruit', {
      swarmId: 'degraded', participantId: 'lane-1', objective: 'work',
      idempotencyKey: 'issue316-a3-1', options: { exact: DEGRADED_ROUTE },
    }, owner),
    (error) => error?.code === 'route_degraded'
      && error.detail?.route?.effort === DEGRADED_ROUTE.effort
      && typeof error.detail?.since === 'string'
      && error.detail?.next?.action === 'pause_recruits_until_probe',
    'a recruit on a degraded route refuses typed route_degraded {route, since, next}',
  );
  assert.equal(spawns, 0, 'the refusal precedes every effect');

  // The readiness probe on that route succeeds (the deployment's own turn on it) — the episode is
  // retired by the SAME derivation, and the next recruit is admitted.
  log.append({
    worker: 'probe-w', harness: `${DEGRADED_ROUTE.harness}@1.0.0`, turnEpoch: 1,
    kind: 'lifecycle.turn_completed', actor: 'worker',
    harnessResolved: DEGRADED_ROUTE.harness, modelResolved: DEGRADED_ROUTE.model,
    effortResolved: DEGRADED_ROUTE.effort,
    payload: { status: 'completed', summary: 'the probe answered', usageSeal: null },
  });
  const healed = await deployment.doctor();
  assert.equal(usageRowFor(healed.routeUsage, DEGRADED_ROUTE).degraded, null,
    'a later successful turn on the route retires the episode');
  assert.equal(usageRowFor(healed.routeUsage, DEGRADED_ROUTE).state, 'ready');

  assert.equal(spawns, 0, 'still nothing was spawned');
  const admitted = await runtime.command('swarm.recruit', {
    swarmId: 'degraded', participantId: 'lane-1', objective: 'work',
    idempotencyKey: 'issue316-a3-2', options: { exact: DEGRADED_ROUTE },
  }, owner);
  assert.equal(admitted.admission.state, 'admitted',
    'the same recruit is admitted once a turn on the route succeeded');
});

// ── (b) an attachment that ends names why ───────────────────────────────────────────────────────

// The rows below await a frame BY IDENTITY (#446). 316-b2 used to sample this consumer's progress
// with a poll loop and a wall-clock deadline and then compare that sample with the cursor the LEG
// computed. Those are not the same moment: the leg writes the frames of one pull as a batch and the
// consumer processes them a message event later, so under load the sample could see frame N while
// the leg had already delivered N+1 — a healthy deployment failing on `2 !== 1` (observed
// 2026-09-18 in a gate run, and reproduced from this file). A frame is therefore awaited by the
// frame's OWN identity — its seq, or the typed final frame's kind — and a wait nothing ever
// satisfies fails at the TRANSPORT'S OWN bound rather than at a constant written here (#445) or at
// a poll interval's phase.

const WAKE_LEG_BOUND_MS = FRAME_LIMITS['web.wait_ceiling_ms'].value;

/** The frames an attachment delivered, in wire order, with an await BY IDENTITY. */
function frameFeed() {
  const frames = [];
  const waiters = new Set();
  const settle = (waiter, frame) => {
    waiters.delete(waiter);
    clearTimeout(waiter.timer);
    waiter.resolve(frame);
  };
  return {
    frames,
    push(frame) {
      frames.push(frame);
      for (const waiter of [...waiters]) if (waiter.predicate(frame)) settle(waiter, frame);
    },
    until(predicate, label) {
      const landed = frames.find(predicate);
      if (landed !== undefined) return Promise.resolve(landed);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: null };
        waiters.add(waiter);
        waiter.timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`the wake leg never delivered ${label}: ${JSON.stringify(frames)}`));
        }, WAKE_LEG_BOUND_MS);
      });
    },
  };
}

/** A wait that is not a frame — the socket's own end — judged by the SAME bound. */
function withinWakeLegBound(promise, label) {
  return Promise.race([promise, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`the wake leg never ${label}`)), WAKE_LEG_BOUND_MS);
    timer.unref?.();
  })]);
}

test('316-b1: an attachment whose resident ends the transport delivers the typed attachment_closed frame, never silence', async (t) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' });
    response.write('id: 4\nevent: wake\ndata: {"schemaVersion":1,"kind":"baton.wake","seq":4,"wakeClass":"recruited"}\n\n');
    // The resident goes away without naming an end marker: the transport simply closes.
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(async () => new Promise((resolve) => { try { server.closeAllConnections?.(); } catch { /* closed */ } server.close(resolve); }));

  const client = { wakes: (options) => openWakeStream({ baseUrl: `http://127.0.0.1:${port}`, token: 't', ...options }) };
  const pages = [];
  const ended = await followWakes(
    { kinds: null, swarms: null, since: 0, follow: true, stopOnClosedWake: false },
    client,
    { onFollowPage: async (page) => { pages.push(page); } },
  );

  assert.equal(ended.kind, 'baton.wake_stream_ended');
  const frame = ended.attachmentClosed;
  assert.ok(frame, 'the ended row carries the attachment\'s typed final frame');
  assert.equal(frame.kind, 'baton.wake_attachment_closed');
  assert.equal(frame.reason, 'transport_closed', 'a transport the resident simply closed names itself');
  assert.equal(frame.resumeFrom, 4, 'the frame names the seq a reconnect resumes from');
  assert.ok(Number.isFinite(Date.parse(frame.at)), 'and the instant the attachment ended');
  assert.deepEqual(wakeStreamModule.ATTACHMENT_CLOSED_REASONS, ['error', 'restart', 'transport_closed'],
    'the reason set is closed, and it is the same set the bridge names');
  // An attachment that delivered wakes prints one page per coordination row (#272) — the end
  // rides the returned row's typed frame. An attachment that delivered NOTHING delivers the frame
  // itself as its only page, so a follow that ends at once is never undiagnosable.
  assert.deepEqual(pages.map((page) => page.kind), ['baton.wake'],
    'a delivered wake keeps one page per coordination row');

  const empty = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' });
    response.end();
  });
  await new Promise((resolve) => empty.listen(0, '127.0.0.1', resolve));
  const emptyPort = empty.address().port;
  t.after(async () => new Promise((resolve) => { try { empty.closeAllConnections?.(); } catch { /* closed */ } empty.close(resolve); }));
  const emptyPages = [];
  const silent = await followWakes(
    { kinds: null, swarms: null, since: 0, follow: true, stopOnClosedWake: false },
    { wakes: (options) => openWakeStream({ baseUrl: `http://127.0.0.1:${emptyPort}`, token: 't', ...options }) },
    { onFollowPage: async (page) => { emptyPages.push(page); } },
  );
  assert.equal(silent.attachmentClosed.reason, 'transport_closed');
  assert.equal(silent.attachmentClosed.resumeFrom, null, 'nothing was seen, so nothing resumes from');
  assert.deepEqual(emptyPages.map((page) => page.kind), ['baton.wake_stream_ended'],
    'an attachment that delivered nothing says why it ended as its only page');
  assert.equal(emptyPages.at(-1).attachmentClosed.reason, 'transport_closed',
    'and that page carries the typed frame');
});

test('316-b2: the bridge names the same closed reason set — the resident\'s own end and a protocol error', async (t) => {
  const store = new CoordinationStore(join(tmpDir('bridge'), 'coordination'));
  store.recordSwarm('swarm.created', { swarmId: 's-316', purpose: 'bridge proof' }, { actor: 'test:root', key: '316:b1' });
  const stream = new WakeStream({ coordination: store, pollMs: 20 });
  t.after(() => stream.close());

  const server = createServer();
  const bridge = attachWakeWebSocket({ server, stream, authenticate: () => ({ userId: 'root' }) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(async () => {
    bridge.close();
    await new Promise((resolve) => { try { server.closeAllConnections?.(); } catch { /* closed */ } server.close(resolve); });
  });

  const feed = frameFeed();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/wakes?since=0`,
    { headers: { authorization: 'Bearer resident-token' } });
  const socketEnded = withinWakeLegBound(
    new Promise((resolve) => socket.addEventListener('close', resolve)), 'end the socket it wrote');
  socket.addEventListener('message', (event) => feed.push(JSON.parse(event.data)));
  t.after(() => { try { socket.close(); } catch { /* already closed */ } });
  await new Promise((resolve) => socket.addEventListener('open', resolve));

  // The row the leg must deliver is awaited BY IDENTITY: the seq of the row just recorded is the
  // ledger's own head, so this consumer's progress and the leg's are compared at one known point —
  // never at whatever a poll caught while the first pull's frames were still crossing the wire.
  store.recordSwarm('swarm.participant_joined', { swarmId: 's-316', participantId: 'seat' },
    { actor: 'test:root', key: '316:b2' });
  const joinedSeq = store.ledgerHeadSeq();
  await feed.until((message) => message.seq === joinedSeq && message.wakeClass === 'recruited',
    `the frame for the row recorded at seq ${joinedSeq}`);

  // The resident stops serving the stream: the attachment ends, and it says so over the wire.
  stream.close();
  const final = await feed.until((message) => message.kind === 'baton.wake_attachment_closed',
    'the typed final frame');
  // The typed final frame is the LAST frame on the leg: the binding writes it before it ends the
  // socket, so everything the leg delivered rides BEFORE it in wire order — the ordering that makes
  // `resumeFrom` checkable from this side of the wire at all. The socket's own end settles it.
  await socketEnded;
  const endedAt = feed.frames.indexOf(final);
  assert.equal(endedAt, feed.frames.length - 1,
    'the typed final frame is the last frame on the leg — no wake follows the end it announces');

  assert.equal(final.reason, 'restart', 'the resident ending its own stream names a restart');
  const delivered = feed.frames.slice(0, endedAt)
    .filter((message) => Number.isSafeInteger(message.seq)).map((message) => message.seq);
  assert.equal(final.resumeFrom, Math.max(...delivered),
    'the frame resumes from the last seq the leg delivered to this consumer, in wire order');
  assert.equal(final.resumeFrom, joinedSeq, 'and that is the row this test recorded and received');
  assert.ok(Number.isFinite(Date.parse(final.at)));
  assert.deepEqual(Object.keys(final).sort(),
    ['at', 'kind', 'reason', 'resumeFrom', 'schemaVersion'],
    'the bridge sends the SAME frame shape the CLI renders, one closed vocabulary, two transports');

  // A protocol error (an unmasked client frame, RFC 6455 §5.3) is the third reason, named the same
  // way — the stream never ends in silence whatever killed it. It rides its own live stream: the
  // one above has already ended (that is the row this test just asserted).
  const liveStore = new CoordinationStore(join(tmpDir('bridge-error'), 'coordination'));
  liveStore.recordSwarm('swarm.created', { swarmId: 's-316e', purpose: 'protocol error' },
    { actor: 'test:root', key: '316:b3' });
  const liveStream = new WakeStream({ coordination: liveStore, pollMs: 20 });
  const errorServer = createServer();
  const errorBridge = attachWakeWebSocket({ server: errorServer, stream: liveStream, authenticate: () => ({ userId: 'root' }) });
  await new Promise((resolve) => errorServer.listen(0, '127.0.0.1', resolve));
  const errorPort = errorServer.address().port;
  t.after(async () => {
    errorBridge.close();
    liveStream.close();
    await new Promise((resolve) => { try { errorServer.closeAllConnections?.(); } catch { /* closed */ } errorServer.close(resolve); });
  });

  // The rude connection is a RAW socket, so the frame the bridge writes to IT is what is asserted:
  // a server frame is unmasked, so its payload is everything after the header.
  const rudeFrames = frameFeed();
  let pending = Buffer.alloc(0);
  const rude = createConnection({ host: '127.0.0.1', port: errorPort });
  await new Promise((resolve) => rude.once('connect', resolve));
  rude.write('GET /v1/wakes HTTP/1.1\r\nhost: 127.0.0.1\r\n'
    + 'upgrade: websocket\r\nconnection: Upgrade\r\n'
    + 'sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
    + 'sec-websocket-version: 13\r\n\r\n');
  // The 101 response is consumed first, so the codec below reads WebSocket frames only.
  await new Promise((resolve) => rude.once('data', resolve));
  rude.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      if (pending.length < 2) return;
      const opcode = pending[0] & 0x0f;
      let length = pending[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (pending.length < 4) return;
        length = pending.readUInt16BE(2);
        offset = 4;
      }
      if (pending.length < offset + length) return;
      const payload = pending.subarray(offset, offset + length);
      pending = pending.subarray(offset + length);
      if (opcode === 0x1) {
        try { rudeFrames.push(JSON.parse(payload.toString('utf8'))); } catch { /* not a wake frame */ }
      }
    }
  });
  rude.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));  // unmasked text frame: a protocol error
  const protocol = await rudeFrames.until((message) => message.kind === 'baton.wake_attachment_closed'
    && message.reason === 'error', 'the protocol-error frame');
  assert.deepEqual(wakeStreamModule.ATTACHMENT_CLOSED_REASONS, ['error', 'restart', 'transport_closed'],
    'the three reasons are the ONE closed set the CLI and the bridge share');
  assert.equal(protocol.reason, 'error');
  assert.equal(protocol.resumeFrom, null, 'an attachment that never saw a frame resumes from nowhere');
  rude.destroy();
});

// ── (c) the served commit rides every wake frame header ─────────────────────────────────────────

test('316-c: the wake frame header carries the served commit and how far behind master it is, read on the deployment cadence', async (t) => {
  const { deployment, repo } = await openDeployment(t, 'served', [READY_ROUTE]);
  const servedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  // The branch the resident was started from moves on while it serves the older commit.
  writeFileSync(join(repo, 'README.md'), '# issue 316 — master moved on\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'master moves ahead'], { cwd: repo });

  assert.deepEqual(deployment.wakeServedFact(), { commit: servedCommit, behind: 1 },
    'the deployment publishes the commit it serves and the commits master has moved past it');

  let reads = 0;
  const coordination = new CoordinationStore(join(tmpDir('served-ledger'), 'coordination'));
  const stream = new WakeStream({
    coordination,
    pollMs: 20,
    observationMs: 60_000,
    served: () => { reads += 1; return deployment.wakeServedFact(); },
  });
  t.after(() => stream.close());

  coordination.recordSwarm('swarm.created', { swarmId: 's-316-c', purpose: 'served header' },
    { actor: 'test:root', key: '316:c:0' });
  for (const index of [1, 2, 3]) {
    coordination.recordSwarm('swarm.participant_joined',
      { swarmId: 's-316-c', participantId: `seat-${index}`, role: 'builder' },
      { actor: 'test:root', key: `316:c:${index}` });
  }
  const page = stream.since(parseWakeFilter({ since: 0 }));
  assert.equal(page.frames.length, 4, 'every ledger row that woke is a frame');
  for (const frame of page.frames) {
    assert.deepEqual(frame.served, { commit: servedCommit, behind: 1 },
      'the drift an operator needs rides the frame header where the deaths appear');
  }
  assert.equal(reads, 1, 'the served fact is read ONCE at publish and refreshed on the cadence — never per frame');

  // A deployment that cannot name a commit says so instead of inventing one, and a served commit
  // with no target counts null behind rather than 0.
  assert.deepEqual(deploymentModule.servedWakeFact({ commit: 'a'.repeat(40), branch: 'gone', target: { ref: null, commit: null, behind: null } }),
    { commit: 'a'.repeat(40), behind: null },
    'no readable target is null, never a fabricated zero');
  assert.equal(deploymentModule.servedWakeFact(null), null, 'a deployment that serves nothing says nothing');

  // The frame's other truth is untouched: the closed end-reason vocabulary of #356 still holds.
  assert.deepEqual([...WAKE_STREAM_END_REASONS],
    ['swarm_closed', 'stream_cursor_behind_archive', 'transport_closed', 'caller_closed', 'resident_stopping']);
});

// ── the runtime half: a degraded route refuses its recruit pre-effect ───────────────────────────

function routeRow(route, { degraded = null, state = 'ready' } = {}) {
  return Object.freeze({
    route: Object.freeze({ ...route }),
    state: degraded ? 'degraded' : state,
    code: null, resetAt: null,
    usage: Object.freeze({ turns: 0, tokens: 0, usd: 0 }),
    concurrency: Object.freeze({ ceiling: null, inUse: 0 }),
    lastProviderRefusal: null, credential: null,
    quota: Object.freeze({ state: 'ok', resetAt: null }),
    degraded,
  });
}

function swarmFixture(t, rows) {
  const directory = tmpDir('runtime');
  const store = new CoordinationStore(directory);
  const workers = [];
  const coordinator = { list: () => workers, pausedTurns: () => [] };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {},
    deploymentSummary: () => ({ workspace: null, hostCapacity: null, served: null, routeUsage: rows }),
    prepareRun: async (request) => ({ ...request, route: request.options?.exact ?? null }),
    startRun: async (request) => {
      if (!workers.some((row) => row.runId === request.runId)) {
        workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
          runId: request.runId, status: 'working', paused: false });
      }
    },
    stopRun: async (runId) => {
      const row = workers.find((candidate) => candidate.runId === runId);
      if (row) row.status = 'dead';
      return { state: 'closed' };
    },
  });
  let key = 0;
  const call = (command, args = {}) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(command === 'view' ? {} : { idempotencyKey: `316-${++key}` }), ...args }, owner);
  return { call };
}

test('316-a4: a recruit on a degraded route refuses route_degraded pre-effect and is admitted once the route reads ready', async (t) => {
  const since = new Date(T0).toISOString();
  const next = Object.freeze({
    action: 'pause_recruits_until_probe', route: Object.freeze({ ...DEGRADED_ROUTE }),
  });
  const degraded = Object.freeze({
    state: 'degraded', since, faultClass: STALL_CODE,
    participants: Object.freeze(['w-1', 'w-2', 'w-3']), window: Object.freeze({ from: since, to: since }),
    next,
  });
  const fixture = swarmFixture(t, [
    routeRow(DEGRADED_ROUTE, { degraded }),
    routeRow(READY_ROUTE),
  ]);
  await fixture.call('create', { purpose: 'degraded route' });

  await assert.rejects(
    fixture.call('recruit', { participantId: 'lane-degraded', objective: 'work', options: { exact: DEGRADED_ROUTE } }),
    (error) => error?.code === 'route_degraded'
      && error.detail?.route?.effort === DEGRADED_ROUTE.effort
      && error.detail?.since === since
      && error.detail?.next?.action === 'pause_recruits_until_probe'
      && error.message.includes('codex/gpt-5.6-sol@high'),
    'the refusal is typed, names the route, since, and the next act',
  );

  // A prefix recruit never silently lands on a degraded route: it chooses the ready one.
  const recruited = await fixture.call('recruit', {
    participantId: 'lane-ready', objective: 'work', options: { model: 'gpt-5.6-sol' },
  });
  assert.equal(recruited.routes.chosen.route.effort, READY_ROUTE.effort,
    'the runtime never chooses a degraded route while a ready one is served');
  assert.equal(recruited.routes.chosen.state, 'ready');

  // The probe succeeded: the same route, no episode, admits.
  const healed = swarmFixture(t, [routeRow(DEGRADED_ROUTE), routeRow(READY_ROUTE)]);
  await healed.call('create', { purpose: 'probe succeeded' });
  const admitted = await healed.call('recruit', {
    participantId: 'lane-healed', objective: 'work', options: { exact: DEGRADED_ROUTE },
  });
  assert.equal(admitted.admission.state, 'admitted', 'a route whose probe succeeded admits again');
});
