# Adversarial review: context unit 4/5

## Finding: completed legacy map evidence can retain a contradictory terminal state

`_contextCallArtifacts` explicitly requires `evidence.state === 'failed'` for a failed call, but its completed `outputValid` branch only compares `output.items` with `call.result.providerResults`; it never requires `evidence.state === 'completed'`. This is concrete on the map schema-v2 compatibility path: schema versions 2 and 3 are accepted for completed map evidence, while `_validateContextMapResultLineageEvidence` is invoked only for schema 3, so no later check shown in this slice closes the schema-v2 gap.

Consequently, a digest-consistent schema-v2 evidence artifact whose `state` is `failed` (or another value) can be returned by `contextCallArtifacts()` as valid evidence for a call recorded as completed. That makes terminal settlement truth ambiguous during historical inspection/replay even though all reference digests match. Require `evidence.state === 'completed'` in the completed branch for every supported schema, and add a regression case with completed map schema-v2 evidence carrying `state: 'failed'` that must raise `context_map_call_settlement_integrity`.
