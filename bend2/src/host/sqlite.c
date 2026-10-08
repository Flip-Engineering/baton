#include <sqlite3.h>
#include <errno.h>
#include <fcntl.h>
#include <sys/file.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* This projection contains only cursor and summary fields. Message bodies and
   reader-visible state remain in the coordinator tables. The triggers run in
   the same transaction as the row mutation. */
static const char *const baton_change_schema[] = {
  "CREATE TABLE IF NOT EXISTS native_changes (change_id INTEGER PRIMARY KEY AUTOINCREMENT,recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),entity TEXT NOT NULL,entity_id TEXT NOT NULL,session_id TEXT NOT NULL DEFAULT '',operation TEXT NOT NULL CHECK(operation IN ('insert','update','delete')),kind TEXT NOT NULL DEFAULT '',summary TEXT NOT NULL DEFAULT '');",
  "DROP TRIGGER IF EXISTS native_changes_retention;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_sessions_insert AFTER INSERT ON sessions BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('player',NEW.id,NEW.id,'insert','session','session inserted'); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_sessions_update AFTER UPDATE ON sessions WHEN OLD.parent IS NOT NEW.parent OR OLD.harness IS NOT NEW.harness OR OLD.model IS NOT NEW.model OR OLD.effort IS NOT NEW.effort OR OLD.native IS NOT NEW.native OR OLD.observed_harness IS NOT NEW.observed_harness OR OLD.observed_model IS NOT NEW.observed_model OR OLD.observed_effort IS NOT NEW.observed_effort OR OLD.endpoint IS NOT NEW.endpoint OR OLD.workspace IS NOT NEW.workspace OR OLD.branch IS NOT NEW.branch OR OLD.base IS NOT NEW.base BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('player',NEW.id,NEW.id,'update','session','session updated'); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_sessions_delete AFTER DELETE ON sessions BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('player',OLD.id,OLD.id,'delete','session','session deleted'); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_roles_insert AFTER INSERT ON session_roles BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('role',NEW.session,NEW.session,'insert','role',NEW.role); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_roles_update AFTER UPDATE ON session_roles WHEN OLD.role IS NOT NEW.role BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('role',NEW.session,NEW.session,'update','role',NEW.role); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_roles_delete AFTER DELETE ON session_roles BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('role',OLD.session,OLD.session,'delete','role',OLD.role); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_executions_insert AFTER INSERT ON executions BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('execution',NEW.session,NEW.session,'insert','execution',NEW.phase || ' ' || NEW.status); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_executions_update AFTER UPDATE ON executions WHEN OLD.id IS NOT NEW.id OR OLD.mode IS NOT NEW.mode OR OLD.directory IS NOT NEW.directory OR OLD.phase IS NOT NEW.phase OR OLD.status IS NOT NEW.status BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('execution',NEW.session,NEW.session,'update','execution',NEW.phase || ' ' || NEW.status); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_executions_delete AFTER DELETE ON executions BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('execution',OLD.session,OLD.session,'delete','execution',OLD.phase || ' ' || OLD.status); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_stops_insert AFTER INSERT ON session_stops BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('stop',NEW.session,NEW.session,'insert','stop',NEW.outcome); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_stops_update AFTER UPDATE ON session_stops WHEN OLD.id IS NOT NEW.id OR OLD.reason IS NOT NEW.reason OR OLD.attempt IS NOT NEW.attempt OR OLD.directory IS NOT NEW.directory OR OLD.signal IS NOT NEW.signal OR OLD.applied_signal IS NOT NEW.applied_signal OR OLD.control_error IS NOT NEW.control_error OR OLD.outcome IS NOT NEW.outcome OR OLD.native_status IS NOT NEW.native_status OR OLD.report_id IS NOT NEW.report_id BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('stop',NEW.session,NEW.session,'update','stop',NEW.outcome); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_stops_delete AFTER DELETE ON session_stops BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('stop',OLD.session,OLD.session,'delete','stop',OLD.outcome); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_messages_insert AFTER INSERT ON messages BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('message',NEW.id,NEW.recipient,'insert','message:' || NEW.kind,NEW.kind || ' from ' || NEW.sender); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_messages_update AFTER UPDATE ON messages WHEN OLD.sender IS NOT NEW.sender OR OLD.recipient IS NOT NEW.recipient OR OLD.kind IS NOT NEW.kind OR OLD.body IS NOT NEW.body OR OLD.receipt IS NOT NEW.receipt BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('message',NEW.id,NEW.recipient,'update',CASE WHEN OLD.receipt IS NOT NEW.receipt THEN 'receipt' ELSE 'message:' || NEW.kind END,CASE WHEN OLD.receipt IS NOT NEW.receipt THEN 'acknowledged' ELSE NEW.kind || ' from ' || NEW.sender END); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_messages_delete AFTER DELETE ON messages BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('message',OLD.id,OLD.recipient,'delete','message:' || OLD.kind,OLD.kind || ' from ' || OLD.sender); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_turns_insert AFTER INSERT ON turns BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('turn',NEW.id,NEW.worker,'insert','report','turn report recorded'); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_turns_update AFTER UPDATE ON turns WHEN OLD.worker IS NOT NEW.worker OR OLD.event IS NOT NEW.event BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('turn',NEW.id,NEW.worker,'update','report','turn report updated'); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_turns_delete AFTER DELETE ON turns BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('turn',OLD.id,OLD.worker,'delete','report','turn report removed'); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_ensembles_insert AFTER INSERT ON ensembles BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('ensemble',NEW.id,NEW.owner,'insert','ensemble',NEW.coupling); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_ensembles_update AFTER UPDATE ON ensembles WHEN OLD.owner IS NOT NEW.owner OR OLD.coupling IS NOT NEW.coupling BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('ensemble',NEW.id,NEW.owner,'update','ensemble',NEW.coupling); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_ensembles_delete AFTER DELETE ON ensembles BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('ensemble',OLD.id,OLD.owner,'delete','ensemble',OLD.coupling); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_members_insert AFTER INSERT ON ensemble_members BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('membership',NEW.ensemble,NEW.session,'insert','membership',NEW.ensemble); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_members_delete AFTER DELETE ON ensemble_members BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('membership',OLD.ensemble,OLD.session,'delete','membership',OLD.ensemble); END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_sections_insert AFTER INSERT ON sections BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) SELECT 'section',NEW.ensemble || '/' || NEW.id,e.owner,'insert','section',NEW.capability FROM ensembles e WHERE e.id=NEW.ensemble; END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_sections_update AFTER UPDATE ON sections WHEN OLD.ensemble IS NOT NEW.ensemble OR OLD.id IS NOT NEW.id OR OLD.capability IS NOT NEW.capability BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) SELECT 'section',NEW.ensemble || '/' || NEW.id,e.owner,'update','section',NEW.capability FROM ensembles e WHERE e.id=NEW.ensemble; END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_sections_delete AFTER DELETE ON sections BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) SELECT 'section',OLD.ensemble || '/' || OLD.id,e.owner,'delete','section',OLD.capability FROM ensembles e WHERE e.id=OLD.ensemble; END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_section_members_insert AFTER INSERT ON section_members BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) SELECT 'section-membership',NEW.ensemble || '/' || NEW.section,NEW.session,'insert','section-membership',s.capability FROM sections s WHERE s.ensemble=NEW.ensemble AND s.id=NEW.section; END;",
  "CREATE TRIGGER IF NOT EXISTS native_changes_section_members_delete AFTER DELETE ON section_members BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) SELECT 'section-membership',OLD.ensemble || '/' || OLD.section,OLD.session,'delete','section-membership',s.capability FROM sections s WHERE s.ensemble=OLD.ensemble AND s.id=OLD.section; END;",
  NULL
};

static int baton_sql_install_projection(sqlite3 *db, const char *schema, char **error) {
  int code = sqlite3_exec(db, "BEGIN IMMEDIATE", NULL, NULL, error);
  if (code == SQLITE_OK)
    code = sqlite3_exec(db, schema, NULL, NULL, error);
  for (size_t i = 0; code == SQLITE_OK && baton_change_schema[i]; i++)
    code = sqlite3_exec(db, baton_change_schema[i], NULL, NULL, error);
  if (code == SQLITE_OK)
    code = sqlite3_exec(db, "COMMIT", NULL, NULL, error);
  if (code != SQLITE_OK)
    sqlite3_exec(db, "ROLLBACK", NULL, NULL, NULL);
  return code;
}

/* Bend supplies SQL and transaction boundaries. This effect executes SQLite calls
   on an IO worker and returns the rows of the last SELECT as newline-separated text. */
typedef struct {
  char *path, *sql, *output, *error;
  size_t length;
  int code, mode, projection_only;
} BatonSql;

static int baton_sql_row(void *context, int count, char **values, char **columns) {
  BatonSql *call = context;
  (void)columns;
  for (int i = 0; i < count; i++) {
    const char *value = values[i] ? values[i] : "";
    size_t n = strlen(value);
    char *next = realloc(call->output, call->length + n + 2);
    if (!next) return 1;
    call->output = next;
    memcpy(next + call->length, value, n);
    call->length += n;
    next[call->length++] = i + 1 == count ? '\n' : '\t';
    next[call->length] = 0;
  }
  return 0;
}

static int baton_sql_busy(void *context, int tries) {
  (void)context; (void)tries;
  sqlite3_sleep(10);
  return 1;
}

static void baton_sql_call(IoWork *w) {
  BatonSql *call = (BatonSql *)w->data;
  sqlite3 *db = NULL;
  call->code = sqlite3_open(call->path, &db);
  if (call->code != SQLITE_OK) {
    call->error = strdup(db ? sqlite3_errmsg(db) : "cannot open database");
  } else {
    sqlite3_busy_handler(db, baton_sql_busy, NULL);
    char *error = NULL;
    call->code = sqlite3_exec(db, "PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;", NULL, NULL, &error);
    if (call->code == SQLITE_OK) {
      if (call->projection_only)
        call->code = baton_sql_install_projection(db, call->sql, &error);
      else
        call->code = sqlite3_exec(db, call->sql, baton_sql_row, call, &error);
    }
    if (call->code != SQLITE_OK) {
      call->error = strdup(error ? error : sqlite3_errmsg(db));
      sqlite3_exec(db, "ROLLBACK", NULL, NULL, NULL);
    }
    sqlite3_free(error);
  }
  if (db) sqlite3_close(db);
}

static Term baton_sql_pack(Env e, IoWork *w) {
  BatonSql *call = (BatonSql *)w->data;
  Term result = call->code == SQLITE_OK
    ? io_done(e, io_str(e, call->output ? call->output : "", call->length))
    : io_fail(e, call->code, call->error ? call->error : "SQLite failed");
  free(call->path); free(call->sql); free(call->output); free(call->error); free(call);
  w->data = NULL;
  return result;
}

/* The effect ID uses the definition name from the Bend source. */
#ifdef CID_SQL_QUERY
static Term baton_sql_run(Env e, Term *f, IoWork *w) {
  BatonSql *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  u64 path_n = 0, sql_n = 0;
  call->path = io_cstr(e, f[0], &path_n);
  call->sql = io_cstr(e, f[1], &sql_n);
  if (strlen(call->path) != path_n || strlen(call->sql) != sql_n) {
    free(call->path); free(call->sql); free(call);
    return io_fail(e, EINVAL, "database path or SQL contains NUL");
  }
  w->data = (char *)call;
  return io_work(w, baton_sql_call, baton_sql_pack);
}
static void __attribute__((constructor)) baton_sql_use(void) {
  io_eff(CID_SQL_QUERY, baton_sql_run, 0);
}
#endif


#ifdef CID_SQL_ENSURE_PROJECTION
static Term baton_sql_ensure_projection_run(Env e, Term *f, IoWork *w) {
  BatonSql *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  u64 path_n = 0, schema_n = 0;
  call->path = io_cstr(e, f[0], &path_n);
  call->sql = io_cstr(e, f[1], &schema_n);
  if (strlen(call->path) != path_n || strlen(call->sql) != schema_n) {
    free(call->path); free(call->sql); free(call);
    return io_fail(e, EINVAL, "database path or schema contains NUL");
  }
  call->projection_only = 1;
  w->data = (char *)call;
  return io_work(w, baton_sql_call, baton_sql_pack);
}
static void __attribute__((constructor)) baton_sql_ensure_projection_use(void) {
  io_eff(CID_SQL_ENSURE_PROJECTION, baton_sql_ensure_projection_run, 0);
}
#endif

/* Bound-database operations. Sql.binding returns the canonical binding of an
   existing coordination database and Sql.query_bound compares that binding
   before running caller SQL; both share baton_sql_binding_open. The helper
   opens the database READWRITE without CREATE and without URI handling,
   rejects a read-only connection, an in-memory or temporary database and a
   non-default VFS, and records the VFS name the connection reports. The two
   SQLITE_FCNTL_HAS_MOVED checks around realpath()/stat() bind the observed
   pathname identity to the connection at the moment of the check: they do not
   expose SQLite's internal file descriptor and do not prove that the file was
   not replaced concurrently, so concurrent replacement during the operation
   stays outside the guarantee.

   The comparison is closed: the expected text must be exactly one flat JSON
   object with the members scheme, version, path, device, file, birth and vfs,
   each exactly once, and an optional string `token`; unknown members,
   duplicates, malformed values, a missing member and bytes after the closing
   brace are mismatches. The physical tuple (scheme, version, device, file,
   birth) is compared first, then the canonical path and VFS name, then the
   token. A nonzero-length expected token must be matched by the observed
   binding before caller SQL runs; an in-place restoration that preserves the
   physical tuple and the token stays outside the detection guarantee. A
   binding whose scheme cannot be qualified (no birth-time incarnation
   discriminator) is refused as unavailable rather than advertised. No SQL text
   and no credential enters the binding text. */

#include <ctype.h>
#include <sys/stat.h>
#include <limits.h>
#ifdef __linux__
#include <linux/stat.h>
#include <sys/syscall.h>
#include <sys/sysmacros.h>
#endif

#define BATON_SQL_UNAVAILABLE "context database binding unavailable: "
#define BATON_SQL_MISMATCH "context database binding mismatch: "

typedef struct {
  char *path, *expected, *sql, *output, *observed, *error;
  size_t length;
  int code, kind;
} BatonSqlBound;

typedef struct { char *path, *expected, *role; int fd, error; } BatonSqlRoleGuard;

/* The closed reading of an expected binding: raw value text per member, the
   member bits seen so far and the first refusal reason. */
static const char *const baton_sql_member_names[7] = {
  "scheme", "version", "path", "device", "file", "birth", "vfs"
};

typedef struct {
  char *value[7];
  char *token;
  int seen, ok, token_seen;
  const char *reason;
} BatonSqlExpected;

static const char *baton_sql_skip_space(const char *s) {
  while (*s == ' ' || *s == '\t' || *s == '\n' || *s == '\r') s++;
  return s;
}

/* The end of the JSON value starting at s: a string keeps its quotes, a
   container is skipped balanced and a scalar ends at its member separator. */
static const char *baton_sql_value_end(const char *s) {
  if (*s == '"') {
    for (s++; *s; s++) {
      if (*s == '\\' && s[1]) s++;
      else if (*s == '"') return s + 1;
    }
    return s;
  }
  if (*s == '{' || *s == '[') {
    char open = *s, close = open == '{' ? '}' : ']';
    int depth = 0;
    for (; *s; s++) {
      if (*s == '"') { s = baton_sql_value_end(s) - 1; continue; }
      if (*s == open) depth++;
      else if (*s == close && !--depth) return s + 1;
    }
    return s;
  }
  while (*s && *s != ',' && *s != '}' && *s != ']') s++;
  return s;
}

/* Returns the original bytes of a refs array element after SQLite validates the
   document. The element index comes from json_each's integer array key. */
static void baton_sql_ref_entry(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  const char *doc = (const char *)sqlite3_value_text(argv[0]);
  sqlite3_int64 wanted = sqlite3_value_int64(argv[1]);
  if (!doc || wanted < 0) { sqlite3_result_null(context); return; }
  sqlite3 *db = sqlite3_context_db_handle(context);
  sqlite3_stmt *probe = NULL;
  int rc = sqlite3_prepare_v2(db, "SELECT json_valid(?1)", -1, &probe, NULL);
  if (rc != SQLITE_OK) { sqlite3_result_error_code(context, rc); return; }
  sqlite3_bind_value(probe, 1, argv[0]);
  int valid = sqlite3_step(probe) == SQLITE_ROW && sqlite3_column_int(probe, 0);
  sqlite3_finalize(probe);
  if (!valid || strlen(doc) != (size_t)sqlite3_value_bytes(argv[0])) {
    sqlite3_result_error(context, "invalid retained JSON document", -1); return;
  }
  rc = sqlite3_prepare_v2(db, "SELECT json_extract(?1,'$')='refs'", -1, &probe, NULL);
  if (rc != SQLITE_OK) { sqlite3_result_error_code(context, rc); return; }
  const char *at = baton_sql_skip_space(doc);
  if (*at == '{') for (at++; ; ) {
    at = baton_sql_skip_space(at);
    if (*at != '"') break;
    const char *key_end = baton_sql_value_end(at);
    sqlite3_bind_text64(probe, 1, at, (sqlite3_uint64)(key_end-at), SQLITE_TRANSIENT, SQLITE_UTF8);
    int refs = sqlite3_step(probe) == SQLITE_ROW && sqlite3_column_int(probe, 0);
    sqlite3_reset(probe); sqlite3_clear_bindings(probe);
    at = baton_sql_skip_space(key_end);
    if (*at++ != ':') break;
    at = baton_sql_skip_space(at);
    const char *end = baton_sql_value_end(at);
    if (refs && *at == '[') {
      at = baton_sql_skip_space(at + 1);
      for (sqlite3_int64 index = 0; *at && *at != ']'; index++) {
        const char *entry_end = baton_sql_value_end(at);
        if (index == wanted) {
          sqlite3_result_text64(context, at, (sqlite3_uint64)(entry_end-at), SQLITE_TRANSIENT, SQLITE_UTF8);
          sqlite3_finalize(probe); return;
        }
        at = baton_sql_skip_space(entry_end);
        if (*at != ',') break;
        at = baton_sql_skip_space(at + 1);
      }
      break;
    }
    at = baton_sql_skip_space(end);
    if (*at != ',') break;
    at++;
  }
  sqlite3_finalize(probe);
  sqlite3_result_null(context);
}

/* Copies the raw value text of one top-level member of a flat JSON object into
   a fresh buffer. Returns 1 when the member is present and 0 otherwise. */
static int baton_sql_member(const char *json, const char *key, char **value) {
  size_t key_n = strlen(key);
  const char *s = baton_sql_skip_space(json);
  if (*s != '{') return 0;
  for (s++; ; ) {
    s = baton_sql_skip_space(s);
    if (*s != '"') return 0;
    const char *start = ++s;
    while (*s && *s != '"') {
      if (*s == '\\' && s[1]) s += 2;
      else s++;
    }
    if (*s != '"') return 0;
    size_t n = (size_t)(s - start);
    int found = n == key_n && !memcmp(start, key, n);
    s = baton_sql_skip_space(s + 1);
    if (*s != ':') return 0;
    s = baton_sql_skip_space(s + 1);
    const char *end = baton_sql_value_end(s);
    const char *trim = end;
    while (trim > s && (trim[-1] == ' ' || trim[-1] == '\t' || trim[-1] == '\n' || trim[-1] == '\r')) trim--;
    if (found) {
      size_t length = (size_t)(trim - s);
      char *copy = malloc(length + 1);
      if (!copy) return 0;
      memcpy(copy, s, length);
      copy[length] = 0;
      *value = copy;
      return 1;
    }
    s = baton_sql_skip_space(end);
    if (*s == ',') { s++; continue; }
    return 0;
  }
}

/* Reads the JSON scalar at *at: a string when number is 0, a decimal number
   otherwise. Copies the raw value text and advances *at. */
static int baton_sql_expected_scalar(const char **at, int number, char **out) {
  const char *s = *at, *start = s;
  if (number) {
    if (*s == '-') s++;
    const char *digits = s;
    while (*s >= '0' && *s <= '9') s++;
    if (s == digits) return 0;
  } else {
    if (*s != '"') return 0;
    for (s++; *s && *s != '"'; s++) {
      if (*s != '\\') continue;
      if (!s[1] || !strchr("\"\\/bfnrtu", s[1])) return 0;
      if (s[1] != 'u') { s++; continue; }
      for (int i = 2; i < 6; i++) if (!isxdigit((unsigned char)s[i])) return 0;
      s += 5;
    }
    if (*s != '"') return 0;
    s++;
  }
  size_t length = (size_t)(s - start);
  char *copy = malloc(length + 1);
  if (!copy) return 0;
  memcpy(copy, start, length);
  copy[length] = 0;
  *out = copy;
  *at = s;
  return 1;
}

/* Reads the expected binding as exactly one flat JSON object carrying each
   required member once, an optional token, and nothing after the closing
   brace. A refusal records a short reason: the first malformed member name,
   `format`, `duplicate`, `unknown`, `trailing` or a missing member name. */
static void baton_sql_expected_parse(const char *text, BatonSqlExpected *out) {
  memset(out, 0, sizeof(*out));
  const char *s = text;
  if (*s != '{') { out->reason = "format"; return; }
  int after_comma = 0;
  for (s++; ; ) {
    if (*s == '}') { if (after_comma) { out->reason = "format"; return; } s++; break; }
    if (*s != '"') { out->reason = "format"; return; }
    after_comma = 0;
    const char *start = ++s;
    while (*s && *s != '"') {
      if (*s == '\\') { out->reason = "format"; return; }
      s++;
    }
    if (*s != '"') { out->reason = "format"; return; }
    size_t length = (size_t)(s - start);
    s++;
    int index = -1;
    for (int i = 0; i < 7; i++)
      if (strlen(baton_sql_member_names[i]) == length && !memcmp(start, baton_sql_member_names[i], length)) index = i;
    int token = length == 5 && !memcmp(start, "token", 5);
    if (index < 0 && !token) { out->reason = "unknown"; return; }
    if (index >= 0 && (out->seen & (1 << index))) { out->reason = "duplicate"; return; }
    if (index < 0 && out->token) { out->reason = "duplicate"; return; }
    s = baton_sql_skip_space(s);
    if (*s != ':') { out->reason = "format"; return; }
    s = baton_sql_skip_space(s + 1);
    int number = index == 1 || index == 3 || index == 4 || index == 5;
    char *value = NULL;
    if (!baton_sql_expected_scalar(&s, number, &value)) { out->reason = "format"; return; }
    if (index >= 0) {
      out->value[index] = value;
      out->seen |= 1 << index;
    } else { out->token = value; out->token_seen = 1; }
    s = baton_sql_skip_space(s);
    if (*s == ',') { s++; after_comma = 1; continue; }
    if (*s != '}') { out->reason = "format"; return; }
    s++;
    break;
  }
  if (*s) { out->reason = "trailing"; return; }
  if (out->seen != 0x7f) {
    for (int i = 0; i < 7; i++)
      if (!(out->seen & (1 << i))) { out->reason = baton_sql_member_names[i]; return; }
  }
  out->ok = 1;
}

/* Compares the closed expected reading with the observed binding: the physical
   tuple first, then the canonical path and VFS, then the token. Returns the
   differing member name and 0 when the binding is checked. */
static const char *baton_sql_expected_difference(const BatonSqlExpected *expected, const char *observed) {
  static const int order[7] = {0, 1, 3, 4, 5, 2, 6};
  for (int i = 0; i < 7; i++) {
    int index = order[i];
    char *have = NULL;
    int present = baton_sql_member(observed, baton_sql_member_names[index], &have);
    int differs = !present || strcmp(expected->value[index], have);
    free(have);
    if (differs) return baton_sql_member_names[index];
  }
  if (expected->token_seen) {
    char *have = NULL;
    int present = baton_sql_member(observed, "token", &have);
    int differs = !present || strcmp(expected->token, have);
    free(have);
    if (differs) return "token";
  }
  return NULL;
}

/* One JSON string literal with the escapes canonical text needs; the result
   carries no tab and no newline, so the binding stays one column value. */
static size_t baton_sql_json_string(char *out, const char *text) {
  size_t used = 0;
  out[used++] = '"';
  for (size_t i = 0; text[i]; i++) {
    unsigned char c = (unsigned char)text[i];
    switch (c) {
      case '"': out[used++] = '\\'; out[used++] = '"'; break;
      case '\\': out[used++] = '\\'; out[used++] = '\\'; break;
      case '\b': out[used++] = '\\'; out[used++] = 'b'; break;
      case '\f': out[used++] = '\\'; out[used++] = 'f'; break;
      case '\n': out[used++] = '\\'; out[used++] = 'n'; break;
      case '\r': out[used++] = '\\'; out[used++] = 'r'; break;
      case '\t': out[used++] = '\\'; out[used++] = 't'; break;
      default:
        if (c < 0x20) { sprintf(out + used, "\\u%04x", c); used += 6; }
        else out[used++] = (char)c;
    }
  }
  out[used++] = '"';
  return used;
}

/* Birth time in nanoseconds, or 0 when the platform cannot supply a positive
   incarnation discriminator. Size, mtime and ctime are deliberately absent:
   they change during ordinary writes. */
static unsigned long long baton_sql_birth(const char *path, const struct stat *info) {
#ifdef __APPLE__
  (void)path;
  if (info->st_birthtimespec.tv_sec <= 0) return 0;
  return (unsigned long long)info->st_birthtimespec.tv_sec * 1000000000ull
    + (unsigned long long)info->st_birthtimespec.tv_nsec;
#elif defined(__linux__) && defined(SYS_statx)
  struct statx observed;
  memset(&observed, 0, sizeof(observed));
  if (syscall(SYS_statx, AT_FDCWD, path, 0, STATX_BTIME | STATX_INO | STATX_TYPE, &observed)) return 0;
  if ((observed.stx_mask & (STATX_BTIME | STATX_INO | STATX_TYPE)) != (STATX_BTIME | STATX_INO | STATX_TYPE)) return 0;
  if (!S_ISREG(observed.stx_mode) || observed.stx_ino != (unsigned long long)info->st_ino ||
      makedev(observed.stx_dev_major, observed.stx_dev_minor) != info->st_dev) return 0;
  if (observed.stx_btime.tv_sec <= 0 || observed.stx_btime.tv_nsec >= 1000000000u) return 0;
  unsigned long long seconds = (unsigned long long)observed.stx_btime.tv_sec;
  if (seconds > (ULLONG_MAX - observed.stx_btime.tv_nsec) / 1000000000ull) return 0;
  return seconds * 1000000000ull + observed.stx_btime.tv_nsec;
#else
  (void)path;
  (void)info;
  return 0;
#endif
}

/* The canonical binding: identity scheme and version, canonical absolute path,
   physical device/file tuple, incarnation discriminator and serving VFS. */
static char *baton_sql_binding_text(const char *path, const char *vfs, unsigned long long device,
                                    unsigned long long file, unsigned long long birth) {
  size_t size = 256 + 6 * strlen(path) + 6 * strlen(vfs);
  char *text = malloc(size);
  if (!text) return NULL;
  size_t used = 0;
  used += (size_t)snprintf(text + used, size - used,
    "{\"scheme\":\"dev-ino-birth\",\"version\":1,\"path\":");
  used += baton_sql_json_string(text + used, path);
  used += (size_t)snprintf(text + used, size - used,
    ",\"device\":%llu,\"file\":%llu,\"birth\":%llu,\"vfs\":", device, file, birth);
  used += baton_sql_json_string(text + used, vfs);
  used += (size_t)snprintf(text + used, size - used, "}");
  return text;
}

static char *baton_sql_message(const char *prefix, const char *reason) {
  size_t head = strlen(prefix), tail = strlen(reason);
  char *text = malloc(head + tail + 1);
  if (!text) return NULL;
  memcpy(text, prefix, head);
  memcpy(text + head, reason, tail + 1);
  return text;
}

/* Acquires the existing coordination database at `path` and returns its
   canonical binding text through *binding. Returns 0 and leaves *out holding
   the open connection on success; otherwise records a stable short reason and
   returns the refusal code. */
static int baton_sql_binding_open(const char *path, sqlite3 **out, char **binding, const char **reason) {
  *out = NULL;
  *binding = NULL;
  *reason = NULL;
  if (!strncmp(path, "file:", 5)) { *reason = "uri"; return SQLITE_MISUSE; }
  sqlite3_vfs *vfs = sqlite3_vfs_find(NULL);
  sqlite3 *db = NULL;
  int code = sqlite3_open_v2(path, &db, SQLITE_OPEN_READWRITE, vfs ? vfs->zName : NULL);
  if (code != SQLITE_OK) {
    if (db) sqlite3_close(db);
    *reason = "open";
    return code;
  }
  if (sqlite3_db_readonly(db, "main")) {
    sqlite3_close(db);
    *reason = "readonly";
    return SQLITE_READONLY;
  }
  const char *filename = sqlite3_db_filename(db, "main");
  if (!filename || !*filename || !strcmp(filename, ":memory:")) {
    sqlite3_close(db);
    *reason = "memory";
    return SQLITE_MISUSE;
  }
  char *vfs_name = NULL;
  code = sqlite3_file_control(db, "main", SQLITE_FCNTL_VFSNAME, &vfs_name);
  if (code != SQLITE_OK || !vfs_name || !vfs || strcmp(vfs->zName, vfs_name)) {
    sqlite3_free(vfs_name);
    sqlite3_close(db);
    *reason = "vfs";
    return SQLITE_MISUSE;
  }
  int moved = -1;
  code = sqlite3_file_control(db, "main", SQLITE_FCNTL_HAS_MOVED, &moved);
  if (code != SQLITE_OK || moved != 0) {
    sqlite3_free(vfs_name);
    sqlite3_close(db);
    *reason = "moved";
    return SQLITE_MISUSE;
  }
  filename = sqlite3_db_filename(db, "main");
  if (!filename || !*filename || !strcmp(filename, ":memory:")) {
    sqlite3_free(vfs_name);
    sqlite3_close(db);
    *reason = "memory";
    return SQLITE_MISUSE;
  }
  char *resolved = realpath(filename, NULL);
  if (!resolved) {
    sqlite3_free(vfs_name);
    sqlite3_close(db);
    *reason = "path";
    return ENOENT;
  }
  struct stat info;
  if (stat(resolved, &info) || !S_ISREG(info.st_mode)) {
    free(resolved);
    sqlite3_free(vfs_name);
    sqlite3_close(db);
    *reason = "stat";
    return ENOENT;
  }
  moved = -1;
  code = sqlite3_file_control(db, "main", SQLITE_FCNTL_HAS_MOVED, &moved);
  if (code != SQLITE_OK || moved != 0) {
    free(resolved);
    sqlite3_free(vfs_name);
    sqlite3_close(db);
    *reason = "moved";
    return SQLITE_MISUSE;
  }
  if (!info.st_dev || !info.st_ino) {
    free(resolved);
    sqlite3_free(vfs_name);
    sqlite3_close(db);
    *reason = "schema";
    return SQLITE_MISUSE;
  }
  /* The scheme is advertised only with its evidence: without a birth-time
     incarnation discriminator the platform cannot qualify dev-ino-birth. */
  unsigned long long birth = baton_sql_birth(resolved, &info);
  if (!birth) {
    free(resolved);
    sqlite3_free(vfs_name);
    sqlite3_close(db);
    *reason = "discriminator";
    return SQLITE_MISUSE;
  }
  char *text = baton_sql_binding_text(resolved, vfs_name, (unsigned long long)info.st_dev,
    (unsigned long long)info.st_ino, birth);
  free(resolved);
  sqlite3_free(vfs_name);
  if (!text) {
    sqlite3_close(db);
    *reason = "schema";
    return ENOMEM;
  }
  *out = db;
  *binding = text;
  return 0;
}

/* Rows of the bound call use exactly the Sql.query format: columns joined by a
   tab and each row terminated by a newline. */
static int baton_sql_bound_row(void *context, int count, char **values, char **columns) {
  BatonSqlBound *call = context;
  (void)columns;
  for (int i = 0; i < count; i++) {
    const char *value = values[i] ? values[i] : "";
    size_t n = strlen(value);
    char *next = realloc(call->output, call->length + n + 2);
    if (!next) return 1;
    call->output = next;
    memcpy(next + call->length, value, n);
    call->length += n;
    next[call->length++] = i + 1 == count ? '\n' : '\t';
    next[call->length] = 0;
  }
  return 0;
}

static void baton_sql_bound_call(IoWork *w) {
  BatonSqlBound *call = (BatonSqlBound *)w->data;
  sqlite3 *db = NULL;
  const char *reason = NULL;
  call->code = baton_sql_binding_open(call->path, &db, &call->observed, &reason);
  if (call->code) {
    call->error = baton_sql_message(BATON_SQL_UNAVAILABLE, reason ? reason : "schema");
    return;
  }
  if (call->kind == 1) {
    sqlite3_close(db);
    return;
  }
  BatonSqlExpected expected;
  baton_sql_expected_parse(call->expected, &expected);
  const char *detail = expected.ok ? baton_sql_expected_difference(&expected, call->observed) : expected.reason;
  for (int i = 0; i < 7; i++) free(expected.value[i]);
  free(expected.token);
  if (detail) {
    call->code = SQLITE_MISUSE;
    call->error = baton_sql_message(BATON_SQL_MISMATCH, detail);
    sqlite3_close(db);
    return;
  }
  sqlite3_busy_handler(db, baton_sql_busy, NULL);
  char *error = NULL;
  call->code = sqlite3_create_function_v2(db, "baton_ref_entry", 2, SQLITE_UTF8 | SQLITE_DETERMINISTIC, NULL, baton_sql_ref_entry, NULL, NULL, NULL);
  if (call->code == SQLITE_OK)
    call->code = sqlite3_exec(db, "PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;", NULL, NULL, &error);
  if (call->code == SQLITE_OK)
    call->code = sqlite3_exec(db, call->sql, baton_sql_bound_row, call, &error);
  if (call->code != SQLITE_OK) {
    call->error = strdup(error ? error : sqlite3_errmsg(db));
    sqlite3_exec(db, "ROLLBACK", NULL, NULL, NULL);
  }
  sqlite3_free(error);
  sqlite3_close(db);
}

static Term baton_sql_bound_pack(Env e, IoWork *w) {
  BatonSqlBound *call = (BatonSqlBound *)w->data;
  char *value = call->kind == 1 ? call->observed : call->output;
  size_t length = value ? strlen(value) : 0;
  Term result = call->code == SQLITE_OK
    ? io_done(e, io_str(e, value ? value : "", length))
    : io_fail(e, call->code, call->error ? call->error : "SQLite failed");
  free(call->path); free(call->expected); free(call->sql); free(call->output);
  free(call->observed); free(call->error); free(call);
  w->data = NULL;
  return result;
}

static int baton_sql_role_directory(char *out, size_t size) {
  const char *runtime = getenv("XDG_RUNTIME_DIR");
  char runtime_path[PATH_MAX], temporary_path[PATH_MAX];
  const char *choices[2] = { NULL, NULL };
  if (runtime && *runtime) {
    int n = snprintf(runtime_path, sizeof(runtime_path), "%s/baton2", runtime);
    if (n > 0 && (size_t)n < sizeof(runtime_path)) choices[0] = runtime_path;
  }
  int n = snprintf(temporary_path, sizeof(temporary_path), "/tmp/baton2-%u", (unsigned)geteuid());
  if (n > 0 && (size_t)n < sizeof(temporary_path)) choices[1] = temporary_path;
  for (size_t i = 0; i < 2; i++) {
    if (!choices[i] || !*choices[i]) continue;
    struct stat info;
    if (mkdir(choices[i], 0700) && errno != EEXIST) continue;
    if (lstat(choices[i], &info) || !S_ISDIR(info.st_mode) || info.st_uid != geteuid()) continue;
    if ((info.st_mode & 0077) && chmod(choices[i], 0700)) continue;
    if (snprintf(out, size, "%s", choices[i]) > 0 && strlen(choices[i]) < size) return 0;
  }
  return EACCES;
}

static int baton_sql_role_guard_call(BatonSqlRoleGuard *call) {
  sqlite3 *db = NULL;
  char *observed = NULL;
  const char *reason = NULL;
  int code = baton_sql_binding_open(call->path, &db, &observed, &reason);
  if (code) return code;
  BatonSqlExpected expected;
  baton_sql_expected_parse(call->expected, &expected);
  const char *detail = expected.ok ? baton_sql_expected_difference(&expected, observed) : expected.reason;
  if (detail) code = SQLITE_MISUSE;
  char *device = expected.value[3] ? strdup(expected.value[3]) : NULL;
  char *file = expected.value[4] ? strdup(expected.value[4]) : NULL;
  char *birth = expected.value[5] ? strdup(expected.value[5]) : NULL;
  for (int i = 0; i < 7; i++) free(expected.value[i]);
  free(expected.token); free(observed); sqlite3_close(db);
  if (code) { free(device); free(file); free(birth); return code; }
  if (!device || !file || !birth || strlen(call->role) != 64) {
    free(device); free(file); free(birth); return EINVAL;
  }
  for (size_t i = 0; i < 64; i++)
    if (!((call->role[i] >= '0' && call->role[i] <= '9') ||
          (call->role[i] >= 'a' && call->role[i] <= 'f'))) {
      free(device); free(file); free(birth); return EINVAL;
    }
  char directory[PATH_MAX], path[PATH_MAX];
  code = baton_sql_role_directory(directory, sizeof(directory));
  if (!code) {
    int n = snprintf(path, sizeof(path), "%s/role-%s-%s-%s-%s.lock",
      directory, device, file, birth, call->role);
    if (n <= 0 || (size_t)n >= sizeof(path)) code = ENAMETOOLONG;
  }
  free(device); free(file); free(birth);
  if (code) return code;
  int fd = open(path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (fd < 0) return errno;
  if (fd < 3) {
    int safe_fd = fcntl(fd, F_DUPFD_CLOEXEC, 3);
    int saved = errno;
    close(fd);
    if (safe_fd < 0) return saved;
    fd = safe_fd;
  }
  struct stat info;
  if (fstat(fd, &info)) { code = errno; close(fd); return code; }
  if (!S_ISREG(info.st_mode) || info.st_uid != geteuid()) { close(fd); return EPERM; }
  if ((info.st_mode & 0077) && fchmod(fd, 0600)) { code = errno; close(fd); return code; }
  int result;
  do { result = flock(fd, LOCK_EX | LOCK_NB); } while (result < 0 && errno == EINTR);
  if (result < 0) { code = errno; close(fd); return code; }
  call->fd = fd;
  return 0;
}

static Term baton_sql_role_guard_pack(Env e, IoWork *w) {
  BatonSqlRoleGuard *call = (BatonSqlRoleGuard *)w->data;
  Term result = call->error ? io_fail(e, (u32)call->error, "physical role guard acquisition failed")
    : io_done(e, (Term)call->fd);
  free(call->path); free(call->expected); free(call->role); free(call);
  w->data = NULL;
  return result;
}

static void baton_sql_role_guard_work(IoWork *w) {
  BatonSqlRoleGuard *call = (BatonSqlRoleGuard *)w->data;
  call->error = baton_sql_role_guard_call(call);
}

#ifdef CID_SQL_ROLE_GUARD
static Term baton_sql_role_guard_run(Env e, Term *f, IoWork *w) {
  BatonSqlRoleGuard *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  u64 path_n = 0, binding_n = 0, role_n = 0;
  call->path = io_cstr(e, f[0], &path_n);
  call->expected = io_cstr(e, f[1], &binding_n);
  call->role = io_cstr(e, f[2], &role_n);
  call->fd = -1;
  if (!call->path || !call->expected || !call->role) call->error = EINVAL;
  if (!call->error && (strlen(call->path) != path_n || strlen(call->expected) != binding_n || strlen(call->role) != role_n))
    call->error = EINVAL;
  w->data = (char *)call;
  if (call->error) return baton_sql_role_guard_pack(e, w);
  return io_work(w, baton_sql_role_guard_work, baton_sql_role_guard_pack);
}
static void __attribute__((constructor)) baton_sql_role_guard_use(void) {
  io_eff(CID_SQL_ROLE_GUARD, baton_sql_role_guard_run, 0);
}
#endif

/* The effect IDs use the definition names from the Bend source. */
#ifdef CID_SQL_BINDING
static Term baton_sql_binding_run(Env e, Term *f, IoWork *w) {
  BatonSqlBound *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  call->kind = 1;
  u64 path_n = 0;
  call->path = io_cstr(e, f[0], &path_n);
  if (strlen(call->path) != path_n) {
    free(call->path); free(call);
    return io_fail(e, EINVAL, "database path contains NUL");
  }
  w->data = (char *)call;
  return io_work(w, baton_sql_bound_call, baton_sql_bound_pack);
}
static void __attribute__((constructor)) baton_sql_binding_use(void) {
  io_eff(CID_SQL_BINDING, baton_sql_binding_run, 0);
}
#endif

#ifdef CID_SQL_QUERY_BOUND
static Term baton_sql_query_bound_run(Env e, Term *f, IoWork *w) {
  BatonSqlBound *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  call->kind = 2;
  u64 path_n = 0, binding_n = 0, sql_n = 0;
  call->path = io_cstr(e, f[0], &path_n);
  call->expected = io_cstr(e, f[1], &binding_n);
  call->sql = io_cstr(e, f[2], &sql_n);
  if (strlen(call->path) != path_n || strlen(call->expected) != binding_n || strlen(call->sql) != sql_n) {
    free(call->path); free(call->expected); free(call->sql); free(call);
    return io_fail(e, EINVAL, "database path, binding or SQL contains NUL");
  }
  w->data = (char *)call;
  return io_work(w, baton_sql_bound_call, baton_sql_bound_pack);
}
static void __attribute__((constructor)) baton_sql_query_bound_use(void) {
  io_eff(CID_SQL_QUERY_BOUND, baton_sql_query_bound_run, 0);
}
#endif

/* UTF-8 admission for the read-only operation: RFC 3629 sequences only, no
   overlong form, no surrogate range and no value above U+10FFFF. */
static int baton_sql_utf8_ok(const unsigned char *text, size_t length) {
  size_t i = 0;
  while (i < length) {
    unsigned char c = text[i];
    size_t extra;
    unsigned int code;
    if (c < 0x80) { i++; continue; }
    if ((c & 0xe0) == 0xc0) { extra = 1; code = c & 0x1f; }
    else if ((c & 0xf0) == 0xe0) { extra = 2; code = c & 0x0f; }
    else if ((c & 0xf8) == 0xf0) { extra = 3; code = c & 0x07; }
    else return 0;
    if (i + extra >= length + 0 && i + extra > length - 1) return 0;
    for (size_t k = 1; k <= extra; k++) {
      unsigned char n = text[i + k];
      if ((n & 0xc0) != 0x80) return 0;
      code = (code << 6) | (n & 0x3f);
    }
    if (extra == 1 && code < 0x80) return 0;
    if (extra == 2 && code < 0x800) return 0;
    if (extra == 3 && code < 0x10000) return 0;
    if (code >= 0xd800 && code <= 0xdfff) return 0;
    if (code > 0x10ffff) return 0;
    i += extra + 1;
  }
  return 1;
}

/* The read-only call shares BatonSql and the existing row callback and pack
   function, so no second structure layout can diverge from the callback's cast. */
/* The shared sqlite3_exec error slot is SQLite-owned, so every reason written into
   it comes from sqlite3_mprintf and is released with sqlite3_free by the caller. The
   prepare/step status is preserved rather than translated into encoding text, and
   the encoding refusal is reported only when the pragma itself was read. */
/* A distinct status for an encoding this operation observed and refuses, separate
   from the SQLite status of a failed prepare, step or finalize. SQLITE_MISMATCH is a
   real SQLite code and carries no SQLite text of its own, so the helper supplies it. */
#define BATON_SQL_NOT_UTF8 SQLITE_MISMATCH

static int baton_sql_encoding_status(sqlite3 *db, char **error) {
  sqlite3_stmt *statement = NULL;
  int status = sqlite3_prepare_v2(db, "PRAGMA encoding;", -1, &statement, NULL);
  if (status != SQLITE_OK) {
    *error = sqlite3_mprintf("%s", sqlite3_errmsg(db));
    return status;
  }
  status = sqlite3_step(statement);
  if (status != SQLITE_ROW) {
    if (status == SQLITE_DONE) status = SQLITE_ERROR;
    *error = sqlite3_mprintf("%s", sqlite3_errmsg(db));
    sqlite3_finalize(statement);
    return status;
  }
  const unsigned char *value = sqlite3_column_text(statement, 0);
  int utf8 = value && sqlite3_stricmp((const char *)value, "UTF-8") == 0;
  int final = sqlite3_finalize(statement);
  if (final != SQLITE_OK) {
    *error = sqlite3_mprintf("%s", sqlite3_errmsg(db));
    return final;
  }
  if (!utf8) {
    *error = sqlite3_mprintf("database encoding is not UTF-8");
    return BATON_SQL_NOT_UTF8;
  }
  return SQLITE_OK;
}

static void baton_sql_read_call(IoWork *w) {
  BatonSql *call = (BatonSql *)w->data;
  sqlite3 *db = NULL;
  call->code = sqlite3_open_v2(call->path, &db, SQLITE_OPEN_READONLY, NULL);
  if (call->code != SQLITE_OK) {
    call->error = strdup(db ? sqlite3_errmsg(db) : "cannot open database read-only");
  } else {
    sqlite3_busy_handler(db, baton_sql_busy, NULL);
    char *error = NULL;
    /* A read-only connection runs no write pragma. Foreign keys are a read-side
       setting; the opened database's encoding is admitted before any caller SQL
       because compact projections measure bytes with CAST(text AS BLOB). */
    call->code = sqlite3_exec(db, "PRAGMA foreign_keys=ON;", NULL, NULL, &error);
    if (call->code == SQLITE_OK) {
      int encoding = baton_sql_encoding_status(db, &error);
      if (encoding != SQLITE_OK) call->code = encoding;
    }
    if (call->code == SQLITE_OK)
      call->code = sqlite3_exec(db, call->sql, baton_sql_row, call, &error);
    if (call->code != SQLITE_OK) {
      call->error = strdup(error ? error : sqlite3_errmsg(db));
      sqlite3_exec(db, "ROLLBACK", NULL, NULL, NULL);
    }
    sqlite3_free(error);
  }
  if (db) sqlite3_close(db);
}

#ifdef CID_SQL_READ
static Term baton_sql_read_run(Env e, Term *f, IoWork *w) {
  BatonSql *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  call->mode = 1;
  u64 path_n = 0, sql_n = 0;
  call->path = io_cstr(e, f[0], &path_n);
  call->sql = io_cstr(e, f[1], &sql_n);
  if (strlen(call->path) != path_n || strlen(call->sql) != sql_n) {
    free(call->path); free(call->sql); free(call);
    return io_fail(e, EINVAL, "database path or SQL contains NUL");
  }
  if (!baton_sql_utf8_ok((const unsigned char *)call->path, path_n) ||
      !baton_sql_utf8_ok((const unsigned char *)call->sql, sql_n)) {
    free(call->path); free(call->sql); free(call);
    return io_fail(e, EINVAL, "database path or SQL is not valid UTF-8");
  }
  w->data = (char *)call;
  return io_work(w, baton_sql_read_call, baton_sql_pack);
}
static void __attribute__((constructor)) baton_sql_read_use(void) {
  io_eff(CID_SQL_READ, baton_sql_read_run, 0);
}
#endif
