# 25 — Researched versus shipped capability gap

This document publishes the historical capability sweep captured in
`docs/handoff/evidence/capability-matrix.json` and reconciles it with phase 10.1 plus the live
capstones. The matrix is a 107-row snapshot taken at the phase-10 handoff; it is authoritative for
the research inventory, while current code/evidence is authoritative where phase 10.1 changed a
row's implementation status.

**Current status has moved on.** Phase 28 supersedes this document's status counts with
`docs/28-exhaustive-capability-audit.md`; this file and its 107 rows remain the preserved research
inventory and historical baseline.

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

The row counts remain a historical phase-10 snapshot, not a current shipped count. Phase 11 has
since shipped exact orchestrator-level model selection, persistent follow-up/resume/fork/recovery,
isolated runtime homes, canonical token/USD thresholds and hard stops, deterministic watchdog
actions, red→green/changed-line coverage/mutation gates, independent oracle provenance,
fast-forward integration, and approval-gated publication. Current code/evidence overrides the
older row status wherever those capabilities appear.

Phase 29 additionally ships the capability-plane narrow waist: deployments can register existing
Atlas modules with explicit bounds and trusted contexts; Coordinator owns invocation; authenticated
web and MCP expose cards plus durable invoke/resume/reverify. This does not auto-enable every Atlas
module or make later Vantage/Evidence/Skill/Cartographer/Cairn products complete.

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

## Former high-priority debt, reconciled honestly

The snapshot has seven high-priority rows. They collapse into four implementation programs.

### 1. Session continuity and branching

Three high rows describe one cross-vendor gap:

- ACP/Grok `session/load` and resume;
- Codex `thread/resume`, `thread/fork`, and rejoin-running-thread; and
- driver-level resume/fork across Claude, Codex, and Grok.

This now ships. Public follow-up turns reuse an attached verified session; Claude and Codex map
native resume/fork, Grok maps `session/load`, restart replay treats stored identities as orphaned,
and explicit bounded recovery requires a fresh exact-identity handshake plus validated worktree
ownership. Automatic startup rejoin and Grok-native fork/rewind remain debt.

### 2. Governance: budgets and watchdog action

This now ships at the per-task/runtime-scope level. Canonical usage deltas drive durable 50/80/100
percent threshold facts and confirmed hard stops; deterministic stall, repeated-failure loop, and
out-of-scope edit rules invoke bounded interrupt/kill. Private runtime homes strip ambient secrets
and project only explicit credentials. Proactive account quota-window and fleet-seat scheduling
remain debt.

### 3. Red→green acceptance

This now ships through `createDriver()`: distinct fresh base/result sandboxes prove the pinned
command is newly green; actual changed lines are compared with reported execution; and an optional
mutation command must report a nonzero all-killed population when required. Independent oracle or
review tasks receive immutable spec/Git evidence and record reviewer vendor/model family; a
same-family fallback cannot satisfy a required oracle gate.

### 4. Integration and irreversible-side-effect approval

The first safe vertical now ships. `integrate()` reaps the accepted worker and applies only an
explicit clean fast-forward; divergence/dirty state refuses without rewriting history and retains
a durable result ref. A separate single-consumer, timeout-bound, fence-checked publication
approval targets an exact integrated SHA, credential-free remote name, and full branch ref. No
approval means no push, and restart drops pending publication authority. Semantic conflict
handling, stacked integration, deploy adapters, and live remote-push proof remain debt.

## Historical Phase-10 fences (status superseded by doc 28)

This section records the Phase-10 decision boundary; it is not current status. Since then Baton has
shipped MCP stdio, the authenticated web northbound, durable coordination/knowledge, broad Atlas
representation rungs, structured integration, and the coordinator-owned ACI registry. Current
shipped/partial/pending status lives in `docs/28-exhaustive-capability-audit.md`. The original 22
fenced rows included:

- MCP northbound exposure and A2A federation;
- multi-machine/cloud execution backends;
- additional vendor adapters and harness-as-MCP-tool variants;
- capability/knowledge-plane modules whose value depends on recurring usage;
- production-language migration details; and
- the E2 cross-vendor decorrelation evaluation as a separate research program.

Fenced does not mean bad. It means phase-10 completion must not be held hostage by features the
goal explicitly excluded.

## Historical order of pursuit and current continuation

Items 1, 2, the ACI registry portion of 3, major bounded portions of 4, MCP stdio, and authenticated
HTTPS/SSE control from item 5 have shipped. The current continuation is: close audited ACI contract
drift; build Cairn Rung 0 and Cartographer/Quartermaster on the shared substrate; then Vantage,
Evidence Ladder, and Skill Forge/computer use; deepen session/governance/northbound production
surfaces; and pursue conditional representation research only through its explicit Decisions.

Each program repeats the earned loop: current-state verification → numbered spec → red tests →
implementation → adversarial review → live proof. No phase may infer completion from adapter-only
tests or introduce a homelab runtime/integration dependency.

## Evidence

- Row-level inventory: `docs/handoff/evidence/capability-matrix.json`
- Handoff synthesis: `docs/handoff/ISSUE-001-phase10-handoff.md` §6
- Independent recursive recount: `reviews/dogfood/codex-capability-gap-review.md`
- Phase-10.1 correction contracts: `spec/phase10.1/spawn-stop-reconciliation.md`
- Three-vendor live proof: `docs/reference/evidence/phase10.1-capstone-2026-07-10/`
- Four-Grok kill/reap proof: `docs/reference/evidence/grok-multi-reap-2026-07-10/`
- Phase-11 acceptance/integration proof: `docs/handoff/evidence/phase11-acceptance-integration-2026-07-11.md`
