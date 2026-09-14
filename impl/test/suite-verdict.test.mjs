// The suite verdict decision procedure (issue #260): expected red must fail, unlisted failures
// are regressions, hangs are never expected, stale expectations refuse, and the progress
// deadline re-arms on every event.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeVerdict, createProgressDeadline, formatVerdict, isHang, loadExpectedRed, rowKey, writeExpectedRed,
} from '../scripts/suite-verdict.mjs';

const row = (file, name, extra = {}) => ({ file, name, nesting: 0, ...extra });

test('a run whose only failures are the listed red-first specs is green', () => {
  const manifest = { rows: [rowKey('test/a-red.test.mjs', 'A1 RED')] };
  const verdict = computeVerdict([{ lane: 'parallel', passed: [row('test/b.test.mjs', 'B1')], failed: [row('test/a-red.test.mjs', 'A1 RED', { failureType: 'testCodeFailure', message: 'stage: missing' })] }], manifest);
  assert.equal(verdict.green, true);
  assert.deepEqual(verdict.expectedRed, ['test/a-red.test.mjs :: A1 RED']);
  assert.equal(verdict.passed, 1);
});

test('an unlisted failure is an unexpected failure and the verdict is red', () => {
  const verdict = computeVerdict([{ lane: 'parallel', passed: [], failed: [row('test/b.test.mjs', 'B1', { failureType: 'testCodeFailure', message: 'boom\nmore' })] }], { rows: [] });
  assert.equal(verdict.green, false);
  assert.deepEqual(verdict.unexpected, [{ key: 'test/b.test.mjs :: B1', message: 'boom\nmore' }]);
  assert.match(formatVerdict(verdict), /unexpected failure: test\/b\.test\.mjs :: B1 — boom/u);
});

test('a listed expectation that passes, or never runs, is stale and refuses', () => {
  const manifest = { rows: [rowKey('test/a-red.test.mjs', 'A1 RED'), rowKey('test/gone.test.mjs', 'G1')] };
  const verdict = computeVerdict([{ lane: 'parallel', passed: [row('test/a-red.test.mjs', 'A1 RED')], failed: [] }], manifest);
  assert.equal(verdict.green, false);
  assert.deepEqual(verdict.stale, ['test/a-red.test.mjs :: A1 RED']);
  assert.deepEqual(verdict.unseen, ['test/gone.test.mjs :: G1']);
});

test('a test cancelled by a dangling await earlier in its file is a listable red, counted as cancelled', () => {
  const key = rowKey('test/c.test.mjs', 'C2');
  const failure = { failureType: 'cancelledByParent', message: 'Promise resolution is still pending but the event loop has already resolved' };
  assert.equal(isHang(failure), false);
  const listed = computeVerdict([{ lane: 'suite', passed: [], failed: [row('test/c.test.mjs', 'C2', failure)] }], { rows: [key] });
  assert.equal(listed.green, true);
  assert.equal(listed.cancelled, 1);
  const unlisted = computeVerdict([{ lane: 'suite', passed: [], failed: [row('test/c.test.mjs', 'C2', failure)] }], { rows: [] });
  assert.equal(unlisted.green, false);
  assert.equal(unlisted.unexpected.length, 1);
});

test('hangs are never expected red, even when listed', () => {
  const key = rowKey('test/h.test.mjs', 'H1');
  for (const failure of [
    { failureType: 'fileHung', message: 'hung' },
    { failureType: 'testTimeoutFailure', message: 'test timed out after 1000ms' },
  ]) {
    assert.equal(isHang(failure), true, failure.failureType);
    const verdict = computeVerdict([{ lane: 'serial', passed: [], failed: [row('test/h.test.mjs', 'H1', failure)] }], { rows: [key] });
    assert.equal(verdict.green, false);
    assert.equal(verdict.hung.length, 1);
    assert.deepEqual(verdict.expectedRed, []);
  }
});

test('a stalled lane refuses and suppresses the unseen-row judgement it could not make', () => {
  const manifest = { rows: [rowKey('test/late.test.mjs', 'L1')] };
  const verdict = computeVerdict([{ lane: 'serial', passed: [], failed: [], stalled: { lastEvent: 'S9', idleMs: 600_000 } }], manifest);
  assert.equal(verdict.green, false);
  assert.deepEqual(verdict.stalled, [{ lane: 'serial', lastEvent: 'S9', idleMs: 600_000 }]);
  assert.deepEqual(verdict.unseen, []);
  assert.match(formatVerdict(verdict), /stalled lane serial: no test event for 600000 ms after S9/u);
});

test('the manifest round-trips sorted and unique, and refuses malformed shapes', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-verdict-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'expected-red-tests.json');
  assert.deepEqual(loadExpectedRed(path), { schemaVersion: 1, rows: [] });
  const written = writeExpectedRed(path, ['test/z.test.mjs :: Z', 'test/a.test.mjs :: A', 'test/z.test.mjs :: Z']);
  assert.deepEqual(written, ['test/a.test.mjs :: A', 'test/z.test.mjs :: Z']);
  assert.deepEqual(loadExpectedRed(path).rows, written);
  writeExpectedRed(path, []);
  assert.deepEqual(loadExpectedRed(path).rows, []);
  const bad = join(directory, 'bad.json');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(bad, JSON.stringify({ schemaVersion: 1, rows: ['no separator'] }));
  assert.throws(() => loadExpectedRed(bad), { code: 'suite_manifest_invalid' });
});

test('the progress deadline re-arms on every observed event', () => {
  let clock = 0;
  const deadline = createProgressDeadline({ timeoutMs: 100, now: () => clock });
  clock = 90; assert.equal(deadline.expired(), false);
  deadline.observe();
  clock = 189; assert.equal(deadline.expired(), false);
  clock = 190; assert.equal(deadline.expired(), true);
  assert.equal(deadline.idleMs(), 100);
  assert.throws(() => createProgressDeadline({ timeoutMs: 0 }), TypeError);
});
