// event-log-read-scaling-red.test.mjs — red-first pin for the read-path full-log clone storm.
//
// Defect (live, 2026-08-14, bus starvation incident): `coordination.events()` returns
// `this._events.slice(...).map(clone)` — a DEEP CLONE of every event in range, per call
// (coordination-store.mjs). The application read paths (the workflow-view helpers
// _isWorkflowRun/_workflowDefinition/_workflowSelection/_workflowFeedback/_workflowMemberStops/
// _buildWorkflowEvidence/_progressTiming, the periodic reconcilers, the profile registry) call
// events() per helper per member per drive-poll. On an 87k-event ledger, two interpreter drives
// polling ten members kept the resident's event loop at ~97% CPU; /readyz starved past 15s and
// new command admissions were never even read (three wave launches lost with zero ledger trace).
//
// Events are frozen at append (load path + both runtime append paths), so read-only callers
// never need a clone. The fix: a clone-free `eventsView(fromSeq, limit)` accessor with
// events()'s exact bounds semantics, and the read-only application call sites switched to it.
//
// The pin is STRUCTURAL (no wall clocks): a spy counts cloning reads (events) vs view reads
// (eventsView) across the member-facing read surface. At HEAD eventsView does not exist and
// every read clones — RED at stage[events-view-missing] and stage[read-paths-full-clone].
//
// Suite law: hermetic (mkdtemp fixture, no network) · no clocks as controls · sorted-key
// literals ACTUAL order · watchdog.stallMs pinned · localeCompare banned.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { createDriver } from '../src/index.mjs';

const REPO = 'repo-event-log-read-scaling';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-elrs-${label}-`));
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

async function buildApp(t, label) {
  const repo = root(`${label}-repo`);
  const logDir = root(`${label}-log`);
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: new MockAdapter({ harness: 'mock', scenariosByMarker: { default: { outcome: 'completed' } } }) },
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
      planner: principalOf('elrs-planner'),
      dispatcher: principalOf('elrs-dispatcher'),
      observer: principalOf('elrs-observer'),
    },
    authorize: async () => true,
  });
  t.after(async () => {
    try { await application.shutdown(principalOf('elrs-cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, driver };
}

test('ELRS-1 (stage[events-view-missing]): the store exposes a clone-free eventsView with events() bounds parity and frozen, reference-stable elements', async (t) => {
  const { driver } = await buildApp(t, 'view');
  const coordination = driver.coordination;

  assert.equal(typeof coordination.eventsView, 'function',
    'stage[events-view-missing]: coordination.eventsView exists — events are frozen at append, so read-only callers never need the per-call deep clone events() performs');

  const all = coordination.events();
  assert.ok(all.length > 0, 'fixture ledger carries startup events to view');

  const viewAll = coordination.eventsView();
  assert.deepEqual(viewAll, all, 'eventsView() matches events() content exactly');
  const from = Math.max(1, all.length - 1);
  assert.deepEqual(coordination.eventsView(from, 1), coordination.events(from, 1),
    'eventsView honors fromSeq/limit identically');
  assert.deepEqual(coordination.eventsView(0), coordination.events(0),
    'bounds parity: a zero fromSeq clamps to the full range on both readers');
  assert.throws(() => coordination.eventsView(1, -2), TypeError, 'bounds validation parity (positive limit)');
  assert.throws(() => coordination.events(1, -2), TypeError, 'bounds validation parity (events baseline)');

  const first = coordination.eventsView();
  const second = coordination.eventsView();
  assert.ok(first[0] === second[0],
    'eventsView returns the store\'s frozen element references — no per-call re-clone (identity-stable across calls)');
  assert.ok(Object.isFrozen(first[0]), 'viewed events are frozen');
});

test('ELRS-2 (stage[read-paths-full-clone]): member-facing read commands perform zero cloning reads — every read-only path rides the frozen view', async (t) => {
  const { application, driver } = await buildApp(t, 'paths');
  const coordination = driver.coordination;

  let cloneReads = 0;
  let viewReads = 0;
  const realEvents = coordination.events.bind(coordination);
  coordination.events = (...args) => { cloneReads += 1; return realEvents(...args); };
  const realView = coordination.eventsView?.bind(coordination);
  if (realView) coordination.eventsView = (...args) => { viewReads += 1; return realView(...args); };

  const owner = principalOf('elrs-owner');
  await captureResult(() => application.command('waves.list', {}, owner));
  await captureResult(() => application.command('runs.list', {}, owner));
  await captureResult(() => application.command('run.view', { runId: 'run-absent' }, owner));

  assert.equal(cloneReads, 0,
    `stage[read-paths-full-clone]: the read surface performed ${cloneReads} full-log cloning reads — at HEAD every workflow-view helper and reconciler calls events() (a deep clone of the whole ledger per call); the frozen view serves them all`);
  assert.ok(viewReads > 0, 'the read surface actually exercised the view (spy saw traffic)');
});

async function captureResult(fn) {
  try { return { value: await fn() }; } catch (error) { return { error }; }
}
