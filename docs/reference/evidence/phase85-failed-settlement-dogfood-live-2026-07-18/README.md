# Phase 85 durable failed-settlement dogfood

This run uses Baton's concise `openBaton().workflow()` surface to give the same red terminal-call
contract to two independently routed implementation Candidates. The ordinary caller supplies an
objective, a narrow source/test scope, and exact orchestrator-selected routes; Baton derives and
owns all internal Goal, Plan, task, worker, worktree, verification, and cleanup coordinates.

Run from the repository root:

```sh
rtk proxy node docs/reference/evidence/phase85-failed-settlement-dogfood-live-2026-07-18/run.mjs
```

The preferred pair is Codex `gpt-5.6-sol`/high plus project-key GLM `glm-5.2`/xhigh. `glm` is the
requested harness identity; the adapter truthfully reports its Claude-session implementation as
the resolved harness. If the exact GLM route is not ready, the second member falls back explicitly
to Codex/xhigh and records that readiness decision. A Candidate is evidence, not authority: its
patch is retained for inspection;
the caller checkout is never integrated or reset by this runner.
