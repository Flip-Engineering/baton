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

`C.schema()` now creates `messages_pending` on
`messages(recipient,receipt,seq)`. The pending count becomes a covering index
search and the oldest-pending read becomes an ordered index search. The index
is part of the caller schema, so the projection installer creates it on the
first stale install after deployment and the schema-version marker records the
new state.

The law literal in `bend2/src/coordinator/laws.bend` includes the same index
text. The focused projection fixture uses the index in its representative
caller schema.

## Counters

A disposable accounts-like database of 30,000 messages and a 158-byte terminal
spool event was measured with `/proc/self/io` `rchar` for the exact
`completion_sql_expr` shape: two pending counts and one oldest-pending read.

| Plan | Bytes | Database bytes per spool byte |
| --- | ---: | ---: |
| `SCAN messages` three times | 23,101,575 | 146,212.5 |
| `messages_pending` searches | 37,002 | 234.2 |

The indexed result was 624 times smaller. The reconciliation value was
identical: `pendingCount` 30 and `oldestPendingId` `m029970`.

The trace ratio was 2,787 database bytes per stdout byte. The long observation
transaction contributed about 22.3 MB of the 159.8 MB. Replacing that scan
with the index leaves the per-frame read-call setup as the next term.

## Read-call setup

Ten fresh read-only connections that ran `PRAGMA foreign_keys=ON`,
`PRAGMA encoding` and `SELECT 1` read 43,180 bytes. Ten repetitions on one
connection read 4,218 bytes. A bounded per-thread read-only connection reuse
would remove most of this setup, approximately 1% of the traced bytes before
the index and most of the residual after the index. That change needs
per-thread ownership, path and file-replacement invalidation, fork reset,
autocommit checks, UTF-8 refusal, statement finalization and teardown. It is a
separate change; this fix does not alter connection lifetime.

## Invariants

The index is a schema object. It does not change replay cursor, EOF, spool
contents, message rows, session state, checkpoints, custody or process
ownership. `bend2/test/replay-read-amplification.py` holds the spool cursor,
EOF, message count and database inode fixed across the before and after runs.

## Limits

The counters use a synthetic accounts-like database, not the live accounts
database. The live database and worker were not touched. No full native build
ran. The projection fixture checks the index in its representative schema; the
law literal records the same text.
