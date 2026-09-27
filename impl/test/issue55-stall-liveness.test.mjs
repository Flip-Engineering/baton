// Issue #55 red suite: mid-turn liveness must move the single-run view. Before the fix, the
// view was byte-static across one long unpaused turn (resource.provider_call/resource.tokens
// are noise-filtered from 'meaningful' progress and no view field varied), so the wave
// driver's stall clock killed productive workers mid-turn (three waves in two days). Rows pin
// the activity projection: mid-turn provider activity is visible (L1) and a silent run reads
// honest zeros (L2).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';

const repoId = 'repo-issue55';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-issue55-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

// A MockAdapter that injects one resource.provider_call mid-turn (before its delayed edit
// lands) — the real adapters emit these per inference; the stock mock only reports tokens
// at finalize, which is exactly the gap that made single-run views byte-static mid-turn.
class MidTurnActivityAdapter extends MockAdapter {
  card() {
    return {
      ...super.card(),
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
        family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low'], serviceTier: null,
        provenance: 'issue55-test', refreshedAt: null,
      },
    };
  }

  async spawn(worker, brief, options = {}) {
    const handle = await super.spawn(worker, brief, options);
    const scenario = options.scenario ?? this._defaultScenario ?? {};
    if (scenario.injectProviderCallMs !== undefined) {
      const session = this._sessions.get(worker);
      const timer = setTimeout(() => {
        if (session && !session.terminal) {
          this._emit(session, 'resource.provider_call', {
            callId: `call-${worker}-midturn`, phase: 'started', threadId: `thread-${worker}`,
            turnId: `turn-${worker}-1`,
          });
        }
      }, scenario.injectProviderCallMs);
      timer.unref?.();
    }
    return handle;
  }
}

function harness(t, adapter) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    adapters: { mock: adapter },
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
  const baton = bindBaton(application, principal('run-owner'));
  t.after(async () => {
    await application.shutdown(principal('cleanup')).catch(() => {});
    try { driver.coordination.releaseWriterLease(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { baton };
}

const stallMarker = (response) => {
  const view = { ...(response ?? {}) };
  delete view.cursor;
  return createHash('sha256').update(JSON.stringify(view)).digest('hex').slice(0, 16);
};

async function until(check, label, timeoutMs = 15_000, pollMs = 40) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label} never became true within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

test('L1: mid-turn provider activity is visible in the single-run view — the stall marker moves while the worker works', async (t) => {
  const adapter = new MidTurnActivityAdapter({
    scenario: {
      outcome: 'completed',
      injectProviderCallMs: 150,
      edits: [{ path: 'reports/alpha.md', content: 'alpha report\n', delayMs: 900 }],
    },
  });
  const { baton } = harness(t, adapter);
  const run = await baton.runs.start('write the alpha report (marker:alpha)', {
    exact: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['reports/**'],
  });
  await run.approve();

  // Before the injection: honest zeros (the turn has started but no resource events landed).
  const before = await until(async () => {
    const status = await run.status();
    const outline = status?.view ?? status ?? {};
    return outline?.phase && outline.phase !== 'planning' ? status : null;
  }, 'run active');
  const beforeOutline = before?.view ?? before ?? {};
  assert.deepEqual(beforeOutline.activity, { providerCalls: 0, tokens: 0, contentEvents: 0, lastActivityAt: null },
    'honest zeros before any provider activity lands');
  const beforeMarker = stallMarker(before);

  // After the mid-turn injection (well before the delayed edit/turn end): the view MUST
  // carry the activity and the stall marker MUST move — a long turn never reads byte-static.
  const after = await until(async () => {
    const status = await run.status();
    const outline = status?.view ?? status ?? {};
    return outline?.activity?.providerCalls === 1 ? status : null;
  }, 'mid-turn provider activity visible');
  const afterOutline = after?.view ?? after ?? {};
  assert.equal(afterOutline.activity.providerCalls, 1);
  assert.equal(typeof afterOutline.activity.lastActivityAt, 'string');
  assert.notEqual(stallMarker(after), beforeMarker,
    'mid-turn provider activity moves the stall marker — the #55 kill never fires on activity');

  const outcomes = await run.complete();
  assert.ok(outcomes);
});

test('L2: a silent run reads honest zero activity — and finalize-time token reports land', async (t) => {
  const adapter = new MidTurnActivityAdapter({
    scenario: {
      outcome: 'completed',
      edits: [{ path: 'reports/beta.md', content: 'beta report\n', delayMs: 800 }],
      budgetUsed: { tokens: 42, usd: 0.001 },
    },
  });
  const { baton } = harness(t, adapter);
  const run = await baton.runs.start('write the beta report (marker:beta)', {
    exact: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['reports/**'],
  });
  await run.approve();
  // Inside the 800ms pre-edit delay: the turn has started, no resource events have landed.
  const early = await until(async () => {
    const status = await run.status();
    const outline = status?.view ?? status ?? {};
    return outline?.phase && outline.phase !== 'planning' ? status : null;
  }, 'run active inside the delay');
  const earlyOutline = early?.view ?? early ?? {};
  assert.deepEqual(earlyOutline.activity, { providerCalls: 0, tokens: 0, contentEvents: 0, lastActivityAt: null });
  await until(async () => {
    const status = await run.status();
    const outline = status?.view ?? status ?? {};
    return (outline?.activity?.tokens ?? 0) > 0 ? status : null;
  }, 'finalize-time token report visible');
});
