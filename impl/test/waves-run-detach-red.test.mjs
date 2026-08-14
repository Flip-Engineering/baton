// waves-run-detach-red.test.mjs — red-first pin for #173: waves.run DETACHES at the bus.
//
// Defect (live, 2026-08-14 — the flood-window starvation): waves.run held its command for the
// wave's whole lifetime. The command loop is serial; two live drives wedged the bus for every
// other launch — measured: zero admissions across 43 attempts × 7 persistent launchers over 60
// minutes on resident v17, with the loop otherwise healthy. Launches vanished because the
// launch VERB never returns.
//
// The fix: the interpreter's drive-to-settle leg is a continuation. The bus (application's
// waves.run) detaches by default: the caller gets the closed acceptance receipt
// {accepted, manifestDigest, members, schemaVersion, verdict:'WAVE-ADMITTED', waveId}
// synchronously; the drive runs untethered; the settlement receipt (the D6 seven-key shape)
// mints as a driver.recorded 'wave.settled' event, idempotency-keyed on the waveId. A caller
// that needs the synchronous receipt passes detach:false (the suite path).
//
// Suite law: hermetic (mkdtemp fixture, MockAdapter) · no clocks as controls (the settlement
// read polls the store with the suite watchdog, never a wall-cap assertion) · sorted-key
// literals ACTUAL order · localeCompare banned.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { createDriver } from '../src/index.mjs';

const REPO = 'repo-waves-run-detach';
const LANE_DRIVER = Object.freeze({ pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: 30_000 });
const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-wrd-${label}-`));
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

async function fixture(t, key) {
  const repo = root(`${key}-repo`);
  const logDir = root(`${key}-log`);
  mkdirSync(join(repo, 'reports'), { recursive: true });
  mkdirSync(join(repo, 'objectives'), { recursive: true });
  writeFileSync(join(repo, 'objectives', 'coordinator.md'), 'write the coordinator report\n(marker:coordinator)\n');
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: {
      mock: new MockAdapter({
        harness: 'mock',
        scenariosByMarker: {
          coordinator: { outcome: 'completed', carryAttemptMarker: true, edits: [{ path: 'reports/coordinator.md', content: 'coordinator report\n' }] },
        },
      }),
    },
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
      planner: principalOf('wrd-planner'),
      dispatcher: principalOf('wrd-dispatcher'),
      observer: principalOf('wrd-observer'),
    },
    authorize: async () => true,
  });
  await application.ready;
  t.after(async () => {
    try { await application.shutdown(principalOf('wrd-cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, driver };
}

function spec(key) {
  return {
    schemaVersion: 1,
    idempotencyKey: key,
    members: [{
      role: 'coordinator',
      exact: { ...ROUTE },
      scope: ['reports/**'],
      objectiveRef: 'objectives/coordinator.md',
      report: 'reports/coordinator.md',
    }],
    steering: {},
    harvest: { paths: [] },
  };
}

test('DR-1 (stage[detach-acceptance-missing]): waves.run at the bus returns the closed acceptance receipt — never the settlement — synchronously', async (t) => {
  const { application } = await fixture(t, 'dr1');
  const acceptance = await application.command('waves.run', { spec: spec('detach-dr1'), driver: LANE_DRIVER }, principalOf('wrd-owner'));
  assert.ok(acceptance && typeof acceptance === 'object', 'an answer');
  assert.equal(acceptance.accepted, true, 'stage[detach-acceptance-missing]: the acceptance flag');
  assert.equal(acceptance.verdict, 'WAVE-ADMITTED', 'stage[detach-acceptance-missing]: the admitted verdict, never a settle verdict');
  assert.ok(typeof acceptance.waveId === 'string' && acceptance.waveId.startsWith('wave:'), 'the waveId');
  assert.deepEqual([...acceptance.members].sort(), ['coordinator'], 'the roster by role');
  assert.equal(typeof acceptance.manifestDigest, 'string', 'the manifest digest');
  for (const settlementKey of ['basis', 'harvest', 'outcomes', 'steering']) {
    assert.equal(acceptance[settlementKey], undefined,
      `stage[detach-acceptance-missing]: the acceptance carries no settlement key (${settlementKey}) — the wave has not driven yet`);
  }
});

test('DR-2 (stage[settle-record-missing]): the detached drive mints wave.settled with the D6 seven-key receipt, keyed on the waveId', async (t) => {
  const { application, driver } = await fixture(t, 'dr2');
  const acceptance = await application.command('waves.run', { spec: spec('detach-dr2'), driver: LANE_DRIVER }, principalOf('wrd-owner'));
  assert.equal(acceptance.verdict, 'WAVE-ADMITTED', 'the admission landed first');
  const deadline = Date.now() + 300_000; // suite-internal polling bound, not a control
  let settled = null;
  while (Date.now() < deadline && !settled) {
    settled = driver.coordination.eventsView().find((event) => event.kind === 'driver.recorded'
      && event.payload?.kind === 'wave.settled' && event.payload?.waveId === acceptance.waveId) ?? null;
    if (!settled) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(settled, 'stage[settle-record-missing]: wave.settled mints for the detached drive — the settlement must land in the store, never ride a held connection');
  const receipt = settled.payload.receipt;
  assert.ok(receipt, 'the receipt payload');
  assert.deepEqual(Object.keys(receipt).sort(), ['basis', 'harvest', 'manifestDigest', 'outcomes', 'steering', 'verdict', 'waveId'],
    'the D6 seven-key receipt shape, sorted');
  assert.equal(receipt.verdict, 'WAVE-OK', 'the mock member completes and harvests clean');
  assert.equal(receipt.waveId, acceptance.waveId, 'keyed on the wave');
});

test('DR-3 (pin): detach:false preserves the synchronous seven-key receipt (the suite/driver path is undisturbed)', async (t) => {
  const { application } = await fixture(t, 'dr3');
  const receipt = await application.command('waves.run', { spec: spec('detach-dr3'), driver: LANE_DRIVER, detach: false }, principalOf('wrd-owner'));
  assert.deepEqual(Object.keys(receipt).sort(), ['basis', 'harvest', 'manifestDigest', 'outcomes', 'steering', 'verdict', 'waveId'],
    'the synchronous path keeps the D6 shape');
  assert.equal(receipt.verdict, 'WAVE-OK', 'the synchronous drive completes');
});
