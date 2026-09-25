# ROW BRIEF — row-suite-158: the red-first suite for the folded #158 contract

Read `foundry-brief.md` first (the suite law binds you — red-first, named stages, hermetic,
split-twice, the attempt-echo law). Your source of truth:
`docs/reference/evidence/scratchpad-write-2026-08-13/contract-fold.md` (v1.1 — its red-first acceptance section is
your row inventory; every pin becomes a row at its named stage). Also read its
`contract-redteam.md` (the attack surface your rows must discriminate) and the issue
(`gh issue view 158`).

Idioms to mirror: `impl/test/control-surface-truth-red.test.mjs` (surface/conformance style)
and `impl/test/wave-observability-red.test.mjs` (registry style) — pick per your contract's
domain.

Deliverables (edit ONLY these): `impl/test/scratchpad-write-red.test.mjs` ·
`docs/reference/evidence/scratchpad-write-2026-08-13/suite-draft-notes.md` (the row inventory + stage table + the
verified split, with your `[attempt: …]` line verbatim in the header) — and echo the same
`[attempt: …]` line as a comment in the suite file's own header too (the harvest's
attribution check reads it there — #171).
