#ifndef BATON_JSONL_LAST_INCLUDED
#define BATON_JSONL_LAST_INCLUDED

#include "jsonl.c"

/* Reads exactly `length` bytes at `position`; a file that shrank is EAGAIN. */
static int baton_jsonl_last_pread(int fd, char *bytes, size_t length, off_t position) {
  while (length) {
    ssize_t count = pread(fd, bytes, length, position);
    if (count < 0 && errno == EINTR) continue;
    if (count < 0) return errno;
    if (!count) return EAGAIN;
    bytes += count; length -= (size_t)count; position += count;
  }
  return 0;
}

#define BATON_JSONL_LAST_BLOCK 65536

/* The most recent block read, covering [from, from + have) of the file. */
typedef struct {
  int fd;
  off_t from;
  size_t have;
  char bytes[BATON_JSONL_LAST_BLOCK];
} BatonJsonlLastBlock;

/* Makes the block cover the byte before `end`, reading the block that ends at
   `end` when it does not. */
static int baton_jsonl_last_cover(BatonJsonlLastBlock *block, off_t end) {
  if (end > block->from && end <= block->from + (off_t)block->have) return 0;
  off_t from = end > (off_t)BATON_JSONL_LAST_BLOCK ? end - (off_t)BATON_JSONL_LAST_BLOCK : 0;
  int error = baton_jsonl_last_pread(block->fd, block->bytes, (size_t)(end - from), from);
  if (error) return error;
  block->from = from; block->have = (size_t)(end - from);
  return 0;
}

/* One past the nearest newline before `end`, or 0. Blocks are read backward and
   a block that holds several lines is read once. */
static int baton_jsonl_last_start(BatonJsonlLastBlock *block, off_t end, off_t *start) {
  off_t position = end;
  while (position > 0) {
    int error = baton_jsonl_last_cover(block, position);
    if (error) return error;
    for (size_t at = (size_t)(position - block->from); at > 0; at--)
      if (block->bytes[at - 1] == '\n') { *start = block->from + (off_t)at; return 0; }
    position = block->from;
  }
  *start = 0;
  return 0;
}

static int baton_jsonl_last_contains(const char *bytes, size_t length, const char *needle, size_t needle_length) {
  while (length >= needle_length) {
    const char *at = memchr(bytes, needle[0], length - needle_length + 1);
    if (!at) return 0;
    if (!memcmp(at, needle, needle_length)) return 1;
    length -= (size_t)(at + 1 - bytes);
    bytes = at + 1;
  }
  return 0;
}

/* The file may grow while it is scanned; it may not be replaced or shortened. */
static int baton_jsonl_last_kept(int fd, const char *path, const struct stat *before) {
  struct stat current, named;
  if (fstat(fd, &current) || stat(path, &named)) return errno;
  return before->st_dev == current.st_dev && before->st_ino == current.st_ino &&
         before->st_dev == named.st_dev && before->st_ino == named.st_ino &&
         current.st_size >= before->st_size
    ? 0 : EAGAIN;
}

/* Scans the file backward from its size at open, one line at a time. A line is
   parsed when it holds `needle` or a `\u` sequence; the other JSON escapes cannot
   produce a letter or an underscore, so a `needle` that is not written out in
   the line can only be spelled with `\u`. The first parsed line, from the end,
   that is valid UTF-8 JSON and for which the read-only scalar SQL predicate (the
   line bound as parameter 1) returns 1 is the result; the parse decides whether
   a candidate matches. A candidate that is not valid UTF-8 JSON is an error. A
   scan without a match returns an empty text. Memory holds one 64 KiB block and,
   for a line that crosses blocks or is selected, a copy of that line. Bytes
   appended after the file was opened are not read. */
static int baton_jsonl_read_last(const char *path, const char *needle, const char *query,
                                char **text, size_t *length) {
  int error = 0, fd = -1, found = 0;
  sqlite3 *database = NULL;
  sqlite3_stmt *valid = NULL, *predicate = NULL;
  BatonJsonlLastBlock *block = NULL;
  char *line = NULL;
  size_t capacity = 0, frame_length = 0, needle_length = strlen(needle);
  const char *tail = NULL;
  struct stat before;
  *text = NULL; *length = 0;
  if (!needle_length) return EINVAL;
  fd = open(path, O_RDONLY | O_CLOEXEC | O_NONBLOCK);
  if (fd < 0) return errno;
  if (fstat(fd, &before)) { error = errno; goto finished; }
  if (!S_ISREG(before.st_mode) || before.st_size < 0 ||
      (uintmax_t)before.st_size > SIZE_MAX - 1) { error = EINVAL; goto finished; }
  block = malloc(sizeof(*block));
  if (!block) { error = ENOMEM; goto finished; }
  block->fd = fd; block->from = 0; block->have = 0;
  if (sqlite3_open_v2(":memory:", &database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, NULL) != SQLITE_OK ||
      sqlite3_prepare_v2(database, "SELECT json_valid(?1)", -1, &valid, NULL) != SQLITE_OK ||
      sqlite3_prepare_v2(database, query, -1, &predicate, &tail) != SQLITE_OK ||
      !predicate || !sqlite3_stmt_readonly(predicate) || sqlite3_column_count(predicate) != 1 ||
      sqlite3_bind_parameter_count(predicate) != 1) { error = EINVAL; goto finished; }
  while (*tail == ' ' || *tail == '\n' || *tail == '\r' || *tail == '\t') tail++;
  if (*tail) { error = EINVAL; goto finished; }
  for (off_t end = before.st_size; end > 0 && !found;) {
    off_t content_end, start;
    error = baton_jsonl_last_cover(block, end);
    if (error) goto finished;
    content_end = block->bytes[end - block->from - 1] == '\n' ? end - 1 : end;
    error = baton_jsonl_last_start(block, content_end, &start);
    if (error) goto finished;
    frame_length = (size_t)(content_end - start);
    if (frame_length) {
      const char *bytes;
      if (start >= block->from && content_end <= block->from + (off_t)block->have)
        bytes = block->bytes + (start - block->from);
      else {
        error = baton_jsonl_reserve(&line, &capacity, frame_length + 1);
        if (error) goto finished;
        error = baton_jsonl_last_pread(fd, line, frame_length, start);
        if (error) goto finished;
        bytes = line;
      }
      if (baton_jsonl_last_contains(bytes, frame_length, needle, needle_length) ||
          baton_jsonl_last_contains(bytes, frame_length, "\\u", 2)) {
        int matches = 0;
        error = baton_jsonl_frame(valid, predicate, bytes, frame_length, &matches);
        if (error) goto finished;
        if (matches) {
          if (bytes != line) {
            error = baton_jsonl_reserve(&line, &capacity, frame_length + 1);
            if (error) goto finished;
            memcpy(line, bytes, frame_length);
          }
          line[frame_length] = 0;
          found = 1;
        }
      }
    }
    end = start;
  }
  error = baton_jsonl_last_kept(fd, path, &before);
finished:
  sqlite3_finalize(predicate); sqlite3_finalize(valid);
  if (database) sqlite3_close(database);
  if (fd >= 0 && close(fd) && !error) error = errno;
  free(block);
  if (error || !found) { free(line); line = NULL; frame_length = 0; }
  if (!error) { *text = line; *length = frame_length; }
  return error;
}

#ifdef CID_JSONL_READ_LAST
typedef struct {
  char *path, *needle, *predicate, *text;
  size_t length;
  int error;
} BatonJsonlLast;

static void baton_jsonl_last_call(IoWork *work) {
  BatonJsonlLast *call = (BatonJsonlLast *)work->data;
  call->error = baton_jsonl_read_last(call->path, call->needle, call->predicate, &call->text, &call->length);
}

static Term baton_jsonl_last_pack(Env environment, IoWork *work) {
  BatonJsonlLast *call = (BatonJsonlLast *)work->data;
  Term result = call->error
    ? io_fail(environment, call->error, "Could not read the last matching JSONL frame.")
    : io_done(environment, io_str(environment, call->text ? call->text : "", call->length));
  free(call->path); free(call->needle); free(call->predicate); free(call->text); free(call);
  work->data = NULL;
  return result;
}

static Term baton_jsonl_last_run(Env environment, Term *arguments, IoWork *work) {
  BatonJsonlLast *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(environment, ENOMEM, NULL);
  u64 path_length = 0, needle_length = 0, predicate_length = 0;
  call->path = io_cstr(environment, arguments[0], &path_length);
  call->needle = io_cstr(environment, arguments[1], &needle_length);
  call->predicate = io_cstr(environment, arguments[2], &predicate_length);
  work->data = (char *)call;
  if (!call->path || !call->needle || !call->predicate || strlen(call->path) != path_length ||
      strlen(call->needle) != needle_length || strlen(call->predicate) != predicate_length) {
    call->error = EINVAL;
    return baton_jsonl_last_pack(environment, work);
  }
  return io_work(work, baton_jsonl_last_call, baton_jsonl_last_pack);
}

static void __attribute__((constructor)) baton_jsonl_last_use(void) {
  io_eff(CID_JSONL_READ_LAST, baton_jsonl_last_run, 0);
}

#endif

#endif
