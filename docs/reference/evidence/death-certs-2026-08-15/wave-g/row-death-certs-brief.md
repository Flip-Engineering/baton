# ROW BRIEF — row-death-certs: terminal events carry the death cert (#225)

Deliverable: implementation + red-first pin suite. Issue #225 is the contract; read it first.

## Pins (verify each at YOUR head; line numbers may have drifted — re-anchor by symbol)

- impl/src/process-lifecycle.mjs:133 ProcessCloseReapLatch — close() captures
  processClosedPayload(generation, pid, code, signal, ready): the exit facts EXIST here.
- impl/src/claude-session.mjs:819 and :1248 — the two onProcessClosed emit sites.
- impl/src/coordinator.mjs:3567, :3594, :4203 — POLICY crash paths that DO carry
  payload:{phase,error,code}. The 18:07Z cluster was ADAPTER-origin and landed envelope-only.
- Hunt the exact loss point: the adapter's crash emission (claude-session crash paths) and
  the coordinator/driver ledger mapping (_coordMapEvent / driver.recorded fold) — which layer
  strips the close facts, and where does the route tuple (harnessResolved) live at emit time.

## The contract (closed)

1. lifecycle.process_closed and lifecycle.crashed ledger events carry, when the fact exists:
   exitCode, signal (the close tuple), the member's route tuple, and — when the adapter
   observed one — the provider cause class (HTTP status class of the last failed request).
2. A bounded stderr/stdout TAIL rides the terminal event: last 4KiB each, redaction class
   per the existing SECRET_SHAPED_TEXT discipline; never unbounded, never a new event kind.
3. No clocks, no retries, no behavior change: enrichment only. Terminal semantics byte-stable.
4. Red-first pin suite impl/test/death-certs-red.test.mjs: kill a member three
   distinguishable ways (SIGKILL; exit 137-style code; adapter-surfaced provider 429) and
   assert the terminal event NAMES WHICH. RED at pre-change head, GREEN after.

## Hard bounds

- No new commands/registry/MCP surfaces; no NUL edits outside the touched files; never edit
  an existing suite to pass; additive hunks only.
- Coordinator battery (58/58) green unchanged; adapter suites green.
