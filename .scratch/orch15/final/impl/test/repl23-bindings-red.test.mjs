// REPL-2 (bindings) + REPL-3 (`cell:` branch composition) red suite
// (docs/reference/evidence/repl-kg-wave-2026-07-22/repl23-decisions.md, issues #22/#23).
//
// Integrated with REPL-1's real admission machinery (a208c13+): manifests are admitted through
// the full ReplManifest authority path (normalizeReplManifest + orchestrator-lease shared /
// wrapper worker principals), with REPL-3's `cell:` raw branches resolved by the
// pre-normalization splice into `_resolveReplManifestBranch` (settled-only, hub-computed
// coordinates baked into the event payload for zero-lookup replay). REPL-2's
// `repl.binding_set`/`repl.binding_dropped` are exercised against the real contract shapes.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { projectReplBindingView } from '../src/application.mjs';
import {
  DEFAULT_CONTEXT_PROGRAM_POLICY, StatelessContextBench, contextValueDigest,
  normalizeContextManifest, normalizeContextProgram,
} from '../src/context-program.mjs';

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const gitBlobOid = (text) => {
  const bytes = Buffer.from(text);
  return createHash('sha1').update(Buffer.from(`blob ${bytes.byteLength}\0`)).update(bytes).digest('hex');
};

const repoId = 'repo-repl23';
const runId = 'run-repl23';
const treeSha = '2'.repeat(40);
const environmentDigest = '5'.repeat(64);
const referenceIdentity = '8'.repeat(64);
const route = Object.freeze({ vendor: 'stub', model: 'stub-model', effort: 'high' });
const goalPlanPolicy = Object.freeze({
  schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 3_600_000,
  riskClasses: ['low'], effectClasses: ['provider_call'], capabilityClasses: ['analysis', 'baton_orchestrator'],
  limits: Object.freeze({
    maxGoalVersions: 8, maxPlanVersions: 8, maxNodes: 8, maxDepsPerNode: 8,
    maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 16,
    maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 1_000, maxProviderTurns: 1_000,
  }),
});
const verification = Object.freeze({
  command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'],
  expectExit: 0, expectResult: 'exit_code', timeoutMs: 60_000,
  maxOutputBytes: 1_000_000, requiredPredecessorEvidence: [],
});
const contextAuth = (principalId, key) => ({
  actor: `direct:${principalId}`, principalId, repoId, runId, key,
  sessionDigest: digest(`session:${principalId}`),
});
const ref = (kind, value) => ({
  [`${kind}Id`]: value[`${kind}Id`], version: value.version, digest: value.digest,
});
/** REPL-2/3 auth: `admitReplManifest`/`admitReplBinding`/`dropReplBinding` only ever read
 * `{actor, principalId}` off the caller's auth (repl23-decisions.md Part B rule 4(c)) — never
 * the 4-field context authority tuple. */
const replAuth = (principalId, key) => ({ actor: `direct:${principalId}`, principalId, key });

function fixture(t, name) {
  const root = mkdtempSync(join(tmpdir(), `baton-repl23-${name}-`));
  const artifactRoot = join(root, 'artifacts');
  const source = [
    ['impl/src/context-program.mjs', 'durable context cell authority for repl23'],
  ].map((entry) => ({
    path: entry[0], chunk: 0, gitBlobOid: gitBlobOid(entry[1]), byteStart: 0,
    byteEnd: Buffer.byteLength(entry[1]), contentDigest: contextValueDigest(entry[1]),
    language: 'mjs', text: entry[1],
  }));
  const sourceDigest = contextValueDigest(source);
  const sourceRef = `ctx:sha256:${sourceDigest}`;
  const bench = new StatelessContextBench({
    artifactRoot, sources: { [sourceRef]: source }, environmentDigest,
    policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
  });
  const storeOptions = {
    repoId, deploymentBaseSha: treeSha, goalPlanPolicy,
    contextProgramPolicy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    runLineagePolicy: Object.freeze({
      schemaVersion: 1, maxDepth: 3, maxChildrenPerRun: 2, maxDescendantsPerRoot: 4,
      leaseTtlMs: 60_000, maxReplManifestsPerRun: 8,
    }),
    contextEnvironmentDigest: environmentDigest,
    contextReferenceIdentity: referenceIdentity,
    contextReferenceRead: (reference) => bench.readReference(reference),
    contextSourceAttest: ({ manifest, branch, source: admittedSource }) => {
      const proofCoordinates = admittedSource.map((item) => ({
        path: item.path, chunk: item.chunk, gitBlobOid: item.gitBlobOid,
        byteStart: item.byteStart, byteEnd: item.byteEnd, contentDigest: item.contentDigest,
      }));
      const core = {
        schemaVersion: 1, kind: 'baton.context_source_attestation',
        producerIdentity: referenceIdentity, treeSha: manifest.tree.sha,
        nodeDigest: manifest.workflow.node.digest,
        scopeDigest: contextValueDigest(['impl/**']), branch: branch.name,
        sourceRef: branch.ref, sourceDigest: branch.digest, itemCount: branch.itemCount,
        proofDigest: contextValueDigest(proofCoordinates),
        coverage: {
          listedEntries: admittedSource.length, outsideScopeEntries: 0,
          scopedEntries: admittedSource.length, includedFiles: admittedSource.length,
          includedItems: admittedSource.length, excludedSensitivePaths: 0,
          excludedUnsupportedTypes: 0, excludedBinaryOrInvalidText: 0,
          excludedOversizeFiles: 0, excludedSensitiveContent: 0, complete: true,
        },
      };
      return { ...core, receiptDigest: contextValueDigest(core) };
    },
    clock: () => '2026-07-22T20:00:00.000Z',
  };
  const store = new CoordinationStore(join(root, 'coordination'), storeOptions);
  const goal = store.defineGoal({
    objective: 'Bind and compose addressed context (repl23)',
    definitionOfDone: ['bindings and cell: composition are durably replayable'],
    constraints: ['No provider effect'], risk: 'low',
    budget: { tokens: 10_000, usd: 1, wallMin: 10, providerTurns: 2 },
    predecessor: null,
  }, contextAuth('goal-owner', `${name}:goal`)).goal;
  const plan = store.proposePlan({
    goal: ref('goal', goal), predecessor: null,
    nodes: [{
      key: 'attempt:root', objective: 'Run the addressed pure Context Program',
      definitionOfDone: goal.definitionOfDone, deps: [], pathScope: ['impl/**'], risk: 'low',
      budget: { tokens: 10_000, usd: 1, wallMin: 10, providerTurns: 2 }, verification,
      routes: { harnesses: [route.vendor], models: [route.model], efforts: [route.effort] },
      capabilities: ['analysis', 'baton_orchestrator'], effects: ['provider_call'],
    }],
  }, contextAuth('planner', `${name}:plan`)).plan;
  store.approvePlan({
    goal: ref('goal', goal), plan: ref('plan', plan), expectedDisposition: null,
    disposition: 'approved',
  }, contextAuth('approver', `${name}:approve`));
  const node = plan.nodes[0];
  const gate = {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey: node.key, expectedDispatchVersion: 0,
    capabilities: node.capabilities, effects: node.effects,
  };
  const preview = store.previewPlanDispatch(gate, route);
  const taskId = `task-${name}`;
  store.createPlanGatedTask({
    id: taskId, brief: preview.brief, deps: [], refines: null, runId,
    taskType: 'general', reservedWorkerId: `worker-${name}`, vendorRequested: route.vendor,
    modelRequested: route.model, modelPolicy: null, effortRequested: route.effort,
    effortResolved: null, effortObserved: null, routeKey: null, sessionRequest: { mode: 'new' },
  }, gate, route, contextAuth('dispatcher', `${name}:dispatch`));
  store.claimTask(taskId, `worker-${name}`, 1,
    { actor: 'orchestrator', key: `${name}:claim` }, {
      harnessRequested: route.vendor, harnessResolved: 'stub@1', modelRequested: route.model,
      modelResolved: route.model, modelObserved: route.model, effortRequested: route.effort,
      effortResolved: route.effort, effortObserved: route.effort, routeKey: 'route:stub',
    });
  const task = store.task(taskId);
  const definitionCore = { schemaVersion: 1, repoId, runId, goalDigest: goal.digest, planDigest: plan.digest };
  const definitionDigest = digest(definitionCore);
  store.recordDriver('application.workflow_definition_bound', {
    ...definitionCore, definitionDigest,
  }, {
    actor: 'application:workflow-registry',
    key: `application.workflow_definition_bound:${runId}:${plan.digest}`,
  });
  const manifest = normalizeContextManifest({
    schemaVersion: 1, kind: 'baton.context_manifest', repoId,
    tree: { sha: treeSha, source: 'deployment_snapshot' },
    workflow: {
      runId, definitionDigest, goal: ref('goal', goal), plan: ref('plan', plan),
      node: { key: node.key, digest: contextValueDigest(node) },
      task: { taskId, version: task.version, createdEvent: task.createdEvent, claimedEvent: task.claimedEvent },
    },
    branches: [{
      name: 'repository', ref: sourceRef, summary: 'one addressed implementation symbol',
      digest: sourceDigest, mediaType: 'application/json', itemCount: source.length,
    }],
    policyDigest: DEFAULT_CONTEXT_PROGRAM_POLICY.policyDigest,
  });
  const principal = { actor: 'direct:context-root', principalId: 'context-root', repoId, runId };
  const cleanup = () => { store.releaseWriterLease(); rmSync(root, { recursive: true, force: true }); };
  t.after(cleanup);
  return { root, artifactRoot, store, storeOptions, bench, manifest, goal, plan, task, principal, cleanup };
}

function admitSession(f) {
  return f.store.admitContextSession({
    manifest: f.manifest, environmentDigest: f.bench.environmentDigest,
  }, contextAuth('context-root', `context.session:${f.manifest.digest}`));
}

function programFor(queryText) {
  return normalizeContextProgram({
    schemaVersion: 1, kind: 'baton.context_program',
    expression: { op: 'search', input: { op: 'source', branch: 'repository' }, query: queryText, mode: 'case_insensitive' },
  });
}

function admitCell(f, session, program) {
  return f.store.admitContextCell({ sessionId: session.session.sessionId, program },
    contextAuth('context-root', `context.cell:${session.session.sessionId}:${program.programDigest}`));
}

function completion(result) {
  return {
    state: 'completed', providerEffects: result.providerEffects,
    outputRef: result.outputRef, evidenceRef: result.evidenceRef,
    sourceCoordinateCount: result.sourceCoordinateCount, coordinateDigest: result.coordinateDigest,
  };
}

/** Admits + settles a fresh completed cell (a distinct query text mints a distinct cellId). */
function completedCell(f, session, queryText) {
  const program = programFor(queryText);
  const admitted = admitCell(f, session, program);
  const computed = f.bench.execute({ manifest: f.manifest, program });
  const settled = f.store.settleContextCell({
    cellId: admitted.cell.cellId, expectedVersion: 1, result: completion(computed),
  }, contextAuth('context-root', `context.cell.settle:${admitted.cell.cellId}:${admitted.cell.admissionDigest}`));
  return { cellId: settled.cell.cellId, computed, cell: settled.cell };
}

function admittedOnlyCell(f, session, queryText) {
  return admitCell(f, session, programFor(queryText)).cell;
}

function failedCell(f, session, queryText) {
  const program = programFor(queryText);
  const admitted = admitCell(f, session, program);
  const result = {
    state: 'failed', providerEffects: 0,
    termination: { code: 'context_execution_failed', retryable: false, summary: 'deliberately failed for repl23 test' },
  };
  return f.store.settleContextCell({
    cellId: admitted.cell.cellId, expectedVersion: 1, result,
  }, contextAuth('context-root', `context.cell.settle:${admitted.cell.cellId}:${admitted.cell.admissionDigest}`)).cell;
}

function cellBranch(name, cellId) {
  return { name, cell: { digest: cellId.slice('cell:'.length) } };
}

/** Admits a REAL ReplManifest through the REPL-1 admission path (post-integration: the
 * stand-in seam is gone) citing one raw `cell:` branch so REPL-2 bindings have a real
 * manifestDigest authority record to cite and REPL-3's admission-time resolution is exercised.
 * Shared scope rides an orchestrator lease (ported from repl1's fixture); worker scope rides
 * the caller's own principalId. Returns the admission result plus the expected resolved branch
 * (derived from the settled cell's outputRef — the hub's rule, asserted). */
function replManifestObject({ replRole, replRunId, branch }) {
  return {
    schemaVersion: 1, kind: 'baton.repl_manifest', repoId,
    tree: { sha: treeSha, source: 'deployment_snapshot' },
    repl: { replRole, runId: replRunId },
    branches: [branch],
    policyDigest: DEFAULT_CONTEXT_PROGRAM_POLICY.policyDigest,
  };
}

// Builds the full goal/plan/task chain for a lease-parent run (goalPlanPolicy is mandatory, so
// plain createTask refuses; previewPlanDispatch demands expectedDispatchVersion 0, so each run
// needs its own approved plan). Cached per fixture.
function ensureLeaseRun(f, runX) {
  f.__leaseRuns ??= new Map();
  if (f.__leaseRuns.has(runX)) return f.__leaseRuns.get(runX);
  const authFor = (principalId, key) => ({
    actor: `direct:${principalId}`, principalId, repoId, runId: runX, key,
    sessionDigest: digest(`session:${principalId}:${runX}`),
  });
  const goal = f.store.defineGoal({
    objective: `Orchestrate REPL lease run ${runX}`,
    definitionOfDone: ['lease parent stays working'], constraints: ['No provider effect'], risk: 'low',
    budget: { tokens: 10_000, usd: 1, wallMin: 10, providerTurns: 2 },
    predecessor: null,
  }, authFor('goal-owner', `${runX}:goal`)).goal;
  const plan = f.store.proposePlan({
    goal: ref('goal', goal), predecessor: null,
    nodes: [{
      key: 'attempt:root', objective: `Orchestrate ${runX}`,
      definitionOfDone: goal.definitionOfDone, deps: [], pathScope: ['impl/**'], risk: 'low',
      budget: { tokens: 10_000, usd: 1, wallMin: 10, providerTurns: 2 }, verification,
      routes: { harnesses: [route.vendor], models: [route.model], efforts: [route.effort] },
      capabilities: ['analysis', 'baton_orchestrator'], effects: ['provider_call'],
    }],
  }, authFor('planner', `${runX}:plan`)).plan;
  f.store.approvePlan({
    goal: ref('goal', goal), plan: ref('plan', plan), expectedDisposition: null,
    disposition: 'approved',
  }, authFor('approver', `${runX}:approve`));
  const node = plan.nodes[0];
  const gate = {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey: node.key, expectedDispatchVersion: 0,
    capabilities: node.capabilities, effects: node.effects,
  };
  const preview = f.store.previewPlanDispatch(gate, route);
  f.store.createPlanGatedTask({
    id: `task-lease-${runX}`, brief: preview.brief, deps: [], refines: null, runId: runX,
    taskType: 'general', reservedWorkerId: `worker-lease-${runX}`, vendorRequested: route.vendor,
    modelRequested: route.model, modelPolicy: null, effortRequested: route.effort,
    effortResolved: null, effortObserved: null, routeKey: null, sessionRequest: { mode: 'new' },
  }, gate, route, authFor('dispatcher', `${runX}:dispatch`));
  const claimed = f.store.claimTask(`task-lease-${runX}`, `worker-lease-${runX}`, 1,
    { actor: 'orchestrator', key: `${runX}:claim` }, {
      harnessRequested: route.vendor, harnessResolved: 'stub@1', modelRequested: route.model,
      modelResolved: route.model, modelObserved: route.model, effortRequested: route.effort,
      effortResolved: route.effort, effortObserved: route.effort, routeKey: 'route:stub',
    }).task;
  f.__leaseRuns.set(runX, claimed);
  return claimed;
}

// Issues a run-orchestrator lease whose parent task is guaranteed `working` with matching
// version/assignee (the use-time checks at coordination-store.mjs:1361-1390). For the fixture's
// own run the EXISTING claimed context task parents the lease; other runs ride ensureLeaseRun.
function orchestratorLease(f, { runId: leaseRunId, principalId = 'orchestrator' }) {
  const parentTask = leaseRunId === runId ? f.task : ensureLeaseRun(f, leaseRunId);
  const sessionId = `sess-${leaseRunId}`;
  const session = {
    principalId, sessionId,
    authorityDigest: digest({ kind: 'authenticated-worker-session', principalId, sessionId }),
    expiresAt: '2026-07-22T21:00:00.000Z',
  };
  const identity = {
    repoId, parentRunId: leaseRunId, parentTaskId: parentTask.id, parentTaskVersion: parentTask.version,
    workerId: parentTask.assignee, principalId, sessionId, sessionAuthorityDigest: session.authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${digest(identity)}`;
  return f.store.issueRunOrchestratorLease(
    { schemaVersion: 1, repoId, parentTask: { id: parentTask.id, version: parentTask.version }, session },
    { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` },
  ).lease;
}

function sharedReplAuth(f, replRunId, key) {
  f.__replLeases ??= new Map();
  if (!f.__replLeases.has(replRunId)) f.__replLeases.set(replRunId, orchestratorLease(f, { runId: replRunId }));
  const lease = f.__replLeases.get(replRunId);
  return {
    // The actor flows into the manifest's record.principal; bindings re-assert it verbatim
    // (repl_binding_unauthorized otherwise). Keep it identical to replAuth('orchestrator').
    actor: 'direct:orchestrator',
    key, orchestratorLeaseId: lease.leaseId, principalId: lease.session.principalId,
    sessionId: lease.session.sessionId, sessionAuthorityDigest: lease.session.authorityDigest, repoId,
  };
}

function admitManifest(f, { replRole, principalId, cellId, branchName = 'x', replRunId = runId, key }) {
  const auth = replRole === 'shared'
    ? sharedReplAuth(f, replRunId, key ?? `repl.manifest:${replRunId}:${replRole}:${cellId}`)
    : {
      actor: `direct:${principalId}`, principalId, repoId, runId: replRunId,
      key: key ?? `repl.manifest:${replRunId}:${replRole}:${principalId}:${cellId}`,
    };
  const admitted = f.store.admitReplManifest({
    manifest: replManifestObject({ replRole, replRunId, branch: cellBranch(branchName, cellId) }),
  }, auth);
  // The expected resolved branch, derived from the settled cell's outputRef — the same
  // coordinates the hub computes (asserted by the composition tests below).
  const outputRef = f.store.contextCell(cellId).result.outputRef;
  const resolvedBranch = {
    name: branchName, digest: outputRef.digest, ref: `ctx:sha256:${outputRef.digest}`,
    itemCount: 1, mediaType: 'application/vnd.baton.context-value+json',
    summary: `resolved from cell:${cellId.slice('cell:'.length)}`,
  };
  return { ...admitted, branches: [resolvedBranch], manifestDigest: admitted.record.manifestDigest };
}

// ---------------------------------------------------------------------------
// REPL-2 core (Part A/C): fresh binds, rebinds, version CAS, digest recompute, settled-only.
// ---------------------------------------------------------------------------

test('B1: fresh repl.binding_set mints bindingVersion 1; a correct rebind mints version+1 and both versions resolve by citation', (t) => {
  const f = fixture(t, 'b1');
  const session = admitSession(f);
  const cellA = completedCell(f, session, 'authority-a');
  const cellB = completedCell(f, session, 'authority-b');
  const manifest = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: cellA.cellId });

  const bound = f.store.admitReplBinding({
    scope: 'shared', name: 'result', cellId: cellA.cellId, manifestDigest: manifest.manifestDigest,
  }, replAuth('orchestrator', 'b1:bind:1'));
  assert.equal(bound.result, 'bound');
  assert.equal(bound.binding.bindingVersion, 1);
  assert.equal(bound.binding.state, 'bound');
  assert.equal(bound.binding.cellId, cellA.cellId);

  const rebound = f.store.admitReplBinding({
    scope: 'shared', name: 'result', cellId: cellB.cellId, manifestDigest: manifest.manifestDigest,
    expectedBindingVersion: 1,
  }, replAuth('orchestrator', 'b1:bind:2'));
  assert.equal(rebound.result, 'rebound');
  assert.equal(rebound.binding.bindingVersion, 2);
  assert.equal(rebound.binding.cellId, cellB.cellId);

  assert.equal(f.store.resolveReplCitation(runId, 'repl:shared:result@1').cellId, cellA.cellId);
  assert.equal(f.store.resolveReplCitation(runId, 'repl:shared:result@2').cellId, cellB.cellId);
});

test('B2: a rebind against a stale expectedBindingVersion is stale_binding_version', (t) => {
  const f = fixture(t, 'b2');
  const session = admitSession(f);
  const cellA = completedCell(f, session, 'authority-a');
  const cellB = completedCell(f, session, 'authority-b');
  const manifest = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: cellA.cellId });
  f.store.admitReplBinding({
    scope: 'shared', name: 'result', cellId: cellA.cellId, manifestDigest: manifest.manifestDigest,
  }, replAuth('orchestrator', 'b2:bind:1'));
  assert.throws(() => f.store.admitReplBinding({
    scope: 'shared', name: 'result', cellId: cellB.cellId, manifestDigest: manifest.manifestDigest,
    expectedBindingVersion: 99,
  }, replAuth('orchestrator', 'b2:bind:2')), (error) => error?.code === 'stale_binding_version');
});

test('B3: a submitted bindingDigest mismatch is repl_binding_digest_mismatch, never a silent overwrite', (t) => {
  const f = fixture(t, 'b3');
  const session = admitSession(f);
  const cellA = completedCell(f, session, 'authority-a');
  const manifest = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: cellA.cellId });
  assert.throws(() => f.store.admitReplBinding({
    scope: 'shared', name: 'result', cellId: cellA.cellId, manifestDigest: manifest.manifestDigest,
    bindingDigest: '0'.repeat(64),
  }, replAuth('orchestrator', 'b3:bind')), (error) => error?.code === 'repl_binding_digest_mismatch');
  assert.equal(f.store.bindingFence(runId, 'shared'), 0, 'the rejected write never advanced the fence');
});

test('B4: a repl.binding_set naming an admitted-but-unsettled or a failed/attention/stopped cell is repl_binding_cell_not_settled', (t) => {
  const f = fixture(t, 'b4');
  const session = admitSession(f);
  const settledCell = completedCell(f, session, 'authority-settled');
  const manifest = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: settledCell.cellId });
  const pending = admittedOnlyCell(f, session, 'authority-pending');
  assert.throws(() => f.store.admitReplBinding({
    scope: 'shared', name: 'pending', cellId: pending.cellId, manifestDigest: manifest.manifestDigest,
  }, replAuth('orchestrator', 'b4:pending')), (error) => error?.code === 'repl_binding_cell_not_settled');
  const failed = failedCell(f, session, 'authority-failed');
  assert.throws(() => f.store.admitReplBinding({
    scope: 'shared', name: 'failed', cellId: failed.cellId, manifestDigest: manifest.manifestDigest,
  }, replAuth('orchestrator', 'b4:failed')), (error) => error?.code === 'repl_binding_cell_not_settled');
});

test('B5: repl.binding_dropped against an already-dropped or a never-bound name is repl_binding_not_bound', (t) => {
  const f = fixture(t, 'b5');
  const session = admitSession(f);
  const cellA = completedCell(f, session, 'authority-a');
  const manifest = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: cellA.cellId });
  assert.throws(() => f.store.dropReplBinding({
    scope: 'shared', name: 'never-bound', manifestDigest: manifest.manifestDigest, expectedBindingVersion: 1,
  }, replAuth('orchestrator', 'b5:never')), (error) => error?.code === 'repl_binding_not_bound');
  f.store.admitReplBinding({
    scope: 'shared', name: 'result', cellId: cellA.cellId, manifestDigest: manifest.manifestDigest,
  }, replAuth('orchestrator', 'b5:bind'));
  const dropped = f.store.dropReplBinding({
    scope: 'shared', name: 'result', manifestDigest: manifest.manifestDigest, expectedBindingVersion: 1,
  }, replAuth('orchestrator', 'b5:drop'));
  assert.equal(dropped.binding.state, 'dropped');
  assert.equal(dropped.binding.bindingVersion, 2);
  assert.throws(() => f.store.dropReplBinding({
    scope: 'shared', name: 'result', manifestDigest: manifest.manifestDigest, expectedBindingVersion: 2,
  }, replAuth('orchestrator', 'b5:drop-again')), (error) => error?.code === 'repl_binding_not_bound');
  // A citation to the dropped version still resolves (Part A rule 2, rule 10).
  assert.equal(f.store.resolveReplCitation(runId, 'repl:shared:result@1').cellId, cellA.cellId);
  assert.equal(f.store.resolveReplCitation(runId, 'repl:shared:result@2').state, 'dropped');
});

// ---------------------------------------------------------------------------
// Authority (Part B, v2 P0-1/P2-5): a write is only as good as the manifest_admitted record it
// cites; no wrapper-level scope-forcing — a mismatch is refused loudly, never coerced.
// ---------------------------------------------------------------------------

test('B6: an unknown/unadmitted manifestDigest is repl_binding_manifest_unadmitted', (t) => {
  const f = fixture(t, 'b6');
  const session = admitSession(f);
  const cellA = completedCell(f, session, 'authority-a');
  assert.throws(() => f.store.admitReplBinding({
    scope: 'shared', name: 'result', cellId: cellA.cellId, manifestDigest: '0'.repeat(64),
  }, replAuth('orchestrator', 'b6:bind')), (error) => error?.code === 'repl_binding_manifest_unadmitted');
});

test('B7: a scope that disagrees with the cited manifest replRole is repl_binding_scope_manifest_mismatch — a worker can never write scope:shared directly', (t) => {
  const f = fixture(t, 'b7');
  const session = admitSession(f);
  const cellA = completedCell(f, session, 'authority-a');
  const workerManifest = admitManifest(f, { replRole: 'worker:w1', principalId: 'w1', cellId: cellA.cellId });
  assert.throws(() => f.store.admitReplBinding({
    scope: 'shared', name: 'result', cellId: cellA.cellId, manifestDigest: workerManifest.manifestDigest,
  }, replAuth('w1', 'b7:worker-to-shared')), (error) => error?.code === 'repl_binding_scope_manifest_mismatch');

  const sharedManifest = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: cellA.cellId });
  assert.throws(() => f.store.admitReplBinding({
    scope: 'worker:w1', name: 'result', cellId: cellA.cellId, manifestDigest: sharedManifest.manifestDigest,
  }, replAuth('orchestrator', 'b7:shared-to-worker')), (error) => error?.code === 'repl_binding_scope_manifest_mismatch');
});

test('B8: a caller whose own identity disagrees with the cited manifest principal is repl_binding_unauthorized', (t) => {
  const f = fixture(t, 'b8');
  const session = admitSession(f);
  const cellA = completedCell(f, session, 'authority-a');
  const w1Manifest = admitManifest(f, { replRole: 'worker:w1', principalId: 'w1', cellId: cellA.cellId });
  assert.throws(() => f.store.admitReplBinding({
    scope: 'worker:w1', name: 'result', cellId: cellA.cellId, manifestDigest: w1Manifest.manifestDigest,
  }, replAuth('w2', 'b8:impersonate')), (error) => error?.code === 'repl_binding_unauthorized');
});

test('B9: a shared-scope promotion citing the orchestrator own shared manifestDigest and carrying forward a worker-bound cellId succeeds', (t) => {
  const f = fixture(t, 'b9');
  const session = admitSession(f);
  const workerCell = completedCell(f, session, 'authority-worker-bound');
  const w1Manifest = admitManifest(f, { replRole: 'worker:w1', principalId: 'w1', cellId: workerCell.cellId });
  const workerBound = f.store.admitReplBinding({
    scope: 'worker:w1', name: 'result', cellId: workerCell.cellId, manifestDigest: w1Manifest.manifestDigest,
  }, replAuth('w1', 'b9:worker-bind'));
  assert.equal(workerBound.result, 'bound');

  const sharedManifest = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: workerCell.cellId });
  const promoted = f.store.admitReplBinding({
    scope: 'shared', name: 'result', cellId: workerCell.cellId, manifestDigest: sharedManifest.manifestDigest,
  }, replAuth('orchestrator', 'b9:promote'));
  assert.equal(promoted.result, 'bound');
  assert.equal(promoted.binding.cellId, workerCell.cellId);
});

// ---------------------------------------------------------------------------
// Idempotency (v2 P1-4): explicit payload comparison, never the bare `_append` blind-return.
// ---------------------------------------------------------------------------

test('B10: a replayed auth.key with an identical payload returns the prior event as idempotent; a divergent payload is repl_binding_conflict', (t) => {
  const f = fixture(t, 'b10');
  const session = admitSession(f);
  const cellA = completedCell(f, session, 'authority-a');
  const cellB = completedCell(f, session, 'authority-b');
  const manifest = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: cellA.cellId });
  const fields = { scope: 'shared', name: 'result', cellId: cellA.cellId, manifestDigest: manifest.manifestDigest };
  const first = f.store.admitReplBinding(fields, replAuth('orchestrator', 'b10:key'));
  const before = f.store.events().length;
  const replay = f.store.admitReplBinding(fields, replAuth('orchestrator', 'b10:key'));
  assert.equal(replay.result, 'idempotent');
  assert.equal(replay.event.seq, first.event.seq);
  assert.equal(f.store.events().length, before, 'no `_append` blind-return double-write');

  assert.throws(() => f.store.admitReplBinding({
    ...fields, cellId: cellB.cellId,
  }, replAuth('orchestrator', 'b10:key')), (error) => error?.code === 'repl_binding_conflict');
});

// ---------------------------------------------------------------------------
// Cross-run isolation (v2 P0-1): identically-scoped/-named bindings in different runs never
// collide in identity, CAS, or fence.
// ---------------------------------------------------------------------------

test('B11: two different runs each bind shared:x independently — no collision in identity, CAS, or fence', (t) => {
  const f = fixture(t, 'b11');
  const session = admitSession(f);
  const cellRunA1 = completedCell(f, session, 'authority-run-a-1');
  const cellRunA2 = completedCell(f, session, 'authority-run-a-2');
  const cellRunB1 = completedCell(f, session, 'authority-run-b-1');
  const runA = 'run-repl23-a';
  const runB = 'run-repl23-b';
  const manifestA = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: cellRunA1.cellId, replRunId: runA });
  const manifestB = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: cellRunB1.cellId, replRunId: runB });
  f.store.admitReplBinding({
    scope: 'shared', name: 'x', cellId: cellRunA1.cellId, manifestDigest: manifestA.manifestDigest,
  }, replAuth('orchestrator', 'b11:a:1'));
  f.store.admitReplBinding({
    scope: 'shared', name: 'x', cellId: cellRunB1.cellId, manifestDigest: manifestB.manifestDigest,
  }, replAuth('orchestrator', 'b11:b:1'));

  assert.equal(f.store.resolveReplCitation(runA, 'repl:shared:x@1').cellId, cellRunA1.cellId);
  assert.equal(f.store.resolveReplCitation(runB, 'repl:shared:x@1').cellId, cellRunB1.cellId);
  assert.equal(f.store.bindingFence(runA, 'shared'), 1);
  assert.equal(f.store.bindingFence(runB, 'shared'), 1);

  // A rebind CAS in run A never observes or is blocked by run B's version.
  const reboundA = f.store.admitReplBinding({
    scope: 'shared', name: 'x', cellId: cellRunA2.cellId, manifestDigest: manifestA.manifestDigest,
    expectedBindingVersion: 1,
  }, replAuth('orchestrator', 'b11:a:2'));
  assert.equal(reboundA.result, 'rebound');
  assert.equal(f.store.bindingFence(runA, 'shared'), 2);
  assert.equal(f.store.bindingFence(runB, 'shared'), 1, 'run B fence unaffected by run A writes');
});

// ---------------------------------------------------------------------------
// Fence divergence (Part C): EVERY write to (runId, scope) bumps the binding fence — worker
// writes included — the opposite of the board fence's orchestrator-authority-only carve-out.
// ---------------------------------------------------------------------------

test('B12: a worker-scope write DOES advance that (runId, scope) bindingFence, unlike a board worker report; the fence replays to the same value by re-counting', (t) => {
  const f = fixture(t, 'b12');
  const session = admitSession(f);
  const cellW1 = completedCell(f, session, 'authority-w1');
  const w1Manifest = admitManifest(f, { replRole: 'worker:w1', principalId: 'w1', cellId: cellW1.cellId });
  assert.equal(f.store.bindingFence(runId, 'worker:w1'), 0);
  f.store.admitReplBinding({
    scope: 'worker:w1', name: 'result', cellId: cellW1.cellId, manifestDigest: w1Manifest.manifestDigest,
  }, replAuth('w1', 'b12:bind'));
  assert.equal(f.store.bindingFence(runId, 'worker:w1'), 1, 'worker traffic advances the binding fence — no board-style carve-out');
  f.store.dropReplBinding({
    scope: 'worker:w1', name: 'result', manifestDigest: w1Manifest.manifestDigest, expectedBindingVersion: 1,
  }, replAuth('w1', 'b12:drop'));
  assert.equal(f.store.bindingFence(runId, 'worker:w1'), 2);

  f.store.releaseWriterLease();
  const reopened = new CoordinationStore(join(f.root, 'coordination'), f.storeOptions);
  t.after(() => reopened.releaseWriterLease());
  assert.equal(reopened.bindingFence(runId, 'worker:w1'), 2, 'the fence replays to the same value by re-counting');
});

test('B13: concurrent binds to two different names in the same run scope never spuriously conflict (the CAS is per-binding-version, not per-scope-fence)', (t) => {
  const f = fixture(t, 'b13');
  const session = admitSession(f);
  const cellX = completedCell(f, session, 'authority-x');
  const cellY = completedCell(f, session, 'authority-y');
  const manifest = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: cellX.cellId });
  const boundX = f.store.admitReplBinding({
    scope: 'shared', name: 'x', cellId: cellX.cellId, manifestDigest: manifest.manifestDigest,
  }, replAuth('orchestrator', 'b13:x'));
  assert.equal(boundX.result, 'bound');
  const boundY = f.store.admitReplBinding({
    scope: 'shared', name: 'y', cellId: cellY.cellId, manifestDigest: manifest.manifestDigest,
  }, replAuth('orchestrator', 'b13:y'));
  assert.equal(boundY.result, 'bound');
  assert.equal(f.store.bindingFence(runId, 'shared'), 2);
});

// ---------------------------------------------------------------------------
// Projections (Part D, F10): non-evented reads, fence-gated cache, per-worker visibility, bounds.
// ---------------------------------------------------------------------------

test('B14: a binding read appends no ledger event; ReplBindingProjection is served from cache while the fence is unchanged and recomputed only on advance', (t) => {
  const f = fixture(t, 'b14');
  const session = admitSession(f);
  const cellA = completedCell(f, session, 'authority-a');
  const manifest = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: cellA.cellId });
  f.store.admitReplBinding({
    scope: 'shared', name: 'result', cellId: cellA.cellId, manifestDigest: manifest.manifestDigest,
  }, replAuth('orchestrator', 'b14:bind'));

  const before = f.store.events().length;
  const snapshot1 = f.store.replBindingSnapshot(runId, 'shared');
  assert.equal(f.store.events().length, before, 'a non-evented read appends nothing');
  assert.equal(snapshot1.bindings.length, 1);

  const cache = new Map();
  const view1 = projectReplBindingView(snapshot1, { role: 'orchestrator' }, cache);
  const view2 = projectReplBindingView(f.store.replBindingSnapshot(runId, 'shared'), { role: 'orchestrator' }, cache);
  assert.equal(view1, view2, 'the exact cached view is served while the fence is unchanged');

  f.store.dropReplBinding({
    scope: 'shared', name: 'result', manifestDigest: manifest.manifestDigest, expectedBindingVersion: 1,
  }, replAuth('orchestrator', 'b14:drop'));
  const view3 = projectReplBindingView(f.store.replBindingSnapshot(runId, 'shared'), { role: 'orchestrator' }, cache);
  assert.notEqual(view3, view1, 'a fence advance recomputes the view');
  assert.equal(view3.bindings.length, 0, 'the dropped binding is no longer active');
});

test('B15: a worker view excludes another worker scope while including shared, both scoped to its own run', (t) => {
  const f = fixture(t, 'b15');
  const session = admitSession(f);
  const cellW1 = completedCell(f, session, 'authority-w1');
  const cellW2 = completedCell(f, session, 'authority-w2');
  const cellShared = completedCell(f, session, 'authority-shared');
  const w1Manifest = admitManifest(f, { replRole: 'worker:w1', principalId: 'w1', cellId: cellW1.cellId });
  const w2Manifest = admitManifest(f, { replRole: 'worker:w2', principalId: 'w2', cellId: cellW2.cellId });
  const sharedManifest = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: cellShared.cellId });
  f.store.admitReplBinding({ scope: 'worker:w1', name: 'x', cellId: cellW1.cellId, manifestDigest: w1Manifest.manifestDigest }, replAuth('w1', 'b15:w1'));
  f.store.admitReplBinding({ scope: 'worker:w2', name: 'x', cellId: cellW2.cellId, manifestDigest: w2Manifest.manifestDigest }, replAuth('w2', 'b15:w2'));
  f.store.admitReplBinding({ scope: 'shared', name: 'x', cellId: cellShared.cellId, manifestDigest: sharedManifest.manifestDigest }, replAuth('orchestrator', 'b15:shared'));

  const w1SharedView = projectReplBindingView(f.store.replBindingSnapshot(runId, 'shared'), { role: 'worker', workerId: 'w1' });
  assert.equal(w1SharedView.bindings.length, 1, 'a worker sees the shared scope');
  const w1OwnView = projectReplBindingView(f.store.replBindingSnapshot(runId, 'worker:w1'), { role: 'worker', workerId: 'w1' });
  assert.equal(w1OwnView.bindings.length, 1, 'a worker sees its own scope');
  const w1OtherView = projectReplBindingView(f.store.replBindingSnapshot(runId, 'worker:w2'), { role: 'worker', workerId: 'w1' });
  assert.equal(w1OtherView.bindings.length, 0, 'a worker never sees another workers scope');
});

test('B16: view byte/count ceilings are honored with an explicit replBindingViewTruncated story, never silent', () => {
  const manySmall = Array.from({ length: 600 }, (unused, index) => ({
    scope: 'shared', name: `item-${index}`, bindingVersion: 1, state: 'bound',
    cellId: `cell:${'0'.repeat(64)}`, bindingDigest: '0'.repeat(64),
  }));
  const countTruncatedView = projectReplBindingView({
    runId: 'run-x', scope: 'shared', bindingFence: 1, bindings: manySmall,
  }, { role: 'orchestrator' });
  assert.equal(countTruncatedView.replBindingViewTruncated, true);
  assert.ok(countTruncatedView.bindings.length <= 512);

  // Under the count ceiling (100 < 512) but each name is near the boundedAttentionText cap
  // (~4KB), so the combined view blows past MAX_REPL_VIEW_BYTES purely on size — isolating the
  // byte-ceiling path from the count-ceiling path exercised above.
  const fewButHuge = Array.from({ length: 100 }, (unused, index) => ({
    scope: 'shared', name: `item-${index}-${'x'.repeat(4_096)}`, bindingVersion: 1, state: 'bound',
    cellId: `cell:${'0'.repeat(64)}`, bindingDigest: '0'.repeat(64),
  }));
  const byteTruncatedView = projectReplBindingView({
    runId: 'run-x', scope: 'shared', bindingFence: 1, bindings: fewButHuge,
  }, { role: 'orchestrator' });
  assert.equal(byteTruncatedView.replBindingViewTruncated, true);
  assert.ok(byteTruncatedView.bindings.length < 100, 'the byte ceiling sheds trailing items rather than silently keeping them all');
  assert.ok(Buffer.byteLength(JSON.stringify(byteTruncatedView)) <= 256 * 1_024);
});

// ---------------------------------------------------------------------------
// Citations (Part E, v2 P1-3/P2-6): repl:<scope>:<name>@<version>, closed grammar, sanitized
// rendering.
// ---------------------------------------------------------------------------

test('B17: repl:<scope>:<name>@<n> resolves the exact digest at version n, never "latest"; an unparseable or unknown citation is repl_binding_citation_not_found', (t) => {
  const f = fixture(t, 'b17');
  const session = admitSession(f);
  const cell1 = completedCell(f, session, 'authority-1');
  const cell2 = completedCell(f, session, 'authority-2');
  const cell3 = completedCell(f, session, 'authority-3');
  const manifest = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: cell1.cellId });
  f.store.admitReplBinding({ scope: 'shared', name: 'r', cellId: cell1.cellId, manifestDigest: manifest.manifestDigest }, replAuth('orchestrator', 'b17:1'));
  f.store.admitReplBinding({ scope: 'shared', name: 'r', cellId: cell2.cellId, manifestDigest: manifest.manifestDigest, expectedBindingVersion: 1 }, replAuth('orchestrator', 'b17:2'));
  f.store.admitReplBinding({ scope: 'shared', name: 'r', cellId: cell3.cellId, manifestDigest: manifest.manifestDigest, expectedBindingVersion: 2 }, replAuth('orchestrator', 'b17:3'));

  assert.equal(f.store.resolveReplCitation(runId, 'repl:shared:r@1').cellId, cell1.cellId);
  assert.equal(f.store.resolveReplCitation(runId, 'repl:shared:r@2').cellId, cell2.cellId);
  assert.equal(f.store.resolveReplCitation(runId, 'repl:shared:r@3').cellId, cell3.cellId);

  assert.throws(() => f.store.resolveReplCitation(runId, 'not-a-citation'),
    (error) => error?.code === 'repl_binding_citation_not_found');
  assert.throws(() => f.store.resolveReplCitation(runId, 'repl:shared:r@99'),
    (error) => error?.code === 'repl_binding_citation_not_found');
  assert.throws(() => f.store.resolveReplCitation(runId, 'repl:shared:unknown-name@1'),
    (error) => error?.code === 'repl_binding_citation_not_found');
});

test('B18: a name containing ":" is rejected at bind time, never reaching the citation grammar; a colon-carrying worker scope still parses unambiguously', (t) => {
  const f = fixture(t, 'b18');
  const session = admitSession(f);
  const cellA = completedCell(f, session, 'authority-a');
  const manifest = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: cellA.cellId });
  assert.throws(() => f.store.admitReplBinding({
    scope: 'shared', name: 'b:c', cellId: cellA.cellId, manifestDigest: manifest.manifestDigest,
  }, replAuth('orchestrator', 'b18:colon-name')), (error) => error?.code === 'invalid_repl_binding');

  // The crafted pair v1's rules would have collided under (`scope: 'worker:w-7'`, `name: 'b:c'`):
  // name is rejected outright, and a real colon-carrying worker scope still round-trips exactly.
  const w7Cell = completedCell(f, session, 'authority-w7');
  const w7Manifest = admitManifest(f, { replRole: 'worker:w-7', principalId: 'w-7', cellId: w7Cell.cellId });
  f.store.admitReplBinding({
    scope: 'worker:w-7', name: 'ok-name', cellId: w7Cell.cellId, manifestDigest: w7Manifest.manifestDigest,
  }, replAuth('w-7', 'b18:w7-bind'));
  const resolved = f.store.resolveReplCitation(runId, 'repl:worker:w-7:ok-name@1');
  assert.equal(resolved.scope, 'worker:w-7');
  assert.equal(resolved.name, 'ok-name');
  assert.equal(resolved.cellId, w7Cell.cellId);
});

test('B19: a rendered view wraps scope/name as untrusted prose while leaving a resolved cellId unwrapped', (t) => {
  const f = fixture(t, 'b19');
  const session = admitSession(f);
  const cellA = completedCell(f, session, 'authority-a');
  const manifest = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: cellA.cellId });
  f.store.admitReplBinding({
    scope: 'shared', name: 'result', cellId: cellA.cellId, manifestDigest: manifest.manifestDigest,
  }, replAuth('orchestrator', 'b19:bind'));
  const view = projectReplBindingView(f.store.replBindingSnapshot(runId, 'shared'), { role: 'orchestrator' });
  const [row] = view.bindings;
  assert.equal(row.scope.provenance, 'model-authored');
  assert.equal(row.scope.untrusted, true);
  assert.equal(row.name.provenance, 'model-authored');
  assert.equal(row.name.untrusted, true);
  assert.equal(typeof row.cellId, 'string', 'the resolved cellId is a plain closed token, never wrapped as prose');
  assert.equal(row.cellId, cellA.cellId);
});

// ---------------------------------------------------------------------------
// REPL-3 (Part F, v2 P0-2): `cell:` branch refs, resolved at manifest admission only.
// ---------------------------------------------------------------------------

test('C1: a cell: branch naming a completed cell resolves at admission and bakes a ctx:sha256: coordinate — never the art:sha256: handle verbatim', (t) => {
  const f = fixture(t, 'c1');
  const session = admitSession(f);
  const settled = completedCell(f, session, 'authority-c1');
  const admitted = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: settled.cellId, branchName: 'resolved', key: 'c1:admit' });
  const [branch] = admitted.branches;
  assert.equal(branch.name, 'resolved');
  assert.equal(branch.digest, settled.computed.outputRef.digest);
  assert.equal(branch.ref, `ctx:sha256:${settled.computed.outputRef.digest}`);
  assert.equal(branch.itemCount, 1);
  assert.equal(branch.mediaType, 'application/vnd.baton.context-value+json');
  assert.match(branch.summary, /resolved from cell:/);
  assert.ok(!branch.ref.startsWith('art:sha256:'));
  assert.ok(!('handle' in branch), 'the art:sha256: handle never appears verbatim in the baked coordinate');
});

test('C2: a cell: branch naming an admitted-only or failed/attention/stopped cell is repl_manifest_cell_not_settled and the admission event is never appended', (t) => {
  const f = fixture(t, 'c2');
  const session = admitSession(f);
  const pending = admittedOnlyCell(f, session, 'authority-c2-pending');
  // Warm the shared orchestrator lease BEFORE measuring: its issuance appends events, and the
  // property under test is that the REFUSED admission appends nothing.
  sharedReplAuth(f, runId, 'c2:pre');
  const before = f.store.events().length;
  assert.throws(() => admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: pending.cellId, key: 'c2:pending' }),
    (error) => error?.code === 'repl_manifest_cell_not_settled');
  assert.equal(f.store.events().length, before);

  const failed = failedCell(f, session, 'authority-c2-failed');
  const beforeFailed = f.store.events().length;
  assert.throws(() => admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: failed.cellId, key: 'c2:failed' }),
    (error) => error?.code === 'repl_manifest_cell_not_settled');
  assert.equal(f.store.events().length, beforeFailed);
});

test('C3: a cell: branch whose settled artifact fails reverification at the moment of admission is context_artifact_unavailable and the admission event is never appended', (t) => {
  const f = fixture(t, 'c3');
  const session = admitSession(f);
  const settled = completedCell(f, session, 'authority-c3');
  unlinkSync(join(f.artifactRoot, `${settled.computed.outputRef.digest}.json`));
  // Warm the shared orchestrator lease BEFORE measuring (its issuance appends events; the
  // refused admission below must append nothing).
  sharedReplAuth(f, runId, 'c3:pre');
  const before = f.store.events().length;
  assert.throws(() => admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: settled.cellId, key: 'c3:admit' }),
    (error) => error?.code === 'context_artifact_unavailable' || error?.code === 'context_source_unavailable');
  assert.equal(f.store.events().length, before, 'admission never happened — never a poisoned manifest');
});

test('C4: replay of an admitted ReplManifest reconstructs the identical resolved branch with zero store lookups', (t) => {
  const f = fixture(t, 'c4');
  const session = admitSession(f);
  const settled = completedCell(f, session, 'authority-c4');
  const admitted = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: settled.cellId, branchName: 'resolved', key: 'c4:admit' });
  const beforeBranch = admitted.branches[0];

  // Destroy the CAS bytes the branch resolved from — if replay ever re-resolved the `cell:`
  // ref instead of trusting the already-baked event payload, this restart would throw.
  unlinkSync(join(f.artifactRoot, `${beforeBranch.digest}.json`));
  f.store.releaseWriterLease();
  const reopened = new CoordinationStore(join(f.root, 'coordination'), f.storeOptions);
  t.after(() => reopened.releaseWriterLease());
  const replayedEvent = reopened.events().find((event) => event.kind === 'repl.manifest_admitted');
  assert.deepEqual(replayedEvent.payload.branches[0], beforeBranch);
  const replayedRecord = reopened.replManifestAdmission(admitted.manifestDigest);
  assert.equal(replayedRecord.runId, runId);
  assert.equal(replayedRecord.replRole, 'shared');
  assert.deepEqual(replayedRecord.principal, { actor: 'direct:orchestrator', principalId: 'orchestrator' });
  assert.equal(replayedRecord.admittedEvent, replayedEvent.seq);
  assert.deepEqual(replayedRecord.branches[0], beforeBranch);
});

test('C5: a Program can never express a cell: ref — an ordinary ContextManifest branch naming one is rejected by unmodified branch resolution, not by new evaluator code', (t) => {
  const f = fixture(t, 'c5');
  assert.throws(() => normalizeContextManifest({
    ...f.manifest,
    branches: [{
      name: 'sneaky', ref: `cell:${'1'.repeat(64)}`, digest: '1'.repeat(64),
      itemCount: 1, mediaType: 'application/vnd.baton.context-value+json', summary: 'x',
    }],
    digest: undefined,
  }), (error) => error?.code === 'context_manifest_invalid');
});

test('C6: a Program source op against the resolved branch reads through the ordinary _readSource path and recovers byte-identical content; a later-lost artifact settles a downstream reading cell to attention (retryable), never failed', (t) => {
  const f = fixture(t, 'c6');
  const session = admitSession(f);
  const settled = completedCell(f, session, 'authority-c6');
  const admitted = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: settled.cellId, branchName: 'resolved', key: 'c6:admit' });
  const [resolvedBranch] = admitted.branches;

  // Independent CAS-identity proof: the bytes the ordinary source-reading path recovers are
  // byte-identical to the original cell's own output, not a lossy re-encoding.
  const recovered = f.bench._readSource(resolvedBranch.digest);
  const original = f.store.contextCellArtifacts(settled.cellId).output;
  assert.deepEqual(recovered, original);
  assert.equal(contextValueDigest(recovered), resolvedBranch.digest);

  // A downstream Program reads the resolved branch through the Bench's ordinary per-cell
  // execution primitive (`execute` -> `_evaluate` -> `_branch` -> `_readSource`) — the exact
  // path any admitted-and-executed cell goes through. This is deliberately exercised at the
  // Bench level rather than through a brand-new `admitContextSession`: session admission's own
  // (pre-existing, REPL-3-unrelated) source-attestation loop requires every branch's mediaType
  // to be `application/json` (an ordinary addressed-source constraint), which a `cell:`-resolved
  // branch's `application/vnd.baton.context-value+json` mediaType never satisfies by design
  // (rule 19) — exactly why REPL-3 "touches zero evaluator code" (rule 21): composition rides
  // the Program's per-cell read path, never the Workflow session/attestation surface.
  const secondManifest = normalizeContextManifest({
    ...f.manifest, branches: [resolvedBranch], digest: undefined,
  });
  const sourceProgram = normalizeContextProgram({
    schemaVersion: 1, kind: 'baton.context_program',
    expression: { op: 'source', branch: resolvedBranch.name },
  });
  const computed = f.bench.execute({ manifest: secondManifest, program: sourceProgram });
  assert.deepEqual(computed.output.items[0], original, 'the Program recovers byte-identical content through the ordinary read path');

  unlinkSync(join(f.artifactRoot, `${resolvedBranch.digest}.json`));
  const chunkProgram = normalizeContextProgram({
    schemaVersion: 1, kind: 'baton.context_program',
    expression: { op: 'chunk', input: { op: 'source', branch: resolvedBranch.name }, by: 'item' },
  });
  // A fresh Bench (no `_readSource` cache warm from the read above) proves the *file*, not a
  // cache entry, is what went missing.
  const freshBench = new StatelessContextBench({
    artifactRoot: f.artifactRoot, sources: {}, environmentDigest, policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
  });
  assert.throws(() => freshBench.execute({ manifest: secondManifest, program: chunkProgram }),
    (error) => error?.code === 'context_source_unavailable',
    'a later-lost artifact fails the same retryable-classified way any other missing source does (context-program.mjs settleFailure treats this code as retryable, settling attention — unmodified by REPL-3)');
});

// ---------------------------------------------------------------------------
// Fold surface (Part G): the closed kind set, the run-stop guard, unsupported kinds.
// ---------------------------------------------------------------------------

test('F1: an unknown-kind event outside the closed set still throws unsupported_event_kind', (t) => {
  const f = fixture(t, 'f1');
  assert.throws(() => f.store._apply({
    schemaVersion: 1, seq: f.store.events().length + 1, ts: '2026-07-22T20:00:00.000Z',
    kind: 'definitely.not.a.repl.kind', actor: 'test', idempotencyKey: 'f1:unknown', payload: {},
  }), (error) => error?.code === 'unsupported_event_kind');
});

test('F2: a repl.binding_set admitted after its run began stopping throws run_stopping, derived via the same _replManifestAdmissions lookup admission uses', (t) => {
  const f = fixture(t, 'f2');
  const session = admitSession(f);
  const cellA = completedCell(f, session, 'authority-f2');
  const manifest = admitManifest(f, { replRole: 'shared', principalId: 'orchestrator', cellId: cellA.cellId });
  const reasonDigest = digest('stop:f2');
  f.store.admitRunStop({
    schemaVersion: 1, repoId, runId, reasonDigest, requestDigest: digest({ repoId, runId, reasonDigest }),
  }, { actor: 'direct:operator', key: `run.stop:${runId}` });
  assert.throws(() => f.store.admitReplBinding({
    scope: 'shared', name: 'result', cellId: cellA.cellId, manifestDigest: manifest.manifestDigest,
  }, replAuth('orchestrator', 'f2:bind')), (error) => error?.code === 'run_stopping');
});

// New event kinds introduced by this suite (folded into the kind-inventory at
// repl1-kind-inventory-red.test.mjs KI1):
//   - repl.binding_set         (REPL-2, Part A/G)
//   - repl.binding_dropped     (REPL-2, Part A/G)
// (repl.manifest_admitted is REPL-1's own kind, introduced by repl1-manifest-red.)

