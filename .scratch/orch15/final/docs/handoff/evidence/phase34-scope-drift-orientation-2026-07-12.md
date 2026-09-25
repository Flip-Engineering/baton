# Phase 34 bounded scope-drift orientation handoff — 2026-07-12

## Outcome

Baton can now turn its existing mechanical out-of-scope edit signal into a bounded addressed
orientation refresh. The default remains `scopeAction: "kill"`. A deployment must explicitly
select `"orient"` and pin an exact Atlas epoch, focus, shape, token budget, cooldown, and positive
per-turn ceiling; invalid policy or an absent registered Cartographer capability fails
construction.

The scheduler reuses the immutable Brief `pathScope` and worker-originated normalized
`content.file_edit` stream. Each outside-scope path is considered once per native turn, at most one
slice computes at a time, and cooldown plus the per-turn ceiling bound repeated effects. New native
turns reset only this ephemeral admission state. It calls the Phase 33 `orientWorker` primitive
with the current exact fence; interrupt or kill during computation voids delivery. Mechanical
violation, suppression, capability/delivery refusal, and acknowledged `knowledge.map_served` are
separate facts and never claim that the worker understood or obeyed the map.

## Verification

- OD1–OD6 policy/dedup/cooldown/turn-limit/stop-race/turn-reset contracts: 4/4.
- Coordinator/web/MCP/ACI/Cartographer focused gate: 112/112.
- Canonical owner-managed zero-quota suite: 820/820.
- `git diff --check`: clean.

## Recursive Baton evidence and reap

`docs/reference/evidence/phase34-scope-orientation-local-2026-07-12/` builds a confined immutable
Atlas snapshot from Baton's real Cartographer, Coordinator, registry, and index sources, starts a
real assembled-driver Mock worker in a clean temporary Git repository, emits a real outside-Brief
edit event, waits for automatic structured delivery, then kills the worker. All 13 checks pass:
mechanical detection, policy actor, exact worker/task/run attribution, typed focus, drift note,
host-path withholding, one-refresh deduplication, no false refusal, confirmed kill, and absent
worktree, metadata, runtime, and branch.

The first dirty-checkout dogfood attempts did not reach the edit event. Worktree creation rejected,
but the Coordinator converted that rejection to `null`; the adapter then received an undefined
worktree path and crashed with a generic path error. The successful proof uses a clean temporary
worker repository so it proves Phase 34 honestly. The swallowed readiness failure is retained as a
separate lifecycle defect and the next dependency-ordered repair target.

## Honest boundary

This phase does not infer semantic scope, choose an epoch/focus, widen authority, edit the task, or
override stop policy. It adds no dependency oracle, external network lookup, advisory/license/
provenance/reachability logic, immutable reuse decision, SBOM, or knowledge promotion. Grok CLI
still reported unauthenticated during this phase, so no fresh provider review is claimed. No
homelab integration is introduced.
