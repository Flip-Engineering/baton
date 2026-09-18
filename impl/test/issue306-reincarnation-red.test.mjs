// Issue #306 — reincarnation in place: the docs/48-reincarnation-in-place.md design pins, moved to
// the LANDED truth (the 374aa9d8 precedent: the design-lane pins follow the landing).
//
// History: written red-before against the design (docs/48 §2 protocol rows, §5 wake class, §6
// refusals) and observed 14/14 red at HEAD 1a830bfe. The implementation lanes then landed FIRST —
// ds-306a (the verb, 809341b3) and ds-306b (the advisories and wake class, 6bc66bcb) — so this
// file now pins the design's contract against the landed implementation, with the landed
// divergences named in docs/48 §11:
//   - the verb is an application DIRECT PORT (like deployment.doctor), never an
//     APPLICATION_COMMAND_DEFINITIONS key — the byte-stable command table is unchanged;
//   - the receipt reads {state: 'reincarnating', target, from, successor: {pid, incarnation}};
//   - a new turn during the handoff is refused reincarnation_in_flight {since, successorPid,
//     phase} through the ONE turnAdmissionRefusal read (not coordinator_draining);
//   - the spawn seam is advanced.resident.spawnSuccessor(spec) and the OLD incarnation mints the
//     successor's identity (BATON_INCARNATION), so host.successor_started names it;
//   - a successor that dies after its readiness marker but before publishing leaves the stop
//     narrated and residentState reconciliation_required (no re-publish — §11's open follow-up);
//   - the wake class carries next: null — the table's one invariant lets only a terminal class
//     name a command, so the re-read guidance rides the summary.
//
// Fixture: the in-process hosted-resident idiom (openBatonDeployment + host()) with the successor
// INJECTED through resident.spawnSuccessor as a child-shaped stub the test drives (never a real
// second resident) — the same idiom impl/test/issue306a-reincarnate.test.mjs pins the mechanics
// with; this file pins the docs/48 DESIGN sections against the landing.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import {
  REINCARNATION_REFUSALS, openBatonDeployment,
} from '../src/application-deployment.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { WAKE_CLASSES, wakeClassRow } from '../src/wake-stream.mjs';

const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const WAIT_MS = 4_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(probe, { timeoutMs = WAIT_MS, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(10);
  }
}

const roots = [];
function world(label) {
  const root = mkdtempSync(join(tmpdir(), `bt306-${label}-`));
  roots.push(root);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [repo, home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git(['init', '-q']);
  git(['config', 'user.email', 'issue306@example.invalid']);
  git(['config', 'user.name', 'Issue306']);
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
    coordinationDir: join(deploymentRoot, 'state', 'coordination'),
  };
}
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

/** The exact adapter card the ordinary resident self-check requires (the issue351 fixture card). */
function adapter() {
  const value = new MockAdapter({ harness: 'codex', scenario: { outcome: 'completed', delayMs: 1, summary: 'issue306 fixture' } });
  const rawCard = value.card.bind(value);
  value.card = () => ({ ...rawCard(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: { schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] } },
    modelSelection: { mode: 'exact', configuredDefault: 'gpt-5.6-sol', available: ['gpt-5.6-sol'], family: 'codex',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['high'], serviceTier: null,
      provenance: 'issue306-reincarnation-red', refreshedAt: null },
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
const hostOrder = (file) => hostRows(file).map((row) => row.payload.kind);

/**
 * The successor the injected spawner hands back: a child-shaped handle (EventEmitter with pid and
 * stderr) the test drives through the successor's own milestones — write the readiness marker,
 * take the released writer lease, publish the selector/profile/token, and (as the successor would
 * once it saw the predecessor's process gone) record the settlement rows.
 */
class StubSuccessor extends EventEmitter {
  static nextPid = 40_000;
  constructor(spec) {
    super();
    this.spec = spec;
    this.pid = StubSuccessor.nextPid += 1;
    this.stderr = new EventEmitter();
    this.exitCode = null;
    this.signalCode = null;
    this.journal = { spawnedAt: Date.now() };
  }
  writeMarker(state) {
    writeFileSync(this.spec.markerPath, `${JSON.stringify({
      schemaVersion: 1, incarnation: this.spec.env.BATON_INCARNATION, pid: this.pid,
      predecessor: { incarnation: this.spec.env.BATON_PREDECESSOR_INCARNATION, commit: this.spec.env.BATON_PREDECESSOR_COMMIT },
      target: { sha: this.spec.env.BATON_REINCARNATION_TARGET, ref: null },
      state, at: new Date().toISOString(),
    })}\n`);
  }
  becomeReady() { this.writeMarker('waiting'); }
  /** The successor's own open+publish, in production's order: lease free → take → publish. */
  async openAndPublish(selector) {
    await until(() => !existsSync(this.spec.leasePath), { label: 'the writer lease release' });
    this.journal.leaseFreeAt = Date.now();
    this.writeMarker('opened');
    writeFileSync(this.spec.selectorPath, `${JSON.stringify(selector)}\n`);
    writeFileSync(this.spec.profilePath, `${JSON.stringify({
      schemaVersion: 2, transport: 'local', socketPath: join(this.spec.deploymentRoot, 'successor.sock'),
      url: 'https://baton.local', origin: 'https://baton.local', tokenFile: this.spec.tokenPath.split('/').at(-1),
      deploymentId: selector.deploymentId, incarnation: selector.incarnation,
      registryDigest: selector.registryDigest, startedAt: selector.startedAt,
      ownerPid: process.pid, ownerPidStart: 'successor',
    })}\n`);
    writeFileSync(this.spec.tokenPath, `${'a'.repeat(48)}\n`);
    this.journal.publishedAt = Date.now();
  }
  /** The settlement rows the REAL successor records once its predecessor's process is gone
   * (docs/48 §2 step 8 — the old holds no writer lease to write them). */
  async settle(worldFixture, { predecessorIncarnation }) {
    const store = new CoordinationStore(worldFixture.coordinationDir);
    store.claimWriterLease();
    const at = new Date().toISOString();
    store.recordDriver('host.successor_published', {
      pid: this.pid, incarnation: this.spec.env.BATON_INCARNATION,
      from: Object.freeze({ incarnation: predecessorIncarnation, commit: worldFixture.landing }),
      target: Object.freeze({ sha: worldFixture.base, ref: null }), at,
    }, { actor: 'issue306-fixture-successor', key: `issue306:${worldFixture.root}:successor_published` });
    store.recordDriver('host.publication_withdrawn', { incarnation: predecessorIncarnation, at },
      { actor: 'issue306-fixture-successor', key: `issue306:${worldFixture.root}:publication_withdrawn` });
    store.recordDriver('host.reincarnated', {
      from: Object.freeze({ incarnation: predecessorIncarnation, commit: worldFixture.landing }),
      to: Object.freeze({ incarnation: this.spec.env.BATON_INCARNATION, commit: worldFixture.base }),
      predecessorExited: true, at,
    }, { actor: 'issue306-fixture-successor', key: `issue306:${worldFixture.root}:reincarnated` });
    store.releaseWriterLease();
  }
  crash({ code = 7, tail = 'boom: the successor refused to start\n' } = {}) {
    this.stderr.emit('data', Buffer.from(tail));
    this.exitCode = code;
    this.emit('exit', code, null);
  }
}

/** One hosted resident over the fixture world, successor spawner injected, handoff bound shrunk. */
async function resident(t, f, { onSpawn } = {}) {
  let driver = null;
  const deployment = await openBatonDeployment({
    repo: f.repo,
    advanced: {
      deploymentRoot: f.deploymentRoot,
      adapters: { codex: adapter() },
      routes: [ROUTE],
      verification: { command: 'node', arguments: ['--test'] },
      resident: {
        env: { XDG_CONFIG_HOME: f.configRoot, HOME: f.home },
        home: f.home,
        webDrainMs: 500,
        sessionTtlMs: 60_000,
        reincarnationWaitMs: WAIT_MS,
        ...(onSpawn ? { spawnSuccessor: onSpawn } : {}),
      },
    },
  }, (options) => { driver = createDriver(options); return driver; });
  t.after(async () => { try { await deployment.close(); } catch { /* the handoff already closed it */ } });
  return { deployment, driver };
}

const selectorOf = (f) => JSON.parse(readFileSync(f.selectorPath, 'utf8'));

/**
 * Drive a whole handoff to settlement (docs/48 §2): the request, the readiness marker, the old
 * incarnation's own close (the verb arms it), the stub's lease-then-publish, and — after the
 * close resolves (the in-process stand-in for the predecessor's process exit) — the settlement
 * rows.
 */
async function driveHandoff(t, f) {
  const stubs = [];
  const { deployment } = await resident(t, f, {
    onSpawn: (spec) => { const stub = new StubSuccessor(spec); stub.becomeReady(); stubs.push(stub); return stub; },
  });
  const published = await deployment.host();
  const oldIncarnation = published.incarnation;
  const seen = new Set();
  let absentReads = 0;
  let watching = true;
  const watcher = (async () => {
    while (watching) {
      if (!existsSync(f.selectorPath)) absentReads += 1;
      else {
        try {
          const selector = JSON.parse(readFileSync(f.selectorPath, 'utf8'));
          if (typeof selector.incarnation === 'string') seen.add(selector.incarnation);
        } catch { absentReads += 1; }
      }
      await sleep(5);
    }
  })();
  const receipt = await deployment.reincarnate({ target: f.base });
  const stub = stubs[0];
  // The successor's open waits for the lease release INSIDE the old's close; the old's close waits
  // for the successor's publish — run both, each meeting the other (docs/48 §2 steps 5-7).
  const publishing = stub.openAndPublish({
    ...selectorOf(f), incarnation: stub.spec.env.BATON_INCARNATION, startedAt: new Date().toISOString(),
  });
  const close = deployment.close().catch((error) => error);
  await Promise.all([close, publishing]);
  watching = false;
  await watcher;
  await stub.settle(f, { predecessorIncarnation: oldIncarnation });
  return { deployment, receipt, stub, oldIncarnation, seen, absentReads };
}

test('#306 §6: the four request refusals are ONE exported closed set', () => {
  assert.deepEqual({ ...REINCARNATION_REFUSALS }, {
    targetUnreachable: 'reincarnation_target_unreachable',
    inFlight: 'reincarnation_in_flight',
    checkoutHeld: 'reincarnation_checkout_held',
    sameCommit: 'reincarnation_same_commit',
  }, 'the closed refusal set docs/48 §6 names — exported, never minted ad hoc at the call sites');
});

test('#306 §9: every handoff bound derives from the limits registry', () => {
  const wait = FRAME_LIMITS['host.reincarnation.wait_ms'];
  assert.ok(wait, 'land the ONE handoff bound in the registry (docs/48 §9)');
  assert.equal(wait.unit, 'ms');
  assert.ok(Number.isSafeInteger(wait.value) && wait.value > 0);
  const commits = FRAME_LIMITS['view.served_behind.commits'];
  assert.ok(commits, 'the behind-commit page bound (docs/48 §4/§9)');
  assert.equal(commits.unit, 'items');
});

test('#306 §5: host.reincarnated wakes the incarnation_changed class in the ONE wake table', () => {
  assert.ok(WAKE_CLASSES.includes('incarnation_changed'),
    "the class is in the closed WAKE_CLASS_TABLE — never a side list (docs/48 §5)");
  const row = wakeClassRow('incarnation_changed');
  assert.equal(row?.scope, 'deployment', 'a deployment-scope wake: every bounded swarm watch sees it');
  assert.equal(row?.terminal, false,
    'a reincarnation settles nothing — terminal false, a sibling of dead in scope only (docs/48 §5)');
  assert.equal(row?.next, null,
    'next is null: the table invariant lets only a terminal class name a command; the re-read guidance rides the summary (docs/48 §11)');
  assert.ok(row?.rows?.some((matcher) => matcher.payloadKind === 'host.reincarnated'),
    "the class derives from the ledger's host.reincarnated row through the table's operationalKind matcher");
});

test('#306 §2.1: the request records host.reincarnation_requested {target, from} and answers the reincarnating receipt', async (t) => {
  const f = world('r1');
  const { receipt, oldIncarnation } = await driveHandoff(t, f);
  assert.equal(receipt.state, 'reincarnating',
    'the verb answers with the handoff in motion — the caller is never held hostage to the drain (docs/48 §2)');
  assert.equal(receipt.target.sha, f.base, 'the receipt names the resolved target');
  assert.deepEqual(receipt.from, { incarnation: oldIncarnation, commit: f.landing },
    'the receipt names the incarnation and commit that served');
  const requested = hostRow(f.ledgerPath, 'host.reincarnation_requested');
  assert.ok(requested, 'the request row is durable (docs/48 §2 step 1)');
  assert.equal(requested.payload.target.sha, f.base, 'the row names the resolved target sha');
  assert.deepEqual(requested.payload.from, { incarnation: oldIncarnation, commit: f.landing });
  assert.equal(hostOrder(f.ledgerPath).indexOf('host.reincarnation_requested'), 0,
    'the request row precedes every other handoff row');
});

test('#306 §2.2: admission closes to new turns with the ONE typed refusal for the whole handoff', async (t) => {
  const f = world('r2');
  const stubs = [];
  const { deployment } = await resident(t, f, {
    onSpawn: (spec) => { const stub = new StubSuccessor(spec); stub.becomeReady(); stubs.push(stub); return stub; },
  });
  await deployment.host();
  const pending = deployment.reincarnate({ target: f.base });
  const refusal = await until(() => deployment.turnAdmissionRefusal(), { label: 'the closed admission' });
  assert.equal(refusal.code, 'reincarnation_in_flight',
    'a new turn during the handoff draws the ONE refusal (docs/48 §2 step 2, §11)');
  assert.equal(typeof refusal.detail.since, 'string', 'the refusal names when the handoff began');
  assert.equal(refusal.detail.phase, 'waiting');
  assert.equal(deployment.turnAdmissionRefusal()?.code, 'reincarnation_in_flight',
    'the same object answers for the whole handoff — never two vocabularies');
  const receipt = await pending;
  assert.equal(receipt.state, 'reincarnating');
  stubs[0].crash(); // let the old's close finish the row without a publish wait
});

test('#306 §2.3: an in-flight turn drains on the old incarnation — host.stop_waiting {on: worker} before host.successor_started', async (t) => {
  const f = world('r3');
  const stubs = [];
  const { deployment, driver } = await resident(t, f, {
    onSpawn: (spec) => { const stub = new StubSuccessor(spec); stub.becomeReady(); stubs.push(stub); return stub; },
  });
  await deployment.host();
  // ONE in-flight turn: a live worker the coordinator reports as mid-turn (the lane-A idiom —
  // the fixture's own handle set is empty, so the projection under test is the whole truth).
  const handle = { id: 'w-inflight', status: 'working', turnInFlight: true, worktree: '/elsewhere', taskId: 'task-inflight' };
  const realList = driver.coordinator.list.bind(driver.coordinator);
  let inFlight = true;
  driver.coordinator.list = () => (inFlight ? [...realList(), handle] : realList());
  const pending = deployment.reincarnate({ target: f.base });
  const waiting = await until(() => hostRow(f.ledgerPath, 'host.stop_waiting'), { label: 'the drain wait row' });
  assert.equal(waiting.payload.on, 'worker', 'the wait rides the #351 stop_waiting shape (docs/48 §2 step 3)');
  assert.deepEqual(waiting.payload.ids, ['w-inflight'], 'the wait names the in-flight turn');
  assert.equal(stubs.length, 0, 'the successor is never spawned while a turn is in flight');
  inFlight = false; // the one-shot turn completes on the old incarnation
  const receipt = await pending;
  assert.equal(receipt.state, 'reincarnating');
  assert.equal(stubs.length, 1, 'the successor spawns once the turn settled');
  const order = hostOrder(f.ledgerPath);
  assert.ok(order.indexOf('host.stop_waiting') > order.indexOf('host.reincarnation_requested'));
  assert.ok(order.indexOf('host.successor_started') > order.indexOf('host.stop_waiting'),
    'requested → stop_waiting → successor_started (docs/48 §2 steps 1-4)');
  stubs[0].crash();
});

test('#306 §2.4: the successor spawns at the target with BATON_PREDECESSOR_INCARNATION and the old-minted BATON_INCARNATION; host.successor_started names both', async (t) => {
  const f = world('r4');
  const { receipt, stub, oldIncarnation } = await driveHandoff(t, f);
  const { spec } = stub;
  assert.equal(spec.env.BATON_PREDECESSOR_INCARNATION, oldIncarnation,
    'the successor knows the incarnation it succeeds (docs/48 §2 step 4)');
  assert.equal(spec.env.BATON_REINCARNATION_TARGET, f.base, 'and the commit it serves');
  assert.equal(typeof spec.env.BATON_INCARNATION, 'string',
    'the old mints the successor identity, so host.successor_started can name it (docs/48 §11)');
  assert.equal(spec.cwd, f.repo, 'the successor serves the same checkout, moved to the target');
  assert.equal(receipt.successor.pid, stub.pid);
  const started = hostRow(f.ledgerPath, 'host.successor_started');
  assert.ok(started, 'host.successor_started is durable');
  assert.equal(started.payload.pid, stub.pid);
  assert.equal(started.payload.incarnation, spec.env.BATON_INCARNATION,
    'the row and the successor\'s own publication name ONE incarnation');
});

test('#306 §2.5: the successor takes the writer lease only after the old incarnation\'s release — host.stopped lies between successor_started and successor_published', async (t) => {
  const f = world('r5');
  const { stub } = await driveHandoff(t, f);
  assert.ok(stub.journal.leaseFreeAt, 'the successor observed the lease release, never an instant coordination_writer_busy');
  const order = hostOrder(f.ledgerPath);
  const stoppedAt = order.indexOf('host.stopped');
  assert.ok(stoppedAt > order.indexOf('host.successor_started'),
    'host.successor_started is the old incarnation\'s last lease-held row — the release (host.stopped) follows it');
  assert.ok(stoppedAt < order.indexOf('host.successor_published'),
    'the successor writes only after the release');
});

test('#306 §2.6-2.7 × §1: the publication moves atomically — every read names exactly one incarnation, the deployment id is stable, and the selector survives the old incarnation\'s exit', async (t) => {
  const f = world('r6');
  const { seen, absentReads, oldIncarnation, stub } = await driveHandoff(t, f);
  assert.equal(absentReads, 0, 'the publication is never absent mid-handoff (#288: never none)');
  for (const incarnation of seen) {
    assert.ok([oldIncarnation, stub.spec.env.BATON_INCARNATION].includes(incarnation),
      `every read resolved exactly one known incarnation (saw ${incarnation}) — never two publications`);
  }
  assert.ok(existsSync(f.selectorPath), 'the selector survives the old incarnation\'s exit — it names the successor now');
  const final = selectorOf(f);
  assert.equal(final.incarnation, stub.spec.env.BATON_INCARNATION, 'the served publication is the successor\'s');
  assert.equal(final.deploymentId, JSON.parse(readFileSync(f.selectorPath, 'utf8')).deploymentId,
    '§1: the deployment id is stable across the incarnation boundary');
});

test('#306 §2.8: the settlement rows are the successor\'s observations of the old incarnation', async (t) => {
  const f = world('r7');
  const { stub, oldIncarnation } = await driveHandoff(t, f);
  const withdrawn = hostRow(f.ledgerPath, 'host.publication_withdrawn');
  assert.ok(withdrawn, 'host.publication_withdrawn is durable (docs/48 §2 step 8)');
  assert.equal(withdrawn.payload.incarnation, oldIncarnation, 'the withdrawal names the OLD incarnation');
  const reincarnated = hostRow(f.ledgerPath, 'host.reincarnated');
  assert.ok(reincarnated, 'host.reincarnated {from, to} is durable (docs/48 §2 step 8)');
  assert.deepEqual(reincarnated.payload.from, { incarnation: oldIncarnation, commit: f.landing });
  assert.deepEqual(reincarnated.payload.to, { incarnation: stub.spec.env.BATON_INCARNATION, commit: f.base });
  assert.equal(reincarnated.payload.predecessorExited, true,
    'the successor records the observed predecessor exit — the fact, never a clock (docs/48 §11)');
  const order = hostOrder(f.ledgerPath);
  assert.ok(order.indexOf('host.reincarnated') > order.indexOf('host.successor_published'),
    'settlement follows the successor\'s publication');
});

test('#306 §2 crash table: a successor that dies before readiness fails the verb with the durable row, admission reopens, the publication is untouched', async (t) => {
  const f = world('r8');
  let stub = null;
  const { deployment } = await resident(t, f, {
    onSpawn: (spec) => { stub = new StubSuccessor(spec); return stub; }, // never becomes ready
  });
  const published = await deployment.host();
  const pending = deployment.reincarnate({ target: f.base });
  await until(() => stub !== null, { label: 'the successor spawn' });
  stub.crash({ code: 7, tail: 'boom: the successor refused to start\n' });
  const failure = await pending.then(() => null, (caught) => caught);
  assert.equal(failure?.code, 'reincarnation_failed',
    'the verb rejects: the caller learns the handoff failed, immediately and typed (docs/48 §2 crash table, §11)');
  assert.equal(failure.detail?.step, 'successor_start');
  assert.equal(failure.detail?.cause?.exit, 7);
  assert.match(failure.detail?.cause?.stderrTail ?? '', /the successor refused to start/u,
    'the cause carries the bounded stderr tail (#326)');
  const row = await until(() => hostRow(f.ledgerPath, 'host.reincarnation_failed'), { label: 'the durable failure row' });
  assert.equal(row.payload.step, 'successor_start');
  assert.equal(row.payload.cause.exit, 7);
  assert.equal(deployment.turnAdmissionRefusal(), null, 'admission reopens — the old incarnation keeps serving');
  assert.equal(selectorOf(f).incarnation, published.incarnation, 'the publication never moved');
  assert.equal(hostRow(f.ledgerPath, 'host.stopped'), null, 'no stop ran: the old incarnation is still serving');
});

test('#306 §6: reincarnation_target_unreachable is typed and pre-effect', async (t) => {
  const f = world('r9');
  let spawns = 0;
  const { deployment } = await resident(t, f, { onSpawn: () => { spawns += 1; throw new Error('must never spawn'); } });
  await deployment.host();
  const refused = await deployment.reincarnate({ target: 'refs/heads/does-not-exist' }).then(() => null, (caught) => caught);
  assert.equal(refused?.code, 'reincarnation_target_unreachable',
    'an unresolvable commit-ish (no ref, no remote to fetch from) refuses typed (docs/48 §6)');
  assert.equal(refused.detail?.target, 'refs/heads/does-not-exist', 'the refusal names the target');
  assert.equal(refused.detail?.fetched, false, 'and whether the verb\'s fetch ran');
  assert.equal(hostRow(f.ledgerPath, 'host.reincarnation_requested'), null, 'pre-effect: nothing recorded');
  assert.equal(spawns, 0, 'pre-effect: nothing spawned');
});

test('#306 §6: reincarnation_same_commit is typed and pre-effect', async (t) => {
  const f = world('r10');
  let spawns = 0;
  const { deployment } = await resident(t, f, { onSpawn: () => { spawns += 1; throw new Error('must never spawn'); } });
  await deployment.host();
  const refused = await deployment.reincarnate({ target: f.landing }).then(() => null, (caught) => caught);
  assert.equal(refused?.code, 'reincarnation_same_commit',
    'reincarnating to the commit the resident already serves refuses typed (docs/48 §6)');
  assert.equal(refused.detail?.served?.commit, f.landing, 'the refusal names the served commit');
  assert.equal(hostRow(f.ledgerPath, 'host.reincarnation_requested'), null, 'pre-effect: nothing recorded');
  assert.equal(spawns, 0, 'pre-effect: nothing spawned');
});

test('#306 §6: reincarnation_in_flight is typed and pre-effect, naming the successor it waits on', async (t) => {
  const f = world('r11');
  const stubs = [];
  const { deployment, driver } = await resident(t, f, {
    onSpawn: (spec) => { const stub = new StubSuccessor(spec); stub.becomeReady(); stubs.push(stub); return stub; },
  });
  await deployment.host();
  // Hold the first handoff in its drain with one in-flight turn, so the second request meets it.
  const handle = { id: 'w-inflight', status: 'working', turnInFlight: true, worktree: '/elsewhere', taskId: 'task-inflight' };
  const realList = driver.coordinator.list.bind(driver.coordinator);
  let inFlight = true;
  driver.coordinator.list = () => (inFlight ? [...realList(), handle] : realList());
  const first = deployment.reincarnate({ target: f.base });
  const waiting = await until(() => hostRow(f.ledgerPath, 'host.stop_waiting'), { label: 'the first handoff\'s drain' });
  assert.ok(waiting);
  const refused = await deployment.reincarnate({ target: f.base }).then(() => null, (caught) => caught);
  assert.equal(refused?.code, 'reincarnation_in_flight',
    'a second request while the first is unresolved refuses typed (docs/48 §6)');
  assert.equal(typeof refused.detail?.since, 'string', 'the refusal names when the in-flight attempt began');
  assert.equal(refused.detail?.phase, 'waiting', 'and the phase it is in');
  assert.equal(stubs.length, 0, 'the second request spawned nothing');
  inFlight = false;
  const receipt = await first;
  assert.equal(receipt.state, 'reincarnating', 'the first handoff completes once the turn settles');
  stubs[0].crash();
});

test('#306 §6: reincarnation_checkout_held is typed and pre-effect, naming the live holders', async (t) => {
  const f = world('r12');
  let spawns = 0;
  const { deployment, driver } = await resident(t, f, { onSpawn: () => { spawns += 1; throw new Error('must never spawn'); } });
  await deployment.host();
  // A live worker whose worktree IS the serving checkout: the checkout move would stomp it
  // (docs/48 §6, #428 custody — read from the coordinator's own live handles).
  const handle = { id: 'w-holder', status: 'working', turnInFlight: false, worktree: f.repo, taskId: 'task-holder' };
  const realList = driver.coordinator.list.bind(driver.coordinator);
  driver.coordinator.list = () => [...realList(), handle];
  const refused = await deployment.reincarnate({ target: f.base }).then(() => null, (caught) => caught);
  driver.coordinator.list = realList;
  assert.equal(refused?.code, 'reincarnation_checkout_held',
    'a live holder of the serving checkout refuses the checkout move, typed (docs/48 §6)');
  assert.deepEqual(refused.detail?.holders, ['w-holder'], 'the refusal names the holders');
  assert.equal(hostRow(f.ledgerPath, 'host.reincarnation_requested'), null, 'pre-effect: nothing recorded');
  assert.equal(spawns, 0, 'pre-effect: nothing spawned');
});
