// The suite verdict (issue #260): what the canonical run MEANS, computed from the reporter's
// per-lane summaries and the expected-red manifest. Pure functions — the runner formats and
// exits, tests pin the decision procedure.
//
// Manifest rows are `file :: name` (the reporter's row key). A row listed there is an intentional
// red-first spec: it must fail. The verdict is green only when
//   - no test failed that is NOT listed (an unexpected failure is a regression), and
//   - no listed test passed (a stale expectation must be removed — the spec went green), and
//   - no test was cancelled / timed out / hung (a hang is never an expected red), and
//   - no lane stalled (the runner's progress deadline expired with tests still pending).
import { readFileSync, writeFileSync } from 'node:fs';

export const MANIFEST_SCHEMA_VERSION = 1;

export function rowKey(file, name) {
  return `${file} :: ${name}`;
}

export function loadExpectedRed(path) {
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return { schemaVersion: MANIFEST_SCHEMA_VERSION, rows: [] };
    throw Object.assign(new Error(`expected-red manifest is unreadable: ${error.message}`), { code: 'suite_manifest_invalid' });
  }
  if (parsed?.schemaVersion !== MANIFEST_SCHEMA_VERSION || !Array.isArray(parsed.rows)
    || parsed.rows.some((row) => typeof row !== 'string' || !row.includes(' :: '))) {
    throw Object.assign(new Error('expected-red manifest must be {schemaVersion: 1, rows: ["file :: name", ...]}'), { code: 'suite_manifest_invalid' });
  }
  return parsed;
}

export function writeExpectedRed(path, rows) {
  const sorted = [...new Set(rows)].sort();
  writeFileSync(path, `${JSON.stringify({ schemaVersion: MANIFEST_SCHEMA_VERSION, rows: sorted }, null, 2)}\n`);
  return sorted;
}

// A hang is a test the RUNNER had to stop: its file emitted nothing until the progress deadline
// (fileHung, minted by run-suite) or node's own per-test timeout fired (testTimeoutFailure /
// testAborted). `cancelledByParent` is different: an earlier test in the file awaited something
// that can never settle, the event loop drained, and node cancelled the rest (its message reads
// "Promise resolution is still pending but the event loop has already resolved"). The file
// finishes in milliseconds, so it is a deterministic red (a dangling await that must be fixed)
// and is listable in the manifest by name like any other expected-not-to-pass row; the verdict
// still names it as cancelled so the count stays visible. Classification reads node's typed
// `failureType` only — never the message prose.
const HANG_FAILURE_TYPES = new Set(['testTimeoutFailure', 'testAborted', 'fileHung']);

export function isHang(failure) {
  return HANG_FAILURE_TYPES.has(failure.failureType);
}

export function isCancelled(failure) {
  return failure.failureType === 'cancelledByParent';
}

/**
 * @param {Array<{lane: string, passed: Array<{file,name}>, failed: Array<{file,name,failureType,message}>, stalled?: {lastEvent: string|null, idleMs: number}|null}>} summaries
 * @param {{rows: string[]}} manifest
 */
export function computeVerdict(summaries, manifest) {
  const expected = new Set(manifest.rows);
  const seen = new Set();
  const unexpected = [];
  const expectedRed = [];
  const hung = [];
  const stale = [];
  const stalled = [];
  let cancelled = 0;
  let passed = 0;
  for (const summary of summaries) {
    for (const row of summary.passed) {
      passed += 1;
      const key = rowKey(row.file, row.name);
      seen.add(key);
      if (expected.has(key)) stale.push(key);
    }
    for (const row of summary.failed) {
      const key = rowKey(row.file, row.name);
      seen.add(key);
      if (isHang(row)) { hung.push({ key, failureType: row.failureType ?? null }); continue; }
      if (isCancelled(row)) cancelled += 1;
      if (expected.has(key)) expectedRed.push(key);
      else unexpected.push({ key, message: row.message ?? null });
    }
    if (summary.stalled) stalled.push({ lane: summary.lane, ...summary.stalled });
  }
  // A listed row that never ran (renamed, deleted, or in a lane that stalled) is stale too:
  // the manifest must describe the suite that exists.
  const unseen = stalled.length === 0 ? [...expected].filter((key) => !seen.has(key)) : [];
  const green = unexpected.length === 0 && stale.length === 0 && hung.length === 0
    && stalled.length === 0 && unseen.length === 0;
  return Object.freeze({
    green, passed, expectedRed, unexpected, stale, unseen, hung, stalled, cancelled,
  });
}

export function formatVerdict(verdict) {
  const lines = [];
  lines.push(`baton suite verdict: ${verdict.green ? 'GREEN' : 'RED'} — ${verdict.passed} passed, ${verdict.expectedRed.length} expected red (${verdict.cancelled ?? 0} of them cancelled by a dangling await earlier in their file), ${verdict.unexpected.length} unexpected failure(s), ${verdict.stale.length} stale expectation(s), ${verdict.hung.length} hung, ${verdict.stalled.length} stalled lane(s)`);
  for (const row of verdict.unexpected) lines.push(`  unexpected failure: ${row.key}${row.message ? ` — ${String(row.message).split('\n')[0].slice(0, 160)}` : ''}`);
  for (const key of verdict.stale) lines.push(`  stale expectation (now green — remove it from expected-red-tests.json): ${key}`);
  for (const key of verdict.unseen) lines.push(`  stale expectation (never ran — renamed or deleted): ${key}`);
  for (const row of verdict.hung) lines.push(`  hung (${row.failureType ?? 'pending promise'}): ${row.key}`);
  for (const row of verdict.stalled) lines.push(`  stalled lane ${row.lane}: no test event for ${row.idleMs} ms after ${row.lastEvent ?? 'the lane started'}`);
  return lines.join('\n');
}

/** Re-arm-on-progress liveness bound: any observe() re-arms; expired() means no event since the
 * last tick within timeoutMs. The clock is injectable. */
export function createProgressDeadline({ timeoutMs, now = Date.now } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('progress deadline timeoutMs must be a positive integer');
  let last = now();
  return Object.freeze({
    observe() { last = now(); },
    expired() { return now() - last >= timeoutMs; },
    idleMs() { return now() - last; },
  });
}
