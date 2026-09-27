// Issue #62 red suite: a refused scratchpad write is an upward signal, never silent.
// R1: an invalid entry (outside the four closed kinds note/plan/doubt/link) lands a
// scratchpad_write_failed attention item in the run view (status().attention) with the
// refusal code. R2: a valid entry mints no such attention (write_result ok:true). R3: the
// projection is bounded (last two failures per worker). The demo receipt: three writes
// refused scratchpad_entry_invalid and invisible until hand-grepped (2026-08-01).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';

const repoId = 'repo-issue62';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-issue62-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

// Emits scripted scratchpad.write attempts at spawn+50ms — the emulated up-channel the
// claude-shim grammar produces; the hub validates and mints scratchpad.write_result.
class ScratchWriteAdapter extends MockAdapter {
  constructor(config = {}) {
    super(config);
    this._writes = config.writes ?? [];
  }

  card() {
    return {
      ...super.card(),
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
        family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low'], serviceTier: null,
        provenance: 'issue62-test', refreshedAt: null,
      },
    };
  }

  async spawn(worker, brief, options = {}) {
    const handle = await super.spawn(worker, brief, options);
    const session = this._sessions.get(worker);
    for (const [index, write] of this._writes.entries()) {
      const timer = setTimeout(() => {
        if (session && !session.terminal) {
          this._emit(session, 'scratchpad.write', {
            entry: write.entry,
            expectedFence: write.expectedFence ?? 'current',
            idempotencyKey: write.idempotencyKey ?? `issue62-write-${index}`,
          });
        }
      }, 50 + index * 40);
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

async function until(check, label, timeoutMs = 12_000, pollMs = 40) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label} never became true within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

const attentionOf = async (run) => {
  const status = await run.status();
  const outline = status?.view ?? status ?? {};
  return Array.isArray(outline?.attention) ? outline.attention : [];
};

test('R1: an invalid scratchpad entry (outside the four closed kinds) lands a scratchpad_write_failed attention with the refusal code', async (t) => {
  const adapter = new ScratchWriteAdapter({
    scenario: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha\n', delayMs: 2_000 }] },
    writes: [{ entry: { finding: 'my title', line: 'wave.mjs:47', severity: 'high' } }],
  });
  const { baton } = harness(t, adapter);
  const run = await baton.runs.start('write the alpha report (marker:alpha)', {
    exact: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['reports/**'],
  });
  await run.approve();
  await until(async () => (await attentionOf(run))
    .some((entry) => entry?.kind === 'scratchpad_write_failed'
      && entry?.code === 'scratchpad_entry_invalid'), 'the refused write surfaces as attention');
  const attention = await attentionOf(run);
  const failure = attention.find((entry) => entry?.kind === 'scratchpad_write_failed');
  assert.equal(failure.code, 'scratchpad_entry_invalid');
  assert.equal(typeof failure.workerId, 'string');
  assert.equal(typeof failure.requestId, 'string');
  await run.stop('R1 done.');
});

test('R2: a valid entry mints ok:true and NO scratchpad_write_failed attention', async (t) => {
  const adapter = new ScratchWriteAdapter({
    scenario: { outcome: 'completed', edits: [{ path: 'reports/beta.md', content: 'beta\n', delayMs: 400 }] },
    writes: [{ entry: { kind: 'note', text: 'a valid note' } }],
  });
  const { baton } = harness(t, adapter);
  const run = await baton.runs.start('write the beta report (marker:beta)', {
    exact: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['reports/**'],
  });
  await run.approve();
  await until(async () => {
    const status = await run.status();
    const outline = status?.view ?? status ?? {};
    return outline?.scratchpad?.entries?.length > 0;
  }, 'the valid write lands in the scratchpad');
  const attention = await attentionOf(run);
  assert.equal(attention.some((entry) => entry?.kind === 'scratchpad_write_failed'), false,
    'a valid write never surfaces as a failure');
  await run.stop('R2 done.');
});

test('R3: the projection is bounded — only the last two failures per worker surface', async (t) => {
  const adapter = new ScratchWriteAdapter({
    scenario: { outcome: 'completed', edits: [{ path: 'reports/gamma.md', content: 'gamma\n', delayMs: 2_400 }] },
    writes: [
      { entry: { bogus: 1 }, idempotencyKey: 'issue62-r3-1' },
      { entry: { bogus: 2 }, idempotencyKey: 'issue62-r3-2' },
      { entry: { bogus: 3 }, idempotencyKey: 'issue62-r3-3' },
      { entry: { bogus: 4 }, idempotencyKey: 'issue62-r3-4' },
    ],
  });
  const { baton } = harness(t, adapter);
  const run = await baton.runs.start('write the gamma report (marker:gamma)', {
    exact: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['reports/**'],
  });
  await run.approve();
  await until(async () => (await attentionOf(run))
    .filter((entry) => entry?.kind === 'scratchpad_write_failed').length >= 2,
    'failures surface (bounded)');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const attention = await attentionOf(run);
  const failures = attention.filter((entry) => entry?.kind === 'scratchpad_write_failed');
  assert.equal(failures.length, 2, `bounded to the last two, got ${failures.length}`);
  await run.stop('R3 done.');
});
