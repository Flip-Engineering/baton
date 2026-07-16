import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  MockAdapter, createDriver, defaultVerificationRuntime, prepareVerificationRuntime, verify,
} from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase69-${name}-`));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sandbox(name) {
  const dir = root(name);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runtime() {
  return prepareVerificationRuntime({
    schemaVersion: 1,
    pathEntries: [dirname(process.execPath)],
    constants: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
}

function verification(arguments_, overrides = {}) {
  return {
    command: 'node', arguments: arguments_, cwd: '.',
    envAllowlist: ['LANG', 'LC_ALL', 'PATH', 'TZ'], expectExit: 0,
    expectResult: 'exit_code', timeoutMs: 5_000, maxOutputBytes: 64 * 1024,
    requiredPredecessorEvidence: [], ...overrides,
  };
}

function task(contract) {
  return { id: 'phase69-task', workerWorktreeDir: '/private/non-verifier-worker', verification: contract };
}

const result = { verification: { claimedExit: null } };

test('VR1: prepared verifier runtime ignores ambient PATH/HOME and exposes only Plan-allowed deployment constants', async (t) => {
  const candidate = sandbox('runtime');
  t.after(candidate.cleanup);
  const prepared = runtime();
  assert.equal(prepared.environment.PATH, dirname(process.execPath));
  assert.equal(Object.hasOwn(prepared.environment, 'HOME'), false);
  assert.match(prepared.digest, /^[a-f0-9]{64}$/u);

  const priorPath = process.env.PATH;
  const priorHome = process.env.HOME;
  process.env.PATH = '/ambient/worker/shims';
  process.env.HOME = '/ambient/user/home';
  t.after(() => { process.env.PATH = priorPath; process.env.HOME = priorHome; });

  const contract = verification(['-e', [
    `if (process.env.PATH !== ${JSON.stringify(dirname(process.execPath))}) process.exit(21);`,
    "if (Object.hasOwn(process.env, 'HOME')) process.exit(22);",
    "if (process.env.LANG !== 'C' || process.env.LC_ALL !== 'C' || process.env.TZ !== 'UTC') process.exit(23);",
  ].join(' ')]);
  const verdict = await verify(task(contract), result, candidate, { runtime: prepared });
  assert.equal(verdict.passed, true);
  assert.equal(verdict.outcome, 'passed');
  assert.equal(verdict.execution.state, 'completed');
  assert.equal(verdict.runtimeDigest, prepared.digest);
});

test('VR1: default verifier runtime excludes user shims, relative entries, HOME, and the ambient PATH value', () => {
  const prepared = defaultVerificationRuntime();
  assert.equal(prepared.environment.PATH.split(':').includes(dirname(process.execPath)), true);
  assert.equal(prepared.environment.PATH.includes('.asdf/shims'), false);
  assert.equal(prepared.environment.PATH.split(':').some((entry) => entry === '' || !entry.startsWith('/')), false);
  assert.equal(Object.hasOwn(prepared.environment, 'HOME'), false);
  assert.notEqual(prepared.environment.PATH, process.env.PATH);
});

test('VR1: verifier runtime policy is closed and rejects unsafe values instead of filtering them', () => {
  const nodeDir = dirname(process.execPath);
  const invalid = [
    { schemaVersion: 1, pathEntries: [], constants: {} },
    { schemaVersion: 1, pathEntries: [nodeDir, nodeDir], constants: {} },
    { schemaVersion: 1, pathEntries: [nodeDir], constants: {}, extra: true },
    { schemaVersion: 1, pathEntries: [nodeDir], constants: { HOME: '/ambient' } },
    { schemaVersion: 1, pathEntries: [nodeDir], constants: { API_KEY: 'secret' } },
    { schemaVersion: 1, pathEntries: [nodeDir], constants: { mixedCase: 'value' } },
    { schemaVersion: 1, pathEntries: [nodeDir], constants: { LANG: 1 } },
  ];
  for (const policy of invalid) {
    assert.throws(() => prepareVerificationRuntime(policy), /closed deployment policy/);
  }
});

test('VR1: coverage and mutation subprocesses use the same closed runtime as the main check', async (t) => {
  const candidate = sandbox('auxiliary-runtime');
  t.after(candidate.cleanup);
  const prepared = runtime();
  const requiredPath = JSON.stringify(prepared.environment.PATH);
  const coverageScript = `(process.env.HOME ? process.exit(71) : process.env.PATH === ${requiredPath} ? console.log(JSON.stringify({ files: { 'x.js': { executedLines: [1] } } })) : process.exit(71))`;
  const mutationScript = `(process.env.HOME ? process.exit(72) : process.env.PATH === ${requiredPath} ? console.log(JSON.stringify({ killed: 1, total: 1, survived: [] })) : process.exit(72))`;
  const contract = verification(['-e', 'process.exit(0)'], {
    coverageCommand: `node -e "${coverageScript}"`,
    mutationCommand: `node -e "${mutationScript}"`,
  });
  const priorPath = process.env.PATH;
  const priorHome = process.env.HOME;
  process.env.PATH = '/ambient/worker/shims';
  process.env.HOME = '/ambient/user/home';
  t.after(() => { process.env.PATH = priorPath; process.env.HOME = priorHome; });

  const verdict = await verify({ ...task(contract), changedLines: { 'x.js': [1] } }, result, candidate, { runtime: prepared });
  assert.equal(verdict.passed, true);
  assert.equal(verdict.coverageOfChange, true);
  assert.equal(verdict.mutationPassed, true);
});

test('VR1: createDriver prepares one deployment runtime and propagates it to every referee attempt', async (t) => {
  const repository = repo();
  const logDir = root('driver-runtime-log');
  const binDir = root('driver-runtime-bin');
  symlinkSync(process.execPath, join(binDir, 'node'));
  t.after(() => {
    rmSync(repository, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  });
  const policy = { schemaVersion: 1, pathEntries: [binDir], constants: { LANG: 'C' } };
  const expectedDigest = prepareVerificationRuntime(policy).digest;
  const adapter = new MockAdapter({
    scenario: { outcome: 'failed', forgeSuccess: true, edits: [{ path: 'candidate.txt', content: 'candidate\n' }] },
    card: { harness: 'mock', version: '1.0.0' },
  });
  const driver = createDriver({ repoRoot: repository, logDir, adapters: { mock: adapter }, verificationRuntime: policy });
  t.after(async () => { await driver.drainAndClose('phase69-driver-runtime').catch(() => {}); });

  policy.pathEntries[0] = '/ambient/policy-mutation';
  const priorPath = process.env.PATH;
  const priorHome = process.env.HOME;
  process.env.PATH = '/usr/bin:/bin';
  process.env.HOME = '/ambient/user/home';
  t.after(() => { process.env.PATH = priorPath; process.env.HOME = priorHome; });
  const brief = {
    goal: 'prove deployment runtime propagation', constraints: [], pathScope: [],
    definitionOfDone: 'the closed verifier completes',
    verification: verification(['-e', `process.exit(process.env.PATH === ${JSON.stringify(binDir)} && !process.env.HOME ? 0 : 91)`]),
    budget: { tokens: 10_000, usd: 1, wallMin: 5 },
  };
  for (const taskId of ['phase69-runtime-a', 'phase69-runtime-b']) {
    const handle = await driver.coordinator.spawn('mock', brief, { taskId, taskType: 'general' });
    let outcome;
    for (let attempt = 0; attempt < 500; attempt += 1) {
      outcome = await driver.coordinator.result(handle.id);
      if (outcome.ready) break;
      await sleep(10);
    }
    assert.equal(outcome?.status, 'completed', JSON.stringify(outcome));
    assert.equal(outcome.verdict.runtimeDigest, expectedDigest);
  }
});

test('VR2: spawn refusal, timeout, and output overflow are typed inconclusive execution dispositions', async (t) => {
  const candidate = sandbox('execution');
  t.after(candidate.cleanup);
  const prepared = runtime();
  const cases = [
    {
      contract: { ...verification([]), command: 'baton-verifier-command-that-does-not-exist' },
      state: 'unavailable', code: 'verification_spawn_unavailable',
    },
    {
      contract: verification(['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 30 }),
      state: 'timed_out', code: 'verification_timed_out',
    },
    {
      contract: verification(['-e', "process.stdout.write('x'.repeat(128))"], { maxOutputBytes: 64 }),
      state: 'output_exceeded', code: 'verification_output_exceeded',
    },
  ];
  for (const row of cases) {
    const verdict = await verify(task(row.contract), result, candidate, { runtime: prepared });
    assert.equal(verdict.outcome, 'inconclusive');
    assert.equal(verdict.failureOwnership, 'verifier');
    assert.deepEqual(verdict.execution, { state: row.state, code: row.code });
    assert.equal(verdict.passed, false);
    assert.equal(verdict.reverified, false);
  }
});

test('VR3: a passing base owns a candidate failure; a failing base leaves ownership unresolved', async (t) => {
  const candidate = sandbox('candidate');
  const passingBase = sandbox('base-pass');
  const failingBase = sandbox('base-fail');
  t.after(() => { candidate.cleanup(); passingBase.cleanup(); failingBase.cleanup(); });
  writeFileSync(join(passingBase.dir, 'baseline-ok'), 'ok');
  const contract = verification(['-e', "process.exit(require('node:fs').existsSync('baseline-ok') ? 0 : 1)"]);
  const prepared = runtime();

  const owned = await verify(task(contract), result, candidate, {
    runtime: prepared, baseSandbox: passingBase, classifyFailureOwnership: true,
  });
  assert.equal(owned.outcome, 'candidate_failed');
  assert.equal(owned.failureOwnership, 'candidate');
  assert.deepEqual(owned.baseExecution, { state: 'completed', code: 'verification_completed' });
  assert.equal(owned.baseExit, 0);

  const unresolved = await verify(task(contract), result, candidate, {
    runtime: prepared, baseSandbox: failingBase, classifyFailureOwnership: true,
  });
  assert.equal(unresolved.outcome, 'inconclusive');
  assert.equal(unresolved.failureOwnership, 'baseline_or_environment');
  assert.deepEqual(unresolved.baseExecution, { state: 'completed', code: 'verification_completed' });
  assert.equal(unresolved.baseExit, 1);
});

function repo() {
  const dir = root('repo');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'phase69@example.invalid'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Phase 69'], { cwd: dir });
  writeFileSync(join(dir, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: dir });
  return dir;
}

test('VR4/VR5: an inconclusive live gate checkpoints the commit without teaching a route loss or promoting a counterexample', async (t) => {
  const repository = repo();
  const logDir = root('log');
  t.after(() => { rmSync(repository, { recursive: true, force: true }); rmSync(logDir, { recursive: true, force: true }); });
  const adapter = new MockAdapter({
    scenario: { outcome: 'failed', forgeSuccess: true, edits: [{ path: 'candidate.txt', content: 'candidate\n' }] },
    card: { harness: 'mock', version: '1.0.0' },
  });
  const driver = createDriver({ repoRoot: repository, logDir, adapters: { mock: adapter } });
  t.after(async () => { await driver.drainAndClose('phase69-test').catch(() => {}); });
  const brief = {
    goal: 'produce a candidate whose pinned baseline check is unavailable', constraints: [], pathScope: [],
    definitionOfDone: 'done.txt exists', verification: { command: 'test -f done.txt', expectExit: 0 },
    budget: { tokens: 10_000, usd: 1, wallMin: 5 },
  };
  const handle = await driver.coordinator.spawn('mock', brief, { taskId: 'phase69-inconclusive', taskType: 'general' });
  let outcome;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    outcome = await driver.coordinator.result(handle.id);
    if (outcome.ready) break;
    await sleep(10);
  }
  assert.equal(outcome?.ready, true);
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.verdict.outcome, 'inconclusive');
  assert.equal(outcome.checkpoint.state, 'pinned');
  assert.equal(outcome.checkpoint.sha, outcome.capturedSha);
  assert.match(outcome.checkpoint.ref, /^refs\/baton\/checkpoints\/[a-f0-9]{40}$/u);
  assert.equal(execFileSync('git', ['rev-parse', '--verify', `${outcome.checkpoint.ref}^{commit}`], { cwd: repository, encoding: 'utf8' }).trim(), outcome.capturedSha);
  assert.equal(outcome.retainedResultRef, null, 'a checkpoint is never an accepted result ref');
  assert.equal(driver.router.getStat(outcome.routeKey, 'general'), null, 'unresolved verification cannot teach a route loss');
  assert.equal(driver.coordination.queryKnowledge({ types: ['Counterexample'] }).some((node) => node.taskId === 'phase69-inconclusive'), false);
  assert.equal(driver.coordination.queryKnowledge({ types: ['Question'] }).some((node) => node.taskId === 'phase69-inconclusive'), true);

  await driver.drainAndClose('phase69-replay');
  const replay = createDriver({ repoRoot: repository, logDir, adapters: { mock: adapter } });
  t.after(async () => { await replay.drainAndClose('phase69-replay-cleanup').catch(() => {}); });
  const replayed = await replay.coordinator.result(handle.id);
  assert.equal(replayed.ready, true);
  assert.deepEqual(replayed.checkpoint, outcome.checkpoint, 'restart must restore the exact checkpoint authority');
  assert.equal(replay.log.read(handle.id).filter((event) => event.kind === 'verify.reverified').length, 1, 'replay must not create another verification attempt');
  assert.equal(execFileSync('git', ['rev-parse', '--verify', `${replayed.checkpoint.ref}^{commit}`], { cwd: repository, encoding: 'utf8' }).trim(), outcome.capturedSha);
});
