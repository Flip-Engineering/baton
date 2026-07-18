# Phase 81 Context Program — live adversarial review, revision 2 (kimi parallel attempt)

## Revision notes

Revision 1 is superseded by this report. Two feedback items are applied:

- **[high/risk] sharper implemented/proposed boundary.** The "implemented vs proposed" split is
  now stated as two distinct layers with different authority semantics, so the stateless pure-cell
  substrate can no longer be read as partially delivering the model-backed authority path.
- **[medium/suggestion] one durable successor Plan.** The flat 11-step list is replaced by a
  single successor Plan whose *next executable slice* keeps the concise `ContextSession` AX while
  adding durable cell admission, exact route binding, restart identity, and stop/reap tests —
  all before deeper recursion is even admissible.

All source pointers were re-verified against the current effective-tree snapshot; one pointer from
revision 1 is corrected (`_resolveExplicitRoute` is defined at `impl/src/coordinator.mjs:1573`,
not 2164 — 2164 is `_spawnPlanWave`).

## Scope and method

Read-only audit of the effective-tree snapshot: `spec/phase81-context-program-rlm.md`,
`impl/src/context-program.mjs`, `impl/test/phase81-context-program-red.test.mjs`, and the
surrounding Workflow/Plan/Wave, routing, stop/reap, and progressive-application machinery in
`impl/src/`. No production file was modified; the verification suite was not run from this process
(Baton performs fresh verification on the result). The only dynamic evidence is the single-operator
`chunk` probe from revision 1, whose mechanism is re-confirmed below by code inspection.

## The two layers — what exists vs. what the spec's core promise needs

The snapshot contains exactly one layer. The spec's headline vertical is a second, different layer
that does not exist at all. Conflating them is the main way to overstate the current rung.

### Layer A — implemented: the stateless pure-cell substrate

A closed, deterministic, in-process evaluator with no provider, ledger, Workflow, or lifecycle
coupling:

- **CP1 manifest** (`impl/src/context-program.mjs:150-198`): closed field set, tree bound to an
  exact 40-hex SHA with `source: 'workflow_plan'` only, branch refs pinned to
  `ctx:sha256:<digest>` with digest-equality enforced, unique sorted branch names/refs, recomputed
  digest, deep-frozen output. Mutable paths, branch names, and HEAD pointers have no
  representation — they fail normalization (test CP81-1).
- **CP2 closed AST** (`context-program.mjs:252-389`): whitelisted ops with exact per-op field sets
  (`exact()` rejects unknown fields before evaluation), node/depth/byte ceilings, cycle rejection,
  NFKC + secret-shaped-text rejection on all free text, canonical key-sorted digest. Effect ops
  (`map`/`reduce`/`review`/`verify`) carry exactly `{input, instruction, op, role}` /
  `{gate, input, op}` — no field can smuggle harness, model, effort, credential, or authority
  coordinates (test CP81-2).
- **Stateless pure Bench** (`context-program.mjs:428-705`): thirteen pure ops evaluate
  deterministically; effect ops throw typed `context_program_effect_requires_workflow` (CP81-4b);
  branch sources are re-verified against digest and item count on every read (CP81-4); outputs are
  content-addressed artifacts written `wx`/`0o600` with re-validation on collision; `readOutput`
  returns typed `context_artifact_unavailable`, never a silent recompute; the manifest policy
  digest must equal the Bench deployment digest.
- **ContextSession facade** (`context-program.mjs:707-791`): compact
  `outline → index → search / chunk / coverage → cell → evidence → help` cascade with
  self-descriptive method lists.
- **Tests**: CP81-1…5 (`impl/test/phase81-context-program-red.test.mjs:52-181`) cover manifest
  closure, AST closure, replay identity + artifact content-addressing + zero provider effects,
  source-substitution refusal, and the session cascade. Exports wired at
  `impl/src/index.mjs:81-83`.

What Layer A actually guarantees, stated without inflation: **it cannot mint authority**. A model
operating through it cannot execute code, choose a route, reach the network, or persist anything
outside one content-addressed artifact root. It does **not** yet *exercise* authority: no cell is
admitted to the ledger, no Workflow consumes a manifest, and no provider call has ever been routed
through it. `docs/28-exhaustive-capability-audit.md:354-358` states this boundary honestly.

### Layer B — not implemented: the model-backed authority path

Everything that turns `map`/`reduce` into WorkItems, Waves, and Attempts is absent, and it lives
in a different authority domain (hub, Workflow, coordination ledger, coordinator) than Layer A:

- **No `context_recursive` strategy.** `normalizeWorkflowComposition`
  (`impl/src/application.mjs:563-585`) and the client facade
  (`impl/src/application-client.mjs:96-101`) accept only `strategy: 'parallel_attempts'`;
  `context_recursive` is rejected today.
- **No effect compilation.** Nothing validates a `map` role against an approved Workflow team,
  derives partitions, or builds a WorkItem/Wave from a cell. `grep` for `context_cell` /
  `context_program` across `impl/src/` matches only `context-program.mjs` itself — the hub has no
  context-cell code path.
- **No manifest producer.** Branch sources are caller-injected into the Bench constructor; nothing
  materializes `ctx:` refs from a real repository tree, Atlas artifacts, Scratch facts, or
  evidence refs.
- **No durable cell authority.** Cells live in a per-process `Map` (`context-program.mjs:442`);
  the coordination ledger has no context-cell events, so CP3's "append-only, idempotent admission"
  and CP5's "restart after cell admission resumes the same cell" are untestable as shipped —
  restart currently means "deterministically recompute," which is only sound because the pure rung
  has no in-flight states and no side effects worth fencing.
- **No typed termination (CP6).** The ten dispositions have no representation; cell `state` is
  only ever `'completed'` (`context-program.mjs:668`).
- **No cell-level stop/reap or generation fencing (CP7).** No cells join the Run stop union; no
  cell generations exist to fence.
- **No transport parity (CP9) or evaluation (CP10).** No CLI/Web/MCP context surface; no
  direct-vs-pure-vs-recursive comparison harness.

## Critique by dimension

### Authority — negative guarantee real, positive path absent

Layer A's closure is genuine (no `eval`, no ambient shell, exact field sets, effect refusal
without Workflow authority). The structural risk is the boundary crossing: if Layer B is ever
built as "the Bench learns to spawn Attempts," it inherits an authority-less cell layer. Cell
admission must become a ledger event stream *in the hub* before any effect op executes, so the
cell layer the map/reduce vertical attaches to is authoritative from day one.

### Replay — sound for pure cells, undefined for in-flight cells

Pure replay returns one identity and one artifact (CP81-3); cross-restart replay revalidates the
existing artifact rather than double-writing; identity binds manifest + program + environment +
policy digests (`context-program.mjs:619-628`). But the record has no
`admitted|working|failed|stopped|attention` lifecycle, so there is nothing to resume — replay is
exactly as strong as the stateless rung and no stronger. Do not describe the current behavior as
"CP5 restart identity"; it is recomputation equivalence, which coincides with restart identity
only because the rung is pure.

### Stop/reap — nothing to reap yet; the union it must join is proven

The Bench spawns no processes, sessions, or worktrees, so the rung is trivially reap-safe. The
Run-level union Layer B must join is exact: `_performRunStop` (`impl/src/application.mjs:2126-2156`)
requires `remainingCount === 0`, `processesObserved === processesClosed`, and authority release
before a durable receipt; `coordinator.stopRunTargets` (`impl/src/coordinator.mjs:1181`) is the
enforcement seam. CP7's cell-level fence (late completions bound to their original cell
generation, never a later cache key) has no scaffold and must be designed into map compilation,
not retrofitted.

### Evidence — the weakest shipped dimension

CP8 requires a result to bind "the exact selected source refs, ranges/nodes." The shipped output
meta carries only **counts** (`sourceItems`, `selectedSourceItems`, `chunks`) and branch names
(`context-program.mjs:416-426`); `ContextSession.evidence()` (`context-program.mjs:759-776`)
projects digests and counts, not the selected items' coordinates. Two cells selecting different
items of one branch produce indistinguishable evidence. The cell record also diverges from the CP3
schema: it lacks `program`, `inputRefs`, `childCalls`, `termination`, and its own `digest` field.
Separately, the spec's own CP1 example (branches with only `name/ref/summary`) would fail the
shipped normalizer, which requires exactly `{digest, itemCount, mediaType, name, ref, summary}` —
spec/example drift to fix in one of the two documents.

### Exact orchestrator-selected routing — substrate enforced, integration absent

The exact-route discipline Layer B depends on already exists and is enforced: routes are closed
`{harness, model, effort}` tuples (`application.mjs:263-269`); the Workflow team binds role →
exact route with duplicates rejected (`application.mjs:572-585`); Wave members route through
`_resolveExplicitRoute` (`coordinator.mjs:1573`), which fails closed (`unknown_harness`,
`session_unavailable`, model-policy conflicts) when the exact tuple is unavailable, from
`_spawnPlanWave` (`coordinator.mjs:2164-2201`). The AST gives a model no route knob at all. But
today nothing connects a `map` role to that role map, and the spec AX example's
`team: { explorer: {...} }` object-map shape matches neither the wire shape (array of
`{role, route}`) nor the client shape; reconcile the metaphor with the real surface.

### Pythonic agent experience — right shape, narrow depth, must not bloat

`ContextSession` is compact and self-descriptive, and `help()` states the authority boundary
honestly. It exposes only `search/chunk/coverage` of the thirteen pure ops — no `slice`, `filter`,
`project`, `sort`, `unique`, `join`, `collect`, `finish`, and no cursor on `index()`. The risk in
the next slice is the opposite failure too: adding durable admission, routing, and stop/reap by
growing caller-facing knobs. Per the spec's own AX rules (no caller-managed depth, count, budget,
or concurrency knobs), the session surface must stay at its current depth while the authority
plumbing lands underneath it — new capability appears as new *evidence depth* and advertised
actions, not new parameters.

## Defects in the shipped substrate (unchanged from revision 1, pointers re-verified)

- **D1 (confirmed): `chunk` crashes untyped on absent fields.** With any item lacking the `by`
  field, `stable(undefined)` yields `undefined` as a `Map` key and the group sort calls
  `undefined.localeCompare`, throwing a raw `TypeError` with no `code`
  (`context-program.mjs:517-529`). Mechanism re-confirmed by inspection: `getField` returns
  `undefined` (line 521-522), the key enters `groups`, and the comparator at line 526 dereferences
  it whenever ≥2 groups exist. A closed program must fail typed, not leak a host exception.
- **D2: `join` is O(n·m) with only a post-hoc ceiling** (`context-program.mjs:570-579`): two
  10k-item inputs materialize up to 10⁸ comparisons before the result-size check. Reject on
  `left.items.length * right.items.length` before the loop.
- **D3: missing-field semantics are inconsistent across ops** — `chunk` crashes (D1), `sort`
  treats missing keys as equal, `filter`/`slice` compare via `stable(undefined)`, `project`
  silently drops. Pick one documented semantics and test it.
- **D4: `search` matches JSON serialization, not content** (`context-program.mjs:493-506`) —
  field names, quotes, and escapes are in the haystack. Deterministic and closed, but document or
  scope it before Atlas delegation replaces it.
- **D5: unbounded in-memory cell map** (`context-program.mjs:442`) — fine for a stateless rung;
  note it before long-lived root sessions accumulate cells. (Durable admission, slice B below,
  supersedes this map anyway.)

None of D1–D5 weakens authority; all are closure-quality issues inside Layer A. D1 still blocks
Layer B because it is the one confirmed path by which a normalized, digest-bound program produces
an untyped host exception.

## One durable successor Plan

This is a single Plan with dependency-ordered slices; each step lands its red test first, and no
step may be reordered past its dependencies. The Plan's defining constraint: **the concise
`ContextSession` AX is load-bearing and must not grow** — authority plumbing lands underneath the
existing `outline → index → cell → evidence → help` cascade, and deeper recursion stays inadmissible
until the evaluation slice closes.

**Slice A — substrate hygiene (pure, no dependencies).**

1. **D1/D3 typed missing-field semantics.** Red: `chunk`/`sort` over items lacking the key throw
   typed `context_program_invalid` (or follow one documented drop semantics shared with
   `filter`/`slice`/`project`). Cheap; unblocks everything.

**Slice B — the next executable slice: durable authority for one depth-one Wave.**
This is the slice the feedback asks for. It preserves the current `ContextSession` AX unchanged
while adding four tested guarantees — durable cell admission, exact route binding, restart
identity, stop/reap — and it deliberately *excludes* `reduce`/`review` synthesis and anything
beyond depth one. Internal order:

2. **CP3 cell-record alignment + ledger admission.** Red: the cell record carries `program`,
   `inputRefs`, `childCalls`, `termination`, and its own `digest`, with an
   `admitted → working → completed` lifecycle recorded as append-only, idempotent
   coordination-store events; two hub processes over one store converge on one cell table.
   *(durable admission)* Depends on 1. This is the load-bearing step: every later guarantee is a
   statement about ledger cells.
3. **CP8 per-item provenance.** Red: cell output and `evidence()` bind the exact selected source
   refs and per-branch item coordinates, not just counts — two cells selecting different items of
   one branch produce distinguishable evidence. Depends on 2 (record shape). The session gains
   evidence *depth*, not new methods.
4. **Manifest producer.** Red: a real Workflow Plan tree plus Scratch facts and evidence refs
   materialize into a digest-verified ContextManifest whose `ctx:` refs the Bench can read; a
   mutated source fails integrity. Depends on 2.
5. **`context_recursive` admission + exact route binding.** Red: composition normalization accepts
   `strategy: 'context_recursive'` with the existing team role→exact-route array shape, rejects
   unknown roles and any model-authored route field, and a `map` role resolves through the
   approved role map to the orchestrator-selected harness/model/effort tuple via
   `_resolveExplicitRoute` — an unavailable tuple fails before any provider effect.
   *(exact route binding)* Depends on 4.
6. **`map` compiles one WorkItem + one Wave with restart identity and stop/reap.** Red: `map` over
   N addressed partitions derives N distinct Attempts through `spawnPlanWave`
   (`coordinator.mjs:2131`), each with distinct route, result, evidence, and cleanup identities;
   analysis children get no writable checkout; restart after cell admission, partial batch
   completion, or provider result converges to the same cell/Attempt identities with at most one
   physical provider effect per Attempt *(restart identity)*; a late or duplicate completion
   arriving after cell stop or timeout stays bound to its original cell generation and cannot
   attach to another cell or cache key *(generation fence)*; stop during the batch snapshots and
   reaps every descendant session, worker, provider process, worktree, lease, and cell batch,
   returning zero remaining ownership through the `stopRunTargets` receipt discipline
   *(stop/reap)*. Depends on 2, 4, 5.

**Slice C — depth-one completion (after B, still no recursion).**

7. **`reduce`/`review` synthesis.** Red: synthesis consumes only exact terminal child refs of the
   current cell generation; stale/cross-cell/cross-generation output is retained as evidence but
   cannot attach; the result is an ordinary untrusted Candidate that cannot select or integrate
   itself. Depends on 6 (the fence exists).
8. **CP6 typed termination + progress projection.** Red: each disposition (repeated
   program/result, no new context/progress, contradiction, verification failure, policy
   exhaustion, missing artifact, ambiguous recovery, operator stop) projects its exact typed state
   and safe next action on `workflow.status()`; policy exhaustion never forces a final answer.
   Depends on 2, 6.
9. **CP9 transport parity.** Red: direct/CLI/Web/MCP context outline/index/cell/call/coverage/
   termination views share one semantic digest and expose only advertised safe actions; schemas
   never accept derivable private coordinates. Depends on 6–8.

**Slice D — earned expansion (gates recursion).**

10. **CP10 evaluation gate.** Red: the fixed four-arm comparison (direct root answer / Atlas-only /
    pure-context / depth-one recursive) runs with fresh-gate correctness, coverage, cost, replay
    equivalence, and cleanup measures; short-context tasks refuse recursion. Depends on 6–9.
11. **Deeper recursion — closed by default.** Only after slice D passes does further expansion
    propose a normal successor Plan under the Phase 80 policy. No code in slices A–C may contain a
    depth knob; depth > 1 remains inadmissible by construction, not by configuration.

Why this order and not another: step 2 (ledger admission) is the sole authority foundation —
routing (5), restart identity (6), and stop/reap (6) are all claims about ledger cells, so landing
them before 2 would build on the in-memory `Map` this Plan exists to remove. Bundling 6's four
guarantees into one slice is deliberate: a Wave without its fence and reap proof is exactly the
half-shipped state CP7 warns about, and splitting them invites the fence to slip behind the first
Wave. `reduce` waits for the fence (7), termination waits for real batches (8), parity and
evaluation wait for something worth viewing (9–10), and recursion waits for evidence (11).

## Bottom line

Layer A — the closed stateless Context Program — delivers what it claims: authority *cannot* be
minted through it, pure-cell replay returns one identity and artifact, outputs are
content-addressed, and the routing substrate it will later use is already enforced elsewhere in
the hub. It does not deliver, and should not be described as delivering, any part of Layer B: no
ledger-admitted cells, no `context_recursive` strategy, no manifest producer, no map/reduce
compilation, no typed termination, no cell-level stop/reap, no transport parity, no evaluation.
The successor Plan above lands durable cell admission first, binds exact routes and restart
identity to it, ships the generation fence and stop/reap proof *with* the first Wave rather than
behind it, keeps the `ContextSession` AX at its current depth throughout, and holds deeper
recursion closed until the evaluation slice earns it. Before Layer B starts, three Layer A fixes
are prerequisites: ledger admission (step 2), per-item evidence (step 3), and the typed `chunk`
refusal (step 1).

## Verification

Per the attempt contract, the verification suite was not run from this process; Baton performs
fresh verification on the result. No new dynamic probes were run in this revision — all claims rest
on re-read source at the cited locations. This review writes only
`reviews/dogfood/phase81-context-program-live-review.md` and modifies nothing else.
