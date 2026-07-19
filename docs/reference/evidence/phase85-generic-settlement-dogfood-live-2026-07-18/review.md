# Adversarial review — context map unit 2/5

## Finding — inherited effect settlement can rebind result lineage

In `_contextSettlementChildren`, a generic retry authenticates the predecessor child with `unitId` plus `childDigest`, but independently selects `providerResult` using only `unitId`. The guard checks that some result exists; it never requires `canonicalDigest(providerResult) === origin.resultRefDigest` or that the result for the unit is unique. The new inherited row then writes `resultRefDigest: canonicalDigest(providerResult)`.

Consequently, a predecessor result containing duplicate or misaligned `providerResults` can pass this retry path and produce a child whose `originChildDigest` identifies one accepted result while `resultRefDigest` identifies different bytes. Replay therefore loses exact inherited result/lineage truth. Reject inheritance unless exactly one provider result matches the unit and its digest matches the authenticated origin child's `resultRefDigest`; carry that authenticated digest forward.
