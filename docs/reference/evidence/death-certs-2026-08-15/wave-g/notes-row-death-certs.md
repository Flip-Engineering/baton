# ROW NOTES — wave-g row-death-certs (#225)

attempt: 04e62c4a-56bd-4fe5-9b6f-ea7365e2ba95 row-death-certs
harness: omp / model deepseek/deepseek-v4-flash / effort high
issue: #225 (closed contract read in full from the row brief — gh unauthenticated in worktree)

## Deliverable

Implementation + red-first pin suite `impl/test/death-certs-red.test.mjs`. Terminal events
(`lifecycle.process_closed`, `lifecycle.crashed`) now carry a structured death cert:

- `exitCode` / `signal` — the exact close tuple, when the latch observed one.
- `providerCauseStatus` / `providerCauseClass` (`4xx`-style HTTP status class) — when the
  adapter observed one (the `api_error_status` on the last failed provider result frame).
- `stderrTail` / `stdoutTail` — last 4KiB each, redacted at the emit seam through the
  sanctioned `boundedAttentionText` (SECRET_SHAPED_TEXT discipline); byte-capped at capture
  AND at emit, never unbounded, never a new event kind.
- The member's route tuple rides the same ledger events via the coordinator's existing
  `_routeAttribution` fold (taskId/runId/harnessRequested/harnessResolved/model*/effort*/routeKey).

Enrichment only: no clocks, no retries, no behavior change; close-fact payloads stay
byte-stable (`validProcessClosedPayload` exact-key shape untouched); absent facts are honest
`null`s.

## The hunt — where the close facts were lost (18:07Z cluster)

Pinned anchors verified at head: `ProcessCloseReapLatch.close()` (process-lifecycle.mjs)
captures the exact close tuple via `processClosedPayload(generation, pid, code, signal, ready)`
— the facts EXIST there and are handed to the retained terminal flush (`_closeDerived?.(this._closeFact)`).
The two adapter `onProcessClosed` emit sites (claude-session.mjs) emit the payload as-is.

Loss points found (three distinct layers):

1. **Adapter crash emission (the primary loss).** `_onClose`'s `closeDerived` emitted
   `lifecycle.crashed` with `error: \`exited ${code}${signal ? ` (${signal})` : ''}\`` — the
   close facts were STRING-INTERPOLATED into free text, never structured. A reader could not
   programmatically name which kill; the 18:07Z adapter-origin crashes therefore "landed
   envelope-only" at every surface that projected payload shape (`{worker, workerSeq, digest,
   kind, ts}` in `mapOperationalEvent`'s `evidence.mapped`, plus the coordinator log row whose
   crashed payload carried no exit facts).
2. **Coordinator `_handleEvent` fold.** Adapter events are reconstructed from a fixed field set
   (`appendAttributed({worker, harness, turnEpoch, kind, actor, payload})`); any adapter-carried
   top-level enrichment would have been DROPPED at the ledger fold. Fixed by preserving the
   adapter's `deathCert` verbatim on the folded `lifecycle.process_closed` and `lifecycle.crashed`
   events (`terminalDeathCert(event)` — never invented, re-derived, or re-ordered).
3. **Route tuple location.** `harnessResolved` lives at the COORDINATOR fold
   (`_routeAttribution(handle, task)`), never on the raw adapter envelope (the adapter knows only
   `harness`/`modelRequested`/`modelObserved`). The fold already merges it onto ledger terminal
   events — DC4 pins that it rides the same events as the death cert. `mapOperationalEvent`
   (`evidence.mapped`) is envelope-only BY DESIGN (digest binds the full operational event); it
   strips nothing — the digest now binds an event that carries the facts.

## Implementation (additive only)

- `impl/src/process-lifecycle.mjs` — doc contract on `ProcessCloseReapLatch.close()`: the
  close-derived callback is flushed with the EXACT close fact so terminal-cause emission
  structures exitCode/signal from it. No functional change (the wiring already existed).
- `impl/src/claude-session.mjs`
  - `byteTail()` capture helper; per-generation `stdoutTail`/`stderrTail` (bounded 4KiB raw at
    capture; `DEATH_CERT_TAIL_BYTES` aliases the registry-cataloged `MAX_ATTENTION_TEXT_BYTES`
    — no fresh byte literal, frame-economics F1 clean).
  - `_handleResult` records `api_error_status` (100–599) of the last failed result as
    `providerCauseStatus` (cleared on credential-refresh retry, per generation).
  - `_deathCert(session, closeFact)` builds the cert; redaction at emit via `boundedAttentionText`.
  - `_emit` gains an optional 4th arg; the two `onProcessClosed` sites, `closeDerived`, and
    `_onSpawnError` pass the cert on `lifecycle.process_closed` / `lifecycle.crashed` only.
- `impl/src/coordinator.mjs` — `terminalDeathCert(event)` preserved onto the folded
  `lifecycle.process_closed` / `lifecycle.crashed` ledger events (both `_handleEvent` cases).
- `impl/test/death-certs-red.test.mjs` — the pin suite (below).

## Red-first proof

- RED at pre-change head: 4/4 fail, every failure `terminal lifecycle.crashed must carry the
  death cert` / `folded ledger ... must retain the adapter death cert` (deathCert absent).
- GREEN after: 4/4 pass, stable across 4 runs.

## Pin suite (DC1–DC4)

Real `ClaudeSessionCli` + a per-run temp fixture (self-contained; no fixture edits, no quota):

- DC1 SIGKILL — crashed and process_closed name `signal: 'SIGKILL'`; tails bounded (≤4096 B),
  carry the last stderr/stdout markers, and REDACT the secret-shaped token (`[redacted]`,
  raw token never present).
- DC2 exit 137 — both terminal events name `exitCode: 137`, `signal: null`.
- DC3 provider 429 — fixture surfaces `api_error_status: 429` on a failed result then exits 137;
  both terminal events name `providerCauseClass: '4xx'` + `providerCauseStatus: 429` alongside
  the exit facts.
- DC4 coordinator ledger — through `createDriver` + external SIGKILL: the FOLDED ledger
  `process_closed`/`crashed` events retain `deathCert` AND carry the member route tuple
  (`harnessRequested === 'claude'`, non-empty `harnessResolved`, `taskId`, `routeKey`; `runId`
  null when unbounded, string when run-bound).

## Verification (at this head)

- Pin suite: 4/4 green (was 0/4 red). `node --test test/death-certs-red.test.mjs`.
- Coordinator battery `test/coordinator.test.mjs`: 58/58 green unchanged.
- Adapter suites green: claude-session 31/31, glm-session (batch), phase10-driver-e2e 4/4,
  phase11-model-selection + claude-credential-projection 24/24, decision-gate 3/3,
  issue28-wire-degrade 5/5, phase51-process-lifecycle + phase8-correctness 92/92,
  phase67-terminal-cause/signal-reap/route-attestation 22/22,
  transport-liveness-235 + reap-on-terminal + phase56 (except noted below),
  phase70-preserved-stop + phase57-adapter-wire-bounds 9/9,
  omp-first-turn/turn-verdict/policy-attest + wire-card-coverage 5/5,
  bidirectional-v3 + board-workerhalf 54/54,
  phase57-provider-callback-integrity/provider-governance/provider-turn-release + phase60 50/50,
  phase62-goal-plan-authority + phase79-plan-wave-replay + wave-driver-policy 23/23,
  quiescence-completion + stall-watchdog + semantic-progress 59/59,
  story + suite-hygiene 24/24 (surface-conformance/surface-audit-smoke: pre-existing only, below).

### Pre-existing failures at this wave head (verified IDENTICAL on the faithful baseline HEAD
### copy — `git archive HEAD` + node_modules symlink; none caused by this change)

- phase10.1-reconciliation SC18 "timeoutMs enforced" — the #163 wall-time-fate law removed the
  adapter wall clock; test not updated (red at baseline).
- phase11-control-integrity CI3 "driver-level wall timeout" — same #163 law; red + process hang
  at baseline and at this head.
- phase56-drain-and-close DC2-DC7 — red at baseline (38/38 baseline is 37/38, same test).
- frame-economics F1 — flagged list at this head is byte-identical to baseline
  (coordination-store ×2, omp-rpc ×2); the new bound aliases the cataloged constant so no new flag.
- surface-conformance SC6/SA2 — ledger-file canonicity state; identical at baseline.

## Judgment calls (recorded)

1. gh is unauthenticated in this worktree; the closed contract in the row brief (identical in
   wave-c..wave-f evidence) was treated as the binding issue #225 text.
2. The wavefile-style path scope lists three src files + wave-g docs; the brief's named
   deliverable `impl/test/death-certs-red.test.mjs` is new and additive (never edits an existing
   suite) — created per the contract, which is the acceptance authority.
3. Field names: `exitCode` (close tuple code) and `providerCauseClass`/`providerCauseStatus`
   (HTTP status class + raw status of the last failed request) — the class string (`4xx`) plus
   the raw status makes "which kill" nameable without ambiguity. process_closed payload keeps
   its exact-key `code`/`signal` (byte-stable; `deathCert` mirrors them as `exitCode`/`signal`).
4. Death cert rides the event TOP-LEVEL (`event.deathCert`), not inside process_closed's
   payload (exact-key validator) — uniform for both terminal kinds; the coordinator fold
   preserves it verbatim.
