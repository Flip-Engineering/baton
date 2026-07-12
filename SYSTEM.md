# The Baton System — complete design

*The single, authoritative design. It synthesizes everything explored across `docs/`, `spec/`, `docs/capabilities/`, the reviews, and the prototype into one coherent, correctly-steered, deeply-engineered whole. Plain language throughout (see [GLOSSARY.md](GLOSSARY.md) for any leftover codewords). The lossless capability/status catalog is [`docs/26-full-system-goal.md`](docs/26-full-system-goal.md); a later/fenced/research label never deletes an item. Where this document and an older document disagree, this document plus that catalog wins.*

---

## 1. What baton is, in one paragraph

Baton is a **fleet driver**: it lets one orchestrator agent — your Claude Code or Codex CLI — direct a fleet of full coding tools from different vendors (Codex, Claude Code, GLM), sending them work, watching everything they do, and interrupting and steering them mid-run, in either direction (`Claude → Codex + GLM` or `Codex → Claude + GLM`). Underneath your orchestrator sits a small, reliable coordinator program that carries out its decisions dependably and keeps the books. Around that core are the features that make the driving *good*: it re-runs a worker's tests before believing "done," it learns which vendor is best at what (and keeps that current as new models ship), it remembers what past runs taught, it hands workers sharper tools, and it keeps everyone safe in sandboxes. The orchestrator decides; the coordinator makes the decisions land; the workers do the work; the supporting features make it trustworthy, smart, and safe.

## 2. The shape

Four layers. The top decides, the middle executes, the bottom works, and the features wrap the middle.

```
   ┌─ YOU / your orchestrator agent (Claude Code or Codex) ── DECIDES ──────────────┐
   │   "spawn a Codex worker here", "interrupt worker 2", "is this really done?"     │
   └──────────────────────────────┬─────────────────────────────────────────────────┘
                                   │  eight commands (§4)
   ┌───────────────────────────────▼─────────────────────────────────────────────────┐
   │  THE COORDINATOR  ── a small reliable program (Elixir/OTP or Go) ── EXECUTES      │
   │  • dispatch  • carry commands reliably  • stream telemetry  • the trust gate      │
   │  ── wrapped by the supporting features ──                                         │
   │  [trust: re-verify] [smart dispatch: routing] [memory] [worker tools] [safety]    │
   └───────────────────────────────┬─────────────────────────────────────────────────┘
                                   │  per-vendor adapters (§6)
   ┌───────────────────────────────▼─────────────────────────────────────────────────┐
   │  WORKERS ── full coding tools, each in its own copy of the repo ── DO THE WORK    │
   │  Codex           Claude Code           GLM (via Claude Code + Z.ai)               │
   └───────────────────────────────────────────────────────────────────────────────────┘
```

The one design rule that holds this together: **the orchestrator is an AI, but the coordinator underneath is plain code.** The AI is good at deciding; plain code is good at not forgetting, not getting confused, and making sure "stop worker 2" actually happens. You keep the AI on top (it's your CLI agent); the plain layer makes its commands dependable.

---

## 3. The coordinator core

The heart of the system. Full assembly spec: [`spec/driver.md`](spec/driver.md). It is one long-lived program that owns the worker pool, the event log, the reliability machinery, and the trust gate.

### 3.1 The eight commands (the whole API)

Everything the orchestrator can do, and nothing it can't:

| Command | Does |
|---|---|
| `spawn(vendor, task)` | start a worker on a task in its own repo copy |
| `send(worker, message, mode)` | message a worker — `nudge` (read at next pause), `steer` (redirect now), `turn` (new instruction) |
| `wait(timeout)` | park until a worker needs attention, then return a short digest of what changed |
| `respond(request, answer)` | answer a worker's question, or approve/deny a risky action it asked about |
| `interrupt(worker, then?)` | stop what a worker is doing now, confirmed; optional follow-up |
| `result(worker)` | get a finished worker's result — *after the coordinator re-ran its tests itself* |
| `list()` | all workers: status, budget, pending questions |
| `kill(worker)` | end a worker, confirming the process is really gone |

### 3.2 The main loop (plain pseudocode)

```
loop:
  DISPATCH   — start each ready task on a free worker, respecting per-vendor limits
               (GLM Pro = 1 at a time; Codex/Claude = several). Routing picks who (§5.2).
  CARRY      — take each orchestrator command, version-stamp it, deliver it;
               reject stale ones; for interrupt, wait for the worker to confirm it stopped.
  STREAM     — for every worker action (turn, edit, tool run, tokens, question):
               write it to the log, push a line to the live feed, update warning signals.
  TRUST GATE — when a worker says "done", re-run its tests in a FRESH repo copy;
               mark done only if the coordinator's own run passes; record the outcome.
```

The prototype (`prototype/`) is this loop, runnable today (minus the live feed and steering).

### 3.3 The five reliability rules (why commands are dependable)

These are the difference between a toy that prints a nice tree and a system you can leave running. Each is plain, and each has a one-word name used in the specs:

1. **Version-stamps ("fencing").** Every command carries the worker's current version number. If the worker has moved on, a stale command is rejected instead of misfiring. This is also how "the human always wins over the AI" works — a human action bumps the version, so the AI's now-stale command is refused.
2. **Confirm-it-stopped ("two-phase stop").** `interrupt` and `kill` aren't "done" until the worker actually confirms it stopped. A worker mid-way through writing a file keeps running for a moment after you hit interrupt; the coordinator waits for the real stop before it lets anything else touch that repo copy. This closes the "I interrupted it but it kept editing" bug.
3. **Never-lose-an-event ("at-least-once cursors").** The reader's position in the log only advances after it confirms it got the last batch — so a crash re-reads rather than silently dropping an event (a dropped event could be a worker's unanswered question, which would hang it).
4. **Answer-exactly-once ("single-consumer approvals").** A worker's question or approval is answered exactly once, even if both the human and the orchestrator could answer — first answer wins, the other is told "already handled."
5. **The log is the only truth.** Everything else (the live feed, any database, the routing stats) is rebuilt from the append-only log. If any of them corrupt, delete and replay. This is what makes the whole system restartable and auditable — you can always replay exactly what happened.

Deeper spec: [`spec/supervisor-state-machine.md`](spec/supervisor-state-machine.md).

---

## 4. The four core capabilities (your named features)

### 4.1 Directing workers, each in its own git worktree
The orchestrator decides via the eight commands; the coordinator's dispatch step executes. Reaching a worker is done through a per-vendor adapter (§6).

**Every worker runs in its own git worktree** — its own working directory on its own branch, sharing one copy of the repo's history underneath (cheap). This is load-bearing plumbing, not a detail, because it does three jobs at once: (1) **isolation** — workers edit and test in parallel without clobbering each other, enforced by git itself (it won't check out the same branch twice); (2) **it's what the trust gate checks against** — re-verification runs in a *fresh* worktree at the worker's committed result, never the worker's own directory, so a doctored test or uncommitted junk can't fool it; (3) **it defines merging** — each result is a branch, so integrating accepted work is a clean branch merge, and collisions between workers are visible, not silent.

The worker just sees a normal repo; the coordinator does all the worktree bookkeeping — create from a pinned clean base, confine the worker to it (the sandbox boundary), capture the result as a *commit* (never a dirty tree), re-verify in a fresh worktree at that commit, merge if accepted, and clean up on done-or-crash (with zombie worktrees reaped on restart). Workers may run their own git — commits are captured, but `push` and other irreversible outside-world actions are approval-gated. Merge collisions are avoided up front by giving concurrent workers **non-overlapping path scopes** (claimed on the shared scratchpad), with textual merge for the MVP and merge-by-meaning as a later upgrade. Full mechanics, commands, and the disk-cost / non-git / interrupt-interaction considerations: [`spec/worktrees.md`](spec/worktrees.md).

### 4.2 Messaging, both ways
Down and up, on a channel that respects turn boundaries (never interrupts a worker mid-thought — that's what steering is for). Full shapes: [`spec/communication-channel.md`](spec/communication-channel.md).

- **Down:** the *brief* — not free text but a small **delegation contract**: objective, in/out-of-scope paths, which tools to use, output format, and the **exact command that defines "done"** (the same command the trust gate re-runs, so the worker can never redefine done). Scope paths feed the path leases and the out-of-scope warning. It's rendered in each vendor's preferred style. Optionally a **plan-gate**: the worker sends a short plan first and the orchestrator okays or redirects it *before* it spends a whole budget going the wrong way. Then *nudge* (a note delivered at the next natural pause) and *steer* (redirect now).
- **Up:** *events* (what the worker is doing), a *question* (the worker can ask instead of guessing — a real feature, so a stuck worker asks rather than burning budget on a wrong guess), and the *result* (what it did, which the coordinator re-checks).
- **Not allowed:** worker-to-worker chat. If two workers need to coordinate, they do it through the shared scratchpad (§5.4), not by messaging — which keeps coordination visible in the log and out of everyone's context.

### 4.3 Telemetry & monitoring
Every worker action becomes a log entry and a live-feed line, tagged by where it came from (a trusted fact the coordinator computed, vs. the worker's own prose, which is never trusted as fact). On top of the raw stream, the coordinator computes **warning signals** so a human doesn't have to watch everything: *stalled* (gone quiet too long), *looping* (same failing action over and over), *over budget*, *out of scope* (editing files outside its brief). What the human sees is a short **story** — "3 workers on the auth change; worker 2 stuck in a test loop; the orchestrator just rerouted worker 4 after Codex refused" — not a wall of metrics. This **story compiler** is a cheap running fold over the log (keep a small per-worker/per-task state, update on each event, render with templates); it works precisely because the driver owns the whole fleet's log, and it's the one custom monitoring surface worth building. For everything else, the driver emits events in the standard OpenTelemetry format so existing tools (Datadog, Honeycomb, Langfuse, Phoenix) render cost/latency/traces — no need to build a dashboard product. Event shapes and signals: `docs/05-telemetry-steering.md`; the story compiler and telemetry-out: `docs/21-frontier-features.md`.

### 4.4 Interruption & steering
The hard part, and the most carefully engineered. Your original concern was whether you can *actually* stop and redirect a subordinate tool reliably. The honest answer, built in:
- **Stopping is dependable** for anything the coordinator mediates, thanks to confirm-it-stopped (§3.3 rule 2) and version-stamps (rule 1). There's a "gentle" end (finish your current step, then reconsider) and a "hard" end (stop now) — prefer gentle; it wastes less of the worker's in-progress thinking.
- **Steering** works differently per vendor and the coordinator is honest about which you got: Codex can redirect a running turn directly; Claude/GLM emulate it (interrupt, then re-prompt), which discards some in-flight work — and the coordinator tells you when that happened rather than pretending they're the same.
- **The honest limit:** a side effect a worker already sent to the outside world (a `git push`, a database migration) can't be un-done by interrupting — the fix is to keep such actions behind approval and out of fire-and-forget nudges, and to *show* the human when one slipped through, not to pretend it's preventable. Deeper: `docs/05` §4, and the red-team in `reviews/steering-interruption-redteam.md`.

---

## 5. The supporting features (what makes the driving good)

Each of these makes the driver more trustworthy, smarter, or safer. None is the product; each is a feature of it.

### 5.1 Trust — a hard-to-fool "done"
When a worker says it passed, the coordinator **re-runs the check itself, in a fresh copy of the repo the worker never touched**, and believes only what it observes. That catches a worker that lies about passing. But a worker can also write *weak* tests that pass trivially — so the trust gate is deepened into a small cluster of checks (all grounded in production practice, all cheap) that together make "done" genuinely hard to fake. This is the highest-value thing to build after the basic driver, because verification integrity gets *more* valuable as models get better at gaming weak checks:

- **Red→green:** confirm the acceptance test actually **failed** at the starting point and **passes** after the change — so a test that always passes is caught. For bug fixes, require a reproduction test that was red first.
- **Coverage-of-change:** during the re-run, check the changed lines were actually *executed* — a green suite that never touched the change doesn't count.
- **Mutation probe:** plant a few small faults in the changed lines and confirm the tests catch them — so tests that pass but don't actually test are caught (this is Meta's approach, in production).
- **Independent oracle:** for higher-stakes work, a *different vendor*, blind to the worker's change, writes the gate tests from the spec you pinned — the worker can't grade its own homework.
- **Impact-selected re-run:** re-run the tests affected by the change (plus the pinned acceptance set) — faster, and it tells you the change's blast radius.

Complementing these machine checks, a **cross-vendor review pass** can have a *different* model family review the change (shown as a semantic diff, §5.4) before the gate — a cheap second pair of eyes from a family that fails differently, which is the honest, 1×-cost form of "use multiple vendors" (a review, not N× re-generation). Because it re-runs a spec *you* pinned in a clean worktree, the driver can safely auto-merge, move on, or reroute — it's earned the right to trust the result. For genuinely critical code this still extends up a **ladder** (property tests → fuzzing → math proof), cheapest rung that fits the risk; most tasks stop at the cluster above. Full design: [`docs/21-frontier-features.md`](docs/21-frontier-features.md) (the trust-gate cluster) and `docs/capabilities/math-proof.md` (the deeper rungs, honest about where proof genuinely applies).

### 5.2 Smart dispatch — routing that stays current
The driver learns which vendor/model is best at which kind of task and routes accordingly — and crucially, it **keeps that current as new models ship**. It tracks by *model version* (a new Codex release starts a fresh record, so stale data can't vote), fades old results automatically so recent performance always wins, and is *optimistic about new models* (it tries them rather than sticking with the incumbent). It learns only from **re-verified** wins, never worker self-reports. Off until there's enough history to matter; round-robin before that. Full design: [`docs/20-adaptive-routing.md`](docs/20-adaptive-routing.md).

### 5.3 Memory — three speeds, plus replay
- **Fast:** a shared live scratchpad where workers post in-progress facts ("this test is flaky, seed 42 reproduces it") and claim shared resources ("I'm editing payments/, hands off") — so they coordinate through shared state instead of messaging. `docs/capabilities/coordination-repl.md`.
- **Medium:** the task list (what's done, what's blocked, what depends on what) that drives dispatch.
- **Slow:** durable knowledge that outlives a run — a per-run scorecard, the routing stats, and a local typed decisions-and-findings graph the driver promotes into through explicit authority. Optional deployment-neutral export may target an existing research-notes system later; Baton does not couple its runtime to one. `docs/08-shared-memory-and-pm.md`, `docs/capabilities/causal-research-bok.md`.
- **Replay:** because the log is the only truth (§3.3 rule 5), you can replay any run, or re-run it with one thing changed ("what if the brief had said X?") — invaluable for debugging the fleet and for improving briefs.

### 5.4 Worker tools — sharper than raw text
Tools the driver hands its workers (and uses itself to check their work), each shaped for an AI to use efficiently (structured, short answers with the bulk fetched only on demand — a search over a huge repo costs a worker a few hundred tokens, not forty thousand). The set, each earned by demand, not all up front:
- **Code search** that's shared across the whole fleet and indexed once, combining plain text search, structure-aware search, and cross-file "what calls this." `docs/capabilities/discovery-search.md`.
- **Debugging** that returns a *structured explanation of why something failed* — including an automatic **postmortem** built from the log and the coordinator's own failed re-run when the trust gate rejects a change — plus shareable record-and-replay recordings, instead of a giant step-by-step log. `docs/capabilities/debug-interp.md`, `docs/21-frontier-features.md`.
- **Semantic diff** — showing what *behavior* a change alters, hiding renames and reformatting. This is the single highest-value tool for the driver's own re-checking and for cross-vendor review: the reviewer looks at the two real changes, not two hundred noise lines. `docs/15-representation-and-computation.md`.
- **Repo orientation** — a shared map of an unfamiliar codebase built once, so N workers don't each re-explore it, plus a way for the orchestrator to point a worker at the relevant part. `docs/capabilities/orientation-reuse.md`.
- **Reusable skills** — when a worker figures out a repeatable procedure (or, most valuably, a fact like "the test command here is `mise exec -- mix test`"), the driver verifies it and shares it with the fleet so nobody rediscovers it. `docs/capabilities/skills-computeruse.md`.

### 5.5 Context handling — the right information, to the right worker, at the right time
The craft of *what each worker and the orchestrator actually see*, so nobody drowns. Briefs are written in each vendor's preferred style (the same task, phrased for Codex vs. for Claude). Bulky context is handed over as a link the worker opens if needed, not pasted in. When a worker's tool memory gets compacted, the coordinator re-injects the goal from the outside so the worker doesn't forget what it was doing. And the orchestrator's own view is kept small — it sees short digests, not raw transcripts — because a distracted orchestrator makes worse decisions exactly when it's coordinating the most. `docs/12-context-harness-engineering.md`, `docs/14-practitioner-addenda.md`.

### 5.6 Safety — sandboxes, secrets, and a trust ramp
- **The sandbox is the real boundary**, not a keyword filter. Each worker is confined by the operating system to its own repo copy; anything outside is denied by the OS, so a cleverly-worded command can't escape. A string-matching policy is a *tripwire and logger*, never the wall.
- **Secrets are scoped:** a GLM worker gets only its Z.ai credentials, never your Anthropic key.
- **Untrusted-by-default:** a worker's output is treated as untrusted input to everyone else (it could have read a malicious file). Shared facts carry where they came from, so if one turns out to be poison, the driver can find every worker that read it. `docs/09-revision-log.md` §C, `docs/14` #24–25.
- **A trust ramp, not a switch:** you don't hand it the keys on day one. Dry-run (it plans, shows you, runs nothing) → approve-everything → approve-sampled → autonomous-with-circuit-breakers. It earns autonomy step by step, and shows you the evidence. `docs/14` #18.
- **The emergency stop always works** and never asks for a written reason — you can always kill a runaway instantly.

---

## 6. Reaching the real tools (the adapters)

One adapter per vendor, each translating the eight commands into that tool's real controls. Grounded in the actual installed CLIs (verified). Full map: [`spec/adapter-contract.md`](spec/adapter-contract.md).

- **Codex** — the richest controls: a background "app-server" you talk to over a local socket, with native redirect-a-running-turn, goal-pinning, and cancel. Best raw target. (Its experimental WebSocket transport is *not* production — use the local socket.)
- **Claude Code** — headless mode (`claude -p`) or the Agent SDK; native interrupt and per-tool approval hooks; steering is emulated (interrupt + re-prompt) and flagged as such.
- **GLM** — Claude Code pointed at Z.ai's Anthropic-compatible endpoint (officially supported); inherits Claude Code's controls, but with a hard concurrency limit (~1 at a time on the Pro plan) the scheduler must respect.
- **Fallback tier** — any tool that speaks the ACP standard (Gemini CLI and others) via one shared adapter, at reduced control. And a last-resort screen-scraping tier for tools with no real interface, so the fleet view is never blind — just coarse.

Each adapter publishes a **card** saying which controls it supports natively vs. emulates vs. can't do — so the driver never silently pretends an emulated steer is a real one.

---

## 7. How it's built

- **Language** (`docs/17`): the coordinator's job — managing many crash-prone workers, restarting them, keeping commands ordered — is exactly what **Elixir/OTP** was built for, and you already run it; **Go** is the simpler alternative. The current **prototype is TypeScript** (fast to move; keep for the MVP). Heavy code-analysis tools, when added, are best in **Rust** (where those tools already live). Python for any eval/stats.
- **Protocols:** up to the orchestrator, the coordinator exposes its eight commands as tools the AI can call (MCP). The human user also gets an authenticated HTTPS command surface plus resumable WebSocket/event delivery over the *same* coordinator authority: harness and exact model selection, steer/turn, approval/question response, interrupt/kill, goals/tasks, budgets, narrative, and emergency stop all retain the ordinary fence, idempotency, audit, sandbox, and trust gates. Down to workers, Baton uses each vendor's real interface (subprocess or Codex's app-server), with the ACP standard as a fallback. No new southbound protocol is invented — Baton is a compatibility layer over what already exists. The secure human↔orchestrator contract is `spec/phase12/authenticated-web-northbound.md`.
- **Deployment:** start on one machine (coordinator + workers together). Later, the coordinator can live on a bigger box you reach over SSH/Tailscale, with your orchestrator attaching remotely. Multi-machine meshing is deferred until one box actually hurts.

---

## 8. Build order

Build the smallest thing that actually drives, prove the hard parts, then grow — each feature switched on when it earns its place.

1. **MVP — the driver in miniature.** One coordinator; two workers (a Codex and a Claude-or-GLM) in separate repo copies; a live text feed; interrupt and steer that reliably land; re-run tests before trusting "done." Round-robin, no routing. A few weeks; proves dependable interrupt/steer + trustworthy "done" — your original concerns.
2. **Make it pleasant to operate.** The story-style monitor, the takeover seat (drop into a worker's own session), the trust ramp.
3. **Make it smart.** Adaptive routing (once there's history), the shared code search, semantic-diff review.
4. **Make it deep.** The rest of the worker tools, the deeper check ladder, the durable memory — each earned by demand.

Optional at any point: a cheap side experiment on your real tasks to see whether a *different vendor's* check catches bugs the same vendor misses — this de-risks the routing/decorrelation bet, but it's not a gate on building the driver.

---

## 9. The honest edges

- **Solid and dependable:** the coordinator core, interrupt/steer, re-verification, messaging, per-vendor adapters. These are specified, red-teamed, and partly prototyped.
- **Real but earned later:** routing, memory, the worker tools — good, but switched on when there's a reason.
- **Genuine bets (flagged, not hidden):** true semantic *merge* at scale (merging by data/control-flow meaning, not lines or syntax trees) could make large fleets far smoother but is unproven. The lower syntax-aware structured rung now wraps Mergiraf-class tooling behind isolated staging and fresh verification; it is not relabeled semantic merge. Math proof only pays off on small critical pieces (turning an English spec into a provable statement is the unsolved part — never claim "proven" over a spec a worker could have weakened); "the fleet gets smarter on its own" is measured, not assumed. AST/CST, symbol/SCIP, CPG, IR, behavioral fingerprints, true semantic merge, and e-graphs remain catalogued representation rungs with explicit evaluation/retirement gates.
- **Things that will move under us:** vendors are building pieces of this themselves and models keep improving, so build *deep* only the parts that stay valuable as models get better — dependable cross-vendor control and trustworthy verification — and keep the rest thin and swappable. A frontier-research pass ([`docs/21`](docs/21-frontier-features.md)) proposed a historical cut list; the full-system goal now treats those entries as sequenced research rungs, not silent deletions. They may be retired only by a recorded evidence-backed Decision. The durable rule is: **nothing self-modifies the coordinator or the trust gate; the driver evolves only its periphery, and only through the same re-verification everything else passes.**

---

## 10. Feature index (nothing lost)

**Scope decision:** Baton is deployment-neutral and has no homelab runtime or integration target.
The repository's `project-manager` material is architectural prior art for the local typed causal
graph, not a dependency; any future export remains optional, approval-gated, and out of current
scope. Historical exploration that mentioned a homelab deployment is superseded by this decision.

Every feature the exploration produced, with honest status. **Core** = the driver itself. **Trust/Smart/Memory/Tools/Safety** = supporting. **Later/Bet** = earned or unproven.

| Feature | Role | Status | Where |
|---|---|---|---|
| Direct workers via 8 commands | Core | MVP | `spec/driver.md` |
| Per-worker git worktrees (isolation, verify-against, clean merge) | Core | MVP | `spec/worktrees.md` |
| Path leases (non-overlapping scopes → clean merges) | Core | MVP | `spec/worktrees.md`, `docs/capabilities/coordination-repl.md` |
| Two-way messaging (brief/nudge/steer/ask/answer/result) | Core | MVP | `spec/communication-channel.md` |
| Telemetry log + live feed + warning signals | Core | MVP (feed to design) | `docs/05` |
| Interrupt & steer, dependable | Core | MVP | `docs/05` §4, `spec/supervisor-state-machine.md` |
| Version-stamps / confirm-stop / never-lose-event / answer-once / log-is-truth | Core reliability | MVP | `spec/supervisor-state-machine.md` |
| Re-verify before "done" | Trust | MVP | `prototype/src/referee.ts`, `spec/driver.md` |
| Hardened trust gate: red→green, coverage-of-change, mutation probe | Trust | Right after MVP (flagship) | `docs/21` |
| Independent oracle (different vendor writes gate tests) | Trust | Later | `docs/21` |
| Cross-vendor review pass (different family reviews the semantic diff) | Trust | Earlier | `docs/21` |
| Delegation-contract brief (structured; "done" = pinned command) | Core/Context | MVP | `docs/21`, `spec/communication-channel.md` |
| Plan-gate (approve the plan before spending budget) | Context | MVP-adjacent | `docs/21` |
| Story compiler (live plain-language fleet narrative) | Monitoring | Phase 2 | `docs/21`, `docs/14` #16 |
| Standard telemetry out (OpenTelemetry GenAI) | Monitoring | Later | `docs/21` |
| Structured postmortem on gate-reject | Debugging | Later | `docs/21` |
| Structured (syntax-aware) merge rung | Tools | Shipped Phase 26 | `spec/phase26/structured-merge.md`, `docs/21`, `docs/15` |
| E-graph/equality-saturation evaluation | Tools/Trust | Shipped Phase 27 negative gate: native repo/function engine retired or redirected; external expression/kernel research conditionally catalogued | `spec/phase27/egraph-evaluation.md`, `docs/15`, `reviews/frontier-features/representation.md` |
| Governance firewall (re-inject constraints on compaction) | Context | MVP-adjacent | `docs/21`, `docs/12` |
| Deeper check ladder (proptest→fuzz→proof) | Trust | Later | `docs/capabilities/math-proof.md` |
| Adaptive, recency-biased routing | Smart | Later | `docs/20` |
| Fast scratchpad / medium task-list / slow knowledge | Memory | Later (task-list MVP) | `docs/08`, capabilities |
| Replay & counterfactual re-run | Memory | Later (free from log) | `docs/14` #20 |
| Shared code search | Tools | Later | `docs/capabilities/discovery-search.md` |
| Structured debugging + record-replay | Tools | Later | `docs/capabilities/debug-interp.md` |
| Semantic diff (review by meaning) | Tools | Earlier (high value) | `docs/15` |
| Repo orientation map | Tools | Later | `docs/capabilities/orientation-reuse.md` |
| Exact dependency dossier + actual-lockfile SBOM | Tools/Safety | Shipped Phases 36–37 | `spec/phase36`, `spec/phase37`, `docs/capabilities/orientation-reuse.md` |
| Immutable external `borrow\|build` decision + causal promotion | Safety/Memory | Shipped Phase 38 | `spec/phase38/immutable-reuse-decision.md`, `docs/capabilities/orientation-reuse.md` |
| Advisory refresh guard + exact TTL invalidation | Safety/Memory | Shipped Phase 39; provider push/policy/clearance later | `spec/phase39/advisory-ttl-invalidation.md`, `docs/capabilities/orientation-reuse.md` |
| Isolated proposed npm graph + actual delta | Tools/Safety | Shipped Phase 40; no install/decision authority; reachability/ecosystems/provenance later | `spec/phase40/proposed-install-graph.md`, `docs/handoff/evidence/phase40-proposed-install-graph-2026-07-12.md` |
| Reusable verified skills/recipes | Tools | Later | `docs/capabilities/skills-computeruse.md` |
| Per-vendor briefs, context-on-demand, re-inject-on-compaction | Context | MVP-adjacent | `docs/12` |
| OS-sandbox boundary, scoped secrets, contagion tracking | Safety | MVP-adjacent | `docs/09` §C, `docs/14` |
| Trust ramp (dry-run → autonomous) | Safety | Grows with use | `docs/14` #18 |
| Story-style operator monitor + takeover seat | Operate | Phase 2 | `docs/14` #16, `docs/05` §7 |
| Authenticated HTTPS commands + resumable web event stream | Core/Operate/Safety | Required northbound | `spec/phase12/authenticated-web-northbound.md`, `docs/26` §J |
| AST/CST → symbol/SCIP → CPG → IR → behavior → semantic diff/merge → e-graph ladder | Tools/Trust | Staged, no silent deletion | `docs/26` §§H–I, `docs/15`, capability specs |
| Semantic merge at scale | Bet | Research | `docs/15` §4b |
| Computer-use (GUI) worker tier | Tools | Bet (flaky) | `docs/capabilities/skills-computeruse.md` |

---

*This is the system. The goal is a fleet driver; everything else earns its place by making the driving trustworthy, smart, and safe. Build the MVP (§8.1), prove the hard parts, and grow from there.*
