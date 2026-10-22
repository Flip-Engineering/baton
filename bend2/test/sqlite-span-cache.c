/* Fixture driver for the read-only span cache. The test runner prepends the
   BatonSqlSpan structure, the span call and release functions, the BatonSql
   structure, its row callback, the busy handler and the marked read-cache
   section from bend2/src/host/sqlite.c. argv: db1 db2 spool. */
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/mman.h>
#include <limits.h>
#include <stdint.h>
#include <errno.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned long long read_rchar(void) {
  FILE *file = fopen("/proc/self/io", "r");
  if (!file) return 0;
  char line[128];
  unsigned long long value = 0;
  while (fgets(line, sizeof line, file)) {
    if (strncmp(line, "rchar:", 6) == 0) {
      value = strtoull(line + 6, NULL, 10);
      break;
    }
  }
  fclose(file);
  return value;
}

static int run_span(const char *path, const char *spool, const char *sql,
                    char **output, unsigned long long *rchar, int *code) {
  struct stat info;
  if (stat(spool, &info) || info.st_size < 0) return 1;
  BatonSqlSpan *call = calloc(1, sizeof *call);
  if (!call) return 1;
  call->path = strdup(path);
  call->spool = strdup(spool);
  call->sql = strdup(sql);
  call->spool_fd = -1;
  call->span_length = (uint64_t)info.st_size;
  if (!call->path || !call->spool || !call->sql) {
    baton_sql_span_release(call);
    return 1;
  }
  IoWork work;
  memset(&work, 0, sizeof work);
  work.data = call;
  unsigned long long before = read_rchar();
  baton_sql_span_call(&work);
  unsigned long long after = read_rchar();
  *rchar = after >= before ? after - before : 0;
  *code = call->code;
  *output = strdup(call->output ? call->output : "");
  int failed = !*output;
  if (!failed && call->code != SQLITE_OK)
    fprintf(stderr, "span query failed: %s\n", call->error ? call->error : "unknown");
  baton_sql_span_release(call);
  return failed;
}

static void print_output(const char *name, const char *output) {
  printf("%s=", name);
  fputs(output ? output : "", stdout);
  printf("%s_END\n", name);
}


static int test_span_transaction(const char *database, const char *spool) {
  char *output = NULL;
  unsigned long long rchar = 0;
  int code = 0;
  if (run_span(database, spool, "BEGIN; SELECT length(?1);", &output, &rchar, &code))
    return 1;
  int failed = code != SQLITE_OK || !output || strcmp(output, "7\n") != 0;
  free(output);
  BatonSqlReadCache *cache = baton_sql_read_cache(0);
  if (!failed && (!cache || !cache->db || !sqlite3_get_autocommit(cache->db))) {
    fprintf(stderr, "fail span-transaction: read transaction remained open\n");
    failed = 1;
  }
  if (failed) {
    fprintf(stderr, "fail span-transaction: code=%d\n", code);
    return 1;
  }
  if (run_span(database, spool, "SELECT length(?1);", &output, &rchar, &code))
    return 1;
  failed = code != SQLITE_OK || !output || strcmp(output, "7\n") != 0 ||
           !cache || !sqlite3_get_autocommit(cache->db);
  free(output);
  if (failed) {
    fprintf(stderr, "fail span-transaction-followup: code=%d\n", code);
    return 1;
  }
  printf("ok span-transaction-rollback\n");
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 4) {
    fprintf(stderr, "usage: %s db1 db2 spool\n", argv[0]);
    return 2;
  }
  const char *sql = "SELECT length(?1), (SELECT count(*) FROM t);";
  char *first = NULL, *second = NULL, *third = NULL;
  unsigned long long first_rchar = 0, second_rchar = 0, third_rchar = 0;
  int first_code = 0, second_code = 0, third_code = 0;
  if (run_span(argv[1], argv[3], sql, &first, &first_rchar, &first_code) ||
      run_span(argv[1], argv[3], sql, &second, &second_rchar, &second_code)) {
    free(first); free(second);
    return 1;
  }
  printf("FIRST_CODE=%d\n", first_code);
  print_output("FIRST_OUTPUT", first);
  printf("FIRST_RCHAR=%llu\n", first_rchar);
  printf("SECOND_CODE=%d\n", second_code);
  print_output("SECOND_OUTPUT", second);
  printf("SECOND_RCHAR=%llu\n", second_rchar);
  printf("CACHE_LIVE=%d\n", baton_sql_read_test_live());
  if (run_span(argv[2], argv[3], sql, &third, &third_rchar, &third_code)) {
    free(first); free(second); free(third);
    return 1;
  }
  printf("THIRD_CODE=%d\n", third_code);
  print_output("THIRD_OUTPUT", third);
  printf("THIRD_RCHAR=%llu\n", third_rchar);
  printf("CACHE_LIVE_AFTER=%d\n", baton_sql_read_test_live());
  int failed = first_code != SQLITE_OK || second_code != SQLITE_OK ||
               third_code != SQLITE_OK;
  if (!failed) failed = test_span_transaction(argv[1], argv[3]);
  free(first); free(second); free(third);
  return failed ? 1 : 0;
}
