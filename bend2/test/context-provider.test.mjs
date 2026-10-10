import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { installedModuleInventory, sessionModuleInventory, moduleDirectoryName, resolveSelectedPackageRoot, verifyInvocationArtifact } from '../scripts/context-provider.mjs';

test('installed provider resolves the module named by the invocation below its wrapper prefix', () => {
  const prefix = mkdtempSync(join(tmpdir(), 'baton2-installed-context-'));
  try {
    const wrapper = join(prefix, 'libexec/baton2/context-provider.mjs');
    const root = join(prefix, 'lib/context/modules', moduleDirectoryName('bend2'));
    mkdirSync(join(prefix, 'libexec/baton2'), { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(wrapper, '// installed wrapper\n');
    const resolved = resolveSelectedPackageRoot(wrapper, 'bend2');
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.root, root);
    const slashId = 'a/../b';
    const slashRoot = join(prefix, 'lib/context/modules', moduleDirectoryName(slashId));
    mkdirSync(slashRoot, { recursive: true });
    assert.equal(resolveSelectedPackageRoot(wrapper, slashId).root, slashRoot);
    assert.notEqual(moduleDirectoryName('a/b'), moduleDirectoryName('a\\b'));
    assert.equal(resolveSelectedPackageRoot(wrapper, 'other').status, 'refused');
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test('installed provider resolves the selected package without a generated manifest', () => {
  const prefix = mkdtempSync(join(tmpdir(), 'baton2-installed-context-'));
  try {
    const wrapper = join(prefix, 'libexec/baton2/context-provider.mjs');
    const root = join(prefix, 'lib/context/modules', moduleDirectoryName('bend2'));
    mkdirSync(join(prefix, 'libexec/baton2'), { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(wrapper, '// installed wrapper\n');
    const selected = resolveSelectedPackageRoot(wrapper, 'bend2');
    assert.equal(selected.status, 'resolved');
    assert.equal(selected.root, root);
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test('installed module inventory reports an absent selected-payload directory as empty', () => {
  const prefix = mkdtempSync(join(tmpdir(), 'baton2-installed-context-'));
  try {
    const wrapper = join(prefix, 'libexec/baton2/context-provider.mjs');
    mkdirSync(join(prefix, 'libexec/baton2'), { recursive: true });
    writeFileSync(wrapper, '// installed wrapper\n');
    assert.deepEqual(installedModuleInventory({ wrapperPath: wrapper }), {
      status: 'available', modules: [], refusals: [],
    });
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test('installed module inventory reports malformed and symlinked module entries', () => {
  const prefix = mkdtempSync(join(tmpdir(), 'baton2-installed-context-'));
  try {
    const wrapper = join(prefix, 'libexec/baton2/context-provider.mjs');
    const modules = join(prefix, 'lib/context/modules');
    mkdirSync(join(prefix, 'libexec/baton2'), { recursive: true });
    mkdirSync(modules, { recursive: true });
    writeFileSync(wrapper, '// installed wrapper\n');
    mkdirSync(join(modules, 'm-zz'));
    symlinkSync(tmpdir(), join(modules, 'm-62656e6432'));
    assert.deepEqual(installedModuleInventory({ wrapperPath: wrapper }), {
      status: 'available', modules: [], refusals: [
        { moduleId: 'bend2', reason: 'selectedModuleEntryNotDirectory' },
        { directory: 'm-zz', reason: 'selectedModuleDirectoryNameInvalid' },
      ],
    });
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test('session inventory reports project settings and preserves capabilities on policy read failures', async () => {
  const prefix = mkdtempSync(join(tmpdir(), 'baton2-session-inventory-'));
  try {
    const wrapper = join(prefix, 'libexec/baton2/context-provider.mjs');
    const worktree = join(prefix, 'project');
    const moduleRoot = join(prefix, 'lib/context/modules', moduleDirectoryName('bend2'));
    mkdirSync(join(prefix, 'libexec/baton2'), { recursive: true });
    mkdirSync(moduleRoot, { recursive: true });
    mkdirSync(join(worktree, '.baton'), { recursive: true });
    writeFileSync(wrapper, '// installed wrapper\n');
    const declaration = { moduleId: 'bend2', operations: [{ id: 'sourceAnalysis' }] };
    writeFileSync(join(moduleRoot, 'native-provider.declaration.json'), JSON.stringify(declaration));
    const read = () => sessionModuleInventory({ owner: 'worker', worktree, wrapperPath: wrapper });
    const policy = join(worktree, '.baton/context.json');
    const absent = await read();
    assert.deepEqual(absent.scope, { session: 'worker', workspace: worktree });
    assert.equal(absent.projectPolicy.status, 'absent');
    assert.equal(absent.modules[0].enabled, true);
    assert.equal(absent.modules[0].preferred, false);

    writeFileSync(policy, JSON.stringify({ schema: 'baton2-context-project-v1',
      disabled: ['bend2'], preferred: ['bend2'] }));
    const configured = await read();
    assert.equal(configured.projectPolicy.status, 'present');
    assert.equal(configured.modules[0].enabled, false);
    assert.equal(configured.modules[0].preferred, true);
    assert.deepEqual(configured.modules[0].declaration, declaration);
    assert.equal(installedModuleInventory({ wrapperPath: wrapper }).modules[0].enabled, undefined);

    writeFileSync(policy, '{');
    const malformed = await read();
    assert.equal(malformed.status, 'available');
    assert.equal(malformed.projectPolicy.reason, 'projectPolicyMalformed');
    assert.equal(malformed.modules[0].enabled, null);
    assert.equal(malformed.modules[0].preferred, null);
    assert.deepEqual(malformed.modules[0].declaration, declaration);

    rmSync(policy);
    mkdirSync(policy);
    const unreadable = await read();
    assert.equal(unreadable.projectPolicy.status, 'unavailable');
    assert.equal(unreadable.projectPolicy.reason, 'EISDIR');
    assert.equal(unreadable.modules[0].enabled, null);
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test('generic project policy entry runs from Core assets with no selected module installed', () => {
  const prefix = mkdtempSync(join(tmpdir(), 'baton2-project-policy-core-'));
  try {
    const worktree = join(prefix, 'checkout');
    const wrapperDir = join(prefix, 'libexec/baton2');
    mkdirSync(wrapperDir, { recursive: true });
    mkdirSync(worktree);
    execFileSync('git', ['init', '--quiet', worktree]);
    for (const name of ['context-provider.mjs', 'context-project-policy.mjs', 'context-worktree-capture.mjs']) {
      copyFileSync(new URL(`../scripts/${name}`, import.meta.url), join(wrapperDir, name));
    }
    const wrapper = join(wrapperDir, 'context-provider.mjs');
    const run = (owner) => spawnSync(process.execPath, [wrapper, '--project-policy'], {
      input: JSON.stringify({ owner, worktree }), encoding: 'utf8',
    });
    const absent = run('query-absent');
    assert.equal(absent.status, 0, absent.stderr);
    assert.equal(JSON.parse(absent.stdout).status, 'absent');
    assert.deepEqual(JSON.parse(absent.stdout).disabled, []);

    mkdirSync(join(worktree, '.baton'));
    writeFileSync(join(worktree, '.baton/context.json'),
      '{"schema":"baton2-context-project-v1","disabled":["example.disabled"],"preferred":[]}');
    const present = run('query-present');
    assert.equal(present.status, 0, present.stderr);
    assert.equal(JSON.parse(present.stdout).status, 'present');
    assert.deepEqual(JSON.parse(present.stdout).disabled, ['example.disabled']);
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test('retained invocation file supplies the exact native provider request', () => {
  const prefix = mkdtempSync(join(tmpdir(), 'baton2-invocation-artifact-'));
  try {
    const wrapperDir = join(prefix, 'libexec/baton2');
    const attempt = join(prefix, 'attempt');
    mkdirSync(wrapperDir, { recursive: true });
    mkdirSync(attempt, { mode: 0o700 });
    const wrapper = join(wrapperDir, 'context-provider.mjs');
    copyFileSync(new URL('../scripts/context-provider.mjs', import.meta.url), wrapper);
    const artifact = join(attempt, 'invocation.json');
    writeFileSync(artifact, JSON.stringify({
      version: 2,
      query: 'q-artifact',
      owner: 'owner-artifact',
      moduleBinding: { id: 'uninstalled-provider' },
      request: {}, inputIdentities: [], operationPlan: [], role: 'starter', incarnation: '0',
    }), { mode: 0o400 });
    const result = spawnSync(process.execPath, [wrapper, '--invoke-file', artifact], {
      input: 'invalid stdin', encoding: 'utf8',
    });
    assert.equal(result.status, 2, result.stderr + result.stdout);
    assert.equal(JSON.parse(result.stdout).reason, 'selectedModulePackageUnavailable');
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test('invocation artifact verification reads ordinary files and reports missing selected packages', () => {
  const directory = mkdtempSync(join(tmpdir(), 'baton2-verify-invocation-'));
  try {
    const ordinary = join(directory, 'ordinary.json');
    writeFileSync(ordinary, JSON.stringify({
      version: 2,
      query: 'q-artifact',
      owner: 'owner-artifact',
      moduleBinding: { id: 'uninstalled-provider' },
      request: {}, inputIdentities: [], operationPlan: [], role: null, incarnation: null,
    }) + '\n', { mode: 0o600 });
    assert.equal(verifyInvocationArtifact(ordinary).reason, 'selectedModulePackageUnavailable');

    const malformed = join(directory, 'malformed.json');
    writeFileSync(malformed, '{');
    assert.equal(verifyInvocationArtifact(malformed).reason, 'invocationArtifactVerificationFailed');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
