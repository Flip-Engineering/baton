# ROW BRIEF — row-dsh-lifecycle: dsh's agent lifecycle + context injection vs baton's member lanes

Read `foundry-brief.md` first (the shared laws bind you). Your lane: **the live-agent layer —
turns, injection, interruption, per-agent scoping**.

Ground in the digest: `architecture.md` (the turn-flow diagram; `agent/pre-step` decides what
the model sees; reject/empty closes a durable no-step turn), `agent-lifecycle.md`,
`subsystems/core.md` (the agent handle — cancellation + error recovery),
`subsystems/scope.md` (per-agent scoped registrations), `subsystems/session.md`
(`agent.inject()` — model-facing context lands in the next admitted request).

Baton's side: the wave member lifecycle (`impl/src/coordinator.mjs` — NUL discipline; turn
machinery, the #67 watchdog), the message lanes (#79 delivery push — landed;
run.message.send/receipt surfaces), #181 (member wake-on-signal — the park/wake gap),
#71 (orchestrator wake), #174 (member blindness), #175 (signal semantics), the lane-proof
wave's evidence (`docs/reference/evidence/lane-proof-2026-08-13/` — if landed by your read;
otherwise the channel audit's lanes-unexercised findings).

Candidates to evaluate (find your own too): **`agent.inject()` as the mid-flight context
lane** (context lands in the NEXT ADMITTED REQUEST — vs baton's message frames delivered
between turns; the operator's standing ask is "pass entire bodies of context into per-worker
objects" — which shape serves it?); `agent/pre-step` interception (a policy listener rewrites
or rejects what the model sees — baton's equivalent is the objective/briefing at spawn; is a
pre-step seam the member-side steering answer?); the durable no-step turn (an attempt is
RECORDED even when rejected — vs baton's silent-turnless workers law; compare honestly);
per-agent scoped registration (`agent.ctx` — a member customizing its OWN toolset within
scope; vs baton's fixed member surface + #147's profile work); the agent handle's
cancellation/error recovery (vs baton's #182 death certificates + #67 watchdog). For each:
ADOPT/ADAPT/REJECT/ALREADY-HAVE with the landing zone.

Deliverable: `docs/reference/evidence/dsh-comparison-2026-08-13/dsh-lifecycle.md`.
