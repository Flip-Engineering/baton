# ROW BRIEF — row-telemetry: seat telemetry + readiness honesty (#146)

The suites are your contract: `impl/test/seat-telemetry-red.test.mjs` +
`impl/test/readiness-honesty-red.test.mjs` — RED at HEAD at named stages. Read BOTH in full
first; every stage names its anchor. Origin evidence: static-ready ≠ provider-alive cost the
campaign two failed waves (Grok 402, GLM capacity deaths found only at turn time); "seats"
must be a live, accurate telemetry surface, and a bounded ACTUAL-INFERENCE readiness probe
must back the static card.

**Your file partition:** `impl/src/application-deployment.mjs` + `impl/scripts/baton.mjs`
(the doctor/readiness CLI leg) + any NEW module the suite names (e.g. a readiness/seat
projection — create it where the suite's imports point) +
`docs/reference/evidence/impl-telemetry-2026-08-14/**`. Never touch application.mjs /
workflow-*.mjs / the northbounds (other waves own them this window). Never edit the
acceptance suites.

**Acceptance:** both suites green at every named stage; adjacents green-unchanged:
`deepseek-routes-red` 4/4, `glm-session` 11/11, `adapter` 42/42, `cli-adapters` 24/24 (paste
counts). Notes: `docs/reference/evidence/impl-telemetry-2026-08-14/notes-row-telemetry.md` —
mechanism, anchors, suite counts, judgment calls. `[attempt: <salt> row-telemetry]` verbatim
in its first five lines. Authority-class ambiguity → DECISION_REQUEST with options.
