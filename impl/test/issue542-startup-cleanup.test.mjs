// Issue #542 — a start refused on a scratch runtime scope it could not remove yet.
//
// Observed on this host 2026-09-24, restarting the resident after a power loss:
//
//   baton: coordinator_cleanup_incomplete: startup owned-resource reconciliation failed
//   (reconciler worker_processes; observed {"code":"ENOTEMPTY"})
//
// The scope was a killed worker's suite scratch whose own child was still exiting and writing
// into it: `rmSync` returned ENOTEMPTY for one filesystem turn, and seconds later the same
// removal succeeded. `RuntimeIsolation.reconcile` treated a scope it could not remove as a
// permanent condition and `_trackStartupCleanup` turned that into the fatal
// `coordinator_cleanup_incomplete`, so the resident — the thing every swarm on the host depends
// on — stayed down until an operator removed the directory by hand.
//
// The repair pinned here: a scope the start cannot remove yet is a PENDING REMOVAL. The
// coordinator records each such scope as `host.cleanup_pending` on its ledger, carries it on
// `coordinator.startupCleanupDeferred()`, starts anyway, and reconciles exactly those scopes
// again in the background until they are absent — with no retry count that then refuses.
//
// Hermetic: a real git checkout in os.tmpdir(), the deployment's own RuntimeIsolation, a fixture
// adapter, and a scope directory made unremovable with the one permission bit that produces the
// reported errno (`chmod 500` refuses the unlink inside it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { KILL_ESCALATION_GRACE_MS } from '../src/process-lifecycle.mjs';

const roots = [];
const temp = (label) => {
  const root = mkdtempSync(join(tmpdir(), `baton-issue542-${label}-`));
  roots.push(root);
  return root;
};
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const git = (cwd, args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
}).trim();

function repository(label) {
  const root = temp(label);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'issue542@example.invalid']);
  git(root, ['config', 'user.name', 'issue542']);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'test', 'smoke.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('smoke', () => assert.equal(1, 1));\n");
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'base']);
  return root;
}

const RESIDENT_ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });

/** The exact adapter card a deployment open requires (phase89-resident-local-host). */
function adapter() {
  const route = RESIDENT_ROUTE;
  const value = new MockAdapter({ harness: route.harness, scenario: { outcome: 'completed', delayMs: 1, summary: 'issue542 fixture' } });
  const card = value.card.bind(value);
  value.card = () => ({
    ...card(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] },
    },
    modelSelection: {
      mode: 'exact', configuredDefault: route.model, available: [route.model], family: route.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [route.effort], serviceTier: null,
      provenance: 'issue542-startup-cleanup', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' },
  });
  return value;
}

/** A served deployment whose scratch runtime root is the deployment's own — the production
 * RuntimeIsolation, never an injected reconciler: the failure is the real `rmSync` one. */
function fixture(label) {
  const repo = repository(label);
  const deploymentRoot = join(temp(`${label}-root`), 'deployment');
  mkdirSync(deploymentRoot, { recursive: true });
  const home = join(temp(`${label}-home`), 'home');
  mkdirSync(home, { recursive: true });
  const configRoot = join(temp(`${label}-config`), 'config');
  mkdirSync(configRoot, { recursive: true });
  return {
    repo,
    deploymentRoot,
    runtimeRoot: join(deploymentRoot, 'runtime'),
    advanced: {
      deploymentRoot,
      adapters: { codex: adapter() },
      routes: [RESIDENT_ROUTE],
      verification: { command: 'node', arguments: ['--test'] },
      resident: { env: { XDG_CONFIG_HOME: configRoot, HOME: home }, home, webDrainMs: 2_000, sessionTtlMs: 60_000 },
    },
  };
}

async function open(f) {
  let driver = null;
  const deployment = await openBatonDeployment({ repo: f.repo, advanced: f.advanced }, (options) => {
    driver = createDriver(options);
    return driver;
  });
  return { deployment, driver };
}

const ledgerRows = (deploymentRoot, kind) => {
  const path = join(deploymentRoot, 'state', 'coordination', 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((line) => line !== '')
    .map((line) => JSON.parse(line))
    .filter((row) => row.kind === 'driver.recorded' && row.payload?.kind === kind)
    .map((row) => row.payload);
};

async function until(predicate, label, timeoutMs = KILL_ESCALATION_GRACE_MS * 3) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() >= deadline) assert.fail(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('542-a: a scratch scope unremovable for one pass starts the resident and ends absent', async (t) => {
  const f = fixture('a');
  const scope = join(f.runtimeRoot, 'w-dead');
  mkdirSync(join(scope, 'tmp'), { recursive: true });
  writeFileSync(join(scope, 'tmp', 'scratch.txt'), "the killed worker's child is still writing here\n");
  // The child still holds the scope open: unlinking inside it is refused for this turn, which is
  // the ENOTEMPTY the restart reported.
  chmodSync(scope, 0o500);
  t.after(() => { try { chmodSync(scope, 0o700); } catch { /* absent, or already restored */ } });

  const opened = await open(f).then((value) => ({ value, error: null }), (error) => ({ error }));
  assert.equal(opened.error, null,
    `the start must not refuse on a scratch scope it cannot remove yet: ${opened.error?.message ?? ''}`);
  const { deployment, driver } = opened.value;
  t.after(async () => { try { await deployment.close(); } catch { /* best effort */ } });

  const hosted = await deployment.host();
  assert.equal(hosted.state, 'published', 'the resident publishes with the scope still pending');

  assert.deepEqual(driver.coordinator.startupCleanupDeferred().map((row) => row.record), ['w-dead'],
    'the pending scope is surfaced on the coordinator read');

  const pending = ledgerRows(f.deploymentRoot, 'host.cleanup_pending');
  assert.equal(pending.length, 1, 'ONE bounded pending row lands on the ledger');
  assert.equal(pending[0].code, 'runtime_cleanup_failed', 'the row carries the removal code');
  assert.equal(pending[0].reconciler, 'worker_processes', 'and the reconciler that observed it');
  assert.equal(pending[0].record, 'w-dead', 'and the scope it could not remove');
  assert.match(String(pending[0].observed?.code ?? ''), /^E[A-Z]+$/u,
    'and the errno the removal observed (ENOTEMPTY on the host that reported this issue)');

  // The child finished tearing down: the same removal now succeeds.
  chmodSync(scope, 0o700);

  await until(() => !existsSync(scope), 'the pending scope to reach absence');
  await until(() => driver.coordinator.startupCleanupDeferred().length === 0,
    'the deferred read to settle');
  assert.deepEqual(ledgerRows(f.deploymentRoot, 'host.cleanup_completed').map((row) => row.record), ['w-dead'],
    'the scope reaching absence is recorded once, on the same ledger');
  assert.equal(existsSync(scope), false, 'and the scope is gone');
});

test('542-b: a scope that keeps refusing keeps being retried, stays named, and is not a refusal', async (t) => {
  const f = fixture('b');
  const scope = join(f.runtimeRoot, 'w-stuck');
  mkdirSync(join(scope, 'tmp'), { recursive: true });
  writeFileSync(join(scope, 'tmp', 'scratch.txt'), 'still held open\n');
  chmodSync(scope, 0o500);
  t.after(() => { try { chmodSync(scope, 0o700); } catch { /* absent, or already restored */ } });

  const opened = await open(f).then((value) => ({ value, error: null }), (error) => ({ error }));
  assert.equal(opened.error, null,
    `a scope that refuses removal is not a startup refusal: ${opened.error?.message ?? ''}`);
  const { deployment, driver } = opened.value;
  t.after(async () => { try { await deployment.close(); } catch { /* best effort */ } });

  const hosted = await deployment.host();
  assert.equal(hosted.state, 'published', 'the resident publishes with the scope still refusing');
  assert.deepEqual(ledgerRows(f.deploymentRoot, 'host.cleanup_pending').map((row) => row.record), ['w-stuck'],
    'the ledger names the scope the start could not remove');

  // The scope keeps refusing while its child tears down: the retry runs again and gives up nothing.
  await until(() => (driver.coordinator.startupCleanupDeferred()[0]?.attempts ?? 0) >= 1,
    'the background retry to run', KILL_ESCALATION_GRACE_MS * 2);
  assert.deepEqual(ledgerRows(f.deploymentRoot, 'host.cleanup_pending').map((row) => row.record), ['w-stuck'],
    'ONE pending row per scope, however many retries run');
  assert.equal(ledgerRows(f.deploymentRoot, 'host.cleanup_completed').length, 0,
    'no row claims a removal that did not happen');
  assert.equal(Array.isArray(driver.coordinator.list()), true, 'the resident still answers reads');

  // The child finishes tearing down; the same retry now reaches absence.
  chmodSync(scope, 0o700);
  await until(() => driver.coordinator.startupCleanupDeferred().length === 0,
    'the retry to reach absence');
  assert.equal(existsSync(scope), false, 'the scope is gone');
});
