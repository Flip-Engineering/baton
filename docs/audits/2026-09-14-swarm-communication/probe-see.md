# probe-see — what a swarm participant can SEE

Participant `probe-see` in swarm `audit-comm` (parent `suborchestrator`, permissions
`read`, `communicate`, `contribute`), 2026-09-14, 04:33Z–04:40Z.
All timestamps are UTC and come from the commands themselves unless marked otherwise.
Raw captures are in `docs/audits/2026-09-14-swarm-communication/evidence/`.
No source file was changed; this report and its evidence are the only writes.

Method: every claim below comes from an executed `node "$BATON_SWARM_CLIENT" <command>` call
(plus two background `swarm.watch` processes timed with millisecond stamps), or from reading the
audited runtime's own source, which is marked as such.

---

## 1. My own seat (`swarm.view`)

First call of my session returned `cursor: 1692`, 3 participants (`suborchestrator`,
`probe-see`, `probe-say`), `groups/work/assignments/context/contributions/reviews` all `{}`,
`attention: []`, and:

```json
"caller":  {"participantId": "probe-see", "permissions": ["read","communicate","contribute"]},
"availableActions": ["swarm.view","swarm.watch","swarm.guide","swarm.capture","swarm.check","swarm.update"],
"updates": ["swarm.context_updated","swarm.contribution_recorded","swarm.participant_left"],
"actionTargets": {"swarm.capture":{"participantIds":["probe-see"]},"swarm.check":{"participantIds":["probe-see"]}}
```

What the unscoped view shows is **everything in the swarm**, not my slice: every participant row
with its full `role` text, `permissions`, `parentId`, `runId`, `bindings` (`workerId`, `taskId`),
`runtime` (`{"workerId":"w-4","state":"working","turn":"running"}`), `delegation`, and `native`
(`{"coverage":"observed_only","agents":[],"invocations":[],"unidentified":[]}`); every work row with
`objective/status/version/actor/seq/ts` and derived `evidence`; every assignment; every context entry;
every contribution and review; all groups; all attention rows.

Two consequences worth naming:

- **Role text is swarm-wide.** From my seat I can read the suborchestrator's brief (3481 chars),
  which includes the root orchestrator's instructions — verified by
  `view.participants[suborchestrator].role.includes("Claude session") === true` — and probe-say's
  brief (911 chars). Nothing in the domain hides a peer's role, permissions, run or worker identity,
  or the parent plan published as shared context.
- **`availableActions` is not a per-event whitelist.** It advertises `swarm.update` for me, but the
  events I may write are `updates` only. Attempting `{"event":"swarm.work_updated"}` refused
  (stderr, rc 1, `idempotencyKey=aa4861de-3b28-44e2-a069-50ee18bb89a8`):

  ```json
  {"ok":false,"error":{"message":"This swarm has not granted organize authority to this participant",
   "code":"swarm_permission_required","detail":{"permission":"organize","participantId":"probe-see"}}}
  ```

My own seat was only visible as *mine* because `caller` names me. `delegation` is a per-participant
field: at 04:36:03.876Z mine read `{"children":[],"work":["work-see"],"complete":false}`. Earlier, at
recruitment time, it read `complete: true` with `work: []` — a vacuous "complete" that a worker
could misread as "my part is finished".

**Contributions and work evidence.** Publishing my finding returned the refreshed view with the
contribution row `contribution-d509edb8a67faf71e6ef553f2ffa2e20` (`participantId: probe-see`,
`workId: work-see`, my `body` verbatim, `"seq": 2040, "ts": "2026-09-14T04:40:39.446Z"`), and in the
same response `work-see.evidence` became
`{"contributions":["contribution-d509edb8a67faf71e6ef553f2ffa2e20"],"accepted":[],"derivedComplete":false}`.
A worker therefore *can* watch its own product land, attributed and linked to its work unit.

The review was just as visible once it existed — and nothing told me it existed. Polling three
minutes later showed my contribution accepted (`seq: 2080, "ts": "2026-09-14T04:41:48.958Z"`):

```json
{"reviewerId":"suborchestrator","decision":"accept","reason":"Verified: file exists at probe worktree ws-31468b49 docs/audits/2026-09-14-swarm-communication/probe-see.md with evidence/; its attention-row capture matches the row I observed at watch 04:39:04Z verbatim; subtree/context-scoping and refusal texts reproduced consistently with my own calls. Worktree-split finding is a real communication gap (probes did not share my checkout).","actor":"swarm-native:audit-comm:suborchestrator","seq":2080,"ts":"2026-09-14T04:41:48.958Z"}
```

and `work-see.evidence` flipped to
`"accepted":["contribution-d509edb8a67faf71e6ef553f2ffa2e20"], "derivedComplete":true`. Two things
this exposes: the swarm stores my *body*, never the file (the reviewer verified `probe-see.md` by
reading my worktree out of band), and an accepted work unit reports `derivedComplete: true`, so a
worker can know the swarm considers its part done even though no verb ever says "your work is
finished". The reviewer's own watch at 04:39:04Z saw the same attention row I captured in §3 —
an independent cross-check of that finding.

## 2. Subtree view (`swarm.view` with `participantId`)

Captured 04:36:30.788Z → 04:36:33.860Z (`evidence/02-subtree-*.json`):

| scope | participants | work | context | caller |
|---|---|---|---|---|
| `suborchestrator` | all 3 | `work-see`, `work-say` | all keys | me (`probe-see`) |
| `probe-say` (sibling) | `probe-say` | `work-say` | all keys | me |
| `probe-see` (me) | `probe-see` | `work-see` | all keys | me |
| `nobody-here` | rc 1 | — | — | — |

- Scoping is a **lens, not an authority boundary**. I could read my sibling's subtree by naming it,
  and I already had the same rows from my unscoped view. `caller` and `availableActions` stay *mine*
  in every scoped read.
- `context` is **not scoped**: a scoped read still returns every shared-context key, including keys
  written by participants outside the scope.
- In my own scope, my assignment appeared as a domain row:
  `assignment-probe-see → work-see`, `"seq": 1738, "ts": "2026-09-14T04:36:02.911Z"`, written by
  `swarm-native:audit-comm:suborchestrator` — the only place the swarm ever told me what I am for.
- Unknown scope refuses on **stderr**, rc 1:
  `{"ok":false,"error":{"message":"Participant is unavailable in this swarm","code":"swarm_participant_not_found","detail":{}}}`

## 3. Attention rows

In a healthy swarm `attention` is `[]` — every view I took while nothing was in flight returned
`[]`. The population is narrow (source: `impl/src/swarm-runtime.mjs:300-309`): unconfirmed
operations (`driver.recorded` / `swarm.operation_requested` with no `${key}:completed`) plus three
organizational anomalies (`delegation_orphaned`, `assignment_holder_gone`,
`closed_with_live_participants`). It is **not** a personal queue: nothing marks "you have mail".

I caught one live, and it is the most instructive row in this audit. Two watches started at
04:38:51.33Z woke 13.44 s later on the same event — another participant's in-flight `swarm.guide` —
and the view they returned carried this row (`evidence/w3-long-sibling-watch.json`, cursor 1967):

```json
{"kind":"operation_unconfirmed","command":"swarm.guide",
 "request":{"participantId":"suborchestrator",
   "message":"probe-say (audit-comm): for probe-say.md, please record which of my utterances woke you via your watch — (1) swarm.work_updated open work-say-probe 04:36:29Z, (2) swarm.assignment_updated assignment-say-probe active 04:36:59Z, (3) swarm.holder_released refusal 04:37:10Z, (4) swarm.context_updated notes:say-probe 04:37:22Z, (5) swarm.work_updated version_conflict refusal 04:37:58Z, (6) swarm.work_updated status-only v2 04:37:59Z, (7) swarm.assignment_updated release 04:38:00Z, (8) swarm.recruit refusals 04:37:58Z and this minute. Reply via swarm.guide to probe-say or a context note; I will quote you verbatim.",
   "swarmId":"audit-comm","idempotencyKey":"90b21c94-9361-4d5f-a065-4177233d0b56"},
 "state":"in_progress","code":null}
```

Two findings fall out of it:

1. **An in-flight operation leaks its whole request to any reader.** Probe-say addressed the
   suborchestrator; I — a third party with only `read` — read the message body, its target and its
   idempotency key verbatim, because a watch that wakes on `swarm.operation_requested` returns a
   view built while the row is still `in_progress`.
2. **It is fleeting.** The next view (`cursor: 1980`, moments later) returned `attention: []`. There
   is no verb to acknowledge, clear or inspect a row; it disappears only when the operation
   completes — and by the same token, an operation that errors *after* its request was recorded
   would leave a permanent row (`code` set from `swarm.operation_unavailable`,
   `impl/src/swarm-runtime.mjs:144-157`) that nobody can dismiss.

Refusals that happen *before* the operation is recorded leave nothing: a permission refusal
(`_permit`, `swarm-runtime.mjs:518`) and the live-holder refusal
(`swarm_holder_live`, `swarm-runtime.mjs:443-445`, thrown before `_once`) produce no attention row,
which is why my many refused writes never showed up in `attention`. Also,
`operation_unconfirmed` rows bypass scope filtering entirely
(`swarm-runtime.mjs:312`), so a scoped read of any participant still exposes the whole swarm's
in-flight operations (source-read, not observed).

## 4. Guidance: how a `swarm.guide` actually reached me

I published the requested note at 04:36:16.856Z (`context` key `notes:probe-see-guide-request`,
body the literal string `"guide me"`, `version: 1`, `actor: swarm-native:audit-comm:probe-see`,
`seq: 1767`; call window 04:36:16.427Z → 04:36:16.890Z). At 04:37:09.447Z I also guided the
suborchestrator myself; that call was accepted —
`{"participantId":"suborchestrator","result":{"ok":true,"result":"ok","emulated":false}}` —
so a child guiding its parent needs no special authority, only `communicate`.

The suborchestrator's guidance arrived **inside my running turn**, as a mid-turn user interjection,
verbatim:

```
<system-notice>
User interjection during work: priority; supersedes conflicting prior instructions. Re-read; ensure current work reflects user intent.
</system-notice>

Guide received path test: this is the swarm.guide you asked for after your "guide me" note (your seq 1767 note surfaced to me as a queued user message at ~04:37Z). Continue: audit your view, the subtree view (swarm.view with participantId suborchestrator), attention rows, and watch wakes; describe verbatim how this guidance reached you and when; then write probe-see.md and contribute naming it.
```

What that form does and does not carry:

- It **preempted work in flight**: the two tool calls I had just issued were cancelled by the
  harness (`Skipped due to queued user message`). A guide is not a passive notification; it can
  cut a turn's current action.
- It is framed as a **user** interjection, not as swarm guidance. Nothing in the envelope names the
  sender, the swarm, a message id, or a timestamp; only the body text ("this is the swarm.guide you
  asked for") reveals what it is. Had the body been ambiguous, I could not have distinguished
  guidance from a human operator instruction.
- The sender-side receipt is equally thin: `{"ok":true,"result":"ok","emulated":false}` says a
  delivery path was used, never whether it landed in a running turn, was queued, or was read.
  There is no acknowledgement, no reply address, and no read state on either side.
- **It left no trace I can see.** Searches over a full `swarm.view` after delivery:
  `JSON.stringify(view).includes("Guide received path test") === false`; `attention` was `[]`
  before and after; no context entry, contribution or review records it; a watch never wakes for a
  guide *as a message*. The only ledger hint is that the delivery is an operation: two
  `driver.recorded/swarm.operation_requested` pairs (seq 1851→1853 and 1865→1867) fall in the
  delivery window, but the wake names no command, actor or content.
- **When did it arrive?** I can only bound it. The message was queued between my last pre-interjection
  observation (a view that still reported `cursor: 1841`, i.e. before `seq 1846` was written at
  `04:37:22.213Z`) and my first post-interjection stamp (`04:37:41.067Z`). A recipient of swarm
  guidance cannot date it better than that without re-deriving it from the ledger.

### 4b. Second sample: the root orchestrator's own guide (04:42Z)

While I was blocked on the verification run, the **root orchestrator** — not a participant — sent a
second guidance message, and it arrived in the identical envelope:

```
<system-notice>
User interjection during work: priority; supersedes conflicting prior instructions. Re-read; ensure current work reflects user intent.
</system-notice>

Root orchestrator here (Claude, watching from outside through swarm watch --follow and the coordination log). This answers your "guide me" note (seq 1767). I first sent it through the MCP surface (baton_swarm_guide over the resident bridge) at 04:39:35Z and the bridge refused it with a bare forbidden, so this copy comes through the CLI. If you are still working, add to probe-see.md: (1) the wall-clock time this reached you and how you noticed it; (2) whether anything tells you it came from the root rather than from the suborchestrator; (3) what your own view shows about the root at all. Then finish as planned.
```

Answering the three questions with what the swarm surfaces actually gave me:

1. **When it reached me / how I noticed.** It preempted my next step while I was blocked in `hub wait`
   on the verification suite; my first wall-clock reading afterwards is `04:42:42.091Z`. The only
   operation pair in that window is `seq 2111 driver.recorded/swarm.operation_requested` →
   `2113 …/swarm.operation_completed` — visible to me only as a seq, a class and a payload kind. How I
   noticed it: a new user turn appeared between tool calls carrying the `system-notice` interjection
   banner; no view, watch or attention row announced it.
2. **Does anything say it came from the root?** No. The envelope has the same shape as the
   suborchestrator's guide — same banner, same "user interjection" framing, no sender, no timestamp,
   no swarm id. The only evidence is the body text asserting it: unauthenticated prose I cannot
   verify from any surface I can read. A participant that did not trust that sentence could not act
   on it differently from any other interjection, and any participant holding `communicate` could
   mint an identical frame.
3. **What my view shows about the root.** Exactly one string: `swarm.actor =
   "web:local-owner:31a271a5-3316-4246-88a7-9fde081767a4"` on the swarm row (`seq: 1565, "ts":
   "2026-09-14T04:33:37.406Z"`) and the same value as the `actor` on the suborchestrator's membership
   row (`seq: 1582, "ts": "2026-09-14T04:33:46.217Z"`). It is not a participant: no permissions row,
   no attention row, no runtime state, nothing saying it watches. The root's report that its MCP guide
   was refused is **invisible from inside** — nothing is recorded for a refusal that happens before an
   operation is recorded (§3), and a ledger walk over that window found no operation rows at all.

## 5. `swarm.watch` wakes and their timing

Measured (background watches started with millisecond stamps; results in `evidence/`):

| # | call | result | measured |
|---|---|---|---|
| B | `afterSeq=1921, timeoutMs=4000` | `"reason":"timeout"` | 4.432 s (04:38:15.657Z → 04:38:20.089Z) |
| W2 | bg `afterSeq=1921, timeoutMs=60000`, then I wrote one context entry | `"reason":"event"`, `matchedSeq:1922`, `{"seq":1922,"kind":"swarm.context_updated","payloadKind":null}` | woke at 04:38:22.048Z; my write returned 04:38:22.053Z — the wake was coincident with the write, ~0.75 s end-to-end including my own client call |
| W1 | bg `afterSeq=1818, timeoutMs=180000` | `"reason":"event"`, `matchedSeq:1823`, `{"seq":1823,"kind":"driver.recorded","payloadKind":"swarm.operation_requested"}` | woke 0.67 s after start; the event was **my own** `swarm.guide` call |
| W3/W4 | bg, both `afterSeq=1956`, started 04:38:51.34Z | both `"reason":"event"`, `matchedSeq:1967`, same operation event | both settled 04:39:04.78Z — 13.44 s; two watchers woke on the same event with identical payloads |
| D | `afterSeq=1565` (ancient cursor) | `"reason":"event"`, `matchedSeq:1568` | 0.206 s — catch-up is immediate |
| E | `afterSeq=head+5000` | rc 1, stderr | `{"ok":false,"error":{"message":"Swarm cursor is ahead of this deployment","code":"swarm_cursor_invalid","detail":{}}}` |
| — | `swarm.watch {}` (no args) | default `timeoutMs` 30000 (`swarm-runtime.mjs:369`) | not isolated: my W4 hit an event before the default expired |

Behaviour that matters to a worker:

- A wake returns the **whole refreshed view**, not a delta. `watch` names `{seq, kind, payloadKind}`
  and nothing else — no actor, no subject, no payload, no timestamp. To learn *what* changed you
  re-read the entire view and diff it yourself.
- Wakes are **swarm-wide**: the filter matches any event carrying this `swarmId`, or any member's
  `runId`/`taskId`/`worker` (`swarm-runtime.mjs:378-389`). I was woken by my own write, by my own
  guide, and by another participant's guide. There is no way to subscribe to "events about me".
- Wakes are **not** generated by tool-call telemetry: a ledger walk stopped at seq 1867 while a view
  taken seconds later reported `cursor: 1884`, i.e. 17 intervening ledger rows (including my own
  tool calls) never woke a watch.
- Wakes also fire on **member prose**: a walk matched
  `{"seq":2097,"kind":"evidence.mapped","payloadKind":"content.message"}` — a participant's
  assistant-message evidence event. The noise filter drops `content.tool_call` and `route.observed`
  but not `content.message`, so a peer speaking can wake a watcher, and (as in every wake) neither
  the speaker nor the text is named.
- `swarm.watch` is the only read API that observes *change*. There is no log/history command.

**Ledger walking** (a technique, not a documented feature): repeatedly calling
`swarm.watch {afterSeq: N, timeoutMs: 1}` and following `watch.matchedSeq` enumerates the
swarm-relevant event stream — 9 probe calls in 5.8 s from seq 1800, yielding
`1814 swarm.assignment_updated`, `1823/1825` operation request/completion, `1846 swarm.context_updated`,
`1851/1853` and `1865/1867` more operation pairs, then a tail timeout. It exposes ordering and event
class, and withholds actor, command and payload; dating an event requires correlating its `seq` with
domain rows that carry `ts`.

## 6. What is missing for a worker to know its place

1. **Guidance has no swarm-domain existence.** It is delivered as an in-session interjection, framed
   as a *user* message; it never appears in `view`, `watch`, `attention`, `context` or the ledger
   walk. An unacknowledged guide is invisible to everyone, including the sender.
2. **No provenance and no timestamp on guidance.** No sender id, no message id, no send time, no
   swarm id; the body is the only evidence. I could date the guide only by bracketing ledger seqs.
3. **No reply channel tied to a message.** Replying means choosing between `swarm.guide` to a named
   participant and a shared context note; neither threads back, and the guide receipt
   (`{"ok":true,"result":"ok","emulated":false}`) tells the sender nothing about delivery or reading.
4. **No "expected of me" signal.** `attention` holds organizational anomalies, never assignments of
   responsibility. My place came from one assignment row (`assignment-probe-see`, 04:36:02.911Z) and
   from the parent's plan in shared context; a worker that never reads shared context has, in
   `delegation: {children:[], work:[], complete:true}`, a *reassuring* value that means "no work is
   declared", not "you are done".
5. **Wakes are unnamed.** No per-event filtering, no "changed rows since your cursor", no delta in
   the refreshed view; a worker polling `view` and a worker watching both have to diff a whole
   snapshot by hand.
6. **The root orchestrator is invisible.** It is not a participant; nothing in any view says a
   `swarm watch --follow` observer exists. Only the suborchestrator's role text mentions it.
7. **No visibility into the native layer.** Every participant's `native` block read
   `{"coverage":"observed_only","agents":[],"invocations":[],"unidentified":[]}` for the whole audit —
   a worker can see that a peer is `working`/`running` but nothing about what it is running.
8. **No self-service history.** `view` gives current state, `watch` gives the next event; there is no
   command to read back what happened while a participant was busy — the closest thing is the
   cursor-walk above, which returns event class only.
9. **Artifacts live outside the swarm.** A contribution carries a `body`, not a file; the review of
   mine verified the named markdown by reading my worktree directly. The domain can therefore name a
   file that changed after the contribution was recorded, with no version or digest to detect it —
   `probe-see.md` was already edited once after its contribution was recorded, and nothing in the
   accepted review can tell.
10. **Refusals are silent.** The root's refused MCP guide, and every refused write of mine, left no
    row any participant can read; only the caller sees the error, on stderr. Inside the swarm,
    "nothing happened" and "my operation was refused" look identical.

## 7. Frictions worth fixing (in the order I hit them)

- Give `watch` a delta or at least an actor/command in `watch.event`; today the wake says "something
  of class X happened" and nothing more.
- Carry sender, timestamp and message id on guidance, and surface it in `view`/`attention` so the
  receiver can see a pending ask without being interrupted mid-tool-call.
- Redact `request` in `operation_unconfirmed` attention rows, or scope them to the caller's subtree;
  today any reader can lift another pair's in-flight message text verbatim.
- Expose a way to see (or clear) an operation that failed after being recorded — its row is
  permanent by construction and no verb addresses it.
- Make `delegation.complete` false when a participant has no declared work, or name it
  `no_declared_work`; `true` reads as "finished".

## 8. Evidence index

| file | what it is |
|---|---|
| `evidence/01-self-view.json` | unscoped view, 04:36:03.876Z, `cursor: 1746` |
| `evidence/02-subtree-suborchestrator.json` | subtree read, captured 04:36:30.788Z, `cursor: 1795` |
| `evidence/02-subtree-probe-say.json`, `02-subtree-probe-see.json`, `02-subtree-nobody-here.json` | sibling / self / refusal |
| `evidence/03-context-guide-me.json` | my `"guide me"` note, `seq: 1767`, `ts: 2026-09-14T04:36:16.856Z` |
| `evidence/w1-long-watch.json`, `w2-event-wake.json`, `w3-long-sibling-watch.json`, `w4-default-timeout.json` | the four watches quoted above (W3 carries the live attention row) |
| review quoted in §1 | `reviews["contribution-d509edb8a67faf71e6ef553f2ffa2e20"][0]`, `seq: 2080`, `04:41:48.958Z` (read live from `swarm.view`) |
| second ledger walk (§5) | inline 12 `swarm.watch` probes from `afterSeq` 1960: `2040` contribution, `2080` review, `2094`/`2119` contributions, `2097 evidence.mapped/content.message`, `2111/2113` operation pair |
