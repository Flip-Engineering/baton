# #169 KERNEL-HONESTY AUDIT BRIEF — the systematic pass over the kernel

You are the auditor for issue #169's systematic half: a red-team-grade pass over baton's
KERNEL layers hunting exactly two defects — (a) silent or approximate authority/recovery
behavior (the mechanism acts, but the record doesn't say what/who/why, or a recovery that
could be automatic is manual), and (b) refusals that don't name their holder/cause/next
action. This mirrors the #147 surface audit, one layer down.

## Read first (in order)

1. The issue: `gh issue view 169` — the five named instances are your seed rows; verify each
   fresh (a fixed instance is a non-finding, say so).
2. The #147 audit's method: `docs/reference/evidence/control-surface-audit-2026-08-13/
   audit-brief.md` (the axes + citation law) — same discipline, kernel layer.
3. The friction ledger: `docs/reference/evidence/frontier-sweep-2026-08-03/
   orchestrator-friction-ledger.md` Appendices A–D (every kernel-adjacent incident).

## The layers (the audit grid)

- **Coordination store + writer lease** (`coordination-store.mjs` — NUL discipline:
  `grep -an`/`sed -n` only): the busy refusal's payload; stale-lease recovery
  (`recoveredStaleAuthority` — when is it automatic vs manual?).
- **Fencing/incarnation** (`fence.mjs`, the incarnation machinery): a fenced principal's
  refusal — does it name the fence event? The resident credential's ~24h death (#148) — is
  the lifetime written anywhere an operator can read?
- **Replay paths** (the coordination replay + rehydration): any spot where replay is
  approximate (recomputes loosely, skips a record class silently).
- **Capacity authority** (`worktree-capacity.mjs`): the reservation refusals (do they name
  the current free/floor/reservations?), the dead-owner reaps.
- **Worktree + snapshot/commit machinery** (`worktree*.mjs`, the snapshot pins): the stale
  index.lock class; the base-commit pinning (on-branch vs sideband — #168).
- **The dispatch/authority seams** (`application.mjs` — NUL discipline): the waves.*
  pre-gate finding (#169 instance 5 — verify the line anchors fresh); the `_authorize`
  collapse; any other command class dispatched before its gate.
- **Kernel API contracts**: `complete()` (the quiescence contract — is misuse enforceable?),
  `run.result()` materialization (the pin-exists-but-section-empty report from the fleet AX
  wave — verify against current code).

## Deliverable

`docs/reference/evidence/kernel-honesty-2026-08-13/kernel-honesty-audit.md` ONLY: the
findings table (layer → finding → evidence `file:line` → severity → concrete fix → #169
instance # or NEW), then the ranked fix list. Laws: every claim cited from a fresh read; no
clocks; no redesign — findings, not architecture.
