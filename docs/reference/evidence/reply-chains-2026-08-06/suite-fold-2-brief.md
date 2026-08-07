# #105 SUITE-FOLD BRIEF — fold the blue-team findings into the reply-chains suite

You are folding a blue-team report into the reply-chains red-first suite. Read fully, in order:
(1) `suite-blueteam.md` (NEEDS-FOLD — B1 the E2 alias-row contradiction + the shallow-green
blockers, each with its concrete fix); (2) `impl/test/reply-chains-red.test.mjs` (your primary
edit target); (3) `reply-chains-contract.md` (v1.1 — edit ONLY if a finding's fix says the
CONTRACT is wrong; bump to v1.2 with a one-line note if so); (4) `suite-draft-notes.md` (update).

## Priorities

- **B1 first (green-side blocker):** E2's alias-row oracle contradicts the folded contract —
  delete the three field assertions and assert the contract-correct discriminators
  (`alias: true`, the `<workerId>:<tail>` key shape, NO `inReplyTo`, no phantom root on replay)
  per the report's concrete fix.
- **The four shallow-green blockers** per the report — every fix implemented as written (or
  deviated only where the fix contradicts v1.1, named in the fold summary).
- **Remaining findings** per the report, resolved or explicitly deferred with the reason.
- Suite stays red-first: PINs green, capability rows RED at named stages. Run twice from the
  repo root, record both splits. No clocks; sorted-key literals ACTUAL order; `localeCompare`
  banned; NUL discipline (`grep -an`/`sed -n` on the two NUL files); hermetic.

## Deliverables (edit ONLY these)

`impl/test/reply-chains-red.test.mjs` ·
`docs/reference/evidence/reply-chains-2026-08-06/suite-draft-notes.md` ·
`docs/reference/evidence/reply-chains-2026-08-06/suite-fold-2.md` (finding → resolution map) ·
`reply-chains-contract.md` (v1.2 ONLY if a finding requires it).
