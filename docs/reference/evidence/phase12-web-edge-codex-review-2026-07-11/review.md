# Phase 12 web-edge adversarial review — 2026-07-11

## Scope and method

Reviewed the current EP1–EP9 contract in `spec/phase12/web-edge-policy.md`, the related northbound/session specifications, `impl/src/web-edge.mjs`, `impl/src/web-northbound.mjs`, `impl/src/web-stream.mjs`, `impl/src/web-auth.mjs`, the coordination health/admission implementation, and the five Phase 12 test files named by the acceptance command. Prior evidence logs were not read. This was a read-only source review except for this report; no implementation, network, homelab, or fleet action was taken.

## Findings

### F1 — Medium — trusted-proxy configuration does not canonicalize equivalent IP spellings

**Source:** `impl/src/web-edge.mjs:8-10,103-108,127-146`; EP1, EP4.

**Failure:** Trust is selected by raw JavaScript string equality after only `net.isIP()` validation. Equivalent socket/allowlist representations therefore do not match: most importantly an IPv4 allowlist entry such as `127.0.0.1` does not trust a socket peer reported as IPv4-mapped IPv6 `::ffff:127.0.0.1`. IPv6 textual aliases likewise remain distinct. This fails closed (forwarding cannot be spoofed), but a correctly located proxy can be treated as direct HTTP and all production requests refused. It also fragments direct address quota/digest buckets across equivalent IPv6 spellings supplied by an adapter/test double.

**Regression required:** Canonicalize both configured peers and socket/client addresses into one binary or normalized textual form, with an explicit policy for IPv4-mapped IPv6. Add direct and trusted-proxy tests for native IPv4, native IPv6, compressed/expanded IPv6 equivalence, and IPv4-mapped IPv6. Preserve exact peer membership after normalization; do not add subnet or implicit loopback trust.

### F2 — Medium — malformed request targets escape typed bounded handling

**Source:** `impl/src/web-northbound.mjs:278-280`; EP3, EP7, EP8.

**Failure:** `new URL(req.url, ...)` executes before the edge-resolution/audit failure boundary and is not caught. A malformed target (or a non-string target in an adapter) rejects/throws out of `handle()` instead of returning a bounded typed response and audit record. On the real Node server, the parser rejects many malformed request lines first, but the northbound authority itself does not uphold the claimed recursive typed-failure boundary for every accepted adapter input.

**Regression required:** Bound and validate `req.url` and catch URL construction before any privileged work; return a fixed 400 response and append a non-disclosing request-refusal audit, with audit failure producing 503. Add malformed, overlong, non-string, invalid-percent, and absolute-form ambiguity cases and assert zero auth/provider/session/coordinator work.

### F3 — Medium — shutdown is not bounded if stream shutdown throws

**Source:** `impl/src/web-northbound.mjs:505-528`, especially line 512; EP6, EP7.

**Failure:** `this.stream.shutdown?.()` is outside a failure boundary. A custom stream authority or unexpected synchronous stream cleanup failure rejects the memoized shutdown promise before listener close, drain deadline enforcement, and terminal audit. Repeated calls then return the same rejected promise. This contradicts the EP6 bounded/idempotent shutdown posture and can leave the listener accepting TCP connections after application admission has closed.

**Regression required:** Contain stream-shutdown failure, continue listener close/deadline/forced-close, record a degraded terminal outcome, and keep repeated shutdown calls resolved to that same bounded outcome. Add a throwing stream shutdown test asserting one invocation, listener close/force-close still occurs, admission stays closed, terminal audit is attempted, no fleet method is called, and repeated calls do not throw.

### F4 — Low — stream-ticket quota is charged when issuance subsequently fails

**Source:** `impl/src/web-northbound.mjs:332-346`; `impl/src/web-stream.mjs:75-99`; EP2, EP3.

**Failure:** The credential ticket bucket is committed before `stream.issue()`. A ticket-capacity refusal, randomness failure, clock failure, or issuance-audit failure returns no ticket but still consumes credential quota. Repeated infrastructure/audit failures can exhaust a principal's ticket allowance and extend denial after recovery. No ticket or connection state is created, so this is not privilege escalation, but quota/admission atomicity is weaker than the EP2/EP3 wording suggests.

**Regression required:** Define explicitly whether this is an issuance quota or an authorized-attempt quota. If issuance, introduce reserve/commit/rollback or perform all non-mutating issuance checks before committing and ensure audit/ticket state and quota have a documented atomic ordering. Test max-ticket, audit, clock, and randomness failures followed by recovery; assert the chosen counter semantics.

## EP verdicts

- **EP1 — finding F1.** Otherwise clean: untrusted forwarding fields are ignored; trusted peers reject mixed `Forwarded`/`X-Forwarded-*`, unknown/duplicate parameters, zones, ports, controls, escapes, excessive bytes/elements, and hop underflow. Bracketed IPv6 is accepted only in the narrow `Forwarded` grammar. Proxy-refusal audit uses only presence classification and keyed peer digest.
- **EP2 — finding F4.** Fixed-window configuration, safe/monotonic clock sampling, deterministic expiry, positive bounded `Retry-After`, bounded cardinality, and the two-bucket principal/cost preflight-and-commit transaction are otherwise clean. Connection release is idempotent for duplicate cleanup calls.
- **EP3 — findings F2 and F4.** For recognized routes, address quota precedes parsing/auth/provider work; login quota follows TLS/origin/content-type/bounded object parsing and precedes provider execution; command quota follows authentication/schema/authorization and precedes durable admission/dispatch; ticket quota follows live authorization. Client IDs do not select buckets. Refusal-audit failure returns no admission success.
- **EP4 — finding F1.** Production assembly otherwise admits only direct-policy TLS or trusted-proxy cleartext, rejects hybrids, requires bound readiness, and proxy transport requires a selected exact HTTPS forwarding signal. Untrusted headers cannot upgrade transport.
- **EP5 — no additional defect found.** Health returns only `{ok:true}` and readiness only `{ready:boolean}`. Readiness is grounded in the exact production coordination, session, and authentication authorities; coordination health covers the shared append log/idempotency store, and admission state is included. Probe quotas are independent. Audit failure fails readiness closed without dependency disclosure.
- **EP6 — finding F3.** Normal shutdown closes admission synchronously, turns readiness false, closes SSE streams with a dual-ceiling control write attempt, releases leases exactly once, closes/forces the listener to a deadline, memoizes the result, and calls no coordinator/fleet operation. Backpressure uses the same frame/buffer ceilings and terminal cleanup invariant.
- **EP7 — findings F2–F4 affect failure posture.** Address and credential material are digested where required; raw forwarding/address values are not appended. Readiness transition state advances only after its audit append. Quotas are process-local while command/session/idempotency truth remains durable. No other leakage or audit-derived authorization was found.
- **EP8 — incomplete because the actionable regressions above are absent.** Existing tests cover most named seams, including mixed forwarding, quota clocks/cardinality/atomic command charging, provider ordering, readiness non-disclosure/audit retry, configuration refusal, drain forcing, backpressure/shutdown cleanup, and no-fleet effects. They do not cover equivalent IPv4/IPv6 trust representations, malformed request-target containment, throwing stream shutdown, or failed ticket issuance counter semantics.
- **EP9 — clean deferral.** OIDC redirect/callback behavior, optional WebSocket parity, real browser automation, operator UI, and MCP integration remain deferred. None of F1–F4 depends on those deferred surfaces, so they are EP defects/gaps rather than deferred-scope findings.

## Overall verdict

EP1–EP9 are not clean: four actionable findings remain (three Medium, one Low). No Critical or High severity issue, forwarding-based trust bypass, raw address/credential audit leakage, readiness fleet disclosure, worker-control side effect, or shutdown claim of worker death was found in the reviewed surface.
