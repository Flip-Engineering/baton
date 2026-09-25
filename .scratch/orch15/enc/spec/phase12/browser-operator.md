# Phase 12.4 / Phase 64 — authenticated Run desk

This vertical supplies the human-facing Run application over the existing authenticated HTTPS and
SSE authorities. It is deliberately a thin client: no Run, Goal, Plan, worker, approval, route,
fence, or evidence truth is owned in the page. Phase 64 supersedes the historical worker-first
dispatch form; that kernel surface survives only under Advanced / Emergency.

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

## BU3 — concise Run intent and deployment cards

The page reads a sanitized application card, selects one immutable deployment profile and one
allowed exact harness/model/effort tuple, and sends `run_start` with only objective, profile, route,
and optional narrower scope. It never constructs a Brief, task ID, verification shell command,
budget, gate, fence, or provider fallback. The Plan preview appears before worker effects.

## BU4 — RunView is the primary control surface

The page renders phase, Plan digest and readable approval folio, progression spine, requested /
resolved / observed route, budget, ownership, verification, semantic state, attention, and Story
narrative from one bounded RunView. `run_approve` binds the displayed Plan digest. `run_answer`
resolves the Run-owned request exactly once. Status and wait return another RunView; the browser
does not join unrelated receipts or infer completion. `run_steer` selects only a RunView-owned
worker, requires nudge/now/turn plus an explicit reason, and leaves current-fence resolution to the
application.

## BU5 — advanced emergency controls remain honest

Run-scoped stop/reap is a first-class Run control with an explicit reason and visible receipt.
Worker list, fenced kill/reap, controller-wide fleet drain, and raw SSE trace are hidden behind an
explicit Advanced / Emergency disclosure and never loaded automatically. `fleet_drain` is labeled
as worker reap while the host remains open; neither `application.shutdown` nor a fictional
fictional `run.close` exists in the browser. The event trace uses one-time cookie/session/repository-bound
tickets, `textContent`, stable cursors, and a bounded local display.

## BU6 — logout and failure posture

Logout calls the existing audited route, clears session and CSRF cookies, and returns to an
unauthenticated surface. Network/JSON failures display bounded status text and never retry a
state-changing command under a new idempotency key automatically.

## BU7 — acceptance and remaining scope

Deterministic tests cover authentication/scope, CSP/MIME/no-store headers, sanitized session and
application cards, the nine Run commands, exact tuple/fence/CSRF/idempotency wiring, remote-shutdown
absence, no dangerous HTML sinks, and zero fleet calls from asset reads. A real local browser pass
then exercises OIDC, objective/profile/route, Plan approval, RunView/attention, advanced kill/reap,
stream, and logout/revocation.

Cursor-follow without polling, recovery, materialized result export, semantic review, multi-node
scheduling, optional WebSocket parity, and the complete WN9 live-browser
gate remain explicit scope.
