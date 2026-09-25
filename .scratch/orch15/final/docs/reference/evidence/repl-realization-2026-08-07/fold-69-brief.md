# #69 FOLD BRIEF — fold the red-team report into the REPL-realization contract (v1.0 → v1.1)

You are folding an adversarial red-team report into the REPL-realization contract. Read fully, in
order: (1) `contract-redteam.md` (NOT FOLD-READY — 8 numbered blockers in §3, each with its
concrete fix; the per-decision notes carry the detail); (2) `repl-realization-contract.md` (v1.0
— your edit target).

## The blockers, headlined (fold ALL 8 per the report's fixes)

1-2, 7-8. The citation re-anchors (automatic class; re-verify at the fold HEAD).
3. **The workflow tier is not realizable across a multi-run wave as spec'd** — fold the per-member
   fan-out (the shared manifest + binding admitted into EACH member's runId at spawn) or a
   wave-scoped resolution in the D2 seam, and add the R-pin proving a multi-run member's brief
   resolves `repl:shared:<name>@<version>` in its own runId.
4. **The run-authority boundary is not enforced on the shipped cite read** — fold the
   server-derived-runId (the `contextRead` pattern) / typed refusal rule, and name issue #143 as
   the shipped-code fix this contract's R-pins hold (cross-run `repl.cite` refuses by name).
5. **The frame escape** — pin the cited-cell head through the sanitize/control-strip discipline
   (a cell containing `## Pending attention` renders INSIDE the bullet, never as a new section),
   with the R-pin.
6. **The reap-at-close path doesn't exist** — specify the run-close reap of the active-binding
   map (history retained for replay-exact resolution) or reword the tier honestly.
Apply the per-decision notes (D5's provenance gap; D7's #79 dependency posture).

## Laws + deliverables

No clocks; every citation verified (`grep -an`/`sed -n` on the two NUL files); sorted-key
literals ACTUAL order; `localeCompare` banned. Header to **v1.1** with the fold note. Edit ONLY:
`repl-realization-contract.md` (v1.1) + `contract-fold.md` (blocker → change map, all 8 + the
open-question verdicts) — this directory.
