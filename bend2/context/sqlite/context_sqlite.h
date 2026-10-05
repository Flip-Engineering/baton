/* Native linked-SQLite planner and replay operations for semantic context.
 *
 * This header is the published C contract for bend2/context/sqlite/. It is
 * subordinate to docs/bend2/semantic-context-spec.md (approved at exact base
 * 8a26bc3e7f9d5355b72f1291d95620b218b5c8e2, sha256
 * 66f1376bed70498699f6e3d4eb5b9bd7608d041a91110c5d5241997dbbc695df).
 *
 * Owners:
 *   - This module: semantic-impl-sqlite (implementation + tests under
 *     bend2/tests/context-sqlite/).
 *   - Result canonical serialization for the public result schema: the native
 *     codec owner. This module emits private observation records only; the
 *     hex string framing is an internal transport, not a public format.
 *   - Source-side SQL bytes and sourceBindingId: the clang-analyzer producer.
 *   - Final entry artifact and build integration: the native package owner;
 *     the child entry named here is provisional until that integration lands.
 *
 * All operations run inside a dedicated one-shot child process. The child owns
 * sqlite3_temp_directory, signal handling and the cancellation flag; the
 * coordinator process never calls these functions in-process.
 *
 * EXPLAIN operand convention (SQLite EXPLAIN columns): for OpenRead/OpenWrite
 * rows, p1 is the cursor, p2 is the rootpage and p3 is the database index
 * (0 = main). The plan join uses p3 == 0 and rootpage membership in the
 * captured main catalog. Authorizer READ events are planning observations;
 * SQLite raises them during prepare/reprepare, not per target row.
 */

#ifndef BATON_CONTEXT_SQLITE_H
#define BATON_CONTEXT_SQLITE_H

#include <signal.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

#define BATON_CONTEXT_SQLITE_ABI 2

/* Fixed stage tokens. They appear in the observation record's status object
 * and in the child's exit status mapping. `code` carries the SQLite result
 * code when a SQLite call failed and 0 otherwise; messages quote SQLite's own
 * error text without identifiers from the request. */
typedef enum BatonCtxSqlStage {
  BATON_CTX_SQL_OK = 0,
  BATON_CTX_SQL_INPUT_INVALID,          /* private input document rejected */
  BATON_CTX_SQL_TEMPDIR_UNAVAILABLE,    /* scratch configuration failed */
  BATON_CTX_SQL_OPEN_FAILED,
  BATON_CTX_SQL_IDENTITY_FAILED,        /* file or database identity capture */
  BATON_CTX_SQL_SNAPSHOT_FAILED,        /* BEGIN or fixed catalog queries */
  BATON_CTX_SQL_DROPMODULES_FAILED,     /* sqlite3_drop_modules(db, NULL) */
  BATON_CTX_SQL_AUTHORIZER_FAILED,      /* sqlite3_set_authorizer failed */
  BATON_CTX_SQL_SQL_UTF8,               /* SQL bytes are not valid UTF-8 */
  BATON_CTX_SQL_SQL_NUL,                /* SQL bytes contain NUL */
  BATON_CTX_SQL_SQL_EMPTY,              /* no nonempty statement */
  BATON_CTX_SQL_SQL_BIND,               /* statement exposes bind parameters */
  BATON_CTX_SQL_PREPARE_FAILED,         /* target statement prepare failed */
  BATON_CTX_SQL_NOT_READONLY,           /* prepared statement is not readonly */
  BATON_CTX_SQL_IS_EXPLAIN,             /* original statement is EXPLAIN */
  BATON_CTX_SQL_TAIL_REMAINS,           /* trailing statement or parse error */
  BATON_CTX_SQL_EXPLAIN_PREPARE_FAILED,
  BATON_CTX_SQL_EXPLAIN_STEP_FAILED,
  BATON_CTX_SQL_CANCELLED,              /* cancellation flag observed */
  BATON_CTX_SQL_CLOSE_FAILED,           /* finalize/close check failed */
  BATON_CTX_SQL_ALLOCATION_FAILED,
  BATON_CTX_SQL_SQL_LENGTH_EXCEEDS_INT, /* bytes exceed sqlite3_prepare_v2 int */
  BATON_CTX_SQL_TEMPSTORE_UNVERIFIED,   /* private replay temp_store check */
  BATON_CTX_SQL_REPLAY_REVISION_FAILED, /* a replay revision script failed */
  BATON_CTX_SQL_REPLAY_OPEN_TRANSACTION /* open transaction after the chain */
} BatonCtxSqlStage;

const char *baton_ctx_sql_stage_name(BatonCtxSqlStage stage);

/* ------------------------------------------------------------- planner ---
 *
 * The private child input document for the planner is one JSON object with
 * exactly the members:
 *
 *   {"version":1, "databasePath":<string>, "sqlBytes":<hex string>,
 *    "sourceBindingId":<string>, "scratchDirectory":<string>}
 *
 * sqlBytes is the lowercase hex encoding of the exact SQL statement bytes.
 * Hex carries the bytes without JSON escaping ambiguity between the source
 * producer and this operation; this framing is an internal transport and is
 * not a public schema. databasePath and sourceBindingId are UTF-8 strings;
 * NUL cannot appear. Unknown members refuse. The C API receives the decoded
 * values as counted buffers below; the NUL/UTF-8/length checks re-run inside
 * the operation.
 */
typedef struct BatonCtxSqlPlanInput {
  const char *databasePath;      /* ordinary pathname; no URI interpretation */
  const unsigned char *sql;      /* exact statement bytes; never NUL-terminated */
  size_t sqlLength;              /* byte length; 0 refuses */
  const char *sourceBindingId;   /* retained verbatim into the record */
  const char *scratchDirectory;  /* child-owned private directory for
                                    sqlite3_temp_directory; must already exist */
  volatile sig_atomic_t *cancelFlag; /* signal-handler-owned; nonzero cancels */
} BatonCtxSqlPlanInput;

/* ------------------------------------------------------------ replay ---
 *
 * Replay is two operations so native Bend logic can validate chain,
 * checksum and applied-prefix consistency between the live capture and any
 * private replay effect.
 *
 * Capture (live, read-only). Private child input document:
 *
 *   {"version":1, "databasePath":<string>,
 *    "applied":{"table":<string>,"revisionColumn":<string>,
 *               "checksumColumn":<string>},
 *    "scratchDirectory":<string>}
 *
 * It opens the admitted pathname SQLITE_OPEN_READONLY once and captures the
 * applied rows and the catalog in one read-only transaction. The live target
 * is never written.
 *
 * Execute (private, in-memory). Private child input document:
 *
 *   {"version":1,
 *    "revisions":[{"revision":<string>,"sha256":<64 lowercase hex>,
 *                  "sqlBytes":<hex string>}],
 *    "validatedPrefixCount":<u32>,
 *    "scratchDirectory":<string>}
 *
 * `revisions` is the captured chain in request order with the request sha256
 * identities echoed for custody. `validatedPrefixCount` names how many chain
 * entries the recorded applied set validated as a contiguous prefix; native
 * Bend validation must have run before this call. The operation replays
 * chain[0..validatedPrefixCount) on one private connection and the full chain
 * on another; both connections are :memory: with PRAGMA temp_store=MEMORY set
 * and verified before the authorizer installs. Revision identities are
 * strings; script bytes must not contain NUL.
 */
typedef struct BatonCtxSqlAppliedCaptureInput {
  const char *databasePath;
  const char *appliedTable;       /* validated identifier; quoted internally */
  const char *revisionColumn;
  const char *checksumColumn;
  const char *scratchDirectory;
  volatile sig_atomic_t *cancelFlag;
} BatonCtxSqlAppliedCaptureInput;

typedef struct BatonCtxSqlReplayRevision {
  const char *revision;           /* exact revision identity string */
  const char *sha256;             /* request chain sha256, echoed in outcomes */
  const unsigned char *sql;       /* exact script bytes */
  size_t sqlLength;
} BatonCtxSqlReplayRevision;

typedef struct BatonCtxSqlChainReplayInput {
  const BatonCtxSqlReplayRevision *revisions;
  size_t revisionCount;
  size_t validatedPrefixCount;    /* <= revisionCount; prefix connection set */
  const char *scratchDirectory;
  volatile sig_atomic_t *cancelFlag;
} BatonCtxSqlChainReplayInput;

/* --------------------------------------------------------------- output ---
 *
 * The operation emits one JSON observation record (no trailing newline) with
 * every string value hex-encoded under a `Hex` field suffix, so tabs,
 * newlines and decoded control bytes survive the C-to-Bend and child-stdout
 * transports. The member contract lives in
 * bend2/context/sqlite/observation-record-contract.md. The record always
 * contains the status object and the actually probed library identity;
 * operation sections are present when their capture completed before a
 * failure.
 */

typedef struct BatonCtxSqlOutput {
  BatonCtxSqlStage stage;        /* fixed stage token */
  int code;                      /* SQLite result code, or 0 */
  char *message;                 /* SQLite error text or NULL; NUL-terminated */
  char *record;                  /* observation record JSON; owned */
  size_t recordLength;           /* byte length of record */
} BatonCtxSqlOutput;

/* Runs the planner operation and fills `output`. Returns 0 when the operation
 * ran to a recorded outcome (including denied SQL and cancellation) and -1
 * only when no record could be produced. The caller owns the output strings
 * and releases them with baton_ctx_sql_output_free. */
int baton_ctx_sql_plan(const BatonCtxSqlPlanInput *input, BatonCtxSqlOutput *output);

/* Captures live applied rows and catalog; see above. */
int baton_ctx_sql_applied_capture(const BatonCtxSqlAppliedCaptureInput *input,
                                  BatonCtxSqlOutput *output);

/* Replays the validated prefix and the full chain into private databases;
 * see above. */
int baton_ctx_sql_chain_replay(const BatonCtxSqlChainReplayInput *input,
                               BatonCtxSqlOutput *output);

void baton_ctx_sql_output_free(BatonCtxSqlOutput *output);

/* Test instrumentation. Compiled only when BATON_CTX_SQL_TEST_TRACE is
 * defined; normal builds carry no trace callback. Returns the newline-joined
 * SQL texts of every statement the operations actually stepped on their
 * internal connections, or NULL when the build lacks instrumentation. The
 * EXPLAIN-only-stepping fixture asserts this log names the EXPLAIN statement
 * and never the admitted original. */
const char *baton_ctx_sql_test_trace_log(void);

#ifdef __cplusplus
}
#endif

#endif /* BATON_CONTEXT_SQLITE_H */
