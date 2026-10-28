/* Fixture driver for the SQLite read-cache checks. The test runner prepends
   the BatonSql structure, its row callback, the busy handler and the marked
   read-cache section from bend2/src/host/sqlite.c. */
#include <time.h>
#include <sys/wait.h>
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

static int test_fork_rejects_inherited(const char *database) {
  baton_sql_read_test_forget();
  BatonSqlReadTestResult before;
  memset(&before, 0, sizeof(before));
  if (baton_sql_read_test_run(database, "SELECT count(*) FROM t;", &before) != 0 ||
      before.code != SQLITE_OK || !before.connection) {
    fprintf(stderr, "fail fork-parent-before: cache was not established\n");
    free(before.output); free(before.error);
    return 1;
  }
  uintptr_t parent_connection = (uintptr_t)before.connection;
  free(before.output); free(before.error);
  pid_t child = fork();
  if (child < 0) {
    perror("fork");
    baton_sql_read_test_forget();
    return 1;
  }
  if (child == 0) {
    BatonSqlReadTestResult result;
    int run = baton_sql_read_test_run(database, "SELECT count(*) FROM t;", &result);
    int rejected = run == 0 && result.code == SQLITE_MISUSE && result.error &&
      strstr(result.error, "cannot cross a fork boundary") && !result.connection;
    free(result.output);
    free(result.error);
    /* The child must not call SQLite close on the parent's inherited handle. */
    _exit(rejected ? 0 : 1);
  }
  int status = 0;
  pid_t waited;
  do { waited = waitpid(child, &status, 0); } while (waited < 0 && errno == EINTR);
  int failed = waited != child || !WIFEXITED(status) || WEXITSTATUS(status) != 0;
  if (failed) {
    fprintf(stderr, "fail fork-rejected: child status=%d\n", status);
  } else {
    printf("ok fork-rejected\n");
  }
  BatonSqlReadTestResult after;
  memset(&after, 0, sizeof(after));
  int run = baton_sql_read_test_run(database, "SELECT count(*) FROM t;", &after);
  if (run != 0 || after.code != SQLITE_OK || !after.connection ||
      (uintptr_t)after.connection != parent_connection ||
      !after.output || strcmp(after.output, "1\n") != 0) {
    fprintf(stderr, "fail fork-parent-after: code=%d output=%s\n", after.code,
            after.output ? after.output : "(null)");
    failed = 1;
  } else {
    printf("ok fork-parent-after\n");
  }
  free(after.output); free(after.error);
  baton_sql_read_test_forget();
  return failed;
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
  failed |= test_fork_rejects_inherited(first);
  failed |= test_path_change(first, second);
  failed |= test_committed_write(first);
  failed |= test_autocommit(first);
  failed |= test_read_only(first);
  failed |= test_replacement(replacement, replacement_next);
  failed |= test_multi(first);
  failed |= test_busy(busy);
  failed |= test_encoding(utf16, plain);
  baton_sql_read_test_forget();
  if (failed) {
    fprintf(stderr, "fail lifecycle\n");
    return 1;
  }
  printf("ok lifecycle\n");
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: lifecycle WORKDIR\n");
    return 2;
  }
  if (strcmp(argv[1], "lifecycle") == 0) return mode_lifecycle(argv[2]);
  fprintf(stderr, "unknown mode: %s\n", argv[1]);
  return 2;
}
