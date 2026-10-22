/* Fixture driver for the SQLite read-cache checks. The test runner prepends
   the BatonSql structure, its row callback, the busy handler and the marked
   read-cache section from bend2/src/host/sqlite.c. */
#include <sys/wait.h>
#include <time.h>
#include <sched.h>

static int create_simple_db(const char *path, int rows, int utf16) {
  sqlite3 *db = NULL;
  int code = sqlite3_open(path, &db);
  if (code != SQLITE_OK) {
    fprintf(stderr, "open %s: %s\n", path, db ? sqlite3_errmsg(db) : "failed");
    if (db) sqlite3_close(db);
    return 1;
  }
  char *error = NULL;
  if (utf16) code = sqlite3_exec(db, "PRAGMA encoding='UTF-16';", NULL, NULL, &error);
  if (code == SQLITE_OK)
    code = sqlite3_exec(db, "CREATE TABLE IF NOT EXISTS t(x INTEGER);", NULL, NULL, &error);
  sqlite3_stmt *statement = NULL;
  if (code == SQLITE_OK)
    code = sqlite3_prepare_v2(db, "INSERT INTO t(x) VALUES(?1);", -1, &statement, NULL);
  if (code == SQLITE_OK) code = sqlite3_exec(db, "BEGIN;", NULL, NULL, &error);
  for (int i = 0; code == SQLITE_OK && i < rows; i++) {
    sqlite3_bind_int(statement, 1, i);
    int step = sqlite3_step(statement);
    if (step != SQLITE_DONE) code = step;
    sqlite3_reset(statement);
    sqlite3_clear_bindings(statement);
  }
  if (statement) sqlite3_finalize(statement);
  if (code == SQLITE_OK) code = sqlite3_exec(db, "COMMIT;", NULL, NULL, &error);
  if (code != SQLITE_OK) {
    fprintf(stderr, "create %s: %s\n", path, error ? error : sqlite3_errmsg(db));
    sqlite3_free(error);
    sqlite3_close(db);
    return 1;
  }
  sqlite3_free(error);
  sqlite3_close(db);
  return 0;
}

static int create_replay_db(const char *path) {
  sqlite3 *db = NULL;
  if (sqlite3_open(path, &db) != SQLITE_OK) return 1;
  char *error = NULL;
  const char *schema =
    "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY NOT NULL, parent TEXT, harness TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', effort TEXT NOT NULL DEFAULT '', native TEXT NOT NULL DEFAULT '');"
    "CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, sender TEXT NOT NULL REFERENCES sessions(id), recipient TEXT NOT NULL REFERENCES sessions(id), kind TEXT NOT NULL, body TEXT NOT NULL, receipt TEXT);"
    "CREATE INDEX IF NOT EXISTS messages_pending ON messages(recipient,receipt,seq);"
    "CREATE TABLE IF NOT EXISTS session_stops (session TEXT PRIMARY KEY NOT NULL, id TEXT UNIQUE NOT NULL, reason TEXT NOT NULL, outcome TEXT NOT NULL);"
    "INSERT OR IGNORE INTO sessions(id,parent,harness) VALUES('root',NULL,'omp');";
  int code = sqlite3_exec(db, schema, NULL, NULL, &error);
  sqlite3_stmt *statement = NULL;
  if (code == SQLITE_OK)
    code = sqlite3_prepare_v2(db,
      "INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES(?1,'sender','root','task',?2,NULL);",
      -1, &statement, NULL);
  char body[201];
  memset(body, 'x', 200);
  body[200] = 0;
  for (int i = 0; code == SQLITE_OK && i < 100; i++) {
    char id[16];
    snprintf(id, sizeof(id), "m%06d", i);
    sqlite3_bind_text(statement, 1, id, -1, SQLITE_STATIC);
    sqlite3_bind_text(statement, 2, body, -1, SQLITE_STATIC);
    int step = sqlite3_step(statement);
    if (step != SQLITE_DONE) code = step;
    sqlite3_reset(statement);
  }
  if (statement) sqlite3_finalize(statement);
  if (code != SQLITE_OK) {
    fprintf(stderr, "create replay db: %s\n", error ? error : sqlite3_errmsg(db));
    sqlite3_free(error);
    sqlite3_close(db);
    return 1;
  }
  sqlite3_free(error);
  sqlite3_close(db);
  return 0;
}

static int write_spool(const char *path) {
  FILE *handle = fopen(path, "w");
  if (!handle) return 1;
  for (int i = 0; i < 158; i++) fputc('x', handle);
  fclose(handle);
  return 0;
}

static long long rchar_bytes(void) {
  FILE *handle = fopen("/proc/self/io", "r");
  if (!handle) return -1;
  char line[256];
  long long value = -1;
  while (fgets(line, sizeof(line), handle))
    if (sscanf(line, "rchar: %lld", &value) == 1) break;
  fclose(handle);
  return value;
}

static int check(const char *label, int code, const char *output,
                 const char *expected) {
  if (code != SQLITE_OK) {
    fprintf(stderr, "fail %s: code=%d output=%s\n", label, code,
            output ? output : "(null)");
    return 1;
  }
  if (expected && (!output || strcmp(output, expected) != 0)) {
    fprintf(stderr, "fail %s: output=%s expected=%s\n", label,
            output ? output : "(null)", expected);
    return 1;
  }
  printf("ok %s\n", label);
  return 0;
}

static int make_path(char *out, size_t size, const char *work, const char *name) {
  int written = snprintf(out, size, "%s/%s", work, name);
  return written < 0 || (size_t)written >= size;
}

typedef struct {
  const char *path;
  int code;
  uintptr_t connection;
} ThreadRead;

static int thread_barrier;

static void *thread_read(void *argument) {
  ThreadRead *state = argument;
  BatonSqlReadTestResult result;
  int run = baton_sql_read_test_run(state->path, "SELECT count(*) FROM t;", &result);
  if (run == 0) {
    state->code = result.code;
    state->connection = (uintptr_t)result.connection;
    free(result.output);
    free(result.error);
  } else {
    state->code = -1;
  }
  __atomic_add_fetch(&thread_barrier, 1, __ATOMIC_RELAXED);
  while (__atomic_load_n(&thread_barrier, __ATOMIC_RELAXED) < 2) sched_yield();
  return NULL;
}

static int test_two_threads(const char *database) {
  baton_sql_read_test_forget();
  __atomic_store_n(&thread_barrier, 0, __ATOMIC_RELAXED);
  ThreadRead first = {database, 0, 0};
  ThreadRead second = {database, 0, 0};
  pthread_t one, two;
  if (pthread_create(&one, NULL, thread_read, &first) != 0) return 1;
  if (pthread_create(&two, NULL, thread_read, &second) != 0) return 1;
  pthread_join(one, NULL);
  pthread_join(two, NULL);
  if (first.code != SQLITE_OK || second.code != SQLITE_OK) {
    fprintf(stderr, "fail two_threads: code=%d/%d\n", first.code, second.code);
    return 1;
  }
  if (!first.connection || !second.connection ||
      first.connection == second.connection) {
    fprintf(stderr, "fail two_threads: connections %p/%p\n",
            (void *)first.connection, (void *)second.connection);
    return 1;
  }
  if (baton_sql_read_test_live() != 0) {
    fprintf(stderr, "fail two_threads: live=%d after thread exit\n",
            baton_sql_read_test_live());
    return 1;
  }
  printf("ok two_threads\n");
  return 0;
}

static int test_path_change(const char *first, const char *second) {
  baton_sql_read_test_forget();
  BatonSqlReadTestResult one, two, again;
  memset(&one, 0, sizeof(one));
  memset(&two, 0, sizeof(two));
  memset(&again, 0, sizeof(again));
  if (baton_sql_read_test_run(first, "SELECT count(*) FROM t;", &one) != 0 ||
      baton_sql_read_test_run(second, "SELECT count(*) FROM t;", &two) != 0 ||
      baton_sql_read_test_run(first, "SELECT count(*) FROM t;", &again) != 0)
    return 1;
  int failed = check("path-first", one.code, one.output, "1\n") |
               check("path-second", two.code, two.output, "2\n") |
               check("path-again", again.code, again.output, "1\n");
  free(one.output); free(one.error);
  free(two.output); free(two.error);
  free(again.output); free(again.error);
  baton_sql_read_test_forget();
  return failed;
}

static int test_committed_write(const char *database) {
  baton_sql_read_test_forget();
  BatonSqlReadTestResult before, after;
  memset(&before, 0, sizeof(before));
  memset(&after, 0, sizeof(after));
  if (baton_sql_read_test_run(database, "SELECT count(*) FROM t;", &before) != 0)
    return 1;
  sqlite3 *writer = NULL;
  char *error = NULL;
  int failed = 0;
  if (sqlite3_open(database, &writer) != SQLITE_OK ||
      sqlite3_exec(writer, "INSERT INTO t(x) VALUES(99);", NULL, NULL, &error) != SQLITE_OK) {
    fprintf(stderr, "fail write: %s\n", error ? error : "writer failed");
    failed = 1;
  }
  sqlite3_free(error);
  if (writer) sqlite3_close(writer);
  if (!failed &&
      baton_sql_read_test_run(database, "SELECT count(*) FROM t;", &after) != 0)
    return 1;
  if (!failed) {
    failed = check("write-before", before.code, before.output, "1\n") |
             check("write-after", after.code, after.output, "2\n");
    if (!failed && before.connection != after.connection) {
      fprintf(stderr, "fail write-reuse: connection changed\n");
      failed = 1;
    }
  }
  free(before.output); free(before.error);
  free(after.output); free(after.error);
  baton_sql_read_test_forget();
  return failed;
}

static int test_autocommit(const char *database) {
  baton_sql_read_test_forget();
  BatonSqlReadTestResult transaction, after;
  memset(&transaction, 0, sizeof(transaction));
  memset(&after, 0, sizeof(after));
  if (baton_sql_read_test_run(database, "BEGIN; SELECT 1;", &transaction) != 0)
    return 1;
  int failed = check("autocommit-transaction", transaction.code,
                     transaction.output, "1\n");
  if (!failed && transaction.autocommit != 1) {
    fprintf(stderr, "fail autocommit: transaction remained\n");
    failed = 1;
  }
  sqlite3 *writer = NULL;
  char *error = NULL;
  if (sqlite3_open(database, &writer) != SQLITE_OK ||
      sqlite3_exec(writer, "INSERT INTO t(x) VALUES(98);", NULL, NULL, &error) != SQLITE_OK) {
    fprintf(stderr, "fail autocommit writer: %s\n", error ? error : "failed");
    failed = 1;
  }
  sqlite3_free(error);
  if (writer) sqlite3_close(writer);
  if (!failed &&
      baton_sql_read_test_run(database, "SELECT count(*) FROM t;", &after) != 0)
    return 1;
  if (!failed)
    failed = check("autocommit-after", after.code, after.output, "3\n");
  free(transaction.output); free(transaction.error);
  free(after.output); free(after.error);
  baton_sql_read_test_forget();
  return failed;
}

static int test_read_only(const char *database) {
  baton_sql_read_test_forget();
  BatonSqlReadTestResult write, after;
  memset(&write, 0, sizeof(write));
  memset(&after, 0, sizeof(after));
  if (baton_sql_read_test_run(database, "INSERT INTO t(x) VALUES(5);", &write) != 0)
    return 1;
  int failed = 0;
  if (write.code == SQLITE_OK) {
    fprintf(stderr, "fail read-only: write succeeded\n");
    failed = 1;
  } else {
    printf("ok read-only\n");
  }
  if (!failed &&
      baton_sql_read_test_run(database, "SELECT count(*) FROM t;", &after) != 0)
    return 1;
  if (!failed)
    failed = check("read-only-after", after.code, after.output, "3\n");
  free(write.output); free(write.error);
  free(after.output); free(after.error);
  baton_sql_read_test_forget();
  return failed;
}

static int test_replacement(const char *database, const char *replacement) {
  baton_sql_read_test_forget();
  BatonSqlReadTestResult before, after;
  memset(&before, 0, sizeof(before));
  memset(&after, 0, sizeof(after));
  if (baton_sql_read_test_run(database, "SELECT count(*) FROM t;", &before) != 0)
    return 1;
  int failed = 0;
  if (create_simple_db(replacement, 3, 0) != 0 || rename(replacement, database) != 0) {
    fprintf(stderr, "fail replacement: cannot replace %s\n", database);
    failed = 1;
  }
  if (!failed &&
      baton_sql_read_test_run(database, "SELECT count(*) FROM t;", &after) != 0)
    return 1;
  if (!failed)
    failed = check("replacement-before", before.code, before.output, "1\n") |
             check("replacement-after", after.code, after.output, "3\n");
  free(before.output); free(before.error);
  free(after.output); free(after.error);
  baton_sql_read_test_forget();
  return failed;
}

static int test_multi(const char *database) {
  baton_sql_read_test_forget();
  BatonSqlReadTestResult result;
  memset(&result, 0, sizeof(result));
  if (baton_sql_read_test_run(database, "SELECT 1; SELECT 2;", &result) != 0)
    return 1;
  int failed = check("multi-statement", result.code, result.output, "1\n2\n");
  free(result.output); free(result.error);
  baton_sql_read_test_forget();
  return failed;
}

typedef struct {
  const char *path;
  int ready;
} BusyWriter;

static void *busy_writer(void *argument) {
  BusyWriter *state = argument;
  sqlite3 *db = NULL;
  char *error = NULL;
  int code = sqlite3_open(state->path, &db);
  if (code == SQLITE_OK)
    code = sqlite3_exec(db, "BEGIN EXCLUSIVE;", NULL, NULL, &error);
  __atomic_store_n(&state->ready, code == SQLITE_OK ? 1 : -1, __ATOMIC_RELAXED);
  if (code == SQLITE_OK) {
    struct timespec pause = {0, 200000000};
    nanosleep(&pause, NULL);
    sqlite3_free(error);
    error = NULL;
    code = sqlite3_exec(db, "INSERT INTO t(x) VALUES(7); COMMIT;", NULL, NULL, &error);
  }
  if (code != SQLITE_OK)
    fprintf(stderr, "busy writer: %s\n", error ? error : "failed");
  sqlite3_free(error);
  if (db) sqlite3_close(db);
  return NULL;
}

static int test_busy(const char *database) {
  baton_sql_read_test_forget();
  BusyWriter writer = {database, 0};
  pthread_t thread;
  if (pthread_create(&thread, NULL, busy_writer, &writer) != 0) return 1;
  for (int i = 0; i < 1000; i++) {
    if (__atomic_load_n(&writer.ready, __ATOMIC_RELAXED) != 0) break;
    struct timespec pause = {0, 1000000};
    nanosleep(&pause, NULL);
  }
  if (__atomic_load_n(&writer.ready, __ATOMIC_RELAXED) != 1) {
    fprintf(stderr, "fail busy: writer did not hold the database\n");
    pthread_join(thread, NULL);
    return 1;
  }
  BatonSqlReadTestResult result;
  memset(&result, 0, sizeof(result));
  int run = baton_sql_read_test_run(database, "SELECT count(*) FROM t;", &result);
  pthread_join(thread, NULL);
  int failed = run != 0 ? 1 : check("busy-read", result.code, result.output, "1\n");
  free(result.output); free(result.error);
  baton_sql_read_test_forget();
  return failed;
}

static int test_fork(const char *database) {
  baton_sql_read_test_forget();
  BatonSqlReadTestResult before, after;
  memset(&before, 0, sizeof(before));
  memset(&after, 0, sizeof(after));
  if (baton_sql_read_test_run(database, "SELECT count(*) FROM t;", &before) != 0)
    return 1;
  pid_t child = fork();
  if (child < 0) {
    perror("fork");
    return 1;
  }
  if (child == 0) {
    BatonSqlReadTestResult result;
    int run = baton_sql_read_test_run(database, "SELECT count(*) FROM t;", &result);
    int ok = run == 0 && result.code == SQLITE_OK &&
             result.cache_pid == getpid();
    free(result.output);
    free(result.error);
    _exit(ok ? 0 : 1);
  }
  int status = 0;
  waitpid(child, &status, 0);
  int failed = 0;
  if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
    fprintf(stderr, "fail fork-child: status=%d\n", status);
    failed = 1;
  } else {
    printf("ok fork-child\n");
  }
  if (!failed &&
      baton_sql_read_test_run(database, "SELECT count(*) FROM t;", &after) != 0)
    return 1;
  if (!failed)
    failed = check("fork-parent", after.code, after.output, "3\n");
  free(before.output); free(before.error);
  free(after.output); free(after.error);
  baton_sql_read_test_forget();
  return failed;
}

static int test_encoding(const char *utf16, const char *utf8) {
  baton_sql_read_test_forget();
  BatonSqlReadTestResult bad, good;
  memset(&bad, 0, sizeof(bad));
  memset(&good, 0, sizeof(good));
  if (baton_sql_read_test_run(utf16, "SELECT count(*) FROM t;", &bad) != 0)
    return 1;
  int failed = 0;
  if (bad.code != SQLITE_MISMATCH || !bad.error ||
      !strstr(bad.error, "not UTF-8")) {
    fprintf(stderr, "fail encoding-refusal: code=%d error=%s\n", bad.code,
            bad.error ? bad.error : "(null)");
    failed = 1;
  } else {
    printf("ok encoding-refusal\n");
  }
  if (bad.live != 0) {
    fprintf(stderr, "fail encoding-refusal: live=%d\n", bad.live);
    failed = 1;
  }
  free(bad.output); free(bad.error);
  if (!failed &&
      baton_sql_read_test_run(utf8, "SELECT count(*) FROM t;", &good) != 0)
    return 1;
  if (!failed)
    failed = check("encoding-utf8", good.code, good.output, "1\n");
  free(good.output); free(good.error);
  baton_sql_read_test_forget();
  return failed;
}

static int mode_lifecycle(const char *work) {
  char first[4096], second[4096], replacement[4096], replacement_next[4096];
  char busy[4096], utf16[4096], plain[4096];
  if (make_path(first, sizeof(first), work, "a.db") ||
      make_path(second, sizeof(second), work, "b.db") ||
      make_path(replacement, sizeof(replacement), work, "replace.db") ||
      make_path(replacement_next, sizeof(replacement_next), work, "replace-next.db") ||
      make_path(busy, sizeof(busy), work, "busy.db") ||
      make_path(utf16, sizeof(utf16), work, "utf16.db") ||
      make_path(plain, sizeof(plain), work, "plain.db")) return 1;
  if (create_simple_db(first, 1, 0) || create_simple_db(second, 2, 0) ||
      create_simple_db(replacement, 1, 0) || create_simple_db(busy, 0, 0) ||
      create_simple_db(utf16, 1, 1) || create_simple_db(plain, 1, 0)) return 1;
  int failed = 0;
  failed |= test_two_threads(first);
  failed |= test_path_change(first, second);
  failed |= test_committed_write(first);
  failed |= test_autocommit(first);
  failed |= test_read_only(first);
  failed |= test_replacement(replacement, replacement_next);
  failed |= test_multi(first);
  failed |= test_busy(busy);
  failed |= test_fork(first);
  failed |= test_encoding(utf16, plain);
  baton_sql_read_test_forget();
  if (failed) {
    fprintf(stderr, "fail lifecycle\n");
    return 1;
  }
  printf("ok lifecycle\n");
  return 0;
}

static int mode_bytes(const char *work) {
  char database[4096], spool[4096];
  if (make_path(database, sizeof(database), work, "replay.db") ||
      make_path(spool, sizeof(spool), work, "stdout.spool")) return 1;
  if (create_replay_db(database) || write_spool(spool)) return 1;
  const char *sql = "SELECT body FROM messages WHERE id='m000000';";
  const int reads = 20;
  BatonSqlReadTestResult result;
  baton_sql_read_test_forget();
  long long before = rchar_bytes();
  if (before < 0) {
    printf("bytes unavailable\n");
    return 2;
  }
  for (int i = 0; i < reads; i++) {
    baton_sql_read_test_forget();
    if (baton_sql_read_test_run(database, sql, &result) != 0 ||
        result.code != SQLITE_OK) {
      fprintf(stderr, "fail bytes fresh: code=%d\n", result.code);
      return 1;
    }
    free(result.output);
    free(result.error);
  }
  long long fresh = rchar_bytes() - before;
  baton_sql_read_test_forget();
  before = rchar_bytes();
  for (int i = 0; i < reads; i++) {
    if (baton_sql_read_test_run(database, sql, &result) != 0 ||
        result.code != SQLITE_OK) {
      fprintf(stderr, "fail bytes reused: code=%d\n", result.code);
      return 1;
    }
    free(result.output);
    free(result.error);
  }
  long long reused = rchar_bytes() - before;
  baton_sql_read_test_forget();
  long long spool_bytes = 158;
  printf("bytes fresh=%lld reused=%lld reads=%d spool=%lld fresh_ratio=%.3f reused_ratio=%.3f\n",
         fresh, reused, reads, spool_bytes, (double)fresh / (double)spool_bytes,
         (double)reused / (double)spool_bytes);
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: lifecycle|bytes WORKDIR\n");
    return 2;
  }
  if (strcmp(argv[1], "lifecycle") == 0) return mode_lifecycle(argv[2]);
  if (strcmp(argv[1], "bytes") == 0) return mode_bytes(argv[2]);
  fprintf(stderr, "unknown mode: %s\n", argv[1]);
  return 2;
}
