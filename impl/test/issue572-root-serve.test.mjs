import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { rootWakeTargetFromEnvironment } from '../src/wake-delivery.mjs';

test('572-serve1: the resident root environment names one validated session', () => {
  assert.equal(rootWakeTargetFromEnvironment({}), null);
  assert.equal(rootWakeTargetFromEnvironment({ BATON_ROOT_WAKE: '' }), null);
  assert.deepEqual(rootWakeTargetFromEnvironment({
    BATON_ROOT_WAKE: JSON.stringify({ harness: 'claude-code', sessionId: 'operator-session' }),
  }), { harness: 'claude-code', sessionId: 'operator-session', from: 'baton' });
  for (const raw of ['{', 'null', '{}', '{"harness":"claude-code","sessionId":"s","unknown":true}']) {
    assert.throws(() => rootWakeTargetFromEnvironment({ BATON_ROOT_WAKE: raw }),
      { code: 'wake_delivery_invalid' });
  }
});

test('572-serve2: baton serve validates its configured root before opening the resident', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-572-root-serve-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: directory });
  const child = spawnSync(process.execPath,
    [fileURLToPath(new URL('../scripts/baton.mjs', import.meta.url)), 'serve'], {
      cwd: directory, encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, BATON_ROOT_WAKE: JSON.stringify({ harness: 'codex', sessionId: 'operator' }) },
    });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1, child.stdout + child.stderr);
  assert.match(child.stderr, /wake_delivery_unavailable|codex cannot start a turn/);
});
