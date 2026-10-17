# Suite-foundry wave-a LANDING NOTE (top orchestrator, 2026-08-13)

## The headline: the QA's verdicts are overturned by worktree evidence

`suite-qa.md` verdict'd all four rows GAP / needs-fold ("dead row; no suite landed") — wrong,
through no fault of the coordinator's diligence: it checked the only two places a member can
see (its own worktree, master) while the suites sat complete in the ROW worktrees. Filed as
the second instance in **#174** (wave members have no live sibling visibility — the
member-side twin of #157). All four suites exist, are substantial (17–57 KB), carry the
attempt-echo header (#171 law working), and are honestly red-first at HEAD.

## Red-first verification at HEAD (f06004b lineage), per-suite splits

| Suite | tests | pass | fail | reading |
|---|---|---|---|---|
| cli-wave-fidelity-red (#157) | 16 | 8 | 8 | exact design split: 8 PIN rows green, 8 capability rows (A7-1..A7-8) RED with named stages |
| scratchpad-write-red (#158) | 24 | 6 | 18 | capability rows RED incl. A10-1 admission-incoherence (the CLI parser throws on `run.scratchpad.append` — the gap all 4 contract-foundry rows independently found) |
| doc-truth-conformance-red (#159) | 13 | 2 | 11 | R1..R11 conformance rows RED (actual 25 vs expected 31 inventory mismatch — the docs/admission drift is real) |
| error-actionability-red (#160) | 22 | 4 | 18 | W/M/C/X matrix RED; S2 static pin RED by design (cli_invalid thrown but not ledgered — a live conformance finding) |

Failure messages carry NAMED stages (`stage[append-admission-incoherent]`,
`stage: interpreter-phase-null` citing `application.mjs:11785`) — the suite-law
stage-discipline requirement holds. Shallow-greenability spot-checks and per-row PIN
audits are the blue-team stage's job (queued), not re-done here.

## Procedural record

- Deliverables materialized from row worktrees (`ws-809b60bc…`, `ws-29cfc1f0…`,
  `ws-7f686d1d…`, `ws-1d534767…`, QA from `ws-13d13a4b…`) — the wave's own receipt was lost
  to the #173 synchronous-launch client timeout; content-based settle detection (the worktree
  marker waiter) substituted. Both workarounds are filed issues' children (#173, #174).
- The QA file is kept as the honest record of what a dark-channels coordinator concludes —
  its "what the fold stage needs" section is VOID (the suites exist); its suite-law checklist
  (§Suite law, 7 points) stands and binds the blue-team stage.
