/* Remote fixture: injected close outcomes after an actual descriptor close. */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <errno.h>
#include <unistd.h>

static int spool_fd = -1, directory_fd = -1;
static int spool_error, directory_error, spool_calls, directory_calls;

static int fixture_close(int fd) {
  int error = 0;
  if (fd == spool_fd) { spool_calls++; error = spool_error; }
  if (fd == directory_fd) { directory_calls++; error = directory_error; }
  int result = close(fd);
  if (result) return result;
  if (error) { errno = error; return -1; }
  return 0;
}

#define close fixture_close
#include "../src/host/process-read-offer.h"
#undef close

#define EXPECT(condition) do { if (!(condition)) { \
  fprintf(stderr, "failed: %s\n", #condition); return 1; \
} } while (0)
#define REQUIRE(condition) do { if (!(condition)) { \
  fprintf(stderr, "setup failed: %s (errno %d)\n", #condition, errno); return 2; \
} } while (0)

static int dispose_case(int directory, int writer, int fail_spool, int fail_directory) {
  BrOfferedReader reader;
  BrFrameOffer offer;
  BrReadFrame taken = {0};
  int kind = -1;
  REQUIRE(br_read_offer_init(&reader, directory, writer, "stdout", 0) == 0);
  spool_fd = reader.source.spool;
  directory_fd = reader.source.directory;
  spool_calls = directory_calls = 0;
  spool_error = fail_spool ? EIO : 0;
  directory_error = fail_directory ? EINTR : 0;
  EXPECT(br_read_offer_ready(&reader, 2, 1, &kind, &offer) == 0);
  EXPECT(kind == BR_BUFFER_FRAME && offer.length == 2);
  EXPECT(br_read_offer_dispose(&reader) == EBUSY);
  EXPECT(spool_calls == 0 && directory_calls == 0);
  EXPECT(!reader.source.cleanup.spool_attempted && !reader.source.cleanup.directory_attempted);
  EXPECT(br_read_offer_take(&reader, offer.serial, &taken) == 0);
  EXPECT(taken.bytes == offer.bytes);
  free(taken.bytes);
  int expected = spool_error ? spool_error : directory_error;
  EXPECT(br_read_offer_dispose(&reader) == expected);
  EXPECT(reader.source.cleanup.spool_attempted == 1);
  EXPECT(reader.source.cleanup.directory_attempted == 1);
  EXPECT(reader.source.cleanup.spool_error == spool_error);
  EXPECT(reader.source.cleanup.directory_error == directory_error);
  EXPECT(spool_calls == 1 && directory_calls == 1);
  EXPECT(!reader.source.name && !reader.source.buffer.partial);

  /* Reuse the exact numeric descriptors. A retry must preserve these objects. */
  REQUIRE(dup2(writer, spool_fd) == spool_fd);
  REQUIRE(dup2(directory, directory_fd) == directory_fd);
  int before_spool = spool_calls, before_directory = directory_calls;
  EXPECT(br_read_offer_dispose(&reader) == expected);
  EXPECT(spool_calls == before_spool && directory_calls == before_directory);
  EXPECT(fcntl(spool_fd, F_GETFD) >= 0 && fcntl(directory_fd, F_GETFD) >= 0);
  EXPECT(reader.source.spool == -1 && reader.source.directory == -1);
  REQUIRE(close(spool_fd) == 0);
  REQUIRE(close(directory_fd) == 0);
  spool_fd = directory_fd = -1;
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  int directory = open(argv[1], O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  REQUIRE(directory >= 0);
  int writer = openat(directory, "stdout", O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  REQUIRE(writer >= 0 && write(writer, "x\n", 2) == 2);
  for (int first = 0; first <= 1; first++) {
    for (int second = 0; second <= 1; second++) {
      int result = dispose_case(directory, writer, first, second);
      if (result) return result;
    }
  }
  REQUIRE(close(writer) == 0 && close(directory) == 0);
  puts("retained reader disposal cases passed");
  return 0;
}
