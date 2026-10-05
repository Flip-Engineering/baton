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
 *     codec owner. This module emits private observation records only.
 *   - Source-side SQL bytes and sourceBindingId: the clang-analyzer producer.
 *
 * Both operations run inside a dedicated one-shot child process (the packaged
 * entry baton2-context-sqlite). The child owns sqlite3_temp_directory, signal
 * handling and the cancellation flag; the coordinator process never calls the
 * operation in-process.
 */

#ifndef BATON_CONTEXT_SQLITE_H
#define BATON_CONTEXT_SQLITE_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

#define BATON_CONTEXT_SQLITE_ABI 1

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
  BATON_CTX_SQL_TAIL_REMAINS,           /* trailing statement or garbage */
  BATON_CTX_SQL_EXPLAIN_PREPARE_FAILED,
  BATON_CTX_SQL_EXPLAIN_STEP_FAILED,
  BATON_CTX_SQL_CANCELLED,              /* cancellation flag observed */
  BATON_CTX_SQL_CLOSE_FAILED,           /* finalize/close check failed */
  BATON_CTX_SQL_ALLOCATION_FAILED,
  BATON_CTX_SQL_REPLAY_REVISION_FAILED, /* a replay revision script failed */
  BATON_CTX_SQL_REPLAY_OPEN_TRANSACTION /* open transaction after the chain */
} BatonCtxSqlStage;

const char *baton_ctx_sql_stage_name(BatonCtxSqlStage stage);

/* ---------------------------------------------------------------- input ---
 *
 * The private child input document for the planner is one JSON object with
 * exactly the members:
 *
 *   {"version":1, "databasePath":<string>, "sqlBytes":<hex string>,
 *    "sourceBindingId":<string>}
 *
 * sqlBytes is the lowercase hex encoding of the exact SQL statement bytes.
 * Hex carries the bytes without JSON escaping ambiguity between the source
 * producer and this operation. databasePath and sourceBindingId are UTF-8
 * strings; NUL cannot appear. Unknown members refuse. The C API receives the
 * decoded values as counted buffers below; the hex/NUL/UTF-8 checks re-run
 * inside the operation.
 */

typedef struct BatonCtxSqlPlanInput {
  const char *databasePath;      /* ordinary pathname; no URI interpretation */
  const unsigned char *sql;      /* exact statement bytes; never NUL-terminated */
  size_t sqlLength;              /* byte length; 0 refuses */
  const char *sourceBindingId;   /* retained verbatim into the record */
  volatile int *cancelFlag;      /* child-owned; nonzero requests cancellation */
} BatonCtxSqlPlanInput;

/* The private child input document for replay is one JSON object:
 *
 *   {"version":1, "databasePath":<string>,
 *    "applied":{"table":<string>,"revisionColumn":<string>,
 *               "checksumColumn":<string>},
 *    "revisions":[{"revision":<string>,"sqlBytes":<hex string>}]}
 *
 * `revisions` is the captured chain in request order; identities are strings
 * (numeric revision values refuse upstream). The operation reads the live
 * applied rows and catalog in one read-only transaction, then replays, on two
 * separate private :memory: connections, the chain entries whose revision
 * identity appears in the live applied rows (the applied prefix) and the full
 * chain (the head).
 */
typedef struct BatonCtxSqlReplayApplied {
  const char *table;
  const char *revisionColumn;
  const char *checksumColumn;
} BatonCtxSqlReplayApplied;

typedef struct BatonCtxSqlReplayRevision {
  const char *revision;          /* exact revision identity string */
  const unsigned char *sql;      /* exact script bytes */
  size_t sqlLength;
} BatonCtxSqlReplayRevision;

typedef struct BatonCtxSqlReplayInput {
  const char *databasePath;
  BatonCtxSqlReplayApplied applied;
  const BatonCtxSqlReplayRevision *revisions;
  size_t revisionCount;
  volatile int *cancelFlag;
} BatonCtxSqlReplayInput;

/* --------------------------------------------------------------- output ---
 *
 * The operation emits one JSON observation record (no trailing newline) with
 * every string value hex-encoded under a `Hex` field suffix, so tabs,
 * newlines and decoded control bytes survive the C-to-Bend and child-stdout
 * transports. The full member contract lives in
 * bend2/context/sqlite/observation-record-contract.md. The record always
 * contains the status object; plan/replay sections are present when their
 * capture completed before a failure.
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

/* Runs the replay operation with the same output ownership rules. */
int baton_ctx_sql_replay(const BatonCtxSqlReplayInput *input, BatonCtxSqlOutput *output);

void baton_ctx_sql_output_free(BatonCtxSqlOutput *output);

#ifdef __cplusplus
}
#endif

#endif /* BATON_CONTEXT_SQLITE_H */
