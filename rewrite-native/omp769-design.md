# Task 769 design: identity-keyed observation storage, bounded replay, filter refusal repair

Author: rewrite-native (GLM 5.3 Flash, omp). Investigation: report
`0e639978`. Critic: rewrite-muse. Acceptance planning:
rewrite-deepseek. Execution stays admission-gated. Emergency-helper
addendum: `rewrite-native/omp769-recovery-helper.md`.

## A. Filter refusal repair (turn.bend, omp-player.bend)

Ground: the filter request carries `id:"baton:filter"`
(`omp-player.bend:52`); recognition requires that id
(`turn.bend:573-574`); `filter_next` keeps the prior state on an empty
mode (`omp-player.bend:71-72`); the checkpoint persists it
(`observer-checkpoint.bend:13`, restore `turn.bend:841`). A missing-id
refusal therefore leaves a believed-active selection indefinitely, and
the turn-end marker keeps claiming `active:true`.

Change (one SQL branch in `filter_mode_sql`, `turn.bend:573-574`):
when the line is a `response` with `success` not equal to 1
(including an absent success field) and its `id` is absent or empty,
and a filter request is outstanding (`requested != 'unknown'`),
answer `refused`. Responses carrying another request's id (get_state,
prompt) are unaffected - they keep their ids by contract. `refused`
flows through the existing `filter_next` to the checkpoint and to
`filter_note`'s existing `outcome:refused` marker
(`omp-player.bend:71-79`). No new state, no flag.

## B. Observation storage: in-place by identity

New durable observation record keyed `(attempt, kind, id)`:

- Prefix frames (`message_update`, `tool_execution_update`) UPSERT:
  the newest frame replaces the row payload in the same per-frame
  transaction `observe_event` (`turn.bend:775`) already runs.
- Non-cumulative frames (`message_start/end`,
  `tool_execution_start/end`, `turn_end`, `agent_end`, errors,
  notices, extension_ui_request) APPEND to the classified record,
  order preserved.
- Terminal status writes stay exactly where they are
  (`completion_state_event`, `terminal_admitted`, `turn.bend:769-772`).

The checkpoint `.pending` whole-held-set rewrite (`turn.bend:598-603`)
is superseded by the per-frame durable upserts: restart recovery reads
the store. `checkpoint_restore` (`turn.bend:610-629`) remains only for
held entries an older observer wrote before the store existed - the
compat path shrinks to genuinely pre-store evidence.

The raw keeper spool is native lineage evidence and stays verbatim and
append-only; it is no longer the replay input. Scope statement: the
existing multi-gigabyte spool files are preserved as evidence per the
operator directive; this design removes them as the resume dependency
and stops every observation-layer path from duplicating cumulative
payloads. The projected log keeps its newest-per-identity flush
(`turn.bend:700`, `logs.bend:108-124,178-180`), now backed durably.

## C. Replay bounded by new information

- Dead-custody resume stops forcing the cursor to 0
  (`receive.bend:307`). Reconstruction reads: (1) the latest
  prefix-frame row per `(kind,id)`; (2) the non-cumulative append
  record in order; (3) the raw spool only from the last verified
  offset for bytes newer than the store. The verified-offset
  machinery exists (`process-spawn.c` restore path,
  `Observer.restore`/`Logs.position`).
- A fully stored spool replays zero lines; unread tail bytes replay
  exactly once. Original spools are never read destructively nor
  rewritten.

## Preserved-properties checklist

Full messages (the newest snapshot is the full message; finals
stored), meaningful errors (refusal/error frames append), terminal
outcomes (unchanged path), owned input/read/receipt (untouched),
native lineage (raw spool verbatim, preserved), restart recovery
(durable store + shrunken checkpoint path). No caps, no evidence
truncation, no dropped frames, no flags, no falsified status. Host
stays mechanical byte IO; identity classification, upsert-vs-append,
and replay order are Bend2 policy over the existing SQL probe style.

## Qualification vectors (admission-gated)

1. Missing-id refusal with an outstanding request -> mode refused;
   marker outcome refused; no active claim.
2. Correlated refusal (id present) -> refused (unchanged).
3. Cumulative update sequence -> exactly one store row per identity,
   payload = newest frame.
4. Kill and resume after N snapshots -> reconstruction equals one-shot
   observation of the newest-per-identity set; replayed raw lines =
   only the unread tail.
5. Terminal after updates -> terminal outcome preserved, record
   ordered.
6. Pre-store checkpoint (legacy `.pending`) still restores via the
   compat path.

## Review response (muse conditional pass, five items)

1. Missing-id refusal attribution is BLOCKED on evidence: no OMP17.4
   refusal text exists in this worktree. Requested: the actual refusal
   frame from the operator's observed run (it is a line of the live
   attempts' raw spools - capturing it is read-only evidence work,
   e.g. a search of the two retained spools for `set_event_filter`
   responses with no id field). Until that text lands, the design
   carries both candidate rules and picks none: (i) refuse on any
   `success != 1` response with absent/empty id while a filter request
   is outstanding; (ii) restrict (i) to responses that also carry
   `command:'set_event_filter'` if observed refusals echo the command.
2. Identity encoding: hardened for the NEW artifact and store - the
   length-prefixed byte encoding (the argv `enc_argv` convention)
   replaces raw TAB joins, making TAB/newline-bearing ids safe without
   any charset claim. Checkpoint compatibility: legacy `.pending`
   files keep the TAB format and are read by the legacy parser; the
   hardened writer is new-format only, and a version marker in the
   manifest distinguishes them. Coalesce precedence justification:
   `frame_id_sql` (logs.bend:199-201) selects
   `toolCallId`, then `messageId`, then `message.id` - tool
   executions carry only `toolCallId`, message frames carry only
   `messageId`/`message.id`, and one frame is never both, so the
   precedence is a total selection per frame shape, not a policy.
3. Retention target accepted: the repair targets the raw spool. Two
   bounding options exist for the (c) unbounded rewind and the spool
   growth itself, and the choice is a trio decision because it trades
   evidence retention: (i) spool compaction/rotation keyed to
   committed offsets (raw bytes below the committed offset move to
   operator-owned archive storage; the spool keeps only unobserved
   bytes); (ii) cumulative-snapshot suppression at the writer - which
   requires the writer to classify frames and therefore moves policy
   into the host unless suppression is done by the Bend2 observer
   rewriting the spool it reads, contradicting read-only lineage.
   Option (i) keeps the host mechanical and bounds the spool by
   durable progress; option (ii) is rejected as designed.
4. Replay domains separated as directed: (a) the guidance/wake cursor
   replay from 0 (receive.bend:307) is bounded by re-emitting the
   stored newest-per-identity and non-cumulative record instead of
   re-deriving from the spool; (b) spool resume already reads from the
   committed offset and is bounded; (c) the unbounded full rewind
   happens only on an unusable/rejected checkpoint, and the fix that
   bounds it is the durable per-frame store - a lost checkpoint no
   longer forces spool re-derivation because the store IS the
   checkpoint (reconstruction reads it directly). With the store
   landed, case (c) degenerates to reading the store plus the unread
   tail.
5. Staged-set exclusion recorded: the unrelated exec slice stays out
   of every 769 implementation commit, enforced by a staged-set check
   before each commit. File hashes while staged:
   exec.c 28b3d867eb03204eca552e5616d8b724361ab43d465b220706be573caa6289c4,
   exec.bend 2ebdded9dfb2f0eff2ebef666782e3ba7b7945299404dd66d51f5d46ced3cd89,
   exit.c e5c685176216026cac3f3aaabe8cb508660fb9f5de14af2e1ba7540481127897,
   exit.bend 8281e1413aec6e9c6d86aa4264acb558063c684c23933df05a86a3dd589acba6,
   exit.js 132ac55e82afb58836ec527bfa67f3453afe9fb495bc3de7b1ed191df989c549,
   git/process.bend 93909215127baeffc45f2a930cdb4b2f8316904492ec0b2f6329446d216f1f56
   (the last is the relocation rewiring, to commit as its own slice).
   The OMP17.4 evidence request above is the open blocker for design
   item 1; item 3's trio decision is the open blocker for the storage
   choice. Both are requested from root through muse.

## Implementation status

Source-only. Compilation, builds, tests, checks and CI remain held by the
shared compilation queue (#970).

### Item A evidence

The missing-id refusal frame the review asked for exists in the retained spool
of attempt `receive:rewrite-native:46` at line 4:

```
{"type":"response","command":"set_event_filter","success":false,"error":"Unknown command: set_event_filter"}
```

The frame carries no `id`, `success` is false and the command is echoed. Rule
(i) and rule (ii) in the conditional review both classify it as `refused`; the
landed arm in `filter_mode_sql` is rule (i). The spool is native lineage
evidence and was read only.

### Item B: durable observation rows

`commands.schema()` creates `observations`:

```
id INTEGER PRIMARY KEY, session, attempt, kind, frame_id,
is_prefix INTEGER, level TEXT, payload TEXT, projected TEXT
```

`observation_store_sql` writes one row per frame in the transaction
`observe_event` already commits. A cumulative frame (`message_update`,
`tool_execution_update`) with an identity upserts its newest payload and moves
the row to the current observation position. Every other frame appends; an
exact repeated append row is not written twice, which covers a keeper replay
from a checkpoint before the frame. `projected` is the line the public log
received at the recorded level; `level` keeps the projection readable after a
level change.

The identity selection in `logs.frame_id_sql` now reads
`message.responseId` and `message.toolCallId`. The real spool above shows the
17.4 message frames carry those fields and not `messageId` or `message.id`;
without them every cumulative snapshot has an empty identity and is written to
the projected log. The fallbacks keep `toolCallId` and `messageId` first for
older frames.

The store is written for OMP attempts only. A store-only frame commits under
`C.observation_schema()` without reinstalling the coordinator schema or
publishing a coordinator change.

### Item C: bounded replay

`receive.wake_fenced` no longer forces a dead attempt's cursor to `0`. It reads
the oldest unacknowledged message directly when host custody is dead and an
attempt is recorded, and keeps the cursor selection for a live attempt.

`turn.retained_output` always restores the host's verified checkpoint.
`Observer.restore_checked` reports whether the host accepted one. A missing
generation file is rebuilt from the observation rows and never by rewinding the
spool. The rebuild includes only rows the projection already wrote when the
observer had not finished its EOF flush; open prefixes stay in the restored
held set and are written by their normal close or flush. When the checkpoint is
unusable the host has already positioned the reader at the spool start; a
genuinely pre-store attempt with a missing generation keeps the compat rewind.
A diagnostic-level generation keeps the raw spool replay: that level retains
every frame, while the store keeps only the newest cumulative prefix per
identity. The raw spool remains untouched and append-only.

### Retained spool measurement (read-only)

The retained spool of attempt `receive:rewrite-native:46` was read without
modification and reduced with the rules above:

| Measure | Value |
| --- | --- |
| frames | 30,541 |
| `message_update` frames | 28,439 |
| cumulative snapshot bytes | 355,846,832 |
| cumulative identities | 63 |
| identities closed by `message_end` | 63 |
| projected default-level snapshot bytes | 0 |
| `message_end` full frames | 157 / 536,106 bytes |
| all append bytes | 1,824,087 bytes |
| first plus added bytes over the cumulative sequences | 874,711 bytes |

Every cumulative identity was closed, so the default projection drops all
28,439 snapshots. The full messages are the 157 `message_end` frames; their
536,106 bytes are below the 874,711-byte first-plus-added bound. The reduction
is a replay of the projection rules over the original spool, not an observer
run.

### Remaining gates

- Items B and C are implemented but not compiled or exercised. The five
  acceptance scenarios in `docs/pure-bend2/acceptance-769-omp-logging.md`
  remain admission-gated through rewrite-root.
- The trio decision on spool compaction or rotation (design item 3) remains
- A frame stored after the last committed checkpoint is replayed from that
  checkpoint. The append guard keeps one row, and the projection write compares
  the replayed bytes with the existing bytes at the same position. Rows written
  after the checkpoint stay in the projection; the store is the durable source.
