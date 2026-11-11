# Capability Plane — the Agent-Computer Interface framework (v0 draft)

*The framework every capability module (code search, debugger, proof checker, orientation, computer-use, skills — doc 11) conforms to. It is to the capability plane what `adapter-contract.md` is to the control plane: the uniform contract that lets heterogeneous tools compose into one agent-shaped substrate. Grounds doc 10's Agent-Computer Interaction (T1) topology. The governing principle: **a capability is not a tool baton installs; it is the agent-shaped form of a tool, plus its integration with the ledger, the artifact store, the task-DAG, and the control plane.**](.)*

## 1. What a capability module is

A capability module wraps one or more underlying tools (rg, an LSP server, a DAP debugger, z3, a browser driver, …) and exposes them as an **ACI surface**: agent-facing verbs whose outputs are structured, token-bounded, addressable, and observable. It MUST implement:

```ts
interface Capability {
  card(): CapabilityCard;                                  // §5 — cost/latency/determinism/side-effects/shared-state
  invoke(op: string, args: object, ctx: InvokeCtx): Promise<AciResult>;   // §3 — the one call shape
  resume?(handle: OpHandle, cursor: Cursor, ctx: InvokeCtx): Promise<AciResult>; // paged continuation
  cancel?(handle: OpHandle, ctx: InvokeCtx): Promise<void>; // task-plane interrupt when wired
  reverify?(claim: AciResult, op: string, args: object, ctx: InvokeCtx): Promise<Verdict>; // §6 — hub re-runs the exact operation and inputs
}
```

`InvokeCtx` always carries registry-owned caller identity, token budget, cancellation signal, and
trusted repository root. A deployment context may add bounded worktree/sandbox/overlay roots but
cannot override those authority fields. A `(worker, turn_epoch)` fence belongs to a durable
task-plane capability invocation; Phase 29's synchronous registry does not fabricate one.

## 2. The five design laws (from doc 10 §5, made operational)

1. **Agent-shaped output or it's a bug.** No capability returns a human artifact (REPL transcript, pixel screenshot, unbounded list, raw stack trace) where a structured, token-bounded, addressable result would serve. The human form, if needed, is an *artifact ref*, not the payload.
2. **Every op is an event.** `invoke` emits `capability.op.started/completed` to the ledger (with `actor`, cost, refs) — capability use is as observable and auditable as control ops ("no invisible hand" extends to tool use).
3. **Long ops live in the task-DAG.** Anything beyond a latency budget (a full index build, a fuzzing campaign, a proof search) becomes a task-DAG node with progress events and is **interruptible via the control plane**. Until that adapter ships, the coordinator-owned registry advertises task-class operations as `taskOpsRequiringTaskPlane` and refuses to run them; web/MCP never execute them inline.
4. **Claims are re-runnable.** Any capability output a downstream decision trusts (a passing test, a proof, a search result the plan depends on) is re-runnable by the hub via `reverify` — a worker cannot forge a capability result the hub re-checks (supervisor I7). Determinism is declared in the card; non-deterministic capabilities declare their re-verification semantics (seed capture, tolerance).
5. **Shared state declares its consistency.** A capability that maintains fleet-shared state (the code index, the blackboard, the skill registry) declares its consistency model in the card (§4) — silent shared mutable state is banned (doc 08 §4).

## 3. The ACI result envelope (the load-bearing agent-ergonomic primitive)

Every capability returns the same shape, so the orchestrator and workers learn *one* way to consume tool output:

```jsonc
{
  "op": "search.structural",
  "status": "ok | partial | error | needs_resume | diverged",
  "summary": "12 defs of `authorize(`; 3 in payments/ (likely targets), 9 in tests",  // ≤ ~1 line, always present
  "payload": [ /* structured, token-BOUNDED to ctx.budget — the top-K, typed, not raw */ ],
  "refs": [ { "handle": "art:sha256:…", "kind": "full_results", "bytes": 48211 } ],   // addressable; full data in artifact store, fetched only on demand
  "cursor": "c:op_7f3:page2",          // present iff status=needs_resume → resume(handle, cursor); at-least-once (spec I3)
  "cost":   { "tokens_out": 380, "wall_ms": 42, "usd": 0.0, "underlying": "rg+scip" },
  "provenance": { "tool": "ripgrep@14 + scip@0.3", "index_epoch": 4412, "worktree": "wt/w3", "deterministic": true }
}
```

Why each field earns its place:
- **`summary`** is what enters the agent's context by default; `payload` is bounded to the caller's token budget; **`refs`** hold the full result in the artifact store, fetched by handle only if the agent actually needs it. This is how a capability serves a worker mid-turn without blowing its context — the doc 05 digest discipline applied to tool output. A search over a million-line repo costs the worker ~400 tokens, not 40,000.
- **`cursor`** makes every op resumable/paged with the same at-least-once durability as `fleet_wait` (spec I3) — a worker can walk a large result set across turns without re-running the op.
- **`provenance`** (esp. `index_epoch`, `deterministic`, `worktree`) is what makes `reverify` and staleness detection possible (§4, §6).
- **`cost`** flows to the budget/scheduler — capability use counts against the task budget just like model turns.

## 4. Shared-state capabilities & the staleness problem

The high-value capabilities (code index, blackboard, skill registry, BoK) are **fleet-shared** — that's their leverage (doc 10 T3, stigmergy: one index every worker reads beats N re-walks). But workers edit in **divergent worktrees**, so a shared index is stale for a worker relative to that worker's uncommitted edits. The framework's rule:

- Shared state is **content-addressed and epoch-stamped**. The index is a base snapshot (`index_epoch`) plus a per-worker **overlay** of that worker's uncommitted diff. A query returns base-hits reconciled against the worker's overlay, and the result's `provenance.index_epoch` + an `overlay_applied` flag tell the agent exactly how fresh it is. Cache invalidation is per-file-hash: a worker's edit invalidates only the cells it touched, for that worker's overlay, not the shared base.
- Consistency models a card may declare: `snapshot` (read a consistent base epoch; overlays local), `tuple-space` (take/read/write with atomic take — for the blackboard's claims: "take the payments/ lease"), `crdt` (for eventually-merged shared notes), `append-only` (ledger-like). The framework provides these as primitives; a module picks one and declares it. **No module invents ad-hoc shared mutable state.**
- The blackboard's "who's touching payments/" (doc 10 T3) is a tuple-space `take` — atomic, so two workers can't both hold the lease; this is the same fencing discipline as the control plane, applied to stigmergic coordination.

## 5. The capability card (registration + negotiation)

Analogous to the harness card. Each module's `card()` declares:

```jsonc
{
  "name": "discovery", "version": "0.1", "underlying": ["ripgrep@14","scip@0.3","tree-sitter"],
  "ops": {
    "search.lexical":    { "latency_class": "interactive", "deterministic": true,  "side_effects": "none", "reverifiable": true },
    "search.semantic":   { "latency_class": "interactive", "deterministic": false, "side_effects": "none", "reverifiable": "by_seed" },
    "index.build":       { "latency_class": "task",        "deterministic": true,  "side_effects": "writes_shared_index", "interruptible": true }
  },
  "shared_state": { "code_index": "snapshot+overlay" },
  "sandbox_required": "read_only_worktree",
  "cost_model": "cpu_bound_local"    // vs "model_tokens" (a capability that itself calls an LLM) vs "external_api"
}
```

`latency_class ∈ {interactive (< budget, returns inline), bounded_batch (deployment-bounded inline batch), task (task-DAG node, progress events, interruptible)}`. Registry cards add derived `actions` support and split `northbound.inlineOps` from `northbound.taskOpsRequiringTaskPlane`; modules cannot self-claim those derived affordances. The orchestrator consults cards to (a) pick the right rung of a ladder (e.g. the validation ladder, doc 11 — cheap `test` op vs expensive `prove` op), (b) know an op's side-effects before invoking, (c) route cost. **Cards are probed from the installed tools where possible** (version strings, feature flags) so they can't drift from reality — the same version-skew defense as adapter cards (doc 09 §G).

## 6. Re-runnability & the trust chain (why this ties to the control plane)

Capabilities are where supervisor **I7 (hub-run verification)** gets its teeth. A worker reports "tests pass / the proof checks / no scope escape." The hub does not trust the report; it calls `capability.reverify(claim)` — re-running the test capability, re-checking the proof artifact with z3/Lean, re-running the search — **in the worker's or a fresh sandbox, never on the hub** (doc 09 §C2). For deterministic capabilities this is an exact re-run; for non-deterministic ones the card declares the re-verification (replay the captured seed; check within tolerance). This is the mechanism that makes "workers can't forge their verification" (red-team `adversarial` A5) real: the proof-carrying artifact (doc 11 validation module) is re-checkable in milliseconds, so forging it is pointless. **The capability plane is thus not just tools — it's the evidence layer the control plane's trust model stands on.**

## 7. Composition: capabilities as ladders and pipelines

Capabilities compose two ways the framework supports first-class:
- **Ladders** — ordered rungs of increasing cost/rigor for one goal (validation: types→test→proptest→fuzz→BMC→SMT→proof; search: lexical→structural→semantic→graph). The card's per-op `latency_class`/`cost` lets the orchestrator (or a policy) pick the rung by task criticality and budget. Cheap rung first; escalate only on the critical path.
- **Pipelines** — one capability's `refs` output is another's input by handle (search → orient → debug → validate), without the intermediate data entering any agent's context. The artifact store is the pipe; agents pass handles, not data. This is ACI's answer to Unix pipes: structured, addressable, token-free intermediate flow.

## 8. Scoping

MVP capability plane = **one capability (discovery/search), one ladder rung each for validation (`test`) and orientation (`repo_map`), the ACI result envelope, and the ledger/cost integration.** Prove that a shared, agent-shaped, re-runnable search beats N workers each grepping (doc 11 discovery module's own MVP), and that the envelope actually keeps a worker's context small. Everything else — the debugger, the proof rungs above `test`, computer-use, the skill forge — is a new module conforming to this same contract, added when a task needs it. The framework is the deliverable; the modules are increments.

## 9. Open questions

1. Is `reverify` always cheap enough to run on every trusted claim, or does the hub sample (re-verify a fraction) for expensive capabilities (a 10-minute fuzz)? Leaning: always re-run cheap/deterministic (tests, proofs); sample + spot-check expensive/non-deterministic, with the sampling rate a policy knob.
2. Do capabilities that themselves call an LLM (semantic search embeddings, an LLM-judge, autoformalization) count against the fleet's model budget, and how does that interact with per-vendor concurrency ceilings (doc 01 §7)? (Yes; the `cost_model: model_tokens` card field routes them into the same scheduler.)
3. Overlay-vs-base index reconciliation cost under a worker making thousands of edits — does the overlay become as expensive as re-indexing? Threshold at which a worker's overlay triggers a private re-index?
4. Should the orchestrator have a *restricted* view of the capability plane (digests only, no raw ACI) to avoid drowning while composing briefs (doc 10 §6 Q4)?
