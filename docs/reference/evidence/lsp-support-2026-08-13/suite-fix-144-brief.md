# #144 SUITE-FIX BRIEF — two red PINs (GP-B, GP-C) + the missing draft notes

The glm suite wave left a strong 939-line suite (13 R-rows red at named stages, 8/10 PINs
green) but FAILED before finishing: PIN rows GP-B and GP-C are red, and
`suite-draft-notes.md` was never written. The suite was quarantined to
`docs/reference/evidence/lsp-support-2026-08-13/issue144-lsp-pool-red.PARTIAL.test.mjs` so the
gate stays clean. Your job: diagnose the two PINs against the REAL machinery, fix, home, and
record.

## The two red PINs (both pin EXISTING surfaces — green is mandatory)

- **GP-B** fails at `the freshness digest is content-derived (canonicalDigest), never a clock`
  — the suite asserts `_orientationFreshness` composes its frame via a `canonicalDigest` call.
  Read the real composition (`grep -an "_orientationFreshness" impl/src/*.mjs`, NUL discipline)
  and pin WHAT THE CODE ACTUALLY DOES (the digest call may be named/shaped differently). If the
  contract's §3 D3.3/GT4 description misdescribes the present surface, pin the CODE's truth and
  flag the contract delta in the notes (a v1.2-note candidate) — never edit the contract.
- **GP-C** fails at `prose leaves require untrusted:true` — the suite asserts the closed
  UNTRUSTED_ORIENTATION frame requires `untrusted: true` on prose leaves. Same discipline:
  read the real frame + prose-leaf rule, pin the real behavior, flag any contract delta.

## Then

1. Home the fixed suite back to `impl/test/issue144-lsp-pool-red.test.mjs` (exact name).
2. Write `docs/reference/evidence/lsp-support-2026-08-13/suite-draft-notes.md`: the declared
   split (23 rows: 13 RED / 10 PIN — or whatever the corrected count is, with the per-row
   inventory), the two diagnoses + resolutions, the verified-stable-twice record.
3. Verify from the repo root, TWICE: every PIN green (GP-B/GP-C included), every R row red at
   its named stage. Both splits recorded.

## Laws

Red-first hygiene (a suite with red PINs never lands); NUL discipline (`grep -an`/`sed -n` on
`application.mjs`/`coordination-store.mjs`); no clocks; sorted-key literals ACTUAL order;
`localeCompare` banned. Edit ONLY the suite file (at its quarantined path, then home it) and
the notes.
