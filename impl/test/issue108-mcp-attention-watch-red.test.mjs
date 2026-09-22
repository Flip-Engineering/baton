import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BatonApplication } from '../src/application.mjs';
import { decorateAttentionApplication } from '../src/production-attention-authorization.mjs';
import { createDriver, DEFAULT_RUN_LINEAGE_POLICY } from '../src/index.mjs';

// Issue #108: attention.watch answers the documented MCP principal an empty page
// and rewinds the cursor, never an error. Two legs, measured on the served base:
//
//   1. The documented composition — the attention seam (`decorateAttentionApplication`,
//      production-attention-authorization.mjs) the wrapped MCP entries and the web
//      transport apply — authorized the connection and paged. The page was EMPTY for
//      a run whose member sat waiting on a blocking question, because no attention
//      row was ever recorded (#255). This file's row pins the composed page: it
//      carries #255's interaction_requested row, so the documented principal's watch
//      is live. Before #255's fix this row failed on the silent empty page.
//
//   2. The northbound dispatch (`mcp-northbound.mjs`) swallowed the lane's own
//      `attention_scope_forbidden` for a control-capable connection and answered the
//      exact dishonest shape `{afterCursor: 0, throughCursor: 0, reasons: []}` — the
//      cursor rewind, never an error. That silent fallback is removed: the lane's
//      refusal reaches the wire AS ITSELF for every principal, so the watch either
//      pages or refuses typed. The wire row for this arm becomes executable when the
//      six ordinary tools' table registration lands (the MCP lane's held staging —
//      `workflow-surface-red` FP-14 pins "tools absent" today); the served composed
//      surface already refuses the cursor-rewind shape
//      (`production-mcp-convergence`'s attentionCursorGuard, pinned green).

const REPO = 'repo-issue-108';

class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native', turnCompletion: 'pausable',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'], family: 'mock',
        acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
        serviceTier: null, provenance: 'issue-108', refreshedAt: null,
      },
    };
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn() { return { ok: true }; }
  async prompt() { return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
  async kill() { return { ok: true }; }
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

function principalOf(id) {
  return Object.freeze({ actor: `test:${id}`, principalId: id, sessionId: `session-${id}` });
}

function makeBrief(overrides = {}) {
  return {
    goal: 'read the world, then produce the deliverable',
    constraints: [], pathScope: ['.'], definitionOfDone: 'report written',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 }, requiredEffects: [], ...overrides,
  };
}

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-issue108-'));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'baton-test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Baton Test'], { cwd: repo });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'base'], { cwd: repo });
  const adapter = new ScriptableAdapter();
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir: join(root, 'log'),
    adapters: { mock: adapter },
    runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY,
    stopDeadlineMs: 1000,
    watchdog: { stallMs: 60_000 },
  });
  const application = new BatonApplication({
    driver, repoId: REPO, profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: { planner: principalOf('planner'), dispatcher: principalOf('dispatcher'), observer: principalOf('observer') },
    authorize: async () => true,
  });
  const state = { driver, application, adapter, runId: 'run:issue-108' };
  t.after(async () => {
    try { await application.shutdown(principalOf('cleanup')); } catch { /* teardown */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* teardown */ }
    try { await driver.closeAuthority?.(); } catch { /* teardown */ }
    rmSync(root, { recursive: true, force: true });
  });
  return state;
}

// The session identity the documented deployment mints for the resident's own MCP
// entry (application-deployment.mjs): the connection's principal, control-capable.
const documentedPrincipal = {
  userId: 'local-owner', sessionId: 'mcp-session-1',
  capabilities: ['observe', 'control', 'approve', 'emergency_stop', 'export_result', 'retry_verification',
    'goal:define', 'goal:observe', 'plan:propose', 'plan:approve'],
  repoIds: [REPO], expiresAt: new Date(Date.now() + 600000).toISOString(), revoked: false,
};

test('#108 the documented principal pages a pending interaction, never a silent empty page', async (t) => {
  const state = await fixture(t);
  const handle = await state.driver.coordinator.spawn('mock', makeBrief(), { runId: state.runId });
  state.adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'question.asked', actor: 'worker',
    payload: { requestId: 'req-108', question: 'Which route?' },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await state.driver.coordinator.wait(5).catch(() => {});

  // The wrapped MCP entries and the web transport decorate the application with the
  // attention seam: the connected principal first passes run replay authorization,
  // then the server derives the deployment viewer. The page carries #255's recorded
  // attention row — on the served base this same call answered `{reasons: []}`.
  const decorated = decorateAttentionApplication(state.application, { transport: 'mcp' });
  const page = await decorated.command('run.attention.watch', { runId: state.runId, cursor: 0 },
    { actor: `mcp:${documentedPrincipal.userId}:${documentedPrincipal.sessionId}`, principalId: documentedPrincipal.userId, sessionId: documentedPrincipal.sessionId },
    { transport: 'mcp', requestId: 'issue-108:1', idempotencyKey: 'mcp.call:issue-108:1' });
  const reason = page.reasons.find((row) => row.kind === 'interaction_requested' && row.requestId === 'req-108');
  assert.ok(reason, 'the documented principal pages the pending interaction');
  assert.equal(reason.interactionKind, 'question');
  assert.equal(reason.runId, state.runId);
});

test('#108 an unauthorized documented principal is refused typed, never silently emptied', async (t) => {
  const state = await fixture(t);
  await state.driver.coordinator.spawn('mock', makeBrief(), { runId: state.runId });
  await new Promise((resolve) => setImmediate(resolve));

  // A connection whose host policy refuses the run read draws the application's own
  // refusal through the decorated seam — never a fabricated empty page.
  const refusingApplication = new BatonApplication({
    driver: state.driver, repoId: REPO, profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: { planner: principalOf('planner'), dispatcher: principalOf('dispatcher'), observer: principalOf('observer') },
    authorize: async () => { throw Object.assign(new Error('application command is not authorized'), { code: 'application_unauthorized' }); },
  });
  const decorated = decorateAttentionApplication(refusingApplication, { transport: 'web' });
  await assert.rejects(
    decorated.command('run.attention.watch', { runId: state.runId, cursor: 0 },
      { actor: `mcp:${documentedPrincipal.userId}:${documentedPrincipal.sessionId}`, principalId: documentedPrincipal.userId, sessionId: documentedPrincipal.sessionId },
      { transport: 'mcp', requestId: 'issue-108:2', idempotencyKey: 'mcp.call:issue-108:2' }),
    (error) => error?.code === 'application_unauthorized',
  );
});
