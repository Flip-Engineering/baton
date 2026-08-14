# Contract seed — #150 coaching-payload passthrough on both northbounds

[attempt: 1faf10bb-21ed-41d5-8bc7-540abddb4af6 row-seeds]

Origin: `gh issue view 150` is not reachable (`gh` unauthenticated in this worktree, and the issue
number is absent from this repo's history). The seed is grounded in the row brief's stated scope —
"the contract for carrying coaching payloads through web + MCP unchanged (closed shapes, refusals
on mutation)" — and in the landed coaching machinery it names: the frame-economics coaching refusal
triple (#89/#79 GT7, `worker-delivery-push-2026-08-07/contract-fold.md`) and the coaching feedback
packet (`feedback-forge-hardening-2026-08-07/contract-fold.md`). Both are "coaching payloads" and
both cross the two agent-facing northbounds (`web-northbound.mjs`, `mcp-northbound.mjs`). This seed
covers BOTH coaching families; the alternative (only the refusal triple) is recorded as an open
question / judgment call.

- **Date:** 2026-08-14 · **Status:** SEED (Ring-2 draft; red-first; specifies behavior, lands no code)
- **Verification HEAD:** `5ae2c7e5c93d99404d3a292e777dd30f7d2ead27`. Every `file:line` below was
  re-verified this session (`grep -an`/`sed -n`/`Read`) at this HEAD. NUL discipline: `application.mjs`
  and `coordination-store.mjs` are grep/sed/Read-verified, never whole-file reads.
- **Scope of the seed, in one sentence:** a coaching payload — either the size-refusal triple
  `{cap, actual, unit, gracefulPath}` or the authored feedback packet `{summary, findings}` — is a
  closed shape at the kernel; both northbounds must deliver it UNCHANGED (same fields, same values,
  same framing), and any surface-side request to rewrite/mutate/re-shape a coaching payload must
  refuse with a typed code rather than silently mutating.

---

## Ground truths (verified this session)

- **G1 — the coaching refusal triple is kernel-composed and closed.** `coachingError` (`coordinator.mjs:
  345-350`) throws `{code, cap, actual, unit: 'bytes', gracefulPath}` from the ONE lane row, and
  `coachingRefusal` (`coordination-store.mjs:706-711`) is its coordination-store twin; the same triple
  rides a `ValidationError` via `coachingValidationError` (`messages.mjs:228-235`). The human message is
  `composeFrameLimitRefusal(row, actual, cap)` output (`limits.mjs:40-42`), the path phrase is
  `frameLimitRefusalPath` (`limits.mjs:45-47`). No hand-typed refusal text exists (the #89 Decision 8/9
  no-re-declare law).
- **G2 — the MCP northbound has a coaching passthrough arm.** `COACHING_REFUSAL_CODES`
  (`mcp-northbound.mjs:208-212`) is derived from `FRAME_LIMITS` (every byte-lane refusalCode except
  `workflow_*`). `laneCraftedToolError` (`mcp-northbound.mjs:220-250`) reconstructs the detail
  `{cap, actual, unit, gracefulPath}` from the error ROOT fields — because the coaching throw puts the
  triple on the root, not in `cause.detail` (`:225-235`). `stateFailureCode` preserves the typed
  coaching code instead of degrading to `command_outcome_unknown` (`:329-333`).
- **G3 — the web northbound has a coaching arm that ADDS a field.** The web sink
  (`web-northbound.mjs:256-272`) emits `{code, message, field, cap, actual, unit, gracefulPath}` at
  httpStatus 413. The `field` member is DERIVED — `coachingWireField(cause)` (`web-northbound.mjs:
  407-410`) maps the lane through `COACHING_LANE_FIELD` (`:372-390`) or the code through
  `COACHING_CODE_FIELD` (`:391-405`), e.g. `run.objective` → `field: 'objective'`.
- **G4 — the two northbounds' shapes DIVERGE today.** MCP emits `{cap, actual, unit, gracefulPath}`
  (no `field`, no `message` in the detail object); web emits the triple PLUS `field` PLUS `message`.
  The kernel error root carries `{code, cap, actual, unit, gracefulPath}` and NO `field`
  (`coordinator.mjs:345-350`, `messages.mjs:228-235`). So a coaching payload does NOT cross both
  northbounds byte-identically today — the web arm synthesizes a field the kernel never produced.
- **G5 — the authored feedback packet is closed and kernel-validated.** The packet body is the exact
  set `{summary, findings}` — `feedbackBody` enforces `exact(value, ['summary', 'findings'])`,
  findings 1..32 each `{kind, severity, message, path, line}` (`workflow-revision.mjs:59-77`; the
  exact-set at `:60`, the closed finding shape at `:68-74`); riding a revision, the packet is
  `{feedbackId, feedbackDigest, eventSeq, feedback}` (`workflow-revision.mjs:120`). The canonical verb
  is `run.feedback` (`application-semantics.mjs:1819-1820`), whose inputSchema is the closed object
  `{summary, findings}` with `additionalProperties: false` (`application-semantics.mjs:586`) — a
  smuggled field fails command-input validation. `BatonRun.sendFeedback` guards a non-string /
  non-object feedback with `clientError('Workflow feedback is invalid')`
  (`application-client.mjs:1179-1185`; default code `application_client_invalid`, `:7`).
  `SECRET_SHAPED_TEXT` scrubs secret-shaped text at the message layer (`messages.mjs:509,538`).
- **G6 — the two northbounds both exist and both carry refusals to the agent.** `mcp-northbound.mjs`
  is the primary agent-facing northbound (README.md:69); `web-northbound.mjs` is the direct-port web
  bus. Both have six error sinks that funnel through the coaching arms of G2/G3.

## Decisions

- **D1 — "coaching payload" is two closed families, both covered.** (a) the size-refusal triple
  `{cap, actual, unit, gracefulPath}` minted by `coachingError`/`coachingRefusal`/`coachingValidationError`;
  (b) the authored feedback packet `{summary, findings}`. "Passthrough unchanged" applies to both:
  the surface delivers the payload exactly as the kernel produced it — no field added, removed,
  renamed, or re-defaulted.
- **D2 — the wire shape is the kernel root, verbatim.** On both northbounds the coaching payload is
  the error root's own `{code, cap, actual, unit, gracefulPath}` (for the triple family) and the
  packet's own `{summary, findings}` (for the feedback family). A surface may
  ADD transport metadata (HTTP status, JSON-RPC envelope) but must not add or rewrite a payload field.
- **D3 — the web `field` synthesis is the mutation the contract refuses.** The `coachingWireField`
  derivation (`web-northbound.mjs:407-410`) injects a `field` the kernel never minted. The seed pins
  the web arm to the kernel root verbatim (drop `field` unless the kernel root carries it) or, at
  minimum, to a payload that is a strict subset of the kernel root — never a superset that adds
  semantics the receiver could treat as kernel-authored. This is the primary RED pin (A1).
- **D4 — refusals on mutation are typed, not silent.** A request that would mutate a coaching payload
  (a surface endpoint that rewrites `cap`/`actual`/`unit`/`gracefulPath`) refuses the lane's own
  refusalCode on the triple family (G1). A feedback author that smuggles a gate shape through the
  coaching branch is refused by the closed `run.feedback` inputSchema (`additionalProperties: false`,
  `application-semantics.mjs:586`) and by the `sendFeedback` client guard
  (`application_client_invalid`, `application-client.mjs:1182`) — both generic-code refusals today,
  which is itself a RED pin (A3): the fold should land a named code for the feedback-mutation refusal.
  No path may silently re-shape and pass through.

## Closed refusal vocabulary

| code | family | meaning |
|---|---|---|
| `spill_body_exceeded` (+ every `FRAME_LIMITS` byte-lane code) | triple | the coaching triple family's typed codes (derived, `mcp-northbound.mjs:208-212`) |
| `application_client_invalid` | feedback | the `sendFeedback` client guard's code for a non-string / non-object feedback (`application-client.mjs:1182`) |
| `context_read_invalid` | triple | a coachable refusal whose query/lane shape is malformed (cross-ref seed-151) |
| `command_outcome_unknown` | fallback | what a coaching code MUST NEVER degrade to (`mcp-northbound.mjs:333`) |

The feedback family's second gate — a smuggled field in a `run.feedback` object — fails the closed
inputSchema's `additionalProperties: false` (`application-semantics.mjs:586`) today with a generic
command-input refusal; the seed names a typed code for it as part of A3.

## Red-first acceptance pins

Every pin is RED at the verification HEAD — the seed specifies behavior that does not yet hold.

- **A1 (RED) — the web arm no longer adds a kernel-absent `field`.** At HEAD, a `run.objective`
  oversize refusal crosses the web northbound with `field: 'objective'` synthesized by
  `coachingWireField` (`web-northbound.mjs:407-410`) while the MCP arm's detail is the bare triple
  (`mcp-northbound.mjs:229-235`) — the two northbounds diverge (G4). Pinned: both arms carry the
  kernel root verbatim; the synthetic `field` is gone.
- **A2 (RED) — both northbounds' coaching payloads deepEqual each other for the same kernel throw.**
  Drive `coachingError` once and render it through the MCP tool error and the web HTTP
  error: `error.detail` (MCP) and `error` body (web) agree on `{cap, actual, unit, gracefulPath}`
  field-for-field at HEAD. Pinned: the payload is transport-enveloped only.
- **A3 (RED) — a feedback submission that smuggles a gate field refuses, and the refusal is named.**
  The kernel leg is GREEN at HEAD: the closed `run.feedback` inputSchema rejects `{summary, findings,
  gate}` via `additionalProperties: false` (`application-semantics.mjs:586`) and `feedbackBody` enforces
  the exact set (`workflow-revision.mjs:60`). The RED is twofold — the surface passthrough of the
  feedback packet is not pinned anywhere (no MCP/web path is committed to forwarding the packet
  unchanged), and the mutation refusal is a generic code, not a typed named one (D4). Pinned: the
  surface forwards verbatim and the refusal names the family.
- **A4 (RED) — no surface rewrites the coaching triple's numbers.** A coached refusal crossing the
  web surface at HEAD carries `cap`/`actual`/`unit`/`gracefulPath` only when the sink author remembers
  to forward them (`web-northbound.mjs:267-270`); the contract pins that forwarding as a closed,
  tested obligation — the payload is the kernel root or the surface refuses.

## Open questions

- **OQ1 — does "both northbounds" include the CLI parse surface?** The brief names web + MCP. The CLI
  (`application-cli.mjs`) is a third agent-facing surface; this seed leaves it as a cross-reference,
  not a scope claim. A future fold should decide whether the CLI must carry the same verbatim payload.
- **OQ2 — the web HTTP status (413) is transport metadata, allowed by D2.** Whether 413 must be
  uniform for every coaching family (vs 400 for the feedback family) is left open — transport codes
  are outside the payload contract.
- **OQ3 — is `field` ever kernel-valid?** If a future lane row carries a real `field` (as the scratchpad
  settle family does), the web derivation should forward it verbatim, not remap. The fold must pick:
  (a) kernel root verbatim always, (b) `field` allowed when the kernel throw carries it.
- **OQ4 — the issue body for #150 was unreachable (`gh` unauthenticated; number absent from history).**
  If the issue names a narrower coaching family, this seed over-covers; the fold should re-scope from
  the issue body.

## Cross-references

- Frame economics #89/#86 — `limits.mjs:40-50` (the ONE composer), `limits.mjs:56-58,86` (the rows).
- `worker-delivery-push-2026-08-07/contract-fold.md` GT7/D2 — the coaching triple and its spill path.
- `feedback-forge-hardening-2026-08-07/contract-fold.md` B2/D3 — the feedback packet's closed shape
  (historical origin; the field set is re-verified this session at HEAD — see G5).
- `error-actionability-2026-08-13/contract-fold.md` §2 D4 R2/R3 — the MCP/web coaching arms' origin.
- seed-151 (this wave) — the `context.read` lane whose spill refusals are also coachable.

## Judgment calls

- Both coaching families covered (G1/G5) because the brief's "coaching payloads" is plural and both
  families are coachable payloads crossing the surfaces; the alternative reading is OQ4.
- No DECISION_REQUEST issued: the brief's scope statement + the landed coaching machinery bound the
  seed; the only genuine authority gap (unreachable issue body) is recorded as OQ4 rather than
  blocking, because the row brief explicitly sanctions repo grounding when `gh` is unavailable.
- The seed deliberately pins the MCP side as the reference (kernel root verbatim) and the web side as
  the divergence (the synthetic `field`), because G4 shows the web arm is the one that mutates.
