# AX review — FRAME-ECONOMICS + CLAIM-PREFLIGHT agent experience (f33c24e, 07d9ddd)
Role: economics-reviewer (deepseek-v4-flash). Surfaces exercised: limits.mjs, every composeFrameLimitRefusal site, the spill lane, claim_premature_liveness, refusalNudgeBudget, doctor projection. Each friction names file:line + the call shape.

## What worked
- Single-source registry: limits.mjs frozen; all 17 admission lanes draw `{cap, actual, unit,
  gracefulPath}` via ONE composer (limits.mjs:40); throw-sites shape-uniform (coordinator.mjs:319,
  coordination-store.mjs:680, application.mjs:231, messages.mjs:228). A worker can rely on
  `error.cap/actual/gracefulPath` wherever a size refusal hits the durable stream.
- Spill lane works end-to-end: mintSpill content-addressed + idempotent by auth key
  (coordination-store.mjs:13208); spilled envelopes carry head + `{spilled, bytes, digest, spill}`,
  never the full body (coordinator.mjs:6842); a worker resolves via `CONTEXT_READ {kind:'spill',
  spill:'spill:sha256:…'}` — scanner kind-agnostic (claude-session.mjs:136), renderer UNTRUSTED-framed
  (coordinator.mjs:10727).
- claim_premature_liveness is honest: rollback leaves `pending`, nothing consumed, pause stays
  claimable (coordinator.mjs:2563-2573); driver budget bounded, claimAttempted keyed per-pauseId, one
  L4-exempt corrective nudge per refusal, record-only exhaustion (wave-driver.mjs:340-398). No clock.
- Graceful objective lanes admit-with-spill (no wall): `run.objective`/`wave.member.objective` up to
  1 MiB mint a durable spill, store bounded head+citation (application.mjs:4373-4392); wave-driver
  precheck is a spill-aware advisory, not a refusal.
- Doctor projection tabulates every lane with class/value/unit/graceful; digest covers DECLARED rows
  only; CLI handshake additive (application-cli.mjs:2124-2128). An orchestrator can enumerate the
  whole frame budget.

## Frictions
- **F1 — beyond-ceiling graceful refusals contradict themselves.** `refusalPath` (limits.mjs:32-36)
  picks the spill phrase for any graceful row regardless of cap, so a body over the 1 MiB spill ceiling
  — which does NOT spill (application.mjs:4380, coordinator.mjs:6812) — is told to spill. Repro:
  `run.start` with a 1 MiB+1-byte objective → "run.objective is 1048577 bytes (cap 1048576); over-cap
  bodies spill to a durable artifact — resend with a digest-citable head". The true fix ("resend within
  1048576 bytes") is never stated; "resend with a digest-citable head" isn't a supported input.
- **F2 — the coaching shape is dropped by both northbound transports.** `dispatchFailure`
  (web-northbound.mjs:140-235) maps every unknown code — all coaching codes (`spill_body_exceeded`,
  `board_report_exceeded`, `decision_question_exceeded`, …) — to `{code:'temporarily_unavailable',
  message:'command dispatch failed'}`; MCP `stateFailureCode` (mcp-northbound.mjs:253) falls to
  `command_outcome_unknown`. Repro: web `POST /v1/commands` `run.start` oversize objective → generic
  503, no cap/actual/code. Only in-process callers and durable-stream `message.rejected` keep the
  numbers; B3 tests the in-process error only.
- **F3 — claim_premature_liveness reason is driver guidance; the worker's corrective nudge is the
  generic completion message.** The reason (coordinator.mjs:2567-2571) is third-person ("nudge the
  worker to continue…"); the worker-side coach is `nudge_turn {message: completionMessage}` =
  "Continue the current turn." (wave-driver.mjs:354) — no liveness counts, no "you need an in-scope
  diff". An analysis-only worker is refused, nudged generically, cannot learn WHY; the contract's
  "nudge MAY carry TG4's sanitized {gate, detail} shape" is unimplemented.
- **F4 — doctor's projection and refusals disagree on graceful-lane caps.** Projection
  (application.mjs:12102-12108) shows `message.send.body value: 2048`; the refusal names `cap:
  1048576`. Three numbers for one lane (registry 2048 / projection 2048 / refusal 1048576). An
  orchestrator can't derive the two-tier envelope (≤2048 plain, 2048–1 MiB spilled, >1 MiB refused)
  without cross-referencing `spill.body` and knowing the graceful semantic; projection omits
  `refusalCode`/`gracefulPath`.
- **F5 — silent cap-void when mintSpill is absent.** Reply lane (coordinator.mjs:12488-12498): if
  `mintSpill` returns null, `replySpillRecord` stays null and the FULL over-cap body is stored with no
  `spilled` flag. The send lane throws on the same condition (coordinator.mjs:6818); the objective
  lane also stores the full body (application.mjs:4385-4391). Repro: coordinator without
  `_coordination.mintSpill` → a 5000-byte reply admitted whole, voiding the 2048 cap unmarked.
- **F6 — the spill query kind lacks run-horizon authorization.** The `finding` kind resolves-then-
  authorizes ("possession of a digest is never authority", coordinator.mjs:10642-10644); the `spill`
  kind (coordinator.mjs:10705-10720) resolves by digest with no run-scope check — a spill from another
  run is materializable by any worker holding the digest. Unguessable in practice, contradicts doctrine.
- **F7 — the spill-resolution convention is not discoverable at runtime.** application-semantics.mjs
  and the help topics never mention the `spill` query kind; a worker holding a `[SPILLED {…}]` frame
  must know `CONTEXT_READ {kind:'spill', …}` from the epic docs. Mechanic works; signposting absent.
- **F8 — application.mjs carries 3 literal NUL bytes** in the board cache-key template literal
  (application.mjs:523), so `file` reports it as `data` and grep silently misses matches (I hit this
  mid-review). Pre-existing (not in the f33c24e diff), but breaks future agent greps.

## Recommendations
1. Make `refusalPath` three-way (spill-admitted / beyond-ceiling "body exceeds the N-byte spill
   ceiling; resend within N bytes" / hard), selected by `(graceful, actual vs spillCeiling)`; add a
   beyond-ceiling golden beside B3.
2. Add coaching codes to `dispatchFailure`/`stateFailureCode` (or pass through any error carrying
   `{cap, actual, unit, gracefulPath}`) and add a transport-level B3 test over `/v1/commands`.
3. Deliver sanitized `{liveness counts, reason: no in-scope diff}` in the corrective nudge, or address
   the worker directly in the reason when a worker issues `claim_turn`.
4. Project each graceful lane's effective admission ceiling (the spill.body value) per lane; make the
   refusal `cap` agree with it.
5. Throw `coachingError` on the mintSpill-absent fallback in the reply and objective lanes, matching
   the send lane.
6. Scope `materializeSpill`/the spill query to the requesting run's horizon, like the `finding` kind.
7. Document the `spill` query kind in the `context.read` semantics summary/help.
8. Strip the NUL bytes at application.mjs:523 so grep works.
