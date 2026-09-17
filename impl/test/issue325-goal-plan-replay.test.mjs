// Issue #325 — goal/plan replay under the RECORDED policy digest.
//
// The incident: `_applyGoalPlanEvent` re-normalised every recorded goal/plan under the
// LIVE goal/plan policy and refused replay when the row's policyDigest differed from the
// live one — so a deployment whose policy had ever been edited could not reopen its own
// ledger (the #292 regression class #304 closed for the swarm fold only). A recorded
// goal replays under the policy digest it was RECORDED under (the row carries it), never
// re-judged by the live policy.
//
// This file pins that: a ledger with goals recorded under TWO policy digests opens under
// either policy, folds to the same projection, and serves new goal/plan traffic — while a
// row whose recorded bytes are tampered with still refuses closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CoordinationIntegrityError, CoordinationStore } from '../src/index.mjs';
import { normalizeGoalPlanPolicy } from '../src/goal-plan.mjs';
import { findTokenShaped, fixtureCeilingBytes } from '../scripts/ledger-extract.mjs';

const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ledgers-goal-plan');

const root = (name) => mkdtempSync(join(tmpdir(), `baton-issue325-${name}-`));
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};
const canonicalDigest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

// Two policies for one deployment: same repo identity, different digests. Policy B both
// retires a digest (approvalTtlMs) and TIGHTENS a ceiling (maxTokens) below the budget
// policy A already admitted — the exact shape of the incident: history legal-then,
// illegal-now, yet still ours to replay.
const policyA = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-issue325',
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});
const policyB = Object.freeze({
  ...policyA,
  approvalTtlMs: 2 * 60 * 60 * 1000,
  limits: Object.freeze({ ...policyA.limits, maxTokens: 12_000 }),
});
const digestA = normalizeGoalPlanPolicy(policyA).policyDigest;
const digestB = normalizeGoalPlanPolicy(policyB).policyDigest;

const auth = (principalId, key) => ({
  actor: `direct:${principalId}`,
  principalId,
  sessionDigest: createHash('sha256').update(`session:${principalId}`).digest('hex'),
  repoId: policyA.repoId,
  runId: null,
  key,
});
const ref = (kind, value) => ({
  [`${kind}Id`]: value[`${kind}Id`], version: value.version, digest: value.digest,
});
const verification = () => ({
  command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'],
  expectExit: 0, expectResult: 'exit_code', timeoutMs: 60_000, maxOutputBytes: 1_000_000,
  requiredPredecessorEvidence: [],
});
const node = (tokens, definitionOfDone = ['node --test passes']) => [{
  key: 'implement',
  objective: 'Implement the approved slice',
  definitionOfDone,
  deps: [],
  pathScope: ['impl/**'],
  risk: 'high',
  budget: { tokens, usd: 1, wallMin: 5, providerTurns: 4 },
  verification: verification(),
  routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] },
  capabilities: ['code'],
  effects: ['repository_edit'],
}];
const gateFor = (goal, plan) => ({
  goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
  planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
  nodeKey: 'implement', expectedDispatchVersion: 0,
  capabilities: ['code'], effects: ['repository_edit'],
});
const taskFields = (state, id) => ({
  id,
  brief: state.brief,
  deps: state.resolvedDeps,
  refines: null,
  runId: null,
  taskType: 'general',
  reservedWorkerId: `worker:${id}`,
  vendorRequested: 'mock',
  modelRequested: 'model-a',
  modelPolicy: null,
  effortRequested: 'low',
  effortResolved: null,
  effortObserved: null,
  routeKey: null,
  sessionRequest: { mode: 'new' },
});

// The two-digest ledger: goal/plan/approval/dispatch recorded under policy A, then a
// successor goal/plan/approval recorded under policy B on the same ledger.
function writeTwoDigestLedger(directory) {
  assert.notEqual(digestA, digestB, 'the fixture premise: two policies, two digests');
  const underA = new CoordinationStore(directory, { goalPlanPolicy: policyA });
  const goalA = underA.defineGoal({
    objective: 'Ship the two-policy change',
    definitionOfDone: ['node --test passes'],
    constraints: ['No network access'],
    risk: 'high',
    budget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
    predecessor: null,
  }, auth('goal-owner', 'goal:two-digest:1')).goal;
  assert.equal(goalA.policyDigest, digestA, 'the first goal is recorded under policy A');
  const planA = underA.proposePlan({
    goal: ref('goal', goalA), predecessor: null, nodes: node(10_000),
  }, auth('planner', 'plan:two-digest:1')).plan;
  underA.approvePlan({
    goal: ref('goal', goalA), plan: ref('plan', planA),
    expectedDisposition: null, disposition: 'approved',
  }, auth('approver', 'approval:two-digest:1'));
  const gateA = gateFor(goalA, planA);
  const route = { vendor: 'mock', model: 'model-a', effort: 'low' };
  const stateA = underA.previewPlanDispatch(gateA, route);
  underA.createPlanGatedTask(taskFields(stateA, 'two-digest-task-a'), gateA, route, auth('dispatcher', 'dispatch:two-digest:a'));
  underA.releaseWriterLease();

  // Reopening under the edited policy replays policy-A history: the incident refused here.
  const underB = new CoordinationStore(directory, { goalPlanPolicy: policyB });
  const goalB = underB.defineGoal({
    objective: 'Ship the two-policy change',
    definitionOfDone: ['node --test passes', 'two-policy replay opens'],
    constraints: ['No network access'],
    risk: 'high',
    budget: { tokens: 5_000, usd: 1, wallMin: 5, providerTurns: 4 },
    predecessor: ref('goal', goalA),
  }, auth('goal-owner', 'goal:two-digest:2')).goal;
  assert.equal(goalB.policyDigest, digestB, 'the successor goal is recorded under policy B');
  const planB = underB.proposePlan({
    goal: ref('goal', goalB), predecessor: null,
    nodes: node(2_500, ['node --test passes', 'two-policy replay opens']),
  }, auth('planner', 'plan:two-digest:2')).plan;
  underB.approvePlan({
    goal: ref('goal', goalB), plan: ref('plan', planB),
    expectedDisposition: null, disposition: 'approved',
  }, auth('approver', 'approval:two-digest:2'));
  underB.releaseWriterLease();
  return { goalA, planA, goalB, planB };
}

test('a ledger with goals recorded under two policy digests opens under either policy, folds alike, and serves', () => {
  const directory = root('two-digest');
  const { goalA, planA, goalB, planB } = writeTwoDigestLedger(directory);

  const underB = new CoordinationStore(directory, { goalPlanPolicy: policyB });
  const underA = new CoordinationStore(directory, { goalPlanPolicy: policyA });
  assert.deepEqual(underB.snapshot().goalPlan, underA.snapshot().goalPlan,
    'the fold is policy-independent: either live policy replays the same projection');
  assert.equal(underB.snapshot().goalPlan.goals.length, 2);
  assert.equal(underB.snapshot().goalPlan.plans.length, 2);
  underB.releaseWriterLease();
  underA.releaseWriterLease();

  // Serve: read old authority and admit new traffic on the reopened store.
  const live = new CoordinationStore(directory, { goalPlanPolicy: policyB });
  const scope = { repoId: policyA.repoId, runId: null };
  const statusA = live.goalPlanStatus({
    goalId: goalA.goalId, goalVersion: goalA.version, goalDigest: goalA.digest,
    planId: planA.planId, planVersion: planA.version, planDigest: planA.digest, throughSeq: null,
  }, scope);
  assert.equal(statusA.nodes[0].state, 'dispatched', 'old dispatch authority still reads after reopen');
  const goalC = live.defineGoal({
    objective: 'Ship the two-policy change',
    definitionOfDone: ['node --test passes', 'two-policy replay opens', 'serve after reopen'],
    constraints: ['No network access'],
    risk: 'high',
    budget: { tokens: 2_000, usd: 1, wallMin: 5, providerTurns: 4 },
    predecessor: ref('goal', goalB),
  }, auth('goal-owner', 'goal:two-digest:3')).goal;
  assert.equal(goalC.version, 3);
  assert.equal(goalC.policyDigest, digestB, 'new traffic is recorded under the live digest');
  const planC = live.proposePlan({
    goal: ref('goal', goalC), predecessor: null,
    nodes: node(1_000, ['node --test passes', 'two-policy replay opens', 'serve after reopen']),
  }, auth('planner', 'plan:two-digest:3')).plan;
  live.approvePlan({
    goal: ref('goal', goalC), plan: ref('plan', planC),
    expectedDisposition: null, disposition: 'approved',
  }, auth('approver', 'approval:two-digest:3'));
  const gateC = gateFor(goalC, planC);
  const route = { vendor: 'mock', model: 'model-a', effort: 'low' };
  const stateC = live.previewPlanDispatch(gateC, route);
  const created = live.createPlanGatedTask(taskFields(stateC, 'two-digest-task-c'), gateC, route, auth('dispatcher', 'dispatch:two-digest:c'));
  assert.equal(created.result, 'created');
  assert.equal(live.snapshot().goalPlan.goals.length, 3, 'the served rows join the same projection');
  live.releaseWriterLease();
});

test('the committed two-digest fixture opens, folds to its sidecar digest, and serves', () => {
  const name = 'two-policy-digests.jsonl';
  const lines = readFileSync(join(CORPUS_DIR, name), 'utf8').split('\n').filter((line) => line !== '');
  const sidecar = JSON.parse(readFileSync(join(CORPUS_DIR, `${name}.digest`), 'utf8'));
  assert.equal(sidecar.schemaVersion, 1, 'the sidecar is the fixture digest record');
  assert.ok(lines.length > 0, 'the fixture is not empty');
  // The fixture is bound to the two in-test policies: the rows it carries were recorded
  // under exactly these digests, so generator drift fails here, not in replay.
  for (const key of ['A', 'B']) {
    assert.equal(normalizeGoalPlanPolicy(sidecar.policies[key]).policyDigest, sidecar.source.policyDigests[key === 'A' ? 0 : 1]);
  }
  assert.equal(sidecar.source.policyDigests[0], digestA);
  assert.equal(sidecar.source.policyDigests[1], digestB);
  const carried = new Set();
  let previousSeq = 0;
  for (const [index, line] of lines.entries()) {
    const event = JSON.parse(line);
    assert.ok(Number.isSafeInteger(event.seq) && event.seq > previousSeq,
      `${name} line ${index + 1}: rows keep their original ledger order`);
    previousSeq = event.seq;
    for (const digest of [event.payload?.goal?.policyDigest, event.payload?.plan?.policyDigest,
      event.payload?.approval?.policyDigest, event.payload?.binding?.policyDigest,
      event.payload?.brief?.goalPlan?.policyDigest]) {
      if (digest !== undefined) carried.add(digest);
    }
    assert.deepEqual(findTokenShaped(line), [], `${name} line ${index + 1} carries a token-shaped value`);
  }
  assert.deepEqual([...carried].sort(), [digestA, digestB].sort(),
    'every goal/plan row was recorded under one of the two fixture digests');
  const bytes = Buffer.byteLength(lines.join('\n'));
  assert.ok(bytes <= fixtureCeilingBytes(), 'the fixture stays bounded by the repository fixture ceiling');

  const directory = root('corpus');
  mkdirSync(join(directory, 'corpus'), { recursive: true });
  const ledgerDir = join(directory, 'corpus');
  writeFileSync(join(ledgerDir, 'events.jsonl'), `${lines.join('\n')}\n`);
  const store = new CoordinationStore(ledgerDir, { goalPlanPolicy: sidecar.policies.B });
  const folded = createHash('sha256').update(JSON.stringify(canonical(store.snapshot().goalPlan))).digest('hex');
  assert.equal(folded, sidecar.digest,
    'the fixture replays to its recorded projection — a fold rule refusing recorded history fails here');
  assert.equal(store.snapshot().goalPlan.goals.length, 2);

  // Serve: read old authority and admit new traffic on the opened fixture.
  const scope = { repoId: policyA.repoId, runId: null };
  const head = store.snapshot().goalPlan.goals.find((goal) => goal.version === 2);
  const statusCoordinates = (goal, plan) => ({
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest, throughSeq: null,
  });
  const planHead = store.snapshot().goalPlan.plans.find((plan) => plan.goal.digest === head.digest);
  const status = store.goalPlanStatus(statusCoordinates(head, planHead), scope);
  assert.equal(status.goal.version, 2, 'old authority still reads after open');
  const goalC = store.defineGoal({
    objective: 'Ship the two-policy change',
    definitionOfDone: [...head.definitionOfDone, 'fixture serves after open'],
    constraints: [...head.constraints],
    risk: 'high',
    budget: { tokens: 2_000, usd: 1, wallMin: 5, providerTurns: 4 },
    predecessor: ref('goal', head),
  }, auth('goal-owner', 'goal:two-digest:fixture:3')).goal;
  assert.equal(goalC.policyDigest, digestB, 'served rows are recorded under the live digest');
  const planC = store.proposePlan({
    goal: ref('goal', goalC), predecessor: null,
    nodes: node(1_000, [...head.definitionOfDone, 'fixture serves after open']),
  }, auth('planner', 'plan:two-digest:fixture:3')).plan;
  store.approvePlan({
    goal: ref('goal', goalC), plan: ref('plan', planC),
    expectedDisposition: null, disposition: 'approved',
  }, auth('approver', 'approval:two-digest:fixture:3'));
  const gateC = gateFor(goalC, planC);
  const route = { vendor: 'mock', model: 'model-a', effort: 'low' };
  const created = store.createPlanGatedTask(
    taskFields(store.previewPlanDispatch(gateC, route), 'two-digest-fixture-task'),
    gateC, route, auth('dispatcher', 'dispatch:two-digest:fixture'));
  assert.equal(created.result, 'created', 'the opened fixture dispatches new work');
  store.releaseWriterLease();
});

test('tampered recorded goal bytes still refuse closed instead of folding', () => {
  const directory = root('tampered');
  writeTwoDigestLedger(directory);
  const file = join(directory, 'events.jsonl');
  const rows = readFileSync(file, 'utf8').trimEnd().split('\n').map(JSON.parse);
  const goalRow = rows.find((event) => event.kind === 'goal.version_defined');
  goalRow.payload.goal.budget.tokens += 1;
  writeFileSync(file, `${rows.map(JSON.stringify).join('\n')}\n`);
  assert.throws(
    () => new CoordinationStore(directory, { goalPlanPolicy: policyB }),
    (error) => error instanceof CoordinationIntegrityError && error.code === 'goal_plan_integrity',
    'a recorded goal whose bytes no longer match its digest refuses even though the digest names a known policy',
  );
});
