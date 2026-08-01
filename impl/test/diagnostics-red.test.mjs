// Diagnostics epic v2 — DG-1 only (DIAG-3 + DIAG-2).
// Authority: docs/reference/evidence/diagnostics-2026-07-31/diagnostics-decisions.md (v2 top).
// Red-first: DG-1a (wire.frame_degraded + stream-death whitelisted summaries) and
// DG-1b (trust-gate {gate, detail} honestly shaped + run.feedback same payload).
// Harness mirrors issue53-run-debug-red: real Coordinator + BatonApplication through
// createDriver, with adapter.emit injection — never via the store directly.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import { sanitizeVerifierDiagnosticText } from '../src/verifier-diagnostics.mjs';

const repoId = 'repo-diagnostics-dg1';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-dg1-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', [
    '-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test',
    'commit', '--allow-empty', '-q', '-m', 'base',
  ], { cwd: dir });
  return dir;
}

function principal(id) {
  return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` });
}

class DebugAdapter extends MockAdapter {
  card() {
    return {
      ...super.card(),
      turnCompletion: 'pausable',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
        family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low'], serviceTier: null,
        provenance: 'diagnostics-dg1-red', refreshedAt: null,
      },
    };
  }

  emit(event) {
    const session = this._sessions.get(event.worker);
    if (session) this._emit(session, event.kind, event.payload ?? {});
  }
}

function harness(t, scenario = {
  outcome: 'completed', edits: [{ path: 'reports/worker.md', content: 'work\n' }],
}) {
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
        riskClasses: ['low'], effectClasses: ['repository_edit', 'provider_call'],
        capabilityClasses: ['code', 'test'],
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
        verification: {
          command: 'true', arguments: [], cwd: '.', envAllowlist: [],
          expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000,
          maxOutputBytes: 65_536, requiredPredecessorEvidence: [],
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
    try { await application.shutdown(principal('cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo, adapter };
}

async function startRun(baton) {
  const run = await baton.runs.start('diagnostics dg1 fixture (marker:dg1)', {
    exact: { harness: 'mock', model: 'mock-model', effort: 'low' },
    scope: ['reports/**'], driverKind: 'wave',
  });
  await run.approve();
  const status = await run.status();
  const view = status?.view ?? status ?? {};
  const workerId = (Array.isArray(view.attention) ? view.attention : [])
    .find((item) => typeof item?.workerId === 'string')?.workerId
    ?? view?.outline?.workerId ?? 'w-1';
  return { run, workerId, runId: run.id ?? status?.runId ?? view?.runId };
}

const emit = (adapter, workerId, kind, payload) => adapter.emit({
  worker: workerId, harness: 'mock@1.0.0', turnEpoch: 1, kind, actor: 'worker', payload,
});

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);

// ---------------------------------------------------------------------------
// DG-1a — DIAG-3: wire.frame_degraded + stream-death as whitelisted summaries
// ---------------------------------------------------------------------------

test('DG-1a: wire.frame_degraded surfaces as a bounded whitelist summary (count + last code), never raw frames', async (t) => {
  const { application, baton, adapter } = harness(t);
  const { workerId, runId } = await startRun(baton);

  emit(adapter, workerId, 'wire.frame_degraded', {
    frameBytes: 200_000, ceilingBytes: 65_536, toolUseId: 'toolu_1',
  });
  emit(adapter, workerId, 'wire.frame_degraded', {
    frameBytes: 180_000, ceilingBytes: 65_536, toolUseId: 'toolu_2',
  });

  const debug = await application.debug({ runId }, principal('observer'));
  const member = debug.members[0];
  const degraded = member.writeReceipts.filter((r) => r.kind === 'wire.frame_degraded');
  assert.equal(degraded.length, 1, 'one aggregated summary, not one receipt per event');
  const summary = degraded[0];
  assert.equal(summary.result, 'degraded');
  assert.equal(summary.code, 'frame_degraded');
  assert.equal(summary.count, 2);
  assert.equal(summary.lastCode, 'frame_degraded');
  assert.equal(typeof summary.at, 'string');
  // Never raw frames / never passthrough of receipt payload internals as free-form content.
  assert.equal(summary.frameBytes, undefined);
  assert.equal(summary.ceilingBytes, undefined);
  assert.equal(summary.toolUseId, undefined);
  const serialized = JSON.stringify(summary);
  assert.ok(!serialized.includes('toolu_'), `raw toolUseId leaked: ${serialized}`);
});

test('DG-1a: stream-death/crash lands on the failure leg as a whitelisted summary', async (t) => {
  const { application, baton, adapter } = harness(t);
  const { workerId, runId } = await startRun(baton);

  emit(adapter, workerId, 'lifecycle.crashed', {
    error: 'stream died mid-turn', code: 'stream_death',
  });

  const debug = await application.debug({ runId }, principal('observer'));
  const failure = debug.members[0].failure;
  assert.ok(failure, 'stream death must surface on the failure leg');
  assert.equal(failure.kind, 'lifecycle.crashed');
  assert.equal(failure.code, 'stream_death');
  assert.equal(failure.message, 'stream died mid-turn');
  // Closed #53 keys remain; no raw stream/frame payload.
  assert.equal(failure.frameBytes, undefined);
  assert.equal(failure.raw, undefined);
});

test('DG-1a: #53 closed-shape whitelist amendment is pinned by source-scan', () => {
  const source = readFileSync(new URL('../src/application.mjs', import.meta.url), 'utf8');
  // Receipt kinds the debug projection admits (whitelist, not blacklist).
  assert.ok(
    /scratchpad\.write_result/.test(source) && /authority\.rejected/.test(source),
    'base #53 receipt kinds must remain in the projection',
  );
  assert.ok(
    /wire\.frame_degraded/.test(source),
    'DIAG-3 amendment must whitelist wire.frame_degraded in the debug projection',
  );
  // Gate diagnosis fields land on the failure leg (DIAG-2 amendment).
  assert.ok(
    /\bgate\b/.test(source) && /pathScopeEvidence|outOfScopeChangedPathsDigest/.test(source),
    'DIAG-2 amendment must project gate diagnosis from pathScopeEvidence digests',
  );
  // Sanitizer reuse is pinned (never a parallel redaction path).
  assert.ok(
    /sanitizeVerifierDiagnosticText/.test(source),
    'red_green/coverage tails must reuse sanitizeVerifierDiagnosticText verbatim',
  );
});

// ---------------------------------------------------------------------------
// DG-1b — DIAG-2: trust-gate rejection diagnosis {gate, detail}
// ---------------------------------------------------------------------------

test("DG-1b: scope refusal carries {gate:'scope', detail:{digests, counts}} — no path strings", async (t) => {
  const { application, baton, adapter } = harness(t);
  const { workerId, runId } = await startRun(baton);

  // Live coordinator mint (pathScopeEvidence digests-only — deliberately no path strings).
  emit(adapter, workerId, 'error', {
    message: 'captured worker result changed paths outside approved Plan scope',
    code: 'worker_path_scope_violation',
    phase: 'trust_gate',
    trustPhase: 'path_scope',
    pathScopeEvidence: {
      changedPathCount: 3,
      changedPathsDigest: DIGEST_A,
      inScopeChangedPathCount: 1,
      inScopeChangedPathsDigest: DIGEST_B,
      outOfScopeChangedPathCount: 2,
      outOfScopeChangedPathsDigest: DIGEST_C,
      // A fixture that tried to plant path strings must not leak through projection.
      offendingPaths: ['secret/outside-plan.txt', 'reports/ok.md'],
    },
  });

  const debug = await application.debug({ runId }, principal('observer'));
  const failure = debug.members[0].failure;
  assert.ok(failure, 'scope refusal must land on the failure leg');
  assert.equal(failure.gate, 'scope');
  assert.ok(failure.detail && typeof failure.detail === 'object');
  assert.deepEqual(failure.detail.digests, {
    changedPathsDigest: DIGEST_A,
    inScopeChangedPathsDigest: DIGEST_B,
    outOfScopeChangedPathsDigest: DIGEST_C,
  });
  assert.deepEqual(failure.detail.counts, {
    changedPathCount: 3,
    inScopeChangedPathCount: 1,
    outOfScopeChangedPathCount: 2,
  });
  const serialized = JSON.stringify(failure);
  assert.ok(!serialized.includes('outside-plan'), `path string leaked: ${serialized}`);
  assert.ok(!serialized.includes('offendingPaths'), `offendingPaths key leaked: ${serialized}`);
  assert.ok(!serialized.includes('secret/'), `path fragment leaked: ${serialized}`);
});

test("DG-1b: red_green refusal carries sanitized tail; secret-shaped line never appears", async (t) => {
  const { application, baton, adapter } = harness(t);
  const { workerId, runId } = await startRun(baton);

  const secret = 'sk-proj-abcdefghijklmnop1234567890';
  const rawTail = `red-green failed\napi_key=${secret}\nexpected exit 0 got 1\n`;
  emit(adapter, workerId, 'verify.reverified', {
    accept: false,
    verdict: {
      outcome: 'candidate_failed',
      diagnosticCode: 'verification_red_green_failed',
      redGreen: false,
      passed: false,
      reverified: true,
      failureCapsule: {
        schemaVersion: 1,
        kind: 'verification_failure_tail',
        text: rawTail,
        textDigest: 'd'.repeat(64),
        capturedOutputBytes: Buffer.byteLength(rawTail),
        capturedOutputDigest: 'e'.repeat(64),
        truncated: false,
        redacted: false,
      },
    },
  });

  const debug = await application.debug({ runId }, principal('observer'));
  const failure = debug.members[0].failure;
  assert.ok(failure, 'red_green refusal must land on the failure leg');
  assert.equal(failure.gate, 'red_green');
  assert.ok(failure.detail && typeof failure.detail.tail === 'string');
  assert.ok(!failure.detail.tail.includes(secret), `secret leaked in tail: ${failure.detail.tail}`);
  // Projection must match the shared sanitizer (no parallel redaction path).
  const expected = sanitizeVerifierDiagnosticText(rawTail).text;
  assert.equal(failure.detail.tail, expected);
});

test("DG-1b: coverage refusal carries sanitized tail via the same gate shape", async (t) => {
  const { application, baton, adapter } = harness(t);
  const { workerId, runId } = await startRun(baton);

  const rawTail = 'coverage of change failed: 0% of changed lines exercised\n';
  emit(adapter, workerId, 'verify.reverified', {
    accept: false,
    verdict: {
      outcome: 'candidate_failed',
      diagnosticCode: 'verification_coverage_failed',
      coverageOfChange: false,
      passed: false,
      reverified: true,
      failureCapsule: {
        schemaVersion: 1,
        kind: 'verification_failure_tail',
        text: rawTail,
        textDigest: 'f'.repeat(64),
        capturedOutputBytes: Buffer.byteLength(rawTail),
        capturedOutputDigest: '1'.repeat(64),
        truncated: false,
        redacted: false,
      },
    },
  });

  const debug = await application.debug({ runId }, principal('observer'));
  const failure = debug.members[0].failure;
  assert.equal(failure.gate, 'coverage');
  assert.equal(failure.detail.tail, sanitizeVerifierDiagnosticText(rawTail).text);
});

test("DG-1b: unrecognized gate code serializes gate:'unknown'", async (t) => {
  const { application, baton, adapter } = harness(t);
  const { workerId, runId } = await startRun(baton);

  emit(adapter, workerId, 'error', {
    message: 'novel gate',
    code: 'some_future_gate_code',
    phase: 'trust_gate',
    trustPhase: 'novel',
  });

  const debug = await application.debug({ runId }, principal('observer'));
  const failure = debug.members[0].failure;
  assert.ok(failure);
  assert.equal(failure.gate, 'unknown');
  assert.equal(failure.code, 'some_future_gate_code');
});

test('DG-1b: run.feedback accepts the same {gate, detail} payload the debug failure leg projects', async (t) => {
  const { application, baton, adapter } = harness(t);
  const { workerId, runId } = await startRun(baton);

  emit(adapter, workerId, 'error', {
    message: 'scope',
    code: 'worker_path_scope_violation',
    phase: 'trust_gate',
    trustPhase: 'path_scope',
    pathScopeEvidence: {
      changedPathCount: 1,
      changedPathsDigest: DIGEST_A,
      inScopeChangedPathCount: 0,
      inScopeChangedPathsDigest: DIGEST_B,
      outOfScopeChangedPathCount: 1,
      outOfScopeChangedPathsDigest: DIGEST_C,
    },
  });

  const debug = await application.debug({ runId }, principal('observer'));
  const diagnosis = {
    gate: debug.members[0].failure.gate,
    detail: debug.members[0].failure.detail,
  };
  assert.equal(diagnosis.gate, 'scope');

  // Shape is accepted by run.feedback (R-DG-6: same structured inputs). On a non-workflow
  // wave run the command refuses at the workflow gate AFTER input normalization — so a shape
  // reject would be application_workflow_feedback_invalid; acceptance is any other code
  // (typically application_workflow_feedback_unavailable).
  const err = await application.command('run.feedback', {
    runId,
    role: 'work',
    feedback: diagnosis,
  }, principal('observer')).then(
    () => null,
    (error) => error,
  );
  assert.ok(err, 'run.feedback must not silently no-op on a non-workflow run');
  assert.notEqual(
    err.code,
    'application_workflow_feedback_invalid',
    `gate diagnosis payload must be valid structured feedback inputs; got ${err.code}: ${err.message}`,
  );
});
