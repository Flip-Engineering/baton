import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { invokeSourceAnalysis } from './native-provider.mjs';
import { installedModuleInventory, moduleDirectoryName, runSelectedInvocation } from '../../scripts/context-provider.mjs';

const [packageArgument, worktreeArgument, targetArgument] = process.argv.slice(2);
assert.ok(packageArgument && worktreeArgument && targetArgument, 'usage: node native-provider.integration.mjs MODULE_ROOT WORKTREE TARGET');
const packageRoot = resolve(packageArgument);
const worktree = resolve(worktreeArgument);
const target = resolve(worktree, targetArgument);
const declaration = JSON.parse(readFileSync(join(packageRoot, 'native-provider.declaration.json'), 'utf8'));
const declarationDigest = createHash('sha256').update(readFileSync(join(packageRoot, 'native-provider.declaration.json'))).digest('hex');
const binding = Object.freeze({
  id: declaration.moduleId,
  revision: declaration.revision,
  declarationDigest,
  protocolVersion: declaration.protocolVersion,
  operation: 'sourceAnalysis',
  artifactIdentities: declaration.artifactIdentities,
  schemaIdentities: declaration.schemaIdentities,
});
const invocation = (overrides = {}) => ({
  version: 2,
  query: 'integration-query-1',
  owner: 'integration-owner-1',
  moduleBinding: binding,
  request: { version: 1, subject: { kind: 'program', path: target }, select: [], cwd: worktree },
  inputIdentities: [],
  operationPlan: [{ binding, common: 'sourceAnalysis', dependencies: [] }],
  role: '',
  incarnation: '',
  ...overrides,
});

const completed = await invokeSourceAnalysis(invocation(), { cwd: worktree, packageRoot });
assert.equal(completed.type, 'event', JSON.stringify(completed));
assert.equal(completed.version, 2);
assert.equal(completed.query, 'integration-query-1');
assert.equal(completed.owner, 'integration-owner-1');
assert.equal(completed.runtime, `${realpathSync(process.execPath)};node=${process.versions.node};sha256=${createHash('sha256').update(readFileSync(realpathSync(process.execPath))).digest('hex')}`);
assert.equal(completed.role, '');
assert.equal(completed.incarnation, '');
assert.deepEqual(completed.moduleBinding, binding);
assert.equal(completed.payload.schema, 'baton2.context.bend2.source-analysis.result.v1');
assert.equal(completed.payload.status, 'completed');
assert.equal(completed.payload.session.owner, 'integration-owner-1');
assert.equal(completed.payload.session.identity, target);
assert.equal(completed.payload.retainedReadSet.status, 'sealed');
assert.ok(completed.payload.retainedReadSet.descriptors.some((entry) => entry.real === target && /^[0-9a-f]{64}$/.test(entry.sha256)));

const nullRole = await invokeSourceAnalysis(invocation({ role: null, incarnation: null }), { cwd: worktree, packageRoot });
assert.equal(nullRole.type, 'event');
assert.equal(nullRole.role, null);
assert.equal(nullRole.incarnation, null);

const installedPrefix = mkdtempSync(join(tmpdir(), 'baton2-provider-install-'));
try {
  const installedWrapper = join(installedPrefix, 'libexec/baton2/context-provider.mjs');
  const installedModule = join(installedPrefix, 'lib/context/modules', moduleDirectoryName(declaration.moduleId));
  mkdirSync(join(installedPrefix, 'libexec/baton2'), { recursive: true });
  mkdirSync(installedModule, { recursive: true });
  cpSync(packageRoot, installedModule, { recursive: true });
  writeFileSync(installedWrapper, readFileSync(new URL('../../scripts/context-provider.mjs', import.meta.url)));
  const inventory = installedModuleInventory({ wrapperPath: installedWrapper });
  assert.equal(inventory.status, 'available');
  assert.deepEqual(inventory.refusals, []);
  assert.equal(inventory.modules.length, 1);
  assert.equal(inventory.modules[0].moduleId, declaration.moduleId);
  assert.equal(inventory.modules[0].declarationDigest, declarationDigest);
  const inventoryProcess = spawnSync(process.execPath, [installedWrapper, '--inventory'], { encoding: 'utf8' });
  assert.equal(inventoryProcess.status, 0, inventoryProcess.stderr);
  const inventoryFrame = JSON.parse(inventoryProcess.stdout);
  assert.equal(inventoryFrame.status, 'available');
  assert.deepEqual(inventoryFrame.refusals, []);
  assert.equal(inventoryFrame.modules[0].declarationDigest, declarationDigest);
  const installed = await runSelectedInvocation(invocation(), { wrapperPath: installedWrapper });
  assert.equal(installed.type, 'event');
  assert.equal(installed.query, 'integration-query-1');
  assert.equal(installed.owner, 'integration-owner-1');
  assert.equal(installed.runtime, completed.runtime);
  const installedNullRole = await runSelectedInvocation(invocation({ role: null, incarnation: null }), { wrapperPath: installedWrapper });
  assert.equal(installedNullRole.type, 'event');
  assert.equal(installedNullRole.role, null);
  assert.equal(installedNullRole.incarnation, null);
  const staleBinding = { ...binding, declarationDigest: '0'.repeat(64) };
  const stale = await runSelectedInvocation(invocation({ moduleBinding: staleBinding,
    operationPlan: [{ binding: staleBinding, common: 'sourceAnalysis', dependencies: [] }] }),
  { wrapperPath: installedWrapper });
  assert.deepEqual(stale, { status: 'refused', reason: 'selectedPackageDoesNotMatchFrozenBinding', detail: null });
  writeFileSync(join(installedModule, 'native-provider.mjs'), 'throw new Error("must not import altered package");\n');
  const tamperedPackage = await runSelectedInvocation(invocation(), { wrapperPath: installedWrapper });
  assert.deepEqual(tamperedPackage, { status: 'refused', reason: 'selectedPackageDoesNotMatchFrozenBinding', detail: null });
  const tamperedInventory = installedModuleInventory({ wrapperPath: installedWrapper });
  assert.deepEqual(tamperedInventory.modules, []);
  assert.deepEqual(tamperedInventory.refusals, [{ moduleId: declaration.moduleId, reason: 'selectedPackageIdentityMismatch' }]);
} finally {
  rmSync(installedPrefix, { recursive: true, force: true });
}

const changedBinding = structuredClone(binding);
changedBinding.artifactIdentities[0].sha256 = '0'.repeat(64);
const changedMetadata = await invokeSourceAnalysis(invocation({ moduleBinding: changedBinding,
  operationPlan: [{ binding: changedBinding, common: 'sourceAnalysis', dependencies: [] }] }), { cwd: worktree, packageRoot });
assert.deepEqual(changedMetadata, { status: 'refused', reason: 'moduleBindingDoesNotNameSelectedPayload', detail: null });

const outside = await invokeSourceAnalysis(invocation({ request: { version: 1,
  subject: { kind: 'program', path: resolve(worktree, '..', 'outside.bend') }, select: [], cwd: worktree } }), { cwd: worktree, packageRoot });
assert.equal(outside.status, 'refused');
assert.equal(outside.reason, 'sourceTargetUnavailable');

const alteredRoot = mkdtempSync(join(tmpdir(), 'baton2-provider-negative-'));
try {
  const copy = join(alteredRoot, 'module');
  const { cpSync } = await import('node:fs');
  cpSync(packageRoot, copy, { recursive: true });
  writeFileSync(join(copy, 'upstream/bend.ts'), readFileSync(join(copy, 'upstream/bend.ts')) + '\n// altered after package admission\n');
  const alteredPayload = await invokeSourceAnalysis(invocation(), { cwd: worktree, packageRoot: copy });
  assert.equal(alteredPayload.status, 'refused');
  assert.equal(alteredPayload.reason, 'packageArtifactDigestMismatch');
} finally {
  rmSync(alteredRoot, { recursive: true, force: true });
}

process.stdout.write(JSON.stringify({ status: 'passed', checks: [
  'real-frontend-invocation', 'frozen-owner-and-binding-preserved', 'retained-source-identity',
  'installed-executable-relative-package-resolution', 'installed-module-inventory-authenticates-package-bytes',
  'installed-inventory-subprocess-emits-the-verified-catalog', 'frozen-declaration-digest-required',
  'changed-module-metadata-refused', 'outside-source-refused', 'changed-package-payload-refused',
] }) + '\n');
