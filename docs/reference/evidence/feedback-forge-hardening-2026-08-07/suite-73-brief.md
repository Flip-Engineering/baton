# #73 SUITE BRIEF — red-first suite for the folded feedback-forge-hardening contract v1.1

You are drafting the **red-first acceptance suite** for the folded #73 contract (`run.feedback`
forged-verdict lane). Read fully, in order: (1) `feedback-forge-hardening-contract.md`
(**v1.1** — source of truth; §5 acceptance pins); (2) `contract-fold.md` (the
candidate.evidence.verification.worker referent fix + the one derived-flag model); (3)
`contract-redteam.md` (the attack surface); (4) idioms:
`impl/test/bidirectional-v3-red.test.mjs` (feedback lanes) and
`impl/test/trust-gate-steering-red.test.mjs` (gate/verdict steering cycles).

## Coverage

Derive the row set from the contract's §5 acceptance pins — at minimum: the G2 shape boundary
(a gate-shaped submission is hub-minted or REFUSED, never caller-authored; a coaching-shaped
one is authored — the discriminator is the top-level `gate` string,
`application.mjs:1645-1682`); the forged-verdict refusal (a caller-supplied `{gate, detail}`
that would impersonate a hub verdict refuses typed, `SECRET_SHAPED_TEXT`-guarded); the
referent fix (candidate.evidence.verification.worker binding); the one derived-flag model;
the pre-hardening records' honest replay (the contract's migration pin). Every refusal code
the contract names, typed and surface-constant.

## Suite law

Red-first (capability rows fail at NAMED stages at HEAD; PIN rows green); namespace imports
for invented surfaces; hermetic (mkdtemp, test.after, no network, no real provider spawns);
run TWICE from the repo root, record the stable split in the header (row inventory + stages +
invented signatures + verified split); sorted-key literals ACTUAL order; `localeCompare`
banned; NUL discipline (`grep -an`/`sed -n` on `application.mjs` + `coordination-store.mjs`);
no clocks as controls.

## Deliverables (edit ONLY these)

`impl/test/feedback-forge-hardening-red.test.mjs` ·
`docs/reference/evidence/feedback-forge-hardening-2026-08-07/suite-draft-notes.md`.
