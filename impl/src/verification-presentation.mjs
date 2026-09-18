// Provider-facing presentation of Baton's verifier contract.
//
// Verification can be either a legacy shell command or a closed executable/argv
// tuple. Do not collapse the latter into a shell string: doing so changes both
// its meaning and its trust boundary, and omitting argv tells workers to run a
// different check from the one the referee will enforce.

// Issue #399: the suite verdict's coverage marker. A run over an explicit file subset
// (named files, or --changed) is NOT the acceptance verdict (docs/44: the canonical
// suite is the ONE acceptance), so the verdict carries ONE coverage value derived from
// what the runner already knows — `full` for the canonical selection, `subset` when
// files were named or narrowed — and anything that reads the verdict document as the
// acceptance refuses a subset in its own rendered line. This module is that consumer
// seam: the runner derives the coverage, prints the subset headline, and renders the
// subset sentence through these helpers, so every line reads the document, never a flag.

/** Derive the ONE coverage value for a run: `full` for the canonical selection,
 * `subset` when files were named or --changed narrowed them. */
export function deriveSuiteCoverage({ subset = false, files = 0, canonical = 0 } = {}) {
  for (const [field, value] of [['files', files], ['canonical', canonical]]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`suite coverage ${field} must be a non-negative integer`);
    }
  }
  return Object.freeze({ kind: subset ? 'subset' : 'full', files, canonical });
}

/** Render the verdict headline for a coverage: a subset run names the subset in the
 * headline (`baton suite verdict (SUBSET n of N files): GREEN — …`, keeping the
 * existing GREEN/RED words and counts exactly); a full run returns the input
 * byte-identical. */
export function renderSuiteVerdictHeadline(formatted, coverage) {
  if (coverage?.kind !== 'subset') return formatted;
  return String(formatted).replace(
    /^baton suite verdict:/u,
    `baton suite verdict (SUBSET ${coverage.files} of ${coverage.canonical} files):`,
  );
}

/** A verdict document is the acceptance only when it is not a subset run. A document
 * that predates the marker (no coverage field) keeps its old meaning: only an
 * explicit `subset` disqualifies. */
export function isSuiteAcceptanceVerdict(document) {
  return document?.coverage?.kind !== 'subset';
}

/** The consumer's own rendered line for a subset verdict document: one sentence naming
 * the subset. A full (acceptance) verdict renders nothing. */
export function renderSuiteCoverageNote(document) {
  const coverage = document?.coverage ?? null;
  if (coverage?.kind !== 'subset') return null;
  return `baton suite verdict note: SUBSET verdict (${coverage.files} of ${coverage.canonical} files) — not the canonical-suite acceptance.`;
}

export function renderVerificationExecution(verification = {}) {
  if (typeof verification.command !== 'string' || verification.command.length === 0) return '';

  const cwd = typeof verification.cwd === 'string' && verification.cwd.length > 0
    ? verification.cwd
    : '.';
  const expectExit = Number.isSafeInteger(verification.expectExit)
    ? verification.expectExit
    : 0;

  if (Array.isArray(verification.arguments)) {
    return [
      'Execution mode: direct executable and argv (no shell)',
      `Executable (JSON string): ${JSON.stringify(verification.command)}`,
      `Arguments (JSON array, in order): ${JSON.stringify(verification.arguments)}`,
      `Working directory (relative to the assigned worktree): ${JSON.stringify(cwd)}`,
      `Expected exit code: ${expectExit}`,
    ].join('\n');
  }

  return [
    'Execution mode: legacy shell command',
    `Command: ${verification.command}`,
    `Working directory (relative to the assigned worktree): ${JSON.stringify(cwd)}`,
    `Expected exit code: ${expectExit}`,
  ].join('\n');
}
