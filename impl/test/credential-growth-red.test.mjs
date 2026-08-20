import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectCredentialTree } from '../src/credential-projection.mjs';

// #245-class red pin — the omp credential DB grew past the projection default.
//
// Measured live (2026-08-20, wave-c): EVERY omp member of every wave now crashes at
// spawn with `credential projection refused (source_file_oversize)` — the campaign's own
// ~/.omp/agent/agent.db (session history, grows by design) reached 1.36 MB while
// DEFAULT_FILE_LIMIT is 1 MiB. The default must accommodate the realistic growth of the
// very identity store it exists to project, or the fleet dies of success.
//
// RED   = a 1.5 MiB owned mode-safe source file refuses source_file_oversize under the
//         DEFAULT limits (no options passed — exactly how runtime-isolation calls it).
// GREEN = the default projects multi-MiB identity stores; the bound still exists
//         (a 64 MiB file still refuses — the guard is a guard, not removed).

function grownDbFixture() {
  const root = mkdtempSync(join(tmpdir(), 'baton-credgrown-source-'));
  chmodSync(root, 0o700);
  // A 1.5 MiB owned, non-group/other-writable file — the grown agent.db's shape.
  writeFileSync(join(root, 'agent.db'), Buffer.alloc(1.5 * 1024 * 1024, 0x20), { mode: 0o600 });
  const target = mkdtempSync(join(tmpdir(), 'baton-credgrown-target-'));
  chmodSync(target, 0o700);
  return { root, target };
}

test('CREDENTIAL-GROWTH (#245-class): a multi-MiB identity store projects under the DEFAULT limits', () => {
  const { root, target } = grownDbFixture();
  // The default call — no options — exactly as runtime-isolation invokes it.
  const projected = projectCredentialTree({ sourceRoot: root, targetRoot: target, relativeFiles: ['agent.db'] });
  assert.equal(projected.count, 1, 'the 1.5 MiB identity store projects (the fleet can spawn again)');
});

test('CREDENTIAL-GUARD: a pathological source file still refuses under the DEFAULT limits', () => {
  const root = mkdtempSync(join(tmpdir(), 'baton-credguard-source-'));
  chmodSync(root, 0o700);
  writeFileSync(join(root, 'agent.db'), Buffer.alloc(64 * 1024 * 1024, 0x20), { mode: 0o600 });
  const target = mkdtempSync(join(tmpdir(), 'baton-credguard-target-'));
  chmodSync(target, 0o700);
  assert.throws(
    () => projectCredentialTree({ sourceRoot: root, targetRoot: target, relativeFiles: ['agent.db'] }),
    (e) => e.code === 'source_file_oversize',
    'the oversize guard survives (a 64 MiB source is pathological, not identity)',
  );
});
