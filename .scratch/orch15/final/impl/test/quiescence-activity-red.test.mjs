import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDriver } from '../src/index.mjs';
import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';

// #236 follow-on red pin — quiescence must treat in-flight tool execution as ACTIVITY.
// Measured 2026-08-19 (wave-e fleet): nine members deep in real work (2079 content events,
// w-649 mid-tool-call at 00:26:12) when the interpreter's quiescence classifier declared
// the waves silent and stopped everyone — WAVE-INCOMPLETE via wave_terminalized_unrecoverable
// on members in phase 'running'.
//
// Mechanism: _progressTiming (application.mjs:8154) builds lastProgress.at from 'meaningful'
// events only, and _followCategory (:8022) classifies evidence.mapped content.tool_call /
// content.message payloads as NOISE (null) — so a member executing a 7-minute tool call
// (a test-suite run inside the member) shows a STALE lastProgress.at the whole time. The
// interpreter reads v.lastProgress.at (workflow-interpreter.mjs:933), sees no advance,
// derives silence. The liveness counter (:8126) counts the same events with the comment
// 'Noise for progress-meaning, exactly right for liveness' — the two views disagree, and
// quiescence read the wrong one.
//
// RED   = a member emitting tool_call evidence mid-turn shows lastProgress.at frozen at the
//         pre-tool event (content events excluded from meaningful).
// GREEN = content.tool_call/content.message evidence advances lastProgress.at (an actively
//         executing member is NEVER quiescent-silent).

const principal = (id) => ({ actor: `pin:${id}`, principalId: id, sessionId: `${id}-session` });
const root = (prefix) => mkdtempSync(join(tmpdir(), `baton-${prefix}-`));

async function buildFixture() {
  const repo = root('quiesce-repo');
  const logDir = root('quiesce-log');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'q@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Q'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  // An adapter that stays working (long delay — the member never completes during the pin)
  // and emits a content.tool_call observation mid-turn via the real event lane.
  const worker = new MockAdapter({ harness: 'worker', scenario: { outcome: 'completed', delayMs: 60_000 } });
  const card = worker.card.bind(worker);
  worker.card = () => ({ ...card(), modelSelection: { mode: 'exact', configuredDefault: 'm', available: ['m'], family: 'f', acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'test', refreshedAt: null } });
  // Capture the coordinator-registered callback so the pin can inject a mid-turn tool_call
  // observation exactly as a real provider tool execution would surface it.
  const realOnEvent = worker.onEvent.bind(worker);
  let registeredCb = null;
  worker.onEvent = (fn) => { registeredCb = fn; return realOnEvent(fn); };
  globalThis.__quiesceInjectToolCall = (workerId) => registeredCb?.({
    worker: workerId, harness: 'worker', turnEpoch: 1, actor: 'worker',
    kind: 'content.tool_call', payload: { phase: 'start', tool: 'bash' },
  });

  const driver = createDriver({
    repoRoot: repo, repoId: 'repo-quiesce', logDir, now: () => Date.now(),
    adapters: { worker },
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1, repoId: 'repo-quiesce', mandatory: true, approvalTtlMs: 3_600_000,
        riskClasses: ['low'], effectClasses: ['repository_edit'], capabilityClasses: ['code'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
          maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
        }),
      }),
      authorize: async () => true,
    },
    stopDeadlineMs: 1_000,
  });

  const application = new BatonApplication({
    driver, repoId: 'repo-quiesce',
    profiles: {
      plain: {
        schemaVersion: 1, repoId: 'repo-quiesce',
        definitionOfDone: ['verification passes'], constraints: [], risk: 'low',
        goalBudget: { tokens: 4_000, usd: 1, wallMin: 5, providerTurns: 4 },
        nodeBudget: { tokens: 4_000, usd: 1, wallMin: 5, providerTurns: 4 },
        pathScope: ['**'],
        verification: { command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code', timeoutMs: 5_000, maxOutputBytes: 16 * 1024, requiredPredecessorEvidence: [] },
        routes: [{ harness: 'worker', model: 'm', effort: 'low' }],
        capabilities: ['code'], effects: ['repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
        integrationPolicy: { mode: 'none', strategies: [], requireAdoptedResult: false, requireSemanticReview: false },
      },
    },
    principals: { planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer') },
    authorize: async () => true,
  });
  await application.ready;
  return { application, driver, repo, logDir };
}

test('QUIESCENCE-ACTIVITY: mid-turn tool_call evidence advances lastProgress.at — an executing member is never silent', async () => {
  const { application, logDir } = await buildFixture();
  try {
    const runId = 'run-quiesce-1';
    const proposed = await application.command('run.start', { intent: {
      runId, objective: 'quiesce pin', route: { harness: 'worker', model: 'm', effort: 'low' },
    } }, principal('owner'));
    await application.command('run.approve', { runId, planDigest: proposed.plan.digest }, principal('approver'));
    await new Promise((r) => setTimeout(r, 100));
    // The member is working (60s delay). Inject the mid-turn tool_call observation through
    // the real event lane — exactly what a live provider tool execution surfaces.
    globalThis.__quiesceInjectToolCall?.('w-1');
    await new Promise((r) => setTimeout(r, 150));
    // content.tool_call evidence event (read from the fixture's coordination events). Pre-fix,
    // timing ignores content evidence and lastProgress.at stays at the dispatch-era event —
    // strictly older than the tool_call.
    const { readFileSync } = await import('node:fs');
    const { join: joinPath } = await import('node:path');
    let lastToolCallTs = null;
    try {
      for (const l of readFileSync(joinPath(logDir, 'coordination', 'events.jsonl'), 'utf8').trim().split('\n')) {
        try {
          const e = JSON.parse(l);
          if (e.kind === 'evidence.mapped' && e.payload?.kind === 'content.tool_call' && e.ts > (lastToolCallTs ?? '')) lastToolCallTs = e.ts;
        } catch {}
      }
    } catch { /* coordination events absent */ }
    const inspect = await application.command('run.inspect', { runId, depth: 'outline' }, principal('owner'));
    const outline = inspect?.outline ?? inspect ?? {};
    const lastProgressAt = outline.lastProgress?.at ?? null;
    assert.ok(lastProgressAt, 'the outline carries lastProgress.at (the quiescence predicate\'s source)');
    assert.ok(lastToolCallTs, 'the fixture emitted a content.tool_call event');
    assert.ok(Date.parse(lastProgressAt) >= Date.parse(lastToolCallTs),
      `lastProgress.at (${lastProgressAt}) must be >= the last tool_call evidence (${lastToolCallTs}) — content liveness IS timing; a member executing tools is never silent`);
  } finally {
    await application.close?.();
  }
});
