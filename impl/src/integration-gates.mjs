// integration-gates.mjs — the landing gate and its target comparison, in ONE place (#580), so that
// a landing (swarm-runtime.mjs) and a contribution check (#593) can never disagree about what a
// change broke.
//
// A gate answers one question: does this change break something that works on its base? It runs
// the repository's own suite runner over the derived files, and when the change's run has
// failures, it re-runs those failing files on the base in the same checkout. Only a failure the
// base does not share blocks. No list of expected failures is read or kept.
//
// This module never imports the coordinator: the supervised runner seam a gate run needs is
// handed in by its caller (`run`), exactly as the landing hands it its own pool.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { appendStderrTail, crashedStderrTail } from './cli-adapters.mjs';
import { failureIdentity } from '../scripts/suite-verdict.mjs';

/** The suite runner a gate run invokes, and the one script name every row of that step spells. */
export const INTEGRATION_GATE_RUNNER = 'impl/scripts/run-suite.mjs';

/**
 * The ONE suite-layout fact a supervised gate run derives from (issue #463): the runner path as
 * the checkout spells it. The runner's OWN directory decides the rest — nothing here guesses at a
 * layout:
 *
 *   • `suiteRoot` — the runner's parent, the root the runner resolves its own URLs against
 *     (`new URL('../', import.meta.url)` in run-suite.mjs) and therefore the root every name it
 *     takes is spelled against;
 *   • `tests` — the test directory of that same root (`new URL('../test/', import.meta.url)`),
 *     expressed relative to it: the shape the runner's own lanes, rows and file arguments carry;
 *   • `runner` — the runner as the suite root spells it: the argv it is spawned with when that
 *     root is the child's working directory.
 *
 * Paths are POSIX because every one of them is a NAME inside a checkout (the runner path a
 * deployment declares, the file arguments the suite runner takes), never a host path being walked.
 *
 * @param {string} runnerPath the runner as the checkout spells it, e.g. `impl/scripts/run-suite.mjs`
 * @returns {{runnerDir: string, suiteRoot: string, tests: string, runner: string}}
 */
export function gateRunnerLayout(runnerPath) {
  const named = `${runnerPath}`;
  const runnerDir = posix.dirname(named);
  const suiteRoot = posix.dirname(runnerDir);
  // The runner's own test directory, read off its path the way run-suite.mjs reads it: the
  // directory the runner's import.meta.url resolves `../test/` to.
  const tests = posix.relative(suiteRoot, posix.join(runnerDir, '..', 'test'));
  return Object.freeze({ runnerDir, suiteRoot, tests, runner: posix.relative(suiteRoot, named) });
}

/** One gate file as the runner takes it: `<tests>/<file>` relative to the suite root. Idempotent —
 * a name already spelled that way (read back from a receipt, say) is returned unchanged, so a
 * caller can hand the runner either the derived basename or a name it was given. */
export function gateRunnerFile(layout, file) {
  return posix.join(layout.tests, posix.basename(`${file}`));
}

/** Issue #463: the layout that runner defines, read off its own path ONCE — the checkout-relative
 * suite root, the test directory inside it, and the shape every gate file arrives in
 * (`<tests>/<file>`, relative to that root). The runner's own directory is the one fact; the cwd a
 * child is spawned with and the names it is handed both derive from it, so the two can never
 * disagree again. */
export const GATE_RUNNER_LAYOUT = gateRunnerLayout(INTEGRATION_GATE_RUNNER);

/** The #326 tail for one captured stream: bound the raw bytes by the adapter's own ceiling, then
 * redact with the one sanitizer. The LAST bytes survive — a dying step's own words are the
 * evidence, never the head of its output. An empty stream keeps an empty tail (absence, never a
 * guess). */
export function boundedStderrTail(raw) {
  const text = typeof raw === 'string' ? raw : '';
  if (text === '') return '';
  const session = { stderrTailRaw: '' };
  appendStderrTail(session, text);
  return crashedStderrTail(session);
}

/** The per-file rows a gate run STREAMED before it died (#546, option a): each "# file <path>
 * (N ms)" block the runner printed is a real result — pass/fail counts and all — so an
 * interrupted run names what it judged beside what its death left unreported, instead of
 * leaving the landing a blank timeout with verdictLine null. */
export function partialFilesJudged(stream) {
  const marks = [...stream.matchAll(/# file (\S+) \((\d+) ms[^)]*\)/g)];
  return marks.map((mark, index) => {
    const from = mark.index + mark[0].length;
    const to = index + 1 < marks.length ? marks[index + 1].index : stream.length;
    const block = stream.slice(from, to);
    return {
      file: mark[1],
      pass: Number((block.match(/# pass (\d+)/) ?? [])[1] ?? 0),
      fail: Number((block.match(/# fail (\d+)/) ?? [])[1] ?? 0),
    };
  });
}

/** One supervised run of the suite runner over `files` in `dir`, with its verdict document read
 * back (null when the runner wrote none) and its last words and exit status.
 *
 * `run` is the CALLER'S supervised runner seam (the resident's own out-of-process pool, which the
 * landing and a check both already hold): this module never imports the coordinator, so the gate
 * rule can be shared without an import cycle. */
export async function runGateFiles(dir, files, { run, pool = null, holder = null, leaseAuthority = null } = {}) {
  if (typeof run !== 'function') throw new TypeError('a gate run needs a supervised runner seam');
  // Issue #551: whether this incarnation read a verdict document at all. An unjudged run keeps
  // its scratch directory, because the verdict it may still write is the one a successor reads.
  let judged = false;
  const scratch = mkdtempSync(join(tmpdir(), 'baton-integrate-'));
  const verdictPath = join(scratch, 'verdict.json');
  try {
    const result = await run({
      file: INTEGRATION_GATE_RUNNER, dir, files, pool, holder, leaseAuthority,
      env: { BATON_SUITE_VERDICT_FILE: verdictPath },
    });
    let document = null;
    try {
      document = JSON.parse(readFileSync(verdictPath, 'utf8'));
    } catch { document = null; }
    judged = document !== null;
    return {
      result, document,
      // Issue #551: where the verdict would be — the path a successor incarnation checks before
      // concluding the run never finished.
      verdictPath,
      stderrTail: boundedStderrTail(`${result.stderr || result.stdout}`),
      exit: result.status === 'timeout' ? null : result.code ?? null,
    };
  } finally {
    // Issue #551: the scratch is removed only when the verdict was read; an unjudged run keeps its
    // directory so the verdict it may still write is findable by the path the row carries.
    if (judged) rmSync(scratch, { recursive: true, force: true });
  }
}

/** The failures one verdict document names, each with its file and failure type, and the entry
 * as the document wrote it (`original`), which a refusal carries unchanged. A runner older than
 * #580 (a branch that has not taken it) writes only `unexpected`: a `file :: name` string is read
 * as a test-level failure, and any other entry keeps no file, so it cannot be re-run on the base
 * and always blocks. */
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

/** The one comparison rule: given the change's failures and the base's, which block and which are
 * shared. A failure with no file could not be re-run on the base, so it blocks. */
export function compareFailures(changeFailures, baseFailures) {
  const onBase = new Set(baseFailures.map(failureIdentity));
  const sharedOnBase = (failure) => typeof failure.file === 'string' && onBase.has(failureIdentity(failure));
  return {
    blocking: changeFailures.filter((failure) => !sharedOnBase(failure)),
    shared: changeFailures.filter(sharedOnBase),
  };
}

/** Issue #580: switch the checkout between the squash and its base, so the change's failing test
 * files can be re-run on the base in the same directory with the same dependencies. The squash
 * commit holds every change, the regenerated artifacts included, so switching back restores the
 * checkout exactly. */
export function checkoutLandingTree(dir, sha) {
  const ran = spawnSync('git', ['checkout', '--detach', '--force', '--quiet', sha], { cwd: dir, encoding: 'utf8' });
  if (ran.status !== 0) {
    throw Object.assign(new Error(`the landing checkout could not switch to ${sha}: ${`${ran.stderr ?? ''}`.trim().slice(0, 300)}`), {
      code: 'integrate_change_invalid',
    });
  }
}

/** The default gate runner: the repository's own suite over the derived files, run in the
 * checkout. Issue #580: a gate answers whether the change breaks something that works on its
 * base. When the change's run has failures, the failing files are re-run on the base in the same
 * checkout, and only a failure the base does not share blocks the gate. A failure present on both
 * sides (a test written ahead of its feature, known breakage, a machine-local prerequisite) is
 * reported and never blocks. No list of expected failures is read or kept.
 *
 * Issue #593: `context.targetHeadBefore`/`context.squashSha` name the two commits of ONE checkout —
 * for a landing the base it squashed onto and the squash itself, for a check the capture's base
 * and the capture. The rule is the same rule, so a check and a landing never disagree.
 *
 * Issue #463: the run's own last words and exit status are read back WITH the verdict, so a RED
 * gate is as actionable as a crashed one. */
export async function defaultIntegrationGates(dir, files, context, supervision = {}) {
  const change = await runGateFiles(dir, files, supervision);
  const { result, document, verdictPath, stderrTail, exit } = change;
  if (document === null) {
    // A runner that died before it could judge is not a green gate set. No resident-side wall
    // clock arms on this child (#546): an unjudged run is either a clean exit without a verdict
    // file (suite-did-not-judge) or a runner that lost its process mid-flight, which reports a
    // named partial verdict with the files it reported before it died.
    const interrupted = result.signal !== null && result.signal !== undefined;
    const filesJudged = interrupted ? partialFilesJudged(`${result.stdout}\n${result.stderr}`) : [];
    const reported = new Set(filesJudged.map((row) => row.file));
    return {
      files,
      // Issue #551: the path a successor incarnation checks for a verdict written after this
      // incarnation stopped waiting.
      verdictPath,
      verdictLine: interrupted
        ? `partial — interrupted by ${result.signal}; ${filesJudged.length} of ${files.length} file(s) reported before the run died`
        : null,
      unexpected: [{
        row: interrupted ? 'gate-run-interrupted' : 'suite-did-not-judge',
        script: INTEGRATION_GATE_RUNNER, exitStatus: exit,
        ...(interrupted ? {
          signal: result.signal,
          filesJudged,
          filesUnreported: files.filter((file) => !reported.has(file)),
        } : {}),
        stderrTail, verdictPath,
      }],
      stderrTail, exit,
    };
  }
  const squashNote = context?.squashSha ? `, squash ${`${context.squashSha}`.slice(0, 12)}` : '';
  const failures = verdictFailures(document);
  if (failures.length === 0) {
    return { files, verdictLine: `green — passed ${document.passed}${squashNote}`, unexpected: [], stderrTail, exit };
  }
  const target = typeof context?.targetHeadBefore === 'string' ? context.targetHeadBefore : null;
  const squash = typeof context?.squashSha === 'string' ? context.squashSha : null;
  let onTarget = null;
  let targetNote = '';
  if (target !== null && squash !== null) {
    checkoutLandingTree(dir, target);
    try {
      // A failing file the target does not have is new with the change; it has nothing to compare
      // against, so its failures block.
      const failingFiles = [...new Set(failures.map((failure) => failure.file))]
        .filter((file) => typeof file === 'string' && file.length > 0
          && existsSync(join(dir, GATE_RUNNER_LAYOUT.suiteRoot, file)));
      if (failingFiles.length > 0) {
        const baseline = await runGateFiles(dir, failingFiles, supervision);
        if (baseline.document === null) {
          targetNote = '; the target run did not judge, so every failure blocks';
        } else {
          onTarget = verdictFailures(baseline.document);
        }
      } else {
        onTarget = [];
      }
    } finally {
      checkoutLandingTree(dir, squash);
    }
  } else {
    targetNote = '; no target to compare against, so every failure blocks';
  }
  const compared = onTarget === null
    ? { blocking: failures, shared: [] }
    : compareFailures(failures, onTarget);
  return {
    files,
    verdictLine: `${compared.blocking.length > 0 ? 'red' : 'green'} — passed ${document.passed}, `
      + `${compared.blocking.length} failing only with the change, ${compared.shared.length} failing on the target too`
      + `${squashNote}${targetNote}`,
    unexpected: compared.blocking.map((failure) => failure.original),
    failingOnTarget: compared.shared.map((failure) => failure.original),
    stderrTail, exit,
  };
}
