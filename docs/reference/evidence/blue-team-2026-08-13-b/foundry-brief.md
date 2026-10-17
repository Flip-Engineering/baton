# BLUE-TEAM FOUNDRY wave-b — shared frame (multi-member suite-attack workflow, 2026-08-13)

Every member reads this first. This wave BLUE-TEAMS the five wave-c red-first suites — one
per row. The suites pin the fold-b contracts (#170 DSL · #163 quiescence · #165 launch
validation · #167 readiness honesty · #146 seat telemetry). They are the campaign's acceptance
machinery: a suite that a wrong implementation can pass is worse than no suite, because it
manufactures confidence. The #170 suite gates the campaign's next serialized impl — its row
gets the deepest pass.

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

- `row-bt170` → `impl/test/workflow-dsl-red.test.mjs` → `blueteam-170.md` (v4-pro seat — the impl gate)
- `row-bt163` → `impl/test/quiescence-completion-red.test.mjs` → `blueteam-163.md`
- `row-bt165` → `impl/test/launch-validation-red.test.mjs` → `blueteam-165.md`
- `row-bt167` → `impl/test/readiness-honesty-red.test.mjs` → `blueteam-167.md`
- `row-bt146` → `impl/test/seat-telemetry-red.test.mjs` → `blueteam-146.md`

Each row's contract lives at the path named in the suite's header comment (Authority line);
its fold/red-team reports are in the same evidence dir. Reports land in
`docs/reference/evidence/blue-team-2026-08-13-b/`.
