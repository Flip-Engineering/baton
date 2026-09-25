// Issue #306 lane A — `deployment.reincarnate`: the RUNNING resident starts a successor over the
// same deployment, hands the publication over, and exits (a drain-restart in place, #204).
//
// THE FACT this file is written against: a resident's seat workers are child processes on stdio
// pipes (omp-rpc.mjs), so a successor cannot inherit them. What survives an incarnation is the
// STATE DIRECTORY (participant rows, workspaces, contracts, parked guidance, claims) — the workers
// themselves are gone and their next turns run under the successor (#364's
// `swarm.participant_runtime_lost` is the row that already says so).
//
// What is pinned here, on a real temporary repository with TWO commits and an INJECTED successor
// spawner (never a second real resident in these rows):
//   (a) the request records `host.reincarnation_requested`, closes new-turn admission (a new turn
//       is refused `reincarnation_in_flight`), names its in-flight turns with the #351
//       `host.stop_waiting {on: worker}` row, and spawns the successor only after they settle;
//   (b) the successor takes the coordination writer lease only AFTER the old incarnation's release
//       (the release is the last step of the old's stop, so the successor's own observation of the
//       free lease lands after the `host.stopped` row the release mints);
//   (c) publication handoff: connection.json answers exactly ONE incarnation at every step — the
//       old's until the successor publishes, the successor's after — and the old's withdrawal
//       (which runs only after it OBSERVES the successor's publication) removes nothing of the
//       successor's (#288: never two publications, never none);
//   (d) a successor that dies before publishing → `host.reincarnation_failed {step, cause}`
//       carrying the bounded stderr tail, admission reopened, and the old publication untouched;
//   (e) the four typed, pre-effect refusals: same commit / unreachable target / checkout held /
//       already in flight — and the fetch path for a target only the deployment's remote holds;
//   (f) the new rows replay byte-identically (they ride the ordinary `driver.recorded` lane).
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { REINCARNATION_REFUSALS, openBatonDeployment } from '../src/application-deployment.mjs';
import { batonCliHelp, parseBatonCli } from '../src/application-cli.mjs';
import { BatonApplication } from '../src/application.mjs';
import { northboundCapabilityToken } from '../src/northbound-capability-authority.mjs';

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
  const root = mkdtempSync(join(tmpdir(), `bt306a-${label}-`));
  roots.push(root);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [repo, home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git(['init', '-q']);
  git(['config', 'user.email', 'issue306a@example.invalid']);
  git(['config', 'user.name', 'Issue306a']);
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
  };
}
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

/** The exact adapter card the ordinary resident self-check requires (the issue351 fixture card). */
function adapter() {
  const value = new MockAdapter({ harness: 'codex', scenario: { outcome: 'completed', delayMs: 1, summary: 'issue306a fixture' } });
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
      provenance: 'issue306a-reincarnate', refreshedAt: null },
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

/** The successor the injected spawner hands back: a real child-shaped handle the test drives —
 * it writes the handoff marker (its readiness), observes the writer lease file, publishes the
 * connection, and can die instead. The deployment never spawns a second resident in these rows. */
class StubSuccessor extends EventEmitter {
  static nextPid = 40_000;
  constructor(spec) {
    super();
    this.spec = spec;
    this.pid = StubSuccessor.nextPid++;
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
  /** Readiness: the marker the successor writes BEFORE its (lease-waiting) open. */
  becomeReady() { this.writeMarker('waiting'); this.journal.readyAt = Date.now(); }
  /** The successor's own open+publish, in the order production has it: lease free → take → publish. */
  async openAndPublish(selector) {
    await until(() => !existsSync(this.spec.leasePath), { label: 'the writer lease release' });
    this.journal.leaseFreeAt = Date.now();
    this.writeMarker('opened');
    // The successor's publication is the selector AND the private profile (and token) beside it —
    // a real successor rewrites all three in place, so the old's withdrawal must remove none.
    writeFileSync(this.spec.selectorPath, `${JSON.stringify(selector)}\n`);
    writeFileSync(this.spec.profilePath, `${JSON.stringify({
      schemaVersion: 2, transport: 'local', socketPath: join(this.spec.deploymentRoot, 'successor.sock'),
      url: 'https://baton.local', origin: 'https://baton.local', tokenFile: this.spec.tokenPath.split('/').at(-1),
      deploymentId: selector.deploymentId, incarnation: selector.incarnation,
      registryDigest: selector.registryDigest, startedAt: selector.startedAt,
      ownerPid: process.pid, ownerPidStart: 'successor',
    })}\n`);
  }
  /** #599: a successor whose open cannot proceed says so — the stand-down marker state the
   * publication window reads as the handoff's terminal fact (never a deadline). */
  standDown() { this.writeMarker('lease_held_by_predecessor'); this.journal.stoodDownAt = Date.now(); }
  crash({ code = 7, tail = 'boom: the successor refused to start\n' } = {}) {
    this.stderr.emit('data', Buffer.from(tail));
    this.exitCode = code;
    this.emit('exit', code, null);
  }
  kill() { this.exitCode = null; this.signalCode = 'SIGKILL'; this.emit('exit', null, 'SIGKILL'); return true; }
}

/** One open deployment over the fixture world, with the successor spawner injected and the handoff
 * bound shrunk to the test's own scale. */
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
  t.after(async () => { try { await deployment.close(); } catch { /* the row already closed it */ } });
  return { deployment, driver };
}

const selectorOf = (f) => JSON.parse(readFileSync(f.selectorPath, 'utf8'));
const successorSelector = (f, incarnation) => {
  const current = selectorOf(f);
  return { ...current, incarnation, startedAt: new Date().toISOString() };
};

test('306a-a: the request records its row, closes admission, waits for the in-flight turn, then spawns', async (t) => {
  const f = world('a');
  const seen = [];
  const { deployment, driver } = await resident(t, f, {
    onSpawn: (spec) => { const stub = new StubSuccessor(spec); stub.becomeReady(); seen.push(stub); return stub; },
  });
  await deployment.host();

  // ONE in-flight turn: a live worker the coordinator list reports as mid-turn. The fixture's own
  // handle set is empty, so the test's own projection is the whole truth the wait reads.
  const handle = { id: 'w-inflight', status: 'working', turnInFlight: true, worktree: '/elsewhere', taskId: 'task-inflight' };
  const realList = driver.coordinator.list.bind(driver.coordinator);
  let inFlight = true;
  driver.coordinator.list = () => (inFlight ? [...realList(), handle] : realList());

  const pending = deployment.reincarnate({ target: f.base });
  const waiting = await until(() => hostRow(f.ledgerPath, 'host.stop_waiting'), { label: 'the host.stop_waiting row' });
  assert.equal(waiting.payload.on, 'worker');
  assert.deepEqual(waiting.payload.ids, ['w-inflight'], 'the wait names the in-flight turn');
  assert.equal(seen.length, 0, 'the successor is never spawned while a turn is in flight');
  const refusal = deployment.turnAdmissionRefusal();
  assert.equal(refusal?.code, REINCARNATION_REFUSALS.inFlight,
    `a new turn during the handoff is refused typed: ${JSON.stringify(refusal)}`);
  assert.equal(deployment.turnAdmissionRefusal()?.code, REINCARNATION_REFUSALS.inFlight,
    'new-turn admission stays closed for the whole handoff');
  const requested = hostRow(f.ledgerPath, 'host.reincarnation_requested');
  assert.ok(requested, 'the request is durable before any wait');

  inFlight = false; // the one-shot turn completes on the old incarnation
  const receipt = await pending;
  assert.equal(seen.length, 1, 'the successor is spawned once the turn settled');
  assert.equal(receipt.state, 'reincarnating');
  assert.equal(receipt.successor.pid, seen[0].pid);
  assert.equal(receipt.target.sha, f.base);
  assert.equal(requested.payload.target.sha, f.base);
  await until(() => hostRow(f.ledgerPath, 'host.successor_started'), { label: 'the successor_started row' });
  seen[0].crash();
  await deployment.close().catch(() => {});
});

test('306a-b/c: the successor takes the writer lease after the old release; the publication never lapses', async (t) => {
  const f = world('b');
  let stub = null;
  const { deployment } = await resident(t, f, {
    onSpawn: (spec) => { stub = new StubSuccessor(spec); stub.becomeReady(); return stub; },
  });
  await deployment.host();
  const oldIncarnation = selectorOf(f).incarnation;

  // Every read of the published connection, in order: the handoff must never leave the repository
  // unpublished, and never answer two incarnations at once (#288).
  const observed = [];
  const watcher = setInterval(() => {
    try { observed.push(JSON.parse(readFileSync(f.selectorPath, 'utf8')).incarnation); }
    catch (error) { observed.push(`<${error.code ?? 'unreadable'}>`); }
  }, 5);
  t.after(() => clearInterval(watcher));

  const receipt = await deployment.reincarnate({ target: f.base });
  stub.openAndPublish(successorSelector(f, receipt.successor.incarnation)).catch(() => {});
  const closed = await deployment.close();
  clearInterval(watcher);

  assert.equal(closed.state, 'closed', `a completed handoff exits 0: ${JSON.stringify(closed)}`);
  const stopped = hostRow(f.ledgerPath, 'host.stopped');
  assert.ok(stopped, 'the old incarnation still runs the #351 stop path');
  const releasedAt = Date.parse(stopped.payload.at ?? stopped.ts);
  assert.ok(stub.journal.leaseFreeAt >= releasedAt,
    `the successor observed the writer lease free (${stub.journal.leaseFreeAt}) only after the release `
    + `that minted host.stopped (${releasedAt})`);

  assert.ok(!observed.some((value) => value.startsWith('<')),
    `the repository was never left unpublished during the handoff: ${observed.join(',')}`);
  const distinct = new Set(observed);
  assert.deepEqual([...distinct].sort(), [oldIncarnation, receipt.successor.incarnation].sort(),
    `exactly the two incarnations were published, in order: ${observed.join(',')}`);
  const firstNew = observed.findIndex((value) => value === receipt.successor.incarnation);
  assert.ok(firstNew > 0, `the old publication was live before the successor published: ${observed.join(',')}`);
  for (const value of observed.slice(firstNew)) {
    assert.equal(value, receipt.successor.incarnation,
      `the old incarnation never overwrites the successor's publication: ${observed.join(',')}`);
  }
  // The successor's identity is the one the checkout now serves — profile and token included.
  assert.equal(selectorOf(f).incarnation, receipt.successor.incarnation);
  const connections = join(f.configRoot, 'baton', 'connections');
  const profileFile = readdirSync(connections).find((name) => name.endsWith('.json'));
  assert.equal(JSON.parse(readFileSync(join(connections, profileFile), 'utf8')).incarnation,
    receipt.successor.incarnation, 'the old withdrawal removed nothing of the successor\'s publication');
});

test('306a-d: a successor that dies before publishing is named with its tail, and the old keeps serving', async (t) => {
  const f = world('d');
  let stub = null;
  const { deployment } = await resident(t, f, { onSpawn: (spec) => { stub = new StubSuccessor(spec); return stub; } });
  await deployment.host();
  const oldIncarnation = selectorOf(f).incarnation;

  const pending = deployment.reincarnate({ target: f.base });
  await until(() => stub !== null, { label: 'the spawn' });
  stub.crash({ code: 7, tail: 'refusing: the successor could not open the state directory\n' });
  await assert.rejects(() => pending, (error) => {
    assert.equal(error.code, 'reincarnation_failed', `the failed handoff is typed: ${error.code}`);
    return true;
  });

  const failed = hostRow(f.ledgerPath, 'host.reincarnation_failed');
  assert.ok(failed, 'the failure is durable, so a later reader sees why the successor never published');
  assert.equal(failed.payload.step, 'successor_start');
  assert.equal(failed.payload.cause.exit, 7);
  assert.match(failed.payload.cause.stderrTail, /could not open the state directory/u);
  // Admission is reopened and the old incarnation is still the published resident.
  assert.equal(deployment.turnAdmissionRefusal(), null, 'the failed handoff reopens admission');
  assert.equal(selectorOf(f).incarnation, oldIncarnation, 'the old publication is untouched');
  assert.equal(hostRow(f.ledgerPath, 'host.stopped'), null, 'no stop ran: the old incarnation is still serving');
});

test('306a-e: the four refusals are typed and drawn before any effect', async (t) => {
  const f = world('e');
  let stubs = 0;
  let stub = null;
  const { deployment, driver } = await resident(t, f, {
    onSpawn: (spec) => { stubs += 1; stub = new StubSuccessor(spec); return stub; },
  });
  await deployment.host();
  const refusalOf = async (thunk) => { try { await thunk(); return null; } catch (error) { return error; } };

  // 1. the target is the commit this resident already serves.
  const same = await refusalOf(() => deployment.reincarnate({ target: f.landing }));
  assert.equal(same.code, REINCARNATION_REFUSALS.sameCommit,
    `the served commit refuses as already-served: ${JSON.stringify(same?.detail)}`);
  assert.equal(same.detail.target.sha, f.landing);

  // 2. an unreachable target (no such ref, and no remote to fetch it from).
  const unreachable = await refusalOf(() => deployment.reincarnate({ target: 'refs/heads/does-not-exist' }));
  assert.equal(unreachable.code, REINCARNATION_REFUSALS.targetUnreachable);
  assert.equal(unreachable.detail.target, 'refs/heads/does-not-exist');

  // 3. a live worker whose worktree IS the serving checkout: the checkout move would stomp it.
  const handle = { id: 'w-holder', status: 'working', turnInFlight: false, worktree: f.repo, taskId: 'task-holder' };
  const realList = driver.coordinator.list.bind(driver.coordinator);
  driver.coordinator.list = () => [...realList(), handle];
  const held = await refusalOf(() => deployment.reincarnate({ target: f.base }));
  assert.equal(held.code, REINCARNATION_REFUSALS.checkoutHeld);
  assert.deepEqual(held.detail.holders, ['w-holder']);
  driver.coordinator.list = realList;

  // 4. a handoff already in flight refuses a second request, naming the successor it waits on.
  const pending = deployment.reincarnate({ target: f.base }).catch((error) => error);
  await until(() => stubs === 1, { label: 'the first successor spawn' });
  const second = await refusalOf(() => deployment.reincarnate({ target: f.base }));
  assert.equal(second.code, REINCARNATION_REFUSALS.inFlight);
  assert.ok(Number.isSafeInteger(second.detail.successorPid), JSON.stringify(second.detail));
  assert.ok(typeof second.detail.since === 'string');
  // The readiness wait has no deadline: the abandoned successor settles the handoff by dying.
  stub.crash({ code: 7, tail: 'the abandoned successor exits before publishing\n' });
  const failed = await pending;
  assert.equal(failed.code, 'reincarnation_failed', 'the abandoned handoff fails without a publication');
});

test('306a-e2: a target only the deployment remote holds is fetched, then resolved', async (t) => {
  const f = world('e2');
  // The target commit exists ONLY in the remote: it is pushed from a scratch clone, then pruned
  // from the served checkout's own object database.
  const remote = join(f.root, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  f.git(['remote', 'add', 'origin', remote]);
  f.git(['push', '-q', 'origin', 'HEAD:refs/heads/landing']);
  const scratch = join(f.root, 'scratch');
  execFileSync('git', ['clone', '-q', remote, scratch]);
  execFileSync('git', ['-C', scratch, 'config', 'user.email', 'issue306a@example.invalid']);
  execFileSync('git', ['-C', scratch, 'config', 'user.name', 'Issue306a']);
  writeFileSync(join(scratch, 'remote-only.txt'), 'remote only\n');
  execFileSync('git', ['-C', scratch, 'add', '.']);
  execFileSync('git', ['-C', scratch, 'commit', '-qm', 'remote only']);
  const remoteOnly = execFileSync('git', ['-C', scratch, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  execFileSync('git', ['-C', scratch, 'push', '-q', '--force', 'origin', 'HEAD:refs/heads/landing']);
  f.git(['reset', '-q', '--hard', f.base]);
  f.git(['reflog', 'expire', '--expire=now', '--all']);
  f.git(['gc', '-q', '--prune=now']);
  assert.throws(() => f.git(['cat-file', '-e', `${remoteOnly}^{commit}`]),
    'fixture invariant: the target is not resolvable in the served checkout yet');

  let stub = null;
  const { deployment } = await resident(t, f, {
    onSpawn: (spec) => { stub = new StubSuccessor(spec); stub.becomeReady(); return stub; },
  });
  await deployment.host();
  const receipt = await deployment.reincarnate({ target: remoteOnly });
  assert.equal(receipt.target.sha, remoteOnly, 'the unreachable target was fetched and resolved');
  void stub.openAndPublish(successorSelector(f, receipt.successor.incarnation));
  await deployment.close();
  assert.equal(selectorOf(f).incarnation, receipt.successor.incarnation);
});

test('306a-f: the reincarnation rows replay byte-identically through a reopened deployment', async (t) => {
  const f = world('f');
  let stub = null;
  const first = await resident(t, f, {
    onSpawn: (spec) => { stub = new StubSuccessor(spec); stub.becomeReady(); setTimeout(() => stub.standDown(), 250); return stub; },
  });
  await first.deployment.host();
  const pending = first.deployment.reincarnate({ target: f.base });
  await until(() => stub !== null, { label: 'the spawn' });
  const receipt = await pending;
  // The successor never publishes here (only the readiness marker exists), so the handoff FAILS at
  // its publication step: the old incarnation names it and RE-PUBLISHES (docs/48 §11 item 7), which
  // means the publication is still ITS — the withdrawal happens on the operator's own stop, never
  // at the handoff's. The rows the old wrote must replay byte-identically afterwards either way.
  const before = hostRows(f.ledgerPath).filter((row) => row.payload.kind === 'host.reincarnation_requested')
    .map((row) => JSON.stringify(row.payload));
  const failed = await until(() => hostRow(f.ledgerPath, 'host.reincarnation_failed'),
    { timeoutMs: WAIT_MS * 2, label: 'the durable publication_handoff failure row' });
  assert.equal(failed.payload.step, 'publication_handoff');
  assert.equal(existsSync(f.selectorPath), true,
    'the failed handoff withdrew nothing — the old incarnation re-published and keeps serving');
  await first.deployment.close();
  assert.equal(existsSync(f.selectorPath), false,
    'the old incarnation\'s own stop is what withdraws the publication it kept');

  const second = await resident(t, f);
  const replayed = hostRows(f.ledgerPath).map((row) => JSON.stringify(row.payload));
  for (const row of before) {
    assert.ok(replayed.includes(row), `the row did not replay byte-identically: ${row}`);
  }
  assert.equal(second.driver.coordination.startupStatus().state, 'ready',
    'the ledger carrying the new rows replays clean');
  assert.ok(receipt.successor.incarnation.length > 0);
});

test('306a-g: the two CLI spellings parse to the ONE reincarnation command', async () => {
  const target = 'a'.repeat(40);
  for (const argv of [['deployment', 'reincarnate', target], ['serve', '--reincarnate', target]]) {
    const parsed = parseBatonCli(argv);
    assert.deepEqual(
      { kind: parsed.kind, name: parsed.name, command: parsed.command, args: parsed.args },
      { kind: 'command', name: 'deployment.reincarnate', command: 'deployment.reincarnate', args: { target } },
      `baton ${argv.join(' ')} must resolve to the one reincarnation command`,
    );
  }
  // The verb's own help row teaches both spellings and names its closed refusal set.
  const help = batonCliHelp('deployment');
  assert.match(help, /baton deployment reincarnate <commit-ish>/u);
  assert.match(help, /baton serve --reincarnate <commit-ish>/u);
  for (const code of Object.values(REINCARNATION_REFUSALS)) assert.match(help, new RegExp(code, 'u'));
  // A target that is really a flag is refused at parse, never handed to git.
  assert.throws(() => parseBatonCli(['deployment', 'reincarnate', '--force']),
    (error) => error.code === 'cli_command_unavailable' || error.code === 'cli_invalid');
  assert.throws(() => parseBatonCli(['serve', '--reincarnate']), (error) => error.code === 'cli_invalid');
});

test('306a-h: the application verb needs the owner or a lifecycle authority, and a hosted deployment', async () => {
  const reincarnate = BatonApplication.prototype.reincarnate;
  const calls = [];
  const hosted = { reincarnationAuthority: { verb: (request) => { calls.push(request); return { state: 'reincarnating', target: request.target }; } } };
  // The resident's own web session: the lifecycle capability the host issues (emergency_stop), the
  // same class application.shutdown requires — this is the caller the CLI is.
  const webContext = {
    transport: 'web', requestId: 'request-1', idempotencyKey: 'key-1',
    capabilityAuthority: northboundCapabilityToken('web'), capabilities: ['control', 'emergency_stop'],
  };
  const receipt = await reincarnate.call(hosted, { target: 'deadbeef' }, { principalId: 'local-owner' }, null);
  assert.equal(receipt.state, 'reincarnating');
  assert.deepEqual(calls, [{ target: 'deadbeef' }], 'the owner reaches the deployment verb');
  await reincarnate.call(hosted, { target: 'deadbeef' }, { principalId: 'service-audit' }, null);
  await reincarnate.call(hosted, { target: 'deadbeef' }, { principalId: 'swarm-native:alpha' }, webContext);
  assert.equal(calls.length, 3, 'the resident session (a lifecycle capability) reaches it too');
  // A seat holding observe alone is refused typed, before the deployment sees anything.
  await assert.rejects(async () => reincarnate.call(hosted, { target: 'deadbeef' },
    { principalId: 'swarm-native:alpha' },
    { ...webContext, capabilities: ['observe'] }),
  (error) => error.code === 'application_unauthorized');
  assert.equal(calls.length, 3, 'a refused caller never reaches the deployment');
  // A deployment that hosts no resident (no verb installed) refuses typed, never silently.
  await assert.rejects(async () => reincarnate.call({}, { target: 'deadbeef' }, { principalId: 'local-owner' }, null),
    (error) => error.code === 'reincarnation_unavailable');
});
