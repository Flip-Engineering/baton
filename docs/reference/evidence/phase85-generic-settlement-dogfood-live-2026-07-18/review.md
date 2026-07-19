# Context map unit 2/5 adversarial review

## Finding: inherited effect result is not bound to its origin child

For a generic retry, `_contextSettlementChildren` authenticates `origin` with
`(binding.unitId, binding.childDigest)`, but independently chooses
`providerResult` with only `predecessorResults.find(candidate =>
candidate.unitId === binding.unitId)`. It does not reject duplicate provider
results and does not require `canonicalDigest(providerResult) ===
origin.resultRefDigest` before emitting a row containing both
`originChildDigest: origin.childDigest` and the newly computed
`resultRefDigest`.

Consequently, a failed predecessor whose `children` and `providerResults`
arrays disagree can pass this retry-settlement path and produce an inherited
child that claims one origin while referencing another result. This loses exact
result lineage during replay. Reject duplicate provider results per unit and
verify the selected result digest against the origin child's recorded result
reference before accepting inheritance.
