# Phase 81 Context Program — live adversarial review (kimi parallel attempt)

## Scope and method

Read-only audit of the effective-tree snapshot: `spec/phase81-context-program-rlm.md`,
`impl/src/context-program.mjs`, `impl/test/phase81-context-program-red.test.mjs`, and the
surrounding Workflow/Plan/Wave, Scratch/Cairn, Atlas, stop/reap, and progressive application
machinery in `impl/src/`. No production file was modified. One dynamic probe was run (a single
`node -e` evaluation of the `chunk` operator, not the verification suite) to confirm a suspected
defect; per the attempt contract, the fresh verification run is left to Baton.

## What is actually implemented now

The shipped vertical is a **closed, stateless, pure-substrate Context Program**, and it is real:

- **CP1 manifest** (`impl/src/context-program.mjs:150-198`): closed field set, `schemaVersion`/`kind`
  header, tree bound to an exact 40-hex SHA with `source: 'workflow_plan'` only, branch refs pinned
  to `ctx:sha256:<digest>` with digest-equality enforced, unique sorted branch names/refs, recomputed
  manifest digest, deep-frozen output. Mutable paths, branch names, and HEAD pointers have no
  representation — they fail normalization, as test CP81-1 proves.
- **CP2 closed AST** (`context-program.mjs:252-389`): whitelisted ops with exact per-op field sets
  (`exact()` rejects unknown fields before any evaluation), node/depth/byte ceilings, cycle
  rejection, NFKC + secret-shaped-text rejection on all free text, canonical key-sorted digest.
  Effect ops (`map`/`reduce`/`review`/`verify`) carry exactly `{input, instruction, op, role}` /
  `{gate, input, op}` — there is no field through which a model could smuggle a harness, model,
  effort, credential, or authority coordinate; test CP81-2 proves a `model:` override fails
  normalization.
- **Stateless pure Bench** (`context-program.mjs:428-705`): thirteen pure ops evaluate
  deterministically; effect ops throw typed `context_program_effect_requires_workflow` (CP81-4b);
  source integrity is re-verified against the branch digest and item count on every read (CP81-4);
  outputs are content-addressed artifacts written `wx`/`0o600` with re-validation on collision;
  `readOutput` returns typed `context_artifact_unavailable`, never a silent recompute; manifest
  policy digest must equal the Bench deployment digest.
- **ContextSession facade** (`context-program.mjs:707-791`): compact `outline → index → search /
  chunk / coverage → cell → evidence → help` cascade with self-descriptive method lists.
- **Tests**: CP81-1…5 cover manifest closure, AST closure, replay identity + artifact
  content-addressing + zero provider effects, source substitution refusal, and the session cascade.
- Exports are wired through `impl/src/index.mjs:81-83`; `docs/28-exhaustive-capability-audit.md:354-358`
  already scopes the shipment honestly ("first closed stateless Context Program/Bench substrate
  locally … Durable ledger cells, Atlas/Scratch partition-to-Wave compilation, model-backed
  depth-one map/reduce, replay/stop union, transport parity, and evaluation remain pending").

## What is proposed, not implemented

Be exact about the boundary — none of the following exists in the snapshot:

- **ContextManifest→Plan/Wave compilation.** `normalizeWorkflowComposition`
  (`impl/src/application.mjs:563-585`) and the client facade
  (`impl/src/application-client.mjs:96-103`) accept only `strategy: 'parallel_attempts'`;
  `context_recursive` is rejected today. No code derives a WorkItem/Wave from a `map` AST.
- **Dynamic depth-one map/reduce.** Effect ops normalize but cannot execute anywhere; there is no
  hub path that validates a role against an approved Workflow definition, derives partitions, or
  spawns child Attempts from a cell.
- **A manifest producer.** Nothing builds a ContextManifest from a real repository tree, Atlas
  artifacts, Scratch facts, or evidence refs; branch sources are caller-injected into the Bench
  constructor. There is no `ctx:` ref materialization layer.
- **Durable cell authority.** Cells live in a per-process `Map`; the coordination ledger has no
  context-cell events, so "the canonical AST recorded in authority and evidence" (spec §Terminology)
  and CP5 restart-after-admission semantics are untestable as shipped.
- **Typed termination (CP6).** The ten dispositions (`no_new_context`, `policy_exhausted`, …) have
  no representation; cell `state` is only ever `'completed'`.
- **Cell-level stop/reap and generation fencing (CP7).** Nothing to fence yet — but see below.
- **Transport parity (CP9) and evaluation (CP10).** No CLI/Web/MCP context surface, no
  direct-vs-pure-vs-recursive evaluation harness.

## Critique by dimension

### Authority — preserved, with one structural gap

The closed-AST posture is genuine: no `eval`, no ambient shell, exact field sets, and effect refusal
without Workflow authority. The gap is that cell admission is **not in the ledger**. Spec §CP3
requires append-only, idempotent cell admission recorded in authority; an in-memory `Map` means two
Bench instances over one artifact root can hold divergent cell tables, and "restart after cell
admission resumes the same cell" (CP5) currently resolves to "deterministically recompute," which
is only acceptable because the pure rung has no in-flight states. This must become a ledger event
stream before any effect op lands, or the map/reduce vertical will inherit an authority-less cell
layer.

### Replay — sound for pure cells, undefined for in-flight cells

Pure replay returns one identity and one artifact (CP81-3), cross-restart replay recomputes and
integrity-checks the existing artifact rather than double-writing, and identity is bound to
manifest + program + environment + policy digests. But the cell record has no
`admitted|working|failed|stopped|attention` lifecycle, so there is nothing to resume — the replay
story is exactly as strong as the stateless rung and no stronger.

### Stop/reap — nothing to reap yet; the extension point is proven

The Bench spawns no processes, sessions, or worktrees, so the current vertical is trivially
reap-safe. The Run-level union it must later join is exact and proven: `_performRunStop`
(`impl/src/application.mjs:2126-2182`) requires `remainingCount === 0`,
`processesObserved === processesClosed`, and authority release before a durable receipt;
`coordinator.stopRunTargets` (`impl/src/coordinator.mjs:1181`) is the enforcement seam. CP7's
cell-level stop with generation fencing (late completions bound to their original cell, never a
later cache key) has no scaffold — no cell generations exist. Design the fence into map compilation,
not after it.

### Evidence — the weakest shipped dimension

CP8 requires a result to bind "the exact selected source refs, ranges/nodes." The shipped output
meta carries only **counts** (`sourceItems`, `selectedSourceItems`, `chunks`) and branch names
(`context-program.mjs:412-426`); `ContextSession.evidence()` projects digests and counts, not the
selected items' coordinates. Two cells that select different items of the same branch produce
evidence that cannot distinguish what was actually read. The cell record also diverges from the CP3
schema: it lacks the `program` AST itself, `inputRefs`, `childCalls`, `termination`, and its own
`digest` field. Separately, the spec's own CP1 example (branches with only `name/ref/summary`)
would fail the shipped normalizer, which requires exactly `{digest, itemCount, mediaType, name,
ref, summary}` — spec/example drift worth fixing in one of the two documents.

### Exact orchestrator-selected routing — substrate proven, integration absent

The exact-route discipline the spec depends on already exists and is enforced: routes are closed
`{harness, model, effort}` tuples (`application.mjs:264-268`); the Workflow team binds role → exact
route with duplicates rejected (`application.mjs:572-585`); Wave members are validated against
approved root nodes and routed through `_resolveExplicitRoute`, which throws `ModelSelectionError`
when the exact tuple is unavailable (`coordinator.mjs:2164-2201`). The AST gives a model no route
knob at all. So the CP4 promise is credible — but today nothing connects a `map` role to that role
map, and the AX example's `team: { explorer: {...} }` object-map shape matches neither the wire
shape (array of `{role, route}`) nor the client shape (`{role, exact}`); reconcile the spec
metaphor with the real surface.

### Pythonic agent experience — right shape, narrow depth

`ContextSession` is compact and self-descriptive, and `help()` honestly states the authority
boundary. But the facade exposes only `search/chunk/coverage` of the Bench's thirteen pure ops —
no `slice`, `filter`, `project`, `sort`, `unique`, `join`, `collect`, `finish`, and no cursor on
`index()`. An agent that needs the closed predicates must hand-author raw AST, which undercuts the
"Pythonic, no raw JSON" promise of the spec's own metaphor.

## Defects found in the shipped substrate

- **D1 (confirmed dynamically): `chunk` crashes untyped on absent fields.** When any item lacks the
  `by` field, `stable(undefined)` yields `undefined` as a `Map` key and the group sort calls
  `undefined.localeCompare`, throwing a raw `TypeError: Cannot read properties of undefined
  (reading 'localeCompare')` with no `code` (`context-program.mjs:517-529`). A closed program must
  fail with a typed error, not leak a host exception. `ctx.chunk('repository', { by: 'symbol' })`
  over items where even one lacks `symbol` reproduces it.
- **D2: `join` is O(n·m) with only a post-hoc ceiling.** Two 10k-item inputs materialize up to 10⁸
  comparisons before the result-size check fires (`context-program.mjs:570-579`). Cheap fix: reject
  when `left.items.length * right.items.length` exceeds a deployment ceiling before the loop.
- **D3: missing-field semantics are inconsistent across ops.** `chunk` crashes (D1), `sort` treats
  missing keys as equal, `filter`/`slice` compare via `stable(undefined)`, `project` silently drops.
  Pick one documented semantics (recommended: typed refusal for `chunk`/`sort` keys, drop for
  `project`) and test it.
- **D4: `search` matches the JSON serialization, not content.** `stable(item)` includes field
  names, quotes, and escapes, so a query can match structure rather than text
  (`context-program.mjs:493-506`). Deterministic and closed, but the semantics should be documented
  or scoped to string fields before Atlas delegation replaces it.
- **D5: unbounded in-memory cell map.** `_cells` grows without eviction; fine for a stateless rung,
  but note it before long-lived root sessions accumulate cells.

None of D1–D5 weakens authority; all are quality-of-closure issues inside the pure rung. D1 should
still block the next vertical because it is the only confirmed path by which a normalized,
digest-bound program produces an untyped host exception.

## Smallest dependency-ordered red-test → implementation sequence

Each step lands its red test first; steps are ordered so each depends only on predecessors.

1. **D1/D3 typed missing-field semantics.** Red: chunk/sort over items lacking the key throw typed
   `context_program_invalid` (or follow documented drop semantics). Pure, no dependencies.
2. **CP3 cell-record alignment + ledger admission.** Red: cell carries `program`, `inputRefs`,
   `childCalls`, `termination`, `digest`, and an `admitted → working → completed` lifecycle recorded
   as append-only, idempotent coordination-store events; restart after admission resumes the same
   cell identity without recompute. Depends on nothing; unblocks everything below.
3. **CP8 per-item provenance.** Red: cell output/evidence binds the exact selected source refs (and
   per-branch item coordinates), not just counts. Depends on 2 (record shape).
4. **Manifest producer.** Red: a real Workflow Plan tree + Scratch facts + evidence refs
   materialize into a digest-verified ContextManifest whose `ctx:` refs the Bench can read; a
   mutated source fails integrity. Depends on 2 (manifest/cell binding).
5. **`context_recursive` strategy admission.** Red: composition normalization accepts
   `strategy: 'context_recursive'` with the existing team role→exact-route map, rejects unknown
   roles and model-authored route fields; orchestrator-approved effort per role is preserved
   end-to-end. Depends on 4 (a workflow needs a manifest).
6. **`map` compilation to one WorkItem + one Wave.** Red: `map` over N addressed partitions derives
   N distinct Attempts through the existing `spawnPlanWave` path, each with distinct route, result,
   evidence, and cleanup identities; analysis children get no writable checkout; a role outside the
   approved map fails before any provider effect; at most one physical provider effect per Attempt
   across restart. Depends on 2, 4, 5.
7. **`reduce`/`review` synthesis + generation fencing.** Red: synthesis consumes only exact terminal
   child refs; a late, duplicate, stale, or cross-generation completion is retained as evidence but
   cannot attach to another cell, cache key, or Cairn promotion. Depends on 6 (generations exist
   only once batches do) — this is CP7's cell-level stop fence and should land with it, not after.
8. **CP6 typed termination + progress projection.** Red: each disposition (repeated program/result,
   no new context/progress, contradiction, verification failure, policy exhaustion, missing
   artifact, ambiguous recovery, operator stop) projects its exact typed state and safe next action
   on `workflow.status()`. Depends on 2, 6.
9. **CP7 stop-union extension.** Red: stop during a parallel batch snapshots and reaps every
   descendant session, worker, provider process, worktree, lease, and cell batch, returning zero
   remaining ownership through the existing `stopRunTargets` receipt discipline. Depends on 6, 7.
10. **CP9 transport parity.** Red: direct/CLI/Web/MCP context outline/index/cell/call/coverage/
    termination views share one semantic digest and expose only advertised safe actions. Depends on
    6–8 (there must be something to view).
11. **CP10 evaluation gate.** Red: the fixed four-arm comparison (direct / Atlas-only / pure-context
    / depth-one recursive) runs with fresh-gate correctness, coverage, cost, replay-equivalence,
    and cleanup measures; depth > 1 stays closed until the gate passes. Depends on 6–9.

Steps 1–3 harden the shipped substrate; 4–5 build authority plumbing; 6–7 are the effect vertical
(and the security-critical fence); 8–9 lifecycle; 10–11 parity and earned routing. This matches the
spec's own build sequence but makes the ledger-admission step (2) explicit — it is the load-bearing
dependency the current snapshot most conspicuously lacks.

## Bottom line

The closed stateless Context Program preserves authority, exact replay for pure cells, content-
addressed artifacts, and a credible routing substrate, and the capability audit already states the
pending scope honestly. The three things that must change before the effect vertical lands: cell
admission belongs in the ledger (CP3/CP5), evidence must bind exact selected refs rather than counts
(CP8), and `chunk`'s untyped crash (D1) must become a typed refusal. Stop/reap, typed termination,
transport parity, and the evaluation gate are correctly sequenced after map/reduce compilation —
provided the generation fence (step 7) ships with the first Wave, not behind it.

## Verification

Per the attempt contract, the verification suite was not run from this process; Baton performs
fresh verification on the result. The only dynamic check performed was the single-operator D1 probe
described above. This review writes only
`reviews/dogfood/phase81-context-program-live-review.md` and modifies nothing else.
