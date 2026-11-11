# Red-team — ATLAS epic contract v1 (`atlas-decisions.md`)

Reviewer: glm (first red-team seat). Method: every citation re-read against live code; coordinator.mjs
read via `sed` only (NUL bytes); no file over ~1500 lines read whole. Targets verified:
`atlas-index.mjs`, `cartographer-quartermaster.mjs`, `coordinator.mjs`, `atlas-representation-producer.mjs`,
`index.mjs`, `adapter.mjs`, `capability-registry.mjs`, `atlas-structural.mjs`, `application.mjs`,
`spec/capability-plane.md`, and the diagnostics / docs-28 / scratchpad-#33 siblings.

## VERDICT: SOUND-WITH-FOLDS

The thesis is correct and the load-bearing machinery claims check out: `orientWorker` pushes a
bounded Cartographer `orientation.slice` over the nudge lane and fires `knowledge.map_served`
(coordinator.mjs:6359-6416, :6543-6550); the JS/TS/JSX/TSX/HTML/CSS ceiling stands
(atlas-index.mjs:11-17); the producer maps structural_delta→R1 / symbol_snapshot→R2 /
cpg_semantic_delta→R3 through one policy-ceilinged `representation.produce`
(atlas-representation-producer.mjs:13-17); the trust gate today records **zero** structural facts
(grep of `structural_delta|run.evidence|representation.produce|diff.structural|pure_reformat` in
coordinator.mjs = 0); `diff.structural` (R1) and `run.evidence` both ship; the `ATLAS_QUERY:` pull
deferral is consistent with the #33 grammar-family discipline. None of that is contested.

The folds are four P1 seams where the contract would ship green-but-broken or fork two competent
implementers, plus three P2 cleanups. No P0: nothing falsifies the contract's existence claim or
forces a rebuild — each defect has a minimal, in-contract repair.

## Hunt coverage (all five brief categories)

1. **Unsound rules** → R-AT-1 (the overlay binding is unexpressible through the shipped registry; the
   "Cartographer binding" escape hatch is itself false).
2. **Contradictions with shipped machinery + siblings** → R-AT-2 (atlas-structural never wired in prod),
   R-AT-3 (run.evidence is read-only; contradicts the diagnostics sibling *and* the contract's own
   `representation.md:36` grounding).
3. **Fork risks in the rung decomposition** → the R1/R2/R3 rung ladder itself is **sound and fixed**
   (atlas-representation-producer.mjs:13-17; enforced by atlas-representation-ceiling.mjs:56-72) — no
   implementer can reorder it. The genuine forks are in *plumbing*, not rungs: R-AT-1 (overlay threading)
   and R-AT-4 (registration locus). ATLAS-2 correctly picks R1 (structural) and defers R3 (cpg); no rung fork.
4. **Red-row gaps (ships green, broken)** → R-AT-2 (AT-3 green via hand-registered fixture; composed
   deployment throws `representation_source_unavailable`), R-AT-3 (AT-3 "records in run.evidence" is
   unbuildable as written).
5. **Overreach** → **none found.** The non-goals list is well-fenced (no CPG triage, no adjudication
   change from structural class, no polyglot, no live LSP/SCIP, no direct rewrite apply, no pull grammar).
   ATLAS-1b's deployment-composition deliverable is *required* scope (docs/28:441-444 + the Phase-29
   "ship dead code if wiring isn't a deliverable" lesson), not overreach. If anything, ATLAS-1 is
   *under*-specified (R-AT-1), not over-reaching.

## Findings

### R-AT-1 — P1 — Per-worker overlay binding is unexpressible through the shipped registry; "inherits the Cartographer binding" is false (unsound rule + fork)
*Grounding:*
- atlas-index.mjs:172 (`overlay(base, worktreeRoot,…)` — `if(!worktreeRoot)…applied:false`) & :339
  (every non-build op calls `overlay(base, ctx.worktreeRoot, …)`; provenance sets `overlay_applied`).
- coordinator.mjs:6393 — `_orientWorker` invokes the registry with
  `invoke('cartographer-quartermaster','orientation.slice', args, { budgetTokens, signal, actor })`;
  production caller at :7927-7932 passes `args={indexEpoch,focus,shape}` and `ctx={actor,budgetTokens,expectedFence}`.
- capability-registry.mjs:128-140 — `_ctx` returns a **closed 7-key shape**
  `{budgetTokens, signal, actor, repoId, idempotencyKey, transport, root}`; any other key (e.g.
  `worktreeRoot`) is **dropped**. `_capabilityCtx` (:143) then forbids `entry.context` from overriding
  `root`/`actor`/`budgetTokens`/…, so a per-worker root cannot enter via the deployment context either.
- cartographer-quartermaster.mjs:517 — Cartographer forwards `ctx` to `this._invokeAtlas(…)` unchanged;
  it is constructed once, deployment-wide, with a single `this.atlas` (:298).
- atlas-decisions.md:36-39 (Ground truth #4), :51-57 (ATLAS-1 rule), :80-82 (AT-1 staleness assertion).

*Failure:* ATLAS-1 promises `symbol.search`/`symbol.references` "over the worker's epoch+overlay binding
(the Cartographer binding)". The overlay *mechanism* exists at the capability layer, but the registry's
context contract is a closed shape: `_ctx` strips `worktreeRoot`, `_capabilityCtx` forbids it from the
deployment context, and `_orientWorker` never offers it. Cartographer — the named "binding" — is built
once and forwards the same closed ctx, so it carries no per-worker root either. Net result: every
orientation/symbol query runs `overlay_applied:false` (base snapshot only) — precisely the staleness
ATLAS-1 exists to cure — and AT-1's "an edit to the focused file changes the slice" assertion cannot
pass against shipped machinery. Note `args.indexEpoch` *does* flow (it rides in `args`, not ctx); it is
specifically the overlay *root* that is unexpressible. Ground truth #4 is therefore imprecise: it says
"atlas-index ops take a raw root — live worker-overlay query semantics are undesigned", when in fact the
query-time overlay is designed (atlas-index.mjs:339) and only the **per-worker threading through the
registry** is missing.

*Divergence (two implementers, both "claiming the contract"):*
- A threads `handle.worktree` → adds `worktreeRoot` to `_ctx`/`_capabilityCtx`'s authority shape →
  passes it from `_orientWorker` for both the Cartographer call and a direct atlas-index symbol call.
- B avoids touching the registry's closed ctx by giving Cartographer a per-worker root channel — but
  Cartographer is deployment-singleton, so B must re-arch it per-worker, or re-derive the overlay
  outside the registry (duplicating the §4 model).
These produce different trust/staleness semantics and different artifact provenance.

*Repair:* ATLAS-1 must (a) extend the registry authority shape (`_ctx`/`_capabilityCtx`) to carry a
per-call `worktreeRoot`, (b) have `_orientWorker` resolve `handle.worktree` + the worker's `indexEpoch`
and pass `worktreeRoot` for both the Cartographer `orientation.slice` and any direct atlas-index
`symbol.search`/`symbol.references`, and (c) delete "inherits the Cartographer binding" — Cartographer
forwards a closed ctx and is a deployment singleton, so it is not a per-worker binding today. Until (a),
AT-1's overlay-freshness leg must be marked as requiring the registry change, not just orientWorker.

### R-AT-2 — P1 — ATLAS-2 depends on `atlas-structural` registration that no rule wires (red-row gap)
*Grounding:* atlas-structural.mjs:153/164-165 (`AtlasStructuralDelta`, op `diff.structural`, card `atlas-structural`),
atlas-representation-producer.mjs:143 (`cards().filter(name===mapping.capability)`) & :289
(`registry.invokeAttested('atlas-structural','diff.structural',…)`), index.mjs:146 (export only) & :1258/:1264
(`atlas-representation-producer` conditional; everything else from `opts.capabilityFactories` only),
atlas-decisions.md:58-62 (ATLAS-1b names only atlas-index) & :84 (AT-2 registers only atlas-index/cartographer ops).
*Failure:* the gate's structural class is produced by `representation.produce` → which calls
`registry.invokeAttested('atlas-structural','diff.structural',…)` (producer:289), gated by
`_card()` (producer:143-145): `cards().filter(name===mapping.capability)` must find exactly one card
or it throws `representation_source_unavailable`. `AtlasStructuralDelta` ships
(atlas-structural.mjs:153) but is instantiated **only in tests** (phase13/29/61) — grep of
`new AtlasStructuralDelta` across `impl/` shows zero production sites outside its own definition; like
atlas-index it is export-only (index.mjs:146) and enters the registry solely via `opts.capabilityFactories`
(index.mjs:1264). ATLAS-1b's opted-in set names only atlas-index; AT-2 registers only
symbol.search/references/repo.map/orientation.slice. So a composed deployment + a real gate verification
throws `representation_source_unavailable` at producer:143 and ATLAS-2 emits no class. AT-3 passes only
because its fixture hand-registers the producer's source dependency — the red row is green, the product
is broken.
*Repair:* ATLAS-1b (or ATLAS-2) must name `atlas-structural` in the opted-in Atlas capability set with
its artifact root + ceilings; AT-3 must assert the structural class is produced through the *composed*
(non-hand-wired) deployment, and assert `cards()` contains `atlas-structural` before the gate runs.

### R-AT-3 — P1 — `run.evidence` is a read-only observe projection; "record … in run.evidence" is the wrong write model (sibling contradiction)
*Grounding:* application.mjs:165 (`'run.evidence': { capabilities:['observe'], web:true, mcp:true }`) & :4433
(`_authorize('run.evidence', observer, …)`), diagnostics-decisions.md:100-101 (DG-3: "run.evidence and
run.debug cite its digest"), atlas-decisions.md:63-66 & :86-89.
*Failure:* ATLAS-2 / AT-3 say the gate "records the structural change-class … alongside the verdict
in `run.evidence`". But `run.evidence` is a read projection: `async evidence(runId, observer)`
(application.mjs:4428-4436) `_authorize`s as **observer** and returns `this._buildEvidence(current)`,
which assembles a view from coordination events + artifacts (application.mjs:4438-4456). There is no
write path into it — evidence enters via ledger events (`_log.append`) and content-addressed artifacts
(`coordination.artifact(...)`). The diagnostics sibling models this correctly: DG-3 pins a
content-addressed capture artifact and "run.evidence and run.debug cite its digest". Two implementers
diverge — one tries to write into run.evidence (impossible; it is derived on read), the other writes a
structural-class artifact + ledger event that run.evidence projects (correct, matches the sibling).
*Repair:* restate ATLAS-2/AT-3 as "the gate writes a content-addressed, byte-bounded
structural-classifact + emits a ledger event; `run.evidence` projects/cites its digest on read" —
mirroring DG-3. AT-3 should assert the digest is observable through `run.evidence`, not that a value
was "recorded in" it. *Self-consistency note:* the contract's own cited source already says this —
`reviews/frontier-features/representation.md:36` specifies the change-class is "written to the **LOG**
as coordinator-computed facts (trusted), distinct from worker prose". ATLAS-2's "in `run.evidence`"
therefore diverges from its own grounding; the LOG/artifact model is the intended one.

### R-AT-4 — P1 — ATLAS-1b deliverable locus is ambiguous (fork + Phase-29 mechanism tension)
*Grounding:* atlas-decisions.md:58-62 ("demo.mjs or the deployment factory registers it"),
docs/28-exhaustive-capability-audit.md:441-444 (Phase-29 pattern = inject Atlas instances via `createDriver()`;
"Atlas is not auto-registered"), impl/demo.mjs (exists; demo harness), index.mjs:1256-1284 (capabilityFactories).
*Failure:* ATLAS-1b gives two loci — "demo.mjs or the deployment factory" — but they are not
equivalent. `demo.mjs` is a scenario *driver* ("drives the REAL assembled fleet driver (createDriver)
through three scenarios", demo.mjs:1) that today calls `createDriver({ repoRoot, logDir, adapters })`
with **no capabilities at all** (demo.mjs:35). The real wiring knobs are `createDriver`'s
`capabilities` / `capabilityFactories` / `capabilityContexts` opts (index.mjs:1039, 1059, 1256-1284),
and docs/28:441-444 says the Phase-29 pattern injects Atlas instances into `createDriver()`. So
"register it in demo.mjs" = add capabilityFactories to demo.mjs's call = Atlas exists only inside the
demo, while every production `createDriver` caller stays empty — which is precisely the dead-code
outcome ATLAS-1b invokes the Phase-29 lesson to avoid. Two implementers diverge: one wires demo.mjs
(green demo, dead product), the other wires createDriver's default assembly (real product).
*Repair:* pin the locus to `createDriver`'s real assembly path (an opt-in default that constructs
atlas-index + atlas-structural + cartographer with ceilings and the language-ceiling honesty gate);
keep demo.mjs as the dogfood *consumer* that exercises the already-wired driver; make AT-2 assert the
zero-assembly (non-demo) `createDriver` deployment, not a demo-only one.

### R-AT-5 — P2 — Grounding slip: "five ops carded" (eight ship)
*Grounding:* atlas-index.mjs:247-255 (the `card().ops` literal), atlas-decisions.md:20 (Ground truth #1:
"R2 symbol index (AtlasCodeIndex, five ops carded, atlas-index.mjs:247-255)").
*Failure:* the card declares **eight** ops — `index.build` (task), `search.lexical`, `symbol.search`,
`symbol.references`, `graph.calls`, `repo.map`, `code.seed`, `scip.export` (all interactive). The "five"
count is wrong. The hazard is not cosmetic: ATLAS-1's whole premise is that `symbol.search`/`symbol.references`
are *already carded* and need only be composed; a reader who trusts "five ops" may believe those two are
absent and re-card them (a duplicate-registration throw, index.mjs:1265) or rebuild them — the exact
dead-code/Phase-29 failure ATLAS-1b exists to prevent.
*Repair:* "eight ops carded (incl. `symbol.search`/`symbol.references`)" or drop the count.

### R-AT-6 — P2 — AT-2 conflates two capabilities and hides the cartographer→atlas-index construction dependency
*Grounding:* cartographer-quartermaster.mjs:298 (`if (!opts.atlas || typeof opts.atlas.invoke !==
'function') throw … 'Cartographer/Quartermaster requires AtlasCodeIndex'`), atlas-decisions.md:84
(AT-2 op list), atlas-decisions.md:58-62 (ATLAS-1b "capabilityFactories wiring").
*Failure:* AT-2's op list spans **two** capabilities — atlas-index (`symbol.search`/`symbol.references`/
`repo.map`) and cartographer-quartermaster (`orientation.slice`) — but "registers the carded ops"
implies one card. cartographer cannot even be constructed without an atlas-index instance (:298), and
its card declares `underlying: ['atlas-index:code.seed','atlas-index:repo.map']`
(cartographer-quartermaster.mjs:369) — i.e. `orientation.slice` is a *composition* over atlas-index,
not a standalone op. So "Atlas opted in" is a construction-ordered dependency graph
(atlas-index → cartographer(atlas); + atlas-structural per R-AT-2), and a factory that registers them
out of order throws at :298. The contract never states the set or the order.
*Repair:* ATLAS-1b/AT-2 should state the opted-in capability set explicitly — `{atlas-index,
atlas-structural, cartographer-quartermaster}` — with construction order (atlas-index first; cartographer
constructed with the atlas-index instance) and the language-ceiling honesty gate applied at atlas-index
construction.

### R-AT-7 — P2 — CPG follow-on should pin the *live* ceiling gate, not just the binding constant
*Grounding:* atlas-representation-ceiling.mjs:56-72 (the enforcing capability), atlas-cpg.mjs:10
(`BINDING_MODEL = 'atlas-js-lexical-bindings-v1'`; LANG JS/TS/JSX/TSX only), atlas-decisions.md:66-68.
*Failure:* ATLAS-2 stamps the lexical-binding ceiling via `atlas-cpg.mjs:10` — a *constant* — but the
constant does not enforce anything. The enforcement is a shipped capability: `atlas-representation-ceiling`
throws `rung_ceiling` on any R4 op with `maximumRung:'R3'` and `redirects:['diff.structural','cpg.build',
'cpg.delta','cpg.taint']` (ceiling:60-63), and its `representation.ceiling` op stamps the full ladder
`['R0:text','R1:ast-structural','R2:symbol-scip','R3:cpg-cfg-may-dataflow']` with `unavailableViews:
['R4:compiler-ir','translation-validation']` (ceiling:68-72). If the named CPG-delta follow-on contract
inherits only the doc/constant, the ceiling can drift between doc and the live gate.
*Repair:* ATLAS-2's ceiling citation should name `atlas-representation-ceiling.mjs:56-72` (the enforcing
gate, incl. the R0→R3 ladder and the R4 refusal) alongside `atlas-cpg.mjs:10` (the binding model), so the
follow-on contract inherits the *live* gate, not a stale reference.

## Surviving sections (verified sound, no change needed)

- **Language ceiling** (JS/TS/JSX/TSX/HTML/CSS) — atlas-index.mjs:11-17; honestly declared on the card
  (:257/:260) and in the producer environment validation. AT-4 honesty test is well-grounded.
- **orientWorker over the nudge lane + `knowledge.map_served`** — coordinator.mjs:6359-6416, :6543-6550;
  message shape `baton.orientation.slice` with bounded `note` (≤2KiB, no NUL), fenced delivery, stale-fence rejection.
- **Producer rung mapping + policy ceilings** — atlas-representation-producer.mjs:13-17 (R1/R2/R3),
  validated policy fields (:18) and environment identity (:73-80); `representation.produce` is the single
  policy-ceilinged op (index.mjs:1258).
- **Trust-gate baseline** — `_runTrustGate` (coordinator.mjs:10817+) captures worktree + changedPaths and
  re-verifies; confirming zero structural facts today grounds ATLAS-2 as a clean build instruction.
- **`diff.structural` (R1) ships** — atlas-structural.mjs:153 (deterministic, reverifiable); the producer
  reaches it via the attested registry path with reverify (producer:289-291).
- **Grammar-family deferral discipline** — `ATLAS_QUERY:` pull deferred as a named successor "red-teamed
  like #33"; matches scratchpad-decisions.md:145-147 (harnesses that can't parse the grammar defer honestly,
  Coordinator is the only write path) and the emulated up-channel ceiling (claude-session.mjs:22-30).
- **Push-first, no-new-transport posture** — orientation rides the existing nudge lane; no MCP/tool plane
  granted to workers; `renderBrief` advertisement detection (adapter.mjs:96-101) is intact.
- **docs/28 grounding** — `:441-444` exact ("Atlas is not auto-registered, so an empty deployment remains
  honestly empty"); correctly inherited as the ATLAS-1b honesty floor.
- **Non-goals list** — correctly fences the v1 boundary (no CPG triage, no adjudication change, no polyglot,
  no live LSP/SCIP, no direct rewrite apply).
