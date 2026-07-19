# Adversarial review: context map unit 4/5

## Finding

### [P1] Reject unknown call kinds instead of routing them as legacy maps

`contextCallSettlementChildren()` and `contextCallArtifacts()` classify only the exact `baton.context_effect_call` kind as generic and send every other kind through the map settlement, cleanup, and provider-result validators. The map artifact check then binds evidence only to `callId` and the stored `callDigest`, not to `call.kind`; `contextCompletedCallSource()` repeats the same fallback by requiring map evidence v3 for every non-effect kind. An unsupported, future, or corrupted kind with otherwise map-shaped artifacts can therefore pass artifact verification and be replayed under the legacy map contract instead of being refused as an unknown route, losing exact route, cleanup, and lineage truth. Use an exhaustive discriminator for the supported effect and map kinds and raise an integrity/refusal error for every other value before selecting validators or constructing a replay source.
