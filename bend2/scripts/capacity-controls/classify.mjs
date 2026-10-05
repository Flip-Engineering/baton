// Shared diagnostic classification for law-gate controls, grounded in the
// retained compiler evidence from the pinned Bend 2.0.25 Darwin toolchain:
//
//   baseline          `--check-only` exits 0.
//   proof removal     the checker refuses with a two-line TODO diagnostic that
//                     names no law; attribution rests on the matched baseline,
//                     the exact verified source delta and this exact refusal.
//   bound mutation    the checker refuses with an `Error:` block carrying
//                     `- expected : ` and `- observed : ` lines and a
//                     `Location:` line whose qualified name ends in the law's
//                     name, for example `Location: commands.help_word_...`.
//   unrelated syntax  the checker refuses with different diagnostics and an
//                     empty `Location:` line.
//
// A bare `Error` substring is not an attributable refusal, and neither is a
// bare `Location:` line. The checker, the aggregate and the package consumer
// call this one classifier over complete retained stream bytes and the actual
// recorded child outcome; a producer's own label is never accepted.

export const TODO_REFUSAL = 'Error: 1 TODO found.\nThe code is incomplete, and not a valid proof yet.';

// The first line of time-tool accounting when the wrapper appends it to the
// same stderr stream the child wrote. Darwin /usr/bin/time opens with its
// real/user/sys field line. GNU time -v opens with a "Command exited with
// non-zero status N" preamble when the child failed, then a TAB-indented
// "Command being timed:" field carrying the quoted argv; both retained
// instance-9930 artifacts show exactly this shape. Everything from that
// boundary on is accounting, and the whole suffix must match the measured
// platform profile.
const ACCOUNTING = /^\s*(?:[0-9.]+ real\s+[0-9.]+ user\s+[0-9.]+ sys\s*$|Command exited with non-zero status \d+$|Command being timed:|User time \(seconds\):)/m;

export function splitTimeAccounting(stderrText) {
  const match = ACCOUNTING.exec(stderrText);
  if (!match) return { diagnostics: stderrText, accounting: null, profile: null };
  const accounting = stderrText.slice(match.index);
  return { diagnostics: stderrText.slice(0, match.index), accounting, profile: accountingProfile(accounting) };
}

// Measured wrapper profiles. Darwin /usr/bin/time -l prints bare field lines
// with the resident set in bytes; GNU time -v prints TAB-indented labeled
// lines with the resident set in kbytes, an optional failure preamble and the
// timed command echoed as the first field. A suffix that fits neither profile
// is invalid evidence, and classification refuses rather than trusting the
// prefix.
export function accountingProfile(accounting) {
  if (accounting === null) return null;
  if (/Command being timed:|Exit status: \d+$|Percent of CPU this job got:/m.test(accounting)) return 'gnu-time-v';
  if (/maximum resident set size/.test(accounting)) return 'darwin-usr-bin-time';
  if (/^\s*[0-9.]+ real\s/m.test(accounting)) return 'unknown';
  return null;
}

const DARWIN_TIME_FIELDS = [
  /^\d+(\.\d+)?\s+real\s+\d+(\.\d+)?\s+user\s+\d+(\.\d+)?\s+sys$/,
  /^\d+\s+maximum resident set size$/,
  /^\d+\s+page reclaims$/,
  /^\d+\s+page faults$/,
  /^\d+\s+swap ins$/,
  /^\d+\s+swap outs$/,
  /^\d+\s+block input ops$/,
  /^\d+\s+block output ops$/,
  /^\d+\s+messages sent$/,
  /^\d+\s+messages received$/,
  /^\d+\s+signals received$/,
  /^\d+\s+voluntary context switches$/,
  /^\d+\s+involuntary context switches$/,
];

// GNU time -v field lines exactly as the retained instance-9930 artifacts
// print them, TAB prefixes trimmed. The preamble appears only on failure.
const GNU_TIME_FIELDS = [
  /^Command being timed: ".*"$/,
  /^Command exited with non-zero status \d+$/,
  /^User time \(seconds\): \d+(\.\d+)?$/,
  /^System time \(seconds\): \d+(\.\d+)?$/,
  /^Percent of CPU this job got: \d+%$/,
  /^Elapsed \(wall clock\) time \(h:mm:ss or m:ss\): (\d{1,2}:)?\d{1,2}:\d{1,2}\.\d{2}$/,
  /^Average shared text size \(kbytes\): \d+$/,
  /^Average unshared data size \(kbytes\): \d+$/,
  /^Average stack size \(kbytes\): \d+$/,
  /^Average total size \(kbytes\): \d+$/,
  /^Maximum resident set size \(kbytes\): \d+$/,
  /^Average resident set size \(kbytes\): \d+$/,
  /^Major \(requiring I\/O\) page faults: \d+$/,
  /^Minor \(reclaiming a frame\) page faults: \d+$/,
  /^Voluntary context switches: \d+$/,
  /^Involuntary context switches: \d+$/,
  /^Swaps: \d+$/,
  /^File system inputs: \d+$/,
  /^File system outputs: \d+$/,
  /^Socket messages sent: \d+$/,
  /^Socket messages received: \d+$/,
  /^Signals delivered: \d+$/,
  /^Page size \(bytes\): \d+$/,
  /^Exit status: \d+$/,
];

export function accountingValid(accounting, profile) {
  if (accounting === null) return true;
  const fields = profile === 'darwin-usr-bin-time' ? DARWIN_TIME_FIELDS
    : profile === 'gnu-time-v' ? GNU_TIME_FIELDS
      : null;
  if (fields === null) return false;
  const lines = accounting.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  if (lines.length === 0 || !lines.every((line) => fields.some((field) => field.test(line)))) return false;
  // The measured exit the wrapper reports must appear exactly once.
  const exitLines = lines.filter((line) => /^(Exit status: \d+$)/.test(line));
  return profile === 'gnu-time-v' ? exitLines.length === 1 : true;
}

// Resource samples with explicit units per measured profile. max_rss_bytes is
// always bytes; max_rss_source_unit records the wrapper's reported unit.
export function parseResourceAccounting(accounting, profile) {
  if (accounting === null) return null;
  if (profile === 'darwin-usr-bin-time') {
    const times = /([0-9.]+)\s+real\s+([0-9.]+)\s+user\s+([0-9.]+)\s+sys/.exec(accounting);
    const rss = /(\d+)\s+maximum resident set size/.exec(accounting);
    const reclaims = /(\d+)\s+page reclaims/.exec(accounting);
    if (!times) return null;
    return {
      profile,
      real_seconds: Number(times[1]),
      user_seconds: Number(times[2]),
      sys_seconds: Number(times[3]),
      max_rss_bytes: rss ? Number(rss[1]) : null,
      max_rss_source_unit: 'bytes',
      page_reclaims: reclaims ? Number(reclaims[1]) : null,
    };
  }
  if (profile === 'gnu-time-v') {
    const elapsed = /Elapsed \(wall clock\) time \(h:mm:ss or m:ss\): ([0-9:.]+)/.exec(accounting);
    const user = /User time \(seconds\): ([0-9.]+)/.exec(accounting);
    const sys = /System time \(seconds\): ([0-9.]+)/.exec(accounting);
    const rss = /Maximum resident set size \(kbytes\): (\d+)/.exec(accounting);
    if (!elapsed) return null;
    const parts = elapsed[1].split(':').map(Number);
    const realSeconds = parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts[0] * 60 + parts[1];
    return {
      profile,
      real_seconds: realSeconds,
      user_seconds: user ? Number(user[1]) : null,
      sys_seconds: sys ? Number(sys[1]) : null,
      max_rss_bytes: rss ? Number(rss[1]) * 1024 : null,
      max_rss_source_unit: 'kbytes',
      page_reclaims: null,
    };
  }
  return null;
}

// The intended proof-removal refusal: the exact TODO diagnostic and nothing
// else. The diagnostic carries no law name, so the verdict is exact: any
// additional diagnostic line makes the control unclassified.
export function isTodoRefusal(diagnostics) {
  return diagnostics === TODO_REFUSAL + '\n' || diagnostics === TODO_REFUSAL;
}

// The full characterized mutation refusal: an Error block with expected and
// observed constructor lines plus a Location naming the law. When the
// definition owner has bound the qualified location, the diagnostic's
// Location must equal it exactly; otherwise the law-naming leaf matches.
export function intendedMutationRefusal(diagnostics, law, location) {
  if (!/^Error:/m.test(diagnostics)) return null;
  if (!/^- expected : /m.test(diagnostics)) return null;
  if (!/^- observed : /m.test(diagnostics)) return null;
  for (const line of diagnostics.split('\n')) {
    if (!line.startsWith('Location: ')) continue;
    const value = line.slice('Location: '.length).trim();
    if (value === '') return null;
    if (location !== undefined) return value === location ? { location: value, law } : null;
    const leaf = value.split('.').pop();
    return leaf === law ? { location: value, law } : null;
  }
  return null;
}

// Optional expected/observed constructor metadata supplied per mutation id.
export function expectationMet(diagnostics, expectation) {
  if (!expectation) return true;
  if (expectation.expected !== undefined && !diagnostics.includes(`- expected : ${expectation.expected}`)) return false;
  if (expectation.observed !== undefined && !diagnostics.includes(`- observed : ${expectation.observed}`)) return false;
  return true;
}

// One strict process-outcome validator for every path: ordinary gate, group
// runner receipts, aggregate loop and the per-case endpoint. This is the
// documented receipt contract, shared with the package validator: fields must
// be present, types are never coerced, the exit code must be a non-negative
// integer, signal and spawn_error are exactly null or a non-empty string, and
// every field must agree with the declared state.
export function validChildOutcome({ state, exitCode, signal, spawnError }) {
  if (state !== 'exited' && state !== 'signalled' && state !== 'spawn-error' && state !== 'not-run') return false;
  if (!Number.isInteger(exitCode) && exitCode !== null) return false;
  if (exitCode !== null && exitCode < 0) return false;
  const signalOk = signal === null || (typeof signal === 'string' && signal.length > 0);
  const spawnOk = spawnError === null || (typeof spawnError === 'string' && spawnError.length > 0);
  if (!signalOk || !spawnOk) return false;
  if (state === 'exited') return Number.isInteger(exitCode) && signal === null && spawnError === null;
  if (state === 'signalled') return exitCode === null && signal !== null && spawnError === null;
  if (state === 'spawn-error') return exitCode === null && signal === null && spawnError !== null;
  return exitCode === null && signal === null && spawnError === null;
}

// The ordinary gate's compile receipt shape: a refusal that was a valid
// observed normal exit with a positive integer code and no signal.
export function refusedNormally(control) {
  if (!validChildOutcome({ state: 'exited', exitCode: control.exitCode, signal: control.signal, spawnError: null })) {
    return false;
  }
  return Number.isInteger(control.exitCode) && control.exitCode > 0;
}

// One classification per completed child over complete raw diagnostics and
// the actual recorded outcome. A type-invalid or inconsistent outcome is
// malformed evidence in its own right and can never classify as a refusal.
export function classifyControl({ state, exitCode, signal, spawnError, stderrText, control, expectation, location }) {
  if (!validChildOutcome({ state, exitCode, signal, spawnError })) {
    return { class: 'malformed-outcome', attributedLaw: null };
  }
  if (spawnError !== null && spawnError !== undefined) return { class: 'spawn-error', attributedLaw: null };
  if (signal !== null && signal !== undefined) return { class: 'crashed', attributedLaw: null };
  if (state !== 'exited' || exitCode === null || exitCode === undefined) {
    return { class: 'unfinished', attributedLaw: null };
  }
  const { diagnostics, accounting, profile } = splitTimeAccounting(stderrText ?? '');
  if (accounting !== null && !accountingValid(accounting, profile)) {
    return { class: 'accounting-invalid', attributedLaw: null };
  }
  if (control.kind === 'baseline') {
    return exitCode === 0
      ? { class: 'baseline-ok', attributedLaw: null }
      : { class: 'baseline-failed', attributedLaw: null };
  }
  if (exitCode === 0) return { class: 'accepted', attributedLaw: null };
  const refusal = control.kind === 'proof-removal'
    ? isTodoRefusal(diagnostics)
    : control.kind === 'mutation' ? intendedMutationRefusal(diagnostics, control.law, location) !== null : false;
  if (refusal && expectationMet(diagnostics, expectation)) {
    return { class: 'intended-law-refusal', attributedLaw: control.law };
  }
  if (refusal) return { class: 'expectation-mismatch', attributedLaw: null };
  return { class: 'unclassified-rejection', attributedLaw: null };
}

// The one qualification boundary for a negative control case. The group
// runner, the aggregate and the per-case endpoint all call this with the same
// bound inputs, so no consumer can turn a narrow diagnostic match into
// acceptance while a prerequisite is missing. A case qualifies only when the
// diagnostics are the intended refusal, the matched baseline compiled, the
// mutation's definition-owned expectation and location metadata are bound,
// the exact applied delta verifies, and any supplied producer label agrees.
//
// `control` is the discovery record; `expectation` and `location` are the
// definition-owner metadata for mutation cases (undefined while the owner has
// not bound them); `delta` carries the retained changed bytes and the bytes
// re-derived from the bound original, or null when unverifiable.
export function classifyCase({
  control,
  expectation,
  location,
  state,
  exitCode,
  signal,
  spawnError,
  stderrText,
  baselineOk,
  delta,
  supplied,
}) {
  const base = classifyControl({
    state, exitCode, signal, spawnError, stderrText, control,
    expectation: control.kind === 'mutation' ? expectation : undefined,
    location: control.kind === 'mutation' ? location : undefined,
  });
  const qualifiedBase = base.class === 'intended-law-refusal' && base.attributedLaw === control.law;
  if (!qualifiedBase) return { ...base, qualified: false };
  if (!baselineOk) return { class: 'unqualified-baseline', attributedLaw: null, qualified: false };
  if (control.kind === 'mutation' && (!expectation || expectation.expected === undefined
    || expectation.observed === undefined || !location)) {
    return { class: 'expectation-unqualified', attributedLaw: null, qualified: false };
  }
  if (!delta || typeof delta.changedText !== 'string' || delta.changedText !== delta.expectedChangedText) {
    return { class: 'delta-unverified', attributedLaw: null, qualified: false };
  }
  if (supplied && (supplied.class !== base.class || supplied.attributed_law !== base.attributedLaw)) {
    return { class: 'misreported-diagnostic', attributedLaw: null, qualified: false };
  }
  return { ...base, qualified: true };
}
