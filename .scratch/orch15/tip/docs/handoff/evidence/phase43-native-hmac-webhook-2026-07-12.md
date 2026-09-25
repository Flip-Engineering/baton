# Phase 43 native HMAC webhook boundary — 2026-07-12

## Outcome

Commit `cdae0e5` adds Baton's first registry-owned native provider authentication path. The
deployment card now pins one callback method/path, signing-domain version, exact header names,
signature encoding, key fingerprint, private-CAS store identity, JSON/media semantics, and header,
body, identity, coordinate, advisory, timestamp, and skew ceilings. The secret remains inside the
source and never enters its card, receipt, event, error, or evidence.

`HmacAdvisoryWebhookSource` verifies a length-prefixed domain over method, path, provider timestamp,
delivery ID, body digest, and exact preserved raw body using constant-time HMAC comparison. It
rejects duplicate headers after case folding, content-length/transfer ambiguity, wrong content type
or encoding, noncanonical/future/stale timestamps, zero-padded/non-integer sequence, noncanonical
or authority-bearing hint JSON, unsorted/duplicate identities, and every max+1 covered by the
source card. Authentication and closed hint parsing finish before private CAS mutation. CAS
digest/byte/store claims are checked on write, and `reverifyReceipt` rereads the private bytes and
recomputes the closed receipt without network.

The Coordinator's `receiveProviderWebhook` remains a machine-plane method: deployment routing
selects the provider, caller context may contain only an abort signal, the actor and idempotency key
are derived, and success returns only after the durable receipt/pending append. It grants no user,
MCP, policy, verdict, clearance, install, merge, verification, or publication authority.

## Validation

- Five native-HMAC tests plus the eleven existing Phase 43 foundation tests pass 16/16.
- Mutations cover raw body, method, path, delivery ID, stale/future/invalid/noncanonical timestamp,
  signature, same-case and mixed-case duplicate signature, framing headers, canonical JSON,
  coordinate/version/authority fields, lying CAS writes, CAS substitution, caller authority, and
  exact duplicate admission.
- The repository-wide zero-quota suite passes 924/924.

## Recursive Baton review

Evidence is in `docs/reference/evidence/phase43-hmac-dogfood-2026-07-12/`. From a detached checkout
at `cdae0e5`, Baton requested/resolved/provider-observed exact GLM `glm-4.7` with low effort on PID
15016. The report was freshly verified, normal kill was confirmed, and process, worktree, runtime,
branch, and writer authority were fully reaped.

The report's claimed timestamp P0 is rejected: its own failure sequence acknowledges exact
`toISOString()` equality rejects the cited strings. Explicit regressions now cover missing
milliseconds, offset form, invalid and future timestamps. Its duplicate-header P1 is also rejected:
all names are case-folded before `Map.has`, and mixed-case duplication is now an explicit red. The
sequence-gap health finding is valid retained AF7 work.

The review reported 81,854 tokens and $0.529367 only at terminal against a 50,000-token/$0.50
brief. That dogfood friction directly produced commit `55b93b3`: hard-threshold crossing is now
sticky, so a terminal claim may avoid a pointless late transport kill but can no longer pass
artifact admission, task completion, review success, or router learning. Preauthorization remains
necessary to prevent spend that a provider reports only after completion.

## Explicitly unshipped

Ed25519, a production HTTPS listener/router, protected historical-key replay, synchronous startup
CAS verification, source sequence/cursor health and reconciliation polling, official Quartermaster
refresh, seedless green/adverse completion, monotonic multi-source guard union/fan-out, and bounded
operator read surfaces remain in the active Phase 43 contract. No homelab integration is added.
