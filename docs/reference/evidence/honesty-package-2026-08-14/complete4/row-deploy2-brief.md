# ROW BRIEF — row-deploy2: the _authorize restrictor legs (own-run predicate + review authority)

The kernel append path and admission tables landed via recovery; the deployment restrictor
legs were truncated by the drain. The acceptance suite is RED at exactly your stages.

**Read first:** `impl/test/scratchpad-write-red.test.mjs` stages A4-1, A4-2, A5-1 (a member
append to a sibling worker:<other> partition refuses at the _authorize seam; the own-run
predicate is ENFORCED — member append to shared/worker:<ownId> of a run other than its own
refuses; local-owner/service-* append to shared ONLY, never a member partition — and the
deployment INSTALLS the restrictor); row-kernel's recovered notes
`docs/reference/evidence/honesty-package-2026-08-14/notes-row-kernel.md` (the D1 write law:
enforcement lives at the surface _authorize seam, never in the kernel fold). Find the
restrictor seam via the suite's anchors (`grep -an` for the cited symbols); the resident
deployment is `impl/scripts/resident.deployment.mjs` (read-only reference for the install
shape).

**Your file partition:** the deployment/restrictor source file(s) the suite's anchors name
(typically `impl/src/deployment*.mjs` or the authorize seam in the application wiring —
ground first, then STAY inside what you name here in your notes) +
`docs/reference/evidence/honesty-package-2026-08-14/**`. Never touch the northbounds,
application-cli.mjs, or the kernel. Never edit the acceptance suite.

**Implement:** the member/review-authority append restrictor per A4-1/A4-2/A5-1, installed by
the deployment; closed refusal vocabulary (`scratchpad_write_refused`-class codes per the
suite's pins — read them exactly).

**Acceptance:** A4-1, A4-2, A5-1 green; the deployment suites green (paste counts).
Notes: `docs/reference/evidence/honesty-package-2026-08-14/notes-row-deploy2.md` with
`[attempt: <salt> row-deploy2]` verbatim in the first five lines.
