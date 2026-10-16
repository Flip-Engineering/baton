// The C half of Host.exit: halt the process with this code and write
// nothing. exit() flushes standard streams and runs atexit handlers; no
// Term is ever produced, so the effect registers without the io_work
// park.
#include <stdlib.h>

#ifdef CID_HOST_EXIT
static Term baton_exit_run(Env e, Term *f, IoWork *w) {
  (void)e;(void)w;
  exit((int)(u32)f[0]);
}
static void __attribute__((constructor)) baton_exit_use(void) {
  io_eff(CID_HOST_EXIT, baton_exit_run, 0);
}
#endif
