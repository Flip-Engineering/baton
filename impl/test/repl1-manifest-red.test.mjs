// REPL-1 red suite (docs/reference/evidence/repl-kg-wave-2026-07-22/repl1-decisions.md).
//
// Pins the ReplManifest shape + digest basis (Part A), the `repl.manifest_admitted` authority
// record (Part B — lease-authenticated + run-pinned `shared`, wrapper-forced `worker`), the
// openSession/cell path without a Plan-gated dispatch (Part C), and the fold/replay surface
// (Part D). The evaluator (StatelessContextBench, the 14+4 whitelist) is untouched — authority
// layer only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import {
  DEFAULT_CONTEXT_PROGRAM_POLICY, DurableContextSession, StatelessContextBench,
  contextValueDigest, normalizeContextManifest, normalizeContextProgram,
  normalizeManifestAny, normalizeReplManifest,
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
const policyDigest = DEFAULT_CONTEXT_PROGRAM_POLICY.policyDigest;
const runLineagePolicy = Object.freeze({
  schemaVersion: 1, maxDepth: 3, maxChildrenPerRun: 2, maxDescendantsPerRoot: 4,
  leaseTtlMs: 60_000, maxReplManifestsPerRun: 4,
});

// A synthetic branch: normalizeReplManifest checks only that ref === ctx:sha256:<digest> and the
// bounds — it does NOT read bytes (that byte-proof lives in admitReplSession). So manifest-shape
// and manifest-admission tests need no real source.
function syntheticBranch(seed, name = 'repository') {
  const branchDigest = digest(`branch:${seed}`);
  return {
    name, ref: `ctx:sha256:${branchDigest}`, digest: branchDigest,
    mediaType: 'application/json', itemCount: 2, summary: `synthetic ${seed}`,
  };
}

function replManifest({ replRole, runId, seed = 'a', branch = syntheticBranch(seed) } = {}) {
  return {
    schemaVersion: 1, kind: 'baton.repl_manifest', repoId,
    tree: { sha: treeSha, source: 'deployment_snapshot' },
    repl: { replRole, runId },
    branches: [branch],
    policyDigest,
  };
}

const refusalCode = (fn) => {
  try { fn(); return null; } catch (error) { return error?.code ?? null; }
};

// ---------------------------------------------------------------- Part A: shape + digest basis

test('A1: normalizeReplManifest accepts shared and worker manifests and delete-and-recomputes digest', () => {
  for (const role of ['shared', 'worker:worker-alpha']) {
    const normalized = normalizeReplManifest(replManifest({ replRole: role, runId: 'run-a' }));
    assert.equal(normalized.kind, 'baton.repl_manifest');
    assert.equal(normalized.repl.replRole, role);
    assert.equal(normalized.repl.runId, 'run-a');
    assert.match(normalized.digest, /^[a-f0-9]{64}$/u);
    // supplied digest must equal the recomputed one; a mismatch is repl_manifest_invalid.
    assert.equal(normalizeReplManifest({ ...replManifest({ replRole: role, runId: 'run-a' }), digest: normalized.digest }).digest, normalized.digest);
    assert.equal(refusalCode(() => normalizeReplManifest({ ...replManifest({ replRole: role, runId: 'run-a' }), digest: 'f'.repeat(64) })), 'repl_manifest_invalid');
  }
});

test('A2: normalizeReplManifest refuses a workflow field, a missing repl, a bad role, and a context kind', () => {
  const bad = replManifest({ replRole: 'shared', runId: 'run-a' });
  assert.equal(refusalCode(() => normalizeReplManifest({ ...bad, workflow: { runId: 'run-a' } })), 'repl_manifest_invalid');
  const { repl, ...withoutRepl } = bad;
  void repl;
  assert.equal(refusalCode(() => normalizeReplManifest(withoutRepl)), 'repl_manifest_invalid');
  assert.equal(refusalCode(() => normalizeReplManifest(replManifest({ replRole: 'observer', runId: 'run-a' }))), 'repl_manifest_invalid');
  // deliberate narrowing vs SAFE_ID: a `:` inside the worker suffix is refused (P2-11).
  assert.equal(refusalCode(() => normalizeReplManifest(replManifest({ replRole: 'worker:a:b', runId: 'run-a' }))), 'repl_manifest_invalid');
  assert.equal(refusalCode(() => normalizeReplManifest({ ...bad, kind: 'baton.context_manifest' })), 'repl_manifest_invalid');
});

test('A3: disjoint digest basis — same tree+branches under the two kinds yield different digests', () => {
  const branch = syntheticBranch('shared-basis');
  const replDigest = normalizeReplManifest(replManifest({ replRole: 'shared', runId: 'run-a', branch })).digest;
  const workflowManifest = {
    schemaVersion: 1, kind: 'baton.context_manifest', repoId,
    tree: { sha: treeSha, source: 'deployment_snapshot' },
    workflow: {
      runId: 'run-a', definitionDigest: 'a'.repeat(64),
      goal: { goalId: 'goal-1', version: 1, digest: 'b'.repeat(64) },
      plan: { planId: `plan:${'c'.repeat(64)}`, version: 1, digest: 'd'.repeat(64) },
      node: { key: 'attempt:root', digest: 'e'.repeat(64) },
      task: { taskId: 'task-1', version: 1, createdEvent: 1, claimedEvent: 2 },
    },
    branches: [branch],
    policyDigest,
  };
  const workflowDigest = normalizeContextManifest(workflowManifest).digest;
  assert.notEqual(replDigest, workflowDigest);
});

test('A4: branch discipline rejects the same malformations manifestBranch rejects today', () => {
  // ref that does not match ctx:sha256:<digest>.
  const badRef = replManifest({ replRole: 'shared', runId: 'run-a', branch: { ...syntheticBranch('x'), ref: 'ctx:sha256:deadbeef' } });
  assert.ok(refusalCode(() => normalizeReplManifest(badRef)) !== null);
  // two branches with duplicate names.
  const dupe = replManifest({ replRole: 'shared', runId: 'run-a' });
  dupe.branches = [syntheticBranch('one', 'dup'), syntheticBranch('two', 'dup')];
  assert.equal(refusalCode(() => normalizeReplManifest(dupe)), 'repl_manifest_invalid');
});

test('A5: normalizeManifestAny dispatches both kinds and refuses a third kind', () => {
  assert.equal(normalizeManifestAny(replManifest({ replRole: 'shared', runId: 'run-a' })).kind, 'baton.repl_manifest');
  assert.equal(refusalCode(() => normalizeManifestAny({ kind: 'baton.something_else' })), 'context_manifest_invalid');
});

// ---------------------------------------------------------------- store fixture + lease helpers

function storeFixture(t, { maxReplManifestsPerRun } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'baton-repl1-'));
  const bench = new StatelessContextBench({
    artifactRoot: join(root, 'artifacts'), sources: {}, environmentDigest,
    policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
  });
  const policy = maxReplManifestsPerRun === undefined
    ? runLineagePolicy : { ...runLineagePolicy, maxReplManifestsPerRun };
  const store = new CoordinationStore(join(root, 'coordination'), {
    repoId, deploymentBaseSha: treeSha,
    contextProgramPolicy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    contextEnvironmentDigest: environmentDigest,
    contextReferenceIdentity: referenceIdentity,
    contextReferenceRead: (reference) => bench.readReference(reference),
    contextSourceAttest: () => { throw new Error('repl sessions do not attest'); },
    runLineagePolicy: policy,
    clock: () => '2026-07-18T08:00:00.000Z',
  });
  t.after(() => {
    try { store.releaseWriterLease(); } catch { /* already released */ }
    rmSync(root, { recursive: true, force: true });
  });
  return { store, bench, root };
}

function orchestratorLease(store, { runId, principalId = `orch-${runId}`, sessionId = `sess-${runId}` }) {
  const workerId = `worker-${runId}`;
  store.createTask({
    id: `task-${runId}`,
    brief: { objective: `orchestrate ${runId}`, capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'kimi-code', modelRequested: 'kimi-code/k3',
    modelPolicy: null, effortRequested: 'max', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${runId}` });
  const task = store.claimTask(`task-${runId}`, workerId, 1,
    { actor: 'orchestrator', key: `task.claimed:${runId}` }, {
      harnessRequested: 'kimi-code', harnessResolved: 'kimi-code@fixture', modelRequested: 'kimi-code/k3',
      modelResolved: 'kimi-code/k3', modelObserved: 'kimi-code/k3', effortRequested: 'max',
      effortResolved: 'max', effortObserved: 'max', routeKey: '["kimi-code","fixture","kimi-code/k3","max"]',
    }).task;
  const session = {
    principalId, sessionId,
    authorityDigest: digest({ kind: 'authenticated-worker-session', principalId, sessionId }),
    expiresAt: '2026-07-18T09:00:00.000Z',
  };
  const identity = {
    repoId, parentRunId: runId, parentTaskId: `task-${runId}`, parentTaskVersion: task.version,
    workerId: task.assignee, principalId, sessionId, sessionAuthorityDigest: session.authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${digest(identity)}`;
  return store.issueRunOrchestratorLease(
    { schemaVersion: 1, repoId, parentTask: { id: `task-${runId}`, version: task.version }, session },
    { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` },
  ).lease;
}

function sharedAuth(lease, key) {
  return {
    actor: `mcp:${lease.session.principalId}:${lease.session.sessionId}`,
    key, orchestratorLeaseId: lease.leaseId, principalId: lease.session.principalId,
    sessionId: lease.session.sessionId, sessionAuthorityDigest: lease.session.authorityDigest, repoId,
  };
}

const workerAuth = ({ principalId = 'worker-repl', runId, key, actor = 'worker-actor-1' }) => ({
  actor, key, principalId, repoId, runId,
});

const admit = (store, manifest, auth) => store.admitReplManifest(
  { manifest, manifestDigest: normalizeReplManifest(manifest).digest }, auth,
);

// ---------------------------------------------------------------- Part B: `repl.manifest_admitted`

test('B1: a shared admission with a run-pinned orchestrator lease succeeds and records the lease principal', (t) => {
  const { store } = storeFixture(t);
  const lease = orchestratorLease(store, { runId: 'run-shared' });
  const manifest = replManifest({ replRole: 'shared', runId: 'run-shared' });
  const result = admit(store, manifest, sharedAuth(lease, 'repl.manifest:shared:1'));
  assert.equal(result.result, 'admitted');
  assert.equal(result.record.replRole, 'shared');
  assert.equal(result.record.runId, 'run-shared');
  assert.equal(result.record.principal.principalId, lease.session.principalId);
  assert.equal(result.record.manifestDigest, normalizeReplManifest(manifest).digest);
});

test('B2: a shared manifest with no lease is repl_manifest_authority_denied', (t) => {
  const { store } = storeFixture(t);
  const manifest = replManifest({ replRole: 'shared', runId: 'run-shared' });
  const auth = { actor: 'mcp:x:y', key: 'k', orchestratorLeaseId: 'run-orchestrator-lease:missing', principalId: 'p', sessionId: 's', sessionAuthorityDigest: digest('x'), repoId };
  assert.equal(refusalCode(() => admit(store, manifest, auth)), 'repl_manifest_authority_denied');
});

test('B3: a lease for run X against a manifest for run Y is repl_manifest_authority_denied (P1-4 cross-run bleed)', (t) => {
  const { store } = storeFixture(t);
  const lease = orchestratorLease(store, { runId: 'run-x' });
  const manifest = replManifest({ replRole: 'shared', runId: 'run-y' });
  assert.equal(refusalCode(() => admit(store, manifest, sharedAuth(lease, 'k'))), 'repl_manifest_authority_denied');
});

test('B4: a worker:a caller admitting a worker:b manifest is repl_manifest_authority_denied (P1-5)', (t) => {
  const { store } = storeFixture(t);
  const manifest = replManifest({ replRole: 'worker:worker-b', runId: 'run-w' });
  const auth = workerAuth({ principalId: 'worker-a', runId: 'run-w', key: 'k' });
  assert.equal(refusalCode(() => admit(store, manifest, auth)), 'repl_manifest_authority_denied');
});

test('B5: a manifest whose recomputed digest differs from the payload manifestDigest is repl_manifest_digest_mismatch', (t) => {
  const { store } = storeFixture(t);
  const manifest = replManifest({ replRole: 'worker:worker-repl', runId: 'run-w' });
  const auth = workerAuth({ runId: 'run-w', key: 'k' });
  assert.equal(refusalCode(() => store.admitReplManifest({ manifest, manifestDigest: 'a'.repeat(64) }, auth)), 'repl_manifest_digest_mismatch');
});

test('B6: a caller repoId that differs from the store repoId is refused (P2-12 provenance pin)', (t) => {
  const { store } = storeFixture(t);
  const manifest = replManifest({ replRole: 'worker:worker-repl', runId: 'run-w' });
  const auth = { ...workerAuth({ runId: 'run-w', key: 'k' }), repoId: 'repo-other' };
  assert.equal(refusalCode(() => admit(store, manifest, auth)), 'repl_manifest_authority_denied');
});

test('B7: idempotency and the P1-6 divergent-principal conflict', (t) => {
  const { store } = storeFixture(t);
  const manifest = replManifest({ replRole: 'worker:worker-repl', runId: 'run-w' });
  const first = admit(store, manifest, workerAuth({ runId: 'run-w', key: 'k1', actor: 'worker-actor-1' }));
  assert.equal(first.result, 'admitted');
  // same key, same core → idempotent.
  assert.equal(admit(store, manifest, workerAuth({ runId: 'run-w', key: 'k1', actor: 'worker-actor-1' })).result, 'idempotent');
  // new key, identical core → idempotent (digest-level, not last-wins).
  assert.equal(admit(store, manifest, workerAuth({ runId: 'run-w', key: 'k2', actor: 'worker-actor-1' })).result, 'idempotent');
  // new key, divergent principal (actor) → repl_manifest_conflict.
  assert.equal(refusalCode(() => admit(store, manifest, workerAuth({ runId: 'run-w', key: 'k3', actor: 'worker-actor-2' }))), 'repl_manifest_conflict');
});

test('B8: the per-run ceiling refuses with repl_manifest_limit', (t) => {
  const { store } = storeFixture(t, { maxReplManifestsPerRun: 1 });
  const one = replManifest({ replRole: 'worker:worker-repl', runId: 'run-w', seed: 'one' });
  const two = replManifest({ replRole: 'worker:worker-repl', runId: 'run-w', seed: 'two' });
  assert.equal(admit(store, one, workerAuth({ runId: 'run-w', key: 'k1' })).result, 'admitted');
  assert.equal(refusalCode(() => admit(store, two, workerAuth({ runId: 'run-w', key: 'k2' }))), 'repl_manifest_limit');
});

// ---------------------------------------------------------------- Part C: session + cell path

const gitBlobOid = (text) => {
  const bytes = Buffer.from(text);
  return createHash('sha1').update(Buffer.from(`blob ${bytes.byteLength}\0`)).update(bytes).digest('hex');
};

function contextSource() {
  return [
    ['impl/src/a.mjs', 'alpha authority record'],
    ['impl/src/b.mjs', 'beta authority record'],
  ].map(([path, text]) => ({
    path, chunk: 0, gitBlobOid: gitBlobOid(text), byteStart: 0,
    byteEnd: Buffer.byteLength(text), contentDigest: contextValueDigest(text), language: 'mjs', text,
  }));
}

const REPL_RUN = 'run-c';
const REPL_PRINCIPAL = 'worker-repl';
const REPL_ACTOR = 'worker-actor-1';

function sessionFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-repl1-c-'));
  const source = contextSource();
  const sourceDigest = contextValueDigest(source);
  const sourceRef = `ctx:sha256:${sourceDigest}`;
  const bench = new StatelessContextBench({
    artifactRoot: join(root, 'artifacts'), sources: { [sourceRef]: source },
    environmentDigest, policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
  });
  const store = new CoordinationStore(join(root, 'coordination'), {
    repoId, deploymentBaseSha: treeSha,
    contextProgramPolicy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    contextEnvironmentDigest: environmentDigest,
    contextReferenceIdentity: referenceIdentity,
    contextReferenceRead: (reference) => bench.readReference(reference),
    contextSourceAttest: () => { throw new Error('repl sessions do not attest'); },
    runLineagePolicy: runLineagePolicy,
    clock: () => '2026-07-18T08:00:00.000Z',
  });
  const branch = {
    name: 'repository', ref: sourceRef, digest: sourceDigest,
    mediaType: 'application/json', itemCount: source.length, summary: 'two authority records',
  };
  const manifest = replManifest({ replRole: `worker:${REPL_PRINCIPAL}`, runId: REPL_RUN, branch });
  admit(store, manifest, workerAuth({ principalId: REPL_PRINCIPAL, runId: REPL_RUN, key: 'repl.manifest:c', actor: REPL_ACTOR }));
  const program = normalizeContextProgram({
    schemaVersion: 1, kind: 'baton.context_program',
    expression: { op: 'search', input: { op: 'source', branch: 'repository' }, query: 'authority', mode: 'case_insensitive' },
  });
  t.after(() => {
    try { store.releaseWriterLease(); } catch { /* already released */ }
    rmSync(root, { recursive: true, force: true });
  });
  return { store, bench, manifest, program, root };
}

const replPrincipal = { actor: REPL_ACTOR, principalId: REPL_PRINCIPAL, repoId, runId: REPL_RUN };

// The REPL session's cell caller authority (rule 12: only the admitting principal). The
// compute/settle of the cell is the REFLEX-4 Bench path (unchanged evaluator); REPL-1 owns the
// authority-layer guarantee that a pure Program is durably ADMITTED and digest-citable.
const cellAuth = (sessionId, program) => ({
  actor: REPL_ACTOR, principalId: REPL_PRINCIPAL, repoId, runId: REPL_RUN,
  key: `context.cell:${sessionId}:${program.programDigest}`,
});

function openReplSession(store, bench, manifest) {
  return new DurableContextSession({
    coordination: store, bench, manifest, principal: replPrincipal,
    admitSession: (fields, auth) => store.admitReplSession(fields, auth),
  });
}

test('C1: a session opens with NO Plan-gated dispatch and a pure Program is durably admitted as a digest-citable cell', (t) => {
  const { store, bench, manifest, program } = sessionFixture(t);
  const session = openReplSession(store, bench, manifest);
  assert.match(session.sessionId, /^context-session:[a-f0-9]{64}$/u);
  const admitted = store.admitContextCell({ sessionId: session.sessionId, program }, cellAuth(session.sessionId, program));
  assert.equal(admitted.result, 'admitted');
  assert.match(admitted.cell.cellId, /^cell:[a-f0-9]{64}$/u);
  assert.equal(store.contextCell(admitted.cell.cellId).state, 'admitted');
  // The session was opened against the admission record, with no goal/plan/dispatch/task at all —
  // a run that would fail context_session_stale / context_source_attestation_invalid in Workflow.
  assert.equal(store.snapshot().goalPlan, undefined);
});

test('C2: a cell admitted by a principal other than the admission principal is context_cell_unauthorized', (t) => {
  const { store, bench, manifest, program } = sessionFixture(t);
  const session = openReplSession(store, bench, manifest);
  assert.equal(refusalCode(() => store.admitContextCell(
    { sessionId: session.sessionId, program },
    { actor: 'intruder', principalId: 'intruder', repoId, runId: REPL_RUN, key: `context.cell:${session.sessionId}:${program.programDigest}` },
  )), 'context_cell_unauthorized');
});

test('C3: an unadmitted manifest digest is repl_session_unadmitted', (t) => {
  const { store, bench } = sessionFixture(t);
  const unadmitted = replManifest({ replRole: `worker:${REPL_PRINCIPAL}`, runId: REPL_RUN, seed: 'unadmitted' });
  assert.equal(refusalCode(() => openReplSession(store, bench, unadmitted)), 'repl_session_unadmitted');
});

test('C4: the same (session, program) cell is idempotent by the context.cell: key', (t) => {
  const { store, bench, manifest, program } = sessionFixture(t);
  const session = openReplSession(store, bench, manifest);
  const first = store.admitContextCell({ sessionId: session.sessionId, program }, cellAuth(session.sessionId, program));
  const second = store.admitContextCell({ sessionId: session.sessionId, program }, cellAuth(session.sessionId, program));
  assert.equal(second.result, 'idempotent');
  assert.equal(first.cell.cellId, second.cell.cellId);
});

// ---------------------------------------------------------------- Part D: fold + replay

test('D1: _apply folds repl.manifest_admitted into _replManifestAdmissions and snapshot().repl reflects it', (t) => {
  const { store } = storeFixture(t);
  const manifest = replManifest({ replRole: 'worker:worker-repl', runId: 'run-w' });
  const manifestDigest = normalizeReplManifest(manifest).digest;
  admit(store, manifest, workerAuth({ runId: 'run-w', key: 'k1' }));
  const record = store.replManifestAdmission(manifestDigest);
  assert.equal(record.manifestDigest, manifestDigest);
  assert.ok(Number.isSafeInteger(record.admittedEvent));
  const manifests = store.snapshot().repl.manifests;
  assert.equal(manifests.length, 1);
  assert.equal(manifests[0].manifestDigest, manifestDigest);
});

test('D2: a repl.manifest_admitted admitted after run.stop is refused run_stopping', (t) => {
  const { store } = storeFixture(t);
  orchestratorLease(store, { runId: 'run-stop' });
  const stopCore = { repoId, runId: 'run-stop', reasonDigest: digest('stop it') };
  store.admitRunStop({ schemaVersion: 1, ...stopCore, requestDigest: digest(stopCore) },
    { actor: 'operator:repl1', key: 'run.stop:run-stop' });
  const manifest = replManifest({ replRole: 'worker:worker-repl', runId: 'run-stop' });
  assert.equal(refusalCode(() => admit(store, manifest, workerAuth({ runId: 'run-stop', key: 'k1' }))), 'run_stopping');
});

test('D3: a checkpoint round-trip preserves the map', (t) => {
  const { store, root } = storeFixture(t);
  const manifest = replManifest({ replRole: 'worker:worker-repl', runId: 'run-w' });
  const manifestDigest = normalizeReplManifest(manifest).digest;
  admit(store, manifest, workerAuth({ runId: 'run-w', key: 'k1' }));
  store._writeProjectionCheckpoint();
  store.releaseWriterLease();
  const reopened = new CoordinationStore(join(root, 'coordination'), {
    repoId, deploymentBaseSha: treeSha,
    contextProgramPolicy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    contextEnvironmentDigest: environmentDigest, contextReferenceIdentity: referenceIdentity,
    contextReferenceRead: () => { throw new Error('unused'); },
    contextSourceAttest: () => { throw new Error('unused'); },
    runLineagePolicy, clock: () => '2026-07-18T08:00:00.000Z',
  });
  t.after(() => reopened.releaseWriterLease());
  assert.equal(reopened.replManifestAdmission(manifestDigest).manifestDigest, manifestDigest);
});

test('D4: replay symmetry — admit manifest+session+cell, reload from the ledger, projection rebuilds cleanly', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-repl1-replay-'));
  const source = contextSource();
  const sourceDigest = contextValueDigest(source);
  const sourceRef = `ctx:sha256:${sourceDigest}`;
  const bench = new StatelessContextBench({
    artifactRoot: join(root, 'artifacts'), sources: { [sourceRef]: source },
    environmentDigest, policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
  });
  const storeOptions = {
    repoId, deploymentBaseSha: treeSha,
    contextProgramPolicy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    contextEnvironmentDigest: environmentDigest, contextReferenceIdentity: referenceIdentity,
    contextReferenceRead: (reference) => bench.readReference(reference),
    contextSourceAttest: () => { throw new Error('unused'); },
    runLineagePolicy, clock: () => '2026-07-18T08:00:00.000Z',
  };
  const store = new CoordinationStore(join(root, 'coordination'), storeOptions);
  const branch = {
    name: 'repository', ref: sourceRef, digest: sourceDigest,
    mediaType: 'application/json', itemCount: source.length, summary: 'two authority records',
  };
  const manifest = replManifest({ replRole: `worker:${REPL_PRINCIPAL}`, runId: REPL_RUN, branch });
  const manifestDigest = normalizeReplManifest(manifest).digest;
  admit(store, manifest, workerAuth({ principalId: REPL_PRINCIPAL, runId: REPL_RUN, key: 'repl.manifest:replay', actor: REPL_ACTOR }));
  const program = normalizeContextProgram({
    schemaVersion: 1, kind: 'baton.context_program',
    expression: { op: 'search', input: { op: 'source', branch: 'repository' }, query: 'authority', mode: 'case_insensitive' },
  });
  const session = new DurableContextSession({
    coordination: store, bench, manifest, principal: replPrincipal,
    admitSession: (fields, auth) => store.admitReplSession(fields, auth),
  });
  const admitted = store.admitContextCell({ sessionId: session.sessionId, program }, {
    actor: REPL_ACTOR, principalId: REPL_PRINCIPAL, repoId, runId: REPL_RUN,
    key: `context.cell:${session.sessionId}:${program.programDigest}`,
  });
  store.releaseWriterLease();

  // Reload the store purely from the ledger: the manifest admission (lower seq) folds first, so
  // the session and cell rebuild with no context_session_integrity / unsupported_event_kind throw.
  const replay = new CoordinationStore(join(root, 'coordination'), storeOptions);
  t.after(() => {
    try { replay.releaseWriterLease(); } catch { /* already released */ }
    rmSync(root, { recursive: true, force: true });
  });
  assert.equal(replay.replManifestAdmission(manifestDigest).manifestDigest, manifestDigest);
  assert.equal(replay.contextSession(session.sessionId).state, 'active');
  assert.equal(replay.contextCell(admitted.cell.cellId).state, 'admitted');
});
