/* Preloaded into the usage-read helper by usage-read-codex.py. A wall-clock read
   fails with EINVAL; every other clock is read by the C library. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <time.h>

int clock_gettime(clockid_t clock, struct timespec *value) {
  static int (*library)(clockid_t, struct timespec *);
  if (clock == CLOCK_REALTIME) {
    errno = EINVAL;
    return -1;
  }
  if (!library) library = (int (*)(clockid_t, struct timespec *))dlsym(RTLD_NEXT, "clock_gettime");
  return library(clock, value);
}
