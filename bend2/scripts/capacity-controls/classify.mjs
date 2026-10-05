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
// same stderr stream the child wrote. Everything from that line on is
// accounting, and the whole suffix must match the measured platform profile.
const ACCOUNTING = /^\s*[0-9.]+ real\s+[0-9.]+ user\s+[0-9.]+ sys\s*$/m;

export function splitTimeAccounting(stderrText) {
  const match = ACCOUNTING.exec(stderrText);
  if (!match) return { diagnostics: stderrText, accounting: null, profile: null };
  const accounting = stderrText.slice(match.index);
  return { diagnostics: stderrText.slice(0, match.index), accounting, profile: accountingProfile(accounting) };
}

// Measured wrapper profiles. Darwin /usr/bin/time -l prints bare field lines
// with the resident set in bytes; GNU time -v prints labeled lines with the
// resident set in kbytes. A suffix that fits neither profile is invalid
// evidence, and classification refuses rather than trusting the prefix.
export function accountingProfile(accounting) {
  if (accounting === null) return null;
  if (/Maximum resident set size \(kbytes\):/.test(accounting)) return 'gnu-time-v';
  if (/maximum resident set size/.test(accounting)) return 'darwin-usr-bin-time';
  if (/^\s*[0-9.]+ real\s/m.test(accounting)) return 'unknown';
  return null;
}

const DARWIN_TIME_FIELDS = [
  /^\d+(\.\d+)? real \d+(\.\d+)? user \d+(\.\d+)? sys$/,
  /^\d+ maximum resident set size$/,
  /^\d+ page reclaims$/,
  /^\d+ page faults$/,
  /^\d+ swap ins$/,
  /^\d+ swap outs$/,
  /^\d+ block input ops$/,
  /^\d+ block output ops$/,
  /^\d+ messages sent$/,
  /^\d+ messages received$/,
  /^\d+ signals received$/,
  /^\d+ voluntary context switches$/,
  /^\d+ involuntary context switches$/,
];

const GNU_TIME_FIELDS = [
  /^\s*Command being exectured:.*$/,
  /^\s*User time \(seconds\): \d+(\.\d+)?$/,
  /^\s*System time \(seconds\): \d+(\.\d+)?$/,
  /^\s*Percent of CPU this job got: \d+%?$/,
  /^\s*Elapsed \(wall clock\) time \(h:mm:ss or m:ss\): .+$/,
  /^\s*Average shared text size \(kbytes\): \d+$/,
  /^\s*Average unshared data size \(kbytes\): \d+$/,
  /^\s*Average stack size \(kbytes\): \d+$/,
  /^\s*Average total size \(kbytes\): \d+$/,
  /^\s*Maximum resident set size \(kbytes\): \d+$/,
  /^\s*Average resident set size \(kbytes\): \d+$/,
  /^\s*Major \(requiring I\/O\) page faults: \d+$/,
  /^\s*Minor \(reclaiming a frame\) page faults: \d+$/,
  /^\s*Voluntary context switches: \d+$/,
  /^\s*Involuntary context switches: \d+$/,
  /^\s*Swaps: \d+$/,
  /^\s*File system inputs: \d+$/,
  /^\s*File system outputs: \d+$/,
  /^\s*Socket messages sent: \d+$/,
  /^\s*Socket messages received: \d+$/,
  /^\s*Signals delivered: \d+$/,
  /^\s*Page size \(bytes\): \d+$/,
  /^\s*Exit status: \d+$/,
];

export function accountingValid(accounting, profile) {
  if (accounting === null) return true;
  const fields = profile === 'darwin-usr-bin-time' ? DARWIN_TIME_FIELDS
    : profile === 'gnu-time-v' ? GNU_TIME_FIELDS
      : null;
  if (fields === null) return false;
  const lines = accounting.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  return lines.length > 0 && lines.every((line) => fields.some((field) => field.test(line)));
}

// Resource samples with explicit units per measured profile. max_rss_bytes is
// always bytes; max_rss_source_unit records the wrapper's reported unit.
export function parseResourceAccounting(accounting, profile) {
  if (accounting === null) return null;
  if (profile === 'darwin-usr-bin-time') {
    const times = /([0-9.]+) real ([0-9.]+) user ([0-9.]+) sys/.exec(accounting);
    const rss = /(\d+) maximum resident set size/.exec(accounting);
    const reclaims = /(\d+) page reclaims/.exec(accounting);
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

// The qualified `Location:` line a bound-mutation refusal carries. Returns the
// parsed location when its last dotted segment equals the law, otherwise null.
// An empty location, as an unrelated syntax error prints, never matches. The
// qualifying prefix is not pinned here: the composed real-Main prefix is
// measured at integration and recorded as producer evidence.
export function qualifiedLawLocation(diagnostics, law) {
  for (const line of diagnostics.split('\n')) {
    if (!line.startsWith('Location: ')) continue;
    const location = line.slice('Location: '.length).trim();
    const leaf = location.split('.').pop();
    if (location !== '' && leaf === law) return { location, law };
    return null;
  }
  return null;
}

// The full characterized mutation refusal: an Error block with expected and
// observed constructor lines plus a Location naming the law. A bare Location
// line without the block is not acceptance evidence.
export function intendedMutationRefusal(diagnostics, law) {
  if (!/^Error:/m.test(diagnostics)) return null;
  if (!/^- expected : /m.test(diagnostics)) return null;
  if (!/^- observed : /m.test(diagnostics)) return null;
  return qualifiedLawLocation(diagnostics, law);
}

// Optional expected/observed constructor metadata supplied per mutation id.
export function expectationMet(diagnostics, expectation) {
  if (!expectation) return true;
  if (expectation.expected !== undefined && !diagnostics.includes(`- expected : ${expectation.expected}`)) return false;
  if (expectation.observed !== undefined && !diagnostics.includes(`- observed : ${expectation.observed}`)) return false;
  return true;
}

// The ordinary gate's compile receipt shape: a refusal that was a normal
// process exit with a nonzero code.
export function refusedNormally(control) {
  return control.exitCode !== null && control.exitCode !== undefined && control.exitCode > 0
    && (control.signal === null || control.signal === undefined);
}

// One classification per completed child over complete raw diagnostics and the
// actual recorded outcome.
export function classifyControl({ state, exitCode, signal, spawnError, stderrText, control, expectation }) {
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
    : control.kind === 'mutation' ? intendedMutationRefusal(diagnostics, control.law) !== null : false;
  if (refusal && expectationMet(diagnostics, expectation)) {
    return { class: 'intended-law-refusal', attributedLaw: control.law };
  }
  if (refusal) return { class: 'expectation-mismatch', attributedLaw: null };
  return { class: 'unclassified-rejection', attributedLaw: null };
}
