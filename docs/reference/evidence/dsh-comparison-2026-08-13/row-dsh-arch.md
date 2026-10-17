# ROW BRIEF — row-dsh-arch: dsh's framework architecture vs baton's kernel

Read `foundry-brief.md` first (the shared laws bind you — cite both sides, verdict per
candidate, the vetoes, attempt-echo). Your lane: **the framework itself — events, contexts,
composition, persistence**.

Ground in the digest: `cordis-primer.md` (services/inject/dispatch modes/reversible effects),
`architecture.md` (the three event domains, the where-new-behavior-goes table),
`event-producer-consumer.md` (the event map), `subsystems/session.md` (the append-only
SessionEvent log + `deriveMessages()`; fork/resume/transcripts derive from the stream).

Baton's side (read the real code): the coordination store (`impl/src/coordination-store.mjs` —
NUL discipline: grep -an/sed -n only) as the event-sourced truth with content-addressed pins;
the command bus + semantic registry (`application-semantics.mjs`); the fencing/incarnation
machinery; deployment files (`impl/scripts/resident.deployment.mjs`) vs profiles/bundles/
patches; #9 (the Program IR trunk), #170 (the DSL — closed spec as data), #177 (silent lease
recovery), #12 (nested orchestration).

Candidates to evaluate (find your own too): **"model-visible means logged" as a runtime
invariant** (dsh asserts model context is reconstructable from the log — baton's analogue: are
member prompts/contexts reconstructable from the coordination store? Where's the gap?);
waterfall/serial event interception as the policy mechanism (vs baton's admission/refusal
gates — two policy shapes, which wins where); reversible effects/registrations that unwind on
unload (vs baton's lease/lifecycle — #177's silent recovery is the gap instance); profiles/
bundles/patches composition (vs baton's deployment files + #180 per-wave profiles);
sessions.fork (fork a live session at a boundary — vs #59 re-drive continuity); the four
dispatch modes as a typed contract (vs baton's event log being write-mostly — do baton events
have consumers with modes?). For each: ADOPT/ADAPT/REJECT/ALREADY-HAVE with the landing zone.

Deliverable: `docs/reference/evidence/dsh-comparison-2026-08-13/dsh-arch.md`.
