// Issue #478 — a handoff that fails after the fleet drain leaves the old incarnation SERVING.
//
// THE FACT this file is written against (live, clone at fed18071, 16:13:40Z): `baton deployment
// reincarnate 82ab2466` with three seats on the roster ran the handoff's step-1 fleet drain, the
// drain did not converge (90 s), and the window recorded
// `host.reincarnation_failed {step: 'publication_handoff', cause: {reason: 'fleet_drain_incomplete'}}`
// — after which the old incarnation was ALIVE and `baton doctor --check` answered `state: ready`,
// while every swarm command over the SAME served transport answered
// `{state: 'stopping', …waits: [], attempts: 0, abandoned: []}`: the stop the handoff's own window
// began was never undone, and the process the failure row calls "keeps serving" refused all work.
// Three more facts ride the same rows: the row said `authority.writerLease: 'unavailable'` and the
// narration "the writer authority stayed with the successor" although the failure came from step 1,
// BEFORE the release at step 3 — the lease never left this incarnation, so `claimWriterLease()`
// answered null because the holder is itself; a SIGTERM to that incarnation was admitted and never
// converged to `host.stopped` (SIGKILL by hand); and the drain that killed a live worker mid-turn
// (its worktree snapshotted and removed one second in) was the window's FIRST act, so a handoff
// that then failed 90 s later had already destroyed what it could not give back.
//
// The rows below pin the served truth, not the mechanism:
//   478-a — after the window fails at the drain, a swarm command over the served transport is
//           ADMITTED (today: the stopping card), and the served card carries no stopping section;
//   478-b — the failure row's `authority.writerLease` says what the window DID: `held` when the
//           failure landed before the release, `reclaimed` when the release had happened and the
//           authority was taken back;
//   478-c — a close() after the re-publish is an ordinary stop: it resolves closed within the stop
//           bound and `host.stopped` lands after the failure row;
//   478-d — the failure row names what the drain already destroyed (`drained: [{workerId,
//           participantId, snapshot}]`), so a root can resume each seat it ended.
//
// The fixture is the issue306r one (a real temporary repository, an INJECTED successor stub, the
// handoff window bound shrunk to the test's scale) with two fixture seats: one live worker
// mid-turn (the drain kills it) and one whose process the kill cannot settle (it holds the drain
// past its own deadline). Every await is bounded and named (docs/42 §8).
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { discoverBatonConnection } from '../src/application-cli.mjs';
import { HOST_CAPACITY_BYPASS } from '../src/host-capacity.mjs';

const ROUTE = Object.freeze({ harness: 'mock', model: 'model-a', effort: 'low' });
// The three bounds this fixture works between, all shrunk to the test's own scale.
//
// The fleet drain a handoff runs is bounded by the DEPLOYMENT's drain window (`DRAIN_MS`), and the
// stop path bounds one worker's kill by `STOP_DEADLINE_MS`. The fixture's worker whose process the
// kill can never settle spends its bounded attempts at that deadline, so the handoff's drain — which
// gets `DRAIN_MS` and no more — runs out of window before the worker is abandoned (the incident's
// own non-convergence), while the operator's later stop still reaches the abandonment and converges
// the way any stop does (the #467/#472 machinery: a worker the stop stopped waiting on is named
// abandoned and the stop proceeds). `DRIVER_CLOSE_MS` is the room the deployment's declared policy
// keeps for the whole driver close — it is deliberately NOT the shrunk drain window, or a close that
// is merely slow under a loaded suite would read as a drain that did not converge.
const WAIT_MS = 900;
const DRAIN_MS = 1_200;
const STOP_DEADLINE_MS = 700;
const DRIVER_CLOSE_MS = 5_000;
// The bound the operator's stop must converge within (docs/42 §8: a declared, named bound).
const STOP_BOUND_MS = 30_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** docs/42 §8: every fixture await carries a bound and names the wait it abandoned. */
function bounded(promise, ms, label) {
  return Promise.race([
    promise,
    sleep(ms).then(() => {
      throw Object.assign(new Error(`fixture_wait_unsettled: ${label} never settled within ${ms}ms`),
        { code: 'fixture_wait_unsettled' });
    }),
  ]);
}

async function until(probe, { timeoutMs = 20_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`fixture_wait_unsettled: ${label} within ${timeoutMs}ms`);
    await sleep(10);
  }
}

const roots = [];
/** The issue306r world (its socket root stays short — sun_path is 103 bytes, docs/42 §7). */
function world(label) {
  const root = mkdtempSync(`/tmp/bt478-${label}-`);
  roots.push(root);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [repo, home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git(['init', '-q']);
  git(['config', 'user.email', 'issue478@example.invalid']);
  git(['config', 'user.name', 'Issue478']);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(repo, 'test'), { recursive: true });
  writeFileSync(join(repo, 'test', 'smoke.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('smoke', () => assert.equal(1, 1));\n");
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  const base = git(['rev-parse', 'HEAD']);
  writeFileSync(join(repo, 'landing.txt'), 'second commit\n');
  git(['add', '.']);
  git(['commit', '-qm', 'landing']);
  const landing = git(['rev-parse', 'HEAD']);
  return {
    root, repo, home, configRoot, deploymentRoot, base, landing, git,
    selectorPath: join(repo, '.git', 'baton', 'connection.json'),
    ledgerPath: join(deploymentRoot, 'state', 'coordination', 'events.jsonl'),
    writerLeasePath: join(deploymentRoot, 'state', 'coordination', 'writer.lease'),
    env: Object.freeze({ HOME: home, XDG_CONFIG_HOME: configRoot, PATH: process.env.PATH ?? '' }),
  };
}
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

/** The adapter card the resident's own self-check requires, over a mock turn that OUTLIVES the
 * handoff — the live worker mid-turn the drain ends. */
function adapter(delayMs) {
  const value = new MockAdapter({
    harness: 'mock', scenario: { outcome: 'completed', delayMs, summary: 'issue478 fixture' },
  });
  const rawCard = value.card.bind(value);
  value.card = () => ({ ...rawCard(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: { schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] } },
    modelSelection: { mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: ROUTE.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'issue478-fixture', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}

function ledgerRows(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line));
}
const hostRows = (file) => ledgerRows(file).filter((row) => row.kind === 'driver.recorded'
  && typeof row.payload?.kind === 'string' && row.payload.kind.startsWith('host.'));
const hostRow = (file, kind) => hostRows(file).find((row) => row.payload.kind === kind) ?? null;
const custodyRows = (file, kind) => ledgerRows(file).filter((row) => row.kind === 'driver.recorded'
  && row.payload?.kind === kind);
const selectorOf = (f) => JSON.parse(readFileSync(f.selectorPath, 'utf8'));

/** The successor the injected spawner hands back: a child-shaped stub the test drives. It writes
 * the handoff marker (its readiness), and can open, die, stall, or be killed — never publishing
 * unless a row asks it to. */
class StubSuccessor extends EventEmitter {
  static nextPid = 53_000;
  constructor(spec) {
    super();
    this.spec = spec;
    this.pid = StubSuccessor.nextPid++;
    this.stderr = new EventEmitter();
    this.exitCode = null;
    this.signalCode = null;
    this.journal = { spawnedAt: Date.now(), killed: false };
  }
  writeMarker(state) {
    writeFileSync(this.spec.markerPath, `${JSON.stringify({
      schemaVersion: 1, incarnation: this.spec.env.BATON_INCARNATION, pid: this.pid,
      predecessor: { incarnation: this.spec.env.BATON_PREDECESSOR_INCARNATION, commit: this.spec.env.BATON_PREDECESSOR_COMMIT },
      target: { sha: this.spec.env.BATON_REINCARNATION_TARGET, ref: null },
      state, at: new Date().toISOString(),
    })}\n`);
  }
  becomeReady() { this.writeMarker('waiting'); this.journal.readyAt = Date.now(); }
  opened() { this.writeMarker('opened'); this.journal.openedAt = Date.now(); }
  crash({ code = 9, tail = 'the successor died between its open and its publication\n' } = {}) {
    this.stderr.emit('data', Buffer.from(tail));
    this.exitCode = code;
    this.emit('exit', code, null);
  }
  kill() {
    this.journal.killed = true;
    this.signalCode = 'SIGKILL';
    this.emit('exit', null, 'SIGKILL');
    return true;
  }
}

/** One open deployment over the fixture world: the successor spawner injected, the handoff window
 * bound and the drain window shrunk to the test's own scale, and the stop deadline left LONG so
 * the fixture's unkillable worker holds the drain past that window (the incident's shape). */
async function fixture(t, f, { onSpawn, delayMs = 120_000 } = {}) {
  const spawned = [];
  const [bypassName, bypassValue] = HOST_CAPACITY_BYPASS.split('=');
  const priorBypass = process.env[bypassName];
  process.env[bypassName] = bypassValue;
  let driver = null;
  let deployment;
  try {
    deployment = await openBatonDeployment({
      repo: f.repo,
      advanced: {
        deploymentRoot: f.deploymentRoot,
        adapters: { mock: adapter(delayMs) },
        routes: [ROUTE],
        verification: { command: 'node', arguments: ['--test'] },
        resident: {
          env: f.env, home: f.home,
          webDrainMs: 400,
          sessionTtlMs: 60_000,
          commandTimeoutMs: 30_000,
          reincarnationWaitMs: WAIT_MS,
          spawnSuccessor: (spec) => {
            const stub = new StubSuccessor(spec);
            spawned.push(stub);
            stub.becomeReady();
            return onSpawn ? onSpawn(stub, spec) : stub;
          },
        },
      },
    }, (options) => {
      driver = createDriver({
        ...options, stopDeadlineMs: STOP_DEADLINE_MS,
        // The deployment's DECLARED drain policy, in the shape a real one has: it is what bounds the
        // whole driver close, so it keeps the room a loaded suite needs (see the note above).
        drainPolicy: { maxWorkers: 8, timeoutMs: DRIVER_CLOSE_MS, pollMs: 10 },
      });
      // …and the window the FLEET DRAIN itself is bounded by, shrunk to the test's scale: the
      // coordinator's own policy is the one a handoff's drain and a stop's drain both run under, and
      // this is the knob that makes the first fail while the second still converges.
      driver.coordinator._drainPolicy = Object.freeze({ maxWorkers: 8, timeoutMs: DRAIN_MS, pollMs: 10 });
      return driver;
    });
  } finally {
    if (priorBypass === undefined) delete process.env[bypassName];
    else process.env[bypassName] = priorBypass;
  }
  t.after(async () => { try { await deployment.close(); } catch { /* the row already closed it */ } });
  await bounded(deployment.host(), 30_000, 'the resident host');
  return { deployment, driver, spawned };
}

const selection = Object.freeze({ exact: ROUTE, scope: ['impl/**'] });

/** One fixture seat, admitted and WORKING — a live worker mid-turn for the handle the drain kills. */
async function recruitSeat(deployment, driver, swarmId, participantId) {
  await deployment.swarms.create('Hold a seat through the failed handoff', {
    swarmId, idempotencyKey: `create:${swarmId}`,
  });
  const swarm = deployment.swarms.open(swarmId);
  const seat = await swarm.recruit(participantId, 'Hold a turn through the failed handoff', {
    options: selection, idempotencyKey: `recruit:${swarmId}:${participantId}`,
  });
  const worker = await until(
    () => driver.coordinator.list().find((row) => row.runId === seat.runId && row.status === 'working') ?? null,
    { label: `the worker of seat ${participantId}` },
  );
  return { seat, worker, handle: driver.coordinator._workers.get(worker.id) };
}

/** One authenticated command over the resident's own Unix socket — the transport `baton swarm …`
 * speaks, taken at the wire level so the row under test is the SERVED answer. Each call carries its
 * OWN command id and idempotency key: a read's observation is scoped by that key, and a replayed
 * answer would report the resident as it was BEFORE the handoff. */
function commandOverSocket(connection, repoId, command, args) {
  const call = Math.random().toString(16).slice(2);
  const envelope = JSON.stringify({
    schemaVersion: 1, commandId: `test-${command}-${call}`,
    idempotencyKey: `test:${command}:${call}`, command: command.replaceAll('.', '_'), args,
    repoId, origin: connection.origin,
  });
  const request = [
    'POST /v1/commands HTTP/1.1',
    'host: localhost',
    `origin: ${connection.origin}`,
    `authorization: Bearer ${connection.token}`,
    'content-type: application/json',
    `content-length: ${Buffer.byteLength(envelope)}`,
    'sec-fetch-site: none',
    'connection: close',
    '', envelope,
  ].join('\r\n');
  return new Promise((resolve, reject) => {
    const client = connect(connection.socketPath);
    let data = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      const [head, ...rest] = data.split('\r\n\r\n');
      const status = Number.parseInt((head.split('\r\n')[0] ?? '').split(' ')[1] ?? '', 10);
      const raw = rest.join('\r\n\r\n');
      let body = null;
      try { body = JSON.parse(raw); } catch { body = null; }
      resolve({ status, body });
    };
    client.on('connect', () => client.write(request));
    client.on('data', (chunk) => { data += chunk; });
    client.on('end', finish);
    client.on('close', finish);
    client.on('error', reject);
  });
}

/** The read a client makes of a resident's own served card (`GET /v1/application-card`). */
function cardOverSocket(connection) {
  const request = [
    'GET /v1/application-card HTTP/1.1',
    'host: localhost',
    `origin: ${connection.origin}`,
    `authorization: Bearer ${connection.token}`,
    'sec-fetch-site: none',
    'connection: close',
    '', '',
  ].join('\r\n');
  return new Promise((resolve, reject) => {
    const client = connect(connection.socketPath);
    let data = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      const [head, ...rest] = data.split('\r\n\r\n');
      const status = Number.parseInt((head.split('\r\n')[0] ?? '').split(' ')[1] ?? '', 10);
      let body = null;
      try { body = JSON.parse(rest.join('\r\n\r\n')); } catch { body = null; }
      resolve({ status, body });
    };
    client.on('connect', () => client.write(request));
    client.on('data', (chunk) => { data += chunk; });
    client.on('end', finish);
    client.on('close', finish);
    client.on('error', reject);
  });
}

/** Drive the window to its durable failure row and hand back the row (never a close() of the
 * test's own — #470: that is a stop, and it supersedes the re-publish). */
async function failedWindow(deployment, f) {
  const failed = await until(() => hostRow(f.ledgerPath, 'host.reincarnation_failed'),
    { label: 'the window\'s failure row' });
  await until(() => deployment.turnAdmissionRefusal() === null, { label: 'admission reopening after the re-publish' });
  return failed;
}

/** The two-seat roster the incident ran with: a LIVE worker mid-turn (the drain kills it and
 * snapshots its checkout) and one whose process the kill cannot settle (it holds the drain past
 * its own deadline, so the window fails at step 1 — the incident's own non-convergence). */
async function twoSeats(deployment, driver, swarmId) {
  const live = await recruitSeat(deployment, driver, swarmId, 'seat-live');
  const stuck = await recruitSeat(deployment, driver, swarmId, 'seat-stuck');
  // A recovered authority with no observable pid: nothing for the kill to signal and no close for
  // it to confirm, so the drain spends its deadline on this worker and never converges.
  stuck.handle.processRef = {
    generation: 0, pid: null, processGroupId: null,
    state: 'unconfirmed_after_restart', ready: false, startedSeq: null, closedSeq: null,
  };
  return { live, stuck };
}

/** The stop card a SERVING incarnation must never answer with — wherever the transport nests it. */
function stoppingCard(body) {
  if (body === null || typeof body !== 'object') return null;
  for (const candidate of [body, body.result]) {
    if (candidate !== null && typeof candidate === 'object' && candidate.state === 'stopping') return candidate;
  }
  return null;
}

// ── (a) the served truth after the re-publish ───────────────────────────────────────────────────
test('478a: a swarm command over the served transport is admitted after the window fails at the drain', async (t) => {
  const f = world('a');
  const { deployment, driver, spawned } = await fixture(t, f);
  const { live } = await twoSeats(deployment, driver, 'issue478a');
  const connection = discoverBatonConnection({ cwd: f.repo, env: f.env });
  assert.equal(connection.transport, 'local', 'the resident serves the local transport');

  // The resident serves the command BEFORE the handoff — the row's baseline, not a claim.
  const serving = await bounded(commandOverSocket(connection, connection.repoId, 'swarm.view', { swarmId: 'issue478a' }),
    20_000, 'swarm.view while serving');
  assert.equal(stoppingCard(serving.body), null,
    `a serving resident answers the view, never a stop card: ${JSON.stringify(serving.body)}`);

  await bounded(deployment.reincarnate({ target: f.base }), 20_000, 'the reincarnate request');
  await until(() => spawned.length === 1, { label: 'the successor spawn' });
  const failed = await failedWindow(deployment, f);
  assert.equal(failed.payload.cause?.reason, 'fleet_drain_incomplete',
    `the failure is the drain's own non-convergence: ${JSON.stringify(failed.payload.cause)}`);

  // (1) The swarm command is ADMITTED over the SAME served transport. The stop the window's own
  //     drain began is not in flight any more — this incarnation is serving, which is what the
  //     failure row says it does.
  const after = await bounded(commandOverSocket(connection, connection.repoId, 'swarm.view', { swarmId: 'issue478a' }),
    20_000, 'swarm.view after the re-publish');
  assert.equal(after.status, 200, `the served transport answers: ${JSON.stringify(after.body)}`);
  assert.equal(stoppingCard(after.body), null,
    `the re-published incarnation admits the swarm family: ${JSON.stringify(after.body)}`);
  assert.notEqual(after.body?.error?.code, 'temporarily_unavailable',
    `work admission is open again: ${JSON.stringify(after.body)}`);

  // (2) …and doctor's own read agrees with it: the card carries no stopping section, so the two
  //     surfaces cannot tell two stories about one process.
  const card = await bounded(cardOverSocket(connection), 20_000, 'the served card');
  assert.equal(card.status, 200);
  assert.equal(card.body?.application?.stopping ?? null, null,
    `the served card names no stop in flight: ${JSON.stringify(card.body?.application?.stopping ?? null)}`);

  // (3) The live worker's turn was ended by the drain — that is the destruction the row must name.
  assert.equal(driver.coordinator.list().find((row) => row.id === live.worker.id)?.status !== 'working', true,
    'the fixture proves the drain ended the live worker');
});

// ── (b) the failure row's authority column ──────────────────────────────────────────────────────
test('478b: the failure row says what the window did with the writer authority', async (t) => {
  const f = world('b');
  const { deployment, driver, spawned } = await fixture(t, f);
  await twoSeats(deployment, driver, 'issue478b');
  await bounded(deployment.reincarnate({ target: f.base }), 20_000, 'the reincarnate request');
  await until(() => spawned.length === 1, { label: 'the successor spawn' });
  const failed = await failedWindow(deployment, f);
  assert.equal(failed.payload.cause?.reason, 'fleet_drain_incomplete', 'the failure is the drain\'s');
  // The release at step 3 never ran, and it is the act that mints `host.stopped` (the outcome the
  // stop path arms before the drain): no outcome row can precede this failure. The lease never left
  // this incarnation, and the row must SAY so — `claimWriterLease()` answering null here is the
  // holder being this same instance, never a lost lease (#478 defect 2).
  assert.equal(hostRow(f.ledgerPath, 'host.stopped'), null,
    'no release ran, so no stop outcome precedes the failure row');
  assert.equal(failed.payload.authority?.writerLease, 'held',
    `a failure before the release leaves the writer authority held: ${JSON.stringify(failed.payload.authority)}`);
  assert.ok(existsSync(f.writerLeasePath), 'the lease file is still this incarnation\'s');
});

test('478b2: a failure past the release reports the authority it RE-TOOK', async (t) => {
  const f = world('b2');
  const { deployment } = await fixture(t, f, {
    // The successor reaches its OPEN and then dies: the window's step 3 released the writer lease,
    // so the re-publish must report the authority it took BACK, not one it never gave up.
    onSpawn: (stub) => { stub.journal.opened = true; stub.opened(); return stub; },
  });
  await bounded(deployment.reincarnate({ target: f.base }), 20_000, 'the reincarnate request');
  await until(() => !existsSync(f.writerLeasePath), { label: 'the window\'s release of the writer lease' });
  const failed = await failedWindow(deployment, f);
  assert.equal(failed.payload.authority?.writerLease, 'reclaimed',
    `a failure past the release reports the re-take: ${JSON.stringify(failed.payload.authority)}`);
  assert.ok(existsSync(f.writerLeasePath), 'the lease is this incarnation\'s again');
});

// ── (c) the operator's stop after the re-publish ────────────────────────────────────────────────
test('478c: a close() after the re-publish converges to host.stopped within the stop bound', async (t) => {
  const f = world('c');
  const { deployment, driver } = await fixture(t, f);
  await twoSeats(deployment, driver, 'issue478c');
  await bounded(deployment.reincarnate({ target: f.base }), 20_000, 'the reincarnate request');
  const failed = await failedWindow(deployment, f);
  assert.equal(failed.payload.cause?.reason, 'fleet_drain_incomplete', 'the failure is the drain\'s');

  const startedAt = Date.now();
  const closed = await bounded(deployment.close(), STOP_BOUND_MS, 'the operator\'s stop after the re-publish');
  const elapsedMs = Date.now() - startedAt;
  assert.ok(closed?.state === 'closed' || closed?.state === 'closed_degraded',
    `close() means close: ${JSON.stringify(closed)}`);
  assert.notEqual(closed?.state, 'serving', 'the stop is never answered with the re-publish verdict');
  const stopped = hostRows(f.ledgerPath).filter((row) => row.payload.kind === 'host.stopped');
  assert.ok(stopped.length >= 1,
    `the stop mints its outcome: ${JSON.stringify(hostRows(f.ledgerPath).map((row) => row.payload.kind))}`);
  assert.ok(stopped.at(-1).seq > failed.seq, 'the stop\'s outcome follows the handoff\'s failure row');
  assert.equal(deployment.withdrawn(), true, 'the incarnation is withdrawn');
  assert.ok(elapsedMs <= STOP_BOUND_MS, `the stop converged within its bound: ${elapsedMs}ms`);
});

// ── (d) what the drain already destroyed ────────────────────────────────────────────────────────
test('478d: the failure row names the seats the drain destroyed, with their snapshots', async (t) => {
  const f = world('d');
  const { deployment, driver } = await fixture(t, f);
  const { live } = await twoSeats(deployment, driver, 'issue478d');
  await bounded(deployment.reincarnate({ target: f.base }), 20_000, 'the reincarnate request');
  const failed = await failedWindow(deployment, f);
  assert.equal(failed.payload.cause?.reason, 'fleet_drain_incomplete', 'the failure is the drain\'s');

  const drained = failed.payload.drained;
  assert.ok(Array.isArray(drained), `the row names what the drain destroyed: ${JSON.stringify(failed.payload)}`);
  const named = drained.find((row) => row.workerId === live.worker.id) ?? null;
  assert.ok(named, `the live worker the drain killed is named: ${JSON.stringify(drained)}`);
  assert.equal(named.participantId, 'seat-live',
    `the seat is named, so a root knows whom to resume: ${JSON.stringify(named)}`);
  // The checkout the drain removed was snapshotted first (the #428 custody rows) — that snapshot is
  // the fact a resume stands on, and the row carries it rather than leaving the root to hunt.
  const snapshotted = custodyRows(f.ledgerPath, 'worktree.snapshotted')
    .filter((row) => row.payload?.workerId === live.worker.id && typeof row.payload?.sha === 'string');
  const removed = custodyRows(f.ledgerPath, 'worktree.removed')
    .filter((row) => row.payload?.reason === 'drain' && row.payload?.workerId === live.worker.id);
  assert.ok(removed.length >= 1, `the drain removed the live worker's checkout: ${JSON.stringify(custodyRows(f.ledgerPath, 'worktree.removed').map((row) => row.payload))}`);
  if (snapshotted.length > 0) {
    assert.equal(named.snapshot, removed.at(-1).payload.snapshot ?? snapshotted.at(-1).payload.sha,
      `the row names the snapshot the removal was backed by: ${JSON.stringify(named)}`);
  }
});

// ── (e) the swarm family's own admission, reopened ──────────────────────────────────────────────
test('478e: a swarm RECRUIT over the served transport is admitted after the re-publish', async (t) => {
  const f = world('e');
  const { deployment, driver } = await fixture(t, f);
  await twoSeats(deployment, driver, 'issue478e');
  const connection = discoverBatonConnection({ cwd: f.repo, env: f.env });
  await bounded(deployment.reincarnate({ target: f.base }), 20_000, 'the reincarnate request');
  const failed = await failedWindow(deployment, f);
  assert.equal(failed.payload.cause?.reason, 'fleet_drain_incomplete',
    `the failure is the drain's own non-convergence: ${JSON.stringify(failed.payload.cause)}`);

  // A RECRUIT is the swarm family's new WORK: it reaches the coordinator's own admission, which the
  // failed handoff's drain left closed (the drain that ends a fleet's life is what closes it), so a
  // resident that "keeps serving" but cannot start a seat is the same two-stories process the served
  // read above names. The command is admitted, or it refuses something OTHER than the drained gate.
  const workersBefore = new Set(driver.coordinator.list().map((row) => row.id));
  const recruit = await bounded(commandOverSocket(connection, connection.repoId, 'swarm.recruit', {
    swarmId: 'issue478e', participantId: 'seat-after', objective: 'Join after the failed handoff',
    options: { exact: ROUTE, scope: ['impl/**'] },
    idempotencyKey: `recruit-after-${Math.random().toString(16).slice(2)}`,
  }), 30_000, 'swarm.recruit after the re-publish');
  assert.equal(recruit.status, 200, `the served transport answers: ${JSON.stringify(recruit.body)}`);
  assert.notEqual(recruit.body?.error?.code, 'coordinator_draining',
    `the fleet authority admits new work again: ${JSON.stringify(recruit.body)}`);
  assert.notEqual(recruit.body?.error?.code, 'temporarily_unavailable',
    `work admission is open again: ${JSON.stringify(recruit.body)}`);
  // …and the seat really starts: a worker the fleet did not hold before the command is running.
  const joined = await until(
    () => driver.coordinator.list().find((row) => !workersBefore.has(row.id)) ?? null,
    { label: 'the recruited seat\'s worker' },
  );
  assert.ok(joined.id, `the fleet took new work after the re-publish: ${JSON.stringify(joined.id)}`);
});
