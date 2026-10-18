// Fixture for the API-credit launch boundary (#793): the native helper resolves
// a secret reference and passes the credential to the child only through its
// environment. Every case here runs the built native bend2/harness/api-key-exec
// with fixture secrets and a stub child; no live credential, account, or
// provider is involved. The fixture secret values exist only inside this
// process and the child's environment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

function run(reference, commandArgs, options = {}) {
  const native = process.env.BATON2_API_KEY_EXEC;
  if (!native) throw new Error('BATON2_API_KEY_EXEC must name the built native api-key-exec helper');
  return execFileSync(native, [reference, ...commandArgs], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

async function withSecret(directory, name, content, mode = 0o600) {
  const file = path.join(directory, name);
  await writeFile(file, content + '\n', { mode });
  await chmod(file, mode);
  return 'file:' + file;
}

test('the credential reaches the child environment and never the argv', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'api-key-exec-'));
  try {
    const secret = 'sk-fixture-619deace-value';
    const reference = await withSecret(directory, 'secret', secret);
    const probe = path.join(directory, 'probe.mjs');
    await writeFile(probe, "console.log(JSON.stringify({argv: process.argv.slice(1), key: process.env.ANTHROPIC_API_KEY ?? null}))");
    const stdout = run(reference, [process.execPath, probe]);
    const observed = JSON.parse(stdout);
    assert.equal(observed.key, secret);
    assert.equal(observed.argv[0], probe);
    assert.equal(observed.argv.join(' ').includes(secret), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a secret file readable beyond its owner is refused unread', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'api-key-exec-'));
  try {
    const secret = 'sk-fixture-wide-value';
    const reference = await withSecret(directory, 'secret', secret, 0o644);
    let stderr = '';
    try {
      run(reference, [process.execPath, '-e', '']);
      assert.fail('the wrapper should have refused');
    } catch (error) {
      stderr = error.stderr;
      assert.equal(error.status, 2);
    }
    const refusal = JSON.parse(stderr.trim());
    assert.equal(refusal.condition, 'secretFilePermissions');
    assert.equal(stderr.includes(secret), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a missing secret file is refused as unavailable', async () => {
  let stderr = '';
  try {
    run('file:' + path.join(tmpdir(), 'api-key-exec-missing-' + Date.now()), [process.execPath, '-e', '']);
    assert.fail('the wrapper should have refused');
  } catch (error) {
    stderr = error.stderr;
    assert.equal(error.status, 2);
  }
  assert.equal(JSON.parse(stderr.trim()).condition, 'secretUnavailable');
});

test('an unsupported reference scheme is refused without reading anything', async () => {
  let stderr = '';
  try {
    run('token:sk-fixture-not-a-reference', [process.execPath, '-e', '']);
    assert.fail('the wrapper should have refused');
  } catch (error) {
    stderr = error.stderr;
    assert.equal(error.status, 2);
  }
  assert.equal(JSON.parse(stderr.trim()).condition, 'unsupportedSecretReference');
});

test('a child signal is re-raised to the parent', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'api-key-exec-'));
  try {
    const reference = await withSecret(directory, 'secret', 'sk-fixture-signal-value');
    const probe = path.join(directory, 'signal.mjs');
    await writeFile(probe, "process.kill(process.pid, 'SIGTERM')");
    try {
      run(reference, [process.execPath, probe]);
      assert.fail('the wrapper should have been killed by the signal');
    } catch (error) {
      assert.equal(error.signal, 'SIGTERM');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the child exit code passes through unchanged', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'api-key-exec-'));
  try {
    const reference = await withSecret(directory, 'secret', 'sk-fixture-exit-value');
    const probe = path.join(directory, 'exit3.mjs');
    await writeFile(probe, 'process.exit(3)');
    const status = run(reference, [process.execPath, probe], { ...{} });
    assert.fail('the wrapper should propagate the child exit');
  } catch (error) {
    assert.equal(error.status, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
