// scratch probe — delete before landing.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import { createWave } from '../src/wave.mjs';
import { createWaveDriver } from '../src/wave-driver.mjs';
import { runWorkflow } from '../src/workflow-interpreter.mjs';

const repoId = 'repo-scratch-200';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-s200-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}
function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

function markerAdapter(scenariosByMarker, tracker = { calls: [] }) {
  const adapter = new MockAdapter({ scenario: scenariosByMarker.default ?? { outcome: 'completed' } });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null,
      provenance: 'scratch-200', refreshedAt: null,
    },
  });
  const nativeSpawn = adapter.spawn.bind(adapter);
  adapter.spawn = (worker, brief, options) => {
    const goal = brief?.goal ?? '';
    const marker = Object.keys(scenariosByMarker).find((key) => key !== 'default' && goal.includes(key));
    const scenario = scenariosByMarker[marker] ?? scenariosByMarker.default;
    tracker.calls.push({ worker, marker: marker ?? 'default' });
    return nativeSpawn(worker, brief, { ...options, scenario });
  };
  return adapter;
}

function harness(t, scenariosByMarker, tracker) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const adapters = { mock: markerAdapter(scenariosByMarker, tracker) };
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    adapters,
    stopDeadlineMs: 2_000,
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1,
        repoId,
        mandatory: true,
        approvalTtlMs: 60 * 60 * 1_000,
        riskClasses: ['low', 'medium', 'high', 'critical'],
        effectClasses: ['repository_edit', 'provider_call'],
        capabilityClasses: ['code', 'test'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
          maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
        }),
      }),
      authorize: async () => true,
    },
  });
  const application = new BatonApplication({
    driver,
    repoId,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1,
        repoId,
        definitionOfDone: ['deployment verification passes'],
        constraints: [],
        risk: 'low',
        goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
        pathScope: ['**'],
        verification: {
          command: 'true', arguments: [], cwd: '.', envAllowlist: [],
          expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536,
          requiredPredecessorEvidence: [],
        },
        routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
        capabilities: ['code', 'test'],
        effects: ['provider_call', 'repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      }),
    },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principal('wave-owner'));
  t.after(async () => {
    await driver.closeAuthority?.();
    await driver.coordination?.releaseWriterLease?.();
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo };
}

const member = (role, objective, options = {}) => ({
  role,
  objective: `${objective} (marker:${role})`,
  harness: 'mock', model: 'mock-model', effort: 'low',
  scope: ['reports/**'],
  report: `reports/${role}.md`,
  ...options,
});

test('POST-1: distinct keys -> distinct runIds, second spawns fresh (direct createWave)', async (t) => {
  const scenarios = { alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] } };
  const tracker = { calls: [] };
  const { baton, repo } = harness(t, scenarios, tracker);
  const obj = 'identical objective text';
  const w1 = await createWave(baton, { repoRoot: repo, members: [member('alpha', obj)], idempotencyKey: 'key-1' });
  const s1 = await w1.settle({ timeoutMs: 20_000 });
  const w2 = await createWave(baton, { repoRoot: repo, members: [member('alpha', obj)], idempotencyKey: 'key-2' });
  const s2 = await w2.settle({ timeoutMs: 20_000 });
  console.log('POST-1 outcomes:', JSON.stringify([s1[0].phase, s2[0].phase]), 'spawns:', tracker.calls.length);
  console.log('POST-1 distinct runs:', w1.runs.get('alpha')?.id !== w2.runs.get('alpha')?.id);
});

test('POST-2: interpreter — distinct keys distinct runIds; same-key re-drive refuses terminal (unchanged)', async (t) => {
  const { baton, repo, driver } = await harness(t, { default: [{ edits: [{ path: 'reports/alpha.md', content: 'alpha\n' }] }] });
  const spec = (key) => ({
    schemaVersion: 1,
    idempotencyKey: key,
    members: [{
      role: 'alpha', exact: { harness: 'mock', model: 'mock-model', effort: 'low' },
      scope: ['reports/**'], objectiveRef: 'objectives/brief.md', report: 'reports/alpha.md',
    }],
    steering: {},
    harvest: { paths: [] },
  });
  mkdirSync(join(repo, 'objectives'));
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(repo, 'objectives', 'brief.md'), 'do the thing\n(marker:alpha)\n');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '-q', '-m', 'brief'], { cwd: repo });
  const r1 = await runWorkflow(baton, spec('key-1'), { repoRoot: repo, driver: { pollIntervalMs: 15, stallTimeoutMs: 400 } });
  const r2 = await runWorkflow(baton, spec('key-2'), { repoRoot: repo, driver: { pollIntervalMs: 15, stallTimeoutMs: 400 } });
  const regs = driver.coordination.eventsView().filter((e) => e.kind === 'driver.recorded' && e.payload?.kind === 'steering.registered');
  console.log('POST-2 regs:', JSON.stringify(regs.map((e) => ({ waveId: e.payload.waveId, runId: e.payload.runId }))));
  console.log('POST-2 outcomes:', r1.outcomes[0].phase, r2.outcomes[0].phase);
});

test('POST-3: same-key ritual re-drive via wave-driver (saltObjectives:false) still dedupes', async (t) => {
  const scenarios = { alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] } };
  const tracker = { calls: [] };
  const { baton, repo } = harness(t, scenarios, tracker);
  const driver = createWaveDriver(baton, {
    pollIntervalMs: 15, stallTimeoutMs: 400, settleTimeoutMs: 1_500,
    steering: 'none', finalization: 'claim-on-stall', unproductiveNudgeBudget: 0,
    saltObjectives: false, preflight: false,
  });
  const members = [member('alpha', 'write the alpha report')];
  const first = await driver.run({ repoRoot: repo, members, idempotencyKey: 'ritual-key' });
  const second = await driver.run({ repoRoot: repo, members, idempotencyKey: 'ritual-key' });
  console.log('POST-3 first basis:', first.basis, 'second basis:', second.basis, 'spawns:', tracker.calls.length);
});
