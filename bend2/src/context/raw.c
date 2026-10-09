/* The context raw reader. This is the only place allowed to report a byte offset,
   and the only place that can: the runtime's io_str conversion replaces invalid
   byte sequences, so a check on the converted String cannot implement this
   boundary.

   Decision order, which the fixtures pin: a leading BOM, then RFC 3629 validity,
   then a decoded NUL. The bytes are read whole, without a configured size
   cutoff. `-` selects stdin. */
#include <errno.h>
#include <unistd.h>

typedef struct {
  char *path, *bytes;
  size_t length;
  int error;    /* host error, 0 when the read completed */
  int refusal;  /* 0 none, 1 invalid utf8, 2 nul, 3 bom */
  size_t offset;
} BatonRawRead;

/* Strict RFC 3629: rejects continuation bytes without a lead, overlong forms,
   surrogate code points, code points above U+10FFFF and truncated sequences. */
static int baton_raw_utf8_bad(const unsigned char *b, size_t n, size_t *bad) {
  size_t i = 0;
  while (i < n) {
    unsigned char c = b[i];
    if (c < 0x80) { i += 1; continue; }
    if (c < 0xC2) { *bad = i; return 1; }
    if (c < 0xE0) {
      if (i + 1 >= n || (b[i + 1] & 0xC0) != 0x80) { *bad = i; return 1; }
      i += 2; continue;
    }
    if (c < 0xF0) {
      if (i + 2 >= n) { *bad = i; return 1; }
      unsigned char c1 = b[i + 1], c2 = b[i + 2];
      if ((c1 & 0xC0) != 0x80 || (c2 & 0xC0) != 0x80) { *bad = i; return 1; }
      if (c == 0xE0 && c1 < 0xA0) { *bad = i; return 1; }
      if (c == 0xED && c1 > 0x9F) { *bad = i; return 1; }
      i += 3; continue;
    }
    if (c < 0xF5) {
      if (i + 3 >= n) { *bad = i; return 1; }
      unsigned char c1 = b[i + 1], c2 = b[i + 2], c3 = b[i + 3];
      if ((c1 & 0xC0) != 0x80 || (c2 & 0xC0) != 0x80 || (c3 & 0xC0) != 0x80) {
        *bad = i; return 1;
      }
      if (c == 0xF0 && c1 < 0x90) { *bad = i; return 1; }
      if (c == 0xF4 && c1 > 0x8F) { *bad = i; return 1; }
      i += 4; continue;
    }
    *bad = i; return 1;
  }
  return 0;
}

static int baton_raw_first_nul(const unsigned char *b, size_t n, size_t *found) {
  for (size_t i = 0; i < n; i += 1) {
    if (b[i] == 0) { *found = i; return 1; }
  }
  return 0;
}

static int baton_raw_bom(const unsigned char *b, size_t n) {
  return n >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF;
}

static void baton_raw_read_call(IoWork *w) {
  BatonRawRead *call = (BatonRawRead *)w->data;
  FILE *file = strcmp(call->path, "-") == 0 ? stdin : fopen(call->path, "rb");
  if (!file) { call->error = errno; return; }
  size_t capacity = 4096;
  call->bytes = malloc(capacity);
  if (!call->bytes) { call->error = ENOMEM; goto close_file; }
  for (;;) {
    if (call->length == capacity) {
      if (capacity > SIZE_MAX / 2) { call->error = ENOMEM; break; }
      capacity *= 2;
      char *next = realloc(call->bytes, capacity);
      if (!next) { call->error = ENOMEM; break; }
      call->bytes = next;
    }
    size_t count = fread(call->bytes + call->length, 1, capacity - call->length, file);
    call->length += count;
    if (!count) {
      if (ferror(file)) call->error = errno ? errno : EIO;
      break;
    }
  }
close_file:
  if (file != stdin && fclose(file) != 0 && !call->error) call->error = errno;
  if (call->error) return;
  const unsigned char *b = (const unsigned char *)call->bytes;
  if (baton_raw_bom(b, call->length)) { call->refusal = 3; return; }
  size_t bad = 0;
  if (baton_raw_utf8_bad(b, call->length, &bad)) { call->refusal = 1; call->offset = bad; return; }
  size_t nul = 0;
  if (baton_raw_first_nul(b, call->length, &nul)) { call->refusal = 2; call->offset = nul; return; }
}

#ifdef CID_RAW_READ_UTF8
static Term baton_raw_read_pack(Env e, IoWork *w) {
  BatonRawRead *call = (BatonRawRead *)w->data;
  Term value = term_pak(CID_UNIT, 0);
  char digits[32];
  if (!call->error && call->refusal != 0) {
    int count = snprintf(digits, sizeof digits, "%lu", (unsigned long)call->offset);
    if (count < 0 || (size_t)count >= sizeof digits) call->error = EOVERFLOW;
    else if (call->refusal == 1) value = io_box(e, CID_RAWINVALIDUTF8, io_str(e, digits, (u64)count));
    else if (call->refusal == 2) value = io_box(e, CID_RAWNUL, io_str(e, digits, (u64)count));
    else value = term_pak(CID_RAWBOM, 0);
  } else if (!call->error) {
    value = io_box(e, CID_RAWTEXT, io_str(e, call->bytes, call->length));
  }
  Term result = call->error ? io_fail(e, call->error, NULL) : io_done(e, value);
  free(call->path); free(call->bytes); free(call);
  w->data = NULL;
  return result;
}

static Term baton_raw_read_run(Env e, Term *f, IoWork *w) {
  BatonRawRead *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  u64 length = 0;
  call->path = io_cstr(e, f[0], &length);
  if (strlen(call->path) != length) {
    free(call->path); free(call);
    return io_fail(e, EINVAL, "path contains NUL");
  }
  w->data = (char *)call;
  return io_work(w, baton_raw_read_call, baton_raw_read_pack);
}
static void __attribute__((constructor)) baton_raw_read_use(void) {
  io_eff(CID_RAW_READ_UTF8, baton_raw_read_run, 0);
}
#endif
