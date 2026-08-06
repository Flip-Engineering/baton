# Orchestrator friction ledger — the frontier sweep, 2026-08-03/06

Every friction the orchestrating model (kimi) actually hit while running the sweep, each mapped
to the level of change that would have prevented it. Sources: the campaign's own receipts, live
waves, and the two demo builds. Nothing here is speculative — each entry cites its receipt.

## Design level

| Friction | Receipt | Filed |
|---|---|---|
| Harvest-by-hand: pin-parent trap (fake 6117-line deletion diff), git apply + three-way merge surgery per wave | two trap hits pre-discipline; application-deployment export-tail + invokeCapability conflicts resolved by hand | **#99** (run.result / waves.harvest accessor) |
| Poisoned idempotency key → attach into the memberless dead wave (`wave_attach_unknown_wave`, no coaching) | readiness/orientation relaunches post-disk-fix; driver keySuffix workaround (a9fc8e2) | **#100** |
| Startup capacity-lock race: simultaneous openBaton deployments fail closed at boot reconciliation | three-wave launch, 2 failed closed; ≥60s stagger workaround | **#100** |
| Recipe-render 4096 objective wall (the wave refused at render; #89's spill covers startWave, not recipes) | frame-economics launch failure, 4116>4096 | **#101** |
| Hand-rolled poll loops in every driver (status→approve→nudge→claim + message/elevate/decision) | #94 demo's loop is the fifth bespoke copy | **#106** (declarative steering policy lanes) |
| Program IR absent: the methodology itself (contract→…→wave→harvest→gate) lives in the orchestrator, not the product | worker AX feedback: "the Program IR is the right answer; it just doesn't exist yet" | #9 (trunk, queued) |

## Context-engineering level

| Friction | Receipt | Filed |
|---|---|---|
| Orchestrator re-derives campaign state every wake (8KB hand-written resume prompt) | the 22:49 wake cron; the re-grounding atlas campaign | **#103** (orchestrator briefing pack) |
| Line-number citations drift ±40-200 per landing; fold agents re-verified ~90 anchors twice | every fold summary's drift tables | **#104** (symbol-cited briefs, resolve-at-read) |
| Workers re-derive the world per task; knowledge rated 2/5 downstream | docs/PROGRESS.md downstream verdict; BD3-A landed the read port, briefing composition isn't automatic | #68 ✓closed (read port); the composition half rides #103's shape for workers |
| Cross-run horizon gap: wave members can't read each other's tiers | discovered mid-demo-design; re-seed workaround | **#96** |
| Re-drive continuity (dead attempt's context into the next attempt) | acceptance retries re-briefed from scratch | #59 (existing) |

## Collaboration layer level

| Friction | Receipt | Filed |
|---|---|---|
| Reply depth 1: a worker's answer can't raise a follow-up conversationally | BD3-C v1 design choice; felt in the demo's one-shot replies | **#105** (budgeted reply chains) |
| Message to a spawning member throws untyped TypeError (not run_not_active) | demo retry-1, mcp/grammar members | **#97** |
| Worker can't reach the OPERATOR (only the orchestrator); no escalation to human attention | decision lane covers orchestrator; operator escalation is #90 (remote, low) / #71 (wake) | #71 commented |
| Ceiling serialization is invisible (member blocked on harness ceiling projects nothing) | demo retry-2: 90s of silent deferrals | #49 + #10 commented (waiting-on vocabulary) |
| Workers can't see each other cross-run (peer reads within a workflow) | demo's elevate + re-seed workaround | #96 + #102 (tight cells sidestep it by construction) |

## REPL level

| Friction | Receipt | Filed |
|---|---|---|
| Shared objects don't exist: the canary/assignments were hand-seeded per runId (4 calls); findings hand-elevated + re-seeded | the #94 demo's step 2/3/6 mechanics | #69 commented (the demo as the gap's live shape) |
| The workflow is imperative script, not data — no replay, no content-addressing, no mid-flight inspection of the WORKFLOW itself | the demo driver is the fifth bespoke orchestration script | #9 / #106 |
| Object-passing across the orchestration layer (context/memory into per-worker or shared objects) | canary-by-seed, never by binding | #69 / #102's group bindings |

## Diagnostic / environment-understanding level

| Friction | Receipt | Filed |
|---|---|---|
| Blocked vs working is indistinguishable (ceiling, spawn-window, stream death, stall blindness) | #49 #50 #55 #97 receipts this week | #10 commented (waiting-on vocabulary) |
| Live-wave debugging = python over raw w-*.jsonl (kind-filtered reads don't exist on the surface) | demo retries' diagnosis loops | #91 commented (--kinds filter) |
| Gate load-flakes (#7 cluster) re-run in isolation by hand every gate | 5 isolated re-runs this sweep (kimi-acp, SC18, DC4/DC5, phase92…) | #7 / #77 (existing) |
| Disk-full refusal was coached but nothing WARNED before it (capacity floors invisible until dispatch refuses) | the 416MiB incident | #72 (prescriptive doctor, existing) |
| Cross-deployment blindness (dozens of deployment roots; no inventory across them) | the campaign's .baton/ root accumulation | #70 adjacent |

## The meta-lesson

The five lenses converge on one diagnosis: **the kernel learned to work; the surfaces haven't yet
learned to say what's happening.** Every landed epic this sweep (BD3, workflow-surface, frame-
economics, claim-preflight, orientation, readiness, board, browser) made the machinery MORE
capable; every friction above is the machinery's state not reaching the agents that drive it.
The next ring's weighting should follow that: blocked-state vocabulary, briefing packs, symbol
citations, declarative steering, and the harvest/result accessors are worth more to the fleet's
throughput than any single new capability — they're what make the existing capabilities *usable*
at orchestration speed.
