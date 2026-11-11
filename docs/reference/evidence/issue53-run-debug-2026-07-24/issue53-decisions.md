# Issue #53 contract — the operator debug surface (v2)

(v2 folds the R53R red-team, verdict SOUND-WITH-FOLDS: R53R-1 the receipt read source is pinned
to per-worker stream reads scoped by the run's snapshot membership — the timeline mapping is
forward-only; R53R-2 the board leg is dropped (no worker-attributed board receipt stream
exists); R53R-3 the ban list becomes a JSON-key scan so 'stale_fence' survives as a value;
R53R-4 'bounded' is output-bounded only, with the read source named; R53R-5 the sanitization
citation is fixed and raw output frames are forbidden as a source; R53R-6 failure causes get a
per-source derivation table; R53R-7 authorization derives member set only from the run's own
snapshot; R53R-9 fixtures use adapter.emit injection; R53R-10 `code` = `result` for
scratchpad receipts and projections are whitelists, not blacklists.)

Ground truth: issue #53 (operator-filed from the demo campaign). Orchestrating and debugging
live runs requires JSONL archaeology today. Contract for a bounded, sanitized `run.debug()`
accessor + CLI verb answering the three everyday questions.

## Rules

1. **The accessor answers exactly three questions** per member: (a) what did the worker last
   say — the last N worker `content.message` texts; (b) did its writes succeed or refuse —
   the write-receipt ledger (`scratchpad.write_result` and decision/interaction rejections —
   the BOARD leg is dropped: workers have no board-write up-channel, so no worker-attributed
   board receipt stream exists, coordinator.mjs:9704-9731); (c) why did it fail — the
   terminal failure cause when present (`lifecycle.crashed` payload or the policy terminal
   event), derived per the table in rule 3.
2. **Bounded and sanitized, never raw — and whitelists, not blacklists.** Messages pass
   `boundedAttentionText` (application.mjs:258-273 — NFKC, whole-text redaction for
   SECRET_SHAPED_TEXT at :258-263, 4096-byte cap); the accessor applies it itself and NEVER
   reuses raw output-channel frames (those carry unredacted provider text,
   run-timeline.mjs:299-311). Receipts carry exactly `{kind, result, code, at}` — with
   `code` = `result` for scratchpad receipts and the `authority.rejected` reason for
   interaction rejections (raw receipt payloads carry banned internals like scratchpadFence
   and eventSeq, so the projection is a field whitelist). The failure cause carries `{kind,
   code, message}`: kind = the event kind; code = `typedTerminalCode` recomputed from the
   payload (durable — handle.terminalCause is in-memory); message = bounded `payload.error`
   or null (policy terminal events like model.mismatch carry no message — null is honest).
   No event seqs, no fences, no pids, no token/cost numbers, no provider internals.
3. **Shape and source.** `run.debug({ member?, limit? })` returns `{schemaVersion: 1, runId,
   phase, members: [{role, workerId, phase, lastMessages: [{at, text}], writeReceipts: [{kind,
   result, code, at}], failure: {kind, code, message} | null}]}`. `member` selects one role
   (default: all); `limit` caps lastMessages (default 3, max 10). Prose-free enums only for
   kind/result/phase. The read source is a DIRECT per-worker stream read
   (`driver.log.read(worker)`) filtered by `event.runId`/`event.taskId` against the run's
   coordination-snapshot member set — it works for historical runs (no backfill needed), and
   'bounded' means OUTPUT-bounded: the read is O(stream) once per member, matching existing
   stream discipline (log.mjs:54-139); the timeline mapping path is forward-only and NOT
   used for receipts.
4. **CLI parity.** `baton run debug RUN [--member ROLE] [--limit N]` prints the same object
   (the CLI's bounded outline form, not a raw dump). The embedded accessor and the CLI read
   the same projection.
5. **Authorization is the run's ordinary read authority.** `run.debug` registers as an
   `observe`-capability command authorized exactly like `run.inspect`
   (`Application._authorize('run.inspect', principal, runId, {})`, application.mjs:2872).
   The accessor adds no new visibility: the member set and worker binding derive ONLY from
   the run's coordination snapshot (role → task → assignee) — never from caller-supplied
   workerIds.

## Red-first tests — `impl/test/issue53-run-debug-red.test.mjs`

1. **R53-1 message accessor:** a mock run whose worker emits three messages returns exactly
   those three, bounded, in order (oldest→newest), with `limit` honored.
2. **R53-2 write receipts:** a run with a successful scratchpad write AND a refused one
   (stale integer) returns both receipts `{kind:'scratchpad.write_result', result:'written'|'stale_fence', code, at}` — `code` equals `result`; no fence value, no seq. Fixtures inject
   `content.message` / `scratchpad.write` through `adapter.emit` (the reflex1 pattern,
   impl/test/reflex1-decision-requests-red.test.mjs:149-154) — never via the store directly.
3. **R53-3 failure cause:** a crashed worker's debug entry carries `{kind:'lifecycle.crashed', code, message}` with the message bounded; a healthy member's `failure` is `null`.
4. **R53-4 no internals:** a JSON-KEY scan of the serialized object finds none of
   `seq|fence|scratchpadFence|expectedFence|eventSeq|pid|tokens?|cost|usd` as keys — while
   `stale_fence` survives as a VALUE (the ban list is keys, not strings).
5. **R53-5 CLI parity:** the CLI verb prints the same member receipts as the embedded call.
6. **R53-6 boundedAttentionText:** a message containing a SECRET_SHAPED_TEXT-shaped string is
   redacted, never carried verbatim.

Deterministic; MockAdapter fixtures; no live providers; fixed clocks.

## Verification

```text
node --test impl/test/issue53-run-debug-red.test.mjs
```

then the canonical suite fully green.
