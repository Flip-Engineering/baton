# Phase 85 generic Context-call dogfood

This one-command Baton-on-Baton runner sends the same closed CLR3 effect-call normalization task to
exact Codex `gpt-5.6-sol` high and xhigh routes in parallel. Baton retains verified Candidates and
then stops/reaps the complete Run subtree without changing the caller worktree or index.

```sh
rtk proxy node docs/reference/evidence/phase85-context-call-dogfood-live-2026-07-18/run.mjs
```

## Result

Run `run-4cdb56de86dfb3b640ca56289ae7f89f` reached `selection_required` with two freshly verified
retained Candidates:

- xhigh adversary Candidate
  `candidate:f94f98ffce198b66f2ad3894747f4ef691c340f5e482896b40ee948914d2dfdb`,
  commit `d437b3e9bfb846875949358b028f39212f6db46a`, patch SHA-256
  `0e868058cf78d79f2ce95bacf29531ac48ca3fe64f838f10977b21be5f1bc938`;
- high builder Candidate
  `candidate:26fc3bcc632f9e073bea4e3f610c7a7ca756794ed6a16d39660a18fa327ff386`,
  commit `47f892cebcdf24599cb9289e230b1240ba814a71`, patch SHA-256
  `884e89e16573c417bce0845caa3cbbd628777979de00620cd32a0f302bb2bb8a`.

Both exact requested routes resolved to Codex CLI 0.144.6 with the requested `gpt-5.6-sol`
high/xhigh effort. Provider telemetry matched the model but did not expose harness/effort identity.

## Stop, reap, and evidence boundary

Baton kill-confirmed both process groups, observed and closed both (`2/2`), released Run authority,
reported `remainingCount: 0`, and closed with zero workers. Stop receipt
`36eac8a4e42500a438020de45e8db9e3371b9e04fd638ceb884c3af798952b2b` records the proof.

The runner's whole-caller-status equality check is intentionally not claimed: the foreground
orchestrator implemented and tested the same core concurrently while Baton's isolated Attempts ran,
so the caller status changed by known orchestrator work. The caller index remained unchanged, and
the provider work stayed in Baton's isolated worktrees. This exposed a real parallel-dogfood AX gap:
whole-tree quiescence is not a valid isolation oracle when the orchestrator and Baton legitimately
work concurrently; future evidence should bind path ownership/provenance rather than weakening the
check or serializing all work.

Subsequent local synthesis used both Candidate patches as review inputs, then strengthened their
opaque requester/lineage digests into hub-derived request authorization and deterministic unit
lineage formulas. The pure generic map/reduce identity core and one-way Phase 84 map-v2 adapter pass
their focused 4/4 suite; the combined adjacent matrix is 33/33 and the complete implementation suite
is green at 2,093/2,093. No generic coordination admission or reduce provider effect is claimed:
current map settlement still lacks exact result-output lineage and remains reduce-ineligible.
