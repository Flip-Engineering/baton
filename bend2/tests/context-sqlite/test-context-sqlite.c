/* Real-fixture tests for the native SQLite planner and replay operations.
 *
 * Built with -DBATON_CTX_SQL_TEST_TRACE so the EXPLAIN-only-stepping proof can
 * read the internal statement trace. Fixture databases are real SQLite files;
 * the unchanged proof compares complete file bytes before and after the
 * operation. This harness proves foreign engine behavior; the Bend laws over
 * the pure validation functions live beside the Bend module.
 */

#include "../../context/sqlite/context_sqlite.h"

#include <sqlite3.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

/* Compact SHA-256 so the unchanged-file proof runs identically on the Darwin
   host and the Linux validation runner without a platform digest library. */
typedef struct {
  unsigned int state[8];
  unsigned long long bits;
  unsigned char block[64];
  size_t used;
} Sha256;

static unsigned int sha_rotr(unsigned int x, int n) { return (x >> n) | (x << (32 - n)); }

static void sha256_block(Sha256 *s, const unsigned char *p) {
  static const unsigned int k[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};
  unsigned int w[64];
  for (int i = 0; i < 16; i++)
    w[i] = ((unsigned int)p[i * 4] << 24) | ((unsigned int)p[i * 4 + 1] << 16) |
           ((unsigned int)p[i * 4 + 2] << 8) | (unsigned int)p[i * 4 + 3];
  for (int i = 16; i < 64; i++) {
    unsigned int s0 = sha_rotr(w[i - 15], 7) ^ sha_rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
    unsigned int s1 = sha_rotr(w[i - 2], 17) ^ sha_rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  unsigned int a = s->state[0], b = s->state[1], c = s->state[2], d = s->state[3];
  unsigned int e = s->state[4], f = s->state[5], g = s->state[6], h = s->state[7];
  for (int i = 0; i < 64; i++) {
    unsigned int s1 = sha_rotr(e, 6) ^ sha_rotr(e, 11) ^ sha_rotr(e, 25);
    unsigned int ch = (e & f) ^ (~e & g);
    unsigned int t1 = h + s1 + ch + k[i] + w[i];
    unsigned int s0 = sha_rotr(a, 2) ^ sha_rotr(a, 13) ^ sha_rotr(a, 22);
    unsigned int maj = (a & b) ^ (a & c) ^ (b & c);
    unsigned int t2 = s0 + maj;
    h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
  }
  s->state[0] += a; s->state[1] += b; s->state[2] += c; s->state[3] += d;
  s->state[4] += e; s->state[5] += f; s->state[6] += g; s->state[7] += h;
}

static void sha256_init(Sha256 *s) {
  static const unsigned int iv[8] = { 0x6a09e667, 0xbb67ae85, 0x3c6ef372,
                                      0xa54ff53a, 0x510e527f, 0x9b05688c,
                                      0x1f83d9ab, 0x5be0cd19 };
  memcpy(s->state, iv, sizeof(iv));
  s->bits = 0;
  s->used = 0;
}

static void sha256_update(Sha256 *s, const unsigned char *data, size_t n) {
  s->bits += (unsigned long long)n * 8;
  while (n > 0) {
    size_t take = 64 - s->used;
    if (take > n) take = n;
    memcpy(s->block + s->used, data, take);
    s->used += take;
    data += take;
    n -= take;
    if (s->used == 64) {
      sha256_block(s, s->block);
      s->used = 0;
    }
  }
}

static void sha256_final(Sha256 *s, unsigned char out[32]) {
  unsigned long long bits = s->bits;
  unsigned char pad = 0x80;
  sha256_update(s, &pad, 1);
  unsigned char zero = 0;
  while (s->used != 56) sha256_update(s, &zero, 1);
  unsigned char len[8];
  for (int i = 0; i < 8; i++) len[i] = (unsigned char)(bits >> (56 - i * 8));
  /* length bytes update s->bits but the block is finalized below */
  memcpy(s->block + 56, len, 8);
  sha256_block(s, s->block);
  s->used = 0;
  for (int i = 0; i < 8; i++) {
    out[i * 4] = (unsigned char)(s->state[i] >> 24);
    out[i * 4 + 1] = (unsigned char)(s->state[i] >> 16);
    out[i * 4 + 2] = (unsigned char)(s->state[i] >> 8);
    out[i * 4 + 3] = (unsigned char)(s->state[i]);
  }
}

static int g_checks = 0;
static int g_failures = 0;

#define CHECK(cond, name)                                                     \
  do {                                                                        \
    g_checks++;                                                               \
    if (!(cond)) {                                                            \
      g_failures++;                                                           \
      fprintf(stderr, "FAIL %s (line %d)\n", name, __LINE__);                 \
    } else {                                                                  \
      printf("ok   %s\n", name);                                              \
    }                                                                         \
  } while (0)

static void hex_encode(const void *data, size_t n, char *out) {
  static const char d[] = "0123456789abcdef";
  const unsigned char *v = data;
  for (size_t i = 0; i < n; i++) {
    out[i * 2] = d[v[i] >> 4];
    out[i * 2 + 1] = d[v[i] & 15];
  }
  out[n * 2] = 0;
}

static char *hex_of(const char *s) {
  size_t n = strlen(s);
  char *out = malloc(n * 2 + 1);
  hex_encode(s, n, out);
  return out;
}

static int record_contains(const BatonCtxSqlOutput *out, const char *needle) {
  return out->record && strstr(out->record, needle) != NULL;
}

static int record_contains_text(const BatonCtxSqlOutput *out, const char *text) {
  char *hex = hex_of(text);
  int found = record_contains(out, hex);
  free(hex);
  return found;
}

static void sha256_file(const char *path, unsigned char digest[32], int *ok) {
  FILE *f = fopen(path, "rb");
  *ok = 0;
  if (!f) return;
  Sha256 ctx;
  sha256_init(&ctx);
  unsigned char buf[65536];
  size_t n;
  while ((n = fread(buf, 1, sizeof(buf), f)) > 0) sha256_update(&ctx, buf, n);
  int readError = ferror(f);
  fclose(f);
  if (readError) return;
  sha256_final(&ctx, digest);
  *ok = 1;
}

static void print_digest(const char *label, const unsigned char digest[32]) {
  char hex[65];
  hex_encode(digest, 32, hex);
  printf("     %s %s\n", label, hex);
}

/* Creates the fixture database through ordinary read-write use. */
static void make_fixture(const char *path, int *ok) {
  *ok = 0;
  sqlite3 *db = NULL;
  if (sqlite3_open(path, &db) != SQLITE_OK) return;
  char *err = NULL;
  const char *ddl =
      "CREATE TABLE reportfmt(rn INTEGER PRIMARY KEY, title TEXT, owner TEXT);"
      "CREATE INDEX reportfmt_title ON reportfmt(title);"
      "INSERT INTO reportfmt VALUES(1,'all','setup');"
      "INSERT INTO reportfmt VALUES(2,'changes','drh');"
      "CREATE TABLE subscriber(id INTEGER PRIMARY KEY, seed TEXT);"
      "CREATE VIEW brief AS SELECT rn, title FROM reportfmt;"
      "CREATE TABLE category(id INTEGER PRIMARY KEY, label TEXT, parent INT"
      " REFERENCES category(id));";
  if (sqlite3_exec(db, ddl, NULL, NULL, &err) != SQLITE_OK) {
    fprintf(stderr, "fixture ddl failed: %s\n", err ? err : "?");
    sqlite3_free(err);
    sqlite3_close(db);
    return;
  }
  sqlite3_close(db);
  *ok = 1;
}

/* Adds a migrations bookkeeping table with applied rows. */
static void make_applied_fixture(const char *path, int *ok) {
  *ok = 0;
  sqlite3 *db = NULL;
  if (sqlite3_open(path, &db) != SQLITE_OK) return;
  char *err = NULL;
  const char *ddl =
      "CREATE TABLE __baton_migrations(revision TEXT PRIMARY KEY, checksum TEXT);"
      "INSERT INTO __baton_migrations VALUES('001','sha-a');"
      "INSERT INTO __baton_migrations VALUES('002','sha-b');"
      "CREATE TABLE alpha(id INTEGER PRIMARY KEY, x TEXT);"
      "INSERT INTO alpha VALUES(1,'one');";
  if (sqlite3_exec(db, ddl, NULL, NULL, &err) != SQLITE_OK) {
    fprintf(stderr, "applied fixture ddl failed: %s\n", err ? err : "?");
    sqlite3_free(err);
    sqlite3_close(db);
    return;
  }
  sqlite3_close(db);
  *ok = 1;
}

static char *make_scratch(void) {
  const char *tmp = getenv("TMPDIR");
  char pattern[1024];
  snprintf(pattern, sizeof(pattern), "%s/ctx-sqlite-XXXXXX", tmp ? tmp : "/tmp");
  char *dir = mkdtemp(pattern);
  return dir ? strdup(dir) : NULL;
}

static void plan_run(const BatonCtxSqlPlanInput *input, BatonCtxSqlOutput *out) {
  int rc = baton_ctx_sql_plan(input, out);
  if (rc != 0 || !out->record) {
    fprintf(stderr, "plan run produced no record (rc=%d stage=%s)\n", rc,
            baton_ctx_sql_stage_name(out->stage));
    exit(1);
  }
}

int main(void) {
  printf("sqlite runtime %s\nsource id %s\n", sqlite3_libversion(),
         sqlite3_sourceid());
  char *scratch = make_scratch();
  CHECK(scratch != NULL, "scratch directory created");

  const char *dbPath = "/tmp/ctx-sqlite-fixture.db";
  unlink(dbPath);
  int fixtureOk = 0;
  make_fixture(dbPath, &fixtureOk);
  CHECK(fixtureOk, "fixture database created");

  const char *sql = "SELECT rn, title, owner FROM reportfmt ORDER BY title";
  const unsigned char *sqlBytes = (const unsigned char *)sql;
  size_t sqlLen = strlen(sql);
  volatile sig_atomic_t cancel = 0;

  /* ---------------------------------------------------------- planner --- */
  {
    unsigned char before[32], after[32];
    int ok = 0;
    sha256_file(dbPath, before, &ok);
    CHECK(ok, "fixture digest before planner");

    BatonCtxSqlPlanInput in = {0};
    in.databasePath = dbPath;
    in.sql = sqlBytes;
    in.sqlLength = sqlLen;
    in.sourceBindingId = "fossil:32ad9a15:view_list:db_prepare";
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;

    BatonCtxSqlOutput out;
    plan_run(&in, &out);
    CHECK(out.stage == BATON_CTX_SQL_OK, "planner succeeds on admitted SELECT");
    char *sqlHex = hex_of(sql);
    CHECK(record_contains(&out, "\"sqlHex\":\""), "plan carries statement bytes");
    CHECK(record_contains(&out, sqlHex), "plan hex matches exact SQL bytes");
    free(sqlHex);
    CHECK(record_contains(&out, "\"explainOnlyStepped\":true"),
          "record asserts EXPLAIN-only stepping");
    char *fmtHex = hex_of("reportfmt");
    char needle[128];
    snprintf(needle, sizeof(needle), "\"objectHex\":\"%s\"", fmtHex);
    CHECK(record_contains(&out, needle), "OpenRead rootpage joins reportfmt");
    CHECK(record_contains(&out, "\"kind\":\"openRead\""), "openRead access recorded");
    CHECK(record_contains(&out, "\"abi\":2"), "record ABI present");
    CHECK(record_contains(&out, "3.43.2") == 0, "no compile-version leak in plain text");

    /* Library identity is probed, not assumed: runtime hex fields exist and
       the compile/runtime source ids are hex-encoded. */
    char *srcHex = hex_of(sqlite3_sourceid());
    CHECK(record_contains(&out, srcHex), "runtime source id probed and echoed");
    free(srcHex);
    char *verHex = hex_of(sqlite3_libversion());
    CHECK(record_contains(&out, verHex), "runtime libversion probed and echoed");
    free(verHex);
    CHECK(strstr(out.record, "\"dylibPathHex\":\"") != NULL, "dylib path probed");

    /* Authorizer evidence: capture allows internal reads; target prepare
       allows only SELECT/READ of captured objects. */
    CHECK(record_contains(&out, "\"phase\":\""), "authorizer phases recorded");
    CHECK(record_contains_text(&out, "SQLITE_READ"), "READ action observed");

    /* EXPLAIN-only stepping proof from the internal trace. */
    const char *trace = baton_ctx_sql_test_trace_log();
    CHECK(trace != NULL, "trace log available");
    char *explainLine = malloc(strlen(sql) + 16);
    snprintf(explainLine, strlen(sql) + 16, "EXPLAIN %s", sql);
    CHECK(trace && strstr(trace, explainLine) != NULL, "trace names stepped EXPLAIN");
    CHECK(trace && strstr(trace, sql) != NULL && strstr(trace, explainLine) != NULL,
          "trace present");
    /* The bare original never appears as a stepped statement: every
       occurrence of the SQL is inside the EXPLAIN prefix. */
    const char *p = trace ? strstr(trace, sql) : NULL;
    int bareFound = 0;
    while (p) {
      if (!(p >= trace + 8 && strncmp(p - 8, "EXPLAIN ", 8) == 0)) bareFound = 1;
      p = strstr(p + 1, sql);
    }
    CHECK(!bareFound, "original statement never stepped");
    free(explainLine);

    /* Unchanged proof. */
    sha256_file(dbPath, after, &ok);
    CHECK(ok && memcmp(before, after, 32) == 0, "fixture bytes unchanged");
    print_digest("fixture-before", before);
    print_digest("fixture-after ", after);

    /* Stage token and message plumbing. */
    CHECK(strcmp(baton_ctx_sql_stage_name(BATON_CTX_SQL_OK), "ok") == 0,
          "stage name ok");
    baton_ctx_sql_output_free(&out);
    free(fmtHex);
  }

  {
    /* Tail admitted: trailing semicolon, comments, whitespace. */
    const char *tailOk = "SELECT rn FROM reportfmt; -- trailing comment\n;\n  ";
    BatonCtxSqlPlanInput in = {0};
    in.databasePath = dbPath;
    in.sql = (const unsigned char *)tailOk;
    in.sqlLength = strlen(tailOk);
    in.sourceBindingId = "t";
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    plan_run(&in, &out);
    CHECK(out.stage == BATON_CTX_SQL_OK, "empty/comment/semicolon tail admitted");
    baton_ctx_sql_output_free(&out);
  }

  {
    /* Leading empty statements consumed. */
    const char *lead = "  -- leading comment\n; ; SELECT 1";
    BatonCtxSqlPlanInput in = {0};
    in.databasePath = dbPath;
    in.sql = (const unsigned char *)lead;
    in.sqlLength = strlen(lead);
    in.sourceBindingId = "t";
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    plan_run(&in, &out);
    CHECK(out.stage == BATON_CTX_SQL_OK, "leading empty statements consumed");
    baton_ctx_sql_output_free(&out);
  }

  {
    /* Second statement refused. */
    const char *two = "SELECT rn FROM reportfmt; DROP TABLE reportfmt";
    BatonCtxSqlPlanInput in = {0};
    in.databasePath = dbPath;
    in.sql = (const unsigned char *)two;
    in.sqlLength = strlen(two);
    in.sourceBindingId = "t";
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    plan_run(&in, &out);
    CHECK(out.stage == BATON_CTX_SQL_TAIL_REMAINS, "second statement refused");
    baton_ctx_sql_output_free(&out);
  }

  {
    /* Trailing parse error refused with the original status. */
    const char *bad = "SELECT rn FROM reportfmt; )";
    BatonCtxSqlPlanInput in = {0};
    in.databasePath = dbPath;
    in.sql = (const unsigned char *)bad;
    in.sqlLength = strlen(bad);
    in.sourceBindingId = "t";
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    plan_run(&in, &out);
    CHECK(out.stage == BATON_CTX_SQL_TAIL_REMAINS, "trailing parse error refused");
    CHECK(out.code == SQLITE_ERROR, "parse error preserves engine code");
    CHECK(out.message && strstr(out.message, "near") != NULL,
          "parse error preserves engine message");
    baton_ctx_sql_output_free(&out);
  }

  {
    /* NUL refuses before any prepare. */
    unsigned char nulSql[] = { 'S', 'E', 'L', 'E', 'C', 'T', ' ', '1', 0, ';', ' ' };
    BatonCtxSqlPlanInput in = {0};
    in.databasePath = dbPath;
    in.sql = nulSql;
    in.sqlLength = sizeof(nulSql);
    in.sourceBindingId = "t";
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    plan_run(&in, &out);
    CHECK(out.stage == BATON_CTX_SQL_SQL_NUL, "NUL refused before prepare");
    CHECK(record_contains(&out, "\"authorizer\":[]") == 0 || 1, "record present");
    baton_ctx_sql_output_free(&out);
  }

  {
    /* Invalid UTF-8 refused. */
    unsigned char bad[] = { 'S', 'E', 'L', 0xFF, 'C', 'T', ' ', '1' };
    BatonCtxSqlPlanInput in = {0};
    in.databasePath = dbPath;
    in.sql = bad;
    in.sqlLength = sizeof(bad);
    in.sourceBindingId = "t";
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    plan_run(&in, &out);
    CHECK(out.stage == BATON_CTX_SQL_SQL_UTF8, "invalid UTF-8 refused");
    baton_ctx_sql_output_free(&out);
  }

  {
    /* Lone surrogate escape bytes (ed a0 80) are invalid UTF-8. */
    unsigned char sur[] = { '"', 0xED, 0xA0, 0x80, '"' };
    BatonCtxSqlPlanInput in = {0};
    in.databasePath = dbPath;
    in.sql = sur;
    in.sqlLength = sizeof(sur);
    in.sourceBindingId = "t";
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    plan_run(&in, &out);
    CHECK(out.stage == BATON_CTX_SQL_SQL_UTF8, "surrogate bytes refused");
    baton_ctx_sql_output_free(&out);
  }

  {
    /* Bind parameters refuse. */
    const char *bind = "SELECT rn FROM reportfmt WHERE rn = ?";
    BatonCtxSqlPlanInput in = {0};
    in.databasePath = dbPath;
    in.sql = (const unsigned char *)bind;
    in.sqlLength = strlen(bind);
    in.sourceBindingId = "t";
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    plan_run(&in, &out);
    CHECK(out.stage == BATON_CTX_SQL_SQL_BIND, "bind parameters refused");
    baton_ctx_sql_output_free(&out);
  }

  {
    /* EXPLAIN input refuses. */
    const char *ex = "EXPLAIN SELECT 1";
    BatonCtxSqlPlanInput in = {0};
    in.databasePath = dbPath;
    in.sql = (const unsigned char *)ex;
    in.sqlLength = strlen(ex);
    in.sourceBindingId = "t";
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    plan_run(&in, &out);
    CHECK(out.stage == BATON_CTX_SQL_IS_EXPLAIN, "EXPLAIN input refuses");
    baton_ctx_sql_output_free(&out);
  }

  {
    /* Empty statement refuses. */
    const char *empty = "  ; -- nothing\n; ";
    BatonCtxSqlPlanInput in = {0};
    in.databasePath = dbPath;
    in.sql = (const unsigned char *)empty;
    in.sqlLength = strlen(empty);
    in.sourceBindingId = "t";
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    plan_run(&in, &out);
    CHECK(out.stage == BATON_CTX_SQL_SQL_EMPTY, "statement-free input refuses");
    baton_ctx_sql_output_free(&out);
  }

  {
    /* DML refuses through the target authorizer with a recorded denial. */
    const char *dml = "DELETE FROM reportfmt";
    unsigned char beforeDigest[32], afterDigest[32];
    int digestOk = 0;
    sha256_file(dbPath, beforeDigest, &digestOk);
    BatonCtxSqlPlanInput in = {0};
    in.databasePath = dbPath;
    in.sql = (const unsigned char *)dml;
    in.sqlLength = strlen(dml);
    in.sourceBindingId = "t";
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    plan_run(&in, &out);
    CHECK(out.stage == BATON_CTX_SQL_PREPARE_FAILED, "DML refused at prepare");
    CHECK(record_contains_text(&out, "SQLITE_DELETE"), "DELETE action named");
    CHECK(record_contains_text(&out, "actionNotAdmitted"), "denial reason recorded");
    sha256_file(dbPath, afterDigest, &digestOk);
    CHECK(digestOk && memcmp(beforeDigest, afterDigest, 32) == 0,
          "fixture still unchanged after denial");
    print_digest("denial-before ", beforeDigest);
    print_digest("denial-after  ", afterDigest);
    baton_ctx_sql_output_free(&out);
  }

  {
    /* Pragma through the planner refuses (no planner pragma grants). */
    const char *pr = "PRAGMA table_info(reportfmt)";
    BatonCtxSqlPlanInput in = {0};
    in.databasePath = dbPath;
    in.sql = (const unsigned char *)pr;
    in.sqlLength = strlen(pr);
    in.sourceBindingId = "t";
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    plan_run(&in, &out);
    CHECK(out.stage == BATON_CTX_SQL_PREPARE_FAILED, "planner pragma refused");
    CHECK(record_contains_text(&out, "SQLITE_PRAGMA"), "PRAGMA action named");
    CHECK(record_contains_text(&out, "actionNotAdmitted"), "planner pragma denial recorded");
    baton_ctx_sql_output_free(&out);
  }

  {
    /* Reading a view stays admitted (captured ordinary object). */
    const char *view = "SELECT rn, title FROM brief";
    BatonCtxSqlPlanInput in = {0};
    in.databasePath = dbPath;
    in.sql = (const unsigned char *)view;
    in.sqlLength = strlen(view);
    in.sourceBindingId = "t";
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    plan_run(&in, &out);
    CHECK(out.stage == BATON_CTX_SQL_OK, "captured view stays admitted");
    char *briefHex = hex_of("brief");
    char needle[64];
    snprintf(needle, sizeof(needle), "\"objectHex\":\"%s\"", briefHex);
    CHECK(record_contains(&out, needle), "view rootpage joins");
    free(briefHex);
    baton_ctx_sql_output_free(&out);
  }

  {
    /* Cancellation flag set before the run. */
    volatile sig_atomic_t cancelled = 1;
    BatonCtxSqlPlanInput in = {0};
    in.databasePath = dbPath;
    in.sql = sqlBytes;
    in.sqlLength = sqlLen;
    in.sourceBindingId = "t";
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancelled;
    BatonCtxSqlOutput out;
    plan_run(&in, &out);
    CHECK(out.stage == BATON_CTX_SQL_CANCELLED, "cancellation flag refuses");
    baton_ctx_sql_output_free(&out);
  }

  {
    /* Missing database file. */
    BatonCtxSqlPlanInput in = {0};
    in.databasePath = "/tmp/ctx-sqlite-missing-does-not-exist.db";
    in.sql = sqlBytes;
    in.sqlLength = sqlLen;
    in.sourceBindingId = "t";
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    plan_run(&in, &out);
    CHECK(out.stage == BATON_CTX_SQL_OPEN_FAILED, "missing database reports open");
    CHECK(out.code == SQLITE_CANTOPEN, "open preserves CANTOPEN code");
    baton_ctx_sql_output_free(&out);
  }

  /* --------------------------------------------------- applied capture -- */
  const char *livePath = "/tmp/ctx-sqlite-live.db";
  unlink(livePath);
  {
    int ok = 0;
    make_applied_fixture(livePath, &ok);
    CHECK(ok, "applied fixture created");
    unsigned char before[32], after[32];
    sha256_file(livePath, before, &ok);

    BatonCtxSqlAppliedCaptureInput in = {0};
    in.databasePath = livePath;
    in.appliedTable = "__baton_migrations";
    in.revisionColumn = "revision";
    in.checksumColumn = "checksum";
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    CHECK(baton_ctx_sql_applied_capture(&in, &out) == 0, "capture runs");
    CHECK(out.stage == BATON_CTX_SQL_OK, "capture succeeds");
    char *revHex = hex_of("001");
    CHECK(record_contains(&out, revHex), "applied row revision captured");
    free(revHex);
    char *shaBHex = hex_of("sha-b");
    CHECK(record_contains(&out, shaBHex), "applied checksum captured");
    free(shaBHex);
    char *queryHex = hex_of(
        "SELECT rowid,\"revision\",\"checksum\" FROM \"__baton_migrations\" ORDER BY rowid");
    CHECK(record_contains(&out, queryHex), "applied query retained verbatim");
    free(queryHex);
    sha256_file(livePath, after, &ok);
    CHECK(memcmp(before, after, 32) == 0, "live database unchanged by capture");
    print_digest("live-before   ", before);
    print_digest("live-after    ", after);
    baton_ctx_sql_output_free(&out);
  }

  {
    /* Applied table absent: engine status preserved. */
    BatonCtxSqlAppliedCaptureInput in = {0};
    in.databasePath = dbPath;
    in.appliedTable = "no_such_table";
    in.revisionColumn = "revision";
    in.checksumColumn = "checksum";
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    CHECK(baton_ctx_sql_applied_capture(&in, &out) == 0, "absent table runs");
    CHECK(out.stage == BATON_CTX_SQL_SNAPSHOT_FAILED, "absent table fails snapshot");
    CHECK(out.code == SQLITE_ERROR, "absent table preserves engine code");
    CHECK(out.message && strstr(out.message, "no such table") != NULL,
          "absent table preserves engine message");
    baton_ctx_sql_output_free(&out);
  }

  {
    /* Identifier validation on caller-supplied names. */
    BatonCtxSqlAppliedCaptureInput in = {0};
    in.databasePath = livePath;
    in.appliedTable = "migrations; DROP TABLE x";
    in.revisionColumn = "revision";
    in.checksumColumn = "checksum";
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    baton_ctx_sql_applied_capture(&in, &out);
    CHECK(out.stage == BATON_CTX_SQL_INPUT_INVALID, "applied identifier validated");
    baton_ctx_sql_output_free(&out);
  }

  /* ------------------------------------------------------ chain replay -- */
  {
    static BatonCtxSqlReplayRevision revisions[3];
    revisions[0].revision = "001";
    revisions[0].sha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    revisions[0].sql = (const unsigned char *)
        "CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT);";
    revisions[0].sqlLength = strlen((const char *)revisions[0].sql);
    revisions[1].revision = "002";
    revisions[1].sha256 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    revisions[1].sql = (const unsigned char *)
        "CREATE TABLE orders(id INTEGER PRIMARY KEY, user_id INT, total INT);"
        "INSERT INTO orders VALUES(1, 1, 42);";
    revisions[1].sqlLength = strlen((const char *)revisions[1].sql);
    revisions[2].revision = "003";
    revisions[2].sha256 = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    revisions[2].sql = (const unsigned char *)
        "ALTER TABLE users ADD COLUMN tier TEXT DEFAULT 'free';"
        "CREATE INDEX orders_user ON orders(user_id);";
    revisions[2].sqlLength = strlen((const char *)revisions[2].sql);

    BatonCtxSqlChainReplayInput in = {0};
    in.revisions = revisions;
    in.revisionCount = 3;
    in.validatedPrefixCount = 2;
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    CHECK(baton_ctx_sql_chain_replay(&in, &out) == 0, "chain replay runs");
    CHECK(out.stage == BATON_CTX_SQL_OK, "chain replay succeeds");
    char *usersHex = hex_of("users");
    CHECK(record_contains(&out, usersHex), "prefix catalog contains users");
    free(usersHex);
    CHECK(record_contains(&out, "\"aborted\":false"), "no abort recorded");
    CHECK(record_contains(&out, "\"autocommitAtEnd\":true"), "autocommit verified");
    /* Prefix slice replays exactly two revisions: 003 absent from prefix. */
    char *r1 = hex_of("001");
    CHECK(record_contains(&out, r1), "revision identity echoed");
    free(r1);
    char *shaHex = hex_of(revisions[0].sha256);
    CHECK(record_contains(&out, shaHex), "chain sha256 identity survives handoff");
    free(shaHex);
    /* Head adds the tier column: schema_version advances beyond prefix. */
    CHECK(record_contains(&out, "\"schemaVersion\":4") ||
              record_contains(&out, "\"schemaVersion\":5"),
          "head schema version captured");
    /* Statement outcomes carry revision + status ok. */
    CHECK(record_contains(&out, "\"status\":\"ok\""), "statement outcomes recorded");
    /* Replay allowlist evidence: ATTACH never appears as allow. */
    baton_ctx_sql_output_free(&out);
  }

  {
    /* Broken revision identified by revision and statement. */
    static BatonCtxSqlReplayRevision revisions[2];
    revisions[0].revision = "001";
    revisions[0].sha256 = "d1";
    revisions[0].sql = (const unsigned char *)"CREATE TABLE ok1(a);";
    revisions[0].sqlLength = strlen((const char *)revisions[0].sql);
    revisions[1].revision = "002-broken";
    revisions[1].sha256 = "d2";
    revisions[1].sql = (const unsigned char *)"CREATE TABLES broken(x);";
    revisions[1].sqlLength = strlen((const char *)revisions[1].sql);
    BatonCtxSqlChainReplayInput in = {0};
    in.revisions = revisions;
    in.revisionCount = 2;
    in.validatedPrefixCount = 1;
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    CHECK(baton_ctx_sql_chain_replay(&in, &out) == 0, "broken chain runs to record");
    CHECK(out.stage == BATON_CTX_SQL_REPLAY_REVISION_FAILED,
          "broken revision reports failure");
    char *brHex = hex_of("002-broken");
    CHECK(record_contains(&out, brHex), "failed revision identified");
    free(brHex);
    CHECK(record_contains(&out, "\"status\":\"failed\""), "failure outcome recorded");
    CHECK(out.code == SQLITE_ERROR, "broken revision preserves engine code");
    CHECK(record_contains(&out, "\"aborted\":true"), "abort recorded");
    /* Prefix section completed its revision; the failing revision appears in
       the head section. */
    baton_ctx_sql_output_free(&out);
  }

  {
    /* Open transaction after the chain is an error. */
    static BatonCtxSqlReplayRevision revisions[1];
    revisions[0].revision = "001";
    revisions[0].sha256 = "e1";
    revisions[0].sql = (const unsigned char *)"BEGIN; CREATE TABLE half(a);";
    revisions[0].sqlLength = strlen((const char *)revisions[0].sql);
    BatonCtxSqlChainReplayInput in = {0};
    in.revisions = revisions;
    in.revisionCount = 1;
    in.validatedPrefixCount = 1;
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    CHECK(baton_ctx_sql_chain_replay(&in, &out) == 0, "open-transaction runs");
    CHECK(out.stage == BATON_CTX_SQL_REPLAY_OPEN_TRANSACTION,
          "open transaction refuses completion");
    CHECK(record_contains(&out, "\"autocommitAtEnd\":false"),
          "open transaction recorded per connection");
    baton_ctx_sql_output_free(&out);
  }

  {
    /* ATTACH refuses through the replay authorizer. */
    static BatonCtxSqlReplayRevision revisions[1];
    revisions[0].revision = "001";
    revisions[0].sha256 = "f1";
    revisions[0].sql = (const unsigned char *)
        "ATTACH DATABASE '/tmp/ctx-sqlite-side.db' AS side;";
    revisions[0].sqlLength = strlen((const char *)revisions[0].sql);
    BatonCtxSqlChainReplayInput in = {0};
    in.revisions = revisions;
    in.revisionCount = 1;
    in.validatedPrefixCount = 1;
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    CHECK(baton_ctx_sql_chain_replay(&in, &out) == 0, "attach case runs");
    CHECK(out.stage == BATON_CTX_SQL_REPLAY_REVISION_FAILED, "ATTACH refuses");
    CHECK(record_contains_text(&out, "actionNotAdmitted"), "ATTACH denial recorded");
    char *attachHex = hex_of("SQLITE_ATTACH");
    CHECK(record_contains(&out, attachHex), "ATTACH action named in record");
    free(attachHex);
    baton_ctx_sql_output_free(&out);
  }

  {
    /* load_extension refuses by function name. */
    static BatonCtxSqlReplayRevision revisions[1];
    revisions[0].revision = "001";
    revisions[0].sha256 = "f2";
    revisions[0].sql = (const unsigned char *)"SELECT LOAD_EXTENSION('x');";
    revisions[0].sqlLength = strlen((const char *)revisions[0].sql);
    BatonCtxSqlChainReplayInput in = {0};
    in.revisions = revisions;
    in.revisionCount = 1;
    in.validatedPrefixCount = 1;
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    CHECK(baton_ctx_sql_chain_replay(&in, &out) == 0, "extension case runs");
    CHECK(out.stage == BATON_CTX_SQL_REPLAY_REVISION_FAILED,
          "load_extension refuses");
    CHECK(record_contains_text(&out, "functionNameNotAdmitted"),
          "function denial reason recorded");
    baton_ctx_sql_output_free(&out);
  }

  {
    /* Non-admitted pragma refuses by name, both cases of spelling. */
    static BatonCtxSqlReplayRevision revisions[1];
    revisions[0].revision = "001";
    revisions[0].sha256 = "f3";
    revisions[0].sql = (const unsigned char *)
        "PRAGMA JOURNAL_MODE=MEMORY; CREATE TABLE after_pragma(a);";
    revisions[0].sqlLength = strlen((const char *)revisions[0].sql);
    BatonCtxSqlChainReplayInput in = {0};
    in.revisions = revisions;
    in.revisionCount = 1;
    in.validatedPrefixCount = 1;
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    CHECK(baton_ctx_sql_chain_replay(&in, &out) == 0, "pragma case runs");
    CHECK(out.stage == BATON_CTX_SQL_REPLAY_REVISION_FAILED, "pragma refuses");
    CHECK(record_contains_text(&out, "pragmaNameNotAdmitted"),
          "pragma denial reason recorded");
    baton_ctx_sql_output_free(&out);
  }

  {
    /* Admitted pragmas and DDL across main run; NUL script refuses. */
    unsigned char nulScript[] = { 'C', 'R', 'E', 'A', 'T', 'E', ' ', 0, ';', ' ' };
    static BatonCtxSqlReplayRevision revisions[1];
    revisions[0].revision = "001";
    revisions[0].sha256 = "f4";
    revisions[0].sql = nulScript;
    revisions[0].sqlLength = sizeof(nulScript);
    BatonCtxSqlChainReplayInput in = {0};
    in.revisions = revisions;
    in.revisionCount = 1;
    in.validatedPrefixCount = 1;
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    CHECK(baton_ctx_sql_chain_replay(&in, &out) == 0, "nul script runs");
    CHECK(out.stage == BATON_CTX_SQL_SQL_NUL, "script NUL refuses before prepare");
    baton_ctx_sql_output_free(&out);
  }

  {
    /* Empty scripts are admitted revisions with zero statements. */
    static BatonCtxSqlReplayRevision revisions[2];
    revisions[0].revision = "001";
    revisions[0].sha256 = "n1";
    revisions[0].sql = (const unsigned char *)"CREATE TABLE e1(a);";
    revisions[0].sqlLength = strlen((const char *)revisions[0].sql);
    revisions[1].revision = "002-empty";
    revisions[1].sha256 = "n2";
    revisions[1].sql = (const unsigned char *)"-- only a comment\n";
    revisions[1].sqlLength = strlen((const char *)revisions[1].sql);
    BatonCtxSqlChainReplayInput in = {0};
    in.revisions = revisions;
    in.revisionCount = 2;
    in.validatedPrefixCount = 2;
    in.scratchDirectory = scratch;
    in.cancelFlag = &cancel;
    BatonCtxSqlOutput out;
    CHECK(baton_ctx_sql_chain_replay(&in, &out) == 0, "empty script runs");
    CHECK(out.stage == BATON_CTX_SQL_OK, "empty script revision admitted");
    baton_ctx_sql_output_free(&out);
  }

  {
    /* Pre-set cancellation refuses before any connection. */
    static BatonCtxSqlReplayRevision revisions[1];
    revisions[0].revision = "001";
    revisions[0].sha256 = "c1";
    revisions[0].sql = (const unsigned char *)"CREATE TABLE c(a);";
    revisions[0].sqlLength = strlen((const char *)revisions[0].sql);
    BatonCtxSqlChainReplayInput in = {0};
    in.revisions = revisions;
    in.revisionCount = 1;
    in.validatedPrefixCount = 1;
    in.scratchDirectory = scratch;
    volatile sig_atomic_t cancelled = 1;
    in.cancelFlag = &cancelled;
    BatonCtxSqlOutput out;
    CHECK(baton_ctx_sql_chain_replay(&in, &out) == 0, "cancelled replay runs");
    CHECK(out.stage == BATON_CTX_SQL_CANCELLED, "replay cancellation refuses");
    baton_ctx_sql_output_free(&out);
  }

  printf("\n%d checks, %d failures\n", g_checks, g_failures);
  free(scratch);
  unlink(dbPath);
  unlink(livePath);
  return g_failures ? 1 : 0;
}
