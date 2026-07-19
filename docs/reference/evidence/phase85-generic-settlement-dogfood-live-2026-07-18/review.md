# Partition 2/5 adversarial review

## Finding: settlement can report an unverified result SHA

`_contextSettlementChildren` treats a completed child as valid when `activeArtifacts` contains any commit with a nonempty `refs.sha` and any verification artifact. It neither requires a single active commit nor proves that the selected verification covers that commit. It then sorts all active artifacts by ID and sets `resultSha` from the first commit, while `artifactDigest` merely inventories every active artifact.

Consequently, a completed child with two active commits and a verification for only the second commit can settle successfully while reporting the first commit as `resultSha`. The row is deterministic but preserves the wrong result lineage, so replay reproduces the ambiguity instead of detecting it. Settlement must reject multiple active gate artifacts and validate the verification-to-commit binding before projecting `resultSha`.

Source: immutable context partition `aff0cb8d14f119c0171b2f2492ddcb1af64c9442bbd67d16813aef9784ab7adb`, `impl/src/coordination-store.mjs`, `_contextSettlementChildren`.
