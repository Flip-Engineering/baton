// C effect: read lines from a child's stdout until a line starting with
// {"type":"result" is found, or EOF. Returns the matching line, or empty
// string at EOF. Shares the children table from process-spawn.c via the
// BATON_PROCESS_CHILDREN_DEFINED guard.

#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>

#ifndef BATON_PROCESS_CHILDREN_DEFINED
#define BATON_PROCESS_CHILDREN_DEFINED

typedef struct {
  pid_t pid;
  int stdin_fd;
  int stdout_fd;
  int stderr_fd;
} SpawnedChild;

#define CHILDREN_INITIAL_CAP 16
static SpawnedChild* children = NULL;
static int child_count = 0;
static int children_cap = 0;

#endif

#ifdef CID_PROCESSCHILD_READ_UNTIL_RESULT

static const char RESULT_PREFIX[] = "{\"type\":\"result\"";
static const size_t RESULT_PREFIX_LEN = 16;

Term processchild_read_until_result_run(Env e, Term* f, IoWork* w) {
  int idx = (int)(u32)f[0];
  if (idx < 0 || idx >= child_count) return io_fail(e, EINVAL, "invalid child handle");

  u32 cap = 8192;
  u32 n = 0;
  char* buf = malloc(cap);

  for (;;) {
    char c;
    ssize_t got = read(children[idx].stdout_fd, &c, 1);
    if (got <= 0) {
      Term r = io_str(e, buf, n);
      free(buf);
      return r;
    }

    if (c == '\n') {
      if (n >= RESULT_PREFIX_LEN && memcmp(buf, RESULT_PREFIX, RESULT_PREFIX_LEN) == 0) {
        Term r = io_str(e, buf, n);
        free(buf);
        return r;
      }
      n = 0;
      continue;
    }

    if (n == cap) { cap *= 2; buf = realloc(buf, cap); }
    buf[n++] = c;
  }
}

static void __attribute__((constructor)) processchild_read_until_result_use(void) {
  io_eff(CID_PROCESSCHILD_READ_UNTIL_RESULT, processchild_read_until_result_run, 0);
}

#endif
