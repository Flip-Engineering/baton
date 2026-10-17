# Phase 12.3 — browser OIDC bootstrap

This vertical gives the human user a concrete browser login path into the existing authenticated
web northbound. Baton remains an OIDC relying party, not an identity provider. Token exchange and
signature verification are injected at one explicit provider boundary; no worker-provider
credential is reused, and no homelab integration is introduced.

## BO1 — Authorization Code + PKCE is exact and bounded

`GET /v1/auth/oidc/start` creates one short-lived flow with cryptographically random state, nonce,
browser-binding token, and PKCE S256 verifier/challenge. The redirect uses one configured HTTPS
authorization endpoint, client ID, exact callback URI, `response_type=code`, and bounded scopes.
Configuration rejects userinfo, fragments, query ambiguity, non-HTTPS endpoints, invalid TTLs, or
unbounded pending-flow capacity.

## BO2 — state is bound to the initiating browser

State alone is insufficient against login CSRF. Start also returns a host-only `Secure; HttpOnly;
SameSite=Lax` flow cookie scoped only to the callback path. Callback requires exactly one matching
state and cookie, consumes the flow before provider work, and rejects replay, expiry, duplicates,
unknown parameters, provider errors, or malformed codes without session issuance. Redirect or
response delivery failure rolls back only the exact uncommitted flow.

## BO3 — provider verification is injected but constrained

The injected completion callback receives the authorization code, secret PKCE verifier, exact
redirect URI/client ID, and expected issuer/nonce. It must perform token exchange and signature
verification. Baton independently requires exact issuer, audience containing its client ID,
subject, and nonce in the verified result before invoking a claims mapper. Raw codes, verifiers,
tokens, nonce, state, and provider claims never enter durable audit or error text.

The claims mapper may return only `userId`, capabilities, repository scopes, and TTL. Baton forces
`authMethod:cookie`; request/provider fields cannot select a Bearer credential or expand claims
outside `WebSessionStore` policy.

## BO4 — callback issues the existing durable session

Successful callback audit precedes `WebSessionStore.issue()`. The response is a `303` to the fixed
same-origin `/control` path with the strict HttpOnly session cookie, a readable non-credential
SameSite-Strict CSRF cookie bound by the session's stored digest, and a clearing flow cookie. The
authorization code/state disappear from the browser URL. Cache and referrer policy are
fail-closed. If synchronous delivery fails after issuance, the exact session is revoked.

## BO5 — origin, fetch, quota, and shutdown posture

Start requires canonical HTTPS and a same-origin/none top-level browser navigation. Callback
requires canonical HTTPS, navigation semantics, and no attacker-selected Origin. Start consumes
the login quota before flow allocation. Closed admission, quota refusal, provider failure, audit
failure, or session failure returns no success. Shutdown prevents new start/callback admission but
never changes worker truth.

## BO6 — deterministic and browser acceptance

Tests cover configuration; PKCE/state/nonce/cookie binding; expiry/capacity; exact one-time
callback; issuer/audience/nonce/subject and claims mapping; quota/audit/session/response failures;
non-leakage; fixed redirect; CSRF cookie binding; replay refusal; and zero coordinator calls.

After deterministic gates, a local HTTPS relying-party and fake OIDC provider are exercised in the
real in-app browser: start, provider redirect, callback, clean `/control` URL, authenticated command
and stream behavior, refresh/logout, and revoked reconnect. Provider-backed recursive review uses
the exact orchestrator harness/model/effort route and reaps every resource.

## BO7 — scope boundary remains explicit

This vertical does not claim a production provider adapter, optional WebSocket parity, the full
operator UI, admitted-command reconciliation, MCP, or all WN9 adversarial cases. It creates the
browser identity seam those later increments consume.
