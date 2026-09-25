import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { connectBaton } from '../src/index.mjs';

import { spawnFixtureResident } from './fixtures/fixture-resident.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/baton.mjs', import.meta.url));

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'bt89-serve-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'phase89@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Phase 89'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    private: true, scripts: { test: 'node --test' },
  }));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test', 'smoke.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('smoke', () => assert.equal(1, 1));",
    '',
  ].join('\n'));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

async function until(predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

test('RLC1: baton serve is zero-assembly, connectable, signal-closeable, and secret-free', async (t) => {
  const repo = repository(t);
  const home = mkdtempSync(join(tmpdir(), 'bt89-serve-home-'));
  const configRoot = mkdtempSync(join(tmpdir(), 'bt89-serve-config-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  t.after(() => rmSync(configRoot, { recursive: true, force: true }));
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: configRoot };
  // Issue #471: the ONE fixture-resident spawn — the child declares THIS runner and is ended by
  // process group at the test's after-hook (and by the runner's death, however it dies).
  const child = spawnFixtureResident(t, {
    args: [SCRIPT, 'serve'],
    cwd: repo, env,
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
    if (stderr.length > 256 * 1024) child.kill('SIGKILL');
  });
  const selectorPath = join(repo, '.git', 'baton', 'connection.json');
  try {
    await until(() => existsSync(selectorPath) && stderr.includes('"state":"published"'),
      'published resident');
  } catch (error) {
    throw new Error(`${error.message}; child=${child.exitCode ?? 'running'}; stderr=${stderr.slice(-4_096)}`);
  }

  const selector = JSON.parse(readFileSync(selectorPath, 'utf8'));
  const tokenPath = join(configRoot, 'baton', 'connections', `${selector.profile}.token`);
  const token = readFileSync(tokenPath, 'utf8').trim();
  assert.equal(stderr.includes(token), false);
  assert.equal(stderr.includes('socketPath'), false);
  const connected = await connectBaton({ repo, advanced: { env, home } });
  assert.deepEqual((await connected.runs.list()).items, []);

  child.kill('SIGTERM');
  const exit = await new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  assert.deepEqual(exit, { code: 0, signal: null });
  assert.equal(existsSync(selectorPath), false);
  assert.equal(existsSync(tokenPath), false);
  assert.equal(stderr.includes(token), false);
  assert.match(stderr, /"state":"closed"/u);
});

test('P92-RLC2: CONFIG_MODULE accepts the same public deployment factory as ordinary serve', async (t) => {
  const repo = repository(t);
  const home = mkdtempSync(join(tmpdir(), 'bt92-serve-home-'));
  const configRoot = mkdtempSync(join(tmpdir(), 'bt92-serve-config-'));
  const moduleRoot = mkdtempSync(join(tmpdir(), 'bt92-serve-module-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  t.after(() => rmSync(configRoot, { recursive: true, force: true }));
  t.after(() => rmSync(moduleRoot, { recursive: true, force: true }));
  const modulePath = join(moduleRoot, 'deployment.mjs');
  const indexUrl = new URL('../src/index.mjs', import.meta.url).href;
  writeFileSync(modulePath, [
    `import { openBaton } from ${JSON.stringify(indexUrl)};`,
    'export const createBatonDeployment = () => openBaton({ repo: process.cwd() });',
    '',
  ].join('\n'));
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: configRoot };
  // Issue #471: the ONE fixture-resident spawn — the child declares THIS runner and is ended by
  // process group at the test's after-hook (and by the runner's death, however it dies).
  const child = spawnFixtureResident(t, {
    args: [SCRIPT, 'serve', modulePath],
    cwd: repo, env,
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  const selectorPath = join(repo, '.git', 'baton', 'connection.json');
  try {
    await until(() => existsSync(selectorPath) && stderr.includes('"state":"published"'),
      'configured deployment publication');
  } catch (error) {
    throw new Error(`${error.message}; child=${child.exitCode ?? 'running'}; stderr=${stderr.slice(-4_096)}`);
  }
  child.kill('SIGTERM');
  const exit = await new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  assert.deepEqual(exit, { code: 0, signal: null });
  assert.match(stderr, /"state":"closed"/u);
});
