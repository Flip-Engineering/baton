# Epic #81 — the orientation ladder — epic contract (draft v1, 2026-08-03)

(Seed: `docs/reference/evidence/orientation-2026-08-03/orientation-scoping.md` — the operator's
evaluation + scoping note ("have you evaluated the advanced syntax, troubleshooting, testing,
and code-investigation/exploration/understanding features for context engineering and tooling
improvements and intuitive, reflectively-bidirectional integration?"). This contract follows the
BD3 spine: seed → code-verified ground truth → question → numbered decisions with red-team
targets → non-goals → red-first acceptance. Seat: **glm** (Lane B). Status: **DRAFT v1** (skeleton-first, then deepened in place) — seed + code-verified
ground truth, the question, eight numbered decisions with named red-team targets, non-goals, red-first
acceptance, open questions, out-of-v1. Ready for the adversarial red-team wave.)

**Dependencies (hard, from the frontier-sweep stack):** This epic is **LAYER 2**, it does not
precede its spine. It rides:
- **BD3-A (Lane S, #68/#75)** — the worker read port. A new `code` query kind joins
  {knowledge, board, scratchpad, finding}; reads are hub-admitted, viewer-scoped, refusal-typed,
  and mint **`context.read`** evidence (ZERO promotion weight — a class that does NOT exist yet).
- **BD3-B (Lane S, #69/#75)** — context-packs. Every orientation tier's answer is a
  content-addressed context-pack cited by digest into briefs (not pasted prose).
- **BD3-A is not landed** (it is in red-team wave as of this contract). Nothing here assumes a
  shipped read port; the contract is written so the rungs compose the moment the spine lands.

**Campaign control law (binding):** orientation controls are EVAL-ABLE (a map answer is verifiable:
bounded bytes, content-addressed, re-verifiable against the tree it was derived from),
CONSTRUCTIVE (the disclosure ladder is capability scoping by construction — a worker cannot get an
unbounded answer, only a tier-bounded one), or CONVERSATIONAL (agents rate the orientations they
receive — O-4's bidirectional feedback). No turn-limit, no clock, no freshness-by-timer. The
freshness control is content-addressed + re-verifiable, never a staleness-TTL.

---

## Seed (condensed from orientation-scoping.md)

The operator's ask, evaluated honestly, splits in two:

**Landed + integrated (the good half):** the unified grammar (M0–M5) is the "advanced syntax"
substrate and is genuinely integrated; troubleshooting/diagnostics (run.debug, trust-gate
{gate,detail}, attention with progressClass + requiredAction, write-failure #62) make failures a
query away; the red-first + adversarial red/blue methodology is the campaign's strongest habit;
validated-goal controls (DoD + verification + referee + content gates) are the good control class.

**Built but unreached-for (the context-engineering half):**
- **ATLAS (index/structural/cartographer):** code property graphs + structural change
  classification + behavior fingerprints — used ONLY by the trust gate as verification evidence.
  No agent-invokable exploration surface (zero `baton_atlas_*` tools, no application pull).
- **Context program (cells/calls, eval/map/reduce/retry):** pure compute over immutable branches;
  manifest admission is embedded-only, MCP/web dispatch "do not yet." Used: essentially never.
- **cartographer/quartermaster `orientation.slice`:** orientation slices — coordinator-internal
  (serves briefs via orchestrator-PUSH paths; no worker pull).
- **REPL:** manifest/binding/cite, ~30% realized (#69).

**The taxes (measured this campaign):** (1) investigation archaeology — every agent (orchestrator
included) re-derives the codebase with grep/read/bash on raw files every task; (2) flat context —
briefs/objectives are unstructured prose, no map→region→detail disclosure ladder; (3) investigation
doesn't compound — structural facts never enter the KG, so every wave re-investigates from zero.

---

## Code-verified ground truth (file:line — all read this campaign)

### GT-1 — ATLAS code index: the strongest machinery in the repo, capability-op only

`impl/src/atlas-index.mjs` — `AtlasCodeIndex`. Eight ops on a content-addressed capability plane
(card() at :245-265): `index.build`, `search.lexical`, `symbol.search`, `symbol.references`,
`graph.calls`, **`repo.map`** (:368-369), **`code.seed`** (:370-376), `scip.export`.

- **Freshness handle TODAY** (:169-186, :343): the index commits to an `index_epoch` (a sha of the
  derived symbols/occurrences/calls PLUS the source inputs — a valid JSON file cannot preserve an
  epoch while silently changing the projection, per the comment at :167-168). Every query runs an
  **`overlay`** of base+worktree (:172-186) — the overlay is **recomputed per query** (a stated
  limitation at :263). Provenance carries `{index_epoch, overlay_applied, overlay_digest,
  overlay_changed/added/deleted, staleness: 'base_plus_worktree_overlay' | 'base_snapshot_only',
  effective_files}` (:343). **There is no git `treeSha` in ATLAS today.**
- **`repo.map`** (:369) — the closest existing thing to `code.orient.map`: a FLAT per-file
  projection `{path, language, lines, symbols, references, imports, calls, parseErrors}`. It has
  NO module grouping, NO one-line purposes, NO entry points, NO hot paths, NO surface ownership.
  Surfacing it verbatim is NOT the map the seed calls for.
- **`code.seed`** (:370-376) — term-scored orientation files (`score = symbols*5 + lexical + imports*0.1`),
  filters score>0. This is the "brief" substrate orientation.slice wraps.
- **Pagination / resume EXISTS** (:407-427): cursor `atlas:<digest>:<offset>`, budget-bounded
  (`budgetTokens * 4` bytes), deterministic, content-addressed, re-reads the artifact and verifies
  its digest (:415). `_result` mints a cursor only when truncated and resumable (:316-322).
- **Honest-empty posture** (:242 availability default; :320 summary): when
  `availability.status === 'empty'` the answer is literally "no JavaScript/TypeScript-family
  sources; honest empty Atlas result." Language ceiling is JS/TS family only, maximumRung 'R2',
  enforcingGate 'atlas-representation-ceiling' (:261). Symlinks skipped, NUL-byte files skipped
  (:126, :134), bounded reads with changed-during-read detection (:19-29, :26).
- **Stated limitations** (:263): overlay recomputed per query; hard result ceiling (`maxResults`,
  default 100k :239); SCIP JSON interchange only (no live LSP/protobuf); **no semantic retrieval**;
  **no CPG/IR/semantic merge**. (The CPG/IR/behavior-fingerprint machinery lives in sibling
  `atlas-cpg*.mjs` / `atlas-structural*.mjs` and is gate-private — see GT-4.)

### GT-2 — cartographer/quartermaster: orientation.slice, coordinator-PUSH only

`impl/src/cartographer-quartermaster.mjs` — `CartographerQuartermaster` (constructs at
`impl/src/index.mjs:1308`).

- **`orientation.slice`** (:516-558): shapes `'brief'` (→ `code.seed`) and `'map'` (→ `repo.map`),
  plus an optional `symbolFocus` (symbol.search + optional symbol.references, :540-554). Emits a
  content-addressed `application/vnd.baton.orientation-reuse+json` artifact (:65) with provenance
  `{index_epoch, overlay_digest, staleness, language_ceiling, atlasArtifactDigest}` (:556-557).
  Honest-empty honored (:556).
- **Pagination / resume EXISTS** (:769-779): cursor `orientation:<digest>:<offset>`, budget-bounded,
  deterministic; **orientation.slice IS resumable** (the `resumable` flag at :494 excludes only the
  provenance/reuse ops, not orientation.slice). `reverify` (:781-903) for orientation.slice falls to
  the generic rerun-and-compare-digest path (:891-893).
- **Supply-chain ops are NOT orientation:** `reuse.internal`, `reuse.vet`, `provenance.sbom`,
  `provenance.plan`, `provenance.advisories` (the dependency dossier / SBOM / advisory machinery —
  gate-supplied, externally-resolved, separate artifact types at :57-65). These are out of scope for
  this epic; they share the file, not the feature.

### GT-3 — the surface: orientation.slice is orchestrator→worker PUSH, not worker pull

- **Coordinator `orientWorker`** (`impl/src/coordinator.mjs:6582-6600`): the coordinator invokes
  `orientation.slice` (resolving `cartographer` → `cartographer-quartermaster` at :6582), gated by
  `expectedFence` (:6570-6576 precheck → `control.stale_rejected` / `stale_fence`), and emits a
  **`baton.orientation.slice` note** (:6593) onto the worker's stream carrying `{op, status,
  summary, focus, payload, refs, cursor, provenance}` (:6590-6599). This is the DOWN channel
  (orchestrator→worker), framed as data. The scope-orientation policy REQUIRES a registered
  orientation.slice (:1000-1001) or it throws.
- **web-northbound + mcp-northbound `push`** (`web-northbound.mjs:456`, `mcp-northbound.mjs:775`):
  the only northbound orientation action is **`push`** — it demands exact
  `{name:'cartographer-quartermaster', op:'orientation.slice', workerId, note, expectedFence}`
  and rejects action-inapplicable fields (`ref`/`cursor`/`claim` at :461). It is an orchestrator
  push to a worker, **not a worker query**. There is no `invoke`/`resume`/`reverify` northbound
  path that a worker drives for code.
- **No `code` query kind exists.** BD3-A's closed v1 query kinds are {knowledge, board,
  scratchpad, finding}; `code` is the addition this epic requires and BD3-A has not landed.

### GT-4 — the gate-private instrument (ATLAS structural / representation review)

The CPG/IR/structural machinery the seed credits — `atlas-structural-evidence.mjs`,
`atlas-structural.mjs`, `atlas-representation-review.mjs`, `atlas-representation-producer.mjs`,
`atlas-rewrite.mjs` — is consumed by `coordinator.mjs` + `coordination-store.mjs` (the trust gate's
verification evidence), NOT by any agent surface. Critically for the freshness question:

- **`atlas-representation-review.mjs:30`** pins freshness by **git `treeSha`**: `head !== args.treeSha`
  throws `representation_tree_changed`. The producer (:76,:80) mints `symbol_snapshot` with `treeSha`
  and structural deltas with `beforeTreeSha`/`afterTreeSha`.
- **The deployment has a `treeSha`** (`application-deployment.mjs:1682`: `treeSha: snapshot.sha`).
- So the repo HAS a git-treeSha freshness discipline — but only the gate uses it. ATLAS's own
  orientation answers use `index_epoch`+`overlay_digest` (content), not `treeSha` (git). This gap is
  the freshness decision (O-3).

### GT-5 — the evidence class: scratch.read accrues weight; context.read does not exist yet

- **`scratch.read`** is an existing causal-evidence class (`coordination-store.mjs:8257` dispatch,
  `:13156` append, `:14349`/`:14471`/`:14545` in promotion). The promotion gate counts **distinct
  reader taskIds** (`:14374` `byTask`, `:14375` `if (readerTaskIds.length < policy.minScratchReaders)
  continue`).
- **The self-read promotion hole (CONFIRMED):** at `:14374` the `byTask` map is keyed only on
  `read.payload.taskId`; there is **no exclusion of the fact's authoring task**. At
  `minScratchReaders === 1`, a worker reads its own fact and self-promotes — zero independent
  readers. BD3-A v2.0 closes this in the same rung (codex #8 + glm #4).
- **`context.read` does not exist** (no hits in `impl/src/`). BD3-A v2.0 defines it as a SEPARATE
  class — content-digested, bounded, **ZERO promotion weight**, never counted by
  `minScratchReaders`. **This corrects the seed:** the seed's O-2 ("a code.orient call mints a
  scratch.read-class evidence event") is pre-BD3-fold; the folded decision is `context.read`, not
  `scratch.read`. Orientation evidence must accrue ZERO weight by default (a worker reading a map
  must not farm promotion), exactly the failure glm #4 describes.

### GT-6 — context-packs are ABSENT today; the candidacy gate is the promotion gate

- **Context packs do not exist** (matrix: "Context packs — absent"; context moves as prompt text).
  BD3-B introduces them. Orientation answers ride BD3-B's `context-pack:<sha>` citation, not the
  ~30%-realized REPL manifest/binding/cite layer (`context-program.mjs` admit machinery at
  :683-704/:1251-1277 is embedded-only).
- **Candidacy is the knowledge-promotion gate** (`coordination-store.mjs:14340+`): candidates →
  promotion batch → Findings, gated by `promotionActor` (orchestrator/operator only, :349). An
  orientation answer becomes a candidacy candidate through the SAME gate a note does — there is no
  separate structural-admission path today.

---

## The question

Can a worker mid-turn ask "what is this codebase — at the level I need right now" and get a
**bounded, citable, freshness-pinned** answer through one disclosure ladder (map → region → detail),
where every answer is a content-addressed context-pack (BD3-B) that the worker cites by digest
instead of re-deriving — and where the structural facts that answer reveals COMPOUND into the KG as
candidacy candidates, so the next wave starts oriented instead of from zero? And can the tooling
itself learn which orientations matter, from the workers' own usage receipts (O-4)? That is the
context-engineering half of the operator's ask, and it is the rung #74's decomposition quality
rides (decomposition quality IS orientation quality).

---

## Numbered decisions (each with grounding + named red-team targets)

### O-1 — the orientation ladder (progressive surface of disclosure)

One tool family, three bounded tiers, each answer a citable context-pack (BD3-B):

- **`code.orient.map({ scope? })`** — the structural index: modules (rolled up from `repo.map`'s
  flat per-file view) with one-line purposes, entry points, hot paths, and surface ownership
  (suite/test pairing). **Bounded ≤ 2KiB.** This is NOT a verbatim surface of `repo.map`
  (atlas-index.mjs:369 — flat `{path, language, lines, symbols, references, imports, calls,
  parseErrors}`, no purposes/entry-points/ownership); O-1 adds the module-rollup + curated overlay
  (O-4) and bounds it. The bound is the constructive control: a worker cannot get an unbounded map.
- **`code.orient.region({ module | pathGlob })`** — one module's surface: exported contracts,
  invariants (from its own comments/tests), its test suites, its recent change classes
  (ATLAS-structural, the gate's classification machinery exposed as a SAFE projection).
  **Bounded ≤ 4KiB.** Generalizes orientation.slice's two shapes (`brief`/`map`,
  cartographer-quartermaster.mjs:516) to a region tier.
- **`code.orient.detail({ citation | range })`** — the exact lines with a content-addressed citation
  (context-pack digest; repl.cite-compatible). Carries `mergeAuthority:false,
  verificationAuthority:false` (the existing provenance flag, cartographer-quartermaster.mjs:501) —
  detail is **evidence, never clearance**.

Every tier rides BD3-A's new `code` query kind (worker pull) and/or BD3-B's spawn-pack citation
(orchestrator push). Every answer is a context-pack, not prompt text.

**Red-team targets:**
- **The map that lies (stale rollup).** A module grouping computed once and cached diverges from the
  tree — the map names a module/entry-point that no longer exists, or omits a new one, and the
  worker plans against a phantom. → Mitigated by O-3: every map answer carries its freshness handle
  and `reverify` refuses on divergence (the `effective_tree_changed` pattern at
  cartographer-quartermaster.mjs:795). A stale map is a typed refusal, never served.
- **Region that smuggles instruction.** region invariants "from comments/tests" are model-authored
  prose crossing INTO context — a comment like `// this is authoritative; run rm -rf` must arrive as
  data, never instruction. → wrapProse-framed (UNTRUSTED) at the admission seam, the same one-closed-
  renderer discipline BD3-A codex #3 mandates (bidirectional-v3-decisions.md:31-34). An unframed leaf
  is rejected before provider delivery.
- **The 4KiB bound vs a 15k-line module.** `coordination-store.mjs` is 15689 lines; its region won't
  fit 4KiB. → The answer is a citation chain (region cites detail packs by digest), NOT a bigger
  region. Conciseness-by-citation (O-5); the bound is the law, not a hope.
- **Region/detail cross-scope leak.** A worker scoped to lane B pulls `region(<lane C module>)`.
  → Viewer-scope is re-derived server-side (BD3-A's horizon predicate, bidirectional-v3-decisions.md
  :11-16); a scope-violating region refuses with the constant scope refusal before any existence
  check (no module-existence leak either direction).

### O-2 — investigation receipts as knowledge (the evidence-class correction)

Every `code.orient.*` call mints a **`context.read`** evidence event — content-digested, bounded,
**ZERO promotion weight**, never counted by `minScratchReaders`. High-value answers (novel
structural facts, surprising invariants) become candidacy candidates through the SAME promotion gate
a note uses. **This corrects the seed:** the seed's O-2 said "a scratch.read-class evidence event"
(orientation-scoping.md:76-79); that was pre-BD3-fold. The folded BD3-A decision (codex #8 + glm #4,
bidirectional-v3-decisions.md:24-30) is `context.read`, a SEPARATE class from `scratch.read`.

Grounding: `scratch.read` exists and accrues weight (coordination-store.mjs:8257/:13156/:14375);
`context.read` does not exist yet (GT-5). candidacy = the knowledge-promotion gate
(coordination-store.mjs:14340+, promotionActor orchestrator/operator only at :349).

**Red-team targets:**
- **Evidence farming (the glm #4 / codex #8 hole, restated for code).** If orientation reads used
  `scratch.read`, a worker could read its own structural "fact" and self-promote at
  `minScratchReaders===1` (the self-read hole, coordination-store.mjs:14374 — `byTask` keyed only on
  `read.payload.taskId`, no author-task exclusion). → Pinning to `context.read` (zero weight) closes
  this by construction: there is no weight to farm. A worker reading a map accrues nothing toward
  promotion.
- **Structural-fact laundering.** A worker authors a Finding claiming a structural fact, then reads
  its own orientation map to "corroborate" it and count as a second reader. → The promotion gate
  must not count `context.read` as an independent reader (it is zero-weight by class), and the
  orientation answer is candidacy-only (promotionActor gate :349 requires orchestrator/operator) — a
  worker cannot self-admit a structural Finding.
- **KG/event flooding.** Every map call mints evidence; a 64-member wave each pulling a map could
  flood the event store. → BD3-A's "bounded, content-digested" `context.read` events + the existing
  `maxScanEvents` ceiling (coordination-store.mjs:297, `<= 1_000_000`) bound it. Resource circuit-
  breaker (event count), not a clock.

### O-3 — freshness: content-addressed + treeSha-pinned, never stale-as-fresh

Every orientation answer carries a freshness handle that is BOTH content-addressed (ATLAS's
`overlay_digest`, already present at atlas-index.mjs:343) AND **git-treeSha-pinned** (the gate's
discipline, atlas-representation-review.mjs:30 → `representation_tree_changed`). `reverify` recomputes
and refuses on divergence (`effective_tree_changed`, cartographer-quartermaster.mjs:795). **The
index must never serve stale structure as fresh; freshness is content + tree, never a TTL.**

Grounding: ATLAS uses `index_epoch`+`overlay_digest`+`staleness` (atlas-index.mjs:343), overlay
recomputed per query (:172-186, limitation :263). The gate uses git `treeSha`
(atlas-representation-review.mjs:30); the deployment carries `treeSha` (application-deployment.mjs
:1682). reuse.vet reverify already does `effective_tree_changed` (:795).

**Red-team targets:**
- **Stale-BASE index served as fresh.** The ATLAS base `index_epoch` is built from `ctx.baseRoot`
  (atlas-index.mjs `index.build` at :334-340); if `baseRoot`'s tree moves under a cached base index, the
  epoch is stale but the worktree-only overlay (:172-186) will NOT catch a base/HEAD divergence. →
  Pin every answer to the deployment `treeSha`, and at serve/reverify time confirm the base index's
  claimed inputs still hash to its epoch (the epoch-projection check at :306-307). If the base is
  stale, refuse with a typed `orientation_base_stale` (re-index required) — never serve the stale
  structure. This is the single most important freshness seam.
- **Overlay-digest without treeSha.** Two divergent trees could (vanishingly) share an
  `overlay_digest` projection; `treeSha` is the authoritative anchor, `overlay_digest` the content
  handle. Both required on every answer; either mismatch refuses.
- **Reverify weaponized as a stall.** `reverify` recomputes the overlay per query (:263); a worker
  hammering reverify could stall. → Bounded by `budgetTokens` + the constructive tier bounds;
  reverify rides the orchestrator-gated `reverifyCapability` path (coordinator.mjs:9670), not a free
  worker loop.

### O-4 — the map authorship: generated-with-curation-overlay (the overlay lives in the KG)

Honest answer (seed, orientation-scoping.md:109-111): **generated-with-curation-overlay.** The
generated map is ATLAS's module rollup (rolled up from `repo.map`, atlas-index.mjs:369). The curated
overlay — one-line purposes, ownership, "why this module exists" — lives in the **KG as authored
Findings**, admitted through the candidacy gate. The map mints by merging generated structure +
curated overlay, both freshness-pinned (O-3) and each leaf labeled by source.

Grounding: `repo.map` (:369) = generated, flat, no purposes. No curated-orientation doc exists today
(grep found none). KG Findings = authored knowledge (promotion gate, coordination-store.mjs:14340+).
The seed's exact framing: "generated (ATLAS) vs curated (a hand-maintained orientation doc)? The
honest answer is generated-with-curation-overlay, and the overlay lives in the KG as authored
Findings" (orientation-scoping.md:108-111).

**Red-team targets:**
- **Curated-overlay-vs-tree drift.** An authored Finding says "module X's purpose is Y" but module X
  was renamed/deleted. → The overlay Finding must cite the structural node it annotates (a
  `DerivedFrom`/annotates edge to the ATLAS symbol/module); a structural change that leaves the
  citation dangling refuses (overlay dropped for that leaf with a typed `overlay_dangling`, never
  silently served against the wrong module, never silently dropped without trace).
- **Authorship authority.** Who writes the overlay? → Worker-authored overlay Findings go through the
  candidacy gate (promotionActor orchestrator/operator, :349); a worker cannot self-author a
  "purpose" and have it served as curated truth. The overlay is orchestrator-admitted, exactly like
  any other Finding.
- **Generated-as-curated confusion.** The answer must label each leaf `source:'generated'` (ATLAS)
  or `source:'curated'` (KG Finding) — never present a generated heuristic as an authored invariant.
  This is the code.seed-score discipline already in force (cartographer-quartermaster.mjs:564-566
  refuses to turn an import-count prior into evidence that a capability exists).

### O-5 — pagination: the cursor IS the citation (big answers are chains, not blobs)

Big answers are citation chains, not bigger blobs. The existing cursor machinery is the pagination
shape and it already exists for both planes: ATLAS `atlas:<digest>:<offset>` (atlas-index.mjs:407-427)
and cartographer `orientation:<digest>:<offset>` (cartographer-quartermaster.mjs:769-779), both
budget-bounded (`budgetTokens * 4`) and deterministic. A region/detail that exceeds its tier bound
returns `needs_resume` + a cursor (cartographer-quartermaster.mjs:494-499 mints cursor only when
`resumable && truncated`); the agent expands the citation on demand. orientation.slice IS already
resumable (:494 excludes only the provenance/reuse ops).

**Red-team targets:**
- **Cursor forgery.** A worker crafts `orientation:<fake-digest>:<offset>` to read an artifact it
  shouldn't. → The resume path already verifies `ref.handle === art:sha256:<digest>` AND
  `match[1] === ref.digest` (cartographer-quartermaster.mjs:771-772), then `_loadArtifact`
  re-reads + verifies digest (:776, :479). Maintained.
- **Cursor-stale-as-fresh (lifecycle glm #2 analog).** A cursor minted against treeSha T1, resumed
  after the tree moved to T2, must NOT serve T1's lines as T2's. The artifact digest is content
  (stable), but the LINES are T1's. → Resume re-checks the answer's freshness handle (O-3) and
  refuses `effective_tree_changed` / `orientation_base_stale` if the tree moved, rather than serving
  the cached slice. (Reuse.vet already does this on reverify at :795; orientation.slice's generic
  rerun path at :891-893 must gain the same tree-check.)
- **Unbounded resume fan-out.** A 64-member wave each resuming a 100k-result map. → Bounded by
  `budgetTokens` per resume + the constructive tier bounds (map ≤2KiB fits without resume; region/
  detail resume but each resume is budget-bounded). No silent cap: if a resume truncates, it says so
  (`needs_resume`), it does not drop the tail silently.

### O-6 — spawn-time L0 + mid-turn pull (push the map, pull the region/detail)

Decision (seed's lean, orientation-scoping.md:113-115): **L0 (the map, scoped to the worker's
pathScope) is injected into EVERY brief at spawn** as a context-pack (BD3-B's spawn CAS — a stale
spawn-time citation fails loudly with `context_pack_stale`, bidirectional-v3-decisions.md:46-48).
**L1 (region) / L2 (detail) are worker-PULLED mid-turn** via the BD3-A `code` query kind. Push the
cheap thing that kills the first hour of archaeology; pull the specific thing the task needs.

Grounding: orientWorker PUSH today (coordinator.mjs:6582-6600, fence-gated, `baton.orientation.slice`
note). BD3-B spawn CAS (bidirectional-v3-decisions.md:46-48). BD3-A worker pull (the `code` query
kind does not exist yet — GT-3).

**Red-team targets:**
- **Spawn-time map as prompt-text regression.** If the L0 pack is spliced into the objective string,
  we have rebuilt the exact anti-pattern BD3-B exists to kill (context-as-prompt-text,
  bidirectional-v3-decisions.md:186-188). → The spawn pack is CITED by digest
  (`context-pack:<sha>`), materialized by the hub (wrapProse-framed), NEVER spliced. Verified by the
  same `context_pack_stale`/`context_pack_expired` spawn gate as any BD3-B pack.
- **The map that misorients at spawn.** A wrong-region L0 map sends a worker down the wrong path for
  an hour. → The L0 map is scoped to the worker's pathScope (the same server-derived scope as BD3-A's
  viewer-scope/horizon predicate, :11-16); a worker scoped to lane B must not receive lane C's map.
  Caller-named scope is refused.
- **L0-always cost.** Injecting a 2KiB map into every spawn. → It is bounded (2KiB), it is the
  cheapest thing that compounds (every worker starts oriented instead of re-deriving), and it is a
  context-pack (deduped by digest — two workers in the same region share one pack artifact). Per the
  control law this is constructive (bounded) + eval-able (verifiable map), not a clock.

### O-7 — bidirectional reflection on the tooling itself (agents rate orientations)

Workers rate the orientations they receive (seed O-4, orientation-scoping.md:91-96): a one-bit
scratchpad kind or link relation `relation:'useful'|'missed'` targeting the **pack citation**. The
layer learns which maps/regions matter → candidacy for tool-quality (which orientations get
pre-computed/cached), not just code-quality.

Grounding: scratchpad closed kinds (SCRATCHPAD_WRITE four kinds, bidirectional-v3 ground-truth #1);
link-relation target vocabulary gains `context-pack` (BD3-B, bidirectional-v3-decisions.md:237).

**Red-team targets:**
- **Rating farming / griefing.** A worker spams `'missed'` on every pack to manipulate tool-quality
  candidacy. → The rating is candidacy (not authoritative); deduped per `(worker, pack)`; bounded
  count; a single worker's rating is one signal, never a veto. Tool-quality candidacy never gates
  serving (a pack serves regardless of its rating).
- **Rating-as-covert-channel.** A `'useful'`/`'missed'` relation piggybacking a message to a peer.
  → The relation targets ONLY a pack citation (content-addressed digest); the body is the one-bit
  kind — **no free text in v1** (the same no-free-text discipline as the closed scratchpad kinds).
- **Cold-start.** Tool-quality candidacy is empty until ratings accrue. → The layer must not block
  on it: ratings are advisory to which maps are pre-computed/cached, never a gate on serving. A new
  orientation serves at zero ratings.

### O-8 — surfaces, honest-empty, and the ATLAS-availability posture

Embedded-first (orchestrator); worker pull via BD3-A's `code` query kind; **MCP per the reflex table
when the packaging epic lands** (BD3 lands embedded-first and joins MCP later,
bidirectional-v3-decisions.md:283). ATLAS availability stays **honest-empty** on non-JS/TS repos
(the existing posture, atlas-index.mjs:320). A non-JS/TS repo, or a parse-error-heavy file, yields a
typed `orientation_unavailable` / partial-labeled answer — never a fabricated or
completeness-claiming map.

Grounding: honest-empty (atlas-index.mjs:242/:320, cartographer-quartermaster.mjs:556); parse-error
accounting (atlas-index.mjs:387 `parseErrors`, scip.export `analysisStatus:'partial'` :389);
language ceiling JS/TS family only, maximumRung R2 (atlas-index.mjs:261).

**Red-team targets:**
- **Availability lie (partial-as-complete).** A partial index (some files parsed, some errored)
  served as a complete map. → The map carries parse-error accounting and labels itself partial when
  errors exist (the scip.export `analysisStatus:'partial'` precedent :389); never present a
  parse-error gap as complete coverage. parseErrors are surfaced, not hidden.
- **Cross-language claim.** The map must not claim ownership/invariants for languages ATLAS does not
  index (JS/TS family only, :261). A Python/Rust module in a polyglot repo gets honest-empty, not a
  guessed purpose. The honest-empty answer is a first-class tier result (it carries provenance and
  is citable), not an error.

---

## Non-goals

- **NOT replacing the gate's private instrument.** The ATLAS CPG/structural/behavior-fingerprint
  machinery (`atlas-cpg*.mjs`, `atlas-structural*.mjs`, `atlas-representation-*.mjs`) stays the
  trust gate's verification evidence (GT-4). Orientation surfaces the **SAFE projection** —
  `repo.map`/`code.seed`-derived structure, module rollups, and curated overlay — NOT the CPG, the
  IR, the taint analysis, or the semantic merge. Surfacing the gate's internals would hand workers
  verification authority they must not hold.
- **NOT semantic retrieval or true vulnerability reachability.** ATLAS states this as a limitation
  (atlas-index.mjs:263 — "no semantic retrieval", "no CPG/IR/semantic merge"). That is a different
  frontier; orientation is structural disclosure, not semantic analysis.
- **NOT worker-authored curated overlay auto-served.** In v1 the overlay is orchestrator-admitted
  through the candidacy gate (O-4); a worker cannot author a "purpose" and have it served as truth.
  Worker-authored overlay candidacy is v1.1.
- **NOT the REPL manifest/binding/cite substrate.** The REPL layer is ~30% realized (#69);
  orientation rides **BD3-B context-packs**, not REPL cells. The context-program's embedded-only
  admission (context-program.mjs:683-704) is out of scope.
- **NOT a re-index cadence or staleness-TTL.** Freshness is content-addressed + treeSha-pinned +
  reverify-on-divergence (O-3), NEVER a timer — per the control law, a clock is the wrong class for
  freshness. There is no "re-index every N minutes."
- **NOT surfacing reuse.vet / provenance.sbom / provenance.plan / provenance.advisories.** Those are
  the supply-chain dependency dossier / SBOM / advisory machinery (cartographer-quartermaster.mjs
  :573-714) — a separate feature that shares the file, not this epic.
- **NOT cross-language orientation beyond the JS/TS family.** honest-empty in v1 (O-8); polyglot
  expansion is a later rung gated on ATLAS language support.

---

## Red-first acceptance

A worker emits a BD3-A `code` query (`code.orient.map`) scoped to its pathScope and receives:
- a **bounded** (≤2KiB) context-pack, freshness-pinned with BOTH `overlay_digest` (content) AND
  `treeSha` (git);
- each leaf labeled `source:'generated'` or `source:'curated'`;
- a read outside its scope refuses with the **typed viewer-scope code** before any existence check;
- a stale base index refuses with **`orientation_base_stale`** (never served stale-as-fresh);
- the read mints a **`context.read`** event with **ZERO promotion weight** (assert: it is NOT a
  `scratch.read` event, and `minScratchReaders` does not count it — verified against the class, not
  the seed's pre-fold wording);
- reads do NOT count as TG2 progress (the farm-guard stays).

A worker pulls `code.orient.region(<module>)`:
- invariants mined from comments arrive **wrapProse-framed (UNTRUSTED)**; an unframed leaf is
  rejected at the seam;
- a region exceeding 4KiB returns `needs_resume` + a **verifiable cursor**; the cursor carries the
  artifact digest AND the freshness handle;
- **resuming after a tree move refuses** (`effective_tree_changed` / `orientation_base_stale`), never
  serves the cached lines;
- a region/detail answer carries `mergeAuthority:false, verificationAuthority:false`.

An orchestrator spawns a worker whose brief cites the L0 map pack by digest:
- the worker receives the **materialized, framed** map; the pack is CITED, never spliced into the
  objective string;
- a spawn-time stale/expired citation fails with **`context_pack_stale` / `context_pack_expired`**;
- two workers in the same region **share one pack artifact** (digest-deduped);
- the L0 map is scoped to the worker's pathScope (server-derived), never caller-named.

A worker rates an orientation:
- `'useful'`/`'missed'` targets **only the pack digest** (no free text);
- a second rating from the same worker on the same pack is **deduped**;
- a flood of `'missed'` from one worker **does not veto** the pack (advisory candidacy, never a
  serving gate).

Availability honesty:
- a non-JS/TS repo yields **`orientation_unavailable`** (honest empty, citable, provenance-carrying),
  never a fabricated map;
- a parse-error-heavy file labels the answer **partial** with the parse-error count, never
  completeness-claiming;
- a polyglot repo's non-indexed language yields honest-empty per module, never a guessed purpose.

Compounding:
- a novel structural fact surfaced by orientation enters the **candidacy gate**
  (promotionActor orchestrator/operator); a worker **cannot self-promote** its own structural claim
  (the self-read hole at coordination-store.mjs:14374 stays closed because the evidence class is
  `context.read`, zero weight).

---

## Open questions for the red team

1. **(O-3) Is the `treeSha`+`overlay_digest` pair sufficient freshness, or does the base-index
   epoch need an independent git anchor?** The base `index_epoch` is a content hash of derived
   symbols PLUS source inputs (atlas-index.mjs:169-170); confirm the deployment `treeSha`
   (application-deployment.mjs:1682) is the authoritative base anchor and that epoch-projection
   re-check (:306-307) closes the stale-base hole. The representation-review gate's
   `head !== treeSha` (atlas-representation-review.mjs:30) is the precedent — is it directly
   reusable, or does orientation need a worktree-relative treeSha?
2. **(O-4) Curated-overlay invalidation under structural change.** When a structural node an overlay
   Finding annotates is renamed/deleted, is a dangling `DerivedFrom`/annotates edge the right
   refusal (`overlay_dangling`), or does this need a dedicated structural-citation edge kind with
   its own resolution semantics? The red team should attack the "overlay silently dropped" and
   "overlay served against the wrong module" failure modes specifically.
3. **(O-1/O-4) What is a "module"?** The grouping unit for the rollup — directory, package.json
   workspace, ATLAS file-cluster, or path-glob? — determines the map's shape, the region's scope, and
   the curated-overlay's citation target. This is the load-bearing definitional question.
4. **(O-6) L0 spawn map: region-scoped (pathScope) or repo-global?** Cost vs the archaeology it
   kills. The seed leans pathScope (orientation-scoping.md:113-115); the red team should attack the
   "misorients at spawn" failure (O-6 red-team) and the pathScope-derivation boundary.
5. **(O-7) Tool-quality candidacy read path.** Do ratings affect which maps are pre-computed/cached
   (advisory), or do they surface as a quality score to the orchestrator (gating)? The seed's "the
   layer learns which maps/regions matter" (orientation-scoping.md:94-96) is advisory-leaning;
   confirm ratings never gate serving.
6. **(O-2) The `context.read` class itself is BD3-A's deliverable, not this epic's.** Confirm the
   dependency ordering: orientation cannot mint `context.read` events until BD3-A lands the class.
   Is there an interim (e.g. a no-op evidence stub) for testing orientation in isolation, or does the
   rung sequence strictly require BD3-A first?

---

## Out of v1

- **Worker-authored curated overlay auto-served** (candidacy gate; orchestrator-admitted only in v1;
  worker-authored overlay candidacy is v1.1 — mirrors BD3-B's "worker-authored context packs v1.1",
  bidirectional-v3-decisions.md:280).
- **MCP surface for the orientation ladder** (follows the packaging epic / reflex table; the lane
  lands embedded-first, bidirectional-v3-decisions.md:283).
- **Semantic retrieval / CPG-backed region detail** (ATLAS limitation :263; a later rung gated on
  ATLAS semantic machinery — and gated on NOT handing workers verification authority).
- **Cross-language orientation beyond the JS/TS family** (honest-empty in v1; polyglot expansion
  gated on ATLAS language-ceiling growth).
- **The context-program (REPL cells) as the orientation substrate** (orientation rides BD3-B
  context-packs; REPL manifest/binding/cite is #69, separate).
- **Auto-promotion of structural facts.** Orientation answers are candidacy-only in v1; even
  high-confidence structural facts require the orchestrator/operator admission gate (:349), never
  worker-self-promotion.
- **A re-index daemon / staleness-TTL.** Explicitly out — freshness is content+treeSha+reverify,
  never a timer (control law).
