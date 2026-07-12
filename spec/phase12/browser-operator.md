# Phase 12.4 — authenticated browser operator seat

This vertical supplies a minimal browser control surface over the existing HTTPS command and SSE
APIs. It is deliberately a thin client: no worker, task, approval, routing, fence, or goal truth is
owned in the page.

## BU1 — every operator asset is authenticated

`GET /control`, its same-origin script/style assets, and `GET /v1/session` require canonical HTTPS,
one active cookie session, `observe`, and the served repository scope. Missing/expired/revoked or
wrong-scope sessions get bounded 401/403 responses without asset or hidden-object disclosure.
Assets are no-store, MIME-pinned, nosniff, frame-denied, and governed by a self-only CSP.

## BU2 — session introspection is sanitized

`GET /v1/session` returns only user ID, capabilities, repository scopes, and expiry. It never
returns session/credential IDs, cookie/token values, CSRF digests, provider claims, or worker
credentials. The browser reads the non-credential CSRF cookie issued by BO4 for state-changing
requests.

## BU3 — exact route specificity reaches the command envelope

The spawn form independently selects harness, exact model, and effort. The page emits the existing
schema-v1 command envelope with cryptographic command/idempotency IDs, exact origin, repository,
and the three independent route axes. It does not invent fallback aliases or infer model from
harness.

## BU4 — control preserves fences and single-consumer authority

Worker rendering uses sanitized `list` results. Send/interrupt/kill include the currently observed
fence; approval/question responses use the existing request ID and `respond` command. Stale fence,
idempotency, authorization, and coordinator failures remain typed server outcomes. The page never
edits coordinator projections directly.

## BU5 — observation uses the existing resumable stream

The page obtains a one-time stream ticket with cookie CSRF and opens the existing event endpoint.
It renders frames only with `textContent`, maintains the last observed cursor, reconnects through
the server contract, and bounds its local event display. Browser close/reload has no worker-control
side effect.

## BU6 — logout and failure posture

Logout calls the existing audited route, clears session and CSRF cookies, and returns to an
unauthenticated surface. Network/JSON failures display bounded status text and never retry a
state-changing command under a new idempotency key automatically.

## BU7 — acceptance and remaining scope

Deterministic tests cover authentication/scope, CSP/MIME/no-store headers, sanitized session data,
route-tuple/fence/CSRF/idempotency wiring in the static client, no dangerous HTML sinks, and zero
fleet calls from asset reads. A real local browser pass then exercises OIDC, page load, list/spawn,
stream, approval, kill/reap, and logout/revocation.

This is not a polished dashboard, optional WebSocket parity, admitted-command reconciliation,
MCP, or the complete WN9 adversarial gate. Those remain explicit subsequent scope.
