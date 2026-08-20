import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAdapter, createDriver } from '../src/index.mjs';
import { BatonApplication } from '../src/application.mjs';

// #158 red pin — the shared scratchpad has no write verb on ANY agent-facing surface.
//
// Proven live by the #147 dogfood wave: the web row's report reached `shared` only through
// settlement elevation; the mcp row stayed worker-scoped; the cli row published nothing.
// The store kernel (appendScratchpad, D3 scope law: members write worker:<ownId> + shared)
// EXISTS — the surface layer never carried it. A wave whose members must publish to
// `shared` loses any member driving through a weaker surface.
//
// RED   = application.command('run.scratchpad.write', ...) refuses unknown_command.
// GREEN = the verb validates (runId + scope + entry), authorizes (D1.2 scoping: a worker
//         principal writes worker:<ownId> + shared ONLY), appends through the kernel,
//         and reads back through run.scratchpad.read. A worker writing another's scope
//         refuses typed.

const REPO = 'issue-158-repo';

const goalPlanPolicy = Object.freeze({
  schemaVersion: 1, repoId: REPO, mandatory: false, approvalTtlMs: 60_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 16, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 100_000, maxUsd: 10, maxWallMin: 60, maxProviderTurns: 100,
  }),
});
const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});
const profile = Object.freeze({
  schemaVersion: 1, repoId: REPO,
  definitionOfDone: ['done'], constraints: [], risk: 'high',
  goalBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['**'], verification,
  routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['provider_call'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

function fixture(label) {
  const repository = mkdtempSync(join(tmpdir(), `bt158-${label}-repo-`));
  const logDir = mkdtempSync(join(tmpdir(), `bt158-${label}-log-`));
  execFileSync('git', ['init', '-q'], { cwd: repository });
  execFileSync('git', ['config', 'user.email', 'i158@example.invalid'], { cwd: repository });
  execFileSync('git', ['config', 'user.name', 'I158'], { cwd: repository });
  writeFileSync(join(repository, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '-A'], { cwd: repository });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repository });
  const adapter = new MockAdapter({
    harness: 'mock', scenario: { outcome: 'completed', delayMs: 5, summary: 'done', files: {} },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: ['mock-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  const driver = createDriver({
    repoRoot: repository, repoId: REPO, logDir, now: Date.now,
    adapters: { mock: adapter }, goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    stopDeadlineMs: 2_000, watchdog: { stallMs: 60_000 },
  });
  const principalId = `worker:w-${label}`;
  const p = (pid) => ({ actor: `direct:${pid}`, principalId: pid, sessionId: `${pid}-session` });
  const application = new BatonApplication({
    driver, repoId: REPO, profiles: { default: profile },
    principals: { planner: p(`${label}-planner`), dispatcher: p(`${label}-dispatcher`), observer: p(`${label}-observer`) },
    authorize: async () => true,
  });
  return {
    application, cleanup: () => { rmSync(repository, { recursive: true, force: true }); rmSync(logDir, { recursive: true, force: true }); },
  };
}

test('SCRATCHPAD-WRITE (#158): a member writes shared through the surface verb and reads it back', async (t) => {
  const f = fixture('sw');
  t.after(() => { try { f.cleanup(); } catch {} });
  const app = f.application;
  await app.ready;

  // Seed a steering-registered run so the scratchpad scopes exist.
  const started = await app.start({
    runId: 'run-158-shared', objective: 'scratchpad write row', profile: 'default',
    route: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['**'],
  }, {"actor":"direct:sw-owner","principalId":"sw-owner","sessionId":"sw-owner-session"},
  { transport: 'direct', requestId: 'sw-1', idempotencyKey: 'direct:sw-1' });
  assert.ok(started, 'the run started');
  const workerPrincipal = { actor: 'worker:w-sw', principalId: 'worker:w-sw', sessionId: 'w-sw-session' };
  const ctx = { transport: 'direct', requestId: 'sw-w', idempotencyKey: 'direct:sw-w' };

  // THE PIN: the append verb exists on the application surface (the MCP tool's shipped
  // schema — baton_run_scratchpad_append was a ghost until now) and writes to shared.
  const written = await app.command('run.scratchpad.append', {
    runId: 'run-158-shared', scope: 'shared',
    kind: 'note', body: 'row complete: the shared write lane works',
  }, workerPrincipal, ctx);
  assert.ok(!written?.error, `the append verb resolves (${JSON.stringify(written).slice(0, 120)})`);

  // And reads back through the read verb (the #33 accessor).
  const read = await app.command('run.scratchpad.read', {
    runId: 'run-158-shared', scope: 'shared',
  }, workerPrincipal, ctx);
  const texts = (read?.entries ?? []).map((e) => e.text).join('\n');
  assert.ok(texts.includes('the shared write lane works'),
    `the shared entry reads back (got: ${texts.slice(0, 120)})`);
});
