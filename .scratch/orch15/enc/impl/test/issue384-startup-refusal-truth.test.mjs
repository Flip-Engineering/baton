// Issue #384 — after a resident crash (#383) the first restart refused
// `coordinator_cleanup_incomplete: startup owned-resource reconciliation failed` with NO cause on the
// wire; the second start succeeded, so the refusal was transient and taught nothing. The old
// composition attached the reconciler's error as `cause` and named retained workspace-owner records
// only when the caught error carried a `report` — a failure that carried neither rendered as one
// bare sentence.
//
// The repair: the composed refusal carries {reconciler, record, observed, next} — which reconciler
// failed (workspace owners / worker processes / worker-process cleanup), which record it names, what
// it observed (a pid still alive? a lease younger than its grace?) and the next action; a transient
// observation says "retry after N ms" with the fact waited on, N being the ONE reap grace the
// reconcilers already use (process-lifecycle KILL_ESCALATION_GRACE_MS — never a new literal). The
// deployment records `host.startup_refused {code, reconciler, record, observed}` through its own
// writer before `baton serve` exits, so doctor and the wake stream see why a restart refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { allocatePhysicalWorkspaceOwner } from '../src/worktree.mjs';
import { KILL_ESCALATION_GRACE_MS } from '../src/process-lifecycle.mjs';

const roots = [];
const temp = (label) => {
  const root = mkdtempSync(join(tmpdir(), `baton-issue384-${label}-`));
  roots.push(root);
  return root;
};
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const git = (cwd, args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
}).trim();
const digest = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;

function repository(label) {
  const root = temp(label);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'issue384@example.invalid']);
  git(root, ['config', 'user.name', 'issue384']);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'test', 'smoke.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('smoke', () => assert.equal(1, 1));\n");
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'base']);
  return { root, baseSha: git(root, ['rev-parse', 'HEAD']) };
}

/** The exact adapter card a deployment open requires (phase89-resident-local-host). */
function adapter() {
  const route = RESIDENT_ROUTE;
  const value = new MockAdapter({ harness: route.harness, scenario: { outcome: 'completed', delayMs: 1, summary: 'issue384 fixture' } });
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
      provenance: 'issue384-startup-refusal', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' },
  });
  return value;
}
const RESIDENT_ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });

/** A served deployment whose ONE injected worker-process reconciler behaves as `reconcile` says.
 * `runtimeScopes` is the coordinator's own documented injection seam — production reconcilers are
 * synchronous and bounded, an injected one may be anything, and the coordinator wraps both through
 * the same `_trackStartupCleanup` path this issue is about. */
function deploymentOptions(f, reconcile, label) {
  const deploymentRoot = join(temp(label), 'deployment');
  mkdirSync(deploymentRoot, { recursive: true });
  const home = join(temp(`${label}-home`), 'home');
  mkdirSync(home, { recursive: true });
  const configRoot = join(temp(`${label}-cfg`), 'config');
  mkdirSync(configRoot, { recursive: true });
  return {
    repo: f.root,
    deploymentRoot,
    advanced: {
      deploymentRoot,
      adapters: { codex: adapter() },
      routes: [RESIDENT_ROUTE],
      verification: { command: 'node', arguments: ['--test'] },
      resident: { env: { XDG_CONFIG_HOME: configRoot, HOME: home }, home, webDrainMs: 2_000, sessionTtlMs: 60_000 },
    },
    createDriver: (options) => createDriver({ ...options, runtimeScopes: { reconcile } }),
  };
}

const ledgerRows = (deploymentRoot) => {
  const path = join(deploymentRoot, 'state', 'coordination', 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
};
const startupRefusedRows = (deploymentRoot) => ledgerRows(deploymentRoot)
  .filter((row) => row.kind === 'driver.recorded' && row.payload?.kind === 'host.startup_refused')
  .map((row) => row.payload);

const open = (configured) =>
  openBatonDeployment({ repo: configured.repo, advanced: configured.advanced }, configured.createDriver);

test('384-a: a reconciler failure whose record still has a live process refuses naming reconciler/record/observed and the grace it waits', async () => {
  const f = repository('a');
  let attempts = 0;
  const configured = deploymentOptions(f, () => {
    attempts += 1;
    throw Object.assign(new Error('worker process group 4242 is still alive'), {
      code: 'runtime_scope_reconcile_failed',
      record: 'w-lost',
      observed: { pid: 4242, state: 'active', alive: true },
    });
  }, 'a');

  // The refusal surfaces at the START itself: the deferred startup reconstruction rejects, so the
  // resident never publishes — exactly the "first restart refused" the issue reports.
  const error = await open(configured).then(() => null, (caught) => caught);
  assert.ok(error, 'the start refuses');
  assert.equal(error.code, 'coordinator_cleanup_incomplete', 'the startup refusal keeps its code');
  assert.equal(error.reconciler, 'worker_processes', 'the refusal names WHICH reconciler failed');
  assert.equal(error.record, 'w-lost', 'and the record it names');
  assert.equal(error.observed?.alive, true, 'and what it observed');
  assert.equal(error.observed?.pid, 4242);
  assert.match(error.next ?? '', new RegExp(`retry after ${KILL_ESCALATION_GRACE_MS} ms`, 'u'),
    `a transient observation says retry after the reap grace (${error.next})`);
  assert.match(error.message, /worker_processes/u, 'the wire message renders the reconciler');
  assert.match(error.message, /w-lost/u, 'the wire message renders the record');
  assert.match(error.message, new RegExp(`retry after ${KILL_ESCALATION_GRACE_MS} ms`, 'u'),
    'the wire message renders the wait');
  assert.deepEqual(error.detail, {
    reconciler: 'worker_processes', record: 'w-lost',
    observed: error.observed, next: error.next,
  }, 'the refusal envelope carries the cause chain for the wire');
  assert.equal(error.cause?.record, 'w-lost', 'and the reconciler\'s own failure stays attached as cause');
  assert.equal(attempts, 1, 'the injected reconciler ran exactly once');

  // The grace the refusal names is the ONE reap grace the reconcilers already use.
  assert.equal(KILL_ESCALATION_GRACE_MS, 5_000, 'the wait is the process-lifecycle reap grace');
});

test('384-b: the resident records host.startup_refused on its own ledger before exiting', async () => {
  const f = repository('b');
  const configured = deploymentOptions(f, () => {
    throw Object.assign(new Error('workspace owner reconciliation is unproven'), {
      code: 'worktree_cleanup_failed',
      record: 'ws-0123456789abcdef0123456789abcdef',
      observed: { reason: 'owner_head_uncontained', alive: false },
    });
  }, 'b');

  await assert.rejects(open(configured), (error) => error.code === 'coordinator_cleanup_incomplete');
  const rows = startupRefusedRows(configured.deploymentRoot);
  assert.equal(rows.length, 1, 'ONE host.startup_refused row lands on the ledger');
  assert.deepEqual(
    { code: rows[0].code, reconciler: rows[0].reconciler, record: rows[0].record },
    { code: 'coordinator_cleanup_incomplete', reconciler: 'worker_processes', record: 'ws-0123456789abcdef0123456789abcdef' },
    'the row names the code, the reconciler and the record');
  assert.equal(rows[0].observed?.reason, 'owner_head_uncontained', 'and what the reconciler observed');

  // A second refused start records its own row too: a startup refusal is an observation of THIS
  // start, not an idempotent command replay. That start is its own deployment root (its own store),
  // because a resident that just refused is not the one the operator restarts next.
  const second = deploymentOptions(f, () => {
    throw Object.assign(new Error('workspace owner reconciliation is unproven'), {
      code: 'worktree_cleanup_failed',
      record: 'ws-0123456789abcdef0123456789abcdef',
      observed: { reason: 'owner_head_uncontained', alive: false },
    });
  }, 'b2');
  await assert.rejects(open(second), (error) => error.code === 'coordinator_cleanup_incomplete');
  assert.equal(startupRefusedRows(second.deploymentRoot).length, 1,
    'every refused start leaves its own observation');
});

test('384-c: the second start succeeds once the transient condition clears, and says what the first waited on', async (t) => {
  const f = repository('c');
  let blocked = true;
  const configured = deploymentOptions(f, () => {
    if (!blocked) return;
    throw Object.assign(new Error('capacity lease is younger than its grace'), {
      code: 'runtime_scope_reconcile_failed',
      record: 'w-transient',
      observed: { pid: process.pid, state: 'absent', alive: false, leaseAgeMs: 120 },
    });
  }, 'c');
  const refusal = await open(configured).then(() => null, (error) => error);
  assert.ok(refusal, 'the first start refuses while the condition holds');
  assert.equal(refusal.record, 'w-transient');
  assert.match(refusal.next ?? '', new RegExp(`retry after ${KILL_ESCALATION_GRACE_MS} ms`, 'u'),
    'the refusal names the wait, not only the failure');
  assert.ok((refusal.observed?.leaseAgeMs ?? null) !== null, 'and the fact it waited on');

  blocked = false;
  const deployment = await open(configured);
  t.after(async () => { try { await deployment.close(); } catch { /* best effort */ } });
  const hosted = await deployment.host();
  assert.equal(hosted.state, 'published', 'the second start succeeds once the condition clears');
  assert.equal(hosted.transport, 'local');
  const rows = startupRefusedRows(configured.deploymentRoot);
  assert.equal(rows.length, 1, 'the first refusal stays on the ledger as the reason that start did not publish');
  assert.equal(rows[0].record, 'w-transient');
});

test('384-d: a retained workspace-owner record refuses with its own remedy, and no fabricated retry', async (t) => {
  const f = repository('d');
  // The issue45 branch-mismatch residue: a proof-complete dead-foreign receipt whose branch sits at
  // a different sha is AMBIGUOUS residue — retained, and the open refuses (rule 2).
  writeFileSync(join(f.root, 'divergent.txt'), 'divergent\n');
  git(f.root, ['add', '.']);
  git(f.root, ['commit', '-qm', 'divergent']);
  const divergentSha = git(f.root, ['rev-parse', 'HEAD']);
  const common = (() => {
    const raw = git(f.root, ['rev-parse', '--git-common-dir']);
    return isAbsolute(raw) ? raw : resolve(f.root, raw);
  })();
  const ownerRoot = join(common, 'baton', 'workspace-owners');
  mkdirSync(ownerRoot, { recursive: true, mode: 0o700 });
  const receipt = allocatePhysicalWorkspaceOwner(f.root, {
    runId: 'issue384-run', attemptId: 'issue384-attempt', logicalTaskId: 'issue384-logical',
    processGeneration: 1, baseSha: f.baseSha,
  }, {
    deploymentId: digest('issue384-dead-deployment'), controllerId: digest('issue384-dead-controller'),
    pid: 2_147_483_647, pidStart: 'issue384-not-a-live-process',
  });
  git(f.root, ['branch', receipt.branch, divergentSha]);
  const receiptPath = join(ownerRoot, `${receipt.physicalOwnerId}.json`);
  const { receiptDigest: _prior, ...core } = JSON.parse(readFileSync(receiptPath, 'utf8'));
  core.state = 'ready';
  writeFileSync(receiptPath, JSON.stringify({
    ...core, receiptDigest: createHash('sha256').update(JSON.stringify(canonical(core))).digest('hex'),
  }), { mode: 0o600 });
  chmodSync(receiptPath, 0o600);

  const logDir = join(temp('d-state'), 'state');
  mkdirSync(logDir, { recursive: true });
  const driver = createDriver({
    repoRoot: f.root, repoId: 'issue384-repo', logDir,
    adapters: { codex: adapter() },
  });
  t.after(async () => { try { await driver.closeAsync(); } catch { /* best effort */ } });

  const error = await driver.coordinator.startupReady().then(() => null, (caught) => caught);
  assert.ok(error, 'the retained residue refuses the startup');
  assert.equal(error.code, 'coordinator_cleanup_incomplete');
  assert.equal(error.reconciler, 'workspace_owners', 'the refusal names the workspace-owner reconciler');
  assert.equal(error.record, receipt.physicalOwnerId, 'and the retained record');
  assert.match(error.message, new RegExp(receipt.physicalOwnerId, 'u'), 'the wire message names it');
  assert.match(error.message, /workspace-owners/u, 'with the remedy');
  assert.equal(/retry after/u.test(error.next ?? ''), false,
    'an ambiguous retained record is not transient — the refusal never invents a retry');
  assert.match(error.next ?? '', /delete the named records|restore their worktrees/u,
    'the next action is the repair the remedy names');
});

test('384-e: a reconciler failure that names nothing still refuses with the reconciler it came from', async () => {
  const f = repository('e');
  const configured = deploymentOptions(f, () => {
    throw Object.assign(new Error('reconcile failed'), { code: 'runtime_scope_reconcile_failed' });
  }, 'e');

  const error = await open(configured).then(() => null, (caught) => caught);
  assert.ok(error, 'the start refuses');
  assert.equal(error.code, 'coordinator_cleanup_incomplete');
  assert.equal(error.reconciler, 'worker_processes',
    'the reconciler is derived at the wrap site, never guessed from the message');
  assert.equal(error.record, null, 'a failure naming no record carries no fabricated one');
  assert.equal(error.observed?.code, 'runtime_scope_reconcile_failed',
    'the observation names the reconciler\'s own code');
  assert.equal(/retry after/u.test(error.next ?? ''), false, 'and no wait is invented');
  assert.match(error.message, /worker_processes/u, 'the wire message still names the reconciler');
  const rows = startupRefusedRows(configured.deploymentRoot);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'coordinator_cleanup_incomplete');
  assert.equal(rows[0].reconciler, 'worker_processes');
  assert.equal(rows[0].record, null);
  assert.equal(rows[0].observed?.code, 'runtime_scope_reconcile_failed');
});
