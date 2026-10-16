# Phase 12 web-edge adversarial review — 2026-07-11

## Verdict

EP1–EP9 were reviewed against `spec/phase12/web-edge-policy.md`, the current web edge, northbound, authentication/session, and stream implementations, and the five Phase 12 test files named by the acceptance command. Prior evidence logs were not read. The review found **one high-severity and two medium-severity EP defects**. No critical or low-severity defects were found.

## Findings

### WEB-EDGE-01 — High — malformed proxy traffic can amplify into unbounded durable audit writes

- **EP/source:** EP1, EP3, EP7; `impl/src/web-northbound.mjs:278-297`; `impl/src/web-edge.mjs:130-164`.
- **Failure:** Edge resolution occurs before any quota. Every invalid peer address or malformed/ambiguous forwarding set immediately appends `proxy_refused`, then returns. No address, health, readiness, or peer-specific quota is consulted on this path. On the cleartext trusted-proxy listener, an external client whose forwarding fields are preserved by the trusted proxy can repeatedly submit duplicate, mixed, invalid, or non-HTTPS forwarding fields and force one durable coordination append per request. Invalid direct socket addresses in an injected/custom request path have the same ordering. This defeats the stated bounded-request/audit-amplification posture and can consume log/disk/coordination capacity while all configured quota counters remain untouched.
- **Why existing tests miss it:** `phase12-web-edge.test.mjs` verifies that malformed forwarding is typed, audited, non-leaking, and pre-work, including on a real listener, but never repeats it past a quota limit or asserts bounded audit cardinality.
- **Required correction:** Introduce a bounded quota keyed by the canonical immediate peer digest before durable proxy-refusal audit (with a bounded fallback class for an unparseable peer), or otherwise provide an equivalent bounded refusal sink. Preserve fail-closed behavior and never trust a forwarded client address before parsing succeeds.
- **Regression:** Configure limit 1, send two malformed forwarding requests through a trusted real proxy listener, and assert the second is bounded without a second durable `proxy_refused` append, with no provider/session/coordinator/stream mutation. Add the analogous invalid-peer harness case and clock/capacity/audit-failure cases.

### WEB-EDGE-02 — Medium — attacker-controlled `Origin` is persisted verbatim in refusal and quota audits

- **EP/source:** EP3, EP7; `impl/src/web-northbound.mjs:128-135`, `278-320`, `419-466`. The invalid-target branch at `309` already demonstrates the safer allowlist-or-null pattern, but proxy, quota, transport, lifecycle-policy, content-type, and body refusals pass the raw header.
- **Failure:** `_audit` stores `ctx.origin` unchanged. Before exact-origin authorization, multiple request paths populate it directly from `req.headers.origin`. A caller can therefore place arbitrary header text—including credential-like material or sensitive URLs—into the append-only audit stream. This violates the no-credential/error-data leakage posture and the intended origin-class audit model. Node bounds aggregate headers, so this is not an unbounded single-record allocation, but it is durable attacker-controlled disclosure and log pollution.
- **Why existing tests miss it:** Tests check raw address, forwarding-header, credential-ID, request-property-name, and login-body secrecy. They do not inject a distinctive secret into a rejected `Origin` and scan durable audit records.
- **Required correction:** Audit only a fixed origin classification (`allowed`, `missing`, `disallowed`, optionally a keyed digest if operationally required). Never retain the pre-authorization raw Origin. Apply this centrally so stream and lifecycle refusal paths cannot regress independently.
- **Regression:** Exercise malformed forwarding, quota refusal, cleartext transport refusal, wrong-origin lifecycle refusal, invalid content type, and invalid body with an Origin containing a unique secret marker; assert the marker is absent from all durable events and only fixed classifications are present.

### WEB-EDGE-03 — Medium — forwarding field-line ambiguity checks are optional when `rawHeaders` is absent

- **EP/source:** EP1, EP4; `impl/src/web-edge.mjs:136-146`.
- **Failure:** The wire-level uniqueness invariant is enforced only inside `if (req.rawHeaders != null)`. A trusted-peer request object without `rawHeaders` is accepted from normalized `headers` alone. That makes `WebEdgePolicy.resolve()` and exported `resolveEdgeRequest()` accept a representation that cannot prove EP1's “exactly one occurrence” requirement. Production Node requests currently supply `rawHeaders`, so the primary listener is protected, but any adapter, test harness, future HTTP integration, or direct API caller can silently weaken the trust boundary while still using the official policy object.
- **Why existing tests miss it:** The real-listener duplicate-field tests prove Node's path; synthetic accepted trusted-proxy requests commonly omit `rawHeaders`, codifying the weaker behavior instead of requiring provenance.
- **Required correction:** In proxy mode require a valid `rawHeaders` array and exact normalized/raw correspondence, or accept an explicit server-owned prevalidated header representation that cannot be caller-forged. Do not treat absence as proof of uniqueness.
- **Regression:** A trusted-peer request with forwarding headers but absent, odd-length, non-array, missing-correspondence, or duplicate `rawHeaders` must fail before address quota/auth/provider/session/fleet work; one exact field-line and one deliberate multi-hop field value must continue to pass.

## EP seam review

### EP1 — canonical client address and trust boundary

Defects: WEB-EDGE-01, WEB-EDGE-03. Otherwise clean. Direct mode selects only `socket.remoteAddress` and socket encryption; untrusted forwarding never changes identity or transport. Trusted peers are exact canonical allowlist matches. IPv4 spellings, compressed/expanded IPv6, and IPv4-mapped IPv6 converge before trust, quota, and HMAC use. Zones, ports, malformed brackets, mixed standard/legacy headers, excessive chains/hops, unknown or duplicate `Forwarded` parameters, escaped quoted values, duplicate raw field-lines, and non-HTTP(S) protocols are refused. Selected-hop semantics and case-insensitive HTTP/HTTPS normalization are deterministic. No subnet or implicit-loopback trust was found.

### EP2 — quota ordering, atomicity, expiry, and cardinality

No additional defect found. All numeric configuration is positive safe-integer validated; unknown policies are rejected. Clock samples are non-negative safe integers and monotonic per authority. Expiry is deterministic at aligned fixed-window boundaries and stale keys are pruned on mutating takes. Cardinality is bounded independently for fixed-window and concurrent maps. `Retry-After` is finite, positive, and window-bounded. Principal count and weighted cost use one clock sample, preflight both authorities without mutation, then commit both. Ticket quota reservations roll back with exact ticket deletion on synchronous issuance/delivery failure. Connection leases are keyed by authenticated credential identity and terminal stream cleanup is guarded exactly once.

Residual operational note, not an EP defect: successful `writeHead`/`end` calls cannot prove receipt by a remote peer; the implemented transaction boundary can only compensate synchronous delivery API failures. That is the strongest locally observable HTTP boundary and does not expose a reusable ticket after a detected failure.

### EP3 — refusal before privileged/expensive work

Defect: WEB-EDGE-01. Otherwise clean. Canonical address resolution and ordinary address quota precede target parsing, body reads, authentication/provider calls, durable command admission, dispatch, and stream mutation. Login quota is consumed only after HTTPS, exact Origin, content type, bounded valid JSON, and object validation, and before the provider. Principal/cost quotas follow authentication, schema validation, and authorization but precede idempotency admission and dispatch. Ticket authorization precedes credential ticket quota. Quota keys come from canonical address digests or authenticated credential IDs, not body IDs. Request targets are bounded origin-form with control/fragment/encoding rejection. Schema audit reasons are fixed codes and do not echo client property names.

### EP4 — explicit trusted-proxy and TLS server modes

Defect: WEB-EDGE-03. Otherwise clean. Production assembly accepts only a real direct-mode `WebEdgePolicy` with key/certificate on an HTTPS listener, or a real proxy-mode policy with a nonempty exact trusted-peer list on a cleartext backend. Hybrid TLS plus cleartext-proxy configuration and policy lookalikes are rejected. Direct policy cannot carry proxy trust/hops. All routes, including health/readiness, pass transport enforcement; untrusted cleartext forwarding cannot upgrade transport.

### EP5 — grounded, non-disclosing readiness

No defect found. Health returns only `{ok:true}`. Readiness returns only `{ready:true|false}` and is false after admission closes or on failed/throwing coordination, session, authentication, revocation-liveness, or injected checks. Production assembly identity-binds readiness to the listener's coordination, session, and authenticator objects; a custom authenticator without live health cannot be production-ready. Probe quotas are independent. Transition state advances only after both probe and transition audit appends succeed, so failed transition audit is retried. Coordination health is the same authority that owns command idempotency, satisfying the storage-grounding requirement without a substitute health object.

### EP6 — shutdown admission, drain, backpressure, idempotency, and fleet isolation

No defect found. Admission closes synchronously before asynchronous shutdown work and is rechecked after provider/body waits. Stream ticket issuance/opening stops, readiness becomes false, listener close drains until a positive bounded deadline, then idle/all HTTP connections are forced closed. Streams attempt one bounded shutdown control write under both control-frame and buffered-byte ceilings, then exactly-once disconnect, timer removal, lease release, and socket end. Lag/backpressure uses the same dual ceiling and terminal guard. Synchronous stream cleanup and audit failures degrade the memoized result without skipping listener close or terminal audit attempts. Repeated shutdown returns the same promise. No shutdown/disconnect path invokes coordinator worker control or changes fleet truth.

### EP7 — durable audit, failure posture, and restart semantics

Defects: WEB-EDGE-01 and WEB-EDGE-02. Otherwise clean. Quota/proxy refusals, readiness probes/transitions, shutdown start, and terminal shutdown outcomes use append-only coordination audit. Admission success is withheld on required audit failure. Address identity is normally only presence/classification plus keyed digest, and authenticated quota/stream records digest credential IDs. Quota maps are in-memory abuse state and do not replace durable command/session/idempotency state. Failed readiness transition audit does not suppress a later retry.

### EP8 — deterministic acceptance coverage

No separate implementation defect; coverage gaps correspond exactly to the three findings above. Existing tests substantively cover direct/untrusted/trusted address selection, IPv4/IPv6 equivalence, malformed and duplicate forwarding, HTTPS signaling, provider throttling, address/principal/cost/ticket/connection separation, clocks, expiry/cardinality, retry metadata, refusal non-mutation, readiness binding/non-disclosure, explicit server modes, shutdown races/drain/degradation/idempotency/no-fleet-effects, and dual-ceiling stream cleanup. The acceptance command below is the fresh verification for this review; recursive Baton build mechanics are process/evidence requirements, not a web-edge runtime seam.

### EP9 — deferred scope, not EP defects

OIDC redirect/callback mechanics, optional WebSocket parity/hijack defenses, real browser automation, MCP/operator UI, and broader WN9 browser sequences remain explicitly deferred. None of WEB-EDGE-01 through WEB-EDGE-03 depends on those features, and none is reclassified as deferred scope. Conversely, absence of those deferred features is not reported as an EP defect.

## Verification

The required command was run exactly as specified after writing this review; its result is recorded below.

```text
test -s docs/reference/evidence/phase12-web-edge-codex-review-2026-07-11/review.md && test -s impl/test/phase12-web-edge.test.mjs && node --test impl/test/phase12-web-edge.test.mjs impl/test/phase12-web-session-lifecycle.test.mjs impl/test/phase12-web-auth.test.mjs impl/test/phase12-web-northbound.test.mjs impl/test/phase12-web-stream.test.mjs
```

Observed exit code: **1**. Result: **79 passed, 1 failed**. The only failure was the real-listener test `EP1/EP4: real proxy listener rejects duplicate forwarding field-lines before work`, before its assertions, because this managed execution environment denied the required loopback bind: `listen EPERM: operation not permitted 127.0.0.1`. All non-listener tests passed. No alternate command, network action, or privileged rerun was used. The specified expected exit code 0 therefore remains unconfirmed in this sandbox; rerun the exact command in an environment that permits loopback listening.
