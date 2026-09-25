// Deployment startup opens one repository from several processes at once. The capacity
// integrity key root must be created exactly once and every successful caller must observe
// the same 32-byte key, while pre-existing files, symlinks, escaping roots, and malformed
// keys stay refused. The multi-process cases drive the create critical sections through a
// cross-process barrier so the interleaving is deterministic instead of timing-dependent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync,
  statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadOrCreateWorktreeCapacityIntegrityKey } from '../src/worktree-capacity.mjs';

const SOURCE_URL = new URL('../src/worktree-capacity.mjs', import.meta.url).href;
const REFUSAL_CODE = 'worktree_capacity_unavailable';

function repoWorld(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-capacity-init-${label}-`));
  const repo = join(dir, 'repo');
  mkdirSync(repo, { mode: 0o700 });
  const baton = join(repo, '.baton');
  const capacity = join(baton, 'capacity');
  return { dir, repo, baton, capacity, keyPath: join(capacity, 'integrity.key') };
}

function refuses(action) {
  assert.throws(action, (error) => {
    assert.equal(error?.name, 'WorktreeCapacityError');
    assert.equal(error?.code, REFUSAL_CODE);
    return true;
  });
}

function childSource() {
  return `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { loadOrCreateWorktreeCapacityIntegrityKey } from ${JSON.stringify(SOURCE_URL)};

const [repoArg, barrierDir, countArg, outPath] = process.argv.slice(2);
const repo = fs.realpathSync(repoArg);
const baton = join(repo, '.baton');
const capacity = join(baton, 'capacity');
const peers = Number(countArg);
const napBuffer = new Int32Array(new SharedArrayBuffer(4));
const nap = (ms) => Atomics.wait(napBuffer, 0, 0, ms);

// Every creator announces itself, then spins until all peers reached this section.
function barrier(name) {
  fs.writeFileSync(join(barrierDir, name + '.' + process.pid), '');
  const deadline = Date.now() + 30000;
  for (;;) {
    const arrived = fs.readdirSync(barrierDir).filter((entry) => entry.startsWith(name + '.')).length;
    if (arrived >= peers) return;
    if (Date.now() > deadline) throw new Error('barrier ' + name + ' timed out');
    nap(5);
  }
}

const realExistsSync = fs.existsSync;
const realMkdirSync = fs.mkdirSync;
const realLinkSync = fs.linkSync;
const text = (value) => (typeof value === 'string' ? value : String(value));
// Hold every creator at the directory creation and key publication points so all of them
// observe the pre-creation state and race the real syscalls together.
fs.existsSync = (path) => {
  const target = text(path);
  if (target === baton || target === capacity) return false;
  return realExistsSync(path);
};
fs.mkdirSync = (path, options) => {
  const target = text(path);
  if (target === baton) barrier('baton');
  if (target === capacity) barrier('capacity');
  return realMkdirSync(path, options);
};
fs.linkSync = (source, destination) => {
  if (text(destination).endsWith('integrity.key')) barrier('link');
  return realLinkSync(source, destination);
};
syncBuiltinESMExports();

const key = loadOrCreateWorktreeCapacityIntegrityKey(repoArg);
fs.writeFileSync(outPath, key.toString('hex'));
`;
}

async function runConcurrentCreators(label, { precreateBaton = null } = {}) {
  const world = repoWorld(label);
  if (precreateBaton !== null) mkdirSync(world.baton, { mode: precreateBaton });
  const barrierDir = join(world.dir, 'barrier');
  mkdirSync(barrierDir, { mode: 0o700 });
  const fixture = join(world.dir, 'concurrent-child.mjs');
  writeFileSync(fixture, childSource());

  const peers = 4;
  const outs = [];
  const children = [];
  for (let index = 0; index < peers; index += 1) {
    const out = join(world.dir, `key-${index}.hex`);
    outs.push(out);
    children.push(new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fixture, world.repo, barrierDir, String(peers), out], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stderr }));
    }));
  }
  const outcomes = await Promise.all(children);
  return { ...world, outs, outcomes };
}

function assertConverged({ repo, outs, outcomes }) {
  assert.deepEqual(outcomes.map((outcome) => outcome.code), [0, 0, 0, 0],
    outcomes.map((outcome) => outcome.stderr).join('\n'));
  const keys = outs.map((out) => readFileSync(out, 'utf8'));
  for (const key of keys) assert.match(key, /^[a-f0-9]{64}$/u, `malformed key: ${key}`);
  assert.equal(new Set(keys).size, 1, 'every concurrent creator must return the same key');

  const keyPath = join(repo, '.baton', 'capacity', 'integrity.key');
  const stat = lstatSync(keyPath);
  assert.equal(stat.isFile(), true);
  assert.equal(stat.isSymbolicLink(), false);
  assert.equal(stat.size, 32);
  assert.equal(stat.mode & 0o777, 0o600, 'the published key is owner-only');
  assert.equal(readFileSync(keyPath).toString('hex'), keys[0], 'the file holds the returned key');
  assert.equal(statSync(join(repo, '.baton')).mode & 0o777, 0o700);
  assert.equal(statSync(join(repo, '.baton', 'capacity')).mode & 0o777, 0o700);
  assert.deepEqual(readdirSync(join(repo, '.baton', 'capacity')), ['integrity.key'],
    'no temp publication residue survives');
}

test('WC-INIT1: simultaneous first startup of a fresh repository converges on one valid key', { timeout: 60_000 }, async (t) => {
  const world = await runConcurrentCreators('fresh-repo');
  t.after(() => rmSync(world.dir, { recursive: true, force: true }));
  assertConverged(world);
});

test('WC-INIT2: simultaneous startup into a pre-created permissive .baton still converges', { timeout: 60_000 }, async (t) => {
  const world = await runConcurrentCreators('existing-baton', { precreateBaton: 0o755 });
  t.after(() => rmSync(world.dir, { recursive: true, force: true }));
  assertConverged(world);
});

test('WC-INIT3: a pre-existing .baton file is refused instead of adopted', (t) => {
  const world = repoWorld('baton-file');
  t.after(() => rmSync(world.dir, { recursive: true, force: true }));
  writeFileSync(world.baton, 'not a directory');
  refuses(() => loadOrCreateWorktreeCapacityIntegrityKey(world.repo));
  assert.equal(existsSync(world.capacity), false);
});

test('WC-INIT4: a .baton symlink escaping the repository is refused', (t) => {
  const world = repoWorld('baton-symlink');
  t.after(() => rmSync(world.dir, { recursive: true, force: true }));
  const outside = join(world.dir, 'outside');
  mkdirSync(outside, { mode: 0o700 });
  symlinkSync(outside, world.baton);
  refuses(() => loadOrCreateWorktreeCapacityIntegrityKey(world.repo));
  assert.deepEqual(readdirSync(outside), [], 'the escape target receives nothing');
});

test('WC-INIT5: a capacity symlink escaping the repository is refused', (t) => {
  const world = repoWorld('capacity-symlink');
  t.after(() => rmSync(world.dir, { recursive: true, force: true }));
  mkdirSync(world.baton, { mode: 0o700 });
  const outside = join(world.dir, 'outside');
  mkdirSync(outside, { mode: 0o700 });
  symlinkSync(outside, world.capacity);
  refuses(() => loadOrCreateWorktreeCapacityIntegrityKey(world.repo));
  assert.deepEqual(readdirSync(outside), [], 'the escape target receives nothing');
});

test('WC-INIT6: malformed existing integrity keys are refused', (t) => {
  const short = repoWorld('key-short');
  const permissive = repoWorld('key-permissive');
  const linked = repoWorld('key-symlink');
  const directory = repoWorld('key-directory');
  t.after(() => {
    for (const world of [short, permissive, linked, directory]) {
      rmSync(world.dir, { recursive: true, force: true });
    }
  });
  mkdirSync(short.capacity, { recursive: true, mode: 0o700 });
  writeFileSync(short.keyPath, Buffer.alloc(31, 7), { mode: 0o600 });
  refuses(() => loadOrCreateWorktreeCapacityIntegrityKey(short.repo));

  mkdirSync(permissive.capacity, { recursive: true, mode: 0o700 });
  writeFileSync(permissive.keyPath, Buffer.alloc(32, 7), { mode: 0o644 });
  refuses(() => loadOrCreateWorktreeCapacityIntegrityKey(permissive.repo));

  mkdirSync(linked.capacity, { recursive: true, mode: 0o700 });
  const target = join(linked.dir, 'real.key');
  writeFileSync(target, Buffer.alloc(32, 7), { mode: 0o600 });
  symlinkSync(target, linked.keyPath);
  refuses(() => loadOrCreateWorktreeCapacityIntegrityKey(linked.repo));

  mkdirSync(directory.keyPath, { recursive: true, mode: 0o700 });
  refuses(() => loadOrCreateWorktreeCapacityIntegrityKey(directory.repo));
});

test('WC-INIT7: a valid existing key is reused byte-for-byte and roots are tightened', (t) => {
  const world = repoWorld('reuse');
  t.after(() => rmSync(world.dir, { recursive: true, force: true }));
  mkdirSync(world.baton, { mode: 0o755 });
  mkdirSync(world.capacity, { mode: 0o755 });
  const existing = Buffer.alloc(32, 9);
  writeFileSync(world.keyPath, existing, { mode: 0o600 });

  const key = loadOrCreateWorktreeCapacityIntegrityKey(world.repo);
  assert.deepEqual(key, existing, 'an established key is authoritative, not regenerated');
  assert.equal(readFileSync(world.keyPath).toString('hex'), existing.toString('hex'));
  assert.equal(statSync(world.baton).mode & 0o777, 0o700);
  assert.equal(statSync(world.capacity).mode & 0o777, 0o700);
  assert.equal(lstatSync(world.keyPath).mode & 0o777, 0o600);
});
