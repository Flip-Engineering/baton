import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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

function run(file, parent) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [RUNNER, file], {
      cwd: IMPL,
      env: runnerEnv(parent),
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
    assert.ok(result.code !== 0 || result.signal !== null);
    assert.equal(pidAlive(descendantPid), false);
    assert.deepEqual(suiteRoots(parent), []);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
