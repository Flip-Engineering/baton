# Task 769 addendum: emergency recovery helper design (pure Bend2)

Author: rewrite-native (GLM 5.3 Flash, omp). Parent design:
`rewrite-native/omp769-design.md`. Critic: rewrite-muse. Design only;
implementation after your review. The two live DeepSeek restores
(deepseek attempt receive:...279 driver pid 24909; compiler attempt 53
driver pid 28747) are untouched by everything here.

## Checkpoint format: what `.pending` supports (cited)

`bend2/src/host/log-checkpoint.c` writes the checkpoint atomically:
mkstemp of `<path>.tmp.XXXXXX` (lines 13-17), full write with EINTR
resume (19-27), fsync (28), close (29-30), rename over the target
(31), unlink of the temporary on any failure (32); an empty payload
removes the file (9-11). Content is opaque text to the host; the
producer is `turn.bend:598-603`
(`Checkpoint.LogCheckpoint.save(log ++ ".pending", Tx.join("\n",
Logs.flush(held)))`), where the held set is the newest-per-identity
entries `<kind>\t<id>\t<line>` joined by newlines
(`logs.bend:108-124`, `held_put` 178-180). Consequences the helper can
rely on: the `.pending` file holds exactly one latest cumulative
snapshot per identity as of the last checkpoint save; it carries no
spool offset, no checksum, and no spool binding; saves are atomic, so
a reader either sees a complete older set or the complete newer one.

## Receive recovery path (cited)

`bend2/src/coordinator/receive.bend:300-312`: claim_state, attempt
directory lookup (`attempt_dir_sql`), `custody_dead`, then
`replay_cursor = "0"` when dead with a non-empty directory
(`:307`) - the full-spool replay - into `wake_admit`. The recovery
driver then re-reads every spool line through the classification probe
per frame (`turn.bend:556-562`), which is the ~126 KB/s-1.4 MB/s the
two live restores show.

## Helper design (new derived artifact; touches nothing owned)

Inputs, read-only: the attempt's `.pending` checkpoint (`Text.read`,
read-only shared), the raw spool via `Files.open`/`Files.read_chunk`/
`Files.close` (own descriptor; the spool is only ever opened O_RDONLY,
so the live drivers' ownership is untouched), and the attempt database
through `Sql.read` only (read-only connection; no writes, no schema
change, no DB surgery).

One sequential pass over the spool in 1 MiB chunks, splitting lines
with a partial-line carry, and for each complete line extracting
`(kind, id)` by the existing classification probe shape
(`frame_identity_kind`, `logs.bend:216-223`, run through `Sql.read`
against the attempt database). Frames route to two derived sections:

1. Held section: for prefix identities (`message_update`,
   `tool_execution_update`), the LAST frame wins - identical
   semantics to `held_put` (`logs.bend:178-180`); the checkpoint's
   entries are the initial map, and any newer spool frame for the same
   identity replaces it.
2. Record section: every non-cumulative frame (`message_start/end`,
   `tool_execution_start/end`, `turn_end`, `agent_end`, errors,
   notices) in spool order.

Output: one new artifact beside the originals
(`<spool>.observation`), written atomically through
`LogCheckpoint.save` (the same mkstemp/fsync/rename discipline), with
three sections and a manifest: the held entries, the ordered record
entries, and the binding - spool device/inode/size, spool SHA-256
(`Files.digest`-equivalent computed streaming during the same pass),
checkpoint SHA-256, attempt/session/native ids as recorded, and the
helper identity. A derived artifact is only complete when its manifest
names a spool digest matching the current file; a spool that grew
during the pass invalidates the artifact and the helper reruns the
pass (no cap; the rerun is the correctness-preserving move).

Preservation: raw bytes untouched (read-only descriptor), source and
target identities preserved (the manifest records them), no invented
terminal status (no terminal frame is synthesized; the artifact holds
only observed frames), no dropped cumulative content (last-wins is
the semantic the checkpoint already uses), no duplicate native launch,
no signals, no restarts, no lock acquisition - the helper never
touches the session lock, the attempt custody, or any driver-owned
descriptor.

## Operational transition (explicitly out of the helper's scope)

Replacing a live driver's continuation with the derived artifact needs
the exact supported custody sequence - observer release/retire of the
old handle, the artifact bound as the resume checkpoint, and a fresh
wake - which is a root-coordinated operational decision per affected
attempt, using the same custody/lock steps the ordinary recovery path
uses. The helper only ever produces the artifact and its manifest.

## Relation to the systematic repair

The parent design's durable per-frame upsert store supersedes the
helper for future attempts; the helper is the emergency instrument for
the two in-flight restores and any spool already on disk, and its
artifact format is the same one the parent store maintains, so the
recovery driver consumes either without a second code path.
