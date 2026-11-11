# Admission, routing, and concurrency limits — implementation record

Date: 2026-09-13. Revision: `9fdbb2f700d2f716757540bd336e445033d33502` + this work.
Input: [admission.md](admission.md) (runtime-policy audit), with one operator correction that
supersedes the audit's D1-C recommendation. Companion direction:
[docs/39-swarm-runtime.md](../../39-swarm-runtime.md) "Runtime engineering".

## Policy

1. `card().concurrencyCeiling: number | null`. `null` means **no configured limit** — not zero
   capacity, not 1, not 4. A number is a positive safe integer the deployment **caller**
   configured.
2. **No built-in ceiling exists.** No constructor default, no deployment literal, no subclass
   default, no surface substitute. A built-in route with no caller configuration reports `null`,
   and absence throttles nothing. `Infinity`/`MAX_SAFE_INTEGER` are not "unbounded": an invalid
   value is refused, never coerced.
3. **A configured ceiling is enforced** for exact and auto routes alike, by one admission point
   (`Coordinator._admitResolvedVendor`) applied to the vendor a route actually resolved — so no
   `_route` implementation, adaptive or custom, can dispatch past it.
4. **A blocked dispatch is a durable fact.** The waiter mints `task.dispatch_deferred`
   (`{taskId, vendor, ceiling, inFlight, taskCreatedSeq}`, idempotency key
   `task.dispatch_deferred:<taskId>:<taskCreatedSeq>`) and resumes when a slot is released. No
   silent skip.
5. **An exact route stays exact.** A saturated exact route waits for its own vendor; it is never
   rerouted. An auto route defers over its capable set rather than rerouting to an incapable
   vendor.
6. **A receipt that was not recorded is not a wait.** Failure to mint is an authoritative-write
   failure: the coordinator is poisoned and the typed `dispatch_deferral_unrecorded` refusal is
   thrown. The task is never left silently pending behind a claimed durable deferral.
7. **Provider quota is never fabricated.** No 429/rate-limit observation is written into a card,
   and none is synthesized from absence. The provider-true backpressure lane remains unbuilt
   (audit F5); this change removes the false claim that it exists.

## Changes

| Site | Change |
| --- | --- |
| `impl/src/concurrency-policy.mjs` (new) | `normalizeConcurrencyCeiling` (null verbatim; positive safe integer; else TypeError) and the shared predicate `withinConcurrencyCeiling` (null = unbounded). |
| `impl/src/adapter.mjs` | `MockAdapter` normalizes its option and defaults to `null`; legacy `CodexAdapter`/`ClaudeAdapter` cards declare `null`; `GlmAdapter` no longer pins 1. |
| `impl/src/cli-adapters.mjs` | `CliAdapter` normalizes `cfg.ceiling` once; `CodexCli`/`ClaudeCli`/`ZCodeCli`/`PiCli` defaults (`?? 4`, `?? 1`) deleted. |
| `impl/src/claude-session.mjs` | `ClaudeSessionCli` normalizes its ceiling; `GlmSessionCli`/`KimiSessionCli` `?? 1` defaults deleted. |
| `impl/src/{omp-rpc,grok-acp,kimi-acp,codex-appserver}.mjs` | `?? 4`/`?? 1` defaults deleted; each constructor normalizes the caller's value. |
| `impl/src/application-deployment.mjs` | Built-in routes pass `advanced.adapterOptions.concurrencyCeiling` (validated, optional, absent ⇒ `null`) and nothing else — no per-route literals. `DeepseekSessionCli`'s `?? 4` deleted. `#occupancyFor` projects the card's configured value **or `null`** (the fabricated `: 1` is gone). Restores the missing `KimiAcpCli` import (a built-in `kimi-code` route previously refused with `ReferenceError: KimiAcpCli is not defined`). |
| `impl/src/router.mjs` | `pick()`/`advice()` use the shared predicate, so `null`/absent ceilings are eligible instead of permanently excluded. |
| `impl/src/index.mjs` | The `createDriver` route closure uses the shared predicate; the stale "the coordinator's own ceiling re-check catches it too" comment is replaced with the real contract. |
| `impl/src/coordinator.mjs` | `_resolveVendor` returns a closed outcome (`selected`/`deferred`/`unavailable`); `_admitResolvedVendor` is the one ceiling gate; `_dispatchPass` mints the deferral receipt; `_deferTaskDispatch` refuses honestly on an unrecorded receipt; `_inFlightCount` documents that `blocked`/`stopping` hold a slot (audit F9). |
| `impl/src/cairn-run-scorecard.mjs` | `route.advice` accepts `concurrencyCeiling: null` (unbounded) and still refuses malformed rows. |

`task.dispatch_deferred` therefore has a producer again; `waitingOn.capacity_ceiling`
(`impl/src/application.mjs:411-471`) and the wave driver's `waiting:true, blocked:false`
classification are live, not dead code.

## Behavior

```
card().concurrencyCeiling = null      → eligible at any in-flight count; nothing defers
card().concurrencyCeiling = 1, 0 in   → dispatch
card().concurrencyCeiling = 1, 1 in   → defer (receipt) → resume when the slot is released
card().concurrencyCeiling = 0/-1/1.5/Infinity/'4' → refused at the configuration boundary
```

Absence is never eligibility-zero, never a number on a surface, and never a reason to skip a
task. Ceilings that are configured are real gates with a ledgered wait.

## Verification

Focused suites, all run in the assigned worktree on Node 22:

| Command | Result |
| --- | --- |
| `node --test impl/test/router.test.mjs` (deployment verification) | 35/35 pass |
| `node --test impl/test/adapter.test.mjs impl/test/cli-adapters.test.mjs impl/test/glm-session.test.mjs impl/test/omp-rpc-red.test.mjs` | 83/83 pass |
| `node --test impl/test/coordinator.test.mjs` | 58/58 pass |
| `node --test impl/test/issue10-waiting-vocabulary-red.test.mjs` | 38/38 pass |
| `node --test impl/test/e2e.test.mjs` | 4/4 pass |
| `node --test impl/test/concurrency-policy-admission.test.mjs` (new) | 8/8 pass |
| `node --test impl/test/phase44-cairn-route-stats.test.mjs` | 6/6 pass |
| `node --test impl/test/phase11-control-integrity.test.mjs` | 16/16 pass in 0.7s |
| `node --test impl/test/phase11-acceptance-integration.test.mjs impl/test/phase26-structured-merge.test.mjs impl/test/phase56-drain-and-close.test.mjs` | 79/79 pass |

New coverage (`impl/test/concurrency-policy-admission.test.mjs`): every in-tree adapter reports
`null` and preserves a configured value; invalid values refuse at the constructor and at
`advanced.adapterOptions`; a **built-in** deployment (real routes, no `advanced.adapters`) has no
ceiling and its doctor/roster occupancy reads `null`; six workers on an unconfigured vendor all
dispatch; a greedy custom `_route` cannot dispatch over a configured ceiling; an unrecorded
deferral throws `dispatch_deferral_unrecorded` and poisons the coordinator; the exact route defers
and is admitted when the slot frees.

Restaged tests (the #221 pins that asserted a **configured** ceiling is bypassed):
`coordinator.test.mjs` (spawn/D11-core#6/two-ready-tasks/list), `e2e.test.mjs` (the concurrency
proof now uses an unconfigured card, which is the property it actually demonstrates),
`issue10-waiting-vocabulary-red.test.mjs` (CC-START/CC-SHOW/CC-EXIT now pin the ledgered wait and
its run-view projection; DP-EXIT-b now pins the row inventory's documented Arm-2 → Arm-1 exit).
Pins that ensure absence does not throttle were retained and extended: `adapter.test.mjs`,
`cli-adapters.test.mjs`, `glm-session.test.mjs`, `omp-rpc-red.test.mjs`, `router.test.mjs`,
`readiness-credentials-red.test.mjs` (`occupancy.concurrencyCeiling` accepts the honest `null`).

Differential evidence (pristine `git archive HEAD` copy in `/tmp`, same file set, same Node):
every file this change touches was compared per file against the pristine revision. Failing-test
name sets are identical for all of them except the intended restagings; across the 76
ceiling-related suites the only deltas are improvements (`seat-telemetry-red` A-L now mints its
receipt; `phase56` DC2-DC7 now passes). The 140 unrelated baseline contract failures are handed
to root rather than chased here; the per-file differential is the evidence that this change
neither causes nor hides them.

### Test-fixture corrections that fell out of the representation change

- Placeholder `concurrencyCeiling: 0` fixture cards (`phase11-acceptance-integration`,
  `phase11-coordination-store`, `phase11-control-integrity`, `phase26-structured-merge`,
  `phase56-drain-and-close`; 14 sites) now declare **no** ceiling. `0` never meant "unlimited";
  it was an invalid value the old code silently accepted and could never enforce.
- `phase11-control-integrity.test.mjs` CI3 asserted a **retired policy**: it waited for the
  driver's wall-timeout killer to crash a member, which operator ruling #163 explicitly removed
  (`coordinator._dispatch`: "NO wall-time clock feeds a member's fate"). The test now asserts the
  live invariant — the driver installs no wall-budget timer (instrumented `setTimeout`, no clock
  compression) and an explicit stop reaps the exact child, worktree, metadata, and branch. The
  ad-hoc `process.kill` fallback that existed only to survive the retired policy is gone; the
  guaranteed driver drain in `finally` remains.
- The same file's `driverHandle` was shadowed by an inner `const`, so the `finally` drain never
  ran and the suite hung forever after its assertions had passed. Fixed; the file now completes
  in under a second.
- `phase51-process-lifecycle.test.mjs` PL7/PL9 is **flaky at the pristine revision**
  (baseline runs: 2 fail, 0 fail, 2 fail) — a real-process reap race, unrelated to admission.

## Out of scope (unchanged)

Provider-429/quota lane (audit F5), contract-146 `seats[]`/wave `capacity` blocks, worktree and
host storage capacity, Program IR's deferred `maxParallelBranches` binding (93E), route
discovery and static route lists (F6), and the structural batch bounds (drain `maxWorkers`, wave
members ≤ 64). The wave/run surfaces now read a real `task.dispatch_deferred` row; nothing was
added to a schema.
