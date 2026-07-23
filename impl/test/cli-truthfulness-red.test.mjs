// Issues #36/#37/#41: CLI truthfulness contracts from the 2026-07-23 dogfood session.
// #37 — `baton setup` treated a resident-published schema-v2 profile as a schema-v1 setup
// profile and refused with an error naming no file, so one `baton serve` ever run permanently
// broke setup. #36 — doctor's no-connection guidance offered only the advanced `baton setup`
// and never the ordinary `baton serve`. #41 — three observed opaque-error seams: the Web
// mapping collapsed `application_profile_not_found` into a bare `not_found`, the Web client's
// refusal string named neither request nor status, and `baton-mcp-web` startup printed a bare
// code. All deterministic; no resident or provider is started.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  BatonWebClient, CoordinationStore, WebNorthbound, inspectBatonConnection, setupBatonConnection,
} from '../src/index.mjs';

const execFileAsync = promisify(execFile);

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-clitruth-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function configHome(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-clitruth-config-'));
  mkdirSync(join(root, 'baton', 'connections'), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeResidentProfile(configRoot, name = 'resident-abc123') {
  writeFileSync(join(configRoot, 'baton', 'connections', `${name}.json`), JSON.stringify({
    schemaVersion: 2, transport: 'local', socketPath: '/tmp/never-used.sock',
    url: 'https://baton.local', origin: 'https://baton.local',
    tokenFile: `${name}.token`, deploymentId: 'deployment-x', incarnation: 'instance-x',
    registryDigest: 'a'.repeat(64), startedAt: '2026-07-19T00:00:00.000Z',
  }), { mode: 0o600 });
  writeFileSync(join(configRoot, 'baton', 'connections', `${name}.token`), 'token\n', { mode: 0o600 });
  return name;
}

const neverFetch = async () => { throw new Error('setup must not reach the network in this contract'); };

test('CT1 (#37): a connections directory holding only a resident-published profile leaves setup honestly profile-less', async (t) => {
  const repo = repository(t);
  const configRoot = configHome(t);
  writeResidentProfile(configRoot);
  const result = await setupBatonConnection({
    cwd: repo, env: { XDG_CONFIG_HOME: configRoot }, home: configRoot, fetchImpl: neverFetch,
  });
  assert.equal(result.state, 'needs_user_input',
    'a resident publication is not a setup profile; setup must report missing profiles, not cli_config_invalid');
  assert.deepEqual([...result.profiles], []);
  assert.equal(result.outline.profiles, 'missing');
});

test('CT2 (#37/#41): a malformed schema-v1 profile error names the offending file', async (t) => {
  const repo = repository(t);
  const configRoot = configHome(t);
  writeFileSync(join(configRoot, 'baton', 'connections', 'broken.json'), JSON.stringify({
    schemaVersion: 1, url: 'https://baton.example.test', unexpected: true,
  }), { mode: 0o600 });
  await assert.rejects(
    setupBatonConnection({ cwd: repo, env: { XDG_CONFIG_HOME: configRoot }, home: configRoot, fetchImpl: neverFetch }),
    (error) => error?.code === 'cli_config_invalid' && /broken\.json/u.test(error?.message ?? ''),
    'the operator must learn WHICH profile file is malformed',
  );
});

test('CT3 (#37): explicitly selecting a resident-published profile refuses as unavailable, never as a malformed setup profile', async (t) => {
  const repo = repository(t);
  const configRoot = configHome(t);
  const name = writeResidentProfile(configRoot);
  await assert.rejects(
    setupBatonConnection({
      cwd: repo, env: { XDG_CONFIG_HOME: configRoot }, home: configRoot,
      fetchImpl: neverFetch, profile: name,
    }),
    (error) => error?.code === 'cli_config_invalid' && /unavailable/u.test(error?.message ?? ''),
  );
});

test('CT4 (#36): doctor with a repository but no connection offers the ordinary `baton serve` beside `baton setup`', (t) => {
  const repo = repository(t);
  const configRoot = configHome(t);
  const result = inspectBatonConnection({ cwd: repo, env: { XDG_CONFIG_HOME: configRoot }, home: configRoot });
  assert.equal(result.state, 'needs_setup');
  const commands = result.next.map((entry) => entry.command);
  assert.ok(commands.includes('baton serve'),
    'the zero-assembly ordinary path must be offered, not only the advanced network setup');
  assert.ok(commands.includes('baton setup'));
});

test('CT5 (#41): the Web dispatch mapping keeps application_profile_not_found specific instead of collapsing it', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-clitruth-web-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cause = Object.assign(new Error('requested Run profile is not defined'), {
    code: 'application_profile_not_found',
  });
  const web = new WebNorthbound({
    coordinator: { async spawn() { throw cause; }, list() { return []; } },
    coordination: new CoordinationStore(root),
    repoIds: ['repo-a'], allowedOrigins: ['https://control.example.test'],
    now: () => Date.parse('2026-07-23T12:00:00.000Z'),
  });
  const result = await web.execute({
    principal: {
      userId: 'user-1', sessionId: 'session-1', credentialId: 'cred-1', authMethod: 'cookie',
      csrfToken: 'csrf-1', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false,
      capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: ['repo-a'],
    },
    origin: 'https://control.example.test', csrfToken: 'csrf-1',
    remoteAddress: '127.0.0.1', transport: 'https',
  }, {
    schemaVersion: 1, commandId: 'cmd-ct5', idempotencyKey: 'retry-ct5', command: 'spawn',
    args: {
      harness: 'grok', model: 'grok-4-code', modelPolicy: { reasoningEffort: 'high' },
      brief: { goal: 'test', constraints: [], pathScope: ['x'], definitionOfDone: 'done', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 10, usd: 1, wallMin: 1 } },
    },
    repoId: 'repo-a', runId: 'run-ct5', origin: 'https://control.example.test',
  });
  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, 'application_profile_not_found',
    'a missing profile is deployment configuration the caller may fix; naming it is not enumeration risk');
});

test('CT6 (#41): the Web client refusal names the request and status, never a bare fixed string', async () => {
  const client = new BatonWebClient({
    baseUrl: 'https://baton.local', origin: 'https://baton.local', repoId: 'repo-a', token: 'tok',
    commandTimeoutMs: 5_000, pollMs: 10,
    fetchImpl: async () => ({
      ok: false, status: 404,
      headers: { get: () => null },
      text: async () => JSON.stringify({ ok: false, error: { code: 'not_found' } }),
    }),
    clock: Date.now, sleep: async () => {},
  });
  await assert.rejects(
    client.command('run.stop', { runId: 'run-x', reason: 'contract' }, 'idem-ct6'),
    (error) => error?.code === 'not_found'
      && /\/v1\/commands/u.test(error?.message ?? '') && /404/u.test(error?.message ?? ''),
    'the refusal must say WHAT was refused (path) and HOW (status), not only that something was',
  );
});

test('CT7 (#41): baton-mcp-web startup failure prints the human cause, not a bare code', async (t) => {
  const outside = mkdtempSync(join(tmpdir(), 'baton-clitruth-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const bridge = new URL('../scripts/mcp-web.mjs', import.meta.url).pathname;
  const outcome = await execFileAsync(process.execPath, [bridge], {
    cwd: outside, timeout: 30_000,
  }).catch((error) => error);
  assert.match(outcome.stderr ?? '', /startup failed/u);
  assert.match(outcome.stderr ?? '', /cli_config_invalid|cli_transport_failed/u, 'the typed code stays');
  assert.match(outcome.stderr ?? '', /repository|connection|Baton Web/iu,
    'the human-readable cause accompanies the code');
});
