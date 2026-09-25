# KG activation epic contract — ambient serving, candidacy queue, elevation rituals (v1)

(Seed: operator question 2026-07-31 — "how have the shared knowledge graphs and solo
knowledge graphs with tiered promotion been working?" — and its honest answer: the
machinery is shipped and suite-green, but campaign-dormant. Usage count across every
campaign coordination log: `knowledge.promoted` ×4 (all policy-actor verification
Findings), `scratchpad.entry_written` ×6, ZERO elevations, ZERO `admitWorkflowFinding`
gate uses, ZERO horizon reads in the wild. Parent issues: #24 (KG-1 horizon projections),
#25 (KG-2 promotion paths), #26 (KG-3 ambient activation), #27 (KG-4 growth/quality).
Grounding: the bidirectional seam map (agent-28 §3) and the campaign usage count
(2026-07-31). Sibling: S-3 owns the canonical registry rows (`knowledge.promote/recall/
horizon`); this contract owns ACTIVATION — putting the graph in the way of work. It moves
no authority: the orchestrator-admit gate (`admitWorkflowFinding`,
`coordination-store.mjs:14253`) stays the only promotion path, deliberately.)

## Ground truth

1. **The graph accrues but nobody reads it.** Verification outcomes mint and promote
   Findings automatically (policy actor); board close/package admit/scratchpad settle mint
   candidates. Nothing serves knowledge back at the moment of work: briefs carry no
   knowledge slice (`renderBrief`, `adapter.mjs:96-117`), `orientWorker`'s push lane serves
   maps (`knowledge.map_served`, `coordinator.mjs:6547`) but not recalled knowledge, and no
   run/wave view surfaces the graph's state.
2. **Candidacy is invisible, so the elevation ritual never happens.** Candidates queue in
   the store awaiting `admitWorkflowFinding`, but no projection shows pending candidates —
   the orchestrator cannot review what it cannot see. Elevation requires a queue, not a
   memory.
3. **The tiered story has no ritual hooks.** Task-ephemeral (scratchpad) →
   workflow-ephemeral (admitted findings) → project-persistent (promoted knowledge) needs
   review moments: end-of-task and end-of-wave. The wave driver's receipt and the run's
   terminal views carry no candidacy counts, so no natural ritual point exists.
4. **Worker-side reads don't exist.** Workers write scratchpad via grammar; they have no
   read port for knowledge (the horizons are coordinator/application-side; a worker learns
   shared state only via downward prompt text — agent-28 §3c).

## The question

Does the graph get ACTIVATED — knowledge served at the moment of work, candidacy surfaced
for review, elevation rituals given natural hooks — while keeping the admit gate the
deliberate authority? Or does it stay a write-only store? This contract picks activation
through projections and serving, explicitly rejecting auto-promotion.

## Rules

1. **Ambient serving into briefs (KG-3's smallest honest slice).** `renderBrief` gains an
   optional bounded knowledge slice: `recallKnowledge` over the run's scope/objective
   keywords (bounded: ≤ 8 findings, ≤ 2KiB, each item prose-wrapped
   `{provenance:'knowledge', untrusted:true}` with its grounding ref and validity dates).
   An empty graph yields an honest empty slice (never fabricated relevance). The slice is
   served at spawn; refresh via the existing `orientWorker` push lane on demand. Worker-
   side pull stays the deferred grammar successor (same discipline as ATLAS_QUERY).
2. **The candidacy queue is a first-class projection.** Run and workflow views gain
   `knowledge.candidates: [{id, type, source (board_close|package_admit|scratchpad_settle|
   verification), ageMs, groundingDigest}]` (bounded ≤ 16, stable order). Admitting or
   rejecting removes from the queue; the queue is derived from the store's candidate
   records, never stored twice.
3. **Ritual hooks at natural review moments.** The wave driver's receipt and the run's
   terminal outline carry `knowledge: {candidates: N, admittedThisRun: M}` — the counts
   that tell the orchestrator an elevation review is due. The P1-D recipe receipts inherit
   the same block. (Ergonomics only — the admit decision stays manual and gated.)
4. **Horizon digests in the wave surface.** `wave.progress()` member rows gain
   `knowledgeDigest` (the workflow horizon's content digest, cheap from the fence-tuple
   cache, `coordinator.mjs:9823-9831`) so an orchestrator sees knowledge state change
   across polls without re-reading the horizon.
5. **No auto-promotion, no new authority, no new event kinds.** Serving and projections
   read existing records; the admit gate is untouched; validity windows (temporal
   validity on nodes) are honored at serve time (expired knowledge never serves).

## Red-first tests — `impl/test/kg-activation-red.test.mjs`

1. **KG-A1 (ambient serving):** a spawn brief carries the bounded knowledge slice with
   provenance wrappers and grounding refs; an empty graph yields the honest empty slice;
   expired-validity nodes never serve; the byte cap holds with a full queue.
2. **KG-A2 (candidacy queue):** candidates from each source kind appear with type/source/
   age/grounding; admit removes exactly that candidate; the queue is capped and ordered;
   no duplicates across views.
3. **KG-A3 (ritual hooks):** the wave receipt and terminal outline carry the candidacy
   counts; a run with zero candidates carries `0` (not a missing field); the recipe
   receipt inherits the block.
4. **KG-A4 (horizon digest):** `wave.progress()` rows carry `knowledgeDigest`; the digest
   changes when a finding is admitted and not when unrelated state moves (cache-correct).
5. **KG-A5 (gate honesty):** the admit gate's lease binding and refusal taxonomy are
   unchanged (source-scan + one refusal row per existing class); no auto-promotion path
   exists (source-scan: no admit call outside the gate's callers).

Deterministic: CoordinationStore/Coordinator fixtures, MockAdapter briefs, fixed clocks,
no live providers.

## Verification

```text
node --test impl/test/kg-activation-red.test.mjs impl/test/reflex2-boards-red.test.mjs impl/test/reflex3-packages-red.test.mjs
node impl/scripts/run-suite.mjs
```

## Explicit non-goals (v1)

Auto-promotion or confidence-scored admission (KG-4's MAD-confidence is #27's own scope);
worker-side knowledge pull grammar (deferred successor); new node/edge types; graph pruning
or staleness sweeps (KG-4); canonical registry changes (S-3 owns the rows); brief
restructure beyond the additive slice.
