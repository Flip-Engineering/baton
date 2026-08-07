# #80 SUITE BRIEF — red-first suite for the folded TG3-window contract v1.1

You are drafting the **red-first acceptance suite** for the folded TG3-window contract. Read
fully, in order: (1) `tg3-window-contract.md` (**v1.1** — source of truth; NOTE the explicit
depending-on-#67 posture — the rows that target #67's machinery are TARGET-STATE rows and must
fail at named target-state stages, matching the #114-B3/#97 precedent); (2) `contract-fold.md`;
(3) `contract-redteam.md`; (4) idioms: `impl/test/trust-gate-steering-red.test.mjs` (the TG3
cycle's own suite) and the target-state row idiom in
`impl/test/workflow-as-data-red.test.mjs` (the depending-on rows).

## Coverage (from the v1.1 acceptance pins)

- **The evidence-answer classes** — each class the contract names (the verified dispatch/start
  chain: `turn/start` response, `turn/started` notification, the queue evidence) answers the
  cycle; a faked or zombie answer does not (the discrimination rows).
- **The expiry disposition** — a window that expires with zero evidence receipts the outcome so
  the #55-class incident is debuggable; a provider-queued healthy-slow worker is NEVER
  final-evaluated as unanswered by a clock alone (the control-law row).
- **The subsumption honesty** — rows composing with #67 v1.1 machinery are target-state rows
  failing at named depending-on stages at HEAD.
- **TG6 compatibility** — no answer class credits a content-free write (the distinct-digest
  class holds).
- **Refusals/observability** — every code the contract names, typed, surface-constant.

## Suite law

Red-first; namespace imports; hermetic (mock adapters, mkdtemp, test.after, no network); run
TWICE from the repo root, record the stable split; header carries the row inventory + stages +
invented signatures + verified split; sorted-key literals ACTUAL order; `localeCompare` banned;
no clocks; NUL discipline.

## Deliverables (edit ONLY these)

`impl/test/tg3-window-red.test.mjs` ·
`docs/reference/evidence/tg3-window-2026-08-07/suite-draft-notes.md`.
