// Issue #522: `baton swarm check` runs a genuine verification — minutes of suite work under the
// same host-capacity `verify` lease the suite runner takes — while the CLI bounded that command
// with the caller's flat `commandTimeoutMs`. A check that was still running was therefore cut off
// at the transport with a `cli_command_pending` receipt while the resident was still working on it
// (the R-5 symptom documented under #288).
//
// The repair pinned here: a check's transport wait is re-armed on the check's own progress — the
// verify lease it holds for its whole verdict, read from the deployment rows the swarm view
// publishes (`deployment.hostCapacity`). The caller keeps waiting while the resident still holds
// that check, and the pending receipt answers a caller that can no longer observe the check.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonWebClient } from '../src/application-cli.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { HostCapacityAuthority } from '../src/host-capacity.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

// The #522 seam is read through the module namespace, never as a static binding: a red-first file
// asserts behaviour that does not exist yet, so a missing export must be a red assertion and never
// a load-time crash (the blind-waits convention this suite's red-first files follow).
const cli = await import('../src/application-cli.mjs');
const verifyLeaseHeld = (...args) => cli.swarmCheckVerifyLeaseHeld(...args);

const ORIGIN = 'https://control.example.test';
const REPO_ID = 'repo-issue522';
const SWARM = 'swarm-522';
const CONTRIBUTION = 'contribution-522';
const CHECK = 'check-522';
const CHECK_SHA = 'c'.repeat(40);
// The verification this fake resident runs takes 150 ms of real work; the caller's own flat bound
// is 60 ms, so the flat clock would cut the check off mid-verification on every attempt.
const CHECK_MS = 150;
const FLAT_BOUND_MS = 60;
const CHECKED = Object.freeze({
  sha: CHECK_SHA, passed: true, attempt: { cleanup: { state: 'closed' } },
  admission: { state: 'admitted', authority: 'host' },
});

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function okBody(body) {
  return {
    ok: true, status: 200, headers: { get: () => null },
    async text() { return JSON.stringify(body); },
  };
}

/** The resident's own host-capacity observation as the swarm view's deployment rows carry it: the
 * `{capacity, used, queue}` shape `observeNow()` answers, with `used.leases.verify` and the verify
 * queue the host capacity authority projects. */
function deploymentRows({ verifyHeld, queue }) {
  return {
    used: { cores: 2, bytes: 0, leases: { verify: verifyHeld, worker: 0 } },
    queue, roomForVerify: verifyHeld === 0, roomForWorker: true,
  };
}

/**
 * A resident that runs ONE check: the check takes CHECK_MS of work from its first attempt, a
 * request that outlives its own transport bound is abandoned while the resident keeps working, and
 * the swarm view answers what the deployment's capacity observation says about the verify lease.
 */
function resident({ verifyHeld = 1, queue = [], publishesCapacity = true, viewReadable = true } = {}) {
  const state = { checkAttempts: 0, progressProbes: 0, startedAt: null };
  const view = () => ({
    swarmId: SWARM, status: 'open', cursor: 41,
    deployment: publishesCapacity ? { hostCapacity: deploymentRows({ verifyHeld, queue }) } : null,
  });
  const fetchImpl = async (url, options) => {
    const target = String(url);
    if (target.endsWith('/healthz')) return okBody({ ok: true });
    const envelope = JSON.parse(options.body);
    if (envelope.command === 'swarm_check') {
      state.checkAttempts += 1;
      if (state.startedAt === null) state.startedAt = Date.now();
      // The resident runs the verification regardless of what the transport does: an abandoned
      // request does not cancel the check, so the NEXT attempt finds it further along.
      const remaining = CHECK_MS - (Date.now() - state.startedAt);
      if (remaining > 0) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, remaining);
          options.signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
      if (Date.now() - state.startedAt >= CHECK_MS) return okBody({ ok: true, result: CHECKED });
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    }
    if (envelope.command === 'swarm_view') {
      state.progressProbes += 1;
      if (!viewReadable) throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
      return okBody({ ok: true, result: view() });
    }
    throw new Error(`this fixture resident serves no ${envelope.command}`);
  };
  return {
    state,
    fetchImpl,
    client: () => new BatonWebClient({
      baseUrl: 'https://resident.baton.test', origin: ORIGIN, repoId: REPO_ID, token: 'private-bearer',
      commandTimeoutMs: FLAT_BOUND_MS, pollMs: 10, clock: Date.now,
      sleep: async () => { await sleep(1); },
      fetchImpl,
    }),
  };
}

const checkArgs = { swarmId: SWARM, participantId: 'reviewer-522', contributionId: CONTRIBUTION, checkId: CHECK };

test('522a: a check that outlives the flat bound answers its verdict while it still holds its verify lease', async () => {
  const resident522 = resident({ verifyHeld: 1 });
  const result = await resident522.client().command('swarm.check', checkArgs, 'operation-key-522');
  assert.equal(result.sha, CHECK_SHA, 'the settled check verdict is the answer');
  assert.equal(result.passed, true);
  assert.ok(resident522.state.checkAttempts >= 2,
    'the wait re-issued the SAME check (identity-keyed: the resident answers the check it is already running)');
  assert.ok(resident522.state.progressProbes >= 1, 'the re-arm was decided on the verify lease it read');
});

test('522b: a check whose verify lease is gone stops holding the caller — the pending receipt is the answer', async () => {
  const resident522 = resident({ verifyHeld: 0 });
  const error = await resident522.client().command('swarm.check', checkArgs, 'operation-key-522')
    .then(() => null, (refusal) => refusal);
  assert.equal(error?.code, 'cli_command_pending',
    'no verify lease is held and this check is not queued for one: nothing says the check is still running');
  assert.equal(error.detail.command, 'swarm.check');
  assert.equal(typeof error.detail.commandId, 'string');
});

test('522c: a deployment that publishes no host-capacity row cannot report progress, so the caller waits for the verdict', async () => {
  const resident522 = resident({ publishesCapacity: false });
  const result = await resident522.client().command('swarm.check', checkArgs, 'operation-key-522');
  assert.equal(result.sha, CHECK_SHA,
    'host admission disabled declares no lease state to read: the resident\'s own verdict is the only end');
  assert.ok(resident522.state.checkAttempts >= 2);
});

test('522d: an unreadable progress probe yields the pending receipt', async () => {
  const resident522 = resident({ viewReadable: false });
  const error = await resident522.client().command('swarm.check', checkArgs, 'operation-key-522')
    .then(() => null, (refusal) => refusal);
  assert.equal(error?.code, 'cli_command_pending', 'an unreadable progress read keeps the caller\'s receipt');
});

test('522e: a check re-arms and every other command keeps the caller\'s own bound', async () => {
  const resident522 = resident({ verifyHeld: 1 });
  const error = await resident522.client().command('swarm.stop', {
    swarmId: SWARM, participantId: 'seat-522', reason: 'done',
  }, 'operation-key-stop').then(() => null, (refusal) => refusal);
  assert.notEqual(error?.code, 'cli_command_pending', 'the fixture serves no swarm.stop; nothing re-armed it');
  assert.equal(resident522.state.checkAttempts, 0);
});

test('522f: the verify lease predicate reads the check\'s own lease, and no published lease state is progress', () => {
  const holder = `check:${CONTRIBUTION}:${CHECK}`;
  const rows = (verifyHeld, queue) => deploymentRows({ verifyHeld, queue });
  const view = (hostCapacity) => ({ swarmId: SWARM, deployment: { hostCapacity } });

  assert.equal(verifyLeaseHeld(
    view(rows(0, [{ position: 1, ahead: 0, kind: 'verify', holder, enqueuedAt: 'x' }])),
    CONTRIBUTION, CHECK), true, 'this check is queued for the verify lease: the resident is still working');
  assert.equal(verifyLeaseHeld(view(rows(1, [])), CONTRIBUTION, CHECK), true,
    'a verify lease is held');
  assert.equal(verifyLeaseHeld(view(rows(0, [])), CONTRIBUTION, CHECK), false,
    'no lease held and this check is not queued: the check is no longer the resident\'s work');
  assert.equal(verifyLeaseHeld(
    view(rows(0, [{ position: 1, ahead: 0, kind: 'verify', holder: 'check:other:check-other', enqueuedAt: 'x' }])),
    CONTRIBUTION, CHECK), false, 'another check\'s queue entry is not this check\'s progress');
  assert.equal(verifyLeaseHeld(
    view(rows(0, [{ position: 1, ahead: 0, kind: 'worker', holder, enqueuedAt: 'x' }])),
    CONTRIBUTION, CHECK), false, 'a worker lease is not the verify lease a check runs under');
  assert.equal(verifyLeaseHeld({ swarmId: SWARM, deployment: null }, CONTRIBUTION, CHECK), true,
    'a deployment that publishes no capacity observation declares no lease state to read');
  assert.equal(verifyLeaseHeld({ swarmId: SWARM, deployment: {} }, CONTRIBUTION, CHECK), true,
    'a deployment row without the host-capacity section is the same absence');
});

// The rows above are the shape this fix reads. This row binds that shape to its SOURCE: a real
// `HostCapacityAuthority` (the authority the suite runner and `swarm.check` both admit through),
// observed through a real `SwarmRuntime` view, is what a check's transport wait decides on — so a
// renamed field or a moved section fails here instead of silently stopping the re-arm.
test('522g: the host capacity authority\'s own observation reaches the predicate through the view', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-issue522-lease-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const authority = new HostCapacityAuthority({
    root, residentId: 'deployment-522', pollMs: 15, waitMs: 5_000,
    observation: () => ({ cores: 4, totalBytes: 32 * 1024 ** 3, freeBytes: 24 * 1024 ** 3, load1m: 1 }),
  });
  const store = new CoordinationStore(root);
  const runtime = new SwarmRuntime({
    store, authorize: async () => {}, hostCapacity: authority,
    // The deployment's own summary function: the host-capacity observation rides the view's
    // `deployment` slice (application-deployment.mjs's deploymentSummary).
    deploymentSummary: () => ({ workspace: null, hostCapacity: authority.observeNow(), served: null }),
    coordinator: {
      list: () => [], pausedTurns: () => [],
      checkContribution: async () => ({ passed: true, sha: CHECK_SHA, attempt: { cleanup: { state: 'closed' } } }),
    },
    prepareRun: async (request) => request,
    startRun: async () => {}, stopRun: async () => ({ state: 'closed' }),
  });
  const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
  const view = () => runtime.command('swarm.view', { swarmId: SWARM }, owner);
  await runtime.command('swarm.create', {
    swarmId: SWARM, purpose: 'Issue #522 lease rows', idempotencyKey: 'issue522-create',
  }, owner);

  assert.equal(await view().then((current) => verifyLeaseHeld(current, CONTRIBUTION, CHECK)), false,
    'no verify lease held and no queue entry: the check is not the resident\'s work');

  // The check's own holder template, exactly as the runtime's swarm.check arm reads it back.
  const held = await authority.acquire('verify', { holder: `check:${CONTRIBUTION}:${CHECK}` });
  assert.equal(await view().then((current) => verifyLeaseHeld(current, CONTRIBUTION, CHECK)), true,
    'the held verify lease is the progress signal the wait re-arms on');
  assert.equal(await view().then((current) => current.deployment.hostCapacity.used.leases.verify), 1,
    'the view carries the authority\'s own lease count');
  // A second verify lease does not fit beside the first on a 4-core fixture, so both take their
  // place in the queue the observation projects with the holder that owns each entry.
  const queuedCheck = `${CHECK}-queued`;
  const queuedHolder = `check:${CONTRIBUTION}:${queuedCheck}`;
  const competing = authority.acquire('verify', { holder: 'check:other:check-other' });
  const queued = authority.acquire('verify', { holder: queuedHolder });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (authority.observeNow().queue.some((row) => row.holder === queuedHolder)) break;
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
  assert.equal(await view().then((current) => verifyLeaseHeld(current, CONTRIBUTION, queuedCheck)), true,
    'a check waiting in the verify queue is still the resident\'s work');

  // The queue drains in order: the seat ahead of this check admits first, then this one.
  await authority.release(held.token);
  const admitted = await competing;
  await authority.release(admitted.token);
  const drained = await queued;
  await authority.release(drained.token);
  assert.equal(await view().then((current) => verifyLeaseHeld(current, CONTRIBUTION, CHECK)), false,
    'the released lease ends the wait');
});
