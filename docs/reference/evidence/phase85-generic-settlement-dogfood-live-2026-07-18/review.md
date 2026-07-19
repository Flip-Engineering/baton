# Adversarial review: context map partition 2/5

## Finding: completed settlement can publish an ambiguous result SHA

`_contextSettlementChildren` sorts all active accepted artifacts by ID, selects the first `commit` with `.find()`, and considers a completed child valid whenever that commit has `refs.sha` and any `verification` artifact exists. It does not require exactly one active commit. Consequently, two unsuperseded accepted commits with different SHAs pass the gate: `resultSha` reports the lower-ID commit while `artifacts` and `artifactDigest` attest both competing results. That is deterministic but not exact result truth, and it affects both context-map and generic-effect settlement through their shared helper.

Settlement and integrity replay should reject a completed child unless it has one authoritative active commit (and an unambiguous verification bound to that commit), rather than deriving authority from artifact-ID order.

Source: immutable partition `context-partition:e0b499a1324938ce2f939ebd0b3032b410b005d508310c07ea409ccf6cca86b0`, in the `activeArtifacts`, `commit`, completed-gate, and `resultSha` logic of `impl/src/coordination-store.mjs`.
