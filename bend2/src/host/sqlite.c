#include <sqlite3.h>
#include <errno.h>

/* Bend supplies SQL and transaction boundaries. This effect executes SQLite calls
   on an IO worker and returns the rows of the last SELECT as newline-separated text. */
typedef struct {
  char *path, *sql, *output, *error;
  size_t length;
  int code;
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
