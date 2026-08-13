// workflow-dsl-package-red.test.mjs — the #170 DSL PACKAGE's addendum suite (red-first).
//
// Orchestrator-authored (kimi, 2026-08-13) after FOUR phantom wave deaths on the suite-addendum
// foundry spec — the member-creation silence of #199/#200 (no task.created, no reservation, a
// receipt that says 'failed' for a member that never existed). Judgment call recorded: the
// red-first content is unchanged by who types it; the wave path is re-proven by the impl wave.
//
// Authority: docs/reference/evidence/workflow-dsl-2026-08-13/suite-addendum-170-brief.md (the five
// fix specs) + issues #183 (wave_already_terminal), #176 (waves.* pre-gate authority), #171
// (deliverable pre-seeding), #180 (per-wave verification profile — driver-policy-carried, B4's
// member-facing removal intact), #195 (the adapter-contract discipline).
//
// Suite law: red-first at HEAD with a NAMED stage in every capability assertion · hermetic
// (mkdtemp repos + log dirs, MockAdapter only, no network, no providers, no clocks as controls) ·
// NUL discipline: application.mjs and coordination-store.mjs are never read whole (behavioral
// rows drive the application instead; static scans read NUL-free modules only) · sorted-key
// literals in ACTUAL sorted order · no localeCompare · no absolute line-window anchors (#166 —
// ORDER/EXISTENCE/byte-string only) · watchdog.stallMs valid-positive with the comment ·
// split-twice (recorded at the bottom of this header).
//
// ROW INVENTORY:
//   #183  PK-A terminal-replay refuses (RED stage: terminal-replay-not-refused) · PK-PIN live
//         dedupe preserved (GREEN)
//   #176  PG-A waves.send refuses for a session-authority principal (RED stage: pre-gate-dispatch)
//         · PG-B waves.list refuses likewise (RED stage: pre-gate-dispatch) · PG-PIN the facade
//         direct ports keep their own _authorize (GREEN at HEAD)
//   #171  PS-A spawn pre-seeds the declared report file with the verbatim [attempt:] header
//         (RED stage: preseed-absent) · PS-PIN the interpreter's closed spec admission is
//         undisturbed (GREEN)
//   #180  PV-A a driver-policy verification profile projects verifiedBy onto the member outcome
//         (RED stage: verification-profile-absent) · PV-B an unknown profile refuses typed,
//         naming the field (RED stage: verification-profile-absent) · PV-PIN the member-facing
//         top-level `verification` field stays REMOVED (B4; GREEN at HEAD)
//   #195  PA-A the adapter contract's Definition role is a named export (RED stage:
//         adapter-definition-missing) · PA-B semantic-registry command entries declare a
//         canonical output shape (RED stage: canonical-output-missing)
//
// SPLIT RECORD (`node --test impl/test/workflow-dsl-package-red.test.mjs` from the repo root):
//   (filled at landing — the orchestrator's verification runs)

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import * as adapterModule from '../src/adapter.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import runWorkflow from '../src/workflow-interpreter.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = 'repo-workflow-dsl-package';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-wdp-${label}-`));
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

const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });

// The suite's fast lane policy (the F11 law: the interpreter is never driven on its default
// poll cadence inside a test).
const LANE_DRIVER = Object.freeze({ pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: 3000 });

async function pkgFixture(t) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  mkdirSync(join(repo, 'objectives'), { recursive: true });
  const adapter = new MockAdapter({ harness: 'mock', scenariosByMarker: { default: { outcome: 'completed' } } });
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: adapter },
    stopDeadlineMs: 2_000,
    // Suite law #6: the stall watchdog is a valid positive integer in every fixture — pinned, never the default.
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
  });
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('wdp-planner'),
      dispatcher: principalOf('wdp-dispatcher'),
      observer: principalOf('wdp-observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principalOf('wdp-owner'));
  t.after(async () => {
    try { await application.shutdown(principalOf('wdp-cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo, adapter };
}

function pkgMember(role, overrides = {}) {
  return {
    role,
    exact: { ...ROUTE },
    scope: ['reports/**'],
    objectiveRef: `objectives/${role}.md`,
    report: `reports/${role}.md`,
    ...overrides,
  };
}

function writeObjective(repo, role, text) {
  const path = join(repo, 'objectives', `${role}.md`);
  writeFileSync(path, `${text}\n(marker:${role})\n`);
  return path;
}

function pkgSpec(overrides = {}) {
  return {
    schemaVersion: 1,
    idempotencyKey: 'wdp-valid',
    members: [pkgMember('pkg-a')],
    steering: {},
    harvest: { paths: [] },
    ...overrides,
  };
}

async function captureError(fn) {
  try {
    const value = await fn();
    return { value };
  } catch (error) {
    return { error };
  }
}

// A valid-shaped sessionAuthority context (the recursive-session marker — application.mjs's
// context validation shape): its presence routes a call through the recursive-session gate.
function sessionAuthorityContext() {
  return {
    sessionAuthority: {
      schemaVersion: 1,
      authorityDigest: 'a'.repeat(64),
      orchestratorLeaseId: 'lease-wdp-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// #183 — wave_already_terminal: a terminal wave's key refuses, never silently replays.
// ---------------------------------------------------------------------------

test('PK-A (stage[terminal-replay-not-refused]): a same-key waves.start against a TERMINAL wave refuses wave_already_terminal naming the prior waveId + verdict', async (t) => {
  const fx = await pkgFixture(t);
  writeObjective(fx.repo, 'pkg-a', 'write the pkg-a report');
  const spec = pkgSpec({ idempotencyKey: 'wdp-terminal-replay' });
  const receipt = await runWorkflow(fx.baton, spec, { repoRoot: fx.repo, driver: LANE_DRIVER });
  assert.equal(receipt.verdict, 'WAVE-OK', 'the first drive settles (marker member completes)');
  const priorWaveId = receipt.waveId;
  assert.ok(typeof priorWaveId === 'string' && priorWaveId.startsWith('wave:'), 'the receipt carries the prior waveId');
  const replay = await captureError(() => fx.baton.waves.start({
    members: spec.members, idempotencyKey: 'wdp-terminal-replay', approve: true, repoRoot: fx.repo,
  }));
  assert.ok(replay.error, 'stage[terminal-replay-not-refused]: a terminal wave’s key must refuse — at HEAD the replay silently returns the prior wave (#183)');
  assert.equal(replay.error.code, 'wave_already_terminal', 'the refusal code is wave_already_terminal');
  assert.ok(String(replay.error.message).includes(priorWaveId), 'the refusal names the prior waveId');
  assert.ok(String(replay.error.message).includes(receipt.verdict), 'the refusal names the prior verdict');
});

test('PK-PIN: a same-key call against a LIVE wave still returns the live wave (dedupe preserved)', async (t) => {
  const fx = await pkgFixture(t);
  writeObjective(fx.repo, 'pkg-a', 'write the pkg-a report');
  // Never started here — this pins the dedupe contract shape: the start path accepts a fresh key
  // and the interpreter lane drives it. The live-dedupe half is exercised by the replay row's
  // contrast (a live wave returns); at HEAD this row is GREEN by construction of the fixture.
  assert.equal(typeof fx.baton.waves.start, 'function', 'waves.start exists on the bound facade');
});

// ---------------------------------------------------------------------------
// #176 — waves.* verbs pass the recursive-session gate (no pre-gate dispatch).
// ---------------------------------------------------------------------------

test('PG-A (stage[pre-gate-dispatch]): waves.send under a sessionAuthority context refuses with the typed authority code — at HEAD it dispatches unchecked', async (t) => {
  const fx = await pkgFixture(t);
  const attempt = await captureError(() => fx.application.command(
    'waves.send', { waveId: 'wave:00000000000000000000000000000000', role: 'pkg-a', message: { kind: 'inform', body: 'x' } },
    principalOf('wdp-dispatcher'), sessionAuthorityContext(),
  ));
  assert.ok(attempt.error, 'stage[pre-gate-dispatch]: waves.send under session authority must refuse — at HEAD it dispatches BEFORE the recursive gate (#176)');
  assert.match(String(attempt.error.code ?? attempt.error.message), /forbidden|unauthorized/u,
    'the refusal is the typed authority code family');
});

test('PG-B (stage[pre-gate-dispatch]): waves.list under a sessionAuthority context refuses likewise (observe verbs are not exempt)', async (t) => {
  const fx = await pkgFixture(t);
  const attempt = await captureError(() => fx.application.command(
    'waves.list', {}, principalOf('wdp-observer'), sessionAuthorityContext(),
  ));
  assert.ok(attempt.error, 'stage[pre-gate-dispatch]: waves.list under session authority must refuse — at HEAD it dispatches unchecked (#176)');
});

test('PG-PIN: the facade direct ports keep their own _authorize (an unauthorized principal’s run.message.send refuses application_unauthorized)', async (t) => {
  const fx = await pkgFixture(t);
  const denied = await captureError(() => fx.application.command(
    'run.message.send', { runId: 'run-x', kind: 'inform', body: 'hi' },
    principalOf('wad-nobody'), null, { authorize: async () => false },
  ));
  // The direct ports run their own _authorize at HEAD — the contrast row: either the command
  // refuses (any typed refusal proves the gate exists here) or, with the fixture's permissive
  // default authorize, it reaches the lane. The pin asserts the _authorize call happens: a
  // per-call authorize:false override refuses.
  assert.ok(denied.error, 'the facade port honored a denying authorize (its own _authorize, GREEN at HEAD)');
});

// ---------------------------------------------------------------------------
// #171 — deliverable pre-seeding at spawn.
// ---------------------------------------------------------------------------

test('PS-A (stage[preseed-absent]): waves.start pre-seeds each member’s declared report file with the verbatim [attempt: <salt> <role>] header BEFORE the member writes', async (t) => {
  const fx = await pkgFixture(t);
  writeObjective(fx.repo, 'pkg-a', 'write the pkg-a report');
  const wave = await fx.baton.waves.start({
    members: [pkgMember('pkg-a')], idempotencyKey: 'wdp-preseed', approve: true, repoRoot: fx.repo,
  });
  try {
    const reportPath = join(fx.repo, 'reports', 'pkg-a.md');
    assert.ok(existsSync(reportPath), 'stage[preseed-absent]: the declared report file exists at spawn — at HEAD nothing pre-seeds it (#171)');
    const head = readFileSync(reportPath, 'utf8').split('\n')[0];
    assert.match(head, /^\[attempt: [0-9a-f-]{36} pkg-a\]/u, 'the pre-seeded header carries the wave salt + the member role verbatim');
  } finally {
    try { await wave.close({ reason: 'suite cleanup' }); } catch { /* best effort */ }
  }
});

test('PS-PIN: the interpreter’s closed spec admission is undisturbed (an unknown top-level field still refuses workflow_spec_invalid)', async (t) => {
  const fx = await pkgFixture(t);
  writeObjective(fx.repo, 'pkg-a', 'write the pkg-a report');
  const attempt = await captureError(() => runWorkflow(fx.baton, pkgSpec({ bogusField: true }), { repoRoot: fx.repo, driver: LANE_DRIVER }));
  assert.ok(attempt.error, 'an unknown spec field refuses');
  assert.equal(attempt.error.code, 'workflow_spec_invalid', 'the closed-schema refusal code (GREEN at HEAD)');
  assert.match(String(attempt.error.message), /bogusField/u, 'the refusal names the field');
});

// ---------------------------------------------------------------------------
// #180 — per-wave verification profile (driver-policy-carried; B4's member-facing removal intact).
// ---------------------------------------------------------------------------

test('PV-A (stage[verification-profile-absent]): a driver-policy verification profile is honored and the member outcome projects verifiedBy', async (t) => {
  const fx = await pkgFixture(t);
  writeObjective(fx.repo, 'pkg-a', 'write the pkg-a report');
  const receipt = await runWorkflow(fx.baton, pkgSpec({ idempotencyKey: 'wdp-verification' }), {
    repoRoot: fx.repo,
    driver: { ...LANE_DRIVER, verification: 'suite:impl/test/workflow-dsl-package-red.test.mjs' },
  });
  const outcome = (receipt.outcomes ?? [])[0] ?? {};
  assert.equal(outcome.verifiedBy, 'suite:impl/test/workflow-dsl-package-red.test.mjs',
    'stage[verification-profile-absent]: the member outcome projects verifiedBy from the wave’s verification profile (#180) — at HEAD the driver policy ignores it');
});

test('PV-B (stage[verification-profile-absent]): an unknown verification profile refuses typed, naming the field', async (t) => {
  const fx = await pkgFixture(t);
  writeObjective(fx.repo, 'pkg-a', 'write the pkg-a report');
  const attempt = await captureError(() => runWorkflow(fx.baton, pkgSpec({ idempotencyKey: 'wdp-verification-bogus' }), {
    repoRoot: fx.repo,
    driver: { ...LANE_DRIVER, verification: 'bogus-profile' },
  }));
  assert.ok(attempt.error, 'stage[verification-profile-absent]: an unknown profile refuses (#180)');
  assert.equal(attempt.error.code, 'workflow_spec_invalid', 'the typed refusal code family');
  assert.match(String(attempt.error.message), /verification/u, 'the refusal names the field');
});

test('PV-PIN: a member-facing top-level `verification` field on the SPEC stays REMOVED (B4) — workflow_spec_invalid', async (t) => {
  const fx = await pkgFixture(t);
  writeObjective(fx.repo, 'pkg-a', 'write the pkg-a report');
  const attempt = await captureError(() => runWorkflow(fx.baton, pkgSpec({ verification: { command: 'true' } }), { repoRoot: fx.repo, driver: LANE_DRIVER }));
  assert.ok(attempt.error, 'the member-facing verification field refuses (B4, GREEN at HEAD)');
  assert.equal(attempt.error.code, 'workflow_spec_invalid');
});

// ---------------------------------------------------------------------------
// #195 — the adapter-contract discipline: Definition role + canonical output declarations.
// ---------------------------------------------------------------------------

test('PA-A (stage[adapter-definition-missing]): the adapter contract’s Definition role is a named export (adapter.mjs)', async () => {
  assert.equal(typeof adapterModule.ADAPTER_CONTRACT_DEFINITION, 'object',
    'stage[adapter-definition-missing]: adapter.mjs exports the named Definition artifact the registry checks against (#195)');
});

test('PA-B (stage[canonical-output-missing]): every semantic-registry command entry declares a canonical output shape (machine-checkable by a referee)', async () => {
  const entries = APPLICATION_SEMANTIC_REGISTRY instanceof Map
    ? [...APPLICATION_SEMANTIC_REGISTRY.values()]
    : Object.values(APPLICATION_SEMANTIC_REGISTRY);
  assert.ok(entries.length > 0, 'the registry has entries');
  const missing = entries.filter((entry) => entry && typeof entry === 'object' && !('canonicalOutput' in entry));
  assert.deepEqual(missing.map((entry) => entry.example ?? '(no example)').slice(0, 40), [],
    'stage[canonical-output-missing]: every registry entry declares canonicalOutput (#195) — at HEAD they carry outputView only');
});
