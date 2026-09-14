// The suite verdict (issue #260): what the canonical run MEANS, computed from the reporter's
// per-lane summaries and the expected-red manifest. Pure functions — the runner formats and
// exits, tests pin the decision procedure.
//
// Manifest rows are `{key, reason}` (the reporter's row key `file :: name` plus WHY the row is
// expected not to pass). A row listed there is an intentional red-first spec: it must fail. The
// verdict is green only when
//   - no test failed that is NOT listed (an unexpected failure is a regression), and
//   - no listed test passed (a stale expectation must be removed — the spec went green), and
//   - no test was cancelled / timed out / hung (a hang is never an expected red), and
//   - no lane stalled (the runner's progress deadline expired with tests still pending).
//
// Every row carries a reason because an unattributed red is indistinguishable from an abandoned
// test (2026-09-14 audit S-G2/S-I6): a GitHub issue (`#263`), the audit item that tracks it
// (`S-G5`, `A-G10`, `R-1`) or a named class (`credential`, `environment`, `design`,
// `unattributed`).
//
// A row whose class is `credential`/`environment` is an ENVIRONMENT row: the machine decides its
// outcome. When the run observed an absent prerequisite it is expected not to pass and is reported
// as environment-red, apart from code rows and beside the machine-local prerequisites the harness
// actually observed (2026-09-14 audit R-1); when every prerequisite was present the machine can
// run it, so it must pass — and a failure there is an unexpected failure like any other.
//
// `converged` names the files that were authored as red-first specs, carry no expected-red row
// any more (they are fully green) and keep the `-red` suffix as the record of the contract they
// pinned. The manifest — never the filename — is the authority on what is still expected red.
import { readFileSync, writeFileSync } from 'node:fs';

export const MANIFEST_SCHEMA_VERSION = 2;

export function rowKey(file, name) {
  return `${file} :: ${name}`;
}

// ── the reason vocabulary ────────────────────────────────────────────────────────────────────────
// `issue` is a GitHub issue; `audit` is a tracking item of the 2026-09-14 deep codebase audit
// (docs/audits/2026-09-14-codebase-audit/); the rest are classes. `credential` and `environment`
// are the two environment-red classes.
const ISSUE_REASON = /^#[1-9]\d{0,6}$/u;
const AUDIT_REASON = /^[A-Z]{1,2}-[A-Z]{0,2}\d+[a-z]?$/u;
const NAMED_CLASSES = Object.freeze(['credential', 'environment', 'design', 'unattributed']);
export const REASON_CLASSES = Object.freeze(['issue', 'audit', ...NAMED_CLASSES]);
export const ENVIRONMENT_REASON_CLASSES = Object.freeze(['credential', 'environment']);

/** The class a reason belongs to, or null when the reason is not one this manifest accepts. */
export function reasonClassOf(reason) {
  if (typeof reason !== 'string' || reason.length === 0) return null;
  if (ISSUE_REASON.test(reason)) return 'issue';
  if (NAMED_CLASSES.includes(reason)) return reason;
  if (AUDIT_REASON.test(reason)) return 'audit';
  return null;
}

export function isEnvironmentReasonClass(klass) {
  return ENVIRONMENT_REASON_CLASSES.includes(klass);
}

/** The refusal text a row without a classifiable reason gets — naming the field it needs. */
export const REASON_FIELD_HINT = 'add "reason": "#<issue>", an audit item (e.g. "S-G5"), or a class (credential | environment | design | unattributed)';

function manifestError(message) {
  return Object.assign(new Error(message), { code: 'suite_manifest_invalid' });
}

function parseRow(row) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)
    || typeof row.key !== 'string' || !row.key.includes(' :: ')
    || reasonClassOf(row.reason) === null) {
    const key = typeof row?.key === 'string' ? row.key : JSON.stringify(row);
    throw manifestError(`expected-red manifest row ${key} is incomplete — ${REASON_FIELD_HINT}`);
  }
  return Object.freeze({ key: row.key, reason: row.reason });
}

export function loadExpectedRed(path) {
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return { schemaVersion: MANIFEST_SCHEMA_VERSION, rows: [], converged: [] };
    throw manifestError(`expected-red manifest is unreadable: ${error.message}`);
  }
  if (parsed?.schemaVersion !== MANIFEST_SCHEMA_VERSION || !Array.isArray(parsed.rows)) {
    throw manifestError(`expected-red manifest must be {schemaVersion: ${MANIFEST_SCHEMA_VERSION}, rows: [{key, reason}, ...], converged: [{file, reason}, ...]}`);
  }
  const converged = parsed.converged ?? [];
  if (!Array.isArray(converged)) throw manifestError('expected-red manifest `converged` must be an array of {file, reason}');
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    rows: parsed.rows.map(parseRow),
    converged: converged.map((entry) => {
      if (entry === null || typeof entry !== 'object' || typeof entry.file !== 'string'
        || reasonClassOf(entry.reason) === null) {
        throw manifestError(`converged red-first file ${JSON.stringify(entry)} is incomplete — ${REASON_FIELD_HINT}`);
      }
      return Object.freeze({ file: entry.file, reason: entry.reason });
    }),
  };
}

/** The committed form: rows sorted by key, converged files sorted by path, both unique. */
export function manifestRows({ rows = [], converged = [] } = {}) {
  const byKey = new Map();
  for (const row of rows) byKey.set(row.key, row.reason);
  const byFile = new Map();
  for (const entry of converged) byFile.set(entry.file, entry.reason);
  return {
    rows: [...byKey].sort(([left], [right]) => left.localeCompare(right)).map(([key, reason]) => ({ key, reason })),
    converged: [...byFile].sort(([left], [right]) => left.localeCompare(right)).map(([file, reason]) => ({ file, reason })),
  };
}

export function writeExpectedRed(path, manifest) {
  const { rows, converged } = manifestRows(manifest);
  writeFileSync(path, `${JSON.stringify({ schemaVersion: MANIFEST_SCHEMA_VERSION, rows, converged }, null, 2)}\n`);
  return { rows, converged };
}

/**
 * Plan a `--write-expected-red` rewrite from THIS run's failing rows.
 *
 * Every row that stays red keeps the reason it already carried. A row the manifest has never
 * listed cannot be invented: it needs the run's declared reason (`defaultReason`, supplied by
 * `--expected-red-reason`), and without one the rewrite is refused by naming the flag and the
 * field it fills — never written as a silent placeholder (2026-09-14 audit S-G2/S-I6).
 *
 * @param {{failures: Array<{file: string, name: string}>, prior: {rows: Array<{key, reason}>, converged: Array<{file, reason}>}, defaultReason?: string|null}} input
 */
export function planExpectedRedRewrite({ failures, prior, defaultReason = null }) {
  const priorReasons = new Map(prior.rows.map((row) => [row.key, row.reason]));
  const keys = [...new Set(failures.map((row) => rowKey(row.file, row.name)))].sort();
  const newKeys = keys.filter((key) => !priorReasons.has(key));
  const resolvedDefault = reasonClassOf(defaultReason) === null ? null : defaultReason;
  if (newKeys.length > 0 && resolvedDefault === null) {
    return { refused: true, newKeys, kept: [], dropped: [], converged: prior.converged };
  }
  const kept = keys.map((key) => ({ key, reason: priorReasons.get(key) ?? resolvedDefault }));
  const dropped = prior.rows.filter((row) => !keys.includes(row.key)).map((row) => row.key);
  return { refused: false, newKeys, kept, dropped, converged: prior.converged };
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
 * @param {Array<{lane: string, passed: Array<{file,name}>, failed: Array<{file,name,failureType,message}>, stalled?: {lastEvent: string|null, idleMs: number}|null}>} summaries
 * @param {{rows: Array<{key, reason}>, converged?: Array<{file, reason}>}} manifest
 * @param {{environment?: object|null}} [options]
 */
export function computeVerdict(summaries, manifest, { environment = null } = {}) {
  // A row without a classifiable reason is refused HERE too: a caller that hand-builds a manifest
  // (or passes the pre-v2 string shape) must not read as "no rows" while its failures are counted
  // as unexpected — the refusal names the row, exactly as the loader does.
  for (const row of manifest.rows) {
    if (typeof row?.key !== 'string' || reasonClassOf(row?.reason) === null) {
      throw manifestError(`expected-red manifest row ${JSON.stringify(row)} is incomplete — ${REASON_FIELD_HINT}`);
    }
  }
  const reasons = new Map(manifest.rows.map((row) => [row.key, row.reason]));
  const seen = new Set();
  const unexpected = [];
  const expectedRed = [];
  const hung = [];
  const stale = [];
  const stalled = [];
  // Environment rows: a row whose reason class is credential/environment is the row's own
  // declaration that this machine decides its outcome (2026-09-14 audit R-1). It is judged
  // against what the run OBSERVED, never against itself:
  //   - the run observed an absent prerequisite: the row is expected not to pass. A failure is
  //     environment-red, a pass is environment-red too (it is not evidence the spec went green),
  //     and staleness never applies — this is what makes a clone-hosted run read
  //     `GREEN except environment` instead of a pile of unexpected failures.
  //   - every declared prerequisite was present: the machine can run the row, so it must pass;
  //     a failure is an unexpected failure like any other.
  const environmentAbsent = (environment?.absent?.length ?? 0) > 0;
  let cancelled = 0;
  let passed = 0;
  for (const summary of summaries) {
    for (const row of summary.passed) {
      passed += 1;
      const key = rowKey(row.file, row.name);
      seen.add(key);
      if (!reasons.has(key)) continue;
      const klass = reasonClassOf(reasons.get(key));
      if (!isEnvironmentReasonClass(klass)) { stale.push(key); continue; }
      if (environmentAbsent) {
        expectedRed.push({ key, reason: reasons.get(key), class: klass, outcome: 'passed' });
      }
    }
    for (const row of summary.failed) {
      const key = rowKey(row.file, row.name);
      seen.add(key);
      if (isHang(row)) { hung.push({ key, failureType: row.failureType ?? null }); continue; }
      if (isCancelled(row)) cancelled += 1;
      if (!reasons.has(key)) { unexpected.push({ key, message: row.message ?? null }); continue; }
      const klass = reasonClassOf(reasons.get(key));
      if (isEnvironmentReasonClass(klass) && !environmentAbsent) {
        unexpected.push({ key, message: row.message ?? null, environmentPrerequisite: 'present' });
        continue;
      }
      expectedRed.push({ key, reason: reasons.get(key), class: klass, outcome: 'failed' });
    }
    if (summary.stalled) stalled.push({ lane: summary.lane, ...summary.stalled });
  }
  // A listed row that never ran (renamed, deleted, or in a lane that stalled) is stale too:
  // the manifest must describe the suite that exists.
  const unseen = stalled.length === 0 ? [...reasons.keys()].filter((key) => !seen.has(key)) : [];
  const green = unexpected.length === 0 && stale.length === 0 && hung.length === 0
    && stalled.length === 0 && unseen.length === 0;
  const byClass = Object.fromEntries(REASON_CLASSES.map((klass) => [klass, 0]));
  for (const row of expectedRed) byClass[row.class] += 1;
  const environmentRed = expectedRed.filter((row) => isEnvironmentReasonClass(row.class));
  const codeRed = expectedRed.filter((row) => !isEnvironmentReasonClass(row.class));
  return Object.freeze({
    green, passed, expectedRed, expectedRedByClass: Object.freeze(byClass), codeRed,
    environmentRed, environment, unexpected, stale, unseen, hung, stalled, cancelled,
  });
}

export function formatVerdict(verdict) {
  const lines = [];
  const headline = verdict.green
    ? (verdict.environmentRed.length > 0 ? 'GREEN except environment' : 'GREEN')
    : 'RED';
  lines.push(`baton suite verdict: ${headline} — ${verdict.passed} passed, ${verdict.expectedRed.length} expected red (${verdict.codeRed.length} code, ${verdict.environmentRed.length} environment-red, ${verdict.cancelled ?? 0} of them cancelled by a dangling await earlier in their file), ${verdict.unexpected.length} unexpected failure(s), ${verdict.stale.length} stale expectation(s), ${verdict.hung.length} hung, ${verdict.stalled.length} stalled lane(s)`);
  if (verdict.environment) lines.push(`  ${formatEnvironment(verdict.environment)}`);
  const classes = REASON_CLASSES.filter((klass) => (verdict.expectedRedByClass?.[klass] ?? 0) > 0);
  if (classes.length > 0) {
    lines.push(`  expected red by reason class: ${classes.map((klass) => `${klass}=${verdict.expectedRedByClass[klass]}`).join(', ')}`);
  }
  for (const row of verdict.environmentRed) {
    const outcome = row.outcome === 'failed' ? 'failed' : 'unjudged — the prerequisite is absent';
    lines.push(`  environment red (expected, ${row.class}, ${outcome}): ${row.key} — reason ${row.reason}`);
  }
  for (const row of verdict.unexpected) lines.push(`  unexpected failure: ${row.key}${row.message ? ` — ${String(row.message).split('\n')[0].slice(0, 160)}` : ''}`);
  for (const key of verdict.stale) lines.push(`  stale expectation (now green — remove it from expected-red-tests.json): ${key}`);
  for (const key of verdict.unseen) lines.push(`  stale expectation (never ran — renamed or deleted): ${key}`);
  for (const row of verdict.hung) lines.push(`  hung (${row.failureType ?? 'pending promise'}): ${row.key}`);
  for (const row of verdict.stalled) lines.push(`  stalled lane ${row.lane}: no test event for ${row.idleMs} ms after ${row.lastEvent ?? 'the lane started'}`);
  return lines.join('\n');
}

/** The machine-readable form of one verdict (the runner writes it when BATON_SUITE_VERDICT_FILE
 * names a path): the same facts the line carries, including the reason classes and the
 * environment the run observed. */
export function verdictDocument(verdict) {
  return {
    schemaVersion: 1,
    green: verdict.green,
    passed: verdict.passed,
    expectedRed: verdict.expectedRed.length,
    expectedRedByClass: { ...verdict.expectedRedByClass },
    codeRed: verdict.codeRed.map((row) => row.key),
    environmentRed: verdict.environmentRed.map((row) => ({ key: row.key, reason: row.reason, class: row.class })),
    unexpected: verdict.unexpected.map((row) => row.key),
    stale: [...verdict.stale],
    unseen: [...verdict.unseen],
    hung: verdict.hung.map((row) => row.key),
    stalled: [...verdict.stalled],
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
