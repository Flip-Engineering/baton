# Phase 14 route-tuple independent Codex review — 2026-07-11

## Verdict

One actionable implementation defect remains. The deterministic gate passes, but its auto-routing test replaces the production routing callback and therefore does not prove the assembled-driver contract that is broken below.

## Finding

### High — assembled auto routing crashes when any adapter is filtered out of the exact tuple

**Contracts:** RT2, RT3, RT9, RT11.1, RT11.3.

**Source:** `impl/src/coordinator.mjs:434-452` correctly constructs `cards` from only candidates supporting the requested model, effort, session, family/policy, and other card constraints. `impl/src/index.mjs:148-154` then incorrectly derives `feasible` from every `opts.adapters` key and immediately reads `cards[v].concurrencyCeiling` and `cards[v].nonRefuserFor`. A filtered adapter has no `cards[v]`, so the first read throws `TypeError`.

**Failure sequence:** configure two adapters, one supporting `low` and one supporting `high`; call direct production `createDriver`/assembled coordinator spawn with `{harness:'auto', model:<shared exact model>, effort:'high'}`; coordinator correctly omits the low-only card; production `route` still iterates the low adapter; dereferencing the absent card throws during `_dispatchPass`. The request neither selects the sole valid exact tuple nor cleanly queues/fails. The same failure is reachable through authenticated web dispatch after admission because web forwards the tuple to this coordinator.

This is also a compatibility failure for heterogeneous pre-Phase-14 installations: any auto request whose model policy, effort inventory, or session mode removes only some registered adapters can crash instead of filtering them.

**Why tests pass without proving the contract:** `impl/test/phase14-route-tuple.test.mjs:134-149` injects a custom route callback that uses `Object.keys(cards)`; it never instantiates or invokes the production callback in `impl/src/index.mjs`. Router migration tests exercise `AdaptiveRouter` alone, not candidate assembly.

**Missing regression:** construct the assembled driver with at least two cards where exactly one is excluded independently by effort (and preferably table cases for model policy and session mode), issue both direct and authenticated-web `auto` spawns, and prove the surviving exact tuple is scored and dispatched without an exception. The assertion must exercise `impl/src/index.mjs` rather than an injected route stub.

## Contract trace

- **RT1–RT3:** request axes, conflict-before-allocation, exact inventory checks, and per-card coordinator resolution are implemented; the production handoff defect above breaks partial-pool auto selection.
- **RT4:** the JSON tuple key includes card name/version, exact-or-default model and effort, family, and task type. Candidate scoring and verified recording use the resolved key. `impl/src/router.mjs:151-166` uses legacy aliases as read-only fallback only when no exact bucket exists; exact evidence wins. Focused router tests prove both precedence and non-writing fallback.
- **RT5:** Codex maps effort on `thread/start` and every `turn/start`; Claude session mode maps `--effort`; Grok ACP maps `--reasoning-effort`; task-level coordinator values reach adapter options. Mock coverage proves forwarding. Native wire observation remains distinct from resolved configuration.
- **RT6:** attribution is carried through handles/task records, operational and coordination events, result/replay, story, review, verification/integration, and capture metadata. Observation is accepted only from adapter-mapped `lifecycle.spawned`/`resource.tokens`; result/content prose cannot forge it.
- **RT7:** authoritative mismatch records `effort.mismatch`, durably fails, invokes ordinary confirmed kill, suppresses trust-gate verification after terminal failure, and cannot record a routing win. Tests prove kill confirmation and reap, though not the production assembled route defect.
- **RT8:** snapshot capture retains task/vendor/model trailers and conditionally emits `Baton-Effort`; worker artifact prose remains an unverified claim.
- **RT9:** web schema admits only the strict spawn fields, rejects empty effort before command admission, and forwards harness/model/effort independently; coordinator performs policy conflict and inventory checks. Existing authentication/origin/CSRF/repository/idempotency/fence controls are unchanged. Auto dispatch remains affected by the finding.
- **RT10:** replay restores tuple attribution and route key, defaults absent legacy fields to null, and normalizes legacy `modelPolicy.reasoningEffort` into explicit requested/resolved attribution without fabrication.
- **RT11:** deterministic coverage exists for direct/web forwarding, no-allocation rejection, tuple identity, verified-only learning, attribution/replay/review/trailers, mismatch stop/reap, and all three native mappings. The assembled auto-routing regression described above is absent.

## Residual live evidence (not implementation defects)

- **Codex:** the specified recursive `CodexAppServerCli + gpt-5.6-sol + low` dogfood proof is live/environmental evidence and is not established by this zero-quota review.
- **Grok:** isolated authenticated concurrent Grok 4.5/Grok Build routing, kill, and complete-reap proof remains `PENDING-LIVE` when isolated credentials are unavailable; ambient credentials must not be used.
- **Claude:** deterministic native `--effort` mapping is covered, but no provider echo is available here, so `effortObserved:null` is legitimate. No live Claude observation claim is made.
