// The packaged Anthropic API-key launcher remains closed until request-level
// credit admission is available. These tests use fixture-only paths and child
// markers. They make no provider requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function invoke(reference, commandArgs, extraEnv = {}) {
  const native = process.env.BATON2_API_KEY_EXEC;
  if (!native) throw new Error('BATON2_API_KEY_EXEC must name the built native api-key-exec helper');
  return execFileSync(native, [reference, ...commandArgs], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv },
  });
}

async function refused(reference, commandArgs, extraEnv = {}) {
  try {
    invoke(reference, commandArgs, extraEnv);
    assert.fail('the API-key launcher should refuse before resolving or spawning');
  } catch (error) {
    assert.equal(error.status, 2);
    assert.equal(error.stdout, '');
    const response = JSON.parse(error.stderr.trim());
    assert.equal(response.schema, 'baton2-api-key-exec-v1');
    assert.equal(response.state, 'unavailable');
    assert.equal(response.condition, 'creditAdmissionUnavailable');
    return error.stderr;
  }
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'api-key-held-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const secret = path.join(directory, 'secret');
  const marker = path.join(directory, 'child-started');
  const child = path.join(directory, 'child.mjs');
  await writeFile(secret, 'sk-fixture-never-read\n', { mode: 0o600 });
  await chmod(secret, 0o600);
  await writeFile(child, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'started')`);
  return { directory, secret, marker, child };
}

test('valid secret reference refuses before secret read and child spawn', async (t) => {
  const f = await fixture(t);
  const stderr = await refused('file:' + f.secret, [process.execPath, f.child]);
  assert.equal(stderr.includes('sk-fixture-never-read'), false);
  assert.equal(existsSync(f.marker), false);
  assert.equal(await readFile(f.secret, 'utf8'), 'sk-fixture-never-read\n');
});

test('missing secret reference receives the same fail-closed refusal', async (t) => {
  const f = await fixture(t);
  const missing = path.join(f.directory, 'missing-secret');
  await refused('file:' + missing, [process.execPath, f.child]);
  assert.equal(existsSync(missing), false);
});

test('unsupported reference scheme is refused without disclosure', async (t) => {
  const f = await fixture(t);
  const stderr = await refused('env:ANTHROPIC_API_KEY', [process.execPath, f.child]);
  assert.equal(stderr.includes('ANTHROPIC_API_KEY='), false);
  assert.equal(existsSync(f.marker), false);
});

test('world-readable secret file remains unchanged', async (t) => {
  const f = await fixture(t);
  await chmod(f.secret, 0o644);
  await refused('file:' + f.secret, [process.execPath, f.child]);
  assert.equal((await readFile(f.secret, 'utf8')), 'sk-fixture-never-read\n');
  assert.equal(existsSync(f.marker), false);
});

test('existing environment specification is not overwritten', async (t) => {
  const f = await fixture(t);
  const specification = path.join(f.directory, 'environment.spec');
  await writeFile(specification, 'OWNER=fixture\n', { mode: 0o600 });
  await refused('file:' + f.secret, [process.execPath, f.child], { BATON2_API_KEY_SPEC_PATH: specification });
  assert.equal(await readFile(specification, 'utf8'), 'OWNER=fixture\n');
});

test('symlinked environment specification target remains unchanged', async (t) => {
  const f = await fixture(t);
  const target = path.join(f.directory, 'target.spec');
  const specification = path.join(f.directory, 'environment.spec');
  await writeFile(target, 'OWNER=target\n', { mode: 0o600 });
  await symlink(target, specification);
  await refused('file:' + f.secret, [process.execPath, f.child], { BATON2_API_KEY_SPEC_PATH: specification });
  assert.equal(await readFile(target, 'utf8'), 'OWNER=target\n');
});

test('empty credential reference still refuses without starting a child', async (t) => {
  const f = await fixture(t);
  await refused('', [process.execPath, f.child]);
  assert.equal(existsSync(f.marker), false);
});

test('child exit status is unreachable while admission is held', async (t) => {
  const f = await fixture(t);
  const child = path.join(f.directory, 'exit.mjs');
  await writeFile(child, 'process.exit(23)');
  await refused('file:' + f.secret, [process.execPath, child]);
  assert.equal(existsSync(f.marker), false);
});

test('child signal is unreachable while admission is held', async (t) => {
  const f = await fixture(t);
  const child = path.join(f.directory, 'signal.mjs');
  await writeFile(child, 'process.kill(process.pid, \'SIGTERM\')');
  await refused('file:' + f.secret, [process.execPath, child]);
  assert.equal(existsSync(f.marker), false);
});

test('concurrent refusals do not disclose secrets or start children', async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([
    refused('file:' + f.secret, [process.execPath, f.child]),
    refused('file:' + f.secret, [process.execPath, f.child]),
    refused('file:' + f.secret, [process.execPath, f.child]),
  ]);
  assert.equal(results.every((stderr) => !stderr.includes('sk-fixture-never-read')), true);
  assert.equal(existsSync(f.marker), false);
});
