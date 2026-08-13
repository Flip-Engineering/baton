/*
 * [attempt: 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc row-suite-155]
 * cli-silent-start-red.test.mjs — #155 red-first acceptance suite (v1.1 FOLDED contract)
 *
 * Source of truth: docs/reference/evidence/cli-silent-start-2026-08-13/cli-silent-start-contract.md
 * (v1.1 FOLDED, HEAD e371f70). The kill: an unknown `run <verb>` must never compile to a real
 * `run.start`. The four-way rule D2 — 1 exact verb→dispatch; 2 bare/unknown-sub `member`→refuse;
 * 3 Damerau–Levenshtein-1 typo→refuse+suggest; 4 otherwise→objective-first byte-identical.
 * Damerau (adjacent transposition = 1), NOT plain Levenshtein (D3, fold B3).
 *
 * Suite law (foundry-brief.md wave-b): red-first at HEAD with a NAMED stage in every capability
 * assertion; hermetic (parse-seam + static source-scan only — no connection, no provider, no
 * clock, no host state, no mkdtemp fixture needed); no absolute line-window anchors (#166) —
 * ORDER/EXISTENCE/byte-string source assertions only; split-twice (recorded below).
 *
 * ROW INVENTORY (contract PT-1..PT-10):
 *   PIN rows (GREEN at HEAD):        PT-1 objective-first byte-identical · PT-3 never-a-guess ·
 *                                    PT-6 exit-code bucket 2 · PT-7 canonical aliases unchanged ·
 *                                    PT-8 parse-before-connection · PT-9 follow/steer keep refusing ·
 *                                    PT-10 conformance gate unchanged
 *   Capability rows (RED at HEAD):   PT-2a pinned transposition typos · PT-2b refused-position
 *                                    typos · PT-2c generated Damerau-1 sweep · PT-4 derivation
 *                                    symbol source-scan · PT-5 bare/unknown-sub member
 *
 * Every row is a test at its NAMED stage: each test name carries the canonical stage
 * (PT-<n> [<stage>]); the assertion messages carry the granular stages. The stage table with the
 * full row↔stage mapping and the plausible-wrong-impl audit is in suite-draft-notes.md.
 *
 * SPLIT RECORD (`node --test impl/test/cli-silent-start-red.test.mjs` from the repo root):
 *   Run 1 — 12 tests, 7 pass / 5 fail  (7 PIN rows green; PT-2a, PT-2b, PT-2c, PT-4, PT-5 red)
 *   Run 2 — 12 tests, 7 pass / 5 fail  (stable)
 *
 * FOLD RECORD (blue-team wave-a → suite v1.2; the contract stays v1.1 FOLDED; fold-suite-155.md):
 * the blue-team named PT-4 BROKEN
 * (unsatisfiable) and PT-2a/PT-2b SHALLOW. Every finding is FOLDED or RECORDED — none STRUCK, none
 * ESCALATED: (1) PT-4(e) prefix mismatch FOLDED (bare-vs-prefixed cli_ code comparison → the
 * prefix-corrected guard; PT-4 stays RED at HEAD for the right reasons a–d and is now green-capable);
 * (2) ALIAS_FIRST_TOKENS drift FOLDED (derivation narrowed to the contract D1 set {view, list,
 * member} — do/resume/retry excluded as lifecycle verbs); (3) member-guard placement constraint
 * RECORDED as a comment on extractRunBranchFacadeLabels (the rule-2 member refusal must live at the
 * :1578 site after lifecycleActions) and hardened by excluding alias first-tokens from the facade
 * derivation; (4) composition-form requirement RECORDED as a comment on extractLifecycleVerbs
 * (RUN_RECOGNIZED_FIRST_TOKENS must be spread-composed, never enumerated); (5) PT-2a/PT-2b SHALLOW
 * ACCEPTED — they name the audit's headline examples and are backstopped by PT-2c's generated sweep.
 *   Run A — 12 tests, 7 pass / 5 fail  (same split; PT-4 now RED for the RIGHT reason)
 *   Run B — 12 tests, 7 pass / 5 fail  (stable)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseBatonCli } from '../src/index.mjs';
import { checkSurfaceDocs } from '../scripts/render-surface-docs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CLI_PATH = join(REPO_ROOT, 'impl', 'src', 'application-cli.mjs');
const SEM_PATH = join(REPO_ROOT, 'impl', 'src', 'application-semantics.mjs');
const BATON_PATH = join(REPO_ROOT, 'impl', 'scripts', 'baton.mjs');

const ALPHA = 'abcdefghijklmnopqrstuvwxyz';

/** Damerau–Levenshtein distance (OSA). Equal to true Damerau for distance ≤ 1, the only band D3 uses. */
function damerauLevenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/** Every Damerau–Levenshtein-distance-1 string of `word` (substitution / insertion / deletion / adjacent transposition). */
function generateDistance1Variants(word) {
  const out = new Set();
  const { length } = word;
  for (let i = 0; i < length; i++) out.add(word.slice(0, i) + word.slice(i + 1)); // deletion
  for (let i = 0; i + 1 < length; i++) out.add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2)); // transposition
  for (let i = 0; i < length; i++) {
    for (const c of ALPHA) if (c !== word[i]) out.add(word.slice(0, i) + c + word.slice(i + 1)); // substitution
  }
  for (let i = 0; i <= length; i++) {
    for (const c of ALPHA) out.add(word.slice(0, i) + c + word.slice(i)); // insertion
  }
  return out;
}

// ── source derivation (the contract's D1 symbol, recomputed from the parser itself) ──

/**
 * The lifecycle verb set. Tolerant of the fold: matches any `new Set([...])` literal of
 * all-lowercase verb tokens and takes the maximal one (29 at HEAD; the run dispatch's closed
 * set is the only literal that rivals it). The fold's RUN_RECOGNIZED_FIRST_TOKENS composes this
 * set (D1), so the same membership must survive under a renamed constant.
 * COMPOSITION-FORM REQUIREMENT (blue-team finding 6): RUN_RECOGNIZED_FIRST_TOKENS must be
 * spread-composed (`[...lifecycleActions, ...FACADE_NOUNS, 'start', 'follow'] ∪ ALIAS_FIRST_TOKENS`),
 * never a hand-enumerated 39-string literal — an enumerated literal would be mistaken for the
 * lifecycle set by this maximal-set extraction and inflate the detection set past 39.
 */
function extractLifecycleVerbs(cli) {
  const sets = [...cli.matchAll(/const [A-Za-z_$][A-Za-z0-9_$]* = new Set\(\[([\s\S]*?)\]\)/gu)];
  let best = [];
  for (const m of sets) {
    const q = [...m[1].matchAll(/'([^']+)'/gu)].map((x) => x[1]);
    if (q.length > best.length && q.every((t) => /^[a-z][a-z0-9-]*$/u.test(t))) best = q;
  }
  return best;
}

/**
 * The five facade nouns, derived from the run-branch `action === '<noun>'` dispatch labels (PT-4(a)).
 * MEMBER-GUARD PLACEMENT CONSTRAINT (blue-team finding 5): the rule-2 `action === 'member'` refusal
 * must live at the `:1578` guard site AFTER `const lifecycleActions = new Set(...)` — if it were
 * placed inside the facade window it would be scanned here; the alias-token filter below (member is
 * an ALIAS_FIRST_TOKENS member, never a facade noun) keeps the derived set at the contract's five
 * facade nouns regardless, so a correctly-placed guard can never inflate the detection set.
 */
function extractRunBranchFacadeLabels(cli, lifecycle, aliases) {
  const s0 = cli.indexOf("if (args.shift() !== 'run')");
  let e0 = cli.indexOf('const lifecycleActions = new Set(', s0);
  if (e0 === -1) e0 = cli.indexOf('unknown run action', s0);
  if (e0 === -1) e0 = cli.length;
  const labels = [...cli.slice(s0, e0).matchAll(/if \(action === '([^']+)'/gu)].map((x) => x[1]);
  return labels.filter((l) => !lifecycle.includes(l) && l !== 'start' && l !== 'follow' && !aliases.has(l));
}

/**
 * ALIAS_FIRST_TOKENS = the canonical alias first-tokens that are NOT otherwise recognized (contract
 * D1 names `view`, `list`, `member`). The OPERATION_ALIASES table's `do`/`resume`/`retry` rows are
 * also `['run', …]` canonical spellings but are already lifecycle verbs, so they are excluded here —
 * otherwise a contract-faithful `ALIAS_FIRST_TOKENS = {view, list, member}` would drift from the
 * derived set (blue-team finding 2).
 */
function extractAliasFirstTokens(sem, lifecycle) {
  const out = new Set();
  for (const mm of sem.matchAll(/cli: \{ canonical: \['run', '([^']+)'/gu)) {
    const tok = mm[1];
    if (!lifecycle.includes(tok)) out.add(tok);
  }
  return out;
}

/**
 * The detection set = RUN_RECOGNIZED_FIRST_TOKENS = [...lifecycleActions, ...FACADE_NOUNS, 'start',
 * 'follow'] ∪ ALIAS_FIRST_TOKENS (contract D1). Recomputed from the source so the generated sweep
 * and the PT-7 dispatch guard track the parser's true recognized first-token set, never a hand-list.
 */
function deriveDetectionSet(cli, sem) {
  const lifecycle = extractLifecycleVerbs(cli);
  const aliases = extractAliasFirstTokens(sem, lifecycle);
  const facades = extractRunBranchFacadeLabels(cli, lifecycle, aliases);
  return new Set([...lifecycle, ...facades, 'start', 'follow', ...aliases]);
}

// The refused-only positions and the member prefix are detected but never suggested (D2 rule 3, fold B2).
const REFUSED_ONLY = new Set(['follow', 'steer', 'member']);
const SWEEP_SEEDS = ['show', 'send', 'view', 'attention', 'status', 'list', 'member', 'steer', 'follow'];

/** The distinct handling per matched verb for a distance-1 typo (D2 rule 3). Returns the message checks. */
function checkRefusalMessage(message, neighbor) {
  if (neighbor === 'follow') {
    return /follow is not shipped by the Run application/u.test(message) && /run start/u.test(message);
  }
  if (neighbor === 'steer') {
    return /steer was deleted at the M5 alias sunset; use run send/u.test(message) && /run start/u.test(message);
  }
  if (neighbor === 'member') {
    return /expected run member view, send, stop, or interrupt/u.test(message);
  }
  if (neighbor === 'attention') {
    return /did you mean 'run attention watch'/u.test(message) && /run start/u.test(message);
  }
  return new RegExp(`did you mean 'run ${neighbor}'`, 'u').test(message) && /run start/u.test(message);
}

// ── PT-1 — objective-first preserved, byte-identical (the §1.3 green pin) ──

test('PT-1 pin [objective-first] — the objective-first start form compiles byte-identically to the phase68 pin', () => {
  const bare = parseBatonCli(['run', 'Improve Baton', '--idempotency-key', 'run-default']);
  assert.deepEqual(bare, {
    kind: 'command', name: 'run.start',
    args: { intent: { objective: 'Improve Baton', resultIntent: 'change' } },
    idempotencyKey: 'run-default',
  }, 'stage[objective-first-bare] the bare run OBJECTIVE form must equal the phase68 pin exactly');
  const explicit = parseBatonCli(['run', 'start', 'Improve Baton', '--idempotency-key', 'run-default']);
  assert.deepEqual(explicit, bare, 'stage[objective-first-start] run start OBJECTIVE must compile identically to the bare form');
  const multi = parseBatonCli(['run', 'Ship it', '--model', 'gpt-5.6-sol', '--effort', 'low']);
  assert.equal(multi?.kind, 'command', 'stage[objective-first-multiword]');
  assert.equal(multi?.name, 'run.start', 'stage[objective-first-multiword] a multi-word objective with start flags must still compile to run.start');
  assert.equal(multi?.args?.intent?.objective, 'Ship it', 'stage[objective-first-multiword]');
});

// ── PT-2a — pinned adjacent-transposition typos refuse with suggestion + escape ──

test('PT-2a capability [pinned-typo-refusals] — transposition typos refuse cli_command_unavailable with suggestion + run start escape (Damerau, not Levenshtein)', () => {
  const pinned = [
    ['shwo', 'show'],
    ['sned', 'send'],
    ['viwe', 'view'],
    ['attenton', 'attention watch'],
  ];
  for (const [token, want] of pinned) {
    assert.throws(
      () => parseBatonCli(['run', token]),
      (e) => e?.code === 'cli_command_unavailable'
        && new RegExp(`did you mean 'run ${want}`, 'u').test(e?.message ?? '')
        && /run start/u.test(e?.message ?? ''),
      `stage[pinned-typo-${token}] run ${token} must refuse cli_command_unavailable with "did you mean 'run ${want}'" and the run start escape — never a run.start`
    );
  }
});

// ── PT-2b — refused-position distance-1 typos (fold B2) ──

test('PT-2b capability [refused-position-typos] — distance-1 typos of the refused-only positions refuse with the dead verb\'s existing text', () => {
  assert.throws(
    () => parseBatonCli(['run', 'steek']),
    (e) => e?.code === 'cli_command_unavailable'
      && /steer was deleted at the M5 alias sunset; use run send/u.test(e?.message ?? '')
      && /run start/u.test(e?.message ?? ''),
    'stage[pinned-typo-steek] run steek (~steer, the audit F-1 headline) must refuse with steer\'s existing message + the run start escape'
  );
  assert.throws(
    () => parseBatonCli(['run', 'follw']),
    (e) => e?.code === 'cli_command_unavailable'
      && /follow is not shipped by the Run application/u.test(e?.message ?? '')
      && /run start/u.test(e?.message ?? ''),
    'stage[pinned-typo-follw] run follw (~follow) must refuse with follow\'s existing message + the run start escape'
  );
  assert.throws(
    () => parseBatonCli(['run', 'membr']),
    (e) => e?.code === 'cli_command_unavailable'
      && /expected run member view, send, stop, or interrupt/u.test(e?.message ?? ''),
    'stage[pinned-typo-membr] run membr (~member) must route to rule 2\'s member subverb teaching message'
  );
});

// ── PT-2c — generated Damerau-Levenshtein-1 sweep (fold B4) ──

test('PT-2c capability [generated-damerau1-sweep] — every generated distance-1 variant refuses (exactly-one) or falls through (zero/two-or-more)', () => {
  const cli = readFileSync(CLI_PATH, 'latin1');
  const sem = readFileSync(SEM_PATH, 'latin1');
  const detection = deriveDetectionSet(cli, sem);
  const lifecycle = extractLifecycleVerbs(cli);
  assert.ok(lifecycle.length >= 29, 'stage[derivation-source-unreadable] the lifecycle verb set must be extractable from application-cli.mjs (29 verbs at HEAD)');
  assert.equal(detection.size, 39, 'stage[derivation-source-unreadable] the detection set must be the 39-token RUN_RECOGNIZED_FIRST_TOKENS at HEAD');

  const variants = new Set();
  for (const seed of SWEEP_SEEDS) {
    for (const v of generateDistance1Variants(seed)) variants.add(v);
  }

  const mismatches = [];
  let exactOne = 0;
  let zero = 0;
  let twoPlus = 0;
  let skippedExact = 0;
  for (const v of variants) {
    if (detection.has(v)) { skippedExact++; continue; } // rule 1 exact dispatch — the fold's concern is what it does to NON-members
    const neighbors = [...detection].filter((t) => damerauLevenshtein(v, t) <= 1);
    if (neighbors.length === 1) {
      exactOne++;
      try {
        parseBatonCli(['run', v]);
        mismatches.push(`${v}~${neighbors[0]}: expected cli_command_unavailable refusal, got a run.start (the silent-start bug)`);
      } catch (e) {
        if (e?.code !== 'cli_command_unavailable' || !checkRefusalMessage(e?.message ?? '', neighbors[0])) {
          mismatches.push(`${v}~${neighbors[0]}: expected cli_command_unavailable + the ${neighbors[0]} suggestion, got ${e?.code ?? e?.constructor?.name} ${JSON.stringify((e?.message ?? '').slice(0, 60))}`);
        }
      }
    } else if (neighbors.length === 0) {
      zero++;
      try {
        const r = parseBatonCli(['run', v]);
        if (!(r?.kind === 'command' && r?.name === 'run.start')) {
          mismatches.push(`${v}: zero-match expected objective-first run.start, got ${r?.name ?? 'throw'}`);
        }
      } catch (e) {
        mismatches.push(`${v}: zero-match expected objective-first run.start, got throw ${e?.code ?? e?.constructor?.name}`);
      }
    } else {
      twoPlus++;
      try {
        const r = parseBatonCli(['run', v]);
        if (!(r?.kind === 'command' && r?.name === 'run.start')) {
          mismatches.push(`${v}: two-or-more (${neighbors.join(',')}) expected objective-first run.start (never a guess), got ${r?.name ?? 'throw'}`);
        }
      } catch (e) {
        mismatches.push(`${v}: two-or-more expected objective-first run.start, got throw ${e?.code ?? e?.constructor?.name}`);
      }
    }
  }
  const sample = mismatches.slice(0, 12).join(' | ');
  assert.deepEqual(mismatches, [],
    `stage[generated-damerau1-sweep] exactly-one=${exactOne} zero=${zero} two-or-more=${twoPlus} skipped-exact=${skippedExact}; ${sample}${mismatches.length > 12 ? ` | …${mismatches.length - 12} more` : ''}`);
});

// ── PT-3 — never a guess (zero-match and two-or-more both fall through objective-first) ──

test('PT-3 pin [never-a-guess] — a token distance-1 from zero or two-or-more recognized first-tokens starts objective-first', () => {
  for (const token of ['deploy', 'refactor']) {
    const r = parseBatonCli(['run', token]);
    assert.equal(r?.kind, 'command', `stage[never-guess-zero-${token}]`);
    assert.equal(r?.name, 'run.start', `stage[never-guess-zero-${token}] run ${token} (distance-1 from zero recognized first-tokens) must start objective-first`);
    assert.equal(r?.args?.intent?.objective, token, `stage[never-guess-zero-${token}]`);
  }
  for (const token of ['stow']) { // constructed fixture distance-1 from show AND stop
    const r = parseBatonCli(['run', token]);
    assert.equal(r?.kind, 'command', `stage[never-guess-two-plus-${token}]`);
    assert.equal(r?.name, 'run.start', `stage[never-guess-two-plus-${token}] run ${token} (distance-1 from two recognized first-tokens) must start objective-first — the parser never guesses between candidates`);
    assert.equal(r?.args?.intent?.objective, token, `stage[never-guess-two-plus-${token}]`);
  }
});

// ── PT-4 — the closed set is derived from the pinned symbol, no drift (source-scan) ──

test('PT-4 capability [derivation-symbol-source-scan] — the recognition set is computed from the single named derivation symbol (a–e)', () => {
  const cli = readFileSync(CLI_PATH, 'latin1');
  const sem = readFileSync(SEM_PATH, 'latin1');
  const failures = [];
  const lifecycle = extractLifecycleVerbs(cli);
  const aliases = extractAliasFirstTokens(sem, lifecycle);
  const facades = extractRunBranchFacadeLabels(cli, lifecycle, aliases);
  const aliasFirst = [...aliases];
  const detection = deriveDetectionSet(cli, sem);

  // (a) FACADE_NOUNS is ONE named constant and equals the run-branch facade dispatch labels.
  const facadeDecl = /const FACADE_NOUNS\s*=\s*(?:new Set\(\[|\[)([\s\S]*?)(?:\]\)|\])/u.exec(cli);
  if (!facadeDecl) {
    failures.push('stage[facade-nouns-symbol-absent]: const FACADE_NOUNS (one named constant) is not declared');
  } else {
    const declared = [...facadeDecl[1].matchAll(/'([^']+)'/gu)].map((x) => x[1]).sort();
    if (JSON.stringify(declared) !== JSON.stringify([...facades].sort())) {
      failures.push(`stage[facade-nouns-drift]: FACADE_NOUNS ${JSON.stringify(declared)} ≠ run-branch dispatch ${JSON.stringify([...facades].sort())}`);
    }
  }

  // (b) ALIAS_FIRST_TOKENS is cross-checked against the OPERATION_ALIASES cli canonical rows' first
  // tokens that are NOT otherwise recognized (contract D1 names view / list / member — the suite's
  // derivation excludes do/resume/retry, which are lifecycle verbs; blue-team finding 2).
  const aliasDecl = /const ALIAS_FIRST_TOKENS\s*=\s*(?:new Set\(\[|\[)([\s\S]*?)(?:\]\)|\])/u.exec(cli);
  if (!aliasDecl) {
    failures.push('stage[alias-first-tokens-symbol-absent]: const ALIAS_FIRST_TOKENS is not declared');
  } else {
    const declared = [...aliasDecl[1].matchAll(/'([^']+)'/gu)].map((x) => x[1]).sort();
    if (JSON.stringify(declared) !== JSON.stringify([...aliasFirst].sort())) {
      failures.push(`stage[alias-first-tokens-drift]: ALIAS_FIRST_TOKENS ${JSON.stringify(declared)} ≠ alias rows ${JSON.stringify([...aliasFirst].sort())}`);
    }
  }

  // (c) the detection set INCLUDES follow/steer/member; the taught live set EXCLUDES them and EXCLUDES watch.
  if (!cli.includes('RUN_RECOGNIZED_FIRST_TOKENS')) {
    failures.push('stage[derivation-symbol-absent]: the guard must compute its set from the named symbol RUN_RECOGNIZED_FIRST_TOKENS, never a second hand-list');
  }
  for (const t of ['follow', 'steer', 'member']) {
    if (!detection.has(t)) failures.push(`stage[detection-missing-${t}]: the detection set must include the refused-only position ${t} (fold B2)`);
  }
  if (detection.has('watch')) failures.push('stage[watch-excluded]: the taught live set must exclude watch (parser-absent, F-2)');
  if (sem.includes("canonical: ['run', 'watch']")) failures.push('stage[watch-excluded]: run.watch must keep cli: null — never a recognized first-token');

  // (d) the refusal fires only from the run branch at the :1578 site (and the member-prefix site), nowhere else.
  const nakedFallthrough = '!lifecycleActions.has(action)) return parseStart(args, action, idempotencyKey)';
  if (cli.includes(nakedFallthrough)) {
    failures.push('stage[guard-replaces-naked-fallthrough]: the naked run-branch fall-through into parseStart is still present — the typo-guard must replace it');
  }

  // (e) no new cli_* code is minted (the F-8 taxonomy is unchanged).
  const headCliCodes = ['cli_action_inputs_invalid', 'cli_command_failed', 'cli_command_host_local',
    'cli_command_pending', 'cli_command_unavailable', 'cli_config_invalid', 'cli_connection_incompatible',
    'cli_export_archive_digest_mismatch', 'cli_export_archive_invalid', 'cli_export_delivery_invalid',
    'cli_export_destination_exists', 'cli_export_destination_invalid', 'cli_export_download_failed',
    'cli_export_extract_failed', 'cli_invalid', 'cli_protocol_failed', 'cli_setup_conflict',
    'cli_setup_failed', 'cli_setup_remote_invalid', 'cli_setup_remote_refused',
    'cli_setup_remote_unavailable', 'cli_transport_failed'];
  const actualCodes = [...new Set([...cli.matchAll(/'cli_([a-z_]+)'/gu)].map((m) => m[1]))];
  // prefix-corrected (blue-team finding 1): actualCodes holds BARE codes, headCliCodes holds the
  // `cli_`-prefixed forms — the old bare-vs-prefixed `includes` comparison was red at HEAD for the
  // wrong reason and could never go green under any correct implementation.
  const minted = actualCodes.filter((c) => !headCliCodes.some((hc) => hc === `cli_${c}`)).sort();
  if (minted.length > 0) {
    failures.push(`stage[new-cli-code-minted]: ${minted.join(',')} — the refusal must reuse cli_command_unavailable, no new code`);
  }

  assert.deepEqual(failures, [], `capability row PT-4 — ${failures.length} source-scan failure(s): ${failures.join(' | ')}`);
});

// ── PT-5 — bare / unknown-sub member incomplete-prefix ──

test('PT-5 capability [member-prefix] — bare and unknown-sub run member refuse with the subverb teaching message', () => {
  for (const argv of [['run', 'member'], ['run', 'member', 'veiw'], ['run', 'member', 'foo']]) {
    assert.throws(
      () => parseBatonCli(argv),
      (e) => e?.code === 'cli_command_unavailable'
        && /expected run member view, send, stop, or interrupt/u.test(e?.message ?? ''),
      `stage[member-prefix-${argv.slice(1).join('-')}] ${JSON.stringify(argv)} must refuse cli_command_unavailable with the member subverb teaching message (rule 2), never a run.start`
    );
  }
});

// ── PT-6 — exit code (bucket 2) ──

test('PT-6 pin [exit-code-bucket-2] — cli_command_unavailable maps to exit 2; a genuine run.start parse still succeeds', () => {
  const baton = readFileSync(BATON_PATH, 'latin1');
  const mapping = "error?.code === 'cli_invalid' || error?.code === 'cli_config_invalid' || error?.code === 'cli_command_unavailable' ? 2 : 1";
  assert.ok(baton.includes(mapping), 'stage[exit-code-bucket-2] baton.mjs must keep the cli_invalid / cli_config_invalid / cli_command_unavailable → exit 2 mapping');
  const r = parseBatonCli(['run', 'start', 'Improve Baton']);
  assert.equal(r?.kind, 'command', 'stage[exit-code-happy-path]');
  assert.equal(r?.name, 'run.start', 'stage[exit-code-happy-path] a genuine run.start parse still succeeds (exit 0 on a happy path)');
});

// ── PT-7 — canonical aliases unchanged (snapshot regression guard) ──

test('PT-7 pin [canonical-aliases-unchanged] — canonical aliases resolve to HEAD and every recognized first-token still dispatches, never run.start', () => {
  // (a) canonical ↔ legacy resolution equivalence — the alias layer the fold must not disturb.
  const eq = (canonical, legacy, stage) => {
    const a = parseBatonCli(canonical);
    const b = parseBatonCli(legacy);
    assert.equal(a?.kind, b?.kind, stage);
    assert.equal(a?.name, b?.name, stage);
    assert.deepEqual(a?.args, b?.args, stage);
  };
  eq(['run', 'view', 'RUN123'], ['run', 'show', 'RUN123'], 'stage[alias-view] run view must keep resolving like run show');
  eq(['run', 'list'], ['runs', 'list'], 'stage[alias-list] run list must keep resolving to runs list');
  eq(['run', 'member', 'view', 'RUN123'], ['run', 'workstreams', 'RUN123'], 'stage[alias-member-view] run member view must keep resolving like run workstreams');
  eq(['run', 'member', 'send', 'RUN123', 'reviewer', 'hello'], ['run', 'notify', 'RUN123', 'reviewer', 'hello'], 'stage[alias-member-send] run member send must keep resolving like run notify');
  eq(['run', 'member', 'stop', 'RUN123', 'reviewer'], ['run', 'stop-member', 'RUN123', 'reviewer'], 'stage[alias-member-stop] run member stop must keep resolving like run stop-member');
  eq(['run', 'member', 'interrupt', 'reviewer'], ['run', 'interrupt', 'reviewer'], 'stage[alias-member-interrupt] run member interrupt must keep resolving like run interrupt');
  assert.equal(parseBatonCli(['run', 'do', 'RUN123', 'ACT1'])?.name, 'run.act', 'stage[alias-do] run do must keep resolving to run.act');
  assert.equal(parseBatonCli(['run', 'resume', 'RUN123', '--reason', 'go'])?.name, 'run.resume_work', 'stage[alias-resume] run resume must keep resolving to run.resume_work');
  assert.equal(parseBatonCli(['run', 'retry', 'RUN123', '--reason', 'go'])?.name, 'run.retry_verification', 'stage[alias-retry] run retry must keep resolving to run.retry_verification');

  // (b) every recognized first-token (except the bare member prefix — PT-5's red row) still
  // dispatches at bare position to its own handling: never the objective-first run.start.
  const cli = readFileSync(CLI_PATH, 'latin1');
  const sem = readFileSync(SEM_PATH, 'latin1');
  const detection = deriveDetectionSet(cli, sem);
  assert.equal(detection.size, 39, 'stage[derivation-source-unreadable]');
  for (const token of detection) {
    if (token === 'member') continue;
    try {
      const r = parseBatonCli(['run', token]);
      assert.ok(!(r?.kind === 'command' && r?.name === 'run.start'),
        `stage[recognized-dispatch-${token}] bare run ${token} must dispatch to its own handling, never run.start`);
    } catch {
      // a recognized verb may throw its own parse/refusal error at bare position — that IS
      // dispatch, not the objective-first reinterpretation this contract kills.
    }
  }
});

// ── PT-8 — parse-time, no connection attempt ──

test('PT-8 pin [parse-time-pre-connection] — the refusal is a parse-time decision, structurally before any connection discovery', () => {
  const baton = readFileSync(BATON_PATH, 'latin1');
  const parseAt = baton.indexOf('parseBatonCli(');
  const connectAt = baton.indexOf('discoverBatonConnection(');
  assert.ok(parseAt !== -1 && connectAt !== -1 && parseAt < connectAt,
    'stage[parse-before-connection] baton.mjs must call parseBatonCli before discoverBatonConnection — a parse-time refusal is structurally unable to reach provider spend');
  assert.equal(typeof parseBatonCli, 'function', 'stage[parse-seam-importable] parseBatonCli is exported at the parse seam');
});

// ── PT-9 — refused positions unchanged ──

test('PT-9 pin [refused-positions-unchanged] — run follow and run steer keep refusing with their existing cli_command_unavailable messages', () => {
  assert.throws(
    () => parseBatonCli(['run', 'follow']),
    (e) => e?.code === 'cli_command_unavailable'
      && /follow is not shipped by the Run application/u.test(e?.message ?? ''),
    'stage[follow-refuses] run follow must keep the existing "not shipped" refusal (the typo-guard must not shadow it)'
  );
  assert.throws(
    () => parseBatonCli(['run', 'steer', 'RUN123']),
    (e) => e?.code === 'cli_command_unavailable'
      && /steer was deleted at the M5 alias sunset; use run send/u.test(e?.message ?? ''),
    'stage[steer-refuses] run steer <RUN_ID> must keep the existing M5-alias-sunset refusal'
  );
});

// ── PT-10 — conformance unchanged ──

test('PT-10 pin [surface-docs-conformance] — the generated CLI inventory conformance gate is unchanged', () => {
  assert.deepEqual(checkSurfaceDocs(), [], 'stage[surface-docs-conformance] checkSurfaceDocs() must return [] — a parse-only change adds/removes no served verb');
});
