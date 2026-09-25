# #71 CONTRACT BRIEF — the orchestrator attention inbox: wake-with-decisions instead of poll

You are drafting the implementation contract for issue #71 (orchestrator attention inbox —
wake-with-decisions instead of poll). Read fully, in order: (1) the issue — `gh issue view 71`;
(2) the lived evidence: `docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md`
(the poll-loop frictions + Appendix C's wave-observability session) — the orchestrator polls
status() in 15s loops because nothing wakes it; (3) the landed machinery to compose with: the
worker-side attention inbox (#10-era — `attention` on status(), ATTENTION_TYPES in
`messages.mjs`), the #10 waitingOn vocabulary (`baecb18` — landed), the decision lane
(`decision.answer` + the onDecision wave-driver callback), the event stream (`waitAfter` —
`coordination-store.mjs:8808` — a long-poll primitive ALREADY EXISTS); (4) the #132
wave-observability contract v1.2 (`docs/reference/evidence/wave-observability-2026-08-06/` — the
registry projection and surface work this must compose with, never duplicate).

## The contract must decide

- **The wake primitive.** The orchestrator asks "wake me when anything needs me" — decisions
  pending, plan approvals advertised, attention items addressed to the orchestrator, wave
  terminal events, waitingOn transitions to interaction. Compose on the store's `waitAfter`
  long-poll (event-seq anchored, NO clocks as workflow controls — a wake is an event-driven
  delivery, the timeout is only the transport's long-poll bound). Pin: the event classes that
  wake (the closed set), the delivery shape (bounded, digest-cited spill per #89), and the
  posture on wake-with-nothing (honest empty, never a fabricated reason).
- **The decision-first surface.** "Wake-with-decisions": the wake payload surfaces actionable
  items FIRST (a pending decision with its options, an advertised plan with its digest) — the
  orchestrator answers from the wake payload without a second read. Pin the actionable-item
  shape and the direct-answer path (answer from the wake, receipted).
- **Who may be woken.** The orchestrator principal for a wave/run; multi-orchestrator honesty
  (two waiters both wake — no claim-on-read semantics).
- **The surface mapping.** MCP (a `baton_attention_wait`-class tool — long-poll discipline
  inside MCP's constraints), the web bus (an events/wait route or the command envelope), CLI
  (`baton attention wait` — blocks with the honest empty on transport timeout). Cross-reference
  #132's D1 (web admission) and #138 (stateless HTTP MCP) — the wake must ride whichever lands;
  the contract names the dependency posture.
- **The #105 composition.** A wake on a reply-chain hop vs a decision — the routing the #105
  contract's D8 named — the wake payload distinguishes them machine-readably.
- **Refusal vocabulary + acceptance pins (red-first)** per decision.

## Laws + deliverable

Ring-2 form. No clocks as controls (the long-poll bound is transport, never a gate); every
citation verified (`grep -an`/`sed -n` on the two NUL files); sorted-key literals ACTUAL order;
`localeCompare` banned. Cross-reference (do not re-spec): #10, #79, #105, #132, #138, #91.
Deliverable: ONLY
`docs/reference/evidence/orchestrator-wake-2026-08-07/orchestrator-wake-contract.md` (v1.0 DRAFT
with the verification HEAD).
