# Attempt 12 — verified review contained an evidence false negative

The exact `gpt-5.4` review passed every Baton lifecycle gate at a 400,000-token ceiling: fresh
verification, ff-only integration, integration authority, confirmed kill, and complete process,
runtime, worktree, and branch reap. Its only major finding claimed the repository lacked an
asymmetric publication-authority replay test, and its minor finding claimed approval parity was not
explicitly tested.

Both claims are contradicted by named tests already present in the reviewed commit:
`CK9: replay rejects an asymmetric publication decision without its paired driver completion` and
`CI2/CK9: accepted approval append failure also releases one racing consumer without redelivery`.
Verification proved artifact shape, not factual correctness. Baton therefore runs a new exact-model
correction review pinned to those evidence locations instead of creating meaningless code churn or
silently editing an integrated reviewer artifact.
