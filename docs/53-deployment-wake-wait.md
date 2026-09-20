# 53 — the deployment wake wait: the root's own wake (issue #529)

Status: landed 2026-09-20 (design lead `ds-wake-lead`). The mechanism below is implemented in
`impl/src/wake-stream.mjs` (`WakeStream.wait`), `impl/src/web-northbound.mjs` (`GET /v1/wakes`
under `Accept: application/json` with `timeoutMs`), and `impl/src/application-cli.mjs`
(`baton deployment watch --timeout-ms`). Its suite is `impl/test/deployment-wake-wait.test.mjs`.
`docs/39-swarm-runtime.md` §"Waking the orchestrator" carries the operator-facing statement.

## 1. What already worked, and what was missing

The deployment wake stream derives every row of the closed wake-class table
(`WAKE_CLASS_TABLE`, `impl/src/wake-stream.mjs:120`) from the coordination ledger, with the cursor
being the ledger seq itself. Its landed consumer forms at HEAD `8a5c51df`:

| form | surface | shape at HEAD |
|---|---|---|
| push | `baton deployment watch --follow` | one JSON frame per line for as long as the attachment holds |
| push | `GET /v1/wakes` (SSE) | server-sent events, `Last-Event-ID` honored as `since` |
| push | loopback WebSocket binding (`attachWakeWebSocket`) | the same frames for clients that speak `ws://` |
| push | MCP `baton_wakes_subscribe` | `notifications/baton/wake` frames for the session's life |
| pull | `baton deployment wakes-since` (#507) | one bounded page, `baton.wake_page` |
| pull | MCP `baton_wakes_since` | the same page |

At swarm scope the runtime also carries a **bounded wait**: `swarm.watch` holds on the store's own
`waitAfter` and answers `watch {reason: 'event'|'timeout', afterSeq, matchedSeq, pendingSince,
event, events}` (`impl/src/swarm-runtime.mjs:4741`), which `baton swarm watch SWARM_ID
[--timeout-ms MS]` consumes. At the deployment scope a root agent watching every swarm the resident
hosts held that feed as a child process whose stdout it read, or polled the page with a loop of its
own; both arrangements are harness-side plumbing this issue names.

## 2. The mechanism

**One bounded call over the same stream, at the scope the root works at.**

- **Resident.** `WakeStream.wait(filter, {timeoutMs, signal})` pulls from the caller's cursor; on a
  pull that carries no frame it waits on `coordination.waitAfter` — the same store wait the push
  loop rides, never a busy poll — and loops until a frame lands or the deadline passes. The answer
  is the page `since` answers (the same `cursor`, `swarms`, `frames` and typed `lagged` marker) plus
  the reason that settled it:
  `{schemaVersion: 1, kind: 'baton.wake_wait', reason: 'event'|'timeout', cursor, swarms, frames,
  lagged}`. A caller re-arms by passing `cursor` back as `since`; no gap and no duplicate follow
  from the stream's own cursor rule. A stream that closed under the wait, and a wait aborted through
  its own signal, answer `timeout` — the caller's next call is refused by whoever owns the closed
  stream.
- **Transport.** `GET /v1/wakes?…&timeoutMs=N` with `Accept: application/json` serves the bounded
  read. The bound draws the ONE web wait ceiling (`web.wait_ceiling_ms`, 30 s): past it the route
  refuses `wakes_wait_timeout_exceeds_web_ceiling` (the `webWaitCeilingRefusalCode` family, scope
  `wakes`), a malformed bound refuses `wake_wait_invalid`, and a bound on the SSE attachment refuses
  `wake_wait_invalid` too — an attachment has no deadline, and a wait none of its consumers read
  would be silence. The plain page read (no `timeoutMs`) is unchanged.
- **CLI.** `baton deployment watch --timeout-ms MS [--wake-class CLASS,…] [--since SEQ]` is the
  bounded form; `--follow` is the feed, and the two are exclusive. The caller's bound is held in
  rounds of the web ceiling, each round re-armed from the answer's cursor (`waitDeploymentWake`), so
  a hold longer than one transport bound loses nothing; the resident's answer is printed verbatim.
  The bare `baton deployment watch` keeps its #507 refusal naming `wakes-since`, so the landed pin
  (`impl/test/issue507-wakes-since-cli.test.mjs:148`) stands.

The verbs and the filter vocabulary are unchanged: `--wake-class`/`--kinds` and `--since` come from
the stream's own parser (`parseWakeFilter`), and no new wake class is minted.

## 3. Boundaries of this landing

The MCP session keeps its landed wake forms (the subscription that rides the session's one
attachment, and the page). A bounded wait over MCP would add a field to a closed core-tool verb and
its own ceiling arm; it is recorded here as its own decision with its own review.

The `WakeStream.wait` primitive is deliberately reusable: the WebSocket binding and the MCP bridge
could serve it under their own ceilings without a second implementation of the wait.
