#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

typedef struct {
  char *path, *text;
  size_t length;
  int error, append;
} BatonRead;

static void baton_read_call(IoWork *w) {
  BatonRead *call = (BatonRead *)w->data;
  if (call->append) {
    FILE *file=fopen(call->path,"ab");
    if(!file) {call->error=errno;return;}
    if(fwrite(call->text,1,call->length,file)!=call->length) call->error=errno?errno:EIO;
    if(fclose(file) && !call->error) call->error=errno;
    return;
  }
  FILE *file = strcmp(call->path, "-") == 0 ? stdin : fopen(call->path, "rb");
  if (!file) { call->error = errno; return; }
  size_t capacity = 4096;
  call->text = malloc(capacity);
  if (!call->text) { call->error = ENOMEM; goto close_file; }
  for (;;) {
    if (call->length == capacity) {
      if (capacity > SIZE_MAX / 2) { call->error = ENOMEM; break; }
      capacity *= 2;
      char *next = realloc(call->text, capacity);
      if (!next) { call->error = ENOMEM; break; }
      call->text = next;
    }
    size_t count = fread(call->text + call->length, 1, capacity - call->length, file);
    call->length += count;
    if (!count) {
      if (ferror(file)) call->error = errno ? errno : EIO;
      break;
    }
  }
close_file:
  if (file != stdin && fclose(file) != 0 && !call->error) call->error = errno;
}

static Term baton_read_pack(Env e, IoWork *w) {
  BatonRead *call = (BatonRead *)w->data;
  Term result = call->error ? io_fail(e, call->error, NULL)
    : io_done(e, call->append ? term_pak(CID_UNIT,0) : io_str(e, call->text, call->length));
  free(call->path); free(call->text); free(call);
  w->data = NULL;
  return result;
}

#ifdef CID_TEXT_READ
static Term baton_read_run(Env e, Term *f, IoWork *w) {
  BatonRead *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  u64 length = 0;
  call->path = io_cstr(e, f[0], &length);
  if (strlen(call->path) != length) {
    free(call->path); free(call);
    return io_fail(e, EINVAL, "path contains NUL");
  }
  w->data = (char *)call;
  return io_work(w, baton_read_call, baton_read_pack);
}
static void __attribute__((constructor)) baton_read_use(void) {
  io_eff(CID_TEXT_READ, baton_read_run, 0);
}
#endif

#ifdef CID_TEXT_WRITE_AT
typedef struct {
  char *path, *text, *position;
  size_t length;
  uint64_t next;
  int error, finish;
} BatonWriteAt;

static void baton_write_at_call(IoWork *work) {
  BatonWriteAt *call = (BatonWriteAt *)work->data;
  int fd = open(call->path, O_CREAT | O_RDWR, 0600);
  if (fd < 0) { call->error = errno; return; }
  if (flock(fd, LOCK_EX)) { call->error = errno; goto close_file; }
  struct stat info;
  if (fstat(fd, &info)) { call->error = errno; goto close_file; }
  uint64_t position = (uint64_t)info.st_size;
  if (*call->position) {
    position = 0;
    for (const unsigned char *digit = (unsigned char *)call->position; *digit; digit++) {
      if (*digit < '0' || *digit > '9') { call->error = EINVAL; goto close_file; }
      unsigned value = *digit - '0';
      if (position > (UINT64_MAX - value) / 10) { call->error = EOVERFLOW; goto close_file; }
      position = position * 10 + value;
    }
  }
  if (call->length > UINT64_MAX - position) { call->error = EOVERFLOW; goto close_file; }
  call->next = position + call->length;
  if ((off_t)call->next < 0 || (uint64_t)(off_t)call->next != call->next) {
    call->error = EOVERFLOW; goto close_file;
  }

  /* Compare only this write's existing range. A replay or partial append keeps
     its matching prefix; a changed projection replaces its ordinary bytes. */
  size_t same = 0;
  uint64_t available = position < (uint64_t)info.st_size ? (uint64_t)info.st_size - position : 0;
  size_t overlap = available < call->length ? (size_t)available : call->length;
  char buffer[8192];
  while (same < overlap) {
    size_t wanted = overlap - same;
    if (wanted > sizeof(buffer)) wanted = sizeof(buffer);
    ssize_t count = pread(fd, buffer, wanted, (off_t)(position + same));
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) { call->error = count < 0 ? errno : EIO; goto close_file; }
    size_t equal = 0;
    while (equal < (size_t)count && buffer[equal] == call->text[same + equal]) equal++;
    same += equal;
    if (equal != (size_t)count) break;
  }
  while (same < call->length) {
    ssize_t count = pwrite(fd, call->text + same, call->length - same, (off_t)(position + same));
    if (count > 0) same += (size_t)count;
    else if (count < 0 && errno == EINTR) continue;
    else { call->error = count < 0 ? errno : EIO; goto close_file; }
  }
  if (call->finish && ftruncate(fd, (off_t)call->next)) call->error = errno;
close_file:
  if (close(fd) && !call->error) call->error = errno;
}

static Term baton_write_at_pack(Env environment, IoWork *work) {
  BatonWriteAt *call = (BatonWriteAt *)work->data;
  char position[32];
  int length = snprintf(position, sizeof(position), "%llu", (unsigned long long)call->next);
  Term result = call->error ? io_fail(environment, call->error, "Could not write file at output position.")
    : io_done(environment, io_str(environment, position, (size_t)length));
  free(call->path); free(call->position); free(call->text); free(call);
  work->data = NULL;
  return result;
}

static Term baton_write_at_run(Env environment, Term *arguments, IoWork *work) {
  BatonWriteAt *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(environment, ENOMEM, NULL);
  u64 path_length = 0, position_length = 0, text_length = 0;
  call->path = io_cstr(environment, arguments[0], &path_length);
  call->position = io_cstr(environment, arguments[1], &position_length);
  call->text = io_cstr(environment, arguments[2], &text_length);
  call->length = text_length;
  call->finish = (u32)arguments[3] != 0;
  work->data = (char *)call;
  if (strlen(call->path) != path_length || strlen(call->position) != position_length) {
    call->error = EINVAL;
    return baton_write_at_pack(environment, work);
  }
  return io_work(work, baton_write_at_call, baton_write_at_pack);
}

static void __attribute__((constructor)) baton_write_at_use(void) {
  io_eff(CID_TEXT_WRITE_AT, baton_write_at_run, 0);
}
#endif

#ifdef CID_TEXT_READ_SPAN
typedef struct {
  char *path, *text;
  size_t length;
  uint64_t offset, count;
  int error;
} BatonReadSpan;

static int baton_text_span_u64(const char *digits, uint64_t *value) {
  if (!digits || !*digits) return EINVAL;
  uint64_t n = 0;
  for (const unsigned char *at = (const unsigned char *)digits; *at; at++) {
    if (*at < '0' || *at > '9') return EINVAL;
    unsigned digit = (unsigned)(*at - '0');
    if (n > (UINT64_MAX - digit) / 10) return EOVERFLOW;
    n = n * 10 + digit;
  }
  *value = n;
  return 0;
}

static void baton_read_span_call(IoWork *w) {
  BatonReadSpan *call = (BatonReadSpan *)w->data;
  if (call->count > SIZE_MAX - 1) { call->error = EOVERFLOW; return; }
  int fd = open(call->path, O_RDONLY | O_CLOEXEC);
  if (fd < 0) { call->error = errno; return; }
  struct stat info;
  if (fstat(fd, &info)) { call->error = errno; goto close_file; }
  uint64_t size = info.st_size < 0 ? 0 : (uint64_t)info.st_size;
  if (call->offset > size || call->count > size - call->offset) { call->error = EINVAL; goto close_file; }
  call->text = malloc((size_t)call->count + 1);
  if (!call->text) { call->error = ENOMEM; goto close_file; }
  while (call->length < (size_t)call->count) {
    ssize_t n = pread(fd, call->text + call->length, (size_t)call->count - call->length,
                      (off_t)(call->offset + call->length));
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) { call->error = n < 0 ? errno : EIO; break; }
    call->length += (size_t)n;
  }
  call->text[call->length] = 0;
close_file:
  if (close(fd) && !call->error) call->error = errno;
}

static Term baton_read_span_pack(Env e, IoWork *w) {
  BatonReadSpan *call = (BatonReadSpan *)w->data;
  Term result = call->error ? io_fail(e, call->error, "Could not read file byte range.")
    : io_done(e, io_str(e, call->text ? call->text : "", call->length));
  free(call->path); free(call->text); free(call);
  w->data = NULL;
  return result;
}

static Term baton_read_span_run(Env e, Term *f, IoWork *w) {
  BatonReadSpan *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  u64 path_n = 0, offset_n = 0, count_n = 0;
  call->path = io_cstr(e, f[0], &path_n);
  char *offset_text = io_cstr(e, f[1], &offset_n);
  char *count_text = io_cstr(e, f[2], &count_n);
  if (!call->path || !offset_text || !count_text || strlen(call->path) != path_n ||
      strlen(offset_text) != offset_n || strlen(count_text) != count_n) {
    call->error = EINVAL;
  } else {
    call->error = baton_text_span_u64(offset_text, &call->offset);
    if (!call->error) call->error = baton_text_span_u64(count_text, &call->count);
  }
  free(offset_text); free(count_text);
  w->data = (char *)call;
  if (call->error) return baton_read_span_pack(e, w);
  return io_work(w, baton_read_span_call, baton_read_span_pack);
}

static void __attribute__((constructor)) baton_read_span_use(void) {
  io_eff(CID_TEXT_READ_SPAN, baton_read_span_run, 0);
}
#endif

#ifdef CID_TEXT_WRITE_SPAN_AT
typedef struct {
  char *path, *spool, *position;
  uint64_t offset, count, next;
  int error, finish;
} BatonWriteSpanAt;

static void baton_write_span_at_call(IoWork *w) {
  BatonWriteSpanAt *call = (BatonWriteSpanAt *)w->data;
  int fd = open(call->path, O_CREAT | O_RDWR, 0600);
  if (fd < 0) { call->error = errno; return; }
  int spool = -1;
  if (flock(fd, LOCK_EX)) { call->error = errno; goto close_files; }
  struct stat info;
  if (fstat(fd, &info)) { call->error = errno; goto close_files; }
  uint64_t size = info.st_size < 0 ? 0 : (uint64_t)info.st_size;
  uint64_t position = size;
  if (*call->position) {
    int parsed = baton_text_span_u64(call->position, &position);
    if (parsed) { call->error = parsed; goto close_files; }
  }
  if (call->count > UINT64_MAX - position) { call->error = EOVERFLOW; goto close_files; }
  call->next = position + call->count;
  if ((off_t)call->next < 0 || (uint64_t)(off_t)call->next != call->next) { call->error = EOVERFLOW; goto close_files; }
  spool = open(call->spool, O_RDONLY | O_CLOEXEC);
  if (spool < 0) { call->error = errno; goto close_files; }
  struct stat spool_info;
  if (fstat(spool, &spool_info)) { call->error = errno; goto close_files; }
  uint64_t spool_size = spool_info.st_size < 0 ? 0 : (uint64_t)spool_info.st_size;
  if (call->offset > spool_size || call->count > spool_size - call->offset) { call->error = EINVAL; goto close_files; }
  uint64_t available = position < size ? size - position : 0;
  uint64_t overlap = available < call->count ? available : call->count;
  uint64_t same = 0;
  char existing[8192], staged[8192];
  while (same < overlap) {
    size_t wanted = (size_t)(overlap - same);
    if (wanted > sizeof(existing)) wanted = sizeof(existing);
    ssize_t got = pread(fd, existing, wanted, (off_t)(position + same));
    if (got < 0 && errno == EINTR) continue;
    if (got <= 0) { call->error = got < 0 ? errno : EIO; goto close_files; }
    ssize_t loaded = pread(spool, staged, (size_t)got, (off_t)(call->offset + same));
    if (loaded < 0 && errno == EINTR) continue;
    if (loaded != got) { call->error = loaded < 0 ? errno : EIO; goto close_files; }
    size_t equal = 0;
    while (equal < (size_t)got && existing[equal] == staged[equal]) equal++;
    same += equal;
    if (equal != (size_t)got) break;
  }
  while (same < call->count) {
    size_t wanted = (size_t)(call->count - same);
    if (wanted > sizeof(staged)) wanted = sizeof(staged);
    ssize_t loaded = pread(spool, staged, wanted, (off_t)(call->offset + same));
    if (loaded < 0 && errno == EINTR) continue;
    if (loaded <= 0) { call->error = loaded < 0 ? errno : EIO; goto close_files; }
    size_t written = 0;
    while (written < (size_t)loaded) {
      ssize_t count = pwrite(fd, staged + written, (size_t)loaded - written, (off_t)(position + same + written));
      if (count > 0) written += (size_t)count;
      else if (count < 0 && errno == EINTR) continue;
      else { call->error = count < 0 ? errno : EIO; goto close_files; }
    }
    same += (size_t)loaded;
  }
  if (call->finish && ftruncate(fd, (off_t)call->next)) call->error = errno;
close_files:
  if (spool >= 0 && close(spool) && !call->error) call->error = errno;
  if (close(fd) && !call->error) call->error = errno;
}

static Term baton_write_span_at_pack(Env e, IoWork *w) {
  BatonWriteSpanAt *call = (BatonWriteSpanAt *)w->data;
  char position[32];
  int length = snprintf(position, sizeof(position), "%llu", (unsigned long long)call->next);
  Term result = call->error ? io_fail(e, call->error, "Could not write file byte range at output position.")
    : io_done(e, io_str(e, position, (size_t)length));
  free(call->path); free(call->spool); free(call->position); free(call);
  w->data = NULL;
  return result;
}

static Term baton_write_span_at_run(Env e, Term *f, IoWork *w) {
  BatonWriteSpanAt *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  u64 path_n = 0, spool_n = 0, position_n = 0, offset_n = 0, count_n = 0;
  call->path = io_cstr(e, f[0], &path_n);
  call->spool = io_cstr(e, f[1], &spool_n);
  call->position = io_cstr(e, f[2], &position_n);
  char *offset_text = io_cstr(e, f[3], &offset_n);
  char *count_text = io_cstr(e, f[4], &count_n);
  call->finish = (u32)f[5] != 0;
  if (!call->path || !call->spool || !call->position || !offset_text || !count_text ||
      strlen(call->path) != path_n || strlen(call->spool) != spool_n ||
      strlen(call->position) != position_n || strlen(offset_text) != offset_n || strlen(count_text) != count_n) {
    call->error = EINVAL;
  } else {
    call->error = baton_text_span_u64(offset_text, &call->offset);
    if (!call->error) call->error = baton_text_span_u64(count_text, &call->count);
  }
  free(offset_text); free(count_text);
  w->data = (char *)call;
  if (call->error) return baton_write_span_at_pack(e, w);
  return io_work(w, baton_write_span_at_call, baton_write_span_at_pack);
}

static void __attribute__((constructor)) baton_write_span_at_use(void) {
  io_eff(CID_TEXT_WRITE_SPAN_AT, baton_write_span_at_run, 0);
}
#endif

#ifdef CID_TEXT_WRITE_BATCH_AT
static int baton_batch_u64(const char *digits, uint64_t *value) {
  if (!digits || !*digits) return EINVAL;
  uint64_t n = 0;
  for (const unsigned char *at = (const unsigned char *)digits; *at; at++) {
    if (*at < '0' || *at > '9') return EINVAL;
    unsigned digit = (unsigned)(*at - '0');
    if (n > (UINT64_MAX - digit) / 10) return EOVERFLOW;
    n = n * 10 + digit;
  }
  *value = n;
  return 0;
}
typedef struct {
  char *path, *plan, *position;
  size_t length;
  uint64_t next;
  int error, finish;
} BatonWriteBatch;

static int batch_position(const char *digits, uint64_t fallback, uint64_t *value) {
  if (!digits || !*digits) { *value = fallback; return 0; }
  return baton_batch_u64(digits, value);
}

static int batch_write_bytes(int fd, uint64_t *position, uint64_t size, const char *bytes, size_t length) {
  if (length > UINT64_MAX - *position) return EOVERFLOW;
  uint64_t available = *position < size ? size - *position : 0;
  uint64_t overlap = available < length ? available : (uint64_t)length;
  uint64_t same = 0;
  char existing[8192];
  while (same < overlap) {
    size_t wanted = (size_t)(overlap - same);
    if (wanted > sizeof(existing)) wanted = sizeof(existing);
    ssize_t got = pread(fd, existing, wanted, (off_t)(*position + same));
    if (got < 0 && errno == EINTR) continue;
    if (got <= 0) return got < 0 ? errno : EIO;
    size_t equal = 0;
    while (equal < (size_t)got && existing[equal] == bytes[same + equal]) equal++;
    same += equal;
    if (equal != (size_t)got) break;
  }
  while (same < length) {
    ssize_t count = pwrite(fd, bytes + same, length - same, (off_t)(*position + same));
    if (count > 0) same += (size_t)count;
    else if (count < 0 && errno == EINTR) continue;
    else return count < 0 ? errno : EIO;
  }
  *position += length;
  return 0;
}

static int batch_write_spool(int fd, int spool, uint64_t *position, uint64_t size, uint64_t offset, uint64_t length) {
  if (length > UINT64_MAX - *position) return EOVERFLOW;
  uint64_t available = *position < size ? size - *position : 0;
  uint64_t overlap = available < length ? available : length;
  uint64_t same = 0;
  char existing[8192], staged[8192];
  while (same < overlap) {
    size_t wanted = (size_t)(overlap - same);
    if (wanted > sizeof(existing)) wanted = sizeof(existing);
    ssize_t got = pread(fd, existing, wanted, (off_t)(*position + same));
    if (got < 0 && errno == EINTR) continue;
    if (got <= 0) return got < 0 ? errno : EIO;
    ssize_t loaded = pread(spool, staged, (size_t)got, (off_t)(offset + same));
    if (loaded < 0 && errno == EINTR) continue;
    if (loaded != got) return loaded < 0 ? errno : EIO;
    size_t equal = 0;
    while (equal < (size_t)got && existing[equal] == staged[equal]) equal++;
    same += equal;
    if (equal != (size_t)got) break;
  }
  while (same < length) {
    size_t wanted = (size_t)(length - same);
    if (wanted > sizeof(staged)) wanted = sizeof(staged);
    ssize_t loaded = pread(spool, staged, wanted, (off_t)(offset + same));
    if (loaded < 0 && errno == EINTR) continue;
    if (loaded <= 0) return loaded < 0 ? errno : EIO;
    uint64_t moved = 0;
    while (moved < (uint64_t)loaded) {
      ssize_t count = pwrite(fd, staged + moved, (size_t)loaded - (size_t)moved, (off_t)(*position + same + moved));
      if (count > 0) moved += (uint64_t)count;
      else if (count < 0 && errno == EINTR) continue;
      else return count < 0 ? errno : EIO;
    }
    same += (uint64_t)loaded;
  }
  *position += length;
  return 0;
}

/* Each plan record is one line and its terminating newline is supplied here.
   A record that begins with the unit separator names a spool byte range; every
   other record is written verbatim. The plan carries raw text lines, so a large
   cumulative snapshot crosses as its small token, never as a Bend String. */
static void baton_write_batch_call(IoWork *w) {
  BatonWriteBatch *call = (BatonWriteBatch *)w->data;
  int fd = open(call->path, O_CREAT | O_RDWR, 0600);
  if (fd < 0) { call->error = errno; return; }
  if (flock(fd, LOCK_EX)) { call->error = errno; goto close_target; }
  struct stat info;
  if (fstat(fd, &info)) { call->error = errno; goto close_target; }
  uint64_t size = info.st_size < 0 ? 0 : (uint64_t)info.st_size;
  uint64_t position = size;
  int parsed = batch_position(call->position, size, &position);
  if (parsed) { call->error = parsed; goto close_target; }
  const char *at = call->plan;
  size_t remaining = call->length;
  while (!call->error && remaining) {
    const char *newline = memchr(at, '\n', remaining);
    size_t record = newline ? (size_t)(newline - at) : remaining;
    int spool = -1;
    if (record && (unsigned char)at[0] == 30) {
      const char *second = memchr(at + 1, 30, record - 1);
      const char *colon = second ? memchr(second + 1, ':', record - (size_t)(second + 1 - at)) : NULL;
      if (!second || !colon) { call->error = EINVAL; goto close_target; }
      size_t spool_length = (size_t)(second - (at + 1));
      char *spool_path = malloc(spool_length + 1);
      if (!spool_path) { call->error = ENOMEM; goto close_target; }
      memcpy(spool_path, at + 1, spool_length);
      spool_path[spool_length] = 0;
      char *offset_text = malloc((size_t)(colon - (second + 1)) + 1);
      char *length_text = malloc((size_t)(at + record - (colon + 1)) + 1);
      if (!offset_text || !length_text) {
        free(spool_path); free(offset_text); free(length_text);
        call->error = ENOMEM; goto close_target;
      }
      memcpy(offset_text, second + 1, (size_t)(colon - (second + 1)));
      offset_text[colon - (second + 1)] = 0;
      size_t length_digits = (size_t)(at + record - (colon + 1));
      memcpy(length_text, colon + 1, length_digits);
      length_text[length_digits] = 0;
      uint64_t offset = 0, span_length = 0;
      call->error = baton_batch_u64(offset_text, &offset);
      if (!call->error) call->error = baton_batch_u64(length_text, &span_length);
      free(offset_text); free(length_text);
      if (call->error) { free(spool_path); goto close_target; }
      spool = open(spool_path, O_RDONLY | O_CLOEXEC);
      free(spool_path);
      if (spool < 0) { call->error = errno; goto close_target; }
      struct stat spool_info;
      if (fstat(spool, &spool_info) || !S_ISREG(spool_info.st_mode)) { call->error = errno ? errno : EINVAL; goto close_spool; }
      uint64_t spool_size = spool_info.st_size < 0 ? 0 : (uint64_t)spool_info.st_size;
      if (offset > spool_size || span_length > spool_size - offset) { call->error = EINVAL; goto close_spool; }
      call->error = batch_write_spool(fd, spool, &position, size, offset, span_length);
close_spool:
      if (close(spool) && !call->error) call->error = errno;
      if (call->error) goto close_target;
    } else {
      call->error = batch_write_bytes(fd, &position, size, at, record);
      if (call->error) goto close_target;
    }
    call->error = batch_write_bytes(fd, &position, size, "\n", 1);
    if (call->error) goto close_target;
    if (!newline) { remaining = 0; break; }
    size_t consumed = record + 1;
    at += consumed;
    remaining -= consumed;
  }
  call->next = position;
  if (call->finish && ftruncate(fd, (off_t)call->next)) call->error = errno;
close_target:
  if (close(fd) && !call->error) call->error = errno;
}

static Term baton_write_batch_pack(Env e, IoWork *w) {
  BatonWriteBatch *call = (BatonWriteBatch *)w->data;
  char position[32];
  int length = snprintf(position, sizeof(position), "%llu", (unsigned long long)call->next);
  Term result = call->error ? io_fail(e, call->error, "Could not write the retained log batch.")
    : io_done(e, io_str(e, position, (size_t)length));
  free(call->path); free(call->plan); free(call->position); free(call);
  w->data = NULL;
  return result;
}

static Term baton_write_batch_run(Env e, Term *f, IoWork *w) {
  BatonWriteBatch *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  u64 path_n = 0, position_n = 0, plan_n = 0;
  call->path = io_cstr(e, f[0], &path_n);
  call->position = io_cstr(e, f[1], &position_n);
  call->plan = io_cstr(e, f[2], &plan_n);
  call->length = plan_n;
  call->finish = (u32)f[3] != 0;
  if (!call->path || !call->position || !call->plan ||
      strlen(call->path) != path_n || strlen(call->position) != position_n) {
    call->error = EINVAL;
  }
  w->data = (char *)call;
  if (call->error) return baton_write_batch_pack(e, w);
  return io_work(w, baton_write_batch_call, baton_write_batch_pack);
}

static void __attribute__((constructor)) baton_write_batch_use(void) {
  io_eff(CID_TEXT_WRITE_BATCH_AT, baton_write_batch_run, 0);
}
#endif

#ifdef CID_TEXT_CONTROL_OUTPUT
static void baton_control_output_call(IoWork *w) {
  /* Receive and Turn use this effect for their control output. Each call owns
     its bytes and writes directly to fd 1 under the stdout stream lock. */
  flockfile(stdout);
  size_t offset = 0;
  while (offset < w->size) {
    ssize_t count = write(STDOUT_FILENO, w->data + offset, w->size - offset);
    if (count > 0) offset += (size_t)count;
    else if (count < 0 && errno == EINTR) continue;
    else { w->code = count < 0 ? errno : EIO; break; }
  }
  funlockfile(stdout);
}

static Term baton_control_output_pack(Env e, IoWork *w) {
  Term result = w->code
    ? io_fail(e, w->code, "Could not write coordinator control output.")
    : io_done(e, term_pak(CID_UNIT, 0));
  free(w->data);
  w->data = NULL;
  return result;
}

static Term baton_control_output_run(Env e, Term *f, IoWork *w) {
  u64 length = 0;
  w->data = io_cstr(e, f[0], &length);
  w->size = length;
  w->code = 0;
  return io_work(w, baton_control_output_call, baton_control_output_pack);
}

static void __attribute__((constructor)) baton_control_output_use(void) {
  io_eff(CID_TEXT_CONTROL_OUTPUT, baton_control_output_run, 0);
}
#endif

#ifdef CID_TEXT_APPEND
static Term baton_append_run(Env e, Term *f, IoWork *w) {
  BatonRead *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  u64 path_length=0,length=0;
  call->path=io_cstr(e,f[0],&path_length);
  call->text=io_cstr(e,f[1],&length);
  call->length=length;call->append=1;
  if(strlen(call->path)!=path_length) {
    free(call->path);free(call->text);free(call);
    return io_fail(e,EINVAL,"path contains NUL");
  }
  w->data=(char *)call;
  return io_work(w,baton_read_call,baton_read_pack);
}
static void __attribute__((constructor)) baton_append_use(void) {
  io_eff(CID_TEXT_APPEND,baton_append_run,0);
}
#endif
