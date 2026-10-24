# Credit transport: native listener and forward design

Status: design only. No native code is in the tree. Nothing here is validated; no build
or check-only result exists for these choices. Parent design: `credit-request-transport.md`.

## The effect model

A host effect is a C file with a `CID_<NAME>` guard. Its `io_eff(CID, run, need)`
registers the effect, and a `.bend` host module imports the file with
`import "./<file>.c"` inside a `def` (`bend2/src/host/http.bend:7-14`, the
`Http.request` definition, imports `credit-transport.c`). The upstream guide describes
the runtime calls (`docs/bend2/reference/upstream/guide/EFFECTS.md:29-66`):

- `io_eff(CID, run, need)` registers the run function (line 32).
- `io_work(w, call, pack)` runs `call(w)` on a helper thread, then `pack(e, w)` on the
  loop. `call` has no `Env` and may touch only `w` (lines 56-59).
- `io_wait_on(w, fd, POLLIN, more)` parks until `fd` is readable and then runs
  `more(e, w)` on the loop (lines 59-61).
- The worked socket example is `bend2/compiler/upstream/effs/tcp_recv.c`. It keeps the
  socket non-blocking, parks on `EAGAIN`, and calls `io_sys_end` on each result.

`bend2/src/host/native-entry.c` is the process entry point (`baton2_runtime_main`). It
registers no effect and is not part of the effect table.

## What exists

- `bend2/src/host/credit-transport.c:12-128`: `CID_HTTP_REQUEST`, a buffered HTTPS
  request through libcurl. It returns the status and the complete body. It is used as
  `Http.request` (`bend2/src/host/http.bend:7-14`).
- `bend2/src/host/process-spawn.c:698`: `pidfd_open` for child-exit detection on Linux.
  No Darwin path was checked in this read.
- No loopback listener, accept, or socket read/write effect exists in `bend2/src/host`.

## Effects needed

| Effect | File | Mode | Inputs | Result |
| --- | --- | --- | --- | --- |
| `CID_LOOPBACK_LISTEN` | new `loopback-listen.c` | `io_done` | none | listener handle and bound port; bind on `127.0.0.1`, port 0 |
| `CID_LOOPBACK_ACCEPT` | new `loopback-accept.c` | `io_wait_on(POLLIN)` then `accept` | listener handle | connection handle, non-blocking |
| `CID_LOOPBACK_READ_REQUEST` | new `loopback-read.c` | `io_wait_on(POLLIN)`, parks on `EAGAIN` | connection handle | method, path, header text, body bytes; reads the head to `\r\n\r\n`, then `Content-Length` bytes |
| `CID_LOOPBACK_WRITE_RESPONSE` | new `loopback-write.c` | `io_wait_on(POLLOUT)` for partial writes | connection handle, status, headers, body | none; writes the response and closes |
| `Http.request` (existing) | `credit-transport.c` | `io_work` | method, url, headers, body | status and complete body |

The upstream forward uses `Http.request` unchanged, with `https://api.anthropic.com` as
the URL. Its headers are the child's headers without hop-by-hop fields, with `x-api-key`
set to the key held by the helper. The key is read from the owner-only secret file by
`api-key-exec` (`bend2/harness/api-key-exec.bend`, `file_secret` and `resolve`) and never
enters the child's environment.

Streaming is not in this design. The first version buffers the upstream response and
writes it back with `Content-Length`. The child waits for the whole response before it
receives bytes. A later design can replace `Http.request` with a chunked effect; that
effect would need a Bend-side callback per chunk, which the effect model does not state.

## Decision 1: reservation request identity

Choice: `request = attempt || '#' || n`, where `n` is the count of `credit_reservations`
rows that carry the same `attempt`. The attempt directory stays in the `attempt` column.

Source:

- `request` is the primary key (`bend2/src/coordinator/accounts.bend:465`). The key the
  schema defines is therefore `request`, and each per-request row needs its own value.
- The launch reservation writes `request` and `attempt` from one argument:
  `INSERT OR IGNORE INTO credit_reservations(request,session,attempt,...) VALUES(C.q(attempt),...)`
  (`accounts.bend:778`). A per-request key needs a separate `request` parameter on
  `credit_reserve_bounded_for` (`accounts.bend:834`) and on the insert at `:778`. That
  parameter is not written.
- A repeated key does not reserve again. A reserved row is admitted with its recorded
  maximum (`accounts.bend:771`, `CAdmitted` on `"reserved"`). A settled row is refused as
  `creditRequestSettled` (`:771`). A failed row is refused as `creditRequestFailed`. A
  replayed request therefore cannot forward a second time.

Consequences and limits:

- `n` is derived from the durable table, so no separate counter is stored.
- Two parallel requests must not compute `n` at the same time. The identity is assigned
  inside the single-threaded FIFO admission section that the listener runs. The FIFO
  queue is not implemented (see open points).
- After a crash the attempt ends with its harness. The `reserved` row stays counted until
  the attempt completion hook settles it. The funding design says a failed attempt keeps
  the reserved maximum counted (`docs/bend2/account-credit-funding.md`, "Continuation
  after a refusal" and the request-level reservation section). That is conservative and
  holds headroom until completion.

## Decision 2: request charge

Choice: the charge is `Priced{max_charge}` from `credit_request_price(facts)`.

Source:

- `CreditRequestPrice` is `Priced{max_charge}` or `PriceRefused{reason}`
  (`accounts.bend:894-896`). `credit_request_price` maps request facts to it
  (`accounts.bend:992`).
- `PriceRefused` refuses without a reservation. The existing launch path does the same
  through `credit_guard_refusal_status(reason)` (`accounts.bend:1715-1716`).
- The reservation for a request is `credit_reserve_bounded_for(..., max_charge)`
  (`accounts.bend:834`). The bound is the price, not the balance.
- At completion the usage fields of the buffered response are priced with
  `credit_price_tokens` (`accounts.bend:973`) and settled with
  `credit_settle_for(db, request, outcome, cost, allow_failed)` (`accounts.bend:877`).
  A failed request is settled with `allow_failed` and keeps its reserved maximum.

## Per-request wiring (Bend, not written)

1. `facts := credit_request_facts_for(db, body)` (`accounts.bend:1012`).
2. `price := credit_request_price(facts)`. `PriceRefused` is answered with
   `credit_guard_refusal_status(reason)`.
3. `request := attempt || '#' || n`, from decision 1.
4. `admission := credit_reserve_bounded_for(db, session, attempt, account, period, max)`
   with `request` as its new parameter.
5. `reply := transport_reply(admission)` (`bend2/src/coordinator/credit-transport.bend`).
   `Forward` goes to `Http.request`. `Hold` and `Refused` are written with their bodies.
6. On the upstream result: settle with the priced usage, or with `allow_failed`.

## Open points, not decided from source

1. Listener lifetime. The accept loop must stop when the child exits. `pidfd_open`
   (`process-spawn.c:698`) is Linux-only, and the Darwin path was not read. The options
   are a child-exit pipe written by the spawn path, a bounded accept timeout checked
   between accepts, or a signal. The choice needs the Darwin spawn path read first.
2. FIFO admission. The one-active refusal, `creditReservationInFlight` raised when
   `reservation_rows_active` holds (`accounts.bend`, `credit_reserve_decided`), still
   refuses a second request. The root's FIFO wait is not implemented.
3. Balance double count. Decision 2 does not change the balance rule. The open point
   recorded in commit `902de677` still applies to the bounded reserve.
4. Streaming. The buffered forward is the first version. Whether a chunked callback is
   possible under the effect model is not established.

## Test plan delta

Added to `transport-test-plan.md` in the state directory: the reply mapping cases
(`bend2/test/credit-transport.bend`), and a case that a replayed key with a settled row
is refused as `creditRequestSettled`. No case has run.
