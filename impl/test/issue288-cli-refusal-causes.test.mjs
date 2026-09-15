// Issue #288 (U-F11, U-F12, U-E19): the CLI's two connection refusals are ONE cause table.
// Before this, `cli_config_invalid` folded ~20 violations (twelve of them behind the single string
// "user connection profile is invalid") and `cli_connection_incompatible` folded ten causes into one
// sentence that discarded the two registry digests the drift case knows. Each refusal now carries
// its typed cause, the field or path the client judged, and the remedy that fixes it.
//
// U-E19 rides the same seam: the schema-version verdict runs BEFORE the key closure, so a selector
// published by a newer resident is refused as version drift, never as "unknown or missing fields".
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CLI_CONNECTION_CAUSES, cliConnectionCauseRow, connectBaton, discoverBatonConnection,
} from '../src/application-cli.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';

const CLI_REGISTRY_DIGEST = APPLICATION_SEMANTIC_REGISTRY.digest;
const NOW = Date.parse('2026-09-14T12:00:00.000Z');
const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue288-${label}-`));
  roots.push(root);
  return root;
}

function repository(label) {
  const repo = join(scratch(`${label}-repo`), 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  return repo;
}

/** One published authority: the repository selector plus (optionally) the resident's user profile
 * and token. `selectorVersion` 2 is the resident publication (`baton serve`). */
function authority({ label, selectorVersion = 2, selector = {}, withProfile = false, profile = {} }) {
  const repo = repository(label);
  const repoId = `repo-${createHash('sha256').update(realpathSync(join(repo, '.git')))
    .digest('hex').slice(0, 32)}`;
  const home = scratch(`${label}-home`);
  const configRoot = join(home, 'config');
  const profilesRoot = join(configRoot, 'baton', 'connections');
  const authorityRoot = join(repo, '.git', 'baton');
  mkdirSync(profilesRoot, { recursive: true });
  mkdirSync(authorityRoot, { recursive: true });
  const profileName = `issue288-${label}`;
  writeFileSync(join(authorityRoot, 'connection.json'), JSON.stringify(selectorVersion === 2 ? {
    schemaVersion: 2, profile: profileName, repoId,
    deploymentId: 'deploy-issue288', incarnation: 'incarnation-issue288', transport: 'local',
    registryDigest: CLI_REGISTRY_DIGEST, startedAt: '2026-09-14T00:00:00.000Z', ...selector,
  } : { schemaVersion: selectorVersion, profile: profileName, repoId, ...selector }), { mode: 0o600 });
  if (withProfile) {
    writeFileSync(join(profilesRoot, `${profileName}.json`), JSON.stringify({
      schemaVersion: selectorVersion === 2 ? 2 : 1,
      url: 'https://resident.baton.test', origin: 'https://control.baton.test',
      tokenFile: `${profileName}.token`,
      ...(selectorVersion === 2 ? {
        transport: 'local', socketPath: '/tmp/b288.sock',
        deploymentId: 'deploy-issue288', incarnation: 'incarnation-issue288',
        registryDigest: CLI_REGISTRY_DIGEST, startedAt: '2026-09-14T00:00:00.000Z',
      } : {}),
      ...profile,
    }), { mode: 0o600 });
    writeFileSync(join(profilesRoot, `${profileName}.token`), 'issue288-private-bearer\n', { mode: 0o600 });
  }
  return {
    repo, repoId, home, configRoot, profileName, profilesRoot,
    env: { HOME: home, XDG_CONFIG_HOME: configRoot },
  };
}

function refusalOf(fn) {
  try { fn(); } catch (error) { return error; }
  return null;
}

const discover = (fixture) => refusalOf(() => discoverBatonConnection({
  cwd: fixture.repo, env: fixture.env, home: fixture.home,
}));

// -------------------------------------------------------------------------------------------
// The table itself: every cause has its own row, both codes are covered, and the ten
// connection-incompatible causes F11 named are all present.
// -------------------------------------------------------------------------------------------

const CONNECTION_INCOMPATIBLE_CAUSES = [
  'selector_repo_mismatch', 'resident_not_ready', 'served_application_schema_unsupported',
  'served_repo_mismatch', 'served_command_list_missing', 'required_commands_missing',
  'served_registry_digest_drift', 'served_limits_digest_drift', 'served_session_repo_not_served',
  'resident_deployment_mismatch', 'resident_incarnation_mismatch',
];

test('U-F11/U-F12: one cause table — every cause has a distinct row naming code, rule and remedy', () => {
  assert.ok(CLI_CONNECTION_CAUSES.length >= 50,
    `the table enumerates the whole connection surface (got ${CLI_CONNECTION_CAUSES.length})`);
  const rules = new Set();
  const codes = new Set();
  for (const cause of CLI_CONNECTION_CAUSES) {
    const row = cliConnectionCauseRow(cause);
    assert.equal(typeof cause, 'string');
    assert.match(cause, /^[a-z][a-z0-9_]*$/u, `${cause} is a typed cause identifier`);
    assert.ok(row !== null, `${cause} has a row`);
    assert.ok(['cli_config_invalid', 'cli_connection_incompatible', 'cli_transport_failed', 'cli_protocol_failed'].includes(row.code),
      `${cause}: the row is reported under one of the connection/transport codes (#313 widened the table)`);
    assert.ok(row.rule.length > 0 && row.remedy.length > 0, `${cause}: rule and remedy are present`);
    assert.equal(rules.has(row.rule), false, `${cause}: the rule text is its own`);
    rules.add(row.rule);
    codes.add(row.code);
  }
  assert.deepEqual([...codes].sort(), ['cli_config_invalid', 'cli_connection_incompatible', 'cli_protocol_failed', 'cli_transport_failed'],
    'every code the client composes is covered by one table');
  for (const cause of CONNECTION_INCOMPATIBLE_CAUSES) {
    assert.notEqual(cliConnectionCauseRow(cause), null, `${cause} (F11) has a row`);
    assert.equal(cliConnectionCauseRow(cause).code, 'cli_connection_incompatible');
  }
  assert.equal(cliConnectionCauseRow('not_a_cause'), null, 'an unregistered cause resolves to null');
});

// -------------------------------------------------------------------------------------------
// U-E19 — the schema verdict precedes the key closure.
// -------------------------------------------------------------------------------------------

test('U-E19: a newer selector schema is refused as version drift, not as unknown fields', () => {
  const fixture = authority({ label: 'schema3', selectorVersion: 3, selector: { futureField: true } });
  const refusal = discover(fixture);
  assert.equal(refusal?.cause, 'repository_selector_schema_unsupported');
  assert.equal(refusal?.code, 'cli_config_invalid');
  assert.equal(refusal?.field, 'schemaVersion');
  assert.match(refusal.message, /schemaVersion 3/u, 'the observed version is named');
  assert.doesNotMatch(refusal.message, /unknown or missing fields/u,
    'version drift is never reported as a key-closure violation');
  assert.ok(refusal.detail.remedy.length > 0, 'the remedy rides the refusal detail');
});

test('U-F12: a key-closure violation names the offending key, not just the artifact', () => {
  const fixture = authority({ label: 'unknownkey', selector: { residentExtra: 'x' } });
  const refusal = discover(fixture);
  assert.equal(refusal?.cause, 'repository_selector_fields_unknown');
  assert.equal(refusal?.field, 'residentExtra');
  assert.match(refusal.message, /residentExtra/u);
  assert.deepEqual(refusal.detail.expected.sort(), [
    'deploymentId', 'incarnation', 'profile', 'registryDigest', 'repoId', 'schemaVersion', 'startedAt', 'transport',
  ]);
});

// -------------------------------------------------------------------------------------------
// U-F12 — the twelve profile comparisons are twelve causes.
// -------------------------------------------------------------------------------------------

test('U-F12: a resident restart (incarnation moved) is its own recoverable cause, not profile corruption', () => {
  const fixture = authority({
    label: 'incarnation', withProfile: true, profile: { incarnation: 'incarnation-from-a-previous-run' },
  });
  const refusal = discover(fixture);
  assert.equal(refusal?.cause, 'user_profile_incarnation_mismatch');
  assert.equal(refusal?.field, 'incarnation');
  assert.equal(refusal?.retryable, true, 'a restarted resident is recoverable by re-reading the connection');
  assert.equal(refusal.detail.selectorIncarnation, 'incarnation-issue288');
  assert.match(refusal.detail.remedy, /baton serve/u);
});

test('U-F12: each profile-field violation is judged and named', () => {
  const cases = [
    [{ url: '' }, 'user_profile_url_missing', 'url'],
    [{ origin: '' }, 'user_profile_origin_missing', 'origin'],
    [{ tokenFile: '' }, 'user_profile_token_file_missing', 'tokenFile'],
    [{ transport: 'tcp' }, 'user_profile_transport_unsupported', 'transport'],
    [{ socketPath: 'relative.sock' }, 'user_profile_socket_path_invalid', 'socketPath'],
    [{ deploymentId: 'another-deployment' }, 'user_profile_deployment_mismatch', 'deploymentId'],
    [{ registryDigest: 'f'.repeat(64) }, 'user_profile_registry_digest_mismatch', 'registryDigest'],
    [{ startedAt: '2026-01-01T00:00:00.000Z' }, 'user_profile_started_at_mismatch', 'startedAt'],
    [{ ownerPid: 'not-a-pid', ownerPidStart: 'owner-start' }, 'user_profile_owner_fields_invalid', 'ownerPid'],
  ];
  for (const [profile, cause, field] of cases) {
    const fixture = authority({ label: `profile-${field}`, withProfile: true, profile });
    const refusal = discover(fixture);
    assert.equal(refusal?.cause, cause, `${field}: ${cause}`);
    assert.equal(refusal?.field, field, `${field}: the judged field is named`);
    assert.ok(refusal.detail.remedy.length > 0, `${field}: a remedy rides the refusal`);
  }
});

// -------------------------------------------------------------------------------------------
// U-F11 — connectBaton's ten causes, each typed, against a serving resident's answer.
// -------------------------------------------------------------------------------------------

function card(overrides) {
  return {
    schemaVersion: 1,
    repoId: overrides.repoId ?? 'repo-placeholder',
    commands: ['application.help', 'runs.list', 'run.start', 'run.inspect', 'run.act', 'run.stop'],
    agentExperience: { registryDigest: CLI_REGISTRY_DIGEST },
    resident: { schemaVersion: 1, deploymentId: 'deploy-issue288', incarnation: 'incarnation-issue288' },
    ...overrides,
  };
}

function servingFetch(fixture, overrides = {}) {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const pathname = new URL(url).pathname;
    requests.push({ pathname, options });
    if (pathname === '/readyz') {
      return { ok: true, async json() { return { ready: overrides.ready ?? true }; } };
    }
    if (pathname === '/v1/application-card') {
      return { ok: true, async json() {
        return { ok: true, application: card({ repoId: fixture.repoId, ...(overrides.card ?? {}) }) };
      } };
    }
    if (pathname === '/v1/session') {
      return { ok: true, async json() {
        return {
          ok: true,
          identity: {
            userId: 'issue288-operator', sessionId: 'issue288-session',
            capabilities: ['observe', 'control'],
            repoIds: overrides.sessionRepoIds ?? [fixture.repoId],
          },
          expiresAt: new Date(NOW + 60_000).toISOString(),
        };
      } };
    }
    throw new Error(`unexpected handshake request ${pathname}`);
  };
  return { fetchImpl, requests };
}

async function connectRefusal(fixture, overrides = {}) {
  const transport = servingFetch(fixture, overrides);
  const advanced = {
    env: fixture.env, home: fixture.home, commandTimeoutMs: 1_000, pollMs: 10,
    clock: () => NOW, sleep: async () => {}, fetchImpl: transport.fetchImpl,
  };
  try {
    await connectBaton({ repo: fixture.repo, advanced });
    return { refusal: null, requests: transport.requests };
  } catch (error) {
    return { refusal: error, requests: transport.requests };
  }
}

test('U-F11: the resident-registry drift names BOTH digests instead of one opaque sentence', async () => {
  const fixture = authority({ label: 'connect-drift', withProfile: true });
  const served = 'f'.repeat(64);
  const { refusal } = await connectRefusal(fixture, { card: { agentExperience: { registryDigest: served } } });
  assert.equal(refusal?.cause, 'served_registry_digest_drift');
  assert.equal(refusal?.code, 'cli_connection_incompatible');
  assert.equal(refusal?.field, 'agentExperience.registryDigest');
  assert.equal(refusal.detail.servedRegistryDigest, served);
  assert.equal(refusal.detail.cliRegistryDigest, CLI_REGISTRY_DIGEST);
  assert.equal(refusal.message.includes(served), true, 'the served digest is named');
  assert.equal(refusal.message.includes(CLI_REGISTRY_DIGEST), true, 'the CLI digest is named');
  assert.match(refusal.detail.remedy, /CLI of the commit the resident runs/u);
});

test('U-F11: readiness, identity, digest and scope failures are distinct typed causes', async () => {
  const cases = [
    [{ ready: false }, 'resident_not_ready', 'ready'],
    [{ card: { schemaVersion: 2 } }, 'served_application_schema_unsupported', 'application.schemaVersion'],
    [{ card: { repoId: 'repo-somewhere-else' } }, 'served_repo_mismatch', 'application.repoId'],
    [{ card: { commands: ['application.help'] } }, 'required_commands_missing', 'application.commands'],
    [{ card: { agentExperience: { registryDigest: CLI_REGISTRY_DIGEST, limitsRegistryDigest: 'f'.repeat(64) } } },
      'served_limits_digest_drift', 'agentExperience.limitsRegistryDigest'],
    [{ card: { resident: { schemaVersion: 1, deploymentId: 'deploy-old', incarnation: 'incarnation-issue288' } } },
      'resident_deployment_mismatch', 'resident.deploymentId'],
    [{ card: { resident: { schemaVersion: 1, deploymentId: 'deploy-issue288', incarnation: 'incarnation-old' } } },
      'resident_incarnation_mismatch', 'resident.incarnation'],
  ];
  for (const [overrides, cause, field] of cases) {
    const fixture = authority({ label: `connect-${cause}`, withProfile: true });
    const { refusal } = await connectRefusal(fixture, overrides);
    assert.equal(refusal?.cause, cause, `${cause}: the typed cause crosses`);
    assert.equal(refusal?.field, field, `${cause}: the judged field is named`);
    assert.equal(refusal?.code, 'cli_connection_incompatible');
    assert.ok(refusal.detail.remedy.length > 0, `${cause}: the remedy is present`);
  }
});

test('U-F11: a session that does not serve the connected repository refuses typed before admission', async () => {
  // The session validator refuses first (cli_protocol_failed: an authenticated session whose
  // repoIds do not cover the connection is not a valid session), so this arrives as the session's
  // own typed refusal; the handshake's `served_session_repo_not_served` row is the same cause on
  // the arm that would see it, and both are enumerated by the table above.
  const fixture = authority({ label: 'connect-session', withProfile: true });
  const { refusal, requests } = await connectRefusal(fixture, { sessionRepoIds: ['repo-not-here'] });
  assert.equal(refusal?.code, 'cli_protocol_failed');
  assert.match(refusal.message, /invalid authenticated session/u);
  assert.equal(requests.some(({ pathname }) => pathname === '/v1/commands'), false,
    'no command is ever admitted under a session that does not serve the repository');
});

test('U-F11: a selector naming another checkout refuses before any transport is opened', async () => {
  const fixture = authority({ label: 'connect-selector', withProfile: true });
  // Re-point the selector at a different repository identity while keeping the local checkout.
  const selectorPath = join(fixture.repo, '.git', 'baton', 'connection.json');
  writeFileSync(selectorPath, JSON.stringify({
    schemaVersion: 2, profile: fixture.profileName, repoId: 'repo-somewhere-else',
    deploymentId: 'deploy-issue288', incarnation: 'incarnation-issue288', transport: 'local',
    registryDigest: CLI_REGISTRY_DIGEST, startedAt: '2026-09-14T00:00:00.000Z',
  }), { mode: 0o600 });
  const transport = servingFetch(fixture);
  const refusal = await connectBaton({
    repo: fixture.repo,
    advanced: {
      env: fixture.env, home: fixture.home, commandTimeoutMs: 1_000, pollMs: 10,
      clock: () => NOW, sleep: async () => {}, fetchImpl: transport.fetchImpl,
    },
  }).then(() => null, (error) => error);
  assert.equal(refusal?.cause, 'selector_repo_mismatch');
  assert.equal(refusal?.field, 'repoId');
  assert.deepEqual(transport.requests, [], 'a selector mismatch never opens a transport');
});
