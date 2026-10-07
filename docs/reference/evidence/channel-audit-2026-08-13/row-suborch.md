# ROW BRIEF — row-suborch: the #74 follow-up — suborchestrator ↔ tightly-coupled cell channels

Read `foundry-brief.md` first — it binds you (verdict scale, evidence law, publish rule,
attempt-echo law). Your target: **whether a coordinator MEMBER of a wave can actually drive
its own tightly-coupled sub-swarms today**, per #74's full shape and the operator's ask.

Questions, each PROVEN/GAPPED/UNEXERCISED with citations:
1. **Can a wave member call `waves.run`?** The #74 design intends a coordinator member to drive
   nested waves; the summary record says the full shape is "correctly gated behind #12's lease
   closure". Read `gh issue view 74` and `gh issue view 12` (if `gh` is unauthenticated in your
   worktree, read the contracts/evidence under `docs/reference/evidence/` instead and SAY you
   couldn't read the issues). Trace the actual block: what refuses a member-driven `waves.run`
   today — capability, lease, admission? Cite the refusing code.
2. **The tightly-coupled cell (#102/#69 family):** what shared-context machinery exists for a
   cell that loose grouping lacks? Read the tight-cell contract/evidence dirs and the current
   scratchpad partitioning code. Is a cell's shared partition writable by all cell members
   TODAY, or is that #158's gap?
3. **Bidirectionality:** member→suborchestrator messages, suborchestrator→top-orchestrator
   escalation chaining (does a nested DECISION_REQUEST surface at the top with its authority
   chain intact, or flatten?). Code-cited.
4. **The steering lanes a suborchestrator would need** (approveOnAdvertisedPlan, nudge,
   claimOnStall, elevateWhenNotes, signalOnMembersDone) — which are interpreter-only today
   (`workflow-interpreter.mjs`) vs available to a member through the facade? The gap list IS
   the #74 remainder — produce it as a table.

Deliverable: `docs/reference/evidence/channel-audit-2026-08-13/suborchestrator.md` ONLY, plus
the `shared` publish (title "row-suborch") — or the exact refusal if the publish fails.
