# 33 — Shared Objects and the REPL Layer

Status: design groundwork for issues REPL-1..3. Companion to docs/32 (reflexive orchestration);
grounded in the REPL/KG inventory taken 2026-07-22 and the landed REFLEX-1..4 work.

## 1. What "REPL" means here — and what it never means

Baton already made the hard call: **no arbitrary-code REPL, ever** (permanent constraint
§93.1(1): "There is no arbitrary language runtime, `eval`, `exec`, callback, import, module
load, ambient filesystem access, shell, or provider launch in the Program evaluator",
spec/phase93-closed-program-ir.md:31-35; roadmap guarantee docs/07-roadmap.md:87; capability
audit docs/28:578 — "a general persistent REPL kernel remains explicitly deferred"). The
coordination-REPL module doc shipped its Board (Rung 0, the scratch family) and left the Bench
rungs for later (docs/capabilities/coordination-repl.md:82-87, :160, :226).

What a REPL *is* here, then: a **read-eval-print loop over closed, content-addressed objects** —
the orchestrator and workers name objects (cells), compute new ones from old ones through the
closed Bench (14 pure ops + 4 predicates, context-program.mjs:341-418), and pass them around by
digest. Every object is immutable, replay-exact, and citable from boards, packages, briefs, and
decision requests. "Scripting" is authoring closed Programs, not writing code.

The good news from the grounding inventory: **the object substrate is already landed.** Cells are
content-addressed immutable JSON objects up to 64MB (context-program.mjs:931-940, :652-686),
durably admitted through `DurableContextSession.evaluate` (:1238-1300) with idempotent identity
(`context.cell:${sessionId}:${programDigest}`, :1244), projected through inspect
(application.mjs:9417-9426), and computable without a Workflow since REFLEX-4
(application.contextEval, :8364-8417). What is missing is the *layer* that makes cells usable as
shared working memory: admission authority outside a Workflow, a named-binding namespace, and
cell-as-source composition.

## 2. Gaps (each is a design constraint, not a wish)

- **G-A — No manifest-admission authority outside a live Workflow dispatch.** REFLEX-4 probed
  this boundary and refused honestly: "a genuinely Workflow-free 'plain' Run has no manifest
  reachable here and this command refuses" (application.mjs:8335-8347). An orchestrator that
  wants to compute a partition manifest over ad-hoc sources for a wave must hand-assemble one
  off-ledger today (docs/32:66-67, G3 :96-99). → REPL-1.
- **G-B — No named shared-object namespace.** Cells are digests; nothing binds a *name*
  (`partition-map`, `orientation-slice`) to a digest in a scoped, durable, replay-exact way.
  Workers cannot ask "what is the current `partition-map`" and the orchestrator cannot rev it.
  Packages carry objects point-to-point but name nothing globally. → REPL-2.
- **G-C — No cell-as-source composition.** A Program's `source` op reads manifest branches only
  (context-program.mjs:342); computing *from a prior cell* requires re-admitting its output as a
  new manifest source by hand. Multi-step REPL work (compute → reshape → join) needs first-class
  composition that stays closed. → REPL-3.

## 3. Design

### 3.1 REPL-1 — Run-scoped REPL sessions (manifest-admission authority)

A **REPL session** is a run-scoped authority that admits ContextManifests and evaluates pure
Programs against them, without a Workflow. It reuses the REFLEX-4 admission path verbatim —
same `DurableContextSession`, same cell identity, same projections — and answers the question
REFLEX-4 parked: *who may admit a manifest when no Workflow dispatch exists?*

1. Session identity is `repl:<runId>:<role>` where role is `shared` or `worker:<workerId>`
   (two layers, see 3.2). Admission is an orchestrator-authority act for `shared`, and a
   worker-delegated act for its own `worker:` layer (the worker's turn fence guards its writes,
   exactly as reports do). Sessions are durable ledger state (event `repl.session_admitted`),
   replay-exact, and bounded (`maxCellsPerSession` already exists, context-program-policy).
2. Manifest admission inside a session goes through `normalizeContextManifest` unchanged
   (context-program.mjs:183-275) — the same delete-and-recompute digest discipline, the same
   tree-authority rules, plus the REPL-3 extension below. No second manifest code path.
3. Evaluation inside a session *is* `application.contextEval` targeted at the session's
   manifest. The non-Workflow manifest-admission authority REFLEX-4's comments name
   (application.mjs:8323-8363) is this session object; its code comments must say so.

### 3.2 REPL-2 — Named bindings: the shared and per-worker object layers

A **binding** maps `(scope, name) → cell:<digest>` where scope is `shared` (whole run) or
`worker:<workerId>` (one worker's layer).

4. Bindings are immutable-versioned like board items (REFLEX-2 rule 2): rebinding a name mints
   `bindingVersion+1` with the new digest; prior versions are retained for replay. Event kinds:
   `repl.binding_set` (orchestrator-authority for shared scope; worker-authority for its own
   scope), `repl.binding_dropped`. A worker-visible projection is computed per worker: shared
   bindings + that worker's own — same slice rule as boards (docs/32:149-152).
5. Reads are **non-evented and cached**, keyed by `(scope, bindingFence)` where bindingFence is
   the replay-derivable count of binding events for that scope — the REFLEX-2 board-fence
   pattern applied verbatim (never the worker FenceTable, never a `repl.read` event).
6. Workers cite bindings in reports and decision requests as `repl:<scope>:<name>@<version>`;
   the hub resolves the citation to the exact digest at read time, so a citation is never
   silently re-pointed (the REFLEX-2 report-binding rule: cite exact versions).
7. Bounds mirror the house: `MAX_REPL_BINDINGS` per scope, name ≤128 chars SafeId, projection
   bytes bounded with an explicit truncation story.

### 3.3 REPL-3 — Cell-as-source composition (closed, digest-bound)

8. A Program `source` op gains exactly one new ref form: `cell:<sha256>`, resolved at admission
   to the settled cell's `outputRef` artifact (context-program.mjs:989-1001). Resolution is
   part of program *normalization*: the normalized program carries the resolved artifact digest,
   so replay recomputes identically and a missing/changed artifact settles
   `artifact_unavailable` at resolve time (§93.5 read rule) — never silent recompute.
9. Only **settled, durably admitted** cells resolve (the REFLEX-4/F12 citable-cells rule:
   never stateless-computed-only). A `cell:` ref to an admitted-but-unsettled cell is a typed
   refusal, not a wait.
10. This is the entire composition story. No new operators, no arithmetic, no string ops —
    the 14+4 whitelist stands. Anything effectful stays successor-Plan-gated (§93.1(1)).

## 4. What this unlocks (the user's workflows)

- Orchestrator computes `partition-map` once (context_eval), binds it shared, and every wave
  member reads it by name — instead of N packages hand-assembled per member.
- A worker computes an intermediate (a digest map of its scope), binds it in its own layer,
  and cites it upward in a report; the orchestrator promotes it shared with one rebind.
- Multi-step analysis: cell A (partition) → cell B (per-partition summaries joining A) →
  cell C (collect B) — each step closed, replay-exact, and independently citable on boards.
- Long-horizon context: a 100KB orientation body lives as a source in the session manifest,
  sliced per worker by closed Programs — instead of whole-body injection into every brief
  (the context-window blow-out the grounding inventory flags at briefs, messages.mjs:95-115).

## 5. Non-goals

No arbitrary-code kernel (permanent). No mutable objects (rebind = new version). No cross-run
bindings in this epic (project-persistent objects ride the KG, docs/34). No worker-authority
shared writes (workers propose via reports/bindings in their own layer; the orchestrator admits
to shared). No git-synced artifact CAS (deployment-local today; replication is a named
follow-up, not this epic).

## 6. Issue breakdown

- **REPL-1**: run-scoped REPL sessions — `repl.session_admitted`, manifest admission authority,
  contextEval targeting, bounds. (G-A)
- **REPL-2**: named bindings — `repl.binding_set`/`_dropped`, fence-cached projections,
  citation grammar, bounds. (G-B)
- **REPL-3**: `cell:<digest>` source refs in Program normalization, settled-only resolution,
  §93.5 resolve-time semantics. (G-C)

Each ships red-first with its own `impl/test/replN-*-red.test.mjs`, full-suite gate, and a
decisions contract in the style of the REFLEX contracts before any implementation wave.
