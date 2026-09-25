// suite-comparison.mjs — issue #593: the ONE comparison a contribution check and a landing gate
// judge by, with the failure vocabulary both read.
//
// A suite run's exit code cannot answer the question either gate means. Since #580 this
// repository's suite is red wherever a test was written before the feature it names, so the same
// failures are red on the change and on the change's base alike, and an exit-code judgement fails
// every capture whatever it does. The question both gates mean is:
//
//   1. run the test files the change selects (verification-selection.mjs is the ONE selector);
//   2. when some fail, re-run ONLY the failing files at the change's base;
//   3. a failure blocks when the base run does not have it.
//
// The two gates run those two halves in different places — a landing switches one checkout
// between the squash and its target (`defaultIntegrationGates`, swarm-runtime.mjs) while a
// contribution check runs them in its candidate and base verify sandboxes (referee.mjs `verify`,
// `opts.comparison`) — and both read this module for the failure identity and the comparison, so
// the two can never disagree about what "the change broke it" means.
//
// The verdict a runner writes is the runner's own (impl/scripts/suite-verdict.mjs); this module
// only READS it, names the failure identity two runs are compared by, and compares them.
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

import { VERIFICATION_GRAPH_DIRS } from './verification-selection.mjs';

/** The path the suite runner writes its verdict document to when it is handed one. The runner
 * reads the variable, and a comparison run sets it for the child it spawns. */
export const SUITE_VERDICT_ENV = 'BATON_SUITE_VERDICT_FILE';

/** The name a deployment's verification declaration gives the comparison procedure. A deployment
 * that declares it (impl/src/application-deployment.mjs does for this repository) says: judge a
 * capture by the comparison over the tests its changes select, never by the run's exit code. */
export const SUITE_COMPARISON = 'selected-vs-base';

/** The failure types that name a whole file rather than one test. Their names carry run-specific
 * detail (an idle time, an exit status), so two runs of the same file compare them by file and
 * failure type, never by name. */
export const FILE_LEVEL_FAILURE_TYPES = Object.freeze(['fileHung', 'fileCrashed', 'fixtureLeak']);

export function rowKey(file, name) {
  return `${file} :: ${name}`;
}

// A hang is a test the RUNNER had to stop: its file emitted nothing until the progress deadline
// (fileHung, minted by run-suite) or node's own per-test timeout fired (testTimeoutFailure /
// testAborted). `cancelledByParent` is different: an earlier test in the file awaited something
// that can never settle, the event loop drained, and node cancelled the rest (its message reads
// "Promise resolution is still pending but the event loop has already resolved"). The file
// finishes in milliseconds, so it is a deterministic red (a dangling await that must be fixed) and
// the verdict names it as cancelled so the count stays visible. Classification reads node's typed
// `failureType` only — never the message prose.
export const HANG_FAILURE_TYPES = new Set(['testTimeoutFailure', 'testAborted', 'fileHung']);

/** The coarse failure kind a failure type names (the law's FailureKind): a hang is the class the
 * verdict already knows (#521) — a file the runner's own deadline reaped, or a test node's timeout
 * stopped. */
export function failureKind(failureType) {
  if (failureType === 'fixtureLeak') return 'leak';
  if (failureType === 'fileCrashed') return 'crash';
  return HANG_FAILURE_TYPES.has(failureType) ? 'hang' : 'assertion';
}

/** The test a failure names, or '' when the run names none. A file-level failure's name carries
 * run-specific detail (an idle time, an exit status), so it is diagnostics, not identity. */
function failureTestName(failure) {
  if (FILE_LEVEL_FAILURE_TYPES.includes(failure?.failureType)) return '';
  return typeof failure?.name === 'string' ? failure.name : '';
}

/** The stable semantic code a failure carries: the failure type the runner typed for it, or '' when
 * it typed none (a bare key an older document wrote). */
function failureCode(failure) {
  return typeof failure?.failureType === 'string' ? failure.failureType : '';
}

/** The identity one failure is compared by across two runs (the change and its base, revision 11):
 * the file, the test where the run names one, the failure kind and the semantic code. Two failures
 * on one file and test whose kinds or codes differ are different failures, so neither matches the
 * other. A failure that names no file names nothing to compare, so it matches nothing. */
export function failureIdentity(failure) {
  const file = typeof failure?.file === 'string' && failure.file.length > 0 ? failure.file : null;
  if (file === null) return null;
  return [file, failureTestName(failure), failureKind(failure.failureType), failureCode(failure)]
    .join(' :: ');
}

/** The failures one verdict document names, each with its file and failure type, and the entry as
 * the document wrote it (`original`), which a refusal carries unchanged. A runner older than #580
 * (a branch that has not taken it) writes only `unexpected`: a `file :: name` string is read as a
 * test-level failure, and any other entry keeps no file, so it cannot be re-run at the base and
 * always blocks. */
export function verdictFailures(document) {
  if (Array.isArray(document?.failures)) {
    return document.failures.map((entry) => ({ ...entry, original: entry.key }));
  }
  return (Array.isArray(document?.unexpected) ? document.unexpected : []).map((entry) => {
    if (typeof entry !== 'string') {
      return { key: JSON.stringify(entry), file: null, name: null, failureType: null, original: entry };
    }
    const at = entry.indexOf(' :: ');
    return {
      key: entry, file: at < 0 ? null : entry.slice(0, at), name: at < 0 ? null : entry.slice(at + 4),
      failureType: null, original: entry,
    };
  });
}

/** Read a verdict document the runner wrote, or null. */
export function readVerdictDocument(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/** The selected files a run did not account for (revision 11): every file a gate handed the run
 * must appear among the rows the run reported, whether it passed, failed or was declined as not a
 * test file. A document that carries no `reportedFiles` array is a runner older than the
 * declaration — it names its files only through the rows it wrote, so a passed file and a file that
 * never ran cannot be told apart and the selection is not compared. */
export function unaccountedFiles(document, selected) {
  if (!Array.isArray(document?.reportedFiles)) return [];
  const reported = new Set(document.reportedFiles);
  return [...new Set(selected ?? [])].filter((file) => !reported.has(file)).sort();
}

/**
 * The ONE comparison. `change` is the verdict document the change's run wrote; `base` is null when
 * there is no base to compare against, `{document: null}` when the base run did not judge, and
 * `{document}` when it did. A base the change's failures cannot be found in — every one of them is
 * a file the base does not have, so nothing ran there — passes `{document: {failures: []}}`: the
 * failures were not compared with anything, and every one of them blocks.
 *
 * @param {{change: object|null, base?: object|null, note?: string}} input
 * @returns {{failures: Array, blocking: Array, shared: Array, compared: boolean, note: string}}
 */
export function compareSuiteVerdicts({ change, base = null, note = '' } = {}) {
  const failures = verdictFailures(change);
  if (failures.length === 0) {
    return Object.freeze({ failures, blocking: [], shared: [], compared: false, note: '' });
  }
  if (base === null || base?.document == null) {
    return Object.freeze({ failures, blocking: failures, shared: [], compared: false, note });
  }
  // A failure that names no file could not be re-run at the base, so it blocks: the base run
  // compared nothing for it.
  const onBase = new Set(verdictFailures(base.document).map(failureIdentity));
  const shared = failures.filter((failure) => typeof failure.file === 'string' && failure.file.length > 0
    && onBase.has(failureIdentity(failure)));
  const blocking = failures.filter((failure) => !shared.includes(failure));
  return Object.freeze({ failures, blocking, shared, compared: true, note: '' });
}

/** The confirmation of a blocking row: the change's own run must reproduce it.
 *
 * A gate runs the change's selection with nine lanes over a ten-core host, beside whatever else
 * the machine is doing. A row that asserts something about the CALLER's own event loop, or about a
 * deadline measured in milliseconds, can therefore redden on the change side while the same row
 * passes in the base run that has fewer files to schedule — and a landing would refuse on a
 * failure the change does not carry. The rule both gates apply now: after the comparison names its
 * blocking rows, the gate re-runs ONLY those rows' files on the change side once more, and a row
 * blocks only when the change run reproduces it. `confirmation` is that second run's verdict
 * document (null when it did not judge, in which case every blocking row stands). An unconfirmed
 * row is reported, never dropped in silence. */
export function confirmSuiteFailures({ blocking = [], confirmation = null } = {}) {
  if (confirmation === null) {
    return Object.freeze({ confirmed: Object.freeze([...blocking]), unconfirmed: Object.freeze([]) });
  }
  const onSecondRun = new Set(verdictFailures(confirmation).map(failureIdentity));
  const confirmed = [];
  const unconfirmed = [];
  for (const failure of blocking) {
    // A row that names no file could not be re-run, so it is never excused.
    if (typeof failure.file !== 'string' || failure.file.length === 0
      || onSecondRun.has(failureIdentity(failure))) confirmed.push(failure);
    else unconfirmed.push(failure);
  }
  return Object.freeze({
    confirmed: Object.freeze(confirmed), unconfirmed: Object.freeze(unconfirmed),
  });
}

/** The sentence a gate reports when a blocking row did not reproduce. */
export function confirmationLine({ unconfirmed = [] } = {}) {
  return unconfirmed.length === 0 ? '' : `, ${unconfirmed.length} not reproduced`;
}

/** The base-side input for a change whose failing files the base does not have at all: there is
 * nothing to compare them with, so every one of them blocks. Both gates pass exactly this. */
export const NO_BASE_FILES = Object.freeze({ document: Object.freeze({ failures: Object.freeze([]) }) });

/** The roots a suite runner resolves a file argument against, in ITS order: the suite root (where
 * its lanes, its verdict rows and its `test/<file>` arguments are named from) first, then the
 * checkout root (the repo-relative spelling a caller may append). Both are derived from the ONE
 * declaration of the directories the selection graph is scanned across
 * (`VERIFICATION_GRAPH_DIRS`) — the suite root is their common parent — never from a second table.
 *
 * A comparison asks a base sandbox whether it HAS a failing file at one of these roots: a file it
 * does not have is new with the change, so it runs nowhere there and its failures block. */
export function suiteRoots(graphDirs = VERIFICATION_GRAPH_DIRS) {
  const segments = [...graphDirs].map((dir) => posix.normalize(dir).split('/').filter(Boolean));
  const shared = segments.reduce((prefix, parts) => {
    let index = 0;
    while (index < prefix.length && index < parts.length && prefix[index] === parts[index]) index += 1;
    return prefix.slice(0, index);
  }, segments[0] ?? []);
  return Object.freeze([shared.join('/'), '.']);
}

/** The ONE sentence both gates report: how many failures the change owns and how many it shares
 * with the run it was compared against. The two gates name that run (`the target`, `the base`). */
export function comparisonCountsLine({ blocking, shared, baseNoun = 'the base' }) {
  return `${blocking.length} failing only with the change, ${shared.length} failing on ${baseNoun} too`;
}
