// Issue #593: a contribution check is accepted by the LANDING gate's own comparison — the one
// implementation in impl/src/integration-gates.mjs — over the capture's SELECTED files against the
// capture's base. Before this, a check ran the deployment's pinned verification (the whole suite)
// twice and judged its exit code; since #580 that suite is red by design, so every check failed
// and every check cost the host two full suites.
//
// What this file pins:
//   • the comparison runs over the selected files against the capture's base, never the whole suite;
//   • a failure the base shares does not fail the check; a failure the base does not share does;
//   • the pinned verification (the deployment's whole-suite contract) does not run on that path;
//   • an unjudged comparison is never a pass, and a leaked comparison sandbox is named;
//   • a capture whose basis names no base keeps the pinned verification (nothing to compare with).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { compareFailures, verdictFailures } from '../src/integration-gates.mjs';

const CHECK_SHA = 'a'.repeat(40);
const CHECK_BASE = 'b'.repeat(40);

/** The same tiny tree the pre-verdict fixture uses: impl/src/b.mjs is imported by a.test.mjs. */
function fixtureTree(root) {
  mkdirSync(join(root, 'impl/src'), { recursive: true });
  mkdirSync(join(root, 'impl/test'), { recursive: true });
  writeFileSync(join(root, 'impl/src/b.mjs'), 'export const b = 1;\n');
  writeFileSync(join(root, 'impl/src/a.mjs'), "import { b } from './b.mjs';\nexport const a = b;\n");
  writeFileSync(join(root, 'impl/test/a.test.mjs'),
    "import { a } from '../src/a.mjs';\nimport test from 'node:test';\ntest('a', () => {});\n");
}

async function fixture(t, { comparison = null, referee = null, verificationFor = null,
  context = { baseSha: CHECK_BASE } } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-593-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, 'repo');
  mkdirSync(root, { recursive: true });
  fixtureTree(root);
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
  const worktrees = {
    async create(id) { return { path: `/owned/${id}`, baseSha: CHECK_BASE, branch: `baton/${id}` }; },
    capture: async () => ({ sha: CHECK_SHA, baseSha: CHECK_BASE, changedPaths: ['impl/src/b.mjs'] }),
    async retainCheckpoint(sha) { const ref = `refs/baton/checkpoints/${sha}`; pins.set(ref, sha); return ref; },
    async resolveCheckpoint(ref) { return pins.get(ref); },
    async createVerifyWorktree(id, sha) { return { path: `/check/${id}/${sha}` }; },
    async removeVerifyWorktree() {},
    async remove() {},
    async reconcile() {},
    readCommitFile(sha, path, maxBytes) {
      if (sha !== CHECK_SHA) throw Object.assign(new Error('unknown capture'), { code: 'captured_file_unavailable' });
      if (path.length > maxBytes) throw Object.assign(new Error('oversize'), { code: 'captured_file_oversize' });
      return Object.freeze({ path, sha, bytes: 1, text: readFileSync(join(root, path), 'utf8') });
    },
  };
  const pinned = [];
  const coordinator = new Coordinator({
    log, coordination: coordinationForLog(log), fences: new FenceTable(),
    adapters: { mock: adapter }, worktrees, route: () => 'mock', now: () => 0,
    repoRoot: root,
    ...(verificationFor ? { verificationForCapture: verificationFor } : {}),
    ...(comparison ? { comparisonGates: comparison } : {}),
    referee: async (...args) => {
      pinned.push(args);
      return referee ? referee(...args)
        : { reverified: true, observedExit: 0, passed: true, matchesClaim: true, locus: 'fresh_sandbox' };
    },
  });
  const handle = await coordinator.spawn('mock', {
    goal: 'Deliver an affected-module fix', constraints: [], pathScope: ['**'],
    definitionOfDone: 'Owner decides when collaboration is done',
    verification: { command: 'node', arguments: ['impl/scripts/run-suite.mjs'], expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
    ...(context ? { context } : {}),
  });
  emit({ worker: handle.id, actor: 'worker', kind: 'lifecycle.turn_completed', turnEpoch: 1,
    payload: { status: 'completed', output: 'Contribution is available.' } });
  await new Promise(setImmediate);
  return { coordinator, handle, log, pinned };
}

const GREEN = {
  files: ['impl/test/a.test.mjs'],
  verdictLine: 'green — passed 3, 0 failing only with the change, 1 failing on the target too',
  unexpected: [],
  failingOnTarget: ['impl/test/a.test.mjs :: known red, red on the base too'],
  stderrTail: '', exit: 1, cleanupError: null,
};

test('#593: a check is accepted by the comparison over the selected files against the capture base', async (t) => {
  const requests = [];
  const f = await fixture(t, {
    comparison: async (request) => { requests.push(request); return { ...GREEN }; },
  });
  await f.coordinator.captureContribution(f.handle.id, { contributionId: 'c1' });
  const receipt = await f.coordinator.checkContribution(f.handle.id, { contributionId: 'c1', checkId: 'k1' });

  assert.equal(requests.length, 1, 'the comparison runs exactly once');
  assert.equal(requests[0].sha, CHECK_SHA, 'it compares the capture');
  assert.equal(requests[0].baseSha, CHECK_BASE, 'against the capture\'s basis base');
  assert.deepEqual(requests[0].files, ['impl/test/a.test.mjs'], 'over the SELECTED files, not the whole suite');
  assert.equal(f.pinned.length, 0, 'the deployment\'s pinned whole-suite verification never runs on this path');

  assert.equal(receipt.passed, true, 'a failure the base shares never fails the capture');
  assert.equal(receipt.verification.locus, 'comparison', 'the receipt names what decided');
  assert.equal(receipt.verification.baseSha, CHECK_BASE);
  assert.equal(receipt.verification.files, 1);
  assert.deepEqual(receipt.preverdict.selection.files, ['impl/test/a.test.mjs']);
  assert.equal(receipt.preverdict.verdict.outcome, 'passed');
  assert.equal(receipt.verdict.passed, true);
  assert.equal(receipt.verdict.diagnosticCode, 'verification_passed');
  assert.deepEqual(receipt.comparison.sharedOnBase, GREEN.failingOnTarget);
  assert.deepEqual(receipt.comparison.blocking, []);
  assert.equal(receipt.attempt.cleanup.state, 'closed');

  const started = f.log.read(f.handle.id).find((event) => event.kind === 'contribution.check_started');
  assert.equal(started.payload.preverdict.acceptance, 'comparison',
    'the started record already names the acceptance, before anything runs');
  assert.equal(started.payload.preverdict.baseSha, CHECK_BASE);
});

test('#593: a failure the base does not share fails the check and is named', async (t) => {
  const blocking = 'impl/test/a.test.mjs :: a test the capture broke';
  const f = await fixture(t, {
    comparison: async () => ({
      ...GREEN,
      verdictLine: 'red — passed 2, 1 failing only with the change, 0 failing on the target too',
      unexpected: [blocking],
      failingOnTarget: [],
    }),
  });
  await f.coordinator.captureContribution(f.handle.id, { contributionId: 'c2' });
  const receipt = await f.coordinator.checkContribution(f.handle.id, { contributionId: 'c2', checkId: 'k2' });

  assert.equal(receipt.passed, false, 'a failure only the change has blocks');
  assert.deepEqual(receipt.comparison.blocking, [blocking]);
  assert.equal(receipt.verdict.outcome, 'candidate_failed');
  assert.equal(receipt.verdict.failureOwnership, 'candidate');
  assert.equal(receipt.verdict.diagnosticCode, 'verification_exit_mismatch');
  assert.equal(receipt.preverdict.verdict.outcome, 'candidate_failed');
});

test('#593: an unjudged comparison is never a pass, and a leaked sandbox is named', async (t) => {
  const leak = Object.assign(new Error('verification cleanup failed'), {
    code: 'worktree_cleanup_failed', paths: ['/check/x'],
  });
  const f = await fixture(t, {
    comparison: async () => ({
      files: ['impl/test/a.test.mjs'], verdictLine: null, exit: null, stderrTail: 'runner died',
      unexpected: [{ row: 'suite-did-not-judge', script: 'impl/scripts/run-suite.mjs', exitStatus: null }],
      failingOnTarget: [], cleanupError: leak,
    }),
  });
  await f.coordinator.captureContribution(f.handle.id, { contributionId: 'c3' });
  const receipt = await f.coordinator.checkContribution(f.handle.id, { contributionId: 'c3', checkId: 'k3' });

  assert.equal(receipt.passed, false, 'a run that judged nothing is not a green gate set');
  assert.equal(receipt.verdict.diagnosticCode, 'verification_exit_mismatch');
  assert.equal(receipt.cleanup.state, 'incomplete', 'the leaked sandbox rides the receipt');
  assert.equal(receipt.cleanup.code, 'worktree_cleanup_failed');
  assert.equal(receipt.attempt.cleanup.state, 'incomplete');
});

test('#593: a docs capture is never compared — the deployment docs verification stays the check', async (t) => {
  const requests = [];
  const f = await fixture(t, {
    comparison: async (request) => { requests.push(request); return { ...GREEN }; },
    verificationFor: (changed, contract) => ({
      selection: 'docs',
      verification: { ...contract, command: 'node', arguments: ['impl/scripts/surface-gate.mjs'] },
    }),
  });
  await f.coordinator.captureContribution(f.handle.id, { contributionId: 'c4' });
  const receipt = await f.coordinator.checkContribution(f.handle.id, { contributionId: 'c4', checkId: 'k4' });

  assert.equal(requests.length, 0, 'a docs capture has no selected test files to compare');
  assert.equal(f.pinned.length, 1, 'the docs verification is the whole check');
  assert.deepEqual(receipt.preverdict, { skipped: 'docs' });
  assert.equal(Object.hasOwn(receipt, 'comparison'), false, 'no comparison row is claimed');
});

test('#593: the comparison rule is one implementation — failures compare by file and failure type', () => {
  const change = verdictFailures({ failures: [
    { key: 'impl/test/a.test.mjs :: one', file: 'impl/test/a.test.mjs', name: 'one', failureType: null },
    { key: 'impl/test/b.test.mjs :: (file hung…)', file: 'impl/test/b.test.mjs', name: '(file hung: 1 ms)', failureType: 'fileHung' },
    { key: 'impl/test/c.test.mjs :: a new failure', file: 'impl/test/c.test.mjs', name: 'a new failure', failureType: null },
  ] });
  const base = verdictFailures({ failures: [
    { key: 'impl/test/a.test.mjs :: one', file: 'impl/test/a.test.mjs', name: 'one', failureType: null },
    // the same FILE, hung at a different moment: the identity is file + failure type, so it is shared
    { key: 'impl/test/b.test.mjs :: (file hung: 9 ms)', file: 'impl/test/b.test.mjs', name: '(file hung: 9 ms)', failureType: 'fileHung' },
  ] });
  const { blocking, shared } = compareFailures(change, base);
  assert.deepEqual(blocking.map((row) => row.key), ['impl/test/c.test.mjs :: a new failure']);
  assert.deepEqual(shared.map((row) => row.key),
    ['impl/test/a.test.mjs :: one', 'impl/test/b.test.mjs :: (file hung…)']);

  // A runner older than #580 writes only `unexpected`: a `file :: name` string is a test-level
  // failure, anything else keeps no file and always blocks.
  const legacy = verdictFailures({ unexpected: ['impl/test/a.test.mjs :: one', { row: 'suite-did-not-judge' }] });
  assert.equal(legacy[0].file, 'impl/test/a.test.mjs');
  assert.equal(legacy[0].name, 'one');
  assert.equal(legacy[1].file, null, 'an un-attributable row cannot be re-run on the base');
  assert.deepEqual(compareFailures(legacy, base).blocking.map((row) => row.key),
    ['{"row":"suite-did-not-judge"}'],
    'the un-attributable row is not excused by the base, while a `file :: name` key the base reports the same way is');
  assert.deepEqual(compareFailures(legacy, base).shared.map((row) => row.key),
    ['impl/test/a.test.mjs :: one'],
    'a legacy row whose key the base shares is a shared failure');
});
