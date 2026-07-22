// REFLEX-3 red suite (docs/32 §3.3, issue #18; contract: docs/reference/evidence/
// reflex-wave-live-2026-07-21/reflex3-packages-decisions.md, red-team F11 lines 205-231 / F14
// lines 282-294; correction #10 lines 338-343).
//
// F11.1 (Part A): `provenance.packageEvent` is hub-derived from the admission ledger event itself
// (the `scratchFactOracleTarget` binding pattern) — never a submitter-supplied claim, refused
// `reserved_package_field` on submission, re-derived fresh on every read/replay, and a divergence
// between the durable projection and the ledger event it claims to bind raises a loud
// `package_provenance_integrity` (never a silent accept).
//
// F11.2 (Part B): `_normalizeContextPackage` runs in the `normalizeContextManifest` mold —
// delete-and-recompute `packageDigest`, exact()-check every field, unique branch names, and every
// branch requires >=1 of source/artifact/valueRef (a `schema` alone is not content).
//
// F11.3 (Part C): admission resolves every branch ref exactly once; `attachContextPackage` is a
// fenced O(1) pointer binding that never re-reads branch bytes; `resolveContextPackageBranch` is
// the lazy §93.5 resolve-time revalidation point, settling `context_artifact_unavailable` on
// missing/changed bytes.
//
// Replay: packages replay byte-for-byte and are never relabeled.
//
// Sanitization (Part D / F14): branch projections route through `boundedAttentionText`/
// `SECRET_SHAPED_TEXT` and carry an explicit untrusted-prose provenance marker.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { DEFAULT_CONTEXT_PROGRAM_POLICY, normalizeContextProgramPolicy } from '../src/context-program-policy.mjs';
import { projectContextPackageBranch } from '../src/application.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

const dirs = [];
function tmpDir(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-reflex3-packages-${label}-`));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

const repoId = 'repo-reflex3-packages';
const treeSha = '1'.repeat(40);
const environmentDigest = '2'.repeat(64);
const referenceIdentity = '3'.repeat(64);
const policy = normalizeContextProgramPolicy(DEFAULT_CONTEXT_PROGRAM_POLICY);

function resolver() {
  const sources = new Map();
  const artifacts = new Map();
  const calls = [];
  const read = (reference) => {
    calls.push(reference);
    if (reference.kind === 'context_source') {
      if (!sources.has(reference.ref)) {
        const error = new Error('context package source is unavailable');
        error.code = 'context_artifact_unavailable';
        throw error;
      }
      return sources.get(reference.ref);
    }
    if (!artifacts.has(reference.handle)) {
      const error = new Error('context package artifact is unavailable');
      error.code = 'context_artifact_unavailable';
      throw error;
    }
    return artifacts.get(reference.handle);
  };
  return { sources, artifacts, calls, read };
}

function storeOptions(res) {
  return {
    repoId, deploymentBaseSha: treeSha,
    contextProgramPolicy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    contextEnvironmentDigest: environmentDigest,
    contextReferenceIdentity: referenceIdentity,
    contextReferenceRead: res.read,
    contextSourceAttest: () => { throw new Error('not used in this suite'); },
    clock: () => '2026-07-21T00:00:00.000Z',
  };
}

function fixture(label) {
  const directory = tmpDir(label);
  const storeRoot = join(directory, 'coordination');
  const res = resolver();
  const store = new CoordinationStore(storeRoot, storeOptions(res));
  return { directory, storeRoot, store, res };
}

function reopen(f) {
  return new CoordinationStore(f.storeRoot, storeOptions(f.res));
}

function artifactBranch(name, res, content = { hello: name }) {
  const artifactDigest = digest(content);
  const handle = `art:sha256:${artifactDigest}`;
  res.artifacts.set(handle, content);
  return {
    name, source: null, valueRef: null, schema: null,
    artifact: {
      kind: 'context_value', digest: artifactDigest, handle,
      mediaType: 'application/vnd.baton.context-value+json',
      bytes: Buffer.byteLength(JSON.stringify(content)),
    },
  };
}

function sourceBranch(name, res, content = [{ v: name }]) {
  const contentDigest = digest(content);
  const ref = `ctx:sha256:${contentDigest}`;
  res.sources.set(ref, content);
  return {
    name, artifact: null, valueRef: null, schema: null,
    source: {
      kind: 'context_source', ref, digest: contentDigest,
      mediaType: 'application/vnd.baton.context-value+json', itemCount: content.length,
    },
  };
}

function packageFields(branches, overrides = {}) {
  return {
    schemaVersion: 1, kind: 'baton.context_package',
    branches,
    provenance: { runId: overrides.runId ?? 'run-a', principalId: overrides.principalId ?? 'principal-a' },
    policyDigest: policy.policyDigest,
    ...(overrides.packageDigest !== undefined ? { packageDigest: overrides.packageDigest } : {}),
  };
}

function refusalCode(fn) {
  try { fn(); return null; }
  catch (error) { return error?.code ?? error?.name ?? 'unknown_error'; }
}

// ==== F11.1 — provenance is hub-derived from the admission ledger event ====================

test('F11.1a: a submission carrying provenance.packageEvent is refused reserved_package_field', () => {
  const f = fixture('reserved-field');
  const fields = packageFields([artifactBranch('a', f.res)]);
  fields.provenance = {
    ...fields.provenance,
    packageEvent: { sourceEventSeq: 1, sourceEventDigest: '0'.repeat(64) },
  };
  assert.equal(
    refusalCode(() => f.store.admitContextPackage(fields, { actor: 'test', key: 'admit-1' })),
    'reserved_package_field',
    'a submitter-supplied packageEvent must be refused as a reserved field',
  );
  f.store.releaseWriterLease();
});

test('F11.1b: the admitted package packageEvent binds the real admission event', () => {
  const f = fixture('provenance-binding');
  const fields = packageFields([artifactBranch('a', f.res)]);
  const admitted = f.store.admitContextPackage(fields, { actor: 'test', key: 'admit-1' });
  assert.equal(admitted.package.provenance.packageEvent.sourceEventSeq, admitted.event.seq);
  assert.equal(
    admitted.package.provenance.packageEvent.sourceEventDigest, digest(admitted.event),
    'sourceEventDigest must hash the exact admission ledger event',
  );
  f.store.releaseWriterLease();
});

test('F11.1c: replay re-derives the identical packageEvent binding', () => {
  const f = fixture('provenance-replay');
  const fields = packageFields([artifactBranch('a', f.res)]);
  const admitted = f.store.admitContextPackage(fields, { actor: 'test', key: 'admit-1' });
  const before = f.store.contextPackage(admitted.package.packageDigest);
  f.store.releaseWriterLease();
  const replay = reopen(f);
  const after = replay.contextPackage(admitted.package.packageDigest);
  assert.deepEqual(after, before, 'replay must reproduce the identical provenance binding');
  replay.releaseWriterLease();
});

test('F11.1d: a tampered provenance binding raises package_provenance_integrity', () => {
  const f = fixture('provenance-tamper');
  const fields = packageFields([artifactBranch('a', f.res)]);
  const admitted = f.store.admitContextPackage(fields, { actor: 'test', key: 'admit-1' });
  const record = f.store._contextPackages.get(admitted.package.packageDigest);
  f.store._contextPackages.set(admitted.package.packageDigest, {
    ...record, admittedEvent: record.admittedEvent + 1_000,
  });
  assert.equal(
    refusalCode(() => f.store.contextPackage(admitted.package.packageDigest)),
    'package_provenance_integrity',
    'a projection whose admission binding no longer matches the ledger event must raise loudly',
  );
  f.store.releaseWriterLease();
});

// ==== F11.2 — normalizeContextPackage in the normalizeContextManifest mold =================

test('F11.2a: duplicate branch names are refused package_branch_name_conflict', () => {
  const f = fixture('dup-names');
  const branches = [
    artifactBranch('same', f.res, { v: 1 }), artifactBranch('same', f.res, { v: 2 }),
  ];
  assert.equal(
    refusalCode(() => f.store.admitContextPackage(packageFields(branches), { actor: 'test', key: 'admit-1' })),
    'package_branch_name_conflict',
  );
  f.store.releaseWriterLease();
});

test('F11.2b: an all-null branch is refused package_branch_empty', () => {
  const f = fixture('all-null-branch');
  const branches = [{ name: 'empty', source: null, artifact: null, valueRef: null, schema: null }];
  assert.equal(
    refusalCode(() => f.store.admitContextPackage(packageFields(branches), { actor: 'test', key: 'admit-1' })),
    'package_branch_empty',
  );
  f.store.releaseWriterLease();
});

test('F11.2c: a schema-only branch is refused package_branch_empty', () => {
  const f = fixture('schema-only-branch');
  const branches = [{
    name: 'schema-only', source: null, artifact: null, valueRef: null,
    schema: {
      kind: 'schema_ref', schemaId: `schema:${'a'.repeat(64)}`, name: 'demo', version: 1,
      digest: 'a'.repeat(64),
    },
  }];
  assert.equal(
    refusalCode(() => f.store.admitContextPackage(packageFields(branches), { actor: 'test', key: 'admit-1' })),
    'package_branch_empty',
    'a schema alone is not content',
  );
  f.store.releaseWriterLease();
});

test('F11.2d: branch count over the manifest-branch policy ceiling is refused', () => {
  const f = fixture('branch-ceiling');
  const branches = Array.from({ length: policy.maxManifestBranches + 1 }, (_, index) => ({
    name: `b${index}`, source: null, artifact: null, valueRef: null, schema: null,
  }));
  assert.equal(
    refusalCode(() => f.store.admitContextPackage(packageFields(branches), { actor: 'test', key: 'admit-1' })),
    'context_package_invalid',
  );
  f.store.releaseWriterLease();
});

test('F11.2e: a submitted packageDigest mismatch is refused (delete-and-recompute)', () => {
  const f = fixture('digest-mismatch');
  const fields = packageFields([artifactBranch('a', f.res)], { packageDigest: '0'.repeat(64) });
  assert.equal(
    refusalCode(() => f.store.admitContextPackage(fields, { actor: 'test', key: 'admit-1' })),
    'context_package_invalid',
  );
  f.store.releaseWriterLease();
});

test('F11.2f: a malformed valueRef branch is refused', () => {
  const f = fixture('malformed-valueref');
  const branches = [{
    name: 'bad-value', source: null, artifact: null, schema: null,
    valueRef: {
      kind: 'value_ref', valueId: 'pvalue:not-the-real-digest', artifactId: 'artifact:x',
      artifactDigest: 'a'.repeat(64), schemaId: `schema:${'b'.repeat(64)}`,
      valueDigest: 'c'.repeat(64), lineageDigest: 'd'.repeat(64),
    },
  }];
  assert.equal(
    refusalCode(() => f.store.admitContextPackage(packageFields(branches), { actor: 'test', key: 'admit-1' })),
    'context_package_invalid',
  );
  f.store.releaseWriterLease();
});

test('admission resolves each branch ref once and refuses when content is unavailable', () => {
  const f = fixture('admission-resolve');
  const branch = artifactBranch('a', f.res);
  f.res.artifacts.delete(branch.artifact.handle);
  assert.equal(
    refusalCode(() => f.store.admitContextPackage(packageFields([branch]), { actor: 'test', key: 'admit-1' })),
    'context_artifact_unavailable',
    'a package can never admit a branch whose content does not resolve',
  );
  f.store.releaseWriterLease();
});

test('a source-ref branch resolves through the existing context_source resolver', () => {
  const f = fixture('source-branch');
  const branch = sourceBranch('a', f.res);
  const admitted = f.store.admitContextPackage(packageFields([branch]), { actor: 'test', key: 'admit-1' });
  const resolved = f.store.resolveContextPackageBranch(admitted.package.packageDigest, 'a');
  assert.deepEqual(resolved.source, [{ v: 'a' }]);
  f.store.releaseWriterLease();
});

test('admitContextPackage replay: the same idempotency key replays without re-appending', () => {
  const f = fixture('admit-idempotent');
  const fields = packageFields([artifactBranch('a', f.res)]);
  const auth = { actor: 'test', key: 'admit-1' };
  const first = f.store.admitContextPackage(fields, auth);
  const second = f.store.admitContextPackage(fields, auth);
  assert.equal(second.result, 'idempotent');
  assert.equal(second.event.seq, first.event.seq);
  assert.deepEqual(second.package, first.package);
  f.store.releaseWriterLease();
});

test('admitting duplicate package content under a new idempotency key is refused', () => {
  const f = fixture('dup-content');
  const fields = packageFields([artifactBranch('a', f.res)]);
  f.store.admitContextPackage(fields, { actor: 'test', key: 'admit-1' });
  assert.equal(
    refusalCode(() => f.store.admitContextPackage(fields, { actor: 'test', key: 'admit-2' })),
    'context_package_conflict',
  );
  f.store.releaseWriterLease();
});

// ==== F11.3 — attach is a fenced O(1) pointer binding; resolve is the revalidation point ===

test('F11.3a: attach performs no byte re-read and is O(1) per scope', () => {
  const f = fixture('attach-o1');
  const branches = [artifactBranch('a', f.res), artifactBranch('b', f.res)];
  const admitted = f.store.admitContextPackage(packageFields(branches), { actor: 'test', key: 'admit-1' });
  assert.ok(f.res.calls.length > 0, 'admission resolves branch refs at least once');
  f.res.calls.length = 0;
  const packageDigest = admitted.package.packageDigest;
  const scopes = ['run', 'worker:role-a', 'board:board-a'];
  for (const scope of scopes) {
    const attached = f.store.attachContextPackage(
      { packageDigest, runId: 'run-a', scope },
      { actor: 'test', key: `package.attach:${packageDigest}:run-a:${scope}` },
    );
    assert.equal(attached.result, 'attached');
  }
  assert.equal(f.res.calls.length, 0, 'attach never re-reads branch bytes');
  const attachments = f.store.contextPackageAttachments('run-a');
  assert.equal(attachments.length, 3, 'three scopes are three cheap bindings, not three re-reads');
  assert.deepEqual(attachments.map((entry) => entry.scope).sort(), [...scopes].sort());
  f.store.releaseWriterLease();
});

test('F11.3b: a branch whose artifact bytes go missing settles context_artifact_unavailable at resolve time, not attach', () => {
  const f = fixture('resolve-missing');
  const branch = artifactBranch('a', f.res);
  const admitted = f.store.admitContextPackage(packageFields([branch]), { actor: 'test', key: 'admit-1' });
  const packageDigest = admitted.package.packageDigest;
  f.res.artifacts.delete(branch.artifact.handle);
  const attached = f.store.attachContextPackage(
    { packageDigest, runId: 'run-a', scope: 'run' },
    { actor: 'test', key: `package.attach:${packageDigest}:run-a:run` },
  );
  assert.equal(attached.result, 'attached', 'attach succeeds even though the branch bytes are now gone');
  assert.equal(
    refusalCode(() => f.store.resolveContextPackageBranch(packageDigest, 'a')),
    'context_artifact_unavailable',
    'missing bytes settle only at resolve time',
  );
  f.store.releaseWriterLease();
});

test('attachContextPackage replay: the same idempotency key replays without a second binding', () => {
  const f = fixture('attach-idempotent');
  const admitted = f.store.admitContextPackage(
    packageFields([artifactBranch('a', f.res)]), { actor: 'test', key: 'admit-1' },
  );
  const packageDigest = admitted.package.packageDigest;
  const auth = { actor: 'test', key: `package.attach:${packageDigest}:run-a:run` };
  const first = f.store.attachContextPackage({ packageDigest, runId: 'run-a', scope: 'run' }, auth);
  const second = f.store.attachContextPackage({ packageDigest, runId: 'run-a', scope: 'run' }, auth);
  assert.equal(second.result, 'idempotent');
  assert.equal(second.event.seq, first.event.seq);
  assert.equal(f.store.contextPackageAttachments('run-a').length, 1);
  f.store.releaseWriterLease();
});

test('attach refuses an unavailable package digest', () => {
  const f = fixture('attach-unavailable');
  const bogus = '0'.repeat(64);
  assert.equal(
    refusalCode(() => f.store.attachContextPackage(
      { packageDigest: bogus, runId: 'run-a', scope: 'run' },
      { actor: 'test', key: `package.attach:${bogus}:run-a:run` },
    )),
    'context_package_not_found',
  );
  f.store.releaseWriterLease();
});

// ==== Replay — packages replay byte-for-byte and are never relabeled =======================

test('replay: packages and their attachments replay byte-for-byte', () => {
  const f = fixture('replay-full');
  const branches = [artifactBranch('a', f.res), artifactBranch('b', f.res)];
  const admitted = f.store.admitContextPackage(packageFields(branches), { actor: 'test', key: 'admit-1' });
  const packageDigest = admitted.package.packageDigest;
  f.store.attachContextPackage(
    { packageDigest, runId: 'run-a', scope: 'run' },
    { actor: 'test', key: `package.attach:${packageDigest}:run-a:run` },
  );
  const beforePackage = f.store.contextPackage(packageDigest);
  const beforeAttachments = f.store.contextPackageAttachments('run-a');
  f.store.releaseWriterLease();

  const replay = reopen(f);
  assert.deepEqual(replay.contextPackage(packageDigest), beforePackage);
  assert.deepEqual(replay.contextPackageAttachments('run-a'), beforeAttachments);
  replay.releaseWriterLease();
});

// ==== Sanitization (Part D / F14) — untrusted branch content ===============================

test('sanitization: branch projections are redacted and provenance-marked', () => {
  const resolved = {
    name: 'a', schema: null, source: null,
    artifact: { secretText: 'password: super-secret-value-123456' },
    valueRef: null,
  };
  const projected = projectContextPackageBranch(resolved);
  assert.equal(projected.provenance, 'untrusted');
  assert.ok(
    !projected.artifact.includes('super-secret-value-123456'),
    'credential-shaped branch content must never reach the projection verbatim',
  );
  assert.match(projected.artifact, /credential-shaped content redacted/);
});

test('sanitization: branch projections are bounded like other attention text', () => {
  const resolved = {
    name: 'a', schema: null, source: 'x'.repeat(200_000), artifact: null, valueRef: null,
  };
  const projected = projectContextPackageBranch(resolved);
  assert.ok(
    Buffer.byteLength(projected.source) <= 4_096 + 4,
    'oversized branch content is bounded exactly like other worker-authored attention text',
  );
});
