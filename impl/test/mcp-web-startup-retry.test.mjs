// The baton-mcp-web startup retry (the root's Claude Code session, 2026-09-25): a host session
// that launches the resident bridge while the resident is mid-restart — the gap between one
// `baton serve` dying and the next binding its socket and republishing the connection — met the
// one-shot discovery refusal and exited, and the host then kept the MCP surface closed for its
// whole session. The entry now waits a bounded window for the publication, retrying the
// publication-gap refusals (`application_unavailable`, `user_profile_*`) and failing exactly as
// before on everything else and on a lapsed window.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { startWakeResident } from './wake-resident-double.mjs';
import { webAdmittedCommandNames } from '../src/web-northbound.mjs';
import { SWARM_COMMAND_DEFINITIONS } from '../src/swarm-contract.mjs';
// The card the resident serves: the union the bridge's own floor is admitted by — the same
// derivation the #314 lane 2 fixture serves (the facade validates its command contract).
const CARD = Object.freeze({
  schemaVersion: 1, repoId: 'repo-startup-retry',
  commands: Object.freeze([...new Set([...webAdmittedCommandNames(), ...Object.keys(SWARM_COMMAND_DEFINITIONS)])]),
  readiness: Object.freeze({ schemaVersion: 1, routes: Object.freeze([]) }),
  agentExperience: Object.freeze({ registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest }),
});
const BRIDGE_ENTRY = new URL('../scripts/mcp-web.mjs', import.meta.url).pathname;
const SESSION = Object.freeze({
  schemaVersion: 1,
  identity: Object.freeze({
    userId: 'operator', sessionId: 'session-startup-retry',
    capabilities: Object.freeze(['observe']), repoIds: Object.freeze(['repo-startup-retry']),
  }),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
});

function fixtures(t) {
  // The test process runs under the resident's own harness environment, whose GIT_* pointers
  // name the served checkout; every git call here must meet the fixture repository instead.
  const gitEnv = { ...process.env };
  for (const name of Object.keys(gitEnv)) if (name.startsWith('GIT_')) delete gitEnv[name];
  const repo = mkdtempSync(join(tmpdir(), 'bt-mcp-retry-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'bt-mcp-retry-home-'));
  const run = (args) => execFileSync('git', args, { cwd: repo, env: gitEnv });
  run(['init', '-q']);
  run(['config', 'user.email', 'retry@example.invalid']);
  run(['config', 'user.name', 'Retry']);
  writeFileSync(join(repo, 'README.md'), 'retry\n');
  run(['add', '.']);
  run(['commit', '-qm', 'base']);
  t.after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
  mkdirSync(join(repo, '.git', 'baton'), { recursive: true });
  return { repo, home };
}

/** The connection selector the resident publishes into the checkout's git directory, and the
 * user profile it publishes into the config home — the two halves discovery joins. */
function connectionHalves({ socketPath, startedAt }) {
  const selector = {
    schemaVersion: 2, profile: 'resident-retry', repoId: CARD.repoId,
    deploymentId: 'deployment-retry-fix', incarnation: 'instance-retry-fix',
    transport: 'local', registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest, startedAt,
  };
  const profile = {
    schemaVersion: 2, url: 'https://baton.local', origin: 'https://baton.local',
    socketPath, deploymentId: selector.deploymentId, incarnation: selector.incarnation,
    registryDigest: selector.registryDigest, startedAt: selector.startedAt,
    transport: 'local', ownerPid: process.pid, ownerPidStart: new Date().toString(),
    tokenFile: 'resident-retry.token',
  };
  return { selector, profile };
}
function publishProfile(home, profile) {
  const directory = join(home, '.config', 'baton', 'connections');
  mkdirSync(directory, { recursive: true });
  // The publication is owner-only (discovery refuses wider permissions), exactly as serve writes it.
  writeFileSync(join(directory, 'resident-retry.json'), JSON.stringify(profile), { mode: 0o600 });
  writeFileSync(join(directory, 'resident-retry.token'), 'test-token-retry\n', { mode: 0o600 });
}

/** One MCP initialize round against the child's stdio: resolves with the server's own result
 * payload, or throws when the child closes or stays silent past the deadline. */
function initialize(child, deadlineMs = 10_000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('the bridge never answered initialize')); }, deadlineMs);
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const index = buffer.indexOf('\n');
      if (index < 0) return;
      clearTimeout(timer);
      resolve(JSON.parse(buffer.slice(0, index)));
    });
    child.stdout.on('close', () => { clearTimeout(timer); reject(new Error('the bridge closed before answering initialize')); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'retry-test', version: '0' } } })}\n`);
  });
}

test('MCPR: a profile published during the startup window opens the bridge and serves initialize', async (t) => {
  const { repo, home } = fixtures(t);
  const resident = await startWakeResident({ token: 'test-token-retry', card: CARD, session: SESSION });
  t.after(() => resident.close());
  const { selector, profile } = connectionHalves({ socketPath: resident.socketPath, startedAt: new Date().toISOString() });
  writeFileSync(join(repo, '.git', 'baton', 'connection.json'), JSON.stringify(selector));

  // The resident's own harness environment carries GIT_* pointers at the served checkout;
  // discovery must meet THIS fixture's repository, never the resident's.
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith('GIT_')) delete env[name];
  const child = execFile(process.execPath, [BRIDGE_ENTRY], {
    cwd: repo,
    env: { ...env, HOME: home, XDG_CONFIG_HOME: '', BATON_MCP_WEB_STARTUP_WINDOW_MS: '8000' },
  }, () => {});

  // The profile is published INSIDE the window — the restart gap this entry now bridges.
  await new Promise((resolveSleep) => setTimeout(resolveSleep, 1_200));
  publishProfile(home, profile);

  const answer = await initialize(child);
  assert.equal(answer.result?.serverInfo?.name, 'baton', 'the bridge serves the MCP initialize once the publication lands');
  child.kill();
});

test('MCPR: a window that lapses fails the startup with the discovery refusal, after retrying', async (t) => {
  const { repo, home } = fixtures(t);
  const resident = await startWakeResident({ token: 'test-token-retry', card: CARD, session: SESSION });
  t.after(() => resident.close());
  const { selector } = connectionHalves({ socketPath: resident.socketPath, startedAt: new Date().toISOString() });
  writeFileSync(join(repo, '.git', 'baton', 'connection.json'), JSON.stringify(selector));
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith('GIT_')) delete env[name];
  const stderr = await new Promise((resolveExit) => {
    let collected = '';
    const child = execFile(process.execPath, [BRIDGE_ENTRY], {
      cwd: repo,
      env: { ...env, HOME: home, XDG_CONFIG_HOME: '', BATON_MCP_WEB_STARTUP_WINDOW_MS: '1200' },
    }, (error) => resolveExit({ code: error?.code, stderr: collected }));
    child.stderr.on('data', (chunk) => { collected += chunk; });
  });
  assert.equal(stderr.code, 1, 'a lapsed window still fails the startup');
  assert.match(stderr.stderr, /baton-mcp-web startup failed: cli_config_invalid/u, 'the lapsed window keeps the typed startup shape');
  assert.match(stderr.stderr, /retrying within the startup window/u, 'the window retried before it lapsed');
});

test('MCPR: a zero window restores the one-shot open', async (t) => {
  const { repo, home } = fixtures(t);
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith('GIT_')) delete env[name];
  const stderr = await new Promise((resolveExit) => {
    let collected = '';
    const child = execFile(process.execPath, [BRIDGE_ENTRY], {
      cwd: repo,
      env: { ...env, HOME: home, XDG_CONFIG_HOME: '', BATON_MCP_WEB_STARTUP_WINDOW_MS: '0' },
    }, (error) => resolveExit({ code: error?.code, stderr: collected }));
    child.stderr.on('data', (chunk) => { collected += chunk; });
  });
  assert.equal(stderr.code, 1, 'the one-shot open fails outside a served checkout');
  assert.match(stderr.stderr, /baton-mcp-web startup failed: cli_/u, 'the one-shot refusal keeps its shape');
  assert.doesNotMatch(stderr.stderr, /retrying within the startup window/u, 'the zero window minted no retry');
});
