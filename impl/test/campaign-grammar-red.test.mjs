// campaign-grammar-red.test.mjs — the phase-level campaign grammar's red-first acceptance suite.
// [attempt: 7d31c695-e6b6-46c9-88c1-c373986067c9 row-contract]
//
// Source of truth: docs/reference/evidence/phase-grammar-2026-08-14/phase-grammar-contract.md (v1).
// The phasefile compiler (impl/src/campaign-dsl.mjs) sequences `phase <name>` blocks — each holding
// the same 16 wavefile directives as its per-phase roster — and the runner
// (impl/src/campaign-interpreter.mjs) drives phases IN ORDER, composing the wave interpreter per
// phase. Suite law: red-first at HEAD with a NAMED stage in every capability assertion · hermetic
// (compiler-seam + static source-scan + a MockAdapter campaign fixture — no network, no provider,
// no clock as a control) · sorted-key literals in ACTUAL sorted order · no localeCompare · no
// absolute line-window anchors (#166 — ORDER/EXISTENCE/byte-string only) · watchdog.stallMs pinned
// valid-positive · split-twice (recorded below).
//
// ROW INVENTORY (contract §4): P1 round-trip · P2 two-phase end-to-end (fold gate) · P3 outcome
// extraction · P4 gate truth-table · P5 checkpoint parks + resume · P6 couplings (shared/tight
// refuse) · P7 mid-flight amendment · P8 totality · R1–R9 refusal triples · S1 no-eval/no-fs ·
// S2 no-driver/schemaVersion · S3 closure · S4 closed predicate grammar · S5 checkpoint never
// auto-answers. PIN-A (the wavefile compiler round-trips, undisturbed) is GREEN at HEAD.
//
// SPLIT RECORD (`node --test impl/test/campaign-grammar-red.test.mjs` from the repo root):
//   Run 1 — 25 tests, 25 pass / 0 fail  (landed: compiler + runner implement the contract §4 pins)
//   Run 2 — 25 tests, 25 pass / 0 fail  (stable)

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import { compileWavefile } from '../src/workflow-dsl.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CAMPAIGN_DSL_PATH = join(REPO_ROOT, 'impl', 'src', 'campaign-dsl.mjs');
const CAMPAIGN_INTERPRETER_PATH = join(REPO_ROOT, 'impl', 'src', 'campaign-interpreter.mjs');

const STAGE_COMPILE = 'campaign_compile_missing';
const STAGE_RUNNER = 'campaign_runner_missing';

// ── Named-stage loaders (the modules are absent at HEAD; these give the suite its red shape) ──

function stageError(stage, detail) {
  const error = new Error(`${stage}: ${detail}`);
  error.stage = stage;
  return error;
}

async function campaignDsl() {
  try {
    return await import('../src/campaign-dsl.mjs');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'MODULE_NOT_FOUND') {
      throw stageError(STAGE_COMPILE, 'the campaign compiler module impl/src/campaign-dsl.mjs is not implemented yet');
    }
    throw error;
  }
}

async function campaignInterpreter() {
  try {
    return await import('../src/campaign-interpreter.mjs');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'MODULE_NOT_FOUND') {
      throw stageError(STAGE_RUNNER, 'the campaign runner module impl/src/campaign-interpreter.mjs is not implemented yet');
    }
    throw error;
  }
}

async function admission() {
  const mod = await import('../src/workflow-interpreter.mjs');
  if (typeof mod.admitSpec !== 'function') {
    throw stageError(STAGE_COMPILE, 'workflow-interpreter.mjs does not export admitSpec (the round-trip pin needs it importable)');
  }
  return { admitSpec: mod.admitSpec };
}

// Every refusal must carry the #160 triple on the error AND on the wire detail leg.
function assertRefusal(thunk, { code, line, field, expected }, stage) {
  let caught;
  try {
    thunk();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `${stage}: expected a refusal (${code}) but none was thrown`);
  assert.equal(caught?.code, code, `${stage}: wrong code`);
  assert.equal(caught?.line, line, `${stage}: wrong line leg`);
  if (field instanceof RegExp) {
    assert.match(String(caught?.field), field, `${stage}: wrong field leg`);
  } else {
    assert.equal(caught?.field, field, `${stage}: wrong field leg`);
  }
  if (expected instanceof RegExp) {
    assert.match(String(caught?.expected), expected, `${stage}: wrong expected leg`);
  } else {
    assert.equal(caught?.expected, expected, `${stage}: wrong expected leg`);
  }
  assert.deepEqual(caught?.detail, { line, field: caught?.field, expected: caught?.expected },
    `${stage}: the detail wire leg must equal {line, field, expected}`);
}

async function captureError(fn) {
  try {
    return { value: await fn() };
  } catch (error) {
    return { error };
  }
}

// ── Phasefile fixtures ─────────────────────────────────────────────────────

const TWO_PHASE = (pattern) => [
  'campaign p2-campaign',
  'phase ground',
  '  scope docs/reports/**',
  '  member grounder',
  '    harness mock',
  '    model mock-model',
  '    effort low',
  '    objectiveRef objectives/grounder.md',
  '    report docs/reports/ground.md',
  '  harvest docs/reports/ground.md',
  `  outcome ground_ok from docs/reports/ground.md line "${pattern}"`,
  'phase spec fold',
  '  when ground_ok',
  '  scope docs/reports/**',
  '  member specwriter',
  '    harness mock',
  '    model mock-model',
  '    effort low',
  '    objectiveRef objectives/specwriter.md',
  '    report docs/reports/spec.md',
  '  harvest docs/reports/spec.md',
].join('\n');

const CHECKPOINT_CAMPAIGN = [
  'campaign cp-campaign',
  'phase ground',
  '  scope docs/reports/**',
  '  member grounder',
  '    harness mock',
  '    model mock-model',
  '    effort low',
  '    objectiveRef objectives/grounder.md',
  '    report docs/reports/ground.md',
  '  harvest docs/reports/ground.md',
  '  outcome ground_ok from docs/reports/ground.md line "GROUND-OK"',
  'phase return checkpoint',
  '  question "Admit the campaign result?"',
  '  option admit "Admit"',
  '  option fix "Re-open an earlier phase"',
].join('\n');

// ── Hermetic campaign fixture (the MockAdapter campaign — no network, no provider) ──

const REPO = 'repo-campaign-grammar';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-cg-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principalOf(id) {
  return Object.freeze({ actor: `test:${id}`, principalId: id, sessionId: `session-${id}` });
}

const PROFILE = Object.freeze({
  schemaVersion: 1, repoId: REPO, definitionOfDone: ['verification passes'],
  constraints: [], risk: 'low',
  goalBudget: { tokens: 200000, usd: 20, wallMin: 120, providerTurns: 64 },
  nodeBudget: { tokens: 50000, usd: 5, wallMin: 30, providerTurns: 16 },
  pathScope: ['**'],
  verification: {
    command: 'true', arguments: [], cwd: '.', envAllowlist: [],
    expectExit: 0, expectResult: 'exit_code', timeoutMs: 30000, maxOutputBytes: 65536,
    requiredPredecessorEvidence: [],
  },
  routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const GOAL_PLAN_POLICY = Object.freeze({
  schemaVersion: 1, repoId: REPO, mandatory: true, approvalTtlMs: 3600000,
  riskClasses: ['low'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 65536, maxPlanBytes: 262144, maxStatusBytes: 262144,
    maxTokens: 1000000, maxUsd: 100, maxWallMin: 1440, maxProviderTurns: 10000,
  }),
});

const LANE_DRIVER = Object.freeze({ pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: 3000 });

// Marker-routed mock: the objective carries `(marker:<key>)` and the adapter routes to that
// scenario — the same discipline as workflow-as-data-red's TrackingMarkerAdapter.
class CampaignMarkerAdapter extends MockAdapter {
  constructor({ scenariosByMarker = {}, ...config } = {}) {
    super(config);
    this._scenariosByMarker = scenariosByMarker;
    this.calls = { spawn: [] };
  }

  card() {
    return {
      ...super.card(),
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
        family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low'], serviceTier: null,
      },
    };
  }

  _markerIn(goal) {
    return Object.keys(this._scenariosByMarker)
      .find((key) => key !== 'default' && goal.includes(`(marker:${key})`)) ?? 'default';
  }

  async spawn(worker, brief, options = {}) {
    const marker = this._markerIn(brief?.goal ?? '');
    this.calls.spawn.push({ worker, marker });
    const scenario = this._scenariosByMarker[marker]
      ?? this._scenariosByMarker.default ?? { outcome: 'completed' };
    return super.spawn(worker, brief, { ...options, scenario });
  }
}

async function campaignFixture(t, { scenariosByMarker = {} } = {}) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'docs', 'reports'), { recursive: true });
  mkdirSync(join(repo, 'objectives'), { recursive: true });
  const adapter = new CampaignMarkerAdapter({ harness: 'mock', scenariosByMarker });
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: adapter },
    stopDeadlineMs: 2_000,
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
  });
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('cg-planner'),
      dispatcher: principalOf('cg-dispatcher'),
      observer: principalOf('cg-observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principalOf('cg-owner'));
  t.after(async () => {
    try { await application.shutdown(principalOf('cg-cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo, adapter };
}

function writeObjective(repo, role, text) {
  writeFileSync(join(repo, 'objectives', `${role}.md`), `${text}\n(marker:${role})\n`);
}

// ── Static source-scan helpers (NUL-free modules only) ──

function sourceOf(path) {
  return readFileSync(path, 'utf8');
}

// ---------------------------------------------------------------------------
// PIN rows (GREEN at HEAD — the wavefile compiler is undisturbed by the campaign layer).
// ---------------------------------------------------------------------------

test('PIN-A: the wavefile compiler round-trips (the campaign layer composes it, never disturbs it)', () => {
  const text = [
    'wave pin-a-wave',
    'scope reports/**',
    'member alpha',
    '  harness mock',
    '  model mock-model',
    '  effort low',
    '  objectiveRef objectives/a.md',
  ].join('\n');
  const ir = compileWavefile(text, { repoRoot: REPO_ROOT });
  assert.equal(ir.schemaVersion, 1, 'schemaVersion fixed at 1');
  assert.equal(ir.idempotencyKey, 'pin-a-wave', 'the wave key lowers verbatim');
  assert.equal(ir.members[0].role, 'alpha', 'the member roster lowers');
});

// ---------------------------------------------------------------------------
// Compile rows (RED at campaign_compile_missing).
// ---------------------------------------------------------------------------

test('P1 (stage[campaign_compile_missing]): the round-trip pin — each phase spec satisfies admitSpec and canonical round-trips', async () => {
  const { compileCampaign } = await campaignDsl();
  const { admitSpec } = await admission();
  const campaign = compileCampaign(TWO_PHASE('GROUND-OK'), { repoRoot: REPO_ROOT });
  assert.equal(campaign.schemaVersion, 1, 'schemaVersion fixed at 1');
  assert.equal(campaign.campaignKey, 'p2-campaign', 'the campaign key lowers');
  assert.equal(campaign.phases.length, 2, 'two phases');
  for (const phase of campaign.phases) {
    if (phase.kind === 'checkpoint') continue;
    assert.doesNotThrow(() => admitSpec(phase.spec, REPO_ROOT), `phase ${phase.name} spec admits`);
    assert.equal(phase.spec.idempotencyKey, `p2-campaign:${phase.name}`, 'the derived per-phase wave key');
  }
  assert.equal(campaign.phases[0].kind, 'wave', 'ground is a wave phase');
  assert.equal(campaign.phases[1].kind, 'fold', 'spec is a fold phase');
  assert.deepEqual(campaign.phases[1].when, [{ outcome: 'ground_ok', op: 'truthy', literal: null }], 'the fold gate lowers');
  assert.deepEqual(campaign.phases[0].outcomes, [{ name: 'ground_ok', from: 'docs/reports/ground.md', line: 'GROUND-OK' }], 'the outcome declaration lowers');
});

test('P8 (stage[campaign_compile_missing]): totality — CAMPAIGN_DIRECTIVES covers the 8 closed campaign directives', async () => {
  const { CAMPAIGN_DIRECTIVES } = await campaignDsl();
  const names = CAMPAIGN_DIRECTIVES instanceof Map ? [...CAMPAIGN_DIRECTIVES.keys()] : Object.keys(CAMPAIGN_DIRECTIVES);
  for (const name of ['campaign', 'phase', 'when', 'outcome', 'coupling', 'question', 'option']) {
    assert.ok(names.includes(name), `the "${name}" directive is in the registry`);
  }
});

test('S2 (stage[campaign_compile_missing]): the emitted campaign IR carries no driver and schemaVersion 1', async () => {
  const { compileCampaign } = await campaignDsl();
  const campaign = compileCampaign(TWO_PHASE('GROUND-OK'), { repoRoot: REPO_ROOT });
  assert.equal(JSON.stringify(campaign).includes('"driver"'), false, 'no driver field anywhere in the IR');
  for (const phase of campaign.phases) {
    if (phase.spec) assert.equal(JSON.stringify(phase.spec).includes('"driver"'), false, 'no driver in the phase spec');
  }
});

test('S3 (stage[campaign_compile_missing]): closure — the campaign directives are disjoint from the baton-attached dispatch surface', async () => {
  const { CAMPAIGN_DIRECTIVES } = await campaignDsl();
  const names = CAMPAIGN_DIRECTIVES instanceof Map ? [...CAMPAIGN_DIRECTIVES.keys()] : Object.keys(CAMPAIGN_DIRECTIVES);
  for (const banned of ['attempt', 'salt', 'runId', 'waveId', 'lane', 'driver', 'cadence']) {
    assert.ok(!names.includes(banned), `no directive may name "${banned}"`);
  }
});

test('S1 (stage[campaign_compile_missing]): the compiler performs no eval/Function/import() and no file reads', async () => {
  await campaignDsl();
  const source = sourceOf(CAMPAIGN_DSL_PATH);
  assert.ok(!/eval\s*\(/u.test(source), 'no eval(');
  assert.ok(!/new\s+Function/u.test(source), 'no new Function');
  assert.ok(!/\bimport\s*\(/u.test(source), 'no dynamic import()');
  assert.ok(!/readFileSync|readFile\(|openSync|fstatSync/u.test(source), 'no file reads');
});

test('S4 (stage[campaign_compile_missing]): the gate predicate vocabulary is closed — the four forms compile, everything else refuses', async () => {
  const { compileCampaign } = await campaignDsl();
  const mk = (whenLine) => [
    'campaign s4',
    'phase a',
    '  scope docs/**',
    '  member m',
    '    harness mock',
    '    model mock-model',
    '    effort low',
    '    objectiveRef objectives/a.md',
    '  harvest docs/r.md',
    '  outcome a_ok from docs/r.md',
    'phase b fold',
    `  ${whenLine}`,
  ].join('\n');
  for (const whenLine of ['when a_ok', 'when not a_ok', 'when a_ok == "WAVE-OK"', 'when a_ok != "WAVE-OK"']) {
    assert.doesNotThrow(() => compileCampaign(mk(whenLine), { repoRoot: REPO_ROOT }), `the closed form compiles: ${whenLine}`);
  }
  for (const whenLine of ['when a_ok && a_ok', 'when a_ok || a_ok', 'when a_ok + 1', 'when not a_ok == "x"', 'when a_ok == ']) {
    assertRefusal(
      () => compileCampaign(mk(whenLine), { repoRoot: REPO_ROOT }),
      { code: 'workflow_gate_invalid', line: 12, field: 'when', expected: 'when <outcome> [not] | when <outcome> ==|!= "<literal>"' },
      `S4:${whenLine}`);
  }
});

test('R1 (stage[campaign_compile_missing]): a phase before campaign refuses workflow_campaign_invalid', async () => {
  const { compileCampaign } = await campaignDsl();
  assertRefusal(
    () => compileCampaign('phase ground\n', { repoRoot: REPO_ROOT }),
    { code: 'workflow_campaign_invalid', line: 1, field: 'phase', expected: 'campaign <key>' },
    'R1');
});

test('R2 (stage[campaign_compile_missing]): a fold phase with no when refuses workflow_campaign_invalid', async () => {
  const { compileCampaign } = await campaignDsl();
  const text = [
    'campaign r2',
    'phase spec fold',
    '  scope docs/**',
    '  member m',
    '    harness mock',
    '    model mock-model',
    '    effort low',
    '    objectiveRef objectives/a.md',
  ].join('\n');
  assertRefusal(
    () => compileCampaign(text, { repoRoot: REPO_ROOT }),
    { code: 'workflow_campaign_invalid', line: 2, field: 'phase spec', expected: 'when <outcome> …' },
    'R2');
});

test('R3 (stage[campaign_compile_missing]): a when referencing an undeclared outcome refuses workflow_gate_invalid', async () => {
  const { compileCampaign } = await campaignDsl();
  const text = [
    'campaign r3',
    'phase a',
    '  scope docs/**',
    '  member m',
    '    harness mock',
    '    model mock-model',
    '    effort low',
    '    objectiveRef objectives/a.md',
    'phase b fold',
    '  when undeclared_ok',
].join('\n');
  assertRefusal(
    () => compileCampaign(text, { repoRoot: REPO_ROOT }),
    { code: 'workflow_gate_invalid', line: 10, field: 'when', expected: 'declared prior outcome' },
    'R3');
});

test('R4 (stage[campaign_compile_missing]): a when referencing a same-phase outcome refuses workflow_gate_invalid', async () => {
  const { compileCampaign } = await campaignDsl();
  const text = [
    'campaign r4',
    'phase a fold',
    '  when a_ok',
    '  scope docs/**',
    '  member m',
    '    harness mock',
    '    model mock-model',
    '    effort low',
    '    objectiveRef objectives/a.md',
    '  harvest docs/r.md',
    '  outcome a_ok from docs/r.md',
].join('\n');
  assertRefusal(
    () => compileCampaign(text, { repoRoot: REPO_ROOT }),
    { code: 'workflow_gate_invalid', line: 3, field: 'when', expected: 'declared prior outcome' },
    'R4');
});

test('R5 (stage[campaign_compile_missing]): a disallowed predicate operator refuses workflow_gate_invalid', async () => {
  const { compileCampaign } = await campaignDsl();
  const text = [
    'campaign r5',
    'phase a',
    '  scope docs/**',
    '  member m',
    '    harness mock',
    '    model mock-model',
    '    effort low',
    '    objectiveRef objectives/a.md',
    '  harvest docs/r.md',
    '  outcome a_ok from docs/r.md',
    'phase b fold',
    '  when a_ok && other',
].join('\n');
  assertRefusal(
    () => compileCampaign(text, { repoRoot: REPO_ROOT }),
    { code: 'workflow_gate_invalid', line: 12, field: 'when', expected: 'when <outcome> [not] | when <outcome> ==|!= "<literal>"' },
    'R5');
});

test('R6 (stage[campaign_compile_missing]): an outcome from a non-harvested path refuses workflow_outcome_invalid', async () => {
  const { compileCampaign } = await campaignDsl();
  const text = [
    'campaign r6',
    'phase a',
    '  scope docs/**',
    '  member m',
    '    harness mock',
    '    model mock-model',
    '    effort low',
    '    objectiveRef objectives/a.md',
    '  outcome a_ok from docs/never-harvested.md',
].join('\n');
  assertRefusal(
    () => compileCampaign(text, { repoRoot: REPO_ROOT }),
    { code: 'workflow_outcome_invalid', line: 9, field: 'outcome a_ok', expected: 'declared harvest path' },
    'R6');
});

test('R7 (stage[campaign_compile_missing]): a duplicate outcome name refuses workflow_outcome_invalid', async () => {
  const { compileCampaign } = await campaignDsl();
  const text = [
    'campaign r7',
    'phase a',
    '  scope docs/**',
    '  member m',
    '    harness mock',
    '    model mock-model',
    '    effort low',
    '    objectiveRef objectives/a.md',
    '  harvest docs/r.md',
    '  outcome a_ok from docs/r.md',
    '  outcome a_ok from docs/r.md',
].join('\n');
  assertRefusal(
    () => compileCampaign(text, { repoRoot: REPO_ROOT }),
    { code: 'workflow_outcome_invalid', line: 11, field: 'outcome a_ok', expected: 'unique outcome name' },
    'R7');
});

test('R8 (stage[campaign_compile_missing]): an unknown coupling kind refuses workflow_campaign_invalid', async () => {
  const { compileCampaign } = await campaignDsl();
  const text = [
    'campaign r8',
    'phase a',
    '  coupling wobbly',
    '  scope docs/**',
    '  member m',
    '    harness mock',
    '    model mock-model',
    '    effort low',
    '    objectiveRef objectives/a.md',
].join('\n');
  assertRefusal(
    () => compileCampaign(text, { repoRoot: REPO_ROOT }),
    { code: 'workflow_campaign_invalid', line: 3, field: 'coupling', expected: 'loose|shared|tight' },
    'R8');
});

test('R9 (stage[campaign_compile_missing]): a checkpoint phase with one option refuses workflow_checkpoint_invalid', async () => {
  const { compileCampaign } = await campaignDsl();
  const text = [
    'campaign r9',
    'phase gate checkpoint',
    '  question "Admit?"',
    '  option admit "Admit"',
].join('\n');
  assertRefusal(
    () => compileCampaign(text, { repoRoot: REPO_ROOT }),
    { code: 'workflow_checkpoint_invalid', line: 2, field: 'checkpoint', expected: 'option "<id>" "<label>"' },
    'R9');
});

// ---------------------------------------------------------------------------
// Pure-logic rows (RED at campaign_runner_missing).
// ---------------------------------------------------------------------------

test('P3 (stage[campaign_runner_missing]): outcome extraction yields the first matching line, never prose', async () => {
  const { extractOutcome } = await campaignInterpreter();
  const harvest = [{ path: 'docs/r.md', ok: true, bytes: 'line one\nGROUND-OK line\nline three\n' }];
  assert.equal(extractOutcome({ from: 'docs/r.md', line: 'GROUND-OK' }, harvest), 'GROUND-OK line', 'the whole matching line');
  assert.equal(extractOutcome({ from: 'docs/r.md', line: 'NOPE' }, harvest), null, 'no match → absent');
  assert.equal(extractOutcome({ from: 'docs/r.md', line: null }, harvest), 'line one\nGROUND-OK line\nline three\n', 'no pattern → whole content');
  assert.equal(extractOutcome({ from: 'docs/missing.md', line: null }, harvest), null, 'missing harvest → absent');
});

test('P4 (stage[campaign_runner_missing]): the closed gate truth-table', async () => {
  const { evaluateWhen } = await campaignInterpreter();
  const outcomes = new Map([['ok', 'WAVE-OK'], ['empty', '']]);
  assert.equal(evaluateWhen([{ outcome: 'ok', op: 'truthy', literal: null }], outcomes), true);
  assert.equal(evaluateWhen([{ outcome: 'missing', op: 'truthy', literal: null }], outcomes), false);
  assert.equal(evaluateWhen([{ outcome: 'missing', op: 'falsy', literal: null }], outcomes), true);
  assert.equal(evaluateWhen([{ outcome: 'empty', op: 'falsy', literal: null }], outcomes), true);
  assert.equal(evaluateWhen([{ outcome: 'ok', op: 'eq', literal: 'WAVE-OK' }], outcomes), true);
  assert.equal(evaluateWhen([{ outcome: 'ok', op: 'ne', literal: 'WAVE-OK' }], outcomes), false);
  assert.equal(evaluateWhen([{ outcome: 'missing', op: 'ne', literal: 'X' }], outcomes), true);
  assert.equal(evaluateWhen([{ outcome: 'ok', op: 'truthy', literal: null }, { outcome: 'missing', op: 'falsy', literal: null }], outcomes), true, 'ANDed predicates');
  assert.equal(evaluateWhen([{ outcome: 'ok', op: 'truthy', literal: null }, { outcome: 'missing', op: 'truthy', literal: null }], outcomes), false, 'ANDed predicates fail on any false');
});

// ---------------------------------------------------------------------------
// Runner rows (RED at campaign_runner_missing) — the hermetic MockAdapter campaign.
// ---------------------------------------------------------------------------

test('P2 (stage[campaign_runner_missing]): two-phase end-to-end — phase B starts only after phase A settles and its outcome satisfies the when', async (t) => {
  const { compileCampaign } = await campaignDsl();
  const { runCampaign } = await campaignInterpreter();
  const fx = await campaignFixture(t, {
    scenariosByMarker: {
      grounder: { outcome: 'completed', edits: [{ path: 'docs/reports/ground.md', content: 'GROUND-OK\n' }] },
      specwriter: { outcome: 'completed', edits: [{ path: 'docs/reports/spec.md', content: 'SPEC-OK\n' }] },
    },
  });
  writeObjective(fx.repo, 'grounder', 'Produce docs/reports/ground.md with the ground findings.');
  writeObjective(fx.repo, 'specwriter', 'Produce docs/reports/spec.md with the spec.');

  const receipt = await runCampaign(fx.baton, compileCampaign(TWO_PHASE('GROUND-OK'), { repoRoot: fx.repo }), { repoRoot: fx.repo, driver: LANE_DRIVER });
  assert.equal(receipt.verdict, 'CAMPAIGN-OK', 'both phases settled');
  assert.equal(receipt.phases[0].verdict, 'run', 'phase ground ran');
  assert.equal(receipt.phases[0].outcomes.ground_ok, 'GROUND-OK', 'the outcome is the extracted line');
  assert.equal(receipt.phases[1].verdict, 'run', 'phase spec ran only because the gate held');
  assert.ok(receipt.phases[1].waveReceipt, 'phase spec started its member');
});

test('P2-fold (stage[campaign_runner_missing]): a false gate folds phase B — no member starts', async (t) => {
  const { compileCampaign } = await campaignDsl();
  const { runCampaign } = await campaignInterpreter();
  const fx = await campaignFixture(t, {
    scenariosByMarker: {
      grounder: { outcome: 'completed', edits: [{ path: 'docs/reports/ground.md', content: 'GROUND-OK\n' }] },
      specwriter: { outcome: 'completed', edits: [{ path: 'docs/reports/spec.md', content: 'SPEC-OK\n' }] },
    },
  });
  writeObjective(fx.repo, 'grounder', 'Produce docs/reports/ground.md with the ground findings.');
  writeObjective(fx.repo, 'specwriter', 'Produce docs/reports/spec.md with the spec.');

  const receipt = await runCampaign(fx.baton, compileCampaign(TWO_PHASE('NOPE'), { repoRoot: fx.repo }), { repoRoot: fx.repo, driver: LANE_DRIVER });
  assert.equal(receipt.phases[0].outcomes.ground_ok, null, 'the outcome is absent (no matching line)');
  assert.equal(receipt.phases[1].verdict, 'folded', 'phase spec folded (no member started)');
  assert.equal(receipt.phases[1].waveReceipt, undefined, 'a folded phase starts no member');
  assert.equal(fx.adapter.calls.spawn.filter((call) => call.marker === 'specwriter').length, 0, 'the spec member was never spawned');
});

test('P5 (stage[campaign_runner_missing]): a checkpoint phase parks and delivers the packet — no member, resumable', async (t) => {
  const { compileCampaign } = await campaignDsl();
  const { runCampaign } = await campaignInterpreter();
  const fx = await campaignFixture(t, {
    scenariosByMarker: {
      grounder: { outcome: 'completed', edits: [{ path: 'docs/reports/ground.md', content: 'GROUND-OK\n' }] },
    },
  });
  writeObjective(fx.repo, 'grounder', 'Produce docs/reports/ground.md with the ground findings.');

  const campaign = compileCampaign(CHECKPOINT_CAMPAIGN, { repoRoot: fx.repo });
  const receipt = await runCampaign(fx.baton, campaign, { repoRoot: fx.repo, driver: LANE_DRIVER });
  assert.equal(receipt.verdict, 'CAMPAIGN-PARKED', 'the campaign parks at the checkpoint');
  assert.equal(receipt.phases[1].verdict, 'parked', 'the checkpoint phase parked');
  assert.deepEqual(receipt.phases[1].checkpoint, {
    question: 'Admit the campaign result?',
    options: [{ id: 'admit', label: 'Admit' }, { id: 'fix', label: 'Re-open an earlier phase' }],
  }, 'the decision packet is delivered upward');

  // Resume with a declared option: settled phases replay, the checkpoint records the decision.
  const resumed = await runCampaign(fx.baton, campaign, { repoRoot: fx.repo, driver: LANE_DRIVER, state: receipt.state, resume: { phase: 'return', optionId: 'admit' } });
  assert.equal(resumed.verdict, 'CAMPAIGN-OK', 'the resumed campaign completes');
  assert.equal(resumed.phases[0].verdict, 'run', 'the settled ground phase replays (no re-drive)');
  assert.equal(resumed.phases[0].replayed, true, 'ground is replayed, not re-driven');
  assert.equal(resumed.phases[1].verdict, 'resumed', 'the checkpoint records the decision');
  assert.deepEqual(resumed.phases[1].decision, { optionId: 'admit' }, 'the decision is recorded');
});

test('P5-resume-guard (stage[campaign_runner_missing]): a resume with an undeclared optionId refuses workflow_checkpoint_invalid', async (t) => {
  const { compileCampaign } = await campaignDsl();
  const { runCampaign } = await campaignInterpreter();
  const fx = await campaignFixture(t, {
    scenariosByMarker: {
      grounder: { outcome: 'completed', edits: [{ path: 'docs/reports/ground.md', content: 'GROUND-OK\n' }] },
    },
  });
  writeObjective(fx.repo, 'grounder', 'Produce docs/reports/ground.md with the ground findings.');

  const campaign = compileCampaign(CHECKPOINT_CAMPAIGN, { repoRoot: fx.repo });
  const receipt = await runCampaign(fx.baton, campaign, { repoRoot: fx.repo, driver: LANE_DRIVER });
  const attempt = await captureError(() => runCampaign(fx.baton, campaign, { repoRoot: fx.repo, driver: LANE_DRIVER, state: receipt.state, resume: { phase: 'return', optionId: 'nope' } }));
  assert.equal(attempt.error?.code, 'workflow_checkpoint_invalid', 'undeclared optionId refuses typed');
  assert.equal(attempt.error?.field, 'resume.optionId', 'the refusal names the field');
});

test('P6 (stage[campaign_runner_missing]): a shared/tight coupling compiles but its run refuses workflow_coupling_unavailable', async (t) => {
  const { compileCampaign } = await campaignDsl();
  const { runCampaign } = await campaignInterpreter();
  const fx = await campaignFixture(t, { scenariosByMarker: { grounder: { outcome: 'completed' } } });
  writeObjective(fx.repo, 'grounder', 'Produce the ground findings.');

  const sharedText = [
    'campaign p6-shared',
    'phase ground',
    '  coupling shared',
    '  scope docs/reports/**',
    '  member grounder',
    '    harness mock',
    '    model mock-model',
    '    effort low',
    '    objectiveRef objectives/grounder.md',
].join('\n');
  const campaign = compileCampaign(sharedText, { repoRoot: fx.repo });
  assert.deepEqual(campaign.phases[0].couplings, { '*': 'shared' }, 'the coupling compiles');
  const attempt = await captureError(() => runCampaign(fx.baton, campaign, { repoRoot: fx.repo, driver: LANE_DRIVER }));
  assert.equal(attempt.error?.code, 'workflow_coupling_unavailable', 'the shared coupling run refuses');
  assert.equal(attempt.error?.field, 'coupling', 'the refusal names the field');
  assert.match(attempt.error?.expected ?? '', /#158/, 'the refusal names the precondition');
});

test('P7 (stage[campaign_runner_missing]): mid-flight amendment — a settled phase is immutable; a pending phase re-runs', async (t) => {
  const { compileCampaign } = await campaignDsl();
  const { runCampaign } = await campaignInterpreter();
  const fx = await campaignFixture(t, {
    scenariosByMarker: {
      grounder: { outcome: 'completed', edits: [{ path: 'docs/reports/ground.md', content: 'GROUND-OK\n' }] },
      specwriter: { outcome: 'completed', edits: [{ path: 'docs/reports/spec.md', content: 'SPEC-OK\n' }] },
    },
  });
  writeObjective(fx.repo, 'grounder', 'Produce docs/reports/ground.md with the ground findings.');
  writeObjective(fx.repo, 'specwriter', 'Produce docs/reports/spec.md with the spec.');

  // Park at a checkpoint so `spec` stays PENDING.
  const parkedText = [
    'campaign p7',
    'phase ground',
    '  scope docs/reports/**',
    '  member grounder',
    '    harness mock',
    '    model mock-model',
    '    effort low',
    '    objectiveRef objectives/grounder.md',
    '    report docs/reports/ground.md',
    '  harvest docs/reports/ground.md',
    '  outcome ground_ok from docs/reports/ground.md line "GROUND-OK"',
    'phase gate checkpoint',
    '  question "Proceed?"',
    '  option go "Go"',
    '  option stop "Stop"',
    'phase spec fold',
    '  when ground_ok',
    '  scope docs/reports/**',
    '  member specwriter',
    '    harness mock',
    '    model mock-model',
    '    effort low',
    '    objectiveRef objectives/specwriter.md',
    '    report docs/reports/spec.md',
    '  harvest docs/reports/spec.md',
].join('\n');

  const receipt = await runCampaign(fx.baton, compileCampaign(parkedText, { repoRoot: fx.repo }), { repoRoot: fx.repo, driver: LANE_DRIVER });
  assert.equal(receipt.verdict, 'CAMPAIGN-PARKED', 'parks at the checkpoint (spec is pending)');
  assert.equal(receipt.phases[2].verdict, 'pending', 'spec is pending, not driven');

  // (a) Editing a SETTLED phase (ground) refuses.
  const editedGroundText = parkedText.replace('objectiveRef objectives/grounder.md', 'objectiveRef objectives/ground-alt.md');
  const editedGround = compileCampaign(editedGroundText, { repoRoot: fx.repo });
  const attempt = await captureError(() => runCampaign(fx.baton, editedGround, { repoRoot: fx.repo, driver: LANE_DRIVER, state: receipt.state, resume: { phase: 'gate', optionId: 'go' } }));
  assert.equal(attempt.error?.code, 'workflow_campaign_amendment_refused', 'an edited settled phase refuses');
  assert.equal(attempt.error?.field, 'phase ground', 'the refusal names the phase');

  // (b) Resuming with an AMENDED pending phase runs the amended spec (settled phases replay).
  const amendedPendingText = parkedText.replace('when ground_ok', 'when not ground_ok');
  const amendedPending = compileCampaign(amendedPendingText, { repoRoot: fx.repo });
  const resumed = await runCampaign(fx.baton, amendedPending, { repoRoot: fx.repo, driver: LANE_DRIVER, state: receipt.state, resume: { phase: 'gate', optionId: 'go' } });
  assert.equal(resumed.phases[0].verdict, 'run', 'ground replays');
  assert.equal(resumed.phases[0].replayed, true, 'ground is replayed');
  assert.equal(resumed.phases[1].verdict, 'resumed', 'the checkpoint resumes');
  assert.equal(resumed.phases[2].verdict, 'folded', 'the amended pending spec folds under its new gate');
});

test('S5 (stage[campaign_runner_missing]): a checkpoint is never auto-answered', async () => {
  await campaignInterpreter();
  const source = sourceOf(CAMPAIGN_INTERPRETER_PATH);
  assert.ok(!/answerDecisions|claimOnStall|nudgeOnCheckpoint/u.test(source), 'no auto-answer steering is reachable from the campaign runner');
});
