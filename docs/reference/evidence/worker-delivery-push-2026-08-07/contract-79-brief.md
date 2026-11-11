# #79 CONTRACT BRIEF — push attention + verdicts to the WORKER's own down-channel

You are drafting the implementation contract for issue #79 (worker-side delivery push). Read
fully, in order: (1) the issue — `gh issue view 79`; (2) the downstream evidence —
`docs/reference/evidence/worker-feedback-2026-08-02/feedback-worker.md` §1.3/§2.2 (the convergent
finding: write-failure attention #62 and the sanitized gate verdict TG4 are RECORDED
orchestrator-side but never PUSHED to the judged worker); (3) the BD3-C message lane artifacts
(`docs/reference/evidence/bidirectional-v3-2026-08-02/` — the natural home; the delivery lane
rides it); (4) the current machinery: the attention inbox (#10-era — `attention` on status(),
`messages.mjs` ATTENTION_TYPES), the next-turn context assembly (`impl/src/adapter.mjs` — where
the brief/continuation context is composed), the wrapProse/UNTRUSTED framing discipline
(`grep -an wrapProse impl/src/*.mjs`), the sanitized verdict shape ({gate, detail} — TG4,
`referee.mjs`/`coordinator.mjs`).

## The contract must decide

- **The delivery seam**: the worker's next-turn context carries its pending attention items
  (bounded, wrapProse-framed, UNTRUSTED — the same discipline as every worker-facing lane). Pin
  WHERE in the assembled context the block lands and its byte budget (bounded; the frame
  economics law #89 — no content caps at the wire, shape-only: the bound is on ITEM COUNT and
  the overflow is a digest-cited spill, not a truncation).
- **What qualifies for push**: attention items ADDRESSED to that worker (scratchpad_write_failed
  #62, the sanitized gate verdict, decision answers, orchestrator messages already delivered by
  the lane) vs orchestrator-only items (never pushed — name the excluded kinds). Addressing is
  by worker identity, never content-matching.
- **Delivery receipts**: a pushed item receipts (durable, replay-derived); a delivered-then-read
  distinction if the wire supports it, honestly absent if not.
- **Dedup/idempotency**: an item pushed at turn N is not re-pushed at N+1 unless still pending —
  keyed how? (the attention item's durable id; replay-safe).
- **The verdict push (TG4)**: the sanitized {gate, detail} verdict reaches the judged worker's
  next turn — the shape is the already-sanitized one (digests+counts, NEVER raw paths/tails);
  the worker's correction loop closes with evidence.
- **Refusal vocabulary + acceptance pins (red-first)**: push delivery, dedup, byte/count bounds,
  the never-pushed kinds, the verdict shape.

## Laws + deliverable

Ring-2 form (ground truths → decisions → refusal vocabulary → acceptance pins → open questions).
No clocks; every citation verified (`grep -an`/`sed -n` on the two NUL files); sorted-key
literals ACTUAL order; `localeCompare` banned. Cross-reference (do not re-spec): #62, #61, #64
(TG4), #68, #75 (BD3-C), #86/#89 (frame economics), #10. Deliverable: ONLY
`docs/reference/evidence/worker-delivery-push-2026-08-07/worker-delivery-push-contract.md`
(v1.0 DRAFT with the verification HEAD).
