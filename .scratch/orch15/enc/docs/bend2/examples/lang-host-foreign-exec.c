// The C half of HostProc.exec: popen the command, read its whole standard output, and
// answer it as a Result. The runtime is spliced in before this file, so io_cstr, io_str,
// io_done, io_fail and io_eff are in scope; io_str copies the bytes into a Term, so the
// local buffer is freed here.

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>

#ifdef CID_HOSTPROC_EXEC

Term hostproc_exec_run(Env e, Term* f, IoWork* w) {
  u64 len = 0;
  char* cmd = io_cstr(e, f[0], &len);
  FILE* p = popen(cmd, "r");
  free(cmd);
  if (p == NULL) {
    return io_fail(e, errno, NULL);
  }
  u32 cap = 4096;
  u32 n = 0;
  char* buf = malloc(cap);
  for (;;) {
    if (n == cap) {
      cap *= 2;
      buf = realloc(buf, cap);
    }
    size_t got = fread(buf + n, 1, cap - n, p);
    if (got == 0) {
      break;
    }
    n += (u32)got;
  }
  int status = pclose(p);
  Term r = status != -1 && WIFEXITED(status) && WEXITSTATUS(status) != 0
    ? io_fail(e, WEXITSTATUS(status), NULL)
    : io_done(e, io_str(e, buf, n));
  free(buf);
  return r;
}

static void __attribute__((constructor)) hostproc_exec_use(void) {
  io_eff(CID_HOSTPROC_EXEC, hostproc_exec_run, 0);
}

#endif
