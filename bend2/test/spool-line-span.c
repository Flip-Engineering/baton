/* Fixture driver for the retained-spool line-span tail buffer. The test runner
   prepends the BatonRetained and BatonProcessCall fields used by the verbatim
   br_spool_try_line_span function from bend2/src/host/process-spawn.c. */
#include <sys/types.h>
#include <sys/stat.h>
#include <errno.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <limits.h>
#define COMPLETE_LINES 4096
#define COMPLETE_LINE_BYTES 127
#define COMPLETE_BYTES (COMPLETE_LINES * (COMPLETE_LINE_BYTES + 1))

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

static int write_all(int fd, const char *bytes, size_t length) {
  while (length) {
    ssize_t written = write(fd, bytes, length);
    if (written < 0 && errno == EINTR) continue;
    if (written <= 0) return 1;
    bytes += written;
    length -= (size_t)written;
  }
  return 0;
}

static void set_exited(BatonRetained *retained, int exited) {
  pthread_mutex_lock(&retained->state);
  retained->exited = exited;
  pthread_mutex_unlock(&retained->state);
}

static int complete_case(const char *directory) {
  char path[PATH_MAX];
  if (snprintf(path, sizeof path, "%s/complete", directory) >= (int)sizeof path)
    return 1;
  int fd = open(path, O_CREAT | O_TRUNC | O_RDWR | O_CLOEXEC, 0600);
  if (fd < 0) return 1;
  char line[COMPLETE_LINE_BYTES + 1];
  memset(line, 'a', COMPLETE_LINE_BYTES);
  line[COMPLETE_LINE_BYTES] = '\n';
  for (size_t i = 0; i < COMPLETE_LINES; i++) {
    if (write_all(fd, line, sizeof line)) { close(fd); return 1; }
  }
  BatonRetained retained;
  memset(&retained, 0, sizeof retained);
  retained.spool = fd;
  retained.exited = 1;
  pthread_mutex_init(&retained.state, NULL);
  unsigned long long before = read_rchar();
  uint64_t expected_start = 0;
  size_t lines = 0;
  for (;;) {
    BatonProcessCall call;
    memset(&call, 0, sizeof call);
    int result = br_spool_try_line_span(&retained, &call);
    if (result == 1) {
      if (call.frame_start != expected_start || call.frame_length != COMPLETE_LINE_BYTES) {
        close(fd); return 1;
      }
      expected_start += COMPLETE_LINE_BYTES + 1;
      lines++;
    } else if (result == -1) {
      if (!call.eof || retained.offset != (off_t)COMPLETE_BYTES) { close(fd); return 1; }
      break;
    } else {
      close(fd); return 1;
    }
  }
  unsigned long long after = read_rchar();
  close(fd);
  if (lines != COMPLETE_LINES) return 1;
  printf("COMPLETE_LINES=%zu\n", lines);
  printf("COMPLETE_BYTES=%zu\n", (size_t)COMPLETE_BYTES);
  printf("COMPLETE_RCHAR=%llu\n", after >= before ? after - before : 0);
  return 0;
}

static int partial_case(const char *directory) {
  char path[PATH_MAX];
  if (snprintf(path, sizeof path, "%s/partial", directory) >= (int)sizeof path)
    return 1;
  int fd = open(path, O_CREAT | O_TRUNC | O_RDWR | O_CLOEXEC, 0600);
  if (fd < 0) return 1;
  if (write_all(fd, "abc", 3)) { close(fd); return 1; }
  BatonRetained retained;
  memset(&retained, 0, sizeof retained);
  retained.spool = fd;
  pthread_mutex_init(&retained.state, NULL);
  BatonProcessCall call;
  memset(&call, 0, sizeof call);
  if (br_spool_try_line_span(&retained, &call) != 0) { close(fd); return 1; }
  if (retained.offset != 0 || retained.spool_partial != 3) { close(fd); return 1; }
  if (write_all(fd, "\ndef\n", 5)) { close(fd); return 1; }
  set_exited(&retained, 1);
  memset(&call, 0, sizeof call);
  if (br_spool_try_line_span(&retained, &call) != 1 ||
      call.frame_start != 0 || call.frame_length != 3) { close(fd); return 1; }
  memset(&call, 0, sizeof call);
  if (br_spool_try_line_span(&retained, &call) != 1 ||
      call.frame_start != 4 || call.frame_length != 3) { close(fd); return 1; }
  memset(&call, 0, sizeof call);
  if (br_spool_try_line_span(&retained, &call) != -1 || !call.eof ||
      retained.offset != 8) { close(fd); return 1; }
  close(fd);
  return 0;
}

static int eof_case(const char *directory) {
  char path[PATH_MAX];
  if (snprintf(path, sizeof path, "%s/eof", directory) >= (int)sizeof path)
    return 1;
  int fd = open(path, O_CREAT | O_TRUNC | O_RDWR | O_CLOEXEC, 0600);
  if (fd < 0) return 1;
  if (write_all(fd, "xyz", 3)) { close(fd); return 1; }
  BatonRetained retained;
  memset(&retained, 0, sizeof retained);
  retained.spool = fd;
  retained.exited = 1;
  pthread_mutex_init(&retained.state, NULL);
  BatonProcessCall call;
  memset(&call, 0, sizeof call);
  if (br_spool_try_line_span(&retained, &call) != -1 || call.eof ||
      call.frame_start != 0 || call.frame_length != 3 ||
      retained.offset != 3) { close(fd); return 1; }
  memset(&call, 0, sizeof call);
  if (br_spool_try_line_span(&retained, &call) != -1 || !call.eof ||
      retained.offset != 3) { close(fd); return 1; }
  close(fd);
  return 0;
}

int main(void) {
  char directory[] = "/tmp/baton-spool-line-XXXXXX";
  if (!mkdtemp(directory)) {
    fprintf(stderr, "mkdtemp: %s\n", strerror(errno));
    return 2;
  }
  if (complete_case(directory) || partial_case(directory) || eof_case(directory)) {
    fprintf(stderr, "spool line span fixture failure\n");
    return 1;
  }
  printf("SPOOL_LINE_TESTS_OK\n");
  return 0;
}
