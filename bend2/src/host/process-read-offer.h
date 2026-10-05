#ifndef BATON_PROCESS_READ_OFFER_H
#define BATON_PROCESS_READ_OFFER_H

#include "process-read-source.h"

/* This object belongs to one attached reader incarnation. The capability
   registry validates that incarnation and serializes access and retirement.
   Source IO and conversion occur outside the shared event mutex. */
typedef struct {
  BrReadSource source;
  BrReadFrame pending;
  uint64_t serial;
  int offered, fault;
} BrOfferedReader;

/* Bytes are borrowed until take succeeds. A retry observes the same allocation
   and range. The serial is reader-local and requires the enclosing capability
   incarnation; it is neither an event revision nor an interpretation cursor. */
typedef struct {
  const unsigned char *bytes;
  size_t length;
  uint64_t start, next, serial;
} BrFrameOffer;

static inline int br_read_offer_init(BrOfferedReader *reader, int directory,
                                    int spool, const char *name, uint64_t cursor) {
  memset(reader, 0, sizeof(*reader));
  return br_read_source_init(&reader->source, directory, spool, name, cursor);
}

static inline int br_read_offer_ready(BrOfferedReader *reader, uint64_t end,
                                     int sealed, int *kind, BrFrameOffer *offer) {
  memset(offer, 0, sizeof(*offer));
  if (reader->fault) return reader->fault;
  int error = br_read_source_validate(&reader->source, end, sealed);
  if (error) { reader->fault = error; return error; }
  if (reader->offered) {
    BrReadBuffer *buffer = &reader->source.buffer;
    if (end < buffer->observed_end ||
        (buffer->sealed && (!sealed || end != buffer->observed_end))) return EINVAL;
    /* Record new extent/finality evidence without reading the next frame. */
    buffer->observed_end = end;
    buffer->sealed = sealed != 0;
  }
  if (!reader->offered) {
    /* Refuse reuse before the core advances or hands over an allocation. */
    if (reader->serial == UINT64_MAX) return EOVERFLOW;
    error = br_read_source_ready(&reader->source, end, sealed, kind, &reader->pending);
    if (error) {
      if (error != ENOMEM) reader->fault = error;
      return error;
    }
    if (*kind != BR_BUFFER_FRAME) return 0;
    reader->serial++;
    reader->offered = 1;
  }
  *kind = BR_BUFFER_FRAME;
  *offer = (BrFrameOffer){reader->pending.bytes, reader->pending.length,
                         reader->pending.start, reader->pending.next, reader->serial};
  return 0;
}

/* The retained task invokes take after arranging ownership of this allocation.
   A conversion failure or client disconnect performs no take. Success transfers
   the complete frame to that task, which must free it after its duties end.
   Transfer does not advance a durable interpretation/effect checkpoint. A
   retained source fault stays latched; take may move its bytes to the failure
   task, and does not qualify them for interpretation. Matching stat results on
   a later call cannot clear that fault. Reconstruction is an owner operation
   under a new qualified reader incarnation. */
static inline int br_read_offer_take(BrOfferedReader *reader, uint64_t serial,
                                    BrReadFrame *frame) {
  memset(frame, 0, sizeof(*frame));
  if (!reader->offered || !serial || serial != reader->serial) return ESTALE;
  *frame = reader->pending;
  memset(&reader->pending, 0, sizeof(reader->pending));
  reader->offered = 0;
  return 0;
}

/* Quiescent disposal requires the registry to have retired all reader/event
   references. Pending offers must first transfer to a retained task, including
   a task retaining cancellation or read-failure duties. */
static inline int br_read_offer_dispose(BrOfferedReader *reader) {
  if (reader->offered) return EBUSY;
  br_read_source_dispose(&reader->source);
  return 0;
}

#endif
