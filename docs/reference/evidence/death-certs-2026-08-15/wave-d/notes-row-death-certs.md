# ROW NOTES — row-death-certs (wave-d, 2026-08-15)

attempt: ca499bcb-aebc-462b-8afa-3139200458fc row-death-certs
Row: row-death-certs · Contract: issue #225 (closed, per row-death-certs-brief.md)
Deliverable: implementation + red-first pin suite `impl/test/death-certs-red.test.mjs`
Commit base: `da16e834` (fix(#233): restore TOOL_BY_NAME)

## The loss point (hunt result)

The 18:06-18:07Z cluster was ADAPTER-origin and landed envelope-only on the coordination
ledger. The loss chain, verified at this head:

1. **The adapter's crash emission strips the close tuple.** In `claude-session.mjs`
   `_onClose`, the OS close facts (`code`, `signal`) are present at emit time but the
   `lifecycle.crashed` payload carried only `{error, usageSeal}` (or `{error, code, phase,
   usageSeal}` — where `code` is a string failure code, never the exit code). No `exitCode`,
   no `signal`, no provider cause class, no output.
2. **`lifecycle.process_closed` DID carry the close tuple** (the latch's closeFact payload:
   `code`/`signal`/`ready` — `process-lifecycle.mjs:133` ProcessCloseReapLatch → `processClosedPayload`).
   What it lacked: the provider cause class and any output tail.
3. **The coordinator's `appendAttributed` reconstructs ledger events** from
   `{worker, harness, turnEpoch, kind, actor, payload}` and drops any adapter top-level
   extras — so even facts placed outside the validated payload were stripped at the ledger
   surface. The member's route tuple (`harnessResolved`, `modelResolved`, `effortResolved`,
   `taskId`, `runId`, …) is added by the coordinator at append time via `_routeAttribution`
   and DID ride — that half of the mapping was intact.
4. `_coordMapEvent` → `mapOperationalEvent` (coordination-store.mjs) folds every operational
   event to an envelope `{worker, workerSeq, digest, kind, ts}`. That fold is hard-coded
   envelope-only and lives in a file OUTSIDE this row's path scope (coordination-store.mjs is
   not in the allowed Path scope), so it is unchanged; its digest continues to anchor the full
   operational event byte-exactly via `_operationalRead`.

## Fix (enrichment only; three files in scope)

### impl/src/claude-session.mjs (adapter — the primary loss point)
- **Close tuple on `lifecycle.crashed`**: `_onClose`'s closeDerived now attaches
  `{exitCode, signal}` (the OS close tuple — null when the fact is absent) to every crashed
  payload, plus `causeClass` and the bounded tails.
- **Provider cause class**: observed on the wire without a new event kind —
  `result.api_error_status` (`_handleResult`) and `rate_limit_event.status`
  (`_handleWireObject` case, still never surfaced) → `session.providerCauseClass` (e.g. `4xx`).
- **Bounded tails**: `_onData`/`_onStderr` retain the last 4KiB per stream
  (`DEATH_CERT_TAIL_BYTES`), appended only AFTER the existing provider-secret checks pass
  (a secret-bearing chunk is refused, never retained); at attach time each tail passes
  `boundedAttentionText` (NFKC + SECRET_SHAPED_TEXT redaction + byte cap — the existing
  discipline from messages.mjs) plus verbatim configured-secret redaction.
- **`lifecycle.process_closed`**: payload stays the validated closeFact (byte-stable);
  cause class + tails ride TOP-LEVEL via `_emit(..., extra)` (both the primary spawn latch
  and the respawn latch).
- Spawn-error crashes carry only the facts that exist (cause class + tails, no fabricated
  exit); respawn resets the process-scoped tails.

### impl/src/coordinator.mjs (ledger preservation)
- `_deathCertEventExtra(event)`: validates and preserves adapter-surfaced top-level
  `causeClass` (`^[45]xx$`) and `stdoutTail`/`stderrTail` (string, >0, ≤4096 bytes, no NUL)
  onto the appended `lifecycle.process_closed` and `lifecycle.crashed` LEDGER events,
  alongside the existing `_routeAttribution`. Additive: absent/invalid values are dropped,
  payloads untouched.

### impl/src/process-lifecycle.mjs
- **Deliberately untouched.** The close tuple facts already exist here (the latch's
  closeFact) and flow on `process_closed`. Extending the closeFact key set is impossible
  without breaking the exact-key validator `validProcessClosedPayload` against the many
  existing suites that hand-build close payloads (phase51, phase56, phase84, phase91, …)
  — prohibited by "never edit an existing suite to pass". The pin suite therefore asserts
  the close tuple where it lives (payload `code`/`signal`) and the new facts on the
  surfaces they ride.

## Judgment calls (recorded)

- **CloseFact key set frozen** — enrichment for `process_closed` rides top-level; the
  validated payload shape is byte-stable (contract item 3).
- **Policy crash paths (coordinator.mjs:3567/3594/4203) not enriched** — all three fire
  pre-spawn (context_materialization, runtime_scope, spawn refused): at emit time NO close
  facts exist, and cross-generation lookup could attach a PREVIOUS generation's exit to a
  member that never ran — a fabricated fact. "When the fact exists" is honored by leaving
  them absent.
- **`evidence.mapped` envelope** (coordination-store.mjs) is out of Path scope; unchanged.
  The operational ledger (the stream the driver folds) now carries the facts; the envelope's
  digest anchors them byte-exactly.
- **`causeClass` naming**: HTTP status class as `Nxx` (e.g. `4xx` for 429) — the class of
  the last failed request, per contract item 1.

## Pin suite — RED/GREEN evidence (impl/test/death-certs-red.test.mjs)

- Adapter leg drives the REAL `ClaudeSessionCli` against an inline fake `claude` (temp dir
  at runtime; no repo fixture edits) — real child processes, real signals:
  - SIGKILL (external group kill): `process_closed.payload.signal === 'SIGKILL'`,
    `crashed.payload.signal === 'SIGKILL'`, tails bounded + present.
  - exit 137: `crashed.payload.exitCode === 137`, `process_closed.payload.code === 137`.
  - adapter-surfaced provider 429 (`rate_limit_event.status 429`): `crashed.payload.causeClass
    === '4xx'`, `process_closed.causeClass === '4xx'`, secret-shaped tail content redacted
    (`[redacted]`, raw token absent), every tail ≤ 4KiB.
- Coordinator leg: Coordinator + stub adapter → `process_closed`/`crashed` LEDGER events
  carry the close tuple, cause class, bounded tails, and the full route tuple
  (`taskId`, `harnessResolved`, `modelResolved`, `effortResolved`, `runId`).
- **RED at pre-change head (da16e834)**: 0/4 pass — every failure names the missing fact
  (e.g. `undefined !== '4xx'`). **GREEN after**: 4/4 pass. Verified by stashing the two
  source edits, running the suite (RED), restoring, re-running (GREEN).

## Regression batteries

- Coordinator/process-lifecycle/adapter core: coordinator.test.mjs, phase51-process-lifecycle,
  claude-session, adapter, cli-adapters, worker-policy, phase67-terminal-cause,
  phase67-signal-reap, phase57-adapter-wire-bounds — 256/256 green.
- Adjacent ledger suites (bidirectional-v3, phase11-persistent-sessions,
  phase11-control-integrity, phase45-session-auto-rejoin, phase56-drain-and-close,
  phase71-kimi-session, omp-rpc-red, cli-dead-paths-red, readiness-honesty-*,
  worker-delivery-push, codex-appserver, grok-acp, kimi-acp, glm-session,
  reap-on-terminal-red, transport-liveness-235) — green (see per-suite detail below).
- Full-suite head-vs-change failure diff: identical failure sets (pre-existing failures at
  head — e.g. phase72-native-kimi-integration KC1, phase84/85 CM-series — reproduce
  unchanged with the edits stashed); zero new failures introduced.
