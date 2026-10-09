import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { captureInputs, invokeSourceAnalysis } from './native-provider.mjs';
import { captureSelectedInputs, installedModuleInventory, moduleDirectoryName, runSelectedInvocation } from '../../scripts/context-provider.mjs';

const [packageArgument, worktreeArgument, targetArgument] = process.argv.slice(2);
assert.ok(packageArgument && worktreeArgument && targetArgument, 'usage: node native-provider.integration.mjs MODULE_ROOT WORKTREE TARGET');
const packageRoot = resolve(packageArgument);
const worktree = resolve(worktreeArgument);
const target = resolve(worktree, targetArgument);
const declarationBytes = readFileSync(join(packageRoot, 'native-provider.declaration.json'));
const declaration = JSON.parse(declarationBytes.toString('utf8'));
const declarationDigest = createHash('sha256').update(declarationBytes).digest('hex');
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

const captured = await captureInputs(invocation(), { cwd: worktree, packageRoot });
assert.equal(captured.status, 'captured', JSON.stringify(captured));
const capturedInvocation = (overrides = {}) => invocation({ inputIdentities: captured.captures, ...overrides });
const completed = await invokeSourceAnalysis(capturedInvocation(), { cwd: worktree, packageRoot });
assert.equal(completed.type, 'event', JSON.stringify(completed));
assert.equal(completed.version, 2);
assert.equal(completed.query, 'integration-query-1');
assert.equal(completed.owner, 'integration-owner-1');
assert.equal(completed.runtime, `${realpathSync(process.execPath)};node=${process.versions.node}`);
assert.equal(completed.role, '');
assert.equal(completed.incarnation, '');
assert.deepEqual(completed.moduleBinding, binding);
assert.equal(completed.payload.schema, 'baton2.context.bend2.source-analysis.result.v1');
assert.equal(completed.payload.status, 'completed');
assert.equal(completed.payload.session.owner, 'integration-owner-1');
assert.equal(completed.payload.session.identity, target);
assert.equal(completed.payload.retainedReadSet.status, 'sealed');
assert.ok(completed.payload.retainedReadSet.captures.some((entry) => entry.path === target && /^[0-9a-f]{64}$/.test(entry.marker)));

const nullRole = await invokeSourceAnalysis(capturedInvocation({ role: null, incarnation: null }), { cwd: worktree, packageRoot });
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
  assert.deepEqual(inventory.modules[0].declaration, declaration);
  const inventoryProcess = spawnSync(process.execPath, [installedWrapper, '--inventory'], { encoding: 'utf8' });
  assert.equal(inventoryProcess.status, 0, inventoryProcess.stderr);
  const inventoryFrame = JSON.parse(inventoryProcess.stdout);
  assert.equal(inventoryFrame.status, 'available');
  assert.deepEqual(inventoryFrame.refusals, []);
  assert.equal(inventoryFrame.modules[0].declarationDigest, declarationDigest);
  const installedCaptures = await captureSelectedInputs(invocation(), { wrapperPath: installedWrapper });
  assert.equal(installedCaptures.status, 'captured', JSON.stringify(installedCaptures));
  const installedInvocation = (overrides = {}) => invocation({ inputIdentities: installedCaptures.captures, ...overrides });
  const installed = await runSelectedInvocation(installedInvocation(), { wrapperPath: installedWrapper });
  assert.equal(installed.type, 'event');
  assert.equal(installed.query, 'integration-query-1');
  assert.equal(installed.owner, 'integration-owner-1');
  assert.equal(installed.runtime, completed.runtime);
  const installedNullRole = await runSelectedInvocation(installedInvocation({ role: null, incarnation: null }), { wrapperPath: installedWrapper });
  assert.equal(installedNullRole.type, 'event');
  assert.equal(installedNullRole.role, null);
  assert.equal(installedNullRole.incarnation, null);

  // An installed provider may execute without offering input acquisition.
  const optionalId = 'fixture-without-capture';
  const optionalRoot = join(installedPrefix, 'lib/context/modules', moduleDirectoryName(optionalId));
  mkdirSync(optionalRoot, { recursive: true });
  const optionalSource = 'export function executeInvocation(input) { return { status: "completed", query: input.query }; }\n';
  writeFileSync(join(optionalRoot, 'native-provider.mjs'), optionalSource);
  const optionalDeclaration = { ...declaration, moduleId: optionalId, dependencies: [],
    artifactIdentities: [{ packagePath: 'native-provider.mjs',
      sha256: createHash('sha256').update(optionalSource).digest('hex') }] };
  const optionalBytes = JSON.stringify(optionalDeclaration);
  writeFileSync(join(optionalRoot, 'native-provider.declaration.json'), optionalBytes);
  const optionalBinding = { ...binding, id: optionalId,
    declarationDigest: createHash('sha256').update(optionalBytes).digest('hex') };
  const optionalStep = { binding: optionalBinding, common: 'sourceAnalysis', dependencies: [] };
  const mixedCapture = await captureSelectedInputs(invocation({
    operationPlan: [...invocation().operationPlan, optionalStep],
  }), { wrapperPath: installedWrapper });
  assert.equal(mixedCapture.status, 'captured');
  assert.deepEqual(mixedCapture.captures, installedCaptures.captures);
  const optionalInvocation = invocation({ moduleBinding: optionalBinding, operationPlan: [optionalStep] });
  const optionalCapture = await captureSelectedInputs(optionalInvocation, { wrapperPath: installedWrapper });
  assert.equal(optionalCapture.status, 'captured');
  assert.deepEqual(optionalCapture.captures, []);
  const optionalResult = await runSelectedInvocation(optionalInvocation, { wrapperPath: installedWrapper });
  assert.equal(optionalResult.status, 'completed');
  assert.equal(optionalResult.query, optionalInvocation.query);
} finally {
  rmSync(installedPrefix, { recursive: true, force: true });
}

const outside = await captureInputs(invocation({ request: { version: 1,
  subject: { kind: 'program', path: resolve(worktree, '..', 'outside.bend') }, select: [], cwd: worktree } }), { cwd: worktree, packageRoot });
assert.equal(outside.status, 'refused');
assert.equal(outside.reason, 'sourceTargetUnavailable');

process.stdout.write(JSON.stringify({ status: 'passed', checks: [
  'real-frontend-invocation', 'owner-and-module-selection-preserved', 'retained-source-identity',
  'installed-package-resolution', 'installed-inventory-lists-provider-path',
  'installed-inventory-subprocess-emits-configured-provider', 'outside-source-refused',
] }) + '\n');
