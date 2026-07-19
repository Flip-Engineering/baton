# Partition 4/5 adversarial review

## Finding: completed schema-v2 map evidence can replay with unverified termination truth

`contextCallArtifacts()` accepts completed non-generic evidence with schema version 2 (`[2, 3]`), but the only direct comparison of `evidence.termination` with `call.result.termination` is inside `outputValid`'s **failed-call** branch. The shared integrity predicate does not compare termination, and completed schema-v2 evidence skips `_validateContextMapResultLineageEvidence()`, which is invoked only for schema version 3. Consequently, a replayed completed schema-v2 settlement can pass this artifact reverification path while its evidence reports termination data different from the settled result. That breaks exact settlement/result truth across the advertised compatibility path.

Require canonical termination equality for every accepted evidence version (or explicitly reject completed schema-v2 evidence), and add a replay test that changes only schema-v2 completed evidence termination and expects `context_map_call_settlement_integrity`.

Grounding: immutable partition `context-partition:addb62713492ad8394903aed5ac917d8cba943ad1c6f6fce1ff1c285b97fe3bb`, `impl/src/coordination-store.mjs`, `contextCallArtifacts()`.
