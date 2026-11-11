# #158 CONTRACT BRIEF — the scratchpad WRITE verb (the shared-layer handoff's missing half)

You are drafting the implementation contract for issue #158: the shared scratchpad has no
write/append verb on ANY agent-facing surface — proven live by the #147 dogfood (the cli row
could not publish its report to `shared`; the handoff failed asymmetrically mid-wave).

## Read first (in order)

1. The issue: `gh issue view 158`. The live evidence: `docs/reference/evidence/
   control-surface-audit-2026-08-13/control-surface-audit.md` §0 + §2 #10 (the asymmetric
   handoff) and `surface-audit-cli.md` §6 F-9/S-3.
2. **The landed read law (your authority anchor):** `docs/reference/evidence/
   worker-orchestrated-swarm-2026-08-13/contract-fold.md` v1.2, §D1.2 — who may READ
   (own `worker:<ownId>` + `shared` + review authority + wave-scoped grants) and the
   enforcement seam (`restrictingReadAuthorize`, landed in `application-deployment.mjs`).
   The write law must be its exact sibling.
3. The scratchpad kernel: the store's partition grammar + kinds (`coordination-store.mjs`
   SCRATCHPAD_KINDS + the scope pattern — `grep -an` NUL discipline), the elevation
   machinery (`scratchpad.elevate`/`settle`), and the existing read ports
   (`run.scratchpad.read`/`elevate` on the three surfaces — verify each surface's current
   state with citations).
4. The worker-side write that ALREADY exists (the #33 worker scratchpad — how workers write
   their own partition today; the write lane this contract exposes is its surface
   completion, not a new mechanism).
5. The wave integration points: `elevateWhenNotes` (workflow-interpreter.mjs) and the #74
   swarm handoff pattern.

## The contract must answer

- **D1 — the write law.** Who may write what: a member writes `worker:<ownId>` and `shared`
  (matching D1.2's read law); cross-partition writes refuse with the typed code; the
  top-orchestrator/review-authority write posture (advisory-only? append-anywhere? choose
  and justify against the trust doctrine).
- **D2 — the verb + the three surfaces.** The exact verb shape (`run.scratchpad.append`?),
  its arg closure (runId, scope, kind, body, idempotency), its refusal family, and its
  admission on CLI / MCP / web bus (the #153 admission pattern is your template; the CLI
  ghost trap — #157 — is the anti-pattern: admitted means parser AND admission AND docs).
- **D3 — bounds and audit.** Byte bounds (which #89 row governs the body?), rate/spam
  discipline, the durable event + replay behavior, the elevate interaction (a written entry
  is elevatable per the existing machinery).
- **D4 — the bare-`run scratchpad` trap.** The CLI bare subcommand currently leaks
  `undefined` — the contract names its refusal.
- **Refusal vocabulary + red-first acceptance pins + open questions**, per campaign form.

## Laws

Ring-2 contract form; every citation verified this session (NUL discipline); no clocks; no
redesign of what landed SOUND (D1.2 is law — cite, don't re-litigate). Deliverable:
`docs/reference/evidence/scratchpad-write-2026-08-13/scratchpad-write-contract.md` ONLY.
