# #10 REGRESSION-FIX BRIEF — restore FP-05 + FP-18 without weakening the #10 suite

The #10 waiting-vocabulary implementation (applied, uncommitted in this tree — 6 files, +224)
passes its own suite 38/38 but BROKE two workflow-surface pins. Your job: restore both pins while
keeping `impl/test/issue10-waiting-vocabulary-red.test.mjs` fully green. ZERO weakening edits to
any suite — the fix is in the implementation.

## The two broken pins (read them fully)

`impl/test/workflow-surface-red.test.mjs`:
- **FP-05** (:637-656) — resolve-then-authorize: `run.message.receipt` with an unknown messageId
  and with a FOREIGN messageId must both refuse `application_unauthorized` with byte-identical
  messages, and no receipt field may cross before authorization. Today the facade answers
  `application_message_receipt_invalid` — a NEW validation firing BEFORE authorization, leaking
  receipt-existence to unauthorized callers.
- **FP-18** (:2101-2125) — `coordinator.messageRunId(messageId)` (the read-only authorization
  accessor) must resolve a just-sent message's target run through durable records (`run:l1`) and
  resolve unknown to null. Today it returns null for a LIVE message — the #10 diff's message-path
  change lost the durable-record lookup.

## Method

1. Read the two FP rows and their surrounding contract comments (Decision 4, the eight direct
   ports, the byte-stable table guard).
2. `git diff HEAD -- impl/src/coordinator.mjs impl/src/application.mjs` shows the uncommitted #10
   work — find where the message-send / message-receipt / messageRunId paths changed.
3. Restore the resolution order: AUTHORIZE FIRST (resolve-to-null ≡ forbidden ≡
   `application_unauthorized`, byte-identical either direction), receipt validity checks only
   AFTER authorization. Restore `messageRunId` resolving through the durable message records.
4. Keep the #10 spawn-refusal semantics intact — the `worker_spawning` typed refusal is a #10
   deliverable; it must fire on its own path without reordering the authorization law.

## Verify (from the repo root, ALL must pass, record the splits)

`node --test impl/test/workflow-surface-red.test.mjs` ·
`node --test impl/test/issue10-waiting-vocabulary-red.test.mjs` (38/38) ·
`node --test impl/test/bidirectional-v3-red.test.mjs`.

Edit ONLY `impl/src/**`. Campaign law: no clocks; NUL discipline (`grep -an`/`sed -n` on
`application.mjs` + `coordination-store.mjs`); sorted-key literals in ACTUAL sorted order;
`localeCompare` banned.
