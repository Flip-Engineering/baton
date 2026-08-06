# #114 SUITE-FOLD BRIEF — fold the blue-team findings into the suite (and the contract where the report says the CONTRACT is wrong)

You are folding a blue-team report into the workflow-as-data red-first suite. Read fully, in
order: (1) `suite-blueteam.md` (verdict NEEDS-FOLD; row-breaking F1/F2/F3/F5/F10, majors
F4/F6/F7/F8/F9/F11, minors F12-F16 — each finding carries its concrete fix); (2)
`impl/test/workflow-as-data-red.test.mjs` (your primary edit target); (3)
`workflow-as-data-contract.md` (v1.1 — edit ONLY where the report's fix says the CONTRACT is
wrong, e.g. F2's `report` member field; if you edit it, bump the header to v1.2 with a one-line
note); (4) `suite-draft-notes.md` (update the row map + measured split).

## Laws for the fold

- The report's concrete fixes are the default; deviate only where the fix contradicts the v1.1
  contract (say so per finding in the fold summary).
- F1 (false-red) and F3 (shallow-green) are the priority: every W3 policy row must observe the
  REAL wire/store call, never a self-authored `receipt.steering[]` event; the MessageDeafAdapter
  oracle must be capable of producing the undelivered state the row asserts.
- After folding, the suite must stay red-first: every non-guard row RED at a named stage at HEAD
  (the lane is still unimplemented). Run `node --test impl/test/workflow-as-data-red.test.mjs`
  from the repo root TWICE; record both splits in the notes. New rows get named stages.
- Campaign law: no clocks; sorted-key literals in ACTUAL sorted order; `localeCompare` banned;
  NUL discipline (`grep -an`/`sed -n` on application.mjs + coordination-store.mjs only);
  hermetic (mock adapters, mkdtemp only, test.after cleanup, no network).

## Deliverables (edit ONLY these)

`impl/test/workflow-as-data-red.test.mjs` ·
`docs/reference/evidence/workflow-as-data-2026-08-06/suite-draft-notes.md` ·
`docs/reference/evidence/workflow-as-data-2026-08-06/suite-fold-2.md` (finding → resolution map —
every F-number from the blue-team report resolved or explicitly deferred with the reason) ·
`workflow-as-data-contract.md` (v1.2 ONLY if F2-class contract mismatches require it).
