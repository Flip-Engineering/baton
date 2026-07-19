# Adversarial review

- **High — failed schema-v4 generic settlements bypass result-lineage reverification.**
  `contextCallArtifacts()` invokes `_validateContextEffectResultLineageEvidence(...)` only for a
  `completed` call. A generic `failed` call instead passes after schema-version and mirrored
  result/evidence comparisons; notably, `providerResultDigest` is recomputed, but `childDigest` is
  only compared between the two records. A coherently replaced failed result and evidence can
  therefore retain a self-consistent child digest, termination, and cleanup without the generic
  validator re-deriving their settlement bindings from the admitted call. This makes failed replay
  weaker than completed replay and can report false result or cleanup truth. Validate failed
  schema-v4 evidence with an equivalent generic failed-settlement lineage check, including
  recomputation of `childDigest` and semantic validation of termination and cleanup bindings.
