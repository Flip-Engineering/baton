## Verdict
CK9 is not green yet.

The current commit `2fb8872` materially improves deterministic crash-window handling against `spec/phase11/coordination-knowledge.md`, especially around follow-up/recovery refinement failure, post-merge authority batching, and accepted-input single-consumer release. But one major replay-authority gap remains, so this gate should stay red even if focused tests are currently green.

No finding:
- `impl/src/coordinator.mjs` records pre-effect intent before the external action for local integration (`integration.requested` before Git at `:1047`), publication authorization (`publication.authorized` before publisher at `:2005`), and follow-up refinement intent (`follow_up.requested` before adapter prompt at `:1331`). That matches the pre-effect ordering required by `spec/phase11/coordination-knowledge.md`.
- `impl/src/coordinator.mjs:1362-1372` and `:968-989` preserve the prior durable terminal task, record `control.refinement_aborted`, quarantine the transport, and replay the worker as `orphaned` when refinement materialization fails after native advancement. The focused coverage in `impl/test/phase11-persistent-sessions.test.mjs` exercises both follow-up and recovery variants.
- `impl/src/coordinator.mjs:2135-2145` commits accepted question/approval delivery as single-consumer even when the authoritative append fails, which is the correct bounded-ambiguity behavior for an already-accepted native response.

## Crash-window matrix
No finding:
- Pre-effect intent ordering: satisfied for follow-up, recovery attach, integration, and publication authorization. Evidence: `impl/src/coordinator.mjs:920`, `:1007`, `:1047`, `:2005`.
- Bounded post-effect ambiguity for local integration: satisfied. `impl/src/coordinator.mjs:1087-1111` logs operational `integration.completed` after merge, and `impl/src/coordination-store.mjs:407-425` commits decision, driver record, and accepted artifact in one append batch. Replay checks the full tuple in `impl/src/coordination-store.mjs:385-405`.
- Restart closure: largely satisfied. `impl/src/coordinator.mjs:2870-2891` and `:3032-3039` replay integrated/publication state conservatively and mark native-session workers `orphaned` rather than presenting them as live. This is aligned with the spec requirement to fail closed after ambiguous live faults.
- Accepted question/approval single-consumer behavior: satisfied in code. `impl/src/coordinator.mjs:2061-2062` clears pending ownership, and `:2135-2145` resolves the reservation on append failure instead of hanging or redelivering.
- Refinement abort/replay and runtime cleanup: satisfied for the reviewed seams. `impl/src/coordinator.mjs:973`, `:989`, `:1369`, and `:1620-1623` kill or quarantine the transport and remove runtime scope after recovery/refinement failure.
- Post-merge Git safety: satisfied for the reviewed deterministic gate. `impl/src/coordinator.mjs:1018` explicitly keeps integration local-only, and `:1047` prevents Git merge when the durable intent append fails.

Major finding:
- Publication replay authority is still under-verified. The spec requires replay to accept `publication.completed` telemetry only when the atomic authority record exists, including the mapped evidence, promoted decision, adjacent paired `driver.recorded`, shared batch lineage, task identity, and matching payload. `impl/src/coordination-store.mjs:427-446` does check both the promoted decision and the paired `driver.recorded` event. But `impl/src/coordinator.mjs:2879-2884` depends on that helper only during replay of operational logs; the focused tests shown in `impl/test/phase11-acceptance-integration.test.mjs` prove the no-authority and post-effect append-failure cases, not the asymmetric case where a corrupted coordination stream keeps `knowledge.promoted` but loses `driver.recorded`. Because the store helper is the only guard here, CK9 is still not fully falsified at the seam the spec calls out most strongly: a corrupted or partially reconstructed authority batch after publication.

Minor finding:
- The focused tests demonstrate accepted-delivery crash-window handling for one input class, but the review evidence collected here does not show an equally explicit assertion for both public single-consumer surfaces after native acceptance. The shared code path suggests parity, but the gate should prefer explicit seam tests over inference.

## Remaining major findings
Major:
- `impl/test/phase11-acceptance-integration.test.mjs` does not prove the strongest publication corruption case demanded by `spec/phase11/coordination-knowledge.md`: operational `publication.completed` present, mapped evidence present, and a malformed authority batch that does not satisfy the full paired decision-plus-driver tuple. The implementation path in `impl/src/coordination-store.mjs:427-446` looks correct, but CK9 should not be called green until that exact replay seam is adversarially locked with a focused test.

Minor:
- `docs/26-full-system-goal.md` still contains broader missing product work around hardened acceptance/integration, richer persistent-session recovery, and wider capability surfaces. Those are not CK9 blockers by themselves. This review is a deterministic crash-window gate, not a claim that Phase 11 or the product goal is complete.

## Required next actions
1. Add a focused CK9 publication replay test that synthesizes the asymmetric authority/corruption case, not just the clean no-authority case: operational `publication.completed` exists, but replay must still return `publication === null` unless the exact paired authority tuple survives.
2. Keep CK9 red until that replay seam is explicitly test-locked, because green focused tests alone are not sufficient evidence for the post-effect publication authority claim in `spec/phase11/coordination-knowledge.md`.
3. Preserve the current follow-up/recovery orphaning and integration authority repairs; those reviewed seams are directionally correct and should not be weakened while closing the remaining publication replay gap.
