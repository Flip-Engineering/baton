#include <errno.h>
#include <signal.h>
#include <unistd.h>

static int output_test_saved = -1;

/* This test effect changes fd 1 without changing the IoAct work error. */
static Term output_test_redirect(Env e, Term *f, IoWork *w) {
  (void)w;
  if ((u32)f[0] == 0) {
    int descriptors[2];
    output_test_saved = dup(STDOUT_FILENO);
    if (output_test_saved < 0 || pipe(descriptors) != 0)
      return io_fail(e, errno, NULL);
    int result = dup2(descriptors[1], STDOUT_FILENO);
    int error = errno;
    close(descriptors[0]);
    close(descriptors[1]);
    if (result < 0) return io_fail(e, error, NULL);
  } else {
    if (dup2(output_test_saved, STDOUT_FILENO) < 0)
      return io_fail(e, errno, NULL);
    close(output_test_saved);
    output_test_saved = -1;
  }
  return io_done(e, term_pak(CID_UNIT, 0));
}

static void __attribute__((constructor)) output_test_use(void) {
  signal(SIGPIPE, SIG_IGN);
  io_eff(CID_OUTPUTTEST_REDIRECT, output_test_redirect, 0);
}
