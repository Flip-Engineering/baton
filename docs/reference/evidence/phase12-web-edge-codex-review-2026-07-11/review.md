# Phase 12 web-edge adversarial review — 2026-07-11

## Scope and method

Independent review of the current EP1–EP9 contract in `spec/phase12/web-edge-policy.md`, the related current northbound/session lifecycle specifications, `impl/src/web-edge.mjs`, `impl/src/web-northbound.mjs`, `impl/src/web-stream.mjs`, `impl/src/web-auth.mjs`, and the five Phase 12 web test files named by the acceptance command. Prior evidence logs were not read. No source, fleet, homelab, network, or server state was changed.

## Findings

### F1 — High — production server assembly permits omission of the entire edge policy

- **Source:** EP1–EP5 require canonical-address trust, request/login/principal/cost/ticket/connection quotas, explicit direct/proxy transport posture, and quota-bounded probes. `WebNorthbound` makes the edge optional (`impl/src/web-northbound.mjs:113`), and `createAuthenticatedWebServer` requires only an authenticator and TLS material in direct mode (`impl/src/web-northbound.mjs:521-532`). The existing direct-TLS assembly test constructs a northbound with no edge and treats server assembly as valid once TLS material is supplied (`impl/test/phase12-web-northbound.test.mjs:181-206`).
- **Failure:** A caller can assemble the exported production HTTPS server with `edge === null`. Requests then skip canonical address resolution and every EP quota (`impl/src/web-northbound.mjs:280-301`); command execution also skips principal/cost enforcement (`impl/src/web-northbound.mjs:198-205`), and streams receive no per-credential connection lease (`impl/src/web-northbound.mjs:120-121`). TLS alone therefore produces a server advertised as authenticated but not EP-compliant.
- **Required correction:** Make production server assembly require a validated `WebEdgePolicy` (or construct one from closed required configuration), while retaining an explicitly named/test-only unbounded adapter only if needed. Validate the selected listener mode against that policy.
- **Regression:** Assert both direct-TLS and proxy server creation refuse a missing edge; then exercise the assembled direct-TLS server and prove address, login, principal/cost, ticket, probe, and connection limits cannot be bypassed.

### F2 — High — readiness is not grounded in the mandatory authorities and can return ready for an unverifiable custom authenticator

- **Source:** EP5 requires failure when operational log/coordination authority, session ledger/liveness verification, command idempotency storage, or admission state is unavailable. `_isReady` checks admission, calls `coordination.snapshot()` if present, optionally calls session health, verifies only that an authenticator function exists, and accepts an empty caller-supplied check list (`impl/src/web-northbound.mjs:144-152`). `createAuthenticatedWebServer` likewise checks only that authentication is a function (`impl/src/web-northbound.mjs:521-523`).
- **Failure:** With a custom authenticator and no session store, readiness can be `200` despite there being no liveness/revocation verifier at all. A successful snapshot does not establish that `admitWebCommand`/completion idempotency storage is writable/durable, and no required interface or probe grounds those dependencies. Optional `readinessChecks` transfer a mandatory security invariant to callers and omission silently reports ready.
- **Required correction:** Define a required readiness authority/interface that independently and fail-closed probes coordination log integrity, command admission/idempotency persistence, and authentication/session liveness. Reject production configuration lacking those probes; do not infer health from method presence or a snapshot alone.
- **Regression:** Construct a server with (a) custom authenticate but no liveness check, (b) readable snapshot but failed idempotency/admission store, and (c) unavailable revocation state; each must refuse configuration or return only `{ready:false}`. Retain exact response non-disclosure assertions.

### F3 — Medium — shutdown audit failures are silently converted into unaudited success

- **Source:** EP7 says shutdown start and completion are append-only audited. Shutdown catches and discards both audit failures (`impl/src/web-northbound.mjs:500,513-515`) and can return `{ok:true,result:'closed'}` with neither record. EP6 requires bounded/idempotent behavior even under audit failure, but does not waive EP7 durability.
- **Failure:** Loss of the audit authority during shutdown leaves no durable start/terminal provenance while the API reports ordinary successful closure. This prevents operators from distinguishing a clean audited drain from an unaudited one and contradicts the exact EP7 claim.
- **Required correction:** Keep admission closure and socket drain bounded, but surface a bounded degraded result when either required append fails (and, where possible, retry the terminal append within the existing deadline). Do not reopen admission or affect fleet truth.
- **Regression:** Inject failure separately for `shutdown_started` and the terminal record; assert one shutdown execution, bounded listener/stream closure, zero coordinator fleet calls, idempotent repeated result, and an explicit non-success/degraded audit outcome rather than silent success.

### F4 — Medium — proxy-refusal audit drops the only safe address provenance

- **Source:** EP1 and EP7 require proxy refusal audit with presence/classification and a keyed address digest, never the raw address. Edge resolution throws before `edgeIdentity`/digest is installed (`impl/src/web-northbound.mjs:281-287`); the catch audits only `{origin}` (`impl/src/web-northbound.mjs:282-284`). `_audit` therefore records `remoteAddressClass:'absent'` and `addressDigest:null` (`impl/src/web-northbound.mjs:125-132`) even though the socket peer was present and is the trust-boundary address.
- **Failure:** Malformed or ambiguous forwarding attacks—the events for which proxy provenance matters most—cannot be correlated or address-classified in durable audit. No raw address leaks, but required keyed provenance is lost.
- **Required correction:** Validate and digest the immediate socket peer independently before parsing forwarded fields; on forwarding refusal audit `remoteAddressClass:'present'`, the peer digest, and a bounded reason classification. If the peer itself is invalid, audit a bounded invalid-peer class without echoing it.
- **Regression:** For trusted-peer malformed/mixed/overlong IPv4 and IPv6 forwarding, assert `proxy_refused` contains a 64-hex peer digest and presence/class only, contains no raw address/header, and audit failure still returns `503` before auth/provider/body work.

## EP-by-EP verdict

- **EP1 — finding F4; otherwise clean.** Immediate-peer trust is exact, untrusted forwarding is ignored, trusted chains are length/size bounded, mixed standard/XFF families fail, configured hop selection is deterministic, IPv4 and bracketed IPv6 are parsed, IPv4-mapped IPv6 is intentionally not aliased, and raw addresses are not placed in audit records. No additional defect found in the reviewed address-selection logic.
- **EP2 — finding F1; otherwise clean.** Fixed-window expiry, positive safe-integer configuration, bounded per-policy key maps, deterministic capacity refusal, atomic synchronous principal/cost preflight/commit, independent probe buckets, and concurrent-key release are sound in-process. Counters are intentionally restart-ephemeral. No additional expiry/cardinality/atomicity defect found.
- **EP3 — finding F1; otherwise clean.** With an edge installed, address and login refusal precede body/provider work; authentication/authorization precede principal/cost charging; quota refusal precedes durable command admission and dispatch; ticket and connection buckets are credential-derived rather than client-selected. Audit failure returns no admission success. No additional ordering or mutation defect found.
- **EP4 — finding F1; otherwise clean.** Direct identity uses socket encryption; proxy cleartext requires nonempty exact peer trust and a selected HTTPS forwarding signal; untrusted headers cannot upgrade transport; direct/proxy configuration mixing and missing TLS material are refused. The reviewed exact IPv4/IPv6 behavior is coherent. No additional server-mode defect found.
- **EP5 — findings F1 and F2.** Health/readiness response bodies disclose only liveness/readiness bits and their quotas are independent; audit failure makes readiness false. Mandatory dependency grounding is incomplete as described above.
- **EP6 — finding F3 only through its audit interaction; operational drain otherwise clean.** Admission closes synchronously before awaited work, provider completion loses the shutdown race, streams stop accepting and receive a fixed bounded shutdown frame, listener drain is deadline-bounded, forced closure is bounded, repeated shutdown shares one promise, and no shutdown path calls coordinator fleet control.
- **EP7 — findings F3 and F4.** Session/command/ticket admission is fail-closed around required audit/storage commits, credentials and raw addresses are absent from reviewed audit/error paths, and quota state is not treated as durable truth. Shutdown durability and proxy-refusal provenance remain defective.
- **EP8 — not satisfied because F1–F4 lack regressions.** Existing tests cover the majority of the enumerated matrix, including IPv4/IPv6, mapped-address exactness, mixed headers, quota expiry/cardinality, no-mutation refusals, non-disclosure, connection release, drain/idempotency, and no-fleet-effects. Add the regressions specified above.
- **EP9 — clean/deferred.** OIDC redirect/callback mechanics, optional WebSocket parity, browser automation/UI, and MCP/operator UI are explicitly deferred. None of F1–F4 depends on or should be reclassified into that deferred scope.

## Deferred scope separation

No defect is reported merely for absence of OIDC redirect/callback behavior, WebSocket transport parity, a real browser sequence/UI, or MCP/operator UI. Those are EP9 follow-on consumers. The findings above concern the currently claimed HTTP/SSE edge policy and production assembly only.
