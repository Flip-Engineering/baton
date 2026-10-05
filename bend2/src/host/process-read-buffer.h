#ifndef BATON_PROCESS_READ_BUFFER_H
#define BATON_PROCESS_READ_BUFFER_H

#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <unistd.h>

/* The attached-reader owner serializes calls and supplies a qualified spool
   extent. A sealed extent means every original byte through end is retained
   and no further append is possible. Native exit alone cannot supply it.
   This buffer has no capability, owner election or readiness registry. */
typedef struct {
  unsigned char *partial;
  size_t length, capacity;
  uint64_t frame_start, scan, observed_end;
  int sealed;
} BrReadBuffer;

typedef struct {
  unsigned char *bytes;
  size_t length;
  uint64_t start, next;
} BrReadFrame;

enum { BR_BUFFER_WAITING, BR_BUFFER_FRAME, BR_BUFFER_EOF };

static inline void br_read_buffer_init(BrReadBuffer *reader, uint64_t cursor) {
  memset(reader, 0, sizeof(*reader));
  reader->frame_start = reader->scan = reader->observed_end = cursor;
}

static inline void br_read_buffer_dispose(BrReadBuffer *reader) {
  free(reader->partial);
  memset(reader, 0, sizeof(*reader));
}

/* Success transfers a frame's allocation to the caller. Waiting retains every
   partial byte and returns no frame or durable interpretation checkpoint.
   Errors retain the accumulated bytes and scan position for diagnosis. */
static inline int br_read_buffer_ready(BrReadBuffer *reader, int spool,
                                      uint64_t end, int sealed,
                                      int *kind, BrReadFrame *frame) {
  _Static_assert(sizeof(off_t) == sizeof(int64_t) && (off_t)-1 < 0,
                 "retained reads require signed 64-bit file offsets");
  memset(frame, 0, sizeof(*frame));
  if (reader->frame_start > reader->scan || reader->scan > end || end > INT64_MAX)
    return EINVAL;
  if (end < reader->observed_end || (reader->sealed && (!sealed || end != reader->observed_end)))
    return EINVAL;
  if (reader->scan - reader->frame_start != reader->length)
    return EINVAL;
  reader->observed_end = end;
  reader->sealed = sealed != 0;
  for (;;) {
    if (reader->scan == end) {
      if (!sealed) { *kind = BR_BUFFER_WAITING; return 0; }
      if (!reader->length) { *kind = BR_BUFFER_EOF; return 0; }
      break;
    }
    unsigned char chunk[8192];
    uint64_t remaining = end - reader->scan;
    size_t wanted = remaining < sizeof(chunk) ? (size_t)remaining : sizeof(chunk);
    ssize_t size = pread(spool, chunk, wanted, (off_t)reader->scan);
    if (size < 0 && errno == EINTR) continue;
    if (size < 0) return errno;
    if (!size) return EIO; /* The supplied retained extent is unavailable. */
    unsigned char *newline = memchr(chunk, '\n', (size_t)size);
    size_t count = newline ? (size_t)(newline - chunk) + 1 : (size_t)size;
    if (count > SIZE_MAX - reader->length) return EOVERFLOW;
    size_t needed = reader->length + count;
    if (needed > reader->capacity) {
      size_t capacity = reader->capacity;
      if (capacity <= SIZE_MAX / 2) capacity *= 2;
      if (capacity < needed) capacity = needed;
      unsigned char *next = realloc(reader->partial, capacity);
      if (!next) return ENOMEM;
      reader->partial = next;
      reader->capacity = capacity;
    }
    memcpy(reader->partial + reader->length, chunk, count);
    reader->length += count;
    reader->scan += count;
    if (newline) break;
  }
  *frame = (BrReadFrame){reader->partial, reader->length, reader->frame_start, reader->scan};
  reader->partial = NULL;
  reader->length = reader->capacity = 0;
  reader->frame_start = reader->scan;
  *kind = BR_BUFFER_FRAME;
  return 0;
}

#endif
