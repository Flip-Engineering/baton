import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const IMPL = resolve(import.meta.dirname, '..');
const RUNNER = join(IMPL, 'scripts', 'run-suite.mjs');

function fixture(source) {
  const parent = mkdtempSync(join(tmpdir(), 'baton-test-runner-contract-'));
  const file = join(parent, 'child.test.mjs');
  writeFileSync(file, source);
  return { parent, file };
}

function suiteRoots(parent) {
  return readdirSync(parent).filter((name) => name.startsWith('baton-suite-'));
}

function runnerEnv(parent) {
  const env = { ...process.env, BATON_TEST_TMP_PARENT: parent };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function run(file, parent, env = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [RUNNER, file], {
      cwd: IMPL,
      env: { ...runnerEnv(parent), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectRun);
    child.once('close', (code, signal) => resolveRun({ code, signal, stdout, stderr }));
  });
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error('timed out waiting for nested test marker');
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processStatus(pid) {
  return spawnSync('ps', ['-o', 'pid=,ppid=,pgid=,state=,command=', '-p', String(pid)], {
    encoding: 'utf8',
  }).stdout.trim();
}

test('TF1/TF2/TF3: a passing nested suite reaps only its owned fixture root', async () => {
  const { parent, file } = fixture(`
    import { mkdirSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import test from 'node:test';
    test('leaves a fixture', () => mkdirSync(join(tmpdir(), 'left-behind')));
  `);
  const sibling = join(parent, 'keep-me');
  mkdirSync(sibling);
  try {
    const result = await run(file, parent);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.deepEqual(suiteRoots(parent), []);
    assert.equal(existsSync(sibling), true);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('TF2/TF3: a failing nested suite stays failed and still reaps its fixture root', async () => {
  const { parent, file } = fixture(`
    import { mkdirSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import test from 'node:test';
    test('fails after leaking', () => { mkdirSync(join(tmpdir(), 'left-behind')); throw new Error('expected failure'); });
  `);
  try {
    const result = await run(file, parent);
    assert.notEqual(result.code, 0);
    assert.deepEqual(suiteRoots(parent), []);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('TF2/TF3: SIGTERM stops a hanging nested suite and reaps its fixture root', async () => {
  const { parent, file } = fixture(`
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import test from 'node:test';
    test('hangs with a descendant', async () => {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      writeFileSync(join(tmpdir(), 'ready'), String(child.pid));
      await new Promise(() => {});
    });
  `);
  try {
    const child = spawn(process.execPath, [RUNNER, file], {
      cwd: IMPL,
      env: runnerEnv(parent),
      stdio: 'ignore',
    });
    await waitFor(() => suiteRoots(parent).some((name) => existsSync(join(parent, name, 'ready'))));
    const root = suiteRoots(parent)[0];
    const descendantPid = Number(readFileSync(join(parent, root, 'ready'), 'utf8'));
    assert.equal(pidAlive(descendantPid), true);
    child.kill('SIGTERM');
    const result = await new Promise((resolveRun, rejectRun) => {
      child.once('error', rejectRun);
      child.once('close', (code, signal) => resolveRun({ code, signal }));
    });
    assert.deepEqual(result, { code: 143, signal: null });
    assert.equal(
      pidAlive(descendantPid),
      false,
      processStatus(descendantPid) || `PID ${descendantPid} remained alive after runner close`,
    );
    assert.deepEqual(suiteRoots(parent), []);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('#521: a file that stops reporting is reaped by its own progress deadline and named hung', async () => {
  // The per-file progress deadline (BATON_SUITE_IDLE_MS, run-suite.mjs runFile) is the runner's ONE
  // lane-liveness bound: a file that stops emitting is reaped and the verdict reports it as hung.
  // The reaped file's hung row reddens the verdict through that bound (#521).
  const { parent, file } = fixture(`
    import test from 'node:test';
    test('reports before the file stops reporting', () => {});
    test('never settles and holds the file open', () => new Promise(() => {}));
    setInterval(() => {}, 1_000);
  `);
  const verdictPath = join(parent, 'verdict.json');
  try {
    const result = await run(file, parent, {
      BATON_SUITE_IDLE_MS: '400',
      BATON_SUITE_VERDICT_FILE: verdictPath,
      BATON_HOST_CAPACITY_DISABLED: '1',
    });
    assert.equal(result.code, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /# file .*HUNG\)/u, 'the run names the file its deadline reaped');
    assert.match(result.stderr, /1 hung/u, 'the verdict counts the reaped file as hung');
    const document = JSON.parse(readFileSync(verdictPath, 'utf8'));
    assert.equal(document.green, false);
    assert.equal(document.hung.length, 1, 'the hung dimension names the file the deadline reaped');
    const idle = /no test event for (\d+) ms/u.exec(document.hung[0]);
    assert.ok(idle, `the hung row names the idle it observed: ${document.hung[0]}`);
    assert.ok(Number(idle[1]) >= 400, `the row names the bound this run configured: ${document.hung[0]}`);
    assert.equal(Object.hasOwn(document, 'stalled'), false, 'no lane dimension is claimed (#521)');
    assert.deepEqual(suiteRoots(parent), [], 'the reaped file leaves no fixture root behind');
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
