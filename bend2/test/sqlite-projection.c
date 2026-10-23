/* Fixture main for the sqlite-projection checks. The test runner prepends
   the verbatim projection section of bend2/src/host/sqlite.c (through
   baton_sql_install_projection and baton_sql_busy), so this file only
   supplies the schema and the scenario driver. */
#include <time.h>

static double now_ms(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1000.0 + t.tv_nsec / 1e6;
}

static const char *SCHEMA =
  "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY NOT NULL, parent TEXT, harness TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', effort TEXT NOT NULL DEFAULT '', native TEXT NOT NULL DEFAULT '', observed_harness TEXT NOT NULL DEFAULT '', observed_model TEXT NOT NULL DEFAULT '', observed_effort TEXT NOT NULL DEFAULT '', endpoint TEXT NOT NULL DEFAULT '', workspace TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', base TEXT NOT NULL DEFAULT '');"
  "CREATE TABLE IF NOT EXISTS session_roles (session TEXT NOT NULL, role TEXT NOT NULL);"
  "CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, receipt TEXT);"
  "DROP INDEX IF EXISTS messages_pending;CREATE INDEX IF NOT EXISTS messages_recipient_seq ON messages(recipient,seq,id);"
  "CREATE TABLE IF NOT EXISTS message_reads(attempt TEXT NOT NULL, message TEXT NOT NULL, recipient TEXT NOT NULL, native TEXT NOT NULL, identity TEXT NOT NULL, handled TEXT, PRIMARY KEY(attempt,identity,message));"
  "CREATE INDEX IF NOT EXISTS message_reads_message ON message_reads(message,recipient);"
  "CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY NOT NULL, worker TEXT NOT NULL, event TEXT NOT NULL);"
  "CREATE TABLE IF NOT EXISTS executions (session TEXT PRIMARY KEY NOT NULL, id TEXT NOT NULL, mode TEXT NOT NULL, directory TEXT NOT NULL, phase TEXT NOT NULL, status TEXT NOT NULL DEFAULT '');"
  "CREATE TABLE IF NOT EXISTS session_stops (session TEXT PRIMARY KEY NOT NULL, id TEXT UNIQUE NOT NULL, reason TEXT NOT NULL, attempt TEXT NOT NULL DEFAULT '', directory TEXT NOT NULL DEFAULT '', signal INTEGER NOT NULL DEFAULT 15, applied_signal INTEGER NOT NULL DEFAULT 0, control_error TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL, native_status TEXT NOT NULL DEFAULT '', report_id TEXT NOT NULL DEFAULT '');"
  "CREATE TABLE IF NOT EXISTS ensembles (id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, coupling TEXT NOT NULL);"
  "CREATE TABLE IF NOT EXISTS ensemble_members (ensemble TEXT NOT NULL, session TEXT NOT NULL);"
  "CREATE TABLE IF NOT EXISTS sections (ensemble TEXT NOT NULL, id TEXT NOT NULL, capability TEXT NOT NULL);"
  "CREATE TABLE IF NOT EXISTS section_members (ensemble TEXT NOT NULL, section TEXT NOT NULL, session TEXT NOT NULL);"
  "CREATE TABLE IF NOT EXISTS usage_windows (id TEXT PRIMARY KEY NOT NULL, used INTEGER NOT NULL DEFAULT 0);";

static const char *BAD_SCHEMA = "CREATE TABLE broken(";

static int print_row(void *context, int count, char **values, char **columns) {
  (void)context;
  (void)columns;
  for (int i = 0; i < count; i++)
    printf("%s%s", i ? "|" : "", values[i] ? values[i] : "");
  printf("\n");
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: hold|hold-read|read-call|install|install-busy|state|recover|bad DB [N]\n");
    return 2;
  }
  if (!strcmp(argv[1], "read-call")) {
    BatonSql call;
    memset(&call, 0, sizeof(call));
    IoWork work;
    work.data = &call;
    char sql[] = "BEGIN; SELECT count(*) FROM messages;";
    call.path = argv[2];
    call.sql = sql;
    baton_sql_read_call(&work);
    printf("read_call=1 code=%d output=%s error=%s\n",
           call.code, call.output ? call.output : "",
           call.error ? call.error : "");
    int code = call.code;
    free(call.output);
    free(call.error);
    if (code != SQLITE_OK)
      return 1;
    sqlite3 *writer = NULL;
    int writer_code = sqlite3_open(argv[2], &writer);
    if (writer_code != SQLITE_OK) {
      printf("writer_commit=failed err=open:%d\n", writer_code);
      if (writer) sqlite3_close(writer);
      return 1;
    }
    sqlite3_busy_timeout(writer, 0);
    char *writer_error = NULL;
    writer_code = sqlite3_exec(writer,
      "BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS read_call_release_probe(x); COMMIT;",
      NULL, NULL, &writer_error);
    printf("writer_commit=%s%s%s\n", writer_code == SQLITE_OK ? "ok" : "failed",
           writer_error ? " err=" : "", writer_error ? writer_error : "");
    sqlite3_free(writer_error);
    sqlite3_close(writer);
    return writer_code == SQLITE_OK ? 0 : 1;
  }
  sqlite3 *db = NULL;
  int rc = sqlite3_open(argv[2], &db);
  if (rc != SQLITE_OK) {
    printf("open=%d\n", rc);
    return 1;
  }
  sqlite3_busy_timeout(db, 0);
  if (!strcmp(argv[1], "hold")) {
    int seconds = argc > 3 ? atoi(argv[3]) : 5;
    char *error = NULL;
    rc = sqlite3_exec(db, "BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS holder_t(x); INSERT INTO holder_t VALUES(1);", NULL, NULL, &error);
    printf("hold_rc=%d%s%s\n", rc, error ? " err=" : "", error ? error : "");
    fflush(stdout);
    sqlite3_free(error);
    sleep(seconds);
    sqlite3_exec(db, "ROLLBACK", NULL, NULL, NULL);
    sqlite3_close(db);
    return 0;
  }
  if (!strcmp(argv[1], "hold-read")) {
    int seconds = argc > 3 ? atoi(argv[3]) : 5;
    char *error = NULL;
    rc = sqlite3_exec(db, "BEGIN; SELECT count(*) FROM messages;", NULL, NULL, &error);
    printf("read_held=%d%s%s\n", rc, error ? " err=" : "", error ? error : "");
    fflush(stdout);
    sqlite3_free(error);
    sleep(seconds);
    sqlite3_exec(db, "COMMIT", NULL, NULL, NULL);
    sqlite3_close(db);
    return 0;
  }
  if (!strcmp(argv[1], "state")) {
    char fingerprint[17];
    baton_sql_projection_fingerprint(SCHEMA, fingerprint);
    int current = baton_sql_projection_is_current(db, SCHEMA, fingerprint);
    sqlite3_int64 version = 0;
    int version_rc = baton_sql_scalar_int(db, "PRAGMA schema_version;", &version);
    printf("current=%d schema_version=%lld version_rc=%d\n",
           current, (long long)version, version_rc);
    sqlite3_close(db);
    return 0;
  }
  if (!strcmp(argv[1], "bad")) {
    char *error = NULL;
    rc = baton_sql_install_projection(db, BAD_SCHEMA, &error);
    printf("code=%d%s%s\n", rc, error ? " err=" : "", error ? error : "");
    sqlite3_free(error);
    sqlite3_close(db);
    return rc == SQLITE_OK ? 1 : 0;
  }
  if (!strcmp(argv[1], "recover")) {
    sqlite3_busy_handler(db, baton_sql_busy, NULL);
    char *error = NULL;
    double started = now_ms();
    rc = sqlite3_exec(db,
      "SELECT 'status=' || phase || '/' || status FROM executions WHERE session='root';"
      "SELECT 'input=' || id || ':' || body FROM messages WHERE recipient='root' AND NOT EXISTS(SELECT 1 FROM message_reads r WHERE r.message=messages.id AND r.recipient=messages.recipient) LIMIT 1;",
      print_row, NULL, &error);
    printf("read_rc=%d ms=%.1f%s%s\n", rc, now_ms() - started,
           error ? " err=" : "", error ? error : "");
    sqlite3_free(error);
    if (rc == SQLITE_OK) {
      error = NULL;
      started = now_ms();
      rc = sqlite3_exec(db, "BEGIN IMMEDIATE; INSERT INTO message_reads(attempt,message,recipient,native,identity) SELECT 'probe','m1','root','','probe' WHERE NOT EXISTS(SELECT 1 FROM message_reads WHERE message='m1' AND recipient='root'); COMMIT;", NULL, NULL, &error);
      printf("settle_rc=%d ms=%.1f%s%s\n", rc, now_ms() - started,
             error ? " err=" : "", error ? error : "");
      sqlite3_free(error);
    }
    sqlite3_close(db);
    return rc == SQLITE_OK ? 0 : 1;
  }
  int use_busy = !strcmp(argv[1], "install-busy");
  if (use_busy) sqlite3_busy_handler(db, baton_sql_busy, NULL);
  int n = argc > 3 ? atoi(argv[3]) : 1;
  double started = now_ms();
  int last = SQLITE_OK;
  char *error = NULL;
  for (int i = 0; i < n; i++) {
    error = NULL;
    last = baton_sql_install_projection(db, SCHEMA, &error);
    if (last != SQLITE_OK) {
      printf("iter=%d code=%d ms=%.1f%s%s\n", i, last, now_ms() - started,
             error ? " err=" : "", error ? error : "");
      sqlite3_free(error);
      break;
    }
  }
  if (last == SQLITE_OK)
    printf("code=0 n=%d ms=%.1f\n", n, now_ms() - started);
  sqlite3_close(db);
  return last == SQLITE_OK ? 0 : 1;
}
