// repl1-kind-inventory-red.test.mjs — the driven remainder of the repl kind inventory (E08 of
// the #598 audit): the source-scanning kind and projection-map regexes are deleted, and what
// stays is the behavior they used to guard — driving an undeclared repl.* event through the
// real coordination store still trips the terminal `unsupported_event_kind` refusal. The
// projection checkpoint cache itself is runtime state (PROJECTION_CHECKPOINT_FIELDS) and is
// not touched by this file.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';

function bareStore(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-repl1-kinds-'));
  const store = new CoordinationStore(join(root, 'coordination'), {
    repoId: 'repo-repl1-kinds', clock: () => '2026-07-18T08:00:00.000Z',
  });
  t.after(() => {
    try { store.releaseWriterLease(); } catch { /* already released */ }
    rmSync(root, { recursive: true, force: true });
  });
  return store;
}

test('KI3: driving an undeclared repl.* event still throws unsupported_event_kind', (t) => {
  const store = bareStore(t);
  let thrown = null;
  try {
    store._apply({ schemaVersion: 1, seq: 1, ts: '2026-07-18T08:00:00.000Z', kind: 'repl.undeclared_kind', actor: 'x', idempotencyKey: 'x', payload: { runId: 'run-x' } });
  } catch (error) { thrown = error; }
  assert.ok(thrown, 'an undeclared repl.* kind must be refused');
  assert.equal(thrown.code, 'unsupported_event_kind');
});
