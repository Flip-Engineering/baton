# 33 — Shared Objects and the REPL Layer

Status: design groundwork for issues REPL-1..3, **v2 revised per red-team findings R33-1..10**
(2026-07-22). v1's REPL-1/REPL-3 cores were unimplementable as written: manifests hard-require
Workflow coordinates (context-program.mjs:203-248), `contextEval` resolves only live-run
dispatch targets (application.mjs:8323-8363), and `cell:` resolution at normalization time
violates evaluator purity (context-program.mjs:330-345). The v2 cores below re-ground all
three. Companion to docs/32 (reflexive orchestration) and docs/34 (knowledge horizons).

## 1. What "REPL" means here — and what it never means

Baton already made the hard call: **no arbitrary-code REPL, ever** (permanent constraint
§93.1(1), spec/phase93-closed-program-ir.md:31-35; docs/07-roadmap.md:87; docs/28:578). The
coordination-REPL module shipped its Board (Rung 0, scratch) and deferred the Bench rungs
(docs/capabilities/coordination-repl.md:82-87, :160, :226).

A REPL here is a **read-eval-print loop over closed, content-addressed objects**: orchestrator
and workers name objects (cells), compute new ones from old ones through the closed Bench
(14 pure ops + 4 predicates, context-program.mjs:341-418), and pass them by digest. Every
object is immutable, replay-exact, and citable from boards, packages, briefs, and decision
requests. "Scripting" is authoring closed Programs, never writing code.

The substrate is landed: cells are content-addressed immutable JSON up to 64MB
(context-program.mjs:931-940, :652-686), durably admitted with idempotent identity
(`context.cell:${sessionId}:${programDigest}`, :1244), projected through inspect
(application.mjs:9417-9426), computable without a Workflow against a *Workflow-reachable*
manifest since REFLEX-4 (:8364-8417). Missing: manifest authority outside a Workflow, a
named-binding namespace, and cell-as-source composition.

## 2. Gaps (each is a design constraint)

- **G-A — No manifest-admission authority outside a live Workflow dispatch** and no manifest
  *shape* for it: `normalizeContextManifest` hard-requires goal/plan/node/task coordinates with
  `planId` matching `^plan:[a-f0-9]{64}$` and ordered task event refs
  (context-program.mjs:203-248). REFLEX-4 refused this boundary honestly
  (application.mjs:8335-8347). → REPL-1.
- **G-B — No named shared-object namespace.** Cells are digests; nothing binds a *name* to a
  digest in a scoped, durable, replay-exact way. → REPL-2.
- **G-C — No cell-as-source composition.** A Program `source` reads manifest branches only
  (context-program.mjs:342), and the evaluator is pure — it cannot and must not resolve cell
  digests itself. → REPL-3.

## 3. Design

### 3.1 REPL-1 — ReplManifest: a second manifest shape with its own authority

(R33-1, R33-2, R33-10: v1's "normalizeContextManifest unchanged, one session family" is
deleted. A Workflow-free manifest is a *different object* and says so in its digest basis.)

1. **`ReplManifest`** is a closed, content-addressed manifest variant sharing the branch
   normalization discipline (exact fields, delete-and-recompute digest, branch bounds — the
   `normalizeContextManifest` mold, context-program.mjs:183-275) but carrying
   `{ runId, replRole }` in place of the Workflow coordinate section, where
   `replRole ∈ { shared, worker:<workerId> }`. Its digest basis kind string is
   `baton.repl_manifest` — disjoint from `baton.context_manifest`, so no existing manifest
   digest changes basis and no Workflow manifest can be reinterpreted as a REPL one.
2. **Admission is the authority record.** One new event kind, `repl.manifest_admitted`, carries
   `{ manifestDigest, runId, replRole, principal: { actor, principalId } }`. For `shared` the
   principal must be the run's orchestrator (the sessionAuthority/lease path already threaded
   for run.act, mcp-northbound.mjs:1012-1043); for `worker:<id>` the coordinator wrapper forces
   `replRole`'s workerId to the caller's own identity — the board-claim wrapper-binding pattern
   (coordinator.mjs:9153-9171), never a caller-supplied owner string at the store.
3. **Cell evaluation** opens a `DurableContextSession` against the ReplManifest digest through
   a NEW openSession path whose session authority is the `repl.manifest_admitted` record (not a
   dispatch). `admitContextCell`'s caller-principal pinning (coordination-store.mjs:9017-9020)
   accepts that record's principal. Cell identity, idempotency, settlement, and projections are
   the REFLEX-4 path genuinely unchanged — the evaluator and `context.*` cell events are
   untouched. This explicitly **supersedes** reflex4-decisions.md's scope boundaries
   ("no new event kinds beyond context.*"; "do not modify the evaluator") — the evaluator stays
   pure; the authority layer grows one event kind.

### 3.2 REPL-2 — Named bindings: the shared and per-worker object layers

(R33-4: "turn fence guards writes" struck — no such mechanism exists; worker identity is
wrapper-bound like board claims. The binding fence is NOT the board fence: see rule 5.)

4. A **binding** maps `(scope, name) → cell:<sha256>`, scope ∈ `{ shared, worker:<workerId> }`.
   Bindings are immutable-versioned (REFLEX-2 rule 2): rebind mints `bindingVersion+1`; prior
   versions retained for replay. Event kinds `repl.binding_set`, `repl.binding_dropped`. Shared
   scope is orchestrator-authority (rule 2's lease path); a worker scope accepts only that
   worker's own writes, wrapper-bound.
5. **Per-scope binding fence**: `bindingFence(scope)` is the replay-derivable count of
   `repl.binding_set`/`_dropped` events **for that scope** — every write to a scope advances
   its own fence, worker writes included. This is a deliberate divergence from the board fence
   (which counts only orchestrator-authority transitions so worker claim/report traffic cannot
   livelock claims, reflex2-boards-decisions.md:77-89): a binding fence guards a namespace's
   *versions*, and the writer of a version must always invalidate its readers' cache.
   Projections are cached keyed `(scope, workerId, bindingFence(scope))`, reads non-evented,
   no `repl.read` event kind (the F10 rule).
6. Workers cite bindings as `repl:<scope>:<name>@<version>` in reports and decision requests.
   The citation grammar is parsed by a named read path — the same projection that renders
   board/report detail (application.mjs run-view item rendering) — resolving to the exact
   digest recorded at that version; citations bind versions, never "latest."
7. Bounds: `MAX_REPL_BINDINGS` per scope, name ≤128 chars SafeId, projection bytes bounded with
   an explicit truncation story.

### 3.3 REPL-3 — Cell-as-source: a ReplManifest branch ref kind (evaluator stays pure)

(R33-3: resolution moved OUT of program normalization entirely. Programs never see `cell:`.)

8. A ReplManifest branch gains exactly one new ref form: `cell: { digest }`. At **manifest
   admission** (the `repl.manifest_admitted` path, evented), the hub resolves the cell digest
   to the settled cell's `outputRef` artifact coordinate (context-program.mjs:989-1001) and
   records the resolved artifact digest **in the admission event payload** — so replay
   reconstructs the identical branch without any store lookup, and the normalized ReplManifest
   (whose digest covers the resolved coordinates) is stable.
9. Only **settled, durably admitted** cells resolve (the F12 rule). An admitted-but-unsettled
   cell is a typed admission refusal. Post-admission artifact loss is NOT an admission error
   and NOT a hard refusal at read: §93.5 resolve-time revalidation settles
   `artifact_unavailable`, and live re-evaluation of a missing-artifact chain settles the
   cell `attention` (retryable) per context-program.mjs:1259-1271 — accepted semantics, named
   here so no worker mistakes it for a wedge.
10. This is the entire composition story. No new operators; the 14+4 whitelist stands;
    effectful work stays successor-Plan-gated (§93.1(1)).

## 4. The fold surface (R33-5 — enumerated, with a test)

Every new event kind — `repl.manifest_admitted`, `repl.binding_set`, `repl.binding_dropped` —
ships with: an `_apply` branch (coordination-store.mjs:7158; unknown kinds throw
`unsupported_event_kind`); `PROJECTION_CHECKPOINT_FIELDS` entries (:89-110) — checkpoint load
validates the field set exactly (:744-751), so the same commit must handle the field-set
change explicitly (bump or migrate, never silently); `snapshot()` exposure (:9937); and the
run-stop guard preamble (:7196-7218) so REPL writes refuse after stop begins. A new
**event-kind inventory test** asserts the closed kind set so an incomplete fold fails at test
time, not at replay.

## 5. What this unlocks

- Orchestrator computes `partition-map` once, binds it shared, every wave member reads it by
  name — instead of N hand-assembled packages.
- A worker binds an intermediate (digest map of its scope) in its own layer and cites it upward
  in a report; the orchestrator promotes it shared with one rebind.
- Multi-step analysis: cell A (partition) → cell B (per-partition summary joining A via a
  `cell:` branch) → cell C (collect B) — each step closed, replay-exact, citable on boards.
- Long-horizon context: a 100KB orientation body lives as a manifest source, sliced per worker
  by closed Programs — instead of whole-body injection into every brief.

## 6. Non-goals

No arbitrary-code kernel (permanent). No mutable objects. No cross-run bindings (project-
persistent objects ride the KG, docs/34). No worker-authority shared writes. No `cell:` refs in
Workflow ContextManifests (ReplManifest-only this epic; unifying the families is a named
follow-up). No git-synced artifact CAS (deployment-local today; replication is a follow-up).

## 7. Issue breakdown

- **REPL-1**: ReplManifest shape + `repl.manifest_admitted` authority + openSession path +
  fold surface + kind-inventory test. (G-A)
- **REPL-2**: bindings — `repl.binding_set`/`_dropped`, per-scope fence + cached projections,
  citation grammar + named resolution path, bounds. (G-B)
- **REPL-3**: `cell:` branch refs resolved at manifest admission with evented coordinates,
  settled-only rule, §93.5/attention read semantics. (G-C)

Each ships red-first (`impl/test/replN-*-red.test.mjs`) with a decisions contract in the REFLEX
style, an adversarial red-team pass, and a full-suite gate before any implementation wave.
