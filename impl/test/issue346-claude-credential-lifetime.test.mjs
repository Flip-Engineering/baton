// issue346-claude-credential-lifetime.test.mjs — Issue #346: a claude-code seat must never be
// admitted into a credential it cannot outlive, and a RUNNING seat must receive the deployment's
// refreshed credential before its next provider call.
//
// The observed failure (2026-09-17, seat claude-cli, worker w-25): readiness admitted the route
// without the access token's remaining lifetime, the token was materialised ONCE into the worker's
// environment at spawn, ~50 minutes and 368 tool calls later the provider answered `Failed to
// authenticate. API Error: 401 OAuth access token has expired.`, the seat was killed as a provider
// fault with zero edits — and the failed-turn summary told the WORKER to run `claude auth login`.
// The operator's credential was valid the whole time and Baton never re-projected it.
//
// This battery pins the before/during halves:
//   (a) readiness publishes the credential's `expiresAt` and whether the deployment can refresh it
//       (doctor row, route card, usage row);
//   (b) a route whose credential cannot outlive the lane's horizon with no refresh path is refused
//       PRE-EFFECT, naming the instant and the routes that ARE ready;
//   (c) a live seat's CLAUDE_CONFIG_DIR credential document is rewritten in place when the cache
//       adopts a refresh, atomically and access-token-only, and `runtime.scope_created` records the
//       mechanism that carried it;
//   (d) a 401 at expiry lands typed — `lifecycle.crashed {phase: 'provider', code:
//       'provider_auth_expired', expiresAt, mechanism}` plus a ROOT-side remedy — and the
//       failed-turn summary never tells the worker to log in.
//
// Hermetic: temp dirs under os.tmpdir() only; no network, no provider, no quota, no Keychain.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import {
  DEFAULT_BUDGET, claudeAuthenticationSummary, claudeCredentialExpirySummary, laneHorizonMs,
  openBatonDeployment,
} from '../src/application-deployment.mjs';
import { ClaudeSessionCli } from '../src/claude-session.mjs';
import { Log } from '../src/log.mjs';
import { runtimeIdentity } from '../src/runtime-isolation.mjs';

const CLAUDE_ROUTE = Object.freeze({
  harness: 'claude-code', provider: 'claude', model: 'claude-opus-4-6', effort: 'high',
});
const CODEX_ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });

/** #346's horizon is DERIVED from the deployment's own wall envelope (DEFAULT_BUDGET.wallMin) —
 * the same existing bound the profile's per-node budget, the approval TTL and the verification
 * timeout already use. This battery pins the derivation, not a number of its own. */
const HORIZON_MS = DEFAULT_BUDGET.wallMin * 60_000;

const routeLabel = (route) => `${route.harness}/${route.model}@${route.effort}`;
const iso = (ms) => new Date(ms).toISOString();

function repository(t, name) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue346-${name}-`));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue346@example.invalid', GIT_COMMITTER_EMAIL: 'issue346@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 346', GIT_COMMITTER_NAME: 'Issue 346' });
  writeFileSync(join(root, 'README.md'), '# issue 346 credential lifetime fixture\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function deploymentRoot(t, name) {
  const owner = mkdtempSync(join(tmpdir(), `baton-issue346-${name}-owner-`));
  t.after(() => rmSync(owner, { force: true, recursive: true }));
  return join(owner, 'deployment');
}

/** The operator credential wire (the vendor schema the cache reads): `refreshable: false` models a
 * credential the deployment has no refresh path for — a token with nothing to spend. */
function wire(expiresAt, { refreshable = true } = {}) {
  return {
    claudeAiOauth: {
      accessToken: `access-${expiresAt}`,
      ...(refreshable ? { refreshToken: `refresh-${expiresAt}` } : {}),
      expiresAt,
      refreshTokenExpiresAt: expiresAt + (24 * 60 * 60_000),
    },
  };
}

/** A double standing in for one real harness. The claude-code card publishes `family: 'claude'`
 * exactly as the real ClaudeSessionCli does, so the runtime identity the credential document is
 * keyed by is the production one. `ownsCredential` marks a caller-supplied adapter on another
 * harness (#327) so the codex alternative resolves readiness without any host credential. */
function fixtureAdapter(harness, routes, { family, ownsCredential = false, delayMs = 10 } = {}) {
  const adapter = new MockAdapter({
    harness,
    scenario: { outcome: 'completed', delayMs, summary: 'issue346 fixture', files: {} },
  });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    authPosture: 'subscription',
    concurrencyCeiling: null,
    ...(ownsCredential ? { providerCompatibility: { credentialState: 'available' } } : {}),
    modelSelection: {
      mode: 'exact',
      configuredDefault: routes[0].model,
      available: [...new Set(routes.map((route) => route.model))],
      family,
      acceptedPrefixes: [],
      acceptedAliases: [],
      reasoningEffort: [...new Set(routes.map((route) => route.effort))],
      serviceTier: null,
      provenance: 'issue346-fixture',
      refreshedAt: null,
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
  return adapter;
}

/** The fixture deployment: fixture adapters, the CC-1 credential shim (credential path + the
 * deployment clock + the refresh runtime), and a captured driver so the test can read the SAME
 * runtime registry the deployment re-projects through. */
async function openFixture(t, name, {
  credential, routes, refreshRuntime = null, delayMs = 10,
} = {}) {
  const repo = repository(t, name);
  const root = deploymentRoot(t, name);
  mkdirSync(root, { recursive: true });
  const credentialPath = join(root, 'operator-credentials.json');
  writeFileSync(credentialPath, `${JSON.stringify(credential)}\n`, { mode: 0o600 });

  const adapters = {};
  for (const route of routes) {
    const key = route.provider ? `${route.harness}:${route.provider}` : route.harness;
    const family = route.harness === 'claude-code' ? 'claude' : route.harness;
    adapters[key] = fixtureAdapter(route.harness, [route], {
      family, ownsCredential: route.harness !== 'claude-code', delayMs,
    });
  }

  let driverOptions = null;
  let driver = null;
  const deployment = await openBatonDeployment({
    repo,
    advanced: {
      deploymentRoot: root,
      adapters,
      routes,
      // A repo-relative executable name: the deployment's verification contract refuses an
      // absolute path, and this battery never runs a real verification.
      verification: { command: 'node', arguments: ['--version'] },
      claudeCredentials: {
        credentialPath,
        keychainRead: () => null,
        keychainMtime: () => null,
        ...(refreshRuntime ? { refreshRuntime } : {}),
      },
    },
  }, (options) => {
    driverOptions = options;
    driver = createDriver(options);
    return driver;
  });
  t.after(async () => { try { await deployment.close(); } catch { /* closed by the fixture */ } });
  return { deployment, driverOptions, driver, adapters, root };
}

function routeRow(doctor, route) {
  return doctor.routes.find((row) => row.harness === route.harness && row.model === route.model
    && row.effort === route.effort);
}

function usageRow(doctor, route) {
  return doctor.routeUsage.find((row) => row.route.harness === route.harness
    && row.route.model === route.model && row.route.effort === route.effort);
}

function readCredentialDocument(path) {
  const mode = statSync(path).mode & 0o777;
  return { mode, wire: JSON.parse(readFileSync(path, 'utf8')) };
}

// ── (a) readiness carries the credential's expiresAt and whether the deployment can refresh it ──

test('LIFETIME-346-A: the doctor row, the route card and the usage row publish expiresAt and refreshable', async (t) => {
  // A credential that expires 60s from now is INSIDE the lane horizon (480 min) — a deployment
  // that can refresh it admits the route anyway; the facts are what make that judgement possible.
  const expiresAt = Date.now() + 60_000;
  const { deployment } = await openFixture(t, 'readiness', {
    credential: wire(expiresAt),
    routes: [CLAUDE_ROUTE, CODEX_ROUTE],
  });

  const doctor = await deployment.doctor();
  const row = routeRow(doctor, CLAUDE_ROUTE);
  assert.equal(row.credential.expiresAt, expiresAt, 'the credential instant rides the doctor row');
  assert.equal(row.credential.refreshable, true,
    'and whether the deployment can refresh it at all — here a refresh token is present');
  assert.equal(row.state, 'ready',
    'a credential the deployment CAN refresh is admitted even when it expires inside the lane');

  const cardRow = deployment.card().readiness.routes
    .find((candidate) => candidate.harness === 'claude-code');
  assert.equal(cardRow.credential.expiresAt, expiresAt, 'the route card carries the same instant');
  assert.equal(cardRow.credential.refreshable, true, 'and the same refreshable fact');

  const usage = usageRow(doctor, CLAUDE_ROUTE);
  assert.equal(usage.credential.expiresAt, expiresAt, 'the usage row carries the same instant');
  assert.equal(usage.credential.refreshable, true, 'and the same refreshable fact');
  assert.equal(usage.state, 'ready');

  // Presence is the only fact published: neither the access token nor the refresh token crosses.
  const published = JSON.stringify(doctor);
  assert.equal(published.includes(`access-${expiresAt}`), false, 'the access token never crosses a row');
  assert.equal(published.includes(`refresh-${expiresAt}`), false, 'nor the refresh token');

  assert.equal(laneHorizonMs(), HORIZON_MS, 'the horizon IS the deployment wall envelope');
});

// ── (b) a credential the route cannot outlive, with no refresh path, refuses pre-effect ────────

test('LIFETIME-346-B: a route whose credential expires before the horizon with no refresh path is refused pre-effect', async (t) => {
  const expiresAt = Date.now() + 60_000;
  const { deployment, adapters } = await openFixture(t, 'horizon-refusal', {
    credential: wire(expiresAt, { refreshable: false }),
    routes: [CLAUDE_ROUTE, CODEX_ROUTE],
  });

  let spawns = 0;
  for (const adapter of Object.values(adapters)) {
    const spawn = adapter.spawn.bind(adapter);
    adapter.spawn = (...args) => { spawns += 1; return spawn(...args); };
  }

  const doctor = await deployment.doctor();
  const row = routeRow(doctor, CLAUDE_ROUTE);
  assert.equal(row.credential.refreshable, false, 'the deployment has no refresh path for this credential');
  assert.equal(row.credential.expiresAt, expiresAt);
  assert.equal(row.state, 'blocked', 'a route that cannot outlive its credential does not read ready');
  assert.equal(row.code, 'credential_expires_before_horizon');
  assert.equal(row.credentialExpiresAt, expiresAt, 'the row names the instant it judged');
  assert.equal(row.credentialHorizonMs, HORIZON_MS, 'and the horizon it judged it against');
  assert.match(row.summary, new RegExp(iso(expiresAt).replaceAll('.', '\\.')));
  // #523: the usage row's `state` reports the SUBSCRIPTION's provider-level facts, so a deployment
  // readiness block — this credential cannot outlive the lane's horizon — rides the doctor row and
  // the pre-effect refusal above, while the usage row publishes the credential facts it judged.
  const usage = usageRow(doctor, CLAUDE_ROUTE);
  assert.equal(usage.state, 'ready', 'a credential block is not a provider-level block');
  assert.equal(usage.credential.refreshable, false, 'the usage row carries the credential it judged');
  assert.equal(usage.credential.expiresAt, expiresAt);
  assert.equal(routeRow(doctor, CODEX_ROUTE).state, 'ready', 'the other route is untouched');
  assert.equal(doctor.ready, true, 'one ready route keeps the fleet usable');

  const refused = (error) => error?.code === 'credential_expires_before_horizon'
    && error?.state === 'blocked'
    && error?.expiresAt === expiresAt
    && error?.horizonMs === HORIZON_MS
    && error?.readyRoutes?.includes(routeLabel(CODEX_ROUTE)) === true
    && error.message.includes(iso(expiresAt))
    && error.message.includes(String(HORIZON_MS))
    && error.message.includes(routeLabel(CODEX_ROUTE));

  await assert.rejects(
    deployment.run('do the work', { exact: CLAUDE_ROUTE }),
    refused,
    'a recruit on a route that cannot outlive its credential is refused pre-effect, naming the instant and the ready alternative',
  );
  assert.equal(spawns, 0, 'the refusal precedes every adapter effect');

  await assert.rejects(
    deployment.explore('look around', { exact: CLAUDE_ROUTE }),
    refused,
    'run admission reaches the same refusal on the same derivation',
  );
  assert.equal(spawns, 0, 'and it too precedes every adapter effect');
});

// ── (c) a LIVE seat receives the refreshed credential ──────────────────────────────────────────

test('LIFETIME-346-C: the deployment re-projects a refreshed credential into a live seat, atomically and access-token-only', async (t) => {
  const expiresAt = Date.now() + 60 * 60_000;
  const refreshedAt = expiresAt + 60 * 60_000;
  const { deployment, driverOptions, driver, adapters } = await openFixture(t, 'rollover', {
    credential: wire(expiresAt),
    routes: [CLAUDE_ROUTE],
    refreshRuntime: async () => ({ candidate: wire(refreshedAt) }),
  });

  const adapter = adapters['claude-code:claude'];
  const observed = {};
  // The interception only OBSERVES (and drives the deployment's own refresh); every assertion
  // runs in the test body, so a failed assertion can never hang the awaited interception.
  let releaseObserved;
  const observedSpawn = new Promise((resolve) => { releaseObserved = resolve; });
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = async (...args) => {
    try {
      // At this instant the coordinator has already created the runtime scope: the seat is live.
      const [workerId, , spawnOptions] = args;
      const identity = runtimeIdentity({ card: adapter.card() });
      const config = join(driverOptions.runtimeIsolation.root, workerId, 'config', identity.family);
      observed.workerId = workerId;
      observed.config = config;
      observed.env = { ...(spawnOptions.env ?? {}) };
      observed.before = readCredentialDocument(join(config, '.credentials.json'));
      // The deployment's own credential refresh — the same seam a root drives.
      observed.reprojected = await deployment.credentials.refresh('claude').catch((error) => ({ error }));
      observed.after = readCredentialDocument(join(config, '.credentials.json'));
      observed.leftovers = readdirSync(config).filter((entry) => entry.endsWith('.tmp'));
    } catch (error) {
      observed.failure = error;
    } finally {
      releaseObserved();
    }
    return spawn(...args);
  };

  const run = await deployment.run('survive the token rollover', {
    harness: CLAUDE_ROUTE.harness, model: CLAUDE_ROUTE.model, effort: CLAUDE_ROUTE.effort,
  });
  await run.approve();
  await Promise.race([
    observedSpawn,
    new Promise((_, reject) => setTimeout(() => reject(new Error('the seat never spawned')), 10_000)),
  ]);
  assert.equal(observed.failure, undefined, `the live observation failed: ${observed.failure?.message}`);
  assert.equal(observed.reprojected?.error, undefined,
    `the credential refresh failed: ${observed.reprojected?.error?.message}`);

  assert.equal(observed.before.mode, 0o600, 'the projected credential document is owner-only');
  assert.equal(observed.before.wire.claudeAiOauth.accessToken, `access-${expiresAt}`,
    'the seat starts on the credential the deployment held at lease creation');
  assert.equal('refreshToken' in observed.before.wire.claudeAiOauth, false,
    'the refresh token never enters the worker scope');
  assert.equal(observed.after.mode, 0o600, 'and the rewrite is owner-only too');
  assert.equal(observed.after.wire.claudeAiOauth.accessToken, `access-${refreshedAt}`,
    'the refreshed credential reaches the LIVE seat before its next provider call');
  assert.equal('refreshToken' in observed.after.wire.claudeAiOauth, false,
    'still access-token-only after the rollover');
  assert.deepEqual(observed.leftovers, [], 'the atomic write leaves no temporary file behind');

  // The transport is the projected FILE: an env snapshot is exactly what #346 observed dying.
  assert.equal(observed.env.CLAUDE_CODE_OAUTH_TOKEN, undefined,
    'no spawn-time env token shadows the document');
  assert.equal(observed.env.CLAUDE_CONFIG_DIR,
    join(driverOptions.runtimeIsolation.root, observed.workerId, 'config', 'claude'),
    'and the seat resolves its credential at its own CLAUDE_CONFIG_DIR');

  // `runtime.scope_created.credential.mechanism` records the mechanism that carried it.
  const log = new Log(driverOptions.logDir);
  const scopes = log.workers().flatMap((worker) => log.byKind(worker, 'runtime.scope_created'));
  assert.equal(scopes.length >= 1, true, 'the lease records its creation');
  const scope = scopes.find((event) => event.worker === observed.workerId);
  assert.ok(scope, 'the live seat has its runtime.scope_created row');
  assert.deepEqual(scope.payload.credential,
    { mechanism: 'file', state: 'materialized', count: 1 },
    'the row names the file projection as the credential mechanism');
  assert.equal(scope.payload.active, true);

  assert.equal(typeof driver.coordinator?._runtimeScopes?.projectCredentialDocument, 'function',
    'the runtime the deployment re-projects through is the one the driver built');
});

// ── (d) a 401 at expiry lands typed, with the ROOT-side remedy ─────────────────────────────────

/** A minimal stand-in for `claude` speaking the real stream-json wire: it answers the first user
 * frame with the live 401-at-expiry result. */
function writeExpiredCredentialCli(root) {
  const path = join(root, 'expired-credential-claude.mjs');
  writeFileSync(path, [
    "import readline from 'node:readline';",
    "function send(object) { process.stdout.write(JSON.stringify(object) + '\\n'); }",
    "send({ type: 'system', subtype: 'init', session_id: 'issue346-expired', cwd: process.cwd(),",
    "  tools: [], model: 'claude-opus-4-6', permissionMode: 'bypassPermissions', apiKeySource: 'user',",
    "  claude_code_version: '2.1.211-fixture', capabilities: [] });",
    'let answered = false;',
    "readline.createInterface({ input: process.stdin, terminal: false }).on('line', (line) => {",
    '  let object;',
    '  try { object = JSON.parse(line); } catch { return; }',
    "  if (object.type !== 'user' || answered) return;",
    '  answered = true;',
    "  send({ type: 'result', subtype: 'error_during_execution', is_error: true,",
    "    result: 'Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.',",
    '    usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0.0001, stop_reason: null });',
    '});',
    "process.stdin.on('close', () => process.exit(0));",
    '',
  ].join('\n'));
  return path;
}

test('LIFETIME-346-D: a 401 at expiry lands as a typed provider crash with the root-side remedy, and never tells the worker to log in', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-issue346-expiry-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const cliPath = writeExpiredCredentialCli(root);
  const expiresAt = Date.now() - 1_000;
  let refreshes = 0;

  // The deployment cannot rescue it: the credential has expired and its refresh path is closed.
  const controller = {
    ensureFresh: async () => {},
    projectionEnv: () => ({}),
    metadata: () => ({ expiresAt, refreshable: false }),
    refresh: async () => {
      refreshes += 1;
      throw Object.assign(new Error('Claude refresh token is absent'), {
        code: 'authentication_refresh_required',
      });
    },
  };

  const cli = new ClaudeSessionCli({
    cmd: process.execPath,
    args: [cliPath],
    credentialController: controller,
    credentialMechanism: 'file',
    credentialExpirySummary: claudeCredentialExpirySummary,
    authenticationSummary: claudeAuthenticationSummary,
    killGraceMs: 20,
  });

  const events = [];
  let resolveTerminal;
  const terminal = new Promise((resolve) => { resolveTerminal = resolve; });
  cli.onEvent((event) => {
    events.push(event);
    if (event.kind === 'lifecycle.turn_completed') resolveTerminal(event);
  });

  const ack = await cli.spawn('issue346-worker', {
    goal: 'expire the credential mid-lane', constraints: [], pathScope: ['impl/**'],
    definitionOfDone: 'fixture', verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100, usd: 1, wallMin: 1 },
  }, { worktree: process.cwd(), env: { PATH: process.env.PATH }, replaceEnv: true });
  assert.equal(ack.ok, true);

  const completed = await Promise.race([
    terminal,
    new Promise((_, reject) => setTimeout(() => reject(new Error('fixture turn timeout')), 4_000)),
  ]);
  assert.equal(refreshes, 1, 'the deployment is asked once to re-materialise the credential');

  const result = completed.payload.result;
  assert.equal(result.status, 'failed');
  assert.equal(result.failure.code, 'provider_auth_expired',
    'the expired credential lands as the provider auth class, not as a bare refresh request');
  assert.match(result.summary, /re-project|re-recruit/u, 'the failed turn names the root-side remedy');
  assert.doesNotMatch(result.summary, /auth login|\/login/iu,
    'the failed-turn summary never tells the worker to log in');
  assert.equal(events.filter((event) => event.kind === 'lifecycle.turn_completed').length, 1);

  const crash = events.find((event) => event.kind === 'lifecycle.crashed');
  assert.ok(crash, 'the expiry lands as a typed crash cert');
  assert.equal(crash.payload.phase, 'provider');
  assert.equal(crash.payload.code, 'provider_auth_expired');
  assert.equal(crash.payload.expiresAt, expiresAt, 'with the credential instant the deployment held');
  assert.equal(crash.payload.mechanism, 'file', 'and the mechanism that carried it into the worker');
  assert.match(crash.payload.remedy, /re-project|re-recruit/u,
    'the row names the ROOT-side act (re-project / re-recruit)');
  assert.doesNotMatch(crash.payload.remedy, /auth login|\/login/iu,
    'and never sends the worker to a login flow it cannot complete');

  await cli.kill('issue346-worker');
});

// ── (e) the route row an auth refusal blocks names the ROOT-side remedy ────────────────────────

test('LIFETIME-346-E: a provider_auth_expired refusal blocks the route with the ROOT-side remedy on the row', async (t) => {
  const { deployment, driverOptions } = await openFixture(t, 'auth-block', {
    credential: wire(Date.now() + 60 * 60_000),
    routes: [CLAUDE_ROUTE],
  });
  const log = new Log(driverOptions.logDir);
  log.append({
    worker: 'issue346-refused', harness: CLAUDE_ROUTE.harness, turnEpoch: 1,
    kind: 'lifecycle.crashed', actor: 'worker',
    harnessResolved: CLAUDE_ROUTE.harness, modelResolved: CLAUDE_ROUTE.model,
    effortResolved: CLAUDE_ROUTE.effort,
    // The live capture that opened #346/#348, plus the typed class the session tier mints.
    payload: {
      phase: 'provider', code: 'provider_auth_expired',
      error: 'Failed to authenticate. API Error: 401 OAuth access token has expired.',
      usageSeal: null,
    },
  });

  const doctor = await deployment.doctor();
  const row = routeRow(doctor, CLAUDE_ROUTE);
  assert.equal(row.state, 'blocked');
  assert.equal(row.code, 'provider_auth_expired', 'the refusal blocks the route under the auth class');
  assert.equal(doctor.ready, false);
  assert.match(row.summary, /re-project|re-recruit/u,
    'the blocked row names the ROOT-side act that clears it (re-project / re-recruit)');
  assert.doesNotMatch(row.summary, /auth login|\/login/iu,
    'and never sends the reader to a login flow the worker cannot complete');
  assert.equal(usageRow(doctor, CLAUDE_ROUTE).lastProviderRefusal.code, 'provider_auth_expired');

  await assert.rejects(
    deployment.run('do the work', { exact: CLAUDE_ROUTE }),
    (error) => error?.code === 'provider_auth_expired' && error?.readyRoutes?.length === 0,
    'and the next recruit on the blocked route is refused pre-effect',
  );
});
