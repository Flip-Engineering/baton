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
import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { verificationSelector } from '../src/application-deployment.mjs';
import { SUITE_COMPARISON, suiteRoots } from '../src/suite-comparison.mjs';
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

const CHECK_SHA = 'a'.repeat(40);
const CHECK_BASE = 'b'.repeat(40);

async function checkFixture(t, { referee, changedPaths, withCapturedFileRead = true, verificationFor } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-preverdict-check-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = fixtureTree(t);
  const prompts = [];
  let emit;
  const adapter = {
    card: () => ({ harness: 'mock', version: '1', concurrencyCeiling: null, maxContext: 100000,
      turnCompletion: 'pausable' }),
    onEvent(callback) { emit = callback; },
    async spawn() { return { ok: true }; },
    async prompt(worker, content, mode) { prompts.push({ worker, content, mode }); return { ok: true }; },
    async kill(worker) {
      queueMicrotask(() => emit({ worker, actor: 'worker', kind: 'kill.confirmed', turnEpoch: 1, payload: {} }));
      return { ok: true };
    },
  };
  const log = new Log(join(directory, 'log'));
  const pins = new Map();
  let capturedReads = 0;
  const worktrees = {
    async create(id) { return { path: `/owned/${id}`, baseSha: CHECK_BASE, branch: `baton/${id}` }; },
    capture: async () => ({ sha: CHECK_SHA, baseSha: CHECK_BASE, changedPaths }),
    async retainCheckpoint(sha) { const ref = `refs/baton/checkpoints/${sha}`; pins.set(ref, sha); return ref; },
    async resolveCheckpoint(ref) { return pins.get(ref); },
    async createVerifyWorktree(id, sha) { return { path: `/check/${id}/${sha}` }; },
    async removeVerifyWorktree() {},
    async remove() {},
    async reconcile() {},
    // The check's captured-revision read, fixture-style: the capture sha stands for the tree
    // the fixture just wrote, so the selection reads it exactly as the real seam would.
    ...(withCapturedFileRead ? {
      readCommitFile(sha, path, maxBytes) {
        capturedReads += 1;
        if (sha !== CHECK_SHA) throw Object.assign(new Error('unknown capture'), { code: 'captured_file_unavailable' });
        if (path.length > maxBytes) throw Object.assign(new Error('oversize'), { code: 'captured_file_oversize' });
        return Object.freeze({ path, sha, bytes: 1, text: readFileSync(join(root, path), 'utf8') });
      },
    } : {}),
  };
  const coordinator = new Coordinator({
    log, coordination: coordinationForLog(log), fences: new FenceTable(),
    adapters: { mock: adapter }, worktrees, route: () => 'mock', now: () => 0,
    repoRoot: root,
    ...(verificationFor ? { verificationForCapture: verificationFor } : {}),
    referee: async (...args) => (referee ? referee(...args) : {
      reverified: true, observedExit: 0, passed: true, matchesClaim: true, locus: 'fresh_sandbox',
    }),
  });
  const handle = await coordinator.spawn('mock', {
    goal: 'Deliver an affected-module fix', constraints: [], pathScope: ['**'],
    definitionOfDone: 'Owner decides when collaboration is done',
    // A closed argv contract: file arguments ride this argv, so the subset is derivable.
    verification: { command: 'node', arguments: ['impl/scripts/run-suite.mjs'], expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
  });
  emit({ worker: handle.id, actor: 'worker', kind: 'lifecycle.turn_completed', turnEpoch: 1,
    payload: { status: 'completed', output: 'Contribution is available.' } });
  await new Promise(setImmediate);
  return { coordinator, handle, log, worktrees, reads: () => capturedReads };
}

/** The deployment declaration #593 reads: a code capture is judged by the comparison over the
 * files its changes select. Built through the ONE selector the deployment wires, so the test
 * exercises the declaration path rather than a hand-written answer. */
const declare = verificationSelector({ command: 'npm', arguments: ['test'], comparison: SUITE_COMPARISON });

test('a check hands the comparison the files the capture\'s changes select, through the contract\'s own argv', async (t) => {
  const seen = [];
  const referee = async (task, result, opts) => {
    seen.push({ arguments: task.brief.verification.arguments, comparison: opts?.comparison ?? null });
    return {
      reverified: true, observedExit: 0, passed: true, matchesClaim: true, locus: 'fresh_sandbox',
      comparison: { procedure: SUITE_COMPARISON, files: [...opts.comparison.files], blocking: [], shared: [] },
    };
  };
  const f = await checkFixture(t, { referee, changedPaths: ['impl/src/b.mjs'], verificationFor: declare });
  await f.coordinator.captureContribution(f.handle.id, { contributionId: 'c1' });
  const receipt = await f.coordinator.checkContribution(f.handle.id, { contributionId: 'c1', checkId: 'k1' });
  assert.equal(receipt.passed, true);
  assert.deepEqual(seen.map((row) => row.arguments), [['impl/scripts/run-suite.mjs']],
    'the contract runs unchanged: the comparison appends the selected files itself');
  assert.deepEqual(seen[0].comparison.files, ['impl/test/a.test.mjs']);
  assert.deepEqual(seen[0].comparison.roots, suiteRoots(),
    'the base side resolves a failure\'s file at the roots a runner resolves its arguments at');
  assert.deepEqual(receipt.comparison.selection.files, ['impl/test/a.test.mjs']);
  assert.deepEqual(receipt.comparison.selection.changedPaths, ['impl/src/b.mjs']);
  assert.deepEqual(receipt.comparison.blocking, [], 'the verdict\'s own comparison detail rides the receipt');
  const started = f.log.read(f.handle.id).find((event) => event.kind === 'contribution.check_started');
  assert.deepEqual(started.payload.comparison, { procedure: SUITE_COMPARISON, files: 1 },
    'the started record names the comparison before anything runs');
});

test('a docs-only capture keeps the #269 skip and records it on the receipt', async (t) => {
  const comparisons = [];
  const referee = async (task, result, opts) => {
    comparisons.push(opts?.comparison ?? null);
    return { reverified: true, observedExit: 0, passed: true, matchesClaim: true, locus: 'fresh_sandbox' };
  };
  const f = await checkFixture(t, {
    referee,
    changedPaths: ['impl/src/orphan.mjs'],
    verificationFor: (changed, contract) => ({
      selection: 'docs',
      verification: { ...contract, command: 'node', arguments: ['impl/scripts/surface-gate.mjs'] },
    }),
  });
  await f.coordinator.captureContribution(f.handle.id, { contributionId: 'docs' });
  const receipt = await f.coordinator.checkContribution(f.handle.id, { contributionId: 'docs', checkId: 'k-docs' });
  assert.deepEqual(receipt.comparison, { skipped: 'docs' }, 'the docs gate is the whole check');
  assert.deepEqual(comparisons, [null], 'the docs contract is a command, judged by its own exit code');
});

test('a change no test reaches skips the comparison by name, and no sandbox is opened for it', async (t) => {
  const calls = [];
  const referee = async (...args) => {
    calls.push(args);
    return { reverified: true, observedExit: 0, passed: true, matchesClaim: true, locus: 'fresh_sandbox' };
  };
  const f = await checkFixture(t, {
    referee, changedPaths: ['impl/src/nothing-reads-this.mjs'], verificationFor: declare,
  });
  await f.coordinator.captureContribution(f.handle.id, { contributionId: 'empty' });
  const receipt = await f.coordinator.checkContribution(f.handle.id, { contributionId: 'empty', checkId: 'k-e' });
  assert.equal(receipt.comparison.skipped, 'no_affected_tests');
  assert.deepEqual(receipt.comparison.selection.files, []);
  assert.equal(receipt.passed, true, 'nothing to judge passes, as the landing gate\'s empty derivation does');
  assert.equal(receipt.verdict.diagnosticCode, 'verification_not_required');
  assert.equal(receipt.attempt.phase, 'selection');
  assert.equal(receipt.attempt.cleanup.state, 'closed');
  assert.equal(calls.length, 0, 'a capture with nothing to judge opens no verify sandbox');
});

test('a fixture-path change is selected by the comparison, and the receipt says how', async (t) => {
  const f = await checkFixture(t, { changedPaths: ['impl/src/orphan.mjs'], verificationFor: declare });
  await f.coordinator.captureContribution(f.handle.id, { contributionId: 'orphan' });
  const receipt = await f.coordinator.checkContribution(f.handle.id, { contributionId: 'orphan', checkId: 'k-o' });
  assert.equal(receipt.comparison.selection.files.includes('impl/test/orphan-fixture.test.mjs'), true);
  assert.equal(receipt.comparison.selection.provenance.some((row) => row.reason === 'fixture-path'), true,
    'the receipt says the file was selected by fixture-path naming');
});

test('an unusable selection is named, and the deployment\'s own contract still judges by exit code', async (t) => {
  const comparisons = [];
  const referee = async (task, result, opts) => {
    comparisons.push(opts?.comparison ?? null);
    return { reverified: true, observedExit: 0, passed: true, matchesClaim: true, locus: 'fresh_sandbox' };
  };
  const f = await checkFixture(t, {
    referee, changedPaths: ['impl/src/b.mjs'], withCapturedFileRead: false, verificationFor: declare,
  });
  await f.coordinator.captureContribution(f.handle.id, { contributionId: 'nounread' });
  const unavailable = await f.coordinator.checkContribution(f.handle.id, { contributionId: 'nounread', checkId: 'k-u' });
  assert.deepEqual(unavailable.comparison, { skipped: 'selection_unavailable' },
    'no captured-revision reader, no selection — named on the receipt');
  assert.deepEqual(comparisons, [null], 'without a file set the contract is judged by its own exit code');
  assert.equal(unavailable.passed, true);
});

test('the comparison decides the check, and the selection is cached per capture', async (t) => {
  let call = 0;
  const referee = async () => {
    call += 1;
    return {
      reverified: true, observedExit: call === 1 ? 1 : 0, passed: call !== 1, matchesClaim: true,
      locus: 'fresh_sandbox',
    };
  };
  const f = await checkFixture(t, { referee, changedPaths: ['impl/src/b.mjs'], verificationFor: declare });
  await f.coordinator.captureContribution(f.handle.id, { contributionId: 'c2' });
  const readsBefore = f.reads();
  const first = await f.coordinator.checkContribution(f.handle.id, { contributionId: 'c2', checkId: 'k-1' });
  assert.equal(first.passed, false, 'the comparison is the verdict: a failure its base does not share fails the check');
  assert.equal(first.verdict.outcome, 'candidate_failed');
  const readsAfterFirst = f.reads();
  assert.ok(readsAfterFirst > readsBefore, 'the first check built the graph from the captured revision');
  // a second check of the SAME capture reuses the cached selection: no re-reading the tree
  const second = await f.coordinator.checkContribution(f.handle.id, { contributionId: 'c2', checkId: 'k-2' });
  assert.equal(f.reads(), readsAfterFirst, 'the selection is cached per capture commit');
  assert.deepEqual(second.comparison.selection, first.comparison.selection);
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
