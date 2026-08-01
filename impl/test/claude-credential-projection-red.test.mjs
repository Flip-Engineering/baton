/**
 * Issue #11 contract v3 red battery.
 *
 * ENV-TOKEN WIRE-SHAPE ASSUMPTION (UNVERIFIED): an env-only Claude CLI whose
 * token expires mid-turn reports either `authentication_error` or
 * `Not logged in · Please run /login`. A live receipt must confirm/extend this
 * matcher before retry-once is trusted.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  ClaudeCredentialCache, claudeAuthenticationSummary,
} from '../src/application-deployment.mjs';
import { ClaudeSessionCli } from '../src/claude-session.mjs';
import { RuntimeIsolation } from '../src/runtime-isolation.mjs';

const deploymentSource = readFileSync(new URL('../src/application-deployment.mjs', import.meta.url), 'utf8');
const sessionSource = readFileSync(new URL('../src/claude-session.mjs', import.meta.url), 'utf8');
const semanticsSource = readFileSync(new URL('../src/application-semantics.mjs', import.meta.url), 'utf8');
const fakeClaude = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const fakeClaudeRefresh = fileURLToPath(new URL('./fixtures/fake-claude-credential-refresh.mjs', import.meta.url));

const roots = [];
function temporary(name) {
  const root = mkdtempSync(join(tmpdir(), `baton-claude-${name}-`));
  roots.push(root);
  return root;
}
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function wire(expiresAt, overrides = {}) {
  return {
    claudeAiOauth: {
      accessToken: `access-${expiresAt}`,
      refreshToken: `refresh-${expiresAt}`,
      expiresAt,
      refreshTokenExpiresAt: expiresAt + 1_000_000,
      ...overrides,
    },
  };
}

function cacheOptions(root, now, overrides = {}) {
  return {
    credentialPath: join(root, '.credentials.json'),
    refreshRoot: join(root, 'refresh'),
    now: () => now,
    keychainRead: () => null,
    keychainMtime: () => null,
    ...overrides,
  };
}

test('CC-1 cache seam: Keychain wins, file fallback works, and N projections read once at open', async () => {
  const root = temporary('cache');
  const path = join(root, '.credentials.json');
  writeFileSync(path, JSON.stringify(wire(20_000)));
  let keychainReads = 0;
  const preferred = await ClaudeCredentialCache.open(cacheOptions(root, 1_000, {
    keychainRead: () => { keychainReads += 1; return JSON.stringify(wire(30_000)); },
    keychainMtime: () => 7,
  }));
  for (let index = 0; index < 64; index += 1) {
    assert.deepEqual(preferred.projectionEnv(), { CLAUDE_CODE_OAUTH_TOKEN: 'access-30000' });
  }
  assert.equal(keychainReads, 1);
  assert.equal(preferred.metadata().state, 'fresh');
  // Keychain access is deployment-side ONLY: through the injected shim, or through the named
  // defaultMacos* seam — and never from a worker path or a per-spawn exec. The source scan
  // proves every /usr/bin/security occurrence lives inside the two named default functions.
  assert.match(deploymentSource, /defaultMacosKeychainRead/, 'the named default seam exists');
  const securityExecSites = deploymentSource.split('\n')
    .filter((line) => line.includes('/usr/bin/security') && !line.trim().startsWith('//'));
  assert.equal(securityExecSites.length, 2,
    `every /usr/bin/security exec lives inside the two named default functions: ${securityExecSites.length}`);
  assert.ok(securityExecSites.every((line) => line.includes("execFileSync('/usr/bin/security'")),
    'each is the bounded execFileSync seam, never a shell or a worker-visible path');

  const fallback = await ClaudeCredentialCache.open(cacheOptions(root, 1_000));
  assert.deepEqual(fallback.projectionEnv(), { CLAUDE_CODE_OAUTH_TOKEN: 'access-20000' });
});

test('CC-2/CC-2+ per-credential single-flight adopts only a strictly fresher schema-valid harvest', async () => {
  const root = temporary('flight');
  writeFileSync(join(root, '.credentials.json'), JSON.stringify(wire(2_000)));
  const cache = await ClaudeCredentialCache.open(cacheOptions(root, 3_000, {
    cmd: process.execPath,
    cmdArgs: [fakeClaudeRefresh],
  }));
  const adopted = await Promise.all(Array.from({ length: 32 }, () => cache.refresh()));
  assert.equal(readFileSync(join(root, 'refresh', 'fixture-spawns'), 'utf8'), '1');
  assert.equal(adopted.every((item) => item.expiresAt === 9_000), true);
  assert.deepEqual(cache.projectionEnv(), { CLAUDE_CODE_OAUTH_TOKEN: 'access-9000' });
});

test('CC-2+ short-TTL, partial, truncated-token, and garbage-expiry write-backs never poison cache', async () => {
  const cases = [
    wire(4_000),
    { claudeAiOauth: { accessToken: 'partial', expiresAt: 20_000 } },
    wire(20_000, { accessToken: '', expiresAt: 'garbage' }),
  ];
  for (const [index, candidate] of cases.entries()) {
    const root = temporary(`schema-${index}`);
    writeFileSync(join(root, '.credentials.json'), JSON.stringify(wire(5_000)));
    const cache = await ClaudeCredentialCache.open(cacheOptions(root, 6_000, {
      refreshRuntime: async () => ({ candidate }),
    }));
    await assert.rejects(cache.refresh(), { code: 'authentication_refresh_required' });
    assert.deepEqual(cache.projectionEnv(), { CLAUDE_CODE_OAUTH_TOKEN: 'access-5000' });
  }
});

test('CC-2 fixture Claude pins assumed terminal shape and retry-once with Claude remedy', async () => {
  let refreshes = 0;
  let token = 'fixture-old-access';
  const controller = {
    ensureFresh: async () => {},
    projectionEnv: () => ({ CLAUDE_CODE_OAUTH_TOKEN: token }),
    refresh: async () => { refreshes += 1; token = 'fixture-new-access'; },
  };
  const cli = new ClaudeSessionCli({
    cmd: process.execPath, args: [fakeClaude], credentialController: controller,
    authenticationSummary: claudeAuthenticationSummary, killGraceMs: 20,
  });
  const events = [];
  let resolveTerminal;
  const terminal = new Promise((resolve) => { resolveTerminal = resolve; });
  cli.onEvent((event) => {
    events.push(event);
    if (event.kind === 'lifecycle.turn_completed') resolveTerminal(event);
  });
  const ack = await cli.spawn('cc2-worker', {
    goal: 'TRIGGER_AUTH_REFUSAL', constraints: [], pathScope: ['impl/**'],
    definitionOfDone: 'fixture', verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100, usd: 1, wallMin: 1 },
  }, { worktree: process.cwd(), env: { PATH: process.env.PATH }, replaceEnv: true });
  assert.equal(ack.ok, true);
  const result = await Promise.race([
    terminal,
    new Promise((_, reject) => setTimeout(() => reject(new Error('fixture retry timeout')), 4_000)),
  ]);
  assert.equal(refreshes, 1);
  assert.equal(result.payload.result.failure.code, 'authentication_refresh_required');
  assert.match(result.payload.result.summary, /Claude.*(?:auth login|\/login)/);
  assert.equal(events.filter((event) => event.kind === 'lifecycle.turn_completed').length, 1);
  await cli.kill('cc2-worker');
});

test('CC-3 doctor metadata has ms epochs, three states, refresh-unverified, and typed Keychain-only/absent codes', async () => {
  const root = temporary('doctor');
  let fileProbes = 0;
  const stale = await ClaudeCredentialCache.open(cacheOptions(root, 5_000, {
    keychainRead: () => JSON.stringify(wire(4_000)),
    keychainMtime: () => 11,
    fileProbe: () => { fileProbes += 1; return { exists: false, mtimeMs: null }; },
  }));
  const metadata = stale.metadata();
  assert.deepEqual(metadata, {
    expiresAt: 4_000, refreshTokenExpiresAt: 1_004_000, state: 'stale', units: 'ms epoch',
    label: 'refresh-unverified until attempted (#47 tier)',
    code: 'claude_credentials_keychain_only',
    operatorFile: { exists: false, mtimeMs: null },
  });
  assert.equal(fileProbes >= 2, true);

  const absent = await ClaudeCredentialCache.open(cacheOptions(temporary('absent'), 5_000));
  assert.equal(absent.metadata().state, 'expired_needs_login');
  assert.equal(absent.metadata().code, 'claude_credentials_absent');

  const freshRoot = temporary('fresh');
  writeFileSync(join(freshRoot, '.credentials.json'), JSON.stringify(wire(7_000)));
  assert.equal((await ClaudeCredentialCache.open(cacheOptions(freshRoot, 5_000))).metadata().state, 'fresh');
});

function scanTree(root) {
  const values = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) values.push(...scanTree(path));
    else values.push(readFileSync(path, 'utf8'));
  }
  return values;
}

test('CC-4+ access-token-only projection has no credentialFiles.claude and no refresh bytes in worker tree', async () => {
  const root = temporary('boundary');
  writeFileSync(join(root, '.credentials.json'), JSON.stringify(wire(20_000)));
  const cache = await ClaudeCredentialCache.open(cacheOptions(root, 1_000));
  const credentialFiles = {};
  assert.equal(credentialFiles.claude, undefined);
  const isolation = new RuntimeIsolation({
    repoRoot: process.cwd(), root: join(root, 'workers'), credentialFiles,
    credentialEnv: cache.credentialEnv(), baseEnv: { PATH: process.env.PATH },
  });
  const lease = isolation.create('cc4-worker', {
    harness: 'claude-code', authPosture: 'subscription',
    modelSelection: { family: 'claude' }, providerCompatibility: { credentialState: 'available' },
  });
  assert.deepEqual(
    Object.fromEntries(Object.entries(lease.env).filter(([name]) => name === 'CLAUDE_CODE_OAUTH_TOKEN')),
    { CLAUDE_CODE_OAUTH_TOKEN: 'access-20000' },
  );
  assert.equal(scanTree(lease.paths.root).some((value) => value.includes('refresh-20000')), false);
  assert.doesNotMatch(deploymentSource, /credentials\.claude\s*=/);
  assert.match(sessionSource, /EGRESS|egress/);
  isolation.remove('cc4-worker');
});

test('CC-5+ invalid_grant latches without a second flight; explicit refresh clears it', async () => {
  const root = temporary('latch');
  writeFileSync(join(root, '.credentials.json'), JSON.stringify(wire(2_000)));
  let spawns = 0;
  let revoked = true;
  const cache = await ClaudeCredentialCache.open(cacheOptions(root, 3_000, {
    refreshRuntime: async () => {
      spawns += 1;
      return revoked ? { invalidGrant: true } : { candidate: wire(8_000) };
    },
    persist: () => {},
  }));
  await assert.rejects(cache.refresh(), { code: 'authentication_refresh_required' });
  await assert.rejects(cache.refresh(), { code: 'authentication_refresh_required' });
  assert.equal(spawns, 1, 'revocation latch prevents a doomed second refresh runtime');
  assert.equal(cache.metadata().state, 'expired_needs_login');
  revoked = false;
  await cache.explicitRefresh();
  assert.equal(spawns, 2);
  assert.equal(cache.metadata().state, 'fresh');
});

test('CC-5+ spawn TTL gate refreshes before any token projection', async () => {
  const root = temporary('ttl');
  writeFileSync(join(root, '.credentials.json'), JSON.stringify(wire(2_000)));
  const order = [];
  const cache = await ClaudeCredentialCache.open(cacheOptions(root, 3_000, {
    refreshRuntime: async () => { order.push('refresh'); return { candidate: wire(9_000) }; },
  }));
  await cache.ensureFresh();
  order.push(cache.projectionEnv().CLAUDE_CODE_OAUTH_TOKEN);
  assert.deepEqual(order, ['refresh', 'access-9000']);
});

test('CC-5+ shared guidance remains vendor-agnostic and Claude summary owns the remedy', () => {
  assert.match(claudeAuthenticationSummary('authentication_refresh_required'), /Claude.*(?:auth login|\/login)/);
  const guidance = semanticsSource.match(/authentication_refresh_required:\s*\{([\s\S]*?)\n\s*\},/)?.[1] ?? '';
  assert.doesNotMatch(guidance, /Claude|\/login/);
});

test('CC-5+ per-credential exclusion and Keychain-mtime CAS reject a stale runtime harvest', async () => {
  const root = temporary('cas');
  writeFileSync(join(root, '.credentials.json'), JSON.stringify(wire(2_000)));
  let keychainReads = 0;
  const cache = await ClaudeCredentialCache.open(cacheOptions(root, 3_000, {
    keychainRead: () => {
      keychainReads += 1;
      return keychainReads >= 3 ? JSON.stringify(wire(7_000)) : null;
    },
    keychainMtime: () => keychainReads >= 3 ? 2 : 1,
    refreshRuntime: async () => ({ candidate: wire(9_000) }),
  }));
  const adopted = await cache.refresh();
  assert.equal(adopted.expiresAt, 7_000, 'Keychain CAS change aborts adoption of runtime candidate');
  assert.equal(readFileSync(new URL('../src/claude-credential-cache.mjs', import.meta.url), 'utf8').includes('O_EXCL'), true);
});
