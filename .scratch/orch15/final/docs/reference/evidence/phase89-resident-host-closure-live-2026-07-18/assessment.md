# Phase 89 ordinary resident-host closure assessment

Date: 2026-07-18

## Baton-on-Baton outcome

Baton dispatched two exact independent closure reviews concurrently from one effective-tree
snapshot:

- GLM `glm-5.2`/`xhigh`, Run `run-ed9c926ecb725ce16b8d014d275164cb`, retained
  `glm-host-authority-review.md` at `ccc24fd66d7024d021535ea179b51e91b2e32a8e`.
- Codex `gpt-5.6-sol`/`high`, Run `run-31c94605f6abcb7d04e2de981dad66cf`, retained
  `codex-postfix-review.md` at `e2a90736da73efb64ab5a1a1431bcc6123dc8375`.

Both reports passed the pinned Phase 89 verification. Requested and resolved route tuples matched
exactly; both providers observed the requested model, while provider-native harness and effort
attestation remained unavailable. Baton stopped both Runs and deployment close reported zero
workers. The compact stop projection again returned null stop/ownership fields, retained as a
separate AX defect rather than treated as failed cleanup because final deployment ownership was
explicitly zero.

## Findings incorporated

The closure reviewers independently converged on an owner-local Unix socket, private session,
stable deployment/fresh incarnation, PID-start-safe fencing, readiness-before-publication,
authenticated generation challenge, explicit two-argument command port, and CAS cleanup. The
implementation now provides:

1. authenticated HTTP over a server-stamped `local` transport on a mode-0600, current-UID Unix
   socket, with no TCP fallback;
2. a bounded local fetch transport that revalidates the socket and never exposes it through the
   ordinary client;
3. one `command(name, args)` contract across direct and connected Runs—principals remain entirely
   inside the direct adapter and sessions/idempotency entirely inside Web;
4. stable deployment identity, fresh instance identity, private hashed session storage and raw
   bearer publication only in an owner-private credential file;
5. resident and coordination writer leases carrying OS process-start identity, including a live-
   PID/different-start regression;
6. actual socket card/readiness/session/repository/registry/incarnation challenge before the
   selector is published;
7. reverse-order startup rollback that leaves the application reusable and permits a fresh retry;
8. exact-record CAS unpublication that cannot delete successor selector/profile/token records;
9. zero-assembly `baton serve`, discoverable through `connectBaton()`, with signal-driven close and
   a subprocess proof that the bearer and socket path do not reach stderr.

Focused resident/client/drain compatibility tests pass. The final canonical implementation suite
passes 2,192/2,192.

## Honest remaining boundary

The resident host currently uses a dedicated PID-start-fenced resident lease in addition to the
upgraded coordination writer lease. That is safe but duplicates authority; a later close-state
refactor should carry one deployment writer fence through Web drain, application reconciliation,
CAS unpublication, and final release. Private profile v2 currently stores the absolute socket path
inside the owner-only file; a per-incarnation relative coordinate would further narrow tampering
and relocation semantics. Session claims are repository-scoped and the card/profile challenge
binds deployment/incarnation, but explicit Run allowlists and incarnation fields in durable session
claims remain future hardening.

Explicit network mode, durable semantic `send`/`interrupt` admission and uncertain-effect
settlement, Run-scoped resumable streams, opaque catalog continuation, persisted/indexed progress
anchors, browser control convergence, crash-supervisor takeover, and the rest of the Phase 89
security matrix remain acceptance-red. This closure is not a claim that Phase 89 is complete.
