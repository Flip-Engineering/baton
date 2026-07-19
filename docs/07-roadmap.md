# 07 — Roadmap (revised, review round 1)

> **Current scope supersession (2026-07-12):** the historical M3 remote Foreman/homelab idea below
> is not part of Baton's current goal. Baton remains deployment-neutral and single-project; adding
> homelab integration would be a detriment. The line is retained only as exploration history.

> **Current implementation continuation (2026-07-18):** Phases 70–77 add preserved-stop/resume,
> required-effects authority, native Kimi worker/orchestrator support, authenticated control,
> explicit full-access policy, bounded topology/recovery, and durable recursive Run authority;
> Phases 78–88 integrate them behind one deployment-owned, cascading application surface and
> close exact Plan-owned harness/model/effort route tuples. Phase 89 now lands the first ordinary
> resident-application vertical: one owner/connected Runs facade, authenticated bounded catalog,
> validating attach, stable progress timing, repository-bound discovery, hardened Web reads,
> owner-only HTTP-over-UDS, private bearer publication, stable deployment/fresh incarnation,
> PID-start writer fencing, authenticated self-challenge, restart rotation, CAS cleanup, and
> zero-assembly `baton serve`. Phase 90 now lands durable semantic control settlement and the
> first Run-scoped progress/events/output stream vertical. Run-bound Web/browser streaming,
> opaque catalog continuation, read-only intent authority, and browser control convergence remain
> acceptance-red. The
> milestone prose below is historical sequencing, not a claim that a Git worktree or private HOME
> is an OS sandbox or that the capability and representation planes are complete.

## Current execution order

1. Finish the concise `openBaton`/bound-Run surface, contextual doctor/help, deployment-owned
   readiness and capacity, crash recovery, exact stop/reap, and Web/MCP parity. The local factory,
   fixed internal capacity, profile/crash replay, auth readiness, close/reopen ownership,
   `deployment.runs`, safe `runs.list`, validating `runs.attach`, repository-bound
   `connectBaton`, stable progress timing, ordinary `openBaton().host()`, and zero-assembly
   `baton serve` are green. The resident owns an owner-only Unix socket, private bearer/session,
   stable deployment identity, fresh incarnation, PID-start-fenced leases, readiness-before-
   publication, authenticated self-check, restart rotation, and compare-and-swap cleanup. The
   advanced loopback HTTPS assembly seam remains only for explicit integration/network work.
2. Dogfood Baton on Baton continuously: route multiple workers in parallel, select exact
   harness/model/effort per task, and live-prove selective kill plus zero ownership after close.
   Current route targets are Codex `gpt-5.6-sol`, native Kimi `kimi-code/k3` at
   orchestrator-selected effort, isolated Kimi-through-Claude K3 at `max`, Claude Code
   `claude-opus-4-6`, Grok 4.5/literal Grok Build when
   provider-observed, and only `glm-5.2` at orchestrator-selected effort (including `xhigh` when
   warranted).
   The current live checkpoint has a green Codex medium-effort >1 MiB telemetry recovery and a
   green two-Grok concurrent admission/selective-stop/exact-reap lifecycle. Native Kimi login was
   refreshed on 2026-07-18; exact `kimi-code/k3`/high and Codex `gpt-5.6-sol`/low then produced
   freshly verified parallel Phase 81 Candidates, followed by an exact Kimi Candidate-based Plan
   v2 revision and zero-ownership close. Grok remains separately auth-red. No provider-success
   claim is borrowed from readiness alone.
3. Build durable dynamic workflow composition over the existing Run application: one approved
   multi-node Goal/Plan, parallel Attempts for shared WorkItems, typed feedback, append-only
   review/revision Plan versions, synthesis, deterministic joins/gates, compact group progress,
   selective stop/reap, and restart recovery. The default shares immutable context and private
   writable overlays; an optional shared lineage has one fenced writer at a time. Direct
   concurrent multi-writer checkouts remain refused under same-UID full-access harnesses.
   The first recursive vertical is specified in
   `spec/phase80-recursive-candidate-revision.md`: selected immutable Candidate plus anchored
   feedback becomes an independently approved successor Plan and one fresh Candidate-based
   revision Attempt, never an agent-authored loop or reuse of review/recovery authority.
   The bounded Plan-v2 vertical is live-green through Baton itself. Deployment-owned multi-round
   policy, cumulative Goal headroom, Plan v3 replay, repeated-feedback/no-progress/contradiction
   stops, and ambiguous-worker recovery are now deterministic-green. Remaining hardening is the
   full effect-boundary/selective-stop matrix and explicit multi-round transport parity;
   arbitrary-depth recursion is not claimed.
4. Build the common Context Program and Scratch Bench as the context-computation layer for dynamic
   workflows. Phase 81 now specifies a Pythonic ContextSession over a closed canonical AST and has
   a first green stateless pure-cell vertical: immutable tree-bound manifests, deterministic
   search/chunk/coverage, content-addressed output, source-integrity refusal, and contextual help.
   Durable cell admission and the first provider-backed successor are now green: a Context map call
   content-addresses exact partitions, prebinds an ordinary successor Plan, waits for distinct
   approval, dispatches one atomic parallel Wave, attaches only mechanically accepted children,
   and settles only after replay-verifiable per-task resource release. Run-stop v3 includes calls.
   Phase 85 now preserves per-output lineage and the root semantic role catalog, adds one
   separately approved reduce successor, failed-call settlement, selective retry generations, and
   an immutable expression builder over one `context_eval` action. Phase 87 closes semantic
   per-action northbound authority, and Phase 88 closes exact Plan route tuple authority across
   replay, workflow, recovery, context, Web, and MCP surfaces. No ambient shell, host `exec`,
   arbitrary-code REPL, hidden provider callback, caller route/budget knob, or shared mutable
   checkout is added. Authenticated resident catalog/discovery and attach have a first green
   vertical. Phase 90 now makes semantic `Run.send()` / `Run.interrupt()` first-class durable
   resident controls with server-derived recipients and admit/effect-start/provider-ack/settle
   recovery. Live Baton-on-Baton CLI dogfood proved exact route binding, selective interrupt,
   whole-Run reap, compact mutation output, and explicit outline/index/section/item/content/evidence
   expansion. The execution chapter now also ships Run-scoped resumable progress/event/output
   streams, safe per-Run positions, opt-in untrusted provider output, Pythonic iterators, and
   concise CLI facades. Run-bound authenticated Web streaming/browser rendering, read-only intent
   authority, opaque catalog continuation, and deeper recursive composition remain next, followed by
   direct-vs-context-vs-RLM evaluation.
5. Deepen the capability and representation plane from the shipped bounded R1 structural-delta,
   R2 SCIP-snapshot, and R3 CPG seeds: Atlas AST/CST precision, native symbol/SCIP depth,
   CPG/dataflow/taint, compiler/IR, behavioral fingerprints, structured/semantic delta and merge, then Vantage,
   Evidence Ladder, Scratch/Bench, Skill Forge, Cartographer/Quartermaster, and Cairn.
6. Extend the shipped Cairn causal/temporal primitives into the deployment-neutral shared typed
   knowledge graph inspired by
   `project-manager` concepts, including provenance, temporal/bitemporal validity,
   contradiction/supersession, selective promotion, and bounded recall. There is no homelab
   integration or runtime dependency.
7. Run and publish the routing, control-latency, cross-vendor decorrelation, recovery, and
   human-audit-cost evaluations. Pending work remains pending until its own evidence is green.

All ordinary surfaces follow one self-describing Run model: objective first, Pythonic logical
methods, closed branches, and progressive Outline → index → section → item depth with contextual
help. Routine callers do not manage budgets, export/file-size ceilings, temporary roots, or host
capacity; the deployment owns safe defaults and exposes remediation only when attention is needed.

*Build sequence for the Option-A hub (doc 04). Milestones are cut so each one is independently useful and **falsifies something measurable**. Rewritten after review round 1 (doc 09 §F): the single strongest convergent signal from the Codex external review, the product judge, the ambition judge, and the time-scale judge was **"you are spending before you prove value, and the proof is cheap."** So eval and the differentiating demo move to the front, and the honest MVP is cut hard.*

## Guiding re-estimate (time-scale judge + Codex review)

The old "M1 in 1–2 weeks" was fiction. The supervisor invariants alone (`spec/supervisor-state-machine.md` I1–I7) are **~2–3 weeks to a tested skeleton for one adapter**, because the tests are the hard part: fault injection — kill the worker mid-approval, cancel `fleet_wait` mid-return, race human+orchestrator on one fence. Cross-vendor conformance is a **months-long, permanently-recurring** cost: every vendor CLI release is a potential break (the app-server is version-fragile; schema-gen is offline codegen, not runtime negotiation — pin versions, hash schemas, keep tested compatibility ranges). Plan for that trajectory, not just the MVP.

## M0 — Transport spike + the honest baseline (~1 week)

Goal: prove the load-bearing bridge works in *both* orchestrator directions, and establish the number every later milestone is judged against.

- Hub skeleton: single process, in-memory registry + JSONL event log. No policy engine, no budgets.
- `codex-adapter`: persistent `codex app-server` (stdio child), `thread/start`→`turn/start`→stream→`turn/interrupt`. Sandbox/approval travel through `thread/start`/`turn/start` params (**not** an app-server CLI flag); Phase 74 defaults to `danger-full-access` plus `never`, with narrower profiles explicit.
- `claude-adapter`: child `claude -p --input-format stream-json --output-format stream-json --permission-mode bypassPermissions`, one process per worker, with Baton's private Claude settings defaulting to unsandboxed command execution. Approval-enabled profiles resolve to `acceptEdits`; the callback is never combined with bypass mode. **Adapter-owned outbox** (nudges never hit stdin mid-turn).
- Northbound MCP tools (minimal): `fleet_spawn`, `fleet_send`, `fleet_wait`, `fleet_result`, `fleet_interrupt`, `fleet_list`.
- **Empirical experiments (this is the point of M0), each a recorded number:**
  1. `fleet_wait` under real host timeouts — set `tool_timeout_sec` (Codex `~/.codex/config.toml`) and `MCP_TOOL_TIMEOUT`/`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` (Claude); confirm the bounded-poll-under-timeout (`HOST_SAFE_MS`) loop + progress heartbeats survive, both directions (Claude-orchestrator and Codex-as-orchestrator via `codex mcp`).
  2. **`turn/steer` behavioral semantics** — does it splice mid-turn or queue? The card may not declare `steer:native` until this passes (red-team `steer` A1).
  3. **Interrupt latency + the unwind window** — time from `fleet_interrupt` to confirmed `turn/completed(cancelled)`, and whether a shell child keeps running past the ack (red-team `interrupt` A1).
  4. **The honest baseline:** `codex exec` in a for-loop vs the minimal hub on ~5 fixed tasks — wall-clock and pass-rate. If the hub isn't already at least competitive on the axes it will later claim, stop and rethink.
- **Falsifies:** the whole event-loop premise, the steer/interrupt reliability premise, and "the hub beats a for-loop" — the three things everything else assumes.

## M1 — The differentiating demo + cross-review + the supervisor (~3–5 weeks)

The two things a `codex exec` for-loop *cannot* do, shipped first because they justify the hub's existence:

- **Differentiating exit demo (name it, gate on it):** orchestrator dies/restarts mid-fleet and resumes command with **pending approvals and worker state intact** (`fleet_list` re-hydration; supervisor I1–I6). A for-loop loses everything on Ctrl-C; the hub doesn't. This is the smallest thing that proves the architecture earns its complexity (product judge C1).
- **Cross-review as the headline (`fleet_review`):** hub-composed tool — worker A implements, worker B *from a different vendor* reviews the diff; the one use case with an existence proof (OpenAI's own plugin). Optional `fleet_bakeoff` (N vendors, same task, judge). Promoted from the old M2 (ambition judge C2).
- **The non-LLM supervisor (the real work):** I1 turn-scoped fencing, I3 at-least-once cursors, I4 bounded poll, I6 drain-first two-phase stop, I7 hub-run verification. Worktree leases with fencing. Priority/bulk lanes (I §4). Single-consumer approval arbiter (I2).
- **Approvals v1:** OS sandbox as the authorization boundary (Codex `sandboxPolicy` / Claude `permissionMode` confine to worktree); deterministic policy engine as a *tightening tripwire/logger only*; out-of-band human notify; timeout → deny-licensing-`status=blocked`. Hub-side watchdog (budget hard-stop + loop-auto-interrupt) that needs **no model turn** — promoted from M2 because the nested-approval padlock (red-team `approval` A4) leaves an unattended fleet otherwise unstoppable.
- **`BatonEvent` v1** with the `surface/model/seat` + `agent_path` envelope (modularity judge C4/C7) + SQLite derived cache (WAL, batched, crash-recoverable — never fsync-per-event); derived signals stall/budget/scope-drift/**semantic-progress** (red-team `adversarial` A4).
- **Cut-down eval at the exit gate:** arms (a) best solo vs (c) fleet on ~10 tasks; explicit pivot criteria (fleet ≤ solo pass-rate and >1.5× wall-clock → halt and rethink). Eval gates M2, not the reverse (Codex review; product judge C2).
- **Auth posture:** API-key is the **default** for unattended/CI; subscription auth is an opt-in, vendor-narrow, on-notice mode (doc 09 §F5). Benchmark the official **Codex SDK** and two-tool **`codex mcp-server`** as lower-ToS-risk alternatives to raw app-server ownership before committing.
- **Falsifies:** does orchestration actually beat a soloist (the eval); does the supervisor hold under fault injection; GLM-in-Claude-harness quality (deferred worker, see below).

## M2 — Full control surface + human seat + hardening (~weeks, earned by M1's eval)

- Control verbs complete with their corrected semantics (doc 05 §4): `nudge` (with `at=tool_boundary`), `steer` (effect-receipt ack; native-Codex-if-M0-verified / emulated-Claude), `fleet_freeze`, honest `pause` (emulated per card), `ask`/`fleet_respond` (the worker's voice — agent-xp C1). "Amendment is loud" conformance assertion.
- `glm-adapter` = claude-adapter + Z.ai env (officially supported config; exact `glm-5.2`, long timeout, auto-compact); scheduler respects plan concurrency ceilings (Pro ≈ 1 in-flight) as a hard input. Evaluate **OpenCode-as-GLM-worker** as a distinct, possibly richer adapter (`opencode serve` REST/WS + `export/import`) if the Claude-harness/GLM mismatch degrades quality. No older GLM example is a supported route.
- `baton top`: TUI dashboard — fleet view, provenance-typed digests (`facts` vs delimiter-wrapped untrusted `prose`), approve/deny, **takeover** (resume worker session in its own TUI).
- **New: worker isolation & threat model** implemented (per-worker throwaway `$HOME`, mount/sandbox enforcement, honey-token canary boot test) — doc 09 §C4.
- Per-vendor backoff/reroute (reroute is a headroom-checked scheduler decision, not a retry cascade); hub-lifecycle recovery (process registry in the ledger, boot reconcile, orphan reaper).
- Adapter conformance suite pinned to installed CLI versions in CI; kill quiesce protocol (T1/T2 numbers) + post-kill integrity pass.
- Red-team pass on cross-agent injection + result-contract forgery (doc 06 Q4, red-team `adversarial` A5/A7).

## M3 — Second northbound + reach (~when earned)

- Conductor mode (Option D): orchestrator under Agent SDK with a true push loop, reusing hub + adapters unchanged (the supervisor already removed the LLM from the liveness path, so this is a northbound swap, not a rewrite).
- ACP southbound tier (Gemini CLI first); draft ACP `steer`/usage extension proposals upstream (ambition judge C4).
- Historical Foreman/homelab posture: **excluded from the current product goal**. Deployment-neutral
  Web/MCP northbound remains; no homelab integration or runtime dependency is pursued.
- Full eval publication (doc 06 Q9) with the harness card + per-vendor cost; routing-by-empirics falls out of the same data.

## Deliberately deferred / cut

- Multi-hub federation / A2A between hubs (until a second machine actually hurts).
- Worker↔worker chat (decomposition smell — doc 06 Q6).
- A public "BatonProtocol" spec (doc 06 Q5 — stay a compatibility layer).
- PTY tier-3 adapter reframed from "fleet view is total" to "known workaround, not a commitment" (ambition judge C7) — build only if a real harness with no other surface must join.
- Web dashboard before the TUI is loved.
- Raw-reasoning capture, editable-approvals-everywhere, generic mid-turn steer as a headline — all until measured demand (Codex review "what to cut").

## Open questions carried into implementation

1. `fleet_wait` block duration vs each host's MCP timeout: hardcode conservative `HOST_SAFE_MS`=25s or probe? (Conservative default + config override; MCP tasks extension — doc 03 — is the eventual native answer, host support varies.)
2. Supervisor: one process owning N adapters (single fence authority, single point of failure + ledger-replay recovery) vs one-per-worker. Leaning single-process.
3. Codex daemon vs per-worker stdio app-server: daemon gives multi-client + remote-control, stdio gives isolation and sidesteps `-32001` broker contention; measure both.
4. Claude Code `--bg` background-agent mode: enough (notifications, reattach) to replace the per-process adapter?
5. GLM-5.2 quality inside the Claude harness vs OpenCode-native (M2 experiment).
6. Where compaction bites: worker-side (brief survival, `thread/goal/set` re-injection) and orchestrator-side (decision-state rehydration via `fleet_recap` replaying own `control.*` + doc 08 decision records — agent-xp C7).
7. Anthropic agent-teams internals (`docs/reference/claude-harness.md`) as integration target: could baton workers appear as "teammates" to a Claude orchestrator, reusing its mailbox/task ledger rather than competing with it?
8. Nested-approval-loop host config: exact tool-annotation + approval-policy stanza per host that makes baton's control verbs auto-approvable, shipped as an install step and verified by the liveness preflight.
