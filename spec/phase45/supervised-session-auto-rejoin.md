# Phase 45 — supervised startup session auto-rejoin

## SR1 — explicit deployment authority

Automatic rejoin exists only when `createDriver({sessionRecoveryPolicy})` supplies exactly positive
bounded `maxSessions`, `maxStateRows`, and per-session `timeoutMs`. There is no web, MCP, worker, or
environment switch. Manual `recover()` remains available under its existing authority.

## SR2 — readiness barrier

The Coordinator replays first, then a single startup supervisor synchronously installs a readiness
barrier before the driver is returned. Ordinary dispatch/control/read commands refuse with
`session_recovery_pending` until the scan settles. Capacity or authoritative-write failure leaves a
failed readiness barrier; it never exposes a partly authoritative controller.

## SR3 — closed eligible set

Only replayed `orphaned` handles with a persisted native `sessionRef`, exact durable session context,
an existing task, and an adapter card that declares native resume are eligible. Candidate order is
stable replay order. All worker rows are bounded before filtering; max+1 eligible sessions refuses
the whole startup scan rather than silently choosing a prefix.

Startup reconciliation preserves only those eligible workers' exact owned worktrees and private
runtime homes before the fresh context/identity handshake. Unsupported and unowned leftovers are
still reaped. Reusing a private home preserves vendor-native session state; runtime construction
reasserts directory/file permissions and credential projection before launch.

## SR4 — existing recovery trust gate

Each candidate passes through the existing `recover()` transaction sequentially. Context ownership
is freshly validated, the adapter receives the persisted exact model and effort, and a bounded fresh
native handshake must report the identical session ID. Rejoin creates a refinement task before
working authority becomes visible. Stale PIDs are never signalled.

## SR5 — honest partial failure

Identity mismatch, adapter refusal/exception, invalid context, or timeout kills the untrusted
transport and leaves that handle explicitly orphaned. The supervisor continues with the remaining
candidates and returns a bounded sanitized `degraded` summary. Coordination/provenance write loss
fails readiness instead of degrading.

## SR6 — one supervisor and no duplicate attempt

`start()` and the driver `ready` promise are idempotent. One candidate is attempted at most once per
driver startup, and attempts are sequential so restart cannot exceed a vendor seat by construction.
Manual control cannot race the readiness barrier.

## SR7 — lifecycle and shutdown

Only closed counts/codes enter supervisor lifecycle events. A driver with auto-rejoin requires
`closeAsync()`. Close awaits the bounded scan, then kills and reaps every session the supervisor
attached before releasing Coordinator and writer authority. Repeated close is idempotent.

## SR8 — compatibility

Without `sessionRecoveryPolicy`, construction, synchronous close, manual recovery, replay, provider
supervisors, and all public northbounds retain their current behavior. Provider polling/processing
does not start until session readiness settles when both supervisors are configured.

## SR9 — adversarial gates

Reds cover invalid/max+1 policy; command-before-ready; stable sequential success/failure; exact
model/effort/context/session identity; unsupported/non-native exclusion; capacity refusal; timeout,
identity mismatch, adapter exception, and coordination-write loss; repeated start; close during an
attempt; full process/worktree/runtime/branch/writer reap; and unchanged opt-out behavior.

## SR10 — live and recursive proof

A fixture restart persists a verified native session, simulates process loss by releasing the first
writer without graceful cleanup, auto-rejoins through a fresh exact-identity handshake, completes a
freshly verified refinement, and proves async close reaps all ownership. A provider-backed exact harness/model/effort proof follows only where the
installed harness supports safe persisted resume; environment refusal remains red evidence.

Phase 46 remains the attested representation review packet. Cairn causal audit, temporal
contradiction hardening, and bounded recall remain later explicit work. No homelab or external
project-manager runtime is introduced.
