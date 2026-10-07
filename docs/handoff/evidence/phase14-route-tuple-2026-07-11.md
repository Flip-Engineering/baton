# Phase 14 harness/model/effort route-tuple evidence — 2026-07-11

## Outcome

GitHub issue #2's implementation gate is complete. Harness registry key, exact provider model, and
model effort are independent orchestrator inputs across direct calls and authenticated web
commands. Automatic routing resolves and filters the full tuple per card before scoring.

## Deterministic proof

- Full suite: 609/609 passing with bare `node --test` in `impl/`.
- Direct and assembled-driver/web `auto` tests prove heterogeneous effort inventories filter
  rejected adapters without fallback or crash.
- Low/high runs use distinct collision-safe learning keys. Exact tuple evidence wins; legacy
  harness and harness/model buckets are read-only fallback only when no exact bucket exists.
- Codex, Claude/GLM, and Grok native effort controls are mapped; recovery reuses the resolved
  task effort.
- Requested/resolved/observed attribution reaches named operational events, durable task claims
  and grounded route-observation records, handles, results, story, replay, review, verification,
  integration, routing, and snapshot trailers. Provider effort observation remains honestly null
  when the provider does not echo it.
- Only adapter-mapped native lifecycle/usage metadata can establish model or effort observation.
  Arbitrary worker content/result fields cannot forge observation or cause a policy mismatch.
- Authoritative mismatch fails the task and uses ordinary confirmed two-phase kill/reap before any
  verification or routing win.

## Recursive Baton proof

The build and review runners used `CodexAppServerCli`, exact `gpt-5.6-sol`, and `low` effort inside
Baton-owned worktrees with isolated credentials and dependency materialization.

- Build attempt 1 was rejected at its hard budget and fully reaped.
- Build attempt 2 exposed the expected pre-feature bootstrap observation limitation.
- Build attempt 3 ran under the new coordinator, fresh-verified, integrated, and fully reaped.
- Review 1 found recovery, observation-trust, and event-attribution defects; all were corrected.
- Review 2 found the assembled heterogeneous auto-route crash; it was corrected with production
  direct/web coverage.
- Review 3 found no actionable implementation defect.
- The final review runner reported every check true: honest exact tuple, fresh verification,
  integration intent/completion, kill confirmation, and process/worktree/runtime/branch removal.

Raw events, summaries, runner, and the final report are under
`docs/reference/evidence/phase14-route-tuple-codex-{build,review}-2026-07-11/`.

## Completed concurrent Grok evidence

The isolated exact-route rerun now passes. Baton concurrently requested and provider-observed
`grok-4.5` and `grok-composer-2.5-fast`, interrupted both active first turns, resumed one native
session into a second turn, killed that worker while it was working, and fully reaped both native
process groups, worktrees, runtime scopes, metadata, and branches. See
`docs/handoff/evidence/phase21-grok-concurrent-reap-2026-07-11.md`. Baton did not project ambient
credentials or weaken runtime isolation. No homelab integration or dependency was added.
