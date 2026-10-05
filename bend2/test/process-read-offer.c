/* Remote controls for the retained allocation between framing and task uptake. */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include "../src/host/process-read-offer.h"

#define EXPECT(condition) do { if (!(condition)) { \
  fprintf(stderr, "failed: %s\n", #condition); return 1; \
} } while (0)
#define REQUIRE(condition) do { if (!(condition)) { \
  fprintf(stderr, "setup failed: %s (errno %d)\n", #condition, errno); return 2; \
} } while (0)

static int pending_contradiction(int directory, int writer, int unseal) {
  BrOfferedReader reader;
  BrFrameOffer first, retry;
  BrReadFrame taken;
  int kind = -1;
  REQUIRE(br_read_offer_init(&reader, directory, writer, "stdout", 0) == 0);
  EXPECT(br_read_offer_ready(&reader, 5, unseal, &kind, &first) == 0);
  EXPECT(kind == BR_BUFFER_FRAME && first.length == 4);
  EXPECT(br_read_offer_ready(&reader, unseal ? 5 : 4, 0, &kind, &retry) == EINVAL);
  EXPECT(reader.fault == EINVAL);
  EXPECT(!retry.bytes && reader.offered && reader.pending.bytes == first.bytes);
  EXPECT(reader.source.buffer.observed_end == 5 && reader.source.buffer.sealed == unseal);
  /* A later consistent observation cannot erase the contradiction. */
  EXPECT(br_read_offer_ready(&reader, 5, unseal, &kind, &retry) == EINVAL);
  EXPECT(!retry.bytes && reader.source.buffer.scan == 4);
  EXPECT(br_read_offer_dispose(&reader) == EBUSY);
  EXPECT(br_read_offer_take(&reader, first.serial, &taken) == 0);
  EXPECT(taken.bytes == first.bytes && taken.length == 4 && reader.fault == EINVAL);
  free(taken.bytes);
  EXPECT(br_read_offer_dispose(&reader) == 0);
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  int directory = open(argv[1], O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  REQUIRE(directory >= 0);
  int writer = openat(directory, "stdout", O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  REQUIRE(writer >= 0);
  const unsigned char bytes[] = {'a', 0, 0xff, '\n', 'z'};
  REQUIRE(pwrite(writer, bytes, sizeof(bytes), 0) == (ssize_t)sizeof(bytes));
  BrOfferedReader reader;
  BrFrameOffer first, retry;
  BrReadFrame taken;
  int kind = -1;
  REQUIRE(br_read_offer_init(&reader, directory, writer, "stdout", 0) == 0);
  EXPECT(br_read_offer_ready(&reader, 5, 0, &kind, &first) == 0);
  EXPECT(kind == BR_BUFFER_FRAME && first.length == 4 && first.start == 0 && first.next == 4);
  EXPECT(first.serial == 1 && !memcmp(first.bytes, bytes, 4));

  /* Model failed conversion/delivery by leaving the offer unaccepted. */
  EXPECT(br_read_offer_ready(&reader, 5, 0, &kind, &retry) == 0);
  EXPECT(retry.serial == first.serial && retry.bytes == first.bytes && retry.next == 4);
  EXPECT(br_read_offer_dispose(&reader) == EBUSY);
  EXPECT(br_read_offer_take(&reader, first.serial + 1, &taken) == ESTALE);
  EXPECT(!taken.bytes && reader.offered && reader.source.buffer.scan == 4);

  /* A source fault preserves the offered allocation for task reconciliation. */
  REQUIRE(renameat(directory, "stdout", directory, "old") == 0);
  EXPECT(br_read_offer_ready(&reader, 5, 0, &kind, &retry) == ENOENT);
  EXPECT(!retry.bytes && reader.pending.bytes == first.bytes && reader.offered);
  REQUIRE(renameat(directory, "old", directory, "stdout") == 0);
  EXPECT(br_read_offer_ready(&reader, 5, 0, &kind, &retry) == ENOENT);
  EXPECT(!retry.bytes && reader.offered && reader.fault == ENOENT);
  EXPECT(br_read_offer_dispose(&reader) == EBUSY);
  EXPECT(br_read_offer_take(&reader, first.serial, &taken) == 0);
  EXPECT(taken.bytes == first.bytes && taken.length == 4 && reader.fault == ENOENT);
  free(taken.bytes);
  EXPECT(br_read_offer_dispose(&reader) == 0);

  /* A fresh fixture reader reconstructs from zero after the faulted reader is
     retired. Production qualification of a replacement is a separate duty. */
  REQUIRE(br_read_offer_init(&reader, directory, writer, "stdout", 0) == 0);
  EXPECT(br_read_offer_ready(&reader, 5, 0, &kind, &first) == 0);
  EXPECT(kind == BR_BUFFER_FRAME && first.length == 4);
  EXPECT(br_read_offer_ready(&reader, 5, 1, &kind, &retry) == 0);
  EXPECT(retry.serial == first.serial && retry.bytes == first.bytes);
  EXPECT(br_read_offer_take(&reader, first.serial, &taken) == 0);
  EXPECT(taken.bytes == first.bytes && taken.length == 4 && taken.start == 0 && taken.next == 4);
  EXPECT(!reader.offered && !reader.pending.bytes);
  free(taken.bytes);
  EXPECT(br_read_offer_take(&reader, first.serial, &taken) == ESTALE);
  EXPECT(!taken.bytes);

  EXPECT(br_read_offer_ready(&reader, 5, 1, &kind, &retry) == 0);
  EXPECT(kind == BR_BUFFER_FRAME && retry.length == 1 && retry.bytes[0] == 'z');
  EXPECT(retry.serial == 2 && retry.start == 4 && retry.next == 5);
  EXPECT(br_read_offer_dispose(&reader) == EBUSY);
  EXPECT(br_read_offer_take(&reader, retry.serial, &taken) == 0);
  EXPECT(taken.length == 1 && taken.bytes[0] == 'z');
  free(taken.bytes);
  EXPECT(br_read_offer_ready(&reader, 5, 1, &kind, &retry) == 0);
  EXPECT(kind == BR_BUFFER_EOF && !retry.bytes && !retry.serial);
  EXPECT(br_read_offer_dispose(&reader) == 0);
  EXPECT(br_read_offer_ready(&reader, 5, 1, &kind, &retry) == EBADF);
  EXPECT(br_read_offer_dispose(&reader) == 0);

  int result = pending_contradiction(directory, writer, 0);
  if (result) return result;
  result = pending_contradiction(directory, writer, 1);
  if (result) return result;

  /* Serial exhaustion refuses before consuming bytes or creating serial zero. */
  REQUIRE(br_read_offer_init(&reader, directory, writer, "stdout", 0) == 0);
  reader.serial = UINT64_MAX;
  EXPECT(br_read_offer_ready(&reader, 5, 0, &kind, &retry) == EOVERFLOW);
  EXPECT(!retry.bytes && !reader.offered && reader.source.buffer.scan == 0);
  EXPECT(br_read_offer_dispose(&reader) == 0);
  REQUIRE(close(writer) == 0);
  REQUIRE(close(directory) == 0);
  puts("retained frame offer cases passed");
  return 0;
}
