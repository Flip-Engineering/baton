# Replay read amplification

Evidence from issue #943 and the recovery helper that replayed attempt
`receive:storage-policy-wonder-20261019:39309:bd5db51622561680553a73741a343108`.

## Trace

Artifacts:

- `/mnt/nvme4tb/retained-root-builds-20261019/storage39309-io-offsets.trace`
  SHA-256 `a2cc9af3ca9e48852d44bdf3153947a7b88c868f925896e66959917d1b5a3ffd`
- `/mnt/nvme4tb/retained-root-builds-20261019/storage39309-io-offset-summary.json`
  SHA-256 `480af84b75785a505f7fd92f8de802f7d3cb985a8fd8ae2cce977c1cc2dbf5e6`

A six-second `strace` of the recovery worker recorded 39,292 `pread64` calls
and 159,828,580 bytes from the 330,878,976-byte accounts database while
reading 57,344 bytes of retained stdout and 6,367 bytes of attempt JSONL. The
stdout offsets advanced from 2,137,437 to 2,151,283, so replay was advancing.

The trace contains 77 opens of the accounts database: 42 read-write opens and
35 read-only opens. Seven long read-write connections each read about 22.3 MB
from 1,922 distinct pages. Each long connection reads the same pages three
times. The short read-only connections read 11 to 18 pages each; the short
read-write connections read 11 to 74 pages each.

## Per-frame sites

The long read-write connection is the `Store.apply(C.Observe)` transaction
that records a terminal frame. `completion_sql_expr` in
`bend2/src/coordinator/commands.bend` evaluates `completion_pending_sql`
twice and `completion_oldest_sql` once. The `messages` table has a unique
index on `id` and no index on `recipient` or `receipt`. SQLite's plan for each
of the three subqueries is `SCAN messages`.

Each 8 KB stdout read in the trace is paired with one long read-write
connection and about ten short connections. The short connections come from
the per-frame read and span calls. `baton_sql_read_call` opens a fresh
read-only SQLite connection, runs `PRAGMA foreign_keys=ON`, runs
`baton_sql_encoding_status` (`PRAGMA encoding`), executes the caller SQL and
closes the connection. `sqlite3_prepare_v2` on `PRAGMA encoding` reads the
schema and initializes FTS5, so every call pays the schema setup again.
`baton_sql_span_call` and `baton_sql_call` open read-write connections with
`PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL` for the same per-call
lifetime.

## Fix

`C.schema()` now creates the partial index `messages_pending` on
`messages(recipient,seq) WHERE receipt IS NULL`. The pending count and the
oldest-pending read search the pending entries directly. The index is part of
the caller schema. A database with no index, including the live database, gets
the partial index on the first install or repair. A database that already
carries the earlier same-name full index keeps that full index because
CREATE INDEX IF NOT EXISTS does not replace it. No release was cut in the
intermediate full-index window, so no deployed database has this state. Fresh
and current-main databases create the partial index.

The law literal in `bend2/src/coordinator/laws.bend` includes the same index
text. The focused projection fixture uses the index in its representative
caller schema.

## Counters

A disposable accounts-like database of 30,000 messages and a 158-byte terminal
event was measured with `/proc/self/io` `rchar` for the exact
`completion_sql_expr` shape: two pending counts and one oldest-pending read.

| Plan | Process rchar | Process rchar per spool byte |
| --- | ---: | ---: |
| `SCAN messages` three times | 23,101,575 | 146,212.5 |
| full `messages_pending(recipient,receipt,seq)` | 37,002 | 234.2 |
| partial `messages_pending(recipient,seq) WHERE receipt IS NULL` | 28,806 | 182.3 |

The partial index result was 802 times smaller than the scan. Root measured
24,899 bytes for the partial index against 33,091 bytes for the full index on
its fixture. The reconciliation value was identical: `pendingCount` 30 and
`oldestPendingId` `m029970`.

The trace ratio was 2,787 database bytes per stdout byte. The seven long
read-write connections contributed about 156 MB of the 159.8 MB. Replacing
those scans with the index leaves the per-frame read-call setup as the next
term.

## Index cost

On the 30,000-row fixture the partial index occupies 4,096 bytes and the full
index occupies 831,488 bytes. Inserts on the partial-index database took
0.768 s versus 0.967 s on the full-index database. Building the index on
pre-existing rows took 82.2 ms.

## Read-call setup

Ten fresh read-only connections that ran `PRAGMA foreign_keys=ON`,
`PRAGMA encoding` and `SELECT 1` reported 43,180 bytes of process `rchar`.
Ten repetitions on one connection reported 4,218 bytes. The trace's 35
read-only opens at 11-18 pages of 4096 bytes account for 1.577-2.580 MB, or
0.99-1.62% of the 159,828,580 traced bytes. The ten-connection process
`rchar` measurement scales to 151,130 bytes for 35 opens, or 0.095%. The
trace range is the traced-byte share; the benchmark value is the read-call
setup estimate. Most of the residual after the index is the per-frame
read-write span and query setup.

The cached read-only connection in commit `6f219c0a` implements the read-call
reduction: one connection per IO helper thread, keyed by path, device and
inode, with per-call busy and foreign-keys, autocommit rollback, path and
file-replacement invalidation, fork reset, UTF-8 refusal, error close and
thread-exit cleanup. `bend2/test/sqlite-read-reuse.py` covers the lifecycle,
visibility, busy, fork and teardown cases. The per-frame read-write span and
query setup remain a separate residual.

## Invariants

The index is a schema object. It does not change replay cursor, EOF, spool
contents, message rows, session state, checkpoints, custody or process
ownership. `bend2/test/replay-read-amplification.py` is an SQL microbenchmark
for the production query shape. It asserts the production
`completion_pending_sql` and `completion_oldest_sql` fragments and the partial
index predicate, then measures the plan and database reads. It does not drive
replay and makes no cursor, EOF or custody claim.

## Limits

The counters use a synthetic accounts-like database, not the live accounts
database. The live database and worker were not touched. No full native build
ran. The projection fixture checks the index in its representative schema; the
law literal records the same text. The partial-index process `rchar` above is
28,806 bytes; root measured 24,899 bytes against 33,091 bytes for the full
index on its fixture.
