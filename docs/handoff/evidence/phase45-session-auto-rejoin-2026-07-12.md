# Phase 45 supervised startup session auto-rejoin — 2026-07-12

## Shipped checkpoint

SR1–SR10 add automatic rejoin without turning replayed references or stale PIDs into authority.
`createDriver({sessionRecoveryPolicy})` is an explicit deployment-only opt-in with exact bounded
session count, state rows, and per-session timeout. Construction synchronously installs a private
Coordinator readiness barrier before returning; ordinary commands refuse while recovery is pending,
and a capacity or authoritative-write failure leaves readiness failed rather than partly live.

The stable eligible set contains only replayed orphaned handles with an existing task, native
session reference, durable context, and adapter-declared native resume. Replay first identifies
those owners, then startup reconciliation preserves only their exact Baton worktrees and private
runtime homes; unsupported leftovers retain ordinary reap behavior. Reusing a private home preserves
vendor session state while runtime creation reasserts permissions, sandbox settings, and explicit
credential projection.

`SessionRecoverySupervisor` attempts candidates sequentially through the existing bounded
`recover()` transaction. Context ownership, exact native session ID, resolved model, and resolved
effort are checked before a durable refinement becomes working. Identity mismatch, refusal,
exception, invalid context, or timeout kills the untrusted transport and leaves an orphan with a
sanitized degraded summary. Coordination-write loss fails readiness. Start is idempotent and no
candidate is attempted twice in one startup.

The driver exposes a `ready` promise and recovery status. Auto-rejoin requires `closeAsync()`;
close awaits the bounded scan, skips an unstarted suffix, kills every attached prefix, and only then
releases Coordinator/writer authority. Provider polling and processing start only after recovery
readiness settles when both are configured.

## Verification and live proof

- Phase 45 passes **7/7** grouped contracts and **25/25** combined persistent-session/recovery tests.
- The cross-supervisor Phase 43/45 gate passes **31/31**, including a held readiness promise that
  proves provider polling remains unstarted until recovery settles.
- The canonical suite passes **986/986**.
- `docs/reference/evidence/phase45-session-auto-rejoin-live-2026-07-12/summary.json` passes all 11
  checks: verified first turn, owned context/runtime, simulated crash writer release, command
  refusal before ready, exact identity/model/effort and ownership preservation, verified recovery
  refinement, durable recovery events, writer release, and complete worktree/runtime/branch reap.
- `git diff --check` is clean. The user's unrelated `.gitignore` modification remains untouched.

## Recursive Baton/GLM review

`docs/reference/evidence/phase45-session-auto-rejoin-review-2026-07-12/summary.json` records exact
credentialed `glm` / `glm-4.7` / `low` routing on native PID `75883` against clean commit `56b2363`.
The worker used 72,132 tokens and $0.609352, fresh-verified its bounded report, received a confirmed
native kill, and left no process, worktree, runtime, branch, or writer authority. It found no P0/P1
defect. Its only observation—that provider-supervisor ordering was implemented but not directly
tested—became the explicit SR8/PF6 held-readiness regression before closure.

## Honest remaining scope

This phase resumes a terminal native session into a new verified refinement; it does not restore an
in-flight turn or claim checkpoint/rewind parity. The live proof uses an exact-identity fixture and
honest simulated process loss. A provider-backed crash/rejoin proof remains gated on a harness whose
persisted native session state survives safe private-runtime restart. Grok fork/rewind schemas,
Claude/Codex deeper checkpoint semantics, quota-aware rejoin, and in-flight continuation remain
catalogued. Phase 46 is the attested representation review packet; Cairn causal audit,
contradiction hardening, and bounded recall follow. No homelab or external project-manager runtime
is involved or desired.
