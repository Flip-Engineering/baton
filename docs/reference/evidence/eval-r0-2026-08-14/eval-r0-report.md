# EVAL-R0 REPORT — the first honest eval number (#107)

[attempt: c8714a30-7464-49c5-904e-58a05ad458d8 row-eval-r0]

**VERDICT: STOPPED — DECISION_REQUEST. No arms ran. No eval number is reported.**

The pre-registration (`docs/reference/evidence/eval-scoping-2026-08-03/eval-r0-preregistration.md`,
dated 2026-08-07, sealed before any arm) demands ten live provider waves on the route
`deepseek-v4-flash@high` (§2, §7). This worktree has no credential for that route and no
capacity for the run envelope; the row brief's halt rule applies verbatim: *"If the
pre-registration demands live provider runs you cannot complete from the worktree
(auth/capacity), STOP and DECISION_REQUEST with options — do not improvise a weaker eval and
present it as R0."* Reporting a fabricated or substituted number would have been the only
alternative, and it is barred. What this report contains instead: the protocol as registered,
every precondition that IS verifiable from the worktree — verified, with artifacts — the two
blocking conditions with evidence, one protocol-level defect discovered during preflight
(the M5 plant, §4.1), and the decision request.

---

## 1. The protocol as registered (no edits)

Source: `eval-r0-preregistration.md` (all § references below are to that file unless noted).
Companion scoping: `eval-scoping.md` §4 (EVAL-R0b design).

- **Question (§1):** does the baton hub (waves + steering + settlement + trust gate) beat a
  for-loop for the red-first implementation task class at current maturity?
- **Five rungs (§2):** #64 trust-gate steering (`ac5bd80` / base `2f2d23b`, raw mode); #63 KG
  settlement (`e0f9d57` / base `2e22197`, raw mode); S-1 wave grammar (`480154a` / base
  `3733096`, planted); DG-1 diagnostics v2 (`6d0ca11` / base `47993f7`, planted); M5 alias
  sunset (`bb85e35` / base `bbf6791`, planted). Planted = final suite extracted from the impl
  commit onto the base, zero weakening.
- **Two arms (§3):** SOLO (one member, steering/finalization/settlement all `'none'`, same
  brief content as the landed impl's worker) vs DRIVEN (the `implementContract` wave-driver
  cadence: approve-on-advertised-plan, nudge-on-checkpoint, claim-on-stall, settlement ritual,
  trust-gate verification). Same brief, same grading suite, same route.
- **Measurement (§4):** sealed CairnRunScorecard per arm per rung — verified-rate, wall ms,
  tokens/USD, interventions byKind/byActor, exact route, pin sha.
- **Pivot criterion (§5, pre-registered, quoted verbatim):** *"If fleet ≤ solo on verified
  pass-rate AND fleet > 1.5× solo on wall-clock — across the five rungs' aggregate — the hub
  loses at current maturity and we say so, in the report, with the numbers."* A split decision
  is reported as a split with the per-rung table, not rounded to a win.
- **Preconditions (§6):** infra-death re-seat rule (once, recorded, never counted an arm
  failure); scorecard projection verified against the #64 landing before the first arm;
  red-at-base t0 splits recorded per rung.
- **Cost (§7):** 10 waves × ~45–60 min ≈ one calendar day at 3-wide on
  `deepseek-v4-flash@high`, low-two-figures USD.

No criterion, rung, route, or arm was modified by this row.

## 2. Preflight verification — what was checked on disk (all green unless stated)

### 2.1 The §2 rung table against git history (verified 2026-08-14)

| Rung | Impl commit | Base commit | Both exist | Suite at impl commit | Suite at base (raw rungs) |
|---|---|---|---|---|---|
| #64 trust-gate steering | `ac5bd80` | `2f2d23b` | yes | `trust-gate-steering-red.test.mjs` present | present at `2f2d23b` |
| #63 KG settlement | `e0f9d57` | `2e22197` | yes | `kg-settlement-red.test.mjs` present | present at `2e22197` |
| S-1 wave grammar | `480154a` | `3733096` | yes | `wave-grammar-red.test.mjs` present | n/a (planted mode) |
| DG-1 diagnostics v2 | `6d0ca11` | `47993f7` | yes | `diagnostics-red.test.mjs` present | n/a (planted mode) |
| M5 alias sunset | `bb85e35` | `bbf6791` | yes | `grammar-m5-red.test.mjs` present | n/a (planted mode) |

All ten commits verified via `git cat-file -t`; all five suites verified via `git cat-file -e`.
Result-pin namespace intact: 461 refs under `refs/baton/results/*` (207 at scoping time,
`eval-scoping.md` §2.1 — grown since, consistent with continued use).

### 2.2 The §6.3 t0 evidence — red-at-base splits (RUN, artifacts in `t0-results/`)

The registered pre-arm check: each base (raw mode) or base+plant (planted mode) must show the
grading suite RED before any arm runs. All suites are offline/deterministic (ScriptableAdapter
+ fake worktrees; no providers), so this precondition is runnable from the worktree and was
run. Method: `t0-red-at-base.sh` in this directory — a real detached git worktree at each base
commit, planted suites copied verbatim from the impl commit (`git show <impl>:impl/test/<suite>`),
`node --test impl/test/<suite>`, full output captured to `t0-results/<rung>.txt`.

| Rung | Mode | Base | Suite | Tests | Pass | **Fail (red)** |
|---|---|---|---|---|---|---|
| #64 trust-gate | raw | `2f2d23b` | trust-gate-steering-red | 21 | 7 | **14** |
| #63 kg-settle | raw | `2e22197` | kg-settlement-red | 24 | 3 | **21** |
| S-1 wave-grammar | planted from `480154a` | `3733096` | wave-grammar-red | 5 | 0 | **5** |
| DG-1 diagnostics | planted from `6d0ca11` | `47993f7` | diagnostics-red | 8 | 1 | **7** |
| M5 alias-m5 | planted from `bb85e35` | `bbf6791` | grammar-m5-red | 1 | 0 | **1 (load error — see §4.1)** |

All five bases are red. The #64 split (21 tests, 14 red, 7 green pins) matches the base
commit's own recorded expectation in `2f2d23b`'s commit message ("21 tests, 14 red at named
stages, 7 green pins") — independent corroboration that the harness reproduces the era's
recorded result.

### 2.3 The t1 grader-ceiling check — every suite GREEN at its pinned impl commit (RUN, `t1-results/`)

A grading suite that cannot pass on the landed implementation is not a valid grader for the
arms. Method: `t1-grader-ceiling.sh` — real detached worktree at each impl commit, suite as
landed, `node --test`, full output in `t1-results/<rung>.txt`.

| Rung | Impl commit | Tests | Pass | Fail | Verdict |
|---|---|---|---|---|---|
| #64 trust-gate | `ac5bd80` | 21 | 21 | 0 | grader valid (21/21) |
| #63 kg-settle | `e0f9d57` | 24 | 24 | 0 | grader valid (24/24; see §4.4 on version drift) |
| S-1 wave-grammar | `480154a` | 5 | 5 | 0 | grader valid (5/5) |
| DG-1 diagnostics | `6d0ca11` | 8 | 8 | 0 | grader valid (8/8) |
| M5 alias-m5 | `bb85e35` | 5 | 5 | 0 | grader valid (5/5) |

Every rung's suite is red at base (§2.2) and green at impl (here) — the t0→t1 delta is the
implementation gap the arms must close, and the M5 row (5 real tests at impl vs the base load
error) further corroborates §4.1's diagnosis.

### 2.4 Era brief-content recovery for the SOLO arm (§3) — COMPLETE, see `era-brief-content.md`

All five rungs' era invocation manifests survive in-repo, each rendering one `implementer`
member whose `objective` is the verbatim brief the landed worker received (2,600–3,714 chars
per rung; sha256 fingerprints, waveIds, idempotencyKeys tabulated in `era-brief-content.md`).
No rung needs the registered contract-statement fallback. This also establishes a fact worth
recording: every landed rung was itself a **one-implementer** wave, so the SOLO/DRIVEN
contrast is cadence (steering/finalization/settlement/trust-gate on vs off), not fleet size —
matching §3's framing.

### 2.5 The §6.2 scorecard-verification precondition (PARTIAL)

The registered check: recompute the #64 landing from its pin and match recorded fields. From
this worktree: the #64 impl receipt records `resultSha a1e0a5421e929b445b5f99838012738720b2c2e3`
(`docs/reference/evidence/trust-gate-steering-2026-08-02/impl-receipt.json`); the pin exists at
`refs/baton/results/a1e0a542…`, and its trailers match the pre-registered route exactly —
`Baton-Vendor: deepseek:deepseek`, `Baton-Model: deepseek-v4-flash`, `Baton-Effort: high`
(verified via `git log -1` on the pin). **Not done:** the full sealed-scorecard recompute —
it requires the #64 deployment's ledger state, which is not reachable from this row worktree
(no connection profile; same limitation recorded by the lane-proof row,
`lane-proof-2026-08-13/lane-qa.md:63-65`). This must complete in the live session before the
first arm, as registered.

### 2.6 §6.1 replay-harness posture (recorded, unchanged)

Issue #125's byte-replay harness does not exist; arms are not byte-replayable; both arms face
the same live-environment noise; infra death → one re-seat, recorded, never an arm failure.

## 3. The STOP — blocking conditions, with evidence

### 3.1 Auth: no credential for the pre-registered route

The pre-registered route is `deepseek-v4-flash@high` on the deepseek harness (§2 "era-
appropriate route availability… the same route class the landed impls used"; §7). The deepseek
harness's credential projection requires `deepseek_key.json` at the repository root
(`impl/src/application-deployment.mjs:107-112`); the deployment readiness surface reports
"DeepSeek is not configured; provision deepseek_key.json at the repository root" when absent
(`impl/src/application-deployment.mjs:795-798`). **No `deepseek_key.json` exists** at this
worktree's root (or the parent repo root); no `glm_key.json` either; `gh` is unauthenticated
in this worktree (verified: `gh issue view 107` → auth error, grounding done in docs per the
brief). Substituting a different harness/route with available credentials (e.g. the Claude
session's own env) would be a post-hoc edit to the sealed protocol — forbidden by the brief
("no scope drift, no post-hoc criterion edits") and by the pre-registration's own framing.

### 3.2 Capacity: the run envelope exceeds this row's window

Per §7: 10 waves (5 rungs × 2 arms) × ~45–60 min realistic (3h hard cap each) ≈ 8–10
seat-hours, ~1 calendar day at 3-wide parallelism, plus orchestrator attention for gate
validation and scorecard sealing. Even with credentials provisioned, this cannot complete
inside a single dispatched row's execution window; the pre-registration itself sequences it as
a dedicated campaign ("one calendar day at 3-wide").

**Pivot criterion (§5): NOT REACHED.** No arm ran; there is no verified-rate pair and no
wall-clock pair; any verdict would be fabrication. The criterion stands unamended for the
session that runs the arms.

## 4. Findings beyond the registered preflight

### 4.1 M5 plant defect (protocol-level — operator decision required)

The M5 grading suite born in `bb85e35` (`impl/test/grammar-m5-red.test.mjs`) has a hard import
on `checkBannedTokens` from `../scripts/surface-conformance.mjs` — and `checkBannedTokens` was
itself **added to `surface-conformance.mjs` in the same impl commit** (absent at base
`bbf6791` per `git show` of both blobs; the impl commit message names it as part of the
delivered capability: "banned-token lint… promoted to red in the conformance harness").
Consequence: the pre-registration's planted mode is not cleanly executable for M5 —

- planting the suite alone → the suite cannot even load at base (the observed t0: red by
  `SyntaxError`, not by assertion splits — recorded in `t0-results/alias-m5.txt`);
- planting the support file too → plants a piece of the implementation itself, contaminating
  the red-at-base property the plant is supposed to establish.

Red-at-base holds for M5 only in the weakest sense (the suite fails at base). Whether that
satisfies §2's "red at the base by construction" or whether M5 must be replaced/dropped is a
sealed-protocol question this row cannot decide. Escalated in §6.

### 4.2 Environment note — baton worktree git filtering (methodology hazard, recorded)

In this baton-managed worktree, bare `git ls-tree` and `git archive` are pathspec-filtered
(the worktree's projection exclude, `core.excludesfile` → `…projection.exclude`) and silently
yield **empty trees** for foreign commits. The first t0 attempt used `git archive` and produced
plausible-looking "red" outputs that were actually module-load errors on empty trees; the
attempt was discarded and redone with real detached worktrees (`t0-red-at-base.sh` documents
this). Anyone re-running R0 preflight from a baton worktree must not trust `git archive`/bare
`ls-tree` here (use `git ls-tree --full-tree`, `git show`, or real worktrees).

### 4.3 node_modules symlink caveat on the t0 splits

Era bases predate the current `impl/node_modules`; the t0 runs symlink the **current**
node_modules into each era tree (needed for `@ast-grep/napi` and peers, which are imported by
suite-reachable modules). The splits are asserted-red at era sources with current optional
deps; if an arm session wants byte-era fidelity it should pin an era package-lock. Does not
affect the red findings (every failure observed is an assertion failure at named stages, not a
dependency error, except M5's §4.1 load error). The t1 grader-ceiling runs share this caveat
(same symlink in `t1-grader-ceiling.sh`).

### 4.4 #63 grader-suite drift within the impl window (finding; not a weakening)

The #63 grading suite is NOT byte-identical between base and impl:
`git diff 2e22197 e0f9d57 -- impl/test/kg-settlement-red.test.mjs` = 19 insertions, 6 deletions.
The delta is exactly two kinds (read in full, cited from the diff):

1. **Rename-follow:** `view.leaseStates.*` → `view.recipientAuthority.counts.*` in five
   assertion sites (KS3/KS5/KS7 rows) — the implementation renamed the orchestration-view
   field and the suite followed; each assertion is semantically identical, none removed.
2. **Determinism anchor:** a fixture-level anchored store clock (base `2026-08-01T06:00:00Z`,
   real-time advancement) added with the stated intent "without touching a single assertion".

Test count is unchanged (24 at base, 24 at impl; §2.2 and §2.3 tables), so no row was added or
dropped — by the corpus's own zero-weakening law (assertions preserved, rows preserved) this is
not a weakening. But it means the pre-registration's "the same suite, zero weakening" for #63
needs an explicit pin choice at arm time: **base digest** (`2e22197`'s blob, the registered t0
grader — will not load against an arm that reproduces the landed *renamed* API) or **landed
digest** (`e0f9d57`'s blob, the t1 ceiling grader). The natural registered reading is
landed-digest grading with base-digest t0 red evidence — the same posture the three planted
rungs already embody — but it should be stated in the arm session's manifest, and is folded
into the §6 decision request as a sub-item rather than decided here. #64's suite IS
byte-identical base→impl (`git diff 2f2d23b ac5bd80 -- impl/test/trust-gate-steering-red.test.mjs`
is empty), so the drift is #63-only among the raw rungs.

## 5. Limitations of this report

1. No arm ran; nothing here measures the §1 question. This is a preflight + halt record.
2. §6.2 is partial (pin identity + route trailers verified; full scorecard recompute pending a
   live session with ledger access).
3. t0 and t1 runs use current node_modules against era sources (§4.3).
4. M5's t0 red is a load error, not an assertion split (§4.1).
5. gh is unauthenticated here; issue #107 was grounded in the repo's pre-registration text, not
   the tracker. Any discrepancy between tracker and repo text is outside what this row could
   check.
6. Wall/cost figures quoted are the pre-registration's own estimates (§7), not measurements.
7. #63's grading-suite digest must be pinned (base vs landed) at arm time (§4.4); the era
   brief-content fingerprints in `era-brief-content.md` are reference values as of 2026-08-14
   and must be re-verified by the arm session.

## 6. DECISION_REQUEST — options for the operator

**Question:** EVAL-R0's ten live arms are unrunnable from this worktree (no deepseek
credential; envelope ≈ 8–10 seat-hours / ~1 calendar day at 3-wide). How should the campaign
proceed? Options:

- **A. Provision and re-dispatch (protocol unchanged).** Operator provisions
  `deepseek_key.json` at the repository root, reserves ~8–10 seat-hours plus orchestrator
  attention (~2h, §7), completes the §6.2 scorecard recompute in a live session, decides the
  M5 and #63-pin questions (below), then re-dispatches row-eval-r0 (or a dedicated eval
  session) to run the arms exactly as registered. The t0/t1 evidence and the era brief-content
  inventory in this directory carry forward as-is.
- **B. Operator-amended pre-registration (route substitution).** Amend the sealed §2 route to
  a harness with credentials available to the eval session (e.g. glm or claude-code), as a
  dated, signed addendum BEFORE any arm runs — keeping the pivot criterion and rungs
  untouched. This is a legitimate amendment only if the operator makes it explicitly; a row
  may not.
- **C. Descend the ambition honestly (NOT R0).** Re-scope to a retrospective (R0a-style
  tabulation of the 461 existing result pins) or a MockAdapter dry-run, pre-registered and
  named as what it is. Explicitly barred from being presented as R0; would still leave #107's
  question unanswered.

**Sub-question 1 (required under any option):** does M5's planted-mode defect (§4.1) mean
(a) load-error-red is acceptable t0 evidence for M5, (b) M5 is dropped and R0 runs four rungs
(aggregate criterion over four), or (c) M5 is replaced by a rung whose suite does not import
impl-commit-born code? Any of these is a sealed-protocol amendment and needs the operator.

**Sub-question 2 (required under any option):** which #63 grading-suite digest do the arms
grade against — the base blob (`2e22197`, registered t0 grader) or the landed blob
(`e0f9d57`, t1 ceiling grader)? See §4.4; the suggested reading (landed-digest grading,
base-digest t0 evidence) needs explicit operator confirmation because the sealed text says
"the same suite" without naming a digest.

## 7. File manifest (this directory)

- `eval-r0-report.md` — this report (deliverable).
- `era-brief-content.md` — §3 brief-content inventory: the five era manifests' fingerprints,
  waveIds, idempotencyKeys, and the landed runs' recorded routes/pins.
- `t0-red-at-base.sh` — the t0 preflight harness (real detached worktrees; documents the
  `git archive` hazard §4.2).
- `t0-results/trust-gate.txt`, `t0-results/kg-settle.txt`, `t0-results/wave-grammar.txt`,
  `t0-results/diagnostics.txt`, `t0-results/alias-m5.txt` — full `node --test` outputs per
  rung at base (raw or planted mode as registered).
- `t1-grader-ceiling.sh` — the t1 grader-ceiling harness (same method, run at the impl
  commits).
- `t1-results/trust-gate.txt`, `t1-results/kg-settle.txt`, `t1-results/wave-grammar.txt`,
  `t1-results/diagnostics.txt`, `t1-results/alias-m5.txt` — full `node --test` outputs per
  rung at its pinned impl commit (all green, §2.3).
- `coordinator-brief.md`, `row-eval-r0-brief.md`, `eval-r0.wavefile` — wave inputs (read-only).
