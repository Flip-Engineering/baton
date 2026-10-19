# Retained-output checkpoint critique: checkpoint_due_fields / output_changed

## Scope and evidence

Offline, read-only review. No live spool, checkpoint, status, ACK, lock or
receiver was accessed. Base: 61cfd6002ad07793b8bbcd5d6e6d2d9e9ef5ac42.

Fixture: /mnt/nvme4tb/ci-runners/baton2-native-homelab/retained/recovery-output-fixture-20261018

- stdout.bin: 46,123,112 bytes, SHA256 87020b044a82014a8a4ef8166249be7a6012986f8f232c3868887f09bb521772 (recomputed, matches SHA256SUMS).
- checkpoint.bin: 1,051,863 bytes, SHA256 fc9d150cbe5c1790083f7a5acf9ef03ef34556992692515331f41688bf6f234f (recomputed, matches).

## Fixture parse (offline parser, /tmp/fixture_harness.py, Python 3.12.3)

checkpoint.bin is a BATONC03 record: 104-byte header, then the schema-1 JSON
state. Header fields (little-endian u64 at byte offsets 40/48/56/64) record
spool dev=2050, ino=38067277, spool cursor=17,430,778, payload=1,051,759.
The copied files sit on dev=66305 with different inodes, so the copied
checkpoint is not valid for live recovery or custody transfer, as RECEIPT.txt
states. It was used only as parse input.

State field sizes in that payload: terminal=997,411 bytes (94.8% of the
payload), last_message=4,304, held=0, output="15418859", output_done=false,
episode="0". The large field is the retained agent_end terminal frame. Held
contributes nothing in this fixture.

Spool census (streaming, one pass): 260,200 frames; message_update=258,051,
message_start=535, message_end=534, agent_end=3. Replay from the durable
spool cursor (17,430,778): 169,510 frames, 28,692,334 bytes, 0.351 s,
peak RSS 17,856 KB. Full-spool census: 0.557 s, same peak RSS. The parser
held no spool copy; RSS does not scale with spool or terminal size.

## Finding 1: output_changed makes checkpoint_due_fields effectively always true during streaming

bend2/src/coordinator/observer-checkpoint.bend:112 computes output_changed
from State.output. State.output is a byte position string, not output text:
Observer.with_output stores Logs.position(previous, positioned), and
Logs.position (logs.bend:503) returns the new positioned offset on success.
turn.bend (consume_frame) writes the frame batch at that position before it
builds next_checkpoint, so any frame that writes retained lines advances the
position and marks the checkpoint due.

Each due checkpoint then runs Observer.commit, which encodes every State
field with encode_sql (observer-checkpoint.bend:129) and calls
Custody.Instance.commit. At this fixture snapshot that is a 1,051,759-byte
payload per due frame, 94.8% of it the unchanged terminal frame re-serialized.

This contradicts the stated intent at observer-checkpoint.bend:98-100: held
OMP prefixes are excluded from the due decision so progress frames do not
cause a disk write for every cumulative progress frame, and restart replays
from the prior offset. output_changed reintroduces a write for every frame
that moves the output position, which during streaming is nearly every
frame. In this spool, 258,051 of 260,200 frames are message_update progress
frames.

## Finding 2: removing output_changed preserves the recorded invariants

Cursor durability: the host binds the encoded state to the attempt identity
and spool byte offset in one atomic checkpoint record
(observer-checkpoint.bend:9-11, Instance.commit at host/instance.bend:78).
The output position travels inside that same state. Removing output_changed
delays only the position piggyback: the next semantic checkpoint
(message, terminal, episode, cursor, activity, primary, current, filter or
codex change) carries the current position, because consume_frame builds
next_checkpoint with the fresh position on every frame regardless of due.

Crash resume from the earlier durable offset: on crash, restore returns the
last committed state with its earlier spool cursor and earlier output
position. Replay re-reads spool frames after that cursor.

Partial replay preserving the existing output prefix:
Logs.write_positioned_retained writes each batch at the recorded position
with write_batch_at, and equal bytes already present stay in place
(logs.bend:521-526 and the comment at logs.bend:553-556). Replayed batches
land on the same offsets, so the existing prefix is preserved.

Final output truncation and finalization: the final path does not use
checkpoint_due_fields. consume_exhausted (turn.bend:774-775) commits
Observer.finish_output(checkpoint_state, ...) under its own enabled flag,
and finish_output clears held and sets output_done
(observer-checkpoint.bend:43-46). Truncation runs through
write_positioned with finish set, which writes an empty string at the final
position with the truncate flag (logs.bend:521-526). Removing
output_changed does not reach this path.

Unknown status and custody: the fixture state has output_done=false and no
terminal success is recorded in the checkpoint itself. Removing
output_changed adds no success or ACK path; checkpoint commit failure still
reports that raw output remains replayable from the last validated
checkpoint (turn.bend, checkpoint_failure_notice). The copied checkpoint
binds dev=2050/ino=38067277 and must stay non-runnable offline. One existing
behavior to keep in view, unchanged by this fix: decode_nonempty falls back
to reset_empty on an invalid state value, which replays the handle and
commits the empty state (observer-checkpoint.bend:210-208). Custody
validation in Instance.restore is the layer that must reject a mismatched
attempt before decode; the due-fields change neither strengthens nor
weakens that.

Existing law held_prefix_progress_keeps_the_prior_replay_offset
(observer-checkpoint-laws.bend) already states the replay-from-prior-offset
contract for held progress. The same contract covers output position.

## Finding 3: removing output_changed is necessary and not sufficient for checkpoint cost

After removal, a checkpoint is due only on semantic change. In this spool
that bounds due checkpoints to the order of message_end (534), turn and
agent boundaries, a reduction from about 260,200 potential commits to the
low thousands at most. Each remaining commit still encodes the full
997,411-byte terminal field at this snapshot, so per-commit cost stays
about 1 MB until the terminal field stops being re-serialized or is stored
by range. That second step needs its own measured failure and is out of
scope for the narrow fix.

## Finding 4: the materialize patch in reviews/ does not apply to this base

reviews/runtime-memory-checkpoint-materialize.patch edits a
checkpoint_state function and a Logs.materialize_held call. Neither symbol
exists in bend2/src/coordinator/observer-checkpoint.bend at this base
(226 lines, no checkpoint_state, no materialize_held; held is a plain State
field). That patch targets a different source shape and must not be applied
here. Its held-materialization finding also does not explain this fixture:
held=0 and terminal is 94.8% of the payload.

## PR 890 checkpoint-rate attribution

No PR 890 artifact, diff or measurement record exists in this checkout
(searched reviews/, docs/, bend2/test/). The attribution is therefore
unverified from local evidence. What the fixture does show: if the rate was
attributed to held-frame materialization, this fixture contradicts it
(held=0). If it was attributed to per-frame checkpoint commits, the
mechanism is output_changed at observer-checkpoint.bend:112, not held.

## Verdict

Remove output_changed from checkpoint_due_fields (line 112 and its use at
line 119), keeping every other due field. Add laws to
observer-checkpoint-laws.bend: (a) a state differing only in output position
is not due; (b) each existing semantic field alone still makes it due;
(c) finish_output still reports output_done with held cleared. Do not apply
the materialize patch. Treat the 1 MB per-commit terminal re-serialization
as a separate, later fix with its own measurement.

Limits: no Bend build or law run was executed in this review (small bounded
scope, no coordinator build); the replay numbers come from the offline
Python parser, which validates the fixture format and the replay-from-cursor
path, not the Bend observer binary. Baton CLI was not on PATH in this
worktree, so this report is delivered as a committed file.
