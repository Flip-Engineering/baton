// The suite verdict (issue #260): what one run of the suite MEANS, computed from the reporter's
// per-lane summaries. Pure functions: the runner formats and exits, tests pin the procedure.
//
// A run is green when no test failed and no file hung. The verdict records every failure with its
// file, test name and failure type. It carries no list of expected failures: a landing gate
// decides what a change broke by comparing the change's failures with the target's own failures
// on the same tests (#580), so nothing test-outcome-related is maintained by hand.
//
// A file that stops reporting is bounded by the runner's own per-file progress deadline (#260):
// the deadline reaps the file and mints a `fileHung` row, which this verdict reads as a hang.
// Issue #593: the failure vocabulary two runs are compared by (and the verdict document a caller
// hands the runner a path for) lives in ONE module, shared with the contribution check's
// comparison (impl/src/suite-comparison.mjs). This module keeps its own surface: every name it
// used to declare is re-exported from there, so a reader of the runner's verdict resolves the
// same bindings.
import { readFileSync } from 'node:fs';

import {
  FILE_LEVEL_FAILURE_TYPES, HANG_FAILURE_TYPES, failureIdentity, readVerdictDocument, rowKey,
} from '../src/suite-comparison.mjs';

export { FILE_LEVEL_FAILURE_TYPES, failureIdentity, readVerdictDocument, rowKey };

export function isHang(failure) {
  return HANG_FAILURE_TYPES.has(failure.failureType);
}

export function isCancelled(failure) {
  return failure.failureType === 'cancelledByParent';
}

// ── the environment dimension (2026-09-14 audit R-1) ────────────────────────────────────────────
// The prerequisites a run needs from ITS MACHINE, derived from the same declaration the
// deployment doctor and route readiness use — never a second list of paths. The caller imports
// the declarations (impl/src/application-deployment.mjs) and passes them in: the served route
// registry, the one omp route-readiness derivation, the route's provider key file, and the
// ready-when contract the doctor documents.
/**
 * @param {object} input
 * @param {Array<{harness: string, provider?: string, model: string}>} input.routes served registry
 * @param {(route: object) => {state: string, code?: string, summary?: string}} input.routeReadiness
 *   the ONE readiness derivation, bound to this repository root (application-deployment.ompRouteReadiness)
 * @param {(model: string) => string|null} input.providerKeyFile ompProviderKeyFile
 * @param {(route: object) => string} input.readinessContract routeReadinessContract
 */
export function environmentPrerequisites({ routes, routeReadiness, providerKeyFile, readinessContract }) {
  const prerequisites = [];
  const seen = new Set();
  for (const route of routes) {
    const id = route.provider ? `${route.harness}:${route.provider}/${route.model}` : `${route.harness}/${route.model}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (route.harness === 'omp') {
      const readiness = routeReadiness(route);
      const keyFile = providerKeyFile(route.model);
      const missing = readiness.state === 'ready' ? null
        : keyFile === null ? readiness.code ?? 'route_unavailable'
          : `repository ${keyFile}`;
      prerequisites.push(Object.freeze({
        id, kind: 'omp-route', state: readiness.state === 'ready' ? 'present' : 'absent',
        code: readiness.code ?? null, keyFile, missing,
      }));
      continue;
    }
    // Every other family's machine-local prerequisite is the ready-when contract the doctor
    // documents; the suite reports it as a declaration it does not evaluate rather than
    // claiming an observation it never made.
    prerequisites.push(Object.freeze({
      id, kind: 'declared-route', state: 'declared', code: null, keyFile: null,
      missing: null, contract: readinessContract(route),
    }));
  }
  const ids = (state) => prerequisites.filter((row) => row.state === state).map((row) => row.id);
  return Object.freeze({
    schemaVersion: 1,
    prerequisites: Object.freeze(prerequisites),
    absent: Object.freeze(ids('absent')),
    present: Object.freeze(ids('present')),
    declared: Object.freeze(ids('declared')),
  });
}

/** One line naming every prerequisite this run observed, present or absent. */
export function formatEnvironment(environment) {
  const parts = environment.prerequisites.map((row) => {
    if (row.state === 'present') return `${row.id} present`;
    if (row.state === 'declared') return `${row.id} declared — ${row.contract}`;
    return `${row.id} ABSENT — ${row.missing}${row.code ? ` (${row.code})` : ''}`;
  });
  return `baton suite environment: ${parts.length > 0 ? parts.join('; ') : 'the served route registry declares no machine-local prerequisite'}`;
}

/**
 * @param {Array<{lane: string, passed: Array<{file,name}>, failed: Array<{file,name,failureType,message}>, skipped?: Array<{file, reason}>}>} summaries
 * @param {{environment?: object|null}} [options]
 */
export function computeVerdict(summaries, { environment = null } = {}) {
  const failed = [];
  const hung = [];
  const skipped = [];
  const reported = new Set();
  const reportedFile = (file) => {
    if (typeof file === 'string' && file.length > 0) reported.add(file);
  };
  let cancelled = 0;
  let passed = 0;
  for (const summary of summaries) {
    // Issue #508: files the runner declined to schedule (not test files) ride the summary as
    // skipped rows, named by the verdict and judged by nothing.
    for (const row of summary.skipped ?? []) skipped.push({ file: row.file, reason: row.reason });
    // The files this run ACCOUNTED for: every file whose own rows reached the summary, plus the
    // files it declined to schedule. The landing gate reads this to check that the run judged the
    // whole selection it was handed (revision 11).
    for (const row of summary.passed) reportedFile(row.file);
    passed += summary.passed.length;
    for (const row of summary.failed) {
      reportedFile(row.file);
      const entry = {
        key: rowKey(row.file, row.name), file: row.file, name: row.name,
        failureType: row.failureType ?? null, message: row.message ?? null,
      };
      if (isHang(row)) { hung.push(entry); continue; }
      if (isCancelled(row)) cancelled += 1;
      failed.push(entry);
    }
  }
  for (const row of skipped) reportedFile(row.file);
  return Object.freeze({
    green: failed.length === 0 && hung.length === 0,
    passed, failed, hung, cancelled, environment,
    skipped: Object.freeze(skipped),
    reportedFiles: Object.freeze([...reported].sort()),
  });
}

export function formatVerdict(verdict) {
  const lines = [];
  const skipped = verdict.skipped ?? [];
  const skippedNote = skipped.length > 0 ? `, ${skipped.length} skipped` : '';
  const cancelledNote = (verdict.cancelled ?? 0) > 0
    ? `, ${verdict.cancelled} of the failures cancelled by a dangling await earlier in their file` : '';
  lines.push(`baton suite verdict: ${verdict.green ? 'GREEN' : 'RED'} — ${verdict.passed} passed, ${verdict.failed.length} failed, ${verdict.hung.length} hung${cancelledNote}${skippedNote}`);
  if (verdict.environment) lines.push(`  ${formatEnvironment(verdict.environment)}`);
  for (const row of verdict.failed) lines.push(`  failed: ${row.key}${row.message ? ` — ${String(row.message).split('\n')[0].slice(0, 160)}` : ''}`);
  for (const row of verdict.hung) lines.push(`  hung (${row.failureType ?? 'pending promise'}): ${row.key}`);
  for (const row of skipped) lines.push(`  skipped: ${row.reason}: ${row.file}`);
  return lines.join('\n');
}

/** The machine-readable form of one verdict (the runner writes it when BATON_SUITE_VERDICT_FILE
 * names a path). `failures` carries each failure with its file, name and failure type, so a
 * landing gate can compare two runs (#580). `unexpected` lists every failing and hung key: a
 * reader older than #580 treats all of them as blocking, never as absent. */
export function verdictDocument(verdict) {
  const failures = [...verdict.failed, ...verdict.hung].map((row) => ({
    key: row.key, file: row.file, name: row.name, failureType: row.failureType,
  }));
  return {
    schemaVersion: 2,
    green: verdict.green,
    passed: verdict.passed,
    failed: verdict.failed.map((row) => row.key),
    hung: verdict.hung.map((row) => row.key),
    failures,
    unexpected: failures.map((row) => row.key),
    skipped: (verdict.skipped ?? []).map((row) => ({ file: row.file, reason: row.reason })),
    // `reportedFiles` is the set of files this run accounted for, so a landing gate can tell the
    // run it started from any other document (revision 11).
    reportedFiles: [...(verdict.reportedFiles ?? [])],
    environment: verdict.environment
      ? { absent: [...verdict.environment.absent], present: [...verdict.environment.present], declared: [...verdict.environment.declared], prerequisites: verdict.environment.prerequisites.map((row) => ({ ...row })) }
      : null,
  };
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
