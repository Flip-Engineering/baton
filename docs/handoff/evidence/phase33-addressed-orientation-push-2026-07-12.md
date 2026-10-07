# Phase 33 addressed orientation push handoff — 2026-07-12

## Outcome

Baton now exposes Cartographer's marquee addressed push without creating a second control plane or
giving capability code adapter authority. The direct orchestrator calls
`orientWorker(workerId, args, note, {expectedFence, budgetTokens, actor})`; authenticated web and
MCP callers use the existing `capability_invoke` command/tool with `action: "push"` restricted to
`cartographer-quartermaster/orientation.slice`.

The Coordinator checks the exact target fence before any Atlas computation, invokes the sole ACI
registry, projects only bounded typed payload, content handle/digest/bytes/media type, cursor, and
closed safe provenance, then queues a nudge on the ordinary serialized worker lane. The lane
rechecks status/fence after computation, so interrupt/kill cannot be crossed by a stale push. Host
artifact paths and deployment-private provenance do not enter the worker message. Successful
delivery is logged once as `knowledge.map_served` with the authenticated actor; generic `send()`
cannot forge that event kind.

## Verification

- OP1–OP6 direct/race/web/MCP push contracts: 4/4.
- Coordinator/web/MCP/ACI/Cartographer focused gate: 104/104.
- Canonical owner-managed zero-quota suite: 816/816.
- `git diff --check`: clean.

The first canonical attempt exposed two unrelated sub-second fake-session timing couplings under
host load. Phase 10.1's semantic reservation test now waits up to two seconds for its fake child's
observable spawn, and its Codex turn-start-failure fixture uses a two-second request ceiling.
Dedicated timeout contracts are unchanged. The focused regressions and the repeated canonical run
both pass.

## Recursive Baton evidence and reap

`docs/reference/evidence/phase33-addressed-orientation-local-2026-07-12/` builds a scoped immutable
Atlas snapshot from Baton's real Cartographer, Coordinator, ACI, and index sources, starts a real
assembled-driver Mock worker, pushes an exact path-focused orientation map, and then kills it.
All 11 checks pass: acknowledgement, exact digest, worker/task/run attribution, typed target path,
host-path withholding, actor preservation, confirmed kill, and absent worktree, metadata, runtime,
and branch.

The first whole-repository attempt failed before worker spawn with host `ENOSPC`. Inspection found
no live Baton processes or worktrees and 2,492 stale Baton test roots totaling about 47 MiB; those
generated roots were reaped. The proof was then correctly narrowed to addressed source inputs
instead of indexing the repository's entire historical evidence corpus. The host filesystem remains
externally constrained, but Phase 33 left no owned runtime residue.

## Honest boundary

This phase does not auto-trigger on file edits. Scope-drift automation must bind the immutable brief
path scope, authoritative `content.file_edit` events, explicit policy, dedup/cooldown, exact Atlas
epoch/overlay, and current fence before calling the now-shipped primitive. Interrupt must void a
queued refresh. External dependency vetting, reachability, decisions/SBOMs, knowledge promotion,
and all later capability/system rungs remain active. No homelab integration is introduced.
