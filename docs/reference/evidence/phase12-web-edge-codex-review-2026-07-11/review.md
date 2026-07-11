# Independent adversarial review — Phase 12 EP1–EP9 web edge policy

Date: 2026-07-11

Scope reviewed: `spec/phase12/web-edge-policy.md`, the current authenticated web northbound and session-lifecycle specifications, `impl/src/web-edge.mjs`, `impl/src/web-northbound.mjs`, `impl/src/web-stream.mjs`, `impl/src/web-auth.mjs`, and the four Phase 12 web test files named by the acceptance command. Prior evidence logs were not read. No source, fleet, homelab, or network changes were made.

## Findings

### F1 — Medium — EP1/EP4 trusted X-Forwarded-Proto parsing contradicts the case-insensitive protocol contract

**Source:** `impl/src/web-edge.mjs:121` lowercases `Forwarded` protocol values, but `impl/src/web-edge.mjs:159-161` accepts the `X-Forwarded-Proto` value only when it is exactly lowercase `http` or `https`. `spec/phase12/web-edge-policy.md` EP1 says protocol tokens are case-insensitive HTTP/HTTPS after decoding. The Phase 12 edge tests exercise lowercase XFP only (`impl/test/phase12-web-edge.test.mjs:29,42,44,134,147`) and therefore do not detect the divergence.

**Failure:** A correctly configured trusted proxy that emits `X-Forwarded-Proto: HTTPS` is refused as `400 invalid_forwarding`, while the semantically identical `Forwarded: for=...;proto=HTTPS` is accepted. This makes transport selection depend on forwarding-header family and casing, contrary to the declared canonical trust boundary. It is fail-closed, so it does not permit a cleartext upgrade, but it can take every proxy-backed route (including health/readiness) out of service after a proxy configuration or version change.

**Regression required:** Add unit and real-listener cases for `HTTP`, `HTTPS`, and mixed-case XFP at a trusted peer, plus a negative non-HTTP token. Normalize the single XFP token before membership and `requireForwardedHttps` checks without relaxing duplicate/mixed-field rejection.

### F2 — Medium — EP3/EP7 invalid-command text allows attacker-controlled, large field names into responses and durable audit

**Source:** `impl/src/web-northbound.mjs:64` interpolates an unknown top-level key into the validation reason; `impl/src/web-northbound.mjs:191` persists that reason in `command_invalid`; the same string is returned by `impl/src/web-northbound.mjs:195`. The only effective bound is the general 64 KiB request body (`impl/src/web-northbound.mjs:524-533`), not a small error/audit-field bound. Similar interpolation exists for unknown command argument and model-policy keys at lines 69 and 81. The Phase 12 tests check ordinary unknown names but not large or sensitive-looking names.

**Failure:** Any authenticated, authorized-address client can place up to roughly the body limit of chosen text into a JSON property name and cause it to be echoed in the HTTP error and appended durably to audit. This violates the bounded/non-leaking refusal posture and amplifies audit storage per request. A client that accidentally uses a credential or other secret as a property name also causes that value to be retained, despite the audit contract's sensitive-value posture. Address and principal quotas limit frequency but do not make each durable record tightly bounded or redact its content.

**Regression required:** Return and audit fixed reason codes (for example `unknown_top_level_field`, `unknown_argument_field`, `unknown_model_policy_field`) rather than client text, or enforce a small identifier bound and redact before both sinks. Add a near-body-limit property-name test asserting bounded response/audit size and absence of the supplied marker.

## EP verdicts

- **EP1 — Finding F1. Otherwise clean:** direct requests use the canonical socket peer; untrusted forwarding is ignored; trusted peer matching is exact after IPv4/IPv6 normalization; IPv4-mapped IPv6 collapses to IPv4; forwarding chains and hops are bounded; mixed normalized headers and duplicate raw field-lines are rejected. Malformed trusted forwarding audits only a keyed peer digest.
- **EP2 — No additional finding:** quota construction rejects invalid limits; clocks are safe-integer and monotonic; fixed-window expiry and maximum key cardinality are deterministic; retry metadata stays positive; ticket issuance has exact-state and quota rollback through HTTP delivery; principal/count and weighted-cost preflight share one sample and do not partially mutate on refusal; connection leases are per credential and exactly-once released on covered terminal paths.
- **EP3 — Finding F2. Otherwise clean:** canonical address quota precedes target parsing, authentication, provider calls, body parsing, session mutation, command admission, and dispatch. Login quota is consumed only after route, HTTPS, Origin, media type, bounded JSON, and object validation. Stream-ticket authorization precedes credential quota. Command quota precedes durable admission/dispatch, and refusals do not mutate fleet/session/stream authority.
- **EP4 — Finding F1. Otherwise clean:** assembly admits only direct-policy HTTPS or trusted-proxy cleartext backend, rejects hybrids/lookalikes, and binds secure-transport enforcement listener-wide including probes. Untrusted headers cannot upgrade transport or alter identity.
- **EP5 — No finding:** health exposes only `{ok:true}` and readiness only `{ready:boolean}`. Production assembly requires the exact coordination, session, and authenticator-backed `WebReadinessAuthority`; admission closure makes readiness false; probe quotas are independent. Audit failure makes readiness fail closed and does not suppress retry of an unrecorded transition.
- **EP6 — No finding:** shutdown closes admission synchronously, makes readiness false, closes streams with bounded shutdown control, releases leases once, drains then force-closes listener connections within bounded waits, memoizes one result, tolerates stream/audit failures, and invokes no coordinator worker-control operation. Backpressure and shutdown control frames are checked against both control-frame and buffered-byte ceilings and terminal cleanup is idempotent.
- **EP7 — Finding F2. Otherwise clean:** proxy/quota/readiness/shutdown events are append-only audited, raw addresses and credential identifiers are replaced by keyed digests, admission successes fail closed on required audit failures, and operational quotas are not used as durable command/session truth.
- **EP8 — No policy/source finding beyond the regression gaps named in F1/F2:** the focused tests cover the specified trust seams broadly, including IPv4/IPv6 equivalence, raw-header ambiguity, ordering, quota atomicity/expiry/cardinality, readiness binding/non-disclosure, assembly refusal, shutdown races/drain/idempotency/no-fleet-effects, and ticket delivery rollback. F1 and F2 identify missing adversarial cases. Recursive build orchestration is an acceptance-process concern, not a defect in the reviewed runtime.
- **EP9 — Correctly deferred, not defects:** OIDC redirect/callback behavior, optional WebSocket parity, real browser automation, MCP/operator UI, and broader WN command/UI completion are expressly subsequent scope. This review does not reclassify those omissions as EP1–EP8 failures.

## Overall disposition

No critical or high-severity defect was found. EP1/EP4 and EP3/EP7 each have one actionable medium-severity conformance/hardening defect. Every other reviewed EP trust seam has an explicit clean verdict above; deferred EP9 work remains visibly separated from current edge-policy defects.
