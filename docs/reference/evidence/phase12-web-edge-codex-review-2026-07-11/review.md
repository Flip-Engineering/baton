# Independent adversarial review — Phase 12 web edge policy (EP1–EP9)

Date: 2026-07-11  
Scope reviewed: `spec/phase12/web-edge-policy.md`, `spec/phase12/authenticated-web-northbound.md`, `spec/phase12/authenticated-web-session-lifecycle.md`, `impl/src/web-edge.mjs`, `impl/src/web-northbound.mjs`, `impl/src/web-stream.mjs`, `impl/src/web-auth.mjs`, and the five Phase 12 web test files named by the acceptance command. Prior evidence logs were not read. No source, fleet, homelab, or network action was performed.

## Executive verdict

EP1–EP9 are not clean. I found two high-severity and three medium-severity defects. The strongest implemented seams are canonical IPv4/IPv6 address identity, bounded forwarding grammar, ordinary quota expiry/cardinality, authorization-before-ticket-quota ordering, readiness response non-disclosure, and stream terminal cleanup. The release claim in EP8 should remain unsatisfied until the regressions below are added and pass.

## Findings

### F1 — High — EP4 transport trust is not enforced for health/readiness

- Source: `spec/phase12/web-edge-policy.md:53-59`; `impl/src/web-edge.mjs:170-173`; `impl/src/web-northbound.mjs:292-310`.
- Failure: in proxy mode, `resolveEdgeRequest` returns `{ transport: "http", proxied: false }` for an untrusted cleartext peer instead of refusing it. `handle` then applies the address/probe quota and returns `/healthz` or `/readyz` before any HTTPS check. Thus an untrusted cleartext backend peer can receive a successful liveness response and, when dependencies are healthy, a successful readiness response. Forwarded headers do not upgrade its identity, but the socket is nevertheless accepted contrary to “only when the immediate peer is trusted and ... proves ... HTTPS.” Direct-policy `handle` has the same plaintext probe behavior outside the TLS server assembly.
- Impact: backend trust and transport policy become route-dependent. If the cleartext listener is reachable beyond the intended proxy boundary, unauthenticated parties can probe process/readiness state; more importantly, the implementation does not establish EP4's single listener-wide admission invariant.
- Regression: construct a proxy-mode `WebNorthbound`; send cleartext `GET /healthz` and `GET /readyz` from an untrusted IPv4 peer, an untrusted IPv6 peer, a trusted peer with no forwarding signal, and a trusted peer with `proto=http`. Require a typed audited transport/proxy refusal for each. Require success only for a trusted peer with the configured exact HTTPS signal. Also exercise plaintext direct-policy `handle` and assert refusal, even though production assembly normally supplies TLS.

### F2 — High — EP3 address-first refusal is bypassed for malformed request targets

- Source: `spec/phase12/web-edge-policy.md:37-49`; `impl/src/web-northbound.mjs:278-308`; existing test `impl/test/phase12-web-edge.test.mjs` (“EP3/EP7: malformed request targets ...”).
- Failure: request-target parsing and its durable audit occur before edge address resolution and before the address quota. An attacker can send unlimited malformed/overlong targets without consuming the bounded per-address request quota. Each request instead performs a durable audit append, creating an unthrottled storage/IO amplification path. This contradicts “all HTTP requests per address,” “address quota runs before ... expensive work,” and the statement that policy-invalid requests use the ordinary address quota.
- Impact: a remote client can evade the abuse counter and turn cheap malformed requests into unbounded append-only audit growth. Audit failure changes the response but does not bound attempts.
- Regression: set address limit to one, submit two malformed targets from the same canonical address, and require the second response to be `429 rate_limited` with bounded `Retry-After` and no second request-refusal append. Repeat with equivalent expanded/compressed IPv6 and IPv4-mapped IPv6 spellings to prove one canonical bucket. Verify address resolution failure remains safely audited without raw peer/header data.

### F3 — Medium — combined principal/cost quota is not failure-atomic across quota clocks

- Source: `spec/phase12/web-edge-policy.md:29-33`; `impl/src/web-edge.mjs:28-32,68-75,178-187`.
- Failure: `takeCommand` calls `principal.canTake` and then `cost.canTake` using one sampled value. Each `canTake` immediately mutates that quota's `lastNow`. If the two quota instances have diverged (their public `take` API permits independent use) and the sampled value is monotonic for principal but regresses for cost, the call throws after advancing principal's clock state. EP2 requires an invalid/regressing sample to fail before any quota mutation. The later two-commit sequence also relies on an invariant throw rather than an explicit atomic transaction.
- Impact: a failed combined check can poison one quota's accepted clock frontier and cause later valid samples to be rejected. This is operational denial of service and violates deterministic failure atomicity, even though counters are not incremented in the demonstrated path.
- Regression: advance only `policy.quotas.cost` to time 2000, set the injected clock to 1500, snapshot both maps and `lastNow` fields, call `takeCommand`, and assert it throws with every snapshot unchanged. Then set time to 2000 and prove a valid command succeeds. Prefer a transaction implementation that validates both clocks/windows/capacity before mutating either authority.

### F4 — Medium — cleartext proxy production assembly accepts a non-policy duck type

- Source: `spec/phase12/web-edge-policy.md:56-59`; `impl/src/web-northbound.mjs:113`; `impl/src/web-northbound.mjs:553-576`.
- Failure: direct TLS assembly requires `northbound.edge instanceof WebEdgePolicy`, but proxy assembly checks only truthy `proxyMode` and a nonempty `trustedProxies`. A caller can inject `{ proxyMode: true, trustedProxies: ["..."] }`; production assembly creates a cleartext server, then the first request fails because `peerDigest`, `resolve`, and quota methods are absent. More dangerous partial duck types can implement inconsistent trust or quota behavior while passing assembly.
- Impact: EP4's production configuration gate does not guarantee that the cleartext listener is guarded by the reviewed edge authority. This is a fail-late availability defect and a policy-substitution seam.
- Regression: pass a plain object and partial/malicious edge lookalikes to proxy assembly and require construction-time refusal. Assert both production modes require an actual `WebEdgePolicy` bound to the northbound instance.

### F5 — Medium — stream-ticket quota commits before HTTP delivery and cannot roll back response failure

- Source: `spec/phase12/web-edge-policy.md:32-33`; `impl/src/web-northbound.mjs:349-360,513-518`; `impl/src/web-stream.mjs:73-98`.
- Failure: successful `stream.issue` audits and installs live ticket state; the edge reservation is then committed before `_write` writes response headers/body. If `writeHead` or `end` throws (broken/reset client), `handle` rejects, the ticket remains live, and credential ticket quota remains consumed. This is an “other issuance failure” for the client-facing operation but is not rolled back. The existing rollback test covers capacity and issuance-audit failure only.
- Impact: repeated response-path failures can exhaust a credential's ticket quota and `maxTickets` without the client ever receiving usable ticket material. Simply rolling back the quota is insufficient unless the newly installed ticket is also revoked atomically.
- Regression: use a response that throws from `writeHead` and another that throws from `end`; assert no live ticket and no consumed reservation remain. Add an issuance transaction/API that can remove the exact ticket on delivery failure, without removing another request's state.

## EP-by-EP seam verdict

### EP1 — canonical address/trusted proxy: clean except where inherited by F1/F2

Canonicalization uses `node:net.isIP`, normalizes equivalent IPv6 spellings, and maps `::ffff:a.b.c.d` to IPv4 before exact proxy membership, digesting, and quota selection (`web-edge.mjs:8-19,129-150`). The bounded 16-element/512-character forwarding parsers reject mixed `Forwarded`/XFF, mixed `Forwarded`/XFP, duplicate/unknown `Forwarded` parameters, zones, ports, controls, and missing/out-of-range hops. Untrusted headers do not affect address or transport identity. Audit on forwarding failure retains only a keyed peer digest/classification (`web-northbound.mjs:293-305`). No additional EP1 defect found. Tests cover IPv4, compressed/expanded IPv6, mapped IPv6, quoting, ports, escapes, mixed families, and raw-header/address non-leakage; F2's canonical malformed-target quota regression is still needed.

### EP2 — quota authority: findings F3 and F5; otherwise clean

Configuration rejects non-positive/non-safe integer limits/windows/cardinality and unknown limit names. Fixed-window expiry and key cardinality are bounded per policy; capacity refusal does not insert a key. Retry values are positive integers bounded by the window. Reservation rollback is idempotent and removes a zero-use entry. Concurrent leases are bounded per credential and cardinality, with release deleting zero-count keys. The ordinary single-quota invalid/regressing-clock path validates before map expiry/counter mutation. Combined atomicity and complete ticket issuance rollback are not clean (F3, F5).

### EP3 — ordering/refusal: finding F2; otherwise clean

For syntactically valid targets, address quota precedes body parsing/auth/provider/session/coordinator work. Login quota follows TLS, Origin, content type, bounded valid object JSON and precedes provider invocation. Principal/count and weighted cost follow authentication, schema validation, and authorization, but precede durable command admission/dispatch. Ticket Origin/repository/capability/live-session authorization precedes ticket quota. Buckets use server-derived address digests or authenticated credential IDs, not client command IDs. Refusals are typed and fail closed on audit failure. Malformed-target traffic bypasses the promised ordinary address quota (F2).

### EP4 — server/transport modes: findings F1 and F4

Direct production assembly requires key+certificate, rejects proxy policy, and pins TLS >=1.2. Proxy assembly rejects TLS material, requires a configured proxy posture, and the edge constructor refuses empty proxy trust or proxy fields in direct mode. However, transport enforcement is not listener-wide (F1), and proxy production assembly does not require a genuine policy instance (F4).

### EP5 — readiness/non-disclosure: clean except transport exposure in F1

Responses expose only `{ok:true}` for liveness and `{ready:boolean}` for readiness. Readiness is grounded in the same coordination, session, and authenticator authorities at production assembly; checks cover coordination health (including the durable command/audit store), session health, authenticator health/live-principal capability, extra configured checks, and admission. Probe audit failure yields only `{ready:false}`. Transition state advances only after both probe and transition appends succeed, so a failed transition append is retried. Health/readiness have independent quota maps. No fleet/repository/provider/path/dependency details are returned. F1 still permits these bits over a disallowed transport/peer.

### EP6 — shutdown/admission/drain/backpressure: clean

Admission flags close synchronously before the shutdown promise is created, and lifecycle/provider completion rechecks admission before mutation. Stream admission closes synchronously; existing streams attempt one dual-ceiling shutdown frame, then exactly-once disconnect, lease release, and socket end. Lag handling uses the same frame/buffer ceilings and terminal guard. Listener drain is deadline-bounded, force-closes connections, and records completion only after the close callback; synchronous stream cleanup and audit failures degrade without skipping listener closure. The shutdown promise is memoized. Coordinator methods are not invoked by shutdown. Accepted commands already dispatching are drained rather than reclassified, and no worker truth is fabricated. No additional EP6 defect found.

### EP7 — audit/restart/leakage: clean except amplification in F2

Required refusal/transition/shutdown events are append-only through coordination audit. Address values are HMAC digests; credential identifiers are separately prefixed and HMAC-digested; raw forwarding headers are never included. Failure returns no new admission success, while shutdown correctly reports a bounded degraded outcome after still closing resources. Operational counters are in-memory only; session and command/idempotency truth remain in their durable authorities. F2 makes malformed-target audit append volume unquota-bounded, but no additional raw-address/credential leakage was found.

### EP8 — acceptance claim: not satisfied

The focused tests are broad and the mandated Phase 12 command passes only when all listed files pass, but current coverage encodes neither F1, F3, F4, nor F5 and asserts the F2 ordering without checking ordinary quota consumption. EP8 cannot claim complete adversarial acceptance until all five regressions are present and passing. Recursive build/integration/kill/reap claims were outside the permitted verification command and no such actions were taken.

### EP9 — deferred scope: correctly separated

OIDC redirect/callback behavior, optional WebSocket parity, browser automation/UI behavior, and MCP/operator UI remain deferred WN9 work. None of F1–F5 depends on those deferred features: they are defects in the shipped HTTP edge/quota/server/ticket transaction seams. No EP9 scope-collapse defect found.

## Required disposition

Fix F1–F5 and add the exact regressions above. Keep OIDC, WebSocket, browser automation/UI, and MCP/operator UI work tracked separately; those deferred items neither block identifying these defects nor repair them.
