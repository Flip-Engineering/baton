# #105 FOLD BRIEF — fold the red-team report into the reply-chains contract (v1.0 → v1.1)

You are folding an adversarial red-team report into the reply-chains contract. Read fully, in
order: (1) `contract-redteam.md` (NOT FOLD-READY — 7 blockers B-1..B-7, each with its concrete
fix; open-question verdicts in §3); (2) `reply-chains-contract.md` (v1.0 — your edit target).

## Fold every blocker (the report's fixes are the default)

- **B-1** — the reply record must inherit the parent's target run for authorization so every hop
  resolves to the root's run (the null-target mint at `coordinator.mjs:12580` kills the walk
  under the resolve-then-authorize law). Pin the inheritance rule and its FP-05 compatibility.
- **B-2** — run-membership authorization on the parent BEFORE the depth/slot checks: the replying
  worker must be a member of the parent's run (or the parent's target), refusing
  `message_parent_not_found` / the new `message_target_not_member` — name which and when.
- **B-3** — state the budget as a per-branch depth cap (drop the per-root-subtree claim) and
  re-derive the MAX bound from the per-frame invariant — or add a real subtree-hop ceiling; pick
  one and justify.
- **B-4** — specify the replay fold's row→record mapping completely: replies distinguished by
  `inReplyTo` presence, `parent.reply` re-linking, per-member multi-reply parents, the legacy
  alias send's second `message.sent` shape (`coordinator.mjs:7410-7419`) with no depth/budget.
- **B-5** — (a) an orchestrator-readable refusal surface (e.g. last-refusal on the receipt) so the
  honest-handoff signal is observable; (b) resolve the direct-ports contradiction: the lane is
  the single authority for budget validation, or the facade's check is documented as range-only.
- **B-6** — wire blocking follow-ups to the existing interaction lane OR define a machine-readable
  escalation marker; if neither, document the inference + the deadlock-recovery path explicitly.
- **B-7** — re-anchor every citation at the current HEAD (post-6872 `coordinator.mjs` anchors
  drifted +16; two anchors wrong even at the pinned HEAD), re-pin the verification HEAD, and mark
  G4 as target-state (tight-cell Decision 5), not ground truth.
- Apply the §3 open-question verdicts.

## Laws + deliverables

No clocks; every citation verified (`grep -an`/`sed -n` on the two NUL files); sorted-key
literals ACTUAL sorted order; `localeCompare` banned. Header to **v1.1** with the fold note.
Edit ONLY: `reply-chains-contract.md` (v1.1) + `contract-fold.md` (blocker → change map, all 7 +
open questions, resolved or explicitly deferred with the reason) — both in this directory.
