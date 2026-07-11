# Phase 14 route-tuple independent Codex review

Reviewed `spec/phase14/harness-model-effort-routing.md` against the current routing-relevant implementation and the five acceptance suites named by the brief. This is an independent Codex turn, not a claim of cross-vendor independence.

## Actionable findings

### High — top-level effort is dropped during native session recovery

Source: `impl/src/coordinator.mjs:966-972` passes `reasoningEffort: handle.modelPolicy?.reasoningEffort` to the recovery `adapter.spawn`, although ordinary dispatch correctly passes `task.effortResolved` at `impl/src/coordinator.mjs:576-581`.

Failure sequence: spawn a resumable task with `{effort:"high"}` and no `modelPolicy.reasoningEffort`; admission/resolution and the handle retain `effortRequested/effortResolved:"high"`; after a recoverable transport loss, recovery reattaches with `reasoningEffort:undefined`; the adapter constructor/default may therefore select another effort while Baton continues attributing the turn to the old resolved route key. This violates RT1, RT5, RT6, and RT10 and can turn a recovery into silently misrouted work unless the provider happens to echo effort and trigger RT7.

Missing regression: exercise `recover()` (or its public recovery entry point) for a task admitted with only top-level effort, assert the resumed native adapter receives `handle.effortResolved`, then emit matching and mismatching native metadata and prove attribution/kill/reap. The current Phase 14 tests cover only initial `spawn` (`impl/test/phase14-route-tuple.test.mjs:101-139`).

### High — arbitrary worker payload can forge `modelObserved` and trigger a policy kill

Source: `impl/src/coordinator.mjs:2480-2506` accepts `payload.modelObserved`, `modelId`, or `model` from every adapter event without restricting kind or establishing native mapping. Replay is broader still: `impl/src/coordinator.mjs:3018-3020` imports those fields from every otherwise-unhandled event. Effort correctly has an authoritative-kind boundary at `impl/src/coordinator.mjs:2509-2513` and `2908-2912`; model does not.

Failure sequence: untrusted worker result/prose or another non-native event contains `model:"different"`; coordinator records it as observed provider identity, appends `model.mismatch`, fails the task, and begins kill. On replay, even an innocuous unknown event can overwrite `modelObserved` without a live mismatch decision. This confuses orchestrator-resolved values, native wire observations, and worker prose, contrary to RT6's attribution model and the brief's explicit trust distinction.

Missing regression: mirror the existing untrusted-effort test (`impl/test/phase14-route-tuple.test.mjs:197-207`) with `model`, `modelId`, and `modelObserved` in `lifecycle.turn_completed` and an unknown worker event; assert they neither establish observation nor mismatch, live or after replay. Separately prove adapter-mapped native lifecycle/usage metadata still can.

### Medium — lifecycle/event tuple attribution is incomplete

Source: the initial orchestrator `lifecycle.spawned` has the full tuple and route key (`impl/src/coordinator.mjs:548-559`), but `lifecycle.turn_started` records only model axes (`impl/src/coordinator.mjs:593-597`). The common adapter-event attribution object contains model/effort only (`impl/src/coordinator.mjs:2530-2537`), omitting `harnessRequested`, `harnessResolved`, and `routeKey`. Consequently resource and terminal events appended through it do not expose the complete RT6 tuple. Several control/integration events likewise rely only on the generic `harness` field, which cannot distinguish the requested registry key from resolved card identity.

Failure sequence: consume an individual turn/resource/terminal event without joining it to spawn state; requested versus resolved harness and route identity are absent, so durable event-level attribution promised by RT6 cannot be established. Replay may reconstruct some values from earlier events, but that does not satisfy event exposure and fails for exported/filtered event slices.

Missing regression: table-drive spawn, turn, resource, terminal, verification, and integration events and assert all nine requested/resolved/observed fields plus `routeKey` are present with nulls where observation is unavailable. Existing assertions inspect spawn/verification/result/replay selectively (`impl/test/phase14-route-tuple.test.mjs:141-183`) and therefore pass without proving the event contract.

## RT contract disposition

- RT1-RT3: initial direct/web normalization, conflict-before-allocation, exact validation, per-card auto filtering, scoring, and exact selected tuple are implemented and tested. Recovery is the exception described above.
- RT4: `routeTupleKey` is collision-safe JSON over card identity/version, resolved-or-default model and effort, family, and task type. Driver candidates use resolved tuples (`impl/src/index.mjs:156-172`), verified outcomes record the stored route key, and observed identity does not rebucket. `AdaptiveRouter._candidateBucket` checks exact evidence first and consults legacy aliases read-only only when exact evidence is absent (`impl/src/router.mjs:155-168`); recording remains exact-only. No legacy-write bypass found.
- RT5: initial Codex thread/turn RPCs and Claude/Grok CLI controls are mapped; fake forwarding is covered. Recovery violates task-level precedence as above.
- RT6: handles, results, replay, review, verification, story, and coordination carry substantial attribution, but native model trust and per-event completeness have the defects above.
- RT7: authoritative effort mismatch fails and uses confirmed two-phase kill/reap; verification and router recording are blocked by terminal status. Deterministic coverage proves this path.
- RT8: capture uses observed-or-resolved dispatch attribution and `worktree.mjs` emits `Baton-Effort`; worker claims remain outside verification authority.
- RT9: authenticated web schema strictly accepts and independently forwards harness/model/effort; empty/unknown arguments fail before durable command admission and existing auth/fence controls remain in the dispatch path.
- RT10: replay defaults absent legacy effort fields to null and preserves stored tuple fields/key; compatibility normalization from `modelPolicy.reasoningEffort` works. Recovery and replayed model provenance are exceptions above.
- RT11: deterministic coverage exists for the main initial-dispatch paths, native argument mapping, learning separation, replay/review/commit attribution, and mismatch reap, but lacks the three regressions identified above.

## Residual live evidence

Implementation defects are listed above. Separately, live recursive Codex dogfood and isolated authenticated Claude/Grok wire evidence are not established by these zero-quota suites. In particular, authenticated concurrent Grok 4.5/Grok Build route/kill/reap remains residual live evidence (`PENDING-LIVE` when credentials are unavailable), and equivalent live Claude native echo evidence should not be inferred from argument-construction tests. No homelab integration was inspected or added.
