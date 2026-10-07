# Adversarial review — `spec/phase11/coordination-knowledge.md`

Reviewed against `docs/26-full-system-goal.md`, `docs/08-shared-memory-and-pm.md`, `docs/capabilities/coordination-repl.md`, and `impl/src/log.mjs` + `impl/src/coordinator.mjs`. Coordination substrate is unimplemented; the driver replays an in-memory task map from per-worker logs.

## Verdict

**Not shippable as written.** CK1–CK8 describe the right three-tempo decomposition (`docs/08` §1, `docs/26` G) and CK4’s narrowed Scratch scope correctly absorbs `coordination-repl.md` critique (event-driven lease expiry, no heartbeat, `observed|derived` grounding). But the spec leaves three contract holes that will reproduce today’s built-not-wired failure mode: (1) no rule for how the new stream relates to existing per-worker `Log`, (2) CK2’s durable-before-return and CAS semantics contradict `coordinator.mjs`’s actual spawn/dispatch path, and (3) CK9 cannot detect a green coordinator sitting beside an empty `CoordinationStore`. Goal alignment is sound; contract precision and gate coverage are not.

## Critical and major findings

### CK1 — stream truth vs operational log

**Critical — dual-truth ambiguity.** CK1 mandates one `events.jsonl` with global `seq`; `log.mjs` uses per-worker `<workerId>.jsonl` with per-worker `seq` (lines 35–68). The spec never says whether coordination events subsume, mirror, or index operational events — breaking CK5 temporal coherence and CK9 replay identity.

**Critical — torn-tail handling absent in reference impl.** CK1 requires malformed tails fail startup visibly. `log.mjs` `read()` parses line-by-line with no validation pass; a partial final line throws at `JSON.parse` on first read, not at store open. CK9 item 9 must include a truncated-tail fixture.

**Major — append failure is non-fatal today.** CK1: “An append is durable before its projection mutates.” `coordinator.mjs` wraps `log.append` and returns `undefined` on failure after a single `process.emitWarning` (lines 294–307). A projection can advance while the event is lost — the exact crash-consistency hole CK1 is meant to close. CK9 needs a probe that append failure aborts the mutation and leaves projections unchanged.

**Major — no idempotency key on current events.** CK1 requires authenticated `actor` + idempotency key on every coordination append. `BatonEvent` in `log.mjs` has neither field. Migration schema must be specified or CK1 is untestable against existing replay.

### CK2 — task DAG, claims, replay

**Critical — spawn is not durable before return.** CK2 requires durable task creation at `spawn()` return, including queued work. `coordinator.spawn()` only mutates `_tasks` (lines 650–684); `lifecycle.spawned` logs in `_dispatch()` (lines 494–503) when deps and vendor capacity allow. Crash between the two loses the task — CK9-2 would fail today but the spec never names this seam.

**Critical — no `claimTask` CAS; assignee pinned at spawn.** CK2 defines `claimTask(id, worker, expectedVersion, key)` as the sole serialization point. Current code sets `assignee: workerId` at task creation (line 639) and dispatches to that pre-bound worker. There is no `version` field and no typed refusal without append. This matches `docs/08` §4’s *intent* (claims serialize) but violates CK2’s contract shape; conflating spawn-with-worker and claim will break queued DAG tasks that should stay unassigned until ready.

**Critical — dependency graph lost on replay.** `_replay()` reconstructs tasks with `deps: []` always (line 2362); `lifecycle.spawned` payload omits `deps` (lines 496–502). After restart, `_dispatchPass()` treats all replayed tasks as ready (line 362: empty deps trivially satisfied). CK9 item 2 says “dependency readiness survives restart” but does not assert `deps[]` round-trip — a classic built-not-wired trap where tests pass on fresh processes and fail on restart with DAGs.

**Major — schema drift.** CK2’s task record omits coordinator fields (`vendorRequested`, `sessionRequest`, etc.). CK2 must map durable vs projection-only fields or CK8 auto-ingest has no taxonomy. CK2 should also normatively tie `control.recovery_terminalized` (lines 2342–2352) to new terminal events via `refines`, never reopening prior terminals.

### CK3 — artifact manifest

**Major — artifacts are worker prose, not manifests.** `coordinator.mjs` stores `task.result.artifacts` from adapter `WorkerResult` (e.g. `adapter.mjs` lines 379–410) and separately `capturedSha` from git capture (lines 2094–2145). CK3 requires immutable manifests with `digest`, `provenance[]`, `createdEvent`. Today there is no registry, no idempotent registration, and no link from verification/review/integration events to manifest IDs. CK9 item 5 can pass on `capturedSha` alone while CK3’s provenance chain remains unwired.

**Major — correction-via-new-artifact unspecified.** CK3 says corrections create new artifacts linked by knowledge edges. No `artifact.supersedes` event kind is named; CK5 `Supersedes` alone is insufficient for manifest immutability without an artifact-layer event.

### CK4 — Scratch projection

**Major — `env_ref` typing underspecified.** CK4 requires cross-tree warnings and `observed|derived` grounding — correctly echoing `coordination-repl.md` appendix §4 (mutable worktree path vs content hash). CK4 never mandates that durable `env_ref` is a git tree-ish / `baseSha`, not a live worktree path. Without that, replay-stable facts can encode stale paths and CK9 item 6 passes while poisoning workers on divergent branches.

**Major — glob intersection algorithm missing.** CK4 requires conservative glob intersection for conflicts; `coordinator.mjs` has `globRegex()` for `pathScope` (lines 93–114) but Scratch has no specified reuse. Divergent implementations will false-negative on `path:payments/**` vs `path:payments/stripe_adapter.py`.

**Later scope:** Bench, CAS cells, watch, heartbeat — correctly deferred; point checks match `scratch_check`.

### CK5 — bitemporal causal graph

**Major — global ordering dependency unresolved.** CK5 rejects evidence whose source `seq` is later than the node event time. With per-worker operational `seq` today, “source seq” is meaningless across workers. CK1 must define a hub total order (coordination `seq`) and a mapping from operational events (e.g. `(worker, seq)` → coordination `seq`) before CK5 is implementable. This is a contract defect, not later scope.

**Major — `ReadBy` recall logging unspecified at substrate boundary.** CK5/CK7 require `ReadBy` edges on recall. No event kinds for `knowledge.read` / `knowledge.recall` are listed in CK1’s implied taxonomy; promotion hooks in CK6 reference nodes but not the read path.

### CK6 — promotion and health

**Later scope:** scorecards, RouteStat, lexical recall — aligned with `docs/26` H.4/Cairn sequencing.

**Major — auto-promotion hook events unnamed.** CK6 says “task/artifact auto-promotion hooks” in the first vertical but does not list trigger events (`task.completed` + `verify.reverified`? `integration.completed`?) or forbid promoting from unaccepted tasks. Without named hooks, promotion can ship as dead code behind a manual `writeDecision()` API.

### CK7 — contamination and read provenance

**Critical for routing/acceptance gate — zero impl, spec incomplete.** `docs/26` D and `docs/08` §5 require read provenance before knowledge influences routing. CK7 mandates `affectedReaders(id)` but does not define the durable record shape (event per read vs projection table), retention, or the failure mode when a read is not logged. A stub `affectedReaders` returning `[]` would satisfy a superficial CK9 item 7 while CK7 remains unwired — exactly the built-not-wired pattern.

### CK8 — public assembly

**Critical — `createDriver()` does not expose `coordination`.** `impl/src/index.mjs` returns `{ coordinator, story, router, log }` (line 188). CK8 requires `coordination` on the driver and automatic flow of coordinator task/artifact events. No `CoordinationStore` module exists. Shipping coordinator changes without a mandatory `coordination.recordFromDriverEvent()` call in the coordinator constructor path will pass all existing 427 tests and fail CK8 silently.

### CK9 — safety gate coverage

**CK9 catches:** idempotency, restart projections, CAS winners, refusal-without-append, Scratch replay, KG rejections, public-driver outcomes (items 1–9) — *if* implemented as integration tests against a real `CoordinationStore`, not coordinator internals alone.

**CK9 misses (built-not-wired):**
1. **Queued task durability** — create task with unsatisfied deps, crash before dispatch, assert task exists unassigned in coordination stream (CK2/CK9-2 gap).
2. **`deps[]` round-trip** — restart with multi-task DAG (CK9-2/9-9 gap).
3. **Dual-log divergence** — worker `lifecycle.*` in per-worker log must appear as mapped coordination events with comparable `seq` (CK1/CK8).
4. **Append-failure atomicity** — simulated `appendFileSync` failure must not mutate `_tasks` or coordination projections (CK1).
5. **Coordinator-without-substrate** — assert every `spawn`/`integrate`/`verify.reverified` produces ≥1 coordination event; `_tasks.size > 0` with empty `events.jsonl` must fail (CK8). Item 8 partially covers this but only for named outcomes, not queued creates.
6. **`affectedReaders` non-stub** — invalidate a node after a logged read, assert non-empty blast radius (CK7).

## Contract corrections

| ID | Correction |
|---|---|
| **CK1** | Add **CK1a**: per-worker logs stay for telemetry; coordinative/epistemic/Scratch mutations append to `CoordinationStore` with global `seq`. Define `mapOperationalEvent(worker, seq) → coordinationSeq`. Append failure is fatal before projection update. |
| **CK1** | Add startup `validateTail()`: scan `events.jsonl`, reject gap/truncated JSON with process exit and actionable error (never truncate). |
| **CK2** | Split **`task.created`** (durable at `spawn()` return, may be `pending`+`assignee:null`) from **`task.claimed`** (CAS dispatch). `spawn()` must not pre-allocate `workerId` for queued tasks. Persist `deps`, `refines`, `taskType`, `brief` hash/ref in `task.created` payload. |
| **CK2** | Add typed refusal codes (`stale_version`, `already_assigned`, `deps_unsatisfied`, `terminal`, `cycle`) as return values with **no** event — mirror `DuplicateTaskIdError` throw vs refusal distinction in coordinator today. |
| **CK3** | Name artifact event kinds: `artifact.registered`, `artifact.superseded`. Require `registerArtifact` only after `task.status === 'completed'` (or named acceptance event). Bind `capturedSha`, `verify.reverified`, `integration.completed` to manifest IDs in payload. |
| **CK4** | Mandate `env_ref` as `{ repoRoot, treeSha }` where `treeSha` is immutable at post time; point reads against mismatched tree emit mandatory warning string exactly as spec’d. Reference `globRegex` semantics or embed normative glob-intersection rules. |
| **CK5** | Require all cross-stream evidence pointers use **coordination `seq`**; operational evidence must pass through `mapOperationalEvent`. Add `knowledge.read` event with `reader`, `runId`, `taskId`, `nodeIds[]`, `asOf`, `validityVersions{}`. |
| **CK7** | Define `read.contamination_record` event schema; `affectedReaders(nodeId)` is a projection over `knowledge.read` + `ReadBy` edges, must return tasks still `pending|working|input_required`. |
| **CK8** | Change `createDriver()` return to include `coordination: CoordinationStore`. Document single wiring point: coordinator calls `coordination.ingestDriverEvent(evt)` for every state-changing path (spawn, dispatch/claim, terminal, capture, integration, publication). |
| **CK9** | Add items **10–15** matching the misses above. Item **9** must compare **coordination projections** byte-for-byte, not coordinator `_tasks` Map. Require tests use temp dir + temp git repo (already stated) and **fail** if `coordination` is not on the assembled driver. |

## Implementation order

1. **CK1 + CK1a + CK8 wiring skeleton** — `CoordinationStore`, tail validation, idempotency index, `createDriver` exposure, fatal append. No KG/Scratch yet. Proves single truth path.
2. **CK2 vertical** — `task.created` at spawn, `task.claimed` at dispatch, `version` on tasks, deps in replay, refusal matrix. Refactor coordinator to emit through store before `_tasks` mutation. CK9 items 2–4, 10–11, 14.
3. **CK3** — manifest registry hooked to `capture`/`verify.reverified`/`integration.completed`. CK9 item 5.
4. **CK4** — Scratch facts/claims/expiry events only; point check API; glob intersection; `env_ref` tree hashing. CK9 item 6.
5. **CK5 + CK6 hooks + CK7** — graph projection, promotion from terminal tasks, `knowledge.read` + `affectedReaders`. CK9 items 7, 15.
6. **CK9 full gate** — restart byte-equivalence (item 9), public-driver E2E (item 8), then recursive dogfood per CK9 footer.

Do not start CK5/CK6 before CK1a + CK2 are green — temporal coherence retrofitted onto per-worker `seq` forces a breaking migration.