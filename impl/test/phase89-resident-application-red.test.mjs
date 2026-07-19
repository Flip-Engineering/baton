// Phase 89 RED contracts for the common resident application surface.
//
// These tests intentionally describe the smallest high-level Runs collection shared by a local
// deployment and an authenticated Web connection. They do not add another receipt-, worker-, or
// transport-oriented API: listing is a bounded observe operation, and attaching validates the Run
// through the existing progressive outline before returning a bound handle.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
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

function applicationFixture(name) {
  const repo = repository(name);
  const driver = createDriver({
    repoRoot: repo,
    repoId: REPO_ID,
    logDir: mkdtempSync(join(tmpdir(), `baton-phase89-resident-${name}-log-`)),
    adapters: { mock: adapter() },
    goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const authorizations = [];
  const application = new BatonApplication({
    driver,
    repoId: REPO_ID,
    profiles: { resident: profile() },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'),
      observer: principal('observer'),
    },
    authorize: async (request) => {
      authorizations.push(request);
      return true;
    },
  });
  return { application, authorizations, driver, repo };
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
    schemaVersion: 1, profile: profileName, repoId: REPO_ID,
  }), { mode: 0o600 });
  assert.equal(statSync(profilePath).mode & 0o077, 0);
  assert.equal(statSync(tokenPath).mode & 0o077, 0);
  assert.equal(statSync(selectorPath).mode & 0o077, 0);
  return {
    repo, home, configRoot, token,
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
  sessionRepoIds = [REPO_ID],
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
          repoId: REPO_ID,
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
