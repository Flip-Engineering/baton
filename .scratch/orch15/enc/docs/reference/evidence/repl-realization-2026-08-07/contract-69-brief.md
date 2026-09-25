# #69 CONTRACT BRIEF — the REPL realization rung (shared objects, scripting, context passing)

You are drafting the implementation contract for issue #69 (the REPL realization gap — the
manifest/binding/cite machinery shipped at P2-C but workers don't script against the REPL, and
no per-worker/shared-layer context objects exist). Read fully, in order: (1) the issue —
`gh issue view 69`; (2) the shipped REPL machinery (`impl/src/application-semantics.mjs` —
`repl.manifest` / `repl.binding` / `repl.cite` entries; the REPL module under `impl/src/` —
grep for it); (3) the BD3-B context-package lane (`mintContextPack` + `context.read` —
`coordination-store.mjs:13157/:13252` area) — the REPL rung must COMPOSE with context packages,
not duplicate them; (4) the KG settlement tiers (scratchpad write/elevate/settle — #33 — the
task→workflow→project promotion path shared-layer objects ride); (5) the #94 demo's lived
context-passing (`docs/reference/evidence/dynamic-workflow-2026-08-03/` — what the orchestrator
hand-injected into objectives that should have been REPL objects).

## The contract must decide (with the house law in front)

**THE HOUSE LAW (docs/33:11 + the Program IR law): no arbitrary-code REPL, ever.** REPL objects
are DATA with citations and closed shapes — never executable. The "scripting" the issue names is
scripting AGAINST the REPL (composing/citing objects), not code executing IN it. The docs-dive
finding (tools-as-code bridge, #131 backlog) is a DIFFERENT, gated surface — do not conflate.

- **D: the load-bearing use (a).** Orchestrator-authored context objects cited into worker
  briefs via `repl.cite` — replacing objective-text context injection (the 4KiB cap lesson,
  #129: brief-by-reference is today's workaround; cited REPL objects are the real lane). Pin the
  object schema (closed, content-addressed, byte-bounded with digest-cited spill per #89), the
  cite-into-brief seam (where in the assembled context the cited object renders, the UNTRUSTED
  frame discipline), and the admission authority (orchestrator-authored vs worker-authored).
- **D: per-worker vs shared-layer objects.** The three tiers: task-ephemeral (dies with the
  task), workflow-ephemeral (shared across a wave's members — the dynamic-workflow ask), and
  project-persistent (promoted via KG settlement — the orchestrator reviews at close, per the
  tiered-promotion law). Pin the tier vocabulary, the visibility/authority per tier, and the
  promotion path's composition with the landed settlement ritual (#63).
- **D: worker-authored manifests (b).** The shipped manifest path is unused in campaigns — the
  contract must say what makes it load-bearing now (review/admission by the orchestrator: what
  the orchestrator sees and approves, and how the admitted manifest binds).
- **D: the #105/#79 composition.** A cited object delivered into a brief interacts with the
  pending-attention push (#79) and reply chains (#105) — name the rendering order and the byte
  budget composition.
- **Refusal vocabulary + acceptance pins (red-first)** per decision.

## Laws + deliverable

Ring-2 form (ground truths → decisions → refusal vocabulary → acceptance pins → open questions).
No clocks; every citation verified (`grep -an`/`sed -n` on the two NUL files); sorted-key
literals ACTUAL order; `localeCompare` banned. Cross-reference (do not re-spec): #19, #33, #63,
#68, #79, #94, #105, #129, #131 (tools-as-code stays in the backlog), docs/33:11. Deliverable:
ONLY `docs/reference/evidence/repl-realization-2026-08-07/repl-realization-contract.md` (v1.0
DRAFT with the verification HEAD).
