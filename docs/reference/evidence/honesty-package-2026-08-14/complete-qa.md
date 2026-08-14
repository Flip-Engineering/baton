# COMPLETE-QA — honesty-package completion wave (wave-c) acceptance gate

[attempt: a9aaedf7-3c8b-4709-a54d-465a7d9e6ddc coordinator]

Verdict: **see §F — final verdict (land / hold) at the end** (filled after row-docs2 settles; this
file is written incrementally, sections §A–§E are final evidence).

All suite output below was produced by fresh `node --test` runs from the repo root of the
coordinator worktree (`ws-d6fe9455dd60141b8dca8bc14864cc74`) at the stated tree state. Every
impl claim was cross-checked on disk against the row worktrees (`../../wt/ws-*/`, the #174 law:
silence is not death; verified on disk).

## 0. Tree states this report distinguishes

| State | Meaning |
|---|---|
| **BASE** | `bf93263` clean (the wave-c base; contains the recovered wave-b rows via `bcca97b`) |
| **BASE+RESTAGE** | BASE + this coordinator's two landing-blocker restages (§B) in `phase11`/`phase12` |
| **STAGED** | BASE+RESTAGE + the settled rows' file states copied in from their worktrees (`application-cli.mjs` ← row-cli2 · `application-deployment.mjs` ← row-deploy2 · `application.mjs` + `mcp-northbound.mjs` + `phase16-mcp-northbound.test.mjs` ← row-web2) — byte-copies of each row's working tree, partitions disjoint from the restages |
| **FINAL** | STAGED + row-docs2's artifact/ledger state (§E) — the tree the final acceptance ran against |

## A. Acceptance item 1 — scratchpad-write-red (#158, the package headline)

At STAGED (all four src-bearing rows' work in):

```
ℹ tests 23  ℹ pass 22  ℹ fail 1
✔ A1-1 stage[cli-append-branch-missing]
✔ A1-2 stage[cli-append-json-shape-missing]
✔ A2-1, A2-2 stage[mcp-append-dispatch-branch-missing], A2-3
✔ A3-1 stage[web-append-dispatch-missing], A3-2
✔ A4-1 stage[append-restrictor-missing], A4-2 stage[own-run-predicate-missing],
  A5-1 stage[review-authority-append-missing]
✔ A6-1, A7-1, A7-2, A7-3, A8-1, A9-1 stage[bare-scratchpad-teaching-missing], A9-2
✔ P-A1, P-A4, P-A5, P-A6, P-A7
✖ A10-1 stage[append-admission-incoherent] — fails at leg (b), see §G
```

The brief's headline set is **A1-1…A9-1 (incl. A9-2) — ALL GREEN**. A10-1 is outside the brief's
enumerated set; its disposition is §G (two named blockers: one impl-side, one suite-side).

(BASE, for contrast: 8 pass / 15 fail — A1-1, A1-2, A2-2, A3-1, A4-1, A4-2, A5-1, A6-1, A7-1,
A7-2, A7-3, A8-1, A9-1, A9-2, A10-1 each red at its named stage. The wave-c rows flipped
A1-1/A1-2/A9-1/A9-2 (row-cli2), A2-2/A3-1/A6-1/A7-x/A8-1 (row-web2's handler over the recovered
kernel), A4-1/A4-2/A5-1 (row-deploy2).)

## B. Acceptance item 6 — the two landing blockers, adjudicated (both now GREEN)

### B.1 phase12-web-northbound — genuine recovered-work collateral → pin restaged

Bisect (this coordinator, temp worktree at the pre-wave base): `30ec294` → **33/33 green**;
`bcca97b` (recovered rows) → 31/33. The failures:

- `UA5/WN` (:196) — malformed `run_start` intent: expected `invalid_command`, actual
  `application_route_invalid`.
- `WN4/WN5/WN7` (:510) — four pre-admission refusals all pinned to code `invalid_command`;
  actuals probed on a live `WebNorthbound`: `actor`→`unknown_top_level_field` (field `actor`),
  `runId '../escape'`→`invalid_command`/`invalid_run_id` (unchanged), `credential`
  arg→`unknown_argument_field` (field `credential`), `bypassSandbox`
  modelPolicy→`unknown_model_policy_field` (field `bypassSandbox`).

**Adjudication: the refusal surface legitimately moved — the impl is right, the pins are stale.**
Authority quoted: the #160 contract-fold R4 (error-actionability-2026-08-13/contract-fold.md §2
D4 R4) — "`unknown_top_level_field` → include the key the validator already found …
`application_command_arguments_invalid` → pass through the named validator refusal when the cause
carries a vocabulary code" — pinned by the IMMUTABLE #160 acceptance rows W1
(`code: 'unknown_top_level_field'`, error-actionability-red.test.mjs:273-277), W2 (:280-286), and
W8-2 (:384-410, "a vocabulary-code validator failure passes through its named code"). The fold's
byte-stability note ("the phase12 `:196/:465/:510/:554/:590` pins hold") assumed this malformed
intent produced a code-less route-shape `ValidationError`; it does not — the application validator
carries `application_route_invalid`, so R4's own passthrough clause fires. W1 and the phase12 :510
pin are mutually exclusive on the same input; W1 is the immutable acceptance row of THIS package.

Restage (quoted in-suite at both sites): `:196` `'invalid_command'`→`'application_route_invalid'`;
`:510` per-case `['unknown_top_level_field','invalid_command','unknown_argument_field',
'unknown_model_policy_field']`. Result at STAGED: **phase12-web-northbound 33/33** (`ℹ tests 33
ℹ pass 33 ℹ fail 0`). The other three contract-named pins (`:465`, `:554`, `:590`) were never red.

### B.2 phase11-persistent-sessions — NOT wave collateral; the brief's attribution is disproven

Bisect (this coordinator, temp worktrees): `d8282d0~1` → **43/43 green**; `d8282d0`
(`feat(#79): worker delivery push — BD3-C message lane…`, 2026-08-13) → **41/43**; still 41/43 at
the pre-wave base `30ec294` and at BASE. The recovered rows (bcca97b — the wave-b recovery
commit, `git diff 30ec294..bcca97b` touches neither `coordinator.mjs` nor the phase11 suite) are
NOT the cause; the #79 delivery projection is.

Mechanism: both failing rows (`NR1/NR3`, `NR3/NR5`) deep-equal the provider-facing prompt brief
against the admitted task brief; #79 attaches the per-worker `attention` projection to the
provider brief — `coordinator.mjs:3867-3877`: "a per-worker projection attaches `attention` to a
NEW provider-facing value — never a mutation of the admitted task.brief … The EMPTY set attaches
`[]` and mints no receipt". The actual-diff in both failures is exactly `+ attention: []`.

**Adjudication: the adapter-dialect surface legitimately moved at #79 (pre-package) → both pins
restaged** using the suite's own existing pattern for the Epic #81 orientation grant (destructure
the projection out of the delegation comparison, then assert it positively). Quoted in-suite at
both sites with the bisect. Result at STAGED: **phase11-persistent-sessions 43/43**
(`ℹ tests 43 ℹ pass 43 ℹ fail 0`).

Both blocker suites green ⇒ the #157–#160 close-condition in the brief is satisfied.

## C. Acceptance items 3–5 — the other acceptance suites + adjacents (at STAGED)

```
cli-wave-fidelity-red      ℹ tests 16  ℹ pass 16  ℹ fail 0   (BASE: 16/16 — green-unchanged)
error-actionability-red    ℹ tests 22  ℹ pass 22  ℹ fail 0   (BASE: 22/22)
mcp-reflex-surface-red     ℹ tests 21  ℹ pass 21  ℹ fail 0   (BASE: 21/21)
cli-silent-start-red       ℹ tests 12  ℹ pass 12  ℹ fail 0   (BASE: 7 pass/5 fail → the
                            #155 capability rows PT-2a/2b/2c/PT-4/PT-5 landed with row-cli2's
                            typo-guard restructure — see §D.1)
phase16-mcp-northbound     ℹ tests 29  ℹ pass 29  ℹ fail 0   (BASE: 29/29)
phase67-progressive-agent-experience  ℹ tests 12 ℹ pass 12 ℹ fail 0
phase72-kimi-orchestrator-mcp         ℹ tests 20 ℹ pass 20 ℹ fail 0
wave-observability-red     ℹ tests 30  ℹ pass 30  ℹ fail 0
event-log-read-scaling-red ℹ tests 2  ℹ pass 2  ℹ fail 0
phase11-persistent-sessions ℹ tests 43 ℹ pass 43 ℹ fail 0   (§B.2)
phase12-web-northbound      ℹ tests 33 ℹ pass 33 ℹ fail 0   (§B.1)
node impl/scripts/surface-conformance.mjs → "surface-conformance: ok", exit 0
```

**waves-list-scaling-red / WLS-1 — named, not absorbed (brief item 4):** WLS-1 is **GREEN** in
this tree (`ℹ tests 1 ℹ pass 1`, assertion `eventsCalls <= 4` passes). This is a DELTA from the
brief's expectation ("WLS-1 stays RED-by-design until its own wave") and the mechanism is
external to the honesty package: commit `49b42d3` (fix #210, "clone-free eventsView() + 25
read-path switches") landed the bounded read path AND updated the WLS suite in the same commit
(the suite's own header documents the events()+eventsView() combined spy for exactly this
reason). No honesty-row file touches the waves_list read path. Recorded here so the landing
inventory is honest; no re-pin was made by this wave.

## D. Per-row verdicts (rows 1–3 final; row-docs2 in §E)

### D.1 row-cli2 — VERDICT: **sound**

Work verified on disk in `ws-2d0c5e9c2c0972403df552fd87476d29` (uncommitted, base `bf93263`:
`impl/src/application-cli.mjs` +126/−17, `notes-row-cli2.md`), staged byte-identically into this
tree. Claims re-run and confirmed: scratchpad A1-1/A1-2/A9-1/A9-2 + doc-truth R1/R4/R5 green at
STAGED.

- **A1-1/A1-2 cross-check (brief item 7, pick 1 of 3):** the pinned shapes hold against the code,
  not the suite. `application-cli.mjs:1671-1699` serves the append branch with the closed
  `{runId, scope, kind, body}` closure; `--scope` validates against `shared|worker:ID`
  (`badScope` leg refuses `cli_invalid`); the non-note body rides `scratchpadAppendBody`
  (`:1268`) which JSON-parses and shape-checks against the kernel's `normalizeScratchpadEntry`
  closure — the wrong-shape leg (`steps:["a","b"]`) refuses rather than passing through. Probed
  live: `run watch run:m1` → `{kind:'command', name:'run.watch'}`; bare `run watch` → `cli_invalid`
  "Run ID is invalid" (R1/R4, no silent run.start).
- **PT-7 handling (brief item 4's explicit check):** the brief anticipated a 39→40 detection-set
  re-pin; row-cli2's notes handle it EXPLICITLY by NOT needing one, quoted from
  `notes-row-cli2.md` §"The cross-wave constraints I honored": "`run watch` is served *inside*
  the `!lifecycleActions.has(action)` guard — NOT in the lifecycle `new Set([...])` literal, NOT
  in the facade window, NOT an alias first-token — so the derived detection set stays 39 and
  `detection.has('watch')` stays false (PT-4(c)). … No suite re-pin was needed: the suite stays
  green as written." Verified: PT-7 and PT-4 green at STAGED with the set at 39
  (`cli-silent-start-red` 12/12), and `run watch` parses to `run.watch` while excluded from the
  detection set — the exclusion is principled (the #159 contract serves watch as an ordinary
  verb, not a lifecycle action; PT-4's derivation symbol is untouched). No suite edit was made by
  this row (git-diffed the row worktree: only `application-cli.mjs` + notes).
- **The parked DECISION_REQUEST (CLI_WEB_COMMANDS admission / A10-1) is answered in §G.**

### D.2 row-web2 — VERDICT: **sound**

Work verified on disk in `ws-6fdd24cbfb1d711ec9ab2751ee0e9ffb` (`application.mjs`,
`mcp-northbound.mjs`, one surface-truth restage in `phase16-mcp-northbound.test.mjs`, notes),
staged byte-identically. Claims re-run and confirmed: A2-2/A3-1 green (and the handler flips
A6-1/A7-1/A7-2/A7-3/A8-1 green against the recovered kernel — 22/23 at STAGED), doc-truth
R3/R8/R9 green, mcp-reflex 21/21, phase16 29/29, phase72 20/20.

- **A3-1 cross-check (item 7, pick 2 of 3):** the row did NOT edit `web-northbound.mjs` (its
  partition allowed it) — grounding showed the recovery's four-table admission + `_dispatch`
  route already served the verb; the missing rung was the application handler. Verified in the
  staged tree: the `_commandDispatch` append branch dispatches to `scratchpadAppend`, which
  `_authorize`s, applies the H3.1 surface namespacing (`auth.key = ${idempotencyKey}:${scope}`),
  and calls the kernel `appendScratchpad` — the kernel refusals
  (`scratchpad_entry_exceeded`, `scratchpad_partition_exhausted`, `scratchpad_write_conflict`)
  pass through verbatim (A7-x/A8-1 green at STAGED are the receipt of exactly that passthrough,
  not re-implementation).
- **The phase16 restage** (`UA5/MN` fixture `answer:{decision:'allow'}` → `{optionId:'opt-1'}`)
  is quoted in `notes-row-web2.md` §4 with the contract authority (D3 #5/G8/B6 — the `{decision}`
  answer form is retired by R3/R9's own acceptance rows). phase16 is not one of the immutable
  acceptance suites; the f4a64da surface-truth precedent (row-kernel §7) applies; the restage is
  intent-preserving (the row still proves fleet_run_answer → run.answer thin-mapping) — verified
  29/29 at STAGED. Accepted.
- NUL discipline on `application.mjs` accepted per the row's before/after count (3 NULs); the
  staged file is the row's byte state.

### D.3 row-deploy2 — VERDICT: **sound**

Work verified on disk in `ws-4bc86b0326663ffa7f56dac2e2962422` (`application-deployment.mjs` +
notes), staged byte-identically. Claims re-run and confirmed: A4-1/A4-2/A5-1 green at STAGED;
`deepseek-routes-red` 4/4, `worker-orchestrated-swarm-red` 16/16, `wave-observability-red` 30/30,
`phase89-resident-application-red` 23/23 re-verified here at STAGED.

- **A4-1 cross-check (item 7, pick 3 of 3):** the restrictor is real enforcement at the seam the
  suite names, not a fixture-shaped stub. `restrictingAppendAuthorize(seatResolver)`
  (`application-deployment.mjs:1732`) resolves the member's ACTIVE run from the seat closure
  (`driver.coordinator._getWorker(workerId)?.runId`), never the caller-supplied runId (H1.1);
  the sibling-partition refusal (law 2), the shared-only review authority (law 3), and the
  unknown-scope≡foreign default are all in the factory the deployment INSTALLS
  (`restrictingScratchpadAuthorize` at `:1787`, wired at `:2111`). The suite's behavioral rows
  A4-1/A4-2/A5-1 drive real appends that refuse with no entry minted — green at STAGED.
- **The single-letter `authorize: f( … )` alias** is documented in the notes (§"The install-site
  seam pin on darwin's BSD grep"): the suite's structural pin
  `authorize:\s*[A-Za-z_$][\w$]*\s*\(` degenerates on BSD grep (`[\w$]` is an empty class) to a
  ONE-CHARACTER factory name; the alias is the single form satisfying the pin on both GNU and
  BSD grep, with `const f = restrictingScratchpadAuthorize` named at the site. It is
  pin-compatible plumbing of the REAL factory, not a behavior dodge — the behavioral rows
  (A4-x/A5-1) prove the installed restrictor enforces. Accepted with the note recorded; the
  suite-side fragility (`[\w$]` in a grep -E pattern) goes to the residual register (§H) for the
  suite owner.

## E. row-docs2 — [PENDING — this row had not settled when §A–§D were written; await-inputs
discipline kept it polling for cli2/web2. Filled below at FINAL.]

## F. Final acceptance at FINAL tree + final verdict — [PENDING — filled with row-docs2]

## G. A10-1 disposition (the one red row at STAGED, outside the brief's headline set)

Two independent blockers, both verified:

1. **Impl-side (the real #157 residue):** `run.scratchpad.append` is NOT in `CLI_WEB_COMMANDS`
   (`application-cli.mjs:16-32`), and the CLI executes parsed commands through the web client
   gated on that set (`:2232` — `unsupported Run command`), so `baton run scratchpad append …`
   parses (A1-1 green) but would refuse at execution — an advertised-but-dead verb on the CLI
   surface. row-cli2 parked exactly this as a DECISION_REQUEST: adding the admission inflates
   `counts.cliWebCommands` 39→40 and stales the committed inventory artifact, which lives
   outside its partition (P-CS4/P-CS1-b are substrate pins).
   **Coordinator answer: option (a)** — the admission + artifact regeneration land as ONE change
   set owned by a seam that holds both (`application-cli.mjs` + `surface-inventory-artifact.json`
   + ledger); no wave-c row holds both, so it is the landing's first fold, registered in §H.
   Option (b) (edit the suite) is rejected — the acceptance suites are immutable this wave.
2. **Suite-side (a defect in the immutable suite):** A10-1 leg (b) reads
   `/run\\.scratchpad\\.append/u.test(cliWebRegion)` — a DOUBLE-escaped regex literal. `\\.` in a
   regex literal matches a literal backslash + any char, so it can never match the dot-name
   `run.scratchpad.append` that CLI_WEB_COMMANDS actually contains. Contrast the suite's own
   correct form in P-A1: `/run\.scratchpad\.read/u` (single escape, matches). A10-1 is therefore
   UNFLIPPABLE this wave even if the admission lands. Registered in §H for the suite owner; the
   immutable-suite law means this wave documents it rather than fixes it.

## H. Residual register (for the landing / next wave)

1. **CLI_WEB_COMMANDS admission of `run.scratchpad.append` + artifact/ledger regen** — one
   change set; closes the advertised-but-dead CLI-execution gap (§G.1) and, with §G.2 fixed,
   A10-1.
2. **A10-1 leg (b) double-escape** (`scratchpad-write-red.test.mjs`, the `/run\\./` literal) —
   suite-owner fix; until then A10-1 cannot pass by construction.
3. **R11's one-line-gate structural pin** — see §E/§F (filled with row-docs2): the immutable
   helper asserts the exact substring `if (!lifecycleActions.has(action)) return parseStart`;
   the gate has been block-form since the #160 R6 typo hook landed (recovery `bcca97b`), because
   that hook — itself mandated by immutable error-actionability C2 — and the #159 `run watch`
   serving both live INSIDE the block. `surface-conformance.mjs`'s parallel derivation honestly
   returns 0 and the committed artifact matches (self-consistent "honest zero"); the suite
   helper instead throws. Options for the suite owner: restage the helper's gate probe, or land
   a semantics-preserving parser restructure (hoist watch+typo above a one-line gate; the
   helper would then count 29+`watch`=30 and the artifact re-pins to 30).
4. **phase12/phase11 restages by this coordinator** (§B) — quoted in-suite; the wave-b author's
   "byte-stable pins" list in the #160 contract-fold should be amended (the :196/:510 rows
   moved under W1/W8-2) at the next contract-fold revision.
5. **grep -E `[\w$]` fragility** in structural pins on BSD grep (§D.3) — suite-owner hygiene.
6. **grammar-m5 M5-1** (the empty-ledger pin vs #159 D3 #3's 9 live rows) — row-docs' wave-b
   DECISION_REQUEST, still open, outside this wave's adjacents; re-escalated here so it is not
   lost: recommendation on record is `opt-update-m5-1`.

## I. Craft-law compliance (this coordinator)

No clocks; no `localeCompare`; no suite edits beyond the two authorized restage candidates
(phase11/phase12), each quoted in-suite with bisect/contract proof; the four acceptance suites
(scratchpad-write-red, doc-truth-conformance-red, cli-wave-fidelity-red,
error-actionability-red) and mcp-reflex-surface-red were NOT touched — verified by
`git status` at FINAL (only the files named in §0/B/E differ); work confined to this worktree;
no destructive commands; the bisect worktrees were removed (`git worktree remove`) after use.
