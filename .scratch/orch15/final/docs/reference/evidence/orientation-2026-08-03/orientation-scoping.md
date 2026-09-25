# Orientation + context-engineering frontier — evaluation and scoping note (2026-08-03)

(Seed: operator ask — "have you evaluated the advanced syntax, troubleshooting, testing, and
code investigation, exploration, and codebase understanding features for context engineering
and tooling framework improvements and intuitive integration yet?" Plus: codebase-context
engineering, conciseness, progressive surface of disclosure, best agentic experience
reflectively with bidirectional feedback, iteratively. This note is the honest evaluation
and the scoping for an epic. It is not yet a contract; the contract follows the BD3 spine.)

## Part 1 — the evaluation: what exists and how integrated it is

### Landed and integrated (the good half)

- **The unified grammar (M0–M5):** one canonical control vocabulary across
  embedded/CLI/MCP/web with conformance enforcement and banned-token lint. This is the
  "advanced syntax" substrate, and it is genuinely integrated — new tools ride registry
  rows; dialects are dead.
- **Troubleshooting/diagnostics:** run.debug (typed failure shapes, whitelisted receipts,
  frame-degraded summaries), trust-gate {gate, detail} with sanitized evidence,
  attention with progressClass + requiredAction, write-failure visibility (#62). Failure
  answers are a query away — but see the archaeology tax below.
- **Testing methodology:** the red-first + adversarial red/blue wave pattern is now the
  campaign's strongest habit (five epics landed through it). Red-teaming the contracts,
  blue-teaming the suites — the workers themselves rate it the quality multiplier.
- **Validated-goal controls:** DoD + verification + referee + content gates — the good
  control class per the campaign control law.

### Built but unreached-for (the context-engineering half)

- **ATLAS (index/structural/cartographer):** code property graphs, structural change
  classification, behavior fingerprints — used ONLY by the trust gate as verification
  evidence. No agent-invokable exploration surface (zero `baton_atlas_*` tools, no
  application command). The strongest investigation machinery in the repo is the gate's
  private instrument.
- **Context program (cells/calls, eval/map/reduce/retry):** pure compute over immutable
  branches — but manifest admission is embedded-only, session setup is a ritual, and its
  own design comment admits MCP/web dispatch "do not yet." Used: essentially never.
- **cartographer/quartermaster:** orientation slices + reuse.vet — coordinator-internal
  only (orientation.slice serves briefs via coordinator paths; no agent tool).
- **REPL:** manifest/binding/cite machinery, ~30% realized (#69).

### The taxes these leave (measured this campaign)

1. **Investigation archaeology:** every agent (orchestrator included) investigates with
   grep/read/bash on raw files. The downstream worker's #1 phrasing — "I re-derive the
   entire world on every task" — applies to CODE as much as to knowledge. A 38KB
   PROGRESS.md and three 30KB red-team docs were read to re-derive what an orientation
   layer could answer in one bounded call.
2. **Flat context:** briefs and objectives are unstructured prose. There is no disclosure
   ladder (map → region → detail); context either arrives whole (byte-capped) or not at
   all. Progressive disclosure exists nowhere as a mechanism — only as the reader's own
   diligence.
3. **Investigation doesn't compound:** what a worker learned investigating is lost unless
   it thinks to scratchpad it; structural facts never enter the KG, so every wave
   re-investigates the same codebase from zero.

## Part 2 — the scoping: the orientation epic (seed, post-BD3)

### O-1 — The orientation ladder (progressive surface of disclosure)

One tool family, three bounded tiers, each answer citable:

- `code.orient.map()` — the repo's structural index: modules with one-line purposes,
  entry points, hot paths, ownership of surfaces (suite/test pairing), bounded ≤ 2KiB.
- `code.orient.region(<module|path-glob>)` — one module's surface: exported contracts,
  invariants (from its own comments/tests), its test suites, its recent change classes
  (ATLAS-structural), bounded ≤ 4KiB.
- `code.orient.detail(<citation|range>)` — the exact lines with a content-addressed
  citation (repl.cite-compatible).

Every tier's answer is a **context-pack** (BD3-B's artifact class): citable by digest
into briefs, and a candidacy candidate for the KG (structural Findings — so orientation
COMPOUNDS across waves instead of re-deriving).

### O-2 — Investigation receipts as knowledge

Workers file investigation receipts by construction (not diligence): a code.orient call
mints a scratch.read-class evidence event (the KG's existing class — reads already accrue
grounding). High-value answers (novel structural facts, surprising invariants) become
candidacy candidates through the same admission gate as notes. The KG stops being only
"what workers said" and gains "what the codebase is."

### O-3 — Conciseness as the mechanism (not the hope)

The ladder IS the conciseness law: no answer exceeds its tier's bound; anything larger is
a citation (digest-handle) the agent expands on demand. Briefs cite orientations by
digest (BD3-B) instead of pasting prose evidence lists (the frontier review's exact
complaint: "Evidence to consult: docs/PROGRESS.md…" pasted verbatim into briefs).

### O-4 — Bidirectional reflection on the tooling itself

Agents rate the orientations they receive (a one-bit scratchpad kind or a link relation:
`relation: 'useful'|'missed'` targeting the pack citation) — the layer learns which
maps/regions matter (candidacy for tool-quality, not just code-quality). This is the
"reflectively with bidirectional feedback" half: the tooling improves from its own usage
receipts, iteratively.

### O-5 — Surfaces

Embedded-first (orchestrator), worker pull via the BD3-A read lane's query kinds (a
`code` query kind joins knowledge/board/scratchpad/finding), MCP per the reflex table.
ATLAS availability stays honest-empty on non-JS/TS repos (the existing posture).

### Open questions for the red team (when contracted)

- Freshness: ATLAS index staleness (re-index cadence vs content-addressed lazily —
  the index must never serve stale structure as fresh; digest-of-treeSha on every answer).
- The map's authorship: generated (ATLAS) vs curated (a hand-maintained orientation
  doc)? The honest answer is generated-with-curation-overlay, and the overlay lives in
  the KG as authored Findings.
- Query cost bounds: structural queries over a 15k-line store file — the CPG's own
  ceilings; pagination shape for big answers.
- Whether workers should orient at spawn (an orientation section in every brief,
  tier-L0 always, L1 for the task's region) vs pull-only. (Lean: L0 always, it is cheap
  and kills the first hour of archaeology on every task.)

## Part 3 — where this sits in the queue

After BD3 (the spine carries the read lane + context-packs this rides) and alongside
#74 (the swarm coordinator is the heaviest orientation consumer — decomposition quality
IS orientation quality). O-1/O-2 are the first contract; O-3/O-4 are their acceptance
shape; O-5 follows BD3-A's lane conventions.
