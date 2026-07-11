# Phase 14.1 — explicit harness, exact-model, and effort routing

This specification completes GitHub issue #2. It makes the orchestrator's route request an
explicit three-axis tuple rather than treating effort as an incidental adapter default or a hidden
model-policy hint. It extends Phase 11 MS1–MS5 and applies equally to direct driver calls and the
authenticated web northbound. It has no homelab or deployment integration.

## RT1 — three independent request axes

The canonical request is `{harness, model?, effort?}`. `harness` may be an exact registered adapter
key or `auto`; `model` is an exact provider model identifier; `effort` is an exact harness-native
reasoning-effort identifier such as `low`, `medium`, or `high`. None is encoded into another field
or inferred from a CLI executable name.

`Coordinator.spawn(harness, brief, {model, effort, modelPolicy})` and web `spawn.args` accept the
same tuple. Omitting effort means the card/configured default, not that effort identity is
irrelevant. Existing `modelPolicy.reasoningEffort` remains a compatibility constraint. If both are
present they must be equal; disagreement is a typed `effort_policy_conflict` before task/worker
allocation or logging.

## RT2 — exact validation and no fallback

An explicit effort must be a non-empty string and must appear in the chosen card's
`modelSelection.reasoningEffort` inventory. Null/unknown inventories cannot claim support for an
explicit effort. Unsupported exact harness/model/effort tuples fail visibly; automatic routing
filters them before scoring. The coordinator never retries with another effort or silently uses a
harness default.

## RT3 — resolution is per candidate

For automatic harness selection, each candidate is resolved independently against the requested
model, effort, family allow/deny, preference, service-tier constraint, session mode, capability,
and concurrency ceiling. The adaptive router sees the resolved candidate tuple—not merely the
adapter card's configured default. Selecting the harness returns the exact model and effort that
were scored.

## RT4 — stable route identity

The learning bucket identity is a collision-safe encoding of:

```text
harness card name, harness card version, resolved exact model or declared default,
resolved effort or declared default, model family, task type
```

Candidate scoring and verified-outcome recording use the same resolved tuple. Observed provider
identity is attribution, not a reason to record the outcome into a different bucket. Low- and
high-effort runs of the same harness/model/task type therefore learn independently. Legacy generic
router tests may continue to use opaque `modelVersion` strings; the assembled driver must use the
full route-tuple key.

## RT5 — native wire mapping

- Codex app-server maps effort to `thread/start` and `turn/start` `effort`.
- Claude/GLM session mode maps effort to the native CLI `--effort` control where supported.
- Grok Build/ACP maps effort to `--reasoning-effort` and preserves the ACP model state.
- Mock/fake adapters expose the received effort so zero-quota driver tests prove the coordinator
  did not drop or rewrite it.

Constructor defaults apply only when the task omitted effort. A task-level value always wins.

## RT6 — requested, resolved, and observed attribution

Task state, public handles, results, replay, spawn/turn/resource/terminal/verification/integration
events, story/scorecard projections, review attribution, and durable coordination records expose:

```text
harnessRequested, harnessResolved,
modelRequested, modelResolved, modelObserved,
effortRequested, effortResolved, effortObserved
```

`harnessResolved` is the card identity/version actually dispatched, distinct from the registry key.
An adapter may leave `effortObserved:null` when the provider cannot echo it; Baton must not invent
wire observation from the request. Adapter-emitted native effort metadata may establish it.

## RT7 — mismatch is a lifecycle fault

When authoritative native metadata reports an effort different from the resolved exact effort,
Baton appends `effort.mismatch`, fails the task, and uses ordinary confirmed two-phase kill/reap.
The event records requested, resolved, and observed tuple fields. No subsequent verification or
routing win is recorded for the mismatched run.

## RT8 — snapshot commit attribution

Captured worker commits retain `Baton-Task`, `Baton-Vendor`, and `Baton-Model` trailers and add
`Baton-Effort` when a resolved/observed effort exists. Trailers reflect dispatch attribution only;
they never turn the worker's result claim into verification evidence.

## RT9 — web schema parity

Authenticated web spawn accepts strict top-level `args.harness`, `args.model`, and `args.effort`,
plus `modelPolicy`. Unknown/empty effort fails before durable command admission. Dispatch forwards
all three independently. Credential, origin, CSRF, repository, idempotency, fence, sandbox,
verification, and approval controls remain unchanged.

## RT10 — replay and compatibility

Replay restores all requested/resolved/observed tuple fields and the route key from durable events.
Older ledgers without effort fields replay them as null/default without fabrication. Existing
callers using only `modelPolicy.reasoningEffort` retain equivalent behavior and receive explicit
effort attribution after normalization.

## RT11 — deterministic acceptance gate

Zero-quota tests prove:

1. direct and web spawn forward an exact harness/model/effort tuple;
2. top-level effort/policy conflict and unsupported effort allocate no task/worker;
3. auto routing filters per-card effort support and scores the task-resolved tuple;
4. low and high effort form distinct learning buckets and only verified outcomes update them;
5. requested/resolved/observed effort survives handles, events, result, replay, review, and commit
   trailers;
6. observed mismatch fails, confirms stop, and fully reaps; and
7. native adapter argument/RPC tests prove Codex, Claude, and Grok mapping.

After deterministic tests pass, recursive Baton dogfood uses
`CodexAppServerCli + gpt-5.6-sol + low` and checks exact observed attribution plus complete reap.
When isolated Grok authentication is available, concurrent Grok 4.5/Grok Build workers repeat the
route, kill, and reap proof. Missing authentication is recorded `PENDING-LIVE`; ambient credentials
are never projected and isolation is never weakened.
