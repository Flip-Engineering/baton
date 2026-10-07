import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { invokeSourceAnalysis } from './native-provider.mjs';

const [packageArgument, worktreeArgument, targetArgument] = process.argv.slice(2);
assert.ok(packageArgument && worktreeArgument && targetArgument, 'usage: node native-provider.integration.mjs MODULE_ROOT WORKTREE TARGET');
const packageRoot = resolve(packageArgument);
const worktree = resolve(worktreeArgument);
const target = resolve(worktree, targetArgument);
const declaration = JSON.parse(readFileSync(join(packageRoot, 'native-provider.declaration.json'), 'utf8'));
const binding = Object.freeze({
  id: declaration.moduleId,
  revision: declaration.revision,
  declarationDigest: 'integration-declaration',
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
assert.equal(completed.type, 'event');
assert.equal(completed.version, 2);
assert.equal(completed.query, 'integration-query-1');
assert.equal(completed.owner, 'integration-owner-1');
assert.equal(completed.role, '');
assert.equal(completed.incarnation, '');
assert.deepEqual(completed.moduleBinding, binding);
assert.equal(completed.payload.schema, 'baton2.context.bend2.source-analysis.result.v1');
assert.equal(completed.payload.status, 'completed');
assert.equal(completed.payload.session.owner, 'integration-owner-1');
assert.equal(completed.payload.session.identity, target);
assert.equal(completed.payload.retainedReadSet.status, 'sealed');
assert.ok(completed.payload.retainedReadSet.descriptors.some((entry) => entry.real === target && /^[0-9a-f]{64}$/.test(entry.sha256)));

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
  'changed-module-metadata-refused', 'outside-source-refused', 'changed-package-payload-refused',
] }) + '\n');
