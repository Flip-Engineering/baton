// REFLEX-4 slice A red suite (docs/32 §3.4, issue #19; contract:
// docs/reference/evidence/reflex-wave-live-2026-07-21/reflex4-decisions.md, red-team refinement
// F12: docs/reference/evidence/reflex-wave-live-2026-07-21/reflex-redteam.md).
//
// application.context_eval is pure-only Bench evaluation without a Workflow *action* gate: it
// reuses an EXISTING durably-admitted Context session (found by manifestDigest or by runId), the
// same DurableContextSession admission path `run.act`'s context_eval action uses, without
// requiring the caller to hold that role's own dispatch. It creates no new manifest admission, no
// new Plan/dispatch/effect authority, and every cell it returns is durably admitted (never
// stateless-computed-only) — see application.mjs `contextEval` for the full authority note.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS, BatonApplication,
} from '../src/application.mjs';
import { parseBatonCli } from '../src/application-cli.mjs';
import { DEFAULT_WORKER_POLICY_REQUEST, MockAdapter, createDriver } from '../src/index.mjs';
import {
  RepositoryContextRuntime, defaultRepositoryContextPolicy,
} from '../src/context-runtime.mjs';

const routeA = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const routeB = Object.freeze({ harness: 'kimi-code', model: 'k3', effort: 'high' });

function principal(id) {
  return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` });
}

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-reflex4-context-eval-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'reflex4@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Reflex4'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  writeFileSync(join(root, 'alpha.mjs'), 'export const alpha = 1;\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function adapter(route, tracker) {
  const value = new MockAdapter({
    harness: route.harness,
    scenario: {
      outcome: 'completed',
      edits: [{ path: `${route.harness}-source.txt`, content: 'source\n', delayMs: 60_000 }],
    },
  });
  const baseCard = value.card.bind(value);
  value.card = () => ({
    ...baseCard(), authPosture: 'subscription',
    modelSelection: {
      mode: 'exact', configuredDefault: route.model, available: [route.model],
      family: route.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [route.effort], serviceTier: null,
      provenance: 'reflex4-context-eval-test', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: {
        supported: ['unattended'], default: 'unattended', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      access: {
        supported: ['full'], default: 'full', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      containment: {
        hostProcess: 'same_uid', guarantees: ['private_runtime'],
        configuredPreferences: [], observation: 'unavailable',
      },
    },
  });
  const nativeSpawn = value.spawn.bind(value);
  value.spawn = (...args) => {
    tracker.calls.push({ harness: route.harness, at: Date.now() });
    return nativeSpawn(...args);
  };
  return value;
}

async function harness(t) {
  const repo = repository();
  const logDir = mkdtempSync(join(tmpdir(), 'baton-reflex4-context-eval-log-'));
  const contextArtifactRoot = mkdtempSync(join(tmpdir(), 'baton-reflex4-context-eval-artifacts-'));
  const treeSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const repoId = 'repo-reflex4-context-eval';
  const contextRuntime = new RepositoryContextRuntime({
    artifactRoot: contextArtifactRoot, policy: defaultRepositoryContextPolicy(),
    repoId, repoRoot: repo, treeSha,
  });
  const tracker = { calls: [] };
  const driver = createDriver({
    repoRoot: repo, repoId, deploymentBaseSha: treeSha, logDir,
    adapters: { codex: adapter(routeA, tracker), 'kimi-code': adapter(routeB, tracker) },
    stopDeadlineMs: 2_000,
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 60 * 60 * 1_000,
        riskClasses: ['low', 'medium', 'high', 'critical'],
        effectClasses: ['repository_edit', 'provider_call'],
        capabilityClasses: ['baton_orchestrator', 'code', 'test'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 16, maxDepsPerNode: 16,
          maxTextBytes: 16_384, maxItems: 128, maxScopePaths: 128, maxRouteValues: 64,
          maxGoalBytes: 256 * 1_024, maxPlanBytes: 512 * 1_024, maxStatusBytes: 1_024 * 1_024,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 480, maxProviderTurns: 2_048,
        }),
      }),
      authorize: async () => true,
    },
    contextProgram: contextRuntime.driverConfiguration(),
  });
  contextRuntime.attachCoordination(driver.coordination);
  const application = new BatonApplication({
    driver, repoId,
    profiles: {
      default: Object.freeze({
        schemaVersion: 2, repoId,
        definitionOfDone: ['deployment verification passes'],
        constraints: [],
        risk: 'low',
        goalBudget: { tokens: 1_000_000, usd: 100, wallMin: 480, providerTurns: 2_048 },
        nodeBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 256 },
        pathScope: ['**'],
        verification: {
          command: 'true', arguments: [], cwd: '.', envAllowlist: [],
          expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65_536,
          requiredPredecessorEvidence: [],
        },
        routes: [routeA, routeB],
        capabilities: ['baton_orchestrator', 'code', 'test'],
        effects: ['provider_call', 'repository_edit'],
        workerPolicy: DEFAULT_WORKER_POLICY_REQUEST,
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      }),
    },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    context: {
      principal: principal('context-service'),
      openSession: (request) => contextRuntime.openSession(request),
      materializeCallResult: (request) => contextRuntime.materializeCallResult(request),
    },
    authorize: async () => true,
  });
  t.after(async () => {
    try { await application.shutdown(principal('shutdown')); } catch { /* best-effort teardown */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
    rmSync(contextArtifactRoot, { recursive: true, force: true });
  });
  return { application, driver, tracker };
}

async function startWorkingWorkflow(application, runId) {
  const owner = principal('owner');
  const intent = {
    runId,
    objective: 'Evaluate one closed pure Context expression without a Workflow action.',
    resultIntent: 'change',
    composition: {
      strategy: 'parallel_attempts', workspace: 'isolated', join: 'operator_selected',
      team: [{ role: 'critic', route: routeA }, { role: 'builder', route: routeB }],
    },
  };
  await application.command('run.start', { intent }, owner);
  const outline = await application.command('run.inspect', { runId, depth: 'outline' }, owner);
  const approve = outline.outline.actions.find((action) => action.kind === 'approve_plan');
  assert.ok(approve, 'a fresh Workflow Run must offer approve_plan');
  await application.command('run.act', {
    runId, actionId: approve.actionId, inputs: {},
  }, owner);
  const working = await application.command('run.inspect', { runId, depth: 'outline' }, owner);
  assert.ok(working.outline.actions.some((action) => action.kind === 'context_eval'),
    'an approved Workflow Run with a live dispatch must advertise the context_eval action');
  return { owner };
}

async function workflowContextEvalAction(application, runId, owner) {
  const outline = await application.command('run.inspect', { runId, depth: 'outline' }, owner);
  const action = outline.outline.actions.find((candidate) => candidate.kind === 'context_eval');
  assert.ok(action, 'a working Workflow Run must offer context_eval');
  return action.actionId;
}

const searchProgram = Object.freeze({
  schemaVersion: 1, kind: 'baton.context_program',
  expression: {
    op: 'search', input: { op: 'source', branch: 'repository' },
    query: 'alpha', mode: 'literal',
  },
});

const effectProgram = Object.freeze({
  schemaVersion: 1, kind: 'baton.context_program',
  expression: {
    op: 'map', input: { op: 'source', branch: 'repository' },
    role: 'critic', instruction: 'attempt a provider effect through the non-Workflow surface',
  },
});

test('RX4-A1: application.context_eval reproduces the exact Workflow cell identity by runId and by manifestDigest, without holding the role\'s own dispatch authority', async (t) => {
  const { application, driver } = await harness(t);
  const runId = 'run-reflex4-a1';
  const { owner } = await startWorkingWorkflow(application, runId);

  const cellsBefore = driver.coordination.snapshot().context.cells.length;
  const workflowActionId = await workflowContextEvalAction(application, runId, owner);
  const workflowResult = await application.command('run.act', {
    runId, actionId: workflowActionId, inputs: { program: searchProgram, role: 'critic' },
  }, owner);
  const workflowCellId = workflowResult.item.id;
  assert.match(workflowCellId, /^cell:[a-f0-9]{64}$/u);
  assert.equal(driver.coordination.snapshot().context.cells.length, cellsBefore + 1,
    'the Workflow action must durably admit exactly one new cell');

  const sessions = driver.coordination.snapshot().context.sessions
    .filter((session) => session.runId === runId);
  assert.equal(sessions.length, 1, 'exactly one Context session backs this Run');
  const manifestDigest = sessions[0].manifestDigest;

  // application.context_eval is a top-level command, never a run.act action: `owner` need not
  // hold `context_eval` action authority on this Run, only ordinary observe/control capability.
  const byRunId = await application.contextEval({
    runId, role: 'critic', program: searchProgram,
  }, owner);
  assert.equal(byRunId.item.id, workflowCellId,
    'same program+manifest+policy by runId must reuse the identical durable cell identity');

  const byManifestDigest = await application.contextEval({
    manifestDigest, program: searchProgram,
  }, owner);
  assert.equal(byManifestDigest.item.id, workflowCellId,
    'same program+manifest+policy by manifestDigest must reuse the identical durable cell identity');

  assert.equal(driver.coordination.snapshot().context.cells.length, cellsBefore + 1,
    'all three evaluations of the identical program must settle on one durable cell, not three');
});

test('RX4-A2: application.context_eval refuses a provider-effect program before any effect, session, or cell is touched', async (t) => {
  const { application, driver, tracker } = await harness(t);
  const runId = 'run-reflex4-a2';
  const { owner } = await startWorkingWorkflow(application, runId);

  const cellsBefore = driver.coordination.snapshot().context.cells.length;
  const callsBefore = tracker.calls.length;
  await assert.rejects(
    application.contextEval({ runId, role: 'critic', program: effectProgram }, owner),
    (error) => error?.code === 'application_context_effect_forbidden',
  );
  assert.equal(driver.coordination.snapshot().context.cells.length, cellsBefore,
    'a refused effect op must not admit a cell');
  assert.equal(tracker.calls.length, callsBefore,
    'a refused effect op must never reach a provider');
});

test('RX4-A3: an unknown manifestDigest refuses without admitting any session or cell', async (t) => {
  const { application, driver } = await harness(t);
  const runId = 'run-reflex4-a3';
  await startWorkingWorkflow(application, runId);

  const sessionsBefore = driver.coordination.snapshot().context.sessions.length;
  const cellsBefore = driver.coordination.snapshot().context.cells.length;
  const neverAdmitted = 'f'.repeat(64);
  await assert.rejects(
    application.contextEval({
      manifestDigest: neverAdmitted, program: searchProgram,
    }, principal('owner')),
    (error) => error?.code === 'application_context_eval_manifest_unavailable',
  );
  assert.equal(driver.coordination.snapshot().context.sessions.length, sessionsBefore);
  assert.equal(driver.coordination.snapshot().context.cells.length, cellsBefore);
});

test('RX4-A4: a tampered manifestDigest (one flipped hex character of a real, admitted digest) refuses the same way as an unknown one', async (t) => {
  const { application, driver } = await harness(t);
  const runId = 'run-reflex4-a4';
  const { owner } = await startWorkingWorkflow(application, runId);
  const actionId = await workflowContextEvalAction(application, runId, owner);
  await application.command('run.act', {
    runId, actionId, inputs: { program: searchProgram, role: 'critic' },
  }, owner);
  const sessions = driver.coordination.snapshot().context.sessions.filter((s) => s.runId === runId);
  const real = sessions[0].manifestDigest;
  const tampered = (real[0] === '0' ? '1' : '0') + real.slice(1);
  assert.notEqual(tampered, real);

  await assert.rejects(
    application.contextEval({ manifestDigest: tampered, program: searchProgram }, owner),
    (error) => error?.code === 'application_context_eval_manifest_unavailable',
  );
});

test('RX4-A5: application.context_eval\'s result is the same bounded, sanitized item projection run.inspect would show for that cell — no separate or looser output surface', async (t) => {
  const { application } = await harness(t);
  const runId = 'run-reflex4-a5';
  const { owner } = await startWorkingWorkflow(application, runId);

  const result = await application.contextEval({
    runId, role: 'critic', program: searchProgram,
  }, owner);
  const inspected = await application.command('run.inspect', {
    runId, depth: 'item', section: 'context', item: result.item.id,
  }, owner);
  assert.deepEqual(result, inspected,
    'application.context_eval must return exactly the run.inspect item projection for its cell');
  assert.equal(result.item.value.kind, 'cell');
  assert.ok(result.item.value.output.items.length > 0);
});

test('RX4-A6: application.context_eval creates no new Plan, dispatch, or Workflow authority — it only reuses what already exists', async (t) => {
  const { application, driver } = await harness(t);
  const runId = 'run-reflex4-a6';
  const { owner } = await startWorkingWorkflow(application, runId);
  const actionId = await workflowContextEvalAction(application, runId, owner);
  await application.command('run.act', {
    runId, actionId, inputs: { program: searchProgram, role: 'critic' },
  }, owner);

  const before = driver.coordination.snapshot().goalPlan;
  await application.contextEval({ runId, role: 'critic', program: searchProgram }, owner);
  await application.contextEval({
    runId, role: 'critic',
    program: {
      schemaVersion: 1, kind: 'baton.context_program',
      expression: { op: 'coverage', input: { op: 'source', branch: 'repository' } },
    },
  }, owner);
  const after = driver.coordination.snapshot().goalPlan;
  assert.equal(after.plans.length, before.plans.length, 'no new Plan version');
  assert.equal(after.dispatches.length, before.dispatches.length, 'no new dispatch');
  assert.equal(after.approvals.length, before.approvals.length, 'no new Plan approval');
});

test('RX4-A7: application.context_eval requires exactly one of runId or manifestDigest', async (t) => {
  const { application } = await harness(t);
  const runId = 'run-reflex4-a7';
  const { owner } = await startWorkingWorkflow(application, runId);
  await assert.rejects(
    application.contextEval({ program: searchProgram }, owner),
    (error) => error?.code === 'application_context_eval_invalid',
    'neither runId nor manifestDigest must refuse',
  );
  const evaluated = await application.contextEval({
    runId, role: 'critic', program: searchProgram,
  }, owner);
  assert.ok(evaluated.item.id);
  await assert.rejects(
    application.contextEval({
      runId, manifestDigest: 'a'.repeat(64), program: searchProgram,
    }, owner),
    (error) => error?.code === 'application_context_eval_invalid',
    'both runId and manifestDigest together must refuse',
  );
});

test('RX4-A8: transport parity — direct method + MCP baton_context_eval; CLI refuses at parse (CS-2)', () => {
  // application.context_eval is `BatonApplication.prototype.contextEval` (application.mjs), a
  // public method, not an APPLICATION_COMMAND_DEFINITIONS entry: `card().commands` is exactly
  // `Object.keys(APPLICATION_COMMAND_DEFINITIONS)`, and several out-of-this-task's-scope fixtures
  // assert that list verbatim (impl/test/phase64-integrated-run-application.test.mjs `UA5`) or
  // derive their own required-command list from it by `.web`/`.mcp`, against a fixed, hand-typed
  // application.card().commands mock that predates this command (impl/test/
  // phase12-web-operator.test.mjs, impl/test/phase72-kimi-orchestrator-mcp.test.mjs, impl/test/
  // phase16-mcp-northbound.test.mjs — whose `combined.result.tools.length === 47` assertion also
  // forbids a new MCP tool regardless). See the authority note atop
  // `BatonApplication.prototype.contextEval` in application.mjs for the full account.
  //
  // CS-2 (control-surface v2): the CLI no longer accepts a dead parse→whitelist path. `context
  // eval` refuses at parse with a typed corrective naming the live paths (embedded
  // BatonRun.context().evaluate / MCP baton_context_eval).
  assert.equal(Object.hasOwn(APPLICATION_COMMAND_DEFINITIONS, 'application.context_eval'), false);

  assert.throws(
    () => parseBatonCli([
      'context', 'eval', '--manifest', 'a'.repeat(64), '--json',
      '{"schemaVersion":1,"kind":"baton.context_program","expression":{"op":"source","branch":"repository"}}',
    ]),
    (error) => error?.code === 'cli_command_host_local'
      && /baton_context_eval|context\(\)|evaluate/iu.test(error?.message ?? ''),
  );
  assert.throws(
    () => parseBatonCli([
      'context', 'eval', '--run', 'run-cli-x', '--role', 'critic', '--json',
      '{"schemaVersion":1,"kind":"baton.context_program","expression":{"op":"source","branch":"repository"}}',
    ]),
    (error) => error?.code === 'cli_command_host_local',
  );
});
