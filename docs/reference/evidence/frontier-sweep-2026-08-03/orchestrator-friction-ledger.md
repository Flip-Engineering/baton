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

## Appendix A — frictions accrued after the ledger's first writing (2026-08-06)

| Friction | Receipt | Disposition |
|---|---|---|
| Sanitization leak: an indiscriminate `cause.message` into MCP tool errors leaked private provider detail | #87 harvest, MN1/MN8 failing | fixed in the harvest (typed-refusals-only coaching, FP-15 preserved) |
| Spawn-race TypeError in the new message lane | demo retry-1, mcp/grammar members | **#97** + folded into the #10 contract (worker_spawning typed refusal) |
| Ceiling-1 per-harness serialization invisible at wave level | demo retry-2, 90s silent deferrals | #49 commented + #10's capacity_ceiling kind |
| Harvest matcher: pins carry Baton-Task trailers, never the salt — content-addressed matching required | demo retry-3/4 | fixed in-driver; the surface answer is #99 |
| Elevation step's status-view shape assumption (taskId/workerId absent at poll phases) | demo retry-4 diagnosis (the scratchpad.read lane itself verified working) | fold into #99/#91's investigation surface (member binding projection) |
| Spec-wave salt-matcher miss (a contract that doesn't quote the salt) | spec-wave harvest | same class as the demo's — the #99 accessor ends matcher-by-convention |
| Recipe-render 4096 wall refused a wave at launch | frame-economics launch, 4116>4096 | **#101** |
| phase92 narrow-index pin's stub broke on the spill-resolution seam (a sanctioned contract seam) | #89 harvest | restaged with the seam bound; lesson: partial-object stubs enumerate what the pinned path may touch — new seams must update the stub |
| MCP surface-truth pins moved by the six new tools (phase16/mcp-reflex/phase72/phase67) | #87 harvest | restaged — the conformance regeneration worked as designed |
| Demo loop deadline beat by a slow member (cli-surveyor's work survived via checkpoint pin) | demo retry-3 | the durability machinery proven; driver deadlines are my own walls, not product behavior |
| glm synthesis member suspected of the 20-min stream death mid-synthesis | demo retry-4 (lead never completed post-gate) | #50 suspected live; the waiting-on vocabulary (#10 contract) is the honest surfacing |

The pattern continues: every entry is a surface not saying what it knows. The R0a tabulation added a quantitative note: median 2 nudges per outcome across 33 receipted outcomes — the steering machinery is doing quiet routine work on nearly every wave; none of it was visible until receipts were read by hand.

## Appendix B — frictions accrued during the Ring 4 pipeline (2026-08-06)

| Friction | Receipt | Disposition |
|---|---|---|
| The ceiling was TWO-layered: the class default AND an explicit construction-site literal — fixing one left the other masking it (the suite wave's members 2-4 never spawned, caught only by event-counting) | ef84435 (class) → the construction-site fix (application-deployment.mjs:843) | a policy value must exist ONCE — the limits-registry class (#89's doctrine): the construction site should derive, never repeat a literal. Fold into the registry's remaining consolidation |
| The harvest content-matcher missed a THIRD time (spec wave, AX wave, suite wave — all recovered by pin-path probing) | suite-wave verdict 'harvested: none' despite all four members complete | #99's whole point; the fleet drivers adopt the harvest lane the moment it lands |
| The kimi-quota 403 cascade killed five subagents mid-tool-call (twice) — my own harness has no graceful degradation; agents need manual resume | agents 85-90 403'd | OPERATIONAL LESSON: baton waves handle provider death with re-drive/attach (93B); my kimi subagents don't. The fleet-wave model is strictly more durable — the pivot (kimi orchestrates, fleet authors) is the answer and it held |
| Landed epics carried live-surface bugs their suites didn't pin: attention.watch silently dead for the documented MCP principal; the coaching shape dropped by both northbound transports | AX-review wave (#108-112) | DISCIPLINE FOLD: surface suites must pin every documented principal's path (not just wave-owner) and both transport levels (in-process + MCP/web), or the lane is suite-green and surface-dead |
| The ceiling serialization is invisible at the wave level — again | suite wave retry-1 (only w-1 spawned) | #10's capacity_ceiling kind covers it; the wave got no signal until I counted events |
| A driver string-literal typo failed node --check before launch | the waiting-vocabulary lane's first launch | the pre-launch check worked as designed — a friction that caught itself |

The pattern from the meta-lesson continues to hold: the newest frictions are all *visibility* frictions (the two-layer ceiling, the invisible spawn serialization, the unharvested pins, the silently-dead lanes) — the machinery knows and nobody's told.

## Appendix C — reflective frictions from the resident-integration session (2026-08-06, filed #134-#139)

The session where the orchestrator (kimi) moved into a standing resident deployment — the frictions are all from *becoming a participant*, which is why earlier lanes never hit them.

| Friction (witnessed) | Cost | Filed |
|---|---|---|
| fold-114 v1 harvester declared FOLD-114-OK from a STALE pin (the wave had zero runs — #129 — and the harvester attributed the earlier WAD wave's pin by path-presence). Only a manual `grep -c v1.1` caught it. Every interim driver carries the wrong-wave attribution bug; the generic `run-task-wave.mjs` inherits it. | a silently-fake "successful" fold, minutes from being committed | #134 (interim waveId-binding + attempt marker; structural fix stays #114/#99) |
| `baton serve` produced ZERO output for ~4 min on first start while burning CPU — no binding/listening/self-check/publish staging. Diagnosed via `lsof` + `sample`. | resident startup reads as a hang; setup polled mid-window got `profiles: missing` | #135 (staged stderr readiness lines) |
| `baton runs list` bare refuses `application_run_list_continuation_required` — and the CLI parser accepts NO cursor argument, so the verb is unreachable-by-design on the CLI; the refusal names no next action. | the catalog read is dead on the human surface | #136 (promotes #131's spec-F5 — sharper: the CLI parse gap) |
| `baton setup` during resident startup reported `profiles: missing` + directed to `create_profile` — which would have raced the resident's own self-publication seconds later. | onboarding misdirection at the exact first-run moment | #137 (resident-starting detection) |
| Both MCP entries are stdio-only; `baton-mcp-web`'s legacy factory builds a THROWAWAY mkdtemp CoordinationStore per process. A process-per-call orchestrator (kimi's Bash) can never hold the wave lane — the only northbound with waves (#132) requires a persistent parent. | the wave lane is unreachable for the orchestrator class baton is built for | #138 (stateless HTTP MCP endpoint on the resident) |
| The `/v1/commands` envelope cost a source dive: `{"name":...}` refused `unknown_top_level_field` without naming the field; the required-field branch withholds which field is missing; the dots→underscores transport spelling is undocumented at the edge. The validator KNOWS the field (`web-northbound.mjs:349`). | every new bus caller re-dives the source | #139 (#41-pattern: name the field, never the value) |

The Appendix-B meta-lesson holds a third time: **every one of these is a visibility/naming friction, not a capability absence.** The machinery knew (the validator had the field, the resident had the stage, the harvester had the waveId available) — the surface didn't say.

## Appendix D — frictions accrued during the #105-gate + fold-sweep session (2026-08-13)

| Friction (witnessed) | Cost | Filed / disposition |
|---|---|---|
| Two suite-fold launches listed the contract as an allowed deliverable in the brief but NOT in the driver's `--targets`; both workers edited the contract (v1.2) and the harvest silently dropped the edit — caught only because the fold-map referenced "contract v1.2" while the tree file read v1.1. Recovered both times by pin-diff (`git diff <pin>~1 <pin> -- <path> | git apply -`). | near-miss on two landings; recovery ~10 min each | LAW (folded into #142's doctrine): any brief that names a deliverable must have that path in `--targets`; suite-fold launches ALWAYS include the contract file. The driver should refuse when brief deliverables exceed targets — candidate row for the driver's next rung |
| The resident's local token returned `unauthenticated` on byte-identical envelopes ~24h after incarnation publish, mid-pump — no expiry surface, no renewal verb, no named fence. The pump loop ran 25 blind iterations because it never printed non-ok responses. | the #61 re-drive cancelled by the forced restart (third attempt needed); orchestration control lost for the window | #148 (resident credential lifetime + programmatic renewal); DRIVER LAW: any loop over the bus must log the full non-ok envelope and stop on repeated auth failure — never retry-blind |
| `phase56-drain-and-close` red in the full gate, then red-green-red across isolated re-runs (DC2/DC4 once, DC4/DC5 once — both `coordinator_drain_incomplete` deadline crossings under wave-spawn load), then green ×2. Different rows fail per run — the signature that distinguishes the #7 load-flake cluster from a regression is **which** rows move, not just that failures move. | one #105 commit held ~40 min for flake proof | Documented #7-cluster members (DC4/DC5 already ledger-named in Appendix A); acceptance rule of thumb: isolated greens must bracket the load failures, and the moving-row signature is the tell |
| The #105 full-gate acceptance required hand-tabulating the failure distribution from a 700KB log (`grep "^✖"` + per-file attribution) — the gate emits no machine-readable failure digest to diff against the expected red-suite set. | ~15 min of log archaeology per gate, error-prone | #149 (gate closing digest — failing-file set + counts + hash, diffed against the declared red-suite roster; folds into #77's governance lane, D2-class) |

The meta-lesson extends: the machinery knew (the harvester had the pin, the server had the fence, the gate had the tally) — the surface still doesn't say. The fourth recurrence of this pattern across appendices is itself the finding: **visibility work is not polish; it is the majority of orchestrator cost.**
