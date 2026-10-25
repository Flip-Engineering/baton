/* Fixture main for the write-ahead-log checks (#1054). The test runner prepends
   the verbatim baton_sql_busy and baton_sql_wal functions of
   bend2/src/host/sqlite.c, so this file only supplies the connection
   scenarios. A Baton connection installs the busy handler, then the journal
   mode, then the pragmas, as the host's read-write open paths do. */
#include <time.h>

static double now_ms(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1000.0 + t.tv_nsec / 1e6;
}

static int print_row(void *context, int count, char **values, char **columns) {
  (void)context;
  (void)columns;
  for (int i = 0; i < count; i++)
    printf("%s%s", i ? "|" : "", values[i] ? values[i] : "");
  printf("\n");
  return 0;
}

static int open_baton(const char *path, sqlite3 **db) {
  int rc = sqlite3_open(path, db);
  if (rc != SQLITE_OK) return rc;
  sqlite3_busy_handler(*db, baton_sql_busy, NULL);
  baton_sql_wal(*db);
  return sqlite3_exec(*db, "PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;", NULL, NULL, NULL);
}

/* A connection of a binary built before this change: busy handler and
   pragmas, no journal-mode statement. */
static int open_old(const char *path, sqlite3 **db) {
  int rc = sqlite3_open(path, db);
  if (rc != SQLITE_OK) return rc;
  sqlite3_busy_handler(*db, baton_sql_busy, NULL);
  return sqlite3_exec(*db, "PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;", NULL, NULL, NULL);
}

static int write_value(sqlite3 *db, const char *value) {
  char sql[256];
  snprintf(sql, sizeof sql, "INSERT INTO t(v) VALUES('%s');", value);
  double start = now_ms();
  char *error = NULL;
  int rc = sqlite3_exec(db, sql, NULL, NULL, &error);
  printf("write_rc=%d ms=%.0f%s%s\n", rc, now_ms() - start, error ? " err=" : "", error ? error : "");
  sqlite3_free(error);
  return rc;
}

int main(int argc, char **argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: open|write|old-write|read-only DB [VALUE]\n");
    return 2;
  }
  sqlite3 *db = NULL;
  int rc;
  if (!strcmp(argv[1], "open") || !strcmp(argv[1], "write")) {
    rc = open_baton(argv[2], &db);
  } else if (!strcmp(argv[1], "old-write")) {
    rc = open_old(argv[2], &db);
  } else if (!strcmp(argv[1], "read-only")) {
    rc = sqlite3_open_v2(argv[2], &db, SQLITE_OPEN_READONLY, NULL);
    if (rc == SQLITE_OK) sqlite3_busy_handler(db, baton_sql_busy, NULL);
  } else {
    fprintf(stderr, "unknown scenario %s\n", argv[1]);
    return 2;
  }
  if (rc != SQLITE_OK) {
    printf("open_rc=%d %s\n", rc, db ? sqlite3_errmsg(db) : "");
    sqlite3_close(db);
    return 1;
  }
  if (!strcmp(argv[1], "open")) {
    sqlite3_exec(db, "PRAGMA journal_mode;", print_row, NULL, NULL);
  } else if (!strcmp(argv[1], "write") || !strcmp(argv[1], "old-write")) {
    rc = write_value(db, argc > 3 ? argv[3] : "x");
  } else {
    char *error = NULL;
    rc = sqlite3_exec(db, "SELECT count(*) FROM t;", print_row, NULL, &error);
    printf("read_rc=%d%s%s\n", rc, error ? " err=" : "", error ? error : "");
    sqlite3_free(error);
  }
  sqlite3_close(db);
  return rc == SQLITE_OK ? 0 : 1;
}
