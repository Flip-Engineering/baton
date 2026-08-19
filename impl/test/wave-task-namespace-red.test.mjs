// [attempt: 101b8ac8-c836-4c3f-be68-18cb788ccc42 row-task-namespace]
// #200 (row-task-namespace) red-first pin suite: member task ids carry the wave namespace.
// A member's task id derives from (wave idempotencyKey, role, brief content) — the runId digest
// folds the objective, and createWave/workflow-interpreter mint a wave-namespace attempt salt
// (waveAttemptSalt, deterministic per key) onto every member objective. Two waves with
// BYTE-IDENTICAL member briefs and DISTINCT keys therefore derive DISTINCT member task ids and
// the second drive spawns FRESH; a same-key re-drive derives the SAME task id (idempotent
// resume, never an orphan mint).
//
// RED at pre-change head: the runId digest excludes the wave namespace (application.mjs start()
// folds objective/route/scope/profile/owner only), so a same-brief re-drive under a distinct key
// re-attaches the prior wave's run — the second drive binds the DEAD task, run.approve refuses
// application_action_unavailable, and the wave verdict reads failed with no spawn (the
// baton-0b77f5031f85e9b33edbad4d-work incident).
//
// Deterministic: MockAdapter fixtures, no live providers, fixed git roots.

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

const repoId = 'repo-wave-task-namespace';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-wave-task-namespace-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

function openHost(repo, logDir, adapter) {
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
  const baton = bindBaton(application, principal('wave-owner'));
  return { application, baton, driver };
}

// The dead-incarnation adapter: the FIRST spawn fails (the dead task the re-drive must never
// bind); every later spawn is a fresh completing worker. Selection by spawn count, never by
// brief text — the two waves' member briefs are byte-identical, so the scenario CANNOT diverge
// on content (an anti-shallow: only a wave-namespaced derivation can give wave B a fresh task).
function deadFirstAdapter() {
  const adapter = new MockAdapter({ scenario: { outcome: 'completed' } });
  let spawns = 0;
  const native = adapter.spawn.bind(adapter);
  adapter.spawn = (worker, brief, options) => {
    spawns += 1;
    const scenario = spawns === 1
      ? { outcome: 'failed', summary: 'first incarnation dies' }
      : { outcome: 'completed', summary: 'fresh spawn', edits: [{ path: 'reports/out.md', content: 'fresh result\n' }] };
    return native(worker, brief, { ...options, scenario });
  };
  return { adapter, spawnCount: () => spawns };
}

// The wave's member runId (the task-id seed): the run in the catalog whose objective carries
// THIS wave's attempt salt. Distinct from the sibling wave's run by construction post-change;
// indistinguishable pre-change (the bind — one shared run).
function runsFor(host) {
  return host.driver.coordination.events()
    .filter((event) => event.kind === 'task.created')
    .map((event) => ({ taskId: event.payload.id, runId: event.payload.runId }));
}

async function until(check, label, timeoutMs = 20_000, pollMs = 50) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label} never became true within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function shutdown(host) {
  await host.application.shutdown(principal('owner')).catch(() => {});
}

test('#200: distinct keys with byte-identical member briefs derive DISTINCT member task ids — the second drive spawns fresh, never binds the dead task', async (t) => {
  const repo = root('distinct');
  const logDir = root('distinct-log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  t.after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(logDir, { recursive: true, force: true }); });

  const { adapter, spawnCount } = deadFirstAdapter();
  const host = openHost(repo, logDir, adapter);
  t.after(() => shutdown(host));

  // BYTE-IDENTICAL member objects for both waves — the brief, role, route, and scope do not
  // change; ONLY the wave idempotencyKey differs. A derivation that excludes the wave namespace
  // resolves both members to the same run, and the second drive re-attaches the dead task.
  const member = {
    role: 'worker',
    objective: 'write the identical report (marker:worker)',
    harness: 'mock', model: 'mock-model', effort: 'low',
    scope: ['reports/**'],
    report: 'reports/worker.md',
  };

  const waveA = await host.baton.waves.start({ repoRoot: repo, idempotencyKey: 'wave-key-A', members: [member] });
  const runA = waveA.runs.get('worker');
  assert.ok(runA, 'wave A member started');
  const runIdA = runA.id;
  await until(
    async () => (await waveA.progress()).members.find((entry) => entry.role === 'worker')?.terminal === true,
    'wave A member dead-terminal',
  );
  assert.equal(spawnCount(), 1, 'wave A spawned exactly once — the dead incarnation');

  // The second drive: distinct key, the SAME brief. Pre-change this re-attaches wave A's dead
  // run (approve refuses application_action_unavailable — no spawn, verdict failed).
  const waveB = await host.baton.waves.start({ repoRoot: repo, idempotencyKey: 'wave-key-B', members: [member] });

  const tasks = runsFor(host);
  const aTask = tasks.find((row) => row.runId === runIdA);
  assert.ok(aTask, 'wave A minted its member task');
  const freshTasks = tasks.filter((row) => row.runId !== runIdA);
  assert.equal(freshTasks.length, 1,
    'the second drive mints a FRESH member task — the wave-namespaced derivation never re-binds the prior run');
  assert.notEqual(freshTasks[0].taskId, aTask.taskId, 'the two waves\' member task ids are DISTINCT');
  assert.notEqual(freshTasks[0].runId, runIdA, 'the second drive\'s member run is DISTINCT from the first');

  // The second drive spawns fresh and settles its OWN work product — never the dead task.
  const outcomes = await waveB.settle({ timeoutMs: 15_000 });
  const outcome = outcomes.find((entry) => entry.role === 'worker');
  assert.ok(outcome, 'wave B settled a member outcome');
  assert.equal(outcome.phase, 'result_ready',
    'the second drive settles result_ready over its own fresh spawn — not failed-with-no-spawn');
  assert.match(outcome.resultSha ?? '', /^[a-f0-9]{40}$/u, 'the fresh spawn harvested its own result');
  assert.equal(spawnCount(), 2, 'wave B spawned a SECOND, fresh worker');

  const listed = await host.baton.runs.list();
  assert.equal(listed.items.length, 2, 'two distinct member runs exist — one per wave');
});

test('#200 anti-shallow: the derivation is the wave namespace — a same-key re-drive derives the SAME member task id (idempotent, never an orphan mint)', async (t) => {
  // The derivation must be a DETERMINISTIC function of (idempotencyKey, role, brief): distinct
  // keys differ, and the SAME key reproduces the SAME task id. The interpreter path is the
  // discriminator — pre-change it salted each drive with a fresh random UUID, so a same-key
  // re-drive minted a SECOND unreachable run (the orphan) while the wave surface stayed bound to
  // the first; a wave-namespaced derivation re-attaches the SAME run instead. Pinned over a
  // LIVE wave (a terminal same-key re-drive refuses wave_already_terminal by design, #183 — the
  // driver's idempotent resume path is allowTerminalReplay over createWave).
  const repo = root('same');
  const logDir = root('same-log');
  mkdirSync(join(repo, 'briefs'), { recursive: true });
  mkdirSync(join(repo, 'reports'), { recursive: true });
  writeFileSync(join(repo, 'briefs', 'worker.md'), 'write the identical report (marker:worker)\n');
  t.after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(logDir, { recursive: true, force: true }); });

  // First spawn holds the member mid-turn (the wave stays LIVE for the re-drive); any later
  // spawn completes immediately. The briefs are byte-identical across both drives — only the
  // salt derivation can make the re-drive idempotent.
  const adapter = new MockAdapter({ scenario: { outcome: 'completed' } });
  let spawns = 0;
  const native = adapter.spawn.bind(adapter);
  adapter.spawn = (worker, brief, options) => {
    spawns += 1;
    const scenario = spawns === 1
      ? { outcome: 'completed', edits: [{ path: 'reports/worker.md', content: 'first drive result\n', delayMs: 3_000 }] }
      : { outcome: 'completed', edits: [{ path: 'reports/worker.md', content: 're-drive result\n' }] };
    return native(worker, brief, { ...options, scenario });
  };
  const host = openHost(repo, logDir, adapter);
  t.after(() => shutdown(host));

  const spec = {
    schemaVersion: 1,
    idempotencyKey: 'wave-key-S',
    members: [{
      role: 'worker', objectiveRef: 'briefs/worker.md',
      exact: { harness: 'mock', model: 'mock-model', effort: 'low' },
      scope: ['reports/**'], report: 'reports/worker.md',
    }],
    steering: {},
  };

  // Drive 1 mid-flight — the same-key re-drive arrives while the wave is live.
  const drive1 = runWorkflow(host.baton, spec, { repoRoot: repo, driver: { pollIntervalMs: 15, stallTimeoutMs: 400 } });
  await until(async () => {
    const list = await host.baton.runs.list();
    return list.items.length === 1 && ['working', 'running', 'pre_delivery', 'post_delivery'].includes(list.items[0].phase);
  }, 'wave 1 member mid-turn (the wave is live)');

  const drive2 = runWorkflow(host.baton, spec, { repoRoot: repo, driver: { pollIntervalMs: 15, stallTimeoutMs: 400 } });
  await drive2;

  const listed = await host.baton.runs.list();
  assert.equal(listed.items.length, 1,
    'the same-key re-drive derives the SAME member run — never a second unreachable orphan');
  await drive1;
});
