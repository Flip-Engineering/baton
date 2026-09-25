# Phase 43 Ed25519, startup CAS replay, and sequence health — 2026-07-12

## Outcome

Commits `7ce537a`, `dc96948`, and `e814b93` extend the native provider boundary without changing its
authority. `Ed25519AdvisoryWebhookSource` signs the identical length-prefixed wire domain as HMAC,
derives the card fingerprint from the pinned SPKI public key, accepts only canonical base64 64-byte
signatures, and retains no private key. A key change produces a different source-card epoch; an
old-key delivery or receipt cannot be verified under the new card.

Native HMAC and Ed25519 startup replay is readiness-critical. `createDriver` supplies the registry's
synchronous receipt verifier to `CoordinationStore`; while loading native receipt events, the store
rereads private CAS bytes, checks bytes/digest/size, rebuilds the local authentication-receipt digest
from the pinned callback domain, and recomputes the complete receipt. Absent synchronous CAS
support, byte substitution, authentication metadata tamper, card/key epoch change, or asynchronous
replay aborts construction before writer readiness. This is honest local authentication-receipt
validation, not independent third-party signature proof after the signature has been discarded.

The store also retains a per-repository/provider/source-epoch sequence map and high-water health.
Same-sequence different authenticated bytes conflict without append. A gap or unseen late delivery
is still admitted as a pending refresh hint but marks the source `reconciliation_required`; normal
traffic and late numeric fills cannot claim recovery. A later explicit bounded full-poll completion
transaction must prove cursor/window completeness before restoring `healthy`.

## Validation

- Twenty focused Phase 43 tests cover Ed25519 fingerprint/signature/key rotation, HMAC and Ed25519
  CAS replay, authentication-receipt tampering, native driver restart and readiness refusal,
  sequence gap/out-of-order/conflict behavior, durable pending admission, and replay reconstruction.
- Explicit signature mutations include missing/extra padding, whitespace, URL-safe characters,
  wrong key, body substitution, and noncanonical encodings.
- The repository-wide zero-quota suite passes 931/931.

## Recursive Baton review

Evidence is in `docs/reference/evidence/phase43-ed-sequence-dogfood-2026-07-12/`. Baton ran exact
GLM `glm-4.7` at low effort from a detached checkout at `dc96948`, provider-observed PID 92538, and
an explicitly approved 100,000-token/$1 budget. It reported 75,275 tokens/$0.57712, produced a
freshly verified report, confirmed normal kill, and reaped process, worktree, runtime, branch, and
writer authority.

The report's base64 P0 is rejected: canonical `Buffer` round-trip equality rejects missing/extra
padding, and explicit reds now cover the proposed encodings. The impossible same-SHA-256/different-
content test is also rejected unless the cryptographic primitive itself is replaced. Its request
for authentication-metadata mutation coverage was actionable and produced `e814b93`. Its concern
that health cannot recover from a gap is resolved as an explicit contract: late delivery alone may
not assert completeness; the separate full-poll completion transaction remains unimplemented.

## Explicitly unshipped

Production HTTPS routing, cursor/window reconciliation completion, poll scheduling/backoff/drain,
official Quartermaster refresh, seedless green/adverse processing, monotonic multi-source guard
union/fan-out, and bounded authenticated read surfaces remain active Phase 43 work. There is no
homelab integration.
