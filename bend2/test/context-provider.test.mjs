import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { moduleDirectoryName, resolveSelectedPackageRoot } from '../scripts/context-provider.mjs';

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
