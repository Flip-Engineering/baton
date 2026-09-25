// The landing gate's table half derives gate-file names from the resident's own tree, so a test
// file the landing itself deletes still reaches the runner by name (#582: a removal lands on its
// merits). A checkout-relative requested file that does not exist is a file the change deleted:
// the runner skips it as a named deletion instead of letting the spawn die unreported — an
// unreported exit is a failure the base comparison would read as one the target does not share.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const IMPL = resolve(import.meta.dirname, '..');
const RUNNER = join(IMPL, 'scripts', 'run-suite.mjs');
const PROBE = 'test/fixtures/issue580-verdict-env-probe.mjs';
const DELETED = 'test/no-such-file-the-change-deleted.test.mjs';

test('a requested file absent from the checkout skips as a named deletion, and the run stays green', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-deleted-selection-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const verdictPath = join(directory, 'verdict.json');
  const env = { ...process.env, BATON_SUITE_VERDICT_FILE: verdictPath, BATON_TEST_TMP_PARENT: directory };
  delete env.NODE_TEST_CONTEXT;
  const run = await new Promise((done) => {
    const child = spawn(process.execPath, [RUNNER, PROBE, DELETED], { cwd: IMPL, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', () => done({ code: -1, stderr }));
    child.once('close', (code) => done({ code, stderr }));
  });
  assert.equal(run.code, 0, `the existing file runs and the absent one skips: ${run.stderr.slice(-2000)}`);
  assert.match(
    run.stderr,
    /skipped \(file absent from the checkout \(deleted by this change\)\): test\/no-such-file-the-change-deleted\.test\.mjs/u,
    'the runner names the deletion on its own stream',
  );
  const document = JSON.parse(readFileSync(verdictPath, 'utf8'));
  assert.equal(document.green, true, 'a deletion the change itself carries is not a failure to compare');
  assert.equal(document.passed, 1, 'only the file that exists ran');
  assert.deepEqual(
    (document.skipped ?? []).map((row) => ({ file: row.file, reason: row.reason })),
    [{ file: DELETED, reason: 'file absent from the checkout (deleted by this change)' }],
  );
});
