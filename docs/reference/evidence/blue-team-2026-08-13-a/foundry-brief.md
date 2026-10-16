# BLUE-TEAM FOUNDRY wave-a — shared frame (multi-member suite-attack workflow, 2026-08-13)

Every member reads this first. This wave BLUE-TEAMS the eight landed red-first suites — one
per row. The suites pin the honesty cluster (#157–#160) and the fold-a contracts
(#155/#156/#161/#164). They are the campaign's acceptance machinery: a suite that a wrong
implementation can pass is worse than no suite, because it manufactures confidence.

## The blue-team law (binds every member)

- **You attack the SUITE, not the contract.** The contract is your map of intent; the suite is
  your target. Every capability row gets the question: "what is the CHEAPEST wrong
  implementation that turns this row green?" Name it per row, or write "none found" with your
  reasoning in one line.
- **PIN rows get the inverse attack:** does the pin actually bite a plausible wrong impl? A pin
  that is green under every mutation you can name is decoration — finding.
- **Verdict per row:** SOUND / SHALLOW (named cheap wrong impl passes) / DECORATIVE (pin bites
  nothing) / BROKEN (red or green for the wrong reason — e.g. the row passes because its
  fixture is inert). Final verdict per suite: ACCEPT / NEEDS-FOLD with the named rows.
- **Re-run the split:** `node --test impl/test/<file>` TWICE from the repo root; both splits
  must match the row's declared notes. Instability = a finding.
- **Law re-check:** named stages on every capability row · hermetic (mkdtemp + after-cleanup,
  no network/provider) · no clocks as controls · namespace imports for invented surfaces ·
  sorted-key literals ACTUAL order · watchdog.stallMs 60_000 + comment · no absolute
  line-window anchors · the verbatim `[attempt: …]` line in the suite header.
- **No edits outside your deliverable.** You may READ and RUN anything.
- **THE ATTEMPT-ECHO LAW (#171):** your `[attempt: <salt> <role>]` line VERBATIM in your
  report's first five lines.
- **Escalation posture:** authority-class ambiguity → DECISION_REQUEST with options; judgment
  calls are yours — record them.

## Row assignments (suite → report)

- `row-bt157` → `impl/test/cli-wave-fidelity-red.test.mjs` → `blueteam-157.md`
- `row-bt158` → `impl/test/scratchpad-write-red.test.mjs` → `blueteam-158.md`
- `row-bt159` → `impl/test/doc-truth-conformance-red.test.mjs` → `blueteam-159.md`
- `row-bt160` → `impl/test/error-actionability-red.test.mjs` → `blueteam-160.md`
- `row-bt155` → `impl/test/cli-silent-start-red.test.mjs` → `blueteam-155.md`
- `row-bt156` → `impl/test/mcp-profile-parity-red.test.mjs` → `blueteam-156.md`
- `row-bt161` → `impl/test/orchestrator-plan-object-red.test.mjs` → `blueteam-161.md`
- `row-bt164` → `impl/test/blind-waits-red.test.mjs` → `blueteam-164.md`

Each row's contract lives at the path named in the suite's header comment (Authority line);
its fold/red-team reports are in the same evidence dir. Reports land in
`docs/reference/evidence/blue-team-2026-08-13-a/`.
