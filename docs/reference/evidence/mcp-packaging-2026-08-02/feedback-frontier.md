# Downstream Baton Worker Review: Frontier Features After #62/#63/#64

- **Reviewer role:** Downstream worker reviewing own integrated experience
- **Review date:** 2026-08-02
- **Epics in scope:** #62 write-failure visibility · #63 KG settlement · #64 trust-gate steering
- **Angle:** Are the FRONTIER features integrated or siloed?
- **Method:** Receipt-grounded (file:line where possible), concrete failure/friction stories where not
- **Scope note:** Read-only review of impl/; only write target is this report.

## TL;DR — verdict box

| Area | Score | One-line justification |
|------|-------|------------------------|
| 1. KG tiered loop (scratchpad→elevation→candidacy→admission→ambient) | **3** | Tiers 1–4 now run automatically by default in the shipped driver, but tier 5 (admission) is an explicit orchestrator act with zero worker feedback, so it stays a mechanism awaiting the promotor's habit. |
| 2. S-2 boards (shared task list vs KG ritual) | **2** | The board is a fully-built orchestrator ledger with MCP tools, but the worker half (board.claim/report) is a surfaceless registry ghost — shared-task-list reality is unrealized. |
| 3. REPL (manifest/binding/cite) | **2** | Plumbing is suite-green and cite reached MCP, but manifest/binding are embedded-only and worker-scoped, so the shared-objects-across-the-orchestration-layer vision is 30% realized. |
| 4. ATLAS/cartographer + context program (cells/calls) | **2** | A verification aid (trust-gate structural evidence) that orchestrators do not reach for daily — context_eval's own seam admits web/MCP/generic dispatch "do not yet". |
| 5. Worker-to-worker channels | **2** | Everything routes through the orchestrator; the shared-scratchpad relay is the only lane and it is write-only-push, while the designed claim/report handoff sits surfaceless. |

Score key: 1 = hostile (fights you), 3 = neutral (works if you remember), 5 = invisible-in-a-good-way (habit-free).

## Evidence consulted

- [x] docs/PROGRESS.md — the arc (lead ledger lines cited inline)
- [x] docs/reference/evidence/kg-tiered-loop-2026-08-01/kg-loop-verdict.md
- [x] docs/reference/evidence/kg-tiered-loop-2026-08-01/kg-loop-live-receipt.json
- [x] docs/reference/evidence/kg-tiered-loop-2026-08-01/kg-loop-surveyor-report.md
- [x] docs/reference/evidence/trust-gate-steering-2026-08-02/ (trust-gate-steering-decisions.md, acceptance-reader-report.md, redteam-authority.md)
- [x] docs/reference/evidence/kg-settlement-2026-08-01/kg-settlement-decisions.md
- [x] docs/reference/evidence/dynamic-workflow-2026-08-01/phase2-relay.json
- [x] This evidence dir: mcp-packaging-2026-08-02/ (mcp-packaging-decisions.md, test-blueteam.md, run-feedback-wave.mjs)
- [x] impl/ anchors (read-only): application-semantics.mjs, mcp-northbound.mjs, coordinator.mjs, recipes.mjs, context-runtime.mjs

## 1. The KG tiered loop — living system or mechanism awaiting habit?

### What was promised (arc from PROGRESS.md + kg-loop-verdict.md)

The verdict names the full stage chain: *worker scratchpad (task-ephemeral) → orchestrator elevation to the shared workflow partition → board-close candidacy → lease-gated admission (verified Finding in the project KG) → workflow settle → horizon digests* (kg-loop-verdict.md:3–5). That demo ran **live once**, every step receipted (`kg-loop-live-receipt.json`: three `scratchpad.write_result ok:true`, elevation `settled` with shared fence 0→3, `run-orchestrator-lease:9359f886…`, `board-item:031d7553…`, `finding:workflow-admitted…`, horizon nodes 4→7). The verdict's own F1 named the honest state at that moment: **zero live call sites** for `elevateTaskScratchpad` / `settleWorkflowScratchpad` / `admitWorkflowFinding` — reachable only from store-level tests, refused by `run_stopping` after close, and the shipped wave driver always stops members first (kg-loop-verdict.md:30–39). "The loop can NEVER execute in a real workflow." #63's settlement epic productized exactly that shape into the driver (`settlement: 'kg-ritual'` default, settle-window sweep/elevate/candidate, kg-settlement-decisions.md D3).

### What I actually experienced as a downstream worker

Post-#63, the lower four tiers are now **habit-free by construction**: my wave runs under the shipped driver (`run-feedback-wave.mjs` in this evidence dir, three reviewer members via `waves.start`), and if any member writes a `note`, the driver's settle-window hook elevates it and posts a candidacy item before close — no one has to remember (kg-settlement-decisions.md:59–90, default `'kg-ritual'`, honest-empty when no entries). That is the single biggest integration win of the three epics: the loop stopped being a hand-assembled demo and became driver behavior.

What is still mechanism, not habit, is **admission**. D5 is explicit: *"No auto-admission anywhere; admission is D2's explicit command only"* (kg-settlement-decisions.md:114–115), and the four settlement commands are embedded-only, top-level-orchestrator-only, deliberately absent from `recursiveEffectCommands` and `RUN_ORCHESTRATOR_CAPABILITIES` (kg-settlement-decisions.md:51–55). So the chain ends in a **candidacy queue that waits on a human forming the review habit**. As a downstream worker I have no read port to know my notes became Findings — D5 also bars it: *"No worker-facing read port"* (kg-settlement-decisions.md:117). I wrote scratchpad notes this session with zero expectation of ever seeing them again; that is the loop as experienced.

### What closes the habit loop (or not)

Three candidate closers, in descending leverage:

1. **Make admission reviewable in-band** — surface `knowledge.candidatesAwaitingAdmission` (already in the receipt + outlines, kg-settlement-decisions.md:81–82) to the orchestrator's next-run brief, so promotion is a step of an existing review, not a new ritual to remember.
2. **Worker-side feedback** — a "your note became finding X" receipt would make the scratchpad a worthwhile write; today a note is a tax the worker pays for nothing visible.
3. **Auto-promote only low-risk candidates** — D5's no-auto-admission is a principle worth keeping, but the sweep already retires un-admitted candidates after TTL (`review_window_expired`, kg-settlement-decisions.md:63–67); that TTL sweep is the existing bound an explicit "promote-or-expire" nudge could ride.

### Score + one line

**3** — elevation/candidacy are now automatic driver behavior (real integration), but admission awaits the orchestrator's habit and the worker sees nothing back, so it is a mechanism awaiting habit, not a living system.

## 2. S-2 boards — shared-task-list reality vs KG-ritual-only usage

### The promise

S-2 is the board-authority primitive: proof-of-principal envelope, board→run binding, CAS in the store append, MCP guards retired to thin adapters (PROGRESS.md:383–385, 403–405). S-3 surfacing makes board read+writes ride it (PROGRESS.md:405–408). The original REFLEX-2 promise was *shared and per-worker boards* (PROGRESS.md:260) — a task-list substrate, not a ritual ledger.

### What I experienced

The board surface splits in two and only one half is reachable:

- **Orchestrator half (real, on MCP):** `board.read/post/retitle/reorder/close/drop` are ordinary rows with MCP tools (`baton_board_*`, mcp-northbound tool inventory), each carrying the `sessionAuthority` envelope and fence CAS (application-semantics.mjs:1348–1406). This half is exactly the KG ritual: post candidacy at close, close items at admission, read the projection for review.
- **Worker half (registry ghost):** `board.claim` and `board.report` — the worker-facing "I take this item / here is my result" cycle — are declared with `profile: 'worker'`, `surfaces: []` (application-semantics.mjs:1407–1419) and have **no application-command definition and no dispatch path** (grep of application.mjs confirms). There is no `baton_board_claim` tool, no CLI verb. And even *reads* are gated: "transported reads require the S-2 run-orchestrator lease" (application-semantics.mjs:1186) — a worker without the lease cannot read the board at all.

So the board as a *shared task list that workers actually coordinate through* does not exist in any shipped surface. Every board row in every evidence dir is a `wave-settlement:<waveId>` candidacy ledger written by the driver or the demo driver (kg-loop-live-receipt.json `board-candidacy` step). That is KG-ritual-only usage by construction, not by accident.

### Score + one line

**2** — a fully-built orchestrator ledger with real MCP tooling, but the worker claim/report half is surfaceless and reads require the orchestrator lease, so the shared-task-list reality is unrealized.

## 3. REPL (manifest/binding/cite) — how much of the vision is realized

### The original vision

The REPL layer (REPL-1..3): *shared cells, typed bindings, cross-run scripting* (PROGRESS.md:261–262). The sweep says REPL/reflex closed out "verified landed and closed with suite evidence" (PROGRESS.md:363–364).

### Fraction realized

The durable plumbing is real and suite-green:

- `repl.manifest` — a worker admits a typed manifest; `repl.manifest_admitted` record; `DurableContextSession` opens against a settled admission (context-runtime.mjs:1295–1309). This is the **context-program's session anchor**.
- `repl.binding` — versioned binding with CAS authority (application-semantics.mjs:1198), admit/drop ops.
- `repl.cite` — role-scoped citation resolution; the **only** REPL op on the ordinary+MCP surface (application-semantics.mjs:1482–1488; `baton_repl_cite` in the MCP inventory).

What is not realized: `repl.manifest` and `repl.binding` are `profile: 'kernel'`, `surfaces: ['embedded']` (application-semantics.mjs:1465–1480) — no MCP, no CLI, no web. And the manifest is deliberately worker-scoped: *"worker manifests remain restricted to the worker own layer"* (application-semantics.mjs:1197). So "shared objects, scripting, context passing **across the orchestration layer**" reduces to: each worker can hold durable cells; citations let an in-scope reader resolve them. There is no shared object an orchestrator can hand from worker A to worker B. The vision is ~30% realized on a per-worker axis.

### The ONE use that would make it load-bearing

**The repl.binding as the typed handoff object for cross-run review context.** This review — like every downstream review — received its scope as prose paths pasted into the objective ("Evidence to consult: docs/PROGRESS.md…", verbatim in my brief). If the orchestrator's settle-window were allowed to mint a REPL binding carrying the elevated/candidate set (`binding {role:'reviewer', refs:[candidateFindingIds…]}`) and the downstream run resolved it via `repl.cite`, then the loop's tier-5 admission review and every downstream review would inherit machine-addressed context instead of prose. That single use makes REPL load-bearing: it would be the citation spine for the KG loop itself. Nothing would need a new surface — `repl.cite` is already on MCP; only the binding-mint side (kernel, embedded) needs the driver hook, which is exactly the shape #63's D3 hook already takes.

### Score + one line

**2** — plumbing is real and `cite` is surfaced, but manifest/binding are embedded-only and worker-scoped, so the cross-orchestration shared-object vision is mostly unrealized; a driver-minted review-binding would make it load-bearing.

## 4. ATLAS/cartographer + context program (cells/calls) — verification aid vs daily context engineering

### The promise

ATLAS structural deltas are first-class derived Cairn `Representation` nodes (PROGRESS.md:193–199); deployment-injected Atlas capabilities are "real fleet tools through one Coordinator-owned registry" (PROGRESS.md:48–49). The context program is the closed Program IR with cells/calls (context.eval/map/reduce/retry, REFLEX-4).

### Why orchestrators don't reach for it

Three receipts, one per blocker:

1. **Reachability.** ATLAS/cartographer are reached only through the capability registry by coordinator-internal code: `atlas.structural_classified` as trust-gate provenance (coordinator.mjs:11406), `cartographer-quartermaster` `orientation.slice` / `reuse.vet` (coordinator.mjs:6582–6585, 9562–9564). There is **no ATLAS MCP tool and no application command** — the MCP inventory has zero `baton_atlas_*`. A worker or downstream reviewer cannot invoke ATLAS; only the gate can.
2. **The context program's own seam admits the gap.** The design comment at application-semantics.mjs:320–327 is unusually honest: `application.context_eval` is a public method, *not* a command-bus entry, and "direct method call works today; Web, MCP, and generic `application.command('application.context_eval', …)` dispatch do not yet." The MCP tool that exists (`baton_context_eval`) is a special-cased legacy reflex row (mcp-northbound.mjs:502–510) wired to the direct method — workable, but it is the only cell/call verb surfaced; `context_map/reduce/retry` are CLI-only.
3. **Session setup cost.** `context_eval` requires a durably-admitted Context session anchored on a settled `repl.manifest_admitted` (context-runtime.mjs:1295–1309) — and manifest admission is embedded-only (section 3). So to evaluate a cell on MCP you must first get an embedded principal to admit the manifest. The setup is a ritual; the payoff (pure compute over an immutable branch) is verification-shaped, not "where do I focus next"-shaped.

That is why orchestrators don't reach for them: ATLAS is invisible unless injected and even then it is the gate's tool, and the context program's cheapest surface (eval) has a session-admission precondition only an embedded principal can satisfy. In this session I, a reviewer, needed no cells and no ATLAS — I read files directly, which is the same decision every orchestrator makes.

### Score + one line

**2** — a real verification aid (trust-gate structural evidence, R1–R3 representations) that stays out of daily context engineering because it is capability-injected, session-gated, and only partially surfaced.

## 5. Worker-to-worker channels — is the shared-scratchpad relay enough?

### Current topology

Everything routes through the orchestrator. The shared scratchpad partition is the only inter-worker lane, proven in demo v2: *push → 5 scratchpad doubts → relay → revision note, all receipted* (PROGRESS.md:302); the relay payload is the orchestrator reading the shared slice and handing it to the next worker (phase2-relay.json). The wave driver's `waves.send`/`waves.progress` are orchestrator→worker steer (this wave's run-feedback-wave.mjs). There is no worker→worker addressing, no notification, no claim.

### Is it enough?

For the relay's one real job (hand a question from worker A to worker B through the orchestrator), it is enough — it worked end-to-end in demo v2. But it is write-only-push and poll-free: the receiving worker only sees the shared slice when the orchestrator chooses to relay it into a brief, and there is no receipt that the handoff was consumed. My own experience as the third member of this wave: the only way I got the other members' work was the objective's prose evidence list. A claim/report cycle would have let me say "I have the kg-settlement and trust-gate evidence; the frontier review is mine" on a shared board the orchestrator actually reads.

**Through which existing primitive?** The S-2 board. The design already exists — `board.claim` / `board.report` with `profile: 'worker'`, item digest + fence (application-semantics.mjs:1407–1419) — it is only `surfaces: []`. Enabling those two rows (embedded+cli+mcp) and letting `waves.send` carry the claim grant gives workers a first-class, already-CAS'd handoff channel without a new primitive, and simultaneously realizes section 2's shared-task-list half. The scratchpad stays the payload; the board becomes the envelope. Until then, workers are exactly as connected as the orchestrator remembers to connect them.

### Score + one line

**2** — the relay is a working but orchestrator-mediated, write-only-push lane; the designed first-class handoff (board.claim/report) exists in the registry and just needs its surface unblocked.

## Synthesis — the ONE thing that would make this integrated

**Enable the worker-facing board half (`board.claim`/`board.report` surfaces) and have the #63 settle-window mint a REPL binding of the candidate set for the next downstream run.** That single move collapses all five findings into one: boards become a shared task list instead of a ritual ledger (§2, §5), the REPL gains its load-bearing cross-run citation use (§3), the KG loop's admission step gets an in-band reviewer handoff instead of prose pastes (§1), and the context program finally has a session someone can reach without embedded ceremony (§4). It is three registry-row edits and one driver hook — the same shape #63 already productized — and it is the difference between "the machinery runs" and "the workers feel it."

## Receipts / appendix

- [x] Deployment verification: executed `true` (exit 0) — exact route, result, and cleanup truth preserved; no impl/ files edited; only write target is this report.
- [x] All in-scope evidence files read and quoted (listed above).
- Concrete receipts cited: kg-loop-live-receipt.json (scratchpad write_result / elevate / lease / board-candidacy), PROGRESS.md:302 (shared-layer relay), recipes.mjs:535 (#62 shape coaching), application-semantics.mjs:1407–1419 (surfaceless board.claim/report), application-semantics.mjs:320–327 (context_eval dispatch gap), coordinator.mjs:11406 (ATLAS as gate-only provenance).
