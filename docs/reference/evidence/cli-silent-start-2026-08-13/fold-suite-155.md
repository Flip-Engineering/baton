# #155 SUITE-FOLD REPORT — fold the cli-silent-start-red suite per its blue-team (row-sf155)

[attempt: c8f618f9-2f2a-4a1d-a367-eda8fd71da5c row-sf155]

- **Row:** `row-sf155`. Frame: `fold-2026-08-13-c/foundry-brief.md` (wave-c fold law — RED honesty
  preserved, the sacred attempt header, split-twice, every finding FOLDED/STRUCK/ESCALATED, scope
  discipline). **Blue-team attack:** `blue-team-2026-08-13-a/blueteam-155.md` (its §4 fold
  instruction set is the work list). **QA cross-check:** `blue-team-2026-08-13-a/blueteam-qa.md`
  #155 section (UPHOLD — NEEDS-FOLD). **Authority contract:** the suite header's Authority line —
  `docs/reference/evidence/cli-silent-start-2026-08-13/cli-silent-start-contract.md` (v1.1 FOLDED,
  read from master; the worktree snapshot carries the v1.0 DRAFT — the suite's own declared HEAD
  is `e371f70`).
- **Scope check:** this worktree is `ws-9d46f2f4045824acb79a53cb5928643e` (verified `pwd` before
  any write). The suite `impl/test/cli-silent-start-red.test.mjs` landed after this worktree's
  snapshot (`e371f70`), so it was materialized from master (`ba78989`, byte-identical to the file
  the blue-team attacked — `git log --follow` shows no later change) and folded in place. No write
  landed outside `impl/test/cli-silent-start-red.test.mjs` + `docs/reference/evidence/
  cli-silent-start-2026-08-13/fold-suite-155.md`.

---

## 0. Pre-fold baseline (reproduced this session, worktree at HEAD `e371f70`)

```
node --test impl/test/cli-silent-start-red.test.mjs   # from the repo root
```

| Run | tests | pass | fail | Result |
|---|---|---|---|---|
| Run 1 | 12 | 7 | 5 | PT-1/PT-3/PT-6/PT-7/PT-8/PT-9/PT-10 green; PT-2a/PT-2b/PT-2c/PT-4/PT-5 red |
| Run 2 | 12 | 7 | 5 | identical split (stable) |

Matches the suite's declared notes and the blue-team's split record exactly.

---

## 1. Finding → resolution map (every blue-team finding gets exactly one of FOLDED / STRUCK / ESCALATED)

Blue-team §3 findings and §4 fold instructions, mapped one-to-one. **None STRUCK, none ESCALATED.**

| # | Blue-team finding (blueteam-155.md) | Resolution | Where folded (suite file, at its new state) |
|---|---|---|---|
| 1 | **[BROKEN, blocking] PT-4(e) prefix mismatch.** `headCliCodes` holds 22 `cli_…`-prefixed codes; `actualCodes` holds bare codes; `filter(c => !headCliCodes.includes(c))` compares bare-vs-prefixed, so `minted` = all 22 at HEAD (red for the wrong reason) and the row is unsatisfiable (a correct impl must still contain `cli_command_unavailable`). | **FOLDED.** | `extractAlias…`? No — PT-4(e): the minted comparison is now `actualCodes.filter((c) => !headCliCodes.some((hc) => hc === \`cli_${c}\`))` — bare vs bare (prefix-corrected), with an inline comment. At HEAD this yields `minted = []` (verified: prefix-corrected `[]`); the row is now green-capable. PT-4 stays RED at HEAD for the right reasons (a)–(d). |
| 2 | **[BROKEN, blocking] ALIAS_FIRST_TOKENS drift.** The suite's `extractAliasFirstTokens` derives `{view, list, member, do, resume, retry}` from every `['run', …]` OPERATION_ALIASES row; the contract's D1 names `ALIAS_FIRST_TOKENS = (view, list, member)`. A contract-faithful implementer declaring `{view, list, member}` fails PT-4(b). | **FOLDED — the contract governs.** The fold law says the contract (authority) governs where they conflict; the contract names `{view, list, member}`, so the suite's derivation narrowed. | `extractAliasFirstTokens(sem, lifecycle)` now excludes tokens already in the lifecycle set (`do`/`resume`/`retry` are lifecycle verbs) → derives exactly `{view, list, member}` (verified). Call sites updated (`deriveDetectionSet`, PT-4) to pass `lifecycle`. PT-4(b) comment cites contract D1 + this finding. |
| 3 | **[SHALLOW, backstopped] PT-2a/PT-2b are redundant with PT-2c** — all seven pinned tokens are distance-1 variants the sweep already generates, so a pinned-token special case turns them green in isolation. | **FOLDED as recorded (accepted).** They are kept as headline-example namers (the audit's F-1 examples); the fold records they are not load-bearing — PT-2c's 2711-variant sweep is the enforcement. | No assertion change; documented in the suite header FOLD RECORD (item 5) and here. |
| 4 | **[decorative arm] PT-2c's zero-match arm is permanently vacuous** (zero=0 by construction — every generated variant is distance-1 from its seed); the zero side of the exactly-one/zero/two-or-more law is carried entirely by PT-3's `deploy`/`refactor`. | **FOLDED as recorded (accepted).** PT-3 is the load-bearing zero-match pin; the vacuous sweep arm is harmless. | No assertion change; the suite-draft-notes already documents this, and it is re-recorded here. |
| 5 | **[fragile coupling] member-guard placement.** A correct impl that places the rule-2 `action === 'member'` guard inside the facade window is captured as a facade noun → inflates the derived facade set; the guard must live at the `:1578` site after `lifecycleActions`. | **FOLDED (hardened + recorded).** | `extractRunBranchFacadeLabels(cli, lifecycle, aliases)` now excludes alias first-tokens from the facade labels (`!aliases.has(l)`), so `member` (an `ALIAS_FIRST_TOKENS` member, never a facade noun) can never inflate the derived set — verified by simulation: a member guard placed inside the window yields facades `{message,attention,scratchpad,board,knowledge}` (5), detection 39, with or without the filter (the set-level dedup also absorbs it, but the PT-4(a) FACADE_NOUNS equality was the real risk). A placement-constraint comment states the `:1578` requirement. |
| 6 | **[fragile coupling] composition-form requirement.** If a correct impl enumerated `RUN_RECOGNIZED_FIRST_TOKENS` as a 39-string `new Set([…])` literal, `extractLifecycleVerbs` (maximal all-lowercase set literal) would grab it and inflate detection past 39; the contract's spread-composition form is a hard requirement of the suite. | **FOLDED as recorded.** | Comment on `extractLifecycleVerbs` documents the COMPOSITION-FORM REQUIREMENT (spread-composed, never enumerated). The extraction itself is unchanged — the recorded requirement is what protects a correct implementer. |

**Blue-team §4 fold instruction set → status:** (1) PT-4(e) prefix fix **FOLDED**; (2) ALIAS drift
**FOLDED** (suite narrowed to the contract's set — contract governs); (3) member-guard placement
**FOLDED** (comment + hardened facade filter); (4) composition-form requirement **FOLDED as recorded**
(comment); (5) keep PT-2a/PT-2b **ACCEPTED** (kept, backstopped).

---

## 2. Post-fold measured splits (split-twice, from the repo root)

```
node --test impl/test/cli-silent-start-red.test.mjs
```

| Run | tests | pass | fail | Result |
|---|---|---|---|---|
| Run A | 12 | 7 | 5 | same split — all seven PIN rows green; PT-2a/PT-2b/PT-2c/PT-4/PT-5 red |
| Run B | 12 | 7 | 5 | identical split (stable) |

**RED honesty preserved:** every capability row still fails at HEAD at a named stage. PT-4's failure
message after the fold (verified this session):

```
capability row PT-4 — 4 source-scan failure(s): stage[facade-nouns-symbol-absent]: const FACADE_NOUNS
(one named constant) is not declared | stage[alias-first-tokens-symbol-absent]: const ALIAS_FIRST_TOKENS
is not declared | stage[derivation-symbol-absent]: the guard must compute its set from the named symbol
RUN_RECOGNIZED_FIRST_TOKENS, never a second hand-list | stage[guard-replaces-naked-fallthrough]: the
naked run-branch fall-through into parseStart is still present — the typo-guard must replace it
```

The `stage[new-cli-code-minted]` failure is **gone** at HEAD (prefix-corrected comparison → `[]`) —
the row is no longer red for the wrong reason and is now green-capable under a correct implementation.
The PT-2c sweep composition is unchanged from the declared notes: **exactly-one = 2711, zero = 0,
two-or-more = 4, skipped-exact = 3** (the detection set stayed at 39 tokens).

---

## 3. Law re-check on the folded suite (fold-foundry wave-c frame)

- **RED honesty preserved** — yes: PT-2a/PT-2b/PT-2c/PT-4/PT-5 all still RED at HEAD; PT-4 now for the
  right reasons (§2). PIN rows stay green. The fold hardens PT-4 against the unsatisfiable-wrong-reason
  defect; it never makes a capability row pass at HEAD.
- **Every finding FOLDED/STRUCK/ESCALATED** — yes (§1): 1–2 FOLDED (blocking), 5 FOLDED (hardened),
  3/4/6 FOLDED-as-recorded. None STRUCK, none ESCALATED.
- **The suite's existing `[attempt: 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc row-suite-155]` header line
  is SACRED and untouched.** This report carries MY objective's attempt line (`c8f618f9-… row-sf155`)
  verbatim in its first five lines.
- **Split-twice** — yes (§2), both 12/7/5, stable.
- **Suite law** — unchanged by the fold: hermetic (parse-seam + static source-scan, no mkdtemp needed
  by the suite's own carve-out), no clocks, namespace imports for real exports only, no sorted-key
  object literals (arrays/sets only), `watchdog.stallMs` N/A (fully synchronous), no absolute line-window
  anchors (#166 — the facade window is a start/end *marker* scan, not a line anchor). The `localeCompare`
  ban holds.

---

## 4. Judgment calls (recorded)

1. **Contract governs the ALIAS_FIRST_TOKENS drift (finding 2).** The blue-team offered both
   directions (widen the contract's D1 parenthetical to six, or narrow the suite's derivation). Per
   the fold law, the contract (authority) is not amended by a suite fold — the suite is folded to the
   contract. Chose to narrow `extractAliasFirstTokens` to `{view, list, member}`. The narrowed set is
   provably equivalent for detection (the three excluded tokens are lifecycle verbs, so the
   `RUN_RECOGNIZED_FIRST_TOKENS` membership is identical — detection stays 39).
2. **Member-guard placement: hardened rather than only recorded (finding 5).** The blue-team asked
   the fold to "state this explicitly". Beyond the comment, I excluded alias first-tokens from the
   facade-label derivation. This is not a weakening: the contract's `FACADE_NOUNS` is the five facade
   nouns and `member` is an `ALIAS_FIRST_TOKENS` member, so excluding it aligns the suite's derivation
   with the contract's composition. A genuinely new facade noun (not in the alias set) is still
   captured and flagged by PT-4(a).
3. **PT-4(e) fix keeps the row red at HEAD via (a)–(d).** The fold fixes the wrong-reason red; the
   four genuine blockers (missing symbols + naked fall-through) keep the capability row honest.
4. **No suite row count / structure changed.** 12 tests, PT-1..PT-10 unchanged; the fold is contained
   to the derivation helpers, PT-4's internal computation, and the header FOLD RECORD.

---

## 5. Deployment verification

Executable `"true"`, args `[]`, cwd `"."` — expected exit 0:

```
true   →   exit 0   (verified)
```

## 6. Deliverables

- `impl/test/cli-silent-start-red.test.mjs` — folded in place (suite v1.2 — the contract stays v1.1
  FOLDED — per the header FOLD RECORD; sacred attempt header preserved; split 12/7/5 stable; PT-4
  green-capable and red for the right reason).
- `docs/reference/evidence/cli-silent-start-2026-08-13/fold-suite-155.md` — this report.
