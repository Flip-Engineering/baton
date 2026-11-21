# 56 — Coordinator steering: assignment-first standing text and the child digest on every wake

*Status: design and red tests, 2026-11-21. Issue: see the tracking issue linked in the PR.*

This document changes two things every Baton session already receives: the standing
instructions written at native launch (`receive.bend` `instructions()` and the `turn.bend` texts
it appends), and the pending-input notice written on every wake (`agent-guidance.bend`
`pending()`). Both are Baton's own text; no model writes either. The goal is that a coordinator
keeps each child on the unfinished part of its assignment, and that a child treats a result it
has shown as settled.

## 1. What happened on 2026-11-21

The flip orchestra's lead (`flip-lead-astra-20261121`, `gpt-6.2-astra`) and its #3221 coordinator
(`flip-3108-astra-20261120`, with about twenty recruited children) spent from about 04:30 to
11:00 PST without merging anything. The #3221 checklist stayed at 10 of 24 entries. The children
and both coordinators spent the time producing and re-reviewing evidence for one entry that was
already checked (frame counts, screenshot hashes, a second review of reviewed evidence). The
lead's operator reports relayed that evidence as progress, and the lead raised operator
questions for work it could do with its own access (a Dev User session, a Google test identity,
an OAuth test client). The Codex 7-day window ran out at 10:57 PST with the scope unbuilt.

Nothing in the orchestra recorded or showed this. Each coordinator saw only its next owed
message; nothing compared its children's activity with their assignments.

## 2. Where Baton's own text leads seats toward re-proof

Every session receives these strings; each one rewards accumulating proof:

| Location | Current text | Effect seen on 2026-11-21 |
|---|---|---|
| `receive.bend` `instructions()` | "On a child's completion request, review the work against its assignment and supplied evidence." | Coordinators reviewed evidence and asked for more of it before confirming. |
| `turn.bend` `task_instructions()` | "Keep unfinished work and outstanding qualification in your reports and project state." | Children kept an open-ended qualification backlog and worked it. |
| `turn.bend` `knowledge_instructions()` | "Preserve uncertainty and complete evidence" | Children recorded the same finding repeatedly with more evidence each time. |
| `agent-guidance.bend` `pending()` | One fixed line on every wake. | A coordinator woke with no view of its children's assignments or state. |

## 3. Changes

### 3.1 Standing instructions

The three strings are replaced. The rest of `instructions()` is unchanged.

`receive.bend` `instructions()`, the completion sentence becomes:

> On a child's completion request, check whether its assignment is met. Use completion-confirmed --to PLAYER when it is, or add --next TEXT to confirm and dispatch its next assignment together. When part of the assignment is unmet, use guide --to PLAYER --text TEXT to name that part. A result the child has shown once stays settled unless something has changed it since.

`turn.bend` `task_instructions()`:

> Carry out the coordinator-authorized assignment in full. Report what you finished and what remains unfinished. A result you have shown once stays settled; check it again only when something has changed that could break it. Direct operator instructions and explicit stops remain effective.

`turn.bend` `knowledge_instructions()`:

> Use baton knowledge to record and read scoped findings. Record a finding once, with the evidence that supports it and the limits of what it shows; baton help knowledge describes the actions.

### 3.2 The child digest

`agent-guidance.bend` gains `pending_for(db, session) -> IO(String)`. For a session with no open
child it returns exactly `pending()`. For a session with at least one open child it returns
`pending()` followed by the digest. Every path that writes the pending notice today calls
`pending_for` instead of `pending()`: `codex-inbox.bend` (both prompt builders) and every other
native wake path that writes `Guidance.pending()`.

**Open child.** A session whose `parent` is the coordinator, with no `session_stops` row, whose
latest message of kind `task`, `task-assignment` or `task-continuation` from the coordinator has a
higher `seq` than its latest `completion-confirmed` from the coordinator. Grandchildren are not
listed; each coordinator sees its own children.

**One line per open child**, built only from recorded rows:

- `PLAYER`, the model recorded on its session, and the first line of its open assignment
  (the body of that latest task message, first line, as stored), with the message id.
- `completion request ID waiting for you`, when the child's latest `completion-request` to the
  coordinator has a higher `seq` than the coordinator's latest `completion-confirmed` and latest
  `guide`/`guidance` to that child.
- `question ID unanswered`, when the child's latest `question` to the coordinator has a higher
  `seq` than every message from the coordinator to that child.
- `N new messages`, the count of messages from the child to the coordinator without a
  `message_reads` row for the coordinator.
- `held by usage until TIME`, when a `usage_windows` row for the child's harness and model has
  `used_fraction >= 1` and `resets_at` later than now (TIME in UTC, minute precision).

Lines with a waiting completion request come first, then lines with an unanswered question,
then the rest; ties keep session id order.

**Layout.** `pending()`, then a blank line, then `Your children's open assignments:`, then one
line per open child, then a blank line and the fixed paragraph. A child line is
`- PLAYER (MODEL): FIRST LINE [TASK_ID]` followed by `; MARKER` for each marker that applies, in
the order listed above, for example:

```
- flip-3221-pace-nov21 (gpt-6.2-sol): Build entry 14 pacing in both clients [7040120:task]; 4 new messages; held by usage until 2026-11-26 22:47 UTC
```

**The fixed paragraph** after the lines:

> These are your children's open assignments. Read each child's new messages against its assignment. Progress is an unfinished part of an assignment moving forward. When a child is re-checking settled work, waiting on something it or you can do, or working outside its assignment, a short guide naming the next unfinished part usually sets it right. Confirm completion requests whose assignments are met.

The digest states recorded facts and one paragraph of purpose. It makes no judgment about any
child; the coordinator reads the messages and judges. It has no project-specific measure: an
assignment is whatever the coordinator dispatched, in any domain.

## 4. What stays out

- Any numeric threshold or score. The digest lists state; it does not rate it.
- Project measures (merges, deploys, checklist counts). Assignments carry their own meaning.
- Model-written text inside Baton. Every word of the digest is either recorded data or the fixed
  paragraph above.
- Changes to message kinds, verbs, delivery order or the read model.

## 5. Tests (red before the change)

`bend2/test/coordinator-digest.bend` with `bend2/test/coordinator-digest.py`, in the shape of
`pending-guidance-replay`: the probe seeds a scratch orchestra with `Store.ensure_before_begin`
and prints `NAME:ok` per check.

1. `leaf unchanged`: a session with no children gets exactly `pending()`.
2. `open child listed`: a child with an open task is listed with its model, the first line of
   the task body and the task message id.
3. `confirmed child omitted`: a child whose latest `completion-confirmed` follows its latest task
   is not listed.
4. `continuation reopens`: a `task-continuation` after a `completion-confirmed` lists the child
   again with the continuation's first line.
5. `stopped child omitted`: a child with a `session_stops` row is not listed.
6. `grandchild omitted`: a child's child is not listed in the grandparent's digest.
7. `waiting completion request`: a `completion-request` with no later confirm or guide shows
   `completion request ID waiting for you`, and that line sorts first.
8. `answered completion request`: a `guide` after the request removes the waiting marker.
9. `unanswered question`: a `question` with no later message from the coordinator shows
   `question ID unanswered` and sorts after waiting requests.
10. `new message count`: three child messages with one `message_reads` row show `2 new messages`.
11. `usage hold shown`: a `usage_windows` row for the child's harness and model with
    `used_fraction` 1.0 and a future `resets_at` shows `held by usage until` with that time.
12. `usage hold elapsed`: the same row with a past `resets_at` shows no hold.
13. `paragraph present`: a digest with at least one line ends with the fixed paragraph, once.
14. `standing text`: `instructions()` no longer contains "supplied evidence",
    `task_instructions()` no longer contains "outstanding qualification",
    `knowledge_instructions()` no longer contains "complete evidence", and each of the three
    contains its replacement sentence from §3.1.

An integration check in the same Python file builds the Codex inbox prompt for a seeded
coordinator through `codex-inbox.bend` and asserts the digest header appears in it, and builds it
for a leaf session and asserts the prompt equals today's.

## 6. Seam map

| Change | File |
|---|---|
| `pending_for`, digest SQL, fixed paragraph | `bend2/src/coordinator/agent-guidance.bend` |
| Completion sentence | `bend2/src/coordinator/receive.bend` `instructions()` |
| Task and knowledge texts | `bend2/src/coordinator/turn.bend` |
| Notice call sites | `bend2/src/coordinator/codex-inbox.bend` and every other caller of `Guidance.pending()` |
| Probe and test | `bend2/test/coordinator-digest.bend`, `bend2/test/coordinator-digest.py` |
