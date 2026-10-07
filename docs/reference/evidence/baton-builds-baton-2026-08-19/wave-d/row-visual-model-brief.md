# ROW — #242 fulfillment: the visual MODEL module (impl/src/visual-model.mjs)

The spec is ON MASTER: impl/test/visual-model.test.mjs (83 lines, 3 tests, RED via
MODULE_NOT_FOUND) + docs/38-flip-visual-surfaces.md (the contract). Read BOTH first.

Deliverable: implement `projectBatonVisualModel({ snapshot, watch?, width, view?, now? })`
to satisfy the 3 pins EXACTLY:
1. composes run/story/attention/telemetry/topology: model.kind='baton.visual_model',
   model.run.runId, model.story.source='story_compiler', model.fleet.members (from
   snapshot.run.value.workstreams, capped 64), model.fleet.counts.active,
   model.attention[n].respondable, model.controls.approvals[n].allow.command='run.answer',
   model.controls.takeover.available=false, model.topology.edges (relation 'uses' —
   worker→route edges from workstream.route), model.telemetry.routes (from doctor routes),
   model.cursors.after (from watch.nextAfterCursor), model.fingerprint (sha256 hex64 of the
   canonical model).
2. provenance law P2: timeline items carry provenance 'worker_prose' for worker-actor
   events with summary = the ANSI-STRIPPED message (strip control bytes \u001b…m); no
   control bytes anywhere in the JSON; model.provenance.workerProse counts them.
3. bounded + deterministic: 100 workstreams/events → members.length=64, timeline.length=64
   (both capped 64), identical inputs → identical fingerprint.
The bounding caps: fleet.members 64, timeline 64 (latest events).
Source seams: snapshot.doctor.value.routes (telemetry), snapshot.run.value (run/workstreams/
attention/narrative/progress), snapshot.convergence.scheduler (pulse lanes),
snapshot.story (narrative/signals), watch.follow.events (timeline; actor 'worker'→prose,
others→fact), watch.attention.value.reasons.

RED-first is done (the pin is RED at HEAD). Implement to GREEN:
node --test test/visual-model.test.mjs → 3/3.
Battery: none adjacent (new module) — just the pin.
Your [attempt:] line verbatim in the first five lines of your notes file.
Scope: impl/src/visual-model.mjs, impl/test/visual-model.test.mjs (only if the spec itself
has a bug — record it in notes), this wave dir.
Report: docs/reference/evidence/baton-builds-baton-2026-08-19/wave-d/notes-row-visual-model.md
