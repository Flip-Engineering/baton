// #300: the pre-verdict selection — from changed paths to the test files a check runs before
// the full suite. The selection is derived, deterministic, and honest about WHY each file was
// selected, including the weaker fixture-path signal.
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

/** #593: a check's acceptance is the landing gate's comparison over the selected files. This
 * fixture STUBS that gate the way it stubs the referee — the comparison's own rule is pinned by
 * issue593-check-comparison.test.mjs. */
const greenComparison = (requests) => async (request) => {
  requests.push(request);
  return {
    files: request.files,
    verdictLine: 'green — passed 3, 0 failing only with the change, 0 failing on the target too',
    unexpected: [], failingOnTarget: [], stderrTail: '', exit: 0, cleanupError: null,
  };
};

async function checkFixture(t, { referee, changedPaths, withCapturedFileRead = true, verificationFor, comparison } = {}) {
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
    ...(comparison ? { comparisonGates: comparison } : {}),
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

test('a check runs the affected subset as its acceptance and records it as a typed receipt row', async (t) => {
  const contracts = [];
  const referee = async (task) => {
    contracts.push(task.brief.verification);
    return { reverified: true, observedExit: 0, passed: true, matchesClaim: true, locus: 'fresh_sandbox' };
  };
  const requests = [];
  const f = await checkFixture(t, { referee, changedPaths: ['impl/src/b.mjs'], comparison: greenComparison(requests) });
  await f.coordinator.captureContribution(f.handle.id, { contributionId: 'c1' });
  const receipt = await f.coordinator.checkContribution(f.handle.id, { contributionId: 'c1', checkId: 'k1' });
  assert.equal(receipt.passed, true, "the comparison's verdict decides the check");
  assert.deepEqual(requests.map((request) => request.files), [['impl/test/a.test.mjs']],
    "the comparison runs over the affected file, against the capture's base");
  assert.deepEqual(requests.map((request) => request.baseSha), [CHECK_BASE]);
  assert.deepEqual(contracts, [], 'the pinned whole-suite contract does not run when a comparison applies');
  assert.deepEqual(receipt.preverdict.selection.files, ['impl/test/a.test.mjs']);
  assert.deepEqual(receipt.preverdict.selection.changedPaths, ['impl/src/b.mjs']);
  assert.equal(receipt.preverdict.verdict.outcome, 'passed', 'the subset verdict is closed and typed');
  assert.equal(receipt.preverdict.verdict.schemaVersion, 1);
  const started = f.log.read(f.handle.id).find((event) => event.kind === 'contribution.check_started');
  assert.deepEqual(started.payload.preverdict,
    { files: 1, command: 'node', acceptance: 'comparison', baseSha: CHECK_BASE },
    'the started record names the subset and the acceptance before anything runs');
});

test('a docs-only capture keeps the #269 skip and records it on the receipt', async (t) => {
  let calls = 0;
  const referee = async (task, ...rest) => { calls += 1; return { reverified: true, observedExit: 0, passed: true, matchesClaim: true, locus: 'fresh_sandbox' }; };
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
  assert.deepEqual(receipt.preverdict, { skipped: 'docs' }, 'the docs gate is the whole check; nothing runs before it');
  assert.equal(calls, 1, 'exactly one verification ran');
});

test('a change no test reaches skips the subset by name and a fixture-path change does not', async (t) => {
  const f = await checkFixture(t, { changedPaths: ['impl/src/orphan.mjs'] });
  await f.coordinator.captureContribution(f.handle.id, { contributionId: 'orphan' });
  const receipt = await f.coordinator.checkContribution(f.handle.id, { contributionId: 'orphan', checkId: 'k-o' });
  // the fixture tree's orphan-fixture test NAMES the orphan in a fixture path: it is selected
  assert.equal(receipt.preverdict.selection.files.includes('impl/test/orphan-fixture.test.mjs'), true);
  assert.equal(receipt.preverdict.selection.provenance.find((row) => row.reason === 'fixture-path') !== undefined, true,
    'the receipt says the file was selected by fixture-path naming');
});

test('an empty selection and an unusable selection are named, not silently skipped', async (t) => {
  const f = await checkFixture(t, { changedPaths: ['impl/src/nothing-reads-this.mjs'] });
  await f.coordinator.captureContribution(f.handle.id, { contributionId: 'empty' });
  const receipt = await f.coordinator.checkContribution(f.handle.id, { contributionId: 'empty', checkId: 'k-e' });
  assert.deepEqual(receipt.preverdict, { skipped: 'no_affected_tests' });

  const g = await checkFixture(t, { changedPaths: ['impl/src/b.mjs'], withCapturedFileRead: false });
  await g.coordinator.captureContribution(g.handle.id, { contributionId: 'nounread' });
  const unavailable = await g.coordinator.checkContribution(g.handle.id, { contributionId: 'nounread', checkId: 'k-u' });
  assert.deepEqual(unavailable.preverdict, { skipped: 'selection_unavailable' },
    'no captured-revision reader, no selection — named on the receipt');
  assert.equal(unavailable.passed, true, 'the full suite still checked the contribution');
});

test('a failure the base shares does not fail the check, and the selection is cached per capture', async (t) => {
  const requests = [];
  const f = await checkFixture(t, {
    changedPaths: ['impl/src/b.mjs'],
    comparison: async (request) => {
      requests.push(request);
      return requests.length === 1
        // The affected file fails with the capture AND on the capture's base: a shared failure.
        ? { files: request.files, verdictLine: 'green — passed 2, 0 failing only with the change, 1 failing on the target too',
          unexpected: [], failingOnTarget: ['impl/test/a.test.mjs :: red on the base too'],
          stderrTail: '', exit: 1, cleanupError: null }
        : { files: request.files, verdictLine: 'red — passed 2, 1 failing only with the change, 0 failing on the target too',
          unexpected: ['impl/test/a.test.mjs :: only with the change'], failingOnTarget: [],
          stderrTail: '', exit: 1, cleanupError: null };
    },
  });
  await f.coordinator.captureContribution(f.handle.id, { contributionId: 'c2' });
  const readsBefore = f.reads();
  const first = await f.coordinator.checkContribution(f.handle.id, { contributionId: 'c2', checkId: 'k-1' });
  assert.equal(first.passed, true, 'a failure the base shares is information, never the capture\'s fault');
  assert.equal(first.preverdict.verdict.outcome, 'passed');
  const readsAfterFirst = f.reads();
  assert.ok(readsAfterFirst > readsBefore, 'the first check built the graph from the captured revision');
  // a second check of the SAME capture reuses the cached selection: no re-reading the tree
  const second = await f.coordinator.checkContribution(f.handle.id, { contributionId: 'c2', checkId: 'k-2' });
  assert.equal(second.passed, false, 'a failure only the change has fails the check');
  assert.equal(second.preverdict.verdict.outcome, 'candidate_failed');
  assert.equal(f.reads(), readsAfterFirst, 'the selection is cached per capture commit');
  assert.equal(second.preverdict.selection.reason, first.preverdict.selection.reason);
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
