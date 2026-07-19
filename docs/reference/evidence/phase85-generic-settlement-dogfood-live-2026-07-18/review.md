# Adversarial review — context map partition 3/5

## High — Context-effect settlements have no legacy evidence path during replay

`_validateContextEffectCallSettlementPayload` accepts an `integrity` flag but unconditionally requires `evidence.schemaVersion === 4`, always requires the completed-state lineage fields, and always invokes `_validateContextEffectResultLineageEvidence` for a completed result. In contrast, the immediately preceding map validator admits its pre-lineage evidence schema only during integrity replay, selects the matching field set, and runs lineage validation only for the current schema.

Consequently, a durable context-effect settlement admitted under the pre-v4 evidence schema cannot be replayed after this upgrade: unchanged child identities, provider results, cleanup receipt, output reference, and settlement digest still fail as `context_call_settlement_integrity`. This turns a compatible historical result into apparent corruption and prevents recovery from preserving its exact result and cleanup truth. The failed-result path is also affected even though it carries no output-lineage fields.

Mirror the map path's compatibility boundary: accept the legacy context-effect evidence schema only when `integrity` is true, derive the exact evidence field set from that schema, and validate output lineage only for schema 4. Keep live settlement admission v4-only, and add completed and failed replay fixtures that prove legacy artifacts pass while any result, cleanup, or reference mutation still fails.

Source: immutable partition `context-partition:d5835703f9aa04c8d315e19d8f90e216d7bf226772edd4e619e61f36d0e1cf38` (`impl/src/coordination-store.mjs`, bytes 405504–417792; digest `661a7ea7feb5817e66d8f093a9773f80b08c916de2443097b6225d306b08e556`).
