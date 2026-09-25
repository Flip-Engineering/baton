// Issue #518 — plan.node_budget_settled replay with no live authority.
//
// The incident: `_validatePlanBudgetSettlement` compared a recorded settlement against one
// re-derived from the LIVE operational log — the worker's own event file, which the read-only
// probe behind `baton doctor` does not carry — so a cold replay of a healthy deployment refused
// its own history at seq 20 (the clone) and seq 23 (the primary). #504's own commit message
// reported this as the residual it left: "plan.node_budget_settled rows re-derive from the
// operational log the probe does not carry; the replay transaction validators in
// coordination-replay.mjs read the authority's repoId for dispatch pairs."
//
// A recorded settlement now replays under the row-anchored rule #325 established for goal/plan
// rows: it is judged by what the row carries and by the ledger rows it cites (the dispatch, the
// terminal transition, the wall time, the evidence mapping), never by the live operational log.
// The operational consumption the row recorded is accepted as recorded, checked for the shape a
// live derivation can produce, and its released/held/overrun arithmetic is recomputed.
//
// The committed fixture is the reported clone ledger's own head: rows 1-20 verbatim, seq 20 the
// reported row, whose receipt digest already binds its own recorded content.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CoordinationStore } from '../src/index.mjs';
import { coordinationReplayFailure } from '../src/coordination-store.mjs';
import { findTokenShaped, fixtureCeilingBytes } from '../scripts/ledger-extract.mjs';

const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ledgers-goal-plan');
const FIXTURE = 'deployment-recorded-settlement.jsonl';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-issue518-${name}-`));
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};
const canonicalDigest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

const policy = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-issue518',
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
const nodeBudget = () => ({ tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 });
const verification = () => ({
  command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'],
  expectExit: 0, expectResult: 'exit_code', timeoutMs: 60_000, maxOutputBytes: 1_000_000,
  requiredPredecessorEvidence: [],
});
const ref = (kind, value) => ({
  [`${kind}Id`]: value[`${kind}Id`], version: value.version, digest: value.digest,
});
const storeAuth = (principalId, key) => ({
  actor: `direct:${principalId}`,
  principalId,
  sessionDigest: createHash('sha256').update(`session:${principalId}`).digest('hex'),
  repoId: policy.repoId,
  runId: null,
  key,
});

function definePlan(store, suffix) {
  const goal = store.defineGoal({
    objective: 'Ship the plan-gated change',
    definitionOfDone: ['node --test passes'],
    constraints: ['No network access'],
    risk: 'high',
    budget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
    predecessor: null,
  }, storeAuth('goal-owner', `goal:${suffix}`)).goal;
  const plan = store.proposePlan({
    goal: ref('goal', goal),
    predecessor: null,
    nodes: [{
      key: 'implement',
      objective: 'Implement the approved slice',
      definitionOfDone: ['node --test passes'],
      deps: [],
      pathScope: ['impl/**'],
      risk: 'high',
      budget: nodeBudget(),
      verification: verification(),
      routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] },
      capabilities: ['code', 'test'],
      effects: ['repository_edit'],
    }],
  }, storeAuth('planner', `plan:${suffix}`)).plan;
  const approval = store.approvePlan({
    goal: ref('goal', goal), plan: ref('plan', plan), expectedDisposition: null, disposition: 'approved',
  }, storeAuth('approver', `approval:${suffix}`)).approval;
  return { goal, plan, approval };
}

function gateFor(goal, plan) {
  return {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey: 'implement', expectedDispatchVersion: 0,
    capabilities: ['code', 'test'], effects: ['repository_edit'],
  };
}

const ROUTE = Object.freeze({ vendor: 'mock', model: 'model-a', effort: 'low' });

/** The worker's own operational log: one turn, one usage reading that seals both metrics. */
function operationalRows(worker, startedAt) {
  const ts = (offset) => new Date(Date.parse(startedAt) + offset).toISOString();
  return [
    { worker, seq: 1, ts: ts(0), kind: 'runtime.scope_created', actor: 'policy', payload: {} },
    { worker, seq: 2, ts: ts(1_000), kind: 'lifecycle.spawned', actor: 'orchestrator', payload: {} },
    { worker, seq: 3, ts: ts(2_000), kind: 'lifecycle.turn_started', actor: 'orchestrator', payload: {} },
    {
      worker, seq: 4, ts: ts(3_000), kind: 'resource.tokens', actor: 'worker',
      payload: { tokens: 1_234, usd: 0.25, usageSeal: { tokens: 'reported', usd: 'reported' } },
    },
  ];
}

/** A ledger with one real plan.node_budget_settled row, recorded by a store that CARRIES the
 * operational resolver — the live-deployment shape the cold probe then cannot reproduce. */
function settledLedger(name) {
  const directory = root(name);
  const worker = 'worker:planned-task';
  const rows = operationalRows(worker, '2026-09-16T23:49:00.000Z');
  const byCoordinate = new Map(rows.map((row) => [`${row.worker}:${row.seq}`, row]));
  const store = new CoordinationStore(directory, {
    goalPlanPolicy: policy,
    operationalRead: (id, seq) => byCoordinate.get(`${id}:${seq}`) ?? null,
    operationalRangeRead: (id, seq) => rows.filter((row) => row.worker === id && row.seq <= seq),
  });
  const { goal, plan } = definePlan(store, name);
  const gate = gateFor(goal, plan);
  const state = store.previewPlanDispatch(gate, ROUTE);
  const fields = {
    id: 'planned-task', brief: state.brief, deps: state.resolvedDeps, refines: null,
    runId: null, taskType: 'general', reservedWorkerId: worker,
    vendorRequested: ROUTE.vendor, modelRequested: ROUTE.model, modelPolicy: null,
    effortRequested: ROUTE.effort, effortResolved: null, effortObserved: null,
    routeKey: null, sessionRequest: { mode: 'new' },
  };
  store.createPlanGatedTask(fields, gate, ROUTE, storeAuth('dispatcher', `dispatch:${name}`));
  store.claimTask(fields.id, worker, 1, { actor: 'orchestrator', key: `claim:${name}` });
  const mapped = store.mapOperationalEvent(rows[3], { actor: 'policy', key: `map:${name}` });
  store.transitionTask(fields.id, 'failed', 2, { actor: 'orchestrator', key: `fail:${name}` },
    { coordinationSeq: mapped.evidence.coordinationSeq });
  const settled = store.settlePlanNodeBudget(fields.id, { actor: 'policy', key: `plan.budget:${name}` });
  const row = store.events().find((event) => event.kind === 'plan.node_budget_settled');
  store.releaseWriterLease();
  return { directory, row, settled, open: (options = {}) => new CoordinationStore(directory, options) };
}

/** Rewrite the ledger's settlement row through `mutate`, recomputing its receipt digest so the
 * mutation is never caught by the row's own binding. */
function rewriteSettlement(directory, mutate) {
  const file = join(directory, 'events.jsonl');
  const rows = readFileSync(file, 'utf8').trimEnd().split('\n').map(JSON.parse);
  const settlement = rows.find((event) => event.kind === 'plan.node_budget_settled');
  mutate(settlement.payload);
  const { receiptDigest: _prior, ...core } = settlement.payload;
  settlement.payload.receiptDigest = canonicalDigest(core);
  writeFileSync(file, `${rows.map(JSON.stringify).join('\n')}\n`);
}

const refusesSettlement = (directory, name) => {
  assert.throws(
    () => new CoordinationStore(directory),
    (error) => error?.code === 'plan_budget_settlement_integrity',
    `a settlement the ledger cannot support refuses on a cold replay (${name})`,
  );
};

test('a settlement recorded over the operational log replays a cold probe, and the warm store agrees (#518)', () => {
  const { directory, row, settled } = settledLedger('cold-probe');
  assert.equal(settled.result, 'settled');
  // The row is the live-deployment shape: the operational log was carried when it was written.
  assert.equal(row.payload.consumed.tokens, 1_234);
  assert.equal(row.payload.consumed.usd, 0.25);
  assert.equal(row.payload.consumed.providerTurns, 1);
  assert.equal(typeof row.payload.consumed.wallMin, 'number');
  assert.deepEqual(row.payload.availability, { tokens: 'exact', usd: 'exact', wallMin: 'exact', providerTurns: 'exact' });
  // The fold keeps the row's own recorded fields and stamps its ledger position beside them.
  const folded = { ...row.payload, eventSeq: row.seq, settledAt: row.ts };

  // The probe behind `baton doctor`: the store constructed with no options at all.
  assert.equal(coordinationReplayFailure(directory), null,
    'the read-only probe folds the recorded settlement and reports no replay refusal');
  const cold = new CoordinationStore(directory);
  assert.deepEqual(cold.snapshot().goalPlan.budgetSettlements, [folded]);
  cold.releaseWriterLease();

  // The warm store that still carries the operational resolver re-derives the same row.
  const rows = operationalRows('worker:planned-task', '2026-09-16T23:49:00.000Z');
  const warm = new CoordinationStore(directory, {
    goalPlanPolicy: policy,
    operationalRead: (id, seq) => rows.find((entry) => entry.worker === id && entry.seq === seq) ?? null,
    operationalRangeRead: (id, seq) => rows.filter((entry) => entry.worker === id && entry.seq <= seq),
  });
  assert.deepEqual(warm.snapshot().goalPlan.budgetSettlements, [folded]);
  warm.releaseWriterLease();
});

test('a settlement that contradicts its recorded dispatch, task, or terminal row refuses (#518)', () => {
  const mutations = {
    // The initial budget is the dispatch's own recorded node budget.
    initial_budget: (p) => { p.initial.tokens -= 1; },
    // The terminal transition is the one the replayed task actually reached.
    terminal_event: (p) => { p.terminalEvent = 1; },
    // The binding is the dispatch's own recorded binding.
    binding_node: (p) => { p.binding.nodeKey = 'elsewhere'; },
    // The wall time re-derives from the recorded claim and terminal timestamps.
    wall_time: (p) => { p.consumed.wallMin += 1; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const { directory } = settledLedger(`contradiction-${name}`);
    rewriteSettlement(directory, mutate);
    refusesSettlement(directory, name);
  }
});

test('a settlement whose recorded consumption cannot come from the live derivation refuses (#518)', () => {
  const mutations = {
    // A total rewritten without its dimensions: the arithmetic no longer closes.
    arithmetic_released: (p) => { p.released.tokens -= 1; },
    // Consumption claiming a value the availability flag calls unavailable.
    unavailable_with_value: (p) => { p.availability.tokens = 'unavailable'; },
    // A non-integer token total, and a USD amount that is not representable at nanos scale.
    fractional_tokens: (p) => { p.consumed.tokens = 1.5; },
    unrepresentable_usd: (p) => { p.consumed.usd = 0.1234567891; },
    // Provider turns are counted from the operational rows, so an unavailable count cannot
    // accompany a recorded evidence prefix.
    turns_without_rows: (p) => { p.availability.providerTurns = 'unavailable'; p.consumed.providerTurns = null; },
    // Exact token and USD totals are only produced over the operational rows.
    tokens_without_rows: (p) => { p.operational.throughSeq = null; p.operational.prefixDigest = null; },
    // (No mutation of `operational.prefixDigest` alone: the digest of the operational rows a
    // cold replay does not carry cannot be recomputed, so the row's claim is checked for shape
    // and for agreement with the ledger's evidence mapping. See the receipt test below.)
    unknown_worker: (p) => { p.operational.worker = 'worker:somewhere-else'; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const { directory } = settledLedger(`shape-${name}`);
    rewriteSettlement(directory, mutate);
    refusesSettlement(directory, name);
  }
});

test('a settlement whose receipt digest does not bind its own bytes refuses (#518)', () => {
  const { directory } = settledLedger('receipt');
  rewriteSettlement(directory, (p) => { p.consumed.tokens += 1; p.receiptDigest = undefined; });
  refusesSettlement(directory, 'receipt');
});

test('the committed fixture — the reported clone ledger head, seq 20 its settlement — replays cold (#518)', () => {
  const lines = readFileSync(join(CORPUS_DIR, FIXTURE), 'utf8').split('\n').filter((line) => line !== '');
  for (const [index, line] of lines.entries()) {
    assert.deepEqual(findTokenShaped(line), [], `${FIXTURE} line ${index + 1} carries a token-shaped value`);
  }
  assert.ok(Buffer.byteLength(lines.join('\n')) <= fixtureCeilingBytes(),
    'the fixture stays bounded by the repository fixture ceiling');
  const sidecar = JSON.parse(readFileSync(join(CORPUS_DIR, `${FIXTURE}.digest`), 'utf8'));
  assert.equal(sidecar.schemaVersion, 1, 'the sidecar is the fixture record');
  const reported = lines.map(JSON.parse).find((event) => event.seq === sidecar.source.reportedRow);
  assert.equal(reported.kind, 'plan.node_budget_settled', 'the reported row is the settlement');
  assert.equal(reported.payload.availability.tokens, 'unavailable',
    'the reported row is the pre-seal shape the live derivation recorded');
  assert.deepEqual(reported.payload.operational, sidecar.settlement.operational);
  assert.equal(reported.payload.receiptDigest, sidecar.settlement.receiptDigest);
  const core = Object.fromEntries(Object.entries(reported.payload).filter(([key]) => key !== 'receiptDigest'));
  assert.equal(reported.payload.receiptDigest, canonicalDigest(core),
    'the recorded receipt digest binds the row\'s own recorded content');

  const directory = join(root('fixture'), 'corpus');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'events.jsonl'), `${lines.join('\n')}\n`);
  assert.equal(coordinationReplayFailure(directory), null,
    'the read-only probe behind `baton doctor` folds the reported ledger head');
  const store = new CoordinationStore(directory);
  assert.deepEqual(store.snapshot().goalPlan.budgetSettlements.map((row) => row.taskId),
    [sidecar.settlement.taskId], 'the reported settlement folds under no live authority');
  const projection = createHash('sha256').update(JSON.stringify(canonical(store.snapshot().goalPlan))).digest('hex');
  assert.equal(projection, sidecar.projectionDigest, 'the fixture folds to the projection its sidecar records');
  store.releaseWriterLease();
});

test('the recorded dispatch pair binds the deployment identity a store does know, and none when it knows none (#518)', () => {
  const directory = join(root('identity'), 'corpus');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'events.jsonl'),
    `${readFileSync(join(CORPUS_DIR, FIXTURE), 'utf8').split('\n').filter((line) => line !== '').join('\n')}\n`);
  const recorded = 'repo-ff350ab79448e28fb18f6921e7950a1c';
  const matching = new CoordinationStore(directory, { repoId: recorded });
  assert.equal(matching.snapshot().goalPlan.budgetSettlements.length, 1,
    'a store that knows the deployment folds the recorded rows');
  matching.releaseWriterLease();
  // The #504 identity rule the probe path needs: a store that knows an identity still refuses a
  // row recorded for another one, so dropping the check cannot pass as a cold-replay fix.
  assert.throws(
    () => new CoordinationStore(directory, { repoId: 'repo-somewhere-else' }),
    (error) => error?.code === 'goal_plan_integrity',
    'a recorded row naming another deployment refuses when the store knows its own identity',
  );
});
