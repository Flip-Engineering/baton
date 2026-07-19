# Phase 87 — Semantic action authority

## Decision

`run.act` is a semantic effect dispatcher, not an observe operation. Baton derives the required
capabilities from the selected action kind and enforces them independently at every northbound
admission boundary and again immediately before the application effect. A caller cannot gain
effect authority merely because it can inspect a Run or possess an action ID.

The action-capability registry is closed, exhaustive, frozen, and owned by the application. Plan
node capabilities describe workflow authority; they are not user or transport authorization and
must never be used to authorize a northbound principal.

## SA1 — Closed semantic capability registry

Every advertised semantic action includes `requiredCapabilities`, derived from one registry:

| Action kind | Required capabilities |
| --- | --- |
| `context_eval`, `context_retry`, `context_reduce`, `context_map`, `context_search`, `context_chunk`, `context_coverage` | `control`, `observe` |
| `approve_plan`, `answer_approval` | `approve`, `observe` |
| `answer_question` | `control`, `observe` |
| `adopt_result` | `adopt_result`, `observe` |
| `select_candidate`, `send_feedback`, `revise_candidate` | `control`, `observe` |
| `stop_member`, `stop` | `emergency_stop`, `observe` |
| `semantic_review` | `review`, `control`, `observe` |
| `integrate` | `integrate_result`, `observe` |
| `export_result` | `export_result`, `observe` |
| `retry_verification` | `retry_verification`, `observe` |
| `resume_work` | `resume_work`, `observe` |

Unknown kinds fail closed. Capability lists are canonical, immutable, and part of the action's
authority identity. `run.act` no longer advertises a single misleading command capability.

## SA2 — Authority is resolved before durable admission

For a new Web or MCP `run.act` request, Baton:

1. resolves the current action ID through the application;
2. derives its kind, effect, and required capabilities;
3. authorizes the current principal for every required capability;
4. only then spends quota or appends a durable admission; and
5. persists the resolved semantic authority with the admission.

A denied request creates no admission, idempotency record, quota charge, or application effect.
The persisted semantic authority binds at least the action ID, kind, effect, required capabilities,
and a canonical digest. It contains no bearer token or secret.

For an already admitted idempotent replay, Baton reads the admission by scope before attempting
current action resolution. It verifies the request digest, reauthorizes the current principal
against the persisted semantic authority, and permits completed-response replay even when the
action is no longer advertised. A capability downgrade therefore denies replay; a vanished action
does not make an authorized completed replay unrecoverable.

Races between preflight and admission are closed by checking that the returned durable admission
contains the same semantic authority before dispatch.

## SA3 — Application-side confused-deputy defense

Web and MCP pass a transport-specific, opaque capability-authority token plus the principal's
authorized capability set into the application command context. The application validates the
token; callers cannot mint a trusted northbound context by copying ordinary JSON fields.

`BatonApplication.act` re-resolves the action and verifies the supplied semantic authority before
entering `_withRunEffect`. It centrally authorizes the derived semantic subject, then rechecks the
action immediately before applying the effect so stale action IDs, kind changes, or authority
changes fail closed.

Direct in-process callers remain governed by the deployment's application authorizer. They do not
need to forge northbound tokens, but they receive the same closed action-kind derivation and
application-side authorization subject.

`authorizeReplay` uses persisted semantic authority for an admitted `run.act`; it must not silently
fall back to generic observe authority or require the action to remain current.

## SA4 — Surface and bridge consistency

The Web server, native MCP server, and MCP-over-Web bridge use the same registry and preflight
contract. None independently hard-code an incomplete capability mapping. MCP marks `run_act` as
destructive because its selected semantic action may mutate or stop a Run; the action descriptor
provides the precise required capabilities for interactive clients.

The default permissive deployment authorizer remains a deployment posture, not a reason to skip
derivation or enforcement. Production attach work must provide a scoped principal authorizer and
must not expose a resident control coordinate until this phase is green.

## Acceptance order

1. red direct-application tests for every action kind, unknown-kind refusal, stale authority, and
   pre-effect recheck;
2. application registry, descriptors, resolver, trusted context, and replay authorization;
3. read-only admission lookup by Web and MCP idempotency scope;
4. Web denial matrix proving zero quota, admission, and effect before authorization;
5. native MCP denial matrix with the same proof;
6. completed-replay tests for action disappearance, capability downgrade, request mismatch, and
   semantic-authority mismatch;
7. MCP-over-Web parity tests;
8. focused suites, full implementation suite, and `git diff --check`; and
9. a bounded Baton-on-Baton adversarial review whose worker is stopped and reaped exactly.

## Follow-on dependencies

Phase 87 gates authenticated attach/discovery/steer/interrupt and resident hosting. It does not
replace route-tuple Plan authority v2, verified harness containment, or the remaining recursive
composition and semantic-code intelligence goal.

## Acceptance evidence

The exact-routed Baton review Run `run-4e3e3318734c6ba943673ef3bdc479b6` used
`glm / glm-5.2 / xhigh`, produced preserved result
`92c7eb1c7668075ea3d1516e5d5c089bcf608323`, and found one bounded MCP-over-Web completed-replay
conformance defect. The bridge now revalidates the opaque MCP token, current principal
capabilities, action identity, current registry effect and capabilities, and canonical authority
digest before returning a cached result. Closure Run `run-93b004db46a193776676218ab1b00c80`
used the same exact route, produced `42b5ca09d01e6f17c6d4df9b649cab78b52127bd`, and found no
remaining concrete bypass. Its remaining unit-matrix gaps were added after review.

The full implementation suite is green at 2,148/2,148 after the bridge fix. Focused Phase 87
coverage is 5/5 after the final adversarial matrix. Both live Runs were stopped through the Run
application; application close reported zero workers, Git reported only the main worktree, and the
shared capacity ledger reported zero reservations. The compact stop projection still serializes
`stop: null`/`ownership: null`; that is a progressive-result evidence defect, not evidence that
cleanup remained active, and stays in the attach/visibility follow-on.

Exact route dogfood also retained three readiness/runtime observations: Codex selected and
attested `gpt-5.6-sol / low` but crashed before work with the generic `provider_crashed` cause;
native Kimi Code and Grok were refused before launch as `authentication_refresh_required`; GLM
5.2/xhigh remained the only proven live review route. Baton did not modify provider login state.
