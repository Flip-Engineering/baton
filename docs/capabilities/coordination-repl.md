# Scratch — the fleet's operational blackboard & coordination REPL — baton capability module

*Capability-plane module. Two co-designed surfaces: **the Board** (an ephemeral tuple-space blackboard for shared operational state) and **the Bench** (a hub-owned sandboxed kernel the fleet co-uses for quick shared computations). Ground truth stays the event ledger; the Board is a live, mutable projection over it. Researched 2026-07-09 against real 2025-26 systems.*

## Summary (5 bullets)

- **Not one more store — a fast lane with a different consistency contract.** Baton already has three memory tempos (doc 08): the operational ledger, the coordinative task-DAG, the epistemic graph. Scratch is the *interactive working set* that sits beside the ledger at operational tempo — the thing you can `take`, `CAS`, and TTL-evict, which a pure append-only ledger can't be. It answers "anyone in `payments/` right now?" and "the failing test is flaky, seed=42 repros" in one round-trip, without the ceremony of a task or the durability of a finding.
- **Tuple-space verbs, per-cell-type consistency — deliberately NOT a monolithic CRDT.** Coordination primitives are Linda's `write/read/take/notify`; but consistency is chosen *per cell type*: append-only **facts** (contention-free), CAS **cells** (optimistic, fail-and-reread), leased **claims** (soft advisory locks with heartbeat expiry), LWW **signals** (presence). A general CRDT rich-text doc is rejected as the core — it is exactly the "shared mutable world-state blob" doc 08 §4 outlaws, and convergence ≠ semantic correctness (CodeCRDT itself concedes this).
- **The Bench is a sandboxed, addressable, memoized kernel — not an ambient shared shell.** Default executions are stateless and content-addressed (`(code, env_ref) → memoized result`), so "does seed=42 repro?" is computed once and *read* by the whole fleet as a fact. A genuinely co-used stateful kernel (Jupyter-IOPub-style, many observers) exists but is opt-in, named, claimed, and serialized. Reuses the OS-sandbox that doc 05 §5 already made the authorization boundary — no new trust model invented.
- **The Board is a materialized view over the ledger, not a second source of truth.** Every mutation emits a `scratch.*` event; if the Board process dies, replay rebuilds it — the same "ledger is the only truth, everything else is a projection" invariant baton applies to its SQLite index (doc 08 §4). Claims obey the supervisor's lease/fence machinery (I1), so a crashed worker's soft lock expires instead of wedging the fleet — fixing the exact "dead teammate wedges a task" bug the prior-art found in Anthropic agent teams.
- **Ephemeral by design; promotes, doesn't accumulate.** Cells TTL out. A fact that is cited (read N times or referenced by a task) becomes a promotion candidate at a task/run boundary, emitted `pm_log_finding`-shaped into the epistemic plane and its produced script/dataset into the git artifact registry. Losing the Board loses in-flight coordination, never durable knowledge.

## The problem for an agent fleet (why harness-native tools are insufficient)

A worker harness is a solipsist. Codex and Claude Code each maintain a private transcript, a private plan, a private working set; neither has any primitive to answer "is another agent already editing this file?" or "has anyone already reproduced this failure?" The harness-native memory that *does* exist is the wrong shape three ways:

1. **It's per-worker, not shared.** Codex `~/.codex/memories/` and Claude session JSONL are single-writer files keyed to one thread (doc 08 §4, §7). They're durable and private — the opposite of what live coordination needs. Two workers in the same fleet cannot see each other's in-flight state through them at all.

2. **The shared surfaces that exist are coordinative, not operational.** Anthropic agent teams ship a real shared task ledger + mailbox (`~/.claude/tasks/`, `~/.claude/teams/…/inboxes/`), but their granularity is the *task* and their claim is a *hard, durable* owner assignment gated by file-locking (doc 08 §1). That is minute-to-hour tempo. It is far too heavy for "heads up, I'm about to touch `payments/` for the next 90 seconds" — a sub-task, advisory, self-expiring signal that shouldn't create a durable task record, shouldn't gate anyone's ready-work, and shouldn't survive the worker that posted it. Forcing that through the task-DAG is the "minute-scale coordination through a provenance-heavy graph" failure doc 08 §1 warns against; it also re-creates the teams bug where a dead owner's claim wedges work because there's no lease.

3. **There is no shared compute at all.** When the fleet needs a *derived fact* — "is this test flaky or deterministic?", "what's the diffstat between these two branches?", "does this SMT constraint hold?" — every worker recomputes it privately, in its own turn, burning its own tokens, and arrives at possibly-inconsistent answers. There is no place to run the check *once* and let the finding be observed. This is the multi-agent version of the token problem Anthropic's "code execution with MCP" and Cloudflare's "Code Mode" solve for a single agent (write code, filter in the sandbox, return only the answer) — but *shared*, so the sandbox's answer becomes fleet knowledge, not one worker's context.

The orchestration angle sharpens all three. A fleet is inherently **concurrent multi-writer** — the hard problem the single-curator memory tools (PM, Letta, Codex memories) never have to solve (doc 08 §2). And the coordination it needs is mostly **stigmergic**: agents shouldn't pairwise-message ("hey w3, are you in payments?"); they should observe a shared environment and react (CodeCRDT, Terrarium). Harness-native tools give a fleet neither a shared environment to observe nor a safe way to write to one. That's the gap Scratch fills — and it must fill it *without* becoming the `state.json` blob that every naive swarm deadlocks on (doc 08 §4), or the `fleet_chat` chatroom doc 05 §6 refuses.

## Prior art

| Tool / system | What it does | 2025-26 status | What baton borrows | What baton rejects |
|---|---|---|---|---|
| **Linda tuple spaces** (Gelernter) | Generative comms: `out/in/rd/eval` over a content-addressed shared space; producers/consumers never name each other | Classic; actively revived as the coordination substrate for LLM fleets ([tuple-space problem-solving](https://www.sciencedirect.com/science/article/abs/pii/S0164121299000199), [Terrarium](https://arxiv.org/html/2510.14312v1)) | The verb set (`write/read/take/notify`) and content-addressed, name-free coordination as the Board's API | Blocking `in`/`take` as the *default* read (deadlock-prone with stochastic agents); global locking |
| **Hearsay-II / blackboard** | Agents post to shared problem-solving state; opportunistic, event-driven activation | Empirically resurgent: [LLM blackboard system](https://arxiv.org/html/2510.01285v1) reports **13–57% task-success gain** over RAG & master–slave | The blackboard as the mental model: post partial state, observe, react; event-driven not request-driven | Centralized serialization of *all* writes (doc 08's SPOF worry); unstructured free-text posts |
| **PatchBoard** | Shared JSON state mutated only via schema-validated [RFC 6902](https://datatracker.ietf.org/doc/html/rfc6902) patches (`add/replace/remove/test`); every change auditable | 2026 research ([arxiv 2605.29313](https://arxiv.org/pdf/2605.29313)) | Schema-grounded mutation for CAS cells; `test`-op = optimistic-concurrency precondition; patch-as-audit-record | Patches as the *only* write path (too heavy for append-only facts & presence signals) |
| **CodeCRDT** | Multi-agent code-gen where agents coordinate by **observing** a Yjs-CRDT shared buffer (stigmergy), no message-passing | 2025 research ([arxiv 2510.18893](https://arxiv.org/pdf/2510.18893)) | Observation-driven / stigmergic coordination as the interaction style; `watch` as the core verb | CRDT as the *core* state model — it concedes convergence lacks semantic guarantees under stochastic writers |
| **Yjs / Automerge / Loro** | Production CRDT libs — Yjs (default, biggest ecosystem), Automerge (git-like history), Loro (fastest, [still experimental](https://loro.dev/)) | Mature 2026 ([comparison](https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026), [benchmarks](https://github.com/dmonad/crdt-benchmarks)) | Held in reserve for **one** case: a co-edited free-text region, and for future multi-*hub* federation (real partitions) | CRDT for single-hub shared structured state — the hub is already a serialization point; CRDT would hide lost updates as "merges" |
| **Jupyter kernel protocol + jupyter-collaboration** | One kernel, many clients; [IOPub](https://jupyter-client.readthedocs.io/en/stable/messaging.html) broadcasts every execution's side effects to all frontends; [RTC](https://github.com/jupyterlab/jupyter-collaboration) is Yjs-backed | Standard; RTC default-on in JupyterLab 4.x | The shared-kernel model for the Bench: many observers, IOPub-style broadcast of outputs | Shared *mutable namespace* as the default (lost-update generator across cells); browser-frontend assumptions |
| **Anthropic "Code execution with MCP" / Cloudflare "Code Mode"** | Agents write code to call tools; intermediate data stays in-sandbox, only the answer returns — [98.7% token cut](https://www.anthropic.com/engineering/code-execution-with-mcp) / [~1k tokens](https://blog.cloudflare.com/code-mode-mcp/) | Nov 2025, both vendors | The Bench *is* baton's code-exec surface: compute in-sandbox, return a token-bounded fact | Per-worker/private execution — baton makes the result a *shared* memoized fact |
| **E2B / Modal / Daytona / Cloudflare & Vercel Sandbox** | Managed agent code sandboxes — Firecracker microVM (E2B), gVisor (Modal), hardened containers 27–90ms (Daytona), pause/resume default | Exploded 2025-26; [Modal $4.65B](https://mcp.directory/blog/cloudflare-sandbox-vs-modal-vs-e2b-vs-daytona-2026), persistence now table-stakes | The isolation menu for the Bench's execution tier; pause/resume/checkpoint for named sessions | Cloud dependency for the MVP — reuse baton's local OS-sandbox first, adopt these as a Bench backend tier |
| **Redis agent-memory-server / LangGraph RedisStore / CrewAI** | Centralized shared state: any agent reads/writes, writes immediately visible; short-term + long-term split | Active 2026 ([redis/agent-memory-server](https://github.com/redis/agent-memory-server), [LangGraph memory](https://docs.langchain.com/oss/python/langgraph/add-memory)) | Short-term/long-term split maps to Board(ephemeral)→KG(durable); namespace+TTL as first-class fields | "Any agent writes anything, instantly global" — [contention under high write loads](https://zylos.ai/research/2026-03-09-multi-agent-memory-architectures-shared-isolated-hierarchical/) is acknowledged even by proponents; no typed consistency |
| **claude-flow `shared_state`** | SQLite KV blackboard with `namespace + TTL`, used by concurrent Claude subagents | alpha; own [issue #695](https://github.com/ruvnet/ruflo/issues/695): cwd-relative path → memory fragments into 14 DBs | `namespace + TTL` as ledger columns; hub owns **one canonical path** per fleet | cwd-relative resolution; KV-as-everything (facts/claims/cells deserve types) |
| **Letta memory blocks** | Labeled, char-capped shared regions; write discipline per-tool: `insert` append-safe, `replace` CAS-fail, `rethink` LWW | Requires a running Letta server (doc 08 §4) | The **exact write discipline** — append free-for-all / replace-CAS / rewrite-owner-only — mapped onto fact/cell/signal | Durable server-hosted agent objects; sociological "designate an owner" as the concurrency story |

## Module design

### Agent-facing interface (MCP verbs)

Two namespaces. The Board is tuple-space-shaped; the Bench is a sandboxed kernel. All verbs are hub-mediated, fence-checked, and emit ledger events.

```ts
// ── The Board (tuple-space blackboard) ─────────────────────────────
// FACTS — append-only, immutable, content-addressed. Contention-free (append never conflicts).
scratch_post(
  kind: 'fact' | 'signal',
  body: Json,                         // structured; NOT prose — schema-checked if a schema is registered
  opts?: { key?: string, tags?: string[], ttl?: Ttl, confidence?: number,
           supersedes?: cell_id, publish_from?: exec_id }
) -> { cell_id, seq }

// CLAIMS — SOFT advisory locks (the "anyone in payments/?" fast lane). CAS acquire + lease.
scratch_claim(
  resource: string,                  // e.g. "path:payments/**", "test:test_auth", "port:5432"
  intent: string,                    // short: "refactoring stripe adapter"
  ttl: Ttl,                          // derived from task budget/heartbeat — NOT a magic constant
  opts?: { heartbeat_s?: number, exclusive?: boolean }
) -> { claim_id, lease_expires }
   | { conflict: [{ holder: worker_id, intent, resource, lease_expires }] }   // advisory: caller decides
scratch_heartbeat(claim_id) -> { lease_expires }
scratch_release(claim_id)   -> void

// CELLS — mutable shared scalars, optimistic-concurrency (PatchBoard/Letta replace-CAS).
scratch_cas(cell_id, expect_version, body: Json) -> { ok, version } | { stale, current, version }

// OBSERVE — the stigmergic read. Token-bounded digest; never dumps the whole board.
scratch_read(query: { tags?, kinds?, keys?, resource_glob? }, level?: 'digest'|'full')
  -> ScratchDigest
// WATCH — bounded-blocking notify (Linda `notify`); same cursor discipline as fleet_wait (I3/I4).
scratch_watch(query, cursor, timeout_ms<=HOST_SAFE_MS) -> { events: ScratchEvent[], cursor, more }

// RETRACT — loud correction (poster, orchestrator, or human). Never silent (doc 05 "no invisible hand").
scratch_retract(cell_id, reason: string) -> { seq }

// ── The Bench (shared sandboxed kernel) ────────────────────────────
// DEFAULT: stateless, addressable, MEMOIZED. Same (code, env_ref) → cached result the fleet shares.
bench_run(
  code: string, lang: 'python'|'bash'|'node',
  opts?: { env_ref?: string,         // a pinned worktree/commit; makes the result reproducible & cacheable
           timeout_ms?, session?: session_id,
           publish_as?: { kind: 'fact', key?, tags? } }   // auto-post result as a Board fact
) -> { exec_id, status, value_digest, stdout_tail, artifacts: [ref], cached: boolean }
// OPT-IN: a named persistent kernel (Jupyter-style co-use). Executions serialized; observers broadcast.
bench_session(name, base_env?) -> { session_id }
bench_observe(target: exec_id|session_id, cursor) -> { output: IOPubDelta[], cursor, more }  // bulk lane
bench_interrupt(exec_id) -> Ack          // two-phase, like a turn (supervisor I6)
bench_kill(session_id)   -> void
```

Design notes that carry weight: `scratch_claim` returns the conflict **as data, not an error** — it is advisory; the caller (or orchestrator) decides whether to yield. This is the deliberate fast-lane trade: no enforcement, so no serialization stall, so a one-round-trip "who's here?". The hard boundary stays the OS sandbox + worktree (doc 05 §5). `bench_run` defaults to stateless+memoized precisely so the common case — "did anyone already check X?" — is a cache hit that costs nothing and returns the same answer to everyone.

### Integration with the three planes

**Ledger (operational, doc 05).** Extend the closed `kind` taxonomy with a `scratch.*` family, each carrying `actor` (`worker|orchestrator|human|policy`):
`scratch.fact_posted`, `scratch.signal`, `scratch.claim_acquired/heartbeat/released/expired`, `scratch.cell_updated`, `scratch.retracted`, `bench.exec_started/completed/interrupted`. The Board is the **materialized view** of these events; the SQLite Board table is a projection rebuildable by replay — identical to how the event index relates to the JSONL truth (doc 08 §4). This is the single most important architectural commitment: *the Board is never its own source of truth.* Bench output deltas are `bench.*` on the **bulk lane** (coalescible/droppable, doc 05 §4), so a chatty shared kernel degrades resolution, not fleet safety; claim/fact/retract events ride the priority lane.

**Artifact registry + task-DAG (coordinative, doc 08 §3).** The Bench is a producer of artifacts: an `exec_id` that generates a repro script or a computed dataset writes `{exec_id → {script, output_ref, env_ref}}` into the registry, git-native, keyed so the artifact is reproducible. The Board does **not** write to the task-DAG — its claims are sub-task and advisory. The relationship is one-directional and explicit: a soft claim that keeps getting renewed and blocks real progress is a *signal to the orchestrator* to mint a hard task; the Board never auto-promotes itself into a dependency.

**Knowledge plane (epistemic, doc 08 §5).** Promotion, not duplication. At task/run boundaries the hub scans cited facts (read ≥N times or referenced by a completed task's result) and emits them `pm_log_finding`-shaped into the epistemic graph, with a provenance edge to the `scratch.fact_posted` event and any `bench.exec_completed` that produced it — satisfying doc 08's temporal-coherence invariant automatically (the finding cites events that provably preceded it, by `seq`). A `scratch_retract` promotes as a correction with a `Supersedes` edge. Everything un-cited simply TTLs away, uncurated — which is the point.

**How the orchestrator STEERS it.** The Board and Bench are hub-owned resources under the supervisor, wielding the same control vocabulary as workers:
- **Freeze** — `scratch_freeze(scope)` makes matching cells read-only during a critical merge (analogous to `fleet_freeze`, doc 05 §4).
- **Evict / retract** — the orchestrator can retract a poisoned fact (a worker posted a wrong "the API is idempotent" that others are trusting); the retraction is loud and event-logged, never a silent delete (doc 05 amendment rule).
- **Claim arbitration** — because claims use the same lease/fence machinery as worker leases (supervisor I1), a claim held by a crashed worker **expires on heartbeat timeout** and emits `scratch.claim_expired` — no dead-owner wedge. Human > orchestrator > policy precedence holds on retraction/freeze by fence, not politeness.

**How it's interrupted.** `bench_interrupt(exec_id)` is two-phase (supervisor I6): request → sandbox SIGTERM→SIGKILL → confirmed-dead → `bench.exec_interrupted`. A runaway shared computation cannot wedge the fleet, and the Bench sandbox is torn down on kill exactly like a worker process. Bench results are subject to I7: a `bench` result is an *unverified claim* with an "untrusted worker output" provenance frame until the hub independently re-runs the brief's verification — a worker cannot launder a wrong answer into fleet-trusted truth by posting it as a fact.

### Agent-ergonomic output shape

`scratch_read({ resource_glob: "payments/**", kinds: ['claim','fact'] })` — the "who's in here and what do we know?" call — returns a bounded digest, not a dump:

```json
{ "as_of_seq": 88231,
  "claims": [
    { "resource": "path:payments/stripe_adapter.py", "holder": "w_codex_01",
      "intent": "refactoring retry logic", "lease_expires": "+41s", "exclusive": true } ],
  "facts": [
    { "cell_id": "f_9a3", "key": "test:test_charge_flaky", "confidence": 0.8,
      "body": { "flaky": true, "repro_seed": 42, "fail_rate": "3/10" },
      "by": "w_claude_02", "via_exec": "bx_5f1", "age": "2m", "cited": 4 } ],
  "signals": [ { "key": "presence:payments", "workers": ["w_codex_01"], "ttl": "20s" } ],
  "counts": { "claims": 1, "facts": 1, "signals": 1, "suppressed": 6 },
  "more": "cursor:88231:payments" }
```

Roughly 200 tokens; `suppressed` + `more` bound the size regardless of Board volume (the doc 05 §3 digest discipline). A `bench_run` reply is equally tight — the sandbox holds the intermediate data (the Code-Mode filtering benefit), the model sees only the answer:

```json
{ "exec_id": "bx_5f1", "status": "ok", "cached": false,
  "value_digest": { "flaky": true, "fail_rate": "3/10", "repro_seed": 42 },
  "stdout_tail": "…FAILED test_charge[seed=42] (3 of 10 runs)…",
  "artifacts": ["registry://run/repro_charge.sh"],
  "published_fact": "f_9a3" }
```

A conflict on `scratch_claim` returns the holder(s) as data (shown above), so the reasoning agent decides to wait, negotiate, or proceed — the fast lane never blocks it.

### Shared vs per-worker

The Board is **fleet-shared, one per fleet-run**, hub-owned at a single canonical path namespaced by `fleet_id` — explicitly dodging claude-flow's cwd-relative fragmentation bug (doc 08 §3; [ruflo #695](https://github.com/ruvnet/ruflo/issues/695)). Concurrency falls out of the per-cell-type consistency choice, and the surface area that needs serialization is deliberately tiny (mirroring doc 08 §4's "claims are the only place that needs serialization"):

- **Facts** — append-only, content-addressed ⇒ contention-free; concurrent posts never conflict (Letta `insert`, Terrarium append-log).
- **Signals** — LWW, short TTL ⇒ presence is naturally last-writer-wins; no coordination needed.
- **Claims + CAS-cells** — the *only* serialized paths: CAS on a hub transaction, typed failure (`already_held` / `stale`). Losers re-read; nobody blocks.
- **Bench (stateless)** — per-call isolated sandboxes; memoization is a shared read-through cache keyed by `(code, env_ref)`, so parallelism is free and the result is shared without shared mutable state.
- **Bench (named session)** — shared namespace, but executions on one session are **hub-serialized and queued** with IOPub-style broadcast to observers; the shared *mutable* kernel namespace is the one genuinely dangerous case, which is why it's opt-in, named, claimable, and last on the roadmap.

There is no `state.json`-style shared blob anywhere; the Board is a set of independently-versioned typed cells, so the lost-update/deadlock class doc 08 §4 warns about cannot arise.

## Scoping (MVP rung vs later rungs)

- **Rung 0 (MVP — ships with the hub, no code execution, no new trust surface): the Board, facts + claims + read/watch.** Backed entirely by `scratch.*` ledger events + a SQLite projection. This alone delivers the two motivating use-cases — the `payments/` soft-claim fast lane and the "flaky, seed=42" shared fact — with zero sandbox, zero kernel, zero CRDT. Smallest useful version; a few days on top of the existing ledger/cursor plumbing (reuses I1 leases, I3/I4 cursors).
- **Rung 1: CAS cells + schema-grounded validation (PatchBoard discipline) + loud retraction + boundary promotion to the KG.** Adds mutable shared scalars and the epistemic handoff.
- **Rung 2: the Bench, stateless tier.** Sandboxed, memoized `bench_run` reusing the OS-sandbox boundary (doc 05 §5); `publish_as` closes the compute→fact loop. This is where code execution enters — gated behind the *existing* confinement, not a new one, and subject to I7 (results are claims until hub-verified).
- **Rung 3: named shared kernel sessions.** Jupyter-IOPub co-use, `bench_observe`, opt-in and claimed. The genuinely-collaborative REPL — most powerful, most dangerous, so last.
- **Rung 4 (only on demonstrated need): a single co-edited free-text "whiteboard" region via Loro/Yjs**, and Board federation across hubs (the mesh posture, doc 04) — the *one* place a CRDT finally earns its keep, because federation is where real concurrent multi-writer across a partition exists. Explicitly deferred; single-hub does not need it.

## Limitations & honest residuals

- **Advisory claims are advisory.** A soft lock is a courtesy, not a fence — a worker can ignore "someone's in `payments/`" and the Board won't stop it. This is intentional (enforcement lives in the OS sandbox + worktree isolation), but it means the Board coordinates *cooperative* agents; it is not a mutual-exclusion mechanism. Naming it a "lock" would be a lie; it's a presence marker.
- **The Board does not adjudicate truth.** Two contradictory append-only facts ("test is flaky" / "test is deterministic, env-dependent") can coexist live. Confidence, poster, and `supersedes` help; the orchestrator/human can retract; but semantic incoherence is a real residual of any fast, un-adjudicated lane — the epistemic plane, with provenance and temporal-coherence audits, is where contradictions get resolved, and that's deliberately *not* this module's job. CodeCRDT's core finding applies: convergence is not correctness.
- **The Bench is a poisoning and trust surface even when sandboxed.** A subtly-wrong shared script produces a fact the fleet trusts. Mitigation is the I7 provenance frame (bench results are claims; verification is hub-run and independent) — but this bounds blast radius, it doesn't eliminate the risk of a plausible-wrong shared computation. The named-session shared namespace additionally risks cross-worker state clobber; that's why it's the last rung and serialized.
- **TTL is a genuine tuning knob, and must not become a magic number.** Too short, coordination markers vanish mid-work; too long, the Board silts up with stale intent. Per this codebase's "no arbitrary numeric limits" rule, claim TTLs are *derived* from the owning task's budget/heartbeat cadence, not a hardcoded constant — but getting the derivation right needs live calibration, same as doc 05's stall thresholds.
- **Promotion policy is inherited, not solved.** "Which facts graduate to the durable graph without a per-event tax or a curation backlog?" is doc 08 §7's open question; Scratch narrows it (cited-fact heuristic) but does not close it — over-promotion re-poisons the KG, under-promotion loses hard-won derived facts.
- **It must not drift into `fleet_chat`.** The strongest failure mode is social: agents posting prose "facts" as messages until the Board is a chatroom, the exact anti-pattern doc 05 §6 refuses. Guardrails — facts are typed/keyed/schema-checked, not free-text; there is no `to:` field; watch is content-addressed not agent-addressed — keep it a blackboard, but this is a discipline the design can only *bias*, not enforce.
- **Single-host only in the MVP.** One hub owns one Board. Cross-host fleets (foreman/mesh postures, doc 04) need federation, which reopens real concurrent multi-writer and is where the deferred CRDT tier lives. Until then, "shared" means "shared within one hub's authority."

## Sources

**Baton internal (design constraints this module must satisfy)**
- `$HOME/Development/Experiments/baton/docs/05-telemetry-steering.md` (event taxonomy, digest levels, control verbs, no-`fleet_chat`, OS-sandbox-as-boundary)
- `$HOME/Development/Experiments/baton/docs/08-shared-memory-and-pm.md` (three memory tempos; no-shared-world-state; claims-are-the-only-serialization-point; selective promotion)
- `$HOME/Development/Experiments/baton/spec/supervisor-state-machine.md` (I1 fences/leases, I3/I4 cursors, I6 two-phase stop, I7 hub-run verification, bulk/priority lanes)
- `$HOME/Development/Experiments/baton/docs/reference/memory-pm-prior-art.md` (Anthropic teams mailbox/task ledger, Letta blocks, claude-flow SQLite, beads — reverse-engineered local evidence)

**Coordination architectures (2025-26 research)**
- CodeCRDT — observation-driven / stigmergic Yjs coordination for multi-agent code-gen: https://arxiv.org/pdf/2510.18893
- LLM-based Multi-Agent Blackboard System (13–57% gain over RAG/master–slave): https://arxiv.org/html/2510.01285v1
- PatchBoard — schema-grounded (RFC 6902) auditable state mutation: https://arxiv.org/pdf/2605.29313
- Terrarium — append-only common-log blackboard for safety/privacy: https://arxiv.org/html/2510.14312v1
- Coordination as an Architectural Layer for LLM multi-agent systems: https://arxiv.org/pdf/2605.03310
- Multi-agent tuple-space problem-solving framework (Linda lineage): https://www.sciencedirect.com/science/article/abs/pii/S0164121299000199

**CRDT libraries & benchmarks**
- Yjs: https://github.com/yjs/yjs · Loro: https://loro.dev/ · comparison: https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026 · benchmarks: https://github.com/dmonad/crdt-benchmarks

**Shared REPL / kernel**
- Jupyter messaging protocol & IOPub broadcast: https://jupyter-client.readthedocs.io/en/stable/messaging.html
- jupyter-collaboration (Yjs-backed RTC, shared kernel): https://github.com/jupyterlab/jupyter-collaboration · https://jupyterlab.readthedocs.io/en/stable/user/rtc.html

**Code-execution-as-coordination & sandboxes**
- Anthropic, Code execution with MCP: https://www.anthropic.com/engineering/code-execution-with-mcp
- Cloudflare, Code Mode: https://blog.cloudflare.com/code-mode-mcp/
- Sandbox landscape (E2B/Modal/Daytona/Cloudflare/Vercel, 2026): https://mcp.directory/blog/cloudflare-sandbox-vs-modal-vs-e2b-vs-daytona-2026

**In-memory shared state (production)**
- Redis agent-memory-server: https://github.com/redis/agent-memory-server · LangGraph memory (RedisStore/checkpoint): https://docs.langchain.com/oss/python/langgraph/add-memory
- Multi-agent memory architectures (shared/isolated/hierarchical; contention analysis): https://zylos.ai/research/2026-03-09-multi-agent-memory-architectures-shared-isolated-hierarchical/
- claude-flow shared_state fragmentation bug: https://github.com/ruvnet/ruflo/issues/695

---

# Appendix: Design critique (workflow critic pass)

Citations verified (PatchBoard 2605.29313, CodeCRDT 2510.18893, blackboard 2510.01285, Terrarium 2510.14312 all resolve to real papers). Grounded in the four baton docs. Here is the critique.

## Design critique & sharpening for coordination-repl

**Verdict up front.** The dossier is unusually disciplined — the "Board is a materialized view over the ledger, never its own truth" commitment and the per-cell-type consistency table are the right spine, and the prior-art is real (I resolved every arXiv ID). But it earns its rigor on the *orchestrator's* view of the Board and then quietly ducks the three hardest problems that are the entire reason to build it: (1) how a **worker mid-turn** actually participates without a polling tax, (2) what a "fact" means when the fleet's defining feature is **diverging worktrees**, and (3) that memoization + I7 certify **reproducibility, not correctness** — which silently launders formal/derived claims into fleet-trusted truth. Fix those and this is buildable. As written, Rung 0 ships a board the orchestrator can *watch* but that doesn't yet *coordinate workers* — the thing that makes it useful.

---

### 1. Scoping: mis-partitioned, not mis-sized

Rung 0 isn't boiling the ocean, but it's cut along the wrong seam. It bundles three distinct mechanisms (append-only facts, leased CAS claims, bounded-blocking watch) and defers the one that is the actual point: the **worker-facing** path. Concretely:

- **`scratch_watch` should be cut from the MVP entirely.** For the *orchestrator* it is redundant with `fleet_wait` — Board deltas are already `scratch.*` events on the priority lane (supervisor §3a `classes` filter), so the orchestrator observes the Board by subscribing to `['scratch']`, not via a second cursor loop with its own `HOST_SAFE_MS` discipline to maintain. For the *worker* a bounded-blocking watch is actively wrong: a worker is inside a synchronous LLM turn, not running an event loop — it cannot park on a 25s notify. Shipping `scratch_watch` in the MVP builds cursor machinery nobody's real consumer can use.
- **`scratch_heartbeat` should be deleted, not shipped.** Same root cause: a worker cannot wake itself every 20s to renew a lease from inside a turn that may run five minutes. The claim lease must be **slaved to the worker's existing supervisor lease (I1)** — one lease, not two. `claim.lease_expires = min(requested_ttl, worker_supervisor_lease)`, renewed by the *adapter* observing worker liveness (which the supervisor already does for stall detection), and auto-expiring with `scratch.claim_expired` when the worker's turn ends or it crashes. This deletes a verb, deletes the "TTL is a magic number" residual (the TTL *is* the worker's lease, already derived), and makes the dead-owner-wedge fix fall out for free instead of being re-derived.
- **The genuinely load-bearing MVP primitive is `scratch_claim` + a worker-side point check** — facts are almost a free thin projection on top. Lead with that. A minimal-and-useful Rung 0 is: leased claims (slaved to I1) + append-only facts + a **boolean-shaped worker query** (below). No watch, no heartbeat, no separate cursor.

Note the naming irony worth surfacing to the team: the module is called **coordination-repl**, but the REPL (the Bench) is Rungs 2-3, shipped *last*. The MVP delivers the non-REPL half. If the workflow's remit is specifically the shared-REPL capability, the MVP under-delivers on its own name — fine if intentional, but say so.

### 2. Agent-ergonomic output: it's the *orchestrator's* ergonomics, bolted with a worker API

The 200-token digest is well-shaped **for the orchestrator surveilling a namespace**. It is the wrong shape for the actual consumer. A worker about to edit `payments/stripe_adapter.py` does not want a digest of the payments namespace — it wants one bit plus one line: *"clear"* or *"w1 holds it, refactoring retry logic, +41s."* Give it a boolean-shaped fast path:

```
scratch_check(resource) -> { clear: true } | { held_by, intent, expires }
```

Two deeper ergonomic defects:

- **The polling tax is uncosted, and it's the whole ballgame.** Stigmergy is cheap for ants because pheromone is *ambient* — observation is free. For an LLM, "observe the environment" is a tool round-trip: request tokens + a ~200-token digest, **every time it looks**. A worker that dutifully `scratch_read`s before each of 30 edits in a turn burns ~6k tokens on board-reading — plausibly more than the coordination saves. The dossier claims "one round-trip for who's-here" but never costs the *steady-state* observation that stigmergy requires. This is the human-tool-with-an-API-bolted-on tell. (Fix is §6.)
- **`confidence: 0.8` is fabricated precision.** An LLM emitting a calibrated 0.8 is theater — models are not calibrated, and a self-reported float is exactly the kind of arbitrary magic number this repo's CLAUDE.md rule forbids, dressed as data. Replace with *structural* confidence the hub can actually compute: corroboration count (N independent posts of the same key), `cited` count, and the observed-vs-derived distinction (§below). "3 workers independently observed this" is a real signal; "0.8" is not.

### 3. Three-plane integration: ledger is genuinely wired; task-DAG and I7 are hand-waved

The ledger integration is the strongest part and is real (materialized-view + replay + `scratch.*` family mirrors the SQLite-index-is-a-projection invariant in doc 08 §4). Two integration seams are asserted, not built:

- **The claim→task promotion trigger is named nowhere.** "A soft claim that keeps getting renewed and blocks real progress is a signal to the orchestrator to mint a hard task" — *who computes that?* This has to be a **named derived signal** in doc 05 §2's sense, alongside stall/loop/churn: e.g. `claim.contended` = a resource with an active claim while ≥1 other worker is `blocked` on `scratch_check` of an intersecting resource, or reclaimed by ≥2 workers within a window. Right now it's the same "the orchestrator notices" hand-wave doc 05 is careful to avoid everywhere else.
- **I7 is stretched past its actual meaning for Bench facts.** I7 (`spec/supervisor-state-machine.md` I7) is specifically "the hub re-executes *the brief's verification command* against the worker's *diff*." A Bench fact like "seed=42 repros 3/10" is neither a diff nor a brief-verification; there is no command to re-run except *the same code in a fresh sandbox*, which certifies **reproducibility, not correctness** (see §over-claims). The dossier borrows I7's authority without I7's mechanism. Either define a real independent oracle for Bench facts or stop citing I7 as the mitigation.

Also unaddressed: is the memoized Bench result stored *in* the artifact registry, or in a *separate* content-addressed cache? If separate, you now have two content-addressed stores that can disagree (cache says "computed, here's value_digest"; the artifact it points to was git-GC'd). Pick one: the memo cache *is* an artifact-registry entry keyed by `(tree_hash, code_hash)`, or you inherit a cache-coherence bug.

### 4. Shared state: the diverging-worktree problem is the elephant, and it's not in the room

This is where the dossier's rigor drops off a cliff, and it's the exact "shared-state consistency hand-wave" to call out.

- **`env_ref = "a pinned worktree/commit"` conflates a mutable path with an immutable tree.** A worktree is mutable — the worker keeps editing it — so `(code, worktree_path)` is stale the instant the worker saves a file. The memo key **must** be a git tree-ish content hash (`git write-tree`), never a path, and "run against my live uncommitted worktree" must be explicitly **cache-bypass / non-memoizable**. This is a concrete correctness bug, and the reference design that fixes it already exists: **Bazel's remote action cache / RBE keys on the hash of (command, input-tree, env)** — adopt that keying verbatim.
- **Cross-worker cache hits mostly *won't happen*, and cross-worker fact *reads* are an epistemic trap.** The fleet's defining feature (doc 08 §3b, doc 04 sidecar) is worktree-per-worker on *diverging branches*. So worker A's `bench_run` against A's HEAD and B's byte-identical code against B's HEAD are correctly *different* keys — meaning the headline "compute once, whole fleet reads it as a fact" almost never fires for anything touching a worker's own diff. Worse: if A posts "seed=42 fails" observed against A's tree, and B reads it as a Board fact while sitting on a different tree, B is trusting a result about **code it isn't running**. **Every fact must be scoped to its `env_ref`, and a cross-tree read must be rendered as "observed on `<commit>` — NOT your tree."** Without this rule the Board is a staleness generator dressed as shared knowledge. The dossier says env_ref makes results "reproducible & cacheable" and never confronts that divergence is the norm.
- **Lease expiry must be event-driven or replay diverges.** The Board-is-replayable claim collides with wall-clock leases (`lease_expires: +41s`). Replaying the log an hour later, a reader-side clock comparison expires everything; two replays at different times reconstruct different Boards. This is *fixable and 90% there* — the event list already includes `scratch.claim_expired`. Promote it to an invariant: **leases expire by an emitted `scratch.claim_expired` event at the expiry `seq`, never by a reader-side clock comparison.** State it, or someone will "optimize" by computing expiry on read and silently break replay determinism.
- **`port:5432` is not an advisory-shaped resource.** Most claim examples (`path:`, `test:`) are genuinely advisory. But two workers cannot both bind port 5432 — that's real mutual exclusion the OS enforces with `EADDRINUSE`. The one example where the resource is genuinely exclusive is exactly where "advisory" is dangerous. Either drop port examples, or route exclusive OS resources to an *enforcing* allocator (the sandbox/port-broker) and let the Board only *advertise* — don't imply the Board coordinates things it structurally can't.
- **Claim conflict = glob intersection, not string equality.** `path:payments/**` vs `path:payments/stripe_adapter.py` is a conflict; `payments/a` vs `payments/b` is not. Conflict detection on *write* needs the same glob-intersection logic as `resource_glob` on read, and it's unspecified. Specify it or claims will false-negative on the overlaps that matter most.
- **CAS-cells look like YAGNI.** Every motivating use case (presence, flaky-repro, who's-here) is a fact or signal. Name **one** concrete fleet use for a *mutable shared scalar* that isn't better as an append-only fact read LWW-by-`seq`, or cut cells from the roadmap. A shared "current merge target" is the only candidate and it's thin. Including a primitive "for completeness" violates the dossier's own smallest-useful ethos. Relatedly, there is **no multi-cell atomicity** — "claim `payments/` AND post my intent" can tear. Either add a narrow transaction (claim+post) or explicitly document that torn coordination state is possible and why it's tolerable.

### 5. What it missed (real tools)

The prior-art table reaches for LLM-agent papers and sandbox vendors but skips the **production systems that already solved the two problems it hand-waves**:

- **Bazel Remote Execution / action cache** — the reference design for "same action + same input-tree → shared cached result across a worker fleet, keyed by content hash." This is the Bench's memoization done correctly and is the direct fix for the mutable-`env_ref` bug above.
- **Ray object store (Plasma) + lineage-based reconstruction** — the canonical shared, content-addressed, memoized *compute-result* store across many workers, with the eviction/reconstruction story the Bench needs and doesn't have. "Compute once, everyone reads the object" *is* Ray's object store.
- **Chubby / etcd advisory leases + fencing tokens; Kleppmann, "How to do distributed locking."** The claim/lease/heartbeat/fence design *is* an advisory distributed lock with a fencing token — and Chubby's paper is famous for arguing most locks should be coarse-grained + advisory, which is the strongest possible support for the dossier's advisory stance. I1's fence *is* Kleppmann's fencing token. Citing Anthropic-teams file-locking but not the 20-year-old systems that formalized exactly this is a gap in the strongest section.
- **Consul sessions / service catalog** (TTL + health-check-driven invalidation) — the production analog of the presence/signal tier, and the model for adapter-driven (not worker-driven) heartbeating.
- **Temporal / DBOS durable execution** — a named, surviving Bench session (Rung 3) is a durable workflow; the "long op lives in the task-DAG, addressable/resumable" requirement in the brief maps straight onto this and is currently unmodeled.
- Framing: the per-cell-type consistency table is a coarse **Software Transactional Memory**. Naming STM (and why you *reject* full STM — no multi-cell transactions) would sharpen the "why per-cell, not global" argument better than the CRDT-rejection does.

### 6. The distinctively agent-native move it's one step from

**Make Board participation a side-channel on tools the worker already calls — not a verb it must remember to poll.** This is the single highest-leverage change and it's latent in the design already, because baton *already sits in the worker's tool-mediation path* (the OS-sandbox authorization boundary, doc 05 §5).

- **Observation becomes free.** When a worker calls `Edit(payments/foo.py)`, the hub injects into the *tool result* it was already returning: `"edit applied. ⚠ w1 holds soft claim path:payments/** (refactoring retry logic, +38s)."` Zero extra round-trip, and the worker learns *exactly when it's relevant* — at the moment it touches the contended path — instead of pre-emptively polling a namespace. This is real ant-model stigmergy: smell the pheromone in the results of work you were doing anyway.
- **Emission becomes ambient.** The hub auto-posts a presence *signal* (and can offer to open a claim) as a side-effect of the worker's first scoped edit — so presence is a byproduct of working, not a discipline the worker must remember (which the dossier admits it "can only bias, not enforce").
- **It structurally kills the scariest residual.** The dossier's top-listed failure mode is "drifts into `fleet_chat`." If the worker-facing surface is *side-channels on work actions* plus a boolean `scratch_check`, and there is **no free-text "post to the board" verb a worker calls**, the Board *cannot* become a chatroom — the anti-pattern is designed out, not merely "biased against."
- **Contention is arbitrated deterministically, not negotiated in prose.** When two workers collide, don't surface it for the LLMs to talk out (that's `fleet_chat` by the back door). Let the *supervisor* resolve by policy (earliest claim wins / higher task-priority / more budget remaining) and **inject the decision as a `steer`** — deterministic conflict resolution on the control plane, exactly where I1's fence precedence already lives.

This reframes the whole module: not "a blackboard workers visit," but "the fleet's coordination state, woven invisibly into the tool results workers already receive." That is agent-computer interaction, not a ported human blackboard.

---

### Over-claims and hand-waves to correct explicitly

- **Memoization + I7 certify reproducibility, NOT correctness — and this is worst for the SMT/formal example.** The dossier lists *"does this SMT constraint hold?"* as a Bench fact. Running z3 is the trivial, deterministic part; the hard, unsolved, hallucination-prone part is **autoformalization** — turning "the retry logic is idempotent" into an SMT encoding faithful to the actual code. A wrong encoding yields a confidently-wrong UNSAT. Then memoization caches that wrong answer, and I7's "re-run independently" re-runs the *same encoding* and gets the *same* wrong answer — so both mechanisms stamp it "reproducible and verified." The fleet reads "idempotent: proven by z3" as a top-trust fact. This is **strictly worse than no fact**, because it borrows the authority of a prover for an unverified translation. The CodeCRDT lesson the dossier correctly cites ("convergence ≠ correctness") reappears one level up: memoization gives you "everyone agrees on the answer to the same computation," never "the computation asked the right question." **Fix:** split fact status into **`observed`** (ran the real artifact, saw real behavior — the seed=42 repro is this) vs **`derived`** (a model/encoding asserted it — the SMT result is this). They are different epistemic objects and must not share `kind:'fact'` + a confidence float. Derived/formal facts (a) carry the encoding as a first-class inspectable artifact, (b) are **quarantined from auto-promotion** to the KG, and (c) are only load-bearing when paired with an *independent* oracle (e.g. z3 UNSAT of the negation replayed as a concrete counterexample against the *real* code, or differential testing) — not a re-run of themselves.
- **"Fixes the exact dead-teammate bug in Anthropic agent teams."** The dossier's own prior-art is "reverse-engineered local evidence." Claiming to fix a *specific* bug in a competitor's system on that basis over-reaches — soften to "the failure mode inherent to file-lock hard claims *without* lease expiry."
- **The 13-57% blackboard number and PatchBoard's token numbers are real but task-transferred.** 13-57% is from *data-science information discovery* with a central poster and volunteering subordinates (a master/blackboard hybrid), not peer stigmergic coding coordination; PatchBoard's 45.5k-token / 84.6% result is ALFWorld embodied planning. Borrow their *mechanisms* (append-log, schema-validated patches) — the dossier does this correctly — but don't let the *numbers* imply validation of the coding-fleet use case. State that the mechanism transfers and the metrics don't.
- **"The Board is a projection, losing it loses no knowledge" carries a standing obligation the dossier should make a hard invariant:** the Board must **never** hold a field not reconstructable from `scratch.*` events (the lease-expiry-is-an-event point is the first instance). The moment it does, it silently becomes the `state.json` blob doc 08 §4 outlaws. Write that as an invariant, not a vibe.

**Docs consulted:** `$HOME/Development/Experiments/baton/docs/08-shared-memory-and-pm.md`, `/docs/05-telemetry-steering.md`, `/docs/04-architecture-options.md`, `/spec/supervisor-state-machine.md` (I1 leases/fences, I3/I4 cursors, I6 two-phase stop, I7 hub-run verification, §4 bulk/priority lanes).
