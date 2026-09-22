import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, connectBaton, openBaton } from '../src/index.mjs';
import { ResidentAuthority } from '../src/resident-authority.mjs';
import { WebSessionStore } from '../src/web-auth.mjs';
import { connectBatonWebApplication } from '../src/mcp-web-bridge.mjs';

// Issue #559: the resident issues one `local-owner` visitor session at open and caps it at
// `advanced.resident.sessionTtlMs`. Before the fix nothing renewed it, so an incarnation that
// outlived its own TTL refused every owner call with `401 unauthenticated` while the process, its
// workers and its socket stayed healthy — `/v1/auth/login` needs an identity provider, `/v1/auth/refresh`
// needs an unexpired session, and `deployment.reincarnate` is itself authenticated.
//
// The declared lifetime here is short enough that a test can outlive it. Every wait is a deadline
// on an observable fact (the published credential changing, the session ledger gaining a rotation
// row), never a fixed sleep, so a loaded host delays the rows instead of failing them.

const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const TTL_MS = 2_000;
// The declared lifetime is orders of magnitude larger than any timer the resident needs to take,
// so a renewal that has not happened by this deadline is a renewal that will not happen.
const RENEWAL_DEADLINE_MS = TTL_MS * 10;

function repository(t) {
  const root = mkdtempSync('/tmp/bt559-owner-session-repo-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'issue559@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Issue 559'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test', 'smoke.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('smoke', () => assert.equal(1, 1));",
    '',
  ].join('\n'));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function adapter() {
  const value = new MockAdapter({
    harness: ROUTE.harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'issue 559 fixture' },
  });
  const card = value.card.bind(value);
  value.card = () => ({
    ...card(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false,
        observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false,
        observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'],
        observation: 'unavailable', configuredPreferences: [] },
    },
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model],
      family: ROUTE.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'issue559-owner-session', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' },
  });
  return value;
}

function options(t, repo) {
  const deploymentRoot = mkdtempSync('/tmp/bt559-owner-session-deployment-');
  const configRoot = mkdtempSync('/tmp/bt559-owner-session-config-');
  const home = mkdtempSync('/tmp/bt559-owner-session-home-');
  t.after(() => rmSync(deploymentRoot, { recursive: true, force: true }));
  t.after(() => rmSync(configRoot, { recursive: true, force: true }));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { XDG_CONFIG_HOME: configRoot, HOME: home };
  return {
    repo,
    advanced: {
      deploymentRoot,
      adapters: { codex: adapter() },
      routes: [ROUTE],
      verification: { command: 'node', arguments: ['--test'] },
      resident: { env, home, webDrainMs: 2_000, sessionTtlMs: TTL_MS },
    },
    connection: { repo, advanced: { env, home } },
    deploymentRoot,
    configRoot,
  };
}

/** The ONE credential file the open publishes, at the path `connectBaton` reads it from. */
function credentialPath({ configRoot }) {
  const directory = join(configRoot, 'baton', 'connections');
  const names = readdirSync(directory).filter((name) => name.endsWith('.token'));
  assert.equal(names.length, 1, 'the open publishes exactly one owner credential file');
  return join(directory, names[0]);
}

function credential(path) {
  return readFileSync(path, 'utf8').trim();
}

/** Wait for the published credential to differ from `previous`, and answer the new one. */
async function renewed(path, previous) {
  const deadline = Date.now() + RENEWAL_DEADLINE_MS;
  for (;;) {
    const current = credential(path);
    if (current !== previous) return current;
    assert.ok(Date.now() < deadline,
      `the owner credential was still ${previous.length} characters at +${RENEWAL_DEADLINE_MS} ms`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
}

/** The session ledger this incarnation writes, in order. */
function sessionLedger({ deploymentRoot }) {
  const raw = readFileSync(join(deploymentRoot, 'resident', 'sessions', 'sessions.jsonl'), 'utf8');
  return raw.trim().split('\n').map((line) => JSON.parse(line));
}

/** One owner call over the resident's own transport, which reads the published credential. */
async function ownerCall(configured) {
  const connected = await connectBaton(configured.connection);
  return (await connected.runs.list()).items;
}

test('559-a: the resident renews the owner session inside its lifetime, and the owner is admitted past it',
  { timeout: 120_000 }, async (t) => {
    const repo = repository(t);
    const configured = options(t, repo);
    const owner = await openBaton({ repo, advanced: configured.advanced });
    t.after(async () => { try { await owner.close(); } catch { /* the test closes it */ } });

    await owner.host();
    const tokenPath = credentialPath(configured);
    const opened = credential(tokenPath);
    const openedAt = Date.now();
    assert.deepEqual(await ownerCall(configured), [], 'the owner is admitted on the credential the open published');

    // The first renewal: the credential a client reads changes while the resident runs.
    const first = await renewed(tokenPath, opened);
    assert.notEqual(first, opened);

    // A second renewal: the successor is itself renewed, so this is a chain and not one re-issue.
    const second = await renewed(tokenPath, first);
    assert.notEqual(second, first);

    // Past the declared lifetime of the session the open issued — the instant the issue reports the
    // lockout at — the owner is still admitted, on a credential the open never published.
    const stale = TTL_MS - (Date.now() - openedAt);
    if (stale > 0) await new Promise((resolveWait) => setTimeout(resolveWait, stale + 50));
    assert.ok(Date.now() - openedAt > TTL_MS, 'the test outlived the declared owner-session lifetime');
    assert.deepEqual(await ownerCall(configured), [],
      'the owner is admitted after the session the open issued has expired');
    assert.equal(credential(tokenPath), second);

    // The mechanism is the store's own rotation, recorded once per renewal: the successor carries
    // the claims the open issued, and the ledger holds digests rather than credentials.
    const ledger = sessionLedger(configured);
    assert.equal(ledger[0].kind, 'session.issued');
    assert.equal(ledger[0].payload.userId, 'local-owner');
    const rotations = ledger.filter((row) => row.kind === 'session.rotated');
    assert.ok(rotations.length >= 2, `the ledger holds ${rotations.length} rotations`);
    assert.deepEqual(rotations[0].payload.successor.capabilities, ledger[0].payload.capabilities);
    assert.notEqual(rotations[0].payload.successor.tokenDigest, ledger[0].payload.tokenDigest);
    assert.equal(ledger.some((row) => row.kind === 'session.issued' && row.payload.userId !== 'local-owner'), false);
    assert.equal(readFileSync(join(configured.deploymentRoot, 'resident', 'sessions', 'sessions.jsonl'), 'utf8')
      .includes(second), false, 'the ledger never holds a credential');
  });

test('559-b: the stop withdraws the credential the last renewal published', { timeout: 120_000 }, async (t) => {
  const repo = repository(t);
  const configured = options(t, repo);
  const owner = await openBaton({ repo, advanced: configured.advanced });
  t.after(async () => { try { await owner.close(); } catch { /* the test closes it */ } });

  await owner.host();
  const tokenPath = credentialPath(configured);
  const renewal = await renewed(tokenPath, credential(tokenPath));

  const closed = await owner.close();
  assert.equal(closed.state, 'closed');
  assert.equal(closed.resident.state, 'closed');
  assert.equal(existsSync(tokenPath), false,
    'the withdrawn credential file is the one the last renewal published');
  // The session the renewal installed is revoked by the same stop, so nothing admits the owner.
  const ledger = sessionLedger(configured);
  assert.equal(ledger.at(-1).kind, 'session.revoked');
  assert.notEqual(ledger.at(-1).payload.sessionId, undefined);
  assert.equal(ledger.filter((row) => row.kind === 'session.rotated').length >= 1, true);
  assert.equal(renewal.length > 0, true);
});

// Execute only the resident renewal timer manually. Startup and transport timers stay real.
function renewalTimers(t) {
  const timers = new Set();
  const set = globalThis.setTimeout;
  const clear = globalThis.clearTimeout;
  t.mock.method(globalThis, 'setTimeout', function (callback, delay, ...args) {
    if (!new Error().stack.includes('#scheduleOwnerSessionRenewal')) return set(callback, delay, ...args);
    const timer = { callback, delay, unref() {} };
    timers.add(timer);
    return timer;
  });
  t.mock.method(globalThis, 'clearTimeout', function (timer) {
    if (!timers.delete(timer)) clear(timer);
  });
  return {
    get pending() { return [...timers]; },
    fire() {
      assert.equal(timers.size, 1);
      const timer = [...timers][0];
      timers.delete(timer);
      timer.callback();
    },
  };
}

async function hosted(t, configure = () => {}) {
  const configured = options(t, repository(t));
  configure(configured);
  const owner = await openBaton({ repo: configured.repo, advanced: configured.advanced });
  t.after(async () => { try { await owner.close(); } catch {} });
  await owner.host();
  return { owner, configured, tokenPath: credentialPath(configured) };
}

test('559-c: failed credential publication preserves the published admission and retries within the TTL', async (t) => {
  const timers = renewalTimers(t);
  const { configured, tokenPath } = await hosted(t);
  const before = credential(tokenPath);
  const original = ResidentAuthority.prototype.renewToken;
  let failures = 1;
  t.mock.method(ResidentAuthority.prototype, 'renewToken', function (...args) {
    if (failures-- > 0) throw Object.assign(new Error('injected write failure'), { code: 'EIO' });
    return original.apply(this, args);
  });
  timers.fire();
  assert.equal(credential(tokenPath), before);
  assert.deepEqual(await ownerCall(configured), [], 'a failed publication retains the usable predecessor');
  assert.ok(timers.pending[0].delay <= TTL_MS / 2, 'retry fits inside the declared lifetime');
  timers.fire();
  assert.notEqual(credential(tokenPath), before);
  assert.deepEqual(await ownerCall(configured), []);
});

test('559-d: a failed session-store renewal retries within a short lifetime', async (t) => {
  const timers = renewalTimers(t);
  await hosted(t);
  t.mock.method(WebSessionStore.prototype, 'rotate', () => { throw new Error('injected ledger failure'); });
  t.mock.method(WebSessionStore.prototype, 'issue', () => { throw new Error('injected ledger failure'); });
  timers.fire();
  assert.ok(timers.pending[0].delay <= TTL_MS / 2, 'retry is bounded by half the session lifetime');
});

test('559-e: a connected client and MCP facade retain admission across renewal', async (t) => {
  const timers = renewalTimers(t);
  const { configured } = await hosted(t);
  const connected = await connectBaton(configured.connection);
  const bridge = await connectBatonWebApplication({
    cwd: configured.repo, ...configured.connection.advanced,
  });
  timers.fire();
  assert.deepEqual((await connected.runs.list()).items, [], 'an existing client follows renewal');
  const current = await bridge._reattestSession();
  assert.equal(current.identity.userId, 'local-owner', 'the bridge reattests the owner');
});

test('559-f: startup self-check survives expiry of its first owner session', async (t) => {
  renewalTimers(t);
  let now = Date.now();
  const issue = WebSessionStore.prototype.issue;
  let first = true;
  t.mock.method(WebSessionStore.prototype, 'issue', function (...args) {
    const result = issue.apply(this, args);
    if (first) { first = false; now += TTL_MS + 1; }
    return result;
  });
  const { configured } = await hosted(t, (value) => { value.advanced.resident.now = () => now; });
  assert.deepEqual(await ownerCall(configured), []);
});

test('559-g: long session lifetimes stay within the Node timer range', async (t) => {
  const timers = renewalTimers(t);
  await hosted(t, (value) => { value.advanced.resident.sessionTtlMs = 2 ** 33; });
  assert.ok(timers.pending[0].delay <= 2 ** 31 - 1);
});
