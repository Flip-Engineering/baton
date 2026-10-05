#!/usr/bin/env node
// Usage: node bend2/test/laws-mutations-migration.mjs ORIGINAL_CHECKER [DEFINITIONS]
// ORIGINAL_CHECKER is a retained pre-extraction source file.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

assert.ok(process.argv[2], 'supply the retained pre-extraction checker');
const source = readFileSync(process.argv[2], 'utf8');
const start = source.indexOf('const MUTATIONS = [');
const end = source.indexOf('for (const mutation of MUTATIONS) {');
assert.ok(start >= 0 && end > start, 'original definition boundaries must exist');
assert.equal(source.lastIndexOf('const MUTATIONS = ['), start);
assert.equal(source.lastIndexOf('for (const mutation of MUTATIONS) {'), end);
// Evaluate the original JavaScript definitions with only their path dependency.
const expected = runInNewContext(
  source.slice(start, end) + '\nMUTATIONS;', { join }, { timeout: 1000 },
);
for (const record of expected) {
  assert.ok(Object.values(record).every(value => typeof value === 'string'));
}
const definitions = resolve(process.argv[3] ??
  join(import.meta.dirname, '..', 'scripts', 'laws-mutations.mjs'));
const scratch = mkdtempSync(join(tmpdir(), 'baton-mutation-import-'));
try {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const denied = name => () => { throw new Error('unexpected import effect: ' + name); };
    for (const name of ['existsSync', 'readdirSync', 'statSync',
      'accessSync', 'mkdirSync', 'rmSync', 'writeFileSync', 'appendFileSync',
      'unlinkSync', 'renameSync', 'cpSync']) fs[name] = denied(name);
    const open = fs.openSync;
    fs.openSync = (path, flags, ...args) => {
      assert.ok(flags === 'r' || flags === 0, 'import must open files read-only');
      return open(path, flags, ...args);
    };
    for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile',
      'execFileSync', 'fork']) childProcess[name] = denied(name);
    syncBuiltinESMExports();
    const { MUTATIONS } = await import(process.argv[1]);
    assert.ok(Array.isArray(MUTATIONS));
    for (const record of MUTATIONS) {
      assert.ok(Object.values(record).every(value => typeof value === 'string'));
    }
    process.stdout.write(JSON.stringify(MUTATIONS));
  `, pathToFileURL(definitions).href], {
    cwd: scratch,
    env: { PATH: '', BEND: '/unavailable/compiler' },
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  assert.deepEqual(JSON.parse(child.stdout), JSON.parse(JSON.stringify(expected)),
    'exported records and ordering must equal the original evaluated definitions');
  assert.deepEqual(readdirSync(scratch), [], 'import must leave its working directory empty');
  console.log('PASS: complete evaluated definitions and ordering preserved; isolated import has no guarded effects');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
