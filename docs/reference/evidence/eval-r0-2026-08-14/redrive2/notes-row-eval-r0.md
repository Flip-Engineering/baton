[attempt: c84cbcbe-878b-4296-af11-8789029d89ad row-eval-r0]
# EVAL-R0 ROW NOTES — row-eval-r0 (wave-c, 2026-08-14)

Issue #107 · pre-registration: `docs/reference/evidence/eval-scoping-2026-08-03/eval-r0-preregistration.md`
(committed 2026-08-07, binding). Companion: `eval-scoping.md` §4 (EVAL-R0b design).

**Status: RUNNING — live arms dispatched. This file is written incrementally; the numbers below
are filled as arms land.** (Wave-b re-drive notes: wave-a's STOP+DECISION_REQUEST was verified
needs-fold; auth was measured present and capacity was to be measured against the live resident —
both done here.)

---

## 1. The protocol, as registered (no post-hoc edits)

The pre-registration (§1–§7) binds the following, quoted or pinned:

- **Question:** Does the baton hub (waves + steering + settlement + trust gate) beat a for-loop
  for the red-first implementation task class at current maturity?
- **Five rungs, re-driven at their base commits** (§2): #64 trust-gate steering (`ac5bd80`/
  base `2f2d23b`, raw mode), #63 KG settlement (`e0f9d57`/base `2e22197`, raw), S-1 wave grammar
  (`480154a`/base `3733096`, planted), DG-1 diagnostics (`6d0ca11`/base `47993f7`, planted), M5
  alias sunset (`bb85e35`/base `bbf6791`, planted). Grader = the same pinned suite, zero weakening.
- **Two arms** (§3): **SOLO** — one member, one task, steering/finalization/settlement all
  `'none'`, no nudges, no claims, no settlement ritual, same brief content; **DRIVEN** — the
  current `implementContract` cadence (nudge-on-checkpoint, claim-on-stall, kg-ritual settlement,
  trust-gate verification). Same seat both arms: `deepseek-v4-flash@high`.
- **Measurement** (§4): sealed CairnRunScorecard per arm per rung — verified-rate (suite green at
  the pinned split) · wall ms · tokens/USD (routed) · interventions byKind/byActor · exact route ·
  the pin sha.
- **Pivot criterion** (§5, verbatim): *"If fleet ≤ solo on verified pass-rate AND fleet > 1.5×
  solo on wall-clock — across the five rungs' aggregate — the hub loses at current maturity and we
  say so, in the report, with the numbers."* A split decision is reported as a split.
- **Preconditions** (§6): replay-harness note (#125 — arms are observational, same live noise,
  infra death → one re-seat, never counted a failure); scorecard verified against #64 landing
  BEFORE the first arm; t0 red-at-base splits recorded.
- **Cost/seat plan** (§7): 10 waves × ~45–60 min ≈ one calendar day at 3-wide on
  deepseek-v4-flash@high; ~2h orchestrator attention for gate validation + scorecard sealing.

**Arm-cadence implementation note (measured, 2026-08-14):** the recipe lane's policy allowlist
(`recipes.mjs` POLICY_FIELDS) has no `settlement` field, and the public `waves.start` lane has no
`worktreeBaseSha`. Both §3 requirements (settlement:'none' for SOLO; base-commit worktrees) are
met with shipped machinery only: SOLO dispatches through `createWaveDriver` with a full policy
(`steering:'none', finalization:'none', settlement:'none'`), and each arm's deployment opens with
`repo` = a detached git worktree at the rung's base commit (node_modules copied — 7.1 MB — and the
two provider key files copied as regular files into the base worktree; the route's readiness check
rejects symlinks, measured). No new orchestration code.

---

## 2. Preconditions (§6) — recorded before the first arm

### 2.1 t0: red-at-base splits (per rung, `t0-red-at-base.sh`, worktree-committed)

| Rung | Base | Mode | tests | pass | fail | evidence |
|---|---|---|---|---|---|---|
| #64 trust-gate | `2f2d23b` | raw | 21 | 7 | 14 | `t0-results/trust-gate.txt` |
| #63 kg-settle | `2e22197` | raw | 24 | 3 | 21 | `t0-results/kg-settle.txt` |
| S-1 wave-grammar | `3733096` | planted from `480154a` | 5 | 0 | 5 | `t0-results/wave-grammar.txt` |
| DG-1 diagnostics | `47993f7` | planted from `6d0ca11` | 8 | 1 | 7 | `t0-results/diagnostics.txt` |
| M5 alias-m5 | `bbf6791` | planted from `bb85e35` | 1 | 0 | 1 | `t0-results/alias-m5.txt` |

All five suites are RED at their base (or base+plant) splits. Method: real detached git worktrees
(not `git archive`, which is pathspec-filtered to empty trees in baton worktrees); current
`impl/node_modules` symlinked into each era tree (untracked; caveat in §6).

### 2.2 t1: grader-ceiling — the grading suite is GREEN at its landed impl commit (`t1-grader-ceiling.sh`)

| Rung | Impl | tests | pass | fail |
|---|---|---|---|---|
| #64 trust-gate | `ac5bd80` | 21 | 21 | 0 |
| #63 kg-settle | `e0f9d57` | 24 | 24 | 0 |
| S-1 wave-grammar | `480154a` | 5 | 5 | 0 |
| DG-1 diagnostics | `6d0ca11` | 8 | 8 | 0 |
| M5 alias-m5 | `bb85e35` | 5 | 5 | 0 |

A suite that cannot pass on the landed implementation is not a valid grader; all five are valid.

### 2.3 Scorecard verification vs the #64 landing (§6.2)

- Pin `refs/baton/results/a1e0a542…` is present; route trailers on the pin verify
  `deepseek:deepseek / deepseek-v4-flash / high`; the era receipt (`impl-receipt.json`) reports
  `outcomes[0].resultSha = a1e0a542…`, basis `completed`, 1 nudge + 1 claim.
- **Full sealed-scorecard recompute is NOT possible in this worktree:** the #64 deployment root
  (`trust-gate-steering-impl-2026-08-02`) has been removed from `.baton/`, so the coordination
  snapshot needed to re-seal `run.scorecard` is gone. The pin identity + route + receipt fields are
  verified; the sealed-document digest is not recomputable from the surviving state. Named as a
  limitation (§6).

### 2.4 Capacity/auth, measured against the live resident (re-drive note 1)

- `deepseek_key.json` (55 B) and `glm_key.json` (64 B) both exist at the main repo root (verified
  on disk; wave-a's §3.1 "auth unavailable" claim was wrong).
- Live probe (2026-08-14): `openBaton` at a detached base worktree → `ready:true`, route
  `deepseek:deepseek-v4-flash@high` state `ready`, auth available. #221 law: no invented seat
  ceilings; typed backpressure is the only queue.

---

## 3. The runs

Arm dispatch (`/tmp/baton-eval-r0-arm.mjs`): per rung per arm, a deployment at the base worktree,
the era brief verbatim (SOLO passes the era `renderedMembers[0].objective` directly; DRIVEN passes
the recovered raw task so the recipe re-render reproduces the same brief at the same byte budget —
the doubled-template attempt exceeded the 4096-byte lane limit and was fixed before re-dispatch),
same seat `deepseek:deepseek-v4-flash@high`, same grading suite as the pinned verification.

| Rung | Arm | idempotencyKey | status |
|---|---|---|---|
| #64 trust-gate | SOLO | `eval-r0-solo-trust-gate-2026-08-14` | **DONE** — verified 21/21 @ `4e6b3d0c` (§4); basis `stall` (driver killed the completed-and-paused worker after the 20-min stall window; §4 note) |
| #64 trust-gate | DRIVEN | `eval-r0-driven-trust-gate-2026-08-14` | **RUNNING** |
| #63 kg-settle | SOLO | `eval-r0-solo-kg-settle-2026-08-14` | **RUNNING** |
| #63 kg-settle | DRIVEN | `eval-r0-driven-kg-settle-2026-08-14` | **RUNNING** (batch 2; first dispatch hit a transient base-worktree lock — `ready=false` at 18:00Z — re-seated 18:02Z, `ready=true`, recorded in §6) |
| S-1 wave-grammar | SOLO | `eval-r0-solo-wave-grammar-2026-08-14` | pending (batch 2) |
| S-1 wave-grammar | DRIVEN | `eval-r0-driven-wave-grammar-2026-08-14` | pending (batch 2) |
| DG-1 diagnostics | SOLO | `eval-r0-solo-diagnostics-2026-08-14` | pending (batch 3) |
| DG-1 diagnostics | DRIVEN | `eval-r0-driven-diagnostics-2026-08-14` | pending (batch 3) |
| M5 alias-m5 | SOLO | `eval-r0-solo-alias-m5-2026-08-14` | pending (batch 3) |
| M5 alias-m5 | DRIVEN | `eval-r0-driven-alias-m5-2026-08-14` | pending (batch 4) |

Dispatch cadence: 3-wide (§7), batches 1→4 as slots free. Each arm's receipts/evidence land in
this directory (`<rung>-<arm>-receipt.json` etc.).

---

## 4. The numbers

_(Populated from `baton-eval-r0-measure.mjs` as arms land. Verified = the independent suite-at-pin
re-run (grader-ceiling at the arm's pinned split) reports GREEN. For the DRIVEN arm the pin is the
harvested `resultSha`; for the SOLO arm (no finalization, by design) the pin is the driver's
`worktree.progress_checkpointed` commit of the worker's final tree — content-addressed, reverifiable,
the honest pinned split of what the for-loop produced. `wallMs` is the driver-measured run wall
(receipt `mtime − startedAt`, both arms the same definition); the SOLO work-completion wall is
reported in parentheses as a secondary observation because the stall-wait after completion is a
driver safety-net artifact, not for-loop work.)_

| Rung | Arm | verified | wall ms (work) | tokens (in/out/cR/cC) | interventions (nudge/claim/decision) | route | pin sha |
|---|---|---|---|---|---|---|---|
| #64 trust-gate | SOLO | **YES** — 21/21 GREEN at pin `4e6b3d0c` | 2,524,334 (work 1,291,000 @17:36:17Z) | 18,323,348 (182k/73k/18,069k/0) | 0/0/0 | deepseek:deepseek-v4-flash@high | `4e6b3d0c` |

## 5. The pivot-criterion verdict

_(Computed from the aggregate across the five rungs when all 10 arms land: if fleet ≤ solo on
verified pass-rate AND fleet > 1.5× solo on wall-clock → the hub loses at current maturity; a
split is reported as a split, never rounded to a win.)_

## 6. Limitations (every one named)

1. **N=5 rungs is a scoping number, not a publication number** (eval-scoping §4).
2. **No replay harness (#125):** arms are observational — both face the same live-environment
   noise; provider drift is an uncontrolled confound. Same-week paired execution mitigates but
   does not eliminate.
3. **Infra death → one re-seat, recorded, never counted a failure of the arm** (§6).
4. **USD is an estimate, not measured** — no list price is pinned in-repo; tokens are measured
   from the routed session transcripts, USD stays at §7's low-two-figures claim.
5. **Scorecard full-seal not recomputable** for #64 (deployment ledger removed; §2.3). The live
   arms' receipts are content-addressed and reverifiable, but the `run.scorecard` seal for the
   era #64 landing is not re-mintable from surviving state.
6. **t0/t1 use the current `impl/node_modules`** symlinked/copied into era trees (untracked) —
   dependency drift between eras is not controlled (same caveat the coordinator's wave-a
   verification accepted).
7. **One seat** — no cross-vendor claim (E2 untouched, still demands its own corpus).
8. **SOLO arm cadence via `createWaveDriver` directly** (not `recipes.implementContract`): the
   recipe lane has no `settlement` policy field, so the for-loop arm is dispatched through the
   shipped driver with a full all-'none' policy. Same driver, same wave machinery, one lane.
9. **DRIVEN arm brief re-render:** the raw epic task is recovered from the era rendered objective
   so the recipe wrapper's re-render reproduces the same content at the same byte budget; the
   attempt-salt line necessarily differs (fresh per run).
10. **Provider 429s / backpressure** are retried + ledgered per #221; any arm that dies of
    infrastructure is re-seated once and recorded.
11. **Dispatch-time transient lock (recorded, 2026-08-14):** the first kg-settle-DRIVEN dispatch
    (18:00Z) returned `ready=false` at `openBaton` while kg-settle-SOLO's worker held an active
    nested worktree on the shared base worktree; a fresh probe on the same base returned
    `ready=true` a minute later. Re-seated 18:02Z (`ready=true`) and run to completion — counted
    as the §6.3 one re-seat, not a failure of the arm. The trust-gate pair shared its base with no
    such failure, so this is a contention window, not a systematic defect.

---

_Evidence: this directory's `t0-results/`, `t1-results/`, the arm `<rung>-<arm>-receipt.json`
files, and the deployment ledgers under the main repo's `.baton/eval-r0-redrive2/<rung>-<arm>/`._
