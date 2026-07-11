# Phase 12 web-edge adversarial review — 2026-07-11

## Scope and method

Independently reviewed the current EP1–EP9 specification (`spec/phase12/web-edge-policy.md`), the Phase 12 lifecycle/northbound specifications, `impl/src/web-edge.mjs`, `impl/src/web-northbound.mjs`, `impl/src/web-stream.mjs`, `impl/src/web-auth.mjs`, and the five Phase 12 web test files named by the acceptance command. Prior evidence logs were not read. No source, fleet, homelab, or network action was taken.

## Findings

### F1 — Medium — command count/cost quota transaction can split across fixed windows

- **Source:** EP2 requires deterministic fixed-window enforcement and EP3 treats principal/cost quota as one refusal boundary (`spec/phase12/web-edge-policy.md:16-30`). `WebEdgePolicy.takeCommand()` performs two `canTake()` calls followed by two independent `take()` calls (`impl/src/web-edge.mjs:138-144`); every call obtains a new clock value (`impl/src/web-edge.mjs:20-40`).
- **Failure:** If the injected clock crosses a window boundary between these calls (or is merely stateful), validation and mutation need not concern the same window. For example, principal validation may occur in window N, cost validation in N+1, and the two commits can occur in still different windows. `takeCommand()` then returns success without atomically establishing that both limits admitted the command in one deterministic window. There is also no check of either commit result after the preflight checks. This is observable without concurrency because the injected clock is called four times.
- **Impact/severity:** Medium. Normal `Date.now()` makes the race narrow, but boundary behavior is part of quota correctness and an injected clock is explicitly contractual. A successful expensive command can be charged inconsistently across buckets/windows, weakening one limit and making replay of boundary behavior nondeterministic.
- **Action:** Capture one validated timestamp/window at the start of `takeCommand()` and implement a single commit operation across the principal and cost entries, or add quota operations that accept the captured timestamp and only mutate after both checks pass. Assert both commits rather than ignoring their results.
- **Regression:** Add a test whose injected clock advances across the four current calls. Seed principal and cost near their limits on both sides of the boundary, invoke `takeCommand()`, and assert either one atomic refusal with neither bucket changed or one success with both charges recorded in the same window. Also assert the clock is sampled once per combined transaction.

### F2 — Medium — durable audit records contain raw credential identifiers contrary to EP7's literal non-disclosure rule

- **Source:** EP7 says the listed edge audit events are append-only audited “without raw addresses or credentials” (`spec/phase12/web-edge-policy.md:56-61`). The shared northbound audit envelope writes `credentialId` verbatim (`impl/src/web-northbound.mjs:127-134`), including quota refusals (`impl/src/web-northbound.mjs:196-201`, `337-341`). Stream audit records do the same (`impl/src/web-stream.mjs:50-54`), including connection-limit/refusal and shutdown disconnect events. The command admission record also persists the raw credential identifier (`impl/src/web-northbound.mjs:210-214`).
- **Failure:** Any authenticated quota refusal or stream audit places the stable raw credential identifier in the durable coordination log. Address values receive a keyed digest, but credential identifiers receive no equivalent minimization. If EP7 intended only credential *secrets*, the specification is ambiguous and the implementation/tests do not establish that narrower meaning.
- **Impact/severity:** Medium. This does not expose bearer/cookie secret material, but it creates durable, correlatable credential-level data in the exact audit boundary that claims credentials are absent. Log readers gain session/credential correlation beyond the stated disclosure posture.
- **Action:** Replace audit `credentialId` with a domain-separated keyed digest (or omit it where the actor/session already supplies sufficient provenance), and clarify EP7 to distinguish credential identifiers from credential secret material. Keep raw identifiers only in durable authorization/idempotency state where required, not general audit payloads.
- **Regression:** Issue an authenticated quota refusal and connection refusal with a distinctive credential ID, serialize all resulting audit events, and assert the raw ID and all credential/token material are absent while a stable keyed classification/digest remains. Repeat for shutdown-driven stream closure.

## EP-by-EP verdicts

### EP1 — clean

Direct mode uses the socket peer and ignores all forwarding headers. Proxy trust is an exact string allowlist match, deliberately treating IPv4 and IPv4-mapped IPv6 as different peers. Both native IPv6 and bracketed RFC `Forwarded` IPv6 are accepted; zone IDs, bracket/port ambiguity, whitespace, duplicate parameters, mixed standard/legacy families, excessive length/hops, missing protocol, and an out-of-range configured hop fail before authentication, provider execution, or body parsing. The selected hop is counted from the trusted-proxy end. Malformed-forwarding audit retains only a keyed peer digest/classification. No additional EP1 defect found.

Operational caution, not a defect: deployments must configure the address form actually presented by Node (for example `::ffff:127.0.0.1`, not `127.0.0.1`), because the exact-match rule intentionally performs no canonical alias conversion.

### EP2 — finding F1; otherwise clean

All configured limits, window size, cardinality, costs, replay/stream ceilings, and connection limits reject non-positive, non-integer, or non-safe values; unknown quota names fail closed. Fixed-window expiry is deterministic, expired keys are pruned before capacity decisions, new keys cannot evict live keys, ticket state is TTL/cardinality bounded, and connection keys disappear on final release. Principal count, weighted cost, ticket, address, login, health, readiness, and concurrent connection authorities are separate. F1 is the only EP2 defect found.

### EP3 — clean

Canonical address resolution and the address/login quotas precede body parsing and provider execution. Command authentication, validation, and authorization precede the credential-derived principal/cost bucket, which precedes durable command admission and coordinator dispatch. Ticket quota uses the authenticated credential ID rather than a client field; connection quota does likewise. Refusals return typed 429 plus `Retry-After`, and audit failure converts the refusal to 503 without session/command/worker/stream admission. Weighted-cost preflight refusal does not consume the principal-count bucket. No additional EP3 defect found.

### EP4 — clean

Production assembly requires key and certificate for direct HTTPS and an edge/readiness authority. Cleartext assembly requires explicit proxy mode, a nonempty trusted peer allowlist, and no TLS material. In proxy mode, only an exactly trusted immediate peer can supply a strictly parsed HTTPS signal; an untrusted peer remains direct HTTP regardless of spoofed forwarding headers and therefore cannot pass secure lifecycle/authentication checks. Standard and legacy forwarding families cannot be mixed. No EP4 defect found.

### EP5 — clean

Health returns only `{ok:true}` and uses an independent health quota. Readiness returns only `{ready:true|false}`, has an independent readiness quota, and is grounded in coordination health, authenticator health/liveness support, session-ledger health when present, optional explicit checks, and both admission flags. Probe/audit failure forces not-ready without dependency detail. No worker, task, repository, credential, provider, path, error, or dependency detail enters either response. No EP5 defect found.

### EP6 — clean

Shutdown flips northbound and edge admission synchronously before awaiting audit or listener work; lifecycle rechecks after body parsing and after an awaited provider, commands recheck after body parsing, tickets recheck after body parsing, and event streams check both northbound admission and stream acceptance. Existing streams receive the fixed reconnect shutdown event, close exactly once, release leases, and stop polling. Listener close has a drain deadline followed by idle/all-connection closure and a second bounded wait. Repeated calls share one promise. Audit and broken-socket failures remain bounded. No coordinator interrupt/kill or worker-state assertion occurs. Backpressure is byte-bounded, emits a bounded lag control when possible, closes, and releases capacity. No EP6 defect found.

### EP7 — finding F2; otherwise clean

Quota refusal, proxy refusal, readiness transition, shutdown start, and terminal shutdown outcome are durable audit events. Address material is keyed-digested and forwarding values are not copied. Audit failure yields no admission success; shutdown still closes resources and returns a degraded result. Quota state is process-local and is not consulted as session, command, idempotency, or fleet truth. F2 is the only EP7 defect found.

### EP8 — acceptance gap from F1/F2; otherwise clean

The Phase 12 edge tests exercise the claimed direct/trusted/untrusted proxy paths, IPv4/IPv6 exactness, malformed and mixed forwarding, HTTPS proof, quota expiry/cardinality/separation/ordering, provider and shutdown races, readiness non-disclosure, configuration refusal, drain/idempotency/audit failure, connection lease cleanup, and no-fleet effects. They do not exercise a clock transition inside the combined principal/cost transaction or assert absence of raw credential identifiers from authenticated audit records. Those are the exact regressions requested in F1 and F2. Recursive Baton build/integration/kill/reap claims were outside this review's permitted actions and are not re-claimed here.

### EP9 — correctly deferred, not EP defects

OIDC redirect/callback protocol details, optional WebSocket parity, real-browser automation, and MCP/operator UI remain explicit deferred scope. Login uses an injected identity provider and the reviewed stream transport is SSE; neither is represented as completing those deferred surfaces. No EP9 scope-claim defect found.

## Overall verdict

Two medium findings: combined command quota atomicity at clock boundaries (F1) and literal EP7 credential-identifier leakage in durable audit (F2). No high or critical findings. Every other reviewed EP trust seam has an explicit clean verdict above.
