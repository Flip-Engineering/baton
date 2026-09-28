import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CoordinationRefusal, CoordinationStore,
} from '../src/coordination-store.mjs';

import { reapFixtureDirectories } from '../scripts/suite-hygiene.mjs';

reapFixtureDirectories();

const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase64-finalization-${name}-`));
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const resultSha = 'a'.repeat(40);
const resultRef = `refs/baton/results/${resultSha}`;
const runId = 'run-finalization';
const nodeKey = 'work';
const taskId = 'task-finalization';

const policy = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-finalization',
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});
const budget = (tokens) => ({ tokens, usd: 1, wallMin: 10, providerTurns: 4 });
const verification = Object.freeze({
  command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 60_000, maxOutputBytes: 1_000_000,
  requiredPredecessorEvidence: [],
});
const auth = (principalId, key) => ({
  actor: `direct:${principalId}`, principalId,
  sessionDigest: digest(`session:${principalId}`), repoId: policy.repoId, runId, key,
});
const ref = (kind, value) => ({ [`${kind}Id`]: value[`${kind}Id`], version: value.version, digest: value.digest });

function fixture(name) {
  const directory = root(name);
  const operational = new Map();
  const operationalRead = (worker, seq) => operational.get(`${worker}:${seq}`) ?? null;
  const store = new CoordinationStore(directory, {
    goalPlanPolicy: policy, operationalRead,
    clock: () => '2026-07-14T03:00:00.000Z',
  });
  const goal = store.defineGoal({
    objective: 'Preserve the accepted result without merging it',
    definitionOfDone: ['The accepted commit remains addressable'], constraints: ['Do not merge'],
    risk: 'high', budget: budget(20_000), predecessor: null,
  }, auth('goal-owner', `${name}:goal`)).goal;
  const plan = store.proposePlan({
    goal: ref('goal', goal), predecessor: null,
    nodes: [{
      key: nodeKey, objective: 'Produce one verified retained result',
      definitionOfDone: ['The accepted commit remains addressable'], deps: [], pathScope: ['impl/**'], risk: 'high',
      budget: budget(10_000), verification, routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] },
      capabilities: ['code', 'test'], effects: ['repository_edit'],
    }],
  }, auth('planner', `${name}:plan`)).plan;
  store.approvePlan({
    goal: ref('goal', goal), plan: ref('plan', plan), expectedDisposition: null, disposition: 'approved',
  }, auth('approver', `${name}:approve`));
  const gate = {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey, expectedDispatchVersion: 0, capabilities: ['code', 'test'], effects: ['repository_edit'],
  };
  const route = { vendor: 'mock', model: 'model-a', effort: 'low' };
  const state = store.previewPlanDispatch(gate, route);
  store.createPlanGatedTask({
    id: taskId, brief: state.brief, deps: state.resolvedDeps, refines: null, runId,
    taskType: 'general', reservedWorkerId: 'worker-finalization', vendorRequested: route.vendor,
    modelRequested: route.model, modelPolicy: null, effortRequested: route.effort,
    effortResolved: null, effortObserved: null, routeKey: null, sessionRequest: { mode: 'new' },
  }, gate, route, auth('dispatcher', `${name}:dispatch`));
  const claimed = store.claimTask(taskId, 'worker-finalization', 1, { actor: 'orchestrator', key: `${name}:claim` });
  const verify = {
    worker: 'worker-finalization', taskId, seq: 7, ts: '2026-07-14T03:00:00.000Z',
    kind: 'verify.reverified', actor: 'policy', payload: { accept: true },
  };
  operational.set('worker-finalization:7', verify);
  const mapped = store.mapOperationalEvent(verify, { actor: 'policy', key: `${name}:map` });
  const terminal = store.transitionTaskWithArtifacts(taskId, 'completed', claimed.task.version, [
    {
      taskId, kind: 'commit', refs: { sha: resultSha, retainedResultRef: resultRef },
      mediaType: 'application/vnd.git.commit', accepted: true, provenance: [mapped.evidence],
    },
    {
      taskId, kind: 'verification', refs: { worker: 'worker-finalization', workerSeq: 7 },
      mediaType: 'application/vnd.baton.verdict+json', accepted: true, provenance: [mapped.evidence],
    },
  ], { actor: 'policy', key: `${name}:terminal` }, mapped.evidence);
  return { directory, operational, operationalRead, store, terminal };
}

test('RF1: accepted commit artifacts may name only their exact deterministic protected result ref', () => {
  const f = fixture('protected-ref');
  assert.equal(f.terminal.artifacts.find((artifact) => artifact.kind === 'commit').refs.retainedResultRef, resultRef);

  const bad = fixture('bad-protected-ref-base');
  const task = bad.store.task(taskId);
  assert.throws(() => bad.store.registerArtifact({
    taskId, kind: 'commit', refs: { sha: resultSha, retainedResultRef: `refs/baton/results/${'d'.repeat(40)}` },
    accepted: true, provenance: [bad.terminal.artifacts[0].provenance[0]],
  }, { actor: 'policy', key: 'bad-protected-ref' }),
  (error) => error instanceof CoordinationRefusal && error.code === 'result_ref_invalid');
  assert.equal(bad.store.task(taskId).artifactIds.length, task.artifactIds.length);

  f.store.releaseWriterLease({ requireOwned: true });
  const replay = new CoordinationStore(f.directory, { goalPlanPolicy: policy, operationalRead: f.operationalRead });
  assert.equal(replay.artifact(f.terminal.artifacts[0].id).refs.retainedResultRef, resultRef);
});

