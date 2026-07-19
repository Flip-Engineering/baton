# Phase 92.2 — physical workspace owner authority

Git worktree ownership is physical authority, not logical task identity. A caller supplies the
logical task only. Baton derives one bounded opaque physical owner from its deployment authority,
Run, Attempt, and generation; callers cannot nominate that owner.

## PW1 — separate identities

`logicalTaskId` remains stable workflow identity. `physicalOwnerId` is a safe opaque path/ref
component. Worker paths and branches use only the physical owner. Thus independent deployments may
execute the same logical task against one Git common directory without sharing a branch or checkout.

## PW2 — durable binding receipt

Before branch creation Baton atomically writes a mode-0600 schema-v2 owner receipt binding the
deployment/controller qualifier, Run, Attempt, generation, logical task, physical owner, exact base
SHA, branch, and worktree path. The ready receipt retains that binding and is copied into the
operational `worktree.ready` fact. Process authority remains separately exact and generation-bound.

## PW3 — crash reconciliation

The pre-create receipt is local proof across the branch-create/worktree-register crash window.
Reconciliation may idempotently remove only residue named by such local authority or by this
controller's registered checkout. A bare Baton branch without local proof is foreign or ambiguous:
it is retained. Live foreign linked worktrees are always retained. Cleanup reaches exact absence
of the locally owned path, registration, metadata, projection state, and branch.

## PW4 — restart and transport invariants

Restart adopts the physical owner from the durable `worktree.ready` receipt; it never recomputes it
from a logical task. Direct and authenticated application transports continue to accept no physical
workspace coordinate. Existing session, exact process recovery, objective-first application, result,
and cleanup semantics are unchanged.

## Exclusions

This phase adds no Program IR, REPL, homelab integration, shared mutable checkout, or speculative
foreign cleanup.
