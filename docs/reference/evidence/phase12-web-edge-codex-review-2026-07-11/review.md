# Phase 12 web-edge adversarial review — 2026-07-11

## Scope and method

Independent source-and-test review of EP1–EP9 against `spec/phase12/web-edge-policy.md`, the current Phase 12 northbound/session specifications, `impl/src/web-edge.mjs`, `web-northbound.mjs`, `web-stream.mjs`, `web-auth.mjs`, the coordination authority used for readiness/idempotency, and the five Phase 12 test files named by the acceptance command. Prior evidence logs were not read. No source, network, homelab, or fleet action was performed.

## Findings

### MEDIUM — EP3 login quota is charged by pathname before method/route validation

- Source: `impl/src/web-northbound.mjs:289-301`, with route selection only later at `:306-317`.
- Failure: every request whose parsed pathname is `/v1/auth/login` consumes both the ordinary address quota and the login quota, regardless of method. In particular, permitted CORS `OPTIONS /v1/auth/login`, `GET`, and other non-login requests burn the same address login bucket as a real `POST`. An unauthenticated caller sharing a canonical address can exhaust the login limit without making provider calls or submitting a login attempt, refusing subsequent legitimate login with `429` for the remainder of the window. This contradicts the EP2/EP3 policy's “unauthenticated login attempts” authority and turns harmless/preflight traffic into a login-denial primitive.
- Regression: set `login: 1`; send an allowed-origin `OPTIONS /v1/auth/login`; then send a valid `POST /v1/auth/login`. The preflight must be `204`, must not consume the login bucket, and the POST must reach the provider. Also cover GET/unknown methods and confirm they do not consume login quota.
- Action: apply the login quota only after confirming the request is the admitted login method/path (while retaining it before body parsing and provider invocation).

### MEDIUM — EP2 injected clock output is unchecked, allowing non-expiring keys and invalid `Retry-After`

- Source: `impl/src/web-edge.mjs:14-18`, `:20-40`, and the shared command timestamp at `:138-146`.
- Failure: configuration validates only that `now` is a function. `take()` and `canTake()` accept `NaN`, infinities, unsafe values, or a regressing clock without validation. With `NaN`, the window start is `NaN`; expiry comparison is permanently false, a new entry is stored with `start: NaN`, and refusals expose `retryAfter: NaN` (serialized by HTTP as `Retry-After: NaN`). At cardinality capacity those poisoned entries never expire. A backward clock jump similarly retains future-window usage and can produce retry intervals far beyond the configured window. This violates deterministic expiry, bounded cardinality behavior, and bounded valid refusal metadata.
- Regression: inject clocks returning `NaN`, `Infinity`, an unsafe integer, and a value earlier than the last accepted sample. Assert fail-closed typed behavior, no key insertion/counter mutation, and no invalid `Retry-After`. Add a boundary test proving every emitted retry value is a positive finite integer no larger than the configured window rounding.
- Action: validate every sampled/explicit timestamp as a non-negative safe integer and define/enforce monotonic-clock behavior (reject regression without mutation, or clamp to the last accepted sample).

### LOW — EP7 readiness transition can become permanently unaudited after a transition-write failure

- Source: `impl/src/web-northbound.mjs:152-162` (`_readinessResponse`).
- Failure: the probe audit and transition audit share one `try`. If `readiness_probe` succeeds but `readiness_transition` throws, the catch changes the response to not-ready; then `_lastReady` is nevertheless set to that derived false value. On the next healthy probe, an actually false dependency state compares equal to `_lastReady`, so no transition audit is retried. Thus an append failure can erase the required readiness transition even after audit service recovers. The response remains non-disclosing and fail-closed, but EP7's append-only transition record is missing.
- Regression: make `recordWebAudit` succeed for `readiness_probe`, fail once for `readiness_transition`, then recover while readiness remains false. The first response must be `503`, and a subsequent probe must append exactly one false `readiness_transition` rather than treating it as recorded.
- Action: update the last-audited readiness state only after the transition append commits; keep response readiness separate from audit bookkeeping.

## EP verdicts

- EP1 — Clean apart from no finding: direct requests use the socket peer; untrusted forwarding is ignored; trusted peers require one bounded chain; mixed `Forwarded`/`X-Forwarded-*` forms fail; exact-hop selection and IPv4/IPv6 parsing are explicit. IPv4-mapped IPv6 is intentionally not aliased. Proxy-refusal audit retains only classification and keyed peer digest.
- EP2 — Findings above: unchecked clock output. Otherwise limits reject non-positive/non-integer/unsafe configuration; fixed-window maps are bounded; expiry pruning is deterministic for a valid monotonic clock; principal and weighted cost use one sampled timestamp and commit synchronously; concurrent leases are bounded and delete zero-count keys.
- EP3 — Finding above: method-independent login charging. Otherwise address refusal precedes authentication/body/provider/session/coordinator work; login refusal precedes provider work; command count/cost refusal precedes durable admission/dispatch; quota refusal audit is fail-closed; cost refusal does not consume count; connection refusal occurs before ticket consumption; client IDs do not select buckets.
- EP4 — Clean. Direct production assembly requires key/certificate and an edge/readiness authority. Cleartext assembly requires proxy mode plus a nonempty exact peer allowlist and rejects simultaneous TLS configuration. Trusted cleartext requests require exact forwarded HTTPS; untrusted peers remain socket-derived HTTP and cannot upgrade transport or address identity.
- EP5 — Clean. Health returns only `{ok:true}` and readiness only `{ready:boolean}`. Readiness is grounded in coordination/log health, live authentication/session health, optional injected dependency checks, admission state, and a successful probe audit (thereby exercising durable append/idempotency storage). Health/readiness have separate address quotas. No fleet/dependency detail is disclosed. The transition-audit bookkeeping defect is recorded under EP7.
- EP6 — Clean. Admission closes synchronously before shutdown work; login rechecks after provider completion; ticket/command paths recheck after awaited authentication/body work; streams stop accepting, receive a fixed shutdown/reconnect frame, release leases once, and close; listener drain is deadline-bounded with idle/all-connection forcing; repeated shutdown returns one promise; no coordinator/worker operation is invoked. Accepted command dispatch is allowed to drain rather than being falsely cancelled.
- EP7 — Finding above: readiness transition retry bookkeeping. Otherwise quota/proxy/shutdown audits exclude raw addresses and credential IDs, use keyed digests where identity is needed, and admission-success paths fail closed on required audit errors. Quota state is in-memory abuse state and is not used as durable command/session/idempotency truth.
- EP8 — Acceptance coverage is substantial for all named seams, but lacks the three regression cases above. The exact required verification result is recorded below.
- EP9 — Deferred, not EP defects: concrete OIDC redirect/callback behavior, optional WebSocket parity, browser automation/UI, and MCP/operator UI remain explicitly outside this vertical. No finding above depends on those deferred facilities.

## Verification

The required command was run exactly as specified after writing this review; result is reported in the handoff response.
