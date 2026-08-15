# IMPL_RESULT_ACCESSOR-VERIFY v1

[attempt: 82a25165-1d3a-43c9-ba67-f6bce7aadcd8 coordinator]
wave: impl-result-accessor-2026-08-14-wave-d (redrive3)
verifier: coordinator (remaining member, pinned #175 semantics)
verified: 2026-08-14

## VERDICT: <PENDING — fill on row settle: sound | needs-fold with blockers>

## Signal status

signalOnMembersDone row-result-accessor (wavefile redrive3/impl-result-accessor.wavefile). Per
#174 law verified on disk across sibling worktrees ../../wt/ws-*/; silence is not death — read
the row's notes file. Row worktree: ../../wt/ws-db1eda661530ebcdd657aad3ed8680d9
(row process cwd confirmed 2026-08-14 17:03 PDT).

NOTES-PATH DISCREPANCY (recorded for the evidence trail): the wavefile harvest directive
pins the row report at redrive3/notes-row-result-accessor.md (wavefile line 16/23), while the
row brief (line 18) tells the row to write .../impl-result-accessor-2026-08-14/
notes-row-result-accessor.md (no redrive3/). The row follows its brief; both paths are under
watch. If the row lands only the brief path, the harvest directive misses it — flag to operator.

<fill: row settled / notes file content / deadline exceeded>

## Measured acceptance counts (run from repo root)

### Primary suite — impl/test/harvest-accessor-red.test.mjs (sha256 f9e6f057…, immutable)
<fill after run>

### Adjacent suites
- wave-observability-red: 30/30 at base (sha d32c7f34…)
- waves-list-scaling-red: 1/1 at base (WLS-1, sha 9e1ac2d8…; brief's "RED-by-design" caveat does
  not bite at this base — green-unchanged expected)
- event-log-read-scaling-red: 2/2 at base (sha 2bf46b7d…)

## Baseline (measured before row landing)

- Primary suite RED at base: A1–A4 dispatch rows fail `application_command_unavailable`;
  N2 fails `application_context_invalid`; N1 fails `application_command_unavailable` where
  the suite pins `application_unauthorized`.
- Base MCP surface: 37 application tools / 88 combined (node-measured at base commit).
  Suite H1 pins 35 / 86 ("exactly 33 + the two" / "exactly 84 + the two"). Live base carries
  four stowaway tools beyond the suite's 33: baton_waves_start, baton_waves_stop,
  baton_workstream_notify, baton_workstream_stop. → **H1 exact-count pins are unsatisfiable by
  an additive row** (perfect impl lands 39/90). See DECISION_REQUEST.

## Spot-audit — two stages against the code
<fill>

## Not green and why
<fill>

## DECISION_REQUEST — authority-class ambiguity (and H1 count drift)

The suite (immutable) and the row brief (additive-only, application-cli.mjs forbidden) cannot
both be satisfied:

1. **CLI verb rows need the forbidden file.** I1-cli-parse and I3-cli-web import
   `parseBatonCli` and `CLI_WEB_COMMANDS` directly from `impl/src/application-cli.mjs`
   (suite lines 43, 885–930). I1 pins `run resultpin RUN_ID` / `waves harvest` parse shapes;
   I3 pins the two keys in `CLI_WEB_COMMANDS`. Both require editing application-cli.mjs — the
   one file the row brief forbids touching. I2 (negative) and I5 (episode) are green guards on
   the same parser.
   Options:
   - (A) fold: redrive a wave whose row brief grants CLI authority for the I1/I3 slice.
   - (B) conclude partial: ports/projection/harvest/MCP/registry green at this wave; CLI verb
     rows documented as blocked by authority split.
   - (C) operator disposition: extend this row's scope to application-cli.mjs.

2. **H1 exact-count drift.** H1 pins ordinary=35 / combined=86 against a base the suite
   assumed to be 33/84. Live base is 37/88 (four post-drafting tools). An additive row cannot
   make the exact-count assertions pass. Options:
   - (A) fold: re-baseline H1's count pins (operator-authorized suite touch) in a fold wave.
   - (B) conclude: H1 counted-rows assessed on membership + schema assertions, with the count
     delta documented as a suite/base drift defect.
   - (C) operator disposition on which inventory (suite pin vs regenerated docs) is
     authoritative.

<fill: coordinator recommendation>
