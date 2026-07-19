# Generic Context settlement adversarial review

## Finding — failed generic settlements lose partial-result lineage

`_validateContextEffectCallSettlementPayload` derives `failed` when any child is not accepted,
but it still validates and persists `providerResults` for that mixed terminal result
(`coordination-store.mjs:5880-5924`). The failed evidence schema then requires only `state` and
`termination` in place of `outputLineageDigest`, `outputLineages`, and `sourceCoordinates`
(`:5938-5944`), and lineage validation runs only for `completed` settlements (`:5974-5977`).
The exact-key check also rejects a producer that tries to retain those lineage fields on failure.

Consequently, a two-unit call with one accepted child and one failed child can settle and replay
with the accepted provider result and cleanup receipt digest-bound, but without any binding from
that result to its source coordinate. The ledger preserves the partial result bytes while losing
their lineage truth. Failed evidence must carry and validate lineage for every retained provider
result (or failed settlement must require `providerResults` to be empty).
