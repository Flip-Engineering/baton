# #105 RED-TEAM BRIEF — adversarial attack on the reply-chains contract v1.0

You are the ADVERSARIAL RED TEAM for `reply-chains-contract.md` (v1.0, same dir — issue #105,
reply chains with a depth budget). Read it FULLY first, then attack:

1. **Re-verify every citation** (`grep -an`/`sed -n`; NUL files: `application.mjs` +
   `coordination-store.mjs` only) — a wrong citation is an automatic blocker. The #10
   interaction (D9) cites the LANDED waitingOn vocabulary (`baecb18`) — verify against the
   current tree, not the contract's claim.
2. **D1 (budget model)** — can a chain exceed its budget by forking (two replies to one parent,
   each at depth+1 — does the budget bind per-BRANCH or per-THREAD)? Can a worker mint a fresh
   chain rooted at an old message to launder depth? Is the max-budget bound enforced at send AND
   at relay (a tampered envelope mid-flight)?
3. **D2 (chain shape)** — closed schema: can a smuggled field ride the envelope? Is the
   parent-messageId reference integrity-checked (a reply to a message in ANOTHER run's chain —
   cross-run chain escape — leaks what)?
4. **D3 (refusals)** — are the two budget refusals distinguishable by a caller who must recover
   (declared-at-send-invalid vs exhausted-in-flight)? Surface-constant on facade/MCP/web?
5. **D4/D5 (receipts + replay)** — is the chain really replay-derivable (what durable record
   carries the parent link — if it is the envelope only, a lost envelope orphans the chain)?
6. **D6 (facade projection)** — does the byte-stable table stay untouched (the direct-ports
   law)? Do the budget fields survive the projection's closed-shape filter?
7. **D8 (DECISION boundary)** — is the routing rule actually decidable by a worker (give the
   ambiguous case: a follow-up that BLOCKS the orchestrator's next instruction — chain or
   gate?)?
8. **D9 (#10 interaction)** — does a worker awaiting a chain reply read as the contract says?
   Any waitingOn kind that hides a deadlock cycle (A waits on B, B waits on A)?
9. **Open questions + non-goals** — verdict each.

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(each: what + why + the concrete fix). Write ONLY
`docs/reference/evidence/reply-chains-2026-08-06/contract-redteam.md`. Laws: no clocks; every
citation re-verified at the current HEAD.
