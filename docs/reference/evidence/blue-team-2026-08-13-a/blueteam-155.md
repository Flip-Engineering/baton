# #155 BLUE-TEAM REPORT — attack on the cli-silent-start-red suite

[attempt: 08338cdd-d549-4375-98ee-af1a313938d5 row-bt155]

- **Row:** `row-bt155`. Frame: `blue-team-2026-08-13-a/foundry-brief.md` (wave-a blue-team law —
  cheapest-wrong-impl per capability row, pin-bite per pin, split-twice, law re-check, attempt-echo).
- **Target:** `impl/test/cli-silent-start-red.test.mjs` (the #155 red-first acceptance suite, v1.1
  FOLDED contract, header `[attempt: 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc row-suite-155]`).
- **Authority contract:** `docs/reference/evidence/cli-silent-start-2026-08-13/cli-silent-start-contract.md`
  (v1.1 FOLDED). Companions read: `fold-155.md` (blocker→resolution map), `redteam-155.md` (4
  blockers + 5 minors, NOT FOLD-READY → folded), `suite-draft-notes.md` (row↔stage table +
  plausible-wrong-impl audit). The attack is against the SUITE's ability to enforce that intent.
- **Verification HEAD:** this worktree is the pinned `e371f70` snapshot (the suite's own declared
  HEAD). The suite file itself is not present in this worktree (it landed after `e371f70`); it was
  read from master and temporarily copied in to run the split, then removed. `git status` clean.

---

## 0. Split record (split-twice, run from the repo root, worktree at HEAD `e371f70`)

```
node --test impl/test/cli-silent-start-red.test.mjs
```

| Run | tests | pass | fail | Result |
|---|---|---|---|---|
| Run 1 | 12 | 7 | 5 | PT-1/PT-3/PT-6/PT-7/PT-8/PT-9/PT-10 green; PT-2a/PT-2b/PT-2c/PT-4/PT-5 red |
| Run 2 | 12 | 7 | 5 | identical split (stable) |

Both runs match the suite's declared notes exactly ("12 tests, 7 pass / 5 fail", the seven PIN rows
green, the five capability rows red). **Split-twice law: satisfied.** The split was re-run twice
more on continuation (same command, worktree re-pinned to `e371f70`): both re-runs reproduced the
identical 12/7/5 split — stable across four total executions. PT-2c's generated sweep is
deterministic (2718 variants; exactly-one 2711, zero 0, two-or-more 4, skipped-exact 3 — re-derived
this session and matching the suite-draft-notes composition).

---

## 1. Per-row verdicts

### Capability rows (RED at HEAD) — cheapest wrong impl per row

| Row | Verdict | Cheapest wrong impl that turns it green (or none found) |
|---|---|---|
| PT-2a `[pinned-typo-refusals]` | **SHALLOW** | A 4-token special case — `if (['shwo','sned','viwe','attenton'].includes(action)) throw cliError('<exact pinned message>', 'cli_command_unavailable')` in the run branch — turns this row green. It is redundant: all four tokens are distance-1 variants of `show`/`send`/`view`/`attention`, so PT-2c's generated sweep covers them (see §3 finding 3). |
| PT-2b `[refused-position-typos]` | **SHALLOW** | A 3-token special case — `['steek','follw','membr']` with the three exact dead-verb messages — turns this row green. Same redundancy: all three are distance-1 variants of `steer`/`follow`/`member`, covered by PT-2c. |
| PT-2c `[generated-damerau1-sweep]` | **SOUND** | None found. The sweep generates 2715 non-exact variants at test time; no token hard-list can anticipate them. Passing requires a genuine Damerau–Levenshtein-1 metric against the full 39-token recognized set (plain Levenshtein rejects the three pinned transpositions at distance 2 → caught), correct per-neighbor suggestion rendering (the four `checkRefusalMessage` special cases for follow/steer/member/attention are load-bearing), and the exactly-one/zero/two-or-more discipline. The 4-variant two-or-more arm (`stow`/`shop`/`eview`/`rview`) is what kills a refuse-everything wall. |
| PT-4 `[derivation-symbol-source-scan]` | **BROKEN** | See §3 findings 1 & 2. Sub-assertion (e) — "no new `cli_*` code minted" — compares bare codes (`actualCodes`, no `cli_` prefix) against prefixed codes (`headCliCodes`, with `cli_` prefix), so it is red at HEAD **for the wrong reason** (the source mints nothing new — verified: prefix-corrected comparison yields `[]`) and stays red under **any** correct implementation (the mapping must still contain `'cli_command_unavailable'`, so `actualCodes` is always non-empty). PT-4 can never go green; the row is unsatisfiable as written. |
| PT-5 `[member-prefix]` | **SOUND** | None found. The cheapest impl that passes is the intended rule-2 mechanism itself — an `action === 'member'` guard throwing `cli_command_unavailable` with `expected run member view, send, stop, or interrupt` before the objective-first fall-through. There is no cheaper wrong impl that yields that exact teaching message for all three argv shapes (`run member`, `run member veiw`, `run member foo`). |

### PIN rows (GREEN at HEAD) — the plausible wrong impl each bites

| Row | Verdict | Plausible wrong impl it kills (or decorative) |
|---|---|---|
| PT-1 `[objective-first]` | **SOUND** | Kills a "full kill" that requires `run start` for every objective (removing the pinned bare form, §1.3 / OQ-2). Byte-exact against the phase68 pin. |
| PT-3 `[never-a-guess]` | **SOUND** | Kills over-refusal (a generic wall that refuses zero-match tokens — `deploy`/`refactor` must start objective-first) and guessing between candidates (`stow` is distance-1 from both `show` and `stop` and must fall through). This is the load-bearing zero-match pin: PT-2c's own zero-match arm is permanently vacuous (see finding 4). |
| PT-6 `[exit-code-bucket-2]` | **SOUND** | Kills remapping the `cli_invalid`/`cli_config_invalid`/`cli_command_unavailable` → exit-2 bucket in `baton.mjs`. Narrow (byte-string presence) but bites a real regression the fold explicitly forbids. |
| PT-7 `[canonical-aliases-unchanged]` | **SOUND** | Kills any disturbance of the canonical→legacy alias layer (the `eq` pairs pin byte-equivalence of kind/name/args) and lets a recognized first-token fall through to `run.start` (the 39-token bare-dispatch loop). |
| PT-8 `[parse-time-pre-connection]` | **SOUND** | Kills moving connection discovery before `parseBatonCli` — a typo could then reach provider spend. ORDER/EXISTENCE check, no line-window anchors (#166 compliant). |
| PT-9 `[refused-positions-unchanged]` | **SOUND** | Kills a typo-guard that shadows the `follow`/`steer` refusals (a generic wall intercepting them with a different message = a #136 dead end). |
| PT-10 `[surface-docs-conformance]` | **SOUND** | Kills adding/removing a served verb from the generated CLI inventory (verified `checkSurfaceDocs()` is a real regenerator-vs-committed byte comparison, not a no-op). |

**No PIN row is decorative.** No capability row is trivially green.

### Pin bite-tests (empirical — reproduced this session)

Each pin's named wrong impl was simulated against the suite's exact assertion shape; a pin that
does not flip RED under its wrong impl is decorative. All seven bite. Harness
`/tmp/bt155-bites2.mjs` (+ `bt155-echeck.mjs` for PT-4, `bt155-shallow3.mjs` for PT-2a/PT-2b),
run from this worktree at `e371f70`.

| Pin | Wrong impl simulated | WRONG-impl | HEAD |
|---|---|---|---|
| PT-1 | Bare `run <objective>` form removed (parse returns a different shape / refuses) | deep-equal vs phase68 pin → **RED** | `{"kind":"command","name":"run.start","args":{"intent":{"objective":"Improve Baton","resultIntent":"change"}},"idempotencyKey":"run-default"}` deep-equal **true** |
| PT-3 | Generic wall refuses zero-match tokens (`deploy`/`refactor`) or guesses between `stow`'s two neighbors | refused/guessed token → assertion flags → **RED** | zero-match falls through to `run.start`, no guess → **GREEN** |
| PT-6 | `baton.mjs` exit-bucket mapping re-mapped (`? 2 : 1` → `? 1 : 2`) | mapping string absent → **RED** | mapping present → **GREEN** |
| PT-7 | A recognized first-token let through to `run.start` | flagged token → **RED** | fall-through list `[]` → **GREEN** |
| PT-8 | Connection discovery hoisted above `parseBatonCli` | `parse < connect` false → **RED** | `parse=2667 connect=3918`, order holds → **GREEN** |
| PT-9 | Generic typo-wall shadows the `follow`/`steer` refusals | not-shipped/sunset regexes fail → **RED** | both exact messages reproduced at HEAD → **GREEN** |
| PT-10 | Served verb added/removed from the CLI inventory | `checkSurfaceDocs()` is a live regenerator-vs-committed byte compare → stale block flagged → **RED** | `checkSurfaceDocs()` = `[]` → **GREEN** |

Concrete harness output (abbreviated):

```
PT-6:  WRONG remap  -> mapping present = false (RED)   |  HEAD -> true (GREEN)
PT-8:  WRONG hoisted -> parse<connect = false (RED)    |  HEAD -> true (GREEN) [parse=2667 connect=3918]
PT-9:  WRONG shadowed follow/steer -> regexes fail (RED)|  HEAD follow+steer messages OK (GREEN)
PT-10: HEAD checkSurfaceDocs() = []                     |  (served-verb change -> stale block, RED)
PT-7b: HEAD recognized-tokens falling through to run.start = []  (GREEN)
PT-1:  HEAD deep-equal vs phase68 pin = true (GREEN)
```

---

## 2. Law re-check (frame checklist against the suite)

- **Named stages on every capability row** — yes: each capability test's name carries its canonical
  stage (`[pinned-typo-refusals]`, `[refused-position-typos]`, `[generated-damerau1-sweep]`,
  `[derivation-symbol-source-scan]`, `[member-prefix]`); assertion messages carry the granular stages.
- **Hermetic (mkdtemp + after-cleanup, no network/provider)** — yes. Parse-seam + static source-scan
  only (`parseBatonCli` in-process, `readFileSync` of local sources). No fixture is built, so the
  mkdtemp/`test.after` requirement is N/A by the suite-law's own carve-out; no network/provider/clock.
- **No clocks as controls** — yes; no `Date`/timers anywhere in the suite.
- **Namespace imports for invented surfaces** — yes; imports only real exports (`parseBatonCli` from
  `../src/index.mjs`, `checkSurfaceDocs` from `../scripts/render-surface-docs.mjs`).
- **Sorted-key literals ACTUAL order** — yes; the suite uses arrays/sets only, no sorted-key object
  literals.
- **watchdog.stallMs 60_000 + comment** — N/A: the suite is fully synchronous (no `await`, no
  timers, no I/O beyond synchronous reads); a stall watchdog would be dead weight. Consistent with
  the suite-draft-notes' hermetic-by-construction note.
- **No absolute line-window anchors (#166)** — yes; ORDER/EXISTENCE/byte-string assertions only
  (PT-8 uses `indexOf` ordering; PT-4 uses existence/equality of declared symbols).
- **Verbatim `[attempt: …]` line in the suite header** — yes.

---

## 3. Findings (blue-team, against the contract's intent)

1. **[BROKEN] PT-4(e) is red for the wrong reason and can never go green.** `headCliCodes` holds
   22 `cli_…`-prefixed codes; `actualCodes` (from `/'cli_([a-z_]+)'/g`) holds bare codes. The
   `filter(c => !headCliCodes.includes(c))` comparison is a prefix mismatch: every bare code is
   "not in" the prefixed list, so `minted` is all 22 at HEAD. Prefix-corrected, the source mints
   **zero** new codes (verified this session). Because the correct implementation must still contain
   `'cli_command_unavailable'`, `actualCodes` stays non-empty and the row stays red under every
   implementation. The suite can never be fully green — the acceptance machinery is broken.
   Reproduced this session (harness `/tmp/bt155-echeck.mjs`, worktree at `e371f70`):

   ```
   actualCodes count: 22
   minted (suite comparison): ["action_inputs_invalid","command_failed",...,"transport_failed"]   // all 22 bare codes
   truly minted (prefix-corrected): []
   ```

   The suite's own `minted` list is the entire code inventory (red for the wrong reason); the
   prefix-corrected comparison is empty (the source mints nothing new — a green-capable row would
   need only this fix).
2. **[BROKEN/drift] PT-4(b) requires `ALIAS_FIRST_TOKENS` to contain `do`/`resume`/`retry`, which
   the fold's D1 names as `(view, list, member)`.** The suite's `extractAliasFirstTokens` reads every
   `cli: { canonical: ['run', '<tok>']` row in `OPERATION_ALIASES`, yielding `{view, list, member, do,
   resume, retry}`. A contract-faithful implementer who declares `ALIAS_FIRST_TOKENS = {view, list,
   member}` (the fold's explicit parenthetical) fails PT-4(b) even though the resulting detection set
   is identical (the three extras are already in `lifecycleActions`). Contract and suite disagree;
   one must give.
3. **[SHALLOW, backstopped] PT-2a/PT-2b are redundant with PT-2c.** All seven pinned tokens are
   distance-1 variants of seeds the sweep already generates, so a pinned-token special case turns
   them green in isolation. PT-2c is what forces the generic mechanism; the pinned rows add no force
   beyond naming the headline examples. Worth keeping (they make the audit's F-1 examples explicit)
   but they are not load-bearing.
   Reproduced this session (harness `/tmp/bt155-shallow3.mjs`): a 7-token special case
   (`shwo`/`sned`/`viwe`/`attenton` for PT-2a; `steek`/`follw`/`membr` for PT-2b) passes **all four**
   PT-2a and **all three** PT-2b assertions against the suite's exact regexes:

   ```
   PT-2a under the 4-token special case:
     run shwo: true    run sned: true    run viwe: true    run attenton: true
   PT-2b under the 3-token special case:
     run steek: true    run follw: true    run membr: true
   ```

   The same special case cannot satisfy PT-2c's 2715-variant generated sweep (e.g. `snd` has no
   pinned entry and must resolve via the real metric) — PT-2c is the enforcement, as claimed.
4. **[decorative arm] PT-2c's zero-match arm is permanently vacuous** (zero=0 by construction —
   every generated variant is distance-1 from its seed). The exactly-one/zero/two-or-more law's
   zero side is carried entirely by PT-3's `deploy`/`refactor`. Not a defect (PT-3 covers it), but the
   sweep alone cannot catch a wall that over-refuses zero-match tokens.
5. **[fragile coupling — fold must record] The member guard has a placement constraint.** The suite's
   `extractRunBranchFacadeLabels` scans `if (action === '<x>')` from the run-branch entry
   (`application-cli.mjs:1417`) to the `const lifecycleActions = new Set(` declaration (`:1574`). A
   correct implementation that places the rule-2 `action === 'member'` guard inside that window is
   captured as a sixth facade noun → `detection.size` becomes 40 → PT-2c and PT-7 both fail. The guard
   must live at the `:1578` site (after `lifecycleActions`), which is where the fold's rule-3 typo
   guard naturally goes — the fold should state this explicitly.
6. **[fragile coupling] The lifecycle extraction assumes the fold composes, not enumerates.** If a
   correct implementation wrote `RUN_RECOGNIZED_FIRST_TOKENS` as a 39-quoted-string `new Set([…])`
   literal, `extractLifecycleVerbs` (maximal all-lowercase set literal) would grab it, `detection`
   would exceed 39, and the size assertions fail. The contract's spread-composition form
   (`[...lifecycleActions, ...FACADE_NOUNS, 'start', 'follow'] ∪ ALIAS_FIRST_TOKENS`) is therefore a
   hard requirement of the suite, not a suggestion. Satisfiable, but the suite would reject an
   otherwise-correct enumerated form.

---

## 4. Fold instruction set (concrete)

1. **Fix PT-4(e)'s prefix mismatch.** Compare `actualCodes` against the bare forms of `headCliCodes`
   (e.g. `!headCliCodes.some((hc) => hc === 'cli_' + c)`). After this, the row's (e) sub-assertion
   becomes a real "no new `cli_*` code" guard — red at HEAD only if the source actually mints one.
2. **Resolve the `ALIAS_FIRST_TOKENS` drift.** Either widen the fold's D1 parenthetical to name all
   six alias first-tokens (`view`, `list`, `member`, `do`, `resume`, `retry` — the suite's derivation,
   and harmless because the three extras are lifecycle verbs), or narrow the suite's
   `extractAliasFirstTokens` to the first-tokens that are *not otherwise recognized* (`view`, `list`,
   `member`). The suite and the contract must name the same set.
3. **State the member-guard placement** (finding 5): the rule-2 refusal must be at the `:1578`
   guard site, after `lifecycleActions`, or the facade extraction inflates the detection set to 40.
4. **Note the composition-form requirement** (finding 6): `RUN_RECOGNIZED_FIRST_TOKENS` must be
   spread-composed, not enumerated, or the suite's maximal-set extraction mis-derives.
5. **Keep PT-2a/PT-2b** (headline-example naming) but do not treat them as load-bearing; PT-2c is
   the enforcement.

---

## 5. Final verdict — **NEEDS-FOLD**

The split is stable and the law re-check passes, and the suite's enforcement core is genuinely
strong: **PT-2c forces the generic Damerau–Levenshtein-1 mechanism with correct per-neighbor
rendering, PT-3 carries the never-guess law, and the seven PIN rows are all SOUND.** No wrong
implementation can pass the suite as a whole.

But the suite is **unsatisfiable**: PT-4(e)'s prefix-mismatch makes a red-first row that can never
go green under any correct implementation (finding 1), and PT-4(b) additionally disagrees with the
fold's own D1 on the `ALIAS_FIRST_TOKENS` membership (finding 2). A suite that cannot turn green
manufactures no confidence — it manufactures a permanent red. **Fold items 1 and 2 are
blocking**; 3 and 4 are fragility notes that must be recorded so a correct implementation does not
fail on placement/composition; PT-2a/PT-2b SHALLOW and PT-2c's vacuous zero-arm are accepted with
the backstops noted.

**Named rows for the fold:** PT-4 (BROKEN — permanently red; fold items 1–2), plus the recorded
fragilities 3–4.

---

## 6. Shared-scratchpad publish — failed; exact refusal recorded

Per the frame, the report's full text was to be published to the `shared` scratchpad partition
(title `#155`). **The publish is unaddressable at HEAD `e371f70`, exactly as the red-team's §7 and
the suite-draft-notes documented.** Attempted from this worktree:

```
node impl/scripts/baton.mjs run scratchpad write shared "#155 blue-team report"
   →  cli_invalid: unexpected argument write    (exit 2)
```

**Exact refusal:** the scratchpad facade at HEAD exposes only `read` and `elevate`
(`application-cli.mjs:1476-1511`); there is **no client-addressable scratchpad write verb**, so a
`kind=note` publish to the `shared` partition cannot be addressed from the CLI surface. The
`SCRATCHPAD_WRITE` channel is a worker up-channel (parsed by `scanForScratchpadWrite` in
`claude-session.mjs`), not a client path; `scratchpad.elevate` additionally fails at connection
discovery in this disconnected worktree. This file remains the durable harvest artifact.

## 7. Deployment verification

Executable `"true"`, args `[]`, cwd `"."` — expected exit 0:

```
true   →   exit 0   (verified)
```
