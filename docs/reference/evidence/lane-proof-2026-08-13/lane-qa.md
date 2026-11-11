LANE-QA v1

[attempt: 9ab83d7f-a20a-40f3-acfd-7550ed95bfa4 coordinator]

Lane-proof coordinator QA — the lane-by-lane verdict from BOTH sides. Every claim below is
cited evidence (message ids, on-disk files, code anchors) or an explicitly named absence.
No clocks, no fabrication.

## Received-by-me log (my side of the wire)

| # | Lane | Kind | Message id / evidence | State |
|---|---|---|---|---|
| 1 | messageOnSpawn (steering→coordinator) | `brief` | `message:f011a2875e1e7376073edacc0b9e5cc4897fc273f5345c801c836edfab0a5295` | DELIVERED — body verbatim equals the workflow.json `messageOnSpawn.body` |
| 2 | message-kind (row-lane-messages→coordinator) | `query` | — | NOT RECEIVED |
| 3 | message-kind (row-lane-messages→coordinator) | `inform` | — | NOT RECEIVED |
| 4 | message-kind (row-lane-messages→coordinator) | `steer` | — | NOT RECEIVED |
| 5 | signalOnMembersDone (steering→coordinator) | `result` | — | NOT RECEIVED |

## Lane-by-lane verdict (both sides)

### L1 — messageOnSpawn (brief)
- Spec: workflow.json `steering.messageOnSpawn` = `{ kind: "brief", body: "Read your
  objectiveRef brief IN FULL first, then foundry-brief.md in the same directory (the lane
  laws bind you). This wave exists to USE the bidirectional lanes and produce evidence —
  record message ids and event seqs, or the verbatim refusal/absence. Your [attempt:] line
  goes verbatim in your report's first five lines." }`.
- My side: RECEIVED, message id `f011a2875e1e7376073edacc0b9e5cc4897fc273f5345c801c836edfab0a5295`,
  delivered with body matching the spec verbatim.
- **VERDICT: PROVEN** (the messageOnSpawn lane delivered to the coordinator).

### L2 — message-kind lane (query / inform / steer, row-lane-messages → coordinator)
- Spec: `row-lane-messages` sends THREE root messages — `query` "Which report sections do you
  want first?", `inform` "My lane-evidence draft is underway", `steer` (a QA-structure
  suggestion).
- Row side (on disk): **no `lane-messages.md` exists** in any sibling worktree or the main
  repo. The row never produced its report.
- Row provisioning (on disk): **no worktree for `row-lane-messages`** under `../../wt/ws-*/`
  (`git worktree list` shows only `ws-20b8c39e…` = row-lane-decision and `ws-91747fd…` = this
  coordinator); no deepseek-v4-flash process at the wave's spawn time.
- My side: none of query/inform/steer was received.
- **VERDICT: GAPPED** — the row never landed (no send, therefore no receipt). This is an
  absence of the row, not a send-then-undelivered gap.

### L3 — reply chain (coordinator → row-lane-messages)
- Spec: I reply to the query's message in the reply chain (the closed `{inReplyTo, body}`
  frame — `claude-session.mjs` `scanForMessageSend`), not a new message.
- My side: **could not reply** — no query arrived, so no parent `message:<sha>` id exists to
  `inReplyTo`. A reply minted against a fabricated id would be `message_parent_not_found`.
- **VERDICT: UNEXERCISED** — the reply chain has no parent to hang from (upstream of L2).

### L4 — DECISION_REQUEST lane (row-lane-decision → answerDecisions policy)
- Spec: workflow.json `steering.answerDecisions.policy` = `{ ".*[Pp]artition.*": "opt-shared" }`.
- Row side (verified on disk, `../../wt/ws-20b8c39e7d8a397905feada77c3146ee/docs/reference/
  evidence/lane-proof-2026-08-13/lane-decision.md`, attempt line
  `[attempt: 9ab83d7f-a20a-40f3-acfd-7550ed95bfa4 row-lane-decision]` — same wave salt):
  - Q1 (policy-matched): question "Which partition should the lane-evidence summary publish
    to?" → answered `DECISION_ANSWER: {"text":"opt-shared"}` (free-text branch — the request
    allowed free response). **outcome: answered**.
  - Q2 (un-matched): question "Should the lane-decision report include a redacted transcript
    appendix?" → NO answer; deferred. **outcome: deferred** (escalation record).
- My side: I am the remaining member, not the answerer — the interpreter's `answerDecisions`
  auto-applied the policy (`workflow-interpreter.mjs` `answerDecision`, lines 805-853); the
  steering-trail entries (`{trigger:'answerDecisions', outcome:'answered'|'deferred'}`) live in
  the wave receipt, which I could not read via the CLI (connection profile unavailable in this
  worktree).
- **VERDICT: PROVEN** — answered ×1 (`opt-shared`), deferred-parked ×1 (appendix question).
  Corroborated by the row's on-disk report plus the workflow.json policy; the exact
  steering-trail rows are coordinator-side and unreadable from here.

### L5 — note elevation (row-lane-messages doubt/plan → elevateWhenNotes)
- Spec: row-lane-messages publishes one `doubt` + one `plan`; `elevateWhenNotes` (kinds
  doubt/plan, maxEntries 20) elevates them.
- Row side: no report (row never landed).
- My side: no elevation observed.
- **VERDICT: UNEXERCISED** — upstream of L2 (the row that would publish the notes never ran).

### L6 — shared-publish (#158 negative test)
- Spec: attempt to publish a summary to the `shared` scratchpad partition; the channel audit
  says this is gapped because the kernel hardcodes `worker:<id>`.
- Code-level (verified this session): `coordination-store.mjs:14101` —
  `const scope = \`worker:${fields.workerId}\`;` — the write scope is HARDCODED to the worker
  partition; there is no path to a `shared` scope. The worker up-channel wire frame carries NO
  scope: `scanForScratchpadWrite` (`claude-session.mjs:103-118`) admits the closed
  `{entry, expectedFence, idempotencyKey}` shape only, and `coordinator.mjs` `writeScratchpad`
  (`:10790`) forwards `{runId, taskId, workerId, entry}` with no scope field.
- My side: I attempted to publish the lane-qa summary via a `SCRATCHPAD_WRITE` note. There is
  no typed refusal for a `shared` target — the request is silently admitted and lands in
  `worker:<id>`, never `shared`. The "exact refusal" therefore does not exist; the exact
  outcome is a silent scope hardcode.
- **VERDICT: GAPPED by construction** — #158 confirmed at the code level. Nothing can reach
  `shared` from the worker up-channel.

### L7 — signalOnMembersDone (#175 corrected semantics)
- Spec: workflow.json `signalOnMembersDone.roles = ["row-lane-decision","row-lane-messages"]`,
  message `{ kind: "result", body: "Both rows settled (you are the remaining member — pinned
  #175 semantics). Verify on disk per the #174 law, then write lane-qa.md per your brief." }`.
  The #175 correction: `roles` names the WATCHED rows; the remaining member (this coordinator)
  is the recipient.
- Code-level: `workflow-interpreter.mjs:739-741` — signal fires when every named role is
  terminal OR has no handle: `every(role => doneRoles.has(role) || !handles.has(role))`.
- My side: NOT RECEIVED. row-lane-decision is terminal (report + result pin on disk), yet no
  `result` message arrived.
- **FINDING (signal absent).** Because row-lane-messages never produced a worktree/process/report,
  I cannot distinguish on-disk between (a) the row having a run handle whose agent never
  started (so `doneRoles` never gains it and the signal never fires), or (b) a signal-delivery
  gap. Either way the corrected #175 path did not complete a full round-trip in this wave: the
  coordinator was never signaled. Recorded, not fabricated.

## Escalation

The disposition of the unprovisioned row (`row-lane-messages` — no worktree, no report, no
messages) is authority-class: I cannot decide alone whether the wave should conclude with the
message/elevation/reply/shared-publish lanes recorded GAPPED or wait for a row that has not
landed. Escalated via a real DECISION_REQUEST (question avoids the `.*[Pp]artition.*` pattern
so it defers to the top orchestrator rather than auto-answering `opt-shared`). See the wire
frame in my turn text.
