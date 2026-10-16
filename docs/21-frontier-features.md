# 21 — Frontier Features (curated, integrated)

*The best 2025-26 state-of-the-art (and a few honest beyond-frontier bets) from a research pass across harness, context, code-editing, monitoring, testing, debugging, interpretation, and representation — filtered for what's real and what actually fits the fleet driver, then organized by **where it plugs in**. Each feature says how it connects to the driver, and whether it's a keeper (stays valuable as models improve), a bet (unproven), or a rental (a better base model obviates it). Plain language. The cut list at the end is as important as the keep list.*

## The headline: the trust gate gets teeth

Six of the eight research areas independently pointed at the same place — **the re-verification step (the trust gate) is the highest-value thing to deepen.** Today it re-runs the worker's tests in a fresh worktree. That catches a worker that lies about "it passed," but not a worker that writes weak tests that pass trivially. The frontier fix is a small cluster of checks that together make "done" genuinely hard to fake — and every one is grounded in production practice, mostly MVP-cheap, and a *keeper* (verification integrity gets *more* valuable as models get better at gaming weak checks).

| Feature | What it catches | How it plugs in | Real basis |
|---|---|---|---|
| **Red→green** | a test that always passes (never actually tested the fix) | the coordinator confirms the acceptance test **fails at the pinned base** and **passes after** the change; for bug tasks, require a reproduction test that was red first | SWT-Bench, test-first bug-repro (2025) |
| **Coverage-of-change** | a green suite that never ran the changed lines | during the fresh-worktree test run, capture which lines executed; refuse "done" if the changed lines weren't exercised | patch-coverage, made an agent gate |
| **Mutation probe** | tests that pass but don't actually test | plant a handful of small faults in the *changed lines only* and check the tests catch them | Meta's ACH, in production (2025) |
| **Independent oracle** | the worker grading its own homework | a *different vendor*, blind to the worker's diff, writes the gate tests from the pinned spec | n-version / decorrelated review |
| **Impact-selected re-run** | wasted time + missed regressions | only re-run tests affected by the change (and always the pinned acceptance set) — faster, and it tells you the change's blast radius | regression-test-selection, 20-yr field |

Build order within the cluster: basic re-verify (already in the prototype) → **red→green** → **coverage-of-change** (shares the same test run) → **mutation probe** → independent oracle (needs a second vendor). This is the single most valuable thing to build after the MVP driver, and it directly answers the deepest risk in the whole project (a worker gaming its own verification).

## Better briefs (what the worker is told)

- **Delegation-contract brief (keeper, MVP).** Turn the free-text brief into a small structured contract: objective, in/out-of-scope paths, which tools to use, the output format, and — the load-bearing field — the **exact command that defines "done."** That command is what the trust gate re-runs, so the worker can never redefine done; the scope paths feed the path leases and the out-of-scope warning. This is Anthropic's multi-agent delegation lesson (vague delegation → workers duplicate and collide) made mechanical. Then render it in each vendor's style.
- **Plan-gate (keeper leaning rental, cheap).** Ask the worker for a short plan first; the orchestrator (or a cheap reviewer) approves or redirects it *before* it spends a whole budget going the wrong way. Reuses the existing question/steer channel. A rejected plan costs a few hundred tokens instead of a whole misdirected run.
- **Structured task-ledger (keeper, format is standard practice).** The worker keeps a committed, machine-readable progress file in its worktree (subtasks with pass/fail). It's how the coordinator sees real progress instead of trusting prose, and it's what a resumed worker reads after a crash.

## Cross-vendor review (the decorrelation value, done as review not generation)

- **Cross-vendor review pass before the trust gate (keeper — the one genuinely model-proof idea).** A *different* model family reviews the worker's change (shown as a **semantic diff** — see below — so it reviews the real behavior change, not text noise) before the gate. Different families miss different bugs, so a second family's eyes catch what the author's can't. This is the honest, cheap form of "use multiple vendors" — 1× cost review, not N× generation. It's the value the whole cross-vendor premise actually rests on.

## Monitoring (what the human sees)

- **The story compiler (keeper, the named story-monitor).** A running plain-language narrative of what the fleet is collectively doing — "3 workers on the auth change; worker 2 stuck in a test loop; the orchestrator just rerouted worker 4 after Codex refused." It's an incremental fold over the log (keep a small per-worker/per-task state, update on each event, render with templates), so it's cheap and deterministic. This only works because baton owns the whole fleet's log — it's the operator UX the user explicitly wants.
- **Standard telemetry out, no dashboard empire (rental — use, don't build).** Emit events in the OpenTelemetry GenAI format so existing tools (Datadog, Honeycomb, Langfuse, Phoenix) render cost/latency/traces. Don't build a monitoring product; the story compiler is the one custom surface worth owning.
- **Live fleet graph with provenance (keeper).** A view of which workers hold which path leases and which shared facts each has read — so when one fact turns out to be poison, you can see everyone downstream of it. Baton's alone, because only baton owns the leases + shared-scratchpad substrate.

## Debugging (when the fleet's code fails)

- **Structured postmortem, not a live session (keeper, build-first for debugging).** When the trust gate rejects a change or a worker errors, produce a short *structured explanation* from the log plus the coordinator's own failed re-run — what failed, where, the likely cause — instead of a giant step-by-step transcript. It enters the log as a reusable fact and can be handed to the next worker.
- **Bug-signature memory (bet).** Match a new failure against known past failures before spending effort re-diagnosing. Useful once there's history; unproven payoff.

## Representation (how code is looked at)

- **Semantic diff as the review primitive (keeper, high-value, build early).** Show what *behavior* a change alters, hiding renames and reformatting. This is the highest-value single tool: it makes the cross-vendor review sharp (review the 2 real changes, not 200 noise lines) and it feeds the trust gate's risk triage. Real tech (tree-sitter / difftastic / GumTree).
- **Structured merge (keeper, a real middle rung).** Between "textual merge" and the far-off "merge by meaning," there's syntax-aware structured merge (Mergiraf-class) that resolves many conflicts textual merge can't. A concrete, buildable middle rung for integrating concurrent workers.
- **Effect tripwire (keeper — but just the tripwire).** On merge, flag when a change *adds* a new outside-world capability (it now touches the network, the filesystem, secrets, or spawns a process) — because a passing test suite is not a security check. Keep this as a cheap flag on the merge gate; do **not** build a full effect-type system.

## Context (keeping windows clean)

- **Governance firewall (keeper, build-first for context).** When a worker's tool memory compacts, re-inject not just the goal but the **constraints and definition-of-done** from the outside — a compacted worker forgets the guardrails, not only the objective.
- **Contradiction-gated recall (keeper).** Before injecting a remembered fact into a worker, check it doesn't contradict the current repo state — stale memory that fights reality is worse than no memory.
- **Tools-as-code bridge (rental, deferred).** Expose the fleet's tools as one small `run(code)` surface the worker writes against, instead of a wall of tool schemas — cuts tool-definition tokens dramatically (Cloudflare/Anthropic "Code Mode"). Worth it once there are several tools; premature before that.

## Add / subtract / modify — the honest calls

**Added (fold into the system):** the trust-gate cluster (red→green, coverage-of-change, mutation probe, independent oracle, impact-selection), the delegation-contract brief, the plan-gate, the cross-vendor review pass, the story compiler, the structured postmortem, semantic diff + structured merge, the governance firewall.

**Cut or deferred (don't build, or not now):**
- **The incremental-representation substrate** (a Salsa-style always-live analysis engine) — over-claimed; it solves a performance problem baton may not have at a handful of workers. Cut from the plan; revisit only if the analysis tools prove too slow.
- **A full effect/capability type system** — keep the merge-time tripwire, cut the type system.
- **Behavioral fingerprinting, e-graph equivalence, edit-level bisect, self-improving worker tools, learned brief-evolution** — genuine research bets, clearly labeled, walled off from the core. Interesting, unproven; not on the build path. In particular, **nothing self-modifies the coordinator or the trust gate** — the driver evolves its periphery (skills, briefs) only, and only through the same re-verification everything else passes.
- **A monitoring dashboard product** — emit standard telemetry, let existing tools render; own only the story compiler.

**Modified:** the trust gate (§5.1 of SYSTEM.md) is upgraded from "re-run the tests" to the hard-to-fool cluster above; the brief (§4.2/§5.5) becomes the structured delegation contract; review becomes a cross-vendor semantic-diff pass.

## The one-line takeaway

The frontier doesn't ask baton to add a plane — it asks baton to make the two things it already has (the trust gate and the brief) *much harder to fool and much clearer*, add a genuine live story for the operator, and review changes across vendors by their meaning. Those are keepers that get *more* valuable as models improve. Everything shiny that a better base model would obviate is on the cut list.
