# Phase 12 web-edge adversarial review — 2026-07-11

## Scope and method

Reviewed the current EP1–EP9 contract in `spec/phase12/web-edge-policy.md`, the related WN/IL contracts, `impl/src/web-edge.mjs`, `impl/src/web-northbound.mjs`, `impl/src/web-stream.mjs`, `impl/src/web-auth.mjs`, and the Phase 12 edge, lifecycle, authentication, northbound, and stream tests. Prior evidence logs were not read. This was a read-only source/test review apart from this report; no source, network, homelab, or fleet action was taken.

## Findings

### F1 — High — production server assembly permits a proxy policy on the direct-TLS listener

- **EP/source:** EP4, `impl/src/web-northbound.mjs:525-540`; `impl/src/web-edge.mjs:115-122,134-137`.
- **Failure:** The cleartext branch correctly requires `edge.proxyMode`, but the TLS branch only checks `edge instanceof WebEdgePolicy`; it does not require `proxyMode === false`. Consequently `createAuthenticatedWebServer()` accepts a proxy-mode edge with TLS material. On that listener, an untrusted direct TLS peer is resolved as a non-proxied HTTPS client by `resolveEdgeRequest()` and is admitted, while a trusted peer is forced to provide forwarding headers. This is neither the explicit direct posture nor the explicit proxy posture, and makes the allowlist change request semantics based only on peer address. It also contradicts EP4's mutually explicit modes and the assembly's own “choose direct TLS or cleartext trusted-proxy backend” error.
- **Action:** In the TLS assembly branch reject `northbound.edge.proxyMode` (and therefore any proxy trust/hop configuration), or define and validate a distinct TLS-to-proxy mode in the spec and assembly. Do not silently treat proxy mode as direct mode for untrusted peers.
- **Regression:** Construct `edge({proxyMode:true,trustedProxies:['127.0.0.1']})` and assert direct TLS server assembly throws. Also make a production-mode table test: direct+TLS succeeds; direct+cleartext fails; proxy+cleartext succeeds; proxy+TLS fails; missing edge/readiness/authenticator fails.

### F2 — High — production readiness can omit session-ledger/revocation health

- **EP/source:** EP5, `impl/src/web-edge.mjs:52-64`; `impl/src/web-northbound.mjs:112-117,525-540`.
- **Failure:** `WebReadinessAuthority` explicitly permits `sessions = null` and then skips session health. Server assembly accepts any instance of that class. A northbound with a custom live authenticator can therefore be assembled for production with `new WebReadinessAuthority({coordination, authenticate})`, and `/readyz` can report ready without grounding session ledger/liveness verification, contrary to EP5. The automatic constructor path happens to require sessions, but the public injected-authority path bypasses that grounding.
- **Action:** Make session/revocation health a mandatory readiness dependency for this authenticated production server, or replace the optional concrete `sessions` parameter with a mandatory named session-liveness health check. Validate that dependency in server assembly rather than relying only on `instanceof`.
- **Regression:** Assemble a production server with a healthy custom authenticator and a `WebReadinessAuthority` lacking sessions; assert configuration refusal. Assert a session health false/throw yields only `{ready:false}`.

### F3 — Medium — shutdown control writes bypass the configured control-frame and backpressure bounds

- **EP/source:** EP6, `impl/src/web-stream.mjs:177-186,285`; compare bounded lag handling at `190-207,261-266`.
- **Failure:** `closeForShutdown()` directly calls `res.write()` with the shutdown frame and ignores both `maxControlFrameBytes`, `writableLength`, and a `false` write result. It then calls `end()`, so it remains terminating and the literal is currently small, but shutdown is not implemented through the declared bounded/backpressure control path. A socket already over its bounded buffer is given another write during global shutdown. EP6 specifically requires bounded shutdown behavior including broken sockets and backpressure.
- **Action:** Pre-encode the shutdown frame, enforce `maxControlFrameBytes` and available-buffer policy, and treat `false`/throw as immediate close without additional writes. Keep lease release and disconnect audit exactly once.
- **Regression:** Open a stream whose response has `writableLength > maxBufferedBytes` and whose `write()` returns false (and separately throws), call shutdown twice, and assert bounded write count/bytes, one end, one lease release, one terminal stream audit, and no fleet call.

## EP-by-EP verdict

### EP1 — canonical client address

Clean apart from F1's mode confusion. Direct resolution uses the socket peer and ignores all forwarding headers. Trusted resolution requires an exact configured peer, rejects mixed `Forwarded`/`X-Forwarded-*`, bounds bytes/elements, rejects duplicate/unknown `Forwarded` parameters, selects one configured hop, and handles IPv4 and bracketed IPv6. IPv4-mapped IPv6 is deliberately exact rather than aliased. Malformed trusted forwarding fails before quota/auth/provider/body work and audits only classification plus a keyed peer digest. No raw address was found in the edge audit path.

The tests cover untrusted spoofing, exact trusted hop selection, mixed headers, IPv4, IPv6, mapped-address non-aliasing, and invalid bracket/port syntax. No additional EP1 defect found.

### EP2 — quotas, expiry, atomicity, and cardinality

Clean. Fixed-window configuration and clock samples reject non-positive/non-integer/unsafe values; regression fails before expiry/key/counter mutation. Expiry is deterministic, each quota map is cardinality-bounded, and refusal metadata is positive and window-bounded. Principal count and weighted cost share one sampled clock, preflight both buckets, and synchronously commit both, so a weighted refusal does not consume command count. Connection keys disappear on final release and are cardinality-bounded.

The authority is intentionally process-local abuse state and does not become command/session truth. No additional EP2 defect found.

### EP3 — refusal ordering and mutation

Clean. Canonical-address quota precedes route body parsing, authentication, provider calls, session mutation, ticket state, durable command admission, and dispatch. Login quota applies only to admitted-shape `POST /v1/auth/login`; preflight and invalid methods use only address quota. Authentication/authorization precede credential-keyed principal/cost quota, and both quota buckets precede durable command admission and coordinator dispatch. Credential IDs, not client command/idempotency IDs, select authenticated buckets. Ticket quota precedes ticket generation/live state.

Tests establish provider-call bounding, no session/fleet mutation, preflight/method behavior, count/cost separation, and refusal audit failure closing. No additional EP3 defect found.

### EP4 — transport and server mode

F1 is an EP4 defect. Otherwise trusted cleartext requires an exact trusted immediate peer plus exact `https` forwarding signal; untrusted forwarding cannot upgrade cleartext or alter identity. Direct mode policy configuration rejects proxy trust/hops and direct server assembly requires key/certificate material. Proxy cleartext assembly requires a nonempty trusted allowlist. IPv4/IPv6 selection itself is clean.

### EP5 — health/readiness

F2 is an EP5 defect. Endpoint payloads are non-disclosing (`{ok:true}` and one `{ready:boolean}`), probes have independent quotas, and readiness also grounds coordination/authentication plus configured checks and admission state. Readiness audit failure returns only not-ready and a failed transition append is retried rather than suppressing the transition. No dependency error detail, fleet inventory, path, provider, credential, repository, worker, or task data is returned.

### EP6 — shutdown

F3 is an EP6 defect. Admission closes synchronously before the first await and covers login, refresh, logout, commands, tickets, and future stream opens; readiness consequently turns false. Provider completion loses to shutdown before session issue. Listener close is deadline-bounded, then idle/all connections are forced and bounded again. Repeated shutdown returns the same promise/result. Stream lease release is exactly-once, and neither northbound nor stream shutdown invokes coordinator/worker operations or asserts worker death.

The shutdown frame is semantically reconnecting and socket exceptions are swallowed, but its backpressure bound is the defect described in F3. No other EP6 defect found.

### EP7 — audit and restart posture

Clean. Proxy/quota/readiness/shutdown outcomes are appended through the coordination audit authority; address and credential quota identities are HMAC digests, not raw values. Refusal/audit failure never returns admission success. Session, command, and idempotency state remain durable authorities separate from resettable quotas. Readiness transition state advances only after the transition append succeeds. Shutdown audit failure yields one bounded degraded result while resources still close. No additional EP7 defect or sensitive value leakage found in the reviewed EP paths.

### EP8 — deterministic acceptance

The focused tests substantially cover the enumerated trust seams: proxy/address/HTTPS ambiguity, provider throttling, quota separation/clock/cardinality, refusal mutation, readiness disclosure/audit retry, connection fairness/release, shutdown drain/idempotency/audit/no-fleet-effects, and server refusal. Missing regressions corresponding to F1–F3 prevent a clean EP8 verdict. Recursive Baton construction/integration/kill/reap language is an external acceptance-process requirement, not a runtime source defect, and was not exercised because this review explicitly forbids fleet actions.

### EP9 — deferred scope, not EP defects

OIDC redirect/callback mechanics, optional WebSocket parity, real browser automation/UI behavior, and MCP/operator UI remain explicitly deferred. None is reported above as an EP implementation defect. Their future implementations must consume, not bypass, the corrected EP4/EP5/EP6 authorities.

## Overall verdict

Three actionable findings: two High (server-mode ambiguity and incomplete readiness grounding) and one Medium (shutdown control-frame backpressure bound). All other reviewed EP trust seams have an explicit clean verdict above.
