// #300/#593: the selection — from changed paths to the test files a check judges — is derived,
// deterministic, and honest about WHY each file was selected, including the weaker fixture-path
// signal. Since #593 it is the file set the check's comparison runs, not a pre-verdict ahead of a
// full-suite acceptance.
import { spawn } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  parseStaticImports, resolveImportSpecifier,
  selectAffectedTests, selectFromRepository,
} from '../src/verification-selection.mjs';

const IMPL = resolve(import.meta.dirname, '..');

function fixtureTree(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-preverdict-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'impl/src'), { recursive: true });
  mkdirSync(join(root, 'impl/test'), { recursive: true });
  mkdirSync(join(root, 'impl/scripts'), { recursive: true });
  writeFileSync(join(root, 'impl/src/b.mjs'), 'export const b = 1;\n');
  writeFileSync(join(root, 'impl/src/a.mjs'), "import { b } from './b.mjs';\nexport const a = b;\n");
  writeFileSync(join(root, 'impl/src/orphan.mjs'), 'export const orphan = 1;\n');
  writeFileSync(join(root, 'impl/test/a.test.mjs'), "import { a } from '../src/a.mjs';\nimport test from 'node:test';\ntest('a', () => {});\n");
  // names the orphan in a fixture path, imports nothing from impl/src
  writeFileSync(join(root, 'impl/test/orphan-fixture.test.mjs'), "import { execFileSync } from 'node:child_process';\nconst script = join('impl', 'src', 'orphan.mjs');\n");
  writeFileSync(join(root, 'impl/test/unrelated.test.mjs'), "import test from 'node:test';\ntest('unrelated', () => {});\n");
  // A fixture the suite's tests read by path, and a nested fixture that imports a module: neither
  // is a test file, so neither selects itself, and a change to one reaches the tests that read it.
  mkdirSync(join(root, 'impl/test/fixtures'), { recursive: true });
  writeFileSync(join(root, 'impl/src/c.mjs'), 'export const c = 1;\n');
  writeFileSync(join(root, 'impl/test/fixtures/fake-cli.mjs'), 'export const fakeCli = 1;\n');
  writeFileSync(join(root, 'impl/test/fixtures/importer-fixture.mjs'),
    "import { c } from '../../src/c.mjs';\nexport const seen = c;\n");
  writeFileSync(join(root, 'impl/test/reads-fixture.test.mjs'),
    "import test from 'node:test';\nimport { seen } from './fixtures/importer-fixture.mjs';\n"
    + "const script = 'impl/test/fixtures/fake-cli.mjs';\ntest('reads the fixture', () => {});\n");
  return root;
}

const graphOf = (root) => ({ selection: (changedPaths) => selectFromRepository({ root, changedPaths }) });

test('a test importing a changed module transitively is selected, and the changed test selects itself', async (t) => {
  const root = fixtureTree(t);
  const { selection } = graphOf(root);
  const selected = selection(['impl/src/b.mjs']);
  assert.deepEqual(selected.files, ['impl/test/a.test.mjs'], 'the test that imports a.mjs which imports b.mjs is affected');
  assert.equal(selected.provenance[0].reason, 'imports');
  assert.equal(selected.provenance[0].via, 'impl/src/a.mjs', 'the changed module the transitive import reaches');

  const self = selection(['impl/test/a.test.mjs']);
  assert.deepEqual(self.files, ['impl/test/a.test.mjs']);
  assert.equal(self.provenance[0].reason, 'changed', 'a changed test file selects itself');
});

test('a file no test imports selects the tests that name it in a fixture path, and says so', async (t) => {
  const root = fixtureTree(t);
  const { selection } = graphOf(root);
  const selected = selection(['impl/src/orphan.mjs']);
  assert.deepEqual(selected.files, ['impl/test/orphan-fixture.test.mjs']);
  assert.equal(selected.provenance[0].reason, 'fixture-path');
  assert.match(selected.reason, /fixture path/u, 'the selection names the weaker fixture-path mechanism');
  const untouched = selection(['impl/src/nothing-changed-here.mjs']);
  assert.deepEqual(untouched.files, [], 'a changed file nothing reads selects nothing');
  assert.match(untouched.reason, /affect no test file/u);
});

// The 2026-09-26 landing of impl/test/fixtures/fake-claude.mjs selected the fixture ITSELF — it is a
// file under the test directory, so rule 1 claimed it — and none of the 17 test files that read it,
// because rule 3 skips a path the selection already holds. The runner then ran nothing for it: the
// landing gate derives each runner name from the test directory, and the fixture's name came back
// as `test/<basename>`, which the checkout does not carry. A file under the test directory's own
// subdirectories is a fixture, not a test file.
test('a changed fixture under the test directory selects its readers, never itself', async (t) => {
  const root = fixtureTree(t);
  const { selection } = graphOf(root);
  const selected = selection(['impl/test/fixtures/fake-cli.mjs']);
  assert.deepEqual(selected.files, ['impl/test/reads-fixture.test.mjs'],
    'the test that names the fixture in a path is the file the change selects');
  assert.equal(selected.provenance[0].reason, 'fixture-path');
  assert.equal(selected.provenance[0].via, 'impl/test/fixtures/fake-cli.mjs');
  assert.match(selected.reason, /naming an otherwise-unimported file in a fixture path/u);
});

test('a selection names only the test directory\'s own entries, and reaches readers through a nested fixture', async (t) => {
  const root = fixtureTree(t);
  const { selection } = graphOf(root);
  const selected = selection(['impl/src/c.mjs']);
  assert.deepEqual(selected.files, ['impl/test/reads-fixture.test.mjs'],
    'the reader that imports the nested fixture is selected, and the fixture itself is not');
  assert.deepEqual(selected.provenance, [
    { path: 'impl/test/reads-fixture.test.mjs', reason: 'imports', via: 'impl/test/fixtures/importer-fixture.mjs' },
  ], 'the account names the nested fixture the import edge crossed');
  for (const file of selected.files) {
    assert.match(file, /^impl\/test\/[^/]+$/u,
      'the landing gate derives each runner name from the test directory, so a selection holds only that directory\'s own entries');
  }
});

test('the selection is deterministic', async (t) => {
  const root = fixtureTree(t);
  const { selection } = graphOf(root);
  const first = selection(['impl/src/b.mjs', 'impl/src/orphan.mjs']);
  const second = selection(['impl/src/orphan.mjs', 'impl/src/b.mjs'], undefined);
  assert.deepEqual(first, second, 'changed-path order does not change the selection');
  assert.equal(Object.hasOwn(first, 'rows'), false, 'a selection names files, never a list of expected failures');
  assert.deepEqual(selectAffectedTests({
    changedPaths: ['impl/src/b.mjs'], graph: new Map(), exists: () => false,
  }).files, [], 'a changed file the revision does not carry selects nothing');
});

test('static import parsing covers the ESM forms and refuses what is not a file edge', () => {
  assert.deepEqual(parseStaticImports(
    "import x, { y as z } from './a.mjs';\nimport * as ns from '../src/b.mjs';\nimport './side-effect.mjs';\nexport { ok } from './c.mjs';\nexport * from './d.mjs';\n",
  ), ['./a.mjs', '../src/b.mjs', './side-effect.mjs', './c.mjs', './d.mjs']);
  assert.deepEqual(parseStaticImports("const dynamic = await import('./late.mjs');"), [],
    'a dynamic import is a runtime decision, not a static edge');
  assert.equal(resolveImportSpecifier('node:fs', 'impl/src/a.mjs'), null);
  assert.equal(resolveImportSpecifier('baton', 'impl/src/a.mjs'), null);
  assert.equal(resolveImportSpecifier('./b.mjs', 'impl/src/a.mjs'), 'impl/src/b.mjs');
  assert.equal(resolveImportSpecifier('../test/a.test.mjs', 'impl/src/a.mjs'), 'impl/test/a.test.mjs');
});

// ── the CLI: run-suite --changed runs the same selection from the runner's own checkout ──

function runRunner(args, parent) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [join(IMPL, 'scripts', 'run-suite.mjs'), ...args], {
      cwd: IMPL, env: { ...process.env, BATON_TEST_TMP_PARENT: parent },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', () => resolveRun({ code: -1, stderr }));
    child.once('close', (code) => resolveRun({ code, stderr }));
  });
}

test('run-suite --changed selects the affected tests from its own checkout and lands green', async (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'baton-preverdict-runner-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  // A changed test file selects itself, and no test imports suite-verdict.test.mjs, so the
  // selection is that one file whatever the rest of the import graph looks like. The import-edge
  // and fixture-path rules are covered by the selectAffectedTests tests above.
  const run = await runRunner(['--changed', 'impl/test/suite-verdict.test.mjs'], parent);
  assert.equal(run.code, 0, 'the selected subset is green');
  assert.match(run.stderr, /selected 1 test file\(s\) from 1 changed path\(s\)/u);
  assert.match(run.stderr, /impl\/test\/suite-verdict\.test\.mjs \(changed\)/u,
    'the run says the file was selected because it changed');
});

test('run-suite --changed refuses to run with no paths', async (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'baton-preverdict-runner-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const unnamed = await runRunner(['--changed'], parent);
  assert.equal(unnamed.code, 1, 'an unnamed selection would silently mean the whole suite');
  assert.match(unnamed.stderr, /--changed names the changed paths/u);
});
