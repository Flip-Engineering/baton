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

#define BATON_SQL_UNAVAILABLE "context database binding unavailable: "
#define BATON_SQL_MISMATCH "context database binding mismatch: "

typedef struct {
  char *path, *expected, *sql, *output, *observed, *error;
  size_t length;
  int code, kind;
} BatonSqlBound;

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
  while (*s && *s != ',' && *s != '}') s++;
  return s;
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
static unsigned long long baton_sql_birth(const struct stat *info) {
#ifdef __APPLE__
  if (info->st_birthtimespec.tv_sec <= 0) return 0;
  return (unsigned long long)info->st_birthtimespec.tv_sec * 1000000000ull
    + (unsigned long long)info->st_birthtimespec.tv_nsec;
#else
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
  unsigned long long birth = baton_sql_birth(&info);
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
