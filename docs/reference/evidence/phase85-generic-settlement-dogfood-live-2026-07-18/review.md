# Adversarial review — context unit 3/5

## High — Context-effect settlement replay is not evidence-schema compatible

In `_validateContextEffectCallSettlementPayload`, a settlement is rejected unless its referenced evidence has `schemaVersion === 4` and exactly the v4 field set; completed evidence must also contain the new `outputLineageDigest`, `outputLineages`, and `sourceCoordinates` keys. There is no version dispatch or legacy normalization before this check. The adjacent context-map settlement path is schema-aware (it runs result-lineage validation only for evidence schema v3), but the context-effect path has no equivalent compatibility branch.

Consequently, replaying an otherwise intact persisted context-effect settlement whose evidence was written by a pre-v4 deployment is classified as changed settlement artifacts (and as an integrity failure during replay), even though its recorded route, result, and cleanup have not changed. That makes an upgrade unable to reconstruct valid historical coordination state. Validate each supported historical evidence schema with its original field/lineage contract (or perform a digest-preserving migration before replay), then normalize the verified evidence to the current in-memory result.

Grounding: immutable `context-unit:29c5ee2a2aeb35ce16b996a6fc5729cdc2d265f006598b93a32229c65af68a58`, `impl/src/coordination-store.mjs`, `_validateContextEffectCallSettlementPayload`.
