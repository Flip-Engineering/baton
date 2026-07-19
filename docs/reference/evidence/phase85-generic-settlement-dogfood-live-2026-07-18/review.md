# Partition 5/5 adversarial review

## Finding: unknown call kinds fail open as legacy map settlements

`_settleContextCall` recognizes only `baton.context_effect_call` explicitly and assigns `kind = 'map'` for every other value of `call.kind`. Its availability guard rejects a missing call or an `expectedKind` mismatch, but it never rejects an unsupported stored kind. Consequently, `settleContextCall` (which supplies no `expectedKind`) can route an unknown or future generic context-call kind through map cleanup, map child projection, schema version 1, and `_validateContextMapCallSettlementPayload`. `settleContextMapCall` also accepts such a kind because the fallback classification is already `map`. During mixed-version replay or a future call-kind rollout, this can record a settlement whose route, result/cleanup interpretation, and compatibility schema do not match the admitted call.

The discriminator should explicitly accept the known map and effect kinds and refuse every other `call.kind` before cleanup or payload construction; route-specific entry points should compare against that explicit classification.
