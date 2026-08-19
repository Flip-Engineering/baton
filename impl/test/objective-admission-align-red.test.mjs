// objective-admission-align-red.test.mjs — red-first pin for #207 (row-admission-align): wave
// admission refuses what members cannot start.
//
// Defect (live at the pre-change head): the interpreter admits a spec whose objectiveRef brief
// renders beyond the run.start objective cap — runWorkflow returns a settle receipt and the wave
// starts, then EVERY member phantom-fails AT START (terminalCause:'start' with the embedded
// client's typed refusal: the nonempty byte wall, application-client.mjs:11-13, throws
// application_client_invalid "Run objective is required" at the same 4096 bytes; the
// registry-declared refusal code for the byte law is spill_body_exceeded, limits.mjs run.objective).
// Admission must fail LOUD at the seam instead — never a per-member phantom failure.
//
// Contract (row brief, closed): an objectiveRef brief whose RENDERED objective exceeds the
// run.objective cap (4096 bytes, limits.mjs — never changed here) refuses at compile/admission
// with a typed workflow_spec_invalid-class refusal naming BOTH byte counts (the measured rendered
// bytes and the cap). The 64 KiB D5 read envelope (OBJECTIVE_REF_MAX_BYTES) stays the
// read/containment bound — the interpreter does NOT split, so the run cap is the admission bound
// (judgment call, recorded in docs/reference/evidence/phantom-root-2026-08-15/wave-g/
// notes-row-admission-align.md).
//
// Suite law: hermetic (mkdtemp fixture, plain MockAdapter with the SINGULAR scenario config —
// adapter.mjs:231,323 — the run genuinely completes) · real createDriver stack · driven through
// the bus-level shipped surface (`application.command('waves.run', ...)`, the exact seam the
// CLI/MCP/embedded facades ride) · red-first: AA-1/AA-2b/AA-3b are RED at the pre-change head
// (they return a settle receipt carrying the phantom start failures instead of refusing);
// AA-2a/AA-3a are green guards pinning the machinery boundary (createWave admits an
// exactly-at-cap rendered objective) and the unchanged D5 envelope. The salt line the
// interpreter prepends (`[attempt: <uuid> <role>] `, renderObjective) is a fixed 36-char UUID, so
// the expected rendered byte count is deterministic: briefBytes + 49 + role.length.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { bindBaton, createDriver, createWave } from '../src/index.mjs';

const REPO = 'repo-objective-admission-align';
const RUN_OBJECTIVE_CAP = FRAME_LIMITS['run.objective'].value; // 4096 bytes — the run.start cap (never changed here)
const LANE_DRIVER = Object.freeze({ pollIntervalMs: 15, stallTimeoutMs: 400 });
const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });
const ROLE = 'row1';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-aa-${label}-`));
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
  routes: [ROUTE],
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

async function fixture(t, key, { briefBytes, briefFile = 'objectives/brief.md' } = {}) {
  const repo = root(`${key}-repo`);
  const logDir = root(`${key}-log`);
  mkdirSync(join(repo, 'reports'), { recursive: true });
  mkdirSync(join(repo, 'objectives'), { recursive: true });
  if (briefBytes !== undefined) writeFileSync(join(repo, briefFile), 'x'.repeat(briefBytes));
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: {
      // The plain MockAdapter reads the SINGULAR `scenario` config (adapter.mjs:231,323) — a
      // `scenariosByMarker` map is a TrackingMarkerAdapter feature and would leave the member
      // without a turn (the run never dispatches). The edit makes the member genuinely complete.
      mock: new MockAdapter({
        harness: 'mock',
        scenario: {
          outcome: 'completed',
          edits: [{ path: 'reports/row1.md', content: 'row1 report\n' }],
        },
      }),
    },
    stopDeadlineMs: 2_000,
    // Suite law: the stall watchdog is a valid positive integer in every fixture — pinned, never the default.
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
  });
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('aa-planner'),
      dispatcher: principalOf('aa-dispatcher'),
      observer: principalOf('aa-observer'),
    },
    authorize: async () => true,
  });
  await application.ready;
  const baton = bindBaton(application, principalOf('aa-owner'));
  t.after(async () => {
    try { await application.shutdown(principalOf('aa-cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, repo, createWave: (options) => createWave(baton, options) };
}

function spec(key, { ref = 'objectives/brief.md' } = {}) {
  return {
    schemaVersion: 1,
    idempotencyKey: key,
    members: [{
      role: ROLE,
      exact: { ...ROUTE },
      scope: ['reports/**'],
      objectiveRef: ref,
      report: 'reports/row1.md',
    }],
    steering: {},
    harvest: { paths: [] },
  };
}

// The interpreter's salt line overhead — `[attempt: <36-char-uuid> <role>] ` (renderObjective):
// deterministic, because the interpreter mints the salt with randomUUID() (always 36 chars).
function saltOverhead(role = ROLE) {
  return Buffer.byteLength(`[attempt: ${'u'.repeat(36)} ${role}] `);
}

function renderedBytes(briefBytes, role = ROLE) {
  return briefBytes + saltOverhead(role);
}

async function capture(fn) {
  try {
    const value = await fn();
    return { value };
  } catch (error) {
    return { error };
  }
}

// AA-1 (RED stage[admission-refusal-missing]): briefs inside the 64 KiB D5 envelope but above the
// 4096 run cap refuse AT ADMISSION with workflow_spec_invalid naming both byte counts — never a
// settle receipt whose member phantom-fails at start (the pre-change head admits, then every
// member dies terminalCause:'start'). Two mid-range sizes span the contract's 4-64 KiB band.
for (const briefBytes of [5 * 1024, 8 * 1024]) {
  test(`AA-1 (stage[admission-refusal-missing]): a ${briefBytes / 1024} KiB objectiveRef brief refuses at admission naming both byte counts — workflow_spec_invalid, never a per-member phantom start failure`, async (t) => {
    const fx = await fixture(t, `aa1-${briefBytes}`, { briefBytes });
    const result = await capture(() => fx.application.command(
      'waves.run', { spec: spec('aa-admission'), driver: LANE_DRIVER, detach: false }, principalOf('aa-owner'),
    ));
    assert.ok(result.error,
      'stage[admission-refusal-missing]: the over-cap brief must REJECT at admission — the pre-change head returns a settle receipt instead (RED)');
    assert.equal(result.error?.code, 'workflow_spec_invalid',
      'stage[admission-refusal-missing]: the refusal is in the workflow_spec_invalid class — never the machinery\'s per-member start code');
    const message = String(result.error?.message ?? '');
    const match = /renders to (\d+) bytes \(cap (\d+)/u.exec(message);
    assert.ok(match, 'the refusal names BOTH byte counts: the measured rendered bytes and the cap');
    assert.equal(Number(match[1]), renderedBytes(briefBytes),
      `the measured byte count is the RENDERED objective (${renderedBytes(briefBytes)}), what the run machinery would admit — not the raw brief bytes (${briefBytes})`);
    assert.equal(Number(match[2]), RUN_OBJECTIVE_CAP, 'the named cap is the run.objective cap');
    assert.ok(message.includes(ROLE) && message.includes('objectives/brief.md'),
      'the refusal names the member role and the objectiveRef');
  });
}

// AA-2a (green guard, machinery boundary): a RENDERED objective at EXACTLY the run cap (4096
// bytes) is admitted by the machinery — createWave starts the member with no phantom. The
// alignment is exact: the interpreter's admission check and the run.start acceptance measure the
// same rendered bytes, so the boundary is never an off-by-overhead false positive. Driven through
// createWave directly (wave.mjs — the same seam waves.start rides) so the pin is fast and
// precise; the interpreter-side boundary is pinned by AA-2b (cap+1 refuses).
test('AA-2a (green guard): the machinery admits a rendered objective of exactly the run.objective cap (4096 bytes) — no phantom member', async (t) => {
  const fx = await fixture(t, 'aa2a');
  const objective = `[attempt: ${'u'.repeat(36)} ${ROLE}] ${'x'.repeat(RUN_OBJECTIVE_CAP - saltOverhead())}`;
  assert.equal(Buffer.byteLength(objective), RUN_OBJECTIVE_CAP, 'the boundary objective is exactly the cap');
  const wave = await fx.createWave({
    members: [{ role: ROLE, objective, exact: { ...ROUTE }, scope: ['reports/**'] }],
    idempotencyKey: 'aa-boundary',
    approve: true,
    repoRoot: fx.repo,
  });
  assert.ok(wave.runs.has(ROLE),
    'green guard: the machinery starts an exactly-at-cap objective — the alignment is exact, no off-by-overhead false refusal');
  const view = await wave.runs.get(ROLE).status();
  assert.ok(view && typeof view === 'object', 'the boundary member run is live');
});

// AA-2b (boundary +1): one byte over the boundary renders to 4097 and refuses — the refusal is
// measured on the RENDERED objective, exactly where run.start would.
test('AA-2b (RED stage[admission-refusal-missing]): a brief rendering to cap+1 refuses at admission naming 4097 bytes', async (t) => {
  const briefBytes = RUN_OBJECTIVE_CAP - saltOverhead() + 1;
  assert.equal(renderedBytes(briefBytes), RUN_OBJECTIVE_CAP + 1, 'the boundary+1 brief renders to cap+1');
  const fx = await fixture(t, 'aa2b', { briefBytes });
  const result = await capture(() => fx.application.command(
    'waves.run', { spec: spec('aa-boundary-plus'), driver: LANE_DRIVER, detach: false }, principalOf('aa-owner'),
  ));
  assert.ok(result.error, 'stage[admission-refusal-missing]: cap+1 must reject at admission (RED at the pre-change head)');
  assert.equal(result.error?.code, 'workflow_spec_invalid', 'the typed workflow_spec_invalid-class refusal');
  const match = /renders to (\d+) bytes \(cap (\d+)/u.exec(String(result.error?.message ?? ''));
  assert.ok(match, 'the refusal names both byte counts');
  assert.equal(Number(match[1]), RUN_OBJECTIVE_CAP + 1, 'the measured count is the rendered cap+1');
  assert.equal(Number(match[2]), RUN_OBJECTIVE_CAP, 'the named cap is the run.objective cap');
});

// AA-3a (green guard, envelope pin): the D5 read envelope is UNCHANGED — 64 KiB + 1 still refuses
// workflow_objective_ref_invalid (the W1-03/F8b exact-value pin), never the admission refusal.
test('AA-3a (green guard): the 64 KiB D5 envelope is unchanged — 64 KiB + 1 refuses workflow_objective_ref_invalid', async (t) => {
  const fx = await fixture(t, 'aa3a', { briefBytes: 64 * 1024 + 1 });
  const result = await capture(() => fx.application.command(
    'waves.run', { spec: spec('aa-envelope-plus'), driver: LANE_DRIVER, detach: false }, principalOf('aa-owner'),
  ));
  assert.ok(result.error, '64 KiB + 1 refuses');
  assert.equal(result.error?.code, 'workflow_objective_ref_invalid',
    'the objectiveRef envelope refusal is unchanged — the interpreter reads at most 64 KiB (D5/F8b)');
});

// AA-3b (RED stage[admission-refusal-missing]): a brief AT the envelope top (64 KiB) is READ (the
// envelope admits) but renders beyond the run cap — the admission refusal names the rendered bytes.
// This pins the judgment call: the envelope is the read/containment bound; the run cap is the
// admission bound; the interpreter does NOT split.
test('AA-3b (stage[admission-refusal-missing]): a 64 KiB brief (envelope top) refuses at admission with workflow_spec_invalid naming the rendered bytes — the envelope is read, the run cap governs admission', async (t) => {
  const briefBytes = 64 * 1024;
  const fx = await fixture(t, 'aa3b', { briefBytes });
  const result = await capture(() => fx.application.command(
    'waves.run', { spec: spec('aa-envelope-top'), driver: LANE_DRIVER, detach: false }, principalOf('aa-owner'),
  ));
  assert.ok(result.error, 'stage[admission-refusal-missing]: the envelope-top brief must REJECT at admission (RED at the pre-change head)');
  assert.equal(result.error?.code, 'workflow_spec_invalid',
    'the run-cap admission refusal, not the envelope refusal — the 64 KiB brief IS read');
  const match = /renders to (\d+) bytes \(cap (\d+)/u.exec(String(result.error?.message ?? ''));
  assert.ok(match, 'the refusal names both byte counts');
  assert.equal(Number(match[1]), renderedBytes(briefBytes), 'the measured count is the rendered 64 KiB objective');
  assert.equal(Number(match[2]), RUN_OBJECTIVE_CAP, 'the named cap is the run.objective cap');
});
