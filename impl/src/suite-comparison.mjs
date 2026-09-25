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

/** The identity one failure is compared by across two runs (the change and its base). */
export function failureIdentity(failure) {
  return FILE_LEVEL_FAILURE_TYPES.includes(failure.failureType)
    ? `${failure.file} :: [${failure.failureType}]`
    : rowKey(failure.file, failure.name);
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
