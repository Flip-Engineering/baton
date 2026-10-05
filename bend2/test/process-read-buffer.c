/* Remote fixture for the raw buffer helper. Capability validation, concurrent
   owner events, attachment and public Receive remain separate controls. */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdlib.h>
static int fail_allocation;
static void *fixture_realloc(void *bytes, size_t length) {
  if (fail_allocation) return NULL;
  return realloc(bytes, length);
}
#define realloc fixture_realloc
#include "../src/host/process-read-buffer.h"
#undef realloc

static int failures;
#define EXPECT(condition) do { if (!(condition)) { \
  fprintf(stderr, "failed: %s\n", #condition); failures++; \
} } while (0)

static void frame_equals(BrReadFrame *frame, const void *bytes, size_t length,
                         uint64_t start, uint64_t next) {
  EXPECT(frame->length == length);
  EXPECT(frame->start == start);
  EXPECT(frame->next == next);
  if (frame->length == length) EXPECT(!memcmp(frame->bytes, bytes, length));
  free(frame->bytes);
  memset(frame, 0, sizeof(*frame));
}

int main(void) {
  FILE *file = tmpfile();
  if (!file) { perror("tmpfile"); return 2; }
  int fd = fileno(file), kind = -1;
  BrReadBuffer reader;
  BrReadFrame frame;
  br_read_buffer_init(&reader, 0);

  EXPECT(br_read_buffer_ready(&reader, fd, 0, 0, &kind, &frame) == 0);
  EXPECT(kind == BR_BUFFER_WAITING && !frame.bytes && !frame.length);
  const unsigned char partial[] = {'a', 0, 0xff};
  if (pwrite(fd, partial, sizeof(partial), 0) != (ssize_t)sizeof(partial)) return 2;
  EXPECT(br_read_buffer_ready(&reader, fd, 3, 0, &kind, &frame) == 0);
  EXPECT(kind == BR_BUFFER_WAITING && !frame.bytes && !frame.length);
  EXPECT(reader.frame_start == 0 && reader.scan == 3 && reader.length == 3);
  EXPECT(br_read_buffer_ready(&reader, fd, 3, 0, &kind, &frame) == 0);
  EXPECT(kind == BR_BUFFER_WAITING && reader.length == 3);

  const unsigned char rest[] = {'\n', '\n', 'z'};
  if (pwrite(fd, rest, sizeof(rest), 3) != (ssize_t)sizeof(rest)) return 2;
  fail_allocation = 1;
  EXPECT(br_read_buffer_ready(&reader, fd, 6, 0, &kind, &frame) == ENOMEM);
  EXPECT(reader.scan == 3 && reader.frame_start == 0 && reader.length == 3);
  EXPECT(!memcmp(reader.partial, partial, sizeof(partial)));
  fail_allocation = 0;
  EXPECT(br_read_buffer_ready(&reader, fd, 6, 0, &kind, &frame) == 0);
  EXPECT(kind == BR_BUFFER_FRAME);
  const unsigned char first[] = {'a', 0, 0xff, '\n'};
  frame_equals(&frame, first, sizeof(first), 0, 4);
  EXPECT(br_read_buffer_ready(&reader, fd, 6, 0, &kind, &frame) == 0);
  EXPECT(kind == BR_BUFFER_FRAME);
  frame_equals(&frame, "\n", 1, 4, 5);
  EXPECT(br_read_buffer_ready(&reader, fd, 6, 0, &kind, &frame) == 0);
  EXPECT(kind == BR_BUFFER_WAITING && !frame.bytes && reader.length == 1);
  EXPECT(br_read_buffer_ready(&reader, fd, 6, 1, &kind, &frame) == 0);
  EXPECT(kind == BR_BUFFER_FRAME);
  frame_equals(&frame, "z", 1, 5, 6);
  EXPECT(br_read_buffer_ready(&reader, fd, 6, 1, &kind, &frame) == 0);
  EXPECT(kind == BR_BUFFER_EOF && !frame.bytes && !frame.length);

  /* A truncated or contradictory extent cannot become EOF or Waiting. */
  EXPECT(br_read_buffer_ready(&reader, fd, 7, 1, &kind, &frame) == EINVAL);
  EXPECT(br_read_buffer_ready(&reader, fd, 6, 0, &kind, &frame) == EINVAL);
  EXPECT(br_read_buffer_ready(&reader, fd, 5, 1, &kind, &frame) == EINVAL);
  EXPECT(br_read_buffer_ready(&reader, fd, UINT64_MAX, 0, &kind, &frame) == EINVAL);
  br_read_buffer_dispose(&reader);

  /* Reconstructing from a recorded cursor uses the original byte range. */
  br_read_buffer_init(&reader, 4);
  EXPECT(br_read_buffer_ready(&reader, fd, 6, 1, &kind, &frame) == 0);
  EXPECT(kind == BR_BUFFER_FRAME);
  frame_equals(&frame, "\n", 1, 4, 5);
  EXPECT(br_read_buffer_ready(&reader, -1, 6, 1, &kind, &frame) == EBADF);
  EXPECT(reader.scan == 5 && reader.frame_start == 5 && !reader.length);
  br_read_buffer_dispose(&reader);
  br_read_buffer_init(&reader, 6);
  EXPECT(br_read_buffer_ready(&reader, fd, 7, 1, &kind, &frame) == EIO);
  br_read_buffer_dispose(&reader);

  unsigned char long_line[16385];
  memset(long_line, 'x', sizeof(long_line));
  long_line[sizeof(long_line) - 1] = '\n';
  if (ftruncate(fd, 0) || pwrite(fd, long_line, sizeof(long_line), 0) != (ssize_t)sizeof(long_line))
    return 2;
  br_read_buffer_init(&reader, 0);
  EXPECT(br_read_buffer_ready(&reader, fd, 16384, 0, &kind, &frame) == 0);
  EXPECT(kind == BR_BUFFER_WAITING && reader.length == 16384 && !frame.bytes);
  EXPECT(br_read_buffer_ready(&reader, fd, 16385, 1, &kind, &frame) == 0);
  EXPECT(kind == BR_BUFFER_FRAME);
  frame_equals(&frame, long_line, sizeof(long_line), 0, sizeof(long_line));
  EXPECT(br_read_buffer_ready(&reader, fd, 16385, 1, &kind, &frame) == 0);
  EXPECT(kind == BR_BUFFER_EOF && !frame.bytes);
  br_read_buffer_dispose(&reader);
  if (fclose(file)) { perror("fclose"); return 2; }
  if (!failures) puts("raw retained buffer cases passed");
  return failures ? 1 : 0;
}
