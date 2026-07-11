# Adversarial review — CK1–CK8 implementation vs `spec/phase11/coordination-knowledge.md`

Reviewed `impl/src/coordination-store.mjs`, `impl/src/coordinator.mjs`, `impl/src/index.mjs`, `impl/test/phase11-coordination-store.test.mjs`, `impl/test/phase11-acceptance-integration.test.mjs`, and `impl/test/phase11-persistent-sessions.test.mjs`. `impl/VALIDATION.md` reports 519/519 passing; that count is treated as coverage breadth, not contract proof.

## Verdict

**Substrate slice is real; CK8/CK9 fleet gate is not.** `CoordinationStore` implements append idempotency, tail validation, CAS claims, Scratch point checks, bitemporal query, read logging, and contamination records with 17 targeted tests. `createDriver()` exposes `coordination` (`index.mjs:194`). The coordinator writes many paths durably. Two replay authorities still coexist, operational-log append loss remains tolerated, Scratch/knowledge recall are store-only APIs, and several CK9 failure modes have no failing test. 519/519 can stay green while a crash between `task.claimed` and `lifecycle.spawned` orphans a working durable task.

## Critical and major findings

### CK1 / CK1a — crash atomicity and dual-stream integrity

**Critical — operational append loss is still non-fatal.** CK1a forbids the telemetry sink’s warn-and-drop behavior for state truth. `coordinator.mjs:295–308` wraps `log.append` and returns `undefined` on failure after `process.emitWarning`. Downstream `_coordMapEvent` (`1416–1418`) then returns `null`, and `_coordTransition` may be skipped while in-memory `task.status` still advances (`2345–2346`, `2172`). Coordination-store append failure is correctly fatal (`coordination-store.test.mjs:32–35`); the operational/coordination seam is not.

**Critical — claim-before-spawn crash window.** `_dispatch` durably `claimTask`s (`434–438`) before `lifecycle.spawned` is logged (`506–515`). Crash there leaves coordination `working` with assignee set, but the worker log may be empty. `_seedQueuedCoordinationTasks` (`712–715`) only rehydrates `pending` tasks; `_replay` skips workers with zero events (`2404–2405`). No test exercises this seam; CK9 item 12 covers store append failure only, not coordinator ordering.

**Major — startup evidence validation is optional.** `evidence.mapped` digest checks run in `_apply` only when `operationalRead` is injected (`coordination-store.mjs:119–123`). A hand-edited coordination stream with dangling evidence pointers can load without `operationalRead`; CK1a reconciliation is wired in `createDriver` (`index.mjs:131`) but not proven under tamper.

### CK2 — replay authority, refinement, recovery

**Critical — coordinator replay ignores coordination DAG truth.** `_replay` (`2401–2643`) rebuilds tasks from per-worker logs with `deps: []` always (`2564`). `lifecycle.spawned` payloads omit `deps` (`508–514`). Queued-task survival is proven only via `_seedQueuedCoordinationTasks` + coordination snapshot (`coordination-store.test.mjs:87–115`), not via `_replay`. A restarted coordinator with completed worker logs but a coordination child still `pending` can dispatch the child early — CK9 items 10–11 are store-level only.

**Major — reservation ≠ claim is split across layers.** Durable `assignee` stays `null` until `task.claimed` (store `_apply:113–115`; test line 114). Coordinator memory sets `assignee: workerId` at spawn (`663`) and dispatches via `task.assignee` (`432`). Correct for the happy path; misleading for CK2 “unassigned until dispatch” audits that read coordinator state.

**Major — refinement/recovery tasks are coordination-only ghosts on replay.** `_createCoordinationRefinement` (`1426–1446`) appends `task.created` + `task.claimed` for recovery refinements. `_replay` never reads coordination tasks; it only folds `control.recovery_attached` / `control.recovery_terminalized` from worker logs (`2483–2521`). PS7 tests rebuild `Coordinator` without reloading the coordination file (`phase11-persistent-sessions.test.mjs:385–400`). Refinement `refines` linkage is asserted in PS1 (`113`) on a live process, not after full driver restart from both streams.

**Major — store cycle refusal is weaker than coordinator.** `createTask` refuses only `deps.includes(fields.id)` (`174`); transitive cycles are unchecked at the store. Coordinator `_assertNoCycle` (`1075–1093`) is stronger. A direct `CoordinationStore` caller can persist cyclic DAGs CK2 forbids.

### CK3 — artifact provenance

**Major — `artifact.superseded` is absent.** CK3 names correction via new manifest + link. Store handles `artifact.registered` only (`125–128`); no supersession event or edge. Immutability is copy-on-read (`coordination-store.test.mjs:137–138`), not correction semantics.

**Major — acceptance gate is partial.** `registerArtifact` requires `provenance` when `accepted: true` (`229–230`) but does not require terminal/verified task status. Trust-gate wiring registers commit+verification only when `captured?.sha` (`2320–2344`); failed verification still transitions task without manifest registration — acceptable — but nothing prevents registering `accepted: true` artifacts on `pending` tasks via the public store API.

**Major — adapter `WorkerResult.artifacts` prose is unwired.** Manifests come from git capture and `verify.reverified`; worker-emitted file lists never reach `artifact.registered`.

### CK4 — Scratch overlap, expiry, wiring

**Major — Scratch is built, not wired.** No `checkScratch` / `claimScratch` / `postScratchFact` call sites in `coordinator.mjs`. CK4’s hub-slaved lease expiry on worker terminal state is manual `expireScratchClaim` only (`275–282`); no coordinator hook on `kill.confirmed` / terminal transitions. Store tests pass (`198–226`); fleet workers cannot reach Scratch through the driver.

**Major — glob–glob overlap may false-negative.** CK4 requires conflict when disjointness cannot be proven, including witness-based glob pairs. `resourceOverlap` (`30–36`) uses literal-prefix prefix test for glob–glob; patterns like `path:payments/*` vs `*stripe.js` can share witnesses but disjoint prefixes. Test covers glob-vs-exact (`205–207`), not witness failure. `globRegex` (`17–27`) embeds `.+` inside the escape branch — suspicious regex construction worth adversarial fixture review.

**Minor — fact lookup asymmetry.** `checkScratch` matches `fact.key === resource || fact.resource === resource` (`290`), but `postScratchFact` stores `namespace`/`key` without `resource` (`243–251`). Namespace-qualified facts may not surface on path-shaped checks.

### CK5 / CK7 — bitemporal causality, reads, contamination

**Major — bitemporal model is partial.** Nodes carry `observedSeq`/`validFrom`/`validTo` but no distinct event-time dimension (CK5: “event time (referenced source seq/time)”). `queryKnowledge` filters `observedSeq` (`340–343`), not `observedAt` timestamps despite the spec’s `asOf` + `observedAt` pairing.

**Major — `ReadBy` edges are never materialized.** CK5/CK7 require graph `ReadBy` edges from recalled nodes to reader task/run on every logged read. `readKnowledge` appends `knowledge.read` (`354–360`) but `_apply` for that kind only pushes `_knowledgeReads` (`153–154`); no edge projection.

**Major — `affectedReaders` omits task status.** CK7 projects downstream tasks “including current task status.” Implementation returns raw read records (`375–377`) without joining coordination task status — a stub-shaped API that passes `affectedReaders('old').length === 1` (`254`) without routing-safety proof.

**Major — multi-node contamination is single-node keyed.** Invalidating node `new` after a read that returned `{old,new}` records zero affected reads (`252–253`) because the read’s `nodeIds` at recall time filtered to `asOf` January view (`245–246`). Correct for that read, but no test proves blast-radius when a later broader read included both nodes and one is invalidated — CK7 “multi-event contamination” gap.

**Major — failed read logging is store-only.** `readKnowledge` append-before-return is correct (`354–360`; test `264–267`). No coordinator/recall path calls it; CK7 “unlogged read is failed operation” is untested on any worker/orchestrator integration path.

**Major — Decision evidence checks edges in name only.** `addKnowledgeNode` requires `evidence.length > 0` for `Decision` (`311`) but does not require an `Informed` edge; test adds edge after node (`235–236`), not as admission gate.

### CK6 — promotion

**Later scope:** scorecards, RouteStat, lexical recall — correctly deferred per spec.

**Major — promotion events missing.** No `knowledge.promoted` or `knowledge.promotion_candidate` kinds. Coordinator calls `addKnowledgeNode` directly for outcomes/integration/publication (`2338–2343`, `1024–1028`, `1831–1835`). Deterministic hooks exist but not as named promotion events CK6 describes; `auditKnowledge` (`385–402`) is never gated in tests.

### CK8 — authority and built-not-wired

**Critical — coordination remains optional inside `Coordinator`.** `opts.coordination ?? null` (`258`); every helper no-ops when null (`1403`, `1412`, `1422`, `1427`). `createDriver` always constructs a store, but hand-wired tests across 502 other cases can omit it. CK9 item 13 (“nonempty coordinator, empty substrate must fail”) has no test.

**Major — coordinator replay authority contradicts CK8.** CK8 makes coordination mandatory for state-changing paths; `_replay` still treats per-worker logs as authoritative for task status, deps, and terminalization (`2398–2399`, `2560–2602`). Coordination is a sidecar writer, not the rebuild source, except for pending queue seeding.

**Major — refused integration is telemetry-only.** `integration.refused` logs (`1002–1006`) but writes no `driver.recorded` or coordination artifact/event — asymmetric with `integration.completed` (`1018–1029`).

## Contract corrections

| ID | Correction |
|---|---|
| **CK1** | Require coordinator operational `append` failure to abort the triggering mutation (mirror store fatal append). Add CK9 probe: inject `log.append` throw after `task.claimed`; coordination and coordinator projections must match after restart. |
| **CK1a** | Mandate `operationalRead` at `CoordinationStore` construction for any assembly that replays worker logs; startup `_load` must reject `evidence.mapped` rows whose digest cannot be verified. |
| **CK2** | Single replay authority: rebuild coordinator `_tasks` from coordination projections first; worker logs may enrich session/vendor fields but must not override `deps`, `status`, or `assignee`. Persist `deps` on `lifecycle.spawned` until replay is unified. Extend `_seedQueuedCoordinationTasks` to all non-terminal coordination tasks or drop worker-log task reconstruction. |
| **CK2** | Store `createTask` must run the same cycle detection as coordinator `spawn`. Recovery refinements must persist a durable link (`refines`, parent `terminalEvent`) recoverable without live memory. |
| **CK3** | Implement `artifact.superseded`; reject `accepted: true` unless task is terminal `completed` and provenance cites `verify.reverified` or named review event seq. |
| **CK4** | Wire Scratch point checks into dispatch/claim boundaries; emit `scratch.claim_expired` from coordinator on lease/terminal/kill paths. Add adversarial glob–glob witness fixture to CK9. |
| **CK5** | Materialize `ReadBy` edges on `knowledge.read`; store distinct `eventTimeSeq` on nodes/edges; enforce `Informed` edge presence for `Decision` admission. |
| **CK7** | `affectedReaders(id)` must return `{readEvent, taskId, taskStatus, runId}` projections; add multi-node read → partial invalidation test. Expose recall only through a coordinator method that cannot return content if read append fails. |
| **CK8** | Make `coordination` a required `Coordinator` constructor arg (no `null`); add CK9 item 13 test across full suite migration. |
| **CK9** | Add failing fixtures for: claim-then-crash-before-`lifecycle.spawned`, coordinator `_replay` `deps[]` round-trip, optional-coordination negative, glob witness overlap, `integration.refused` coordination audit. |

## Implementation order

1. **CK8 replay authority** — Coordination-first `_replay`, mandatory store injection, deps on `lifecycle.spawned`, extend seeding beyond `pending`. Blocks every restart lie.
2. **CK1/CK1a atomic seams** — Fatal operational append; claim/log ordering or transactional outbox; mandatory `operationalRead` validation at startup.
3. **CK2 refinement/recovery** — Durable refinement replay without live `_refinementSeq`; associate recovery tasks in coordination stream with worker evidence.
4. **CK3 provenance closure** — `artifact.superseded`, terminal gate, register adapter artifacts.
5. **CK4 fleet wiring** — Coordinator Scratch hooks + lease-driven expiry events.
6. **CK5/CK7 graph completeness** — `ReadBy` materialization, `affectedReaders` status join, coordinator recall API with append-before-return.
7. **CK9 adversarial gate** — Item 13 negative, crash windows, multi-node contamination, then recursive dogfood.