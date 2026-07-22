// REPL-1 kind-inventory red suite (docs/33 §4, rule 17). A STATIC mechanism — not a live
// full-kind drive: it reads the _apply method source, extracts every folded event-kind literal,
// asserts `repl.manifest_admitted` is among them, cross-checks that every projection map written
// in the fold is a checkpoint field (catching "kind folds but no checkpoint field"), and drives
// one undeclared repl.* event to prove the terminal `unsupported_event_kind` tripwire still fires.
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

const applySource = CoordinationStore.prototype._apply.toString();

function foldedKinds() {
  const kinds = new Set();
  for (const match of applySource.matchAll(/event\.kind === '([^']+)'/gu)) kinds.add(match[1]);
  for (const match of applySource.matchAll(/\[([^\]]*)\]\.includes\(event\.kind\)/gu)) {
    for (const literal of match[1].matchAll(/'([^']+)'/gu)) kinds.add(literal[1]);
  }
  return kinds;
}

function foldedProjectionMaps() {
  const maps = new Set();
  for (const match of applySource.matchAll(/this\.(_[A-Za-z0-9]+)\.set\(/gu)) maps.add(match[1]);
  return maps;
}

test('KI1: repl.manifest_admitted is in the closed set of folded coordination event kinds', () => {
  const kinds = foldedKinds();
  assert.ok(kinds.has('repl.manifest_admitted'),
    'the new kind must appear in _apply before the terminal unsupported_event_kind throw');
  assert.ok(kinds.has('context.session_admitted'), 'the extraction sees existing context kinds too');
});

test('KI2: every projection map written in the fold is a checkpoint field (repl map in both)', (t) => {
  const store = bareStore(t);
  const checkpointFields = new Set(Object.keys(store._projectionCheckpointPayload()));
  const maps = foldedProjectionMaps();
  assert.ok(maps.has('_replManifestAdmissions'), 'the repl fold writes its projection map');
  assert.ok(checkpointFields.has('_replManifestAdmissions'), 'the repl map is a checkpoint field');
  // The general cross-check: no fold writes a projection map that a checkpoint would silently drop.
  for (const name of maps) {
    assert.ok(checkpointFields.has(name),
      `fold writes projection map ${name} but it is absent from PROJECTION_CHECKPOINT_FIELDS`);
  }
});

test('KI3: driving an undeclared repl.* event still throws unsupported_event_kind', (t) => {
  const store = bareStore(t);
  let thrown = null;
  try {
    store._apply({ schemaVersion: 1, seq: 1, ts: '2026-07-18T08:00:00.000Z', kind: 'repl.binding_set', actor: 'x', idempotencyKey: 'x', payload: { runId: 'run-x' } });
  } catch (error) { thrown = error; }
  assert.ok(thrown, 'an undeclared repl.* kind must be refused');
  assert.equal(thrown.code, 'unsupported_event_kind');
});
