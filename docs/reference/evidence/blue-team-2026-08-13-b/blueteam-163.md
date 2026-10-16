# #163 BLUE-TEAM REPORT — quiescence-completion-red suite attack

[attempt: 2344e0b7-8929-4768-bbcf-695ec5dcb0c6 row-bt163]

- **Row:** `row-bt163` · **Target:** `impl/test/quiescence-completion-red.test.mjs` (579 lines, 15 rows)
- **Authority:** `docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md` (v2 — folded source of truth) + `fold-163.md` + `redteam-163.md` + `row-quiescence.md` + `suite-notes-163.md` (same dir). I attacked the SUITE against that intent; I did not re-review the contract.
- **Verdict scale:** SOUND / SHALLOW (named cheap wrong impl passes) / DECORATIVE (pin bites nothing) / BROKEN (red/green for wrong reason) · Final: ACCEPT / NEEDS-FOLD.
- **Scope honored:** read/ran anything, edited only this deliverable + the `shared` durable publish.

## Split — re-run twice, both match the declared notes

`node --test impl/test/quiescence-completion-red.test.mjs` from the repo root, two fresh runs at
HEAD `e371f70` (`/tmp/bt163-split1.txt`, `/tmp/bt163-split2.txt`):

| Run | tests | pass | fail | duration | row set |
|---|---|---|---|---|---|
| 1 | 15 | 3 | 12 | 54 904 ms | P1/P2/N1 green · R1–R6/N2/N3 red at their named stages |
| 2 | 15 | 3 | 12 | 48 372 ms | byte-identical row set to run 1 |
| 3 (re-run) | 15 | 3 | 12 | 62 777 ms | byte-identical row set to runs 1–2 |
| 4 (re-run) | 15 | 3 | 12 | 53 126 ms | byte-identical row set to runs 1–3 |

Split stability confirmed across two independent re-run pairs — all four runs match the declared
notes exactly (`suite-notes-163.md`: 15 tests / 3 pass / 12 fail; "R1–R6 fail at their named stage;
P1–P2 are green today"; N1 green at HEAD by design, N2/N3 red). No flakiness across any run; the
incremental re-run (rows 3–4, this session) reproduced the byte-identical row set after the report
was written, confirming every per-row verdict against the live suite.

Red rows at HEAD, with the exact stage failure (assertion messages, deduped):

- **R1** `quiescence-verdict-missing` — a quiet roster receipts `WAVE-INCOMPLETE`, not `WAVE-QUIESCED`.
- **R2** `totality-evidence-missing` — no `wave_terminalized_unrecoverable` steering line.
- **R3** `readview-projection-missing` — `readView` body lacks `lastProgress`.
- **R4a** `quiescence-floor-missing` — `QUIESCENCE_MIN_SILENT_POLLS` absent.
- **R4b** `active-turn-phases-missing` — `ACTIVE_TURN_PHASES` absent.
- **R4c** `reset-set-missing` — `'approval.resolved'` (and the other three REARM_KINDS) absent.
- **R4d** `null-sentinel-missing` — `hardCapMs === null` absent.
- **R4e** `quiescence-vocabulary-missing` — `WAVE-QUIESCED` absent.
- **R5** `hard-break-evidence-missing` — no `wave_terminalized_unrecoverable` line (`WAVE-INCOMPLETE`
  already holds at HEAD; survivor-sha + survivor-harvest assertions are green at HEAD by design).
- **R6** `production-driver-uncapped-missing` — `PRODUCTION_WORKFLOW_DRIVER` still ships
  `hardCapMs: 3 * 3_600_000`.
- **N2** `cadence-derived-window-missing` — the 400 ms wave receipts `WAVE-INCOMPLETE`.
- **N3** `post-declaration-rewake-missing` — `WAVE-INCOMPLETE`, not `WAVE-QUIESCED`.

## Law re-check (per the frame)

| Law | Finding |
|---|---|
| Named stage on every capability row | PASS — every red row's failure message carries its `stage[...]` prefix. |
| Hermetic (mkdtemp + after-cleanup, no network/provider) | PASS — `mkdtempSync` repos + log dirs, `t.after` rmSync, local `git init/commit` only, `MockAdapter` fixture, no host state. |
| No clocks as controls | PASS — the +130_000 app-clock offset is a fixture double (documented in the suite header); the only delayMs values are mock-adapter edit latencies (fixture input, not a completion control); N2's `−150`/`+300` and N3's `+50` are assertion tolerances, not controls. |
| Namespace imports for invented surfaces | PASS — named imports from `../src/*` only; no invented surface. |
| Sorted-key literals ACTUAL order | PASS — `RECEIPT_KEYS` is `['basis','harvest','manifestDigest','outcomes','steering','verdict','waveId']`, compared against `Object.keys(receipt).sort()`; the literal is in codepoint order. No `localeCompare`. |
| watchdog.stallMs 60_000 + comment | PASS — `watchdog: { stallMs: 60_000, ... }` with the inline comment. |
| No absolute line-window anchors | PASS — R3 slices `async function readView` → `const TERMINAL_PHASES`; R6 slices `const PRODUCTION_WORKFLOW_DRIVER` → first `});`; both marker-anchored. |
| Verbatim `[attempt: …]` suite header line | PASS — `// [attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-163]` at line 2. |
| Split stability | PASS — two fresh runs byte-identical in row set. |

## Per-row attacks — capability rows (cheapest wrong impl that turns the row green)

### R1 (quiescence-verdict-missing) — **SHALLOW**

Cheapest wrong impl: a **relabel-on-quiet** at the verdict seam (`workflow-interpreter.mjs:602-605`).
When the drive loop exits with `pending` non-empty and every pending member's outline reads
`progressClass === 'silent'`, map the receipt to `verdict: 'WAVE-QUIESCED'`, `basis: 'quiesced'`,
push `{ evidence: 'wave_quiesced' }`, and synthesize the three additive outcome fields
(`quiescenceLastMeaningfulAt` from `lastProgress.at`, `quiescenceSilenceMs` from `silenceMs`,
`progressClass`) from the outline. Every R1 assertion is output-shape; the row does NOT require the
cadence-derived window (D1.2), the confirmation poll (D1.3), or the D1.1 three-leg predicate. The
single parked member (phase `'paused'`, silent under the decoupled-clocks double) is a candidate on
the first quiet poll. The counterexamples that make the relabel insufficient ACROSS the suite are
R2 (a mid-turn member must veto) and N2 (the window must scale) — but R1 in isolation is cheaply
green.

### R2 (totality-evidence-missing) — **SHALLOW** (sharpest genuine gap)

Cheapest wrong impl: at the loop exit, scan `pending`; any member whose outline phase is in a
phase-gate set (`'running'`/`'working'`/…) with `progressClass === 'silent'` → push
`{ role: <that member>, evidence: 'wave_terminalized_unrecoverable' }` and return `WAVE-INCOMPLETE`.
No N-consecutive-poll totality counting is exercised. Worse — **the role is not pinned**:
`assert.ok(typeof term.role === 'string' && term.role.length > 0)` accepts ANY member, so a wrong
impl that terminalizes the QUIET member (`q-b`, phase `'paused'`) instead of the phase-stuck member
(`q-a`, phase `'running'`) passes R2 while leaving the genuinely stuck member pending. The totality
rule's attribution (A12 leg b) is the contract's central honesty law, and the suite's only
behavioral test of it permits misattribution. Fold: assert `term.role === 'q-a'` — under the
contract the phase-stuck member is the only legal terminalization target (the quiet member is a
quiescence candidate, never terminalized).

### R3 (readview-projection-missing) — **SHALLOW**

Static region pin (`readViewBody.includes(field)` for the three identifiers, sliced to the readView
body). Cheapest wrong impl: `return { ..., lastProgress: null, silenceMs: null, progressClass: null }`
(dead fields) or even a comment listing the three inside the body. The projection need not be wired
to `io`, so a landing that drops the fields at the same seam it "adds" them passes. Fold: assert the
fields are sourced from the outline — the B3 projection form the contract names
(`lastProgress: io.lastProgress ?? null`, `silenceMs: io.silenceMs ?? null`,
`progressClass: io.progressClass ?? null`).

### R4a (quiescence-floor-missing) — **SHALLOW**

Whole-file `includes` ×2. Cheapest wrong impl: two dead module-scope constants
(`const QUIESCENCE_MIN_SILENT_POLLS = 8; const maxObservedGapMs = 0;`), unused by any predicate, or a
comment. The cadence-derivation law (never a bare constant) is only behaviorally forced by N2, not by
R4a.

### R4b (active-turn-phases-missing) — **SHALLOW**

Whole-file `includes`. Cheapest wrong impl: a dead `const ACTIVE_TURN_PHASES = new Set(['working'])`
(or comment) that gates nothing. The derived-complement derivation (fold judgment call 1) is not
pinned; a landing can hardcode `phase === 'running'` for R2 and carry a dead set for R4b.

### R4c (reset-set-missing) — **SHALLOW**

Whole-file `includes` ×4. Cheapest wrong impl: a comment (or dead array) listing the four
`REARM_KINDS` literals anywhere in the interpreter. The reset set need not be the union, need not
gate the predicate. Fold: region-scope to the actual reset-set construction.

### R4d (null-sentinel-missing) — **SHALLOW**

Whole-file `includes('hardCapMs === null')`. Cheapest wrong impl: a no-op branch
(`if (driver.hardCapMs === null) { /* uncapped */ }`) or a comment; the loop condition can still
mis-evaluate `number < null` → immediate exit (which would break the behavioral rows, but the PIN
itself is satisfied). Fold: region-scope to `normalizeDriver`'s null branch AND the loop condition —
both must carry the sentinel.

### R4e (quiescence-vocabulary-missing) — **SHALLOW**

Whole-file `includes` of `WAVE-QUIESCED`, `wave_quiesced`, `wave_terminalized_unrecoverable`, and the
five exit-enum strings. Cheapest wrong impl: dead constants/comments satisfying each literal. R1/R5
force the verdict + evidence lines to be LIVE, but the closed-exit-enum completeness (D1.5) is not
pinned — any literal satisfies it.

### R5 (hard-break-evidence-missing) — **SHALLOW**

`WAVE-INCOMPLETE` already holds at HEAD (a `failed` member → `everyHarvested` false), and the
survivor-sha + survivor-harvest assertions are green at HEAD by design (`suite-notes-163.md`). The
only RED assertion is the evidence line with `role === 'q-a'`. Cheapest wrong impl: push the line at
the loop exit when any member is in an unrecoverable terminal — no hard-break at the failed member's
poll needed. The **DR-1(a) hard-break TIMING is unpinned**: `q-a` fails at spawn and `q-b` (no
`delayMs`) settles before the first 15 ms poll, so continue-to-completion and hard-break produce
byte-identical receipts. Fold: delay the survivor's edit beyond the failed member's detection so a
continue-impl fails the survivor-harvest assertion — then the hard-break law is behaviorally pinned.

### R6 (production-driver-uncapped-missing) — **SHALLOW**

Region pin on the `PRODUCTION_WORKFLOW_DRIVER` literal. Cheapest wrong impl: change the literal to
`hardCapMs: null` (which IS the D2.1 edit) while leaving another clock alive in the shipped path
(e.g., `DEFAULT_DRIVER` at 3000, or the loop mis-evaluating the sentinel). The pin checks the value
only; the de-clocking's integrity is forced by R4d (weak) and the behavioral rows (R1/R2/N2 need the
loop to actually drive uncapped).

## Extended rows

### N1 (null-gating) — **SOUND**

Bites the wrong impl that runs the quiescence predicate regardless of the sentinel: the same quiet
parked fixture under `LANE_DRIVER` (`hardCapMs: 3000`) would declare `WAVE-QUIESCED` at the 120 ms
floor → `verdict !== 'WAVE-QUIESCED'` and the no-`wave_quiesced`-line assertions fail. Composed with
N2 (quiescence must fire fast under `hardCapMs: null`), the only impl satisfying both is the
null-gate. Genuinely discriminating.

### N2 (cadence-derived-window) — **SOUND** (with a minor precision note)

A bare-constant window cannot pass both scenarios: any fixed `W` yields `s400 = s800 = W`, but the
assertions demand `s400 ≥ 650`, `s800 ≥ 1450`, and `s800 > s400 + 300` — no single `W` satisfies the
last two. The `−150` tolerance and the `+300` ordering force the declared `quiescenceSilenceMs` to
scale with the observed cadence. **Precision note (non-blocking):** the exact 2× multiplier is not
pinned — a 2.5× or 3× window passes (e.g. `s400 = 1000`, `s800 = 2000`, `2000 > 1300` ✓), so an
over-waiting landing (a liveness regression) is not caught. The contract's A2 law is "≥ 2×", so this
is a tightness gap, not a false-confidence gap.

### N3 (post-declaration re-wake) — **SHALLOW** (re-wake leg weakly biting)

The primary assertions (`WAVE-QUIESCED` + `quiescenceLastMeaningfulAt`) are R1-redundant. The
distinctive re-wake scan only bites a **declare-too-early** impl — one that declares quiescence
before the parked member's initial `turn_started`/`file_edit` land, so those events fall after the
snapshot `+ 50 ms` and the scan fires. It does NOT exercise the A9/G8 law the row claims to pin: a
wrong impl that declares quiescence but fails to stop members passes N3, because the parked member
emits nothing post-park. The "no post-declaration re-wake" law is unpinned. Fold: either drive a
deterministic second work event after a premature declaration, or mark the leg as a preservation-scan
with an inline comment so a reader does not over-read it.

## PIN-row bite tests

### P1 (lane-driver-preserved) — **SOUND**

Bites an impl that changes the suite lane policy (the `deepEqual` self-check), breaks the happy path
under the fast 3000 ms backstop, or adds/drops/reorders a receipt key (the 7-key `deepEqual` on the
settling wave). Composes with N1 (settling fixture vs quiet fixture) — P1 alone would not catch a
false quiescence under the lane (the settling members exit via `pending.size === 0` before any
quiescence window), which is why N1 exists. Both are sound and complementary.

### P2 (stuck-decision-preserved) — **SOUND**

Bites two wrong impls. (1) The **pure-silence relabel** from R1: `p2-a` completes an edit then waits
on a deferred decision → `blocked_interaction:*`, so a naive `silenceMs >= windowMs` predicate would
declare it quiesced → `verdict !== 'WAVE-QUIESCED'` fails. The contract's progressClass gate is the
only clean way to pass. (2) An impl that **drops the deferred-decision steering entry** (the D3.3
exit) or misreports the stuck exit. Note: the "quiescence-preempts-stuck-break" ordering claim is only
weakly discriminated — `p2-a` is blocked, not quiescent-eligible, so a quiescence-first ordering
yields the same receipt.

## Final verdict — NEEDS-FOLD with the named rows

The **core composition is sound**: R1+R2+N2+N1+P1+P2 force a real implementation — a wrong impl must
land the quiescence declaration, a cadence-derived (scaling) window, an active-turn phase gate that
treats the real outline vocabulary (`'running'`) as active, the null-gate, the fast-policy and
stuck-break preservation, and the D6 receipt shape. No cheap wrong impl greens that combination.

The suite is not ACCEPT as-is because four rows are cheaply satisfiable while leaving the named law
unimplemented, and one of those (R2) is a genuine hole in a central honesty pin:

1. **R2 — pin the terminalized role (`term.role === 'q-a'`).** As written, a wrong impl may
   terminalize the quiet member and still pass; the totality-rule attribution (A12 leg b) is
   unpinned. One-line fold, real improvement.
2. **R3 — assert the B3 projection form (`io.lastProgress ?? null` etc.),** not mere identifier
   presence, so dead fields/comments fail.
3. **R4c / R4d — region-scope to the reset-set and to `normalizeDriver` + the loop condition,**
   so a comment/no-op branch anywhere in the file no longer satisfies them.
4. **N3 — either drive a real post-declaration work event or mark the re-wake leg as a
   preservation-scan;** the A9/G8 re-wake law is currently unpinned.
5. **Class note (lower priority):** R4a/R4b/R4e/R6 remain existence/value anchors that dead
   identifiers satisfy; the behavioral rows compensate, so region-scoping there is hardening, not
   fixing.

Two acknowledged-unhermetic seams remain regardless of folds: the D1.3 two-poll confirmation race
and the totality rule's N-count are not behaviorally drivable in a hermetic fixture (judgment calls
7/8 in `suite-notes-163.md`) — the suite's coverage split (N2 + R4a for the confirmation; R2 + R4e
for totality) is reasonable, but the R2 role pin above must land for the totality representation to
be honest.

## Shared-publish record (live surface refused — durable fallback published)

Per the frame ("Publish your report to the `shared` scratchpad as well as your file; a failed
publish is evidence — record the refusal"), the agent-facing scratchpad WRITE verb does not exist at
HEAD `e371f70`, exactly as recorded for wave-a and in the contract's OQ1:

- Probed the facade dispatch: only `run.scratchpad.read` / `run.scratchpad.elevate`
  (`application.mjs:12522-12523`); no `run.scratchpad.append` branch exists anywhere in `impl/src/`
  (`grep` for `scratchpad.append`/`scratchpad_append` returns nothing).
- No scratchpad-append tool is advertised to this row's toolset.

The live `shared` publish therefore FAILED; this refusal is recorded as the evidence. Durable
fallback (the coordinator brief's documented channel — "fall back to the durable files … only where
the shared post is absent — note which"): the full report text is published to
`docs/reference/evidence/blue-team-2026-08-13-b/shared/blueteam-163.md` (title `#163`) inside this
row's write scope.
