# Baton Fleet Driver — Completeness Report

*Honest assessment against the plan-of-record and the broader vision. Every claim below is grounded in the PLANNED-vs-BUILT matrix and the adversarial verification pass; where the adversarial pass downgraded a "done" claim, this report does not repeat the overclaim.*

> **Historical snapshot:** the measurements below describe the early implementation audited when
> this report was written. They are retained as evidence, not current percentages. The live plan of
> record is `docs/26-full-system-goal.md`; later phases must not use this snapshot to erase scope.

## 2026-07-17 scope and gap refresh

The control/trust spine, native session adapters, authenticated Web/SSE and MCP authority,
Goal/Plan authority, exact route tuples, recovery, recursive Run authorization, and substantial
representation seeds have advanced well beyond this snapshot. Phase 78 is integrating them behind
one repository-oriented deployment and bound-Run surface. Deployment-owned readiness/capacity,
crash-safe export-owner recovery, exact close/reap, profile replay, and current-incarnation
ownership are now implemented behind that surface. Real Codex medium-effort dogfood is green
through >1 MiB telemetry recovery and close/reopen; two Grok Runs proved concurrent admission,
selective stop, and reap, but provider work is auth-red on expired metadata. Recursive
multi-harness provider-success evidence remains incomplete and must use the concise surface rather
than a phase-specific runner.

Phase 79/80 now provide the first bounded dynamic-workflow vertical through that concise surface:
one WorkItem can dispatch an atomic parallel Wave of exact-route Attempts in isolated worktrees,
retain attributable verified Candidates, record typed Candidate-bound feedback, require an explicit
selection, and append a separately approved exact-Candidate-base revision Plan. Live Baton-on-Baton
Codex dogfood completed that loop and closed with zero workers/worktrees. Batch preflight,
all-settled stop/reap, cleanup-incomplete outcomes, compact failure/route/cleanup truth, and bound
member identity checks are covered. This does not complete arbitrary-depth recursion, the adverse
restart/stop matrix, review/debate/synthesis/partition strategy compilation, or the deeper Atlas and
causal-graph catalog.

The intended product remains larger than the integrated control surface. The following are active
scope, not optional details that may disappear from summaries:

- one Pythonic, self-describing application across embedding, CLI, authenticated Web, and MCP,
  with contextual help and progressive Outline → index → section → item depth;
- objective-first calls with no routine caller budgets, provider-turn counts, export/file-size
  ceilings, temp roots, lease coordinates, or host-capacity arithmetic;
- exact independent harness/model/effort routing selected by the orchestrator: Codex
  `gpt-5.6-sol`, native Kimi `kimi-code/k3` at `max`, isolated Kimi K3 through Claude Code at
  `max`, Claude Code `claude-opus-4-6`, Grok 4.5/literal Grok Build only when provider-observed,
  and GLM only `glm-5.2` with context-selected effort such as `xhigh`; no silent fallback and no
  blanket low effort;
- approval-free/full-permission harness launch by default with truthful same-UID containment
  reporting, emergency stop, and exact process/worktree/runtime/lease/export reap;
- continuous reflexive Baton-on-Baton dogfood, including multiple harnesses in parallel and a
  selective kill/reap proof;
- durable recursive-feedback and parallel workflow composition under one Run/Plan: shared logical
  WorkItems with attributable Attempts, typed evidence-bound feedback, review/revision/synthesis,
  exact per-role routing, compact group progress, selective stop/reap, and restart recovery;
- safe collaboration modes that share immutable snapshots, indexes, artifacts, Scratch, and causal
  knowledge while keeping parallel writers in private worktrees; shared writable lineage is
  single-writer/fenced, and direct concurrent multi-writer is not claimed under same-UID full
  access;
- Atlas lexical plus AST/CST structural work, symbol/LSP/SCIP graphs, CPG/CFG/PDG/dataflow/taint,
  compiler/IR, behavioral fingerprints, and structured/semantic delta and merge;
- the remaining capability plane: Vantage, Evidence Ladder, Scratch/Bench, Skill Forge/computer
  use, Cartographer/Quartermaster, and Cairn; and
- a deployment-neutral shared typed causal knowledge graph inspired by `project-manager` concepts,
  with evidence edges, temporal/bitemporal validity, contradiction/supersession, selective
  promotion, and bounded recall. **There is no homelab integration or dependency.**

None of those capability-plane or deeper representation/knowledge items is complete merely because
the Phase 78 application surface becomes usable; each retains its own deterministic, adversarial,
and live-evidence gate.

---

## 1. Headline

Baton's **deterministic coordinator core is real and largely finished; its cross-vendor control surface and its orchestrator-facing northbound are not.** Two numbers:

- **~80% of the MVP plan-of-record (the specs).** The coordinator-core — `log` / `fence` / `messages` / `coordinator` / `worktree` / `referee` / `story` — is ~95% built and heavily tested. The aggregate drops to ~80% because several items the specs label *mvp-contract* are partial or absent: the real-adapter session-control verbs, the MCP/daemon northbound, and the entire capability-plane MVP vertical.
- **~10% of the broader vision (the docs).** A handful of vision modules are genuinely done (adaptive-router module, referee red→green + coverage-of-change hardening, GLM adapter, ask/question flow, StoryCompiler). The rest — capability plane, human seat, session/daemon control, fleet memory, semantic diff/merge, eval publication — is intentionally deferred and unbuilt.

**What this means:** as a *single-process TypeScript library* that spawns, gates, verifies, and replays a fleet of mock (and one-shot real) workers, Baton is solid and the safety spine holds. As *the product described in the plan* — an interruptible, steerable, MCP-exposed cross-vendor driver — the load-bearing control paths only fully work against the in-process `MockAdapter`.

---

## 2. What's DONE (real and verified)

These survived adversarial re-testing intact:

| Capability | Why it holds |
|---|---|
| **Referee freshness guard (R1/C3)** | `freshVerifySandbox` does a real `git worktree add --detach <sha>`; `SameWorktreeError` throws *before* any command runs. The gitignored-plant flagship test proves the fresh checkout never inherits the worker's on-disk artifact. |
| **End-to-end forge-catch (R4)** | Real Coordinator + referee + worktree over a real temp git repo: a forged `completed` yields `status:failed`, `passed:false`, and the planted `done.txt` is absent from the verified tree. The core safety property — a lying worker cannot mint a "completed" — is genuinely enforced. |
| **Construction replay (D10) + durable cursors (D11)** | Independently reproduced cross-process: a log seeded in one process, then a fresh Coordinator built over only the log dir, rebuilds `input_required` / `working` / `cancelled` with no manual seeding. Cursor floors persist to `<logDir>/.cursors/<worker>.floor` and re-serve un-acked digests after restart. This is the orchestrator-death-recovery differentiator, and it is real. |
| **Single-consumer approvals CAS (I2)** | Synchronous check-then-set flips state *before* the first await, so double-respond resolves exactly once and adapter delivery fires once; timeout auto-deny passes exact `{decision:'deny'}`. The race test truly serializes. |
| **`record()` learns from verified wins only** | Strict-boolean gate throws on worker self-report; e2e confirms `verifiedWin === accept(verdict)` using the real router with a real bucket update. (Caveat below: it learns but never routes.) |
| **Append-only JSONL ledger + gap-free durable seq (L1/L3)** | Append-only via `appendFileSync`; `_lastSeq` recovers from disk tail; hub-stamped seq/ts, forge-rejected. Replay rebuilds identical terminal statuses. |
| **Fence primitives (F1)** | Monotonic per-worker fence; `bumpTurn` (fence+turnEpoch), `bumpHuman` (fence only); idempotent register; typed `ok`/`stale_fence`/`unknown_worker`. |
| **Worktree lifecycle mechanics** | Namespacing (W1), pinBaseSha + dirty guard, `createFromBase`, `captureCommit` (dirty-snapshot, no empty commit), sandbox cleanup, `markStopped`+reap gating (W5), boot reconcile zombie sweep (W6), typed errors (W7). |
| **Pure message/story layer** | Deep-frozen Briefs, provenance typing (fact vs prose, forged-marker rejection), deterministic frozen outputs, pure fold with dedup/gap/legal-transition, stall/loop/scope-escape signals. |

---

## 3. What's PARTIAL / STUB (adversarially downgraded — do not treat as done)

These were claimed "done" but the verification pass found them thinner than advertised. **The gap is named in each row.**

| Claim | Real status | The gap |
|---|---|---|
| **`accept()` as sole done-gate** | **Overclaimed.** | The coordinator never gates on `referee.accept()`. `coordinator.mjs:768` re-implements the decision inline (`verdict.reverified===true && verdict.observedExit===expectExit`) and that local boolean, not `accept()`, sets status. `index.mjs:50` calls `accept(verdict)` and **discards the result**. Consequence: `accept()`'s `requireRedGreen` / `requireCoverage` hardening is never plumbed to the gate — those hardenings *can never gate "done,"* and the duplicated gate can silently drift. The safety property survives via real freshness; the "sole gate" wording is literally false. |
| **Two-phase confirmed-stop** | **Overclaimed.** | Real on mock/coordinator, but (a) `_forceStop` fires **only inside `tick()`** — there is no background timer, so if the adapter never confirms and the orchestrator issues no further command, `interrupt()`/`kill()` **hangs forever**; the "never hangs" invariant holds only if the caller keeps ticking. (b) The real-CLI stop path has **zero behavioral coverage**; on one-shot CLIs `interrupt` and `kill` are the same act (signal the process to die), so a "graceful confirmed-stop" is a process death in disguise. |
| **Fencing / stale-command rejection** | **Overclaimed.** | `send()` snapshots the stamp, `await`s `adapter.prompt(...)` — *which is the delivery* — then rechecks. `bumpHuman` invalidates the stamp, but **only after the message already reached the worker.** The recheck suppresses the coordinator's own log entry and returns `stale_fence`; it does not undo delivery. The test asserts the return *value*, not that the worker didn't receive it. Human>orchestrator ordering holds over the log, not over actual delivery. |
| **captureCommit vendor attribution** | **Overclaimed.** | Freshness half is real. But the shipped wiring (`index.mjs:33`) calls `captureCommit(repoRoot, taskId, {})` — **vendor is always `undefined`.** Result: author is `baton-snapshot` (not `baton-worker-<vendor>`) and **only the `Baton-Task` trailer is written — `Baton-Vendor` never is.** Vendor attribution is asserted only in a unit test that passes `{vendor:'mock'}` explicitly, a shape the coordinator never produces. Provenance in the real path collapses to "which task," losing "which vendor." |
| **Real Codex/Claude "spawn native"** | **Partial (unrun).** | The runtime launch/interrupt/kill path in `cli-adapters.mjs` (spawn, stdin write, `_onData`/`_onClose`, SIGKILL) has **zero automated coverage** — it's quota-gated behind `live:true` and never executes in tests. Only argv-builders and parsers (against 4 hand-authored lines each) are tested. The code runs when exercised, but "first-class Codex/Claude adapters" rests on unrun runtime code. |
| **MockAdapter "real git"** | **Overclaimed (and inverted).** | The matrix says the adapter doesn't self-commit and captureCommit does it — that's **backwards.** `MockAdapter._applyEdit` runs a real `git add -A` + `git commit` per edit; captureCommit then finds a clean tree and no-ops. The *goal* (genuine commits e2e) is delivered; the description of *where* the commit happens is wrong. |
| **`createDriver()` assembly** | **Partial — zero direct tests.** | The shipped entrypoint (`index.mjs`) is never imported by any test. `e2e.test.mjs` hand-wires the modules inline in `setupSystem()` and the reimplementation **isn't faithful** — shipped `route()` filters by ceiling and returns `candidates[0]`, while the e2e `routeFn` returns a fixed vendor. The real product entrypoint is exercised only by proxy. |
| **`router.pick()` / adaptive routing** | **Partial — dead in dispatch.** | The AdaptiveRouter fully implements + tests all five rules (decay/seed/UCB/verified-only/minSamples). But `pick()` is **never called anywhere in `src/`** (grep-confirmed). Dispatch uses hand-rolled first-fit `route()`. The router *learns* from verified wins but its scoring never *routes*. |
| **Budget burn signal, end-to-end** | **Partial — unreachable.** | The story module fires 50/80/100% thresholds from synthetic `resource.tokens` events. But the coordinator never accumulates `handle.budgetUsed` and never emits `resource.budget_threshold`, so the digest `budget_alarm` attention is **unreachable end-to-end** and no hub watchdog (budget hard-stop, loop-auto-interrupt) exists. |
| **Deterministic narrative render** | **Partial.** | `renderNarrative` is deterministic and stable, but a trust-gate-completed worker still renders as `active` (no `verify.reverified → done` transition). |
| **`plan-gate` brief flag** | **Stub.** | Brief typedef mentions `planGate`; no code enforces "worker must send plan before working." |

---

## 4. The one-shot adapter question *(the section that matters most)*

**Your instinct is correct.** For the fleet driver's *intended* use — an orchestrator directing full-session workers with streaming telemetry, interruption, and mid-run steering — one-shot adapters are inappropriate, **and the gap is avoidable.** Both vendors ship real session control planes; the one-shot design is an implementation choice, not a vendor limitation.

### The proof is in the code
`cli-adapters.mjs` runs `codex exec --json` and `claude -p --output-format stream-json` as single-prompt children. The prompt is written to stdin and **stdin is immediately closed** (`child.stdin.end()`, `cli-adapters.mjs:142`). Because no further input can ever reach the worker:

- `prompt()`, `steer()`, `approve()`, `answer()` all **hard-return `ok:false` / unsupported** — that's **4 of the 8 verbs** in Baton's own Adapter contract left stubbed on real vendors.
- `interrupt()` is a **SIGINT to the process group that kills the run** (`emulated:true`), not a graceful cancel-keep-session.

The Adapter interface was **designed session-shaped** (8 verbs: card/spawn/prompt/interrupt/approve/answer/kill/onEvent). The one-shot adapters *under-implement* it.

### What one-shot genuinely cannot do
- **Graceful interrupt** — only SIGINT-kills; in-progress work is lost, a full respawn is required.
- **Mid-run steering / context injection** — stdin closed → `steer()`/`prompt()` structurally impossible.
- **Interactive approvals** — `approve()`/`answer()` return `ok:false`; routine prompts are avoided with approval-free modes and Phase 74's explicit full-access defaults (Codex `never`, Claude `bypassPermissions`, Grok `--always-approve`), never answered by the one-shot tier's hub policy. Explicit narrower/session approval paths remain separate.
- **Multi-turn** — single prompt then EOF; no follow-up.
- **Session resume / fork / reattach** — no control-session id tracked.

### What the session surfaces already provide
| Vendor | Session surface | Gives you |
|---|---|---|
| **Codex** | `app-server` (JSON-RPC / NDJSON) | `turn/start` (multi-turn), `turn/steer` (redirect an *active* turn), `turn/interrupt` (turn ends `interrupted`, **thread survives**), `thread/inject_items`, `thread/resume` + `thread/fork`, approvals as server→client requests answered centrally (`item/*/requestApproval`). |
| **Claude** | `--input-format stream-json` (open stdin) **or** Agent SDK `Query` | Real-time streaming input for multi-turn + inject (`shouldQuery:false`), `interrupt()` returning a receipt that **leaves the session alive**, `canUseTool` / `--permission-prompt-tool stdio` for interactive per-tool approval, `--resume`/`--continue`/`--fork-session`, richer telemetry (`session_state_changed`, `tool_progress`, `rate_limit_event`). |

**All of these map cleanly onto Baton's existing 8 verbs** — no interface change is needed, only filling the four stubbed verbs with the real control planes.

### Effort to build session adapters
Moderate and de-risked — Baton was built for this (session-shaped contract, existing BatonEvent parsers, single-terminal/append-log discipline, and both protocols are already reverse-engineered in `docs/reference`):

- **Claude session adapter — smaller lift (~1–2 days):** swap one-shot `-p` for `--input-format stream-json --verbose` with a persistent stdin writer + control-frame reader, wire `canUseTool` via `--permission-prompt-tool stdio`, map `interrupt()` → control_request. Or simply delegate all 8 verbs to the Agent SDK `Query` object. **Build this first — smallest lift, biggest coverage.**
- **Codex app-server adapter — larger lift (~3–5 days):** a real JSON-RPC/NDJSON client (initialize handshake, per-request timeout, event demux keyed on `(threadId,turnId)`, answer `item/*/requestApproval`, handle `-32001` contention with private-child fallback). OpenAI's own plugin is a ~9-method reference implementation.

### Where one-shot is genuinely fine (keep it)
One-shot is the *right* tool — not a compromise — for **fire-and-forget, well-specified build/fix tasks that fit a single turn and are verified externally**, which is exactly the trust-gate model (hub re-runs the pinned check; worker self-report is never trusted). When the brief needs no mid-run correction, sandbox is an acceptable substitute for interactive approval (the trust gate catches bad output anyway), no human sits in the tool-call loop, and "interrupt" can mean "abandon and respawn," one-shot is simpler and has fewer moving parts.

**Recommendation:** make session-mode the **default tier** for the driver's interruptible/steerable/interactive workloads, but **keep the one-shot classes as an explicit labeled "fire-and-forget" fast tier.** `card().verbs` already advertises the truth (`steer:unsupported`), so the hub can route by capability: tasks tagged `interruptible`/`steerable`/`needs-approval`/`multi-turn` → session adapter; `one-shot`/`verified-build` → fast tier. The failure mode isn't *having* one-shot — it's using it as the **default** for workloads the fleet driver is meant to run.

---

## 5. Intentionally DEFERRED / CUT (not "missing work")

Don't mistake these deliberate scope decisions for incompleteness:

- **Entire capability plane** — search/`repo_map`/test-rung/ACI-envelope/ledger-cost/atlas/scorecard. Deferred by design (doc 19). *(Caveat: its items are labeled mvp-contract, so they still weigh on the contract %.)*
- **Elixir/OTP production core port** — cut; MVP stays TypeScript (doc 17).
- **Multi-machine / remote fleet, foreman posture, A2A federation, remote-control daemon + pairing** — single box only.
- **Proof-ladder rungs above `test`** (proptest→fuzz→BMC→SMT→proof), semantic diff/merge, structured merge + effect tripwire — deferred bets.
- **Fleet memory (cross-run), worker tool suite, human seat/takeover, fancy monitor UI, web dashboard** — vision, unbuilt.
- **Retired framings** — "neutral trust institution," "Referee-not-Conductor," "crown-jewel / proof-carrying," emergence/reflexive-capability over-claim, best-of-N ensemble, "measure-first / don't build the driver" hedging. Correctly stood down.
- **`worker↔worker` chat, `fleet_chat` single-channel, public "BatonProtocol" spec, PTY/tmux tier-3, `approve(edit)`, `pause` verb** — correctly cut; coordination stays stigmergic.

---

## 6. Biggest real gaps, ranked (what to build to close the distance)

1. **Session-mode adapters (Claude first, then Codex).** The single largest gap. Mid-run steer, inject, interactive approval, multi-turn, and graceful (keep-session) interrupt work *only* against `MockAdapter`. This is the core product promise, and it's avoidable — both vendors ship the control planes and Baton's interface already fits them. **Claude ~1–2 days, Codex ~3–5 days.**
2. **MCP northbound / hub daemon / `fleet_*` tools.** None exist in `src` (grep: 0). The orchestrator-facing socket the whole design centers on — plus the `fleet_wait` long-poll bridge and cross-vendor `fleet_review`/bakeoff — is unbuilt. Baton ships as an in-process library, not the daemon the plan describes.
3. **Wire `accept()` (with its hardening) as the real done-gate, and `router.pick()` into dispatch.** Two load-bearing modules are built, tested, and then bypassed. `accept()`'s `requireRedGreen`/`requireCoverage` can never gate "done"; the AdaptiveRouter learns but never routes. Closing these makes existing, tested code actually load-bearing — high value per unit effort.
4. **Budget end-to-end + hub watchdog.** Accumulate `handle.budgetUsed`, emit `resource.budget_threshold`, and make the digest `budget_alarm` reachable; add the budget hard-stop / loop-auto-interrupt watchdog that runs without a model turn.
5. **Worktree lifecycle completion.** Three named MVP behaviors missing: no merge/integration step (lifecycle stops at a verified branch), no git-exclude of `.baton/` (left to callers), and `git push` is not approval-gated (irreversible-side-effect gate absent).
6. **Fix the confirmed-stop liveness hole and cover the real-CLI stop path.** Either a bounded internal timer or a documented "caller must keep ticking" contract, plus behavioral tests for real-adapter interrupt/kill — today it's SIGINT-kill with zero coverage.
7. **Direct tests for `createDriver()`; fix the drifting e2e reimplementation.** The shipped entrypoint is unexercised and the inline e2e wiring already diverges from the real `route()`.
8. **Run the eval.** A green suite doesn't prove the cross-vendor thesis: M0 steer/interrupt-latency and fleet_wait-under-timeout measurements, M1 arms, and E2 decorrelation are all unrun — and most of what they'd measure (steer, app-server) doesn't exist yet, which is exactly why #1 comes first.

*Net: the trust spine and deterministic core are trustworthy and well-tested; the distance to the plan is almost entirely the real-vendor session control surface and the northbound — both anticipated by the existing interfaces, neither yet built.*
