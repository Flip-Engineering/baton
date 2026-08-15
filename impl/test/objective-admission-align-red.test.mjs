// ROW BRIEF: docs/reference/evidence/phantom-root-2026-08-15/wave-d/row-admission-align-brief.md
// Issue #207 root — the interpreter admits by-reference objectives to a 64 KiB envelope while
// run.start's objective lane caps at 4096 bytes; a brief in the 4-64 KiB band renders into a
// member objective the embedded client WALLS (application-client.mjs `nonempty`,
// `Buffer.byteLength(value) <= 4_096` — the "Run objective is required" phantom), so the wave
// ADMITS at compile and every member phantom-fails at start with terminalCause 'start' and a
// misleading application_client_invalid. The fix: the interpreter refuses at admission
// (renderObjective, the compile/admit seam) when the rendered brief exceeds the run.objective
// cap, naming both byte counts — a workflow_objective_ref_invalid-class refusal (the objectiveRef
// member of the workflow_spec_invalid family, consistent with the sibling D5 byte-bound refusal
// at the same seam, pinned by workflow-as-data-red W1-03).
//
// RED at pre-change head (da16e834, measured 2026-08-15): the lane RESOLVES with a D6 receipt
// whose member outcome is phase 'failed', terminalCause 'start', error
// {code:'application_client_invalid', message:'Run objective is required'} — every assertion
// below that expects an admission-time refusal fails.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import { runWorkflow } from '../src/workflow-interpreter.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

const REPO = 'repo-objective-admission-align';
// The cap is read from the registry (Decision 8 — never a re-declared literal).
const RUN_OBJECTIVE_CAP = FRAME_LIMITS['run.objective'].value;

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-ooa-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principalOf(id) {
  return Object.freeze({ actor: `test:${id}`, principalId: id, sessionId: `session-${id}` });
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

const GOAL_PLAN_POLICY = Object.freeze({
  schemaVersion: 1, repoId: REPO, mandatory: true, approvalTtlMs: 3600000,
  riskClasses: ['low'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 65536, maxPlanBytes: 262144, maxStatusBytes: 262144,
    maxTokens: 1000000, maxUsd: 100, maxWallMin: 1440, maxProviderTurns: 10000,
  }),
});

const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });

// The fast lane driver (F11 idiom — the suite never runs the interpreter on the 20 s default).
const LANE_DRIVER = Object.freeze({ pollIntervalMs: 15, stallTimeoutMs: 400 });

async function fixture(t) {
  const repo = root('repo');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  mkdirSync(join(repo, 'objectives'), { recursive: true });
  const adapter = new MockAdapter({
    harness: 'mock',
    scenario: { outcome: 'completed', edits: [{ path: 'reports/member.md', content: 'done' }] },
  });
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir: join(repo, 'log'),
    adapters: { mock: adapter },
    stopDeadlineMs: 2_000,
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
  });
  const application = new BatonApplication({
    driver, repoId: REPO,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('planner'),
      dispatcher: principalOf('dispatcher'),
      observer: principalOf('observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principalOf('owner'));
  t.after(async () => {
    try { await application.shutdown(principalOf('cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
  });
  return { baton, repo };
}

async function captureError(fn) {
  try {
    const value = await fn();
    return { value };
  } catch (error) {
    return { error: { code: error?.code ?? null, message: String(error?.message ?? error) } };
  }
}

function memberSpec(idempotencyKey) {
  return {
    schemaVersion: 1,
    idempotencyKey,
    members: [{
      role: 'row-a',
      exact: { ...ROUTE },
      scope: ['reports/**'],
      objectiveRef: 'objectives/brief.md',
      report: 'reports/member.md',
    }],
    steering: {},
    harvest: { paths: [] },
  };
}

// The phantom band: a brief over the 4096-byte run.objective cap (up to the old 64 KiB envelope).
test('row-admission-align: an objectiveRef brief over the run.objective cap refuses AT ADMISSION naming both byte counts — never a per-member phantom start failure', async (t) => {
  const fx = await fixture(t);
  for (const size of [RUN_OBJECTIVE_CAP + 1, 8192, 64 * 1024]) {
    writeFileSync(join(fx.repo, 'objectives', 'brief.md'), 'x'.repeat(size));
    const result = await captureError(() => runWorkflow(fx.baton, memberSpec(`ooa-refuse-${size}`), {
      driver: LANE_DRIVER, detach: false,
    }));
    assert.ok(result.error,
      `stage: admission-align — a ${size}-byte brief must refuse AT ADMISSION; at pre-change head the lane ADMITTED and every member phantom-failed at start (terminalCause 'start')`);
    // The typed workflow_spec_invalid-class refusal: workflow_objective_ref_invalid (the
    // objectiveRef member of the family, consistent with the D5 byte-bound refusal at this seam).
    assert.equal(result.error.code, 'workflow_objective_ref_invalid',
      `stage: admission-align — the ${size}-byte brief refuses workflow_objective_ref_invalid (a workflow_spec_invalid-class code), never the phantom application_client_invalid`);
    const message = result.error.message;
    assert.match(message, /objectiveRef/u, 'the refusal names the objectiveRef seam');
    // Contract 1: the message names BOTH byte counts — the measured rendered brief and the cap.
    const counts = /is (\d+) bytes \(cap (\d+)/u.exec(message);
    assert.ok(counts, `the refusal names both byte counts (measured + cap): "${message}"`);
    const measured = Number(counts[1]);
    assert.ok(measured >= size && measured <= size + 128,
      `the measured bytes are the RENDERED salted brief (${size} raw + the [attempt: <uuid> <role>] salt prefix)`);
    assert.equal(Number(counts[2]), RUN_OBJECTIVE_CAP,
      'the cap named is the run.objective registry value (4096)');
  }
});

// The boundary guard: a brief AT or under the cap still admits and settles — the refusal is the
// run-cap alignment, never a wall in front of the objectiveRef lane.
test('row-admission-align: a brief within the run.objective cap admits and settles — the refusal is not a blanket objectiveRef wall', async (t) => {
  const fx = await fixture(t);
  writeFileSync(join(fx.repo, 'objectives', 'brief.md'), 'y'.repeat(RUN_OBJECTIVE_CAP - 200));
  const result = await captureError(() => runWorkflow(fx.baton, memberSpec('ooa-admit'), {
    driver: LANE_DRIVER, detach: false,
  }));
  assert.ok(!result.error, `a ${RUN_OBJECTIVE_CAP - 200}-byte brief admits: ${result.error?.code ?? result.error?.message ?? 'no error'}`);
  assert.equal(result.value?.basis, 'completed', 'the at-cap brief runs to a completed wave');
  const outcome = result.value?.outcomes?.find((row) => row?.role === 'row-a');
  assert.ok(outcome && outcome.terminal === true, 'the member settles terminal');
  assert.notEqual(outcome?.terminalCause, 'start', 'no phantom start failure');
  assert.equal(outcome?.error ?? null, null, 'no phantom start error');
});
