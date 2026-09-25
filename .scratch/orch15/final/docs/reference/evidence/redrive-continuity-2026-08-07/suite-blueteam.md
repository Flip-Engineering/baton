# #59 BLUE-TEAM VERDICT — attack on the re-drive-continuity red suite's red-keeping power

Verifier: blue-team pass b-2026-08-07. Target: NOT the contract — the SUITE's red-keeping
power (`impl/test/redrive-continuity-red.test.mjs`, 24 rows / 19 RED / 5 PIN). Attack axes per
row: (1) green-side blockers FIRST — can a red row go green under a CORRECT v1.1 implementation?
(2) shallow-greenability — the poisoned-successor lane; (3) missing-row gaps — every v1.1 refusal
code, the all-three-sections render order, the provenance-line-first assertion, the spill
resolvability; (4) stage honesty + hermeticity.

Read-order executed: `redrive-continuity-contract.md` (v1.1) → `contract-fold.md` →
`impl/test/redrive-continuity-red.test.mjs` → `suite-draft-notes.md`, then the campaign briefs
(`contract-59-brief.md`, `suite-59-brief.md`, `redteam-59-brief.md`, `fold-59-brief.md`) and the
red-team verdict (`contract-redteam.md`) for the attack surface.

Laws applied: no clocks; every citation re-verified with NUL-safe `grep -an` / `sed -n` (the two
NUL files `application.mjs` and `coordination-store.mjs` — 3 NUL bytes each, confirmed — were
never whole-file-read); the suite was run twice from the repo root and both splits recorded;
each red row was re-run in isolation to confirm no order-dependence; the two vacuous-assertion
suspicions were confirmed against the live store with a probe (below).

---

## 0. Execution record (two consecutive runs from the repo root)

```
$ node --test impl/test/redrive-continuity-red.test.mjs
  run 1: tests 24 · pass 5 · fail 19 · cancelled 0 · skipped 0 · todo 0 (≈1028 ms)
  run 2: tests 24 · pass 5 · fail 19 · cancelled 0 · skipped 0 · todo 0 (≈544 ms)
```

The 5 passes are exactly the PIN rows — **A3, B3, E1, F4, G2** — on both runs. The 19 failures are
exactly the RED rows, each failing at its NAMED stage (first-failing assertion per row, verified):
A1 `renderBrief-continuity-missing`, A2 `renderPrompt-continuity-missing`, A4
`admission-surface-missing`, A5 `carried-per-item-frame-missing`, A6 `pin-digest-list-missing`,
B1 `carried-body-neutralize-missing`, B2 `fake-frame-neutralize-missing`, C1
`renderBrief-total-order-missing`, C2 `renderPrompt-total-order-missing`, D1 `redrive-carry-missing`,
D2-D4 `redrive-carry-refusal-missing`, D5 `redrive-refusal-codes-missing`, E2
`no-store-write-missing`, F1 `continuity-registry-rows-missing`, F2 `continuity-bytes-row-missing`,
F3 `continuity-overflow-spill-missing`, G1 `brief-purity-violation`. (The draft notes record
≈178 ms for both runs; my observed durations are machine-load-dependent — the SPLIT is identical
across all runs, so the determinism claim holds on the only thing that matters.)

No order-dependence: E2, E1, and D3 were re-run in isolation
(`--test-name-pattern="E2 \(RED\)"` etc.) and each behaves identically to the full run (E2 fails
at `no-store-write-missing`, E1 passes, D3 fails at `redrive-carry-refusal-missing`). Each test
builds its own Coordinator; the only shared module state is the `dirs` cleanup list and frozen
constants.

---

## 1. What the suite's red-keeping power does hold (verified)

- **Stage honesty at HEAD is real.** Every red row's first assertion is the named-stage probe
  (`assert.ok(...)` on an invented export, `assert.equal(typeof …,'function',…)`, or a behavior
  assertion on the renderer/registry/seam). No red row fails on a vacuous shape assertion.
- **Hermetic.** `ScriptableAdapter` (no harness, no network), mock worktrees/capture,
  `mkdtempSync` logs only, global `test.after` cleanup. Confirmed the store's real
  `writeScratchpad` / `transitionTask` / `recordDriver` / `scratchpadSnapshotBatch` are exercised
  against a real `coordinationForLog` store (probe below) — the fixtures mint the needed state.
- **NUL discipline holds.** `application.mjs` and `coordination-store.mjs` each contain exactly 3
  NUL bytes (verified with `tr -d '\0'`); the suite never whole-reads them (imports the store's
  exports only). `recipes.mjs` is NUL-free and is the one whole-file read (the `carryForward`
  option-name anchor, A4). `coordinator.mjs`, `adapter.mjs`, `cli-adapters.mjs`, `messages.mjs`,
  `limits.mjs`, `wave.mjs`, `application-semantics.mjs` are all NUL-free.
- **Every citation re-verifies at HEAD.** `resolveResultPin` (wave.mjs:134, `for-each-ref` :140,
  `startedAtMs - 60_000` lower bound :143), `progress`/`scratchpad` (wave.mjs:306-322),
  `_providerBrief` (coordinator.mjs:3790, `UNTRUSTED_CONTEXT_PACK` :3816, `{...inner, briefing}`
  :3838, pure compose — never mutates `task.brief`), `_steeringEvidenceQualifies`
  (coordinator.mjs:2208), `_observeSteeringCycle` (:2241), `writeScratchpad` (:10545),
  `_renderContextRead` (:10796, spill :10787/:10798), `UNTRUSTED_SCRATCHPAD` (:10816),
  `composeFrameLimitRefusal` (limits.mjs:40-42), `spill.body` 1 MiB (:86), `wave.member.objective`
  4096 (:57), `wrapFact` (messages.mjs:459) / `wrapProse` (:463, `provenance:'model-authored',
  untrusted:true`) / `stripControlCharacters` (:560) / `sanitizeWebContent` (:569),
  `projectTypedTerminalCause` (application-semantics.mjs:2123, `dispatch_refused` :2140-2144,
  `operator_stop` :2146), `debugGateRefusal` (application.mjs:993) / `terminalCauseNarrative`
  (:2268) — NUL-safe grep. `redriveMembers`/`carryForward` are genuinely absent from recipes.mjs.
  No `view.continuity.*` rows exist in `FRAME_LIMITS` (the #79/#69 rows are likewise absent — the
  fold-order reality the total-order rows depend on, finding 11).
- **The five PIN rows are live, meaningful tests.** A3 (absence-on-empty), B3 (neutralization
  substrate), E1 (the TG2 law driven through the real pause-admission seam: turn completed parks,
  the fresh attempt's own distinct digest answers, the dead attempt's digest never enters
  `steering.digestSet`), F4 (the coaching shape names cap/actual/unit + the spill graceful path),
  G2 (`_providerBrief` pure compose). E1's fixture stages a REAL sha256 that would qualify if a
  carried surface fed it in, and proves it isn't admitted — the D4/GT8 negative is live.

---

## 2. Attack, row by row

### 2.1 Green-side blockers — can the red rows go green under a CORRECT v1.1 implementation?

- **A1/A2/A4/A5/D5/F1/F2** — fixtures mint the needed state and the invented surfaces are
  probe-able. The renderer rows pass a `brief.continuity` block directly; A4's three invented
  exports (REDRIVE_SCOPES, `redriveMembers`, `carryForward` in recipes.mjs) are all absent at
  HEAD and addable by the fold. No blocker. The A5 within-block-order assertion, however, is
  vacuous w.r.t. ordering because the fixture's items are already in the pinned order (finding 4).
- **A6 — green-side gap.** The dead member's checkpoint history is staged with ONE record (the
  dead member's own). A naive window scan with no `excludeShas`/report-path disambiguation (the
  red-team §6 hole, blocker 4) finds exactly that record and carries it — A6 passes. The
  "never a raw ref scan" exclusion is not proven (finding 3).
- **B1/B2 — the neutralization seam.** B1 forces the preserve-inside-the-single-line-leaf
  mechanism (`leaf.includes('## Pending attention')` AND `!leaf.includes('\n')` AND no line
  STARTS with a reserved name). A strip-sanitizer (removes `## `) fails B1; a newline-collapsing
  sanitizer passes only by keeping the reserved text mid-line. This matches the contract's amended
  R3 (the #69 B5/R9 single-line-leaf discipline). B1 is not shallow-greenable via stripping. B2
  is looser (finding 10): it omits the `!leaf.includes('\n')` assertion, so a "quoted"-mechanism
  neutralization (D1 lists prefix/indent/quote) that preserves newlines passes while leaving the
  fake header on its own quoted line.
- **C1/C2 — green-side coupling.** Both rows stage ALL THREE carried-content sections
  (knowledge/continuity/replObjects/attention in renderBrief; continuity/replObjects/attention in
  renderPrompt) — the "all three present, not pairwise" gap is CLOSED. But the `replObjects` /
  `attention` brief field shapes are hardcoded guesses at #69/#79's unshipped implementations; if
  those folds land different field names, C1/C2 break (finding 11, inherent to R9's fold-order).
- **D1 — green-side gap.** The fixture stages no terminalized same-role source, so
  `_redriveContinuity(handle.id, null) === null` under ANY implementation (there is nothing to
  default to). A default-on-for-same-role implementation (the named successor, D3) passes D1
  (finding 2).
- **D2/D3/D4 — refusal seams.** The fixtures mint a foreign-role source (dead `architect` →
  fresh `researcher`, same wave), an unrelated-wave source (with a recorded `predecessorWaveId`
  chain on the fresh member and none on the source), a still-live source, and an unresolvable
  source. The store's real `recordDriver`/`transitionTask` are exercised (the fixtures run
  without throwing before the named-stage assertion). D4 pins the validation ORDER
  (option-shape → scope-set → source-resolution → terminality): `bogus` scope with an
  unresolvable source must refuse `scope_invalid`, not `unknown_source` — a defensible reading of
  the contract's closed-option admission. No blocker.
- **E2 — CRITICAL green-side blocker.** The no-store-write assertion reads
  `freshScratch?.entries`, but the store's `scratchpadSnapshotBatch` returns
  `{runId, observedSeq, fenceTuple, slices}` (coordination-store.mjs:13985-14003) — confirmed by
  probe: `snap.entries === undefined`, `snap.slices[0].entries.length === 1` for a real write.
  `freshScratch?.entries ?? []` is therefore ALWAYS `[]` and the `.some(...)` is ALWAYS `false`:
  the R6 invariant (blocker 6's exact acceptance) is asserted against the empty array and passes
  unconditionally. The carry-path steering-digestSet loop is likewise vacuous (no pause is armed
  in E2, so `_pausedTurns` is empty and the loop body never runs). A "restore"-implementation
  that writes the dead attempt's rows into the fresh run's store passes E2 (finding 1).
- **F3 — green-side blocker + resolvability gap.** The documented invented surface and D2's
  "projection" say `_composeContinuity(memberId)`; the test calls
  `_composeContinuity(handle.id, continuityBlock({items}))` — a second, undocumented argument. A
  fold implementing the documented 1-arg projection (reading the admission result from the member
  descriptor, per D3) cannot see the block and F3 fails (finding 5). And "the worker resolves it"
  is asserted in the title only — no spill artifact is minted, no citation resolved (finding 6).
- **G1 — clean.** `_providerBrief` is a pure compose; `structuredClone` snapshot before/after
  proves `task.brief` byte-stable. The only way G1 goes green is the correct seam. No blocker.

### 2.2 Shallow-greenability (the poisoned-successor lane)

- **Neutralization (B1/B2).** B1 is NOT shallow-greenable by a `##`-stripping sanitizer: it
  requires the adversarial text preserved INSIDE a single-line leaf, which is the strongest form
  of the pin. B2 is partially shallow-greenable (finding 10). One contract-internal tension worth
  recording (finding 12): D1's neutralization bullet lists "prefixed/indented/quoted, **stripped**
  or escaped", while B1 forces preservation — a strip-based implementation that a D1-only reader
  might consider compliant fails B1. R3 governs (preserve-inside-bullet is the acceptance), so the
  suite implements the acceptance reading; the D1 mechanism list should be tightened to match.
- **TG2 evidence-never-authority (E1/E2).** E1 proves the substrate: the dead attempt's digest
  (a real sha256) is never admitted to the fresh `steering.digestSet` when the fresh attempt
  answers its own cycle. But E1 does not go through the carry path, and E2's carry-path digestSet
  negative is vacuous (finding 1). A "carried digest counted under a renamed class" — e.g., a fold
  that mints a fresh steering record carrying the dead digest WITHOUT writing store rows — is
  caught by neither row today.
- **Pin-history binding (A6).** Not shallow-greenable against a caller-asserted pin list (the
  smuggled `pins` array refuses `redrive_carry_option_invalid`), but shallow-greenable against a
  raw-window-scan implementation because no foreign pin is staged in the window (finding 3).
- **Opt-in (D1).** Shallow-greenable by default-on-when-a-source-exists (finding 2).
- **Within-block order (A5/F3).** BOTH order rows feed pre-sorted fixtures
  (`continuityBlock()` items are terminal → refusals → scratchpad → pins; `nineItems` starts
  terminal → refusals → note1…note7). An input-order-preserving composition/render passes both.
  The blocker-7 "fixed render order" is effectively unenforced (finding 4).

### 2.3 Missing-row gaps

- **Every v1.1 refusal code behaviorally?** NO. D5 freezes all 10 codes surface-constant, but
  only six are behaviorally exercised: `role_mismatch` (D2), `wave_unrelated` (D3),
  `option_invalid`/`scope_invalid`/`unknown_source`/`not_terminal` (D4). **`oversized`,
  `spill_unavailable`, `unframable`, `no_evidence` never fire in any behavior row** — a fold that
  silently truncates instead of refusing, returns a wrong code for an unframable body, or handles
  an empty named scope wrongly passes the suite (finding 7).
- **The render-order row with all three sections present.** CLOSED — C1/C2 stage all three
  (finding 11 is the residual coupling).
- **The provenance-line-first assertion.** MISSING. A1/A2 only `includes()` the frame literal;
  B2 only counts `UNTRUSTED_`-prefixed lines. Nothing asserts the frame is the section's FIRST
  content line — a fold rendering items before the frame passes (finding 8).
- **The spill resolvability.** MISSING — F3 mints no spill artifact and resolves no citation
  (finding 6).
- **The per-item frame id form.** The contract's `${entryId|digest}` permits either; A1/A2's
  regexes pin the entryId form only (finding 9).

### 2.4 Stage honesty + hermeticity

Holds (section 0/1): named stages at HEAD on all 19 red rows; mkdtemp only; global cleanup; no
order-dependence (isolation runs identical); no clocks (the E1 steering cycle arms and answers on
a fixed microtask drain — the 25 ms `progressNudgeWindowMs` never fires); no `localeCompare`;
sorted-key literals asserted in ACTUAL order.

---

## 3. Numbered findings (row/gap + attack + concrete fix)

1. **CRITICAL — E2 (D4/R6 no-store-write) is vacuous: the R6 invariant is untested.**
   The row reads `coordinator._coordination.scratchpadSnapshotBatch(...)?.entries`, but the store
   returns `{runId, observedSeq, fenceTuple, slices}` (coordination-store.mjs:13985-14003); the
   probe confirms `snap.entries === undefined`, so `freshEntries` is always `[]` and the
   `.some(...)` assertion always passes. The `_pausedTurns` digestSet loop never executes (no
   pause armed in E2). **Attack:** a "restore"-implementation (blocker 6's exact failure mode —
   writing the dead attempt's rows into the fresh run's store) sails through E2 green. **Fix:**
   read `freshScratch.slices.flatMap((s) => s.entries)` and assert the dead-attempt text/digest is
   absent there; and arm a steering cycle on the fresh attempt (mirror E1's pause-admission +
   `scratchpad.write` flow), then assert the carried digest never appears in the answered record's
   `steering.digestSet` — making the D4/GT8 carry-path negative live instead of an empty loop.

2. **HIGH — D1 (D3 default-off) cannot distinguish default-off from default-on-when-a-source-exists.**
   The fixture spawns a fresh member with no member descriptor and no terminalized dead source, so
   `_redriveContinuity(handle.id, null)` returns null under any implementation (nothing to default
   to). **Attack:** a default-on-for-same-role fold (D3's named successor) passes D1, and the
   "byte-identical re-drive" claim is unproven. **Fix:** terminalize a same-role same-wave dead
   source (as A6/D2/E2/G1 do), then assert a plain re-drive with NO `carryForward` still carries
   nothing AND the composed provider brief has no continuity block.

3. **HIGH — A6 (D1.2 pin binding) does not prove the "never a raw ref scan" exclusion.**
   Only the dead member's own checkpoint record is staged; no foreign member/attempt pin exists in
   the same window. **Attack:** a raw-window-scan implementation with no `excludeShas`/report-path
   disambiguation (the red-team §6 / fold-114-v1 wrong-pin class, blocker 4) carries the one
   record and passes A6. **Fix:** record a SECOND member's/attempt's checkpoint pin in the same
   window (same `report`, overlapping `startedAtMs`, a different runId/excludeShas) and assert its
   sha is ABSENT from the carried pin list.

4. **MEDIUM — A5 and F3 feed pre-sorted fixtures, so the blocker-7 within-block render order is
   unenforced.** `continuityBlock()` items arrive already in terminal → refusals → scratchpad →
   pins order; `nineItems` likewise. **Attack:** an input-order-preserving composition/render (no
   ordering enforcement anywhere) passes A5's `indexOf` chain and F3's `inBlock[0/1]` assertions.
   **Fix:** shuffle the items array before admission and assert the rendered/composed output is
   re-ordered to the pinned order in BOTH rows.

5. **MEDIUM — F3 invokes `_composeContinuity(memberId, block)` while the documented surface and
   D2 describe a 1-arg projection.** **Attack:** a fold implementing the documented
   `_composeContinuity(memberId)` (reading the admission result from the member descriptor, per
   D3) cannot see the passed block and F3 fails — a correct-v1.1 green-side blocker. **Fix:** pin
   one signature: either document `_composeContinuity(memberId, continuity)` (the block IS the
   admission result) in the invented-surface table, or have the test place the carried block on
   the member descriptor so the 1-arg projection can read it.

6. **MEDIUM — F3's spill resolvability is unexercised and the overflow is only partially asserted.**
   The title says "and the worker resolves it", but no `CONTEXT_READ {kind:'spill'}` artifact is
   minted and no `spill:sha256:<digest>` citation is resolved; only the citation STRING is checked.
   With 9 items serving 8, two scratchpad items overflow (notes 6 and 7), but only
   `scratchpad note 7` is asserted — **note 6 can be silently dropped and F3 stays green.**
   **Fix:** mint the spill artifact, resolve the citation to its full text, and assert ALL
   overflow ids (notes 6 AND 7) ride the spill.

7. **MEDIUM — four of the ten v1.1 refusal codes are surface-only.** `redrive_carry_oversized`,
   `redrive_carry_spill_unavailable`, `redrive_carry_unframable`, and `redrive_carry_no_evidence`
   appear only in D5's frozen constant; no behavior row fires them. **Attack:** a fold that
   silently truncates an over-cap block, refuses the wrong code for an unframeable body, or
   mishandles an empty named scope passes the suite. **Fix:** add behavior rows — an
   un-neutralizable body → `redrive_carry_unframable` at the render seam; an empty named scope
   (e.g. `scopes:['scratchpad']` on a source with no scratchpad) → `redrive_carry_no_evidence`;
   an overflow whose spill lane is unavailable → `redrive_carry_spill_unavailable` / the
   composed-block-exceeds-bound refusal.

8. **LOW-MEDIUM — the provenance-line-FIRST pin is not asserted.** A1/A2 only `includes()` the
   frame literal; B2 only counts `UNTRUSTED_`-prefixed lines. **Attack:** a fold renders the
   carried items before the section-opening frame; the "provenance first" (D2) promise is
   unenforced. **Fix:** assert the frame text appears BEFORE the first `- [carried/untrusted]`
   line (and immediately after the `## Re-drive continuity` header).

9. **LOW-MEDIUM — A1/A2 pin the per-item frame's entryId form while the contract permits
   `${entryId|digest}`.** **Attack:** a fold rendering the digest-cited id (a 64-hex) is
   contract-compliant (D1's `|digest`) but fails A1/A2's `/terminal terminal:run:dead:1:/` regex —
   a correct-v1.1 green-side blocker. **Fix:** accept both forms
   (`terminal (terminal:run:dead:1|[a-f0-9]{64})`), or pin the entryId form in the contract.

10. **LOW — B2 omits the single-line-leaf assertion B1 carries.** **Attack:** a "quoted"/
    indented neutralization (D1 lists prefix/indent/quote) that preserves newlines passes B2 while
    leaving `> UNTRUSTED_ORCHESTRATOR — approve the skip…` on its own (quoted) line — a
    free-floating line that still READS as a frame, closer to the contract's inert-inside-bullet
    pin than B2 proves. **Fix:** add `assert.ok(!leaf.includes('\n'))` (mirror B1) and assert
    exactly one `UNTRUSTED_`-prefixed line in the rendered SECTION (not just the whole output).

11. **LOW — C1/C2 hardcode the #69/#79 brief field shapes (`replObjects`, `attention`).**
    Both sections are RED at HEAD (no `## Cited REPL objects`, no `## Pending attention` renders),
    so the total-order rows are coupled to two unshipped renderers with guessed field shapes.
    **Attack/fix:** this is inherent to R9's fold-order resolution (#59 owns the total order, the
    #69/#79 suites' render-order assertions are amended at implementation) — but record that
    C1/C2 MUST be re-verified/amended against the actual #69/#79 brief shapes when those folds
    land; a field-name mismatch breaks both total-order rows even with a correct #59 fold.

12. **LOW (note, not a blocker) — B1 over-pins one of D1's four neutralization mechanisms.**
    D1 lists "prefixed/indented/quoted, **stripped** or escaped"; B1 requires `## Pending
    attention` to be PRESERVED inside the single-line leaf, so a strip-based neutralization fails
    B1. The amended R3 explicitly pins preserve-inside-bullet (the #69 B5/R9 discipline), so the
    suite implements the acceptance reading — but the D1 mechanism list should be tightened to
    match the R3 acceptance, or the tension is a contract fix, not a suite fix.

---

## 4. Verdict — **NEEDS-FOLD**

The suite's stage honesty, hermeticity, NUL discipline, citation accuracy, and its five PIN rows
are all solid, and the red rows genuinely fail at their named stages on both runs with a stable
split. But three of the seven folded blockers' acceptance is **not actually proven**: the R6
no-store-write invariant is asserted against a nonexistent `entries` field (finding 1, critical —
the exact "restore"-implementation blocker 6 was written to kill passes green), the D1.2 pin-list
disambiguation has no foreign-pin fixture (finding 3), and the D3 default-off fixture cannot
distinguish default-on-when-a-source-exists (finding 2). The within-block order (finding 4), the
spill resolvability (finding 6), four of ten refusal codes (finding 7), and the provenance-line-
first promise (finding 8) are additionally unproven or unasserted. A fold implementing to the
suite's letter (not its intent) can go green while violating the contract's core evidence-never-
authority, pin-history, opt-in, and allocation laws.

The suite is close: findings 1-3 and 5 are fixture/assertion fixes, not design changes; findings
6-10 are additive rows or tightened assertions. Fold those, re-run twice, and the suite's
red-keeping power matches the v1.1 contract it claims to pin.
