// Issue #418: the standing numeric-constant lint. The audit lanes covered a closed module
// list; this suite pins the lint that closes the partition — it flags bound-shaped constants
// anywhere in impl/src, exempts exactly the four named channels (registry read, operator env,
// named pragma, comment line), ignores protocol vocabulary, and holds its own table honest
// through the stale-entry check.

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { lintDefaultSourceDirectory, lintNumericConstants } from '../scripts/numeric-constant-lint.mjs';

const dirs = [];
function srcTree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'baton-418-lint-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'src'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, 'src', name), body);
  }
  return dir;
}

test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

test('418-L1: the real tree is green — every bound-shaped constant is declared, exempted or named', () => {
  const findings = lintDefaultSourceDirectory();
  assert.deepEqual(findings, [],
    'the standing inventory regressed: ' + findings.slice(0, 5).map((f) => `${f.file}:${f.line}`).join(', '));
});

test('418-L2: a bound-shaped constant in a module is flagged; the registry/env/pragma/comment channels pass', () => {
  const dir = srcTree({
    'limits.mjs': "export const ROW = { value: 65536 };\n",
    'clean-registry.mjs': "import { FRAME_LIMITS } from './limits.mjs';\nexport const B = FRAME_LIMITS['wire.frame'].value;\n",
    'clean-env.mjs': "export const T = Number(process.env.BATON_X_MS) || 120_000;\n",
    'clean-pragma.mjs': "export const M = 2048; // baton-lint: declared-bound deliberate-local partition (Decision 2)\n",
    'clean-comment.mjs': "// the ceiling is 65536 bytes\nexport const name = 'x';\n",
    'clean-vocabulary.mjs': "const mode = 100644; const code = -32601;\n",
    'dirty.mjs': "export const ceiling = 65536;\n",
  });
  const files = ['limits.mjs', 'clean-registry.mjs', 'clean-env.mjs', 'clean-pragma.mjs', 'clean-comment.mjs', 'clean-vocabulary.mjs', 'dirty.mjs']
    .map((name) => join(dir, 'src', name));
  const findings = lintNumericConstants(files, { srcDir: join(dir, 'src'), staleCheck: false });
  assert.deepEqual(findings.map((f) => f.file), ['dirty.mjs'],
    'exactly the undeclared constant is flagged');
  assert.match(findings[0].constants, /65536/);
});

test('418-L3: multiplied KiB/MiB products flag; sub-KiB literals do not', () => {
  const dir = srcTree({
    'products.mjs': "export const a = 16 * 1024 * 1024;\nexport const b = 750;\n",
  });
  const findings = lintNumericConstants([join(dir, 'src', 'products.mjs')], { srcDir: join(dir, 'src'), staleCheck: false });
  assert.equal(findings.length, 1);
  assert.match(findings[0].constants, /16 \* 1024 \* 1024/);
});

test('418-L4: a table entry whose line vanished is reported stale', () => {
  // The real table names real modules; a tree without them makes every entry stale — the same
  // mechanism that keeps the shipped inventory honest, exercised over a synthetic tree.
  const dir = srcTree({ 'limits.mjs': 'export const r = 1;\n' });
  const findings = lintNumericConstants([join(dir, 'src', 'limits.mjs')], { srcDir: join(dir, 'src') });
  assert.ok(findings.length > 0, 'the stale check runs');
  assert.ok(findings.every((f) => f.line === 0 && /stale exemption/.test(f.reason)),
    'every finding is a stale-entry finding');
});
