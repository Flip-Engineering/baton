// Phase 89 RED contracts for the common resident application surface.
//
// These tests intentionally describe the smallest high-level Runs collection shared by a local
// deployment and an authenticated Web connection. They do not add another receipt-, worker-, or
// transport-oriented API: listing is a bounded observe operation, and attaching validates the Run
// through the existing progressive outline before returning a bound handle.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS,
  APPLICATION_SEMANTIC_REGISTRY,
  BatonApplication,
  BatonRun,
  BatonWebClient,
  MockAdapter,
  bindBaton,
  connectBaton,
  createDriver,
  openBaton,
  validateApplicationCommandArgs,
} from '../src/index.mjs';

const REPO_ID = 'repo-phase89-resident';
const EXACT_ROUTE = Object.freeze({ harness: 'mock', model: 'resident-model', effort: 'high' });
const principal = (id) => ({
  actor: `direct:${id}`, principalId: id, sessionId: `${id}-session`,
});

const policy = Object.freeze({
  schemaVersion: 1,
  repoId: REPO_ID,
  mandatory: true,
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
});

function verification() {
  return {
    command: 'node', arguments: ['-e', 'process.exit(0)'], cwd: '.', envAllowlist: ['PATH'],
    expectExit: 0, expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
    requiredPredecessorEvidence: [],
  };
}

function profile() {
  return {
    schemaVersion: 1,
    repoId: REPO_ID,
    definitionOfDone: ['resident application contract is observable'],
    constraints: ['do not expose implementation coordinates'],
    risk: 'medium',
    goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
    nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
    pathScope: ['**'],
    verification: verification(),
    routes: [EXACT_ROUTE],
    capabilities: ['code', 'test'],
    effects: ['repository_edit'],
    resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
    followPolicy: {
      mode: 'enabled', maxWaitMs: 2_000, maxChanges: 16,
      maxResponseBytes: 64 * 1024, maxScanEvents: 128,
    },
  };
}

function adapter() {
  const instance = new MockAdapter({
    harness: EXACT_ROUTE.harness,
    scenario: { outcome: 'completed', delayMs: 0, summary: 'resident fixture complete' },
  });
  const card = instance.card.bind(instance);
  instance.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: EXACT_ROUTE.model, available: [EXACT_ROUTE.model],
      family: EXACT_ROUTE.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [EXACT_ROUTE.effort], serviceTier: null,
      provenance: 'phase89-test', refreshedAt: null,
    },
  });
  return instance;
}

function repository(name) {
  const root = mkdtempSync(join(tmpdir(), `baton-phase89-resident-${name}-`));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'phase89@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Phase 89'], { cwd: root });
  writeFileSync(join(root, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function applicationFixture(name, { clock, authorize } = {}) {
  const repo = repository(name);
  const logDir = mkdtempSync(join(tmpdir(), `baton-phase89-resident-${name}-log-`));
  const driver = createDriver({
    repoRoot: repo,
    repoId: REPO_ID,
    logDir,
    adapters: { mock: adapter() },
    goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const authorizations = [];
  const applicationOptions = {
    driver,
    repoId: REPO_ID,
    profiles: { resident: profile() },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'),
      observer: principal('observer'),
    },
    authorize: async (request) => {
      authorizations.push(request);
      return authorize ? authorize(request) : true;
    },
  };
  if (clock !== undefined) applicationOptions.clock = clock;
  const application = new BatonApplication(applicationOptions);
  return { application, authorizations, driver, repo, logDir, clock, authorize };
}

function cleanup(t, fixture) {
  t.after(async () => {
    try { await fixture.application.shutdown(principal('cleanup')); }
    catch {
      try { await fixture.application.detach(); } catch { /* fixture teardown */ }
      try { await fixture.driver.drainAndClose('phase89-resident-cleanup'); } catch { /* fixture teardown */ }
    }
  });
}

async function restartApplicationFixture(fixture) {
  await fixture.application.detach();
  const driver = createDriver({
    repoRoot: fixture.repo,
    repoId: REPO_ID,
    logDir: fixture.logDir,
    adapters: { mock: adapter() },
    goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const authorizations = [];
  const options = {
    driver,
    repoId: REPO_ID,
    profiles: { resident: profile() },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'),
      observer: principal('observer'),
    },
    authorize: async (request) => {
      authorizations.push(request);
      return fixture.authorize ? fixture.authorize(request) : true;
    },
  };
  if (fixture.clock !== undefined) options.clock = fixture.clock;
  fixture.driver = driver;
  fixture.authorizations = authorizations;
  fixture.application = new BatonApplication(options);
  await fixture.application.ready;
  return fixture.application;
}

function intent(runId) {
  return {
    runId,
    objective: `Observe ${runId} through the resident Runs collection`,
    profile: 'resident',
    route: EXACT_ROUTE,
    scope: ['**'],
  };
}

function collectKeys(value, into = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectKeys(child, into);
    return into;
  }
  if (!value || typeof value !== 'object') return into;
  for (const [key, child] of Object.entries(value)) {
    into.push(key);
    collectKeys(child, into);
  }
  return into;
}

function connectionFixture(name) {
  const repo = repository(`connect-${name}`);
  const repoId = `repo-${createHash('sha256').update(realpathSync(join(repo, '.git')))
    .digest('hex').slice(0, 32)}`;
  const home = mkdtempSync(join(tmpdir(), `baton-phase89-connect-${name}-home-`));
  const configRoot = join(home, 'config');
  const profilesRoot = join(configRoot, 'baton', 'connections');
  const repositoryAuthorityRoot = join(repo, '.git', 'baton');
  const profileName = `phase89-${name}`;
  const profilePath = join(profilesRoot, `${profileName}.json`);
  const tokenPath = join(profilesRoot, `${profileName}.token`);
  const selectorPath = join(repositoryAuthorityRoot, 'connection.json');
  const token = `phase89-private-${name}-bearer`;
  mkdirSync(profilesRoot, { recursive: true });
  mkdirSync(repositoryAuthorityRoot, { recursive: true });
  writeFileSync(profilePath, JSON.stringify({
    schemaVersion: 1,
    url: 'https://resident.baton.test',
    origin: 'https://control.baton.test',
    tokenFile: `${profileName}.token`,
  }), { mode: 0o600 });
  writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  writeFileSync(selectorPath, JSON.stringify({
    schemaVersion: 1, profile: profileName, repoId,
  }), { mode: 0o600 });
  assert.equal(statSync(profilePath).mode & 0o077, 0);
  assert.equal(statSync(tokenPath).mode & 0o077, 0);
  assert.equal(statSync(selectorPath).mode & 0o077, 0);
  return {
    repo, repoId, home, configRoot, token,
    advanced: {
      env: { HOME: home, XDG_CONFIG_HOME: configRoot },
      home,
      ownerUid: typeof process.getuid === 'function' ? process.getuid() : null,
      commandTimeoutMs: 1_000,
      pollMs: 10,
      clock: () => Date.parse('2026-07-19T12:00:00.000Z'),
      sleep: async () => {},
    },
  };
}

function response(body, ok = true) {
  return { ok, async json() { return body; } };
}

function residentFetch(fixture, {
  ready = true,
  registryDigest = APPLICATION_SEMANTIC_REGISTRY.digest,
  sessionRepoIds = [fixture.repoId],
  cardRepoId = fixture.repoId,
} = {}) {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const pathname = new URL(url).pathname;
    requests.push({ pathname, options });
    if (pathname === '/readyz') return response({ ready });
    if (pathname === '/v1/application-card') {
      return response({
        ok: true,
        application: {
          schemaVersion: 1,
          repoId: cardRepoId,
          commands: [
            'application.help', 'runs.list', 'run.start', 'run.inspect', 'run.act', 'run.stop',
          ],
          agentExperience: { registryDigest },
        },
      });
    }
    if (pathname === '/v1/session') {
      return response({
        ok: true,
        identity: {
          userId: 'phase89-operator',
          sessionId: 'phase89-session',
          capabilities: ['observe', 'control'],
          repoIds: sessionRepoIds,
        },
        expiresAt: '2026-07-19T13:00:00.000Z',
      });
    }
    if (pathname === '/v1/commands') {
      const envelope = JSON.parse(options.body);
      if (envelope.command === 'runs_list') {
        return response({
          ok: true,
          status: 'completed',
          result: {
            schemaVersion: 1,
            registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
            items: [{
              id: 'run-connected', objective: 'Connected resident Run', phase: 'running',
            }],
            continuation: null,
          },
        });
      }
      if (envelope.command === 'run_inspect') {
        return response({
          ok: true,
          status: 'completed',
          result: {
            schemaVersion: 1,
            runId: 'run-connected',
            depth: 'outline',
            registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
            viewDigest: 'b'.repeat(64),
            outline: {
              runId: 'run-connected', objective: 'Connected resident Run', phase: 'running',
            },
            terminal: false,
          },
        });
      }
      throw new Error(`unexpected resident command ${envelope.command}`);
    }
    throw new Error(`unexpected resident request ${pathname}`);
  };
  return { fetchImpl, requests };
}

test('RA1 RED: runs.list is one bounded authenticated observe operation in the application registry', () => {
  assert.deepEqual(APPLICATION_COMMAND_DEFINITIONS['runs.list'], {
    args: [],
    capabilities: ['observe'],
    web: true,
    mcp: true,
    mcpStateful: false,
    reconcilable: true,
  });
  assert.deepEqual(APPLICATION_SEMANTIC_REGISTRY.operations['runs.list'], {
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
    helpTopic: 'runs',
    idempotent: true,
    destructive: false,
  });
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.defaultOperations.includes('runs.list'), true);

  assert.equal(validateApplicationCommandArgs('runs.list', {}), true);
  for (const invalid of [
    { limit: 1 }, { cursor: 'caller-managed-page' }, { receiptCursor: 12 },
  ]) {
    assert.throws(
      () => validateApplicationCommandArgs('runs.list', invalid),
      (error) => error?.code === 'application_run_list_invalid',
    );
  }
});

test('RA2 RED: BatonApplication returns a server-bounded safe summary and authorizes each visible Run', async (t) => {
  const fixture = applicationFixture('application-list');
  cleanup(t, fixture);
  await fixture.application.ready;
  const owner = principal('owner');
  for (const runId of ['run-phase89-a', 'run-phase89-b']) {
    await fixture.application.command('run.start', { intent: intent(runId) }, owner);
  }
  fixture.authorizations.length = 0;

  const listed = await fixture.application.command('runs.list', {}, owner);
  assert.equal(listed.schemaVersion, 1);
  assert.equal(typeof listed.registryDigest, 'string');
  assert.equal(listed.items.length, 2);
  assert.equal(listed.continuation, null);
  for (const item of listed.items) {
    assert.equal(typeof item.id, 'string');
    assert.equal(typeof item.objective, 'string');
    assert.equal(typeof item.phase, 'string');
  }
  assert.deepEqual(
    fixture.authorizations.map(({ command, principal: caller, repoId, runId, subject }) => ({
      command, principalId: caller.principalId, repoId, runId, operation: subject.operation,
    })),
    [
      {
        command: 'runs.list', principalId: owner.principalId, repoId: REPO_ID,
        runId: null, operation: 'runs.list',
      },
      ...listed.items.map(({ id }) => ({
        command: 'run.status', principalId: owner.principalId, repoId: REPO_ID,
        runId: id, operation: 'runs.list',
      })),
    ],
  );

  const forbiddenKeys = new Set([
    'receipt', 'receipts', 'ledger', 'ledgerSeq', 'pid', 'workerId', 'workers',
    'budget', 'goalBudget', 'nodeBudget', 'maxFiles', 'maxBytes', 'maxResponseBytes',
    'maxScanEvents', 'sessionId', 'worktree', 'path', 'ref', 'sha',
  ]);
  for (const key of collectKeys(listed)) {
    assert.equal(forbiddenKeys.has(key), false, `ordinary Runs listing leaked ${key}`);
  }
});

test('RA3 RED: bound BatonRuns lists and asynchronously validates attach through one outline read', async () => {
  const calls = [];
  const caller = principal('remote-orchestrator');
  const application = {
    async command(name, args, receivedPrincipal) {
      calls.push({ name, args, principal: receivedPrincipal });
      if (name === 'runs.list') {
        return {
          schemaVersion: 1,
          items: [{ id: 'run-known', objective: 'Known resident Run', phase: 'running' }],
          continuation: null,
        };
      }
      if (name === 'run.inspect' && args.runId === 'run-known') {
        return {
          schemaVersion: 1,
          runId: 'run-known',
          depth: 'outline',
          registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
          viewDigest: 'a'.repeat(64),
          outline: { runId: 'run-known', objective: 'Known resident Run', phase: 'running' },
          terminal: false,
        };
      }
      throw Object.assign(new Error(`unknown run ${args.runId}`), {
        code: 'application_run_not_found',
      });
    },
  };
  const baton = bindBaton(application, caller);

  const listed = await baton.runs.list();
  assert.deepEqual(listed.items.map(({ id }) => id), ['run-known']);
  const attaching = baton.runs.attach('run-known');
  assert.ok(attaching && typeof attaching.then === 'function', 'attach must validate asynchronously');
  const attached = await attaching;
  assert.ok(attached instanceof BatonRun);
  assert.equal(attached.id, 'run-known');
  assert.equal(attached.objective, 'Known resident Run');
  assert.equal(attached.last.outline.phase, 'running');

  await assert.rejects(
    baton.runs.attach('run-missing'),
    (error) => error?.code === 'application_run_not_found',
  );
  assert.deepEqual(calls, [
    { name: 'runs.list', args: {}, principal: caller },
    { name: 'run.inspect', args: { runId: 'run-known', depth: 'outline' }, principal: caller },
    { name: 'run.inspect', args: { runId: 'run-missing', depth: 'outline' }, principal: caller },
  ]);
});

test('RA4 RED: openBaton exposes the same Runs collection while preserving concise aliases', async (t) => {
  const repo = repository('deployment-runs');
  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot: mkdtempSync(join(tmpdir(), 'baton-phase89-resident-deployment-')),
      adapters: { mock: adapter() },
      routes: [EXACT_ROUTE],
      verification: { command: 'node', arguments: ['-e', 'process.exit(0)'] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({
          freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER,
        }),
      },
    },
  });
  t.after(async () => { try { await deployment.close(); } catch { /* fixture teardown */ } });
  await deployment.ready;

  assert.ok(deployment.runs && typeof deployment.runs === 'object');
  assert.equal(typeof deployment.runs.start, 'function');
  assert.equal(typeof deployment.runs.list, 'function');
  assert.equal(typeof deployment.runs.attach, 'function');
  assert.equal(typeof deployment.run, 'function', 'concise start alias remains available');
  assert.equal(typeof deployment.open, 'function', 'unchecked compatibility handle remains available');

  const listed = await deployment.runs.list();
  assert.equal(listed.schemaVersion, 1);
  assert.equal(typeof listed.registryDigest, 'string');
  assert.deepEqual(listed.items, []);
  assert.equal(listed.continuation, null);
  await assert.rejects(
    deployment.runs.attach('run-does-not-exist'),
    (error) => error?.code === 'application_run_not_found',
  );
});

test('RA5 RED: authenticated BatonWebClient transports runs.list with the same application envelope', async () => {
  const requests = [];
  const responses = [
    { ok: true, body: { ok: true, status: 'admitted' } },
    {
      ok: true,
      body: {
        ok: true,
        command: {
          status: 'completed',
          outcome: {
            httpStatus: 200,
            body: { ok: true, result: { schemaVersion: 1, items: [], continuation: null } },
          },
        },
      },
    },
  ];
  const client = new BatonWebClient({
    baseUrl: 'https://baton.test',
    origin: 'https://control.test',
    repoId: REPO_ID,
    token: 'private-bearer',
    commandTimeoutMs: 1_000,
    pollMs: 10,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      const response = responses.shift();
      return { ok: response.ok, async json() { return response.body; } };
    },
    clock: () => 0,
    sleep: async () => {},
  });

  assert.deepEqual(await client.command('runs.list', {}, 'runs-list-a'), {
    schemaVersion: 1, items: [], continuation: null,
  });
  const envelope = JSON.parse(requests[0].options.body);
  assert.equal(envelope.command, 'runs_list');
  assert.deepEqual(envelope.args, {});
  assert.equal(Object.hasOwn(envelope, 'runId'), false);
  assert.equal(envelope.repoId, REPO_ID);
  assert.equal(envelope.origin, 'https://control.test');
  assert.equal(requests[0].options.headers.authorization, 'Bearer private-bearer');
  assert.equal(requests[0].options.body.includes('private-bearer'), false);
});

test('RA6 RED: connectBaton discovers one repository authority and returns the common bound Runs facade', async () => {
  const fixture = connectionFixture('facade');
  const transport = residentFetch(fixture);
  const baton = await connectBaton({
    repo: fixture.repo,
    advanced: { ...fixture.advanced, fetchImpl: transport.fetchImpl },
  });

  assert.ok(baton.runs && typeof baton.runs === 'object');
  assert.equal(typeof baton.runs.list, 'function');
  assert.equal(typeof baton.runs.attach, 'function');
  const listed = await baton.runs.list();
  assert.deepEqual(listed.items.map(({ id }) => id), ['run-connected']);
  const attached = await baton.runs.attach('run-connected');
  assert.ok(attached instanceof BatonRun);
  assert.equal(attached.id, 'run-connected');
  assert.equal(attached.objective, 'Connected resident Run');
  assert.equal(attached.last.outline.phase, 'running');

  const paths = transport.requests.map(({ pathname }) => pathname);
  assert.equal(paths.filter((path) => path === '/readyz').length, 1);
  assert.equal(paths.filter((path) => path === '/v1/application-card').length, 1);
  assert.equal(paths.filter((path) => path === '/v1/session').length, 1);
  assert.equal(paths.filter((path) => path === '/v1/commands').length, 2);
  const handshakes = transport.requests.filter(({ pathname }) => (
    pathname === '/v1/application-card' || pathname === '/v1/session'
  ));
  for (const { options } of handshakes) {
    assert.equal(options.headers.authorization, `Bearer ${fixture.token}`);
  }

  const envelopes = transport.requests
    .filter(({ pathname }) => pathname === '/v1/commands')
    .map(({ options }) => JSON.parse(options.body));
  assert.deepEqual(envelopes.map(({ command }) => command), ['runs_list', 'run_inspect']);
  for (const envelope of envelopes) {
    assert.equal(typeof envelope.idempotencyKey, 'string');
    assert.match(envelope.idempotencyKey, /^[A-Za-z0-9._:-]{1,256}$/u);
    assert.equal(JSON.stringify(envelope.idempotencyKey).includes('bound-command-port'), false,
      'the bound Baton principal must never become a Web idempotency key');
    assert.equal(JSON.stringify(envelope).includes(fixture.token), false);
  }
});

test('RA7 RED: connectBaton rejects incompatible resident authority before admitting commands', async (t) => {
  const cases = [
    {
      name: 'wrong-registry',
      overrides: { registryDigest: 'f'.repeat(64) },
      code: 'cli_connection_incompatible',
    },
    {
      name: 'not-ready',
      overrides: { ready: false },
      code: 'cli_connection_incompatible',
    },
    {
      name: 'wrong-repo-session',
      overrides: { sessionRepoIds: ['repo-somewhere-else'] },
      code: 'cli_protocol_failed',
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const fixture = connectionFixture(scenario.name);
      const transport = residentFetch(fixture, scenario.overrides);
      await assert.rejects(
        connectBaton({
          repo: fixture.repo,
          advanced: { ...fixture.advanced, fetchImpl: transport.fetchImpl },
        }),
        (error) => error?.code === scenario.code,
      );
      assert.equal(
        transport.requests.some(({ pathname }) => pathname === '/v1/commands'),
        false,
        'an incompatible handshake must fail before command admission',
      );
      const serialized = JSON.stringify(transport.requests);
      assert.equal(serialized.includes(fixture.token), true,
        'authenticated card/session handshakes use the private token');
      assert.equal(serialized.includes('bound-command-port'), false);
    });
  }
});

test('RA8 RED: list and attached outlines project stable progress anchors without semantic clock churn', async (t) => {
  let observedMs = Date.now() + 60_000;
  const clock = () => new Date(observedMs).toISOString();
  const fixture = applicationFixture('progress-timing', { clock });
  cleanup(t, fixture);
  await fixture.application.ready;
  const owner = principal('timing-owner');
  const runId = 'run-phase89-progress-timing';
  await fixture.application.command('run.start', { intent: intent(runId) }, owner);

  const first = await fixture.application.command('run.inspect', {
    runId, depth: 'outline',
  }, owner);
  const listed = await fixture.application.command('runs.list', {}, owner);
  const item = listed.items.find((candidate) => candidate.id === runId);
  assert.ok(item, 'the admitted Run is discoverable');
  for (const key of [
    'startedAt', 'stage', 'lastProgress', 'completedAt', 'observedAt', 'elapsedMs', 'silenceMs',
  ]) {
    assert.equal(Object.hasOwn(first.outline, key), true, `outline is missing ${key}`);
    assert.equal(Object.hasOwn(item, key), true, `Run summary is missing ${key}`);
  }
  assert.equal(first.outline.stage, first.outline.progress.current);
  assert.equal(item.stage, first.outline.stage);
  assert.equal(item.startedAt, first.outline.startedAt);
  assert.deepEqual(item.lastProgress, first.outline.lastProgress);
  assert.equal(item.completedAt, null);
  assert.equal(first.outline.completedAt, null);
  assert.equal(first.outline.elapsedMs, observedMs - Date.parse(first.outline.startedAt));
  assert.equal(first.outline.silenceMs, observedMs - Date.parse(first.outline.lastProgress.at));
  assert.ok(first.outline.elapsedMs >= 0);
  assert.ok(first.outline.silenceMs >= 0);

  const bound = bindBaton(fixture.application, owner);
  const attached = await bound.runs.attach(runId);
  assert.equal(attached.last.outline.startedAt, first.outline.startedAt);
  assert.deepEqual(attached.last.outline.lastProgress, first.outline.lastProgress);

  observedMs += 5_000;
  const later = await fixture.application.command('run.inspect', {
    runId, depth: 'outline', cursor: first.cursor,
  }, owner);
  assert.equal(later.outline.elapsedMs, first.outline.elapsedMs + 5_000);
  assert.equal(later.outline.silenceMs, first.outline.silenceMs + 5_000);
  assert.equal(later.outline.observedAt, clock());
  assert.equal(later.outline.startedAt, first.outline.startedAt);
  assert.equal(later.outline.stage, first.outline.stage);
  assert.deepEqual(later.outline.lastProgress, first.outline.lastProgress);
  assert.equal(later.outline.completedAt, first.outline.completedAt);
  assert.equal(later.viewDigest, first.viewDigest,
    'observation time must be excluded from the semantic view digest');
  assert.equal(later.changed, false,
    'time passage alone must not report a semantic Run change');

  observedMs += 1_000;
  await fixture.application.command('run.stop', {
    runId, reason: 'Make terminal timing durable for replay.',
  }, owner);
  const terminal = await fixture.application.command('run.inspect', {
    runId, depth: 'outline',
  }, owner);
  assert.equal(terminal.terminal, true);
  assert.equal(typeof terminal.outline.completedAt, 'string');
  assert.equal(terminal.outline.silenceMs, 0);
  assert.equal(
    terminal.outline.elapsedMs,
    Date.parse(terminal.outline.completedAt) - Date.parse(terminal.outline.startedAt),
  );
  assert.ok(terminal.outline.elapsedMs >= 0);

  const terminalAnchors = {
    startedAt: terminal.outline.startedAt,
    stage: terminal.outline.stage,
    lastProgress: terminal.outline.lastProgress,
    completedAt: terminal.outline.completedAt,
    elapsedMs: terminal.outline.elapsedMs,
  };
  observedMs += 10_000;
  const replayedApplication = await restartApplicationFixture(fixture);
  const replayed = await replayedApplication.command('run.inspect', {
    runId, depth: 'outline',
  }, owner);
  assert.deepEqual({
    startedAt: replayed.outline.startedAt,
    stage: replayed.outline.stage,
    lastProgress: replayed.outline.lastProgress,
    completedAt: replayed.outline.completedAt,
    elapsedMs: replayed.outline.elapsedMs,
  }, terminalAnchors, 'restart/replay preserves all durable progress anchors');
  assert.equal(replayed.outline.silenceMs, 0);
  assert.equal(replayed.viewDigest, terminal.viewDigest);
});

test('RA9 RED: invalid or regressing application clocks never project negative durations', async (t) => {
  await t.test('regressing canonical clock clamps durations to zero', async (inner) => {
    let observedAt = '2000-01-01T00:00:00.000Z';
    const fixture = applicationFixture('regressing-clock', { clock: () => observedAt });
    cleanup(inner, fixture);
    await fixture.application.ready;
    const owner = principal('regressing-clock-owner');
    const runId = 'run-phase89-regressing-clock';
    await fixture.application.command('run.start', { intent: intent(runId) }, owner);
    const outline = await fixture.application.command('run.inspect', {
      runId, depth: 'outline',
    }, owner);
    assert.ok(Date.parse(observedAt) < Date.parse(outline.outline.startedAt));
    assert.equal(outline.outline.elapsedMs, 0);
    assert.equal(outline.outline.silenceMs, 0);
    const listed = await fixture.application.command('runs.list', {}, owner);
    assert.equal(listed.items[0].elapsedMs, 0);
    assert.equal(listed.items[0].silenceMs, 0);
    observedAt = '1999-01-01T00:00:00.000Z';
    const regressedAgain = await fixture.application.command('run.inspect', {
      runId, depth: 'outline', cursor: outline.cursor,
    }, owner);
    assert.equal(regressedAgain.outline.elapsedMs, 0);
    assert.equal(regressedAgain.outline.silenceMs, 0);
    assert.equal(regressedAgain.changed, false);
    assert.equal(regressedAgain.viewDigest, outline.viewDigest);
  });

  await t.test('malformed clock fails typed before timing is projected', async (inner) => {
    const fixture = applicationFixture('invalid-clock', { clock: () => 'not-an-iso-instant' });
    cleanup(inner, fixture);
    await fixture.application.ready;
    const owner = principal('invalid-clock-owner');
    const runId = 'run-phase89-invalid-clock';
    await fixture.application.command('run.start', { intent: intent(runId) }, owner);
    await assert.rejects(
      fixture.application.command('run.inspect', { runId, depth: 'outline' }, owner),
      (error) => error?.code === 'application_progress_clock_invalid',
    );
    await assert.rejects(
      fixture.application.command('runs.list', {}, owner),
      (error) => error?.code === 'application_progress_clock_invalid',
    );
  });
});

test('RA10 RED: connectBaton binds local Git, selector, card, and session to one repository ID', async (t) => {
  await t.test('selector cannot claim a different local Git repository', async () => {
    const fixture = connectionFixture('selector-local-mismatch');
    const selectorPath = join(fixture.repo, '.git', 'baton', 'connection.json');
    writeFileSync(selectorPath, JSON.stringify({
      schemaVersion: 1,
      profile: 'phase89-selector-local-mismatch',
      repoId: 'repo-not-this-local-checkout',
    }));
    const requests = [];
    await assert.rejects(
      connectBaton({
        repo: fixture.repo,
        advanced: {
          ...fixture.advanced,
          fetchImpl: async (...args) => {
            requests.push(args);
            throw new Error('selector mismatch must fail before transport');
          },
        },
      }),
      (error) => error?.code === 'cli_connection_incompatible',
    );
    assert.deepEqual(requests, []);
  });

  await t.test('resident card cannot claim a repository different from the selector and local Git', async () => {
    const fixture = connectionFixture('card-selector-mismatch');
    const transport = residentFetch(fixture, { cardRepoId: 'repo-not-the-selected-resident' });
    await assert.rejects(
      connectBaton({
        repo: fixture.repo,
        advanced: { ...fixture.advanced, fetchImpl: transport.fetchImpl },
      }),
      (error) => error?.code === 'cli_connection_incompatible',
    );
    assert.equal(
      transport.requests.some(({ pathname }) => pathname === '/v1/commands'),
      false,
    );
  });
});

test('RA11 RED: BatonWebClient refuses redirect/URL ambiguity and bounds declared and actual JSON', async (t) => {
  const options = (fetchImpl, overrides = {}) => ({
    baseUrl: 'https://resident.baton.test',
    origin: 'https://control.baton.test',
    repoId: REPO_ID,
    token: 'phase89-private-web-boundary',
    commandTimeoutMs: 1_000,
    pollMs: 10,
    fetchImpl,
    clock: () => Date.parse('2026-07-19T12:00:00.000Z'),
    sleep: async () => {},
    ...overrides,
  });
  const unusedFetch = async () => { throw new Error('invalid URL must fail before transport'); };
  for (const invalid of [
    { baseUrl: 'https://user:password@resident.baton.test' },
    { baseUrl: 'https://resident.baton.test?authority=other' },
    { baseUrl: 'https://resident.baton.test#other' },
    { origin: 'https://user:password@control.baton.test' },
    { origin: 'https://control.baton.test?authority=other' },
    { origin: 'https://control.baton.test#other' },
  ]) {
    assert.throws(
      () => new BatonWebClient(options(unusedFetch, invalid)),
      (error) => error?.code === 'cli_config_invalid',
    );
  }

  await t.test('every JSON request disables redirect following', async () => {
    const requests = [];
    const documents = new Map([
      ['/readyz', { ready: true }],
      ['/v1/application-card', { ok: true, application: { schemaVersion: 1 } }],
    ]);
    const client = new BatonWebClient(options(async (url, request) => {
      const pathname = new URL(url).pathname;
      requests.push({ pathname, request });
      const raw = JSON.stringify(documents.get(pathname));
      return {
        ok: true,
        headers: { get: (name) => name === 'content-length' ? String(Buffer.byteLength(raw)) : null },
        async text() { return raw; },
      };
    }));
    await client.doctor();
    assert.deepEqual(requests.map(({ pathname }) => pathname), ['/readyz', '/v1/application-card']);
    for (const { request } of requests) {
      assert.equal(request.redirect, 'error');
      assert.ok(request.signal instanceof AbortSignal);
    }
  });

  await t.test('declared oversize JSON is rejected before reading its body', async () => {
    let bodyRead = false;
    const client = new BatonWebClient(options(async () => ({
      ok: true,
      headers: { get: (name) => name === 'content-length' ? String((2 * 1024 * 1024) + 1) : null },
      async text() { bodyRead = true; return '{}'; },
    })));
    await assert.rejects(
      client.doctor(),
      (error) => error?.code === 'cli_protocol_failed',
    );
    assert.equal(bodyRead, false);
  });

  await t.test('actual oversize JSON is rejected when content length is absent', async () => {
    const oversized = JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) });
    const client = new BatonWebClient(options(async () => ({
      ok: true,
      headers: { get: () => null },
      async text() { return oversized; },
    })));
    await assert.rejects(
      client.doctor(),
      (error) => error?.code === 'cli_protocol_failed',
    );
  });
});

test('RA12 RED: unauthorized Runs do not consume the 64-visible-Run response ceiling', async (t) => {
  const hiddenRunId = 'run-phase89-ceiling-hidden';
  let revealHidden = false;
  const fixture = applicationFixture('authorization-ceiling', {
    authorize: (request) => {
      if (request.command === 'run.status' && request.subject?.operation === 'runs.list'
        && request.runId === hiddenRunId) return revealHidden;
      return true;
    },
  });
  cleanup(t, fixture);
  await fixture.application.ready;
  const owner = principal('ceiling-owner');
  const visibleRunIds = Array.from({ length: 64 }, (_, index) => (
    `run-phase89-ceiling-visible-${String(index).padStart(2, '0')}`
  ));
  for (const runId of [...visibleRunIds, hiddenRunId]) {
    await fixture.application.command('run.start', { intent: intent(runId) }, owner);
  }

  const visible = await fixture.application.command('runs.list', {}, owner);
  assert.equal(visible.items.length, 64);
  assert.deepEqual(
    visible.items.map(({ id }) => id).sort(),
    [...visibleRunIds].sort(),
  );
  assert.equal(visible.items.some(({ id }) => id === hiddenRunId), false);

  revealHidden = true;
  await assert.rejects(
    fixture.application.command('runs.list', {}, owner),
    (error) => error?.code === 'application_run_list_continuation_required',
    'the same durable state fails only when 65 Runs are visible to this principal',
  );
});

test('RA13 RED: deployment.runs.start and deployment.run share the exact route-readiness gate', async (t) => {
  const blocked = adapter();
  const card = blocked.card.bind(blocked);
  blocked.card = () => ({
    ...card(),
    readiness: {
      state: 'blocked',
      code: 'phase89_route_not_ready',
      summary: 'The Phase89 fixture route is deliberately unavailable.',
    },
  });
  const deployment = await openBaton({
    repo: repository('route-readiness-parity'),
    advanced: {
      deploymentRoot: mkdtempSync(join(tmpdir(), 'baton-phase89-route-readiness-')),
      adapters: { mock: blocked },
      routes: [EXACT_ROUTE],
      verification: { command: 'node', arguments: ['-e', 'process.exit(0)'] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({
          freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER,
        }),
      },
    },
  });
  t.after(async () => { try { await deployment.close(); } catch { /* fixture teardown */ } });
  await deployment.ready;
  const readiness = await deployment.doctor();
  assert.equal(readiness.routes[0].state, 'blocked');
  assert.equal(readiness.routes[0].code, 'phase89_route_not_ready');

  for (const start of [
    () => deployment.run('Blocked through the concise alias', EXACT_ROUTE),
    () => deployment.runs.start('Blocked through the common Runs collection', EXACT_ROUTE),
  ]) {
    await assert.rejects(
      async () => start(),
      (error) => error?.code === 'phase89_route_not_ready'
        && error?.route?.harness === EXACT_ROUTE.harness
        && error?.route?.model === EXACT_ROUTE.model
        && error?.route?.effort === EXACT_ROUTE.effort,
    );
  }
  assert.deepEqual((await deployment.runs.list()).items, [],
    'neither readiness failure may admit a Run');
});
