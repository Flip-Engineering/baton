/* Remote controls for validation of the original spool on every read. */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include "../src/host/process-read-source.h"

static int failures;
#define EXPECT(condition) do { if (!(condition)) { \
  fprintf(stderr, "failed: %s\n", #condition); failures++; \
} } while (0)
#define REQUIRE(condition) do { if (!(condition)) { \
  fprintf(stderr, "setup failed: %s (errno %d)\n", #condition, errno); return 2; \
} } while (0)

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  int directory = open(argv[1], O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  REQUIRE(directory >= 0);
  int writer = openat(directory, "stdout", O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  REQUIRE(writer >= 0);
  REQUIRE(pwrite(writer, "tail", 4, 0) == 4);
  BrReadSource source;
  BrReadFrame frame;
  int kind = -1;
  REQUIRE(br_read_source_init(&source, directory, writer, "stdout", 0) == 0);
  EXPECT(source.spool != writer && source.directory != directory);
  EXPECT((fcntl(source.spool, F_GETFD) & FD_CLOEXEC) != 0);
  EXPECT(br_read_source_ready(&source, 4, 0, &kind, &frame) == 0);
  EXPECT(kind == BR_BUFFER_WAITING && source.buffer.length == 4 && !frame.bytes);

  /* A fully buffered tail still requires its original named source. */
  REQUIRE(renameat(directory, "stdout", directory, "original") == 0);
  EXPECT(br_read_source_ready(&source, 4, 1, &kind, &frame) == ENOENT);
  EXPECT(source.buffer.length == 4 && source.buffer.scan == 4 && !source.buffer.sealed);
  EXPECT(!frame.bytes);
  REQUIRE(symlinkat("original", directory, "stdout") == 0);
  EXPECT(br_read_source_ready(&source, 4, 1, &kind, &frame) == ESTALE);
  REQUIRE(unlinkat(directory, "stdout", 0) == 0);
  int replacement = openat(directory, "stdout", O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  REQUIRE(replacement >= 0);
  REQUIRE(pwrite(replacement, "tail", 4, 0) == 4);
  EXPECT(br_read_source_ready(&source, 4, 1, &kind, &frame) == ESTALE);
  EXPECT(source.buffer.length == 4 && !source.buffer.sealed && !frame.bytes);
  REQUIRE(close(replacement) == 0);
  REQUIRE(unlinkat(directory, "stdout", 0) == 0);
  REQUIRE(renameat(directory, "original", directory, "stdout") == 0);

  /* An observed truncation refuses before consuming the retained tail. */
  REQUIRE(ftruncate(writer, 2) == 0);
  EXPECT(br_read_source_ready(&source, 4, 1, &kind, &frame) == EIO);
  EXPECT(source.buffer.length == 4 && source.buffer.frame_start == 0 && !frame.bytes);
  REQUIRE(pwrite(writer, "il", 2, 2) == 2);
  EXPECT(br_read_source_ready(&source, 4, 1, &kind, &frame) == 0);
  EXPECT(kind == BR_BUFFER_FRAME && frame.length == 4 && frame.start == 0 && frame.next == 4);
  if (frame.length == 4) EXPECT(!memcmp(frame.bytes, "tail", 4));
  free(frame.bytes);
  EXPECT(br_read_source_ready(&source, 4, 1, &kind, &frame) == 0);
  EXPECT(kind == BR_BUFFER_EOF && !frame.bytes);

  /* EOF also validates availability and the sealed extent. */
  REQUIRE(renameat(directory, "stdout", directory, "original") == 0);
  EXPECT(br_read_source_ready(&source, 4, 1, &kind, &frame) == ENOENT);
  REQUIRE(renameat(directory, "original", directory, "stdout") == 0);
  REQUIRE(pwrite(writer, "x", 1, 4) == 1);
  EXPECT(br_read_source_ready(&source, 4, 1, &kind, &frame) == EIO);
  EXPECT(source.buffer.scan == 4 && source.buffer.sealed && !frame.bytes);
  REQUIRE(ftruncate(writer, 4) == 0);
  EXPECT(br_read_source_ready(&source, UINT64_MAX, 0, &kind, &frame) == EOVERFLOW);

  /* The reader owns duplicates, so closing caller descriptors preserves it. */
  REQUIRE(close(writer) == 0);
  REQUIRE(close(directory) == 0);
  EXPECT(br_read_source_ready(&source, 4, 1, &kind, &frame) == 0);
  EXPECT(kind == BR_BUFFER_EOF && !frame.bytes);
  int held = source.spool;
  br_read_source_dispose(&source);
  errno = 0;
  EXPECT(fcntl(held, F_GETFD) == -1 && errno == EBADF);
  EXPECT(br_read_source_ready(&source, 4, 1, &kind, &frame) == EBADF);
  EXPECT(!frame.bytes);
  br_read_source_dispose(&source);

  /* Initialization refuses an unrelated open spool, even with equal bytes. */
  directory = open(argv[1], O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  REQUIRE(directory >= 0);
  writer = openat(directory, "other", O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  REQUIRE(writer >= 0);
  REQUIRE(pwrite(writer, "tail", 4, 0) == 4);
  EXPECT(br_read_source_init(&source, directory, writer, "stdout", 0) == ESTALE);
  EXPECT(source.directory == -1 && source.spool == -1 && !source.name);
  EXPECT(br_read_source_init(&source, directory, writer, "../stdout", 0) == EINVAL);
  br_read_source_dispose(&source);
  REQUIRE(close(writer) == 0);
  REQUIRE(close(directory) == 0);
  if (!failures) puts("retained source validation cases passed");
  return failures ? 1 : 0;
}
