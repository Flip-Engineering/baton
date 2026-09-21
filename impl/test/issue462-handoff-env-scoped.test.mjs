// Issue #462 — the handoff declaration is a fact about ONE process.
//
// OBSERVED (lane ds-461 on the primary, 2026-09-18): the primary was reincarnated (#306) and the
// successor was spawned with `BATON_INCARNATION` / `BATON_PREDECESSOR_*` in its environment. Every
// worker the successor recruited inherited that environment. Six keep-green rows then failed
// identically on the lane and at the base while those variables were set — issue306-reincarnation-red
// §2.1/§2.5/§2.8, issue351-resident-shutdown RS2/RS4, issue351-startup-answer SA2 — and passed with
// them scrubbed, because a fixture that opens a BatonDeployment in-process read the SEAT's ambient
// declaration and opened as a phantom successor of a predecessor that does not exist in its temp
// root. The declaration is a fact about the incarnation `deployment.reincarnate` started, never
// about the processes that incarnation spawns: a worker seat, a #459 supervised gate run, a
// regenerator, a seat's own nested `baton serve`, or an in-process deployment a fixture opens.
//
// The landed rule, and the row that pins it:
//   462-A/462-B — the successor CONSUMES the declaration at open: the keys leave `process.env` in
//       the same act they are read into its incarnation state (the readiness marker, the identity
//       it publishes), and a malformed declaration is consumed all the same — absence for identity,
//       never a fact for the children;
//   462-C — the seam that builds worker environments (the runtime's baseEnv, taken once at open and
//       filtered into every seat env) hands none of the closed list through;
//   462-D/462-E — the OLD incarnation still MINTS the closed list for the successor it spawns, and
//       mint side and consume side read ONE list (`REINCARNATION_HANDOFF_ENV_KEYS`), never two that
//       can drift: a successor that reincarnates again hands the NEXT successor its OWN declaration,
//       never the one it was spawned into;
//   462-F — the six rows above run green in the environment a reincarnated resident's seat inherits.
//
// Why 462-F inherits the SUCCESSOR's own environment instead of injecting the keys into the child by
// hand: a process whose ambient environment carries the declaration IS a handoff successor by #306's
// own rule — that is the bug's premise, not its fix. Injecting the keys into a child reproduces the
// phantom-open every time (measured after this change too: `BATON_INCARNATION=… node --test
// test/issue351-startup-answer.test.mjs` still fails SA2, because the fixture's own `baton serve`
// child is then genuinely spawned into a declaration). What the fix owns is the source: a child of
// the successor — a seat, a #459 gate run, a regenerator — inherits an environment without it, and
// the six rows are the observers that were red inside a reincarnated resident's seat.
//
// Hermetic: temp dirs under os.tmpdir() only; no network, no provider, no host CLI.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MockAdapter, createDriver } from '../src/index.mjs';
import {
  REINCARNATION_HANDOFF_ENV_KEYS, consumeReincarnationHandoff, openBatonDeployment,
  reincarnationMarkerPath, withoutReincarnationHandoff,
} from '../src/application-deployment.mjs';

const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const WAIT_MS = 4_000;
const IMPL_DIR = fileURLToPath(new URL('..', import.meta.url));

/** The declaration a reincarnated resident's seat carries at HEAD — one predecessor incarnation,
 * one incarnation the old minted for this process, the commit it served and the target it serves.
 * The pid names a process that is always alive (init), so nothing in these rows depends on a
 * predecessor's death. */
const DECLARATION = Object.freeze({
  BATON_INCARNATION: 'instance-462-seat',
  BATON_PREDECESSOR_INCARNATION: 'instance-462-predecessor',
  BATON_PREDECESSOR_PID: '1',
  BATON_PREDECESSOR_COMMIT: '0'.repeat(40),
  BATON_REINCARNATION_TARGET: '1'.repeat(40),
});

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
  const root = realpathSync(mkdtempSync(join(tmpdir(), `bt462-${label}-`)));
  roots.push(root);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [repo, home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  // The predecessor's own resident directory: a successor opens over the SAME deployment root, so
  // the directory the readiness marker lands in already exists — the marker write is best-effort
  // by construction and would otherwise be swallowed.
  mkdirSync(join(deploymentRoot, 'resident'), { recursive: true });
  const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git(['init', '-q']);
  git(['config', 'user.email', 'issue462@example.invalid']);
  git(['config', 'user.name', 'Issue462']);
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
  return { root, repo, home, configRoot, deploymentRoot, base, landing, git };
}
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

/** Run `body` with the handoff declaration in the ambient environment, restoring whatever the
 * environment held before (a lane running inside a real seat may carry its own). */
async function withDeclaration(body) {
  const previous = new Map(REINCARNATION_HANDOFF_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(DECLARATION)) process.env[key] = value;
  try {
    return await body();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** The exact adapter card the ordinary resident self-check requires (the issue351/issue306a
 * fixture card), so a hosted row publishes as a real deployment would. */
function adapter() {
  const value = new MockAdapter({
    harness: ROUTE.harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'issue462 fixture', files: {} },
  });
  const rawCard = value.card.bind(value);
  value.card = () => ({ ...rawCard(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: { schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], configuredPreferences: [], observation: 'unavailable' } },
    modelSelection: { mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: ROUTE.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'issue462-handoff-env-scoped', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}

/** One open deployment over the fixture world. `onSpawn` injects the successor spawner, the way
 * issue306a drives a whole handoff without a second resident. */
async function openFixture(t, f, { onSpawn = null, waitMs = WAIT_MS } = {}) {
  const adapters = { [ROUTE.harness]: adapter() };
  let driver = null;
  const deployment = await openBatonDeployment({
    repo: f.repo,
    advanced: {
      deploymentRoot: f.deploymentRoot,
      adapters,
      routes: [ROUTE],
      verification: { command: 'node', arguments: ['--version'] },
      resident: {
        env: { XDG_CONFIG_HOME: f.configRoot, HOME: f.home },
        home: f.home,
        webDrainMs: 500,
        sessionTtlMs: 60_000,
        reincarnationWaitMs: waitMs,
        ...(onSpawn ? { spawnSuccessor: onSpawn } : {}),
      },
    },
  }, (options) => { driver = createDriver(options); return driver; });
  t.after(async () => { try { await deployment.close(); } catch { /* the row already closed it */ } });
  return { deployment, driver, adapters };
}

/** The child the injected spawner hands back: the old's readiness wait reads the marker path, and
 * the exit event reaches the old directly — nothing else of a second resident is stood up. */
class StubSuccessor extends EventEmitter {
  static nextPid = 46_200;
  constructor(spec) {
    super();
    this.spec = spec;
    this.pid = StubSuccessor.nextPid += 1;
    this.stderr = new EventEmitter();
  }
  becomeReady() {
    writeFileSync(this.spec.markerPath, `${JSON.stringify({ schemaVersion: 1, state: 'waiting' })}\n`);
  }
}

const markerOf = (f, incarnation) => reincarnationMarkerPath(f.deploymentRoot, incarnation);
const readMarker = (path) => JSON.parse(readFileSync(path, 'utf8'));

// ── (a) the successor consumes the declaration: it leaves process.env and lands in its state ────

test('462-A: a deployment opened with the declaration consumes it — out of process.env, into the incarnation state', async (t) => {
  const f = world('consume');
  await withDeclaration(async () => {
    await openFixture(t, f);
    assert.deepEqual([...REINCARNATION_HANDOFF_ENV_KEYS].sort(), Object.keys(DECLARATION).sort(),
      'the closed list IS the declaration the old mints — the spec and the consumer read one list');
    for (const key of REINCARNATION_HANDOFF_ENV_KEYS) {
      assert.equal(process.env[key], undefined,
        `the successor consumed ${key}: it is a fact about ONE process, and this process is done reading it`);
    }
  });

  // The same act READ the keys into the deployment's own incarnation state: its readiness marker
  // (the successor's first act, written before the open blocks on the leases) names them.
  const marker = readMarker(markerOf(f, DECLARATION.BATON_INCARNATION));
  assert.equal(marker.incarnation, DECLARATION.BATON_INCARNATION,
    'the incarnation this process adopted is the one the old minted for it');
  assert.equal(marker.predecessor.incarnation, DECLARATION.BATON_PREDECESSOR_INCARNATION);
  assert.equal(marker.predecessor.commit, DECLARATION.BATON_PREDECESSOR_COMMIT);
  assert.equal(marker.target.sha, DECLARATION.BATON_REINCARNATION_TARGET);
  assert.equal(marker.pid, process.pid, 'and the marker names THIS process as the successor');
});

test('462-B: the consume is one act — a malformed declaration is consumed too, never left for the children', async (t) => {
  const f = world('malformed');
  const env = { ...Object.fromEntries(REINCARNATION_HANDOFF_ENV_KEYS.map((key) => [key, DECLARATION[key]])),
    BATON_INCARNATION: 'not an incarnation id' };
  const handoff = consumeReincarnationHandoff(env, f.deploymentRoot);
  assert.equal(handoff, null, 'a malformed declaration is absence for identity, exactly as #306 has it');
  assert.deepEqual(env, {}, 'and it is consumed all the same — absence for identity, never a fact for the children');
  const copy = withoutReincarnationHandoff({ ...DECLARATION, KEPT: 'yes' });
  assert.deepEqual(copy, { KEPT: 'yes' },
    'the copy helper (the base every child environment is built from) drops the closed list and nothing else');
});

// ── (c) the seam that builds worker environments hands none of the keys through ─────────────────

test('462-C: a deployment opened with the declaration spawns a worker whose environment lacks every key in the closed list', async (t) => {
  const f = world('worker');
  const observed = {};
  let fixture = null;
  await withDeclaration(async () => {
    fixture = await openFixture(t, f);
    const adapterInstance = fixture.adapters[ROUTE.harness];
    const spawn = adapterInstance.spawn.bind(adapterInstance);
    adapterInstance.spawn = async (...args) => {
      // The runtime scope the coordinator created at the adapter's own spawn seam — the seat's
      // whole environment, read the way issue346 reads it.
      observed.env = { ...(args[2]?.env ?? {}) };
      return spawn(...args);
    };
    const run = await fixture.deployment.run('spawn one seat', {
      harness: ROUTE.harness, model: ROUTE.model, effort: ROUTE.effort,
    });
    await run.approve();
    await until(() => observed.env, { timeoutMs: 30_000, label: 'the worker spawn' });
  });

  assert.ok(fixture !== null && observed.env, 'the fixture spawned a seat');
  for (const key of REINCARNATION_HANDOFF_ENV_KEYS) {
    assert.equal(observed.env[key], undefined,
      `the worker seat's environment carries no ${key} — the declaration was never about this seat`);
  }
  assert.equal(typeof observed.env.HOME, 'string',
    'and the seat env is a real one (HOME projected), not an empty map that proves nothing');
  assert.notEqual(observed.env.HOME, process.env.HOME, 'the seat runs on its own projected HOME');
  if (process.env.BATON_TEST_SUITE_ROOT !== undefined) {
    assert.equal(observed.env.BATON_TEST_SUITE_ROOT, process.env.BATON_TEST_SUITE_ROOT,
      '#424: the ambient facts a seat legitimately inherits are still carried — the fix removes the '
      + 'handoff declaration alone');
  }
});

// ── (d) the old still MINTS the closed list, fresh — one list, both halves ───────────────────────

test('462-D: the old mints a fresh declaration for the successor it spawns — exactly the closed list', async (t) => {
  const f = world('mint');
  const specs = [];
  const { deployment } = await openFixture(t, f, {
    onSpawn: (spec) => { const stub = new StubSuccessor(spec); stub.becomeReady(); specs.push(spec); return stub; },
  });
  const published = await deployment.host();
  const receipt = await deployment.reincarnate({ target: f.base });
  assert.equal(specs.length, 1, 'the handoff spawned exactly one successor');
  const spec = specs[0];

  const carried = Object.keys(spec.env).filter((key) => REINCARNATION_HANDOFF_ENV_KEYS.includes(key)).sort();
  assert.deepEqual(carried, [...REINCARNATION_HANDOFF_ENV_KEYS].sort(),
    'the spec carries every key in the closed list — the mint side and the consume side are ONE list');
  assert.equal(spec.env.BATON_INCARNATION, receipt.successor.incarnation,
    'the incarnation the old minted for it, so host.successor_started can name the identity it publishes');
  assert.equal(spec.env.BATON_PREDECESSOR_INCARNATION, receipt.from.incarnation,
    'and the incarnation handing over is THIS one');
  assert.equal(spec.env.BATON_PREDECESSOR_PID, String(process.pid));
  assert.equal(spec.env.BATON_PREDECESSOR_COMMIT, f.landing,
    'the commit this incarnation serves — frozen at its open, and the successor is told which');
  assert.equal(receipt.from.commit, f.landing, 'the receipt and the row name the same commit');
  assert.equal(spec.env.BATON_REINCARNATION_TARGET, f.base, 'and the target the successor must serve');
  assert.equal(spec.env.BATON_INCARNATION === receipt.from.incarnation, false,
    'the successor is never handed the predecessor\'s own identity');
});

test('462-E: a reincarnated resident that reincarnates again hands the NEXT successor its OWN declaration', async (t) => {
  const f = world('nested');
  const specs = [];
  await withDeclaration(async () => {
    const { deployment } = await openFixture(t, f, {
      onSpawn: (spec) => { const stub = new StubSuccessor(spec); stub.becomeReady(); specs.push(spec); return stub; },
    });
    // This deployment WAS spawned into a handoff (the ambient declaration): it adopts the
    // incarnation the old minted, exactly as the successor half of #306 says.
    await deployment.host();
    await deployment.reincarnate({ target: f.base });
  });
  assert.equal(specs.length, 1);
  const spec = specs[0];
  assert.equal(spec.env.BATON_PREDECESSOR_INCARNATION, DECLARATION.BATON_INCARNATION,
    'the next successor\'s predecessor is THIS incarnation — the one it adopted — not the one this '
    + 'process was spawned into: the declaration is minted fresh, never inherited');
  assert.equal(spec.env.BATON_PREDECESSOR_INCARNATION === DECLARATION.BATON_PREDECESSOR_INCARNATION, false,
    'the ambient predecessor is not this incarnation and never rides another handoff');
  assert.deepEqual(Object.keys(spec.env).filter((key) => REINCARNATION_HANDOFF_ENV_KEYS.includes(key)).sort(),
    [...REINCARNATION_HANDOFF_ENV_KEYS].sort(), 'and the spec carries the closed list and nothing beside it');
});

// ── (e) the six rows, in the environment a reincarnated resident's seat inherits ─────────────────

test('462-F: the six keep-green rows run green in the environment a successor leaves its children', async (t) => {
  t.diagnostic('a child of a successor inherits the successor\'s environment — the seat, the #459 '
    + 'supervised gate run and the regenerator all build theirs over it; at HEAD it carried the '
    + 'declaration, and these six rows went red inside a reincarnated resident');
  const f = world('seat');
  let status = null;
  let stdout = '';
  let stderr = '';
  await withDeclaration(async () => {
    await openFixture(t, f);
    for (const key of REINCARNATION_HANDOFF_ENV_KEYS) {
      assert.equal(process.env[key], undefined,
        `${key} is gone from the parent, so the child inherits none of it`);
    }
    // The child's test context is this run's, never the caller's (the run-suite precedent): an
    // inherited NODE_TEST_CONTEXT would report the six rows into THIS runner and print nothing.
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    // ONE row at a time: each of the six starts a real resident and bounds its own handoff at a
    // few seconds, so running them concurrently turns the host's load into their failures (the
    // suite's own lane law: a file that spawns real processes runs with --test-concurrency=1).
    // The assertions below read TAP's count lines (`# pass 6`, `not ok N - ...`). Node 25's
    // default reporter is spec, which prints `ℹ pass 6` and no line those assertions match; the
    // child therefore names the reporter its reader reads, as run-suite.mjs names its own.
    const child = spawnSync(process.execPath, [
      '--test',
      '--test-reporter=tap',
      '--test-concurrency=1',
      '--test-name-pattern', '§2\\.1|§2\\.5|§2\\.8|RS2|RS4|SA2',
      'test/issue306-reincarnation-red.test.mjs',
      'test/issue351-resident-shutdown.test.mjs',
      'test/issue351-startup-answer.test.mjs',
    ], { cwd: IMPL_DIR, env: childEnv, encoding: 'utf8', timeout: 300_000 });
    status = child.status;
    stdout = child.stdout ?? '';
    stderr = child.stderr ?? '';
  });
  assert.equal(status, 0,
    `the six rows pass in the seat's inherited environment:\n${stdout.slice(-4_000)}\n${stderr.slice(-4_000)}`);
  // A count that is not six names the rows that failed, out of the child's own output: a short
  // child must never read as a vacuous pass, and the failing row must be readable here.
  assert.match(stdout, /# pass 6/u, 'and all six ran — a pattern that selects none would pass vacuously'
    + `\n${(stdout.match(/^not ok \d+ - .*$/gmu) ?? ['(no failing row named)']).join('\n')}`
    + `\n${stdout.slice(-1_500)}`);
  assert.match(stdout, /§2\.1|§2\.5|§2\.8|RS2|RS4|SA2/u, 'the six named rows are the ones that ran');
});
