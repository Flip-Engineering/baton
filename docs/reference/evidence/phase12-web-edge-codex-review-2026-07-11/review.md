# Phase 12 web-edge adversarial review — 2026-07-11

## Scope and method

Reviewed the current EP1–EP9 specification (`spec/phase12/web-edge-policy.md`), the Phase 12 authenticated northbound and lifecycle specifications, and the current web edge, auth, northbound, stream, session, coordination, and Phase 12 test sources. Per the brief, no prior evidence log was read. No source, network, homelab, or fleet mutation was performed. The only repository write is this report.

## Findings

### F1 — High — direct TLS mode still trusts forwarding headers for address selection

- **EP:** EP1, EP4.
- **Source:** `impl/src/web-edge.mjs:62-83,86-104`; `impl/src/web-northbound.mjs:263-285`; `impl/test/phase12-web-edge.test.mjs` test “EP1/EP4: untrusted forwarding…”.
- **Failure:** `WebEdgePolicy.resolve()` always calls `resolveEdgeRequest()` with the configured `trustedProxies`, even when `proxyMode` is false. It overwrites only the returned transport in direct mode; it preserves the forwarding-selected address. Consequently a direct-TLS deployment that happens to configure `trustedProxies` accepts `Forwarded`/`X-Forwarded-For` from those peers for address and login quota identity. This contradicts “Direct requests use the socket peer address” and allows a trusted peer to choose/bypass address buckets in direct mode. The existing test asserts only that transport remains `http`; it does not assert the address.
- **Required correction:** Make proxy/header address resolution conditional on explicit proxy mode (or reject `trustedProxies` when proxy mode is false). Direct mode must return the socket peer for both address and transport regardless of forwarding headers.
- **Regression:** In direct mode with a peer present in `trustedProxies`, assert IPv4 and IPv6 forwarding headers cannot alter the canonical address/digest/quota bucket; malformed forwarding headers must also be ignored rather than turn a direct request into `invalid_forwarding`.

### F2 — Medium — the standard `Forwarded` path rejects all IPv6 client addresses

- **EP:** EP1, EP4, EP8.
- **Source:** `impl/src/web-edge.mjs:45-59`, especially the unconditional `fields.for.includes(':')` rejection; Phase 12 edge tests contain IPv4 only.
- **Failure:** RFC-style IPv6 `for` values require a colon and normally quotes/brackets (for example `for="[2001:db8::1]"`). The parser rejects quotes and every colon, so trusted proxies cannot represent an IPv6 client through `Forwarded`. `X-Forwarded-For` accepts bare IPv6, producing mode/header-family-dependent behavior. Socket peers using IPv4-mapped IPv6 (for example `::ffff:127.0.0.1`) also do not exactly match an IPv4 allowlist entry, with no documented normalization posture.
- **Required correction:** Define and implement one canonical IPv4/IPv6 grammar and normalization policy for socket peers, allowlist entries, `Forwarded`, and XFF. If mapped-address equivalence is intentionally rejected, state and test that exact policy.
- **Regression:** Cover direct IPv6, trusted XFF IPv6, valid quoted/bracketed `Forwarded` IPv6, malformed bracket/port/zone forms, mapped IPv4 exact-match behavior, and mixed IPv4/IPv6 chains at every selectable hop.

### F3 — High — readiness is not grounded in all EP5 authorities and readiness transitions are not audited

- **EP:** EP5, EP7.
- **Source:** `impl/src/web-northbound.mjs:140-150,286-288,473-482`; `impl/test/phase12-web-edge.test.mjs` readiness/shutdown test.
- **Failure:** `_isReady()` treats a truthy coordination snapshot, a nonthrowing session `events()` call, the existence of an authenticator, and caller-supplied checks as sufficient. It does not prove that command idempotency writes/reads are available, that session liveness verification is usable, or that durable audit append is available. It also emits no audit record on ready→not-ready or not-ready→ready transitions. Thus `/readyz` can return ready while an EP5-required authority is unusable, and EP7’s readiness-transition audit claim is absent. The current test supplies a Boolean callback and checks only response non-disclosure.
- **Required correction:** Introduce explicit, side-effect-safe health contracts for coordination/log plus idempotency authority and session-ledger/liveness authority, include admission state, and record each state transition append-only without dependency detail. Decide fail-closed behavior when transition audit itself fails and specify it consistently.
- **Regression:** Independently fail each named readiness dependency (including audit/idempotency and live-session verification), assert `{ready:false}` only, assert exactly-once transition audit without raw dependency errors, and assert recovery transition behavior.

### F4 — High — shutdown can admit a stream after the one-time stream shutdown sweep

- **EP:** EP6.
- **Source:** `impl/src/web-northbound.mjs:263-342,473-482`; `impl/src/web-stream.mjs:114-205,262`.
- **Failure:** `handle()` checks admission before awaiting authentication for `/v1/events`. `shutdown()` then flips admission and immediately calls `stream.shutdown()`, which closes only connections already in the set. A request that passed the admission check but is paused in authentication can resume afterward and call `stream.open()`, creating a connection after the shutdown sweep. The same check/await race applies to other admissions; commands can proceed through body/auth work after shutdown, although streams are the durable drain failure because they can remain open and delay listener close beyond the claimed bounded drain.
- **Required correction:** Put admission gating inside each admission authority at the final mutation/open point, recheck after every await before session mutation, command admission, ticket issue, or stream open, and make stream shutdown permanently reject future opens before sweeping existing connections.
- **Regression:** Pause authentication/body/provider/dispatch at each boundary, start shutdown, then resume. Assert no login/refresh mutation, durable command admission, ticket state, or stream connection is created after admission closes; assert the listener/drain promise remains bounded.

### F5 — Medium — graceful shutdown does not actually enforce the drain bound on sockets and can report completion while the listener remains open

- **EP:** EP6, EP7.
- **Source:** `impl/src/web-northbound.mjs:473-482`; the edge shutdown test uses a server whose `close()` callback fires immediately.
- **Failure:** the timeout merely wins `Promise.race`; it does not close idle/active connections or otherwise force the HTTP server’s close callback. `shutdown_completed` is then attempted even though the listener may still be waiting on sockets. Broken or slow non-SSE requests are not tracked. This makes completion semantically false and leaves process resources beyond the bounded interval.
- **Required correction:** Track accepted requests/sockets, stop listener admission first, drain accepted responses, and at the deadline close the remaining HTTP connections with the supported server/socket mechanism. Audit completion only after the listener and tracked connections are actually closed, or audit a distinct bounded-timeout outcome.
- **Regression:** Use a real server with idle keep-alive, stalled request body, slow response, and broken socket; verify no new acceptance, deadline cleanup, actual listener closure, idempotent repeated shutdown, and bounded completion audit ordering.

### F6 — Medium — connection quota is global, consumes tickets before refusal, and is not part of the deterministic edge quota authority

- **EP:** EP2, EP3, EP8.
- **Source:** `impl/src/web-edge.mjs:92-111` has no connection quota; `impl/src/web-stream.mjs:98-125` consumes the one-time ticket before checking global `activeConnections`; stream tests explicitly accept ticket consumption on refusal in analogous setup cases.
- **Failure:** EP2 names concurrent connections as a separate policy alongside per-address/per-credential quotas, but the implementation supplies only one process-global ceiling. One credential can occupy all slots and deny every other principal. A capacity refusal also destroys the caller’s valid one-time ticket before returning 429, forcing another ticket issuance/quota charge. There is no `Retry-After` for this 429 and no fixed-window/key-cardinality semantics because this ceiling bypasses `WebEdgePolicy`.
- **Required correction:** Specify the intended connection key (credential and/or address plus a global safety cap), enforce it atomically at open/close, and decide whether a capacity refusal consumes a ticket. Provide bounded retry semantics consistent with EP3.
- **Regression:** Cover cross-principal isolation, per-key and global ceilings, simultaneous opens/closes, exactly-once decrement, ticket disposition on refusal, and `Retry-After`.

### F7 — Medium — quota configuration accepts unknown policy names and omits cross-policy consistency validation

- **EP:** EP2, EP4.
- **Source:** `impl/src/web-edge.mjs:86-98`; edge tests validate only a small set of constructor failures indirectly.
- **Failure:** arbitrary entries in `opts.limits` create arbitrary quota maps instead of being rejected, while required policies can be semantically weakened independently without any “internally inconsistent” checks. `trustedProxies` are likewise permitted in direct mode, enabling F1’s inconsistent server posture. This falls short of EP2’s explicit invalid/internally-inconsistent configuration refusal.
- **Required correction:** Use a closed configuration schema, require every named policy needed by the selected server mode, reject unknown keys and inconsistent direct/proxy combinations, and document any intentional relationships between count and weighted limits.
- **Regression:** Table-test unknown/missing keys, unsafe values, direct mode plus proxy trust, proxy mode without trust, hop outside the configured trust-chain model, and count/cost consistency rules.

### F8 — Low — readiness probes are separate, but health probes are not independently quota-bounded

- **EP:** EP5, EP8.
- **Source:** `impl/src/web-northbound.mjs:272-288`; quota selection uses `readiness` only for `/readyz`, and all other paths including `/healthz` use `address`. `WebEdgePolicy` defines no health quota.
- **Failure:** EP5 says “Readiness probes are independently quota-bounded”; that narrow claim is met for readiness. If the intended seam is both health and readiness probe traffic (as EP8’s health/readiness coverage language suggests), health competes with ordinary address quota and has no independent ceiling. Current tests do not exercise probe exhaustion, expiry, `Retry-After`, or disclosure under refusal.
- **Required correction:** Clarify the spec. If both probes require isolation, add a health policy; otherwise explicitly state that health shares the general address policy.
- **Regression:** Exhaust each probe policy independently and assert bounded, non-disclosing responses and deterministic expiry.

## Explicit seam verdicts

- **EP1:** Not clean because of F1 and F2. Header-family mixing, duplicate parameters, chain length, selected-hop bounds, and untrusted-header ignoring are otherwise fail-closed and bounded. Raw addresses are HMAC-digested before normal edge audits; proxy-refusal audits contain neither raw headers nor raw peer addresses.
- **EP2:** Not clean because of F6 and F7. Fixed-window expiry and per-map cardinality are deterministic and synchronous. `takeCommand()` performs a synchronous two-phase check then mutation, so weighted refusal does not partially consume count quota in the current single-threaded execution model.
- **EP3:** Not clean because of F4 and F6. General address and login quotas precede body/provider work; principal/count and cost quotas precede durable command admission and dispatch; audited quota refusal fails closed. Authentication and body parsing necessarily precede principal quota selection, and client command/idempotency IDs do not select its credential bucket.
- **EP4:** Not clean because of F1, F2, and F7. Server assembly correctly requires key+certificate for direct HTTPS and permits cleartext only with explicit proxy mode plus nonempty trust. Untrusted forwarding cannot upgrade transport. Direct-mode TLS material is checked by server assembly, not by `WebEdgePolicy` alone.
- **EP5:** Not clean because of F3 and the clarification item F8. Response bodies disclose only liveness/readiness bits and no fleet/dependency detail.
- **EP6:** Not clean because of F4 and F5. Admission flags turn readiness false synchronously; existing registered SSE streams receive a small shutdown frame and close; repeated shutdown calls share one promise; no worker control method is invoked. Actual accepted-request draining and listener closure are not bounded.
- **EP7:** Not clean because of F3 and F5. Quota/proxy refusal and shutdown start/completion calls exist, and admission refusals covered by the reviewed paths fail closed on audit error. Quotas are in-memory operational state and are not used as durable command/session truth. Shutdown audit failures are intentionally swallowed, so append-only shutdown audit is not guaranteed.
- **EP8:** Not clean. Existing Phase 12 tests cover the principal happy/refusal paths, but omit the regressions listed in F1–F8, especially IPv6/normalization, direct-mode header ambiguity, real listener drain, shutdown races, readiness dependency grounding/transitions, and per-principal connection fairness.
- **EP9:** Clean as a scope statement. OIDC redirect/callback protocol details, optional WebSocket parity, browser automation/UI behavior, and MCP/operator UI remain explicitly deferred. None of F1–F8 depends on those deferred features; they are defects or ambiguities in the currently claimed HTTP/SSE edge policy.

## Deferred scope, kept separate

No defect is asserted here for unimplemented OIDC redirect/callback flows, WebSocket transport, browser UI/automation, or MCP/operator UI. Future implementations of those surfaces must consume the corrected canonical address, transport, quota, readiness, audit, and shutdown authorities rather than establish parallel trust rules.
