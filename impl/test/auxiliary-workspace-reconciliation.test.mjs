import test from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { ensureBatonExcluded, freshVerifySandbox, listWorktrees, reconcile } from '../src/worktree.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-auxiliary-owner-'));
  const cleanups = [];
  t.after(async () => {
    try { for (const cleanup of cleanups.reverse()) await cleanup(); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q'); git('config', 'user.name', 'Baton test'); git('config', 'user.email', 'baton@example.invalid');
  writeFileSync(join(root, 'input.txt'), 'verification input\n');
  git('add', 'input.txt'); git('commit', '-qm', 'base');
  return { root, sha: git('rev-parse', 'HEAD'), cleanup: (operation) => cleanups.push(operation) };
}

test('another reconciliation preserves a live verifier cwd and reports unproven ownership', async (t) => {
  const { root, sha, cleanup } = fixture(t);
  const sandbox = await freshVerifySandbox(root, 'active-verifier', sha);
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import {readFileSync} from 'node:fs';
    process.on('message', () => process.send({input: readFileSync('input.txt', 'utf8')}));
    process.send({ready:true});
  `], { cwd: sandbox.dir, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const closed = once(child, 'close');
  cleanup(async () => { child.kill(); await closed; await sandbox.cleanup(); });
  assert.equal((await once(child, 'message'))[0].ready, true);
  const report = reconcile(root, []);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.removedVerifyDirs, []);
  assert.ok(report.diagnostics.some((row) => row.kind === 'verify' && row.retained && row.authority === 'unproven'));
  assert.equal(existsSync(sandbox.dir), true);
  const response = once(child, 'message');
  child.send('read again');
  assert.deepEqual((await response)[0], { input: 'verification input\n' });
});

test('repeated reconciliation preserves independent sandboxes and explicit cleanup remains exact', async (t) => {
  const { root, sha, cleanup } = fixture(t);
  const first = await freshVerifySandbox(root, 'first', sha);
  const sibling = await freshVerifySandbox(root, 'sibling', sha);
  cleanup(async () => { await first.cleanup(); await sibling.cleanup(); });
  for (const report of [reconcile(root, []), reconcile(root, [])]) {
    assert.deepEqual(report.errors, []);
    assert.equal(report.diagnostics.filter((row) => row.kind === 'verify').length, 2);
  }
  await first.cleanup();
  assert.equal(existsSync(first.dir), false);
  assert.equal(readFileSync(join(sibling.dir, 'input.txt'), 'utf8'), 'verification input\n');
  assert.equal(listWorktrees(root).some((row) => row.dir === sibling.dir), true);
  assert.deepEqual(reconcile(root, []).errors, []);
});

test('unattributed legacy candidates are retained without pretending another controller owns cleanup', (t) => {
  const { root } = fixture(t);
  const candidate = join(root, '.baton', 'integrate', 'legacy-candidate');
  mkdirSync(candidate, { recursive: true });
  writeFileSync(join(candidate, 'partial.txt'), 'useful partial merge');
  const report = reconcile(root, []);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.removedIntegrationDirs, []);
  assert.equal(readFileSync(join(candidate, 'partial.txt'), 'utf8'), 'useful partial merge');
  assert.ok(report.diagnostics.some((row) => row.path === candidate && row.retained && row.authority === 'unproven'));
});

test('retention never follows an unsafe auxiliary directory symlink', (t) => {
  const { root } = fixture(t);
  const outside = join(root, 'outside'); mkdirSync(outside);
  writeFileSync(join(outside, 'precious.txt'), 'untouched');
  const verify = join(root, '.baton', 'verify'); mkdirSync(verify, { recursive: true });
  symlinkSync(outside, join(verify, 'unsafe'));
  const report = reconcile(root, []);
  assert.ok(report.errors.some((error) => error.includes('verify/unsafe')));
  assert.equal(readFileSync(join(outside, 'precious.txt'), 'utf8'), 'untouched');
  assert.deepEqual(report.removedVerifyDirs, []);
});

for (const unsafe of [false, true]) {
  test(`concurrent auxiliary-root creation validates the winner (${unsafe ? 'symlink refused' : 'directory accepted'})`, async (t) => {
    const { root, sha, cleanup } = fixture(t);
    const verify = join(root, '.baton', 'verify');
    const outside = join(root, 'outside'); mkdirSync(outside);
    writeFileSync(join(outside, 'sentinel'), 'untouched');
    const original = fs.mkdirSync;
    let raced = false;
    fs.mkdirSync = (path, options) => {
      if (path === verify && !raced) {
        raced = true;
        if (unsafe) symlinkSync(outside, verify);
        else original(path, options);
        throw Object.assign(new Error('another creator won'), { code: 'EEXIST' });
      }
      return original(path, options);
    };
    syncBuiltinESMExports();
    try {
      if (unsafe) {
        await assert.rejects(freshVerifySandbox(root, 'race', sha), /not a confined directory/);
        assert.equal(readFileSync(join(outside, 'sentinel'), 'utf8'), 'untouched');
        assert.equal(listWorktrees(root).length, 0);
      } else {
        const sandbox = await freshVerifySandbox(root, 'race', sha);
        cleanup(() => sandbox.cleanup());
        assert.equal(readFileSync(join(sandbox.dir, 'input.txt'), 'utf8'), 'verification input\n');
      }
      assert.equal(raced, true);
    } finally {
      fs.mkdirSync = original;
      syncBuiltinESMExports();
    }
  });
}

test('a Finder metadata file in an auxiliary root is not a reconciliation error (#602)', (t) => {
  const { root } = fixture(t);
  const verify = join(root, '.baton', 'verify'); mkdirSync(verify, { recursive: true });
  writeFileSync(join(verify, '.DS_Store'), 'Finder junk');
  const report = reconcile(root, []);
  assert.deepEqual(report.errors, []);
  assert.equal(report.diagnostics.some((row) => typeof row.path === 'string' && row.path.endsWith('.DS_Store')), false);
});

test('ensureBatonExcluded hides Finder metadata inside a linked seat checkout (#602)', (t) => {
  const { root, sha } = fixture(t);
  ensureBatonExcluded(root);
  const seat = join(root, '.baton', 'wt', 'ws-finder');
  mkdirSync(dirname(seat), { recursive: true });
  execFileSync('git', ['worktree', 'add', '--detach', seat, sha], { cwd: root, stdio: 'ignore' });
  writeFileSync(join(seat, '.DS_Store'), 'Finder junk');
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: seat, encoding: 'utf8' });
  assert.equal(status.trim(), '');
  ensureBatonExcluded(root);
  const exclude = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8');
  assert.ok(exclude.split('\n').includes('.baton/'));
  assert.ok(exclude.split('\n').includes('.DS_Store'));
});
