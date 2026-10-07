# Phase 73 — provider-result and required-effect honesty

Status: provider-failure and explicit required-effect gates locally green; affected suites green.

This phase closes two different false-success classes without conflating them:

1. a provider-native failed turn must never enter candidate verification; and
2. a provider-native completed turn may enter verification, but a Plan that explicitly requires a
   repository mutation must not accept an unchanged base merely because its verifier already passes.

Provider prose is never the trust boundary. Structured adapter status, an approved Plan's explicit
required-outcome contract, captured Git identity, and hub verification are the authorities.

## PH1 — failed provider results bypass the trust gate

Only a normalized WorkerResult with exact `status: completed` may enter repository capture and the
referee. `failed`, `blocked`, missing, or unknown statuses durably transition the task to failed,
record a bounded `provider_failure/provider_turn_failed` cause, and begin the normal two-phase
stop. Phase 70 may capture dirty progress only as a non-adoptable checkpoint before kill/reap.

The failed path creates no verifier sandbox, verifier invocation, `verify.reverified` event,
accepted result ref, accepted artifact, adoption action, export action, or route win. Restart
reconstructs the same provider failure rather than `verifying`. A successful result containing
error-like prose remains successful; no string matcher can override structured native status.

## PH2 — adapter-native failure mapping

Every adapter maps provider-native terminal status before producing a WorkerResult. Claude
`is_error`, Codex failed turn status, ACP non-`end_turn` terminal outcomes, authentication refusal,
rate limits, model refusal, and protocol failure remain failed even if the CLI exits zero.
Provider-specific detail may enrich private evidence, but only a closed public code crosses the
ordinary application surface.

The Coordinator repeats the exact-status check defensively so a third-party adapter cannot bypass
the rule by emitting a failed WorkerResult under `lifecycle.turn_completed`.

## PH3 — explicit required effects

Goal/Plan gains a separate closed `requiredEffects` field. Existing `effects` continues to mean
effects the node is authorized to perform; changing that field to mean required outcomes would
break read-only and mixed-purpose plans. `requiredEffects` is a subset of `effects` and initially
supports `repository_edit`.

When `repository_edit` is required, capture must prove a nonempty exact diff from the authorized
base SHA inside path scope. An unchanged SHA, empty changed-path set, edits later reverted to the
base tree, or changes only outside scope fail with `required_effect_absent` before result retention.
A read-only node or a node that merely permits edits may succeed unchanged when its independent
verification contract passes.

Required effects are immutable Plan authority and flow through the authoritative Brief, dispatch
binding, replay, retry, follow-up, recovery, review, RunView outline, and evidence manifest. They
cannot be added by a worker result, a CLI flag, or untrusted prose.

## PH4 — application behavior

A failed provider Run reaches `phase: failed` with `result: null`, no adopt/export actions, one
bounded terminal cause, and an optional resumable checkpoint action only when progress was pinned.
Operator depth may explain that the provider failed and progress was preserved; it must not call
the checkpoint an accepted result.

A missing required effect also reaches failed with a distinct policy cause and fresh capture
evidence. It may offer a plan-authorized retry or preserved resume, never adoption of the unchanged
base.

## PH5 — acceptance

Deterministic tests prove:

1. failed WorkerResult plus a passing verifier never invokes capture/referee for acceptance;
2. dirty failed work is checkpointed and killed/reaped without a result ref;
3. application, replay, adoption, export, and route learning remain fail-closed;
4. error-like success prose cannot trigger failure;
5. completed plus required repository edit plus no diff fails;
6. completed read-only work may pass unchanged;
7. required effects cannot exceed authorized effects or change after Plan approval; and
8. affected and full suites remain green.

No homelab integration is part of this phase.
