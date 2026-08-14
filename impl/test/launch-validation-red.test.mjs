// [attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-165] — the red-first suite for the folded #165 launch-validation contract.
// Binding contract: docs/reference/evidence/contract-foundry-2026-08-13/contract-165.md (v2, folded) — ground truths G1-G10,
//   decisions D1 (the file-only law on BOTH surfaces) / D2 (deliverable-coverage, strict `## Deliverables` grammar) / D3 (the
//   spec-side admission pin), the refusal vocabulary (four driver tokens + workflow_harvest_invalid), red-first acceptance
//   pins A1-A7, open questions OQ1-OQ6. Red-team: redteam-165.md (four blockers; D2-H1 the prose-parses-as-path attack this
//   suite's A3 discriminates). Verification HEAD e371f70.
//
// Row inventory — every §red-first-acceptance pin becomes a row at its named stage. 12 tests = 9 red capability rows
// (A1, A2, A3, A3-nearmiss, A4, A4-object, A5, A7, S1) + 3 green guard/pin rows (A6, P2, E1). The 9 red rows each fail
// at HEAD at a NAMED stage (the stage string in the assertion message); the 3 green rows guard landed behavior the
// contract says is unchanged (A6 the normalization non-refusal that binds the D2 implementation; P2 the landed
// containment admission; E1 the verified driver exit-code map).
//
//   Row   | Contract pin        | Stage (named)                     | At HEAD
//   ------|-------------------- |------------------------------------|------------------------------
//   A1    | D1a driver dir      | d1a-directory-refused             | RED — driver checks --targets presence only (run-task-wave.mjs:44-47)
//   A2    | D2a driver coverage | d2a-coverage-refused              | RED — driver never reads the brief (run-task-wave.mjs:60, G6)
//   A3    | D2 strict grammar   | d2-grammar-prose                  | RED — no brief read at all (G6)
//   A3-nm | D2 near-miss head   | d2-grammar-nearmiss-heading       | RED — no brief read at all (G6)
//   A4    | D1b admission str   | d1b-admission-directory           | RED — admitHarvestEntry checks containment only (:300-327)
//   A4-obj| D1b {path,mustCont}.| d1b-admission-directory-object    | RED — same seam, object entry form (:308,311,314)
//   A5    | D3 + D2b transports | d3-transport-code-survival        | RED — no refusal exists to survive the transports
//   A7    | D2b objective render| d2b-objective-render-coverage     | RED — renderObjective reads the brief only to build text (:339)
//   S1    | static tokens       | static-launch-refusal-tokens      | RED — none of the four driver tokens exist at HEAD
//   A6    | D2 normalization    | d2-normalization-non-refusal      | GREEN (no predicate to misfire) — binds the impl
//   P2    | D3 containment      | d1b-containment-guard             | GREEN — assertHarvestContained throws workflow_harvest_invalid
//   E1    | exit-code map       | exit-code-map                     | GREEN — exit 2 (:46,:48,:65), exit 1 (:96), verdicts receipt-carried
//
// Hermetic: mkdtemp git repos + log dirs cleaned in t.after; the driver rows spawn the real run-task-wave.mjs with an
// EMPTY XDG_CONFIG_HOME so the wave launch reaches waves.start and refuses deterministically with authentication_required
// (exit 1) when no launch refusal fires — no network, no real provider, no host state. The interpreter rows drive the
// real embedded lane (baton.recipes.runWorkflow, present at HEAD) with the pinned fast driver policy. No clocks as
// controls (FAR_FUTURE parsed once at module load). Static anchors are EXISTENCE/byte-string assertions only — never
// absolute line windows (#166). NUL discipline: application.mjs / coordination-store.mjs are never read whole.
//
// Verified split: 9 red / 3 green — `node impl/scripts/run-suite.mjs impl/test/launch-validation-red.test.mjs` from the
// repo root, twice (stable): tests 12 · pass 3 · fail 9 (each red row failing at its named stage — see suite-notes-165.md).

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { parseBatonCli } from '../src/application-cli.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver, McpFleetServer, WebNorthbound } from '../src/index.mjs';
import { mcpApplicationToolNames } from '../src/mcp-northbound.mjs';

const REPO = 'repo-launch-validation';
// The one deployment profile the whole suite rides (workflow-as-data-red PROFILE, repo-pinned).
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

const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });

// The pinned FAST driver policy (workflow-as-data-red F11) — every interpreter row drives the lane
// on the 15 ms poll, never the 20 s production cadence, so the admission/coverage rows stay
// load-insensitive. (The web and MCP transports cannot take a driver arg at HEAD — web ARG_FIELDS
// rejects it, MCP drops it — so A5's web/MCP legs ride the production cadence by construction.)
const LANE_DRIVER = Object.freeze({ pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: 3000 });

// F16 (workflow-as-data): one fixed far-future instant — no wall-clock TTL on northbound principals.
const FAR_FUTURE_MS = Date.parse('2099-01-01T00:00:00.000Z');
const FAR_FUTURE_ISO = '2099-12-31T23:59:59.000Z';

// The generic dogfood driver lives at docs/reference/evidence/run-task-wave.mjs — NOT in impl/.
const driverPath = fileURLToPath(
  new URL('../../docs/reference/evidence/run-task-wave.mjs', import.meta.url),
);

// ---------------------------------------------------------------------------
// Fixture helpers.
// ---------------------------------------------------------------------------

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-lv-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principalOf(id) {
  return Object.freeze({ actor: `test:${id}`, principalId: id, sessionId: `session-${id}` });
}

// The interpreter fixture — a real createDriver stack over a plain completed MockAdapter. The base
// card() modelSelection (adapter.mjs:230-239) validates a profile route {mock, mock-model, low}
// through selectExactRouteCard with no override. The `docs/reports` directory is created for real —
// the launch-tree directory A4/A4-object/A5 refuse on (G8).
async function lvFixture(t, { adapter } = {}) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'docs', 'reports'), { recursive: true });
  mkdirSync(join(repo, 'objectives'), { recursive: true });
  mkdirSync(join(repo, 'specs'), { recursive: true });
  const coordAdapter = adapter ?? new MockAdapter({ harness: 'mock', scenario: { outcome: 'completed' } });
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: coordAdapter },
    stopDeadlineMs: 2_000,
    // #67 admission law: watchdog.stallMs is a valid positive integer — a stallMs far beyond any
    // test window so a parked turn's freshly armed timer never fires and writes nothing.
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
  });
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('lv-planner'),
      dispatcher: principalOf('lv-dispatcher'),
      observer: principalOf('lv-observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principalOf('lv-owner'));
  t.after(async () => {
    try { await application.shutdown(principalOf('lv-cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo, adapter: coordAdapter, coordination: driver.coordination };
}

// One closed spec — a single completed member + empty steering + empty harvest (D1 v1.1 shape).
function lvSpec(overrides = {}) {
  return {
    schemaVersion: 1,
    idempotencyKey: 'lv-valid',
    members: [lvMember('lv-a')],
    steering: {},
    harvest: { paths: [] },
    ...overrides,
  };
}

function lvMember(role, overrides = {}) {
  return {
    role,
    exact: { ...ROUTE },
    scope: ['docs/**'],
    objectiveRef: `objectives/${role}.md`,
    report: `docs/reports/${role}.md`,
    ...overrides,
  };
}

function writeObjective(repo, role, text) {
  const path = join(repo, 'objectives', `${role}.md`);
  writeFileSync(path, text);
  return path;
}

// ---------------------------------------------------------------------------
// Interpreter row helpers.
// ---------------------------------------------------------------------------

function laneOf(baton, stage) {
  const lane = baton?.recipes?.runWorkflow;
  assert.equal(typeof lane, 'function',
    `stage[${stage}]: baton.recipes.runWorkflow(spec|specPath) must exist — the workflow-as-data interpreter lane (issue #114) is absent`);
  return lane;
}

function driveLane(baton, stage, spec) {
  return laneOf(baton, stage)(spec, { driver: LANE_DRIVER, detach: false });
}

async function captureError(fn) {
  try {
    const value = await fn();
    return { value };
  } catch (error) {
    return { error: { code: error?.code ?? null, message: String(error?.message ?? error) } };
  }
}

// ---------------------------------------------------------------------------
// Driver row helpers.
// ---------------------------------------------------------------------------

// A hermetic launch repo: git HEAD + optional real directories + target files + the brief. The
// driver's waves.start refuses deterministically here (empty XDG_CONFIG_HOME → authentication_required,
// exit 1) whenever no D1a/D2a launch refusal fires first.
function driverFixture(t, { dirs = [], targets = [], brief, briefText } = {}) {
  if (!t || typeof t.after !== 'function') throw new TypeError('driverFixture requires the test context');

  const repo = root('driver');
  for (const d of dirs) mkdirSync(join(repo, d), { recursive: true });
  for (const tgt of targets) { mkdirSync(join(repo, dirname(tgt)), { recursive: true }); writeFileSync(join(repo, tgt), `${basename(tgt)} content\n`); }
  if (brief) { mkdirSync(join(repo, dirname(brief)), { recursive: true }); writeFileSync(join(repo, brief), briefText); }
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  return repo;
}

function runDriver(repo, rowArgs) {
  const args = [
    '--evidence', 'docs/evidence', '--scope', 'docs/**', '--verdict', 'LV',
    '--effort', 'low', '--deadline-min', '1',
    ...rowArgs,
  ];
  const cfgDir = join(repo, '.empty-cfg');
  mkdirSync(cfgDir, { recursive: true });
  const result = spawnSync(process.execPath, [driverPath, ...args], {
    cwd: repo, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, XDG_CONFIG_HOME: cfgDir },
  });
  return { status: result.status, out: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

// The contract's D1a/D2a message tokens, asserted against the driver's stdout+stderr (the driver
// prints usage/refusals to stderr and receipts to stdout — combine both so a lone exit code cannot
// hide the message).
const driverOut = (r) => r.out;

// ---------------------------------------------------------------------------
// A1 — driver directory refusal (D1a).
// ---------------------------------------------------------------------------

test('A1 (stage[d1a-directory-refused]): the driver refuses a directory --targets before waves.start', (t) => {
  const stage = 'd1a-directory-refused';
  const repo = driverFixture(t, {
    dirs: ['docs/reports'],
    brief: 'docs/a1-brief.md',
    briefText: '# A1 brief\n\nDeliver the target file.\n',
  });
  const r = runDriver(repo, ['--role', 'lv-a1', '--brief', 'docs/a1-brief.md', '--targets', 'docs/reports']);
  assert.equal(r.status, 2,
    `stage[${stage}]: --targets docs/reports names a real directory — the launch must refuse with exit 2 (the driver's launch-refusal class); at HEAD it reaches waves.start and exits 1 with authentication_required`);
  const out = driverOut(r);
  assert.match(out, /target_directory_refused/u,
    `stage[${stage}]: the refusal carries the typed driver token target_directory_refused`);
  assert.match(out, /docs\/reports/u, `stage[${stage}]: the refusal names the offending directory path`);
  assert.match(out, /names a directory/u, `stage[${stage}]: the refusal names the shape (the file-only law)`);
  assert.match(out, /FILES/u, `stage[${stage}]: the refusal cites the law — targets name FILES, never directories`);
});

// ---------------------------------------------------------------------------
// A2 — driver deliverable-coverage refusal (D2a).
// ---------------------------------------------------------------------------

test('A2 (stage[d2a-coverage-refused]): a brief deliverable absent from --targets refuses exit 2 naming the uncovered set', (t) => {
  const stage = 'd2a-coverage-refused';
  const repo = driverFixture(t, {
    targets: ['docs/a2-target.md'],
    brief: 'docs/a2-brief.md',
    briefText: [
      '# A2 brief',
      '',
      'Deliver the contract file.',
      '',
      '## Deliverables',
      '',
      '- docs/a2-deliverable.md',
      '',
    ].join('\n'),
  });
  const r = runDriver(repo, ['--role', 'lv-a2', '--brief', 'docs/a2-brief.md', '--targets', 'docs/a2-target.md']);
  assert.equal(r.status, 2,
    `stage[${stage}]: the brief names docs/a2-deliverable.md absent from --targets — the launch must refuse with exit 2; at HEAD the driver never reads the brief (G6) and reaches waves.start (exit 1)`);
  const out = driverOut(r);
  assert.match(out, /deliverables_uncovered/u,
    `stage[${stage}]: the refusal carries the typed driver token deliverables_uncovered`);
  assert.match(out, /docs\/a2-deliverable\.md/u,
    `stage[${stage}]: the refusal names the uncovered deliverable path`);
});

// ---------------------------------------------------------------------------
// A3 — driver strict grammar (D2): a whitespace-bearing prose line refuses.
// ---------------------------------------------------------------------------

test('A3 (stage[d2-grammar-prose]): a prose line inside ## Deliverables refuses deliverables_malformed naming the line', (t) => {
  const stage = 'd2-grammar-prose';
  const repo = driverFixture(t, {
    targets: ['docs/a3-target.md'],
    brief: 'docs/a3-brief.md',
    briefText: [
      '# A3 brief',
      '',
      '## Deliverables',
      '',
      '- the contract file, plus its fold map',
      '',
    ].join('\n'),
  });
  const r = runDriver(repo, ['--role', 'lv-a3', '--brief', 'docs/a3-brief.md', '--targets', 'docs/a3-target.md']);
  assert.equal(r.status, 2,
    `stage[${stage}]: the prose bullet is not a strict bullet/bare path — the launch must refuse with exit 2 naming the line; at HEAD no brief read exists (G6)`);
  const out = driverOut(r);
  assert.match(out, /deliverables_malformed/u,
    `stage[${stage}]: the refusal carries the typed driver token deliverables_malformed`);
  assert.match(out, /contract file, plus its fold map/u,
    `stage[${stage}]: the refusal names the offending prose line (never a loose parse — the red-team D2-H1 attack)`);
});

// ---------------------------------------------------------------------------
// A3-nearmiss — D2 grammar closure: a near-miss heading cannot silently disable coverage.
// ---------------------------------------------------------------------------

test('A3-nearmiss (stage[d2-grammar-nearmiss-heading]): a `### Deliverables` heading with no ## Deliverables section refuses deliverables_malformed', (t) => {
  const stage = 'd2-grammar-nearmiss-heading';
  const repo = driverFixture(t, {
    targets: ['docs/a3b-target.md'],
    brief: 'docs/a3b-brief.md',
    briefText: [
      '# A3b brief',
      '',
      'Deliver the target file.',
      '',
      '### Deliverables',
      '',
    ].join('\n'),
  });
  const r = runDriver(repo, ['--role', 'lv-a3b', '--brief', 'docs/a3b-brief.md', '--targets', 'docs/a3b-target.md']);
  assert.equal(r.status, 2,
    `stage[${stage}]: a near-miss heading (## Deliverables at depth 3) must refuse — a typo'd heading can never silently disable the coverage guarantee (D2); at HEAD no brief read exists (G6)`);
  const out = driverOut(r);
  assert.match(out, /deliverables_malformed/u,
    `stage[${stage}]: the refusal carries the typed driver token deliverables_malformed`);
  assert.match(out, /Deliverables/u, `stage[${stage}]: the refusal names the near-miss heading`);
});

// ---------------------------------------------------------------------------
// A4 / A4-object — interpreter admission directory refusal (D1b/D3).
// ---------------------------------------------------------------------------

test('A4 (stage[d1b-admission-directory]): a string harvest.paths entry naming a launch-tree directory refuses workflow_harvest_invalid AT ADMISSION', async (t) => {
  const stage = 'd1b-admission-directory';
  const fx = await lvFixture(t);
  const spec = lvSpec({
    idempotencyKey: 'lv-a4',
    members: [lvMember('lv-a4')],
    harvest: { paths: ['docs/reports'] },
  });
  writeObjective(fx.repo, 'lv-a4', '# lv-a4 objective\n\nDeliver the report.\n');
  const result = await captureError(() => driveLane(fx.baton, stage, spec));
  assert.equal(result?.error?.code, 'workflow_harvest_invalid',
    `stage[${stage}]: harvest.paths ["docs/reports"] names a real launch-tree directory — admitHarvestEntry must refuse at admission; at HEAD it checks containment only (:300-327) and the directory passes admission (the W1-05 table case, G8)`);
  assert.match(result?.error?.message ?? '', /docs\/reports/u,
    `stage[${stage}]: the refusal names the directory path`);
  assert.match(result?.error?.message ?? '', /names a directory/u,
    `stage[${stage}]: the refusal names the shape (the file-only law)`);
  assert.match(result?.error?.message ?? '', /FILES/u,
    `stage[${stage}]: the refusal cites the law — harvest paths name FILES, never directories`);
});

test('A4-object (stage[d1b-admission-directory-object]): the {path, mustContain} harvest entry form refuses a directory the same way', async (t) => {
  const stage = 'd1b-admission-directory-object';
  const fx = await lvFixture(t);
  const spec = lvSpec({
    idempotencyKey: 'lv-a4o',
    members: [lvMember('lv-a4o')],
    harvest: { paths: [{ path: 'docs/reports', mustContain: '[attempt: lv-a4o' }] },
  });
  writeObjective(fx.repo, 'lv-a4o', '# lv-a4o objective\n\nDeliver the report.\n');
  const result = await captureError(() => driveLane(fx.baton, stage, spec));
  assert.equal(result?.error?.code, 'workflow_harvest_invalid',
    `stage[${stage}]: the {path, mustContain} entry form must refuse the same directory at admission (D1b covers BOTH entry forms, :308,311,314); at HEAD it passes admission`);
  assert.match(result?.error?.message ?? '', /docs\/reports/u,
    `stage[${stage}]: the refusal names the directory path`);
  assert.match(result?.error?.message ?? '', /FILES/u,
    `stage[${stage}]: the refusal cites the file-only law`);
});

// ---------------------------------------------------------------------------
// A5 — the typed refusal survives the waves.run surface on CLI, MCP, and web.
// ---------------------------------------------------------------------------

test('A5 (stage[d3-transport-code-survival]): the directory-harvest refusal code reaches waves.run on CLI, MCP, AND web — no transport-side re-spelling', { timeout: 180_000 }, async (t) => {
  const stage = 'd3-transport-code-survival';
  const fx = await lvFixture(t);
  const code = 'workflow_harvest_invalid';

  const dirSpec = (idempotencyKey) => lvSpec({ idempotencyKey, members: [lvMember(idempotencyKey.replaceAll('-', '_'))], harvest: { paths: ['docs/reports'] } });
  const cliSpec = dirSpec('lv-a5-cli');
  const webSpec = dirSpec('lv-a5-web');
  const mcpSpec = dirSpec('lv-a5-mcp');
  writeObjective(fx.repo, 'lv_a5_cli', '# lv-a5-cli objective\n\nDeliver the report.\n');
  writeObjective(fx.repo, 'lv_a5_web', '# lv-a5-web objective\n\nDeliver the report.\n');
  writeObjective(fx.repo, 'lv_a5_mcp', '# lv-a5-mcp objective\n\nDeliver the report.\n');
  const cliPath = join(fx.repo, 'specs', 'a5-cli.json');
  writeFileSync(cliPath, JSON.stringify(cliSpec));
  const webPath = join(fx.repo, 'specs', 'a5-web.json');
  writeFileSync(webPath, JSON.stringify(webSpec));

  // CLI leg: baton waves run <spec.json> parses to waves.run; the embedded command port carries the
  // refusal. Driven with the fast driver policy (the workflow-as-data F11 cadence choice — the
  // refusal code is cadence-independent, and the assertion never waits on the 20 s production poll).
  const parsed = parseBatonCli(['waves', 'run', cliPath]);
  assert.equal(parsed?.command, 'waves.run', `stage[${stage}]: baton waves run <spec.json> must parse to the waves.run command`);
  const cli = await captureError(() => fx.application.command('waves.run', { specPath: cliPath, driver: LANE_DRIVER, detach: false }, principalOf('lv-cli'), null));
  assert.equal(cli?.error?.code, code,
    `stage[${stage}]: the CLI leg must surface the typed directory refusal — at HEAD the admission check is absent (A4) and the wave runs`);
  assert.match(cli?.error?.message ?? '', /docs\/reports/u,
    `stage[${stage}]: the CLI message names the directory path`);

  // MCP leg: baton_waves_run { repoId, spec } — the tool carries the spec object. The MCP surface
  // drops the driver arg (mcp-northbound.mjs:1795-1801), so this leg rides the production 20 s poll.
  assert.ok(mcpApplicationToolNames().includes('baton_waves_run'),
    `stage[${stage}]: baton_waves_run is on the MCP application surface`);
  const server = await realServer(fx, mockPrincipal({ capabilities: ['control', 'observe'] }));
  await initialized(server);
  const mcp = await wireCall(server, 2, 'baton_waves_run', { repoId: REPO, spec: mcpSpec });
  assert.equal(mcp.result?.isError, true,
    `stage[${stage}]: the MCP leg must surface the refusal as a wire error — at HEAD the wave runs and the tool succeeds`);
  assert.equal(mcp.result?.structuredContent?.error?.code, code,
    `stage[${stage}]: the MCP leg carries the typed code in structuredContent.error (the pinned accessor — W6)`);
  assert.match(mcp.result?.structuredContent?.error?.message ?? '', /docs\/reports/u,
    `stage[${stage}]: the MCP message names the directory path`);

  // Web leg: waves_run direct port. The web surface does not accept a driver arg at HEAD
  // (WAVE_ARG_FIELDS.waves_run = {idempotencyKey, spec, specPath}), so this leg rides the production
  // cadence; the dispatchFailure mapping must carry the workflow_* code (currently absent — the fallback
  // is 503 temporarily_unavailable, so A5's web leg pins that mapping too).
  const web = new WebNorthbound({
    coordinator: fx.driver.coordinator,
    coordination: fx.driver.coordination,
    application: fx.application,
    repoIds: [REPO],
    allowedOrigins: ['https://control.example.test'],
    now: () => FAR_FUTURE_MS,
  });
  const webRes = await web.execute(webContext(), webEnvelope({ args: { specPath: webPath } }));
  assert.equal(webRes.body?.error?.code, code,
    `stage[${stage}]: the web direct port must carry the typed code in body.error — at HEAD the wave runs (200) and no workflow_* dispatchFailure arm exists`);
  assert.match(webRes.body?.error?.message ?? '', /docs\/reports/u,
    `stage[${stage}]: the web message names the directory path`);
});

// ---------------------------------------------------------------------------
// A7 — spec-surface deliverable-coverage refusal (D2b) at the objective render.
// ---------------------------------------------------------------------------

test('A7 (stage[d2b-objective-render-coverage]): a member objectiveRef brief declaring a deliverable absent from harvest.paths refuses workflow_harvest_invalid AT THE OBJECTIVE RENDER', async (t) => {
  const stage = 'd2b-objective-render-coverage';
  const fx = await lvFixture(t);
  const spec = lvSpec({
    idempotencyKey: 'lv-a7',
    members: [lvMember('lv-a7', { objectiveRef: 'objectives/lv-a7.md' })],
  });
  writeObjective(fx.repo, 'lv-a7', [
    '# lv-a7 objective',
    '',
    'Produce the contract deliverable.',
    '',
    '## Deliverables',
    '',
    '- docs/lv-a7-deliverable.md',
    '',
  ].join('\n'));
  const result = await captureError(() => driveLane(fx.baton, stage, spec));
  assert.equal(result?.error?.code, 'workflow_harvest_invalid',
    `stage[${stage}]: the objectiveRef brief declares docs/lv-a7-deliverable.md absent from harvest.paths — renderObjective must refuse at the objective render; at HEAD it reads the brief only to build the objective text (:339)`);
  assert.match(result?.error?.message ?? '', /docs\/lv-a7-deliverable\.md/u,
    `stage[${stage}]: the refusal names the uncovered deliverable`);
  assert.match(result?.error?.message ?? '', /lv-a7/u,
    `stage[${stage}]: the refusal names the member role whose brief declared it`);
});

// ---------------------------------------------------------------------------
// S1 — static: the four driver launch-refusal tokens must exist as literals.
// ---------------------------------------------------------------------------

test('S1 (stage[static-launch-refusal-tokens]): the four driver launch-refusal tokens exist in the driver source', () => {
  const stage = 'static-launch-refusal-tokens';
  const source = readFileSync(driverPath, 'utf8');
  for (const token of ['target_directory_refused', 'deliverables_malformed', 'deliverables_uncovered', 'brief_unreadable']) {
    assert.ok(source.includes(token),
      `stage[${stage}]: the launch-refusal token ${token} must exist in the driver source as a literal — at HEAD none of the four exist (the refusal vocabulary is RED)`);
  }
});

// ---------------------------------------------------------------------------
// A6 — GREEN guard: coverage normalization non-refusal binds the D2 implementation.
// ---------------------------------------------------------------------------

test('A6 (stage[d2-normalization-non-refusal]): ./docs/x.md (or docs//x.md) vs --targets docs/x.md does NOT refuse — the normalized set difference is empty', (t) => {
  const stage = 'd2-normalization-non-refusal';
  const repo = driverFixture(t, {
    targets: ['docs/a6-deliverable.md'],
    brief: 'docs/a6-brief.md',
    briefText: [
      '# A6 brief',
      '',
      '## Deliverables',
      '',
      '- ./docs/a6-deliverable.md',
      '',
    ].join('\n'),
  });
  const r = runDriver(repo, ['--role', 'lv-a6', '--brief', 'docs/a6-brief.md', '--targets', 'docs/a6-deliverable.md']);
  const out = driverOut(r);
  assert.notEqual(r.status, 2,
    `stage[${stage}]: a normalized-equal deliverable (./docs/a6-deliverable.md) and target (docs/a6-deliverable.md) must NOT refuse — a raw-string set-difference would false-refuse (D2-H2); at HEAD no predicate exists to misfire, so this GREEN guard binds the implementation`);
  assert.ok(!/deliverables_uncovered/u.test(out),
    `stage[${stage}]: no deliverables_uncovered token may appear for a covered pair`);
});

// ---------------------------------------------------------------------------
// P2 — GREEN guard: the landed containment admission (the D3 substrate).
// ---------------------------------------------------------------------------

test('P2 (stage[d1b-containment-guard]): a harvest.paths containment escape still refuses workflow_harvest_invalid at admission', async (t) => {
  const stage = 'd1b-containment-guard';
  const fx = await lvFixture(t);
  const spec = lvSpec({
    idempotencyKey: 'lv-p2',
    members: [lvMember('lv-p2')],
    harvest: { paths: ['../outside.md'] },
  });
  writeObjective(fx.repo, 'lv-p2', '# lv-p2 objective\n\nDeliver the report.\n');
  const result = await captureError(() => driveLane(fx.baton, stage, spec));
  assert.equal(result?.error?.code, 'workflow_harvest_invalid',
    `stage[${stage}]: the landed containment admission (assertHarvestContained, workflow-interpreter.mjs:320-327) must refuse a ../ escape — the D3 substrate the new file-shape/coverage axes join (must stay GREEN)`);
  assert.match(result?.error?.message ?? '', /outside\.md/u,
    `stage[${stage}]: the refusal names the escaping path`);
});

// ---------------------------------------------------------------------------
// E1 — GREEN static pin: the verified driver exit-code map.
// ---------------------------------------------------------------------------

test('E1 (stage[exit-code-map]): the driver exit-code map holds — exit 2 for argument refusals, exit 1 ONLY for start-refused, verdicts receipt-carried', () => {
  const stage = 'exit-code-map';
  const source = readFileSync(driverPath, 'utf8');
  assert.match(source, /process\.exit\(2\)/u,
    `stage[${stage}]: the driver refuses launch/argument classes with exit 2 (the usage/brief/objective refusals)`);
  assert.match(source, /process\.exitCode\s*=\s*1/u,
    `stage[${stage}]: exit 1 is set ONLY for start-refused (the no-run-returned-at-admission branch)`);
  const verdictIdx = source.lastIndexOf('receipts.verdict =');
  assert.ok(verdictIdx >= 0, `stage[${stage}]: the driver assigns receipt verdicts`);
  const tail = source.slice(verdictIdx);
  assert.ok(!tail.includes('process.exit'),
    `stage[${stage}]: no exit-code assignment follows the receipt verdicts — -FAILED/-DRAINED/-INCOMPLETE harvests are receipt-carried with process exit 0 (the contract's verified map, red-team C1)`);
});

// ---------------------------------------------------------------------------
// MCP wire helpers (workflow-as-data-red:1540-1578, verbatim).
// ---------------------------------------------------------------------------

function mockPrincipal(overrides = {}) {
  return {
    userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe', 'approve', 'emergency_stop'],
    // F16: a fixed far-future expiry (no wall-clock TTL) — the principal can never lapse mid-test.
    repoIds: [REPO], expiresAt: FAR_FUTURE_ISO, revoked: false, ...overrides,
  };
}

async function realServer(fx, principal) {
  const server = new McpFleetServer({
    coordinator: fx.driver.coordinator,
    coordination: fx.driver.coordination,
    application: fx.application,
    surface: 'application',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal,
    // F16: a fixed far-future clock (no real Date.now) — the server's TTL checks are deterministic.
    repoIds: [REPO], now: () => FAR_FUTURE_MS, maxWaitMs: 25000, maxMessageBytes: 256 * 1024,
    takeToolQuota: async () => ({ ok: true }),
  });
  return server;
}

const wireRequest = (server, id, method, params) => server.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
async function initialized(server) {
  const response = await wireRequest(server, 1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
}
const wireCall = (server, id, name, args) => wireRequest(server, id, 'tools/call', { name, arguments: args });

// ---------------------------------------------------------------------------
// Web envelope helpers (phase12-web-northbound:13-54, verbatim shape).
// ---------------------------------------------------------------------------

function webPrincipal(overrides = {}) {
  return {
    userId: 'lv-web', sessionId: 'session-lv-web', credentialId: 'cred-lv-web', authMethod: 'cookie',
    csrfToken: 'csrf-lv', expiresAt: FAR_FUTURE_ISO, revoked: false,
    capabilities: ['control', 'observe', 'approve', 'emergency_stop', 'adopt_result', 'review', 'integrate_result'],
    repoIds: [REPO], ...overrides,
  };
}

function webContext(overrides = {}) {
  return {
    principal: webPrincipal(), origin: 'https://control.example.test', csrfToken: 'csrf-lv',
    remoteAddress: '127.0.0.1', transport: 'https', ...overrides,
  };
}

function webEnvelope(overrides = {}) {
  return {
    schemaVersion: 1,
    commandId: 'lv-web-cmd-1',
    idempotencyKey: 'lv-web-1',
    command: 'waves_run',
    args: { specPath: 'specs/a5-web.json' },
    repoId: REPO,
    runId: 'run-lv-web',
    origin: 'https://control.example.test',
    ...overrides,
  };
}
