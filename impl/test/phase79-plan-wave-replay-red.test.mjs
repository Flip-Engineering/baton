import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/index.mjs';

const policy = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-phase79-wave',
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function auth(principalId, key, runId = null) {
  return {
    actor: `direct:${principalId}`,
    principalId,
    sessionDigest: digest(`session:${principalId}`),
    repoId: policy.repoId,
    runId,
    key,
  };
}

const ref = (kind, value) => ({
  [`${kind}Id`]: value[`${kind}Id`], version: value.version, digest: value.digest,
});

function fixture(name, { dispatch = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), `baton-phase79-wave-${name}-`));
  const store = new CoordinationStore(directory, { goalPlanPolicy: policy });
  const runId = `run-phase79-${name}`;
  const goal = store.defineGoal({
    objective: 'Produce two independently attributable candidate changes',
    definitionOfDone: [
      'The builder candidate is inspectable',
      'The challenger candidate is inspectable',
    ],
    constraints: ['Use isolated workspaces'],
    risk: 'high',
    budget: { tokens: 40_000, usd: 4, wallMin: 20, providerTurns: 16 },
    predecessor: null,
  }, auth('goal-owner', `goal:${name}`, runId)).goal;
  const routes = {
    builder: { vendor: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
    challenger: { vendor: 'grok', model: 'grok-4.5', effort: 'medium' },
  };
  const plan = store.proposePlan({
    goal: ref('goal', goal),
    predecessor: null,
    nodes: Object.entries(routes).map(([key, route]) => ({
      key,
      objective: `Produce the ${key} candidate`,
      definitionOfDone: [`The ${key} candidate is inspectable`],
      deps: [], pathScope: ['impl/**'], risk: 'high',
      budget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
      verification: {
        command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'],
        expectExit: 0, expectResult: 'exit_code', timeoutMs: 60_000,
        maxOutputBytes: 1_000_000, requiredPredecessorEvidence: [],
      },
      routes: { harnesses: [route.vendor], models: [route.model], efforts: [route.effort] },
      capabilities: ['code', 'test'], effects: ['repository_edit', 'provider_call'],
    })),
  }, auth('planner', `plan:${name}`, runId)).plan;
  store.approvePlan({
    goal: ref('goal', goal), plan: ref('plan', plan),
    expectedDisposition: null, disposition: 'approved',
  }, auth('approver', `approval:${name}`, runId));

  const entries = Object.entries(routes).map(([nodeKey, route]) => {
    const node = plan.nodes.find((candidate) => candidate.key === nodeKey);
    const gate = {
      goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
      planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
      nodeKey, expectedDispatchVersion: 0,
      capabilities: node.capabilities, effects: node.effects,
      ...(Object.hasOwn(node, 'requiredEffects')
        ? { requiredEffects: node.requiredEffects } : {}),
    };
    const state = store.previewPlanDispatch(gate, route);
    const id = `wave-${name}-${nodeKey}`;
    return {
      gate, route,
      fields: {
        id, brief: state.brief, deps: [], refines: null, runId,
        taskType: 'general', reservedWorkerId: `worker:${id}`,
        vendorRequested: route.vendor, modelRequested: route.model, modelPolicy: null,
        effortRequested: route.effort, effortResolved: null, effortObserved: null,
        routeKey: null, sessionRequest: { mode: 'new' },
      },
    };
  });
  const waveAuth = auth('dispatcher', `wave:${name}`, runId);
  const created = dispatch ? store.createPlanGatedWave(entries, waveAuth) : null;
  return { directory, store, entries, waveAuth, created, runId };
}

function rewriteWave(directory, mutate) {
  const path = join(directory, 'events.jsonl');
  const rows = readFileSync(path, 'utf8').trimEnd().split('\n').map(JSON.parse);
  const wave = rows.filter((event) => event.batch?.kind === 'goal_plan_wave_dispatch');
  mutate(wave, rows);
  if (wave.length > 0) {
    const batchId = digest({
      schemaVersion: 1,
      kind: 'goal_plan_wave_dispatch',
      entries: wave.map((event) => ({
        kind: event.kind, actor: event.actor,
        idempotencyKey: event.idempotencyKey, payload: event.payload,
      })),
    });
    wave.forEach((event) => { event.batch.id = batchId; });
  }
  writeFileSync(path, `${rows.map(JSON.stringify).join('\n')}\n`);
}

test('WF79-R1: exact Wave dispatch replays idempotently and changed membership conflicts without new tasks', (t) => {
  const f = fixture('replay');
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  const before = f.store.snapshot();
  f.store.releaseWriterLease();

  const replay = new CoordinationStore(f.directory, { goalPlanPolicy: policy });
  assert.deepEqual(replay.snapshot(), before);
  const lastSeq = replay.snapshot().lastSeq;
  const exact = replay.createPlanGatedWave(f.entries, f.waveAuth);
  assert.equal(exact.result, 'idempotent');
  assert.equal(replay.snapshot().lastSeq, lastSeq);
  assert.throws(() => replay.createPlanGatedWave([
    f.entries[0],
    { ...f.entries[1], fields: { ...f.entries[1].fields, reservedWorkerId: 'worker:substituted' } },
  ], f.waveAuth), (error) => error?.code === 'plan_wave_conflict');
  assert.equal(replay.snapshot().lastSeq, lastSeq);
  replay.releaseWriterLease();
});

test('WF79-R2: a torn Wave batch fails closed during replay', (t) => {
  const f = fixture('torn');
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  f.store.releaseWriterLease();
  const path = join(f.directory, 'events.jsonl');
  const rows = readFileSync(path, 'utf8').trimEnd().split('\n');
  rows.pop();
  writeFileSync(path, `${rows.join('\n')}\n`);
  assert.throws(
    () => new CoordinationStore(f.directory, { goalPlanPolicy: policy }),
    (error) => error?.code === 'goal_plan_batch_integrity',
  );
});

test('WF79-R3: a self-consistent batch-id forgery cannot substitute the authoritative Wave digest', (t) => {
  const f = fixture('digest-forgery');
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  f.store.releaseWriterLease();
  rewriteWave(f.directory, (wave) => {
    for (const event of wave.filter((row) => row.kind === 'plan.node_dispatched')) {
      event.payload.wave.digest = 'f'.repeat(64);
    }
  });
  assert.throws(
    () => new CoordinationStore(f.directory, { goalPlanPolicy: policy }),
    (error) => error?.code === 'goal_plan_batch_integrity',
  );
});

test('WF79-R4: an admitted Run stop fences the Wave at the last pre-write boundary', (t) => {
  const f = fixture('stop-fence', { dispatch: false });
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  const reasonDigest = digest('Stop before the reserved Wave can append.');
  const requestCore = { repoId: policy.repoId, runId: f.runId, reasonDigest };
  f.store.admitRunStop({
    schemaVersion: 1, ...requestCore, requestDigest: digest(requestCore),
  }, { actor: 'operator:phase79', key: `run.stop:${f.runId}` });
  const before = f.store.snapshot().lastSeq;
  assert.throws(
    () => f.store.createPlanGatedWave(f.entries, f.waveAuth),
    (error) => error?.code === 'run_stopping',
  );
  assert.equal(f.store.snapshot().lastSeq, before);
  assert.equal(f.store.events().some((event) => event.batch?.kind === 'goal_plan_wave_dispatch'), false);
  f.store.releaseWriterLease();
});
