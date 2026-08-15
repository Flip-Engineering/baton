import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import { createWave } from '../src/wave.mjs';

const repoId = 'repo-wave-task-namespace-debug2';
function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-wave-ns-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}
function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

function harness(repo, logDir, tracker) {
  const adapter = new MockAdapter({ scenario: { outcome: 'completed' } });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({ ...baseCard(), modelSelection: { mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'], family: 'mock', acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'debug', refreshedAt: null } });
  const nativeSpawn = adapter.spawn.bind(adapter);
  adapter.spawn = (worker, brief, options) => { tracker.calls.push({ worker }); return nativeSpawn(worker, brief, { ...options, scenario: { outcome: 'completed' } }); };
  const driver = createDriver({
    repoRoot: repo, repoId, logDir, adapters: { mock: adapter }, stopDeadlineMs: 2_000,
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 60 * 60 * 1_000,
        riskClasses: ['low', 'medium', 'high', 'critical'], effectClasses: ['repository_edit', 'provider_call'],
        capabilityClasses: ['code', 'test'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
          maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
        }),
      }),
      authorize: async () => true,
    },
  });
  const application = new BatonApplication({
    driver, repoId,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1, repoId, definitionOfDone: ['deployment verification passes'], constraints: [],
        risk: 'low', goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 }, pathScope: ['**'],
        verification: { command: 'true', arguments: [], cwd: '.', envAllowlist: [], expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536, requiredPredecessorEvidence: [] },
        routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
        capabilities: ['code', 'test'], effects: ['provider_call', 'repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      }),
    },
    defaults: { profile: 'default', route: null },
    principals: { planner: principal('application-planner'), dispatcher: principal('application-dispatcher'), observer: principal('application-observer') },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principal('wave-owner'));
  return { application, baton, driver, adapter };
}

const repo = root('repo'); const logDir = root('log');
mkdirSync(join(repo, 'reports'), { recursive: true });
const tracker = { calls: [] };
const { baton, driver } = harness(repo, logDir, tracker);
const brief = { role: 'alpha', objective: 'write the shared report (marker:alpha)', harness: 'mock', model: 'mock-model', effort: 'low', scope: ['reports/**'], report: 'reports/alpha.md' };
const first = await createWave(baton, { repoRoot: repo, members: [brief], idempotencyKey: 'ns-wave-a' });
const firstOutcomes = await first.settle({ timeoutMs: 20_000 });
console.log('wave A outcome:', JSON.stringify(firstOutcomes));
await first.close({ reason: 'A settled.' });

let second;
try {
  second = await createWave(baton, { repoRoot: repo, members: [brief], idempotencyKey: 'ns-wave-b' });
  console.log('wave B created; runs keys:', [...second.runs.keys()]);
  const progress = await second.progress();
  console.log('wave B progress:', JSON.stringify(progress.members, null, 2));
  const outcomes = await second.settle({ timeoutMs: 20_000 });
  console.log('wave B outcomes:', JSON.stringify(outcomes, null, 2));
} catch (error) {
  console.log('wave B createWave threw:', error?.code, String(error?.message).slice(0, 400));
}
console.log('spawnCalls:', tracker.calls);
await driver.closeAuthority?.();
await driver.coordination?.releaseWriterLease?.();
rmSync(repo, { recursive: true, force: true }); rmSync(logDir, { recursive: true, force: true });
