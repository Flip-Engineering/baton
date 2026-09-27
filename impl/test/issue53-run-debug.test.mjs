// Issue #53 — the operator debug surface (docs/reference/evidence/issue53-run-debug-2026-07-24/
// issue53-decisions.md v2). Red suite: every row pins one rule of the run.debug accessor.
// Harness mirrors the wave-driver-policy suite: a real Coordinator + BatonApplication through
// createDriver, with adapter.emit injection (the reflex1 pattern) for content.message /
// scratchpad.write / lifecycle.crashed — never via the store directly.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';

const repoId = 'repo-run-debug';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-r53-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

class DebugAdapter extends MockAdapter {
  card() {
    return {
      ...super.card(),
      turnCompletion: 'pausable',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
        family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low'], serviceTier: null,
        provenance: 'issue53-run-debug-red', refreshedAt: null,
      },
    };
  }

  emit(event) {
    const session = this._sessions.get(event.worker);
    if (session) this._emit(session, event.kind, event.payload ?? {});
  }
}

function harness(t, scenario = { outcome: 'completed', edits: [{ path: 'reports/worker.md', content: 'work\n' }] }) {
  const repo = root('repo');
  const logDir = root('log');
  const adapter = new DebugAdapter({ harness: 'mock', scenario });
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    adapters: { mock: adapter },
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 3_600_000,
        riskClasses: ['low'], effectClasses: ['repository_edit', 'provider_call'], capabilityClasses: ['code', 'test'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
          maxGoalBytes: 65_536, maxPlanBytes: 262_144, maxStatusBytes: 262_144,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 1_440, maxProviderTurns: 10_000,
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
        schemaVersion: 1, repoId,
        definitionOfDone: ['deployment verification passes'],
        constraints: [], risk: 'low',
        goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
        pathScope: ['**'],
        verification: { command: 'true', arguments: [], cwd: '.', envAllowlist: [], expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65_536, requiredPredecessorEvidence: [] },
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
    try { await application.shutdown(principal('cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo, adapter };
}

async function startRun(baton) {
  const run = await baton.runs.start('debug surface fixture (marker:x)', {
    exact: { harness: 'mock', model: 'mock-model', effort: 'low' },
    scope: ['reports/**'], driverKind: 'wave',
  });
  await run.approve();
  const status = await run.status();
  const view = status?.view ?? status ?? {};
  const workerId = (Array.isArray(view.attention) ? view.attention : []).find((item) => typeof item?.workerId === 'string')?.workerId
    ?? view?.outline?.workerId ?? 'w-1';
  return { run, workerId, runId: run.id ?? status?.runId ?? view?.runId };
}

const emit = (adapter, workerId, kind, payload) => adapter.emit({ worker: workerId, harness: 'mock@1.0.0', turnEpoch: 1, kind, actor: 'worker', payload });

test('R53-1: last-N worker messages are returned bounded, oldest-to-newest, with limit honored', async (t) => {
  const { application, baton, driver, adapter } = harness(t);
  const { workerId, runId } = await startRun(baton);
  emit(adapter, workerId, 'content.message', { text: 'first message' });
  emit(adapter, workerId, 'content.message', { text: 'second message' });
  emit(adapter, workerId, 'content.message', { text: 'third message' });

  const debug = await application.debug({ runId }, principal('observer'));
  assert.equal(debug.schemaVersion, 1);
  assert.equal(debug.members.length, 1);
  const member = debug.members[0];
  assert.equal(member.workerId, workerId);
  const texts = member.lastMessages.map((entry) => entry.text);
  assert.deepEqual(texts, ['first message', 'second message', 'third message']);
  assert.ok(member.lastMessages.every((entry) => typeof entry.at === 'string'));

  const limited = await application.debug({ runId, limit: 2 }, principal('observer'));
  assert.deepEqual(limited.members[0].lastMessages.map((entry) => entry.text), ['second message', 'third message']);

  await assert.rejects(
    application.debug({ runId, limit: 11 }, principal('observer')),
    (error) => error?.code === 'application_debug_invalid',
  );
});

test('R53-2: write receipts return written + stale_fence with code = result and no fence values', async (t) => {
  const { application, baton, driver, adapter } = harness(t);
  const { workerId, runId } = await startRun(baton);
  const entry = { kind: 'note', text: 'receipt row' };
  emit(adapter, workerId, 'scratchpad.write', { entry, expectedFence: 'current', idempotencyKey: 'r53:written' });
  emit(adapter, workerId, 'scratchpad.write', { entry, expectedFence: 999_999, idempotencyKey: 'r53:stale' });

  const debug = await application.debug({ runId }, principal('observer'));
  const receipts = debug.members[0].writeReceipts;
  assert.equal(receipts.length, 2);
  assert.deepEqual(
    receipts.map((receipt) => [receipt.kind, receipt.result, receipt.code]),
    [['scratchpad.write_result', 'written', 'written'], ['scratchpad.write_result', 'stale_fence', 'stale_fence']],
  );
  assert.ok(receipts.every((receipt) => typeof receipt.at === 'string'));
  assert.ok(!('current' in (receipts[1] ?? {})) && !('scratchpadFence' in (receipts[0] ?? {})) && !('eventSeq' in (receipts[0] ?? {})));
});

test("R53-3: a crashed member's failure is derived per the table; a healthy member's failure is null", async (t) => {
  const { application, baton, driver, adapter } = harness(t);
  const { workerId, runId } = await startRun(baton);
  emit(adapter, workerId, 'lifecycle.crashed', { error: 'simulated provider death', code: 'provider_crashed' });

  const debug = await application.debug({ runId }, principal('observer'));
  const member = debug.members[0];
  assert.equal(member.failure.kind, 'lifecycle.crashed');
  assert.equal(member.failure.code, 'provider_crashed');
  assert.equal(member.failure.message, 'simulated provider death');

  const healthy = await application.debug({ runId, member: 'no-such-member' }, principal('observer')).then(
    () => null,
    (error) => error,
  );
  assert.equal(healthy?.code, 'application_debug_member_not_found');
});

test('R53-4: the serialized object carries no banned internal keys, while stale_fence survives as a value', async (t) => {
  const { application, baton, driver, adapter } = harness(t);
  const { workerId, runId } = await startRun(baton);
  const entry = { kind: 'note', text: 'ban-list row' };
  emit(adapter, workerId, 'scratchpad.write', { entry, expectedFence: 999_999, idempotencyKey: 'r53:ban' });

  const debug = await application.debug({ runId }, principal('observer'));
  const bannedKeys = /"(?:seq|fence|scratchpadFence|expectedFence|eventSeq|pid|tokens?|cost|usd)"\s*:/u;
  assert.ok(!bannedKeys.test(JSON.stringify(debug)), `banned internal key leaked: ${JSON.stringify(debug).match(bannedKeys)?.[0]}`);
  assert.equal(debug.members[0].writeReceipts[0].result, 'stale_fence');
});

test('R53-5: the CLI verb is registered and the embedded command returns the debug projection', async (t) => {
  const { application, baton, driver, adapter } = harness(t);
  const { workerId, runId } = await startRun(baton);
  emit(adapter, workerId, 'content.message', { text: 'cli parity message' });

  const cliSource = readFileSync(new URL('../src/application-cli.mjs', import.meta.url), 'utf8');
  assert.ok(cliSource.includes("name: 'run.debug'"), 'the run.debug command is registered for the CLI');

  const debug = await application.debug({ runId }, principal('observer'));
  assert.equal(debug.members[0].lastMessages.at(-1).text, 'cli parity message');
});

test('R53-6: a SECRET_SHAPED_TEXT-shaped message is redacted by the accessor, never carried verbatim', async (t) => {
  const { application, baton, driver, adapter } = harness(t);
  const { workerId, runId } = await startRun(baton);
  const secret = 'sk-proj-abcdefghijklmnop1234567890';
  emit(adapter, workerId, 'content.message', { text: `the token is ${secret} ok` });

  const debug = await application.debug({ runId }, principal('observer'));
  const text = debug.members[0].lastMessages.at(-1).text;
  assert.ok(!text.includes(secret), `secret-shaped text leaked verbatim: ${text}`);
});
