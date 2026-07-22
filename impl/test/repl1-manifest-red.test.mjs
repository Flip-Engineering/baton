// REPL-1 RED suite (docs/reference/evidence/repl-kg-wave-2026-07-22/repl1-decisions.md).
// ReplManifest (Part A) + normalizeManifestAny (rule 4a) + repl.manifest_admitted authority
// (Part B) + the admitReplSession/cell path and Workflow-non-wedge guards (Part C) + the fold
// surface and replay symmetry (Part D). The compute layer (StatelessContextBench, the 14 pure
// ops + 4 predicates) is untouched — this is authority/identity/fold only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import {
  DEFAULT_CONTEXT_PROGRAM_POLICY, DurableContextSession, StatelessContextBench,
  contextValueDigest, normalizeContextManifest, normalizeManifestAny, normalizeReplManifest,
} from '../src/context-program.mjs';

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

const repoId = 'repo-repl1';
const treeSha = '1'.repeat(40);
const environmentDigest = '4'.repeat(64);
const referenceIdentity = '9'.repeat(64);
const POLICY = DEFAULT_CONTEXT_PROGRAM_POLICY;
const CLOCK = '2026-07-18T20:00:00.000Z';
const SESSION_EXPIRES = '2026-07-18T21:00:00.000Z';

const gitBlobOid = (text) => {
  const bytes = Buffer.from(text);
  return createHash('sha1').update(Buffer.from(`blob ${bytes.byteLength}\0`)).update(bytes).digest('hex');
};
const source = [
  ['impl/src/context-program.mjs', 'durable context authority replay'],
  ['impl/src/coordination-store.mjs', 'append only replay authority'],
].map(([path, text]) => ({
  path, chunk: 0, gitBlobOid: gitBlobOid(text), byteStart: 0, byteEnd: Buffer.byteLength(text),
  contentDigest: contextValueDigest(text), language: 'mjs', text,
}));
const sourceDigest = contextValueDigest(source);
const sourceRef = `ctx:sha256:${sourceDigest}`;

function branch(name = 'repository') {
  return {
    name, ref: sourceRef, digest: sourceDigest, mediaType: 'application/json',
    itemCount: source.length, summary: 'immutable repl source',
  };
}

function replManifestValue({ replRole, runId, branchName = 'repository' }) {
  return {
    schemaVersion: 1, kind: 'baton.repl_manifest', repoId,
    tree: { sha: treeSha, source: 'deployment_snapshot' },
    repl: { replRole, runId },
    branches: [branch(branchName)],
    policyDigest: POLICY.policyDigest,
  };
}

function makeStore(t, { runLineagePolicy } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'baton-repl1-'));
  const artifactRoot = join(root, 'artifacts');
  const bench = new StatelessContextBench({
    artifactRoot, sources: { [sourceRef]: source }, environmentDigest, policy: POLICY,
  });
  const store = new CoordinationStore(join(root, 'coordination'), {
    repoId, deploymentBaseSha: treeSha, contextProgramPolicy: POLICY,
    contextEnvironmentDigest: environmentDigest, contextReferenceIdentity: referenceIdentity,
    contextReferenceRead: (reference) => bench.readReference(reference),
    contextSourceAttest: () => { throw new Error('REPL admission must not attest via Plan node'); },
    runLineagePolicy: runLineagePolicy ?? {
      schemaVersion: 1, maxDepth: 4, maxChildrenPerRun: 8,
      maxDescendantsPerRoot: 32, leaseTtlMs: 60 * 60 * 1_000,
    },
    clock: () => CLOCK,
  });
  t.after(() => {
    try { store.releaseWriterLease(); } catch { /* already released */ }
    rmSync(root, { recursive: true, force: true });
  });
  return { store, bench, root };
}

function orchestratorLease(store, { runId, label, principalId = `orch-${label}`, sessionId = `sess-${label}` }) {
  const taskId = `task-orch-${label}`;
  const workerId = `worker-orch-${label}`;
  store.createTask({
    id: taskId, brief: { objective: `Own ${runId}`, capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'mock', modelRequested: 'model-a',
    modelPolicy: null, effortRequested: 'low', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${taskId}` });
  const task = store.claimTask(taskId, workerId, 1,
    { actor: 'orchestrator', key: `task.claimed:${taskId}` }, {
      harnessRequested: 'mock', harnessResolved: 'mock@fix', modelRequested: 'model-a',
      modelResolved: 'model-a', modelObserved: 'model-a', effortRequested: 'low',
      effortResolved: 'low', effortObserved: 'low', routeKey: '["mock","fix","model-a","low"]',
    }).task;
  const session = {
    principalId, sessionId,
    authorityDigest: digest({ kind: 'authenticated-session', principalId, sessionId }),
    expiresAt: SESSION_EXPIRES,
  };
  const identity = {
    repoId, parentRunId: runId, parentTaskId: taskId, parentTaskVersion: task.version,
    workerId, principalId, sessionId, sessionAuthorityDigest: session.authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${digest(identity)}`;
  const lease = store.issueRunOrchestratorLease({
    schemaVersion: 1, repoId, parentTask: { id: taskId, version: task.version }, session,
  }, { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` }).lease;
  return {
    lease, session, principalId,
    auth: (key) => ({
      actor: 'mcp:orchestrator', key, orchestratorLeaseId: lease.leaseId,
      principalId, sessionId, sessionAuthorityDigest: session.authorityDigest,
    }),
  };
}

function refusal(fn) {
  try { fn(); return null; }
  catch (error) { return error?.code ?? error?.name ?? 'unknown'; }
}

// ---- Part A: ReplManifest shape + disjoint digest basis ----

test('A: normalizeReplManifest accepts shared and worker roles, deletes-and-recomputes digest', () => {
  const shared = normalizeReplManifest(replManifestValue({ replRole: 'shared', runId: 'run-a' }), POLICY);
  assert.equal(shared.kind, 'baton.repl_manifest');
  assert.equal(shared.repl.replRole, 'shared');
  assert.match(shared.digest, /^[a-f0-9]{64}$/u);
  const worker = normalizeReplManifest(replManifestValue({ replRole: 'worker:w1', runId: 'run-a' }), POLICY);
  assert.equal(worker.repl.replRole, 'worker:w1');
  // supplied-digest mismatch is refused
  assert.equal(refusal(() => normalizeReplManifest(
    { ...replManifestValue({ replRole: 'shared', runId: 'run-a' }), digest: 'b'.repeat(64) }, POLICY,
  )), 'repl_manifest_invalid');
});

test('A: normalizeReplManifest refuses workflow field, missing repl, bad roles, and context kind', () => {
  const base = replManifestValue({ replRole: 'shared', runId: 'run-a' });
  assert.equal(refusal(() => normalizeReplManifest({ ...base, workflow: {} }, POLICY)), 'repl_manifest_invalid');
  const noRepl = { ...base }; delete noRepl.repl;
  assert.equal(refusal(() => normalizeReplManifest(noRepl, POLICY)), 'repl_manifest_invalid');
  // a ':' inside the worker suffix is rejected — deliberately narrower than SAFE_ID (P2-11)
  assert.equal(refusal(() => normalizeReplManifest(
    replManifestValue({ replRole: 'worker:a:b', runId: 'run-a' }), POLICY)), 'repl_manifest_invalid');
  assert.equal(refusal(() => normalizeReplManifest(
    replManifestValue({ replRole: 'other', runId: 'run-a' }), POLICY)), 'repl_manifest_invalid');
  assert.equal(refusal(() => normalizeReplManifest(
    { ...base, kind: 'baton.context_manifest' }, POLICY)), 'repl_manifest_invalid');
});

test('A: byte-identical tree+branches under the two kinds yield different digests (disjoint basis)', () => {
  const repl = normalizeReplManifest(replManifestValue({ replRole: 'shared', runId: 'run-a' }), POLICY);
  // a context manifest sharing the same tree+branches carries a different digest basis
  const contextValue = {
    schemaVersion: 1, kind: 'baton.context_manifest', repoId,
    tree: { sha: treeSha, source: 'deployment_snapshot' },
    workflow: {
      runId: 'run-a', definitionDigest: 'a'.repeat(64),
      goal: { goalId: 'goal-a', version: 1, digest: 'b'.repeat(64) },
      plan: { planId: `plan:${'c'.repeat(64)}`, version: 1, digest: 'd'.repeat(64) },
      node: { key: 'attempt:root', digest: 'e'.repeat(64) },
      task: { taskId: 'task-a', version: 1, createdEvent: 1, claimedEvent: 2 },
    },
    branches: [branch()], policyDigest: POLICY.policyDigest,
  };
  const context = normalizeContextManifest(contextValue, POLICY);
  assert.notEqual(repl.digest, context.digest);
});

test('A: normalizeManifestAny dispatches both kinds and refuses a third', () => {
  assert.equal(normalizeManifestAny(replManifestValue({ replRole: 'shared', runId: 'run-a' }), POLICY).kind,
    'baton.repl_manifest');
  assert.equal(refusal(() => normalizeManifestAny({ kind: 'baton.other' }, POLICY)), 'context_manifest_invalid');
});

// ---- Part B: repl.manifest_admitted authority ----

test('B: shared admission requires a run-pinned orchestrator lease and records the lease principal', (t) => {
  const { store } = makeStore(t);
  const orch = orchestratorLease(store, { runId: 'run-shared', label: 'b1' });
  const manifest = replManifestValue({ replRole: 'shared', runId: 'run-shared' });
  const digest0 = normalizeReplManifest(manifest, POLICY).digest;
  const ok = store.admitReplManifest({
    schemaVersion: 1, manifest, manifestDigest: digest0, runId: 'run-shared', replRole: 'shared',
  }, orch.auth('repl.manifest:shared:1'));
  assert.equal(ok.result, 'admitted');
  assert.equal(ok.record.principal.principalId, orch.principalId);
  assert.equal(ok.record.runId, 'run-shared');
  // same manifest with no lease is refused
  assert.equal(refusal(() => store.admitReplManifest({
    schemaVersion: 1, manifest: replManifestValue({ replRole: 'shared', runId: 'run-shared' }),
    manifestDigest: digest0, runId: 'run-shared', replRole: 'shared',
  }, { actor: 'x', key: 'repl.manifest:nolease' })), 'repl_manifest_authority_denied');
});

test('B: a lease for run X cannot authenticate a manifest for run Y (P1-4 cross-run bleed)', (t) => {
  const { store } = makeStore(t);
  const orch = orchestratorLease(store, { runId: 'run-X', label: 'b2' });
  const manifestY = replManifestValue({ replRole: 'shared', runId: 'run-Y' });
  const digestY = normalizeReplManifest(manifestY, POLICY).digest;
  assert.equal(refusal(() => store.admitReplManifest({
    schemaVersion: 1, manifest: manifestY, manifestDigest: digestY, runId: 'run-Y', replRole: 'shared',
  }, orch.auth('repl.manifest:crossrun'))), 'repl_manifest_authority_denied');
});

test('B: a worker cannot admit another worker\'s layer (P1-5) and digest/repoId pins hold', (t) => {
  const { store } = makeStore(t);
  const manifestB = replManifestValue({ replRole: 'worker:w-b', runId: 'run-w' });
  const digestB = normalizeReplManifest(manifestB, POLICY).digest;
  // worker w-a threaded by the wrapper admitting worker:w-b layer -> denied by store equality
  assert.equal(refusal(() => store.admitReplManifest({
    schemaVersion: 1, manifest: manifestB, manifestDigest: digestB, runId: 'run-w', replRole: 'worker:w-b',
  }, { actor: 'worker', key: 'repl.manifest:wa', principalId: 'w-a', repoId, runId: 'run-w' })),
  'repl_manifest_authority_denied');
  // digest mismatch
  assert.equal(refusal(() => store.admitReplManifest({
    schemaVersion: 1, manifest: manifestB, manifestDigest: 'a'.repeat(64), runId: 'run-w', replRole: 'worker:w-b',
  }, { actor: 'worker', key: 'repl.manifest:wb', principalId: 'w-b', repoId, runId: 'run-w' })),
  'repl_manifest_digest_mismatch');
  // repoId provenance pin (P2-12)
  assert.equal(refusal(() => store.admitReplManifest({
    schemaVersion: 1, manifest: manifestB, manifestDigest: digestB, runId: 'run-w', replRole: 'worker:w-b',
  }, { actor: 'worker', key: 'repl.manifest:wc', principalId: 'w-b', repoId: 'repo-other', runId: 'run-w' })),
  'repl_manifest_authority_denied');
  // the owning worker succeeds
  const ok = store.admitReplManifest({
    schemaVersion: 1, manifest: manifestB, manifestDigest: digestB, runId: 'run-w', replRole: 'worker:w-b',
  }, { actor: 'worker', key: 'repl.manifest:wd', principalId: 'w-b', repoId, runId: 'run-w' });
  assert.equal(ok.result, 'admitted');
  assert.equal(ok.record.replRole, 'worker:w-b');
});

test('B: key-level and new-key idempotency (P1-6)', (t) => {
  const { store } = makeStore(t);
  const manifest = replManifestValue({ replRole: 'worker:w1', runId: 'run-i' });
  const d = normalizeReplManifest(manifest, POLICY).digest;
  const auth = (key) => ({ actor: 'worker', key, principalId: 'w1', repoId, runId: 'run-i' });
  assert.equal(store.admitReplManifest({ schemaVersion: 1, manifest, manifestDigest: d, runId: 'run-i', replRole: 'worker:w1' }, auth('k1')).result, 'admitted');
  // same key, identical core -> idempotent
  assert.equal(store.admitReplManifest({ schemaVersion: 1, manifest, manifestDigest: d, runId: 'run-i', replRole: 'worker:w1' }, auth('k1')).result, 'idempotent');
  // a NEW key, identical core -> idempotent (digest-level), never a second append
  assert.equal(store.admitReplManifest({ schemaVersion: 1, manifest, manifestDigest: d, runId: 'run-i', replRole: 'worker:w1' }, auth('k2')).result, 'idempotent');
  // a key rebind under a divergent actor is a conflict, never a silent overwrite
  assert.equal(refusal(() => store.admitReplManifest(
    { schemaVersion: 1, manifest, manifestDigest: d, runId: 'run-i', replRole: 'worker:w1' },
    { actor: 'worker-other', key: 'k1', principalId: 'w1', repoId, runId: 'run-i' },
  )), 'repl_manifest_conflict');
});

test('B: the digest-level conflict gate refuses a divergent principal (P1-6 last-wins fix)', (t) => {
  const { store } = makeStore(t);
  // two orchestrator leases on the SAME run, distinct principals, admit the SAME shared digest.
  const orchA = orchestratorLease(store, { runId: 'run-two', label: 'A', principalId: 'orch-A', sessionId: 'sess-A' });
  const orchB = orchestratorLease(store, { runId: 'run-two', label: 'B', principalId: 'orch-B', sessionId: 'sess-B' });
  const manifest = replManifestValue({ replRole: 'shared', runId: 'run-two' });
  const d = normalizeReplManifest(manifest, POLICY).digest;
  const fields = { schemaVersion: 1, manifest, manifestDigest: d, runId: 'run-two', replRole: 'shared' };
  assert.equal(store.admitReplManifest(fields, orchA.auth('repl.manifest:two:A')).result, 'admitted');
  // same digest, different key, DIVERGENT principal -> conflict (never last-wins that shifts the
  // principal under an existing session).
  assert.equal(refusal(() => store.admitReplManifest(fields, orchB.auth('repl.manifest:two:B'))),
    'repl_manifest_conflict');
  // re-admitting under a new key with the SAME (orchA) principal is idempotent.
  assert.equal(store.admitReplManifest(fields, orchA.auth('repl.manifest:two:A2')).result, 'idempotent');
});

test('B: the per-run ceiling refuses with repl_manifest_limit', (t) => {
  const { store } = makeStore(t, {
    runLineagePolicy: {
      schemaVersion: 1, maxDepth: 4, maxChildrenPerRun: 1,
      maxDescendantsPerRoot: 4, leaseTtlMs: 60 * 60 * 1_000,
    },
  });
  // ceiling = maxChildrenPerRun + 1 = 2
  const admit = (suffix) => {
    const m = replManifestValue({ replRole: `worker:${suffix}`, runId: 'run-cap' });
    const d = normalizeReplManifest(m, POLICY).digest;
    return store.admitReplManifest(
      { schemaVersion: 1, manifest: m, manifestDigest: d, runId: 'run-cap', replRole: `worker:${suffix}` },
      { actor: 'worker', key: `repl.manifest:${suffix}`, principalId: suffix, repoId, runId: 'run-cap' });
  };
  assert.equal(admit('w1').result, 'admitted');
  assert.equal(admit('w2').result, 'admitted');
  assert.equal(refusal(() => admit('w3')), 'repl_manifest_limit');
});

// ---- Part C: session + cell path, and the Workflow-non-wedge guard ----

function admitWorkerManifest(store, { runId, principalId, key }) {
  const manifest = replManifestValue({ replRole: `worker:${principalId}`, runId });
  const d = normalizeReplManifest(manifest, POLICY).digest;
  const admitted = store.admitReplManifest(
    { schemaVersion: 1, manifest, manifestDigest: d, runId, replRole: `worker:${principalId}` },
    { actor: 'worker', key, principalId, repoId, runId });
  return { manifest, digest: d, record: admitted.record };
}

test('C: a ReplManifest opens a durable session and a pure Program evaluates to a citable cell', (t) => {
  const { store, bench } = makeStore(t);
  const { manifest, record } = admitWorkerManifest(store, { runId: 'run-s', principalId: 'w1', key: 'repl.manifest:s' });
  const principal = {
    actor: record.principal.actor, principalId: record.principal.principalId,
    repoId, runId: 'run-s',
  };
  const session = new DurableContextSession({
    coordination: store, bench, manifest, principal,
    admitSession: (fields, auth) => store.admitReplSession(fields, auth),
  });
  assert.match(session.sessionId, /^context-session:[a-f0-9]{64}$/u);
  const cell = session.search('authority');
  assert.equal(cell.state, 'completed');
  assert.match(cell.cellId, /^cell:[a-f0-9]{64}$/u);
  // idempotent by the deterministic context.cell key
  const again = session.search('authority');
  assert.equal(again.cellId, cell.cellId);
});

test('C: an unadmitted manifest is repl_session_unadmitted; a foreign principal is context_cell_unauthorized', (t) => {
  const { store, bench } = makeStore(t);
  // unadmitted
  const unadmitted = replManifestValue({ replRole: 'worker:ghost', runId: 'run-u' });
  assert.equal(refusal(() => store.admitReplSession(
    { manifest: unadmitted, environmentDigest }, { actor: 'x', principalId: 'ghost', repoId, runId: 'run-u', key: 'k' },
  )), 'repl_session_unadmitted');
  // admit, open, then a foreign principal cell is rejected at the caller-principal pin
  const { manifest, record } = admitWorkerManifest(store, { runId: 'run-u2', principalId: 'w1', key: 'repl.manifest:u2' });
  const admitted = store.admitReplSession(
    { manifest, environmentDigest },
    { actor: record.principal.actor, principalId: record.principal.principalId, repoId, runId: 'run-u2', key: `context.session:${record.manifestDigest}` });
  const program = {
    schemaVersion: 1, kind: 'baton.context_program',
    expression: { op: 'search', input: { op: 'source', branch: 'repository' }, query: 'authority', mode: 'case_insensitive' },
  };
  assert.equal(refusal(() => store.admitContextCell(
    { sessionId: admitted.session.sessionId, program },
    { actor: 'intruder', principalId: 'intruder', repoId, runId: 'run-u2', key: 'context.cell:intruder' },
  )), 'context_cell_unauthorized');
});

test('C (P1-7): a live REPL session does not wedge Workflow session scans', (t) => {
  const { store, bench } = makeStore(t);
  const { manifest, record } = admitWorkerManifest(store, { runId: 'run-coexist', principalId: 'w1', key: 'repl.manifest:coexist' });
  new DurableContextSession({
    coordination: store, bench, manifest, principal: {
      actor: record.principal.actor, principalId: record.principal.principalId, repoId, runId: 'run-coexist',
    },
    admitSession: (fields, auth) => store.admitReplSession(fields, auth),
  });
  // the REPL session rides the shared session list; a Workflow-oriented snapshot scan that
  // dereferences `.workflow.*` on every session must not throw a bare TypeError.
  const sessions = store.snapshot().context.sessions;
  assert.ok(sessions.some((s) => s.manifest.kind === 'baton.repl_manifest'));
  assert.doesNotThrow(() => sessions
    .filter((s) => s.manifest.kind === 'baton.context_manifest')
    .map((s) => s.manifest.workflow.plan.digest));
});

// ---- Part D: fold + replay ----

test('D: repl.manifest_admitted folds into _replManifestAdmissions and snapshot.repl.manifests', (t) => {
  const { store } = makeStore(t);
  admitWorkerManifest(store, { runId: 'run-f', principalId: 'w1', key: 'repl.manifest:f' });
  const snap = store.snapshot();
  assert.ok(snap.repl && Array.isArray(snap.repl.manifests) && snap.repl.manifests.length === 1);
  assert.equal(snap.repl.manifests[0].replRole, 'worker:w1');
});

test('D: a repl.manifest_admitted appended after run.stop throws run_stopping at fold (rule 14)', (t) => {
  const { store } = makeStore(t);
  // register the run (a claimed task) so admitRunStop recognizes it, then stop it.
  store.createTask({
    id: 'task-stopped', brief: { objective: 'own run-stopped', capabilities: [] },
    deps: [], refines: null, relation: 'root', runId: 'run-stopped', taskType: 'general',
    reservedWorkerId: 'worker-stopped', vendorRequested: 'mock', modelRequested: 'model-a',
    modelPolicy: null, effortRequested: 'low', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: 'task.created:task-stopped' });
  store.admitRunStop({
    schemaVersion: 1, repoId, runId: 'run-stopped',
    reasonDigest: digest('stop'), requestDigest: digest({ repoId, runId: 'run-stopped', reasonDigest: digest('stop') }),
  }, { actor: 'direct:operator', key: 'run.stop:run-stopped' });
  const principal = { actor: 'worker', principalId: 'w1' };
  const payload = {
    schemaVersion: 1, manifestDigest: 'a'.repeat(64), runId: 'run-stopped', replRole: 'worker:w1',
    principal, requestDigest: digest({ manifestDigest: 'a'.repeat(64), runId: 'run-stopped', replRole: 'worker:w1', principal }),
  };
  assert.equal(refusal(() => store._apply({
    schemaVersion: 1, seq: store.snapshot().lastSeq + 1, ts: CLOCK,
    kind: 'repl.manifest_admitted', actor: 'worker', idempotencyKey: 'x', payload,
  })), 'run_stopping');
});

test('D: an undeclared repl.* kind still throws unsupported_event_kind', (t) => {
  const { store } = makeStore(t);
  assert.equal(refusal(() => store._apply({
    schemaVersion: 1, seq: store.snapshot().lastSeq + 1, ts: CLOCK,
    kind: 'repl.binding_set', actor: 'x', idempotencyKey: 'x', payload: {},
  })), 'unsupported_event_kind');
});

test('D (P1-8): replay symmetry — admit manifest+session+cell, reload from the ledger, rebuild', (t) => {
  const { store, bench, root } = makeStore(t);
  const { manifest, record } = admitWorkerManifest(store, { runId: 'run-r', principalId: 'w1', key: 'repl.manifest:r' });
  const session = new DurableContextSession({
    coordination: store, bench, manifest, principal: {
      actor: record.principal.actor, principalId: record.principal.principalId, repoId, runId: 'run-r',
    },
    admitSession: (fields, auth) => store.admitReplSession(fields, auth),
  });
  const cell = session.search('authority');
  assert.equal(cell.state, 'completed');
  store.releaseWriterLease();
  // reload the store from the same ledger — every event re-applies, no integrity throw.
  const reloadBench = new StatelessContextBench({
    artifactRoot: join(root, 'artifacts'), sources: { [sourceRef]: source }, environmentDigest, policy: POLICY,
  });
  const reloaded = new CoordinationStore(join(root, 'coordination'), {
    repoId, deploymentBaseSha: treeSha, contextProgramPolicy: POLICY,
    contextEnvironmentDigest: environmentDigest, contextReferenceIdentity: referenceIdentity,
    contextReferenceRead: (reference) => reloadBench.readReference(reference),
    contextSourceAttest: () => { throw new Error('unused'); },
    runLineagePolicy: {
      schemaVersion: 1, maxDepth: 4, maxChildrenPerRun: 8,
      maxDescendantsPerRoot: 32, leaseTtlMs: 60 * 60 * 1_000,
    },
    clock: () => CLOCK,
  });
  t.after(() => { try { reloaded.releaseWriterLease(); } catch { /* ignore */ } });
  const snap = reloaded.snapshot();
  assert.equal(snap.repl.manifests.length, 1);
  assert.ok(snap.context.sessions.some((s) => s.sessionId === session.sessionId));
  assert.ok(snap.context.cells.some((c) => c.cellId === cell.cellId && c.state === 'completed'));
});
