// Issue #306 red-before skeleton (stage: design-not-landed) — the resident reincarnates in
// place: one deployment, a succession of incarnations, as specified by
// docs/48-reincarnation-in-place.md §2 (the handoff protocol), §5 (the wake class) and §6 (the
// refusals).
//
// Every row asserts the behaviour docs/48 specifies against the CURRENT runtime and is expected
// RED: today there is no `deployment.reincarnate` verb, no `advanced.reincarnation.spawn`
// injection seam (the open refuses the unknown advanced field and the fixture falls back so the
// row can say precisely what is missing), no host.reincarnation_* rows, and no
// `incarnation_changed` wake class. Each row's message names what the implementing lanes
// (ds-306a: the verb; ds-306b: the wake class) must land. When a row goes green its expected-red
// manifest entry is stale and retires with the landing (docs/44).
//
// Manifest plan (docs/44 rule 5): these rows list with reason #306. The manifest
// (impl/scripts/expected-red-tests.json) is outside every #306 lane's path scope; listing the
// rows is the integrating lane's first act, named in docs/48 §10.
//
// Fixture: the in-process served-deployment idiom of issue384 / phase89-resident-local-host /
// served-commit-306 — a real temporary repository with two commits, a real hosted resident
// (openBaton + host()), and a STUB successor provided through the injected spawner docs/48 §2
// step 4 names (never a real second resident). The stub is a real trivial child process (a real
// pid the old incarnation can observe) whose "successor milestones" — the writer-lease claim,
// the atomic selector move, the settlement rows — are driven from the test through the store the
// successor would own.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { MockAdapter, openBaton } from '../src/index.mjs';
import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { WAKE_CLASSES, wakeClassRow } from '../src/wake-stream.mjs';
import { allocatePhysicalWorkspaceOwner } from '../src/worktree.mjs';

const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The resident protocol bounds a socket path to sun_path (103 bytes); fixture roots are short.
function fixtureRoot(t, label) {
  const root = mkdtempSync(`/tmp/bt306-${label}-`);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** A two-commit repository: the resident serves shaB (HEAD); shaA is the reincarnation target. */
function repository(root) {
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  const gitOut = (args) => git(args).stdout.trim();
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'bt306@example.invalid']);
  git(['config', 'user.name', 'BT306']);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(repo, 'test'), { recursive: true });
  writeFileSync(join(repo, 'test', 'smoke.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('smoke', () => assert.equal(1, 1));\n");
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  const shaA = gitOut(['rev-parse', 'HEAD']);
  writeFileSync(join(repo, 'landing.txt'), 'landing\n');
  git(['add', '.']);
  git(['commit', '-qm', 'landing']);
  const shaB = gitOut(['rev-parse', 'HEAD']);
  return { repo, shaA, shaB };
}

/** The exact adapter card the ordinary resident self-check requires (phase89-resident-local-host). */
function adapter(delayMs = 1) {
  const value = new MockAdapter({ harness: ROUTE.harness, scenario: { outcome: 'completed', delayMs, summary: 'issue306 fixture' } });
  const card = value.card.bind(value);
  value.card = () => ({
    ...card(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] },
    },
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: ROUTE.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'issue306-reincarnation-red', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' },
  });
  return value;
}

const ledgerRows = (path) => (!existsSync(path) ? [] : readFileSync(path, 'utf8').split('\n')
  .filter((line) => line !== '').map((line) => JSON.parse(line)));
const hostRows = (fixture) => ledgerRows(fixture.ledgerPath)
  .filter((row) => row.kind === 'driver.recorded' && typeof row.payload?.kind === 'string' && row.payload.kind.startsWith('host.'))
  .map((row) => row.payload);
const kindOrder = (rows) => rows.map((row) => row.kind);

/** A bounded read that answers the value or null — never throws on timeout; the assertion names
 * the missing fact. */
async function until(fn, { timeoutMs = 20_000, pollMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await sleep(pollMs);
  }
}

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** A real trivial child process: a real pid the old incarnation can observe, killable, exitable. */
function stubChild({ crash = false } = {}) {
  const child = crash
    ? spawn(process.execPath, ['-e', 'process.stderr.write("stub successor exploded\\n"); process.exit(2)'], { stdio: ['ignore', 'ignore', 'pipe'] })
    : spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let tail = '';
  child.stderr.on('data', (chunk) => { tail = `${tail}${chunk}`.slice(-4096); });
  const exit = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  return { child, exit, stderrTail: () => tail };
}

/**
 * The stub successor's milestones, driven exactly as docs/48 §2 orders them: claim the writer
 * lease on the deployment's coordination directory (bounded poll — the old incarnation's release
 * is what makes it succeed), move the publication selector atomically to the successor's own
 * incarnation, record `host.successor_published`, and — after the old incarnation is gone —
 * record `host.publication_withdrawn` and `host.reincarnated {from, to}`.
 */
function successorMilestones(fixture, probe, { sha, predecessorIncarnation, pid }) {
  return (async () => {
    const store = new CoordinationStore(fixture.coordinationDir);
    const deadline = Date.now() + 10_000;
    for (;;) {
      try {
        store.claimWriterLease();
        probe.leaseClaimed = true;
        break;
      } catch (error) {
        if (error?.code === 'coordination_writer_busy') probe.sawLeaseBusy = true;
        if (error?.code !== 'coordination_writer_busy' || Date.now() > deadline) {
          probe.leaseError = error?.code ?? String(error);
          return;
        }
        await sleep(25);
      }
    }
    const selector = JSON.parse(readFileSync(fixture.selectorPath, 'utf8'));
    const next = { ...selector, incarnation: probe.successorIncarnation, startedAt: new Date().toISOString() };
    writeFileSync(`${fixture.selectorPath}.tmp`, `${JSON.stringify(next)}\n`);
    renameSync(`${fixture.selectorPath}.tmp`, fixture.selectorPath);
    probe.published = true;
    store.recordDriver('host.successor_published', {
      incarnation: probe.successorIncarnation, pid, commit: sha, at: new Date().toISOString(),
    }, { actor: 'issue306-fixture-successor', key: `issue306:${fixture.label}:successor_published` });
    await fixture.oldExited.promise;
    store.recordDriver('host.publication_withdrawn', {
      incarnation: predecessorIncarnation, at: new Date().toISOString(),
    }, { actor: 'issue306-fixture-successor', key: `issue306:${fixture.label}:publication_withdrawn` });
    store.recordDriver('host.reincarnated', {
      from: { incarnation: predecessorIncarnation, commit: fixture.shaB },
      to: { incarnation: probe.successorIncarnation, commit: sha },
      at: new Date().toISOString(),
    }, { actor: 'issue306-fixture-successor', key: `issue306:${fixture.label}:reincarnated` });
    probe.settled = true;
  })().catch((error) => { probe.milestoneError = error?.message ?? String(error); });
}

/**
 * A hosted resident on the two-commit repository, with the docs/48 §2 step 4 injection seam
 * (`advanced.reincarnation.spawn`) wired to a stub. At HEAD the open refuses the unknown
 * advanced field; the fixture then opens WITHOUT the seam so each row fails on the precise
 * missing surface instead of the config refusal.
 */
async function hostedFixture(t, label, { makeSpawn = null, delayMs = 1 } = {}) {
  const root = fixtureRoot(t, label);
  const { repo, shaA, shaB } = repository(root);
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const fixture = {
    label, root, repo, shaA, shaB, deploymentRoot, configRoot, home,
    coordinationDir: join(deploymentRoot, 'state', 'coordination'),
    ledgerPath: join(deploymentRoot, 'state', 'coordination', 'events.jsonl'),
    selectorPath: join(repo, '.git', 'baton', 'connection.json'),
    oldExited: deferred(),
    probe: { successorIncarnation: `instance-stub-successor-${label}`, spawnCalls: [], leaseClaimed: false, sawLeaseBusy: false, published: false, settled: false },
    seamAdmitted: true,
    deployment: null,
    published: null,
  };
  const spawn = makeSpawn === null ? null : makeSpawn(fixture, fixture.probe);
  const advanced = {
    deploymentRoot,
    adapters: { codex: adapter(delayMs) },
    routes: [ROUTE],
    verification: { command: 'node', arguments: ['--test'] },
    resident: { env: { XDG_CONFIG_HOME: configRoot, HOME: home }, home, webDrainMs: 250, sessionTtlMs: 60_000 },
    capacity: {
      estimate: () => ({ bytes: 1, inodes: 1 }),
      observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
    },
  };
  try {
    fixture.deployment = await openBaton({
      repo, advanced: { ...advanced, reincarnation: { spawn: spawn ?? (async () => { throw new Error('no spawn wired'); }) } },
    });
  } catch (error) {
    if (error?.code !== 'deployment_config_invalid' || !/reincarnation/u.test(error?.message ?? '')) throw error;
    fixture.seamAdmitted = false;
    fixture.deployment = await openBaton({ repo, advanced });
  }
  t.after(async () => {
    try { fixture.oldExited.resolve(); } catch { /* already settled */ }
    try { fixture.probe.child?.kill('SIGKILL'); } catch { /* stub already gone */ }
    try { await fixture.deployment.close(); } catch { /* fixture tree removed by fixtureRoot */ }
  });
  fixture.published = await fixture.deployment.host();
  return fixture;
}

function assertSeam(fixture) {
  assert.ok(fixture.seamAdmitted,
    'land the advanced.reincarnation.spawn injection seam (docs/48 §2 step 4): the deployment open must admit it');
  assert.equal(typeof fixture.deployment.reincarnate, 'function',
    'land deployment.reincarnate {target} on the opened resident (docs/48 §2)');
}

/** Drive a whole happy-path handoff: the request, the stub successor's milestones, the old
 * incarnation's close (its own, through the handoff — the test's close() joins the same
 * promise), then the settlement rows. */
async function driveHandoff(fixture, { target } = {}) {
  const receipt = await fixture.deployment.reincarnate({ target: target ?? fixture.shaA });
  await fixture.deployment.close();
  fixture.oldExited.resolve();
  await fixture.probe.milestones;
  try { fixture.probe.child?.kill('SIGKILL'); } catch { /* already gone */ }
  return { receipt, rows: hostRows(fixture) };
}

test('#306 RED (stage: design-not-landed): the reincarnate verb is ONE registered application command (docs/48 §2)', () => {
  const definition = APPLICATION_COMMAND_DEFINITIONS['deployment.reincarnate'];
  assert.ok(definition,
    "land 'deployment.reincarnate' in APPLICATION_COMMAND_DEFINITIONS (application.mjs) — one canonical command, CLI and deployment port spellings beside it (docs/48 §2)");
  assert.ok(definition.args.includes('target'), 'the command takes the target commit-ish');
});

test('#306 RED (stage: design-not-landed): §2.1 the request records host.reincarnation_requested {target:{sha,ref}, from:{incarnation, commit}} and answers a draining receipt', { timeout: 60_000 }, async (t) => {
  const f = await hostedFixture(t, 'r1', {
    makeSpawn: (fixture, probe) => async (args) => {
      probe.spawnCalls.push(args);
      const handle = stubChild();
      probe.child = handle.child;
      probe.milestones = successorMilestones(fixture, probe, { ...args, pid: handle.child.pid });
      return { pid: handle.child.pid, exit: handle.exit, stderrTail: handle.stderrTail };
    },
  });
  assertSeam(f);
  const { receipt, rows } = await driveHandoff(f);
  assert.equal(receipt?.reincarnation?.state, 'draining',
    'the verb answers after the request row — it never blocks the caller on the drain (docs/48 §2)');
  const requested = rows.find((row) => row.kind === 'host.reincarnation_requested');
  assert.ok(requested, 'land host.reincarnation_requested — the FIRST durable row of the handoff (docs/48 §2 step 1)');
  assert.equal(requested.target?.sha, f.shaA, 'the row names the resolved target sha');
  assert.equal(typeof requested.target?.ref, 'string', 'and the ref it resolved through');
  assert.equal(requested.from?.incarnation, f.published.incarnation, 'the row names the incarnation that served');
  assert.equal(requested.from?.commit, f.shaB, 'and the commit that incarnation served');
  assert.equal(kindOrder(rows).indexOf('host.reincarnation_requested'), 0,
    'the request row precedes every other handoff row');
});

test('#306 RED (stage: design-not-landed): §2.2 admission closes to new turns with the ONE drain refusal while the handoff drains', { timeout: 60_000 }, async (t) => {
  const f = await hostedFixture(t, 'r2', {
    delayMs: 400,
    makeSpawn: (fixture, probe) => async (args) => {
      probe.spawnCalls.push(args);
      const handle = stubChild();
      probe.child = handle.child;
      probe.milestones = successorMilestones(fixture, probe, { ...args, pid: handle.child.pid });
      return { pid: handle.child.pid, exit: handle.exit, stderrTail: handle.stderrTail };
    },
  });
  assertSeam(f);
  const turn = await f.deployment.run('hold the drain open');
  assert.ok(turn, 'the in-flight turn started before the request');
  const request = await f.deployment.reincarnate({ target: f.shaA });
  assert.equal(request?.reincarnation?.state, 'draining');
  const refused = await f.deployment.run('a new turn during the drain').then(
    () => null, (caught) => caught);
  assert.equal(refused?.code, 'coordinator_draining',
    'a new turn during the reincarnation drain meets the ONE #351 drain refusal — never a new vocabulary (docs/48 §2 step 2)');
  await f.deployment.close();
  f.oldExited.resolve();
  await f.probe.milestones;
});

test('#306 RED (stage: design-not-landed): §2.3 an in-flight turn drains first — a host.stop_waiting row precedes host.successor_started', { timeout: 60_000 }, async (t) => {
  const f = await hostedFixture(t, 'r3', {
    delayMs: 400,
    makeSpawn: (fixture, probe) => async (args) => {
      probe.spawnCalls.push(args);
      const handle = stubChild();
      probe.child = handle.child;
      probe.milestones = successorMilestones(fixture, probe, { ...args, pid: handle.child.pid });
      return { pid: handle.child.pid, exit: handle.exit, stderrTail: handle.stderrTail };
    },
  });
  assertSeam(f);
  await f.deployment.run('hold the drain open');
  const request = await f.deployment.reincarnate({ target: f.shaA });
  assert.equal(request?.reincarnation?.state, 'draining');
  await sleep(100); // the turn (400 ms) is still in flight
  assert.ok(!hostRows(f).some((row) => row.kind === 'host.successor_started'),
    'the successor is not spawned while a one-shot turn is in flight — it completes on the old incarnation (docs/48 §2 step 3)');
  await f.deployment.close();
  f.oldExited.resolve();
  await f.probe.milestones;
  const order = kindOrder(hostRows(f));
  const waiting = order.indexOf('host.stop_waiting');
  assert.ok(waiting > order.indexOf('host.reincarnation_requested'),
    'the turn wait is a host.stop_waiting row in the #351 shape, after the request (docs/48 §2 step 3)');
  assert.ok(waiting < order.indexOf('host.successor_started'),
    'the wait settles before the successor starts');
});

test('#306 RED (stage: design-not-landed): §2.4 the successor spawns at the target with BATON_PREDECESSOR_INCARNATION, and host.successor_started is the old incarnation\'s last lease-held row', { timeout: 60_000 }, async (t) => {
  const f = await hostedFixture(t, 'r4', {
    makeSpawn: (fixture, probe) => async (args) => {
      probe.spawnCalls.push(args);
      const handle = stubChild();
      probe.child = handle.child;
      probe.milestones = successorMilestones(fixture, probe, { ...args, pid: handle.child.pid });
      return { pid: handle.child.pid, exit: handle.exit, stderrTail: handle.stderrTail };
    },
  });
  assertSeam(f);
  const { rows } = await driveHandoff(f);
  const args = f.probe.spawnCalls[0];
  assert.ok(args, 'the successor spawn rode the injected seam');
  assert.equal(args.sha, f.shaA, 'the successor serves the target sha');
  assert.equal(args.env?.BATON_PREDECESSOR_INCARNATION, f.published.incarnation,
    'BATON_PREDECESSOR_INCARNATION names the old incarnation (docs/48 §2 step 4)');
  const started = rows.find((row) => row.kind === 'host.successor_started');
  assert.ok(started, 'land host.successor_started (docs/48 §2 step 4)');
  assert.equal(started.pid, f.probe.child.pid, 'the row names the successor pid');
  assert.equal(typeof started.incarnation, 'string', 'the row names the successor incarnation');
  const after = kindOrder(rows).slice(kindOrder(rows).indexOf('host.successor_started') + 1);
  assert.ok(after.every((kind) => ['host.stopped', 'host.successor_published', 'host.publication_withdrawn', 'host.reincarnated'].includes(kind)),
    `no old-incarnation handoff row follows host.successor_started — the release-minted host.stopped and the successor's own rows only (saw ${after.join(', ') || 'none'})`);
});

test('#306 RED (stage: design-not-landed): §2.5 the successor takes the writer lease only after the old incarnation\'s release, and the release mints host.stopped state reincarnating', { timeout: 60_000 }, async (t) => {
  const f = await hostedFixture(t, 'r5', {
    makeSpawn: (fixture, probe) => async (args) => {
      probe.spawnCalls.push(args);
      const handle = stubChild();
      probe.child = handle.child;
      probe.milestones = successorMilestones(fixture, probe, { ...args, pid: handle.child.pid });
      return { pid: handle.child.pid, exit: handle.exit, stderrTail: handle.stderrTail };
    },
  });
  assertSeam(f);
  const { rows } = await driveHandoff(f);
  assert.equal(f.probe.leaseClaimed, true,
    `the stub successor's bounded lease claim completed — a premature claim would still see coordination_writer_busy (saw busy: ${f.probe.sawLeaseBusy}, error: ${f.probe.leaseError ?? 'none'})`);
  assert.equal(f.probe.sawLeaseBusy, true,
    'the successor observed the held lease first (coordination_writer_busy) — it waited, it never refused at once (docs/48 §2 step 5)');
  const stopped = rows.find((row) => row.kind === 'host.stopped');
  assert.equal(stopped?.state, 'reincarnating',
    'the release mints the old incarnation\'s host.stopped through the #351 arming seam with state reincarnating (docs/48 §2 step 5)');
  const order = kindOrder(rows);
  assert.ok(order.indexOf('host.stopped') > order.indexOf('host.successor_started'),
    'host.successor_started is the old incarnation\'s last lease-held row — the release (host.stopped) follows it');
  assert.ok(order.indexOf('host.successor_published') > order.indexOf('host.stopped'),
    'the successor writes only after the release');
});

test('#306 RED (stage: design-not-landed): §2.6-2.7 the publication moves atomically — every read names exactly one incarnation and the selector survives the old incarnation\'s exit', { timeout: 60_000 }, async (t) => {
  const f = await hostedFixture(t, 'r6', {
    makeSpawn: (fixture, probe) => async (args) => {
      probe.spawnCalls.push(args);
      const handle = stubChild();
      probe.child = handle.child;
      probe.milestones = successorMilestones(fixture, probe, { ...args, pid: handle.child.pid });
      return { pid: handle.child.pid, exit: handle.exit, stderrTail: handle.stderrTail };
    },
  });
  assertSeam(f);
  const seen = new Set();
  let absentReads = 0;
  let watching = true;
  const receipt = await f.deployment.reincarnate({ target: f.shaA });
  assert.equal(receipt?.reincarnation?.state, 'draining');
  const watcher = (async () => {
    while (watching) {
      if (!existsSync(f.selectorPath)) absentReads += 1;
      else {
        try {
          const selector = JSON.parse(readFileSync(f.selectorPath, 'utf8'));
          if (typeof selector.incarnation === 'string') seen.add(selector.incarnation);
        } catch { absentReads += 1; }
      }
      await sleep(10);
    }
  })();
  await f.deployment.close();
  watching = false;
  await watcher;
  f.oldExited.resolve();
  await f.probe.milestones;
  try { f.probe.child?.kill('SIGKILL'); } catch { /* already gone */ }
  assert.equal(absentReads, 0, 'the publication is never absent mid-handoff (#288: never none)');
  for (const incarnation of seen) {
    assert.ok([f.published.incarnation, f.probe.successorIncarnation].includes(incarnation),
      `every read resolved exactly one known incarnation (saw ${incarnation}) — never two publications, never none`);
  }
  assert.ok(existsSync(f.selectorPath), 'the selector survives the old incarnation\'s exit — it names the successor now');
  const final = JSON.parse(readFileSync(f.selectorPath, 'utf8'));
  assert.equal(final.incarnation, f.probe.successorIncarnation, 'the served publication is the successor\'s');
});

test('#306 RED (stage: design-not-landed): §2.8 the successor records host.publication_withdrawn and host.reincarnated {from, to} as observations of the old incarnation', { timeout: 60_000 }, async (t) => {
  const f = await hostedFixture(t, 'r7', {
    makeSpawn: (fixture, probe) => async (args) => {
      probe.spawnCalls.push(args);
      const handle = stubChild();
      probe.child = handle.child;
      probe.milestones = successorMilestones(fixture, probe, { ...args, pid: handle.child.pid });
      return { pid: handle.child.pid, exit: handle.exit, stderrTail: handle.stderrTail };
    },
  });
  assertSeam(f);
  const { rows } = await driveHandoff(f);
  const withdrawn = rows.find((row) => row.kind === 'host.publication_withdrawn');
  assert.ok(withdrawn, 'land host.publication_withdrawn — successor-recorded, the old incarnation holds no lease to write it (docs/48 §2 step 8)');
  assert.equal(withdrawn.incarnation, f.published.incarnation, 'the withdrawal names the OLD incarnation');
  const reincarnated = rows.find((row) => row.kind === 'host.reincarnated');
  assert.ok(reincarnated, 'land host.reincarnated {from, to} (docs/48 §2 step 8)');
  assert.deepEqual(reincarnated.from, { incarnation: f.published.incarnation, commit: f.shaB });
  assert.deepEqual(reincarnated.to, { incarnation: f.probe.successorIncarnation, commit: f.shaA });
  const order = kindOrder(rows);
  assert.ok(order.indexOf('host.reincarnated') > order.indexOf('host.successor_published'),
    'settlement follows the successor\'s publication');
});

test('#306 RED (stage: design-not-landed): §2 crash — a successor that dies before publishing records host.reincarnation_failed {step, cause:{exit, stderrTail}} and reopens admission', { timeout: 60_000 }, async (t) => {
  const f = await hostedFixture(t, 'r8', {
    makeSpawn: (fixture, probe) => async (args) => {
      probe.spawnCalls.push(args);
      const handle = stubChild({ crash: true });
      probe.child = handle.child;
      probe.milestones = Promise.resolve();
      return { pid: handle.child.pid, exit: handle.exit, stderrTail: handle.stderrTail };
    },
  });
  assertSeam(f);
  const receipt = await f.deployment.reincarnate({ target: f.shaA });
  assert.equal(receipt?.reincarnation?.state, 'draining');
  const failed = await until(() => hostRows(f).find((row) => row.kind === 'host.reincarnation_failed'));
  assert.ok(failed, 'land host.reincarnation_failed — the old incarnation is the successor\'s parent and observes the exit (docs/48 §2 crash table)');
  assert.equal(failed.step, 'successor_publish', 'the failure names the step that never completed');
  assert.equal(failed.cause?.exit, 2, 'the cause carries the exit');
  assert.match(failed.cause?.stderrTail ?? '', /stub successor exploded/u, 'and the bounded stderr tail (#326)');
  const admitted = await f.deployment.run('after the failed reincarnation').then(
    () => true, () => false);
  assert.equal(admitted, true, 'admission reopens — the old incarnation keeps serving (docs/48 §2 crash table)');
  const selector = JSON.parse(readFileSync(f.selectorPath, 'utf8'));
  assert.equal(selector.incarnation, f.published.incarnation, 'the publication never moved');
});

test('#306 RED (stage: design-not-landed): §6 reincarnation_target_unreachable is typed and pre-effect', { timeout: 60_000 }, async (t) => {
  const f = await hostedFixture(t, 'r9', { makeSpawn: (fixture, probe) => async (args) => { probe.spawnCalls.push(args); throw new Error('must never spawn'); } });
  assertSeam(f);
  const target = 'f'.repeat(40);
  const refused = await f.deployment.reincarnate({ target }).then(() => null, (caught) => caught);
  assert.equal(refused?.code, 'reincarnation_target_unreachable',
    'an unresolvable commit-ish (the verb\'s fetch found no remote here) refuses typed (docs/48 §6)');
  assert.equal(refused?.detail?.target ?? refused?.target, target, 'the refusal names the target');
  assert.ok(!hostRows(f).some((row) => row.kind === 'host.reincarnation_requested'), 'pre-effect: nothing recorded');
  assert.equal(f.probe.spawnCalls.length, 0, 'pre-effect: nothing spawned');
});

test('#306 RED (stage: design-not-landed): §6 reincarnation_same_commit is typed and pre-effect', { timeout: 60_000 }, async (t) => {
  const f = await hostedFixture(t, 'r10', { makeSpawn: (fixture, probe) => async (args) => { probe.spawnCalls.push(args); throw new Error('must never spawn'); } });
  assertSeam(f);
  const refused = await f.deployment.reincarnate({ target: f.shaB }).then(() => null, (caught) => caught);
  assert.equal(refused?.code, 'reincarnation_same_commit',
    'reincarnating to the commit the resident already serves refuses typed (docs/48 §6)');
  assert.ok(!hostRows(f).some((row) => row.kind === 'host.reincarnation_requested'), 'pre-effect: nothing recorded');
  assert.equal(f.probe.spawnCalls.length, 0, 'pre-effect: nothing spawned');
});

test('#306 RED (stage: design-not-landed): §6 reincarnation_in_flight is typed and pre-effect', { timeout: 60_000 }, async (t) => {
  const f = await hostedFixture(t, 'r11', {
    makeSpawn: (fixture, probe) => async (args) => {
      probe.spawnCalls.push(args);
      const handle = stubChild(); // never publishes: the first attempt stays in flight
      probe.child = handle.child;
      probe.milestones = Promise.resolve();
      return { pid: handle.child.pid, exit: handle.exit, stderrTail: handle.stderrTail };
    },
  });
  assertSeam(f);
  const first = await f.deployment.reincarnate({ target: f.shaA });
  assert.equal(first?.reincarnation?.state, 'draining');
  const refused = await f.deployment.reincarnate({ target: f.shaA }).then(() => null, (caught) => caught);
  assert.equal(refused?.code, 'reincarnation_in_flight',
    'a second request while the first is unresolved refuses typed (docs/48 §6)');
  assert.equal(typeof (refused?.detail?.since ?? refused?.since), 'string', 'the refusal names when the in-flight attempt began');
  assert.equal(refused?.detail?.successorPid ?? refused?.successorPid, f.probe.child.pid, 'and the successor it already started');
  assert.equal(f.probe.spawnCalls.length, 1, 'the second request spawned nothing');
});

test('#306 RED (stage: design-not-landed): §6 reincarnation_checkout_held is typed and pre-effect', { timeout: 60_000 }, async (t) => {
  const f = await hostedFixture(t, 'r12', { makeSpawn: (fixture, probe) => async (args) => { probe.spawnCalls.push(args); throw new Error('must never spawn'); } });
  assertSeam(f);
  allocatePhysicalWorkspaceOwner(f.repo, {
    runId: 'issue306-run', attemptId: 'issue306-attempt', logicalTaskId: 'issue306-logical',
    processGeneration: 1, baseSha: f.shaB,
  }, {
    deploymentId: 'issue306-holder-deployment', controllerId: 'issue306-holder-controller',
    pid: process.pid, pidStart: 'issue306-live-holder',
  });
  const refused = await f.deployment.reincarnate({ target: f.shaA }).then(() => null, (caught) => caught);
  assert.equal(refused?.code, 'reincarnation_checkout_held',
    'a live holder of the serving checkout (#428 custody) refuses the checkout move, typed (docs/48 §6)');
  assert.ok(Array.isArray(refused?.detail?.holders ?? refused?.holders), 'the refusal names the holders');
  assert.ok(!hostRows(f).some((row) => row.kind === 'host.reincarnation_requested'), 'pre-effect: nothing recorded');
  assert.equal(f.probe.spawnCalls.length, 0, 'pre-effect: nothing spawned');
});

test('#306 RED (stage: design-not-landed): §5 host.reincarnated wakes the incarnation_changed class in the ONE wake table', () => {
  assert.ok(WAKE_CLASSES.includes('incarnation_changed'),
    "land 'incarnation_changed' in the closed WAKE_CLASS_TABLE (wake-stream.mjs) — never a side list (docs/48 §5)");
  const row = wakeClassRow('incarnation_changed');
  assert.equal(row?.terminal, false,
    'a reincarnation settles nothing: terminal false, a sibling of dead in scope only (docs/48 §5)');
  assert.ok(row?.rows?.some((matcher) => matcher.payloadKind === 'host.reincarnated'),
    "the class derives from the ledger's host.reincarnated row through the ONE table's operationalKind matcher");
  assert.equal(row?.scope, 'deployment', 'a deployment-scope wake: every bounded swarm watch sees it');
});
