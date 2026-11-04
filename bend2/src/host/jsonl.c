#ifndef BATON_JSONL_INCLUDED
#define BATON_JSONL_INCLUDED

#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sqlite3.h>
#include <sys/stat.h>
#include <unistd.h>

/* Strict RFC 3629 validation runs before conversion to the runtime String. */
static int baton_jsonl_utf8(const unsigned char *bytes, size_t length) {
  for (size_t i = 0; i < length;) {
    unsigned char c = bytes[i++];
    if (!c) return EILSEQ;
    if (c < 0x80) continue;
    unsigned count = c >= 0xC2 && c <= 0xDF ? 1 :
                     c >= 0xE0 && c <= 0xEF ? 2 :
                     c >= 0xF0 && c <= 0xF4 ? 3 : 0;
    if (!count || count > length - i) return EILSEQ;
    unsigned char next = bytes[i];
    if ((c == 0xE0 && next < 0xA0) || (c == 0xED && next >= 0xA0) ||
        (c == 0xF0 && next < 0x90) || (c == 0xF4 && next >= 0x90)) return EILSEQ;
    for (unsigned j = 0; j < count; j++)
      if ((bytes[i++] & 0xC0) != 0x80) return EILSEQ;
  }
  return 0;
}

static int baton_jsonl_same_stat(const struct stat *first, const struct stat *second) {
#ifdef __APPLE__
  return first->st_dev == second->st_dev && first->st_ino == second->st_ino &&
    first->st_size == second->st_size &&
    first->st_mtimespec.tv_sec == second->st_mtimespec.tv_sec &&
    first->st_mtimespec.tv_nsec == second->st_mtimespec.tv_nsec &&
    first->st_ctimespec.tv_sec == second->st_ctimespec.tv_sec &&
    first->st_ctimespec.tv_nsec == second->st_ctimespec.tv_nsec;
#else
  return first->st_dev == second->st_dev && first->st_ino == second->st_ino &&
    first->st_size == second->st_size &&
    first->st_mtim.tv_sec == second->st_mtim.tv_sec &&
    first->st_mtim.tv_nsec == second->st_mtim.tv_nsec &&
    first->st_ctim.tv_sec == second->st_ctim.tv_sec &&
    first->st_ctim.tv_nsec == second->st_ctim.tv_nsec;
#endif
}

static int baton_jsonl_snapshot_same(int fd, const char *path, const struct stat *before) {
  struct stat current, named;
  if (fstat(fd, &current) || stat(path, &named)) return errno;
  return baton_jsonl_same_stat(before, &current) && baton_jsonl_same_stat(before, &named)
    ? 0 : EAGAIN;
}

static int baton_jsonl_reserve(char **bytes, size_t *capacity, size_t wanted) {
  if (wanted <= *capacity) return 0;
  size_t next = *capacity ? *capacity : 8192;
  while (next < wanted) {
    if (next > SIZE_MAX / 2) { next = wanted; break; }
    next *= 2;
  }
  char *grown = realloc(*bytes, next);
  if (!grown) return ENOMEM;
  *bytes = grown; *capacity = next;
  return 0;
}

static int baton_jsonl_frame(sqlite3_stmt *valid, sqlite3_stmt *predicate,
                            const char *bytes, size_t length, int *matches) {
  int error = baton_jsonl_utf8((const unsigned char *)bytes, length);
  if (error || !length) return error;
  sqlite3_reset(valid); sqlite3_clear_bindings(valid);
  if (sqlite3_bind_text64(valid, 1, bytes, length, SQLITE_STATIC, SQLITE_UTF8) != SQLITE_OK ||
      sqlite3_step(valid) != SQLITE_ROW || !sqlite3_column_int(valid, 0)) return EILSEQ;
  sqlite3_reset(predicate); sqlite3_clear_bindings(predicate);
  if (sqlite3_bind_text64(predicate, 1, bytes, length, SQLITE_STATIC, SQLITE_UTF8) != SQLITE_OK ||
      sqlite3_step(predicate) != SQLITE_ROW) return EINVAL;
  if (sqlite3_column_type(predicate, 0) != SQLITE_INTEGER) return EINVAL;
  sqlite3_int64 value = sqlite3_column_int64(predicate, 0);
  if (value != 0 && value != 1) return EINVAL;
  *matches = (int)value;
  return sqlite3_step(predicate) == SQLITE_DONE ? 0 : EINVAL;
}

/* Scans one file snapshot with one frame in working memory. Only the selected
   suffix is retained for conversion by the host effect. All frames are checked. */
static int baton_jsonl_read_suffix(const char *path, const char *query,
                                  char **text, size_t *length) {
  int error = 0, fd = -1, selected = 0;
  sqlite3 *database = NULL;
  sqlite3_stmt *valid = NULL, *predicate = NULL;
  char *line = NULL, *suffix = NULL;
  size_t line_length = 0, line_capacity = 0, used = 0, capacity = 0;
  const char *tail = NULL;
  struct stat before;
  *text = NULL; *length = 0;
  fd = open(path, O_RDONLY | O_CLOEXEC | O_NONBLOCK);
  if (fd < 0) return errno;
  if (fstat(fd, &before)) { error = errno; goto finished; }
  if (!S_ISREG(before.st_mode) || before.st_size < 0 ||
      (uintmax_t)before.st_size > SIZE_MAX - 1) { error = EINVAL; goto finished; }
  if (sqlite3_open_v2(":memory:", &database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, NULL) != SQLITE_OK ||
      sqlite3_prepare_v2(database, "SELECT json_valid(?1)", -1, &valid, NULL) != SQLITE_OK ||
      sqlite3_prepare_v2(database, query, -1, &predicate, &tail) != SQLITE_OK ||
      !predicate || !sqlite3_stmt_readonly(predicate) || sqlite3_column_count(predicate) != 1 ||
      sqlite3_bind_parameter_count(predicate) != 1) { error = EINVAL; goto finished; }
  while (*tail == ' ' || *tail == '\n' || *tail == '\r' || *tail == '\t') tail++;
  if (*tail) { error = EINVAL; goto finished; }
  off_t position = 0, line_offset = 0;
  char block[65536];
  while (position < before.st_size) {
    off_t remaining = before.st_size - position;
    size_t wanted = remaining < (off_t)sizeof(block) ? (size_t)remaining : sizeof(block);
    ssize_t count = pread(fd, block, wanted, position);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) { error = count < 0 ? errno : EAGAIN; goto finished; }
    for (size_t at = 0; at < (size_t)count;) {
      char *newline = memchr(block + at, '\n', (size_t)count - at);
      size_t part = newline ? (size_t)(newline - block) + 1 - at : (size_t)count - at;
      if (part > SIZE_MAX - line_length - 1) { error = EOVERFLOW; goto finished; }
      error = baton_jsonl_reserve(&line, &line_capacity, line_length + part + 1);
      if (error) goto finished;
      memcpy(line + line_length, block + at, part);
      line_length += part; line[line_length] = 0; at += part;
      if (!newline && position + count < before.st_size) continue;
      int matches = 0;
      size_t frame_length = line_length - (line_length && line[line_length - 1] == '\n');
      if (!line_offset && frame_length >= 3 &&
          !memcmp(line, "\xEF\xBB\xBF", 3)) { error = EILSEQ; goto finished; }
      error = baton_jsonl_frame(valid, predicate, line, frame_length, &matches);
      if (error) goto finished;
      selected |= matches;
      if (selected) {
        if (line_length > SIZE_MAX - used - 1) { error = EOVERFLOW; goto finished; }
        error = baton_jsonl_reserve(&suffix, &capacity, used + line_length + 1);
        if (error) goto finished;
        memcpy(suffix + used, line, line_length); used += line_length; suffix[used] = 0;
      }
      line_offset += (off_t)line_length;
      line_length = 0;
    }
    position += count;
  }
  error = baton_jsonl_snapshot_same(fd, path, &before);
finished:
  sqlite3_finalize(predicate); sqlite3_finalize(valid);
  if (database) sqlite3_close(database);
  if (fd >= 0 && close(fd) && !error) error = errno;
  free(line);
  if (error) free(suffix);
  else { *text = suffix; *length = used; }
  return error;
}

#ifdef CID_JSONL_READ_SUFFIX
typedef struct {
  char *path, *predicate, *text;
  size_t length;
  int error;
} BatonJsonlRead;

static void baton_jsonl_read_call(IoWork *work) {
  BatonJsonlRead *call = (BatonJsonlRead *)work->data;
  call->error = baton_jsonl_read_suffix(call->path, call->predicate, &call->text, &call->length);
}

static Term baton_jsonl_read_pack(Env environment, IoWork *work) {
  BatonJsonlRead *call = (BatonJsonlRead *)work->data;
  Term result = call->error
    ? io_fail(environment, call->error, "Could not read a stable UTF-8 JSONL snapshot.")
    : io_done(environment, io_str(environment, call->text ? call->text : "", call->length));
  free(call->path); free(call->predicate); free(call->text); free(call);
  work->data = NULL;
  return result;
}

static Term baton_jsonl_read_run(Env environment, Term *arguments, IoWork *work) {
  BatonJsonlRead *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(environment, ENOMEM, NULL);
  u64 path_length = 0, predicate_length = 0;
  call->path = io_cstr(environment, arguments[0], &path_length);
  call->predicate = io_cstr(environment, arguments[1], &predicate_length);
  work->data = (char *)call;
  if (!call->path || !call->predicate || strlen(call->path) != path_length ||
      strlen(call->predicate) != predicate_length) {
    call->error = EINVAL;
    return baton_jsonl_read_pack(environment, work);
  }
  return io_work(work, baton_jsonl_read_call, baton_jsonl_read_pack);
}

static void __attribute__((constructor)) baton_jsonl_read_use(void) {
  io_eff(CID_JSONL_READ_SUFFIX, baton_jsonl_read_run, 0);
}

#endif

#endif
