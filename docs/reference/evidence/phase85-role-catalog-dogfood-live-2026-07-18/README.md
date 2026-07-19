# Phase 85 durable root role-catalog dogfood

This one-command Baton-on-Baton runner dispatches the same red Workflow-definition v3 contract to
exact Codex `gpt-5.6-sol` high and xhigh routes in parallel. It uses the concise Workflow surface,
requires retained Candidates rather than direct caller-tree edits, and stops/reaps every admitted
worker after evidence capture.

```sh
rtk proxy node docs/reference/evidence/phase85-role-catalog-dogfood-live-2026-07-18/run.mjs
```

## Result

Run `run-505b29729a108efc01579f16ea244672` ended at the honest
`selection_required` boundary with one retained Candidate:

- `role-catalog-builder` requested Codex `gpt-5.6-sol`/high and resolved to
  `codex@codex-cli 0.144.6`, `gpt-5.6-sol`/high exactly. It produced Candidate
  `candidate:e686bb32cd43f76a2bda93da31b499af59d243d7d1184ba808b39fcb7133c5a6`,
  retained at commit `c9e3be80daf4f549722f50350d1038f66adfa51c`. Its exported patch is
  `candidate-role-catalog-builder.patch` (40,366 bytes, SHA-256
  `335570879866eac5fe34abd68d633196a71af8174839f5673c97a34ce5edf88b`).
- `role-catalog-adversary` requested Codex `gpt-5.6-sol`/xhigh and resolved to
  `codex@codex-cli 0.144.6`, `gpt-5.6-sol`/xhigh exactly. It was cancelled before producing a
  Candidate; no adversary result is claimed or retained.

For both Attempts, launch enforcement proves that requested and resolved harness, model, and effort
matched. Provider telemetry observed `gpt-5.6-sol`, but did not expose provider-side harness or
effort identity before settlement (`unavailable` for the retained high Attempt and
`not_observed_before_stop` for the cancelled xhigh Attempt). This evidence therefore proves exact
request and launch resolution, not unavailable provider observation.

## Stop and reap proof

After retaining the high Candidate, Baton stopped the exact Run subtree. Receipt
`3ba295841fe97975ee15a5456b1ce479acb2922cc45cb7895a0219c46c91e69c` covers both targets:
one process group was kill-confirmed, the other was already terminal, both admitted processes were
observed and closed (`2/2`), `remainingCount` is zero, and run authority was released. Deployment
close then reported zero workers. The caller's status and index were unchanged.

The [machine-readable evidence](evidence.json) records the exact routes, retained Candidate, patch
digest, terminal Attempt states, stop receipt, ownership checks, and caller-tree invariants.

## Subsequent local integration

The live runner itself executed only the pre-existing `CM84-W1` focused gate. The retained Candidate
was therefore input to, not proof of, the final catalog implementation. Subsequent local integration
added the closed catalog/template/Attempt schemas, contiguous ancestry, canonical partition roles,
schema-stable v1/v2 replay, mixed v2→v3 upgrade/restart, and digest-valid catalog/template/route
substitution refusal. The focused role/revision/map authority matrix passed 26/26. The complete
implementation suite passed 2,089/2,089 after one isolated process-lifecycle timeout passed its
exact rerun and then the complete rerun.
