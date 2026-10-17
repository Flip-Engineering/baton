# #70 CONTRACT BRIEF — cross-deployment knowledge: one project, many deployment roots

You are drafting the implementation contract for issue #70 (every deployment root carries its
own KG; a project spanning deployments starts knowledge-poor every time). Read fully, in order:
(1) the issue — `gh issue view 70` (the three candidate shapes (a) designated project-primary
root with replication-as-projection, (b) cross-root knowledge.recall federation, (c) the PKG-1
descriptor naming a shared knowledge root); (2) the lived evidence: this campaign's own
deployment sprawl (every wave driver gets a per-salt root — `ls .baton/` — knowledge promoted in
one is invisible to the next wave's workers); (3) the KG machinery: the Cairn knowledge graph +
promotion taxonomy (#24-27), the settlement tiers (#63), `knowledge.recall`/`knowledge.horizon`
(application-semantics entries), the promotion event shape (content-addressed + replayable);
(4) the #132 wave-observability contract v1.2 (LANDED — the cross-deployment liveness honesty
posture: local-only v1.0 with remote/stale deferred; this contract's knowledge-side equivalent
must compose) and the #69 REPL-realization contract v1.1 (tiered objects — the knowledge tiers
they ride).

## The contract must decide

- **The shape (a/b/c or a composition).** Pick and justify. The discipline hint: promotion
  events are content-addressed and replayable, so replication is a PROJECTION, not a merge — no
  merge conflicts, no two-writer problem (the single-writer lease law holds per root). If (a):
  the designated-primary mechanism (how a repo names its primary root; what happens when two
  roots both claim primary — the honest conflict posture). If (b): the recall federation's
  staleness honesty (a federated answer names its source root + epoch lag — event-seq anchored,
  never wall time).
- **What federates (and what NEVER does).** Project-persistent (promoted) knowledge federates;
  task-ephemeral and workflow-ephemeral NEVER cross roots (the tier law from #69); candidacy
  queues stay local (a settlement ritual reviews local evidence only). Pin the boundary.
- **The authority posture.** A federated recall is a READ — never an authority input (no
  gate, no verification, no settlement may consume federated knowledge as evidence; it's
  orientation, UNTRUSTED-framed like every worker-facing lane).
- **The descriptor seam (c).** If the PKG-1 descriptor names a shared knowledge root, pin the
  field (closed schema), the containment check, and the default (absent = per-root local,
  today's exact behavior).
- **Refusal vocabulary + acceptance pins (red-first)** per decision.

## Laws + deliverable

Ring-2 form. No clocks; every citation verified (`grep -an`/`sed -n` on the two NUL files);
sorted-key literals ACTUAL order; `localeCompare` banned. Cross-reference (do not re-spec):
#24-27, #63, #68, #69, #132. Deliverable: ONLY
`docs/reference/evidence/cross-deployment-knowledge-2026-08-07/cross-deployment-knowledge-contract.md`
(v1.0 DRAFT with the verification HEAD).
