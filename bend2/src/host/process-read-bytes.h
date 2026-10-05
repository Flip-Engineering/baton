#ifndef BATON_PROCESS_READ_BYTES_H
#define BATON_PROCESS_READ_BYTES_H

#include <limits.h>
#include "process-read-offer.h"

/* Internal raw reader over an already qualified, append-only source. Its owner
   serializes observations, reads, take and retirement under one incarnation.
   BrOfferedReader supplies allocation transfer and cleanup. Its frame scanner
   must never be invoked on this object's storage. No runtime registry is here. */
typedef struct { BrOfferedReader held; } BrByteReader;
enum { BR_BYTES_WAITING, BR_BYTES_OFFER, BR_BYTES_END };

static inline int br_read_bytes_init(BrByteReader *reader, int directory,
                                    int spool, const char *name, uint64_t cursor) {
  return br_read_offer_init(&reader->held, directory, spool, name, cursor);
}

/* capacity bounds one transfer, never the complete requested interval. end and
   sealed are current owner-qualified observations. Pending bytes remain stable
   across retries even when capacity changes. Open byte tails are readable.
   An error returns no borrowed offer; retained pending storage and serial stay
   available to the responsible failure task through held and exact take. */
static inline int br_read_bytes_ready(BrByteReader *reader, uint64_t end,
                                     int sealed, size_t capacity, int *kind,
                                     BrFrameOffer *offer) {
  _Static_assert(sizeof(off_t) == sizeof(int64_t) && (off_t)-1 < 0,
                 "raw reads require signed 64-bit file offsets");
  memset(offer, 0, sizeof(*offer));
  *kind = -1;
  BrOfferedReader *held = &reader->held;
  BrReadBuffer *state = &held->source.buffer;
  if (held->fault) return held->fault;
  if (!capacity || capacity > (size_t)SSIZE_MAX) return EINVAL;
  int error = br_read_source_validate(&held->source, end, sealed);
  if (!error && (state->scan > end || end < state->observed_end ||
      (state->sealed && (!sealed || end != state->observed_end)))) error = EINVAL;
  if (error) { held->fault = error; return error; }
  if (!held->offered && held->serial == UINT64_MAX) return EOVERFLOW;
  state->observed_end = end;
  state->sealed = sealed != 0;
  if (!held->offered) {
    if (state->scan == end) {
      *kind = sealed ? BR_BYTES_END : BR_BYTES_WAITING;
      return 0;
    }
    uint64_t remaining = end - state->scan;
    size_t wanted = remaining < capacity ? (size_t)remaining : capacity;
    unsigned char *bytes = malloc(wanted);
    if (!bytes) return ENOMEM;
    ssize_t size;
    do {
      size = pread(held->source.spool, bytes, wanted, (off_t)state->scan);
    } while (size < 0 && errno == EINTR);
    if (size <= 0) {
      error = size < 0 ? errno : EIO;
      free(bytes);
      held->fault = error;
      return error;
    }
    uint64_t start = state->scan;
    state->scan += (uint64_t)size;
    state->frame_start = state->scan;
    held->pending = (BrReadFrame){bytes, (size_t)size, start, state->scan};
    held->serial++;
    held->offered = 1;
    /* A newly detected source fault retains bytes for failure-task adoption. */
    error = br_read_source_validate(&held->source, end, sealed);
    if (error) { held->fault = error; return error; }
  }
  *kind = BR_BYTES_OFFER;
  *offer = (BrFrameOffer){held->pending.bytes, held->pending.length,
                        held->pending.start, held->pending.next, held->serial};
  return 0;
}

/* Same empty-output, exact-serial and failure-task rules as frame offers. The
   owner adopts allocation, correlation and fault together before taking it. */
static inline int br_read_bytes_take(BrByteReader *reader, uint64_t serial,
                                    BrReadFrame *bytes) {
  return br_read_offer_take(&reader->held, serial, bytes);
}

/* The actual registry must first retire references and outstanding borrowers.
   Cleanup outcomes remain in held.source.cleanup, including uncertain closes. */
static inline int br_read_bytes_dispose(BrByteReader *reader) {
  return br_read_offer_dispose(&reader->held);
}

#endif
