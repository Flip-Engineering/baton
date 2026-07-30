# Issue #53 contract — the operator debug surface (v1)

Ground truth: issue #53 (operator-filed from the demo campaign). Orchestrating and debugging
live runs requires JSONL archaeology today. Contract for a bounded, sanitized `run.debug()`
accessor + CLI verb answering the three everyday questions.

## Rules

1. **The accessor answers exactly three questions** per member: (a) what did the worker last
   say — the last N worker `content.message` texts; (b) did its writes succeed or refuse —
   the write-receipt ledger (`scratchpad.write_result`, board receipts, decision/interaction
   rejections); (c) why did it fail — the terminal failure cause when present
   (`lifecycle.crashed` payload or the policy terminal event's code/message).
2. **Bounded and sanitized, never raw.** Messages pass `boundedAttentionText` (NFKC + byte
   cap) with `SECRET_SHAPED_TEXT` redaction; receipts carry only `{kind, result, code, at}`;
   the failure cause carries `{kind, code, message}` with the message bounded. No event seqs,
   no fences, no pids, no token/cost numbers, no provider internals.
3. **Shape.** `run.debug({ member?, limit? })` returns `{schemaVersion: 1, runId, phase,
   members: [{role, workerId, phase, lastMessages: [{at, text}], writeReceipts: [{kind,
   result, code, at}], failure: {kind, code, message} | null}]}`. `member` selects one role
   (default: all); `limit` caps lastMessages (default 3, max 10). Prose-free enums only for
   kind/result/phase.
4. **CLI parity.** `baton run debug RUN [--member ROLE] [--limit N]` prints the same object
   (the CLI's bounded outline form, not a raw dump). The embedded accessor and the CLI read
   the same projection.
5. **Authorization is the run's ordinary read authority** (the view's own principal checks);
   the accessor adds no new visibility — it projects what the caller may already read, shaped
   for debugging.

## Red-first tests — `impl/test/issue53-run-debug-red.test.mjs`

1. **R53-1 message accessor:** a mock run whose worker emits three messages returns exactly
   those three, bounded, in order (oldest→newest), with `limit` honored.
2. **R53-2 write receipts:** a run with a successful scratchpad write AND a refused one
   (stale integer) returns both receipts `{kind:'scratchpad.write_result', result:'written'|'stale_fence', code, at}` — no fence value, no seq.
3. **R53-3 failure cause:** a crashed worker's debug entry carries `{kind:'lifecycle.crashed', code, message}` with the message bounded; a healthy member's `failure` is `null`.
4. **R53-4 no internals:** the serialized object contains no `seq`, `fence`, `pid`, `token`,
   `cost`, or provider-frame fields (a string scan pins the ban list).
5. **R53-5 CLI parity:** the CLI verb prints the same member receipts as the embedded call.
6. **R53-6 boundedAttentionText:** a message containing a SECRET_SHAPED_TEXT-shaped string is
   redacted, never carried verbatim.

Deterministic; MockAdapter fixtures; no live providers; fixed clocks.

## Verification

```text
node --test impl/test/issue53-run-debug-red.test.mjs
```

then the canonical suite fully green.
