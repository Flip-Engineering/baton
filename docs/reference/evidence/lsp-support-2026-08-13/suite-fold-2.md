# #144 suite-fold-2 — blue-team NEEDS-FOLD folded into the LSP-pool red-first suite

Authority: `suite-blueteam.md` (NEEDS-FOLD — green-side blockers F1–F3 + F12; shallow-greenability
F8–F10; F7 pin-breaks-on-landing; F11 hermeticity; F4–F6 the stale-split/line-anchor class) via
`suite-fold-2-brief.md`. Suite: `impl/test/issue144-lsp-pool-red.test.mjs` — folded **in place**,
staying **23 rows (10 PIN / 13 RED)**. The fold adds no rows; it re-drives R3 on three greenable
legs (F1–F3), re-anchors two PINs (F5/F6), re-scopes one PIN (F7), tightens three RED rows
(F8/F9/F10), re-settles the handshake (F11), narrows R1 (F12), and re-records the split (F4).
Contract: `contract-fold.md` v1.1 → **v1.2** (two citation corrections only, F5/F6 — no contract
movement; see the v1.2 note there).

## The twelve findings → resolution

| Finding | Severity | Folded seam | Row(s) | RED/PIN at HEAD | What the fold pins |
|---|---|---|---|---|---|
| **F1** R3 lifecycle leg demands a synchronous `process_ready` no real async handshake can provide | GREEN-SIDE BLOCKER | new **`pool.ready(language)`** invented seam (bounded, event/count-derived wait; rejects `lsp_startup_failed`) | **R3** (lifecycle leg) | RED at `stage #144: R3: the LSP server lifecycle + clock-free wedged trigger is not landed (D1.3)` | `acquire` stays non-blocking (returns a starting handle); the lifecycle leg `await`s `pool.ready('typescript')` BEFORE reading `lastLifecycleEvents()`, then asserts `process_started` precedes `process_ready`. A real async handshake can now place `process_ready` in the array — no same-tick assumption. |
| **F2** the `'hung'` stub never becomes ready, so the B2 wedged trigger can never fire past readiness | GREEN-SIDE BLOCKER | new stub mode **`'ready-then-hung'`** (answers initialize/initialized → ready, then drains stdin silently on `textDocument/*`) | **R3** (wedged leg) | RED at the same named stage | the wedged leg awaits readiness, fires `ceiling` concurrent `code.hover` requests against a READY-but-silent server (outstanding genuinely climbs), asserts the next demand refuses `lsp_server_unavailable` with reason `wedged`, then that the regeneration `acquire` returns a new-generation handle. A never-ready stub could only drive `starting`; only a wedged-but-alive server drives `wedged`. |
| **F3** the always-crash stub makes a correct implementation's retry also fail `lsp_startup_failed` — slot-clear unobservable | GREEN-SIDE BLOCKER | new stub mode **`'crash-once-then-answer'`** (first spawned process exits 72; a fresh generation answers the envelope; marker-file `crashed-once.marker` makes the crash once) | **R3** (crash leg) | RED at the same named stage | first `ready` rejects `lsp_startup_failed`; the retry `acquire` returns a fresh handle; the second `ready` RESOLVES (the fresh generation answers) and `lastLifecycleEvents()` shows a NEW `process_started` — the single-flight slot cleared BEFORE the refusal and a fresh attempt began. `doesNotThrow`-vacuous removed. |
| **F4** the documented "10 pass / 13 fail" split does not reproduce at the review HEAD (observed 8/15; GP-A + GP-F red) | STAGE HONESTY / REPRODUCIBILITY | re-anchor GP-A/GP-F (F5/F6) + re-run/re-record | **all** | n/a | the split is re-verified at the fold HEAD as **10 pass / 13 fail** across two consecutive runs (below) — the record now tells the truth about the tree it runs on, and the two drifted PINs are grep-anchored so a +N line drift cannot silently re-red them. |
| **F5** GP-A asserts the `debugGateFromLiveCode` if-chain order, NEVER the `DEBUG_GATE_CODES` set literal it claims to pin | CONTENT-WRONG PIN | `grepFirstLineNum` anchor on `const DEBUG_GATE_CODES = Object.freeze` + `sedSrc(setStart, setStart+2)`; ACTUAL set order | **GP-A** | PIN re-anchored GREEN | the pin now guards the SET literal (`application.mjs:952-954` at HEAD): order `scope → red_green → coverage → route_mismatch → forbidden_effect → unknown` (`forbidden_effect` FIFTH), closed-set membership, and the no-LSP-gate-code loop preserved. Contract §6/GT5 "✅ exact" claim corrected in **v1.2**. |
| **F6** the credential-shaped redaction line drifted out of GP-F's fixed `334-341` window on the #153 +7 shift | ANCHOR DRIFT | `grepFirstLineNum` anchor on `function boundedAttentionText` + direct grep of the redaction literal | **GP-F** | PIN re-anchored GREEN | the signature is located by grep (drift-proof), the credential-shaped redaction asserted by `grepCount(..., 'credential-shaped content redacted') ≥ 1`, the #89 registry row by grep. Contract GT8/D4.3/§6 `:334-341` citations corrected to `:341-348` in **v1.2**. |
| **F7** GP-E greps referee.mjs for the byte-level ABSENCE of the exact blast-radius projection a correct #144 adds to the referee path | PIN BREAKS ON CORRECT LANDING | re-scope the pin to the derivation it guards | **GP-E** | PIN re-scoped GREEN | `coverageOfChange` stays textually derived (`coverageOfChange = uncovered.length === 0`, referee.mjs:313) and never coupled to a blastRadius projection — `grepCount('referee.mjs', 'coverageOfChange.*blastRadius|blastRadius.*coverageOfChange') === 0`. B5b's evidence-not-a-gate-input law is preserved WITHOUT forbidding the annotation machinery B5b also requires. |
| **F8** the blast-radius projection is pinned only as a pure function — never asserted consulted by a verdict path | SHALLOW-GREENABILITY | new R6 consultation leg | **R6** | RED at `stage #144: R6: the advisory blast-radius projection is not landed (D2.2)` | `pool.answer({ op: 'code.symbol', changedLines })` on a changed-lines project must return a verdict carrying the blast advisory/annotation (`verdictAnswer?.blastRadius ?? verdictAnswer?.orientation?.blastRadius`), and that annotation never carries `coverageOfChange`. The projection must ANNOTATE, not merely exist. |
| **F9** `typeof symbol.name === 'string'` passes `''` — a digests-only implementation can drop symbol NAMES | SHALLOW-GREENABILITY | R5 name assertion tightened | **R5** | RED at `stage #144: R5: the symbol-accurate evidence projection is not landed (D2.1)` | the projection must carry the RESOLVED symbol name — `assert.equal(symbol.name, 'missingFn')` (the fixture resolver's exact return) — and the resolved file digest, never a path. |
| **F10** R13 never asserts the opted path reachable — an all-refusing implementation passes | SHALLOW-GREENABILITY | R13 reachability leg | **R13** | RED at `stage #144: R13: the per-language opt-in gate + honest trust card is not landed (D1.5)` | `assert.ok(pool.acquire({ language: 'typescript' }))` — the opt-in gate must ADMIT the opted language, not only refuse the un-opted one. (Mitigation note from the report honored: R2/R3/R4/R8/R9 acquire typescript too, but R13, the row that pins the gate, now pins the admission itself.) |
| **F11** `handshakeStub` resolves on a fixed 600 ms deadline racing the child's real response — a #7-class flake surface | HERMETICITY / #7-CLASS | arrival-driven settle | **GP-L** | PIN (mechanism only) | the promise resolves when BOTH responses (id 1 `initialize`, id 2 `hover`) have arrived; the 4000 ms timer is the outer bound that REJECTS; the child `exit` before settle rejects. The 150 ms pacing write is stdin-buffered and benign. No fixed-ms resolve deadline races the child. |
| **F12** R1's `serialized.includes('definition') === false` bans a correct honest-empty answer's legitimate "no definition provider" vocabulary | MINOR | typed-empty SHAPE assertions | **R1** | RED at `stage #144: R1: the LSP pool / typed-empty index_status is not landed (D1.5)` | the typed-empty surface is pinned by SHAPE — `availability.status === 'empty'`, `language_ceiling === 'honest_empty'`, and no `"symbols"`/`"diagnostics"` KEYS in the serialized object — instead of the English substring. The impl's honest vocabulary is unconstrained. |

## Before / after

```
BEFORE (review HEAD 5bc67de):  tests 23 · pass 8 · fail 15   (GP-A, GP-F red on drifted anchors; R1..R13 red)
AFTER  (fold HEAD 919a412b):   tests 23 · pass 10 · fail 13  (GP-A..GP-L green; R1..R13 red at named stages)
```

Verified at HEAD (two consecutive runs from the repo root, both stable):

```
Run 1: 23 tests — 10 pass (GP-A..GP-L guard pins) / 13 fail (R1..R13 red rows)
Run 2: 23 tests — 10 pass / 13 fail. STABLE.
```

Every RED row still fails at its NAMED first stage — `resolveLspPoolHome() → {surface:null}` →
`stageGuard` asserts `surface.createLspPool` is a function and throws `stage #144: <named stage>`
(issue144-lsp-pool-red.test.mjs:469-472). The fold re-drives three of those named stages (R3's
message is unchanged; R1/R5/R6/R13 messages unchanged); it does not move any existing stage.

## Per-finding seam notes

- **F1 — readiness seam, not a blocked acquire.** The report's either/or — synchronous
  `process_ready` vs. a blocked acquire hanging the wedged leg — is dissolved by the seam: `acquire`
  returns a starting handle immediately (so the wedged leg can fire ceiling requests against a
  ready-then-hung server), and `pool.ready(language)` is what the lifecycle and crash legs await.
  Readiness is bounded and count/event-derived (a kill-wait under M2), never a wall-clock hard cap;
  it rejects `lsp_startup_failed` on handshake failure, which is how the crash leg observes the
  slot-clear without a `doesNotThrow` wrapper.
- **F2 — ready-then-hung drives `wedged`, not `starting`.** The `'hung'` mode stays (it pins the
  not-ready/`starting` behavior); `'ready-then-hung'` is a distinct fixture because B2 defines
  wedged as *ready, then silent on textDocument/*. The wedged leg awaits readiness first — so a
  correct pool has advanced past `starting` before the ceiling is driven, and the refusal genuinely
  fires with reason `wedged`.
- **F3 — crash-once makes the slot-clear observable.** The marker-file prelude writes
  `crashed-once.marker` next to the stub on first spawn and exits 72; a fresh generation (the
  retry's process) sees the marker and answers. The assertion is a NEW `process_started` event after
  the retry — a fresh attempt began — plus `ready` resolving on the fresh generation. An
  always-crash stub could not distinguish "slot cleared, fresh attempt also failed" from "slot
  parked"; the marker file can.
- **F5/F6 — grep-anchored, so the +7 drift class is closed for GP-A/GP-F.** Both pins now locate
  their target by `grepFirstLineNum` (set literal / function signature) and assert content by grep
  or a window anchored to that line. A future unrelated production edit can shift lines without
  turning these PINs red — the suite-fix-144 re-anchor treated the GP-B/GP-C symptom; the fold
  hardens the two remaining line-window pins.
- **F7 — the pin is the derivation, not the file.** GP-E asserts `coverageOfChange` is textually
  derived and never coupled to a blastRadius projection. A correct #144 MAY add the projection to
  the referee path to annotate the verdict (that is R6/B5b's requirement); it must never feed the
  coverage gate. The old byte-absence grep would have turned a must-stay-green PIN red on the
  correct landing.
- **F8 — consultation rides the verdict path.** The R6 leg drives `pool.answer` with `changedLines`
  and asserts the returned answer carries the blast advisory — the projection is proven wired into
  verdict production, not merely exported. The no-`coverageOfChange` half is asserted on the
  consulted annotation too.
- **F11 — arrival, not a deadline.** `maybeSettle()` resolves only when both response ids are in
  the map; the 4000 ms timer and the child-`exit` handler are the reject paths. GP-L's timing is
  now bounded by the stub's real response arrival — a loaded host can exceed any fixed deadline
  without flaking.
- **Contract movement is citation-only (v1.2).** F5 corrects the §6/GT5 "gate enum declaration
  order" claim to the true `DEBUG_GATE_CODES` set-literal order; F6 corrects `boundedAttentionText`
  to `:341-348`. No decision, refusal vocabulary, or row inventory changed — the pinned laws are
  intact, so the fold lands as rows/seams in the existing suite, not as contract text.

## Suite-law hygiene (unchanged, re-verified)

- **Red-first at named stages**: 13 RED rows / 10 PIN rows; every RED row's first failing assertion
  is the named-stage failure (`stage #144: <named stage>`); the stage strings live in the header
  row inventory AND in each row's assertion message.
- **Hermetic**: every fixture world is mkdtemp'd under `os.tmpdir()` and reaped by `test.after`
  (issue144-lsp-pool-red.test.mjs:222-228); the LSP server is a local `node` script (the stubbed
  typescript-language-server), `gitRepo` shells to real git on a mkdtemp root; no network, no real
  providers, no host-load reads.
- **No clocks as controls**: the wedged trigger is the per-server OUTSTANDING-REQUEST ceiling
  (count-derived, `perServerOutstandingRequests`), never a timer; the only real timers are inside
  the `handshakeStub` test fixture — the 4000 ms outer bound (a bounded kill-wait) and the 150 ms
  stdin pacing write, both lawful, with the F11 hard-resolve deadline removed.
- **NUL discipline**: every `impl/src` machinery file is NUL-bearing; all source scans use
  `grep -an` / `sed -n` / `grepFirstLineNum` (NUL-safe), never whole-file reads; the resolver reads
  only the not-yet-existing `src/lsp-pool.mjs` inside a try/catch.
- **Sorted-key literals ACTUAL order**: the gate-enum set (GP-A), the `LSP_BOUNDS_KEYS` set, the
  sanitizer mapping, and every closed literal are asserted against frozen constants in ACTUAL order;
  `localeCompare` remains banned (GP-I).
- **`watchdog.stallMs` valid-positive in every fixture**: `poolConfig` sets
  `watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' }` (the #67 law) — the
  stall is set so the watchdog never fires in any row; it is fixture hygiene, not a control.
