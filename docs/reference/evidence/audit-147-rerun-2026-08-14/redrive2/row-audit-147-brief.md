# ROW BRIEF — row-audit-147: the control-surface audit re-run (#147 follow-up)

The first #147 audit (the control-surface AX audit) predates the DSL package (#170), the
eventsView fix (#210), the honesty package's partial landing, and the glm-5.3/ceiling work.
Re-run it against CURRENT master and produce the delta: which of its findings still bite,
which are closed, and what the new surface state introduces. Include the attempt-echo
requirement (every claim re-verified THIS run — quoted commands and outputs, not carried
from the prior audit).

**Read first:** the prior audit's artifacts (find them under docs/ or reviews/ — grep for
147), `impl/CLI.md` + `impl/MCP.md` (taught surface) vs `impl/src/application-semantics.mjs`
+ the northbounds (admitted surface), and `impl/scripts/surface-conformance.mjs` (run it).

**Your file partition:** `docs/reference/evidence/audit-147-rerun-2026-08-14/**` ONLY.
Read-and-run only outside it. No code edits anywhere.

**Deliverable:** `audit-147-rerun.md` — the findings table (prior finding → still-bites /
closed-with-evidence / moved), NEW findings since, and a prioritized list. Every claim cited
(command + output, or file anchor). `[attempt: <salt> row-audit-147]` verbatim in the first
five lines. DECISION_REQUEST on authority-class ambiguity.
