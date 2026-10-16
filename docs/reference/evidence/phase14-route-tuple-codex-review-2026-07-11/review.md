# Phase 14 route-tuple independent Codex review — 2026-07-11

## Verdict

No actionable implementation defect remains in the reviewed Phase 14 routing source and tests. I found no omission, false wire observation, routing-policy bypass, legacy-migration write path, compatibility break, or acceptance test that contradicts its stated contract. Requested and orchestrator-resolved values remain distinct from native wire-observed values; model-authored result/content payloads cannot establish either model or effort observation.

## Contract review

| Contract | Adversarial result and precise evidence |
|---|---|
| RT1 | Direct admission validates independent exact `model` and `effort`, normalizes legacy `modelPolicy.reasoningEffort`, and raises `effort_policy_conflict` before allocation (`impl/src/coordinator.mjs:123-149`, `656-686`). Web forwards all axes independently (`impl/src/web-northbound.mjs:12`, `55-70`, `197-205`). |
| RT2 | Explicit effort requires a known inventory member and null/empty inventories cannot support it (`impl/src/route-tuple.mjs:6-9`). Direct and auto admission reject before task/worker allocation (`impl/src/coordinator.mjs:662-686`); dispatch re-resolves without retry/default substitution (`429-454`). Tests cover unsupported and null inventories plus zero allocation (`impl/test/phase14-route-tuple.test.mjs:78-81`, `113-141`). |
| RT3 | Auto resolution is per card after session/model/policy/effort filtering; the router receives candidate-specific resolved model and effort and the chosen values are returned to dispatch (`impl/src/coordinator.mjs:427-454`). The assembled-driver test proves rejected cards are not resurrected (`impl/src/index.mjs:145-184`; `impl/test/phase14-route-tuple.test.mjs:144-190`). Existing Phase 11 selection tests cover family, tier, capability, and ceiling constraints. |
| RT4 | The collision-safe JSON route key contains card name/version, resolved model/default, resolved effort/default, family, and task type (`impl/src/route-tuple.mjs:1-4`). The assembled router scores that key and verified completion records the same task key (`impl/src/index.mjs:157-184`; `impl/src/coordinator.mjs:2829-2835`). Low/high separation is proved end to end (`impl/test/phase14-route-tuple.test.mjs:84-88`, `191-232`). |
| RT5 | Codex maps effort on thread/start and turn/start (`impl/src/codex-appserver.mjs:477-516`, `574-581`); Claude maps `--effort` (`impl/src/claude-session.mjs:17-31`, `180-185`); Grok maps `--reasoning-effort` while retaining model args/state (`impl/src/grok-acp.mjs:69-82`, `486-514`). Coordinator dispatch/recovery passes the resolved task effort (`impl/src/coordinator.mjs:590-605`, `941-954`). Protocol/argument tests cover all three native mappings, with Phase 14 explicitly covering Claude/Grok (`impl/test/phase14-route-tuple.test.mjs:108-110`). |
| RT6 | The common attribution projection supplies all nine tuple fields to operational lifecycle/resource/terminal/verification/integration events (`impl/src/coordinator.mjs:470-481`, `2549-2683`). Public handles/results and replay retain them (`impl/src/coordinator.mjs:1247-1262`, `2234-2249`, `2890-3169`); durable claim and route-observation records retain them (`impl/src/coordination-store.mjs:143-151`, `286-294`; `impl/src/coordinator.mjs:2675-2682`). Story projection consumes only top-level/native lifecycle attribution (`impl/src/story.mjs:307-323`). Review and commit attribution are preserved (`impl/src/coordinator.mjs:842-893`, `2705-2709`, `2810-2824`; `impl/src/worktree.mjs:203-221`). The lifecycle projection loop is asserted in `impl/test/phase14-route-tuple.test.mjs:191-261`. |
| RT7 | Only adapter-mapped `lifecycle.spawned`/`resource.tokens` metadata can establish observation; a mismatch appends attributed `effort.mismatch`, durably fails, and enters ordinary confirmed stop/reap (`impl/src/coordinator.mjs:2495-2547`). Terminal tasks cannot enter verification (`2567-2571`), hence no verified routing record follows. The mismatch and forged-prose sequences are tested (`impl/test/phase14-route-tuple.test.mjs:263-298`). |
| RT8 | Snapshot capture uses observed identity when authoritative and otherwise resolved dispatch identity, adding `Baton-Effort` without treating the worker result as verification (`impl/src/coordinator.mjs:2703-2710`; `impl/src/worktree.mjs:203-221`). The Phase 14 verified-run test asserts capture effort (`impl/test/phase14-route-tuple.test.mjs:191-215`). |
| RT9 | Spawn has a strict argument allowlist, non-empty effort validation, strict model-policy fields, and independent forwarding (`impl/src/web-northbound.mjs:10-13`, `55-70`, `197-205`). Authenticated admission remains upstream of dispatch; Phase 12 tests exercise that full path, while Phase 14 tests exercise schema and forwarding (`impl/test/phase14-route-tuple.test.mjs:91-105`, `161-190`). |
| RT10 | Operational and coordination replay default absent effort/route fields to null and never derive observation from result prose (`impl/src/coordinator.mjs:803-825`, `2890-2931`, `3104-3169`). Policy-only effort is normalized to the same `effortRequested` before allocation (`impl/src/coordinator.mjs:123-149`, `662-664`). |
| RT11 | The deterministic suite covers direct/web exact forwarding, pre-allocation refusal, per-card auto filtering, distinct verified learning buckets, attribution/replay/review/commit input, mismatch stop/reap, and native mappings (`impl/test/phase14-route-tuple.test.mjs:78-298`), supplemented by the named Phase 8/11/12/router suites in the acceptance command. |

## Legacy learning migration

Exact tuple evidence wins whenever its bucket exists. Only when it does not exist does selection consult legacy aliases; recording has no alias path and writes only the exact route key (`impl/src/router.mjs:153-167`; `impl/src/index.mjs:157-184`). The precedence and fallback contracts are independently tested at `impl/test/router.test.mjs:472-496`. This is read-only fallback, not bucket collapse or dual-write migration.

## Residual live evidence (not implementation defects)

- Claude: deterministic native CLI argument mapping is proved, but this review did not produce a live provider echo of effort. A provider that does not echo effort correctly remains `effortObserved: null`; it must not be inferred from dispatch.
- Grok: deterministic ACP argument/model-state behavior is proved. Isolated authenticated Grok 4.5/Grok Build route/kill/reap evidence remains dependent on available isolated authentication and is separately `PENDING-LIVE`, as allowed by RT11.
- No homelab integration was inspected or added. This report is an independent Codex turn, not a claim of cross-vendor independence.

## Missing regressions

None required for an actionable defect. A future hardening test could assert whitespace-only effort policy according to any later identifier grammar, but the current specification requires a non-empty exact string, which the implementation enforces.
