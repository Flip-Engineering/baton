// Issue #619: a landing that ENDS leaves no host artifact behind.
//
// The observation behind the issue: the 2026-09-27T15:11Z run left four verify queue rows at the
// head of the lane (867b68d5, 0d2abafb, 2769697f, 0acaa225) and three dead gate checkouts, all
// under the resident's own live pid, so #506's dead-pid sweep could never reach the rows and the
// lane admitted nothing already queued until the root removed them by hand. The lane admits by
// queue order — only the FIRST row can be admitted — and `createIntegrationCheckout` refuses a
// contribution whose `.baton/wt/integrate-<contributionId>` directory still exists, so one
// landing's leftovers blocked both the lane and that contribution's next attempt.
//
//   (a) a queued request that ends by throwing takes its own queue row with it;
//   (b) withdrawQueuedHolder removes exactly the rows that name the request it is given;
//   (c) reclaimIntegrationCheckout reclaims the exact checkout it is given, and only that one;
//   (d) the landing's own end reclaims both artifacts for the landing that ended.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HostCapacityAuthority } from '../src/host-capacity.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { createIntegrationCheckout, reclaimIntegrationCheckout } from '../src/worktree.mjs';

const G = 1024 ** 3;
const PRIVATE = 0o600;
const QUIET_GIT_ENV = { GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' };
const HAVE_GIT = (() => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const needsGit = { skip: HAVE_GIT ? false : 'git binary unavailable' };

function capacityRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-issue619-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Stage one record the way the authority writes it: a private regular file whose field set is
 * exactly the one the read validates, named so bytewise order is FIFO order. */
function stage(dir, name, record) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, name), `${JSON.stringify(record)}\n`, { mode: PRIVATE });
}

const stagedLease = (overrides) => ({
  schemaVersion: 1, kind: 'verify', holder: 'participant:swarm-619:other',
  nonce: 'a'.repeat(32), pid: process.pid, residentId: 'resident-other',
  acquiredAt: '2026-09-27T15:00:00.000Z', ...overrides,
});

/** Plenty of memory (so a verify is never answered DEGRADED) and four cores, so one admitted
 * verify fills the derived budget and the next request has to wait for it. */
function authorityOver(root) {
  return new HostCapacityAuthority({
    root, residentId: 'issue619',
    observation: () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: 1 }),
    pollMs: 10,
  });
}

/** A real temporary repository with one commit — the shape `createIntegrationCheckout` needs. */
function tempRepo(t) {
  const repo = mkdtempSync(join(tmpdir(), 'baton-619-repo-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, {
    cwd: repo, encoding: 'utf8', env: { ...process.env, ...QUIET_GIT_ENV },
  });
  git('init', '-q');
  writeFileSync(join(repo, 'README.md'), 'one\n');
  git('add', 'README.md');
  // Issue #605: a fixture passes git identity by environment, never by writing a config.
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@baton.invalid', 'commit', '-q', '-m', 'one');
  git('branch', 'lane');
  return repo;
}

// ── HC-619-a: the request's own row leaves with the request ─────────────────────────────────────

test('HC-619-a: a queued request that ends by throwing leaves no queue row behind', async (t) => {
  const root = capacityRoot(t);
  const authority = authorityOver(root);
  // One admitted verify holds the derived budget (every core but the hub's, one memory share),
  // and its holder's pid is live, so #506's sweep never reclaims it.
  stage(join(root, 'leases'), 'lease-verify-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json', stagedLease({}));

  let announce;
  const announced = new Promise((resolve) => { announce = resolve; });
  const waiting = authority.acquire('verify', {
    holder: 'integrate:swarm-619:contribution-aaaa',
    onQueued: (row) => announce(row),
  });
  const row = await announced;
  assert.equal(row.position, 1, 'the request waits as the lane\'s only queue row');
  assert.equal(row.ahead, 0);
  assert.equal(row.running, 1, 'the admitted verify it waits on is a lease, not a row');

  const ownRows = readdirSync(join(root, 'queue'));
  assert.equal(ownRows.length, 1, 'the waiting request announced itself as one queue row');
  const ownRow = ownRows[0];

  // A record the authority cannot read makes the request's own next turn throw — an exit that
  // carries no lease token, which is the class of exit the 2026-09-27T15:11Z run died on.
  stage(join(root, 'leases'), 'lease-worker-garbage.json', { not: 'a host capacity record' });

  await assert.rejects(waiting, (error) => error?.code === 'host_capacity_unavailable');
  assert.deepEqual(readdirSync(join(root, 'queue')), [],
    `the row ${ownRow} left with the request that wrote it`);
});

// ── HC-619-b: the row names the request, so the request can take it back ────────────────────────

test('HC-619-b: withdrawQueuedHolder removes exactly the rows that name the holder it is given', async (t) => {
  const root = capacityRoot(t);
  const authority = authorityOver(root);
  const queueDir = join(root, 'queue');
  const row = (holder, nonce, enqueuedAt) => ({
    schemaVersion: 1, kind: 'verify', holder, nonce, pid: process.pid,
    residentId: 'issue619', enqueuedAt,
  });
  stage(queueDir, 'queue-2026-09-27T16:00:00.000Z-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json',
    row('integrate:swarm-619:contribution-onesix', 'a'.repeat(32), '2026-09-27T16:00:00.000Z'));
  stage(queueDir, 'queue-2026-09-27T16:00:01.000Z-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json',
    row('integrate:swarm-619:contribution-onesix', 'b'.repeat(32), '2026-09-27T16:00:01.000Z'));
  stage(queueDir, 'queue-2026-09-27T16:00:02.000Z-cccccccccccccccccccccccccccccccc.json',
    row('integrate:swarm-619:contribution-other', 'c'.repeat(32), '2026-09-27T16:00:02.000Z'));
  stage(queueDir, 'queue-2026-09-27T16:00:03.000Z-dddddddddddddddddddddddddddddddd.json',
    row('participant:swarm-619:seat', 'd'.repeat(32), '2026-09-27T16:00:03.000Z'));

  assert.equal(await authority.withdrawQueuedHolder('integrate:swarm-619:contribution-onesix'), 2,
    'both rows the landing left are removed');
  const left = readdirSync(queueDir).sort();
  assert.equal(left.length, 2, 'another landing\'s row and a seat\'s row are not its business');
  assert.equal(
    await authority.withdrawQueuedHolder('integrate:swarm-619:contribution-onesix'), 0,
    'a holder with no row left answers zero, never a silent no-op',
  );
  assert.equal(await authority.withdrawQueuedHolder('participant:swarm-619:seat'), 1);
});

// ── HC-619-c: the checkout is reclaimed by the exact directory that named it ─────────────────────

test('HC-619-c: reclaimIntegrationCheckout reclaims the exact checkout it is given, and only that one',
  needsGit, async (t) => {
    const repo = tempRepo(t);
    const checkout = await createIntegrationCheckout(repo, 'contribution:onesix');
    const sibling = await createIntegrationCheckout(repo, 'contribution:other');
    assert.equal(existsSync(checkout.dir), true);

    assert.equal(await reclaimIntegrationCheckout(repo, checkout.dir), 'integrate-contribution-onesix',
      'the directory the landing named is reclaimed');
    assert.equal(existsSync(checkout.dir), false, 'and it is exactly absent');
    assert.equal(existsSync(sibling.dir), true, 'another landing\'s checkout is not this one\'s business');
    assert.equal(existsSync(join(repo, '.baton', 'wt', 'integrate-contribution-onesix.projection.exclude')), false);

    assert.equal(await reclaimIntegrationCheckout(repo, checkout.dir), null,
      'a checkout that is already gone answers null');
    assert.equal(await reclaimIntegrationCheckout(repo, join(repo, 'README.md')), null,
      'a path that is not an integration checkout is left alone');
    await sibling.cleanup();
  });

// ── HC-619-d: the landing's own end reclaims both artifacts ─────────────────────────────────────

test('HC-619-d: a landing that has ended reclaims its queue row and its scratch checkout',
  needsGit, async (t) => {
    const repo = tempRepo(t);
    const root = capacityRoot(t);
    const authority = authorityOver(root);
    const queueDir = join(root, 'queue');
    // The row a landing's gate run leaves behind when it waits for the lane: its holder names the
    // landing (`integrate:<swarm>:<contribution>`), which is what lets the landing take it back.
    stage(queueDir, 'queue-2026-09-27T16:00:00.000Z-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json', {
      schemaVersion: 1, kind: 'verify', holder: 'integrate:swarm-619:contribution-onesix',
      nonce: 'a'.repeat(32), pid: process.pid, residentId: 'issue619',
      enqueuedAt: '2026-09-27T16:00:00.000Z',
    });
    const checkout = await createIntegrationCheckout(repo, 'contribution:onesix');
    const storeDir = mkdtempSync(join(tmpdir(), 'baton-619-store-'));
    t.after(() => rmSync(storeDir, { recursive: true, force: true }));
    const runtime = new SwarmRuntime({
      store: new CoordinationStore(storeDir),
      coordinator: { list: () => [], pausedTurns: () => [] },
      authorize: async () => {}, hostCapacity: authority, integration: { repoRoot: repo },
      prepareRun: async (request) => request,
      startRun: async () => {},
      stopRun: async () => ({ state: 'closed' }),
    });

    await runtime._reclaimLanding({
      swarmId: 'swarm-619', contributionId: 'contribution-onesix', scratch: checkout.dir,
    });
    assert.deepEqual(readdirSync(queueDir), [], 'the row that named the landing is gone');
    assert.equal(existsSync(checkout.dir), false, 'the checkout that landing opened is gone');
  });

// ── HC-619-e: the row leaves at the LANDING's end too, not only with the request that wrote it ──

test('HC-619-e: a landing that ends reclaims the queue row that named it', needsGit, async (t) => {
  const repo = tempRepo(t);
  const root = capacityRoot(t);
  const authority = authorityOver(root);
  const storeDir = mkdtempSync(join(tmpdir(), 'baton-619-store-'));
  t.after(() => rmSync(storeDir, { recursive: true, force: true }));
  const owner = { actor: 'issue619-owner', principalId: 'issue619-owner', sessionId: 'issue619-owner' };
  const store = new CoordinationStore(storeDir);
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => [], pausedTurns: () => [] },
    authorize: async () => {},
    hostCapacity: authority,
    integration: { repoRoot: repo },
    prepareRun: async (request) => request,
    startRun: async () => {},
    stopRun: async () => ({ state: 'closed' }),
  });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  await runtime.command('swarm.create',
    { swarmId: 'swarm-619', purpose: 'Landings reclaim their artifacts', idempotencyKey: 'i619:create' }, owner);
  // The seat and its contribution are recorded through the store's own fold, as #600's fixture
  // does: the command path resolves the contract's sha against the SEAT's worker checkout, and
  // this fixture has no seat — nothing below is about that admission.
  const record = (kind, payload, key) => store.recordSwarm(kind, { swarmId: 'swarm-619', ...payload },
    { actor: owner.actor, key: `i619:${key}` });
  record('swarm.participant_joined', { participantId: 'seat-619', role: 'Builder', runId: 'run-619' }, 'join');
  record('swarm.contribution_recorded', {
    contributionId: 'contribution-onesix', participantId: 'seat-619',
    body: {
      subject: 'One', base: { observedHead: sha, rebasedOnto: sha },
      commit: { sha, branch: 'lane' },
      items: [{
        id: 'one', status: 'delivered', change: 'one landing', files: ['README.md'],
        test: 'node --test test/one.test.mjs', evidence: 'green',
      }],
      verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
      carriedForward: [], needsFromOthers: [],
    },
  }, 'contribution');

  // The row a waiting landing leaves: its holder names the landing that wrote it.
  const queueDir = join(root, 'queue');
  stage(queueDir, 'queue-2026-09-27T16:00:00.000Z-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json', {
    schemaVersion: 1, kind: 'verify', holder: 'integrate:swarm-619:contribution-onesix',
    nonce: 'a'.repeat(32), pid: process.pid, residentId: 'issue619',
    enqueuedAt: '2026-09-27T16:00:00.000Z',
  });

  // The landing ends on the target it cannot resolve: however a landing ends, its row does not
  // stay in the lane.
  await runtime.command('swarm.integrate', {
    swarmId: 'swarm-619', contributionId: 'contribution-onesix', target: 'no-such-ref',
    idempotencyKey: 'i619:land',
  }, owner).then(() => null, (thrown) => thrown);
  assert.deepEqual(readdirSync(queueDir), [], 'the landing that ended took its row with it');
});
