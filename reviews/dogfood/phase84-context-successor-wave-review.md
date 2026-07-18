# Phase 84 Context successor-Wave review — partition 1/3

Review basis: only `context-partition:653c3c04238c21a32013b22ba1a648d9debb6c6b1d04e380d218f81e1595fdd2` from `run.mjs` (bytes 0–12288; content digest `856f81f6791ad63718c072e927c20ee1f5bf33ce7b383cd95648db58713d9982`).

## Release blocker: route authority is accepted without complete matched proof

The settlement guard does not establish the claimed exact orchestrator-selected harness/model/effort route. For each child it compares `child.route` and `attempt.route.requested` with `mapRoute`, but its two checks of execution proof are vacuous for absent or partial objects:

```js
Object.values(attempt.route?.launchEnforcement ?? {})
  .some((axis) => axis.state !== 'matched')
Object.values(attempt.route?.providerAttestation ?? {})
  .some((axis) => axis.state === 'mismatched')
```

An absent `launchEnforcement` or `providerAttestation` becomes `{}`, whose values contain no failing axis. A partial object also passes without proving every requested axis. Worse, a provider axis in any state other than the single literal `mismatched` passes, so an unverified or unavailable attestation is treated as sufficient. The surrounding equality checks prove requested/recorded route metadata, not the provider's actual route. Consequently this evidence runner can emit `context_map_completed` and preserve a record that claims exact route truth even when actual harness/model/effort authority was never completely attested.

Require the exact harness, model, and effort axes to be present in both `launchEnforcement` and `providerAttestation`, and require every one to have state `matched`; missing, unknown, or additional non-matched states must fail settlement. Tests were not run, per the mapped instruction.
