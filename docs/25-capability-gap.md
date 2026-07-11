# 25 — Researched versus shipped capability gap

This document publishes the capability sweep captured in
`docs/handoff/evidence/capability-matrix.json` and reconciles it with phase 10.1 plus the live
capstones. The matrix is a 107-row snapshot taken at the phase-10 handoff; it is authoritative for
the research inventory, while current code/evidence is authoritative where phase 10.1 changed a
row's implementation status.

## The answer

The gap is real, but it is not one undifferentiated failure to ship:

| Snapshot status | Rows | Meaning |
|---|---:|---|
| `SHIPPED` | 41 | Reachable through `createDriver()` or, for a few protocol details, the exported adapter surface |
| `DELIBERATELY-FENCED` | 22 | Explicitly outside the narrow-waist phase-10 product goal |
| `UNSHIPPED-DEBT` | 44 | Researched and useful, absent from the product path, with no explicit fence |
| **Total** | **107** | Complete matrix inventory |

Debt is 41.1% of the whole inventory. If deliberately fenced scope is excluded, it is 44 of 85
non-fenced rows, or 51.8%—so “roughly half the researched surface” is accurate. Exactly one third
of all non-shipped rows (22 of 66) are deliberate scope discipline rather than forgotten work.

Phase 10.1 does not invalidate the inventory, but it corrects one important clause: session
**wall-time enforcement now ships** under SC18. The rest of the budget/governance row—token/USD
folding, threshold events, hard spend stops, and watchdog action—remains debt.

## What phase 10 actually completed

The shipped control plane is broader than the handoff snapshot implied:

- Claude, Codex, and Grok session adapters are exported, constructed through `createDriver()`, and
  live-proven concurrently on real Baton repository tasks.
- Spawn, streaming, mid-turn steer (native Claude/Codex; explicit emulation on Grok), interrupt,
  approval, kill, worktree isolation, fresh verification, story, and verified-only routing are
  connected at the driver seam.
- Async spawn/stop ownership, terminal monotonicity, queued delivery authority, child reaping, and
  wall-time bounds are contract- and regression-locked by SC12–SC19.
- One Grok adapter ran four live sessions concurrently and proved interrupt/kill/process/worktree
  reaping at its declared ceiling.
- GLM is implemented as the Z.ai-configured Claude session subclass, but live proof remains
  credential-gated and was recorded `PENDING-LIVE`.

That is a complete phase-10 fleet driver, not a complete realization of every researched feature.

## The high-priority debt, grouped honestly

The snapshot has seven high-priority rows. They collapse into four implementation programs.

### 1. Session continuity and branching

Three high rows describe one cross-vendor gap:

- ACP/Grok `session/load` and resume;
- Codex `thread/resume`, `thread/fork`, and rejoin-running-thread; and
- driver-level resume/fork across Claude, Codex, and Grok.

Every vendor has durable-session primitives, but Baton cold-spawns every task. It cannot recover a
worker session after a child/coordinator failure, fork competing approaches, or amortize repeated
orientation. This is phase 11's clearest product-depth step because it uses capabilities already
present southbound.

Coordinator-process persistence was explicitly fenced in phase 10; mid-run vendor-session
continuity was not. Do not hide this debt behind the adjacent non-goal.

### 2. Governance: budgets and watchdog action

Two high rows cover complementary controls:

- **Budget enforcement:** phase 10.1 now enforces wall time, but token/USD usage is not folded into
  handle state, threshold events, alarms, or hard-stop policy.
- **Watchdog action:** story signals can identify stalls/loops/out-of-scope/budget conditions, but
  the coordinator does not consume them to steer or stop a worker. Several real-adapter payloads
  also need normalization before those signals are trustworthy at the driver level.

The live four-Grok test proves manual control at concurrency. It does not prove unattended
governance; four workers can still waste quota together until policy or a human acts.

### 3. Red→green acceptance

The referee can compute `redGreen` and `accept()` can require it. `createDriver()` does not build a
base-SHA verification sandbox or pass it to the referee, so `requireRedGreen:true` cannot accept a
task on the public path. This is the canonical remaining built-but-not-wired acceptance seam.

The implementation must prove the pinned command fails at the base commit and passes at the worker
commit without weakening the mandatory fresh-result sandbox.

### 4. Integration and irreversible-side-effect approval

Verified work ends on `baton/<taskId>`. There is no structured merge/integration phase, conflict
handling contract, or git-push approval gate. The recursive capstone required the operator to
inspect and cherry-pick three verified worker commits manually.

Branch retention is therefore currently functional evidence retention, not a finished lifecycle.
The multi-Grok stress explicitly deleted cancelled-task branches; Baton does not yet decide when a
completed branch is integrated, retained, or discarded.

## Deliberately fenced capability families

The 22 fenced rows should remain fenced until the control plane earns expansion. They include:

- MCP northbound exposure and A2A federation;
- multi-machine/cloud execution backends;
- additional vendor adapters and harness-as-MCP-tool variants;
- capability/knowledge-plane modules whose value depends on recurring usage;
- production-language migration details; and
- the E2 cross-vendor decorrelation evaluation as a separate research program.

Fenced does not mean bad. It means phase-10 completion must not be held hostage by features the
goal explicitly excluded.

## Phase-11 order of pursuit

1. **Governance correctness first:** normalize real usage/action events; update handle budget state;
   emit threshold facts; add policy-driven hard stops and watchdog actions with numbered contracts.
2. **Session continuity second:** specify a vendor-neutral resume/fork/rejoin contract, then map it
   to each vendor without pretending their semantics are identical.
3. **Acceptance depth third:** wire base-SHA red execution into the existing fresh-result referee.
4. **Integration last:** structured merge/conflict handling and explicit approval for push or other
   irreversible effects.

Each program should repeat the earned loop: current-state verification → numbered spec → red tests
→ implementation → adversarial review → live proof. Phase 11 must not silently reclassify debt as
fenced or infer completion from adapter-only tests.

## Evidence

- Row-level inventory: `docs/handoff/evidence/capability-matrix.json`
- Handoff synthesis: `docs/handoff/ISSUE-001-phase10-handoff.md` §6
- Independent recursive recount: `reviews/dogfood/codex-capability-gap-review.md`
- Phase-10.1 correction contracts: `spec/phase10.1/spawn-stop-reconciliation.md`
- Three-vendor live proof: `docs/reference/evidence/phase10.1-capstone-2026-07-10/`
- Four-Grok kill/reap proof: `docs/reference/evidence/grok-multi-reap-2026-07-10/`

