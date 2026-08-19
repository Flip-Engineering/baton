import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import { createWave } from '../src/wave.mjs';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-t-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}
function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

class DoubleSpawnAdapter extends MockAdapter {
  constructor(config = {}) { super(config); this.doubleSpawn = config.doubleSpawn !== false; this._nextPid = 4242; }
  async spawn(worker, brief, opts = {}) {
    const ack = await super.spawn(worker, brief, opts);
    if (!ack.ok) return ack;
    if (!this.doubleSpawn) return ack;
    const session = this._sessions.get(worker);
    const generation = opts.processGeneration ?? 1;
    const pid = this._nextPid; this._nextPid += 7;
    this._emit(session, 'lifecycle.spawned', { phase: 'spawn' });
    this._emit(session, 'lifecycle.process_started', { schemaVersion: 1, generation, pid, processGroupId: pid, phase: 'initializing' });
    this._emit(session, 'lifecycle.process_ready', { schemaVersion: 1, generation, pid, processGroupId: pid });
    queueMicrotask(() => { const live = this._sessions.get(worker); if (live && !live.terminal) this._emit(live, 'lifecycle.spawned', { phase: 'spawn' }); });
    return ack;
  }
}

const repoId = 'repo-t';
const repo = root('repo'); mkdirSync(join(repo, 'reports'), { recursive: true });
const logDir = root('log');
const adapter = new DoubleSpawnAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] } });
const driver = createDriver({ repoRoot: repo, repoId, logDir, adapters: { mock: adapter }, stopDeadlineMs: 2000, goalPlanAuthority: { policy: Object.freeze({ schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 60 * 60 * 1000, riskClasses: ['low','medium','high','critical'], effectClasses: ['repository_edit','provider_call'], capabilityClasses: ['code','test'], limits: Object.freeze({ maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16, maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32, maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024, maxTokens: 1000000, maxUsd: 100, maxWallMin: 1440, maxProviderTurns: 10000 }) }), authorize: async () => true }) });
const application = new BatonApplication({ driver, repoId, profiles: { default: Object.freeze({ schemaVersion: 1, repoId, definitionOfDone: ['deployment verification passes'], constraints: [], risk: 'low', goalBudget: { tokens: 200000, usd: 20, wallMin: 120, providerTurns: 64 }, nodeBudget: { tokens: 50000, usd: 5, wallMin: 30, providerTurns: 16 }, pathScope: ['**'], verification: { command: 'true', arguments: [], cwd: '.', envAllowlist: [], expectExit: 0, expectResult: 'exit_code', timeoutMs: 30000, maxOutputBytes: 65536, requiredPredecessorEvidence: [] }, routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }], capabilities: ['code','test'], effects: ['provider_call','repository_edit'], resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' } }) }, defaults: { profile: 'default', route: null }, principals: { planner: principal('application-planner'), dispatcher: principal('application-dispatcher'), observer: principal('application-observer') }, authorize: async () => true });
const baton = bindBaton(application, principal('wave-owner'));

let t0 = Date.now();
const wave = await createWave(baton, { repoRoot: repo, members: [{ role: 'alpha', objective: 'write the alpha report (marker:alpha)', harness: 'mock', model: 'mock-model', effort: 'low', scope: ['reports/**'], report: 'reports/alpha.md' }] });
console.log('createWave', Date.now() - t0, 'ms');
t0 = Date.now();
const outcomes = await wave.settle({ timeoutMs: 20000 });
console.log('settle', Date.now() - t0, 'ms', JSON.stringify(outcomes));
t0 = Date.now();
const stop = await wave.close({ reason: 'spawn-window settled.' });
console.log('close', Date.now() - t0, 'ms', JSON.stringify({ stops: stop?.stops?.length, remainingCount: stop?.remainingCount }));
t0 = Date.now();
await driver.closeAuthority?.();
await driver.coordination?.releaseWriterLease?.();
console.log('driver close', Date.now() - t0, 'ms');
rmSync(repo, { recursive: true, force: true }); rmSync(logDir, { recursive: true, force: true });
