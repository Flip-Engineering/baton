# Phase 85 Context lineage dogfood

This evidence run uses Baton's concise `openBaton().workflow()` application surface to launch two
parallel, exactly routed implementation Candidates against the current effective tree. Each
Candidate must implement and verify the bounded per-output pure-Context lineage slice. Baton retains
their patches, then stops and reaps the whole Run without changing caller state outside this evidence
directory.

Run it from the repository root with:

```sh
rtk proxy node docs/reference/evidence/phase85-context-lineage-dogfood-live-2026-07-18/run.mjs
```

`evidence.json` records readiness, exact routes, Candidate identities and changed paths, mechanical
verification, exact stop/reap cleanup, deployment closure, and caller isolation. `candidate-*.patch` contains
the attributable retained delta from each verified Candidate.

If the foreground runner is interrupted after durable settlement, `recover.mjs` reopens the exact
deployment and Run, extracts the verified Candidate patches, joins the idempotent stop, and requires
zero process/worker ownership before closing. Ordinary Workflow-only stop currently uses receipt v1;
the v3 extension is required only when Context session/cell/call descendants also exist.
