#ifndef BATON_PROCESS_READ_SOURCE_H
#define BATON_PROCESS_READ_SOURCE_H

#include <fcntl.h>
#include <sys/stat.h>
#include "process-read-buffer.h"

/* The owner supplies its already-qualified attempt directory and open spool.
   Duplicated descriptors pin those objects until disposal. The owner serializes
   access and retirement and permits only append operations on the original file.
   These checks cannot detect an external same-inode rewrite or truncate/regrow.
   Owner generation, event version and writer finality remain caller duties.
   Calls and file IO run under reader serialization outside the event mutex. */
typedef struct {
  int directory, spool;
  char *name;
  dev_t device;
  ino_t inode;
  BrReadBuffer buffer;
} BrReadSource;

static inline void br_read_source_dispose(BrReadSource *source) {
  if (source->spool >= 0) close(source->spool);
  if (source->directory >= 0) close(source->directory);
  free(source->name);
  br_read_buffer_dispose(&source->buffer);
  source->spool = source->directory = -1;
  source->name = NULL;
}

static inline int br_read_source_validate(BrReadSource *source, uint64_t end,
                                         int sealed) {
  if (source->spool < 0 || source->directory < 0 || !source->name) return EBADF;
  if (end > INT64_MAX) return EOVERFLOW;
  struct stat held, named;
  if (fstat(source->spool, &held)) return errno;
  if (fstatat(source->directory, source->name, &named, AT_SYMLINK_NOFOLLOW)) return errno;
  if (!S_ISREG(held.st_mode) || !S_ISREG(named.st_mode) ||
      held.st_dev != source->device || held.st_ino != source->inode ||
      named.st_dev != source->device || named.st_ino != source->inode) return ESTALE;
  if (held.st_size < 0 || (uint64_t)held.st_size < end ||
      (uint64_t)held.st_size < source->buffer.observed_end) return EIO;
  /* A final extent cannot conceal bytes already present after that boundary. */
  if (sealed && (uint64_t)held.st_size != end) return EIO;
  return 0;
}

/* Initialize fresh storage only. A cursor is a host byte position; supplying it
   does not establish an interpretation checkpoint. Receive starts at zero. */
static inline int br_read_source_init(BrReadSource *source, int directory,
                                     int spool, const char *name, uint64_t cursor) {
  memset(source, 0, sizeof(*source));
  source->directory = source->spool = -1;
  br_read_buffer_init(&source->buffer, cursor);
  if (!name || !*name || strchr(name, '/') || !strcmp(name, ".") || !strcmp(name, ".."))
    return EINVAL;
  if (cursor > INT64_MAX) return EOVERFLOW;
  struct stat original;
  if (fstat(spool, &original)) return errno;
  if (!S_ISREG(original.st_mode)) return EINVAL;
  int flags = fcntl(spool, F_GETFL);
  if (flags < 0) return errno;
  if ((flags & O_ACCMODE) == O_WRONLY) return EBADF;
  source->device = original.st_dev;
  source->inode = original.st_ino;
  source->name = strdup(name);
  int error = source->name ? 0 : ENOMEM;
  if (!error) {
    source->directory = fcntl(directory, F_DUPFD_CLOEXEC, 0);
    if (source->directory < 0) error = errno;
  }
  if (!error) {
    source->spool = fcntl(spool, F_DUPFD_CLOEXEC, 0);
    if (source->spool < 0) error = errno;
  }
  if (!error) error = br_read_source_validate(source, cursor, 0);
  if (error) br_read_source_dispose(source);
  return error;
}

/* Validate even when the buffer can emit a tail or EOF without pread. On a
   validation failure no buffered byte, offset or finality state is changed.
   A Frame transfers its allocation to the wrapper, which must retain an offer
   through failed conversion or delivery. This function does not settle it. */
static inline int br_read_source_ready(BrReadSource *source, uint64_t end,
                                      int sealed, int *kind, BrReadFrame *frame) {
  memset(frame, 0, sizeof(*frame));
  int error = br_read_source_validate(source, end, sealed);
  if (error) return error;
  return br_read_buffer_ready(&source->buffer, source->spool, end, sealed, kind, frame);
}

#endif
