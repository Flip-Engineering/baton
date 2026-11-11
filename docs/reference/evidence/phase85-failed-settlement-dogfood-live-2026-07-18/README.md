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

The recorded Run `run-6d691f60c1a14a89c3804bd6fc659ea0` admitted the exact Codex/high and
GLM 5.2/xhigh tuples. Codex produced Candidate
`candidate:c1dab8dd2e665cc5cebe9b7ae4fb892d0955a09a8d9f198a2ed1b2d54445c8b0`, whose
focused red/green verification passed in a fresh sandbox. GLM acquired a process group but never
advanced beyond initialization or supplied observed provider identity. The controller was signaled
after the Codex Candidate was retained; Baton's ordinary stop kill-confirmed and reaped both exact
process groups (`2/2`), closed with zero workers, and preserved caller status/index. No GLM success
or second Candidate is claimed.
