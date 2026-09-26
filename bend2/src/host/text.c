#include <errno.h>

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
