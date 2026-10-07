# ROW BRIEF — row-gate-digest: the machine-readable gate failure digest (#149)

Today acceptance is hand-tabulated log archaeology: the full gate's output is prose and the
orchestrator classifies expected-red vs unexpected failures BY HAND (a 32-file manual
classification happened this campaign). The gate must emit a machine-readable digest:
per-suite {file, stage, code-class} failure records, a stable failure-set hash, and a
diff vs the accepted baseline (new failures / missing failures / unchanged) as DATA.

**Read first:** `impl/scripts/run-suite.mjs` (the runner — its output shape today), and any
existing red-first suite for the stage idioms. The operator's bar: failure→issue
classification is machinery, not diligence.

**Your file partition:** `impl/scripts/run-suite.mjs` +
`docs/reference/evidence/impl-gate-digest-2026-08-14/**`. Nothing else. Never edit acceptance
suites. The digest must be DETERMINISTIC (sorted keys, no clocks, no absolute paths — repo-relative).

**Acceptance:** `node impl/scripts/run-suite.mjs --digest` (or the flag shape you choose —
name it in your notes) writes/prints the digest; a seeded-failure self-check (run against a
fixture with a known failure set) shows new/missing/unchanged classified correctly; the
runner's default human output is unchanged. Notes:
`docs/reference/evidence/impl-gate-digest-2026-08-14/notes-row-gate-digest.md` —
`[attempt: <salt> row-gate-digest]` verbatim in its first five lines. DECISION_REQUEST on
authority-class ambiguity.
