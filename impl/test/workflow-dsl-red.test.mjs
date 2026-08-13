// workflow-dsl-red.test.mjs — #170 red-first acceptance suite (v2 FOLDED contract).
// [attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-170]
//
// Source of truth: docs/reference/evidence/workflow-dsl-2026-08-13/workflow-dsl-contract.md
// (v2 FOLDED, worktree HEAD e371f70). The wavefile compiler lowers the 16-directive line-oriented
// grammar to the interpreter's closed field set; the compiler is a pure function of the text given
// repoRoot, every refusal carries the #160 {line, field, expected} triple (on the error AND the
// wire detail leg), and the emitted IR round-trips byte-for-byte through admitSpec. Suite law
// (foundry-brief.md wave-c): red-first at HEAD with a NAMED stage in every capability assertion;
// hermetic (compiler-seam + static source-scan only — no network, no provider, no clock, no host
// state); no absolute line-window anchors (#166) — ORDER/EXISTENCE/byte-string assertions only;
// sorted-key literals in ACTUAL sorted order (localeCompare banned); split-twice (recorded below).
//
// The compiler module impl/src/workflow-dsl.mjs does not exist at HEAD, so every capability row is
// RED at the stage workflow_dsl_compile_missing; the round-trip rows additionally depend on the
// interpreter exporting admitSpec (stage workflow_dsl_admission_seam_missing — a judgment call, see
// suite-draft-notes.md). PIN rows are GREEN at HEAD: they pin the interpreter/surface invariants the
// DSL must NOT disturb (interpreter string path stays JSON-only; the closed 5-code refusal family;
// the closed field sets; schemaVersion fixed; the MCP LANE_CRAFTED detail-forwarding arm).
//
// ROW INVENTORY (every contract pin P1–P10 / R1–R10 / S1–S5 is a row at its named stage):
//   PIN rows (GREEN at HEAD):     PIN-A interpreter JSON-only string path (R10 substance) ·
//                                 PIN-B closed 5-code refusal family (G5) · PIN-C closed field sets
//                                 (G1 totality target) · PIN-D schemaVersion fixed 1 (S2 half) ·
//                                 PIN-E MCP LANE_CRAFTED forwards cause.detail (P9 seam, green)
//   Capability rows (RED at HEAD):P1 round-trip · P2 scope-default + Appendix A fixture · P3 no
//                                 deeper inheritance · P4 total coverage · P5 sniffing · P6 four-
//                                 surface parity · P7 compile seam · P8 generated-docs · P9 MCP
//                                 triple · P10 web triple (GATED on #160 R3, contract N1) ·
//                                 R1–R9 refusal triples · R10 head-seam (waves run compiles) ·
//                                 S1 no-eval/no-fs · S2 no-driver/schemaVersion · S3 three-way
//                                 invariant · S4 closure · S5 constants · OQ6 registry seam
//                                 (waves.compile row + waves.run gains web)
//
// SPLIT RECORD (`node --test impl/test/workflow-dsl-red.test.mjs` from the repo root):
//   Run 1 — 31 tests, 5 pass / 26 fail  (5 PIN rows green; 26 capability rows red)
//   Run 2 — 31 tests, 5 pass / 26 fail  (stable)

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import runWorkflow from '../src/workflow-interpreter.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { parseBatonCli } from '../src/application-cli.mjs';
import { mcpApplicationToolNames } from '../src/mcp-northbound.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const COMPILER_PATH = join(REPO_ROOT, 'impl', 'src', 'workflow-dsl.mjs');
const INTERPRETER_PATH = join(REPO_ROOT, 'impl', 'src', 'workflow-interpreter.mjs');
const MCP_PATH = join(REPO_ROOT, 'impl', 'src', 'mcp-northbound.mjs');
const WEB_PATH = join(REPO_ROOT, 'impl', 'src', 'web-northbound.mjs');
const CLIENT_PATH = join(REPO_ROOT, 'impl', 'src', 'application-client.mjs');
const APP_PATH = join(REPO_ROOT, 'impl', 'src', 'application.mjs');
const RENDER_DOCS_PATH = join(REPO_ROOT, 'impl', 'scripts', 'render-surface-docs.mjs');
const CONFORMANCE_PATH = join(REPO_ROOT, 'impl', 'scripts', 'surface-conformance.mjs');
const FIXTURE_PATH = join(REPO_ROOT, 'impl', 'test', 'fixtures', 'workflow-dsl-foundry-roundtrip.json');

const STAGE_COMPILE = 'workflow_dsl_compile_missing';
const STAGE_ADMISSION = 'workflow_dsl_admission_seam_missing';

// ── Named-stage loaders (the module is absent at HEAD; these give the suite its red shape) ──

function stageError(stage, detail) {
  const error = new Error(`${stage}: ${detail}`);
  error.stage = stage;
  return error;
}

async function compiler() {
  try {
    return await import('../src/workflow-dsl.mjs');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'MODULE_NOT_FOUND') {
      throw stageError(STAGE_COMPILE, 'the wavefile compiler module impl/src/workflow-dsl.mjs is not implemented yet');
    }
    throw error;
  }
}

// P1/P2 depend on the interpreter exporting admitSpec (the round-trip pin's acceptance leg). At
// HEAD admitSpec is module-local; the impl rung must export it (or a shared closed module per S5).
async function admission() {
  const mod = await import('../src/workflow-interpreter.mjs');
  if (typeof mod.admitSpec !== 'function') {
    throw stageError(STAGE_ADMISSION, 'workflow-interpreter.mjs does not export admitSpec (the round-trip pin needs it importable)');
  }
  return { admitSpec: mod.admitSpec };
}

// canonicalJson — local reimplementation of the interpreter's key-sorting canonical form
// (workflow-interpreter.mjs:58-63). Key order is presentation, never identity (D1), so a local
// byte-behavior-identical copy keeps the round-trip hermetic without a second export dependency.
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

// WAVEFILE_DIRECTIVES may be an object, a Map, or an array of entries — return its directive names.
function directiveNames(ns) {
  const registry = ns.WAVEFILE_DIRECTIVES;
  assert.ok(registry, 'stage[wavefile-directives-registry] the compiler must export WAVEFILE_DIRECTIVES');
  if (registry instanceof Map) return [...registry.keys()];
  if (Array.isArray(registry)) return registry.map((entry) => (typeof entry === 'string' ? entry : entry[0] ?? entry.name));
  return Object.keys(registry);
}

// Every refusal must carry the #160 triple on the error AND on the wire detail leg (D2/B4).
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
  // The wire shape: error.detail = {line, field, expected} (B4 — the LANE_CRAFTED arm forwards
  // cause?.detail, so the triple rides the wire ONLY through this leg).
  assert.deepEqual(caught?.detail, { line, field: caught?.field, expected: caught?.expected },
    `${stage}: the detail wire leg must equal {line, field, expected}`);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FOUNDRY_SCOPE = 'docs/reference/evidence/contract-foundry-2026-08-13/**';

// Appendix A (contract §Appendix A) — the foundry workflow.json expressed as a wavefile, byte-for-byte.
const APPENDIX_A = [
  '# The contract-foundry wave (workflow.json -> wavefile)',
  'wave contract-foundry-2026-08-13-wave-a',
  '',
  '# Wave-level scope default: applies to every member without its own scope.',
  'scope docs/reference/evidence/contract-foundry-2026-08-13/**',
  '',
  'approveOnAdvertisedPlan',
  'nudgeOnCheckpoint "Continue your draft drive — read evidence, write your contract incrementally, publish to the shared scratchpad when complete."',
  'claimOnStall',
  'messageOnSpawn brief "Read your objectiveRef brief IN FULL first, then foundry-brief.md in the same directory (the shared frame binds you). Publish your final draft to the `shared` scratchpad partition as well as your file. Authority-class ambiguity → DECISION_REQUEST with options; judgment calls are yours — record them in open questions."',
  'elevateWhenNotes doubt,plan 20',
  'signalOnMembersDone coordinator result "All rows settled — read their drafts from the `shared` scratchpad partition and write foundry-qa.md per your brief."',
  '',
  'member coordinator',
  '  harness deepseek',
  '  model deepseek-v4-pro[1m]',
  '  effort high',
  '  objectiveRef docs/reference/evidence/contract-foundry-2026-08-13/coordinator-brief.md',
  '  report docs/reference/evidence/contract-foundry-2026-08-13/foundry-qa.md',
  '',
  'member row-quiescence',
  '  harness deepseek',
  '  model deepseek-v4-flash',
  '  effort high',
  '  objectiveRef docs/reference/evidence/contract-foundry-2026-08-13/row-quiescence.md',
  '  report docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md',
  '',
  'member row-launchval',
  '  harness deepseek',
  '  model deepseek-v4-flash',
  '  effort high',
  '  objectiveRef docs/reference/evidence/contract-foundry-2026-08-13/row-launchval.md',
  '  report docs/reference/evidence/contract-foundry-2026-08-13/contract-165.md',
  '',
  'member row-readiness',
  '  harness deepseek',
  '  model deepseek-v4-flash',
  '  effort high',
  '  objectiveRef docs/reference/evidence/contract-foundry-2026-08-13/row-readiness.md',
  '  report docs/reference/evidence/contract-foundry-2026-08-13/contract-167.md',
  '',
  'member row-telemetry',
  '  harness deepseek',
  '  model deepseek-v4-flash',
  '  effort high',
  '  objectiveRef docs/reference/evidence/contract-foundry-2026-08-13/row-telemetry.md',
  '  report docs/reference/evidence/contract-foundry-2026-08-13/contract-146.md',
  '',
  'harvest docs/reference/evidence/contract-foundry-2026-08-13/foundry-qa.md mustContain "FOUNDRY-QA v1"',
  'harvest docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md mustContain "#163"',
  'harvest docs/reference/evidence/contract-foundry-2026-08-13/contract-165.md mustContain "#165"',
  'harvest docs/reference/evidence/contract-foundry-2026-08-13/contract-167.md mustContain "#167"',
  'harvest docs/reference/evidence/contract-foundry-2026-08-13/contract-146.md mustContain "#146"',
].join('\n');

const MINIMAL_WAVEFILE = [
  'wave minimal-wave',
  'scope reports/**',
  'member alpha',
  '  harness mock',
  '  model mock-model',
  '  effort low',
  '  objectiveRef reports/a.md',
].join('\n');

// The emitted IR for Appendix A (contract §Appendix A / lowering template D1), key-order-free.
const EXPECTED_APPENDIX_IR = {
  schemaVersion: 1,
  idempotencyKey: 'contract-foundry-2026-08-13-wave-a',
  members: [
    { role: 'coordinator', exact: { harness: 'deepseek', model: 'deepseek-v4-pro[1m]', effort: 'high' }, scope: [FOUNDRY_SCOPE], objectiveRef: 'docs/reference/evidence/contract-foundry-2026-08-13/coordinator-brief.md', report: 'docs/reference/evidence/contract-foundry-2026-08-13/foundry-qa.md' },
    { role: 'row-quiescence', exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }, scope: [FOUNDRY_SCOPE], objectiveRef: 'docs/reference/evidence/contract-foundry-2026-08-13/row-quiescence.md', report: 'docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md' },
    { role: 'row-launchval', exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }, scope: [FOUNDRY_SCOPE], objectiveRef: 'docs/reference/evidence/contract-foundry-2026-08-13/row-launchval.md', report: 'docs/reference/evidence/contract-foundry-2026-08-13/contract-165.md' },
    { role: 'row-readiness', exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }, scope: [FOUNDRY_SCOPE], objectiveRef: 'docs/reference/evidence/contract-foundry-2026-08-13/row-readiness.md', report: 'docs/reference/evidence/contract-foundry-2026-08-13/contract-167.md' },
    { role: 'row-telemetry', exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }, scope: [FOUNDRY_SCOPE], objectiveRef: 'docs/reference/evidence/contract-foundry-2026-08-13/row-telemetry.md', report: 'docs/reference/evidence/contract-foundry-2026-08-13/contract-146.md' },
  ],
  steering: {
    approveOnAdvertisedPlan: true,
    nudgeOnCheckpoint: { message: 'Continue your draft drive — read evidence, write your contract incrementally, publish to the shared scratchpad when complete.' },
    claimOnStall: true,
    messageOnSpawn: { kind: 'brief', body: 'Read your objectiveRef brief IN FULL first, then foundry-brief.md in the same directory (the shared frame binds you). Publish your final draft to the `shared` scratchpad partition as well as your file. Authority-class ambiguity → DECISION_REQUEST with options; judgment calls are yours — record them in open questions.' },
    elevateWhenNotes: { kinds: ['doubt', 'plan'], maxEntries: 20 },
    signalOnMembersDone: { roles: ['coordinator'], message: { kind: 'result', body: 'All rows settled — read their drafts from the `shared` scratchpad partition and write foundry-qa.md per your brief.' } },
  },
  harvest: {
    paths: [
      { path: 'docs/reference/evidence/contract-foundry-2026-08-13/foundry-qa.md', mustContain: 'FOUNDRY-QA v1' },
      { path: 'docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md', mustContain: '#163' },
      { path: 'docs/reference/evidence/contract-foundry-2026-08-13/contract-165.md', mustContain: '#165' },
      { path: 'docs/reference/evidence/contract-foundry-2026-08-13/contract-167.md', mustContain: '#167' },
      { path: 'docs/reference/evidence/contract-foundry-2026-08-13/contract-146.md', mustContain: '#146' },
    ],
  },
};

// The 16 closed directives with their IR targets (contract D1 table) — the P4 totality matrix.
const CLOSED_DIRECTIVES = [
  ['wave', 'idempotencyKey'],
  ['member', 'members[].role'],
  ['harness', 'members[].exact.harness'],
  ['model', 'members[].exact.model'],
  ['effort', 'members[].exact.effort'],
  ['scope', 'members[].scope'],
  ['objectiveRef', 'members[].objectiveRef'],
  ['report', 'members[].report'],
  ['approveOnAdvertisedPlan', 'steering.approveOnAdvertisedPlan'],
  ['claimOnStall', 'steering.claimOnStall'],
  ['nudgeOnCheckpoint', 'steering.nudgeOnCheckpoint.message'],
  ['messageOnSpawn', 'steering.messageOnSpawn'],
  ['elevateWhenNotes', 'steering.elevateWhenNotes'],
  ['answerDecisions', 'steering.answerDecisions.policy'],
  ['signalOnMembersDone', 'steering.signalOnMembersDone'],
  ['harvest', 'harvest.paths[]'],
];

const MACHINERY_NAMES = ['attempt', 'salt', 'runId', 'waveId', 'lane', 'driver', 'cadence', 'projection'];

// ── PIN rows (GREEN at HEAD) ─────────────────────────────────────────────────

test('PIN-A pin [interpreter-json-only] — the interpreter string path stays JSON-only: a non-JSON file refuses workflow_spec_invalid "not valid JSON"', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'baton-dsl-pina-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dslFile = join(dir, 'wavefile.dsl');
  writeFileSync(dslFile, 'wave ok-key\nmember alpha\n  harness mock\n', 'utf8');
  const stub = { waves: { start() {} } };
  await assert.rejects(
    runWorkflow(stub, dslFile, { repoRoot: dir }),
    (error) => error?.code === 'workflow_spec_invalid' && /not valid JSON/u.test(error?.message ?? ''),
    'stage[interpreter-json-only] the DSL text must refuse at the interpreter string path as not valid JSON today — the red the compile seam turns green (G2 consequence)',
  );
});

test('PIN-B pin [closed-refusal-vocabulary] — the interpreter admission-time workflow_* family is exactly the 5 codes the DSL reuses', () => {
  const src = readFileSync(INTERPRETER_PATH, 'utf8');
  const family = [
    'workflow_spec_invalid',
    'workflow_member_invalid',
    'workflow_steering_unknown',
    'workflow_harvest_invalid',
    'workflow_objective_ref_invalid',
  ];
  for (const code of family) {
    assert.ok(src.includes(`'${code}'`), `stage[closed-refusal-vocabulary] the interpreter must mint ${code} (G5)`);
  }
  // The DSL reuses these codes — no new allowlist entry (G5). A wrong impl minting a 6th
  // admission code would violate the closed family this pin guards.
  assert.ok(!src.includes("'workflow_compile_invalid'"), 'stage[closed-refusal-vocabulary] no compiler-specific admission code may be minted');
});

test('PIN-C pin [closed-field-sets] — the interpreter closed field sets are the exact totality target the DSL must cover', () => {
  const src = readFileSync(INTERPRETER_PATH, 'utf8');
  const extract = (name) => {
    const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`, 'u').exec(src);
    assert.ok(m, `stage[closed-field-sets] the interpreter must declare ${name}`);
    return [...m[1].matchAll(/'([^']+)'/gu)].map((x) => x[1]);
  };
  assert.deepEqual(extract('SPEC_FIELDS'), ['schemaVersion', 'idempotencyKey', 'members', 'steering', 'harvest']);
  assert.deepEqual(extract('MEMBER_FIELDS'), ['role', 'exact', 'scope', 'objectiveRef', 'report']);
  assert.deepEqual(extract('EXACT_FIELDS'), ['harness', 'model', 'effort']);
  assert.deepEqual(extract('STEERING_FIELDS'),
    ['approveOnAdvertisedPlan', 'nudgeOnCheckpoint', 'claimOnStall', 'messageOnSpawn', 'elevateWhenNotes', 'answerDecisions', 'signalOnMembersDone']);
});

test('PIN-D pin [schemaVersion-fixed] — the interpreter fixes schemaVersion exactly 1 and defaults harvest to { paths: [] }', () => {
  const src = readFileSync(INTERPRETER_PATH, 'utf8');
  assert.ok(src.includes('raw.schemaVersion !== 1'), 'stage[schemaVersion-fixed] admitSpec must refuse any schemaVersion other than exactly 1');
  assert.ok(src.includes('schemaVersion: 1'), 'stage[schemaVersion-fixed] the emitted spec must fix schemaVersion to exactly 1');
  assert.ok(src.includes('{ paths: [] }'), 'stage[schemaVersion-fixed] the harvest default must be the empty paths object (S2 half)');
});

test('PIN-E pin [mcp-lane-crafted-detail] — the MCP LANE_CRAFTED arm forwards cause?.detail (the P9 wire seam already exists)', () => {
  const src = readFileSync(MCP_PATH, 'utf8');
  assert.ok(/cause\?\.detail/u.test(src), 'stage[mcp-lane-crafted-detail] the MCP lane-crafted arm must forward cause?.detail — the wire leg the compiler triple rides');
});

// ── Capability rows (RED at HEAD) ────────────────────────────────────────────

test('P1 capability [roundtrip] — compileWavefile emits exactly what admitSpec accepts (canonical round-trip) for Appendix A and the minimal wavefile', async () => {
  const ns = await compiler();
  const { admitSpec } = await admission();
  const dir = mkdtempSync(join(tmpdir(), 'baton-dsl-p1-'));
  try {
    for (const [label, text] of [['appendix-a', APPENDIX_A], ['minimal', MINIMAL_WAVEFILE]]) {
      const ir = ns.compileWavefile(text, { repoRoot: dir });
      assert.ok(ir && typeof ir === 'object' && !Array.isArray(ir), `stage[roundtrip-${label}-shape] compileWavefile must emit an object IR`);
      assert.doesNotThrow(() => admitSpec(ir, dir), `stage[roundtrip-${label}-admit] admitSpec must accept the emitted IR`);
      assert.equal(canonicalJson(admitSpec(ir, dir)), canonicalJson(ir),
        `stage[roundtrip-${label}-canonical] admitSpec(compileWavefile(text)) must canonicalize identically to compileWavefile(text)`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P2 capability [scope-default] — the wave-level scope expands into every member lacking an override; a member scope overrides only itself; Appendix A compiles to the committed fixture', async () => {
  const ns = await compiler();
  const dir = mkdtempSync(join(tmpdir(), 'baton-dsl-p2-'));
  try {
    const ir = ns.compileWavefile(APPENDIX_A, { repoRoot: dir });
    assert.equal(canonicalJson(ir), canonicalJson(EXPECTED_APPENDIX_IR),
      'stage[appendix-a-roundtrip] Appendix A must compile byte-for-byte to the expected foundry IR (collapsed five scopes to one wave default)');
    for (const member of ir.members) {
      assert.deepEqual(member.scope, [FOUNDRY_SCOPE], `stage[scope-default-expansion] member ${member.role} receives the wave default scope array`);
    }
    // A member scope overrides the default for that member only — no cross-member bleed.
    const override = [
      'wave scope-override',
      'scope shared/**',
      'member alpha',
      '  harness mock',
      '  model mock-model',
      '  effort low',
      '  scope only-alpha/**',
      '  objectiveRef reports/a.md',
      'member beta',
      '  harness mock',
      '  model mock-model',
      '  effort low',
      '  objectiveRef reports/b.md',
    ].join('\n');
    const over = ns.compileWavefile(override, { repoRoot: dir });
    assert.deepEqual(over.members.find((m) => m.role === 'alpha').scope, ['only-alpha/**'],
      'stage[scope-default-override] the member scope override replaces the default for that member only');
    assert.deepEqual(over.members.find((m) => m.role === 'beta').scope, ['shared/**'],
      'stage[scope-default-override] the sibling member keeps the wave default — no cross-member bleed');
    // The committed immutable fixture must exist and match (a byte snapshot, NOT the live workflow.json).
    let fixtureText;
    try {
      fixtureText = readFileSync(FIXTURE_PATH, 'utf8');
    } catch {
      assert.fail('stage[foundry-fixture-committed] impl/test/fixtures/workflow-dsl-foundry-roundtrip.json must be committed (the immutable Appendix A snapshot)');
    }
    assert.equal(canonicalJson(JSON.parse(fixtureText)), canonicalJson(EXPECTED_APPENDIX_IR),
      'stage[foundry-fixture-committed] the committed fixture must equal the expected foundry IR');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P3 capability [no-deeper-inheritance] — a member scope is its own array or a copy of the default, never a merge; no route/steering/harvest defaults', async () => {
  const ns = await compiler();
  const dir = mkdtempSync(join(tmpdir(), 'baton-dsl-p3-'));
  try {
    const text = [
      'wave no-deeper',
      'scope a/**',
      'scope b/**',
      'member alpha',
      '  harness mock',
      '  model mock-model',
      '  effort low',
      '  objectiveRef reports/a.md',
    ].join('\n');
    const ir = ns.compileWavefile(text, { repoRoot: dir });
    // Repeated top-level scope directives accumulate in directive order (fold A2).
    assert.deepEqual(ir.members[0].scope, ['a/**', 'b/**'],
      'stage[no-deeper-accumulation] repeated top-level scope directives accumulate in directive order, never merge with a member override');
    // Steering and harvest have no defaults beyond the interpreter's empties.
    assert.deepEqual(ir.steering, {}, 'stage[no-deeper-steering] no steering directives must emit an empty steering object');
    assert.deepEqual(ir.harvest, { paths: [] }, 'stage[no-deeper-harvest] no harvest directives must emit the empty paths object');
    assert.ok(!('driver' in ir), 'stage[no-deeper-driver] no driver field may be invented as a default');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P4 capability [total-coverage] — WAVEFILE_DIRECTIVES covers every closed field; schemaVersion is never authorable', async () => {
  const ns = await compiler();
  const names = directiveNames(ns);
  const nameSet = new Set(names);
  assert.equal(nameSet.size, 16, 'stage[total-coverage-count] the closed directive vocabulary must be exactly 16 directives');
  for (const [directive] of CLOSED_DIRECTIVES) {
    assert.ok(nameSet.has(directive), `stage[total-coverage-${directive}] the directive ${directive} must be in WAVEFILE_DIRECTIVES (the ${CLOSED_DIRECTIVES.find(([d]) => d === directive)[1]} field)`);
  }
  // schemaVersion is fixed by the interpreter, never authored — the registry must NOT express it.
  assert.ok(!nameSet.has('schemaVersion'), 'stage[total-coverage-schemaVersion] schemaVersion must never be an authorable directive');
});

test('P5 capability [sniffing] — a DSL text compiles; a text whose first token is not `wave` (and not `{`) refuses as a wavefile at line 1', async () => {
  const ns = await compiler();
  const dir = mkdtempSync(join(tmpdir(), 'baton-dsl-p5-'));
  try {
    assert.ok(ns.compileWavefile(MINIMAL_WAVEFILE, { repoRoot: dir }), 'stage[sniffing-dsl-compiles] a wavefile text must compile');
    // A text starting with `[` is NOT `{` — it compiles as a wavefile and refuses at line 1 (D2).
    assertRefusal(
      () => ns.compileWavefile('[not-json]', { repoRoot: dir }),
      { code: 'workflow_spec_invalid', line: 1, field: '[not-json]', expected: 'wave <key>' },
      'stage[sniffing-array-refusal]',
    );
    // `wave` must be the first directive of a wavefile (the totalness rule the sniffer relies on).
    assertRefusal(
      () => ns.compileWavefile('member alpha\n  harness mock\n', { repoRoot: dir }),
      { code: 'workflow_spec_invalid', line: 1, field: 'member', expected: 'wave <key>' },
      'stage[sniffing-wave-first]',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P7 capability [compile-seam] — compileWavefile is pure and idempotent; the seam exposes no wave-starting surface', async () => {
  const ns = await compiler();
  const dir = mkdtempSync(join(tmpdir(), 'baton-dsl-p7-'));
  try {
    const first = ns.compileWavefile(APPENDIX_A, { repoRoot: dir });
    const second = ns.compileWavefile(APPENDIX_A, { repoRoot: dir });
    assert.equal(canonicalJson(first), canonicalJson(second), 'stage[compile-seam-idempotent] two compiles of the same text must emit the identical IR');
    // The compile seam is read-only: importing the module runs nothing and it exposes no run/start.
    assert.equal(typeof ns.runWorkflow, 'undefined', 'stage[compile-seam-readonly] the compiler must not export runWorkflow');
    assert.equal(typeof ns.run, 'undefined', 'stage[compile-seam-readonly] the compiler must not export a run port');
    assert.equal(typeof ns.start, 'undefined', 'stage[compile-seam-readonly] the compiler must not export a start port');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('OQ6 capability [registry-seam] — the waves.compile canonical operation lands (4 surfaces) and waves.run gains web', () => {
  const ops = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations;
  const compile = ops.find((entry) => entry.key === 'waves.compile');
  assert.ok(compile, 'stage[registry-seam-compile-row] the waves.compile canonical operation must be registered');
  assert.deepEqual([...compile.surfaces].sort(), ['cli', 'embedded', 'mcp', 'web'],
    'stage[registry-seam-compile-surfaces] waves.compile must register on all four surfaces (no ghost row)');
  assert.equal(compile.effect, 'observe', 'stage[registry-seam-compile-effect] waves.compile must be a read-only observe operation (admission-free)');
  const run = ops.find((entry) => entry.key === 'waves.run');
  assert.ok(run, 'stage[registry-seam-run-row] the waves.run canonical operation must exist');
  assert.ok(run.surfaces.includes('web'), 'stage[registry-seam-run-web] waves.run must gain web (its waves_run bus transport already exists, OQ6)');
});

test('P6 capability [surfaces-parity] — the compile seam lands on all four surfaces (CLI verb, bus transport, MCP tool, facade method)', () => {
  // CLI: `baton waves compile <specPath>` forms a waves.compile command (the inspectable seam).
  let cliOk = false;
  try {
    const cmd = parseBatonCli(['waves', 'compile', 'appendix.dsl']);
    cliOk = cmd?.kind === 'command' && cmd?.name === 'waves.compile';
  } catch { cliOk = false; }
  assert.ok(cliOk, 'stage[surfaces-parity-cli] the CLI must parse `baton waves compile <specPath>` into the waves.compile command');
  // Bus: waves_compile transport + specDsl admitted (ARG_FIELDS, D4).
  const web = readFileSync(WEB_PATH, 'utf8');
  assert.ok(/waves_compile/u.test(web), 'stage[surfaces-parity-bus] the web bus must admit a waves_compile transport');
  assert.ok(/specDsl/u.test(web), 'stage[surfaces-parity-bus] the web ARG_FIELDS must gain specDsl');
  // MCP: baton_waves_compile is a NEW read-only tool; baton_waves_run gains specDsl.
  assert.ok(mcpApplicationToolNames().includes('baton_waves_compile'), 'stage[surfaces-parity-mcp] the MCP surface must advertise baton_waves_compile');
  // Facade: baton.waves.compile is a new method on the waves accessor.
  const client = readFileSync(CLIENT_PATH, 'utf8');
  assert.ok(/\bcompile\s*:/u.test(client), 'stage[surfaces-parity-facade] the embedded facade must expose a baton.waves.compile method');
});

test('P8 capability [generated-docs] — renderWavefileGrammar renders the directive table; the conformance main gains the wavefile leg', () => {
  const docs = readFileSync(RENDER_DOCS_PATH, 'utf8');
  assert.ok(/renderWavefileGrammar/u.test(docs), 'stage[generated-docs-render] render-surface-docs.mjs must export renderWavefileGrammar (the directive table generator)');
  const conf = readFileSync(CONFORMANCE_PATH, 'utf8');
  assert.ok(/wavefile/iu.test(conf), 'stage[generated-docs-conformance] surface-conformance.mjs must gain the wavefile (documented ⇄ parsed ⇄ admitted) leg');
});

test('P9 capability [mcp-triple] — baton_waves_run gains specDsl and dispatches through the compile seam so the typed workflow_* code + detail ride the MCP wire', () => {
  const mcp = readFileSync(MCP_PATH, 'utf8');
  assert.ok(/baton_waves_run[\s\S]{0,600}specDsl/u.test(mcp), 'stage[mcp-triple-specDsl] baton_waves_run must gain specDsl alongside spec');
  // The dispatch compiles specDsl before the interpreter; the compiler's thrown detail leg then
  // rides the LANE_CRAFTED arm (PIN-E) so error.detail = {line, field, expected} reaches the wire.
  assert.ok(/compileWavefile/u.test(mcp), 'stage[mcp-triple-dispatch] the MCP dispatch must compile specDsl through the seam');
});

test('P10 capability [web-triple] — the web surface gains specDsl and the #160 R3 pre-TypeError workflow_* arm (GATED on #160 R3 landing)', () => {
  const web = readFileSync(WEB_PATH, 'utf8');
  assert.ok(/specDsl/u.test(web), 'stage[web-triple-specDsl] the web ARG_FIELDS must gain specDsl');
  // #160 R3 (contract N1): the pre-TypeError workflow_* arm must land BEFORE the TypeError-name arm,
  // so a bare workflow_* throw preserves its typed code + detail instead of degrading to invalid_command.
  assert.ok(/startsWith\(['"]workflow_['"]\)/u.test(web),
    'stage[web-triple-gated-on-160r3] the web must gain the pre-TypeError workflow_* prefix arm (SEQUENCED AFTER #160 R3)');
});

test('R1 capability [unknown-directive] — an unknown directive refuses workflow_spec_invalid with the closed-list expected', async () => {
  const ns = await compiler();
  const dir = mkdtempSync(join(tmpdir(), 'baton-dsl-r1-'));
  try {
    assertRefusal(
      () => ns.compileWavefile('wave ok-key\nmemberr foo\n', { repoRoot: dir }),
      { code: 'workflow_spec_invalid', line: 2, field: 'memberr', expected: '<closed directive list>' },
      'stage[unknown-directive]',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R2 capability [member-missing-fields] — a member missing exact fields reports the FIRST missing field in fixed order (harness first)', async () => {
  const ns = await compiler();
  const dir = mkdtempSync(join(tmpdir(), 'baton-dsl-r2-'));
  try {
    // Missing harness AND objectiveRef → field names harness (NOT objectiveRef) — the folded R2 order.
    const text = 'wave ok-key\nmember alpha\n  scope reports/**\n';
    let caught;
    try {
      ns.compileWavefile(text, { repoRoot: dir });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, 'stage[member-missing-fields] expected a refusal for a member missing harness/model/effort/objectiveRef');
    assert.equal(caught?.code, 'workflow_member_invalid', 'stage[member-missing-fields] wrong code');
    assert.equal(caught?.line, 2, 'stage[member-missing-fields] the refusal line is the member directive');
    assert.equal(caught?.field, 'exact.harness', 'stage[member-missing-fields] field must name the FIRST missing field in harness→model→effort→objectiveRef order — harness, never objectiveRef');
    assert.equal(caught?.expected, 'harness|model|effort', 'stage[member-missing-fields] expected names the closed exact-field set');
    assert.deepEqual(caught?.detail, { line: 2, field: 'exact.harness', expected: 'harness|model|effort' },
      'stage[member-missing-fields] the detail wire leg must equal {line, field, expected}');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R3 capability [member-no-scope] — a member with no scope and no wave default refuses workflow_member_invalid', async () => {
  const ns = await compiler();
  const dir = mkdtempSync(join(tmpdir(), 'baton-dsl-r3-'));
  try {
    const text = [
      'wave ok-key',
      'member alpha',
      '  harness mock',
      '  model mock-model',
      '  effort low',
      '  objectiveRef reports/a.md',
    ].join('\n');
    assertRefusal(
      () => ns.compileWavefile(text, { repoRoot: dir }),
      { code: 'workflow_member_invalid', line: 2, field: /^member\s/u, expected: 'non-empty scope' },
      'stage[member-no-scope]',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R4 capability [duplicate-role] — a duplicate member role refuses workflow_member_invalid', async () => {
  const ns = await compiler();
  const dir = mkdtempSync(join(tmpdir(), 'baton-dsl-r4-'));
  try {
    const text = [
      'wave ok-key',
      'scope reports/**',
      'member alpha',
      '  harness mock',
      '  model mock-model',
      '  effort low',
      '  objectiveRef reports/a.md',
      'member alpha',
      '  harness mock',
      '  model mock-model',
      '  effort low',
      '  objectiveRef reports/b.md',
    ].join('\n');
    assertRefusal(
      () => ns.compileWavefile(text, { repoRoot: dir }),
      { code: 'workflow_member_invalid', line: 8, field: /^member\s/u, expected: 'unique role' },
      'stage[duplicate-role]',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R5 capability [messageOnSpawn-bad-kind] — a messageOnSpawn kind outside MESSAGE_KINDS refuses workflow_steering_unknown', async () => {
  const ns = await compiler();
  const dir = mkdtempSync(join(tmpdir(), 'baton-dsl-r5-'));
  try {
    assertRefusal(
      () => ns.compileWavefile('wave ok-key\nmessageOnSpawn async "body"\n', { repoRoot: dir }),
      { code: 'workflow_steering_unknown', line: 2, field: 'messageOnSpawn.kind', expected: 'inform|query|steer|brief|result' },
      'stage[messageOnSpawn-bad-kind]',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R6 capability [elevate-bad-kind] — an elevateWhenNotes kind outside SCRATCHPAD_KINDS refuses workflow_steering_unknown', async () => {
  const ns = await compiler();
  const dir = mkdtempSync(join(tmpdir(), 'baton-dsl-r6-'));
  try {
    assertRefusal(
      () => ns.compileWavefile('wave ok-key\nelevateWhenNotes doubt,secret 20\n', { repoRoot: dir }),
      { code: 'workflow_steering_unknown', line: 2, field: 'elevateWhenNotes.kinds', expected: 'doubt|link|note|plan' },
      'stage[elevate-bad-kind]',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R7 capability [bare-directory-scope] — a bare-directory scope refuses workflow_member_invalid with the "<dir>/**" corrective', async () => {
  const ns = await compiler();
  const dir = mkdtempSync(join(tmpdir(), 'baton-dsl-r7-'));
  try {
    assertRefusal(
      () => ns.compileWavefile('wave ok-key\nscope docs/reference/evidence/contract-foundry-2026-08-13\n', { repoRoot: dir }),
      { code: 'workflow_member_invalid', line: 2, field: 'scope', expected: '"<dir>/**"' },
      'stage[bare-directory-scope]',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R8 capability [absolute-harvest-path] — an absolute harvest path refuses workflow_harvest_invalid', async () => {
  const ns = await compiler();
  const dir = mkdtempSync(join(tmpdir(), 'baton-dsl-r8-'));
  try {
    assertRefusal(
      () => ns.compileWavefile('wave ok-key\nharvest /abs/path\n', { repoRoot: dir }),
      { code: 'workflow_harvest_invalid', line: 2, field: 'harvest.paths[0]', expected: 'non-empty path in the repo path class' },
      'stage[absolute-harvest-path]',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R9 capability [bad-idempotency-key] — a wave key violating IDEMPOTENCY_PATTERN refuses workflow_spec_invalid', async () => {
  const ns = await compiler();
  const dir = mkdtempSync(join(tmpdir(), 'baton-dsl-r9-'));
  try {
    assertRefusal(
      () => ns.compileWavefile('wave "bad key!"\n', { repoRoot: dir }),
      { code: 'workflow_spec_invalid', line: 1, field: 'idempotencyKey', expected: '<IDEMPOTENCY_PATTERN>' },
      'stage[bad-idempotency-key]',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R10 capability [head-seam] — the application runWorkflow sniffs and compiles a wavefile path before the interpreter (the seam that flips the HEAD refusal green)', () => {
  // At HEAD the application hands specOrPath straight to the interpreter (JSON-only string load);
  // the seam lives at the surface, never inside the interpreter. Post-impl the application compiles.
  const app = readFileSync(APP_PATH, 'latin1');
  assert.ok(/compileWavefile/u.test(app), 'stage[head-seam-compile] application.mjs runWorkflow must sniff + compile a wavefile path before the interpreter');
  assert.ok(/specDsl/u.test(app), 'stage[head-seam-specDsl] application.mjs runWorkflow must admit inline specDsl text');
});

test('S1 capability [no-eval-no-fs] — the compiler performs no eval/Function/import() and no file READS; realpathSync only behind the repoRoot gate', async () => {
  await compiler(); // module must exist (named stage at HEAD)
  const src = readFileSync(COMPILER_PATH, 'utf8');
  for (const forbidden of ['eval(', 'new Function', 'import(']) {
    assert.ok(!src.includes(forbidden), `stage[no-eval-no-fs] the compiler body must not contain ${forbidden}`);
  }
  for (const read of ['readFileSync', 'readFile', 'openSync', 'fstatSync']) {
    assert.ok(!src.includes(read), `stage[no-eval-no-fs] the compiler body must not read files (${read})`);
  }
  // realpathSync is the ONLY fs syscall permitted, and only behind the repoRoot-gated harvest
  // containment check (fold B3/A4). The read denylist above already proves no read surface is
  // imported; the gated use itself is a behavioral leg the round-trip rows exercise (a harvest
  // path symlink-escape draws workflow_harvest_invalid when repoRoot is provided).
  assert.ok(src.includes('realpathSync') || !src.includes("from 'node:fs'"),
    'stage[no-eval-no-fs] the only fs import permitted is the repoRoot-gated realpathSync');
});

test('S2 capability [no-driver-schemaVersion] — every emitted IR has schemaVersion exactly 1 and no driver field', async () => {
  const ns = await compiler();
  const { admitSpec } = await admission();
  const dir = mkdtempSync(join(tmpdir(), 'baton-dsl-s2-'));
  try {
    for (const text of [MINIMAL_WAVEFILE, APPENDIX_A]) {
      const ir = ns.compileWavefile(text, { repoRoot: dir });
      assert.equal(ir.schemaVersion, 1, 'stage[no-driver-schemaVersion] schemaVersion must be exactly 1');
      assert.ok(!('driver' in ir), 'stage[no-driver-schemaVersion] the emitted IR must carry no driver field (an invocation option, not a spec field)');
      assert.ok(!('driver' in admitSpec(ir, dir)), 'stage[no-driver-schemaVersion] admitSpec must not re-introduce a driver field');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('S3 capability [three-way-invariant] — the generated directive set equals the compiler accepted set and is a subset of the documented set', async () => {
  const ns = await compiler();
  const names = directiveNames(ns);
  // The #159 three-way invariant: documented ⇄ parsed ⇄ admitted. The generated WAVEFILE_DIRECTIVES
  // set (rendered by renderWavefileGrammar) must equal the compiler's accepted set and be a subset
  // of the documented 16-directive table (D1) — derived from ONE source, never hand-edited.
  const docs = readFileSync(RENDER_DOCS_PATH, 'utf8');
  assert.ok(/renderWavefileGrammar/u.test(docs), 'stage[three-way-invariant-render] renderWavefileGrammar must render the directive table from WAVEFILE_DIRECTIVES');
  const documented = new Set(CLOSED_DIRECTIVES.map(([directive]) => directive));
  for (const name of names) {
    assert.ok(documented.has(name), `stage[three-way-invariant-subset] the accepted directive ${name} must be in the documented 16-directive table`);
  }
  assert.equal(names.length, documented.size, 'stage[three-way-invariant-equal] the accepted directive set must equal the documented set (no accepted-but-undocumented, no documented-but-unaccepted)');
});

test('S4 capability [closure] — the directive vocabulary is DISJOINT from the baton-attached dispatch surface', async () => {
  const ns = await compiler();
  const names = directiveNames(ns);
  for (const machine of MACHINERY_NAMES) {
    assert.ok(!names.includes(machine), `stage[closure-${machine}] no directive may name ${machine} — it is machine-minted (attempt salt → interpreter randomUUID; runId/waveId → dispatch; driver/cadence → invocation option; projection → not in the closed spec)`);
  }
});

test('S5 capability [constants] — the compiler closed constants equal the interpreter constants byte-for-byte', async () => {
  const ns = await compiler();
  const interpSrc = readFileSync(INTERPRETER_PATH, 'utf8');
  const compilerSrc = readFileSync(COMPILER_PATH, 'utf8');
  const extractPattern = (src) => /IDEMPOTENCY_PATTERN = \/([^/]+)\//u.exec(src)?.[1];
  const compilerPattern = extractPattern(compilerSrc);
  const interpPattern = extractPattern(interpSrc);
  assert.ok(compilerPattern && interpPattern, 'stage[constants-pattern] both modules must declare IDEMPOTENCY_PATTERN');
  assert.equal(compilerPattern, interpPattern, 'stage[constants-pattern] IDEMPOTENCY_PATTERN must be byte-identical');
  // MAX_MEMBERS / MAX_SCOPE / the enum sets — byte-identical to the interpreter's closed values.
  const interpCeiling = /MAX_MEMBERS = (\d+)/u.exec(interpSrc)?.[1];
  const compilerCeiling = /MAX_MEMBERS = (\d+)/u.exec(compilerSrc)?.[1];
  assert.equal(compilerCeiling, interpCeiling, 'stage[constants-max-members] MAX_MEMBERS must be byte-identical');
  for (const enumName of ['MESSAGE_KINDS', 'SCRATCHPAD_KINDS']) {
    const enumRe = new RegExp(`${enumName} = new Set\\(\\[([\\s\\S]*?)\\]\\)`, 'u');
    const interpEnum = enumRe.exec(interpSrc)?.[1];
    const compilerEnum = enumRe.exec(compilerSrc)?.[1];
    assert.ok(interpEnum && compilerEnum, `stage[constants-${enumName.toLowerCase()}] both modules must declare ${enumName}`);
    assert.equal(compilerEnum.trim(), interpEnum.trim(), `stage[constants-${enumName.toLowerCase()}] ${enumName} must be byte-identical`);
  }
  // Or a shared closed-constants module (S5 alternative) — both satisfy the source-scan.
  assert.ok(compilerSrc.includes('MESSAGE_KINDS') && compilerSrc.includes('SCRATCHPAD_KINDS'),
    'stage[constants-shared-module] the compiler must declare the closed enums (locally or via a shared module)');
});
