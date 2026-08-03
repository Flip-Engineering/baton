# Epic #81 — the orientation ladder — epic contract (v1.0, 2026-08-03)

> **Fold (v1.0, 2026-08-03):** post-red-team fold of `orientation-redteam.md` (same directory) —
> ledger 3 CONFIRMED-HOLE (O-2, O-4, O-5), 5 NEEDS-AMENDMENT (O-1, O-3, O-6, O-7, O-8), 0 DEFENDED.
> All eight amendment blocks are folded in place (CONFIRMED-HOLE decisions rewritten,
> NEEDS-AMENDMENT amendments applied verbatim), plus the campaign-law amendment: no clock anywhere —
> `context_pack_expired` is removed from this epic.

(Seed: `docs/reference/evidence/orientation-2026-08-03/orientation-scoping.md` — the operator's
evaluation + scoping note ("have you evaluated the advanced syntax, troubleshooting, testing,
and code-investigation/exploration/understanding features for context engineering and tooling
improvements and intuitive, reflectively-bidirectional integration?"). This contract follows the
BD3 spine: seed → code-verified ground truth → question → numbered decisions with red-team
targets → non-goals → red-first acceptance. Seat: **glm** (Lane B). Status: **v1.0** (post-red-team fold) — seed + code-verified
ground truth (with fold additions), the question, eight numbered decisions amended per the red-team
ledger with updated targets, non-goals, red-first acceptance re-pinned to the amended semantics,
resolved open questions, out-of-v1.)

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
receive — seed O-4 → this contract's O-7 bidirectional feedback). No turn-limit, no clock, no
freshness-by-timer. The freshness control is content-addressed + re-verifiable, never a
staleness-TTL. **Law amendment (v1.0 fold, red-team campaign-law audit):** orientation MUST NOT
read `now`, compare validity timestamps, use TTLs, count turns, or limit service by elapsed time.
`context_pack_expired` is NOT imported from BD3-B's wall-clock validity window — packs stop serving
only through causal invalidation: supersession/head mismatch (`context_pack_stale`), explicit
operator retirement, attempt closure, scope change, tree/overlay divergence, or deterministic
reachability retirement under a declared storage ceiling. "Recent" never denotes a time window; it
is an explicit predecessor/current tree pair. All ceilings are byte/item/event-count ceilings
checked BEFORE work or append.

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
- **(fold v1.0 — red-team confirmed):** `resume` (:769-778) validates budget, cursor syntax, ref
  digest/handle, artifact existence/integrity, op, and offset ONLY — it accepts no viewer, task,
  run, or scope coordinate (bearer-only), and it copies the stored `document.provenance` into the
  response (:778) with no freshness recomputation. `_result` refs (:497) also expose the local
  filesystem `path`. All three facts are O-5/O-3 holes, closed in those decisions.

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
- **(fold v1.0 — red-team confirmed the gate shape is NOT compatible even in principle):**
  `_deriveKnowledgePromotion` derives candidates only from task creation, selected driver events,
  policy failure events, and `scratch.read` over Scratch facts (coordination-store.mjs:14337-14383 —
  no generic evidence-class hook); workflow admission accepts only `board.item_closed` /
  `package.admitted` Findings (:14781); the candidacy trigger vocabulary is the closed set
  `KNOWLEDGE_CANDIDATE_TRIGGERS` (:15628-15635). So "the SAME gate a note does" was false for
  orientation: a zero-weight `context.read` would never compound at all. O-2/O-4 add the explicit
  `orientation.leaf_proposed` / `orientation.overlay_proposed` triggers. Separately, `maxScanEvents`
  only refuses the promotion SCAN past ceiling (:14339) — it neither stops nor coalesces event
  writes, so v1's flood defense was false; O-2 replaces it with per-attempt constructive ceilings.

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

- **`code.orient.map({ moduleKey? })`** — the structural index: modules (rolled up from `repo.map`'s
  flat per-file view) with one-line purposes, entry points, hot paths, and surface ownership
  (suite/test pairing). **Bounded ≤ 2KiB.** This is NOT a verbatim surface of `repo.map`
  (atlas-index.mjs:369 — flat `{path, language, lines, symbols, references, imports, calls,
  parseErrors}`, no purposes/entry-points/ownership); O-1 adds the module-rollup + curated overlay
  (O-4) and bounds it. The bound is the constructive control: a worker cannot get an unbounded map.
- **`code.orient.region({ moduleKey })`** — one module's surface: exported contracts,
  invariants (from its own comments/tests), its test suites, its change classes between two
  explicitly cited trees (ATLAS-structural, the gate's classification machinery exposed as a SAFE
  projection). **Bounded ≤ 4KiB.** Generalizes orientation.slice's two shapes (`brief`/`map`,
  cartographer-quartermaster.mjs:516) to a region tier.
- **`code.orient.detail({ citation | range })`** — the exact lines with a content-addressed citation
  (context-pack digest; repl.cite-compatible). Carries `mergeAuthority:false,
  verificationAuthority:false` (the existing provenance flag, cartographer-quartermaster.mjs:501) —
  detail is **evidence, never clearance**.

Every tier rides BD3-A's new `code` query kind (worker pull) and/or BD3-B's spawn-pack citation
(orchestrator push). Every answer is a context-pack, not prompt text.

**Fold (v1.0 — red-team NEEDS-AMENDMENT, applied verbatim): canonical structural coordinates and
closed leaves.** A `moduleKey` is hub-derived as `{repoId, rootPath}` where `rootPath` is the
deepest supported package/workspace root containing the file, or the file's first path segment (root
files use `.`) when no supported manifest exists. The map records `moduleDigest = sha256(sorted
member {path, contentDigest})`. Callers may request a module key or a descendant citation, but may
not name `scope`; the hub derives `{runId, taskId, taskVersion, workerId, pathScope, scopeDigest}`
from the admitted attempt and applies scope refusal before module/path existence lookup. `detail`
MUST descend from a live map/region citation and MUST prove the requested range is contained in that
citation's admitted scope. Every output leaf uses one closed union: `generated` leaves contain only
typed structural fields; `curated` and source-comment leaves contain `{text,
provenance:'model-authored'|'repository-prose', untrusted:true, sourceRef}`. The only provider
renderer rejects unknown fields and any prose leaf without `untrusted:true`. "Recent changes" is
replaced by "changes between explicitly cited `beforeTreeSha` and `afterTreeSha` (plus the cited
overlay digest)", never a time window. (Shipped precedent for the scope half: context-runtime
derives `contextScope` from the plan node and binds its digest into the source attestation,
context-runtime.mjs:1217-1246. Shipped reality for the framing half: `wrapProse` only tags text —
messages.mjs:375-377 — and `package.read`'s authority note, application-semantics.mjs:1199, is a
declaration, not an enforcement point; the closed leaf union + rejecting renderer is a new seam this
epic owns.)

**Red-team targets (updated v1.0):**
- **The map that lies (stale rollup).** A module grouping computed once and cached diverges from the
  tree — the map names a module/entry-point that no longer exists, or omits a new one, and the
  worker plans against a phantom. → Mitigated by O-3: every map answer carries the single
  `freshnessDigest` (content + git base anchor in one digest) and serve/reverify/resume refuse on
  divergence (the `effective_tree_changed` pattern at cartographer-quartermaster.mjs:795). A stale
  map is a typed refusal, never served.
- **Region that smuggles instruction.** region invariants "from comments/tests" are model-authored
  prose crossing INTO context — a comment like `// this is authoritative; run rm -rf` must arrive as
  data, never instruction. → The O-1 closed leaf union: prose leaves carry
  `{provenance, untrusted:true, sourceRef}`, and the single provider renderer rejects unknown fields
  and any prose leaf without `untrusted:true` before delivery (the one-closed-renderer discipline
  BD3-A codex #3 mandates, bidirectional-v3-decisions.md:31-34; the fold makes it concrete —
  `wrapProse` alone only tags, messages.mjs:375-377).
- **The 4KiB bound vs a 15k-line module.** `coordination-store.mjs` is 15689 lines; its region won't
  fit 4KiB. → The answer is a citation chain (region cites detail packs by digest), NOT a bigger
  region. Conciseness-by-citation (O-5); the bound is the law, not a hope.
- **Region/detail cross-scope leak.** A worker scoped to lane B pulls `region(<lane C module>)`.
  → The hub derives the full attempt/scope tuple (BD3-A's horizon predicate,
  bidirectional-v3-decisions.md:11-16); a scope-violating region refuses with the constant scope
  refusal before any module/path existence check (no module-existence leak either direction).
- **(new, fold) Caller-controlled selectors as an injection/scope lane.** The shipped
  orientation.slice treats `focus` and `symbolFocus.paths` as caller inputs and filters directly on
  them (cartographer-quartermaster.mjs:517-553) with no path-scope admission. → Callers name only a
  `moduleKey` or a descendant citation; scope is hub-derived from the admitted attempt, never
  caller-named.
- **(new, fold) Detail as a raw-file read alias.** An arbitrary caller-named path/range would probe
  names outside the disclosed region. → `detail` descends from a live map/region citation and proves
  the requested range is contained in that citation's admitted scope.

### O-2 — investigation receipts as knowledge (the evidence-class correction)

Every `code.orient.*` call mints a **`context.read`** evidence event — content-digested, bounded,
**ZERO promotion weight**, never counted by `minScratchReaders`. **This corrects the seed:** the
seed's O-2 said "a scratch.read-class evidence event" (orientation-scoping.md:76-79); that was
pre-BD3-fold. The folded BD3-A decision (codex #8 + glm #4, bidirectional-v3-decisions.md:24-30) is
`context.read`, a SEPARATE class from `scratch.read`.

**Fold (v1.0 — red-team CONFIRMED-HOLE, decision rewritten): receipts do not auto-author facts.**
v1's next sentence — "high-value answers become candidacy candidates through the SAME promotion gate
a note uses" — was a confirmed hole: the shipped gate has no derivation path for the class
(`_deriveKnowledgePromotion` recognizes task creation, selected driver events, policy failures, and
`scratch.read` over Scratch facts only, coordination-store.mjs:14337-14383), workflow admission
rejects candidate triggers outside {`board.item_closed`, `package.admitted`} (:14781), and "high
value" had no authority owner (a worker-set flag launders prose into candidacy; hub inference from
free prose is nondeterministic). The folded rules:

- A successful orientation materialization appends **at most one `context.read`** per `{repoId,
  runId, taskId, taskVersion, workerId, op, normalizedQueryDigest, packDigest, freshnessDigest}`.
  Every identity and scope field is hub-derived. The idempotency key is hub-derived from that tuple;
  exact replay returns the prior event, and same-key/different-content refuses
  `context_read_conflict` (the shipped `readKnowledge` pattern: request digest over query+reader,
  conflict on mismatch — coordination-store.mjs:15454-15468).
- `context.read` has zero promotion weight, never satisfies any reader threshold, and never counts
  as progress.
- Compounding is a SEPARATE conversational action, `orientation.candidate.propose({packDigest,
  leafDigest})`. The hub resolves the cited immutable leaf, verifies that the proposing attempt
  previously received it, and mints an observed candidate with trigger `orientation.leaf_proposed`;
  callers cannot supply body, grounding, task identity, scope, or evidence. The promotion/admission
  trigger vocabulary (the closed set at coordination-store.mjs:15628-15635; the workflow-admission
  gate at :14781) is amended to admit that trigger ONLY through the orchestrator/operator gate.
  Duplicate proposals coalesce by `{leafDigest, freshnessDigest}`.
- **Flood control is constructive — the v1 defense was false.** `maxScanEvents` only refuses the
  promotion scan past ceiling (:14339); it does not stop or coalesce read events — past it, writes
  continue while promotion wedges. The folded bound is per-attempt receipt/proposal count and byte
  ceilings, refusing BEFORE append, plus the one-receipt-per-tuple coalescing above.

Grounding: `scratch.read` exists and accrues weight (coordination-store.mjs:8257/:13156/:14375);
`context.read` does not exist yet (GT-5). candidacy = the knowledge-promotion gate
(coordination-store.mjs:14337+, promotionActor orchestrator/operator only at :349).

**Red-team targets (updated v1.0):**
- **Evidence farming (the glm #4 / codex #8 hole, restated for code).** If orientation reads used
  `scratch.read`, a worker could read its own structural "fact" and self-promote at
  `minScratchReaders===1` (the self-read hole, coordination-store.mjs:14374 — `byTask` keyed only on
  `read.payload.taskId`, no author-task exclusion). → Pinning to `context.read` (zero weight) closes
  this by construction: there is no weight to farm. A worker reading a map accrues nothing toward
  promotion.
- **Structural-fact laundering.** A worker authors a Finding claiming a structural fact, then reads
  its own orientation map to "corroborate" it and count as a second reader. → `context.read` never
  counts as a reader by class, and candidacy enters only via `orientation.candidate.propose`, whose
  candidate is hub-minted observed (callers supply only `{packDigest, leafDigest}`) and whose
  admission is orchestrator/operator-only (:349) — a worker cannot self-admit a structural Finding
  or corroborate its own.
- **KG/event flooding.** Every map call mints evidence; a 64-member wave each pulling a map could
  flood the event store. → Per-attempt receipt/proposal count + byte ceilings checked BEFORE append,
  and at most one `context.read` per hub-derived identity tuple. NOT `maxScanEvents` (confirmed by
  the red team: a scan ceiling, not a write bound, coordination-store.mjs:14339).
- **(new, fold) Replay identity.** v1 specified neither the server-derived reader tuple nor an
  idempotency key for `context.read`. → Both are hub-derived; exact replay returns the prior event;
  same-key/different-content refuses `context_read_conflict` (pattern: `readKnowledge`,
  coordination-store.mjs:15454-15468).

### O-3 — freshness: one effective-source authority (content + git base, never stale-as-fresh)

Every orientation answer carries a freshness handle over BOTH content and git base. **The index
must never serve stale structure as fresh; freshness is content + tree, never a TTL.**

**Fold (v1.0 — red-team NEEDS-AMENDMENT, applied verbatim).** v1's pair (`overlay_digest` content +
deployment `treeSha` carried as separate fields) was the right non-clock direction but not a
complete effective-worktree identity: the base epoch's load-time self-check proves "this artifact
matches itself" (atlas-index.mjs:294-310), not "this is the deployment base named by `treeSha`",
and `treeSha` does not name dirty overlay bytes (the overlay scans a mutable worktree, :172-186).
The folded rules:

- Index build MUST read the base from the deployment's **immutable git object tree**, not a mutable
  directory (the shipped Repository-Context authority: source read from the git tree under
  server-derived scopes, context-runtime.mjs:390-419; 40-hex tree authority, :487-496), and persist
  `{repoId, baseTreeSha, indexEpoch, baseInputsDigest}` as ONE attested record.
- Every answer and page carries **`freshnessDigest = sha256({repoId, baseTreeSha, indexEpoch,
  overlayDigest, scopeDigest})`**.
- Worktree overlay production is **fenced**: the hub captures the admitted attempt/worktree fence
  before scan and compares it again before publishing; divergence refuses `effective_tree_changed`
  and publishes no pack.
- **Serve, reverify, and resume ALL** re-derive the current attempt/scope, require the same base
  authority, and compare the complete freshness digest. Base mismatch refuses
  `orientation_base_stale`; overlay/fence mismatch refuses `effective_tree_changed`. (Generic resume
  today does no freshness work — it serves stored bytes and stored provenance,
  atlas-index.mjs:406-426 / cartographer-quartermaster.mjs:769-778; O-5 routes resume through this
  gate.)
- No timestamp, TTL, or re-index cadence participates (control law, as amended).

Grounding: ATLAS uses `index_epoch`+`overlay_digest`+`staleness` (atlas-index.mjs:343), overlay
recomputed per query (:172-186, limitation :263). The gate uses git `treeSha`
(atlas-representation-review.mjs:30); the deployment carries `treeSha` (application-deployment.mjs
:1682). reuse.vet reverify already does `effective_tree_changed` (:795).

**Red-team targets (updated v1.0):**
- **Stale-BASE index served as fresh.** The ATLAS base `index_epoch` is built from `ctx.baseRoot`
  (atlas-index.mjs `index.build` at :334-340); if `baseRoot`'s tree moves under a cached base index, the
  epoch is stale but the worktree-only overlay (:172-186) will NOT catch a base/HEAD divergence. →
  The base is built FROM the deployment's immutable git object tree and persisted as one attested
  `{repoId, baseTreeSha, indexEpoch, baseInputsDigest}` record; serve/reverify/resume compare the
  full `freshnessDigest` (the epoch-projection self-check at :306-307 is retained as integrity, but
  is no longer the only base anchor). Base mismatch refuses `orientation_base_stale` (re-index
  required) — never serve the stale structure. This remains the single most important freshness seam.
- **Overlay-digest without treeSha.** Two divergent trees could (vanishingly) share an
  `overlay_digest` projection. → Dissolved by construction: there is ONE `freshnessDigest` over
  `{repoId, baseTreeSha, indexEpoch, overlayDigest, scopeDigest}` — no separate content handle to
  mismatch. Either the whole digest matches current authority or the answer refuses.
- **Reverify weaponized as a stall.** `reverify` recomputes the overlay per query (:263); a worker
  hammering reverify could stall. → Bounded by `budgetTokens` + the constructive tier bounds;
  reverify rides the orchestrator-gated `reverifyCapability` path (coordinator.mjs:9670), not a free
  worker loop.
- **(new, fold) Resume bypasses freshness.** Generic resume serves stored bytes and stored
  provenance with no recomputation (atlas-index.mjs:406-426; cartographer-quartermaster.mjs:778). →
  Resume is a serve path: it re-derives attempt/scope and compares the full `freshnessDigest` before
  resolving a page (O-5).

### O-4 — the map authorship: generated-with-curation-overlay (materialized structural subjects)

Honest answer (seed, orientation-scoping.md:109-111): **generated-with-curation-overlay.** The
generated map is ATLAS's module rollup (rolled up from `repo.map`, atlas-index.mjs:369). The curated
overlay — one-line purposes, ownership, "why this module exists" — lives in the **KG as authored
Findings**, admitted through the candidacy gate. The map mints by merging generated structure +
curated overlay, both freshness-pinned (O-3) and each leaf labeled by source.

**Fold (v1.0 — red-team CONFIRMED-HOLE, decision rewritten).** v1's attachment mechanism was
impossible as written: `annotates` is not a KG edge type and every edge endpoint must be an existing
KG node (coordination-store.mjs:137, :14319-14320), while ATLAS `repo.map` returns plain file
records, not KG node IDs (atlas-index.mjs:369); and the settle-time admission gate admits only
`board.item_closed` / `package.admitted` Findings (:14781), so "admitted exactly like any Finding"
excluded orientation candidates. The folded design:

- The orientation producer mints a hub-derived KG **`Source`** node for each `{repoId, moduleKey,
  moduleDigest, freshnessDigest}` before any overlay candidate (`Source` is already a closed KG node
  type, coordination-store.mjs:136).
- An overlay candidate is an observed `Finding` with trigger **`orientation.overlay_proposed`** and
  a **`Cites`** edge to that `Source` (`Cites` is in the closed edge vocabulary, :137). Callers may
  cite an existing leaf but may not name the Source node or author evidence coordinates. The
  workflow admission gate explicitly recognizes this trigger under the existing
  orchestrator/operator authority and idempotency/lease checks.
- At merge, a curated leaf applies only when its cited `moduleDigest` and freshness coordinates
  EXACTLY match. A stale leaf is omitted with structured `overlayOmissions:[{findingId,
  reason:'overlay_dangling'}]`; generated structure still serves and the overall status is
  `partial`. (This resolves v1's contradictory "refuses (overlay dropped)" — it is neither
  whole-answer refusal nor silent omission.)
- Multiple live curated leaves for one field require an explicit live **`Supersedes`** winner;
  otherwise omit all conflicting curated values with `overlay_conflict`. Never select by event time
  or insertion order (the KG already treats contradictions/supersession as explicit versioned edges,
  coordination-store.mjs:14322-14333).

Grounding: `repo.map` (:369) = generated, flat, no purposes. No curated-orientation doc exists today
(grep found none). KG Findings = authored knowledge (promotion gate, coordination-store.mjs:14337+).
The seed's exact framing: "generated (ATLAS) vs curated (a hand-maintained orientation doc)? The
honest answer is generated-with-curation-overlay, and the overlay lives in the KG as authored
Findings" (orientation-scoping.md:108-111).

**Red-team targets (updated v1.0):**
- **Curated-overlay-vs-tree drift.** An authored Finding says "module X's purpose is Y" but module X
  was renamed/deleted. → A curated leaf applies only on exact `moduleDigest` + freshness-coordinate
  match; a stale leaf is omitted WITH structured trace (`overlayOmissions`, reason
  `overlay_dangling`) and the answer serves `partial` — never silently served against the wrong
  module, never silently dropped, and one stale annotation never denies the whole map.
- **Authorship authority.** Who writes the overlay? → Worker-authored overlay Findings go through
  the candidacy gate (promotionActor orchestrator/operator, :349); the `orientation.overlay_proposed`
  trigger is admitted under that same authority. A worker cannot self-author a "purpose" and have it
  served as curated truth.
- **Generated-as-curated confusion.** The answer must label each leaf `source:'generated'` (ATLAS)
  or `source:'curated'` (KG Finding) — never present a generated heuristic as an authored invariant.
  This is the code.seed-score discipline already in force (cartographer-quartermaster.mjs:564-566
  refuses to turn an import-count prior into evidence that a capability exists), now carried by the
  O-1 closed leaf union.
- **(new, fold) Overlay conflict.** Two admitted curated Findings can assert different purposes for
  the same module/digest. → A live `Supersedes` winner is required; otherwise all conflicting
  curated values are omitted with `overlay_conflict`. Deterministic — never array order or event
  time.

### O-5 — citation, continuation, and grant are distinct (big answers are chains, not blobs)

Big answers are citation chains, not bigger blobs.

**Fold (v1.0 — red-team CONFIRMED-HOLE, decision rewritten).** v1 conflated two objects — a cursor
is continuation state, while the immutable pack/ref digest is the citation — and called digest
validation a sufficient forgery defense. But integrity was checked while authorization was not:
cartographer resume validates budget, cursor syntax, ref digest/handle, artifact
existence/integrity, op, and offset, and accepts NO viewer, task, run, or scope coordinate
(cartographer-quartermaster.mjs:769-778), so a valid cursor copied across workers bypassed the scope
decision. The folded rules:

- **The pack digest is the citation.** A cursor is an opaque continuation over `{packDigest,
  pageOffset, freshnessDigest, scopeDigest}` and conveys no authority.
- **Every resume re-authorizes.** The hub re-derives the active attempt and viewer scope, proves the
  cited pack was admitted to that attempt (or is a live head visible to it), checks the O-3
  freshness digest, then resolves the page. Scope refusal precedes artifact existence lookup — a
  copied cursor fails with the constant scope refusal.
- **Transport strips host paths.** Worker-visible refs contain only `{kind, handle, digest, bytes,
  mediaType}`; absolute/local `path` is internal-only. (Today both planes return it:
  atlas-index.mjs:320 initial / :421 resumed; cartographer-quartermaster.mjs:497.)
- **Retention is constructive, never a clock.** Orientation storage has deployment byte/count
  ceilings. Admission reclaims only unreferenced intermediate artifacts by deterministic
  reachability; live pack heads, active brief citations, event evidence, and KG citations are roots.
  If capacity remains exhausted, refuse BEFORE write with `orientation_storage_exhausted`. If an
  otherwise valid unrooted page was reclaimed, return `orientation_artifact_retired` — never an
  empty or newly generated page under the old cursor. No age/TTL controls reclamation (control law).
- **What v1 already had, maintained:** budget-bounded deterministic pages (`budgetTokens * 4`;
  ATLAS `atlas:<digest>:<offset>`, atlas-index.mjs:406-426; cartographer
  `orientation:<digest>:<offset>`, cartographer-quartermaster.mjs:769-779), digest-verified artifact
  loads (atlas-index.mjs:414; cartographer-quartermaster.mjs:479), cursor minted only when
  `resumable && truncated` (:493-498), and `needs_resume` honesty — a truncated resume says so, it
  never drops the tail silently.

**Red-team targets (updated v1.0):**
- **Cursor forgery / copied-cursor scope leak.** Two distinct attacks, both closed: a FORGED digest
  fails integrity (ref/handle/digest match, cartographer-quartermaster.mjs:771-772, plus re-read
  verification at :479); a COPIED valid cursor fails authorization — resume re-derives the
  attempt/scope and refuses with the constant scope refusal BEFORE artifact existence lookup. The
  cursor conveys no authority.
- **Cursor-stale-as-fresh (lifecycle glm #2 analog).** A cursor minted against treeSha T1, resumed
  after the tree moved to T2, must NOT serve T1's lines as T2's. → Resume is a serve path under O-3:
  it compares the full `freshnessDigest` and refuses `effective_tree_changed` /
  `orientation_base_stale` if the tree moved, rather than serving the cached slice. (v1 relied on
  stored provenance — resume copies `document.provenance` verbatim, :778.)
- **Unbounded resume fan-out.** A 64-member wave each resuming a 100k-result map. → Bounded by
  `budgetTokens` per resume + the constructive tier bounds (map ≤2KiB fits without resume; region/
  detail resume but each resume is budget-bounded). No silent cap: if a resume truncates, it says so
  (`needs_resume`), it does not drop the tail silently.
- **(new, fold) Local path disclosure.** Both planes return absolute artifact paths in
  worker-visible refs (atlas-index.mjs:320/:421; cartographer-quartermaster.mjs:497) — host
  filesystem topology leaks to workers. → The transport projection carries only `{kind, handle,
  digest, bytes, mediaType}`; paths are internal-only.
- **(new, fold) No retention contract.** CAS writes are create-if-absent + integrity check
  (atlas-index.mjs:277-283; cartographer-quartermaster.mjs:442-457) with no quota, roots, or
  reclamation, while resume dies `unknown_cursor` if the bytes vanish (atlas-index.mjs:412). →
  Constructive byte/count ceilings, deterministic reachability roots, `orientation_storage_exhausted`
  before write, `orientation_artifact_retired` after lawful reclamation. No age-based control.

### O-6 — spawn-time L0 + mid-turn pull (push the map, pull the region/detail)

Decision (seed's lean, orientation-scoping.md:113-115): **L0 (the map, scoped to the worker's
pathScope) is injected into EVERY brief at spawn** as a context-pack (BD3-B's spawn CAS — a stale
spawn-time citation fails loudly with `context_pack_stale`, bidirectional-v3-decisions.md:44-47).
**L1 (region) / L2 (detail) are worker-PULLED mid-turn** via the BD3-A `code` query kind. Push the
cheap thing that kills the first hour of archaeology; pull the specific thing the task needs.

**Fold (v1.0 — red-team NEEDS-AMENDMENT, applied verbatim): recoverable prepare/admit/dispatch, no
clock.**

- Spawn uses a hub-derived idempotency key over `{runId, taskId, taskVersion, workerId, scopeDigest,
  freshnessDigest}` (the shipped attempt-binding precedent: a context-runtime session is reused only
  when run, tree, policy, definition, goal, plan, node, task ID, and task VERSION all match,
  context-runtime.mjs:1199-1214; scope derives from the node, :1217).
- Ordering: FIRST write the deterministic L0 artifact; SECOND atomically append the pack grant and
  task/spawn binding (or exact-replay that binding); ONLY THEN dispatch the provider. A crash before
  append leaves an unreferenced reclaimable artifact (O-5 roots); a crash after append resumes the
  same task and citation. Same-key/different-scope or freshness refuses.
- Content may deduplicate globally (two workers in one region share pack bytes), but grants and
  `context.read` receipts remain attempt-scoped — authority never collapses across attempts, and a
  retried spawn never mints a second grant.
- **Orientation packs have NO wall-clock validity.** They stop serving only through
  eval-able/constructive causal facts: non-head supersession (`context_pack_stale`), tree/overlay
  divergence, scope/attempt closure, explicit operator retirement, or storage retirement allowed by
  O-5. **`context_pack_expired` is removed from this epic** — BD3-B's timestamp validity window
  (bidirectional-v3-decisions.md:48-49) is a clock and is not imported (control law, as amended).

Grounding: orientWorker PUSH today (coordinator.mjs:6582-6600, fence-gated, `baton.orientation.slice`
note). BD3-B spawn CAS (bidirectional-v3-decisions.md:44-47). BD3-A worker pull (the `code` query
kind does not exist yet — GT-3).

**Red-team targets (updated v1.0):**
- **Spawn-time map as prompt-text regression.** If the L0 pack is spliced into the objective string,
  we have rebuilt the exact anti-pattern BD3-B exists to kill (context-as-prompt-text,
  bidirectional-v3-decisions.md:186-188). → The spawn pack is CITED by digest
  (`context-pack:<sha>`), materialized by the hub under the O-1 closed leaf union, NEVER spliced.
  Verified by the `context_pack_stale` head-CAS at spawn (causal supersession — no expiry clock).
- **The map that misorients at spawn.** A wrong-region L0 map sends a worker down the wrong path for
  an hour. → The L0 map is scoped to the worker's hub-derived pathScope (the same server-derived
  scope as BD3-A's viewer-scope/horizon predicate, :11-16); a worker scoped to lane B must not
  receive lane C's map. Caller-named scope is refused.
- **L0-always cost.** Injecting a 2KiB map into every spawn. → It is bounded (2KiB), it is the
  cheapest thing that compounds (every worker starts oriented instead of re-deriving), and it is a
  context-pack (deduped by digest — two workers in the same region share one pack's bytes). Per the
  control law this is constructive (bounded) + eval-able (verifiable map), not a clock.
- **(new, fold) Publish/dispatch crash window.** v1 did not order artifact write, pack admission,
  spawn event, and provider dispatch — a crash could leave an orphan pack or a durable task whose
  cited pack was never admitted. → Artifact-write → atomic grant+spawn append → dispatch;
  crash-before is a reclaimable orphan (O-5), crash-after exact-replays the same task/citation.
- **(new, fold) Retry identity.** Two identical workers share content bytes but never authority; a
  retried spawn must not mint a second task/grant. → Hub-derived idempotency key over the attempt
  tuple; same-key/different-scope or freshness refuses.

### O-7 — bidirectional reflection on the tooling itself (agents rate orientations)

Workers rate the orientations they receive (seed O-4, orientation-scoping.md:91-96). The layer
learns which maps/regions matter → candidacy for tool-quality (which orientations get
pre-computed/cached), not just code-quality.

**Fold (v1.0 — red-team NEEDS-AMENDMENT, applied verbatim): one closed rating event.** v1's "a
one-bit scratchpad kind or link relation" was an unresolved protocol choice, and `(worker, pack)`
was not sufficient authority identity (worker IDs can describe a process, not a durable attempt; a
respawn could rate twice, or two task versions collide on a reused worker). The fold chooses a
dedicated **`orientation.rating_recorded`** event — not a new free-form scratchpad kind. Its closed
payload is hub-derived `{repoId, runId, taskId, taskVersion, workerId, packDigest,
grantOrReadEventSeq, rating:'useful'|'missed'}`. The caller supplies only `{packDigest, rating}`.
Admission first proves the attempt previously received/read the exact pack (`grantOrReadEventSeq`)
and returns one constant `orientation_rating_refused` for invisible, unknown, stale-task, and
out-of-scope targets. The idempotency identity is `{taskId, taskVersion, packDigest}`: exact replay
returns the prior event; an opposite second rating refuses `orientation_rating_conflict` and never
overwrites history. At most one rating per granted pack per task attempt may append. Aggregates are
advisory, content-digested, and may only prioritize work inside a fixed deployment precompute
count/byte budget; they never change scope, freshness, serving, verification, or promotion
authority.

Grounding: scratchpad closed kinds (SCRATCHPAD_WRITE four kinds, bidirectional-v3 ground-truth #1) —
the rating event follows that closed-schema discipline but is its own event kind, not a scratchpad
kind; KG reads already run the request-digest replay pattern this mirrors
(coordination-store.mjs:15454-15468).

**Red-team targets (updated v1.0):**
- **Rating farming / griefing.** A worker spams `'missed'` on every pack to manipulate tool-quality
  candidacy. → At most one rating per granted pack per task attempt; an opposite second rating
  refuses `orientation_rating_conflict`; aggregates are advisory inside a fixed precompute budget
  and never gate serving (a pack serves regardless of its rating).
- **Rating-as-covert-channel.** A `'useful'`/`'missed'` relation piggybacking a message to a peer.
  → The payload is closed and hub-derived; the caller supplies only `{packDigest, rating}`; the
  target is only a pack digest — no free text in v1.
- **Cold-start.** Tool-quality candidacy is empty until ratings accrue. → Ratings never gate
  serving; a new orientation serves at zero ratings.
- **(new, fold) Identity/replay ambiguity.** v1 did not say whether an opposite second rating
  conflicts, replaces, or is ignored. → Identity `{taskId, taskVersion, packDigest}`; exact replay
  returns the prior event; an opposite second rating refuses and never overwrites history.
- **(new, fold) Rating without receipt.** Naming a digest is not evidence the worker received the
  pack — differential errors would leak pack existence. → Admission proves a prior grant/read
  (`grantOrReadEventSeq`) and returns the constant `orientation_rating_refused` for every failure
  mode.

### O-8 — surfaces, honest-empty, and the ATLAS-availability posture

Embedded-first (orchestrator); worker pull via BD3-A's `code` query kind; **MCP per the reflex table
when the packaging epic lands** (BD3 lands embedded-first and joins MCP later,
bidirectional-v3-decisions.md:283). A non-JS/TS repo, or a parse-error-heavy file, yields a typed
`orientation_unavailable` / partial-labeled answer — never a fabricated or completeness-claiming map.

**Fold (v1.0 — red-team NEEDS-AMENDMENT, applied verbatim): answer-time coverage.** Availability is
derived for EVERY answer from the same scoped effective-source snapshot and freshness digest used to
build that answer; the deployment-time flag (computed once from `git ls-files`, index.mjs:84-88, and
passed frozen into both capabilities, :1301-1311) is advisory card metadata only — a repo that gains
its first supported file after startup must not wear an honest-empty label over non-empty results,
nor `available` over empty ones. Each tier returns `coverage:{totalFiles, supportedFiles,
unsupportedFiles, excludedFiles, parseErrorFiles, parseErrorCount}`. Status is
`orientation_unavailable` only when `supportedFiles===0`; it is `partial` when any in-scope file is
unsupported, excluded, unreadable, or parse-failed; otherwise it is `ok`. Every summary and pack
preserves the coverage object. No generated or curated leaf may claim completeness outside supported
files, and curated leaves for an unsupported-only module do not upgrade availability. (Today only
`scip.export` computes aggregate parse status — `analysisStatus:'partial'`, atlas-index.mjs:386-389;
the fold makes partial labeling a ladder invariant. The honest-empty detection itself is real and
tested: index.mjs:84-88, impl/test/atlas-orientation-red.test.mjs:186-203.)

Grounding: honest-empty (atlas-index.mjs:242/:320, cartographer-quartermaster.mjs:556); parse-error
accounting (atlas-index.mjs:387 `parseErrors`, scip.export `analysisStatus:'partial'` :389);
language ceiling JS/TS family only, maximumRung R2 (atlas-index.mjs:261).

**Red-team targets (updated v1.0):**
- **Availability lie (partial-as-complete).** A partial index (some files parsed, some errored)
  served as a complete map. → Every tier carries the `coverage` object and labels itself `partial`
  when any in-scope file is unsupported/excluded/unreadable/parse-failed (the scip.export
  `analysisStatus:'partial'` precedent :389, now a ladder invariant); the counts are surfaced, not
  hidden.
- **Cross-language claim.** The map must not claim ownership/invariants for languages ATLAS does not
  index (JS/TS family only, :261). → The coverage denominator (`supportedFiles` vs
  `unsupportedFiles`) makes a mixed module visibly partial; a module with zero supported files gets
  honest-empty — a first-class, citable tier result carrying provenance — never a guessed purpose.
- **(new, fold) Stale availability.** Deployment-time availability is frozen from a one-shot file
  listing (index.mjs:84-88, passed frozen at :1301-1311). → Availability derives per-answer from the
  answer's own scoped effective-source snapshot and freshness digest; the card flag is advisory
  metadata only.

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
- **NOT a re-index cadence, staleness-TTL, or wall-clock pack expiry.** Freshness is
  content-addressed + treeSha-pinned + reverify-on-divergence (O-3), NEVER a timer — per the control
  law (as amended by the v1.0 fold), a clock is the wrong class for freshness AND for validity.
  There is no "re-index every N minutes", and `context_pack_expired` is not imported from BD3-B:
  packs invalidate causally only (supersession/head mismatch `context_pack_stale`, tree/overlay
  divergence, attempt/scope closure, operator retirement, storage reclamation under O-5).
- **NOT surfacing reuse.vet / provenance.sbom / provenance.plan / provenance.advisories.** Those are
  the supply-chain dependency dossier / SBOM / advisory machinery (cartographer-quartermaster.mjs
  :573-714) — a separate feature that shares the file, not this epic.
- **NOT cross-language orientation beyond the JS/TS family.** honest-empty in v1 (O-8); polyglot
  expansion is a later rung gated on ATLAS language support.

---

## Red-first acceptance (v1.0 — re-pinned to the amended decisions)

A worker emits a BD3-A `code` query (`code.orient.map`) and receives:
- a **bounded** (≤2KiB) context-pack carrying **`freshnessDigest = sha256({repoId, baseTreeSha,
  indexEpoch, overlayDigest, scopeDigest})`** — one digest over BOTH the content handles AND the git
  base anchor;
- each leaf in the O-1 closed union: `generated` (typed structural fields only) or prose carrying
  `{text, provenance, untrusted:true, sourceRef}`; the provider renderer rejects unknown fields and
  unframed prose;
- a **`coverage`** object (`{totalFiles, supportedFiles, unsupportedFiles, excludedFiles,
  parseErrorFiles, parseErrorCount}`) preserved in the summary and the pack;
- a read outside its attempt's hub-derived scope refuses with the **constant scope refusal BEFORE
  any module/path existence check**;
- a stale base index refuses with **`orientation_base_stale`** (never served stale-as-fresh); a
  worktree-fence divergence during production refuses `effective_tree_changed` and publishes no
  pack;
- the read mints at most one **`context.read`** per hub-derived identity tuple, with **ZERO
  promotion weight** (assert: it is NOT a `scratch.read` event, `minScratchReaders` does not count
  it, and it never counts as progress — verified against the class, not the seed's pre-fold
  wording); exact replay returns the prior event; same-key/different-content refuses
  **`context_read_conflict`**;
- exceeding the per-attempt receipt byte/count ceiling refuses BEFORE append;
- reads do NOT count as TG2 progress (the farm-guard stays).

A worker pulls `code.orient.region(<moduleKey>)` / `code.orient.detail(...)`:
- prose leaves (invariants mined from comments/tests, curated purposes) arrive in the closed union
  with `untrusted:true`; an unknown-field or unframed leaf is rejected at the provider seam;
- a region exceeding 4KiB returns `needs_resume` + a cursor over `{packDigest, pageOffset,
  freshnessDigest, scopeDigest}`;
- **resume re-authorizes**: scope refusal precedes artifact existence lookup, so a cursor copied
  from another worker fails with the constant scope refusal; resume also re-checks the freshness
  digest — **resuming after a tree move refuses** (`effective_tree_changed` /
  `orientation_base_stale`), never serves the cached lines;
- `detail` descends from a live map/region citation and proves range containment — an arbitrary
  caller-named path/range is refused;
- worker-visible refs carry only `{kind, handle, digest, bytes, mediaType}` — no local path;
- a region/detail answer carries `mergeAuthority:false, verificationAuthority:false`.

An orchestrator spawns a worker whose brief cites the L0 map pack by digest:
- the worker receives the **materialized, framed** map; the pack is CITED, never spliced into the
  objective string;
- a spawn-time non-head citation fails with **`context_pack_stale`** — and NOTHING fails by wall
  clock: there is no `context_pack_expired` in this epic;
- spawn ordering is artifact-write → atomic grant+spawn append → provider dispatch; a crash before
  append leaves a reclaimable orphan, a crash after append exact-replays the same task/citation;
- two workers in the same region **share pack bytes** (digest-deduped) while grants and
  `context.read` receipts stay **attempt-scoped**;
- the L0 map is scoped to the worker's hub-derived pathScope (server-derived), never caller-named.

A worker rates an orientation:
- the caller supplies only `{packDigest, rating:'useful'|'missed'}`; the hub mints
  **`orientation.rating_recorded`** with the attempt identity and a prior-grant/read proof
  (`grantOrReadEventSeq`);
- invisible, unknown, stale-task, and out-of-scope targets all fail with the constant
  **`orientation_rating_refused`**;
- a second rating from the same task attempt on the same pack: exact replay returns the prior event;
  an OPPOSITE second rating refuses **`orientation_rating_conflict`** (history is never overwritten);
- a flood of `'missed'` from one worker **does not veto** the pack — aggregates are advisory inside
  a fixed deployment precompute budget and never gate serving, scope, freshness, verification, or
  promotion.

Availability honesty:
- a repo with zero in-scope supported files yields **`orientation_unavailable`** (honest empty,
  citable, provenance- and coverage-carrying), never a fabricated map;
- any in-scope unsupported/excluded/unreadable/parse-failed file labels the answer **partial** with
  the coverage counts, never completeness-claiming;
- a polyglot repo's non-indexed language yields honest-empty per module, never a guessed purpose —
  and a curated leaf on an unsupported-only module does not upgrade availability.

Compounding and overlay:
- a worker compounds a novel structural fact ONLY via `orientation.candidate.propose({packDigest,
  leafDigest})`; the hub mints the observed candidate (`orientation.leaf_proposed` /
  `orientation.overlay_proposed`) and admission goes through the **orchestrator/operator gate** — a
  worker **cannot self-promote** its own structural claim (the self-read hole at
  coordination-store.mjs:14374 stays closed because the evidence class is `context.read`, zero
  weight);
- a stale curated leaf is omitted with structured **`overlayOmissions`** and the answer serves
  `partial`; conflicting live curated leaves omit with **`overlay_conflict`** absent a live
  `Supersedes` winner;
- storage exhaustion refuses BEFORE write with **`orientation_storage_exhausted`**; a lawfully
  reclaimed page returns **`orientation_artifact_retired`**, never an empty or regenerated page
  under the old cursor.

---

## Open questions — resolved by the v1.0 fold

1. **(O-3) Is the `treeSha`+`overlay_digest` pair sufficient freshness?** **RESOLVED** by the O-3
   amendment: one `freshnessDigest` over `{repoId, baseTreeSha, indexEpoch, overlayDigest,
   scopeDigest}`; the base is read from the deployment's immutable git object tree (the
   context-runtime authority pattern, context-runtime.mjs:390-419/:487-496), so the epoch's
   "matches itself" check (atlas-index.mjs:294-310) is anchored externally. The
   representation-review gate's `head !== treeSha` (atlas-representation-review.mjs:30) stays the
   gate-side precedent; orientation uses the attempt/worktree fence for the dirty half.
2. **(O-4) Curated-overlay invalidation under structural change.** **RESOLVED** by the O-4
   amendment: materialized KG `Source` nodes + `Cites` edges (both already in the closed KG
   vocabulary — no new edge kind needed); stale leaves omit with structured `overlayOmissions`
   (answer serves `partial`); conflicting live leaves omit with `overlay_conflict` absent a live
   `Supersedes` winner. The "silently dropped" and "served against the wrong module" modes are both
   closed.
3. **(O-1/O-4) What is a "module"?** **RESOLVED** by the O-1 amendment: `moduleKey = {repoId,
   rootPath}` (deepest supported package/workspace root containing the file, else the first path
   segment, root files `.`), with `moduleDigest = sha256(sorted member {path, contentDigest})` as
   the rollup's content anchor and the overlay's citation coordinate.
4. **(O-6) L0 spawn map: region-scoped (pathScope) or repo-global?** **RESOLVED**: pathScope-scoped
   (the seed's lean), hub-derived from the admitted attempt; caller-named scope is refused. The
   "misorients at spawn" failure is bounded by the same derivation — a worker never receives another
   lane's map.
5. **(O-7) Tool-quality candidacy read path.** **RESOLVED**: advisory only — ratings may prioritize
   work inside a fixed deployment precompute count/byte budget; they never gate serving and never
   touch scope, freshness, verification, or promotion authority.
6. **(O-2) The `context.read` class itself is BD3-A's deliverable, not this epic's.** **CARRIED** to
   implementation sequencing (the red team did not force a change): BD3-A lands the class first;
   this contract specifies no interim evidence stub. The dependency ordering in the header stands.

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
