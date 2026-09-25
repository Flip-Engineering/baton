// run-admission-readiness-red.test.mjs — Issue #324: run admission consults route readiness
// pre-effect. The deployment facade already refuses recruits on blocked routes (recruit
// admission, #295 item 4), but `run.start` commands reaching the inner application — the
// resident path every `baton run` / `baton explore` takes over the socket, the wave-member
// path, the swarm-recruit path — admitted without consulting readiness: goal/plan records
// minted (approvable), then worktree, capacity reservation and worker spawn at dispatch.
// Run admission must reuse the ONE readiness derivation and refuse BEFORE any effect with
// a typed refusal carrying the blocked row (state, code, summary).
//
// Hermetic: temp dirs under os.tmpdir() only; HOME/XDG sandbox the muse auth file lookup;
// keychainRead is an explicit null (the real keychain is never touched); no provider
// process, no network, no quota.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDriver, MockAdapter, openBaton } from '../src/index.mjs';
import { BatonApplication } from '../src/application.mjs';
import { routeAdmissionGate } from '../src/application-deployment.mjs';
import { ProviderQuotaAuthority } from '../src/route-quota.mjs';

const MUSE_MODEL = 'muse-spark-1.3-contributor';
const MUSE_ROUTE = Object.freeze({ harness: 'muse', model: MUSE_MODEL, effort: 'high' });

// A file-backed login: the shape `TBH_CREDENTIAL_BACKEND=file muse login` provisions. Bogus
// token, never sent anywhere: readiness resolves shape presence only, never validity.
const MUSE_FILE_BACKED_AUTH = () => JSON.stringify({
  schema_version: 2,
  providers: {
    meta: {
      mechanism: 'oauth', storage: 'file', obtained_via: 'device_code',
      api_base_url: 'https://api.meta.ai/v1',
      user_full_name: 'Fixture User', user_email: 'fixture@example.invalid',
      access_token: 'bogus-token-for-shape-probe', expires_at: 4102444800,
    },
  },
});

const MUSE_WORKER_POLICY = Object.freeze({
  schemaVersion: 1,
  autonomy: {
    supported: ['unattended'], default: 'unattended', perTask: false,
    observation: 'launch', mechanisms: ['permission-mode-yolo'],
  },
  access: {
    supported: ['full'], default: 'full', perTask: false,
    observation: 'launch', mechanisms: ['muse-unsandboxed-permissions'],
  },
  containment: {
    hostProcess: 'same_uid', guarantees: ['private_runtime'],
    configuredPreferences: ['worktree-cwd', 'profile-isolation'], observation: 'unavailable',
  },
});

const principal = (id) => ({ actor: `pin:${id}`, principalId: id, sessionId: `${id}-session` });

function fixtureRepo(t, label) {
  const root = mkdtempSync(join(tmpdir(), `baton-run-admission-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'run-admission@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Run admission'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# run admission fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  return { root, repo };
}

function fixtureHome(t, label, authContents = null) {
  const home = mkdtempSync(join(tmpdir(), `baton-run-admission-${label}-home-`));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  if (authContents !== null) {
    mkdirSync(join(home, 'muse'), { recursive: true });
    writeFileSync(join(home, 'muse', 'auth.json'), authContents, { mode: 0o600 });
  }
  return home;
}

/** Scope HOME/XDG_CONFIG_HOME at a fixture home for one closure (sync or async). */
async function withFixtureHome(home, fn) {
  const previousHome = process.env.HOME;
  const previousXdg = process.env.XDG_CONFIG_HOME;
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = home;
  try {
    return await fn();
  } finally {
    process.env.HOME = previousHome;
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
  }
}

// The card a muse route matches: satisfies every pre-existing readiness gate (exact route
// match, observed version, the #230 worker policy), so each row's verdict is decided by the
// muse credential derivation alone. Spawn is counted: any worker spawn is an effect the
// admission must precede.
function museAdapter(spawnCalls) {
  const adapter = new MockAdapter({
    harness: 'muse',
    scenario: { outcome: 'completed', delayMs: 1, summary: 'must not launch', files: {} },
  });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    version: '1.0.0',
    authPosture: 'subscription',
    modelSelection: {
      mode: 'exact', configuredDefault: MUSE_MODEL, available: [MUSE_MODEL], family: 'muse',
      acceptedPrefixes: ['muse-'], acceptedAliases: [],
      reasoningEffort: ['low', 'medium', 'high', 'xhigh', 'max'],
      serviceTier: null, provenance: 'run-admission-readiness-fixture', refreshedAt: null,
    },
    workerPolicy: MUSE_WORKER_POLICY,
    permissions: { mode: 'never', sandbox: 'danger-full-access', boundary: 'run-admission-readiness fixture' },
  });
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = (...args) => { spawnCalls.count += 1; return spawn(...args); };
  return adapter;
}

function goalPlanAuthority(repoId) {
  return {
    policy: Object.freeze({
      schemaVersion: 1, repoId, mandatory: true,
      approvalTtlMs: 60 * 60 * 1000,
      riskClasses: ['low', 'medium', 'high', 'critical'],
      effectClasses: ['repository_edit', 'provider_call'],
      capabilityClasses: ['code', 'test'],
      limits: Object.freeze({
        maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
        maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
        maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
        maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
      }),
    }),
    authorize: async () => true,
  };
}

// Open the fixture deployment over a fixture HOME: the muse row's verdict is decided by the
// auth file there (or its absence). Returns the open deployment plus its doctor rows.
async function openMuseDeployment(t, label, { authContents = null } = {}) {
  const fixture = fixtureRepo(t, label);
  const home = fixtureHome(t, label, authContents);
  const spawnCalls = { count: 0 };
  const deployment = await withFixtureHome(home, () => openBaton({
    repo: fixture.repo,
    advanced: {
      deploymentRoot: join(fixture.root, 'deployment'),
      museCredentials: { keychainRead: () => null },
      adapters: { muse: museAdapter(spawnCalls) },
      routes: [{ ...MUSE_ROUTE }],
      verification: { command: process.execPath, arguments: ['--version'] },
      capacity: {
        estimate: () => ({ bytes: 1, inodes: 1 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
    },
  }));
  t.after(async () => { try { await deployment.close(); } catch {} });
  const doctor = await deployment.doctor();
  const row = doctor.routes.find((route) => (
    route.harness === MUSE_ROUTE.harness && route.model === MUSE_ROUTE.model && route.effort === MUSE_ROUTE.effort
  ));
  assert.ok(row, 'the fixture deployment must serve the muse row under test');
  return { deployment, row, spawnCalls };
}

// The inner application behind a deployment: the same admission seam the resident serves
// `run.start` on, wired to the deployment's own readiness rows through the ONE gate —
// never a second derivation.
async function innerApplication(t, label, readiness, spawnCalls) {
  const repo = mkdtempSync(join(tmpdir(), `baton-run-admission-${label}-approot-`));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const logDir = mkdtempSync(join(tmpdir(), `baton-run-admission-${label}-applog-`));
  t.after(() => rmSync(logDir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'run-admission@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Run admission'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const repoId = `repo-run-admission-${label}`;
  const driver = createDriver({
    repoRoot: repo, repoId, logDir, now: () => Date.now(),
    adapters: { muse: museAdapter(spawnCalls) },
    goalPlanAuthority: goalPlanAuthority(repoId),
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver, repoId,
    profiles: {
      default: {
        schemaVersion: 1,
        repoId,
        definitionOfDone: ['deployment verification passes'],
        constraints: [],
        risk: 'high',
        goalBudget: { tokens: 40_000, usd: 4, wallMin: 20, providerTurns: 12 },
        nodeBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 6 },
        pathScope: ['impl/**'],
        verification: { command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024, requiredPredecessorEvidence: [] },
        routes: [{ ...MUSE_ROUTE }],
        capabilities: ['code', 'test'],
        effects: ['repository_edit'],
        integrationPolicy: { mode: 'none', strategies: [], requireAdoptedResult: false, requireSemanticReview: false },
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      },
    },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'),
      observer: principal('observer'),
    },
    authorize: async () => true,
    // Issue #324: run admission reads the deployment's readiness through the same gate
    // recruit admission reads — the deployment's rows, the deployment's quota authority.
    routeAdmission: routeAdmissionGate(readiness, new ProviderQuotaAuthority({ now: Date.now, maxEntries: 1 })),
  });
  await application.ready;
  t.after(async () => { try { await application.shutdown(principal('owner')); } catch {} });
  return application;
}

test('RUN-ADMISSION-READINESS 1: run.start on a blocked muse route refuses with the readiness row before any effect', async (t) => {
  const { row, spawnCalls } = await openMuseDeployment(t, 'blocked-run');
  assert.equal(row.state, 'blocked', 'fixture premise: the muse row is blocked');
  assert.equal(row.code, 'authentication_required', 'fixture premise: no login provisions the route');
  const application = await innerApplication(t, 'blocked-run', { routes: [row], ready: false }, spawnCalls);

  const runId = 'run-admission-blocked-1';
  await assert.rejects(
    application.command('run.start', {
      intent: { runId, objective: 'Admit this run on a blocked muse route', route: { ...MUSE_ROUTE } },
    }, principal('owner')),
    (error) => error?.code === row.code
      && error?.state === 'blocked'
      && error?.message === row.summary
      && /`muse login`/u.test(error?.message ?? ''),
    'run admission must refuse with the blocked readiness row (state, code, summary)',
  );
  assert.equal(spawnCalls.count, 0, 'no worker spawn may precede the refusal');
  await assert.rejects(
    application.command('run.inspect', { runId, depth: 'outline' }, principal('owner')),
    (error) => error?.code === 'application_run_not_found',
    'the refused run must leave no goal/plan record behind (nothing approvable)',
  );
});

test('RUN-ADMISSION-READINESS 2: explore on a blocked muse route refuses with the same readiness row', async (t) => {
  const { row, spawnCalls } = await openMuseDeployment(t, 'blocked-explore');
  assert.equal(row.state, 'blocked', 'fixture premise: the muse row is blocked');
  const application = await innerApplication(t, 'blocked-explore', { routes: [row], ready: false }, spawnCalls);

  const runId = 'run-admission-blocked-2';
  await assert.rejects(
    application.command('run.start', {
      intent: {
        runId, objective: 'Explore on a blocked muse route', route: { ...MUSE_ROUTE },
        resultIntent: 'read_only_evidence',
      },
    }, principal('owner')),
    (error) => error?.code === row.code
      && error?.state === 'blocked'
      && error?.message === row.summary,
    'explore admission must refuse with the blocked readiness row (state, code, summary)',
  );
  assert.equal(spawnCalls.count, 0, 'no worker spawn may precede the refusal');
  await assert.rejects(
    application.command('run.inspect', { runId, depth: 'outline' }, principal('owner')),
    (error) => error?.code === 'application_run_not_found',
    'the refused explore must leave no goal/plan record behind (nothing approvable)',
  );
});

test('RUN-ADMISSION-READINESS 3: the deployment facade refuses run and explore on the same blocked rows', async (t) => {
  const { deployment, row, spawnCalls } = await openMuseDeployment(t, 'blocked-facade');
  assert.equal(row.state, 'blocked', 'fixture premise: the muse row is blocked');

  await assert.rejects(
    deployment.run('Facade run on a blocked muse route.', { exact: { ...MUSE_ROUTE } }),
    (error) => error?.code === row.code && error?.state === 'blocked',
    'recruit admission (facade run) refuses with the blocked row',
  );
  await assert.rejects(
    deployment.explore('Facade explore on a blocked muse route.', { exact: { ...MUSE_ROUTE } }),
    (error) => error?.code === row.code && error?.state === 'blocked',
    'recruit admission (facade explore) refuses with the blocked row',
  );
  assert.equal(spawnCalls.count, 0, 'no worker spawn may precede the refusal');
  const listed = await deployment.runs.list();
  assert.deepEqual(listed?.items ?? listed ?? [], [], 'the refused runs must leave no run record behind');
});

test('RUN-ADMISSION-READINESS 4: a ready muse route still admits run.start to plan proposal', async (t) => {
  const { row, spawnCalls } = await openMuseDeployment(t, 'ready-run', { authContents: MUSE_FILE_BACKED_AUTH() });
  assert.equal(row.state, 'ready', `fixture premise: file-backed login serves the muse row (got ${row.code} ${row.summary})`);
  const application = await innerApplication(t, 'ready-run', { routes: [row], ready: true }, spawnCalls);

  const runId = 'run-admission-ready-1';
  const admitted = await application.command('run.start', {
    intent: { runId, objective: 'Admit this run on a ready muse route', route: { ...MUSE_ROUTE } },
  }, principal('owner'));
  assert.ok(admitted?.plan?.digest, 'a ready route still admits: run.start proposes a plan');
  assert.equal(spawnCalls.count, 0, 'admission stops at plan proposal; nothing is dispatched before approval');
});
