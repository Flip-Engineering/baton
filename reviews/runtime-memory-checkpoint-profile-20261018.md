# Receive memory profile: checkpoint held materialization

## Candidate

- Binary: `/run/baton2-native-homelab/retained/baton-account-credits-793-702-20261017T0106Z/worktrees/runtime-memory-focus-luna-20261018/.scratch-runtime-memory-core-final2-parallel4-20261018/sharded-nopch`
- SHA256: `82b55b82a5e1c312ec8133e96b73873bf0aebda010271f52eb72bd367959e7d7`
- Generated C: `3157d5e8f88e5044690ac47b5494b421f15d0834887b7ac4ab55ea5c8374fa4e`
- Driver: `codex/runtime-memory-acceptance-20261018` HEAD `214446dfe977b896ea1c6cb8a5291df07029d03b`
- Test: `MemoryGateTests.test_repeated_semantic_checkpoints_keep_one_latest_open_frame`

## Run

`BATON_CANDIDATE=<binary> python3 bend2/test/receive-memory-acceptance.py ...` from the acceptance worktree.
No new run was started after the resource-admission instruction; this is the already-running finite reproduction.
An 8 GiB address-space limit is unusable for this binary: it reserves about 10.6 GiB virtual
(the same run under `ulimit -v 8388608` fails at coordinator setup with `bend: reservation failed`).
No cgroup delegation was available (`sudo -n` denied, no user systemd bus), so RSS is bounded by the test itself.

## RSS per checkpoint

| Checkpoint | Observer RSS (bytes) | Growth (bytes) |
| ---: | ---: | ---: |
| 0 | 387,760,128 | 376,373,248 |
| 1 | 488,431,616 | 477,044,736 |
| 2 | 589,160,448 | 577,773,568 |
| 3 | 689,823,744 | 678,436,864 |
| 4 | 790,519,808 | 779,132,928 |
| 5 | 891,199,488 | 879,812,608 |
| 6 | 991,911,936 | 980,525,056 |
| 7 | 1,092,575,232 | 1,081,188,352 |

Held projection is 4,194,645 bytes at every checkpoint; checkpoint bytes are 4,195,204 to 4,195,205.
Steady growth is 100,663,296 to 100,728,832 bytes per checkpoint, about 24.0 bytes per held byte.

## Where it grows

- External sampling of the observer (`/proc/<pid>/status`, `smaps_rollup`, `maps`):
  RSS is flat between checkpoints for tens of seconds, then jumps 82–102 MB at a checkpoint.
- Growth is `RssAnon`/`Private_Dirty`/`Anonymous`; `RssFile` stays about 7 MB.
- Mappings are an 8 GiB and a 2 GiB anonymous `rw-p` arena plus small heap chunks; threads = 3.
  The growth is inside the Bend runtime's anonymous arena, not the spool or SQLite file mapping.
- Source path: `consume_frame` -> `Observer.checkpoint_state` -> `Logs.materialize_held` ->
  `Frame.materialize_checkpoint_text` -> `Text.read_span`, on every due checkpoint.
  `Text.read_span` returns a Bend String; 4.19 MB at about 24 bytes/char is about 100.7 MB.
  The previous checkpoint's string is not reclaimed or reused, so RSS grows linearly with checkpoints.

## Smallest safe candidate

`reviews/runtime-memory-checkpoint-materialize.patch` changes only `checkpoint_state` in
`bend2/src/coordinator/observer-checkpoint.bend`: materialize held span tokens only for a final
state (`output_done` or non-empty `terminal`); intermediate checkpoints keep the tokens.

- Intermediate checkpoints stop the 4.19 MB -> 100 MB materialization.
- Tokens are valid while the attempt spool is retained. Ack is suppressed on an incomplete
  checkpoint, and `finish_output` clears held before the final checkpoint, so no token is
  persisted past a successful final checkpoint/ack.
- A restore of an intermediate token checkpoint materializes at the next final checkpoint or
  flushes by span copy; the current `materialize_held`/`write_positioned` paths already handle tokens.

## Limits

- One finite run; the target test fails at checkpoint 7 with 1,092,575,232 B RSS, matching the
  reported about 1.09 GB.
- No cgroup 8 GiB/0-swap scope; no AS cap because the runtime reserves 10.6 GiB virtual.
- The patch was not built or rerun; it is a review candidate.

## Independent instrumented C counters

The instrumented final2 C run at checkpoint cursor 20,973,556 (five updates) reported:

- Observer RSS: 771,932 kB.
- Heap allocated: 665,939,680 B; freed: 590,382,801 B; live delta: 75,556,879 B.
- Maximum H_BUMP: 688,865 pages. With `PAGE_BITS=7` and `Loc=u64`, one page is 128 * 8 = 1024 B,
  so the bump-arena high-water is 705,397,760 B (672.7 MiB).
- `io_str` (generated C around 360864) allocates one SCon node per decoded scalar.

This separates the two candidates: the live term delta is about 76 MB, while the arena high-water is
about 673 MiB and RSS about 754 MiB. The gate is measuring allocator high-water from constructing the
4.19 MB held frame as a Bend String at each checkpoint, not retained held/checkpoint storage. The
freed bytes are not returned or reused promptly, so each 100 MB materialization raises the high-water
until the arena reaches about 1.09 GB.

## Safe streaming/range representation

1. Intermediate checkpoints store the held entry as its existing range token
   `(spool, offset, length)` plus the attempt/spool identity. No `Text.read_span`, no `io_str`,
   no SCons, and no held-frame String on the checkpoint path.
2. The final/terminal checkpoint must not carry a live range that cannot outlive its spool:
   `finish_output` clears held after the flush; if held is still non-empty, materialize once or
   stream the range through a native span copy. Ack stays suppressed on an incomplete checkpoint.
3. Restore validates the range against the recorded spool identity (device/inode/path or attempt
   id). A missing or mismatched spool is a restore error, not a silent drop.
4. A checkpoint-owned sidecar file is only justified if a self-contained checkpoint is mandatory;
   then write it by native streaming copy (never a Bend String) and clear it with the checkpoint.
   Prefer the retained-spool range: a second durable store duplicates the existing spool source.

The narrow patch in `reviews/runtime-memory-checkpoint-materialize.patch` implements step 1 and 2:
materialize only when the state is final (`output_done` or non-empty `terminal`); intermediate
checkpoints keep the range token.
