# #79 SUITE BRIEF — red-first suite for the folded worker-delivery-push contract v1.1

You are drafting the **red-first acceptance suite** for the folded worker-delivery-push contract.
Read fully, in order: (1) `worker-delivery-push-contract.md` (**v1.1** — source of truth); (2)
`contract-fold.md` (the citation re-anchors + the per-worker verdict filter); (3)
`contract-redteam.md` (the attack surface); (4) idioms:
`impl/test/workflow-surface-red.test.mjs` (facade staging) and
`impl/test/bidirectional-v3-red.test.mjs` (the message lane).

## Coverage (from the v1.1 acceptance pins)

- **D1 the brief-section seam** — a worker with pending attention gets the `## Pending attention`
  section on its next-turn brief; a worker with none gets NO section (no frame waste); the
  UNTRUSTED wrapProse framing is the shipped discipline (assert the frame, and that
  worker-crafted attention content cannot inject out of it).
- **D2 the item-count bound** — the count bound holds; overflow is a digest-cited spill the
  worker can actually resolve; never a silent truncation.
- **D3 addressing** — worker-identity addressing (an item for worker A never lands in worker B's
  brief; cross-run items never cross); the never-pushed kinds are honored.
- **D4/D5 receipts + dedup** — delivery receipts durable + replay-derived; no double-push after
  a driver restart (the durable id key); the read-posture honest.
- **D6 the verdict push** — the judged worker's next brief carries the sanitized {gate, detail}
  for ITS OWN verdict (never another worker's); the shape is digests+counts (a raw path/tail
  never crosses).
- **Refusals** — every code the contract names, typed, surface-constant.

## Suite law

Red-first (every capability row fails at a NAMED stage at HEAD); namespace imports for invented
surfaces; hermetic (mock adapters, mkdtemp, test.after, no network); run TWICE from the repo
root, record the stable split; header carries the row inventory + stages + invented signatures +
verified split; sorted-key literals ACTUAL order; `localeCompare` banned; no clocks; NUL
discipline (`grep -an`/`sed -n` on the two NUL files).

## Deliverables (edit ONLY these)

`impl/test/worker-delivery-push-red.test.mjs` ·
`docs/reference/evidence/worker-delivery-push-2026-08-07/suite-draft-notes.md`.
