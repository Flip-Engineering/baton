# #72 RED-TEAM BRIEF — adversarial attack on the prescriptive-doctor contract v1.0

You are the ADVERSARIAL RED TEAM for `prescriptive-doctor-contract.md` (v1.0, same dir — issue
#72, warn on the footguns before they bite). Read it FULLY, then attack:

1. **Re-verify every citation** (`grep -an`/`sed -n`; NUL files: `application.mjs` +
   `coordination-store.mjs` only) — a wrong citation is an automatic blocker. The footgun
   catalog's anchors (the campaign receipts) must resolve.
2. **The warning catalog** — attack each detection read: can a detection give false-positive
   noise (a warning that cries wolf — operators learn to ignore ALL warnings; the catalog must
   pin the precision law)? Can a detection be expensive (a census scan on every doctor call —
   the cheap-local-read law)? Can a threshold be wrong in both directions (too early AND too
   late)? Pick the two most gameable warnings and show the failure.
3. **The severity/surface model** — can a prescriptive warning ever BLOCK (it must never)?
   Does the render compose with #103's briefing field (not duplicate it)? CLI/MCP parity?
4. **The action link** — find a warning whose remediation is wrong or stale (a named verb that
   doesn't fix its cause — the #136 class).
5. **Credential TTL detection** — the metadata-only law: can any warning path leak token
   material (never)? Is TTL staleness read honestly (issued-at metadata, not wall-guesses)?
6. **Refusal/observability vocabulary + acceptance pins + open questions** — each verdict'd.

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(what + why + concrete fix). Write ONLY
`docs/reference/evidence/prescriptive-doctor-2026-08-12/contract-redteam.md`. Laws: no clocks;
every citation re-verified at the current HEAD.
