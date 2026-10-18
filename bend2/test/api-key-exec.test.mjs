// The packaged Anthropic API-key launcher stays closed until request-level
// promotional-credit admission is available. These tests use only fixture
// paths and a marker child; they make no provider request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function run(reference, commandArgs) {
  const native = process.env.BATON2_API_KEY_EXEC;
  if (!native) throw new Error('BATON2_API_KEY_EXEC must name the built native api-key-exec helper');
  return execFileSync(native, [reference, ...commandArgs], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function refused(reference, commandArgs) {
  try {
    run(reference, commandArgs);
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

test('credit admission refuses before reading a secret or starting the child', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'api-key-held-'));
  try {
    const secret = 'sk-fixture-never-read';
    const referencePath = path.join(directory, 'secret');
    const marker = path.join(directory, 'child-started');
    const child = path.join(directory, 'child.mjs');
    await writeFile(referencePath, secret + '\n', { mode: 0o644 });
    await chmod(referencePath, 0o644);
    await writeFile(child, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'started')`);

    const stderr = await refused('file:' + referencePath, [process.execPath, child]);
    assert.equal(stderr.includes(secret), false);
    assert.equal(existsSync(marker), false);
    assert.equal(await readFile(referencePath, 'utf8'), secret + '\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('credit admission refuses before checking whether a secret reference exists', async () => {
  const missing = path.join(tmpdir(), 'api-key-held-missing-' + process.pid);
  await refused('file:' + missing, [process.execPath, '-e', 'process.exit(0)']);
  assert.equal(existsSync(missing), false);
});
