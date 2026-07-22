// REPL-1 kind-inventory RED suite (rule 17): a STATIC assertion of the closed set of coordination
// event kinds the store folds. It reads CoordinationStore.prototype._apply source, extracts every
// `event.kind === '...'` literal and every `[...].includes(event.kind)` list member, then asserts
// (a) repl.manifest_admitted is folded, (b) the map its fold writes is a checkpoint field (the
// cross-check that catches "kind folds but no checkpoint field"), and (c) an undeclared repl.*
// kind still throws unsupported_event_kind. This grows as REPL-2's repl.binding_* land.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { DEFAULT_CONTEXT_PROGRAM_POLICY, contextValueDigest } from '../src/context-program.mjs';

function foldedKinds() {
  const src = CoordinationStore.prototype._apply.toString();
  const kinds = new Set();
  for (const match of src.matchAll(/event\.kind === '([^']+)'/g)) kinds.add(match[1]);
  for (const list of src.matchAll(/\[([^\]]*)\]\.includes\(event\.kind\)/g)) {
    for (const literal of list[1].matchAll(/'([^']+)'/g)) kinds.add(literal[1]);
  }
  return kinds;
}

function mapWritesInApply() {
  const src = CoordinationStore.prototype._apply.toString();
  const names = new Set();
  for (const match of src.matchAll(/this\.(_[A-Za-z0-9]+)\.set\(/g)) names.add(match[1]);
  return names;
}

function makeStore(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-repl1-kind-'));
  const store = new CoordinationStore(join(root, 'coordination'), {
    repoId: 'repo-repl1-kind', deploymentBaseSha: '1'.repeat(40),
    contextProgramPolicy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    contextEnvironmentDigest: '4'.repeat(64), contextReferenceIdentity: '9'.repeat(64),
    contextReferenceRead: () => { throw Object.assign(new Error('no source'), { code: 'context_source_unavailable' }); },
    contextSourceAttest: () => { throw new Error('unused'); },
    runLineagePolicy: {
      schemaVersion: 1, maxDepth: 4, maxChildrenPerRun: 8,
      maxDescendantsPerRoot: 32, leaseTtlMs: 60 * 60 * 1_000,
    },
    clock: () => '2026-07-18T20:00:00.000Z',
  });
  t.after(() => { try { store.releaseWriterLease(); } catch { /* ignore */ } rmSync(root, { recursive: true, force: true }); });
  return store;
}

test('rule 17(a): repl.manifest_admitted is among the folded coordination kinds', () => {
  const kinds = foldedKinds();
  // extraction is real — established kinds are present
  assert.ok(kinds.has('context.session_admitted'), 'extraction found the context kinds');
  assert.ok(kinds.has('run.orchestrator_lease_issued'), 'extraction found the lease kind');
  // REPL-1 lands exactly one new kind
  assert.ok(kinds.has('repl.manifest_admitted'), 'repl.manifest_admitted must be folded');
  // REPL-2 kinds are NOT yet declared — the closed set grows deliberately
  assert.equal(kinds.has('repl.binding_set'), false);
  assert.equal(kinds.has('repl.binding_dropped'), false);
});

test('rule 17(b): the map the repl fold writes is present in PROJECTION_CHECKPOINT_FIELDS', (t) => {
  const store = makeStore(t);
  const checkpointFields = new Set(Object.keys(store._projectionCheckpointPayload()));
  // the repl fold writes _replManifestAdmissions — it MUST be a durable checkpoint field, or a
  // checkpoint written by new code silently drifts from the folded projection.
  assert.ok(mapWritesInApply().has('_replManifestAdmissions'), '_apply writes _replManifestAdmissions');
  assert.ok(checkpointFields.has('_replManifestAdmissions'), '_replManifestAdmissions is a checkpoint field');
  // cross-check: every projection Map that _apply writes via .set is a checkpoint field — no
  // "folds but never checkpointed" drift.
  const nonCheckpointCaches = new Set(['_cells']); // Bench-local caches never live on the store
  for (const name of mapWritesInApply()) {
    if (nonCheckpointCaches.has(name)) continue;
    assert.ok(checkpointFields.has(name), `${name} folds into a projection but is not checkpointed`);
  }
});

test('rule 17(c): an undeclared repl.* kind still throws unsupported_event_kind', (t) => {
  const store = makeStore(t);
  assert.throws(() => store._apply({
    schemaVersion: 1, seq: store.snapshot().lastSeq + 1, ts: '2026-07-18T20:00:00.000Z',
    kind: 'repl.some_future_kind', actor: 'x', idempotencyKey: 'x', payload: { runId: 'r' },
  }), (error) => error.code === 'unsupported_event_kind');
  // sanity: the contextValueDigest import is exercised so the harness matches the manifest suite
  assert.match(contextValueDigest({ ok: true }), /^[a-f0-9]{64}$/u);
});
