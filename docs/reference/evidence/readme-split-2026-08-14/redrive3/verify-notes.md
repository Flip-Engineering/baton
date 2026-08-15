README_SPLIT-VERIFY v1
[attempt: 64cd747d-4fa0-4ed3-bed8-04b87229508f coordinator]
ObjectiveRef: docs/reference/evidence/readme-split-2026-08-14/redrive3/coordinator-brief.md
Row verified: row-readme (worktree ws-d0c56785, w-613) — README split + progress ledger.
VERDICT: **needs-fold with blockers** — two blockers, one authority-class ambiguity for DECISION_REQUEST.

## What was checked and measured

The row is docs-only (three paths: README.md, progress-ledger, notes). The acceptance per the
row's brief is the execution contract's `true` (exit 0) plus this verify pass: the row's named
suites green, adjacents green-unchanged, spot-audit of two stages against the code.

- **Deployment verification** — `true` → **exit 0** ✓ (execution contract satisfied).
- **Scope discipline** — `git status` at ws-d0c56785 shows exactly `README.md` modified + two
  untracked new files (`docs/reference/progress-ledger-2026-08-14.md`,
  `docs/reference/evidence/readme-split-2026-08-14/redrive3/notes-row-readme.md`). **No
  `impl/` or `test/` change** — suites immutable respected. Adjacents are green-unchanged by
  construction (the row never touched a suite).
- **Suite spot-audit** (suites the README's LANDED tier cites with pass counts):
  - `impl/test/workflow-dsl-red.test.mjs` → **35 pass / 0 fail** ✓ (matches README "35/35").
  - `impl/test/issue10-waiting-vocabulary-red.test.mjs` → **38/38** ✓.
  - `impl/test/waves-list-scaling-red.test.mjs` → **1/1** ✓.
  - `impl/test/control-surface-truth-red.test.mjs` → 6/7; the 1 fail is **CS1-b** (the
    surface-conformance main is not green) — this is the pre-existing baseline red state from
    the mcp-dsl-surface wave **#227** (10 novel `mcp.web-bridge:run.*:name` divergences, present
    at base commit `1c2e04ae` and in the row's worktree; the divergence ledger has 0 web-bridge
    rows). Not a regression, not the row's fault.
  - `impl/test/quiescence-completion-red.test.mjs` → 14/15; the 1 fail is **R5
    (stage[hard-break-evidence-missing])** — a red-first pin from the in-flight no-clock-followons
    wave (its row brief: "implementation + red-first pin suite", cadence/break pins). Consistent
    with the ledger §3 methodology ("the red set == the declared in-flight roster").
  - `impl/test/workflow-dsl-package-red.test.mjs` → README claims 12/12; my two 280s verification
    windows timed out before output (cold-start matches `workflow-dsl-red`'s ~300s cold profile;
    a 520s re-run was in flight at write time). Reported **inconclusive/pending**, not a row
    defect — the row did not author the suite.
- **Canonical gate at baseline** — `node impl/scripts/run-suite.mjs` exits nonzero at the
  surface-conformance precheck with 10 `mcp.web-bridge` novel divergences (base commit and row's
  worktree identical). Pre-existing, attributed to mcp-dsl-surface **#227** red-first state; the
  row's docs-only change cannot move it.
- **Citation integrity** — every suite (17), doc (12), commit (14), and evidence dir (14) cited
  by the README exists at the row's HEAD. 0 broken relative links in the README; 0 broken in the
  ledger (21 relative links resolved). Ledger §4's gate counts (4054/3677; 377-row failure set)
  accurately attributed to `docs/PROGRESS.md:12` + the 2026-08-14 campaign reports.

## Blocker 1 — eight capability items deleted without a new home

The row's notes claim "Nothing from the README was deleted … every pre-split campaign line has a
home" and the brief's core directive is **NOTHING deleted without a new home**. Measured against
the current-state docs (new README + progress-ledger + campaign-state report), **8 capability
items from the old README's "In flight" section have zero representation**:

| issue | old-README capability | red-first suite status (measured) | home in new docs |
|---|---|---|---|
| #79 | worker delivery push | `worker-delivery-push-red` **32/32 GREEN** — SHIPPED (`d8282d0`, PROGRESS.md:21) | **none** — a shipped capability missing from the LANDED tier |
| #61 | worker verdict surface | `worker-verdict-surface-red` 5/31 RED | none |
| #69 | repl realization (PROGRESS.md:14) | `repl-realization-red` 11/34 RED | none |
| #70 | cross-deployment knowledge | `cross-deployment-knowledge-red` 9/31 RED | none |
| #71 | orchestrator wake | `orchestrator-wake-red` 6/36 RED | none |
| #72 | prescriptive doctor | `prescriptive-doctor-red` 4/17 RED | none |
| #73 | feedback-forge hardening | `feedback-forge-hardening-red` 8/16 RED | none |
| #77 | suite resource governance | `suite-resource-governance-red` 2/32 RED | none |

Seven still have live red-first suites (i.e. are genuinely mid-pipeline = IN-FLIGHT per the tier
definitions), and #79 is a *shipped* capability whose suite is green. All eight are absent from
the README's IN-FLIGHT **and** LANDED tiers, absent from ledger §5's "full current fleet"
roster, and absent from the campaign-state report. By the row's own judgment-call #5 criterion
("IN-FLIGHT = items with … landed red-first pins"), these belong in the IN-FLIGHT tier. They are
not there.

## Blocker 2 — the "red set == in-flight roster" claim is unverifiable from the deliverable

Ledger §3/§4 state the gate's red set is exactly the declared in-flight roster, and that the
377-row failure set is "fully accounted" by 20 red-by-design campaign pins + 12 #7 load-flake
members. But the README's IN-FLIGHT tier and ledger §5 list only the newest 2026-08-14 packs
(#208/#227/#228/#225/#204/#199/#200/#207/#226/#146/#149/#99/#179/K-plane/phase-grammar/member-harvest);
the 20 pins named at `PROGRESS.md:14` (#12, #59, #66, #69, #71, #80, #99, #102, #144,
phase80-revision, phase83-context-runtime, cross-deployment-knowledge, feedback-forge-hardening,
prescriptive-doctor, suite-resource-governance, worker-verdict-surface, #157–#160) are mostly
absent. Several were *relocated to the PLANNED tier* despite their suites still being red (#12,
#59, #66, #80, #102 — #66 and #80 are even inside PLANNED lanes that read as historical
disposition, "Older AX frictions" / "(suites red)"). A reader cannot confirm the ledger's honesty
claim from the deliverable alone; the current-state roster and the gate's red set have diverged.

## Judgment calls recorded (not blockers)

- The two single-failures in cited LANDED suites (CS1-b, R5) are **baseline red-first pins**
  (mcp-dsl-surface #227, no-clock-followons), not regressions — the row is docs-only and touched
  no suite; both fail identically at the base commit.
- `workflow-dsl-package-red` (12/12) could not be confirmed within my windows — reported
  inconclusive, not failed.
- The PLANNED tier's thematic shape with a lossless-catalog pointer (docs/28 + issue tracker) is
  a defensible editorial choice for the *planned* backlog; the objection is only that still-red
  in-flight items were parked there and that 8 items were dropped outright.

## DECISION_REQUEST — authority-class ambiguity

The row's judgment calls #4/#5 authorized a thematic, non-exhaustive capability ledger. The
brief requires "NOTHING deleted without a new home." Are the 8 dropped items (Blocker 1) and the
still-red→PLANNED relocations (Blocker 2) a violation of the binding brief that must be folded,
or are they within the row's recorded editorial authority because the issue tracker + docs/28
remain the lossless catalog and the row cited the tracker + campaign-state report as the
authoritative complete map? Options:

1. **Fold (blocker).** Require a follow-on fold: restore the 8 dropped items to the README
   IN-FLIGHT tier / ledger §5 (or explicitly disposition each — #79 → LANDED with `d8282d0`),
   and reconcile the red-first roster with PROGRESS.md:14's 20 pins so "red set == in-flight
   roster" is verifiable from the deliverable.
2. **Accept with amendment.** Accept the editorial authority but require the notes/ledger to
   explicitly record that the in-flight roster is *subset-by-editorial-choice* and that the
   authoritative current fleet is the issue tracker + campaign-state report (making Blocker 1 a
   documentation omission, not a deletion).
3. **Reject the brief's authority.** If the brief is read to require a lossless in-flight roster,
   options 1 and 2 both apply and the fold is mandatory; this needs operator confirmation because
   gh is unauthenticated here and the live tracker state cannot be independently confirmed.

Recommendation: **option 1** — the fold is cheap (the suites and commit `d8282d0` are the
evidence), the tier mismatch undermines the ledger's central honesty claim, and the row's own
notes claim ("nothing deleted") is contradicted by measurement.
