# DSH-comparison foundry LANDING NOTE (top orchestrator, 2026-08-13)

## Provenance (the by-now-familiar shape)

The wave settled WAVE-OK, 5/5 harvests — and the coordinator's `dsh-qa.md` was again written
before the rows were visible to it (its §1/§2 record the unfired signal + the on-disk check;
its escalation A/B/C is recorded; the DECISION_REQUEST lane was unreachable from its seat —
more lane-gap evidence). **But the red-team row verified the row reports on disk mid-flight
(the #174 law working at row level) and applied its rubric to their actual verdicts** — so
this landing reconciles: rows' verdicts + the red-team's rubric application GOVERN; the
coordinator's blind merge is kept for its §7 honesty paragraph and its candidate list (which
the rows' content substantially confirms).

## The reconciled adoption list (as filed this date)

1. **"Model-visible means logged" as a dispatch-seam invariant + the durable no-step turn**
   (arch C1 + lifecycle L3): any member's exact served context is reconstructable from the
   shared ledger — with the rubric caveat: reconstructable VIA the cited spill artifact, never
   bodies-inline (`limits.mjs` keeps bodies out by design). A rejected/empty attempt is
   RECORDED (the no-step turn) — the silent-turnless gap's structural answer.
2. **The `agent.inject()`-shaped context lane** (lifecycle L1): model-facing context lands in
   the next admitted request — the operator's standing "pass whole context objects into
   per-worker/shared layers" ask, dsh's shape. Ours: the wave driver's mid-flight injection,
   not just spawn-time briefs.
3. **The adapter-contract discipline** (seams S1 + S3 + C9): the Definition role made explicit
   on the adapter contract; the pre-execute policy gate (a named-capability refusal at the
   existing `_authorize` seam — the #176 class's positive form); canonical output declarations
   on capability cards so a referee verifies an op the way liveness verifies a route.
4. **The delegated-turn subagent provider + followup routing** (seams S2/C2A + C8): a member
   provider that delegates a turn into another product (grok/kimi ACP = ALREADY-HAVE; the
   typed pre-check before spawn is the ADAPT) and the deterministic followup-routing decision
   table on the recovery path (running→enqueue / waiting→wake / none→cold-resume — a
   cold-resume is a re-drive per #59, never a live-state fork).
5. **Typed dispatch-mode declarations** (arch C6, narrow): per-kind consumer-mode declaration
   + a generated matrix — declaration only; the waterfall half is REJECTED in the kernel.
6. **Coordinator-GRANTED scoped capability sets** (seams C10, conditioned): a permission
   projection granted to a member, never member-minted shadowing (the single-agent trap's
   danger zone — the boundary pin is recorded).

**Disposer discipline** (arch C3) lands as #177's fix shape (a recorded `writer.lease_recovered`
replaces the silent `unlinkSync`) — already filed; the dsh evidence strengthens it.

**Rejected with reasons (the red-team's trap list governs):** the skills seam (no baton landing
zone); waterfall interception in the kernel (T3/T5); live session fork (T4 — #59's explicit-
boundary re-drive is the honest form); per-agent inbox (T6, the single-agent trap); the
delta-streaming event kind (T7 — mined by the red-team on its second pass); profiles/bundles/
patches beyond #180's narrow closed-map form (config sprawl); UI-first chrome (docs/38's lane
is the honest home for visual work).

## What dsh does better, kept plain

dsh's composition elegance (boot-time patchable plugin trees) and its single-agent live-context
machinery (inject, pre-step interception, scoped shadowing) are real — and mostly single-agent
shaped. Baton's elegance is the other kind: fenced worktrees, content-addressed pins, evidence
that survives the wave. The adoptions above are exactly the subset that strengthens the second
without importing the first's traps.
