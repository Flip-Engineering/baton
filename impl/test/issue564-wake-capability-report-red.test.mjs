// issue564-wake-capability-report-red.test.mjs — issue #564's capability report: the doctor (and
// the deployment summary a recruit reads) names, per harness this deployment can run, how a
// root-addressed wake starts a turn in an idle session — or that no channel exists.
//
// The delivery slice (impl/src/wake-delivery.mjs) owns the ONE closed per-harness capability
// table: claude-code carries `session-socket` and canStartTurn true, and codex, grok, kimi-code,
// muse and omp carry `none` with the channel that was checked named in their note. This slice
// reports those rows where a root reads them: `doctorReadiness().wakeDelivery` over the harnesses
// of this deployment's own routes, with an unknown harness reported as a row rather than omitted,
// and the deployment summary carrying the same rows when any harness of the deployment cannot
// start a turn (so a deployment whose every harness can be woken keeps its serialized shape).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication, MockAdapter, createDriver } from '../src/index.mjs';
import { HARNESS_WAKE_DELIVERY, harnessWakeCapabilityForHarnesses } from '../src/wake-delivery.mjs';

const tmpDir = () => mkdtempSync(join(tmpdir(), 'baton-564-capability-'));
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });

const PROFILE = (routes) => Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-564',
  definitionOfDone: ['deployment verification passes'],
  constraints: [],
  risk: 'low',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 20, providerTurns: 8 },
  nodeBudget: { tokens: 5_000, usd: 1, wallMin: 10, providerTurns: 4 },
  pathScope: ['**'],
  verification: {
    command: 'true', arguments: [], cwd: '.', envAllowlist: [],
    expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536,
    requiredPredecessorEvidence: [],
  },
  routes,
  capabilities: ['code', 'test'],
  effects: ['provider_call', 'repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

function appFixture(routes) {
  const repo = tmpDir();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'cap@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Cap Test'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapterFor = (harness, model) => {
    const adapter = new MockAdapter({ harness, scenario: { outcome: 'completed' } });
    const card = adapter.card.bind(adapter);
    adapter.card = () => ({
      ...card(),
      harness,
      modelSelection: {
        mode: 'exact', configuredDefault: model, available: [model], family: harness,
        acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['high','low'],
        serviceTier: null, provenance: 'issue564-capability-report', refreshedAt: null,
      },
    });
    return adapter;
  };
  const adapters = Object.fromEntries(routes.map((route) => [route.harness, adapterFor(route.harness, route.model)]));
  const driver = createDriver({
    repoRoot: repo, repoId: 'repo-564', logDir: tmpDir(), adapters,
  });
  const application = new BatonApplication({
    driver, repoId: 'repo-564', profiles: { default: PROFILE(routes) },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('plan'), dispatcher: principal('dispatch'), observer: principal('observe'),
    },
    authorize: async () => true,
  });
  return { application, driver, repo };
}

test('564-c1: the capability rows cover exactly the deployment harnesses, sorted, unknown named', () => {
  const rows = harnessWakeCapabilityForHarnesses(['codex', 'claude-code', 'claude-code', null, '']);
  assert.deepEqual(rows.map((row) => row.harness), ['claude-code', 'codex'],
    'duplicates collapse and non-string names are dropped, sorted by harness');
  const claude = rows.find((row) => row.harness === 'claude-code');
  assert.equal(claude.canStartTurn, true, 'the operator Claude session has a turn-starting channel');
  assert.equal(claude.mechanism, 'session-socket', 'and it is named');
  const codex = rows.find((row) => row.harness === 'codex');
  assert.equal(codex.canStartTurn, false, 'an idle codex session cannot be started by this deployment yet');
  assert.equal(codex.mechanism, 'none', 'and the row says so instead of staying silent');
  assert.equal(typeof codex.note, 'string', 'the note names the channel that was checked');
  const unknown = harnessWakeCapabilityForHarnesses(['mystery-harness']);
  assert.equal(unknown.length, 1, 'a harness the table does not know is REPORTED, never omitted');
  assert.equal(unknown[0].canStartTurn, false, 'and it can start no turn');
  assert.deepEqual(harnessWakeCapabilityForHarnesses([]), [], 'no routes, no rows');
});

test('564-c2: the doctor carries the capability rows of the harnesses this deployment can run', async (t) => {
  const { application, driver, repo } = appFixture([
    { harness: 'claude-code', model: 'claude-opus-4-6', effort: 'high' },
    { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
  ]);
  t.after(async () => {
    await application.shutdown(principal('shutdown')).catch(() => {});
    await driver.drainAndClose('564-capability').catch(() => {});
    rmSync(repo, { recursive: true, force: true });
  });
  const readiness = application.doctorReadiness();
  assert.ok(Array.isArray(readiness.wakeDelivery),
    'the doctor document carries the per-harness wake capability, so a root is never silently deaf');
  const rows = readiness.wakeDelivery;
  assert.deepEqual(rows.map((row) => row.harness), ['claude-code', 'codex'],
    'exactly the harnesses of this deployment routes, sorted');
  assert.deepEqual(rows.find((row) => row.harness === 'codex'),
    Object.freeze({ harness: 'codex', ...HARNESS_WAKE_DELIVERY.codex }),
    'the reported row is the delivery table own row, not a copy that can drift');
});

test('564-c3: every harness the deployment vocabulary names has a capability row', () => {
  const routeHarnesses = ['codex', 'muse', 'grok', 'kimi-code', 'claude-code', 'omp'];
  const rows = harnessWakeCapabilityForHarnesses(routeHarnesses);
  assert.deepEqual(rows.map((row) => row.harness), [...routeHarnesses].sort(),
    'the doctor cannot report a harness the delivery table has no row for');
  for (const row of rows) {
    assert.equal(row.canStartTurn, row.mechanism !== 'none',
      'a row that cannot start a turn never claims a mechanism that could');
  }
});
