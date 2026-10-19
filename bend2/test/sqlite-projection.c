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
  "CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY NOT NULL, worker TEXT NOT NULL, event TEXT NOT NULL);"
  "CREATE TABLE IF NOT EXISTS executions (session TEXT PRIMARY KEY NOT NULL, id TEXT NOT NULL, mode TEXT NOT NULL, directory TEXT NOT NULL, phase TEXT NOT NULL, status TEXT NOT NULL DEFAULT '');"
  "CREATE TABLE IF NOT EXISTS session_stops (session TEXT PRIMARY KEY NOT NULL, id TEXT UNIQUE NOT NULL, reason TEXT NOT NULL, attempt TEXT NOT NULL DEFAULT '', directory TEXT NOT NULL DEFAULT '', signal INTEGER NOT NULL DEFAULT 15, applied_signal INTEGER NOT NULL DEFAULT 0, control_error TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL, native_status TEXT NOT NULL DEFAULT '', report_id TEXT NOT NULL DEFAULT '');"
  "CREATE TABLE IF NOT EXISTS ensembles (id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, coupling TEXT NOT NULL);"
  "CREATE TABLE IF NOT EXISTS ensemble_members (ensemble TEXT NOT NULL, session TEXT NOT NULL);"
  "CREATE TABLE IF NOT EXISTS sections (ensemble TEXT NOT NULL, id TEXT NOT NULL, capability TEXT NOT NULL);"
  "CREATE TABLE IF NOT EXISTS section_members (ensemble TEXT NOT NULL, section TEXT NOT NULL, session TEXT NOT NULL);";

int main(int argc, char **argv) {
  if (argc < 3) { fprintf(stderr, "usage: hold|install|install-busy DB [N]\n"); return 2; }
  sqlite3 *db = NULL;
  int rc = sqlite3_open(argv[2], &db);
  if (rc != SQLITE_OK) { printf("open=%d\n", rc); return 1; }
  if (!strcmp(argv[1], "hold")) {
    char *e = NULL;
    rc = sqlite3_exec(db, "BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS holder_t(x); INSERT INTO holder_t VALUES(1);", NULL, NULL, &e);
    printf("hold_rc=%d\n", rc);
    fflush(stdout);
    sleep(3);
    sqlite3_exec(db, "ROLLBACK", NULL, NULL, NULL);
    sqlite3_close(db);
    return 0;
  }
  if (!strcmp(argv[1], "install-busy")) sqlite3_busy_handler(db, baton_sql_busy, NULL);
  else sqlite3_busy_timeout(db, 0);
  int n = argc > 3 ? atoi(argv[3]) : 1;
  double t0 = now_ms();
  int last = SQLITE_OK;
  char *err = NULL;
  for (int i = 0; i < n; i++) {
    err = NULL;
    last = baton_sql_install_projection(db, SCHEMA, &err);
    if (last != SQLITE_OK) {
      printf("iter=%d code=%d err=%s ms=%.1f\n", i, last, err ? err : "", now_ms() - t0);
      break;
    }
  }
  if (last == SQLITE_OK) printf("code=0 n=%d ms=%.1f\n", n, now_ms() - t0);
  sqlite3_close(db);
  return last == SQLITE_OK ? 0 : 1;
}
