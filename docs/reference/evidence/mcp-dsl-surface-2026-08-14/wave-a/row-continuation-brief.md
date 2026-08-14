# ROW BRIEF — row-continuation: BatonWebClient implements bounded list continuation

Issue #227 item 4 (#223 cross-ref). Deliverable: implementation + red-first pin.

## Anchors

- impl/src/application.mjs:12183 — runs.list throws application_run_list_continuation_required
  when authorized runs exceed MAX_RUN_LIST_ITEMS; the refusal is the honest server-side
  guard (keep it).
- impl/src/application-cli.mjs:2122 — BatonWebClient.command: status==='admitted' →
  reconcile(); the continuation refusal returns 400 with the code — the client throws
  cliError and STOPS. MEASURED (2026-08-14): waves.list/runs.list unusable over web on any
  real fleet; observability broken at exactly fleet scale.

## Contract (closed)

1. On the continuation refusal the client re-issues with the server-named continuation
   cursor (the refusal's field carries it or the next call accepts an offset — follow
   whichever the server actually exposes; if NEITHER exists, the server gains a
   continuation field in the SAME refusal payload, additive) until the list completes or a
   bounded page count (measured cap, e.g. 64 pages) — never unbounded.
2. The MCP surface benefits transitively (the facade rides the client); CLI list verbs
   become usable at fleet scale.
3. Red-first pin impl/test/web-client-continuation-red.test.mjs: a fake transport serving
   3 continuation pages completes in one client runs.list call (RED at pre-change head:
   throws on the first refusal).

## Hard bounds
Additive; no server behavior change beyond the additive refusal field if needed; batteries green.
