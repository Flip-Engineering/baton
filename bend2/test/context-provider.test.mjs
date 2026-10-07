import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { installedModuleInventory, moduleDirectoryName, resolveSelectedPackageRoot } from '../scripts/context-provider.mjs';

test('installed provider resolves the module named by the frozen binding below its wrapper prefix', () => {
  const prefix = mkdtempSync(join(tmpdir(), 'baton2-installed-context-'));
  try {
    const wrapper = join(prefix, 'libexec/baton2/context-provider.mjs');
    const root = join(prefix, 'lib/context/modules', moduleDirectoryName('bend2'));
    mkdirSync(join(prefix, 'libexec/baton2'), { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(wrapper, '// installed wrapper\n');
    writeFileSync(join(root, 'manifest.json'), JSON.stringify({
      schema: 'baton2-selected-module-artifact-v1', moduleId: 'bend2',
    }));
    const resolved = resolveSelectedPackageRoot(wrapper, 'bend2');
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.root, root);
    const slashId = 'a/../b';
    const slashRoot = join(prefix, 'lib/context/modules', moduleDirectoryName(slashId));
    mkdirSync(slashRoot, { recursive: true });
    writeFileSync(join(slashRoot, 'manifest.json'), JSON.stringify({
      schema: 'baton2-selected-module-artifact-v1', moduleId: slashId,
    }));
    assert.equal(resolveSelectedPackageRoot(wrapper, slashId).root, slashRoot);
    assert.notEqual(moduleDirectoryName('a/b'), moduleDirectoryName('a\\b'));
    assert.equal(resolveSelectedPackageRoot(wrapper, 'other').status, 'refused');
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test('installed provider refuses a manifest identity that differs from the requested module', () => {
  const prefix = mkdtempSync(join(tmpdir(), 'baton2-installed-context-'));
  try {
    const wrapper = join(prefix, 'libexec/baton2/context-provider.mjs');
    const root = join(prefix, 'lib/context/modules', moduleDirectoryName('bend2'));
    mkdirSync(join(prefix, 'libexec/baton2'), { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(wrapper, '// installed wrapper\n');
    writeFileSync(join(root, 'manifest.json'), JSON.stringify({
      schema: 'baton2-selected-module-artifact-v1', moduleId: 'other',
    }));
    assert.equal(resolveSelectedPackageRoot(wrapper, 'bend2').reason, 'selectedModuleManifestMismatch');
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
