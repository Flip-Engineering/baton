# FOLD-155 — blocker→resolution map for the #155 CLI-silent-start contract

`[attempt: f3425277-ad18-4234-b694-6044e4283c89 row-fold155]`

- **Row:** `row-fold155`. Frame: `docs/reference/evidence/fold-2026-08-13/foundry-brief.md` (shared
  laws — the fold resolves, it does not relitigate; no clocks; the attempt-echo law).
- **Target:** `docs/reference/evidence/cli-silent-start-2026-08-13/cli-silent-start-contract.md`
  (v1.0 DRAFT → v1.1 FOLDED, this fold).
- **Red-team:** `docs/reference/evidence/cli-silent-start-2026-08-13/redteam-155.md` (4 numbered
  blockers B1-B4 + 5 non-blocking minors M1-M5; verdict NOT FOLD-READY).
- **QA:** `docs/reference/evidence/review-foundry-2026-08-13/review-qa.md` §1 (verdict NOT
  FOLD-READY; §1.5 fold instruction set — six items, all applied). The four row-report blockers are
  preconditions per §1.5's preamble.
- **Verification HEAD:** `e371f70` (this worktree's git HEAD). Every citation touched by this fold
  was re-verified this session at that HEAD with `grep -an`/`sed -n`/`Read` — `surface-audit-cli.md:161`
  (E-5 deficient), `:173-176` (sweep verdict E-6/E-7), `:258` (F-1 `run steek`); `application-cli.mjs:1307-1310`
  (E-6), `:1314-1322` (E-7), `:1383-1385` (E-5), `:1421-1423` (follow), `:1574-1577` (29-verb
  lifecycle), `:1578` (fall-through), `:1775-1779` (steer), `:1295`/`:1130` (review→`parseReviewStart`);
  `application-semantics.mjs:742-787` (`OPERATION_ALIASES`); `baton.mjs:133` (exit-2 mapping). No
  NUL-bearing file cited.
- **Verdict:** FOLDED — all four blockers and all five minors folded; none STRUCK, none ESCALATED. No
  top-orchestrator decision was quoted for this row (the QA's DR-1/2/3, §5, belong to rows #164/#161).

---

## 0. Completeness ledger — every item gets exactly one disposition, no silent drops

Every blocker/amendment from the red-team report and every numbered instruction from the QA's fold
instruction set (plus the two coordinator amendments) appears exactly once below, each with a single
disposition and the contract section that changed. **STRUCK: 0. ESCALATED: 0. FOLDED: 13.**

| Item | Source | Disposition | Contract section changed |
|---|---|---|---|
| B1 — §1.2 misattributes the audit's model-refusal verdict to E-5 | red-team C-1 / Blocker 1; QA §1.3 B1; QA §1.5 #1 | **FOLDED** | §1.2, §8 |
| B2 — distance-1 typos of `follow`/`steer`/`member` silently start Runs; residual undisclosed | red-team D2 / Blocker 2 + OQ-2; QA §1.3 B2; QA §1.5 #2 | **FOLDED** | §1.1, D1, D2 rule 3, D3, PT-2 |
| B3 — "Levenshtein ≤ 1 (… transposition = 1)" self-contradictory; fails PT-2 | red-team D3 / Blocker 3; QA §1.3 B3; QA §1.5 #3 | **FOLDED** | D3, PT-2 |
| B4 — "derived at runtime, never a hand list" un-implementable; PT-2/3/5 shallow-greenable | red-team D1 / Blocker 4 + §4; QA §1.3 B4; QA §1.5 #4 | **FOLDED** | D1, PT-4, PT-2 |
| QA #5 — ship the sound remainder as written | QA §1.5 #5 | **FOLDED** (shipped byte-stable; no change needed) | unchanged — refusal vocabulary, rules 1/4, exit-code bucket, PT-1/6/7/8/9/10 |
| QA #6 — keep coordinator amendments H1/H2, folded into B4/M3 | QA §1.5 #6 | **FOLDED** | D1, D2 rule 2, PT-4(a), PT-5, §5 |
| H1 — one named facade-noun constant, source-scan-pinned | QA §1.4 | **FOLDED** | D1, PT-4(a) |
| H2 — `run member <unknown-sub>` non-goal line | QA §1.4 | **FOLDED** | D2 rule 2, PT-5, §5 |
| M1 — §5 "review calls parseStart" (it calls `parseReviewStart`) | red-team C-2 | **FOLDED** | §5, §8 |
| M2 — §1.5 exit-code framing (connected case 0→2) | red-team D1 minor / §1.5 note | **FOLDED** | §1.5, D1 |
| M3 — `run member foo` (unknown sub-verb) unpinned | red-team D2 minor | **FOLDED** | D2 rule 2, PT-5 |
| M4 — "byte-style mirror" applies to message, not code | red-team §3 note | **FOLDED** | D2 rule 2 |
| M5 — verification HEAD `7bcca96` absent from this repo | red-team C-3 | **FOLDED** | header, §1, §8, fold record |

The red-team's sound items (C-4 "everything else accurate", OQ-1, OQ-3, §6's sound-remainder list) and
QA §1.5 #5 are shipped unchanged — they are verifications/approvals, not findings, and are not entries
needing a disposition.

---

## 1. The four blockers (B1-B4) — all FOLDED

### B1 — §1.2 misattributes the audit's model-refusal verdict to E-5 (citation-fidelity)

**Reported:** the v1.0 contract claimed the `waves` branch at `application-cli.mjs:1383-1385` (audit
E-5) is "the audit's verified model refusal … one of the two sites that pass the #41/#139 test". The
audit says the opposite: the sweep verdict (`surface-audit-cli.md:173-176`) names **E-6** and **E-7**
as the two model sites, and E-5 is judged deficient (`surface-audit-cli.md:161`: "names the closed set
but omits send/stop … does not say 'use web/MCP/embedded'"; Names-field/class ✘, Names-next-action ✘).

**Resolution → FOLDED.** §1.2 re-anchored on E-6 (`application-cli.mjs:1307-1310`,
`cli_command_host_local` + corrective naming + next action) and E-7 (`:1314-1322`, `wave`→`waves`
plural corrective, `cli_command_unavailable`). The contract now states honestly that E-5's **shape**
(typed code + closed set) is mirrored but its missing next-action element — which the audit says E-5
lacks and E-6/E-7 demonstrate — is the contract's addition, supplied by D1's message shapes. The
"verified model refusal (E-5)" claim is struck. Citations `surface-audit-cli.md:161/173-176` and
`application-cli.mjs:1307-1310/1314-1322` added to §8.

### B2 — D2/D3: distance-1 typos of `follow`/`steer`/`member` silently start Runs (`run steek` is the audit's F-1 second headline)

**Reported:** the v1.0 taught-live set excluded `follow`/`steer` (refused-only) and `member` (prefix),
so rule 3's detection matched ZERO verbs for their distance-1 typos and they fell to objective-first.
Live-verified at HEAD: `run steek`→`run.start`, `run follw`→`run.start`, `run membr`→`run.start`.
`steek` is the audit's own F-1 second example (`surface-audit-cli.md:258`: "A connected orchestrator
typo (`run shwo`, `run steek`) launches a real Run").

**Resolution → FOLDED.** D2 rule 3's detection now compares against the FULL recognized set
(`RUN_RECOGNIZED_FIRST_TOKENS`, §D1) INCLUDING `follow`/`steer`/`member`, with distinct handling:
- typo of `follow` → refuse `cli_command_unavailable` with follow's existing text ("follow is not
  shipped by the Run application", `:1422`) + the `run start` escape — never suggesting `run follow`;
- typo of `steer` → refuse with steer's existing text ("steer was deleted at the M5 alias sunset; use
  run send", `:1777`) + the `run start` escape — the suggested verb is `run send`, never `run steer`;
- typo of `member` → route to rule 2's prefix refusal (`expected run member view, send, stop, or
  interrupt`).
D3's residual disclosure is expanded to name the `steek`/`follw`/`membr` class as now-covered. PT-2
pins `run steek`/`run follw`/`run membr` refusals. `run steek` refuses before fold. Citation
`surface-audit-cli.md:258` added to §8.

### B3 — D3/PT-2: "Levenshtein ≤ 1 (… transposition counts as 1)" is self-contradictory and fails PT-2

**Reported:** standard Levenshtein counts an adjacent transposition as distance 2. Measured this
session: `shwo`→`show`, `sned`→`send`, `viwe`→`view` are adjacent transpositions — Levenshtein 2,
Damerau-Levenshtein 1. An implementer following "Levenshtein ≤ 1" rejects none of the three, so PT-2
fails three of four assertions.

**Resolution → FOLDED.** D3 and PT-2 now pin **Damerau–Levenshtein ≤ 1** (single-character
substitution / insertion / deletion; **adjacent transposition = 1**), explicitly not plain Levenshtein,
with the note that the pinned examples are transpositions precisely so plain Levenshtein cannot pass.
`shwo`/`sned`/`viwe` must refuse.

### B4 — D1/PT-4: "derived at runtime, never a hand list" is un-implementable; PT-2/3/5 shallow-greenable

**Reported:** the taught-live set's parts have no single runtime source at HEAD — `lifecycleActions` is
a literal; the five facade nouns, `start`, and `follow` are separate `if (action === …)` branch
conditions; `view`/`list`/`member` are cross-file alias first-tokens. No query yields the union, so
PT-4's "source-scan proves … not a hand-kept literal" had no verifiable criterion, and a lazy
implementation hardcoding `['shwo','sned','viwe','attenton']` + a bare-`member` case passed every pin
except the criterion-less PT-4.

**Resolution → FOLDED.** D1 pins the exact composition mechanism as a named derivation symbol:
`RUN_RECOGNIZED_FIRST_TOKENS = [...lifecycleActions, ...FACADE_NOUNS, 'start', 'follow'] ∪
ALIAS_FIRST_TOKENS`, with `FACADE_NOUNS` (one constant: `message`, `attention`, `scratchpad`, `board`,
`knowledge`) and `ALIAS_FIRST_TOKENS` (`view`, `list`, `member`). PT-4's source-scan is redefined with
five concrete assertions (a-e): the constant equals the run-branch's facade dispatch labels; the alias
first-tokens cross-check against `OPERATION_ALIASES`; the detection set INCLUDES follow/steer/member
while the rendered/usable set excludes them and `watch`; the refusal fires only at the `:1578` run-branch
site (and the member-prefix site); no new `cli_*` code is minted. PT-2 is expanded into a **generated
Damerau-distance-1 sweep** over a sample of recognized first-tokens so token special-casing cannot pass.

## 2. The QA's six fold-instruction items — all applied, each citing the section that changed

1. **B1 — re-anchor §1.2's model-refusal claim on E-6/E-7; stop attributing a "verified model refusal"
   verdict to E-5.** → **FOLDED** — §1.2 (retitled and rewritten; E-6/E-7 quoted and named as the model
   sites, E-5's shape-mirrored-but-verdict-deficient stated), §8 (anchors added).
2. **B2 — extend rule-3 detection to `follow`/`steer`/`member` (distinct handling: existing next
   actions, never suggest the dead verb); expand the residual disclosure to name the
   `steek`/`follw`/`membr` class.** → **FOLDED** — §1.1, D1 (detection set vs taught-live set split),
   D2 rule 3 (distinct handling per matched verb), D3 (residual disclosure names the class), PT-2.
   `run steek` refuses before fold.
3. **B3 — pin Damerau-Levenshtein ≤ 1 in D3 and PT-2 (transposition = 1); `shwo`/`sned`/`viwe` must
   refuse.** → **FOLDED** — D3, PT-2.
4. **B4 — pin the derivation symbol and redefine PT-4's source-scan; expand PT-2 into a generated
   distance-1 sweep.** → **FOLDED** — D1 (`RUN_RECOGNIZED_FIRST_TOKENS`), PT-4 (five-part source-scan
   a–e), PT-2 (generated Damerau-distance-1 sweep).
5. **Ship the sound remainder as written.** → **FOLDED** — shipped byte-stable with no text change:
   the refusal vocabulary (no new `cli_*` code, both message shapes, next action always present),
   the four-way rule's rules 1/4, the exit-code bucket 2 landing, and PT-1/6/7/8/9/10.
6. **Keep the coordinator's amendments H1/H2 (folded into B4/M3).** → **FOLDED** — H1 in D1 + PT-4(a)
   (folded into B4); H2 in D2 rule 2 + PT-5 + §5 (folded into M3). See §3 below.

## 3. The coordinator's amendments (QA §1.4) — FOLDED

- **H1 — one named facade-noun constant, source-scan-pinned.** → **FOLDED** — `FACADE_NOUNS` is named
  as ONE constant in D1 and pinned by a #159-style derived assertion in PT-4(a): the scan compares the
  constant against the `action === '<noun>'` branch conditions at
  `application-cli.mjs:1430/1456/1476/1513/1552`; a facade noun missed from the constant fails red.
- **H2 — `run member <unknown-sub>` (two tokens) non-goal line.** → **FOLDED** — D2 rule 2 extends to
  the unknown-sub form (refuse `cli_command_unavailable` with the member subverb set; today it is a
  loud `cli_invalid: unexpected argument <sub>`, never silent), PT-5 pins it, and §5's non-goals name
  the residual (the sub-verb-typo class inside `member` is the F-7 help-topic family, not the
  silent-start class).

## 4. The non-blocking minors (M1-M5) — all FOLDED

- **M1** (`review` calls `parseReviewStart` at `:1295`, function at `:1130`, not `parseStart`) →
  **FOLDED** — §5 non-goals and §8 corrected.
- **M2** (exit-code framing assumes the disconnected case; the connected case is exit 0→2, the
  improvement) → **FOLDED** — §1.5 and D1's exit-code paragraph state both cases.
- **M3** (`run member foo` unpinned) → **FOLDED** — D2 rule 2 and PT-5 extend to the unknown-sub form.
- **M4** ("byte-style mirror" applies to the message, not the code — `attention`/`knowledge` throw
  `cli_invalid`, the member refusal `cli_command_unavailable`; both exit 2) → **FOLDED** — D2 rule 2
  scopes the mirror claim to message text.
- **M5** (verification HEAD `7bcca96` absent from this repo) → **FOLDED** — header, §1, §8, and the
  fold record cite the actual snapshot HEAD `e371f70`.

## 5. Sound remainder — shipped byte-stable

The core diagnosis (E-1 / `application-cli.mjs:1578` silent reinterpretation), the preservation of
objective-first (§1.3, pinned), the four-way rule's rules 1/4, the refusal vocabulary (no new code,
both message shapes, next action always present), PT-1/PT-6/PT-7/PT-8/PT-9/PT-10, and the exit-code
landing in bucket 2 are unchanged in substance.

## 6. Deliverables

1. `docs/reference/evidence/cli-silent-start-2026-08-13/cli-silent-start-contract.md` — v1.1 FOLDED,
   fold record appended.
2. This file — the blocker→resolution map (harvest artifact), attempt line verbatim in the header.

No source files were modified; work was confined to `docs/reference/evidence/cli-silent-start-2026-08-13/**`.
