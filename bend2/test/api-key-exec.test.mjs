// Fixture for the API-credit launch boundary (#793): the native helper resolves
// a secret reference and passes the credential to the child only through its
// environment. Every case here runs the built native bend2/harness/api-key-exec
// with fixture secrets and a stub child; no live credential, account, or
// provider is involved. The fixture secret values exist only inside this
// process and the child's environment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

function run(reference, commandArgs, options = {}) {
  const native = process.env.BATON2_API_KEY_EXEC_TEST;
  if (!native) throw new Error('BATON2_API_KEY_EXEC_TEST must name the test-only resolver entry');
  return execFileSync(native, [reference, ...commandArgs], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function runProduction(reference, commandArgs, env) {
  const native = process.env.BATON2_API_KEY_EXEC;
  if (!native) throw new Error('BATON2_API_KEY_EXEC must name the production api-key-exec helper');
  return execFileSync(native, [reference, ...commandArgs], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
}

function assertProductionRefusal(reference, commandArgs) {
  try {
    runProduction(reference, commandArgs);
    assert.fail('the production API-key helper must refuse while credit admission is unavailable');
  } catch (error) {
    assert.equal(error.status, 2);
    assert.equal(error.stdout, '');
    const refusal = JSON.parse(error.stderr.trim());
    assert.equal(refusal.condition, 'creditAdmissionUnavailable');
    assert.equal(refusal.state, 'unavailable');
    assert.equal(refusal.schema, 'baton2-api-key-exec-v1');
    return error.stderr;
  }
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

test('a forced existing spec path refuses before the child starts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'api-key-exec-'));
  try {
    const reference = await withSecret(directory, 'secret', 'sk-fixture-forced-spec-value');
    const spec = path.join(directory, 'forced-spec');
    const marker = path.join(directory, 'started');
    const probe = path.join(directory, 'marker.mjs');
    await writeFile(probe, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'started')`);
    await writeFile(spec, 'existing-bytes');
    let stderr = '';
    try {
      run(reference, [process.execPath, probe], { env: { ...process.env, BATON2_API_KEY_SPEC_PATH: spec } });
      assert.fail('the helper should refuse an existing spec path');
    } catch (error) {
      stderr = error.stderr;
      assert.equal(error.status, 2);
    }
    assert.equal((await readFile(spec, 'utf8')), 'existing-bytes');
    assert.equal(existsSync(marker), false);
    assert.equal(stderr.includes('sk-fixture-forced-spec-value'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a forced symlink spec path preserves the target and refuses before the child starts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'api-key-exec-'));
  try {
    const reference = await withSecret(directory, 'secret', 'sk-fixture-symlink-spec-value');
    const target = path.join(directory, 'target');
    const spec = path.join(directory, 'forced-link');
    const marker = path.join(directory, 'started');
    const probe = path.join(directory, 'marker.mjs');
    await writeFile(probe, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'started')`);
    await writeFile(target, 'target-bytes');
    await symlink(target, spec);
    let stderr = '';
    try {
      run(reference, [process.execPath, probe], { env: { ...process.env, BATON2_API_KEY_SPEC_PATH: spec } });
      assert.fail('the helper should refuse a symlink spec path');
    } catch (error) {
      stderr = error.stderr;
      assert.equal(error.status, 2);
    }
    assert.equal((await readFile(target, 'utf8')), 'target-bytes');
    assert.equal(existsSync(marker), false);
    assert.equal(stderr.includes('sk-fixture-symlink-spec-value'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a signaled child is re-raised by the helper', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'api-key-exec-'));
  try {
    const reference = await withSecret(directory, 'secret', 'sk-fixture-signal-value');
    const probe = path.join(directory, 'signal.mjs');
    await writeFile(probe, 'process.kill(process.pid, "SIGTERM")');
    try {
      run(reference, [process.execPath, probe]);
      assert.fail('the helper should terminate by the child signal');
    } catch (error) {
      assert.equal(error.signal, 'SIGTERM');
      assert.equal(error.status, null);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('concurrent forced spec paths never disclose another secret', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'api-key-exec-'));
  try {
    const native = process.env.BATON2_API_KEY_EXEC_TEST;
    const spec = path.join(directory, 'shared-spec');
    const probe = path.join(directory, 'print.mjs');
    await writeFile(probe, 'process.stdout.write(process.env.ANTHROPIC_API_KEY ?? "")');
    const first = await withSecret(directory, 'first', 'sk-fixture-race-first');
    const second = await withSecret(directory, 'second', 'sk-fixture-race-second');
    const results = await Promise.allSettled([
      execFileAsync(native, [first, process.execPath, probe], { encoding: 'utf8', env: { ...process.env, BATON2_API_KEY_SPEC_PATH: spec } }),
      execFileAsync(native, [second, process.execPath, probe], { encoding: 'utf8', env: { ...process.env, BATON2_API_KEY_SPEC_PATH: spec } }),
    ]);
    const firstOk = results[0].status === 'fulfilled';
    const secondOk = results[1].status === 'fulfilled';
    assert.ok(firstOk || secondOk);
    if (firstOk) assert.equal(results[0].value.stdout, 'sk-fixture-race-first');
    else assert.equal(results[0].reason.status, 2);
    if (secondOk) assert.equal(results[1].value.stdout, 'sk-fixture-race-second');
    else assert.equal(results[1].reason.status, 2);
    for (let index = 0; index < 2; index++) {
      const result = results[index];
      const text = result.status === 'fulfilled' ? result.value.stdout + result.value.stderr : (result.reason.stdout ?? '') + (result.reason.stderr ?? '');
      const own = index === 0 ? 'sk-fixture-race-first' : 'sk-fixture-race-second';
      const other = index === 0 ? 'sk-fixture-race-second' : 'sk-fixture-race-first';
      assert.equal(text.includes(other), false);
      if (!own.includes('none')) assert.equal(text.includes(own), result.status === 'fulfilled' ? true : false);
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

test('the production helper refuses before reading a secret or starting a child', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'api-key-held-'));
  try {
    const secret = 'sk-fixture-never-read';
    const reference = await withSecret(directory, 'secret', secret);
    const marker = path.join(directory, 'child-started');
    const child = path.join(directory, 'child.mjs');
    await writeFile(child, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'started')`);
    const stderr = assertProductionRefusal(reference, [process.execPath, child]);
    assert.equal(stderr.includes(secret), false);
    assert.equal(existsSync(marker), false);
    assert.equal(await readFile(path.join(directory, 'secret'), 'utf8'), secret + '\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the production helper runs a child for a matching reservation marker', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'api-key-admitted-'));
  try {
    const reference = await withSecret(directory, 'secret', '[REDACTED]');
    const child = path.join(directory, 'child.mjs');
    await writeFile(child, 'process.stdout.write(process.env.ANTHROPIC_API_KEY ? "key-set" : "key-missing")');
    const attempt = path.join(directory, 'attempt-1');
    const output = runProduction(reference, [process.execPath, child], {
      ...process.env, BATON2_CREDIT_RESERVATION: attempt, BATON_ATTEMPT_DIRECTORY: attempt,
    });
    assert.equal(output, 'key-set');
    try {
      runProduction(reference, [process.execPath, child], {
        ...process.env, BATON2_CREDIT_RESERVATION: path.join(directory, 'other'), BATON_ATTEMPT_DIRECTORY: attempt,
      });
      assert.fail('a mismatched reservation marker must refuse');
    } catch (error) {
      assert.equal(error.status, 2);
      assert.equal(JSON.parse(error.stderr.trim()).condition, 'creditAdmissionUnavailable');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the production helper refuses missing references without probing them', async () => {
  const missing = path.join(tmpdir(), 'api-key-held-missing-' + process.pid);
  const child = path.join(tmpdir(), 'api-key-held-child-' + process.pid + '.mjs');
  await writeFile(child, 'process.exit(0)');
  try {
    assertProductionRefusal('file:' + missing, [process.execPath, child]);
    assert.equal(existsSync(missing), false);
  } finally {
    await rm(child, { force: true });
  }
});
