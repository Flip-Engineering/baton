# Phase 84 Context successor-Wave review — partition 1/6

Scope: only immutable partition `context-partition:ff135acc4fd6f16b200fd78cf90943cb087091bc52a5c1f176dba07b0357a300`, bytes 0–12288 of `docs/reference/evidence/phase84-context-successor-wave-live-2026-07-18/run.mjs`.

## Release blocker: exact-route authority is accepted without complete attestation

The run selects an exact `ax-adversary` harness/model/effort route as `mapRoute` (`run.mjs:59-66`) and explicitly claims to audit exact orchestrator-selected routing (`run.mjs:69-74`). Its settlement predicate does not prove that authority. Although it compares `child.route` and `attempt.route.requested` with `mapRoute`, it evaluates launch enforcement with `Object.values(attempt.route?.launchEnforcement ?? {})` (`run.mjs:192-196`). A missing, null, empty, or partial object therefore supplies no failing axis. Provider attestation is weaker still: the analogous expression rejects only axes whose state is exactly `mismatched` (`run.mjs:197-198`), so absent axes and any other non-success state also pass.

Consequently, an accepted attempt can satisfy this evidence gate using only the requested/copied route while supplying no complete provider proof that harness, model, and effort actually matched. Baton can therefore certify exact route truth that the partition's evidence does not establish. This is a release blocker, not later reduce/review/verify/RLM work, because it invalidates the current authority claim.

Require both attestation objects to contain the exact required axis set (`harness`, `model`, and `effort`), require every launch and provider axis to have an explicit positive terminal state and the selected value, and reject missing, partial, unknown, or otherwise non-matching evidence. Negative verification should cover absent objects, omitted axes, and non-`mismatched` failure states.
