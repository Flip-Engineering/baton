# Phase 61 GLM Isolation Review — commit 340146d

## Verdict

PASS

Phase 61 correctly implements graph-backed representation production with proper GLM isolation, replay-safe idempotency, and causal endpoint integrity. The implementation grounds derived representations in replay-validated source claims without exposing credentials or depending on homelab infrastructure.

## P0-P1 findings

**No P0-P1 defects found.** The implementation correctly enforces:

- **GR1–GR2 closed mapping**: Producer kind maps through one fixed capability/operation/rung/type table. Source card substitution, dishonest resume, and reverify divergence all refuse typed before graph mutation. `atlas-representation-producer.mjs:140–180` validates the exact mapped contract against the current card before source invocation.

- **GR3 exact identity**: Representation identity digest includes the full stable closed set—repoId, taskId, runId, producerKind, fixed rung and type, capability card digest, operation, source arguments digest, source artifact digest and bytes, stable result projection digest, reverify result digest, and immutable environment identity. Volatile fields like `wall_ms` are excluded from the canonical hash. `atlas-representation-producer.mjs:206–245` constructs this identity precisely.

- **GR4 atomic lineage transaction**: `coordination-store.mjs:956–958` atomically materializes `Representation`, `Artifact`, `DerivedFrom`, `ProducedBy`, and `ObservedIn` nodes/edges in one append. Task causal endpoints must preexist and match repository/run membership. Append loss exposes no partial graph state.

- **GR6 replay integrity**: `coordination-store.mjs:798–853` reloads durable events and manifests, reruns source reverify under current trusted context, and compares every digest and causal endpoint. Environment drift, card changes, artifact tampering, or causal-orphan endpoints fail typed. The outer reconciliation path closes a lost ACI completion write without repeating source effects.

- **Request-bound idempotency**: Child source operations use distinct implementation-derived keys `representation:${stage}:${digest({ requestDigest })}` (`atlas-representation-producer.mjs:188`), never the outer ACI identity. The outer production uses `representation:${digest({ repoId, actor, idempotencyKey })}` (`atlas-representation-producer.mjs:275`) which includes the caller's idempotency key but is scoped to the producer namespace.

## Required corrections

**None required.** The implementation satisfies GR1–GR9 as committed at 340146d. Grounding remains `derived`, authority fields are all `false`, reds cover substitution and replay attacks, and recursive self-representation proof (`docs/reference/evidence/phase61-graph-representation-review-2026-07-13/self-representation.mjs`) confirms process, worktree, runtime, branch, writer, artifact, and capacity cleanup without credential exposure.