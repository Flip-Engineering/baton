/* Remote-only raw source controls. Each invocation gets a unique directory. */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include "../src/host/process-read-offer.h"

static int fail_allocation, interrupted_read, short_read, fail_read;
static int remove_after_read, source_directory;
static void *test_allocate(size_t size) {
  if (fail_allocation) { fail_allocation = 0; return NULL; }
  return malloc(size);
}
static ssize_t test_read(int fd, void *bytes, size_t size, off_t offset) {
  if (interrupted_read) { interrupted_read = 0; errno = EINTR; return -1; }
  if (fail_read) { fail_read = 0; errno = EIO; return -1; }
  if (short_read && size > 2) size = 2;
  ssize_t result = pread(fd, bytes, size, offset);
  if (remove_after_read) {
    remove_after_read = 0;
    if (renameat(source_directory, "stdout", source_directory, "moved")) return -1;
  }
  return result;
}
#define malloc test_allocate
#define pread test_read
#include "../src/host/process-read-bytes.h"
#undef malloc
#undef pread

#define EXPECT(condition) do { if (!(condition)) { \
  fprintf(stderr, "failed: %s\n", #condition); return 1; \
} } while (0)
#define REQUIRE(condition) do { if (!(condition)) { \
  fprintf(stderr, "setup failed: %s (errno %d)\n", #condition, errno); return 2; \
} } while (0)

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  int directory = open(argv[1], O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  REQUIRE(directory >= 0);
  source_directory = directory;
  int writer = openat(directory, "stdout", O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  REQUIRE(writer >= 0);
  const unsigned char original[] = {'a', 0, 0xff, '\r', '\n', 'a', 0, 0xff, '\r', '\n', 'z'};
  REQUIRE(pwrite(writer, original, sizeof(original), 0) == (ssize_t)sizeof(original));
  REQUIRE(lseek(writer, 3, SEEK_SET) == 3);
  BrByteReader reader;
  BrFrameOffer first, retry;
  BrReadFrame taken;
  int kind = -1;
  REQUIRE(br_read_bytes_init(&reader, directory, writer, "stdout", 0) == 0);
  EXPECT(br_read_bytes_ready(&reader, 4, 0, 0, &kind, &first) == EINVAL);
  EXPECT(reader.held.fault == 0 && reader.held.source.buffer.scan == 0);
  fail_allocation = 1;
  EXPECT(br_read_bytes_ready(&reader, 4, 0, 64, &kind, &first) == ENOMEM);
  EXPECT(!first.bytes && !reader.held.offered && reader.held.source.buffer.scan == 0);
  interrupted_read = 1;
  EXPECT(br_read_bytes_ready(&reader, 4, 0, 64, &kind, &first) == 0);
  EXPECT(kind == BR_BYTES_OFFER && first.start == 0 && first.next == 4 && first.length == 4);
  EXPECT(!memcmp(first.bytes, original, 4));
  EXPECT(lseek(writer, 0, SEEK_CUR) == 3);
  EXPECT(br_read_bytes_ready(&reader, 4, 0, 1, &kind, &retry) == 0);
  EXPECT(retry.bytes == first.bytes && retry.serial == first.serial && retry.length == 4);
  EXPECT(br_read_bytes_dispose(&reader) == EBUSY);
  EXPECT(br_read_bytes_take(&reader, first.serial + 1, &taken) == ESTALE);
  EXPECT(!taken.bytes && reader.held.offered);
  EXPECT(br_read_bytes_take(&reader, first.serial, &taken) == 0);
  EXPECT(taken.bytes == first.bytes && taken.next == 4);
  free(taken.bytes);
  EXPECT(br_read_bytes_take(&reader, first.serial, &taken) == ESTALE);
  EXPECT(br_read_bytes_ready(&reader, 4, 0, 64, &kind, &retry) == 0);
  EXPECT(kind == BR_BYTES_WAITING && !retry.bytes);
  EXPECT(br_read_bytes_dispose(&reader) == 0);

  /* Small transfers concatenate to the exact source, including repeated bytes. */
  unsigned char collected[sizeof(original)];
  size_t used = 0;
  REQUIRE(br_read_bytes_init(&reader, directory, writer, "stdout", 0) == 0);
  short_read = 1;
  while (used < sizeof(original)) {
    EXPECT(br_read_bytes_ready(&reader, sizeof(original), 0, 7, &kind, &first) == 0);
    EXPECT(kind == BR_BYTES_OFFER && first.start == used && first.length > 0);
    EXPECT(first.next <= sizeof(original) && first.length == first.next - first.start);
    memcpy(collected + used, first.bytes, first.length);
    used += first.length;
    EXPECT(br_read_bytes_take(&reader, first.serial, &taken) == 0);
    free(taken.bytes);
  }
  short_read = 0;
  EXPECT(!memcmp(collected, original, sizeof(original)));
  EXPECT(br_read_bytes_ready(&reader, sizeof(original), 0, 7, &kind, &retry) == 0);
  EXPECT(kind == BR_BYTES_WAITING && !retry.bytes);
  EXPECT(br_read_bytes_ready(&reader, sizeof(original), 1, 7, &kind, &retry) == 0);
  EXPECT(kind == BR_BYTES_END && !retry.bytes);
  EXPECT(br_read_bytes_ready(&reader, sizeof(original), 0, 7, &kind, &retry) == EINVAL);
  EXPECT(reader.held.fault == EINVAL);
  EXPECT(br_read_bytes_dispose(&reader) == 0);

  /* A raw reconnect can start inside an LF-delimited frame. */
  REQUIRE(br_read_bytes_init(&reader, directory, writer, "stdout", 2) == 0);
  EXPECT(br_read_bytes_ready(&reader, 4, 0, 64, &kind, &first) == 0);
  EXPECT(first.start == 2 && first.next == 4 && !memcmp(first.bytes, original + 2, 2));
  EXPECT(br_read_bytes_ready(&reader, 3, 0, 64, &kind, &retry) == EINVAL);
  EXPECT(reader.held.fault == EINVAL && reader.held.pending.bytes == first.bytes);
  EXPECT(br_read_bytes_take(&reader, first.serial, &taken) == 0);
  free(taken.bytes);
  EXPECT(br_read_bytes_dispose(&reader) == 0);

  /* Post-read replacement retains the newly read allocation for a failure task. */
  REQUIRE(br_read_bytes_init(&reader, directory, writer, "stdout", 0) == 0);
  remove_after_read = 1;
  EXPECT(br_read_bytes_ready(&reader, 4, 0, 64, &kind, &first) == ENOENT);
  EXPECT(!first.bytes && reader.held.offered && reader.held.pending.length == 4);
  REQUIRE(renameat(directory, "moved", directory, "stdout") == 0);
  EXPECT(br_read_bytes_ready(&reader, 4, 0, 64, &kind, &retry) == ENOENT);
  EXPECT(br_read_bytes_dispose(&reader) == EBUSY);
  EXPECT(br_read_bytes_take(&reader, reader.held.serial, &taken) == 0);
  EXPECT(!memcmp(taken.bytes, original, 4) && reader.held.fault == ENOENT);
  free(taken.bytes);
  EXPECT(br_read_bytes_dispose(&reader) == 0);

  REQUIRE(br_read_bytes_init(&reader, directory, writer, "stdout", 0) == 0);
  fail_read = 1;
  EXPECT(br_read_bytes_ready(&reader, 4, 0, 64, &kind, &first) == EIO);
  EXPECT(!reader.held.offered && reader.held.source.buffer.scan == 0 && reader.held.fault == EIO);
  EXPECT(br_read_bytes_dispose(&reader) == 0);
  REQUIRE(br_read_bytes_init(&reader, directory, writer, "stdout", 0) == 0);
  reader.held.serial = UINT64_MAX;
  EXPECT(br_read_bytes_ready(&reader, 0, 0, 64, &kind, &first) == EOVERFLOW);
  EXPECT(reader.held.source.buffer.scan == 0 && !reader.held.offered);
  EXPECT(br_read_bytes_dispose(&reader) == 0);
  EXPECT(br_read_bytes_dispose(&reader) == 0);
  REQUIRE(br_read_bytes_init(&reader, directory, writer, "stdout", 0) == 0);
  EXPECT(br_read_bytes_ready(&reader, (uint64_t)INT64_MAX + 1, 0, 64, &kind, &first) == EOVERFLOW);
  EXPECT(reader.held.fault == EOVERFLOW && !reader.held.offered);
  EXPECT(br_read_bytes_dispose(&reader) == 0);

  int wide = openat(directory, "wide", O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  REQUIRE(wide >= 0);
  uint64_t start = (uint64_t)UINT32_MAX + 7;
  REQUIRE(pwrite(wide, original, 3, (off_t)start) == 3);
  REQUIRE(br_read_bytes_init(&reader, directory, wide, "wide", start) == 0);
  EXPECT(br_read_bytes_ready(&reader, start + 3, 1, 64, &kind, &first) == 0);
  EXPECT(first.start == start && first.next == start + 3 && first.length == 3);
  EXPECT(!memcmp(first.bytes, original, 3));
  EXPECT(br_read_bytes_take(&reader, first.serial, &taken) == 0);
  free(taken.bytes);
  EXPECT(br_read_bytes_dispose(&reader) == 0);
  REQUIRE(close(wide) == 0);
  REQUIRE(close(writer) == 0);
  REQUIRE(close(directory) == 0);
  puts("retained raw byte cases passed");
  return 0;
}
