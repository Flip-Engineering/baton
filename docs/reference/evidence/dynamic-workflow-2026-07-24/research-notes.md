# Research notes — AX (agentic-experience) frictions and gaps

**Seat:** RESEARCHER (glm) · **Workflow:** dynamic-workflow-2026-07-24 (researcher / kimi-drafter / sonnet-critic).
**Method:** read-only mining of committed evidence. **Sources:** `docs/reference/evidence/**`
(driver logs, fold ledgers, red-team reports, acceptance reviews) and `reviews/*.md`. **No `gh`
calls** (no auth). Every friction below is grounded in a committed file path or issue/commit.

Nine distinct AX frictions surfaced, grouped by failure locus. Each is cross-tagged with its
scratchpad id (`AX-N`). The drafter/critic should treat the **group** as the unit of the AX
narrative and the `AX-N` id as the atomic, citable claim.

---

## Group A — Wave / driver execution does not fail loudly (AX-0, AX-1)

The wave driver can neither confirm success nor explain a pause; an operator learns both only by
inference from a log tail.

- **AX-0 — implementer stalls to the watchdog with no artifact.**
  `docs/reference/evidence/grammar-2026-07-24/m1-wave.log` closes with
  `outcome grammar-m1-implementer: phase=running sha=none` after a ~6600 s watchdog
  (`progress 6609s … =running`, then `watchdog`). A long implementer run produced **no commit**
  (`sha=none`); the wave's only signal of the failure is the watchdog timeout itself. There is no
  mid-run "produced-nothing-after-N-minutes" health check distinct from the wall-clock kill.
- **AX-1 — pause reason is opaque in telemetry.**
  `docs/reference/evidence/grammar-2026-07-24/m0-wave-attempt4.log` repeatedly emits
  `progress 5906s grammar-m0-implementer=paused[[object Object]]`. The pause payload is stringified
  as `[object Object]`, so an operator reading the log cannot tell *why* the seat paused — the very
  field that would triage the stall is unrendered. (Same log also ends `phase=paused sha=none`.)

**AX thread:** the driver reports *that* a seat is alive/stuck but not *what it is doing or why it
blocked*. Both a missing-artifact run (AX-0) and an unexplained pause (AX-1) reduce to "read the
log until the watchdog fires."

---

## Group B — Fleet scheduling & seat contention are uncoordinated (AX-2, AX-8)

Two seats doing concurrent work collide in different ways; neither collision is prevented by the
scheduler, only noted after the fact.

- **AX-2 — concurrent controllers re-do already-finished work.**
  `docs/reference/evidence/grammar-2026-07-24/FOLD-STATUS.md` records that the seat committing
  `fa71aea` (`run-revise-wave.mjs`, an opus fold wave) targeted the docs/35 fold that was **already
  at v2 FINAL** (`0c5c970`), and the standing controller had to leave a coordination note pleading
  *"Please do not land a second competing v2 of docs/35; amend by follow-up findings instead."* No
  seat-lock / claim on the artifact prevents the redundant wave from launching.
- **AX-8 — model slots are silently lost to a concurrent seat.**
  Driver commit `e790825` records the M3 GLM seat being dropped because the *"GLM slot occupied by
  the concurrent #46 seat."* A scheduled model seat loses its infra slot to another concurrent seat
  with no arbitration surfaced to the operator — the seat just does not run.

**AX thread:** the fleet has no claim/arbitration layer over *artifacts* (AX-2) or *infrastructure
slots* (AX-8), so concurrency produces duplicate work and silent no-ops that are discovered only
post-hoc.

---

## Group C — Per-vendor credential & capability-gating brittleness (AX-3)

Whole model seats drop out on auth expiry or on gates that cannot be proven, forcing last-minute
seat swaps (e.g. the documented `kimi→opus` M3 substitution).

- **AX-3 — credentials expire mid-run; thinking gating is unprovable per vendor.**
  Driver commit `7de3a36` records *"grok token expired 28min post-login"* and *"kimi thinking
  unprovable"*; `29769c1` records *"kimi@low … @high fails: auth/thinking gating unproven at high"*;
  `e790825` records *"kimi thinking-proof down at every effort."* A model seat can thus be lost not
  to a fault in the work but to (a) a short credential window expiring inside the run or (b) a
  thinking/effort gate that the harness cannot prove open, so the seat is de-scoped rather than
  driven.

**AX thread:** vendor readiness is the dominant AX risk for a heterogeneous fleet — credential
lifetime and per-vendor capability proof are first-class operational concerns, not setup details.

---

## Group D — Resource governance is wired for observation, not control (AX-4, AX-5, AX-6)

The control plane can *see* misbehavior but does not *act* on it; and crashed/stalled workers cannot
be cheaply recovered.

- **AX-4 — budget enforcement is observation-only.**
  `reviews/dogfood/codex-capability-gap-review.md` (grounded in `capability-matrix.json`) records
  that token telemetry is logged but `handle.budgetUsed` stays **zero**, `resource.budget_threshold`
  is **never emitted**, and the `wallMin`-derived session timeout is **ignored**. Available usage
  inputs produce no threshold alarm, hard stop, or wall-clock bound — a live worker can consume
  time/quota until a human intervenes.
- **AX-5 — watchdog signals are computed but never drive a control action.**
  The same review records `story.signals()` computing stalled / looping / over-budget /
  out-of-scope attention that **the coordinator does not consume** to interrupt or stop, plus
  producer/consumer mismatches: digest-health and budget event kinds are *"listened for but not
  emitted."* The diagnosis ("signals without a control loop") is an AX gap: detection exists, action
  does not.
- **AX-6 — no general worker resume/fork path.**
  The same review records **cold-spawn cost on every task**, **no mid-run worker crash recovery**,
  and **no fork-and-explore workflow**, because the coordinator exposes no general resume/fork
  command even though native resume/fork/load exists across Claude/Codex/Grok. Every task pays full
  spawn cost; a crashed mid-run worker cannot be resumed.

**AX thread:** the three form one governance debt cluster — *budget* (AX-4), *watchdog action*
(AX-5), and *session continuity* (AX-6) — all "UNSHIPPED-DEBT, high priority" in the matrix,
collectively the blocker for unattended workers.

---

## Group E — Validation & review records go stale and must be actively retracted (AX-7)

The system's own truth-keeping documents lag the code, and stale review claims persist until someone
re-grounds them.

- **AX-7 — counts freeze and prior reviews overstate gaps the repo has since closed.**
  `reviews/dogfood/claude-validation-review.md` shows `impl/VALIDATION.md` suite counts frozen at
  **372/372** while the live suite is **427/427**, and lists twelve claims that must be
  retired/upgraded/rewritten (the record "must be rewritten, not appended").
  `reviews/dogfood/codex-ck9-crash-window-review.md` documents a previously **accepted** review that
  *"materially overstated gaps that the repository now contradicts"* and must be reclassified from
  `major` to `no finding`, and separately warns against relying on unevidenced suite-count rhetoric
  ("567 tests").

**AX thread:** the AX surface includes the *meta*-record — validation docs and red-team verdicts
decay, and stale accepted findings actively mislead unless re-grounded against current seams.

---

## Cross-cutting note for the drafter

The strongest single-sentence framings for the report's headline are the two where detection and
action are split: **AX-4/AX-5** ("the harness can observe a runaway worker but cannot stop one")
and **AX-0/AX-1** ("the driver reports *that* a seat is stuck, never *why*"). The fleet/scheduling
pair **AX-2/AX-8** is the concurrency-coordination gap; **AX-3** is the vendor-readiness gap; **AX-6**
is the recovery-cost gap; **AX-7** is the record-truth gap.

## Evidence index (read this turn)

- `docs/reference/evidence/grammar-2026-07-24/m1-wave.log` (AX-0)
- `docs/reference/evidence/grammar-2026-07-24/m0-wave-attempt4.log` (AX-1)
- `docs/reference/evidence/grammar-2026-07-24/FOLD-STATUS.md`, `fold-ledger.md` (AX-2)
- `reviews/dogfood/codex-capability-gap-review.md` (AX-4, AX-5, AX-6)
- `reviews/dogfood/claude-validation-review.md`, `reviews/dogfood/codex-ck9-crash-window-review.md` (AX-7)
- Driver commits `7de3a36`, `29769c1`, `e790825` (AX-3, AX-8)

*Spec-level red-team findings (R-CX/R-KM/R-OP in `grammar-2026-07-24/redteam-*.md`, all folded in
`fold-ledger.md`) were reviewed but are document-correctness findings against docs/35, not
agent-experience frictions, and are deliberately excluded from the AX set above.*
