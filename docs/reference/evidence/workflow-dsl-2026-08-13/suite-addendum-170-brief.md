# ROW BRIEF — suite-addendum-170: the red-first rows for the #170 DSL PACKAGE's folded-in items

(Attempt D note: re-driven after attempts a–c died to the interpreter's spawn-window race
(#199) and the member-task id collision (filed separately) — this line changes the brief's
content digest so the re-drive mints a fresh member task. Disregard for content purposes.)

Read the suite law first (it binds you): red-first (every capability row fails at a NAMED
stage at HEAD; PIN rows green) · hermetic (mkdtemp + after-cleanup, no network/providers) ·
no clocks as controls · namespace imports for invented surfaces · sorted-key literals ACTUAL
order · `localeCompare` banned · `watchdog.stallMs: 60_000` + comment in fixtures · no
absolute line-window anchors · your `[attempt: <salt> suite-addendum-170]` line VERBATIM in
the first five lines of BOTH deliverables.

Your suite: `impl/test/workflow-dsl-package-red.test.mjs` (NEW — the package addendum; do NOT
touch `workflow-dsl-red.test.mjs`, whose attempt header is sacred). Mirror its idioms
(fixture style, stage naming `stage: <name>`) and the wave-observability/control-surface
suites' seams.

## The five fix specs (your row inventory — each becomes RED rows + PIN rows)

**#183 — `wave_already_terminal` refusal.** At HEAD: `waves.start` with an idempotency key
whose wave is terminal silently replays the prior wave (`waves.start` dedupes on the key).
The fix: a terminal-wave key refuses with the typed code naming the prior waveId, its
verdict, and the next action ("re-key to re-drive"). Rows: drive a minimal wave to terminal
(fixture: two marker-adapter members), re-start with the same key → RED asserts the refusal
code + the {priorWaveId, verdict} payload (at HEAD the replay succeeds, so the row fails at
`stage: terminal-replay-not-refused`). PIN: a LIVE wave's same-key call still returns the
live wave (dedupe preserved).

**#176 — waves.\* authority closure.** At HEAD: `waves.start/run/stop/send/progress/list`
dispatch BEFORE the recursive-session gate (`application.mjs` — NUL discipline: grep -an /
sed -n only; the dispatch block comments admit it); `_refuseCoordinatorAuthority` covers only
start/run/stop and only `worker:`-seat principals. The fix: all six waves.* verbs pass the
gate; a lease-bound principal's `waves.send` refuses with the typed authority code. Rows:
per-verb authority attempts by a session-authority principal (RED at
`stage: pre-gate-dispatch`); PIN: the eight facade direct ports keep their own `_authorize`
(unaffected); PIN: an authorized orchestrator principal's waves.* calls succeed.

**#171 — deliverable pre-seeding.** At HEAD: members must hand-copy the `[attempt: salt role]`
line into deliverables (0/5 compliance on a real wave). The fix: at spawn, the driver
creates each member's declared report file containing the attempt header — echo becomes
scaffold. Rows: start a wave with a declared report path → after spawn and BEFORE the member
writes, the file exists with the verbatim `[attempt: <salt> <role>]` first line (RED at
`stage: preseed-absent`); PIN: a member appending below the header preserves it; PIN: the
harvest's marker check passes on the pre-seeded file even if the member writes nothing else.

**#180 — the `verification` directive.** At HEAD: the resident's verifier is a deployment-wide
`command: 'true'`. The fix: the DSL grammar carries a closed `verification` directive
(`none` / `suite:<path>` / `gate`), admission validates it (unknown profile refuses
`workflow_spec_invalid` naming the field), and the member outcome projects `verifiedBy`.
Rows: compile a wavefile with `verification suite:impl/test/x.test.mjs` → IR carries the
profile (RED at `stage: verification-directive-unknown`); a bogus profile refuses; a member
outcome carries `verifiedBy: 'suite:…'` after the verifier runs. PIN: the default (no
directive) inherits the deployment's verifier unchanged.

**#195 — the adapter-contract discipline.** Three legs: (a) the Definition role declared —
the adapter contract as a named artifact (source-scan row: an exported Definition shape the
registry checks against); (b) the pre-execute gate — a named-capability refusal at the
existing `_authorize` seam extended to the waves.* verbs (pairs with #176's rows; keep this
leg registry-level: the gate's capability list includes the waves.* verbs); (c) canonical
output declarations — capability cards declare canonical output shapes, machine-checkable
(RED: a card without a declaration refuses registration, `stage: canonical-output-missing`).

## Deliverables (edit ONLY these)

1. `impl/test/workflow-dsl-package-red.test.mjs` (new).
2. `docs/reference/evidence/workflow-dsl-2026-08-13/suite-addendum-notes.md` — row inventory +
   stage table + both measured splits + judgment calls.

Re-run the split TWICE; both deliverables carry your attempt line verbatim in the first five
lines. Judgment calls recorded; authority-class ambiguity → DECISION_REQUEST with options.
