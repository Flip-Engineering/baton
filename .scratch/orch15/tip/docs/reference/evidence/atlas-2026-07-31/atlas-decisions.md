# ATLAS epic contract — worker-facing orientation + structural trust-gate evidence (v2)

(v2 folds the glm red-team (`redteam-v1.md`, verdict **SOUND-WITH-FOLDS**, R-AT-1..7, no P0 —
glm-5.2@high's first red-team seat). The thesis and the rung ladder stand; four P1 plumbing
folds: (1) "inherits the Cartographer binding" is FALSE — Cartographer is a deployment
singleton forwarding a closed ctx, not a per-worker binding; the overlay binding needs a
registry authority-shape change (R-AT-1). (2) `atlas-structural` is instantiated only in
tests — the composed deployment throws `representation_source_unavailable` unless the opted-in
capability set names it (R-AT-2). (3) `run.evidence` is a read projection — structural facts
enter via content-addressed artifact + ledger event and are CITED on read, the DG-3 model
(R-AT-3). (4) The registration locus pins to `createDriver`'s real assembly path (R-AT-4).
P2s: carded-op count corrected (eight ship, R-AT-5); the opted-in set is named explicitly
(R-AT-6); the ceiling citation names the enforcing gate (R-AT-7). v1 retained below.)

## Rules (v2 — amended; the push-first thesis, rung ladder, and non-goals stand)

1. **ATLAS-1 — push-first worker orientation, with the registry authority-shape change
   named.** `orientWorker` gains a symbol-focus shape AND the registry's invocation context
   (`_ctx`/`_capabilityCtx`) is extended to carry a per-call `worktreeRoot`; `_orientWorker`
   resolves `handle.worktree` + the worker's `indexEpoch` and passes `worktreeRoot` to both
   the Cartographer `orientation.slice` and any direct atlas-index
   `symbol.search`/`symbol.references` — per-worker overlay correctness is a registry change,
   not an orientWorker-local one (R-AT-1). "Inherits the Cartographer binding" is DELETED:
   Cartographer forwards a closed ctx and is a deployment singleton. AT-1's overlay-freshness
   leg is marked as requiring the registry change. Pull mode stays the deferred
   `ATLAS_QUERY:` successor.
2. **ATLAS-1b — deployment composition names the FULL opted-in set.** The opt-in Atlas
   registration (pinned to `createDriver`'s real assembly path — an opt-in default
   constructing the capability set, R-AT-4) registers EXPLICITLY `{atlas-index,
   atlas-structural, cartographer}` with artifact roots and policy ceilings (R-AT-6) — never
   atlas-index alone (the producer's `cards().filter(name===mapping.capability)` must find
   exactly one card or the gate throws `representation_source_unavailable`,
   `atlas-representation-producer.mjs:143-145/:289`; R-AT-2). Language-ceiling honesty
   stands (non-JS/TS repos get the honest empty capability).
3. **ATLAS-2 — structural evidence enters via artifact + ledger, cited on read.** On
   verification, the hub computes `diff.structural` (R1) over the worker's committed diff and
   writes a content-addressed, byte-bounded structural-class artifact
   (`pure_reformat|logic_changed|signature_changed` + per-file counts) PLUS a ledger event;
   `run.evidence` PROJECTS/cites its digest on read (the DG-3 model — `run.evidence` is a
   read-only observe projection, `application.mjs:165/:4428-4456`; R-AT-3). The change-class
   is coordinator-computed trusted fact in the LOG, distinct from worker prose (the
   contract's own grounding, `reviews/frontier-features/representation.md:36`). It informs,
   never adjudicates, in v2. The ceiling citation names the ENFORCING gate
   (`atlas-representation-ceiling.mjs:56-72`, R-AT-7); CPG-delta triage stays the named
   follow-on with its lexical-binding ceiling honestly stamped.
4. **(rule 4 stands — bounded, reverifiable, ceiling-honest; "eight ops carded incl.
   symbol.search/references" is the corrected count, R-AT-5.)**

## Red-first tests (v2 amendments)

- **AT-1:** the overlay-freshness leg asserts the registry context carries `worktreeRoot`
  (the registry change ships in the same rung); a worker-side edit to the FOCUSED file
  changes the slice after the overlay refresh; an unrelated edit does not.
- **AT-2:** the composed (NOT hand-wired) deployment registers `{atlas-index,
  atlas-structural, cartographer}` with budgets and ceilings; `cards()` contains
  `atlas-structural` BEFORE any gate verification runs (the R-AT-2 red-row gap pinned);
  non-JS/TS fixture repo gets the honest empty card.
- **AT-3:** a gate verification writes the content-addressed structural-class artifact +
  ledger event; the digest is observable through `run.evidence` ON READ (never "recorded
  in" it); the verdict itself is unchanged; artifacts byte-bounded with the ceiling
  declaration.
- **AT-4:** unchanged (honest empty ceiling for non-JS/TS workers).

---

# ATLAS epic contract — worker-facing orientation + structural trust-gate evidence (v1)

(Seed: operator directive 2026-07-31 — "advanced diagnostic or engineering features enabled
by baton… context engineering within the codebase." Parent: docs/28 audit (Atlas R1–R3/R5/R6
shipped, orchestrator-side only; "Atlas is not auto-registered; an empty deployment stays
honestly empty", `docs/28-exhaustive-capability-audit.md:441-444`); the Phase-29 lesson
(ship dead code if deployment wiring isn't a deliverable). Grounding: full ATLAS/DIAG
inventory 2026-07-31 (explore subagent, file:line-cited). Sibling: diagnostics contract owns
run.debug/run.evidence projections; this contract owns worker ORIENTATION and trust-gate
STRUCTURAL facts. Language ceiling honored throughout: Atlas indexes JS/TS/JSX/TSX/HTML/CSS
only (`atlas-index.mjs:11-17`) — cards must keep declaring it.)

## Ground truth

1. **Workers burn orientation compute per-turn, uncached and unsteerable**
   (`docs/capabilities/orientation-reuse.md:17-19`). A wave member is a harness CLI in a
   fenced worktree with native grep/read/bash only; the brief advertises no baton tools
   (`renderBrief` detects advertisements, `adapter.mjs:96-101`, but no shipped wave script
   populates `brief.tools`). The orientation machinery EXISTS orchestrator-side: R2 symbol
   index (`AtlasCodeIndex`, five ops carded, `atlas-index.mjs:247-255`), Cartographer
   `orientation.slice` over one immutable epoch + worktree overlay
   (`cartographer-quartermaster.mjs:361`), and the Phase-33 `orientWorker` push over the
   nudge lane (`coordinator.mjs:6360-6364`, event `knowledge.map_served` at `:6547`).
2. **The trust gate re-verifies without structural facts.** It re-runs the verification
   command and checks paths/fences, but nothing records WHAT CHANGED structurally — the two
   frontier proposals (structural diff → LOG fact; CPG-delta → risk triage,
   `reviews/frontier-features/representation.md:36,41`) match the already-carded producer
   (`atlas-representation-producer.mjs:13-17` maps structural_delta→R1, symbol_snapshot→R2,
   cpg_semantic_delta→R3 through one policy-ceilinged `representation.produce` op).
3. **Worker↔hub transport is the emulated up-channel grammar family only**
   (`DECISION_REQUEST:`/`SCRATCHPAD_WRITE:`, `claude-session.mjs:22-30`,
   assistant-text-only, first-balanced-JSON, ≤8KiB). Workers have no MCP and no tool plane;
   harnesses that can't parse a grammar defer the tool honestly
   (`scratchpad-decisions.md:145-147`). Any pull-style worker query is a NEW grammar member
   and gets red-teamed like #33.
4. **Staleness semantics are inherited, not invented.** The shared-epoch + per-worker-overlay
   model exists for Cartographer reads (`spec/capability-plane.md` §4); `atlas-index` ops take
   a raw root — live worker-overlay query semantics are undesigned. ATLAS-1 inherits the
   Cartographer binding.

## The question

Do workers get oriented by the hub (push-first) with the Atlas epoch they should see, and does
the trust gate record structural facts about the diff it judges — using machinery that
already exists and is carded — or does Atlas stay an orchestrator-side tool while workers
grep blindly? This contract picks push-first orientation + gate structural evidence, with a
deployment-composition slice so nothing ships dead.

## Rules

1. **ATLAS-1 — push-first worker orientation.** `orientWorker` gains a symbol-focus shape:
   the orchestrator (or wave brief) names focus symbols/paths; the hub computes
   `orientation.slice` + `symbol.search`/`symbol.references` over the worker's epoch+overlay
   binding (the Cartographer binding, rule per grounding — never a second staleness model)
   and pushes the bounded slice over the existing nudge lane. No new transport; pull mode is
   explicitly deferred to a future `ATLAS_QUERY:` grammar member red-teamed like #33 (named
   successor, not this contract).
2. **ATLAS-1b — deployment composition is a deliverable.** The zero-assembly deployment gains
   an opt-in Atlas registration (capabilityFactories wiring, `index.mjs:1256-1284`) that is
   honest when the repo language set is outside the JS/TS ceiling (the card declares the
   ceiling; non-matching repos get an honest empty capability, not silent maps). `demo.mjs`
   or the deployment factory registers it — nothing ships dead (the Phase-29 lesson).
3. **ATLAS-2 — structural evidence in the trust gate.** On verification, the hub computes
   `diff.structural` (R1) over the worker's committed diff and records a bounded change-class
   (`pure_reformat|logic_changed|signature_changed`, plus per-file counts) alongside the
   verdict in `run.evidence`; CPG-delta (R3) risk triage is the named follow-on (its own
   contract — the lexical-binding ceiling must stay honestly stamped,
   `atlas-cpg.mjs:10`). The structural fact is hub-computed and TRUSTED (the trust-gate
   thesis); it informs the operator and the revision nudge; it does not adjudicate by itself
   in v1 (no gate outcome changes on structural class alone).
4. **Bounded, reverifiable, ceiling-honest.** Every artifact is policy-ceilinged through the
   existing producer, deterministic, and carries the language-ceiling declaration; every push
   slice is byte-bounded (orientation slices already have bounds, Cartographer pattern);
   worker-facing content is prose-wrapped untrusted per the established posture.

## Red-first tests — `impl/test/atlas-orientation-red.test.mjs`

1. **AT-1:** an orchestrator push with a symbol focus delivers a bounded orientation slice to
   the worker over the nudge lane (`knowledge.map_served` carries the focus and slice
   digest); the slice reflects the worker's epoch+overlay binding (a worker-side edit to an
   UNRELATED file does not change the slice; an edit to the focused file does, after the
   overlay refresh the Cartographer binding already defines).
2. **AT-2:** the zero-assembly deployment with Atlas opted in registers the carded ops
   (symbol.search/references, repo.map, orientation.slice) with budgets; a non-JS/TS fixture
   repo gets the honest empty capability card, never silent results.
3. **AT-3:** a gate verification records the structural change-class with per-file counts in
   `run.evidence` (a pure-reformat fixture classifies `pure_reformat`; a signature edit
   classifies `signature_changed`); the verdict itself is unchanged (structural facts inform,
   never adjudicate in v1); artifacts are byte-bounded and carry the ceiling declaration.
4. **AT-4:** honesty — a worker in a repo with no JS/TS files receives an orientation push
   that declares the empty ceiling (never a fabricated map); the event and the slice say so.

Deterministic; fixture repos (tiny JS trees); MockAdapter workers; no live providers.

## Verification

```text
node --test impl/test/atlas-orientation-red.test.mjs
node impl/scripts/run-suite.mjs
```

## Explicit non-goals (v1)

`ATLAS_QUERY:` pull grammar (named successor, red-teamed like #33); CPG-delta risk triage in
the gate (named follow-on); direct rewrite apply (audit-pending); live LSP/native SCIP;
polyglot indexing (the ceiling stands); gate adjudication changes from structural class;
Python/Rust/Go language support.
