# Phase 12 authenticated web session lifecycle — independent adversarial review

Date: 2026-07-11

Scope reviewed: `spec/phase12/authenticated-web-session-lifecycle.md`, the governing WN requirements in `spec/phase12/authenticated-web-northbound.md`, `impl/src/web-auth.mjs`, `impl/src/web-northbound.mjs`, `impl/src/web-stream.mjs`, and all four requested Phase 12 test files. Prior evidence logs were not inspected. No network, homelab integration, or fleet action was used.

## Result

Three actionable implementation defects were found: one high, one medium, and one low. Apart from these findings, the reviewed implementation correctly keeps claims provider-injected; issues cookie and Bearer credentials only in the intended channels; hashes credentials at rest; performs predecessor revocation and successor installation in one session event; refuses the predecessor after restart; enforces HTTPS, exact Origin, JSON, body limits, cookie CSRF, strict host-only cookies, and credentialed exact-origin CORS; preserves claims across refresh; prevents lifecycle request claim/TTL expansion; binds stream liveness to the live session registry; leaks no raw lifecycle credential into the inspected session/audit/event paths; and makes no coordinator/fleet call from lifecycle routes.

## Findings

### HIGH — acknowledged session mutations are not durably committed before credentials/success are returned

**Source:** IL2 requires a durable `session.rotated` append before returning the successor; IL5 requires session-store append failure to return no new credential or success. `WebSessionStore._append()` calls `appendFileSync()` and immediately applies the event in memory (`impl/src/web-auth.mjs:62-68`), while issue and rotate return the raw credential after that call (`impl/src/web-auth.mjs:108-131`, `141-160`). No file or directory sync is performed. The creation path likewise creates the ledger without syncing its directory entry (`impl/src/web-auth.mjs:40-44`).

**Failure sequence:** (1) login or refresh appends an event into the kernel page cache; (2) `_append()` returns, the coordination audit commits, and HTTP returns a cookie/Bearer credential; (3) the process/host loses power before the session ledger reaches stable storage; (4) after restart the acknowledged issuance/rotation is absent. For rotation, the client has discarded or overwritten the predecessor with the returned successor, but durable truth may still recognize only the predecessor. This violates durable one-time rotation and restart integrity; depending on client retention it can also resurrect the supposedly revoked predecessor. A torn append instead makes `_load()` fail closed on the truncated tail, taking all session authentication unavailable.

**Why high:** the security property being claimed is specifically crash-safe revocation/rotation. A normal successful response can be contradicted by restart state, including possible predecessor resurrection.

**Missing regression:** the existing restart test reopens the file after a clean synchronous append (`impl/test/phase12-web-session-lifecycle.test.mjs:53-63`), and the append-failure test injects an exception before any write (`:66-81`). Neither proves stable-storage ordering or simulates loss/torn persistence after an acknowledged append. Add a storage abstraction that can assert file-data and parent-directory sync ordering, plus crash-point recovery tests around issue, rotate, and revoke before any response is released.

### MEDIUM — required coordination-audit failure after rotation strands the session with no reconciliation path

**Source:** IL5 explicitly says that when session mutation has committed but required coordination audit fails, retry/re-authentication reconciles from durable session truth rather than undoing or duplicating the credential. `_refresh()` commits `session.rotated`, thereby revoking the presented credential and creating a successor, before calling `_audit()` (`impl/src/web-northbound.mjs:373-382`). If `_audit()` throws, it returns `503` without sending the already-generated successor. Authentication exposes only token lookup, and a retry with the predecessor fails before `_refresh()` (`impl/src/web-northbound.mjs:314-349`; `impl/src/web-auth.mjs:163-185`). There is no rotation operation ID, pending credential delivery record, recovery lookup, or replay route.

**Failure sequence:** (1) a valid refresh authenticates with credential A; (2) the durable rotation atomically revokes A and installs B; (3) `recordWebAudit` fails; (4) the server returns `503` and never reveals B; (5) retry with A returns `401`; B is unknowable to the client. Re-login creates an unrelated session rather than reconciling this rotation. The same mutation-before-audit pattern leaves orphan active sessions on login-audit failure and makes logout retry observably non-idempotent, but refresh is the availability-critical case.

**Why medium:** it fails closed and does not expand privilege or touch fleet state, but an ordinary required-audit outage irrecoverably destroys the caller's authenticated session and directly contradicts IL5's specified retry/re-authentication reconciliation.

**Missing regression:** no lifecycle test injects `recordWebAudit` failure after successful issue/rotate/revoke. Add crash/failure-point tests for each boundary: session append failure, coordination audit failure after mutation, response-write loss after audit, and retry/re-authentication recovery from durable truth. Assert no duplicate rotation, no predecessor acceptance, and deterministic recovery of the committed outcome.

### LOW — invalid provider claims can be reported as server/storage failure instead of the required bounded authentication refusal

**Source:** IL1 requires missing, throwing, or refusing providers to have the same bounded `unauthenticated` response and no issuance. `validProviderClaims()` accepts any nonempty strings and any positive safe TTL (`impl/src/web-northbound.mjs:49-56`), but `WebSessionStore.issue()` applies narrower identifier syntax and maximum-TTL policy (`impl/src/web-auth.mjs:108-112`). `_login()` treats the former as valid, then maps the latter's validation exception to `503 temporarily_unavailable` (`impl/src/web-northbound.mjs:352-367`).

**Failure sequence:** (1) the injected provider returns, for example, `userId: "bad user"` or a TTL above the store maximum; (2) northbound claim validation accepts it; (3) session issuance throws before mutation; (4) the route returns `503`, distinguishable from provider refusal's `401`. No credential is issued, but provider/policy errors are misclassified as infrastructure failure and violate the uniform refusal contract.

**Why low:** confidentiality, authorization, and mutation safety remain fail closed; the defect is response classification and operational ambiguity.

**Missing regression:** current injected-provider tests cover valid claims and forged request claims, not provider output at the store-policy boundary. Add cases for invalid identifier characters/length, invalid capability/repository identifiers, and TTL above `maxTtlMs`; each should produce the same bounded `401 unauthenticated`, no session event, sanitized audit, and zero fleet calls.

## IL1–IL8 seam disposition

- **IL1:** provider-only claim authority is preserved; request fields cannot directly become identity claims. Finding 3 covers the provider-output refusal mismatch. Provider-granted capability/repository scope is necessarily trusted by this injected-provider contract; no request-driven confused-deputy or claim-expansion path was found.
- **IL2:** rotation is one logical event and in-memory/restart replay atomically revokes A while installing B; old-token replay is refused. Finding 1 covers missing stable-storage durability, and Finding 2 covers post-commit recovery.
- **IL3:** lifecycle POST routes enforce encrypted sockets, exact configured Origin, JSON, bounded parsing, empty refresh/logout bodies, and cookie CSRF. CORS reflects only an allowed exact origin with credentials and `Vary: Origin`; no wildcard combination was found. Oversized-body handling is bounded, though the tests use a no-op `req.destroy()` and do not prove delivery of the typed 413 on a real socket.
- **IL4:** cookie/Bearer delivery, clearing-cookie posture, `no-store`, and sanitized identity are correct in inspected paths. Raw credentials were not found in URLs, audit/events, errors, or provider metadata. The SSE URL contains a single-use connection ticket, which the governing spec explicitly classifies as non-credential.
- **IL5:** session append precedes credential release and coordination audit precedes success, but Findings 1 and 2 cover crash durability and the specified post-mutation audit reconciliation gap. Refusals are audited fail closed where implemented.
- **IL6:** live registry checks close an existing SSE at the next pump and before each replayed event, and rotated/logged-out credentials cannot issue tickets, reconnect, or command. Lifecycle code contains no coordinator dispatch. No stream-to-fleet side effect was found.
- **IL7:** deterministic tests cover the happy paths, predecessor refusal/restart, append exception before mutation, primary request controls, credential leakage, stream revocation, and zero fleet calls. The missing regressions are listed per finding; the suite does not yet substantiate the full stated append/audit/crash gate.
- **IL8:** OIDC redirect/callback mechanics, login throttling, per-IP/principal quotas, trusted-proxy address resolution, optional WebSocket parity, and real browser automation are deferred WN5/WN8/WN9 scope. They are not counted as defects in this review. The SSE lifecycle and direct-TLS authority reviewed here do not claim those deferred gates.

## Replay, leakage, and fleet-side-effect conclusion

Credential replay after clean rotation/logout is refused, claim expansion through refresh bodies is rejected, mixed cookie/Bearer presentation fails closed, and stream tickets are session/credential/origin/repository bound and single-use. No raw credential leakage or lifecycle-triggered coordinator/fleet call was found. No additional actionable IL1–IL8 defect was identified beyond the three findings above.
