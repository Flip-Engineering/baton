import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication, MockAdapter, createDriver } from '../src/index.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

// Issue #500 — the shipped deployment profile's followPolicy.maxResponseBytes was a
// bare 512 * 1024 literal: exactly the view.run.bytes value class that broke run show
// on a roughly 45-seat swarm before #489's fix. Post-#489 that registry row is the ONE
// Run-view ceiling with the narrowing ladder as its graceful path, and the profile
// validator (application.mjs normalizeFollowPolicy) already refuses any follow ceiling
// above it — so the shipped default now reads the registry row instead of re-declaring
// the number. These rows pin the contract that makes the literal unnecessary: the
// registry row is admitted as a follow ceiling, and one byte over it refuses typed.
// The sourcing itself is pinned by the frame-economics F1 ratchet: its exemption for
// the old literal is removed, so a re-declared 512 * 1024 fails the suite.

const RUN_VIEW_BYTES = FRAME_LIMITS['view.run.bytes'].value;
const repoId = 'repo-issue500-follow';
const route = Object.freeze({ harness: 'mock', model: 'model-a', effort: 'low' });
const principal = (id) => Object.freeze({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });

const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1_024,
  requiredPredecessorEvidence: [],
});

function profile(maxResponseBytes) {
  return {
    schemaVersion: 1,
    repoId,
    definitionOfDone: ['deployment verification passes'],
    constraints: [],
    risk: 'high',
    goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
    nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
    pathScope: ['impl/**'],
    verification,
    routes: [route],
    capabilities: ['code', 'test'],
    effects: ['repository_edit'],
    resultPolicy: { mode: 'none', maxAdoptedResults: 0, locator: 'git_ref' },
    followPolicy: {
      mode: 'enabled', maxWaitMs: 1_000, maxChanges: 8, maxResponseBytes, maxScanEvents: 32,
    },
    exportPolicy: {
      mode: 'manual', format: 'directory-v1', maxFiles: 8, maxBytes: 64 * 1_024,
      requireAdoptedResult: false, requireSemanticReview: false, requireIntegration: false,
    },
  };
}

async function applicationWith(t, maxResponseBytes) {
  const root = mkdtempSync(join(tmpdir(), 'baton-500-follow-'));
  mkdirSync(join(root, 'export'), { recursive: true, mode: 0o700 });
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue500@example.invalid', GIT_COMMITTER_EMAIL: 'issue500@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 500', GIT_COMMITTER_NAME: 'Issue 500' });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = new MockAdapter({
    harness: 'mock', scenario: { outcome: 'completed', summary: 'fixture', files: {} },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  const driver = createDriver({
    repoRoot: repo, repoId, logDir: join(root, 'log'),
    adapters: { mock: adapter },
  });
  const app = new BatonApplication({
    driver, repoId, profiles: { deployment: profile(maxResponseBytes) },
    exportRoot: join(root, 'export'),
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: async () => true,
  });
  t.after(async () => {
    await app.shutdown(principal('shutdown')).catch(() => {});
    rmSync(root, { recursive: true, force: true });
  });
  return app;
}

test('500-d: the registry view.run.bytes row is admitted as the follow response ceiling', async (t) => {
  const app = await applicationWith(t, RUN_VIEW_BYTES);
  assert.ok(app, 'a follow ceiling at exactly the registry row is admitted');
});

test('500-e: one byte over the registry row refuses typed at profile admission', async (t) => {
  await assert.rejects(() => applicationWith(t, RUN_VIEW_BYTES + 1), (error) => {
    assert.equal(error.code, 'application_profile_invalid',
      'a follow ceiling above the registry row refuses typed');
    assert.match(error.message, /followPolicy/u, 'the refusal names the policy block');
    return true;
  });
});
