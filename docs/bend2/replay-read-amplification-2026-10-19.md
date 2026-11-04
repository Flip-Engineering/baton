# Replay read amplification

This note records the database-read trace for issue #943 and the current
replay-related source evidence on main. It does not report a current replay
performance measurement.

## Original trace

The six-second trace covered recovery attempt
`receive:storage-policy-wonder-20261019:39309:bd5db51622561680553a73741a343108`.
The accounts database was 330,878,976 bytes. During the trace, the recovery
worker read 159,828,580 database bytes, 57,344 stdout bytes and 6,367 attempt
JSONL bytes. Stdout offsets advanced from 2,137,437 to 2,151,283.

The trace recorded 39,292 database `pread64` calls. Seven long read-write
connections each read about 22.3 MB from 1,922 distinct pages. These repeated
page reads came from three message-table scans during terminal observation.
The trace also recorded short per-frame reads.

Trace artifacts:

- `/mnt/nvme4tb/retained-root-builds-20261019/storage39309-io-offsets.trace`,
  SHA-256 `a2cc9af3ca9e48852d44bdf3153947a7b88c868f925896e66959917d1b5a3ffd`
- `/mnt/nvme4tb/retained-root-builds-20261019/storage39309-io-offset-summary.json`,
  SHA-256 `480af84b75785a505f7fd92f8de802f7d3cb985a8fd8ae2cce977c1cc2dbf5e6`

## Current message index

Main creates `messages_recipient_seq` on `(recipient,seq,id)` and drops the
older `messages_pending` index. Pending state is derived from `message_reads`,
so the current index has no receipt predicate. The fixture in
`bend2/test/replay-read-amplification.py` checks the current index and query
plan against a synthetic 30,000-message database. It does not run coordinator
replay or measure cursor advancement.

The byte counts in earlier versions of this note compare no index, a full
index and the obsolete partial receipt index. They do not measure the current
schema and are not evidence of current replay performance.

## Read-only connection reuse

PR #1208 merged per-helper-thread read-only SQLite connection reuse. The cache
checks process identity and database path, device and inode. It rejects an
inherited connection after fork, rolls back open transactions, and closes
connections after errors or SQL that changes connection-local state. Thread
exit releases the connection. `query_span` and read-write connections are
unchanged.

The focused lifecycle fixture passed on SQLite 3.45.1 in 557.786 seconds. No
full native build ran for that change. PR #1208 removed its synthetic replay
byte ratio and makes no performance claim. The older branch
`fix/replay-read-reuse-943-main-20261022` is based on an obsolete main revision;
its cache implementation is superseded by the merged change.

## Replay behavior fixture

`bend2/test/observer-monitor.py::test_protected_spool_replays_to_normal_eof_with_unknown_monitor_custody`
uses a fixture-enabled run to replay a retained spool larger than 40 MB. It
checks normal EOF, the final checkpoint and custody offsets, terminal output,
and materialized output size. The test is skipped unless
`BATON_MONITOR_REPLAY_SPOOL_FIXTURE` names a data-only spool file. This source
coverage has not been qualified as a run for the current issue evidence.

## Remaining measurement

Measure database bytes read per spool byte on a source-matched, live-sized
accounts database and sanitized spool using the current index and read-only
connection implementation. Run the replay-level fixture with its required
input. Record the source and input hashes, database identity, commands, full
output and completed process status. The live accounts database must remain
untouched.

Until that measurement is recorded, there is no current replay byte ratio and
no measured basis for a performance claim about read-only connection reuse.
