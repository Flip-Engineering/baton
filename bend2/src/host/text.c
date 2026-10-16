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
