/* Native linked-SQLite planner and replay operations for semantic context.
 *
 * Implements bend2/context/sqlite/context_sqlite.h. All behavior follows
 * docs/bend2/semantic-context-spec.md: read-only planner with a captured
 * ordinary-main catalog, SELECT+READ target authorizer, explicit byte
 * lengths, EXPLAIN-only stepping, checked cleanup; two-phase migration
 * replay with a private in-memory prefix/head replay, fixed action and
 * pragma allowlists, and a signal-owned cancellation flag. No statement,
 * row, output-size or time cutoff exists anywhere in this file; the only
 * length boundary is the sqlite3_prepare_v2 int parameter.
 *
 * Authorizer argument facts (sqlite3.h): SQLITE_SELECT passes no arguments;
 * SQLITE_READ passes (table, column) only, so planner admission checks table
 * membership in the captured ordinary-main set; CREATE/DROP actions carry
 * the database name in arg3; SQLITE_PRAGMA carries the name in arg1;
 * SQLITE_FUNCTION carries the function name in arg2.
 */

#include "context_sqlite.h"

#include <sqlite3.h>

#include <dlfcn.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>

/* ------------------------------------------------------------ builder --- */

typedef struct Buf {
  char *data;
  size_t len, cap;
  int oom;
} Buf;

static void buf_init(Buf *b) { b->data = NULL; b->len = 0; b->cap = 0; b->oom = 0; }

static void buf_add(Buf *b, const char *bytes, size_t n) {
  if (b->oom || !bytes) return;
  if (b->len + n + 1 > b->cap) {
    size_t cap = b->cap ? b->cap : 256;
    while (cap < b->len + n + 1) cap *= 2;
    char *next = realloc(b->data, cap);
    if (!next) { b->oom = 1; return; }
    b->data = next;
    b->cap = cap;
  }
  memcpy(b->data + b->len, bytes, n);
  b->len += n;
  b->data[b->len] = 0;
}

static void buf_lit(Buf *b, const char *s) { buf_add(b, s, strlen(s)); }

static void buf_num(Buf *b, long long v) {
  char tmp[32];
  snprintf(tmp, sizeof(tmp), "%lld", v);
  buf_lit(b, tmp);
}

static void buf_ull(Buf *b, unsigned long long v) {
  char tmp[32];
  snprintf(tmp, sizeof(tmp), "%llu", v);
  buf_lit(b, tmp);
}

static const char HEX_DIGITS[] = "0123456789abcdef";

static void buf_hex_bytes(Buf *b, const void *value, size_t n) {
  const unsigned char *v = value;
  for (size_t i = 0; i < n; i++) {
    char pair[2] = { HEX_DIGITS[v[i] >> 4], HEX_DIGITS[v[i] & 15] };
    buf_add(b, pair, 2);
  }
}

/* Emits a hex string JSON value ("hex" or null) for array elements. */
static void buf_hex_value(Buf *b, const void *value, size_t n) {
  if (!value) { buf_lit(b, "null"); return; }
  buf_lit(b, "\"");
  buf_hex_bytes(b, value, n);
  buf_lit(b, "\"");
}

/* Emits ,"key":"<lowercase hex>" or ,"key":null. */
static void buf_hex_field(Buf *b, const char *key, const void *value, size_t n) {
  buf_lit(b, ",\"");
  buf_lit(b, key);
  buf_lit(b, "\":");
  buf_hex_value(b, value, n);
}

/* --------------------------------------------------------------- text --- */

static int utf8_valid(const unsigned char *s, size_t n) {
  size_t i = 0;
  while (i < n) {
    unsigned char c = s[i];
    if (c < 0x80) { i++; continue; }
    int need;
    unsigned long cp;
    if ((c & 0xE0) == 0xC0) { need = 1; cp = c & 0x1Fu; }
    else if ((c & 0xF0) == 0xE0) { need = 2; cp = c & 0x0Fu; }
    else if ((c & 0xF8) == 0xF0) { need = 3; cp = c & 0x07u; }
    else return 0;
    if (n - i - 1 < (size_t)need) return 0;
    for (int k = 1; k <= need; k++) {
      if ((s[i + (size_t)k] & 0xC0) != 0x80) return 0;
      cp = (cp << 6) | (unsigned long)(s[i + (size_t)k] & 0x3Fu);
    }
    if (need == 1 && cp < 0x80) return 0;
    if (need == 2 && cp < 0x800) return 0;
    if (need == 3 && cp < 0x10000) return 0;
    if (cp > 0x10FFFF) return 0;
    if (cp >= 0xD800 && cp <= 0xDFFF) return 0;
    i += (size_t)need + 1;
  }
  return 1;
}

static int bytes_contain_nul(const unsigned char *s, size_t n) {
  for (size_t i = 0; i < n; i++) if (s[i] == 0) return 1;
  return 0;
}

/* Strict identifier for caller-supplied applied table/columns: letters,
 * digits and underscore, not starting with a digit. */
static int valid_identifier(const char *s) {
  if (!s || !*s) return 0;
  if (!(  (*s >= 'A' && *s <= 'Z') || (*s >= 'a' && *s <= 'z') || *s == '_' )) return 0;
  for (const char *p = s; *p; p++) {
    char c = *p;
    if (!( (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
           (c >= '0' && c <= '9') || c == '_' )) return 0;
  }
  return 1;
}

static void buf_quote_identifier(Buf *b, const char *name) {
  buf_lit(b, "\"");
  for (const char *p = name; *p; p++) {
    if (*p == '"') buf_lit(b, "\"\"");
    else buf_add(b, p, 1);
  }
  buf_lit(b, "\"");
}

static char *dup_bytes(const void *s, size_t n) {
  char *out = malloc(n + 1);
  if (!out) return NULL;
  if (s) memcpy(out, s, n);
  out[n] = 0;
  return out;
}

/* --------------------------------------------------------- trace hook --- */

#ifdef BATON_CTX_SQL_TEST_TRACE
static Buf g_trace;
static int trace_cb(unsigned int mask, void *context, void *p, void *x) {
  (void)mask; (void)context; (void)p;
  const char *sql = (const char *)x;
  if (sql) {
    buf_lit(&g_trace, sql);
    buf_lit(&g_trace, "\n");
  }
  return SQLITE_OK;
}
const char *baton_ctx_sql_test_trace_log(void) { return g_trace.data; }
static void trace_install(sqlite3 *db) {
  sqlite3_trace_v2(db, SQLITE_TRACE_STMT, trace_cb, NULL);
}
#else
const char *baton_ctx_sql_test_trace_log(void) { return NULL; }
static void trace_install(sqlite3 *db) { (void)db; }
#endif

/* ------------------------------------------------------- authorizer ----- */

enum { AUTH_CAPTURE = 0, AUTH_PLANNER = 1, AUTH_REPLAY = 2 };

typedef struct AuthEvent {
  const char *phase;
  int action;
  const char *actionName;
  char *arg1, *arg2, *arg3, *arg4;
  int allow;
  const char *reason;              /* fixed token when denied */
  struct AuthEvent *next;
} AuthEvent;

typedef struct AuthCtx {
  int mode;
  const char *phase;
  AuthEvent *head, *tail;
  size_t count;
  int oom;
  char **objectNames;              /* planner-admitted ordinary main names */
  size_t objectCount;
} AuthCtx;

static const char *action_name(int action) {
  switch (action) {
    case SQLITE_CREATE_INDEX: return "SQLITE_CREATE_INDEX";
    case SQLITE_CREATE_TABLE: return "SQLITE_CREATE_TABLE";
    case SQLITE_CREATE_TEMP_INDEX: return "SQLITE_CREATE_TEMP_INDEX";
    case SQLITE_CREATE_TEMP_TABLE: return "SQLITE_CREATE_TEMP_TABLE";
    case SQLITE_CREATE_TEMP_TRIGGER: return "SQLITE_CREATE_TEMP_TRIGGER";
    case SQLITE_CREATE_VIEW: return "SQLITE_CREATE_VIEW";
    case SQLITE_CREATE_TEMP_VIEW: return "SQLITE_CREATE_TEMP_VIEW";
    case SQLITE_CREATE_TRIGGER: return "SQLITE_CREATE_TRIGGER";
    case SQLITE_DELETE: return "SQLITE_DELETE";
    case SQLITE_DROP_INDEX: return "SQLITE_DROP_INDEX";
    case SQLITE_DROP_TABLE: return "SQLITE_DROP_TABLE";
    case SQLITE_DROP_TEMP_INDEX: return "SQLITE_DROP_TEMP_INDEX";
    case SQLITE_DROP_TEMP_TABLE: return "SQLITE_DROP_TEMP_TABLE";
    case SQLITE_DROP_TEMP_TRIGGER: return "SQLITE_DROP_TEMP_TRIGGER";
    case SQLITE_DROP_TEMP_VIEW: return "SQLITE_DROP_TEMP_VIEW";
    case SQLITE_DROP_TRIGGER: return "SQLITE_DROP_TRIGGER";
    case SQLITE_DROP_VIEW: return "SQLITE_DROP_VIEW";
    case SQLITE_INSERT: return "SQLITE_INSERT";
    case SQLITE_PRAGMA: return "SQLITE_PRAGMA";
    case SQLITE_READ: return "SQLITE_READ";
    case SQLITE_SELECT: return "SQLITE_SELECT";
    case SQLITE_TRANSACTION: return "SQLITE_TRANSACTION";
    case SQLITE_UPDATE: return "SQLITE_UPDATE";
    case SQLITE_ATTACH: return "SQLITE_ATTACH";
    case SQLITE_DETACH: return "SQLITE_DETACH";
    case SQLITE_ALTER_TABLE: return "SQLITE_ALTER_TABLE";
    case SQLITE_REINDEX: return "SQLITE_REINDEX";
    case SQLITE_ANALYZE: return "SQLITE_ANALYZE";
    case SQLITE_CREATE_VTABLE: return "SQLITE_CREATE_VTABLE";
    case SQLITE_DROP_VTABLE: return "SQLITE_DROP_VTABLE";
    case SQLITE_FUNCTION: return "SQLITE_FUNCTION";
    case SQLITE_SAVEPOINT: return "SQLITE_SAVEPOINT";
    case SQLITE_RECURSIVE: return "SQLITE_RECURSIVE";
    default: return "SQLITE_UNKNOWN";
  }
}

static AuthEvent *auth_record(AuthCtx *ctx, int action, const char *a1,
                              const char *a2, const char *a3, const char *a4,
                              int allow, const char *reason) {
  AuthEvent *e = calloc(1, sizeof(*e));
  if (!e) { ctx->oom = 1; return NULL; }
  e->phase = ctx->phase;
  e->action = action;
  e->actionName = action_name(action);
  e->arg1 = a1 ? dup_bytes(a1, strlen(a1)) : NULL;
  e->arg2 = a2 ? dup_bytes(a2, strlen(a2)) : NULL;
  e->arg3 = a3 ? dup_bytes(a3, strlen(a3)) : NULL;
  e->arg4 = a4 ? dup_bytes(a4, strlen(a4)) : NULL;
  e->allow = allow;
  e->reason = reason;
  if ((a1 && !e->arg1) || (a2 && !e->arg2) || (a3 && !e->arg3) || (a4 && !e->arg4)) {
    ctx->oom = 1;
    free(e->arg1); free(e->arg2); free(e->arg3); free(e->arg4); free(e);
    return NULL;
  }
  if (ctx->tail) ctx->tail->next = e; else ctx->head = e;
  ctx->tail = e;
  ctx->count++;
  return e;
}

static int planner_object_admitted(const AuthCtx *ctx, const char *name) {
  if (!name) return 0;
  for (size_t i = 0; i < ctx->objectCount; i++)
    if (strcmp(ctx->objectNames[i], name) == 0) return 1;
  return 0;
}

/* Fixed replay pragma allowlist, matched with sqlite3_stricmp. */
static const char *const replay_pragmas[] = {
  "foreign_keys", "legacy_alter_table", "defer_foreign_keys", "user_version",
  "table_info", "table_xinfo", "table_list", "index_list", "index_info",
  "index_xinfo", "foreign_key_list", "database_list", "schema_version",
  "application_id", "encoding", "page_size", "secure_delete",
};

static int replay_pragma_admitted(const char *name) {
  if (!name) return 0;
  for (size_t i = 0; i < sizeof(replay_pragmas) / sizeof(replay_pragmas[0]); i++)
    if (sqlite3_stricmp(name, replay_pragmas[i]) == 0) return 1;
  return 0;
}

static int replay_ddl_action(int action) {
  switch (action) {
    case SQLITE_CREATE_INDEX: case SQLITE_CREATE_TABLE:
    case SQLITE_CREATE_TEMP_INDEX: case SQLITE_CREATE_TEMP_TABLE:
    case SQLITE_CREATE_TEMP_TRIGGER: case SQLITE_CREATE_VIEW:
    case SQLITE_CREATE_TEMP_VIEW: case SQLITE_CREATE_TRIGGER:
    case SQLITE_DROP_INDEX: case SQLITE_DROP_TABLE:
    case SQLITE_DROP_TEMP_INDEX: case SQLITE_DROP_TEMP_TABLE:
    case SQLITE_DROP_TEMP_TRIGGER: case SQLITE_DROP_TEMP_VIEW:
    case SQLITE_DROP_TRIGGER: case SQLITE_DROP_VIEW:
      return 1;
    default:
      return 0;
  }
}

static int auth_cb(void *context, int action, const char *a1, const char *a2,
                   const char *a3, const char *a4) {
  AuthCtx *ctx = context;
  int allow = 0;
  const char *reason = NULL;
  if (ctx->mode == AUTH_CAPTURE) {
    allow = 1;
  } else if (ctx->mode == AUTH_PLANNER) {
    if (action == SQLITE_SELECT) {
      allow = 1;
    } else if (action == SQLITE_READ) {
      /* READ carries (table, column); ordinary main objects were captured
         before this authorizer installed. */
      if (!planner_object_admitted(ctx, a1)) reason = "objectNotCaptured";
      else allow = 1;
    } else {
      reason = "actionNotAdmitted";
    }
  } else { /* AUTH_REPLAY */
    if (action == SQLITE_PRAGMA) {
      if (replay_pragma_admitted(a1)) allow = 1;
      else reason = "pragmaNameNotAdmitted";
    } else if (action == SQLITE_FUNCTION) {
      if (a2 && sqlite3_stricmp(a2, "load_extension") == 0)
        reason = "functionNameNotAdmitted";
      else allow = 1;
    } else if (replay_ddl_action(action)) {
      if (a3 && (strcmp(a3, "main") == 0 || strcmp(a3, "temp") == 0)) allow = 1;
      else reason = "databaseNotAdmitted";
    } else if (action == SQLITE_SELECT || action == SQLITE_READ ||
               action == SQLITE_TRANSACTION || action == SQLITE_SAVEPOINT ||
               action == SQLITE_RECURSIVE || action == SQLITE_INSERT ||
               action == SQLITE_UPDATE || action == SQLITE_DELETE ||
               action == SQLITE_ALTER_TABLE || action == SQLITE_REINDEX ||
               action == SQLITE_ANALYZE) {
      allow = 1;
    } else {
      reason = "actionNotAdmitted"; /* ATTACH, DETACH, VTABLE, COPY, unknown */
    }
  }
  auth_record(ctx, action, a1, a2, a3, a4, allow, reason);
  if (ctx->oom) return SQLITE_DENY;
  return allow ? SQLITE_OK : SQLITE_DENY;
}

static void auth_events_free(AuthCtx *ctx) {
  AuthEvent *e = ctx->head;
  while (e) {
    AuthEvent *next = e->next;
    free(e->arg1); free(e->arg2); free(e->arg3); free(e->arg4); free(e);
    e = next;
  }
  ctx->head = ctx->tail = NULL;
  ctx->count = 0;
  for (size_t i = 0; i < ctx->objectCount; i++) free(ctx->objectNames[i]);
  free(ctx->objectNames);
  ctx->objectNames = NULL;
  ctx->objectCount = 0;
}

static void auth_json(Buf *b, const AuthCtx *ctx) {
  buf_lit(b, "\"authorizer\":[");
  int first = 1;
  for (AuthEvent *e = ctx->head; e; e = e->next) {
    if (!first) buf_lit(b, ",");
    first = 0;
    buf_lit(b, "{\"phase\":");
    buf_hex_value(b, e->phase, e->phase ? strlen(e->phase) : 0);
    buf_lit(b, ",\"action\":");
    buf_num(b, e->action);
    buf_hex_field(b, "actionNameHex", e->actionName,
                  e->actionName ? strlen(e->actionName) : 0);
    buf_hex_field(b, "arg1Hex", e->arg1, e->arg1 ? strlen(e->arg1) : 0);
    buf_hex_field(b, "arg2Hex", e->arg2, e->arg2 ? strlen(e->arg2) : 0);
    buf_hex_field(b, "arg3Hex", e->arg3, e->arg3 ? strlen(e->arg3) : 0);
    buf_hex_field(b, "arg4Hex", e->arg4, e->arg4 ? strlen(e->arg4) : 0);
    buf_lit(b, ",\"decision\":\"");
    buf_lit(b, e->allow ? "allow" : "deny");
    buf_lit(b, "\"");
    buf_hex_field(b, "reasonHex", e->reason, e->reason ? strlen(e->reason) : 0);
    buf_lit(b, "}");
  }
  buf_lit(b, "]");
}

/* ---------------------------------------------------------- row capture */

typedef struct Row {
  char **vals;                     /* ncols entries; NULL when SQL NULL */
  size_t *lens;                    /* exact byte lengths of each value */
} Row;

typedef struct Rows {
  int ncols;
  char **names;                    /* owned column names */
  size_t *nameLens;
  Row *rows;
  size_t nrows, cap;
  int oom;
} Rows;

static void rows_free(Rows *r) {
  if (r->names)
    for (int i = 0; i < r->ncols; i++) free(r->names[i]);
  free(r->names);
  free(r->nameLens);
  for (size_t i = 0; i < r->nrows; i++) {
    if (r->rows[i].vals)
      for (int c = 0; c < r->ncols; c++) free(r->rows[i].vals[c]);
    free(r->rows[i].vals);
    free(r->rows[i].lens);
  }
  free(r->rows);
  memset(r, 0, sizeof(*r));
}

/* Captures every row of a fixed internal query as exact byte values. */
static int rows_capture(Rows *r, sqlite3 *db, const char *sql, int *code,
                        char **message) {
  memset(r, 0, sizeof(*r));
  sqlite3_stmt *stmt = NULL;
  int rc = sqlite3_prepare_v2(db, sql, -1, &stmt, NULL);
  if (rc != SQLITE_OK) {
    *code = rc;
    const char *m = sqlite3_errmsg(db);
    if (message) *message = m ? dup_bytes(m, strlen(m)) : NULL;
    return -1;
  }
  r->ncols = sqlite3_column_count(stmt);
  if (r->ncols > 0) {
    r->names = calloc((size_t)r->ncols, sizeof(char *));
    r->nameLens = calloc((size_t)r->ncols, sizeof(size_t));
    if (!r->names || !r->nameLens) { r->oom = 1; sqlite3_finalize(stmt); return -1; }
  }
  for (int c = 0; c < r->ncols; c++) {
    const char *name = sqlite3_column_name(stmt, c);
    if (name) {
      r->names[c] = dup_bytes(name, strlen(name));
      r->nameLens[c] = strlen(name);
      if (!r->names[c]) { r->oom = 1; sqlite3_finalize(stmt); return -1; }
    }
  }
  for (;;) {
    rc = sqlite3_step(stmt);
    if (rc == SQLITE_DONE) break;
    if (rc != SQLITE_ROW) {
      *code = rc;
      const char *m = sqlite3_errmsg(db);
      if (message) *message = m ? dup_bytes(m, strlen(m)) : NULL;
      sqlite3_finalize(stmt);
      return -1;
    }
    if (r->nrows == r->cap) {
      size_t cap = r->cap ? r->cap * 2 : 16;
      Row *next = realloc(r->rows, cap * sizeof(Row));
      if (!next) { r->oom = 1; sqlite3_finalize(stmt); return -1; }
      r->rows = next;
      r->cap = cap;
    }
    Row *row = &r->rows[r->nrows];
    memset(row, 0, sizeof(*row));
    row->vals = calloc((size_t)r->ncols, sizeof(char *));
    row->lens = calloc((size_t)r->ncols, sizeof(size_t));
    if (!row->vals || !row->lens) { r->oom = 1; sqlite3_finalize(stmt); return -1; }
    for (int c = 0; c < r->ncols; c++) {
      const unsigned char *text = sqlite3_column_text(stmt, c);
      if (text) {
        int n = sqlite3_column_bytes(stmt, c);
        size_t len = n > 0 ? (size_t)n : 0;
        row->vals[c] = dup_bytes(text, len);
        if (!row->vals[c]) { r->oom = 1; sqlite3_finalize(stmt); return -1; }
        row->lens[c] = len;
      }
    }
    r->nrows++;
  }
  sqlite3_finalize(stmt);
  return 0;
}

static void rows_json(Buf *b, const Rows *r) {
  buf_lit(b, "{\"headerHex\":[");
  for (int c = 0; c < r->ncols; c++) {
    if (c) buf_lit(b, ",");
    buf_hex_value(b, r->names[c], r->names[c] ? r->nameLens[c] : 0);
  }
  buf_lit(b, "],\"rows\":[");
  for (size_t i = 0; i < r->nrows; i++) {
    if (i) buf_lit(b, ",");
    buf_lit(b, "[");
    for (int c = 0; c < r->ncols; c++) {
      if (c) buf_lit(b, ",");
      buf_hex_value(b, r->rows[i].vals[c],
                    r->rows[i].vals[c] ? r->rows[i].lens[c] : 0);
    }
    buf_lit(b, "]");
  }
  buf_lit(b, "]}");
}

/* A value is NUL-clean when its captured length has no embedded NUL, so the
   C-string uses below (PRAGMA query construction) stay exact. */
static int value_nul_clean(const char *v, size_t len) {
  return v && memchr(v, 0, len) == NULL;
}

/* --------------------------------------------------- library identity --- */

typedef struct LibInfo {
  char *runtimeVersion;
  char *runtimeSourceId;
  char *dylibPath;                 /* NULL when dladdr cannot resolve */
  char **compileOptions;
  size_t compileOptionCount;
} LibInfo;

static void lib_info_probe(LibInfo *info) {
  memset(info, 0, sizeof(*info));
  const char *v = sqlite3_libversion();
  const char *sid = sqlite3_sourceid();
  info->runtimeVersion = v ? dup_bytes(v, strlen(v)) : NULL;
  info->runtimeSourceId = sid ? dup_bytes(sid, strlen(sid)) : NULL;
  Dl_info di;
  if (dladdr((void *)(uintptr_t)sqlite3_libversion, &di) && di.dli_fname)
    info->dylibPath = dup_bytes(di.dli_fname, strlen(di.dli_fname));
  size_t cap = 0;
  for (int i = 0; ; i++) {
    const char *opt = sqlite3_compileoption_get(i);
    if (!opt) break;
    if (info->compileOptionCount == cap) {
      cap = cap ? cap * 2 : 16;
      char **next = realloc(info->compileOptions, cap * sizeof(char *));
      if (!next) return;
      info->compileOptions = next;
    }
    info->compileOptions[info->compileOptionCount] = dup_bytes(opt, strlen(opt));
    if (!info->compileOptions[info->compileOptionCount]) return;
    info->compileOptionCount++;
  }
}

static void lib_info_free(LibInfo *info) {
  free(info->runtimeVersion);
  free(info->runtimeSourceId);
  free(info->dylibPath);
  for (size_t i = 0; i < info->compileOptionCount; i++) free(info->compileOptions[i]);
  free(info->compileOptions);
  memset(info, 0, sizeof(*info));
}

static void lib_info_json(Buf *b, const LibInfo *info) {
  buf_lit(b, ",\"library\":{\"compileVersionHex\":\"");
  buf_hex_bytes(b, SQLITE_VERSION, strlen(SQLITE_VERSION));
  buf_lit(b, "\"");
  buf_hex_field(b, "compileSourceIdHex", SQLITE_SOURCE_ID, strlen(SQLITE_SOURCE_ID));
  buf_hex_field(b, "runtimeVersionHex", info->runtimeVersion,
                info->runtimeVersion ? strlen(info->runtimeVersion) : 0);
  buf_hex_field(b, "runtimeSourceIdHex", info->runtimeSourceId,
                info->runtimeSourceId ? strlen(info->runtimeSourceId) : 0);
  buf_hex_field(b, "dylibPathHex", info->dylibPath,
                info->dylibPath ? strlen(info->dylibPath) : 0);
  buf_lit(b, ",\"compileOptionsHex\":[");
  for (size_t i = 0; i < info->compileOptionCount; i++) {
    if (i) buf_lit(b, ",");
    buf_hex_value(b, info->compileOptions[i], strlen(info->compileOptions[i]));
  }
  buf_lit(b, "]}");
}

/* ------------------------------------------------------ common pieces --- */

static int configure_scratch(const char *scratchDirectory) {
  if (!scratchDirectory || !*scratchDirectory) return -1;
  sqlite3_temp_directory = (char *)scratchDirectory; /* child process global */
  return 0;
}

static int progress_cb(void *flag) {
  return *(volatile sig_atomic_t *)flag != 0;
}

static void status_json(Buf *b, BatonCtxSqlStage stage, int code, const char *message) {
  buf_lit(b, ",\"status\":{\"stageHex\":");
  buf_hex_value(b, baton_ctx_sql_stage_name(stage),
                strlen(baton_ctx_sql_stage_name(stage)));
  buf_lit(b, ",\"code\":");
  buf_num(b, code);
  buf_hex_field(b, "messageHex", message, message ? strlen(message) : 0);
  buf_lit(b, "}");
}

static void scratch_json(Buf *b, const char *dir, int configured,
                         int tempStoreVerified) {
  buf_lit(b, ",\"scratch\":{\"configured\":");
  buf_lit(b, configured ? "true" : "false");
  buf_lit(b, ",\"tempStoreVerified\":");
  buf_lit(b, tempStoreVerified ? "true" : "false");
  buf_lit(b, ",");
  buf_hex_field(b, "directoryHex", dir, dir ? strlen(dir) : 0);
  buf_lit(b, "}");
}

static void path_hex_value(Buf *b, const char *path) {
  if (!path) { buf_lit(b, "null"); return; }
  buf_lit(b, "\"");
  buf_hex_bytes(b, path, strlen(path));
  buf_lit(b, "\"");
}

/* ------------------------------------------------------- catalog capture */

typedef struct CatObjects {
  char **type, **name, **tblName, **sql;
  size_t *typeLen, *nameLen, *tblNameLen, *sqlLen;
  long long *rootpage;
  size_t count, cap;
  int oom;
} CatObjects;

static void cat_objects_free(CatObjects *o) {
  for (size_t i = 0; i < o->count; i++) {
    free(o->type[i]); free(o->name[i]); free(o->tblName[i]); free(o->sql[i]);
  }
  free(o->type); free(o->name); free(o->tblName); free(o->sql);
  free(o->typeLen); free(o->nameLen); free(o->tblNameLen); free(o->sqlLen);
  free(o->rootpage);
  memset(o, 0, sizeof(*o));
}

static int cat_objects_capture(CatObjects *o, sqlite3 *db, int *code, char **message) {
  Rows rows;
  int rc = rows_capture(&rows, db,
    "SELECT type,name,tbl_name,rootpage,sql FROM main.sqlite_schema", code, message);
  if (rc != 0) return -1;
  for (size_t i = 0; i < rows.nrows; i++) {
    if (o->count == o->cap) {
      size_t cap = o->cap ? o->cap * 2 : 16;
      char **nt = realloc(o->type, cap * sizeof(char *));
      char **nn = realloc(o->name, cap * sizeof(char *));
      char **ntb = realloc(o->tblName, cap * sizeof(char *));
      char **ns = realloc(o->sql, cap * sizeof(char *));
      size_t *ntl = realloc(o->typeLen, cap * sizeof(size_t));
      size_t *nnl = realloc(o->nameLen, cap * sizeof(size_t));
      size_t *ntbl = realloc(o->tblNameLen, cap * sizeof(size_t));
      size_t *nsl = realloc(o->sqlLen, cap * sizeof(size_t));
      long long *nrp = realloc(o->rootpage, cap * sizeof(long long));
      if (!nt || !nn || !ntb || !ns || !ntl || !nnl || !ntbl || !nsl || !nrp) {
        free(nt); free(nn); free(ntb); free(ns);
        free(ntl); free(nnl); free(ntbl); free(nsl); free(nrp);
        o->oom = 1;
        rows_free(&rows);
        return -1;
      }
      o->type = nt; o->name = nn; o->tblName = ntb; o->sql = ns;
      o->typeLen = ntl; o->nameLen = nnl; o->tblNameLen = ntbl; o->sqlLen = nsl;
      o->rootpage = nrp;
      o->cap = cap;
    }
    size_t k = o->count;
    Row *r = &rows.rows[i];
    #define CAT_SET(field, col) { \
      o->field[k] = r->vals[col] ? dup_bytes(r->vals[col], r->lens[col]) : NULL; \
      o->field##Len[k] = r->vals[col] ? r->lens[col] : 0; \
      if (r->vals[col] && !o->field[k]) { o->oom = 1; rows_free(&rows); return -1; } }
    CAT_SET(type, 0)
    CAT_SET(name, 1)
    CAT_SET(tblName, 2)
    CAT_SET(sql, 4)
    #undef CAT_SET
    o->rootpage[k] = r->vals[3] ? strtoll(r->vals[3], NULL, 10) : 0;
    o->count++;
  }
  rows_free(&rows);
  return 0;
}

static void cat_objects_json(Buf *b, const CatObjects *o) {
  buf_lit(b, "\"objects\":[");
  for (size_t i = 0; i < o->count; i++) {
    if (i) buf_lit(b, ",");
    buf_lit(b, "{");
    buf_hex_field(b, "typeHex", o->type[i], o->type[i] ? o->typeLen[i] : 0);
    buf_hex_field(b, "nameHex", o->name[i], o->name[i] ? o->nameLen[i] : 0);
    buf_hex_field(b, "tblNameHex", o->tblName[i], o->tblName[i] ? o->tblNameLen[i] : 0);
    buf_lit(b, ",\"rootpage\":");
    buf_num(b, o->rootpage[i]);
    buf_hex_field(b, "sqlHex", o->sql[i], o->sql[i] ? o->sqlLen[i] : 0);
    buf_lit(b, "}");
  }
  buf_lit(b, "]");
}

typedef struct Projection {
  char *query;
  Rows rows;
  int failed;
} Projection;

typedef struct Projections {
  Projection *items;
  size_t count, cap;
  int oom;
  size_t skippedNames;
} Projections;

static void projections_free(Projections *p) {
  for (size_t i = 0; i < p->count; i++) {
    free(p->items[i].query);
    rows_free(&p->items[i].rows);
  }
  free(p->items);
  memset(p, 0, sizeof(*p));
}

static int projection_add(Projections *ps, sqlite3 *db, const char *query,
                          int *code, char **message) {
  if (ps->count == ps->cap) {
    size_t cap = ps->cap ? ps->cap * 2 : 16;
    Projection *next = realloc(ps->items, cap * sizeof(Projection));
    if (!next) { ps->oom = 1; return -1; }
    ps->items = next;
    ps->cap = cap;
  }
  Projection *p = &ps->items[ps->count];
  memset(p, 0, sizeof(*p));
  p->query = dup_bytes(query, strlen(query));
  if (!p->query) { ps->oom = 1; return -1; }
  Rows rows;
  int rc = rows_capture(&rows, db, query, code, message);
  if (rc != 0) {
    p->failed = 1;
    ps->count++;
    return 1;
  }
  p->rows = rows;
  ps->count++;
  return 0;
}

static void projections_json(Buf *b, const Projections *ps) {
  buf_lit(b, "\"projections\":[");
  for (size_t i = 0; i < ps->count; i++) {
    if (i) buf_lit(b, ",");
    buf_lit(b, "{");
    buf_hex_field(b, "queryHex", ps->items[i].query, strlen(ps->items[i].query));
    if (ps->items[i].failed) {
      buf_lit(b, ",\"failed\":true,\"rows\":{\"headerHex\":[],\"rows\":[]}");
    } else {
      buf_lit(b, ",\"rows\":");
      rows_json(b, &ps->items[i].rows);
    }
    buf_lit(b, "}");
  }
  buf_lit(b, "],\"skippedNames\":");
  buf_ull(b, (unsigned long long)ps->skippedNames);
}

/* Captures the fixed catalog projections for one connection. Names with an
   embedded NUL cannot build an exact PRAGMA query and are counted. */
static int catalog_capture(Projections *ps, sqlite3 *db, const CatObjects *objects,
                           int *code, char **message) {
  if (projection_add(ps, db, "PRAGMA main.table_list", code, message) != 0) return -1;
  const Projection *tl = &ps->items[0];
  for (size_t i = 0; i < tl->rows.nrows; i++) {
    const char *name = tl->rows.rows[i].vals[1];
    size_t len = tl->rows.rows[i].vals[1] ? tl->rows.rows[i].lens[1] : 0;
    if (!value_nul_clean(name, len)) { ps->skippedNames++; continue; }
    Buf q;
    buf_init(&q);
    buf_lit(&q, "PRAGMA main.table_xinfo(");
    buf_quote_identifier(&q, name);
    buf_lit(&q, ")");
    int r1 = projection_add(ps, db, q.data, code, message);
    free(q.data);
    if (r1 != 0) return -1;
    buf_init(&q);
    buf_lit(&q, "PRAGMA main.index_list(");
    buf_quote_identifier(&q, name);
    buf_lit(&q, ")");
    int r2 = projection_add(ps, db, q.data, code, message);
    free(q.data);
    if (r2 != 0) return -1;
    buf_init(&q);
    buf_lit(&q, "PRAGMA main.foreign_key_list(");
    buf_quote_identifier(&q, name);
    buf_lit(&q, ")");
    int r3 = projection_add(ps, db, q.data, code, message);
    free(q.data);
    if (r3 != 0) return -1;
  }
  for (size_t i = 0; i < objects->count; i++) {
    if (!objects->type[i] || strcmp(objects->type[i], "index") != 0) continue;
    if (!value_nul_clean(objects->name[i], objects->nameLen[i])) {
      ps->skippedNames++;
      continue;
    }
    Buf q;
    buf_init(&q);
    buf_lit(&q, "PRAGMA main.index_xinfo(");
    buf_quote_identifier(&q, objects->name[i]);
    buf_lit(&q, ")");
    int r = projection_add(ps, db, q.data, code, message);
    free(q.data);
    if (r != 0) return -1;
  }
  return 0;
}

/* Planner-admitted object names: ordinary table/view objects of main per
   PRAGMA table_list types (shadow and virtual tables are excluded, so a
   target statement reading one refuses with objectNotCaptured). */
static int planner_object_names(AuthCtx *ctx, sqlite3 *db, int *code, char **message) {
  Rows tl;
  if (rows_capture(&tl, db, "PRAGMA main.table_list", code, message) != 0) return -1;
  ctx->objectNames = calloc(tl.nrows ? tl.nrows : 1, sizeof(char *));
  if (!ctx->objectNames) { rows_free(&tl); return -1; }
  for (size_t i = 0; i < tl.nrows; i++) {
    const char *name = tl.rows[i].vals[1];
    const char *type = tl.rows[i].vals[2]; /* table|view|shadow|virtual */
    if (!name || !type) continue;
    if (strcmp(type, "table") != 0 && strcmp(type, "view") != 0) continue;
    ctx->objectNames[ctx->objectCount] = dup_bytes(name, strlen(name));
    if (!ctx->objectNames[ctx->objectCount]) { rows_free(&tl); return -1; }
    ctx->objectCount++;
  }
  rows_free(&tl);
  return 0;
}

/* ------------------------------------------------------------ explain --- */

typedef struct ExplainRow {
  long long addr, p1, p2, p3, p5;
  int hasAddr, hasP1, hasP2, hasP3, hasP5;
  char *opcode;
  char *p4;
  char *comment;
  size_t opcodeLen, p4Len, commentLen;
  int access;                      /* 0 none, 1 openRead, 2 openWrite */
} ExplainRow;

typedef struct Explain {
  ExplainRow *rows;
  size_t count, cap;
  int oom;
} Explain;

static void explain_free(Explain *e) {
  for (size_t i = 0; i < e->count; i++) {
    free(e->rows[i].opcode); free(e->rows[i].p4); free(e->rows[i].comment);
  }
  free(e->rows);
  memset(e, 0, sizeof(*e));
}

static void explain_json(Buf *b, const Explain *e, const CatObjects *objects,
                         const unsigned char *sql, size_t sqlLength) {
  buf_lit(b, ",\"plan\":{");
  buf_hex_field(b, "sqlHex", sql, sql ? sqlLength : 0);
  buf_lit(b, ",\"rows\":[");
  for (size_t i = 0; i < e->count; i++) {
    const ExplainRow *r = &e->rows[i];
    if (i) buf_lit(b, ",");
    buf_lit(b, "{\"addr\":");
    if (r->hasAddr) buf_num(b, r->addr); else buf_lit(b, "null");
    buf_lit(b, ",\"opcodeHex\":");
    buf_hex_value(b, r->opcode, r->opcode ? r->opcodeLen : 0);
    buf_lit(b, ",\"p1\":");
    if (r->hasP1) buf_num(b, r->p1); else buf_lit(b, "null");
    buf_lit(b, ",\"p2\":");
    if (r->hasP2) buf_num(b, r->p2); else buf_lit(b, "null");
    buf_lit(b, ",\"p3\":");
    if (r->hasP3) buf_num(b, r->p3); else buf_lit(b, "null");
    buf_lit(b, ",\"p4Hex\":");
    buf_hex_value(b, r->p4, r->p4 ? r->p4Len : 0);
    buf_lit(b, ",\"p5\":");
    if (r->hasP5) buf_num(b, r->p5); else buf_lit(b, "null");
    buf_lit(b, ",\"commentHex\":");
    buf_hex_value(b, r->comment, r->comment ? r->commentLen : 0);
    if (r->access == 0) {
      buf_lit(b, ",\"access\":null");
    } else if (r->access == 2) {
      buf_lit(b, ",\"access\":{\"kind\":\"openWrite\"}");
    } else {
      buf_lit(b, ",\"access\":{\"kind\":\"openRead\",\"cursor\":");
      buf_num(b, r->p1);
      buf_lit(b, ",\"rootpage\":");
      buf_num(b, r->p2);
      buf_lit(b, ",\"database\":");
      buf_num(b, r->p3);
      /* Join rootpage to the captured main catalog; only a unique match
         binds an object. */
      size_t matches = 0, matchIndex = 0;
      for (size_t k = 0; k < objects->count; k++) {
        if (objects->rootpage[k] == r->p2 && r->p2 > 0) {
          matches++;
          matchIndex = k;
        }
      }
      buf_lit(b, ",\"objectHex\":");
      if (matches == 1) {
        buf_hex_value(b, objects->name[matchIndex], objects->nameLen[matchIndex]);
      } else {
        buf_lit(b, "null");
      }
      buf_lit(b, ",\"ambiguousJoin\":");
      buf_lit(b, matches > 1 ? "true" : "false");
      buf_lit(b, "}");
    }
    buf_lit(b, "}");
  }
  buf_lit(b, "],\"explainOnlyStepped\":true}");
}

/* ------------------------------------------------------- record output -- */

static void record_open(Buf *b, const char *kind) {
  buf_lit(b, "{\"record\":");
  buf_hex_value(b, kind, strlen(kind));
  buf_lit(b, ",\"abi\":2");
}

typedef struct OutputSink {
  Buf record;
  const char *kind;
} OutputSink;

static void output_finish(BatonCtxSqlOutput *out, OutputSink *sink,
                          BatonCtxSqlStage stage, int code, const char *message) {
  out->stage = stage;
  out->code = code;
  out->message = message ? dup_bytes(message, strlen(message)) : NULL;
  if (sink->record.oom) {
    out->stage = BATON_CTX_SQL_ALLOCATION_FAILED;
    out->code = 0;
    free(out->message);
    out->message = NULL;
  }
  if (sink->record.data) {
    out->record = sink->record.data;
    out->recordLength = sink->record.len;
  } else {
    /* Refusals that ran before record assembly still emit a record. */
    Buf b;
    buf_init(&b);
    record_open(&b, sink->kind ? sink->kind : "context-sqlite");
    status_json(&b, out->stage, out->code, out->message);
    buf_lit(&b, "}");
    out->record = b.oom ? NULL : b.data;
    out->recordLength = b.oom ? 0 : b.len;
    if (b.oom) out->stage = BATON_CTX_SQL_ALLOCATION_FAILED;
  }
}

static int output_failed(const BatonCtxSqlOutput *out) {
  return out->record == NULL;
}

/* ---------------------------------------------------------- planner ----- */

static BatonCtxSqlStage stage_worse(BatonCtxSqlStage a, BatonCtxSqlStage b) {
  return (int)a >= (int)b ? a : b;
}

int baton_ctx_sql_plan(const BatonCtxSqlPlanInput *input, BatonCtxSqlOutput *output) {
  if (!output) return -1;
  memset(output, 0, sizeof(*output));
  OutputSink sink;
  buf_init(&sink.record);
  sink.kind = "context-sqlite-plan";

  if (!input || !input->databasePath || !input->sql || input->sqlLength == 0) {
    output_finish(output, &sink, BATON_CTX_SQL_INPUT_INVALID, 0,
                  "planner input incomplete");
    return 0;
  }
  if (input->sqlLength > (size_t)INT_MAX) {
    output_finish(output, &sink, BATON_CTX_SQL_SQL_LENGTH_EXCEEDS_INT, 0,
                  "SQL bytes exceed sqlite3_prepare_v2 int parameter");
    return 0;
  }
  if (bytes_contain_nul(input->sql, input->sqlLength)) {
    output_finish(output, &sink, BATON_CTX_SQL_SQL_NUL, 0,
                  "SQL bytes contain NUL");
    return 0;
  }
  if (!utf8_valid(input->sql, input->sqlLength)) {
    output_finish(output, &sink, BATON_CTX_SQL_SQL_UTF8, 0,
                  "SQL bytes are not valid UTF-8");
    return 0;
  }
  if (configure_scratch(input->scratchDirectory) != 0) {
    output_finish(output, &sink, BATON_CTX_SQL_TEMPDIR_UNAVAILABLE, 0,
                  "scratch directory unavailable");
    return 0;
  }
  if (input->cancelFlag && *input->cancelFlag) {
    output_finish(output, &sink, BATON_CTX_SQL_CANCELLED, 0, "cancelled");
    return 0;
  }

  int code = 0;
  char *message = NULL;
  BatonCtxSqlStage stage = BATON_CTX_SQL_OK;
  sqlite3 *db = NULL;
  sqlite3_stmt *original = NULL;
  AuthCtx auth;
  memset(&auth, 0, sizeof(auth));
  auth.mode = AUTH_CAPTURE;
  auth.phase = "capture";
  LibInfo lib;
  lib_info_probe(&lib);
  CatObjects objects;
  memset(&objects, 0, sizeof(objects));
  Projections projections;
  memset(&projections, 0, sizeof(projections));
  Rows databaseList;
  memset(&databaseList, 0, sizeof(databaseList));
  Explain explain;
  memset(&explain, 0, sizeof(explain));
  struct stat st;
  memset(&st, 0, sizeof(st));
  int haveStat = 0;
  long long schemaVersion = -1;
  char *filename = NULL;
  char *foreignKeyState = NULL;
  int rollbackFailed = 0;
  const char *stmtStart = NULL;    /* admitted first-statement bytes */
  size_t stmtLength = 0;

  record_open(&sink.record, "context-sqlite-plan");

  int rc = sqlite3_open_v2(input->databasePath, &db, SQLITE_OPEN_READONLY, NULL);
  if (rc != SQLITE_OK) {
    stage = BATON_CTX_SQL_OPEN_FAILED;
    code = rc;
    const char *m = db ? sqlite3_errmsg(db) : "cannot open database";
    message = dup_bytes(m, strlen(m));
    goto emit;
  }
  trace_install(db);

  if (stat(input->databasePath, &st) == 0) haveStat = 1;
  {
    const char *fn = sqlite3_db_filename(db, "main");
    filename = fn ? dup_bytes(fn, strlen(fn)) : NULL;
  }

  if (sqlite3_set_authorizer(db, auth_cb, &auth) != SQLITE_OK) {
    stage = BATON_CTX_SQL_AUTHORIZER_FAILED;
    code = sqlite3_extended_errcode(db);
    message = dup_bytes(sqlite3_errmsg(db), strlen(sqlite3_errmsg(db)));
    goto emit;
  }
  if (input->cancelFlag)
    sqlite3_progress_handler(db, 1000, progress_cb,
                             (void *)(volatile sig_atomic_t *)input->cancelFlag);

  rc = sqlite3_exec(db, "BEGIN", NULL, NULL, NULL);
  if (rc != SQLITE_OK) {
    stage = BATON_CTX_SQL_SNAPSHOT_FAILED;
    code = rc;
    message = dup_bytes(sqlite3_errmsg(db), strlen(sqlite3_errmsg(db)));
    goto emit;
  }

  /* Fixed internal queries: schema snapshot, catalog, identity reads. */
  if (cat_objects_capture(&objects, db, &code, &message) != 0) {
    stage = BATON_CTX_SQL_SNAPSHOT_FAILED;
    if (!message) message = dup_bytes("catalog capture failed", 22);
    goto emit;
  }
  if (rows_capture(&databaseList, db, "PRAGMA database_list", &code, &message) != 0) {
    stage = BATON_CTX_SQL_SNAPSHOT_FAILED;
    goto emit;
  }
  {
    Rows sv, fk;
    if (rows_capture(&sv, db, "PRAGMA schema_version", &code, &message) != 0) {
      stage = BATON_CTX_SQL_SNAPSHOT_FAILED;
      goto emit;
    }
    if (sv.nrows > 0 && sv.rows[0].vals[0])
      schemaVersion = strtoll(sv.rows[0].vals[0], NULL, 10);
    rows_free(&sv);
    if (rows_capture(&fk, db, "PRAGMA foreign_keys", &code, &message) != 0) {
      stage = BATON_CTX_SQL_SNAPSHOT_FAILED;
      goto emit;
    }
    if (fk.nrows > 0 && fk.rows[0].vals[0])
      foreignKeyState = dup_bytes(fk.rows[0].vals[0], strlen(fk.rows[0].vals[0]));
    rows_free(&fk);
  }
  if (catalog_capture(&projections, db, &objects, &code, &message) != 0) {
    stage = BATON_CTX_SQL_SNAPSHOT_FAILED;
    if (!message) message = dup_bytes("catalog projections failed", 25);
    goto emit;
  }
  if (planner_object_names(&auth, db, &code, &message) != 0) {
    stage = BATON_CTX_SQL_SNAPSHOT_FAILED;
    if (!message) message = dup_bytes("object capture failed", 21);
    goto emit;
  }

  if (sqlite3_drop_modules(db, NULL) != SQLITE_OK) {
    stage = BATON_CTX_SQL_DROPMODULES_FAILED;
    code = sqlite3_extended_errcode(db);
    message = dup_bytes(sqlite3_errmsg(db), strlen(sqlite3_errmsg(db)));
    goto emit;
  }

  /* Target authorizer before any target-derived prepare. */
  auth.mode = AUTH_PLANNER;
  if (sqlite3_set_authorizer(db, auth_cb, &auth) != SQLITE_OK) {
    stage = BATON_CTX_SQL_AUTHORIZER_FAILED;
    code = sqlite3_extended_errcode(db);
    message = dup_bytes(sqlite3_errmsg(db), strlen(sqlite3_errmsg(db)));
    goto emit;
  }

  if (input->cancelFlag && *input->cancelFlag) {
    stage = BATON_CTX_SQL_CANCELLED;
    code = SQLITE_INTERRUPT;
    goto emit;
  }

  {
    const char *cursor = (const char *)input->sql;
    const char *end = cursor + input->sqlLength;
    const char *tail = NULL;
    auth.phase = "original-prepare";
    /* Consume leading empty statements (comments, whitespace, semicolons);
       the first nonempty statement is the admitted target. */
    for (;;) {
      size_t remaining = (size_t)(end - cursor);
      if (remaining > (size_t)INT_MAX) {
        stage = BATON_CTX_SQL_SQL_LENGTH_EXCEEDS_INT;
        code = SQLITE_TOOBIG;
        goto cleanup;
      }
      rc = sqlite3_prepare_v2(db, cursor, (int)remaining, &original, &tail);
      if (rc != SQLITE_OK) {
        stage = BATON_CTX_SQL_PREPARE_FAILED;
        code = rc;
        message = dup_bytes(sqlite3_errmsg(db), strlen(sqlite3_errmsg(db)));
        goto cleanup;
      }
      if (original) break;
      if (tail == cursor) {
        stage = cursor == end ? BATON_CTX_SQL_SQL_EMPTY : BATON_CTX_SQL_TAIL_REMAINS;
        if (stage == BATON_CTX_SQL_SQL_EMPTY)
          message = dup_bytes("no nonempty statement", 21);
        else
          message = dup_bytes("statement cursor did not advance", 33);
        goto cleanup;
      }
      cursor = tail;
    }
    stmtStart = cursor;
    stmtLength = (size_t)(tail - cursor);
    if (!sqlite3_stmt_readonly(original)) {
      stage = BATON_CTX_SQL_NOT_READONLY;
      goto cleanup;
    }
    if (sqlite3_stmt_isexplain(original) != 0) {
      stage = BATON_CTX_SQL_IS_EXPLAIN;
      goto cleanup;
    }
    if (sqlite3_bind_parameter_count(original) != 0) {
      stage = BATON_CTX_SQL_SQL_BIND;
      goto cleanup;
    }

    /* Consume the tail under the same policy: empty statements, comments
       and semicolons only; any second statement or parse error refuses. */
    {
      const char *cursor = tail;
      const char *end = (const char *)input->sql + input->sqlLength;
      while (cursor && cursor < end) {
        size_t remaining = (size_t)(end - cursor);
        if (remaining > (size_t)INT_MAX) {
          stage = BATON_CTX_SQL_TAIL_REMAINS;
          code = SQLITE_TOOBIG;
          goto cleanup;
        }
        sqlite3_stmt *extra = NULL;
        const char *next = NULL;
        int trc = sqlite3_prepare_v2(db, cursor, (int)remaining, &extra, &next);
        if (trc != SQLITE_OK) {
          stage = BATON_CTX_SQL_TAIL_REMAINS;
          code = trc;
          message = dup_bytes(sqlite3_errmsg(db), strlen(sqlite3_errmsg(db)));
          goto cleanup;
        }
        if (extra) {
          stage = BATON_CTX_SQL_TAIL_REMAINS;
          if (!message) message = dup_bytes("second statement refused", 24);
          sqlite3_finalize(extra);
          goto cleanup;
        }
        if (next == cursor) {
          stage = BATON_CTX_SQL_TAIL_REMAINS;
          if (!message) message = dup_bytes("statement cursor did not advance", 33);
          goto cleanup;
        }
        cursor = next;
      }
    }

    if (input->cancelFlag && *input->cancelFlag) {
      stage = BATON_CTX_SQL_CANCELLED;
      code = SQLITE_INTERRUPT;
      goto cleanup;
    }

    /* Fixed EXPLAIN prefix + the admitted statement bytes; leading empty
       statements are not part of the planned statement. Only this EXPLAIN
       statement is stepped. */
    {
      Buf explainSql;
      buf_init(&explainSql);
      buf_lit(&explainSql, "EXPLAIN ");
      buf_add(&explainSql, stmtStart, stmtLength);
      sqlite3_stmt *explainStmt = NULL;
      const char *explainTail = NULL;
      auth.phase = "explain-prepare";
      int erc = sqlite3_prepare_v2(db, explainSql.data, (int)explainSql.len,
                                   &explainStmt, &explainTail);
      free(explainSql.data);
      if (erc != SQLITE_OK) {
        stage = BATON_CTX_SQL_EXPLAIN_PREPARE_FAILED;
        code = erc;
        message = dup_bytes(sqlite3_errmsg(db), strlen(sqlite3_errmsg(db)));
        goto cleanup;
      }
      if (sqlite3_stmt_isexplain(explainStmt) != 1) {
        stage = BATON_CTX_SQL_EXPLAIN_PREPARE_FAILED;
        message = dup_bytes("EXPLAIN statement did not report isexplain", 41);
        sqlite3_finalize(explainStmt);
        goto cleanup;
      }
      auth.phase = "explain-step";
      for (;;) {
        int src = sqlite3_step(explainStmt);
        if (src == SQLITE_DONE) break;
        if (src != SQLITE_ROW) {
          stage = src == SQLITE_INTERRUPT ? BATON_CTX_SQL_CANCELLED
                                          : BATON_CTX_SQL_EXPLAIN_STEP_FAILED;
          code = src;
          message = dup_bytes(sqlite3_errmsg(db), strlen(sqlite3_errmsg(db)));
          break;
        }
        if (explain.count == explain.cap) {
          size_t cap = explain.cap ? explain.cap * 2 : 32;
          ExplainRow *next = realloc(explain.rows, cap * sizeof(ExplainRow));
          if (!next) { stage = BATON_CTX_SQL_ALLOCATION_FAILED; break; }
          explain.rows = next;
          explain.cap = cap;
        }
        ExplainRow *r = &explain.rows[explain.count];
        memset(r, 0, sizeof(*r));
        /* EXPLAIN output columns: addr, opcode, p1, p2, p3, p4, p5, comment. */
        {
          const unsigned char *t = sqlite3_column_text(explainStmt, 0);
          if (t) { r->hasAddr = 1; r->addr = strtoll((const char *)t, NULL, 10); }
          t = sqlite3_column_text(explainStmt, 1);
          if (t) {
            size_t len = (size_t)sqlite3_column_bytes(explainStmt, 1);
            r->opcode = dup_bytes(t, len);
            r->opcodeLen = len;
          }
          t = sqlite3_column_text(explainStmt, 2);
          if (t) { r->hasP1 = 1; r->p1 = strtoll((const char *)t, NULL, 10); }
          t = sqlite3_column_text(explainStmt, 3);
          if (t) { r->hasP2 = 1; r->p2 = strtoll((const char *)t, NULL, 10); }
          t = sqlite3_column_text(explainStmt, 4);
          if (t) { r->hasP3 = 1; r->p3 = strtoll((const char *)t, NULL, 10); }
          t = sqlite3_column_text(explainStmt, 5);
          if (t) {
            size_t len = (size_t)sqlite3_column_bytes(explainStmt, 5);
            r->p4 = dup_bytes(t, len);
            r->p4Len = len;
          }
          t = sqlite3_column_text(explainStmt, 6);
          if (t) { r->hasP5 = 1; r->p5 = strtoll((const char *)t, NULL, 10); }
          t = sqlite3_column_text(explainStmt, 7);
          if (t) {
            size_t len = (size_t)sqlite3_column_bytes(explainStmt, 7);
            r->comment = dup_bytes(t, len);
            r->commentLen = len;
          }
          if (!r->opcode) {
            stage = BATON_CTX_SQL_ALLOCATION_FAILED;
            break;
          }
          if (r->hasP3 && r->p3 == 0 && r->opcode) {
            if (strcmp(r->opcode, "OpenRead") == 0) r->access = 1;
            else if (strcmp(r->opcode, "OpenWrite") == 0) r->access = 2;
          }
        }
        explain.count++;
      }
      if (sqlite3_finalize(explainStmt) != SQLITE_OK && stage == BATON_CTX_SQL_OK) {
        stage = BATON_CTX_SQL_CLOSE_FAILED;
        code = sqlite3_extended_errcode(db);
        message = dup_bytes(sqlite3_errmsg(db), strlen(sqlite3_errmsg(db)));
      }
    }
  }

cleanup:
  /* Checked finalization of the original statement on every path; the
     EXPLAIN statement finalizes inside its own block. */
  if (original) {
    if (sqlite3_finalize(original) != SQLITE_OK && stage == BATON_CTX_SQL_OK) {
      stage = BATON_CTX_SQL_CLOSE_FAILED;
      code = sqlite3_extended_errcode(db);
      message = dup_bytes(sqlite3_errmsg(db), strlen(sqlite3_errmsg(db)));
    }
    original = NULL;
  }

emit:
  if (db) {
    /* Cleanup statements are internal fixed bytes; they run under the
       recording capture policy, phase cleanup, so the target authorizer
       cannot refuse the operation's own rollback. */
    auth.mode = AUTH_CAPTURE;
    auth.phase = "cleanup";
    if (sqlite3_exec(db, "ROLLBACK", NULL, NULL, NULL) != SQLITE_OK)
      rollbackFailed = 1;
  }

  {
    Buf *b = &sink.record;
    lib_info_json(b, &lib);
    status_json(b, stage, code, message);
    scratch_json(b, input->scratchDirectory,
                 input->scratchDirectory && *input->scratchDirectory, 0);
    buf_lit(b, ",\"sourceBindingIdHex\":");
    path_hex_value(b, input->sourceBindingId);
    buf_lit(b, ",\"database\":{\"pathHex\":");
    path_hex_value(b, input->databasePath);
    buf_hex_field(b, "filenameHex", filename, filename ? strlen(filename) : 0);
    buf_lit(b, ",\"deviceId\":");
    if (haveStat) buf_ull(b, (unsigned long long)st.st_dev); else buf_lit(b, "null");
    buf_lit(b, ",\"fileId\":");
    if (haveStat) buf_ull(b, (unsigned long long)st.st_ino); else buf_lit(b, "null");
    buf_lit(b, ",\"schemaVersion\":");
    if (schemaVersion >= 0) buf_num(b, schemaVersion); else buf_lit(b, "null");
    buf_hex_field(b, "foreignKeyStateHex", foreignKeyState,
                  foreignKeyState ? strlen(foreignKeyState) : 0);
    buf_lit(b, ",\"openFlagsHex\":");
    buf_hex_value(b, "SQLITE_OPEN_READONLY", strlen("SQLITE_OPEN_READONLY"));
    buf_lit(b, ",\"databaseList\":");
    rows_json(b, &databaseList);
    buf_lit(b, "},\"catalog\":{");
    cat_objects_json(b, &objects);
    buf_lit(b, ",");
    projections_json(b, &projections);
    buf_lit(b, "},");
    auth_json(b, &auth);
    explain_json(b, &explain, &objects,
                 (const unsigned char *)stmtStart, stmtLength);
    if (rollbackFailed) buf_lit(b, ",\"rollbackFailed\":true");
    buf_lit(b, "}");
  }

  if (db && sqlite3_close(db) != SQLITE_OK) {
    stage = stage_worse(stage, BATON_CTX_SQL_CLOSE_FAILED);
    if (code == 0) code = sqlite3_extended_errcode(db);
    if (!message) message = dup_bytes("close failed", 12);
  }
  if (stage == BATON_CTX_SQL_OK && rollbackFailed) {
    stage = BATON_CTX_SQL_CLOSE_FAILED;
    if (!message) message = dup_bytes("rollback failed", 15);
  }

  output_finish(output, &sink, stage, code, message);

  free(message);
  free(filename);
  free(foreignKeyState);
  rows_free(&databaseList);
  cat_objects_free(&objects);
  projections_free(&projections);
  explain_free(&explain);
  auth_events_free(&auth);
  lib_info_free(&lib);
  return output_failed(output) ? -1 : 0;
}

/* --------------------------------------------------- applied capture ---- */

int baton_ctx_sql_applied_capture(const BatonCtxSqlAppliedCaptureInput *input,
                                  BatonCtxSqlOutput *output) {
  if (!output) return -1;
  memset(output, 0, sizeof(*output));
  OutputSink sink;
  buf_init(&sink.record);
  sink.kind = "context-sqlite-applied";

  if (!input || !input->databasePath || !valid_identifier(input->appliedTable) ||
      !valid_identifier(input->revisionColumn) ||
      !valid_identifier(input->checksumColumn)) {
    output_finish(output, &sink, BATON_CTX_SQL_INPUT_INVALID, 0,
                  "applied capture input incomplete");
    return 0;
  }
  if (configure_scratch(input->scratchDirectory) != 0) {
    output_finish(output, &sink, BATON_CTX_SQL_TEMPDIR_UNAVAILABLE, 0,
                  "scratch directory unavailable");
    return 0;
  }
  if (input->cancelFlag && *input->cancelFlag) {
    output_finish(output, &sink, BATON_CTX_SQL_CANCELLED, 0, "cancelled");
    return 0;
  }

  int code = 0;
  char *message = NULL;
  BatonCtxSqlStage stage = BATON_CTX_SQL_OK;
  sqlite3 *db = NULL;
  AuthCtx auth;
  memset(&auth, 0, sizeof(auth));
  auth.mode = AUTH_CAPTURE;
  auth.phase = "capture";
  LibInfo lib;
  lib_info_probe(&lib);
  CatObjects objects;
  memset(&objects, 0, sizeof(objects));
  Projections projections;
  memset(&projections, 0, sizeof(projections));
  Rows applied;
  memset(&applied, 0, sizeof(applied));
  Rows databaseList;
  memset(&databaseList, 0, sizeof(databaseList));
  struct stat st;
  memset(&st, 0, sizeof(st));
  int haveStat = 0;
  long long schemaVersion = -1;
  char *filename = NULL;
  char *foreignKeyState = NULL;
  char *appliedQuery = NULL;
  int rollbackFailed = 0;

  record_open(&sink.record, "context-sqlite-applied");

  int rc = sqlite3_open_v2(input->databasePath, &db, SQLITE_OPEN_READONLY, NULL);
  if (rc != SQLITE_OK) {
    stage = BATON_CTX_SQL_OPEN_FAILED;
    code = rc;
    const char *m = db ? sqlite3_errmsg(db) : "cannot open database";
    message = dup_bytes(m, strlen(m));
    goto emit;
  }
  trace_install(db);
  if (stat(input->databasePath, &st) == 0) haveStat = 1;
  {
    const char *fn = sqlite3_db_filename(db, "main");
    filename = fn ? dup_bytes(fn, strlen(fn)) : NULL;
  }

  if (sqlite3_set_authorizer(db, auth_cb, &auth) != SQLITE_OK) {
    stage = BATON_CTX_SQL_AUTHORIZER_FAILED;
    code = sqlite3_extended_errcode(db);
    message = dup_bytes(sqlite3_errmsg(db), strlen(sqlite3_errmsg(db)));
    goto emit;
  }
  if (input->cancelFlag)
    sqlite3_progress_handler(db, 1000, progress_cb,
                             (void *)(volatile sig_atomic_t *)input->cancelFlag);

  rc = sqlite3_exec(db, "BEGIN", NULL, NULL, NULL);
  if (rc != SQLITE_OK) {
    stage = BATON_CTX_SQL_SNAPSHOT_FAILED;
    code = rc;
    message = dup_bytes(sqlite3_errmsg(db), strlen(sqlite3_errmsg(db)));
    goto emit;
  }

  if (cat_objects_capture(&objects, db, &code, &message) != 0) {
    stage = BATON_CTX_SQL_SNAPSHOT_FAILED;
    if (!message) message = dup_bytes("catalog capture failed", 22);
    goto emit;
  }
  {
    Rows sv, fk;
    if (rows_capture(&sv, db, "PRAGMA schema_version", &code, &message) != 0) {
      stage = BATON_CTX_SQL_SNAPSHOT_FAILED;
      goto emit;
    }
    if (sv.nrows > 0 && sv.rows[0].vals[0])
      schemaVersion = strtoll(sv.rows[0].vals[0], NULL, 10);
    rows_free(&sv);
    if (rows_capture(&fk, db, "PRAGMA foreign_keys", &code, &message) != 0) {
      stage = BATON_CTX_SQL_SNAPSHOT_FAILED;
      goto emit;
    }
    if (fk.nrows > 0 && fk.rows[0].vals[0])
      foreignKeyState = dup_bytes(fk.rows[0].vals[0], strlen(fk.rows[0].vals[0]));
    rows_free(&fk);
  }
  if (catalog_capture(&projections, db, &objects, &code, &message) != 0) {
    stage = BATON_CTX_SQL_SNAPSHOT_FAILED;
    if (!message) message = dup_bytes("catalog projections failed", 25);
    goto emit;
  }

  /* Applied rows in the same read-only transaction as the catalog. */
  {
    Buf q;
    buf_init(&q);
    buf_lit(&q, "SELECT rowid,\"");
    buf_add(&q, input->revisionColumn, strlen(input->revisionColumn));
    buf_lit(&q, "\",\"");
    buf_add(&q, input->checksumColumn, strlen(input->checksumColumn));
    buf_lit(&q, "\" FROM \"");
    buf_add(&q, input->appliedTable, strlen(input->appliedTable));
    buf_lit(&q, "\" ORDER BY rowid");
    appliedQuery = q.data;
  }
  if (rows_capture(&applied, db, appliedQuery, &code, &message) != 0) {
    stage = BATON_CTX_SQL_SNAPSHOT_FAILED;
    goto emit;
  }
  if (rows_capture(&databaseList, db, "PRAGMA database_list", &code, &message) != 0) {
    stage = BATON_CTX_SQL_SNAPSHOT_FAILED;
    goto emit;
  }

emit:
  if (db) {
    if (sqlite3_exec(db, "ROLLBACK", NULL, NULL, NULL) != SQLITE_OK)
      rollbackFailed = 1;
  }

  {
    Buf *b = &sink.record;
    lib_info_json(b, &lib);
    status_json(b, stage, code, message);
    scratch_json(b, input->scratchDirectory,
                 input->scratchDirectory && *input->scratchDirectory, 0);
    buf_lit(b, ",\"live\":{\"database\":{\"pathHex\":");
    path_hex_value(b, input->databasePath);
    buf_hex_field(b, "filenameHex", filename, filename ? strlen(filename) : 0);
    buf_lit(b, ",\"deviceId\":");
    if (haveStat) buf_ull(b, (unsigned long long)st.st_dev); else buf_lit(b, "null");
    buf_lit(b, ",\"fileId\":");
    if (haveStat) buf_ull(b, (unsigned long long)st.st_ino); else buf_lit(b, "null");
    buf_lit(b, ",\"schemaVersion\":");
    if (schemaVersion >= 0) buf_num(b, schemaVersion); else buf_lit(b, "null");
    buf_hex_field(b, "foreignKeyStateHex", foreignKeyState,
                  foreignKeyState ? strlen(foreignKeyState) : 0);
    buf_lit(b, ",\"openFlagsHex\":");
    buf_hex_value(b, "SQLITE_OPEN_READONLY", strlen("SQLITE_OPEN_READONLY"));
    buf_lit(b, ",\"databaseList\":");
    rows_json(b, &databaseList);
    buf_lit(b, "},\"applied\":{\"queryHex\":");
    path_hex_value(b, appliedQuery);
    buf_lit(b, ",\"rows\":");
    rows_json(b, &applied);
    buf_lit(b, "},\"catalog\":{");
    cat_objects_json(b, &objects);
    buf_lit(b, ",");
    projections_json(b, &projections);
    buf_lit(b, "}}");
    if (rollbackFailed) buf_lit(b, ",\"rollbackFailed\":true");
    buf_lit(b, "}");
  }

  if (db && sqlite3_close(db) != SQLITE_OK) {
    stage = stage_worse(stage, BATON_CTX_SQL_CLOSE_FAILED);
    if (code == 0) code = sqlite3_extended_errcode(db);
    if (!message) message = dup_bytes("close failed", 12);
  }
  if (stage == BATON_CTX_SQL_OK && rollbackFailed) {
    stage = BATON_CTX_SQL_CLOSE_FAILED;
    if (!message) message = dup_bytes("rollback failed", 15);
  }

  output_finish(output, &sink, stage, code, message);

  free(message);
  free(filename);
  free(foreignKeyState);
  free(appliedQuery);
  rows_free(&applied);
  rows_free(&databaseList);
  cat_objects_free(&objects);
  projections_free(&projections);
  auth_events_free(&auth);
  lib_info_free(&lib);
  return output_failed(output) ? -1 : 0;
}

/* ----------------------------------------------------- chain replay ----- */

typedef struct ReplaySection {
  char **revisions;                /* exact revision identity echoes */
  size_t revisionCount, revisionCap;
  int revisionsOom;
  Buf statements;
  size_t statementCount;
  int aborted;
  int cancelled;
  int autocommitAtEnd;
  int haveAutocommit;
  CatObjects objects;
  Projections projections;
  long long schemaVersion;
  int haveSchemaVersion;
  const AuthCtx *auth;
} ReplaySection;

static void replay_section_free(ReplaySection *s) {
  for (size_t i = 0; i < s->revisionCount; i++) free(s->revisions[i]);
  free(s->revisions);
  free(s->statements.data);
  cat_objects_free(&s->objects);
  projections_free(&s->projections);
  memset(s, 0, sizeof(*s));
}

static void replay_section_json(Buf *b, const ReplaySection *s) {
  buf_lit(b, "{\"revisionsHex\":[");
  for (size_t i = 0; i < s->revisionCount; i++) {
    if (i) buf_lit(b, ",");
    buf_hex_value(b, s->revisions[i], s->revisions[i] ? strlen(s->revisions[i]) : 0);
  }
  buf_lit(b, "],\"statements\":");
  if (s->statements.data && !s->statements.oom)
    buf_add(b, s->statements.data, s->statements.len);
  else
    buf_lit(b, "[]");
  buf_lit(b, ",\"aborted\":");
  buf_lit(b, s->aborted ? "true" : "false");
  buf_lit(b, ",\"cancelled\":");
  buf_lit(b, s->cancelled ? "true" : "false");
  buf_lit(b, ",\"autocommitAtEnd\":");
  if (s->haveAutocommit) buf_lit(b, s->autocommitAtEnd ? "true" : "false");
  else buf_lit(b, "null");
  buf_lit(b, ",\"schemaVersion\":");
  if (s->haveSchemaVersion) buf_num(b, s->schemaVersion); else buf_lit(b, "null");
  buf_lit(b, ",\"catalog\":{");
  cat_objects_json(b, &s->objects);
  buf_lit(b, ",");
  projections_json(b, &s->projections);
  buf_lit(b, "},");
  if (s->auth) {
    auth_json(b, s->auth);
  } else {
    buf_lit(b, "\"authorizer\":[]");
  }
  buf_lit(b, "}");
}

/* Runs one connection's slice of the chain, recording statement outcomes.
   Returns 1 when a revision failed or cancellation hit. */
static int replay_run_slice(sqlite3 *db, AuthCtx *auth, ReplaySection *section,
                            const BatonCtxSqlChainReplayInput *input,
                            size_t begin, size_t end, int *code, char **message,
                            BatonCtxSqlStage *stage) {
  section->revisions = calloc(end > begin ? end - begin : 1, sizeof(char *));
  if (!section->revisions) {
    *stage = BATON_CTX_SQL_ALLOCATION_FAILED;
    return 1;
  }
  buf_init(&section->statements);
  buf_lit(&section->statements, "[");
  int stopped = 0;
  for (size_t i = begin; i < end; i++) {
    const BatonCtxSqlReplayRevision *rev = &input->revisions[i];
    section->revisions[section->revisionCount] = dup_bytes(rev->revision, strlen(rev->revision));
    if (!section->revisions[section->revisionCount]) {
      *stage = BATON_CTX_SQL_ALLOCATION_FAILED;
      return 1;
    }
    section->revisionCount++;
    if (input->cancelFlag && *input->cancelFlag) {
      section->cancelled = 1;
      section->aborted = 1;
      *stage = BATON_CTX_SQL_CANCELLED;
      *code = SQLITE_INTERRUPT;
      stopped = 1;
      break;
    }
    const char *cursor = (const char *)rev->sql;
    const char *endp = cursor + rev->sqlLength;
    size_t statementIndex = 0;
    int revFailed = 0;
    while (cursor < endp) {
      size_t remaining = (size_t)(endp - cursor);
      if (remaining > (size_t)INT_MAX) {
        revFailed = 1;
        *code = SQLITE_TOOBIG;
        if (!*message)
          *message = dup_bytes("script bytes exceed sqlite3_prepare_v2 int", 42);
        break;
      }
      sqlite3_stmt *stmt = NULL;
      const char *next = NULL;
      int src = sqlite3_prepare_v2(db, cursor, (int)remaining, &stmt, &next);
      if (src != SQLITE_OK) {
        revFailed = 1;
        *code = src;
        const char *m = sqlite3_errmsg(db);
        if (!*message) *message = m ? dup_bytes(m, strlen(m)) : NULL;
        break;
      }
      if (next == cursor) {
        revFailed = 1;
        *code = SQLITE_INTERNAL;
        if (!*message) *message = dup_bytes("statement cursor did not advance", 33);
        break;
      }
      cursor = next;
      if (!stmt) continue; /* empty statement: comments and whitespace */
      int stepFailed = 0;
      for (;;) {
        int src2 = sqlite3_step(stmt);
        if (src2 == SQLITE_DONE) break;
        if (src2 != SQLITE_ROW) {
          stepFailed = 1;
          *code = src2;
          const char *m = sqlite3_errmsg(db);
          if (!*message) *message = m ? dup_bytes(m, strlen(m)) : NULL;
          break;
        }
      }
      if (sqlite3_finalize(stmt) != SQLITE_OK && !stepFailed) {
        stepFailed = 1;
        *code = SQLITE_INTERNAL;
        if (!*message) *message = dup_bytes("statement finalize failed", 25);
      }
      if (stepFailed) {
        revFailed = 1;
        break;
      }
      if (section->statementCount) buf_lit(&section->statements, ",");
      buf_lit(&section->statements, "{");
      buf_hex_field(&section->statements, "revisionHex", rev->revision,
                    rev->revision ? strlen(rev->revision) : 0);
      buf_hex_field(&section->statements, "sha256Hex", rev->sha256,
                    rev->sha256 ? strlen(rev->sha256) : 0);
      buf_lit(&section->statements, ",\"index\":");
      buf_ull(&section->statements, (unsigned long long)statementIndex);
      buf_lit(&section->statements, ",\"status\":\"ok\",\"code\":0,\"messageHex\":null}");
      section->statementCount++;
      statementIndex++;
    }
    if (revFailed) {
      stopped = 1;
      section->aborted = 1;
      if (section->statementCount) buf_lit(&section->statements, ",");
      buf_lit(&section->statements, "{");
      buf_hex_field(&section->statements, "revisionHex", rev->revision,
                    rev->revision ? strlen(rev->revision) : 0);
      buf_hex_field(&section->statements, "sha256Hex", rev->sha256,
                    rev->sha256 ? strlen(rev->sha256) : 0);
      buf_lit(&section->statements, ",\"index\":");
      buf_ull(&section->statements, (unsigned long long)statementIndex);
      buf_lit(&section->statements, ",\"status\":\"failed\",\"code\":");
      buf_num(&section->statements, *code);
      buf_hex_field(&section->statements, "messageHex", *message,
                    *message ? strlen(*message) : 0);
      buf_lit(&section->statements, "}");
      section->statementCount++;
      if (*stage == BATON_CTX_SQL_OK) {
        *stage = (*code == SQLITE_INTERRUPT && input->cancelFlag && *input->cancelFlag)
                     ? BATON_CTX_SQL_CANCELLED
                     : BATON_CTX_SQL_REPLAY_REVISION_FAILED;
      }
    }
    if (stopped) break;
  }
  buf_lit(&section->statements, "]");
  if (section->statements.oom) {
    *stage = BATON_CTX_SQL_ALLOCATION_FAILED;
    return 1;
  }
  return stopped;
}

int baton_ctx_sql_chain_replay(const BatonCtxSqlChainReplayInput *input,
                               BatonCtxSqlOutput *output) {
  if (!output) return -1;
  memset(output, 0, sizeof(*output));
  OutputSink sink;
  buf_init(&sink.record);
  sink.kind = "context-sqlite-chain-replay";

  if (!input || !input->revisions || input->revisionCount == 0 ||
      input->validatedPrefixCount > input->revisionCount) {
    output_finish(output, &sink, BATON_CTX_SQL_INPUT_INVALID, 0,
                  "chain replay input incomplete");
    return 0;
  }
  for (size_t i = 0; i < input->revisionCount; i++) {
    const BatonCtxSqlReplayRevision *rev = &input->revisions[i];
    if (!rev->revision || (rev->sqlLength > 0 && !rev->sql)) {
      output_finish(output, &sink, BATON_CTX_SQL_INPUT_INVALID, 0,
                    "chain replay input incomplete");
      return 0;
    }
    if (rev->sqlLength > 0 && bytes_contain_nul(rev->sql, rev->sqlLength)) {
      output_finish(output, &sink, BATON_CTX_SQL_SQL_NUL, 0,
                    "script bytes contain NUL");
      return 0;
    }
  }
  if (configure_scratch(input->scratchDirectory) != 0) {
    output_finish(output, &sink, BATON_CTX_SQL_TEMPDIR_UNAVAILABLE, 0,
                  "scratch directory unavailable");
    return 0;
  }
  if (input->cancelFlag && *input->cancelFlag) {
    output_finish(output, &sink, BATON_CTX_SQL_CANCELLED, 0, "cancelled");
    return 0;
  }

  int code = 0;
  char *message = NULL;
  BatonCtxSqlStage stage = BATON_CTX_SQL_OK;
  LibInfo lib;
  lib_info_probe(&lib);
  ReplaySection prefixSection;
  memset(&prefixSection, 0, sizeof(prefixSection));
  ReplaySection headSection;
  memset(&headSection, 0, sizeof(headSection));
  sqlite3 *prefixDb = NULL;
  sqlite3 *headDb = NULL;
  AuthCtx prefixAuth;
  AuthCtx headAuth;
  memset(&prefixAuth, 0, sizeof(prefixAuth));
  memset(&headAuth, 0, sizeof(headAuth));
  int closeFailed = 0;
  int tempStoreVerified = 0;

  record_open(&sink.record, "context-sqlite-chain-replay");

  int flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_MEMORY;
  int rc = sqlite3_open_v2(":memory:", &prefixDb, flags, NULL);
  if (rc != SQLITE_OK) {
    stage = BATON_CTX_SQL_OPEN_FAILED;
    code = rc;
    const char *m = prefixDb ? sqlite3_errmsg(prefixDb) : "cannot open database";
    message = dup_bytes(m, strlen(m));
    goto emit;
  }
  rc = sqlite3_open_v2(":memory:", &headDb, flags, NULL);
  if (rc != SQLITE_OK) {
    stage = BATON_CTX_SQL_OPEN_FAILED;
    code = rc;
    const char *m = headDb ? sqlite3_errmsg(headDb) : "cannot open database";
    message = dup_bytes(m, strlen(m));
    goto emit;
  }
  trace_install(prefixDb);
  trace_install(headDb);

  /* temp_store=MEMORY set and verified before the authorizer installs;
     internal readiness reads precede the script authorizer. */
  for (sqlite3 **slot = (sqlite3 *[]){prefixDb, headDb, NULL}; *slot; slot++) {
    sqlite3 *db = *slot;
    rc = sqlite3_exec(db, "PRAGMA temp_store=MEMORY", NULL, NULL, NULL);
    if (rc != SQLITE_OK) {
      stage = BATON_CTX_SQL_TEMPSTORE_UNVERIFIED;
      code = rc;
      message = dup_bytes(sqlite3_errmsg(db), strlen(sqlite3_errmsg(db)));
      goto emit;
    }
    Rows check;
    if (rows_capture(&check, db, "PRAGMA temp_store", &code, &message) != 0) {
      stage = BATON_CTX_SQL_TEMPSTORE_UNVERIFIED;
      goto emit;
    }
    int ok = check.nrows > 0 && check.rows[0].vals[0] &&
             strcmp(check.rows[0].vals[0], "2") == 0; /* 2 = MEMORY */
    rows_free(&check);
    if (!ok) {
      stage = BATON_CTX_SQL_TEMPSTORE_UNVERIFIED;
      if (!message) message = dup_bytes("temp_store verification failed", 30);
      goto emit;
    }
  }
  tempStoreVerified = 1;

  prefixAuth.mode = AUTH_REPLAY;
  prefixAuth.phase = "prefix-replay";
  headAuth.mode = AUTH_REPLAY;
  headAuth.phase = "head-replay";
  if (sqlite3_set_authorizer(prefixDb, auth_cb, &prefixAuth) != SQLITE_OK ||
      sqlite3_set_authorizer(headDb, auth_cb, &headAuth) != SQLITE_OK) {
    stage = BATON_CTX_SQL_AUTHORIZER_FAILED;
    sqlite3 *db = prefixAuth.head ? prefixDb : headDb;
    code = sqlite3_extended_errcode(db);
    message = dup_bytes(sqlite3_errmsg(db), strlen(sqlite3_errmsg(db)));
    goto emit;
  }
  if (input->cancelFlag) {
    sqlite3_progress_handler(prefixDb, 1000, progress_cb,
                             (void *)(volatile sig_atomic_t *)input->cancelFlag);
    sqlite3_progress_handler(headDb, 1000, progress_cb,
                             (void *)(volatile sig_atomic_t *)input->cancelFlag);
  }

  prefixSection.auth = &prefixAuth;
  headSection.auth = &headAuth;
  {
    int stopped = replay_run_slice(prefixDb, &prefixAuth, &prefixSection, input,
                                   0, input->validatedPrefixCount, &code,
                                   &message, &stage);
    int headStopped = replay_run_slice(headDb, &headAuth, &headSection, input,
                                       0, input->revisionCount, &code,
                                       &message, &stage);
    stopped = stopped || headStopped;
    (void)stopped;
  }

  for (sqlite3 **slot = (sqlite3 *[]){prefixDb, headDb, NULL}; *slot; slot++) {
    ReplaySection *section = *slot == prefixDb ? &prefixSection : &headSection;
    section->haveAutocommit = 1;
    section->autocommitAtEnd = sqlite3_get_autocommit(*slot) != 0;
    if (!section->autocommitAtEnd && stage == BATON_CTX_SQL_OK)
      stage = BATON_CTX_SQL_REPLAY_OPEN_TRANSACTION;
    int ccode = 0;
    char *cmsg = NULL;
    if (cat_objects_capture(&section->objects, *slot, &ccode, &cmsg) != 0) {
      if (stage == BATON_CTX_SQL_OK) {
        stage = BATON_CTX_SQL_SNAPSHOT_FAILED;
        code = ccode;
        message = cmsg;
        cmsg = NULL;
      }
    }
    free(cmsg);
    Rows sv;
    if (rows_capture(&sv, *slot, "PRAGMA schema_version", &ccode, &cmsg) == 0) {
      if (sv.nrows > 0 && sv.rows[0].vals[0]) {
        section->haveSchemaVersion = 1;
        section->schemaVersion = strtoll(sv.rows[0].vals[0], NULL, 10);
      }
    }
    rows_free(&sv);
    free(cmsg);
    if (input->cancelFlag && *input->cancelFlag) section->cancelled = 1;
  }

emit:
  /* Checked close before serialization so the record carries its result. */
  if (prefixDb) {
    if (sqlite3_close(prefixDb) != SQLITE_OK) closeFailed = 1;
    prefixDb = NULL;
  }
  if (headDb) {
    if (sqlite3_close(headDb) != SQLITE_OK) closeFailed = 1;
    headDb = NULL;
  }
  if (closeFailed && stage == BATON_CTX_SQL_OK) {
    stage = BATON_CTX_SQL_CLOSE_FAILED;
    if (!message) message = dup_bytes("close failed", 12);
  }

  {
    Buf *b = &sink.record;
    lib_info_json(b, &lib);
    status_json(b, stage, code, message);
    scratch_json(b, input->scratchDirectory,
                 input->scratchDirectory && *input->scratchDirectory,
                 tempStoreVerified);
    buf_lit(b, ",\"prefix\":");
    replay_section_json(b, &prefixSection);
    buf_lit(b, ",\"head\":");
    replay_section_json(b, &headSection);
    if (closeFailed) buf_lit(b, ",\"closeFailed\":true");
    buf_lit(b, "}");
  }

  output_finish(output, &sink, stage, code, message);

  free(message);
  replay_section_free(&prefixSection);
  replay_section_free(&headSection);
  auth_events_free(&prefixAuth);
  auth_events_free(&headAuth);
  lib_info_free(&lib);
  return output_failed(output) ? -1 : 0;
}

/* ---------------------------------------------------------- exports ----- */

void baton_ctx_sql_output_free(BatonCtxSqlOutput *output) {
  if (!output) return;
  free(output->message);
  free(output->record);
  memset(output, 0, sizeof(*output));
}

const char *baton_ctx_sql_stage_name(BatonCtxSqlStage stage) {
  switch (stage) {
    case BATON_CTX_SQL_OK: return "ok";
    case BATON_CTX_SQL_INPUT_INVALID: return "inputInvalid";
    case BATON_CTX_SQL_TEMPDIR_UNAVAILABLE: return "tempdirUnavailable";
    case BATON_CTX_SQL_OPEN_FAILED: return "openFailed";
    case BATON_CTX_SQL_IDENTITY_FAILED: return "identityFailed";
    case BATON_CTX_SQL_SNAPSHOT_FAILED: return "snapshotFailed";
    case BATON_CTX_SQL_DROPMODULES_FAILED: return "dropModulesFailed";
    case BATON_CTX_SQL_AUTHORIZER_FAILED: return "authorizerFailed";
    case BATON_CTX_SQL_SQL_UTF8: return "sqlUtf8";
    case BATON_CTX_SQL_SQL_NUL: return "sqlNul";
    case BATON_CTX_SQL_SQL_EMPTY: return "sqlEmpty";
    case BATON_CTX_SQL_SQL_BIND: return "sqlBind";
    case BATON_CTX_SQL_PREPARE_FAILED: return "prepareFailed";
    case BATON_CTX_SQL_NOT_READONLY: return "notReadonly";
    case BATON_CTX_SQL_IS_EXPLAIN: return "isExplain";
    case BATON_CTX_SQL_TAIL_REMAINS: return "tailRemains";
    case BATON_CTX_SQL_EXPLAIN_PREPARE_FAILED: return "explainPrepareFailed";
    case BATON_CTX_SQL_EXPLAIN_STEP_FAILED: return "explainStepFailed";
    case BATON_CTX_SQL_CANCELLED: return "cancelled";
    case BATON_CTX_SQL_CLOSE_FAILED: return "closeFailed";
    case BATON_CTX_SQL_ALLOCATION_FAILED: return "allocationFailed";
    case BATON_CTX_SQL_SQL_LENGTH_EXCEEDS_INT: return "sqlLengthExceedsInt";
    case BATON_CTX_SQL_TEMPSTORE_UNVERIFIED: return "tempstoreUnverified";
    case BATON_CTX_SQL_REPLAY_REVISION_FAILED: return "replayRevisionFailed";
    case BATON_CTX_SQL_REPLAY_OPEN_TRANSACTION: return "replayOpenTransaction";
    default: return "unknown";
  }
}
