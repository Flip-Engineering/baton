#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <sqlite3.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* The fixture records entry to the real busy callback for its selected database. */
typedef int (*BusyCallback)(void *, int);
typedef int (*BusyHandler)(sqlite3 *, BusyCallback, void *);
typedef struct BusyObservation {
  BusyCallback callback;
  void *argument;
  char *marker;
} BusyObservation;

static int observed_busy(void *argument, int tries) {
  BusyObservation *observation = argument;
  int saved = errno;
  char line[96];
  int length = snprintf(line, sizeof(line), "%ld %d\n", (long)getpid(), tries);
  int fd = open(observation->marker, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0600);
  if (fd >= 0) {
    ssize_t written;
    do written = write(fd, line, (size_t)length); while (written < 0 && errno == EINTR);
    close(fd);
  }
  errno = saved;
  return observation->callback(observation->argument, tries);
}

static int observe_busy_handler(sqlite3 *database, BusyCallback callback, void *argument) {
  BusyHandler original = (BusyHandler)dlsym(RTLD_NEXT, "sqlite3_busy_handler");
  const char *selected = getenv("BATON_TEST_BUSY_DATABASE");
  const char *marker = getenv("BATON_TEST_BUSY_MARKER");
  const char *filename = sqlite3_db_filename(database, "main");
  if (!original) {
    fputs("The SQLite busy observer could not find sqlite3_busy_handler.\n", stderr);
    _exit(125);
  }
  if (!callback || !selected || !marker || !filename || strcmp(selected, filename))
    return original(database, callback, argument);
  BusyObservation *observation = calloc(1, sizeof(*observation));
  if (observation) observation->marker = strdup(marker);
  if (!observation || !observation->marker) {
    fputs("The SQLite busy observer could not retain its fixture marker.\n", stderr);
    _exit(125);
  }
  observation->callback = callback;
  observation->argument = argument;
  int result = original(database, observed_busy, observation);
  if (result != SQLITE_OK) {
    free(observation->marker);
    free(observation);
    return result;
  }
  /* The fixture retains callback contexts for the subprocess lifetime. */
  return result;
}

#ifdef __APPLE__
__attribute__((used)) static struct {
  const void *replacement;
  const void *original;
} busy_interpose __attribute__((section("__DATA,__interpose"))) = {
  (const void *)observe_busy_handler, (const void *)sqlite3_busy_handler
};
#else
int sqlite3_busy_handler(sqlite3 *database, BusyCallback callback, void *argument) {
  return observe_busy_handler(database, callback, argument);
}
#endif
