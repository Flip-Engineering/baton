# Adversarial review — context map unit 4/5

## Finding: inherited origin bypasses terminal-success validation during retry

In `_contextRetrySelection`, the branch `child.origin === 'inherited' || child.state === 'accepted'` adds a child to `inheritedChildren` solely because its origin is `inherited`. Consequently, an inherited child whose recorded state is failed (including one with a retryable termination) is neither retried nor rejected; its `childDigest` is carried into the successor generation as though it were successful. The identity check immediately above covers only `unitId` and `unitDigest`, so it does not close this state/lineage gap. This can make successor replay lineage claim inheritance while the predecessor result records failure, losing exact route and result truth. Require an explicit successful/accepted invariant for both inherited and newly accepted children (and reject or retry every other terminal state) before constructing `inheritedChildren`.

Source: immutable `context-unit:e07d858e7eb25fceedabdc1f241cd077dc7c354bd2dc9cf9b614260493837c7c`, `impl/src/coordination-store.mjs`, bytes 540672–552960.
