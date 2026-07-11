# Phase 12 web-edge adversarial review — 2026-07-11

## Scope and method

Independent review of `spec/phase12/web-edge-policy.md` (EP1–EP9), the current Phase 12 web edge, northbound, authentication/session, and stream implementations, and the five Phase 12 test files named by the required verification command. Prior evidence logs were not read. No source, network, homelab, or fleet action was performed.

## Findings

### HIGH — EP1/EP4: duplicate `Forwarded` field-lines are accepted as one trusted chain

- **Source:** `impl/src/web-edge.mjs:130-151`, especially the use of `req.headers.forwarded` at line 134 and comma splitting at lines 106-110; `impl/src/web-northbound.mjs:301-318` passes the real request directly to this resolver. The current EP1 tests in `impl/test/phase12-web-edge.test.mjs:25-47` construct only the already-normalized `headers` object and do not exercise duplicate wire field-lines through `rawHeaders` or a real HTTP listener.
- **Failure:** Node may combine repeated `Forwarded` field-lines into a comma-separated value in `req.headers`. The resolver does not inspect `req.rawHeaders` to distinguish one deliberately supplied forwarding chain from multiple duplicate field-lines. Consequently two individually valid duplicate `Forwarded` lines become a syntactically valid two-element chain. With `forwardedHop` selecting from the right, the accepted client address and selected `proto` can differ from what a proxy or intermediary treats as the authoritative field-line. This contradicts EP1's requirement that ambiguous forms fail typed and EP4's requirement for an exact forwarding signal. Because this occurs only after exact immediate-peer trust, it is not an untrusted-peer upgrade, but it is a high-impact ambiguity at the sole trusted boundary.
- **Regression:** Reject repeated occurrences of `forwarded`, `x-forwarded-for`, and `x-forwarded-proto` using the wire-level header list before parsing; retain the existing mixed-family rejection. Add a real HTTP proxy-mode test that sends duplicate field-lines (including equivalent comma-join outcomes), proves a typed audited refusal, proves no provider/session/fleet work, and proves neither supplied address appears in audit. Also retain positive single-field multi-hop IPv4/IPv6 cases.

No other actionable implementation defect was found.

## EP verdicts

### EP1 — canonical client address: **finding above; otherwise clean**

Direct mode ignores forwarding headers and derives transport/address from the socket. Proxy trust is exact after canonicalization; expanded IPv6 and IPv4-mapped IPv6 converge, while zones and address ports are rejected. Trusted parsing bounds length and hops, rejects mixed header families, unknown/duplicate parameters, controls/escapes, malformed quoting, invalid protocols, and hop underflow. Address audits use a keyed digest and classification rather than raw peer/client values. The unresolved wire-level duplicate-header ambiguity is the finding above.

### EP2 — quota authority: **clean**

Configuration rejects non-positive/non-safe limits, windows, cardinality, and unknown quota names. Fixed windows have injected monotonic safe-integer clocks, deterministic expiry, bounded active keys, bounded positive `Retry-After`, and no random eviction. Address, login, principal count, weighted cost, ticket issuance, health, readiness, and concurrent connection policies are separated. Combined command preflight samples once and does not mutate either authority when either clock/capacity/limit check fails. Ticket reservations roll back on issuance/audit/capacity failure and synchronous HTTP header/body delivery failure; rollback is tied to the exact quota entry and ticket state. Connection leases are acquired before ticket consumption, refusals preserve tickets, and every terminal stream path releases once.

### EP3 — refusal ordering: **clean**

Canonical edge identity and ordinary address quota precede target parsing, authentication, bodies, providers, session mutation, command admission, dispatch, and stream work. Login quota is consumed only after HTTPS, Origin, content type, bounded JSON, and object validation, and before the provider. Authentication and authorization precede principal/cost quota, which precedes durable command admission and dispatch. Ticket Origin/repository/capability/live-principal checks precede ticket quota. Client IDs do not select buckets. Refusal audit failure converts the response to fail-closed 503, and tested refusals leave provider/session/command/fleet/stream state unchanged.

### EP4 — explicit transport/server modes: **finding above; otherwise clean**

Direct policy cannot carry proxy trust or forwarding hops and the production direct listener requires TLS material. Cleartext assembly requires an actual proxy-mode `WebEdgePolicy` with a nonempty exact peer allowlist; TLS and cleartext-proxy postures cannot be combined or substituted with lookalikes. All routes, including probes, pass listener-wide canonical HTTPS enforcement. Untrusted forwarding cannot upgrade transport or choose address identity. The duplicate-field exact-signal defect is shared with EP1.

### EP5 — health/readiness: **clean**

Health discloses only `{ok:true}`. Readiness discloses only `{ready:boolean}` and fails closed for closed admission, coordination/audit health, session health, authentication/liveness health, or configured admission checks. Production assembly verifies that readiness holds the listener's identical coordination, session, and authenticator objects. Probe quotas are independent. Transition state advances only after successful transition audit, so failed appends retry without disclosing dependency details.

### EP6 — shutdown/drain/backpressure/no-fleet-effects: **clean**

Admission flags close synchronously before asynchronous shutdown work; provider completion races cannot issue credentials afterward, and stream acceptance closes permanently. Shutdown is memoized, audits start/terminal state, closes streams, drains the listener, force-closes after the deadline, and returns a bounded degraded result for audit or synchronous stream-cleanup failure. Stream shutdown and lag controls enforce both frame and buffered-byte ceilings; write refusal/throw leads to one cleanup/end attempt and exactly-once lease release. Repeated stream or northbound shutdown is idempotent. No path invokes worker interruption, kill, or changes worker truth, and tests assert no fleet calls.

### EP7 — audit/restart posture: **clean**

Proxy, transport, target, quota, readiness, stream, and shutdown events are append-only through the coordination authority and admission fails closed where audit durability is required. Address and credential identifiers are HMAC-digested; forwarding values and raw addresses are not persisted. Responses do not surface audit/dependency causes. Quota maps are process-local operational state; command/session/idempotency state remains in the durable authorities and is not inferred from quota state.

### EP8 — deterministic acceptance: **clean for the reviewed Phase 12 scope, with the regression addition above**

The current suites cover IPv4/IPv6 canonicalization, mapped addresses, direct/trusted/untrusted forwarding, malformed/mixed chains, TLS postures, quota ordering/expiry/cardinality/clock regression/atomicity, ticket compensation, non-disclosure, authority binding, connection cleanup, drain deadlines, shutdown races/idempotency/degradation, and no-fleet-effects. Add the real-listener duplicate-wire-header regression described in the finding. Recursive Baton orchestration claims are process/evidence procedure rather than an additional runtime trust seam and were not independently claimed here.

### EP9 — deferred scope: **not an EP defect**

OIDC redirect/callback mechanics, optional WebSocket parity, browser automation, MCP, and operator UI remain explicitly deferred. Nothing in the reviewed implementation silently claims those surfaces. Their absence is therefore separated from the EP1 duplicate-header defect and is not reported as a Phase 12 web-edge failure.

## Overall verdict

EP1 and EP4 have one shared high-severity trusted-proxy header-ambiguity defect. EP2, EP3, EP5, EP6, EP7, and the implemented acceptance surface of EP8 are clean under the reviewed code and tests. EP9 items are deferred scope, not defects.
