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
