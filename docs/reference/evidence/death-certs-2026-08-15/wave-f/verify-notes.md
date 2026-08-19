# VERIFY NOTES — death-certs-2026-08-15 wave-f (#225) — coordinator

[attempt: 0b33aaa7-ea7b-43d8-83d3-26a0d2b6c890 coordinator]
Verdict: FAIL — the row's deliverable does not exist. Not accepted.
DEATH-CERTS-VERIFY v1. Acceptance authority: the red-first pin suite the row names, run green
at the row's HEAD, plus the coordinator battery unchanged.

## Verdict

**FAIL / NOT ACCEPTED.** The implementation row (row-death-certs) produced no deliverable:
no implementation commit, no red-first pin suite, no row notes, no wave-f artifacts. The
acceptance authority is unsatisfiable as dispatched: the pin suite it names
(`impl/test/death-certs-red.test.mjs`) does not exist in the tree or in any ref, so it cannot
run green at the row's HEAD (there is no row HEAD beyond base). A row re-drive is required.

## Measurements cited verbatim (from the coordination ledger, 2026-08-14)

- 18:06:51-18:07:00Z: 11 lifecycle.crashed events, every one envelope-only
  {worker, workerSeq, digest, kind, ts} — zero cause payload.
- All-time: 453 lifecycle.process_closed ledger rows, none carrying a cause-class field
  at the LEDGER surface (the latch's closeFact may hold it — the mapping is the suspect).

Both remain TRUE at this HEAD (verified below): the ledger surface still carries zero cause
payload. The enrichment did not land.

## Evidence (all verified in this worktree, read-only)

### 1. Base and tree state
- HEAD: `1f0f1495` ("fix(#236): quiescence counts tool execution as activity") — the wave-f
  base is the wave-e base `9195d45d` plus the quiescence fix. No further commits.
- Working tree clean (`git status --porcelain` empty). Branch `baton/ws-1492ca…`.
- origin/master == `1f0f1495`. No ref anywhere carries a row commit.

### 2. The row's deliverable is absent — every possible location checked
- No `docs/reference/evidence/death-certs-2026-08-15/wave-f/` on disk before this file.
- No `impl/test/death-certs-red.test.mjs` — the red-first pin suite the row brief names
  (red-first pin: "kill a member three distinguishable ways (SIGKILL; exit 137-style code;
  adapter-surfaced provider 429) and assert the terminal event NAMES WHICH") — on disk or in
  any commit (`git log --all -S` and path scans across all refs).
- No `notes-row-death-certs.md` (the row's report file) anywhere in the tree or history.
- All 9 baton worktrees (this wave's dispatch batch, created 00:57–00:59Z 2026-08-19, all at
  base `1f0f1495`) are clean — zero uncommitted bytes in any of them; no sibling branch has a
  commit beyond base. No in-flight row edits exist.
- No hub peers; no "row settled" signal was delivered to this coordinator. The row never
  settled.
- Campaign history: five prior waves (wave-a 08-14, wave-b, wave-c, wave-d, wave-e 08-15)
  likewise produced neither verify-notes.md nor notes-row-death-certs.md anywhere — this row
  is a re-drive of a deliverable that has never landed.

### 3. Source state at the pinned anchors — pre-change, matching the brief
- `impl/src/process-lifecycle.mjs` `ProcessCloseReapLatch.close(code, signal, ready)` still
  captures the tuple into `_closeFact` via `processClosedPayload` (which carries `code`/`signal`).
  The exit facts EXIST at the latch — as the brief asserted.
- `impl/src/claude-session.mjs` `onProcessClosed` (~:818) forwards the latch payload to
  `lifecycle.process_closed`, but the crash paths (:1548-:1553, :1577) still emit envelope-only
  `{ error, usageSeal }` — the 18:07Z adapter-origin shape, unchanged.
- `impl/src/coordinator.mjs` POLICY crash paths (:3593-:3596, :3620-:3622, :4230+) still carry
  `payload:{phase,error[,code]}` — no exitCode/signal/route tuple added.
- `impl/src/coordination-store.mjs` `mapOperationalEvent` (:12805-:12816) — the brief's named
  suspect — still maps to the envelope `{ worker, workerSeq, digest, kind, ts }` at the LEDGER
  surface. The full operational event (with its payload) is not surfaced; only its digest links
  it. **The loss point is confirmed unfixed.**
- `impl/src/omp-rpc.mjs` `_onClose` (:673-:677) carries `exitCode`/`signal` natively — but this
  predates the wave (`cfdb593e`, feat(#228) adapter creation); it is not a wave-f deliverable
  and covers only the omp adapter, not the claude-session/ledger path the brief measures.

### 4. Acceptance authority assessment
- Conjunct 1 (pin suite green at the row's HEAD): NOT SATISFIABLE — the suite does not exist
  and the row produced no HEAD.
- Conjunct 2 (coordinator battery unchanged): trivially true only in the sense that no source
  change exists to change it; with no row commit it cannot evidence any implementation.
- Overall: FAIL. No part of the closed contract (#225: exitCode/signal/route/cause on
  process_closed + crashed at the ledger; bounded 4KiB stderr/stdout tail; red-first pin suite)
  is met.

## Judgment calls
- Authority classes were unambiguous per the coordinator brief ("Do not edit source yourself.
  The row does. You read, verify, report."), so no DECISION_REQUEST was raised: the missing
  deliverable is an objective fact, and implementing the feature in the row's place would
  exceed the verifier role. The disposition — FAIL + row re-drive — follows directly.
- I did not wait indefinitely for a settle signal: all 9 worktrees were idle/clean minutes
  after dispatch, no peer existed, and no signal arrived; an unbounded wait cannot produce
  evidence that does not exist.
- The deployment verification command (`true`, argv [], exit 0) is the harness contract and is
  orthogonal to the honest verdict above; this report is the deliverable.

## Required follow-up
- Re-dispatch the implementation row at this base (or later base) with the same row brief.
  Acceptance authority for the re-drive is unchanged: the pin suite it names, green at its
  HEAD, plus the coordinator battery unchanged.
