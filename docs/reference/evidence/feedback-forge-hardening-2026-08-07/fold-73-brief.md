# #73 FOLD BRIEF — fold the red-team report into the forge-hardening contract (v1.0 → v1.1)

You are folding an adversarial red-team report into the forge-hardening contract. Read fully, in
order: (1) `contract-redteam.md` (NOT FOLD-READY — the numbered blockers in §7, each with its
concrete fix); (2) `feedback-forge-hardening-contract.md` (v1.0 — your edit target).

## The blockers, headlined (fold ALL per the report's fixes)

1. **B1 — D1 reads a nonexistent field.** The Candidate's `verification` projection has no
   `worker`; the referent lookup must read `candidate.evidence.verification.worker` /
   `.workerSeq` (and the G4 anchor corrects to `:6247-6252`). As written `derived` was always
   null and GREEN-2 impossible.
2. **B2 — D3's closed-literal contradiction.** Pin ONE model: `derived` recorded on every packet
   (`true`/`false`, `derived === true` the discriminator) OR absence-means-authored with the
   exact-set check named — the report's fix governs.
3+. **The remaining numbered blockers** per the report (cross-run referent laundering,
   stale/superseded referents, the D2 coaching smuggle check, surface constancy) + the
   open-question verdicts.

## Laws + deliverables

No clocks; every citation verified (`grep -an`/`sed -n` on the two NUL files); sorted-key
literals ACTUAL order; `localeCompare` banned. Header to **v1.1** with the fold note. Edit ONLY:
`feedback-forge-hardening-contract.md` (v1.1) + `contract-fold.md` (blocker → change map, all
items + open questions) — this directory.
