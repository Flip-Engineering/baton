#include <sqlite3.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>

/* Install a compact durable projection after the coordinator creates its tables.
   This keeps the schema DDL out of the large admitted Bend query literal. */
static const char *const baton_change_schema[] = {
  "CREATE TABLE IF NOT EXISTS native_changes (change_id INTEGER PRIMARY KEY AUTOINCREMENT,recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),entity TEXT NOT NULL,entity_id TEXT NOT NULL,session_id TEXT NOT NULL DEFAULT '',operation TEXT NOT NULL,kind TEXT NOT NULL,summary TEXT NOT NULL);",
  "CREATE TRIGGER IF NOT EXISTS native_changes_retention AFTER INSERT ON native_changes BEGIN DELETE FROM native_changes WHERE change_id<=NEW.change_id-10000; END;",
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
  "CREATE TRIGGER IF NOT EXISTS native_changes_messages_receipt AFTER UPDATE OF receipt ON messages WHEN OLD.receipt IS NOT NEW.receipt BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('message',NEW.id,NEW.recipient,'update','receipt','acknowledged'); END;",
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

static int baton_projection_ready(sqlite3 *db, int *ready) {
  sqlite3_stmt *statement = NULL;
  int code = sqlite3_prepare_v2(db,
    "SELECT count(*)=10 FROM sqlite_master WHERE type='table' AND name IN ('sessions','messages','turns','executions','session_stops','session_roles','ensembles','ensemble_members','sections','section_members')",
    -1, &statement, NULL);
  if (code != SQLITE_OK) return code;
  code = sqlite3_step(statement);
  if (code == SQLITE_ROW) *ready = sqlite3_column_int(statement, 0);
  sqlite3_finalize(statement);
  return code == SQLITE_ROW ? SQLITE_OK : code;
}

static int baton_install_projection(sqlite3 *db, char **error) {
  int own_transaction = sqlite3_get_autocommit(db);
  int code = own_transaction
    ? sqlite3_exec(db, "BEGIN IMMEDIATE", NULL, NULL, error)
    : SQLITE_OK;
  for (size_t i = 0; code == SQLITE_OK && baton_change_schema[i]; i++)
    code = sqlite3_exec(db, baton_change_schema[i], NULL, NULL, error);
  if (code == SQLITE_OK && own_transaction)
    code = sqlite3_exec(db, "COMMIT", NULL, NULL, error);
  if (code != SQLITE_OK && own_transaction)
    sqlite3_exec(db, "ROLLBACK", NULL, NULL, NULL);
  return code;
}

static int baton_ensure_projection(sqlite3 *db, int *installed, char **error) {
  int ready = 0;
  int code;
  if (*installed) return SQLITE_OK;
  code = baton_projection_ready(db, &ready);
  if (code != SQLITE_OK || !ready) return code;
  code = baton_install_projection(db, error);
  if (code == SQLITE_OK) *installed = 1;
  return code;
}

/* Bend supplies SQL and transaction boundaries. This effect executes SQLite calls
   on an IO worker and returns the rows of the last SELECT as newline-separated text. */
typedef struct {
  char *path, *sql, *output, *error;
  size_t length;
  int code;
} BatonSql;

static int baton_sql_statement_row(BatonSql *call, sqlite3_stmt *statement) {
  int count = sqlite3_column_count(statement);
  for (int i = 0; i < count; i++) {
    const unsigned char *raw = sqlite3_column_text(statement, i);
    const char *value = raw ? (const char *)raw : "";
    size_t n = strlen(value);
    char *next = realloc(call->output, call->length + n + 2);
    if (!next) return SQLITE_NOMEM;
    call->output = next;
    memcpy(next + call->length, value, n);
    call->length += n;
    next[call->length++] = i + 1 == count ? '\n' : '\t';
    next[call->length] = 0;
  }
  return SQLITE_OK;
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
    int projection_installed = 0;
    if (call->code == SQLITE_OK)
      call->code = baton_ensure_projection(db, &projection_installed, &error);
    const char *sql = call->sql;
    while (call->code == SQLITE_OK && sql && *sql) {
      sqlite3_stmt *statement = NULL;
      const char *tail = NULL;
      call->code = sqlite3_prepare_v2(db, sql, -1, &statement, &tail);
      if (call->code != SQLITE_OK) break;
      if (!statement) {
        if (tail == sql) break;
        sql = tail;
        continue;
      }
      int step;
      while ((step = sqlite3_step(statement)) == SQLITE_ROW) {
        call->code = baton_sql_statement_row(call, statement);
        if (call->code != SQLITE_OK) break;
      }
      if (call->code == SQLITE_OK && step != SQLITE_DONE) call->code = step;
      sqlite3_finalize(statement);
      if (call->code != SQLITE_OK) break;
      sql = tail;
      call->code = baton_ensure_projection(db, &projection_installed, &error);
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
