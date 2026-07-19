import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS, BatonApplication, MockAdapter, createDriver,
  validateApplicationCommandArgs,
} from '../src/index.mjs';

const REPO_ID = 'repo-phase66-export';
const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase66-export-${name}-`));
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const goalPlanPolicy = Object.freeze({
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

const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});

// These are deployment reservations for the disposable fixture, not product defaults.
const exportPolicy = Object.freeze({
  mode: 'manual',
  format: 'directory-v1',
  maxFiles: 128,
  maxBytes: 4 * 1024 * 1024,
  requireAdoptedResult: true,
  requireSemanticReview: false,
  requireIntegration: false,
});

function configuredAdapter() {
  const adapter = new MockAdapter({
    harness: 'mock',
    scenario: {
      outcome: 'completed', delayMs: 5, summary: 'created the accepted export fixture',
      edits: [{ path: 'impl/exported.mjs', content: 'export const materialized = true;\n' }],
    },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return adapter;
}

function profile(overrides = {}) {
  return {
    schemaVersion: 1,
    repoId: REPO_ID,
    definitionOfDone: ['deployment verification passes'],
    constraints: ['Keep the change inside the approved repository scope'],
    risk: 'high',
    goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
    nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
    pathScope: ['impl/**'],
    verification,
    routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
    capabilities: ['code', 'test'],
    effects: ['repository_edit'],
    resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
    exportPolicy,
    ...overrides,
  };
}

function fixture(name, {
  authorize = async () => true,
  exportRoot = root(`${name}-exports`),
  unsafeTree = false,
  applicationProfile = profile(),
} = {}) {
  const repo = root(`${name}-repo`);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase66@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 66'], { cwd: repo });
  mkdirSync(join(repo, 'bin'), { recursive: true });
  writeFileSync(join(repo, '.fixture-dotfile'), 'tracked dotfile\n');
  writeFileSync(join(repo, 'base.txt'), 'accepted base\n');
  writeFileSync(join(repo, 'bin', 'tool.sh'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(repo, 'bin', 'tool.sh'), 0o755);
  if (unsafeTree) symlinkSync('../base.txt', join(repo, 'bin', 'linked-base'));
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  const logDir = root(`${name}-log`);
  const adapter = configuredAdapter();
  const driver = createDriver({
    repoRoot: repo, repoId: REPO_ID, logDir, adapters: { mock: adapter },
    goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver,
    repoId: REPO_ID,
    profiles: { exportable: applicationProfile },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize,
    exportRoot,
  });
  return { application, driver, repo, logDir, exportRoot, applicationProfile };
}

const intent = (runId) => ({
  runId,
  objective: `Materialize exact accepted result for ${runId}`,
  profile: 'exportable',
  route: { harness: 'mock', model: 'model-a', effort: 'low' },
  scope: ['impl/**'],
});

async function acceptedResult(f, runId) {
  const proposed = await f.application.command('run.start', { intent: intent(runId) }, principal('owner'));
  await f.application.command('run.approve', {
    runId, planDigest: proposed.plan.digest,
  }, principal('approver'));
  const finished = await f.application.command('run.wait', {
    runId, timeoutMs: 5_000,
  }, principal('owner'));
  assert.equal(finished.phase, 'work_completed');
  const beforeAdoption = await f.application.command('run.evidence', { runId }, principal('owner'));
  await f.application.command('run.adopt', {
    runId,
    nodeKey: finished.result.nodeKey,
    resultSha: finished.result.sha,
    evidenceDigest: beforeAdoption.manifestDigest,
    reason: 'Preserve the exact verified result for materialization.',
  }, principal('adopter'));
  const evidence = await f.application.command('run.evidence', { runId }, principal('owner'));
  return { finished, evidence };
}

function acceptedGitFiles(repo, resultSha) {
  const rows = execFileSync('git', ['ls-tree', '-rz', '--full-tree', resultSha], { cwd: repo })
    .toString('utf8').split('\0').filter(Boolean);
  return rows.map((row) => {
    const tab = row.indexOf('\t');
    const [mode, type, blob] = row.slice(0, tab).split(' ');
    const path = row.slice(tab + 1);
    assert.equal(type, 'blob');
    const bytes = execFileSync('git', ['cat-file', 'blob', blob], { cwd: repo });
    return { path, mode, blob, digest: sha256(bytes), size: bytes.length, bytes };
  });
}

function materializedFiles(treeRoot) {
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const path = relative(treeRoot, absolute).split(sep).join('/');
      const info = lstatSync(absolute);
      assert.equal(info.isSymbolicLink(), false, `materialization contains link ${path}`);
      if (info.isDirectory()) visit(absolute);
      else {
        assert.equal(info.isFile(), true, `materialization contains special entry ${path}`);
        found.push({ path, bytes: readFileSync(absolute), executable: (info.mode & 0o111) !== 0 });
      }
    }
  };
  visit(treeRoot);
  return found.sort((left, right) => left.path.localeCompare(right.path));
}

test('CE1/CE2: the registry and immutable profile expose one strict directory-v1 export command', () => {
  assert.deepEqual(APPLICATION_COMMAND_DEFINITIONS['run.export'], {
    args: ['runId', 'evidenceDigest'],
    capabilities: ['export_result', 'observe'],
    web: true,
    mcp: true,
    mcpStateful: true,
    reconcilable: true,
  });
  assert.equal(validateApplicationCommandArgs('run.export', {
    runId: 'run-export-registry', evidenceDigest: 'a'.repeat(64),
  }), true);
  assert.throws(() => validateApplicationCommandArgs('run.export', {
    runId: 'run-export-registry', evidenceDigest: 'a'.repeat(64), path: '/tmp/caller-selected',
  }), (error) => error.code === 'application_command_invalid');
});

test('CE2: export root is deployment authority and is absent from profile/card/digest projections', async (t) => {
  const f = fixture('profile-card');
  t.after(() => f.application.shutdown(principal('shutdown')).catch(() => {}));
  const card = f.application.card();
  assert.deepEqual(card.profiles[0].exportPolicy, {
    mode: exportPolicy.mode,
    format: exportPolicy.format,
    requireAdoptedResult: exportPolicy.requireAdoptedResult,
    requireSemanticReview: exportPolicy.requireSemanticReview,
    requireIntegration: exportPolicy.requireIntegration,
  });
  assert.equal(Object.hasOwn(card.profiles[0].exportPolicy, 'maxFiles'), false);
  assert.equal(Object.hasOwn(card.profiles[0].exportPolicy, 'maxBytes'), false);
  assert.equal(JSON.stringify(card).includes(f.exportRoot), false);
  assert.equal(JSON.stringify(card.profiles[0].digest).includes(f.exportRoot), false);

  assert.throws(() => fixture('profile-path-smuggling', {
    applicationProfile: profile({ exportPolicy: { ...exportPolicy, exportRoot: '/tmp/not-profile-authority' } }),
  }), (error) => error.code === 'application_profile_invalid');
});

test('CE9: direct export authorization is checked with fresh evidence before filesystem effects', async (t) => {
  const authorizations = [];
  const f = fixture('direct-authority', {
    authorize: async (request) => {
      authorizations.push(request);
      return request.command !== 'run.export';
    },
  });
  t.after(() => f.application.shutdown(principal('shutdown')).catch(() => {}));
  const runId = 'run-export-denied';
  const { evidence } = await acceptedResult(f, runId);
  const before = readdirSync(f.exportRoot);
  await assert.rejects(f.application.command('run.export', {
    runId, evidenceDigest: evidence.manifestDigest,
  }, principal('exporter')), (error) => error.code === 'application_unauthorized');
  assert.deepEqual(readdirSync(f.exportRoot), before);
  const request = authorizations.findLast((item) => item.command === 'run.export');
  assert.equal(request.runId, runId);
  assert.deepEqual(request.subject, { evidenceDigest: evidence.manifestDigest });
});

test('CE9/CE10: completed directory-v1 export is the exact accepted Git tree and leaks no path/ref authority', async (t) => {
  const f = fixture('exact-tree');
  t.after(() => f.application.shutdown(principal('shutdown')).catch(() => {}));
  const runId = 'run-export-exact-tree';
  const { finished, evidence } = await acceptedResult(f, runId);
  const response = await f.application.command('run.export', {
    runId, evidenceDigest: evidence.manifestDigest,
  }, principal('exporter'));
  const receipt = response.export;

  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.state, 'completed');
  assert.equal(receipt.format, 'directory-v1');
  assert.equal(receipt.runId, runId);
  assert.equal(receipt.nodeKey, finished.result.nodeKey);
  assert.equal(receipt.resultSha, finished.result.sha);
  assert.equal(receipt.evidenceDigest, evidence.manifestDigest);
  assert.match(receipt.exportId, /^[a-f0-9]{64}$/u);
  assert.equal(receipt.locator, `export:${receipt.exportId}`);
  assert.equal(receipt.treeOid, execFileSync('git', ['rev-parse', `${finished.result.sha}^{tree}`], {
    cwd: f.repo, encoding: 'utf8',
  }).trim());
  const publicReceipt = JSON.stringify(receipt);
  assert.equal(publicReceipt.includes(f.exportRoot), false);
  assert.equal(publicReceipt.includes(f.repo), false);
  assert.equal(publicReceipt.includes('refs/'), false);

  const completed = readdirSync(f.exportRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'));
  assert.deepEqual(completed.map((entry) => entry.name), [receipt.exportId]);
  const exportDirectory = join(f.exportRoot, receipt.exportId);
  const treeRoot = join(exportDirectory, 'tree');
  const manifestBytes = readFileSync(join(exportDirectory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.equal(receipt.manifestDigest, sha256(manifestBytes));
  assert.equal(lstatSync(treeRoot).isDirectory(), true);
  assert.equal(readdirSync(treeRoot).includes('.git'), false);

  const expected = acceptedGitFiles(f.repo, finished.result.sha)
    .sort((left, right) => left.path.localeCompare(right.path));
  const actual = materializedFiles(treeRoot);
  assert.deepEqual(actual.map((file) => file.path), expected.map((file) => file.path));
  for (const [index, file] of actual.entries()) {
    assert.deepEqual(file.bytes, expected[index].bytes);
    assert.equal(file.executable, expected[index].mode === '100755');
  }
  assert.deepEqual(manifest.files, expected.map(({ path, mode, blob, digest, size }) => ({
    path, mode, blob, digest, size,
  })));
  assert.equal(receipt.fileCount, expected.length);
  assert.equal(receipt.byteCount, expected.reduce((total, file) => total + file.size, 0));
  assert.equal(manifest.exportId, receipt.exportId);
  assert.equal(manifest.treeOid, receipt.treeOid);
});

test('CE10: deployment root links and accepted Git symlinks fail closed without a completed export', async (t) => {
  await t.test('deployment-root-link', () => {
    const target = root('root-link-target');
    const linkParent = root('root-link-parent');
    const link = join(linkParent, 'exports');
    symlinkSync(target, link);
    assert.throws(() => fixture('root-link', { exportRoot: link }),
      (error) => error.code === 'application_export_root_invalid');
  });

  await t.test('accepted-tree-symlink', async (inner) => {
    const f = fixture('git-symlink', { unsafeTree: true });
    inner.after(() => f.application.shutdown(principal('shutdown')).catch(() => {}));
    const runId = 'run-export-git-symlink';
    const { evidence } = await acceptedResult(f, runId);
    await assert.rejects(f.application.command('run.export', {
      runId, evidenceDigest: evidence.manifestDigest,
    }, principal('exporter')), (error) => error.code === 'application_export_tree_unsafe');
    assert.deepEqual(readdirSync(f.exportRoot), ['.baton-export-root-lease']);
  });
});
