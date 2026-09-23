# Recovery note: #555 closure landing (2026-09-22 ~21:20Z)

Blocked by deployment-wide ENOSPC: the authoritative operational log refuses even small
appends, reads that touch the log refuse, and the run scratchpad store refuses. Disk:
767 MiB free of 228 GiB; ~10 GiB reclaimable inside the deployment's own runtime
(`.git/baton/application-v3/runtime` 4.1 G, `.git/baton` 4.4 G total, 185 dead-seat
worktrees under `.baton/wt`). DNS to github.com also fails from seat worktrees, so no
remote push is possible until egress returns.

## What is done and where it lives

- Branch `baton/mcp3-555-seedrow`, commit `dbd8340f3757b094ac99c03f14969243cf627cde`
  (in the shared local repository — survives independently of any session).
- Content: the #555/#314 seed-row closure (inherited from mcp-lead2's
  contribution-a5717b03, final lane commit f3ee7df7), MINUS the orphan syntax-broken
  `impl/src/probe-northbound.mjs` WIP (preserved at 542204c8 / origin-preserve refs),
  PLUS the fixes that make it landable:
  - `impl/src/surface-capability-catalog.mjs`: the D4 native-row filter no longer erases
    served tool names that resolve only through a compatibility alias (all 110 combined
    tools were anonymous; alias corrections keep their owner).
  - Five test rows d1288fd9 reded silently re-pinned to the measured post-D4 surface
    (canonical/alias resolution, served identities, describe, admission predicate,
    typed bridge refusal) + H1-tools literals 65/118 → measured 57/110.
  - `impl/scripts/control-surface-audit.mjs` + `native-surface-capabilities.json`:
    `registryMcpExceptions` (staleness-guarded seat_side/host_local classification) and
    the dispatch-only spellings the cut retired; four masked audit refusal layers
    reconciled.
- Verified: 130/130 across the ten-file closure suite
  (surface-capability-catalog, unified-mcp-surface, surface-audit-smoke,
  mcp-bridge-admission, harvest-accessor-red, mcp-profile-parity-red,
  issue314-core-table, issue314-lane2-receipts-wakes, issue314-mcp-core-surface-red,
  issue462-handoff-env-scoped) and `node scripts/control-surface-audit.mjs` exits clean.
- Rebased onto master 65c913f0 (zero file overlap with the four commits ahead of served
  1e050e42).

## Resume (one operator/root action first)

1. Free disk on the deployment volume (the resident's own dead-seat runtime holds the
   space; swarm.stop authority or direct cleanup), OR confirm enough headroom for the log.
2. Record the contribution for `dbd8340f` on `baton/mcp3-555-seedrow` (the full contract
   JSON is in the mcp-lead3 session transcript; a terse version is in the same transcript
   when the log has page room).
3. `swarm.integrate` that contribution with target `master`.
4. Confirm publication with `git ls-remote origin master` once egress returns.
5. Notify wake-lead3 (swarm-wake-20260921): their #410 landing (contribution-df1200e8)
   and the whole wake lane wait on this closure being green on master.
6. Holder-release `mcp-lead` and `mcp-lead2` (both runtime-dead, superseded; no resume
   warranted — mcp-lead's work landed as squashes, mcp-lead2's live work is this lane).
7. A junk probe contribution (body "probe", seq 107110, mcp-lead3) needs a recorder
   comment; it was an ENOSPC test that landed during the outage window.
