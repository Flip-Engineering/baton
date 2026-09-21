// The C half of HostEcho.run: popen the command, read its whole standard output, answer it as a
// String. The runtime is spliced in before this file, so io_cstr, io_str, io_done and io_eff are
// in scope; io_str copies the bytes into a Term, so the local buffer is freed here.
//
// This file is deliberately the ONLY host half of the effect: the question it answers is whether
// a native Bend2 binary runs an effect that has no JavaScript side.

#include <stdio.h>
#include <stdlib.h>

#ifdef CID_HOSTECHO_RUN

Term hostecho_run_run(Env e, Term* f, IoWork* w) {
  u64 len = 0;
  char* cmd = io_cstr(e, f[0], &len);
  FILE* p = popen(cmd, "r");
  free(cmd);
  if (p == NULL) {
    return io_str(e, "", 0);
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
  pclose(p);
  Term r = io_str(e, buf, n);
  free(buf);
  return r;
}

static void __attribute__((constructor)) hostecho_run_use(void) {
  io_eff(CID_HOSTECHO_RUN, hostecho_run_run, 0);
}

#endif
