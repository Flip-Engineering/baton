# Logging utility review for #686

Scope: practical defaults for Baton2-owned log generation and retention.
Measurements were taken on 2026-10-06 against base `2cc57690` and the
`orchestra.db` at
`baton-bend2-root-delivery-20260928/.scratch/baton2-audit-followups-20261004/`.
The implementation work itself belongs to logging-impl-20261006; this document
records the recommended defaults and the evidence behind them.

## Measured sources of volume

`turns.event` in the shared database, grouped by recorded harness:

| Harness | Turns | Total event bytes | Max single event bytes |
| --- | --- | --- | --- |
| OMP | 2008 | 147,795,322 | 1,024,862 |
| Codex | 957 | 528,099 | 1,673 |
| Muse | 403 | 424,678 | 28,710 |

OMP `agent_end` envelopes carry complete accumulated message arrays; that
column is the largest database-resident source. File-level storage beside the
database totals 3.9 GB. The largest components are Player worktrees (1249 MB),
`orchestra.db.sessions` conversation files (114 MB), `retained` output (64 MB),
and one directory per native attempt (`orchestra.db.attempt-*`, largest
observed ~293 MB). Each turn writes a new attempt directory, a per-turn output
log, and a `.stderr` file, with no cleanup path in source. The issue reports
`semantic-impl-context-core.jsonl` at 819,516,444 bytes, `semantic-impl-codec`
near 739 MB, one recovery provider log near 811 MB, and ~20.9 GB of inactive
JSONL and log candidates across workspaces (that aggregate includes external
harness histories; see ownership boundaries below).

Unacknowledged message backlog at measurement time: 3918 reports, 148 guidance,
155 questions, 39 tasks, 26 notes, 1 coordination, 1 ask.

## Default operational event set

The consume loop in `bend2/src/coordinator/turn.bend` already drops OMP
`message_update` cumulative snapshots from the native log and keeps
`message_end` plus other frames (`record_frame`, `turn.bend:257`). The
relevance predicate in `bend2/src/coordinator/guidance.bend:relevant` admits
`response`, `message_end`, `tool_execution_start`, `tool_execution_end`, and
`agent_end` for OMP; every frame is relevant for other harnesses. The retained
default set for both the native log and `turns.event`:

- Session, actor, turn, and message identifiers for every admitted frame.
- Tool execution start and end with tool name, arguments digest, exit status,
  and duration.
- Terminal envelopes (`agent_end`, `turn.completed`, `turn.failed`) with the
  terminal status, the latest assistant message text, and the error text.
- Delivery identifiers: report id, recipient, receipt, and the native attempt
  identity linking the event to its attempt directory.
- Validation identifiers: land/push results, remote runner receipts, and the
  source commit each check ran against.

Per-frame accumulated message arrays are excluded from the default set. The
terminal projection keeps the latest assistant message, following the existing
`message_end` fallback in `turn.bend:178-190`. Full per-frame content stays
available in the per-turn native log until rotation removes it.

## Verbosity levels and full-trace activation

Three levels:

1. `normal` (default). The event set above. Per-turn native logs keep admitted
   frames only.
2. `debug` (per session or per turn). Admits `message_update` snapshots and
   unfiltered provider frames into that session's native log. `turns.event`
   keeps the default projection.
3. `trace` (per turn, time-boxed). Records the complete raw stream for one
   turn, including dropped snapshot frames, with a stated byte cap and expiry.

Activation: `debug` is set on a named session; `trace` is set on a named turn
with a duration after which the turn falls back to `debug`. The `set_event_filter`
delta request (`bend2/src/harness/omp-player.bend`, `turn.bend:260-279`) stays
enabled and records its outcome per turn (`delta`, `refused`, `unconfirmed`,
`unacknowledged`); a `refused` or `unconfirmed` outcome on a session using
`normal` raises that session to `debug` only for the affected turn, so the
evidence for the refusal is captured once. Full traces carry a retention of 7
days and a per-turn byte cap; exceeding the cap seals the trace and records a
diagnostic naming the cap.

## Payload artifact references

Repeated large data is stored once and named by reference. Tool payloads above
a size threshold (recommended initial value: 64 KB, justified by the max
single-event sizes above) are written to the turn's attempt directory under a
content-addressed name, and the log line carries the artifact path, byte size,
and digest. The `delivery` and `turns` commands resolve a reference to the
stored bytes while the artifact is retained. Removing an artifact leaves the
reference line in place with a `removed` marker and the removal timestamp, so
provenance stays readable after bytes are gone.

## Rotation, compression, retention, and budgets

- Per-turn native logs and `.stderr` files rotate at 64 MB: the active file is
  sealed and compressed (zstd), and the turn continues in a new file named
  with the turn id and sequence number. Compressed files keep the turn id in
  the file name so `turns` output stays joinable to bytes on disk.
- Attempt directories (`orchestra.db.attempt-*`) are sealed when the turn
  completes. Sealed attempts older than 30 days are compressed as a unit;
  compressed attempts older than 90 days are eligible for removal.
- Storage budgets are configured per database directory: a soft budget (warn
  in status output) and a hard budget (refuse new turn starts with a
  `budget-exceeded` diagnostic naming current use). Recommended initial values
  from the measurements: soft 10 GB, hard 20 GB for a coordination database
  directory. The values are configurable; the units are bytes.
- A storage inspection command prints per-category bytes (database tables,
  session conversations, attempt directories, retained output, worktrees) and
  a cleanup preview lists every eligible artifact with its size and the rule
  that selected it. Cleanup deletes only listed eligible artifacts after an
  explicit confirmation naming the preview.
- Retention exclusions (never eligible while the condition holds): messages
  with `receipt IS NULL` (3918 reports, 148 guidance, 155 questions, 39 tasks
  at measurement), active traces, dirty worktrees, stored credentials, and
  the only retained copy of a delivery or validation receipt. Coordinate with
  #685, #666, #669, #664, and #670 so reduced logs keep report extraction,
  error diagnosis, and continuation behavior.

## Ownership boundaries

- Baton2 owns: `turns.event` rows, per-turn output logs and `.stderr` files,
  attempt directories, `retained` output, the messages database including
  pending inputs, and Player worktrees it created.
- The harness owns its conversation storage (OMP `--session-dir` files, Muse
  conversation storage, Codex session files). Baton2 reads them for the
  `observed-usage` projection (`bend2/src/coordinator/usage.bend`) and resume
  (`Omp.resume_file`, `Muse.resume_player`); it deletes nothing there. The
  ~20.9 GB aggregate in the issue mixes Baton2-owned files with these
  external histories; cleanup measures each side separately.
- Session databases, pending messages, dirty work, and validation evidence
  stay until their owning issue or landing completes. Cross-ensemble cleanup
  requires the owning conductor's acknowledgment.

## Write-failure and disk-exhaustion handling

- Every log append treats failure as data: a failed append records the error
  text in the turn outcome (`remember`/`remember_write`, `turn.bend:27-35`)
  and continues the turn. Completion and delivery reports state the failure;
  a turn that lost log bytes never reports clean completion.
- When the hard budget is reached or a write returns ENOSPC, the turn seals
  its current log, records `budget-exceeded` with current use and the failed
  path, and finishes the turn as failed with pending input preserved. The
  failure is delivered as a report so recovery has the identifiers it needs.
- Startup probes free space before spawning a native process and refuse the
  start with the same diagnostic when below a floor (recommended: 1 GB),
  instead of launching a turn that cannot record its own outcome.

## Muse underutilization evidence and routing recommendations

Observed in source:

- `Muse.input` writes no bytes (`bend2/src/harness/muse-player.bend`; law
  `m13_muse_input_writes_no_bytes` in `bend2/src/harness/laws.bend:261`
  pins this behavior). A Muse session accepts further instructions only
  through a new `dispatch-turn`, never mid-turn.
- The receiver admits only Codex or OMP sessions
  (`bend2/src/coordinator/control.bend:106`,
  `bend2/src/coordinator/control-laws.bend:210`). A Muse session cannot use
  the receiver path; `receive.bend:44` directs Muse and Claude Players to
  `dispatch-turn`.
- `docs/bend2/harness-setup.md` qualifies Muse only for the Player role and
  documents `exec --json --prompt-file` with `--session-id` resume. The
  recovery documentation states that active OMP Players accept native
  guidance while other harnesses receive instructions through the next
  explicitly started turn.
- `recruit` takes an explicit harness, model, and effort
  (`bend2/src/coordinator/main.bend:80`); no in-source default selects a
  harness. Recorded usage: 82 OMP, 16 Codex, 10 Muse sessions; 2008 OMP,
  957 Codex, 403 Muse turns. Section assignments pair Muse critics with OMP
  research sessions; conductors are Codex or OMP sessions.

Recommendations only; no routing source edits are proposed in this ensemble:

1. Qualify a Muse receiver and `dispatch-file` path, or record the
   dispatch-turn-only status as a permanent constraint that conductors plan
   around.
2. Give conductors a documented harness-selection rule: single-shot review
   and critic work with no mid-turn steering defaults to Muse; work needing
   steering or a receiver stays on Codex or OMP.
3. Record per-harness live capacity beside the qualified-routes table so
   selection uses current availability instead of fixed habit.
