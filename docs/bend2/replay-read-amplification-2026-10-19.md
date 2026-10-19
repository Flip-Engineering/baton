# Replay read amplification

Evidence from issue #943 and the recovery helper that replayed attempt
receive:storage-policy-wonder-20261019:39309:bd5db51622561680553a73741a343108.

## Trace

Artifacts:

- /mnt/nvme4tb/retained-root-builds-20261019/storage39309-io-offsets.trace
  SHA-256 a2cc9af3ca9e48852d44bdf3153947a7b88c868f925896e66959917d1b5a3ffd
- /mnt/nvme4tb/retained-root-builds-20261019/storage39309-io-offset-summary.json
  SHA-256 480af84b75785a505f7fd92f8de802f7d3cb985a8fd8ae2cce977c1cc2dbf5e6

A six-second strace of the recovery worker recorded 39,292 pread64 calls
and 159,828,580 bytes from the 330,878,976-byte accounts database while
reading 57,344 bytes of retained stdout and 6,367 bytes of attempt JSONL. The
stdout offsets advanced from 2,137,437 to 2,151,283, so replay was advancing.

The trace contains 77 opens of the accounts database: 42 read-write opens and
35 read-only opens. Seven long read-write connections each read about 22.3 MB
from 1,922 distinct pages. Each long connection reads the same pages three
times. The short read-only connections read 11 to 18 pages each; the short
read-write connections read 11 to 74 pages each.

## Per-frame sites

The long read-write connection is the Store.apply(C.Observe) transaction that
records a terminal frame. completion_sql_expr in
bend2/src/coordinator/commands.bend evaluates completion_pending_sql twice and
completion_oldest_sql once. The messages table has a unique index on id and
no index on recipient or receipt. SQLite's plan for each of the three
subqueries is SCAN messages.

Each 8 KB stdout read in the trace is paired with one long read-write
connection and about ten short connections. The short connections come from
the per-frame read and span calls. baton_sql_read_call opens a fresh read-only
SQLite connection, runs PRAGMA foreign_keys=ON, runs
baton_sql_encoding_status (PRAGMA encoding), executes the caller SQL and
closes the connection. sqlite3_prepare_v2 on PRAGMA encoding reads the schema
and initializes FTS5, so every call pays the schema setup again.
baton_sql_span_call and baton_sql_call open read-write connections with
PRAGMA foreign_keys=ON and PRAGMA synchronous=FULL for the same per-call
lifetime.

## Fix

C.schema() now creates the partial index messages_pending on
messages(recipient,seq) WHERE receipt IS NULL. The pending count uses an index
search, and the oldest-pending read uses that index in sequence order. The
partial predicate stores only unacknowledged messages. The schema is installed
through the existing projection setup path.

The law literal in bend2/src/coordinator/laws.bend includes the same index
text. The focused projection fixture uses the index in its representative
caller schema.

## Counters

A disposable accounts-like database of 30,000 messages and a 186-byte spool
was measured with /proc/self/io rchar for the query shape asserted against
completion_sql_expr: two pending counts and one oldest-pending read. The SQL
fixture keeps the same rows and output across the three index variants.

| Index | Bytes read | Bytes per spool byte |
| --- | ---: | ---: |
| None | 23,097,665 | 124,181.0 |
| Full (recipient,receipt,seq) | 33,091 | 177.9 |
| Partial (recipient,seq) WHERE receipt IS NULL | 24,899 | 133.9 |

All variants returned pendingCount 30 and oldestPendingId m029970. In a
separate 30,001-row size fixture, the partial index used 8,232,960 bytes
(2,010 pages) and the full index used 8,962,048 bytes (2,188 pages). These are
synthetic SQLite measurements, not end-to-end replay timings.

The trace ratio was 2,787 database bytes per stdout byte. The long observation
transactions contributed about 156 MB of the 159.8 MB. Replacing that scan
with the partial index reduces the measured query work, while the trace also
shows per-frame read-call setup.

## Read-call setup

Ten fresh read-only connections that ran PRAGMA foreign_keys=ON,
PRAGMA encoding and SELECT 1 read 43,180 bytes. Ten repetitions on one
connection read 4,218 bytes. The difference is 3,896 bytes per read on this
small setup fixture. Applied to the 35 short read-only opens in the trace, it
accounts for about 0.085% of the measured 159.8 MB. Connection reuse is a
separate change and requires per-thread ownership, path and file-replacement
invalidation, fork reset, autocommit checks, UTF-8 refusal, statement
finalization and teardown.

## Invariants

The index is a schema object. It preserves the query result and message
identity. The SQL fixture checks that the spool file is unchanged and the
database inode is stable while the index is installed. It does not run a
replay or establish cursor, EOF, checkpoint, custody or process-ownership
behavior.

## Limits

The counters use a synthetic accounts-like database, not the live accounts
database. The live database and worker were not touched. No full native build
ran. The projection fixture checks the partial index in its representative
schema; the source-shape assertions verify the pending query predicates and
subquery counts used by the SQL fixture. The law literal records the same
index text.
