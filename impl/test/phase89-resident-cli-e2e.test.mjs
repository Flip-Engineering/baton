import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { connectBaton } from '../src/index.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/baton.mjs', import.meta.url));

function repository(t) {
  const root = mkdtempSync('/tmp/bt89-serve-repo-');
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
  const home = mkdtempSync('/tmp/bt89-serve-home-');
  const configRoot = mkdtempSync('/tmp/bt89-serve-config-');
  t.after(() => rmSync(home, { recursive: true, force: true }));
  t.after(() => rmSync(configRoot, { recursive: true, force: true }));
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: configRoot };
  const child = spawn(process.execPath, [SCRIPT, 'serve'], {
    cwd: repo, env, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
    if (stderr.length > 256 * 1024) child.kill('SIGKILL');
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
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
