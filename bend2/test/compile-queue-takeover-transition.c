/* Reproduce the admission transition of supervisor 4190273 on 2026-10-25.
   After takeover releases its initial admission view, let the fixture admit a
   waiter before takeover acquires the lock again. Record its signal calls. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

static _Atomic int phase;

static int admission_fd(int fd) {
  const char *lock = getenv("TAKEOVER_TRANSITION_LOCK");
  struct stat expected, actual;
  return lock && !stat(lock, &expected) && !fstat(fd, &actual)
    && expected.st_dev == actual.st_dev && expected.st_ino == actual.st_ino;
}

static void transition(void) {
  const char *ready = getenv("TAKEOVER_TRANSITION_READY");
  const char *release = getenv("TAKEOVER_TRANSITION_RELEASE");
  if (!ready || !release) _exit(90);
  int fd = open(ready, O_WRONLY | O_CREAT | O_EXCL, 0600);
  if (fd < 0) _exit(91);
  close(fd);
  while (access(release, F_OK)) usleep(1000);
}

int flock(int fd, int operation) {
  int (*actual)(int, int) = dlsym(RTLD_NEXT, "flock");
  int ours = admission_fd(fd);
  int previous = 2;
  if (ours && operation == LOCK_EX
      && atomic_compare_exchange_strong(&phase, &previous, 3)) transition();
  int result = actual(fd, operation);
  if (!result && ours) {
    previous = 0;
    if (operation == LOCK_EX) atomic_compare_exchange_strong(&phase, &previous, 1);
    previous = 1;
    if (operation == LOCK_UN) atomic_compare_exchange_strong(&phase, &previous, 2);
  }
  return result;
}

int close(int fd) {
  int (*actual)(int) = dlsym(RTLD_NEXT, "close");
  int ours = admission_fd(fd);
  int result = actual(fd);
  int previous = 1;
  if (!result && ours) atomic_compare_exchange_strong(&phase, &previous, 2);
  return result;
}

int kill(pid_t pid, int sig) {
  int (*actual)(pid_t, int) = dlsym(RTLD_NEXT, "kill");
  const char *log = getenv("TAKEOVER_TRANSITION_SIGNALS");
  if (log) {
    int fd = open(log, O_WRONLY | O_CREAT | O_APPEND, 0600);
    if (fd >= 0) {
      dprintf(fd, "%d %d\n", (int)pid, sig);
      close(fd);
    }
  }
  return actual(pid, sig);
}
