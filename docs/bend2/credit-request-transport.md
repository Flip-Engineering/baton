# Per-request credit transport (#881, #793)

Status: design, not implemented. `credit_guard_qualified` remains `False{}` in
`bend2/src/coordinator/accounts.bend`, so no promotional-credit launch is admitted.

## Scope

This document covers the native transport that sits between the `claude-code`
harness and `api.anthropic.com` for an `api_key` account on the Anthropic route.
Its purpose is to call the per-request gate for every Messages request that the
launched harness sends, so that each request reserves its priced charge before it
is forwarded and settles to its actual cost after the response completes.

Policy stays in Bend2. Host code performs listener, socket and HTTP I/O only.

## Current source

- `credit_request_facts_for(db, body)` reads one Messages request body and returns
  `CreditRequestFacts`.
- `credit_launch_gate_priced(db, session, attempt, harness, chosen, helper,
  profile_store, facts, qualified)` reserves the priced charge for one request and
  returns the helper binding, or the hold sentence when the guard is not qualified.
- `credit_settle_for(db, request, outcome, cost, allow_failed)` settles one
  reservation to its actual cost, or to the reserved maximum when no cost is
  reported.
- `bend2/harness/api-key-exec.bend` resolves the secret reference, writes an
  owner-only environment specification and spawns the harness with
  `ANTHROPIC_API_KEY` in the child environment. It admits one whole launch against
  one authorization row.

The host has no effect that accepts a connection or streams an upstream response:

- `bend2/src/host/` and `bend2/harness/` define no `listen`, `accept` or `socket`
  call. The only socket use in the tree is in `bend2/harness/git-series.mjs`
  and `bend2/src/host/process-spawn.c`, which are not HTTP listeners.
- `bend2/src/host/credit-transport.c` provides `CID_HTTP_REQUEST`. That effect
  buffers the complete response before it returns, so it cannot forward a
  streamed Messages response as it arrives.

## Proposed flow

1. `api-key-exec` opens a listener on `127.0.0.1` at an ephemeral port before it
   spawns the harness.
2. The child receives `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>` and a per-launch
   placeholder for `ANTHROPIC_API_KEY`. The real key is not placed in the child
   environment.
3. For each request, the listener reads the request line, headers and a body of
   the length named by `Content-Length`.
4. Bend2 calls `credit_request_facts_for` on the body and then
   `credit_launch_gate_priced` with that request's facts.
   - On a hold, the listener answers with the provider's credit-exhaustion text
     (`Your credit balance is too low to access the Anthropic API.`). The existing
     classifier then reads it through the handoff path described in
     `docs/bend2/account-credit-funding.md`.
   - On an admit, the listener forwards the request to
     `https://api.anthropic.com` with the real key set in the `x-api-key` header.
5. The upstream response streams back to the child as it arrives. The listener
   parses the `usage` fields from `message_start` and `message_delta` events. At
   completion it prices the usage with `credit_request_price` and calls
   `credit_settle_for` with the actual cost.
6. An upstream failure after admission settles the reservation with
   `allow_failed` and keeps the reserved maximum counted.

## Accepted decisions

The root accepted these decisions on 2026-10-22.

1. Process boundary. The proxy is a per-launch child of `api-key-exec`. Its
   lifetime ends with the harness. It reads the provider key owner-only and
   injects it into each forwarded request. The harness child never holds the key.
   There is no shared daemon.
2. Concurrency. There is no cap of one reservation per organization, grant cycle
   and cap period. The admission rule is the credit balance for the grant cycle.
   A request is admitted while the sum of open reservations and settled spend,
   plus the request's reserved maximum, stays within the remaining promotional
   balance for that cycle. A request that would exceed the balance waits in
   first-in-first-out order until earlier reservations settle and release
   headroom. It is refused only when the balance is exhausted. Settlement releases
   the unused part of each reservation.

The current source does not implement rule 2. `credit_reservations_active` is a
unique index that allows one active reservation per organization, grant cycle and
cap period. The implementation replaces that index with the balance-sum rule, and
the funding document's launch-serialization sentence changes with it.

## Open implementation choices

1. Usage parsing. The settle path reads the `usage` fields of the streamed
   response: `message_start` for input and cache tokens, and `message_delta` for
   output tokens. A response with no usage fields settles to the reserved maximum.
   The root did not decide this point.

## Native effects required

- `CID_LISTEN_LOOPBACK`: bind and listen on `127.0.0.1`, return the port, accept
  one connection per call.
- `CID_HTTP_STREAM`: send one request to a fixed HTTPS origin and deliver each
  response chunk to a caller-owned write effect as it arrives.
- A bounded read of one HTTP request head and body from an accepted socket.

None of these exist in the host today. Each needs a C implementation in
`bend2/src/host/` and an entry in the effect table.

## Qualification

- A focused native test drives the listener against a loopback fixture server that
  implements the Messages event shape. The fixture reports usage, and the test
  checks the reserved maximum, the settled cost, the one-use authorization and the
  hold text for a second request while the first is active.
- No test calls the live provider. The live fallback exercise is a separate step.
  Its plan is approved in outline by the root and is recorded outside this
  repository; the exercise runs only after the native qualification passes.
- The guard stays false until the installed release passes this test and the
  root qualifies it.

## Implementation state

Written, not validated:

- `bend2/src/coordinator/credit-transport.bend` maps a request's admission to a reply.
  An admitted request is forwarded with its reserved total. A balance refusal
  (`promotionalCreditInsufficient` or `promotionalCreditExhausted`) is answered with the
  provider's credit-stop body. Any other refusal is answered with its reason, and never
  with the stop body.
- `bend2/test/credit-transport.bend` checks that mapping with exact string comparisons.

Not written:

- The loopback listener and the streaming forward (native host effects). The effect
  table and the streaming interface have not been read, so no native code is in the tree.
- The per-request I/O that builds the admission. It needs a request identity for each
  reservation row, because `credit_reservations.request` is the primary key, and the
  request charge from `credit_request_price`. Neither is decided here.

Validation: no check-only or build result exists for either file. The queue records for
the earlier check-only runs have no terminal result (see the report to the coordinator).

## Not in this change

- No change to `credit_guard_qualified`.
- No change to the Max subscription routes or to `subscription-fallback.bend`.
- No top-up, billing change or purchase.
