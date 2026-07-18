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
verification, stop-v3 cleanup, deployment closure, and caller isolation. `candidate-*.patch` contains
the attributable retained delta from each verified Candidate.
