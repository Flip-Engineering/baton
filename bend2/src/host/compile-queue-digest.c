/* Compile queue identity bindings.
 *
 * Effect names follow the Bend module and function names, not this file:
 *   CompileQueueIdentity.source_closure    -> CID_COMPILEQUEUEIDENTITY_SOURCE_CLOSURE
 *   CompileQueueIdentity.source_digest     -> CID_COMPILEQUEUEIDENTITY_SOURCE_DIGEST
 *   CompileQueueIdentity.file_closure      -> CID_COMPILEQUEUEIDENTITY_FILE_CLOSURE
 *   CompileQueueIdentity.compiler_closure  -> CID_COMPILEQUEUEIDENTITY_COMPILER_CLOSURE
 *   CompileQueueIdentity.file_digest       -> CID_COMPILEQUEUEIDENTITY_FILE_DIGEST
 *   CompileQueueIdentity.text_digest       -> CID_COMPILEQUEUEIDENTITY_TEXT_DIGEST
 *
 * The source walker follows .bend imports and quoted import bindings, then
 * local #include "..." headers. Paths outside the source root are rejected so
 * one checkout's identity never contains a host-specific path. The compiler
 * closure hashes executable wrapper chains, the captured version text and the
 * Bend release tree. System headers are covered by the caller-supplied
 * toolchain/version evidence, not by walking the host system.
 *
 * All helpers are POSIX C and avoid GNU-only facilities so the same source
 * builds on Linux and macOS.
 */
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

/* ------------------------------------------------------------------------- */
/* SHA-256                                                                   */
/* ------------------------------------------------------------------------- */

typedef struct {
  uint32_t state[8];
  uint64_t bits;
  unsigned char block[64];
  size_t used;
} CqIdSha;

static const uint32_t cq_id_k[64] = {
  0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u,
  0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
  0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
  0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
  0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu,
  0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
  0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u,
  0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
  0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
  0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
  0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u,
  0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
  0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u,
  0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
  0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
  0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u
};

static uint32_t cq_id_rotr(uint32_t value, unsigned count) {
  return (value >> count) | (value << (32u - count));
}

static void cq_id_sha_block(CqIdSha *sha, const unsigned char *block) {
  uint32_t w[64];
  for (int i = 0; i < 16; i++) {
    w[i] = ((uint32_t)block[i * 4] << 24)
      | ((uint32_t)block[i * 4 + 1] << 16)
      | ((uint32_t)block[i * 4 + 2] << 8)
      | (uint32_t)block[i * 4 + 3];
  }
  for (int i = 16; i < 64; i++) {
    uint32_t s0 = cq_id_rotr(w[i - 15], 7) ^ cq_id_rotr(w[i - 15], 18)
      ^ (w[i - 15] >> 3);
    uint32_t s1 = cq_id_rotr(w[i - 2], 17) ^ cq_id_rotr(w[i - 2], 19)
      ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  uint32_t a = sha->state[0], b = sha->state[1], c = sha->state[2];
  uint32_t d = sha->state[3], e = sha->state[4], f = sha->state[5];
  uint32_t g = sha->state[6], h = sha->state[7];
  for (int i = 0; i < 64; i++) {
    uint32_t s1 = cq_id_rotr(e, 6) ^ cq_id_rotr(e, 11) ^ cq_id_rotr(e, 25);
    uint32_t ch = (e & f) ^ ((~e) & g);
    uint32_t t1 = h + s1 + ch + cq_id_k[i] + w[i];
    uint32_t s0 = cq_id_rotr(a, 2) ^ cq_id_rotr(a, 13) ^ cq_id_rotr(a, 22);
    uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
    uint32_t t2 = s0 + maj;
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }
  sha->state[0] += a;
  sha->state[1] += b;
  sha->state[2] += c;
  sha->state[3] += d;
  sha->state[4] += e;
  sha->state[5] += f;
  sha->state[6] += g;
  sha->state[7] += h;
}

static void cq_id_sha_init(CqIdSha *sha) {
  sha->state[0] = 0x6a09e667u;
  sha->state[1] = 0xbb67ae85u;
  sha->state[2] = 0x3c6ef372u;
  sha->state[3] = 0xa54ff53au;
  sha->state[4] = 0x510e527fu;
  sha->state[5] = 0x9b05688cu;
  sha->state[6] = 0x1f83d9abu;
  sha->state[7] = 0x5be0cd19u;
  sha->bits = 0;
  sha->used = 0;
}

static void cq_id_sha_update(CqIdSha *sha, const void *data, size_t length) {
  const unsigned char *bytes = (const unsigned char *)data;
  sha->bits += (uint64_t)length * 8u;
  while (length > 0) {
    size_t take = 64 - sha->used;
    if (take > length) take = length;
    memcpy(sha->block + sha->used, bytes, take);
    sha->used += take;
    bytes += take;
    length -= take;
    if (sha->used == 64) {
      cq_id_sha_block(sha, sha->block);
      sha->used = 0;
    }
  }
}

static void cq_id_sha_final(CqIdSha *sha, unsigned char digest[32]) {
  uint64_t bits = sha->bits;
  size_t used = sha->used;
  sha->block[used++] = 0x80;
  if (used > 56) {
    while (used < 64) sha->block[used++] = 0;
    cq_id_sha_block(sha, sha->block);
    used = 0;
  }
  while (used < 56) sha->block[used++] = 0;
  for (int i = 0; i < 8; i++) {
    sha->block[56 + i] = (unsigned char)(bits >> (56 - i * 8));
  }
  cq_id_sha_block(sha, sha->block);
  for (int i = 0; i < 8; i++) {
    digest[i * 4] = (unsigned char)(sha->state[i] >> 24);
    digest[i * 4 + 1] = (unsigned char)(sha->state[i] >> 16);
    digest[i * 4 + 2] = (unsigned char)(sha->state[i] >> 8);
    digest[i * 4 + 3] = (unsigned char)sha->state[i];
  }
}

static void cq_id_hex(const unsigned char digest[32], char hex[65]) {
  static const char digits[] = "0123456789abcdef";
  for (int i = 0; i < 32; i++) {
    hex[i * 2] = digits[digest[i] >> 4];
    hex[i * 2 + 1] = digits[digest[i] & 15];
  }
  hex[64] = '\0';
}

static void cq_id_hash_bytes(const void *data, size_t length, char hex[65]) {
  CqIdSha sha;
  unsigned char digest[32];
  cq_id_sha_init(&sha);
  cq_id_sha_update(&sha, data, length);
  cq_id_sha_final(&sha, digest);
  cq_id_hex(digest, hex);
}

static int cq_id_hash_file(const char *path, char hex[65]) {
  int fd = open(path, O_RDONLY);
  if (fd < 0) return errno;
  CqIdSha sha;
  unsigned char digest[32];
  unsigned char chunk[65536];
  cq_id_sha_init(&sha);
  for (;;) {
    ssize_t count = read(fd, chunk, sizeof chunk);
    if (count > 0) {
      cq_id_sha_update(&sha, chunk, (size_t)count);
      continue;
    }
    if (count == 0) break;
    if (errno == EINTR) continue;
    int error = errno;
    close(fd);
    return error;
  }
  if (close(fd)) return errno;
  cq_id_sha_final(&sha, digest);
  cq_id_hex(digest, hex);
  return 0;
}

/* ------------------------------------------------------------------------- */
/* Small allocation helpers                                                  */
/* ------------------------------------------------------------------------- */

typedef struct {
  char *data;
  size_t length;
  size_t capacity;
  int error;
} CqIdBuffer;

typedef struct {
  char **items;
  size_t length;
  size_t capacity;
  int error;
} CqIdList;

static void cq_id_buf_free(CqIdBuffer *buffer) {
  free(buffer->data);
  buffer->data = NULL;
  buffer->length = buffer->capacity = 0;
}

static int cq_id_buf_reserve(CqIdBuffer *buffer, size_t extra) {
  if (buffer->error) return 0;
  if (extra > SIZE_MAX - buffer->length - 1) {
    buffer->error = ENOMEM;
    return 0;
  }
  size_t need = buffer->length + extra + 1;
  if (need <= buffer->capacity) return 1;
  size_t capacity = buffer->capacity ? buffer->capacity : 256;
  while (capacity < need) {
    if (capacity > SIZE_MAX / 2) {
      capacity = need;
      break;
    }
    capacity *= 2;
  }
  char *data = (char *)realloc(buffer->data, capacity);
  if (!data) {
    buffer->error = ENOMEM;
    return 0;
  }
  buffer->data = data;
  buffer->capacity = capacity;
  return 1;
}

static int cq_id_buf_add(CqIdBuffer *buffer, const char *text, size_t length) {
  if (!cq_id_buf_reserve(buffer, length)) return 0;
  memcpy(buffer->data + buffer->length, text, length);
  buffer->length += length;
  buffer->data[buffer->length] = '\0';
  return 1;
}

static int cq_id_buf_adds(CqIdBuffer *buffer, const char *text) {
  return cq_id_buf_add(buffer, text, strlen(text));
}

static int cq_id_buf_format(CqIdBuffer *buffer, const char *format, ...) {
  char small[512];
  va_list args;
  va_start(args, format);
  int length = vsnprintf(small, sizeof small, format, args);
  va_end(args);
  if (length < 0) {
    buffer->error = EINVAL;
    return 0;
  }
  if ((size_t)length < sizeof small) {
    return cq_id_buf_add(buffer, small, (size_t)length);
  }
  char *large = (char *)malloc((size_t)length + 1);
  if (!large) {
    buffer->error = ENOMEM;
    return 0;
  }
  va_start(args, format);
  vsnprintf(large, (size_t)length + 1, format, args);
  va_end(args);
  int ok = cq_id_buf_add(buffer, large, (size_t)length);
  free(large);
  return ok;
}

static char *cq_id_format(const char *format, ...) {
  char small[512];
  va_list args;
  va_start(args, format);
  int length = vsnprintf(small, sizeof small, format, args);
  va_end(args);
  if (length < 0) return NULL;
  if ((size_t)length < sizeof small) return strdup(small);
  char *large = (char *)malloc((size_t)length + 1);
  if (!large) return NULL;
  va_start(args, format);
  vsnprintf(large, (size_t)length + 1, format, args);
  va_end(args);
  return large;
}

static char *cq_id_strdup(const char *text) {
  size_t length = strlen(text);
  char *copy = (char *)malloc(length + 1);
  if (!copy) return NULL;
  memcpy(copy, text, length + 1);
  return copy;
}

/* Takes ownership of item; frees it when the list cannot accept it. */
static int cq_id_list_add(CqIdList *list, char *item) {
  if (!item) {
    list->error = ENOMEM;
    return 0;
  }
  if (list->error) {
    free(item);
    return 0;
  }
  if (list->length == list->capacity) {
    size_t capacity = list->capacity ? list->capacity * 2 : 16;
    char **items = (char **)realloc(list->items, capacity * sizeof(*items));
    if (!items) {
      list->error = ENOMEM;
      free(item);
      return 0;
    }
    list->items = items;
    list->capacity = capacity;
  }
  list->items[list->length++] = item;
  return 1;
}

static int cq_id_list_contains(const CqIdList *list, const char *item) {
  for (size_t i = 0; i < list->length; i++) {
    if (!strcmp(list->items[i], item)) return 1;
  }
  return 0;
}

static int cq_id_list_compare(const void *left, const void *right) {
  return strcmp(*(char *const *)left, *(char *const *)right);
}

static void cq_id_list_sort_unique(CqIdList *list) {
  if (list->error || list->length < 2) return;
  qsort(list->items, list->length, sizeof(*list->items), cq_id_list_compare);
  size_t write = 1;
  for (size_t read = 1; read < list->length; read++) {
    if (!strcmp(list->items[read], list->items[write - 1])) {
      free(list->items[read]);
    } else {
      list->items[write++] = list->items[read];
    }
  }
  list->length = write;
}

static void cq_id_list_free(CqIdList *list) {
  for (size_t i = 0; i < list->length; i++) free(list->items[i]);
  free(list->items);
  list->items = NULL;
  list->length = list->capacity = 0;
}

/* ------------------------------------------------------------------------- */
/* Paths and files                                                           */
/* ------------------------------------------------------------------------- */

static char *cq_id_join(const char *directory, const char *name) {
  size_t a = strlen(directory);
  size_t b = strlen(name);
  int slash = a > 0 && directory[a - 1] != '/';
  char *out = (char *)malloc(a + (size_t)slash + b + 1);
  if (!out) return NULL;
  memcpy(out, directory, a);
  if (slash) out[a++] = '/';
  memcpy(out + a, name, b + 1);
  return out;
}

static char *cq_id_dirname(const char *path) {
  size_t length = strlen(path);
  while (length > 1 && path[length - 1] == '/') length--;
  long last = -1;
  for (size_t i = 0; i < length; i++) {
    if (path[i] == '/') last = (long)i;
  }
  if (last < 0) return cq_id_strdup(".");
  if (last == 0) return cq_id_strdup("/");
  size_t cut = (size_t)last;
  while (cut > 1 && path[cut - 1] == '/') cut--;
  char *out = (char *)malloc(cut + 1);
  if (!out) return NULL;
  memcpy(out, path, cut);
  out[cut] = '\0';
  return out;
}

static const char *cq_id_basename(const char *path) {
  const char *slash = strrchr(path, '/');
  return slash ? slash + 1 : path;
}

static int cq_id_inside(const char *root, const char *path) {
  size_t length = strlen(root);
  if (length == 1 && root[0] == '/') return path[0] == '/';
  return !strncmp(root, path, length) && path[length] == '/';
}

static char *cq_id_relative(const char *root, const char *path) {
  size_t length = strlen(root);
  return cq_id_strdup(path + length + 1);
}

static int cq_id_is_file(const char *path) {
  struct stat info;
  return !stat(path, &info) && S_ISREG(info.st_mode);
}

static int cq_id_is_script(const char *path) {
  int fd = open(path, O_RDONLY);
  if (fd < 0) return 0;
  unsigned char magic[2];
  ssize_t count = read(fd, magic, sizeof magic);
  close(fd);
  return count == 2 && magic[0] == '#' && magic[1] == '!';
}

static char *cq_id_exec_target(const char *path) {
  int fd = open(path, O_RDONLY);
  if (fd < 0) return NULL;
  CqIdBuffer buffer = {0, 0, 0, 0};
  char chunk[4096];
  for (;;) {
    ssize_t count = read(fd, chunk, sizeof chunk);
    if (count > 0) {
      if (!cq_id_buf_add(&buffer, chunk, (size_t)count)) break;
      continue;
    }
    if (count == 0) break;
    if (errno == EINTR) continue;
    buffer.error = errno;
    break;
  }
  close(fd);
  if (buffer.error || !buffer.data) {
    cq_id_buf_free(&buffer);
    return NULL;
  }
  size_t start = 0;
  while (start < buffer.length) {
    size_t end = start;
    while (end < buffer.length && buffer.data[end] != '\n') end++;
    if (end - start >= 6 && !memcmp(buffer.data + start, "exec \"", 6)) {
      size_t target = start + 6;
      size_t close = target;
      while (close < end && buffer.data[close] != '"') close++;
      if (close < end) {
        size_t length = close - target;
        char *answer = (char *)malloc(length + 1);
        if (answer) {
          memcpy(answer, buffer.data + target, length);
          answer[length] = '\0';
        }
        cq_id_buf_free(&buffer);
        return answer;
      }
    }
    start = end + 1;
  }
  cq_id_buf_free(&buffer);
  return NULL;
}

static char *cq_id_resolve_command(const char *command) {
  if (strchr(command, '/')) {
    char *resolved = realpath(command, NULL);
    return resolved ? resolved : cq_id_strdup(command);
  }
  const char *path = getenv("PATH");
  if (path) {
    const char *start = path;
    for (;;) {
      const char *end = strchr(start, ':');
      size_t length = end ? (size_t)(end - start) : strlen(start);
      char *directory = NULL;
      if (length == 0) {
        directory = cq_id_strdup(".");
      } else {
        directory = (char *)malloc(length + 1);
        if (directory) {
          memcpy(directory, start, length);
          directory[length] = '\0';
        }
      }
      if (!directory) return cq_id_strdup(command);
      char *candidate = cq_id_join(directory, command);
      free(directory);
      if (candidate && access(candidate, X_OK) == 0) {
        char *resolved = realpath(candidate, NULL);
        free(candidate);
        return resolved ? resolved : cq_id_strdup(command);
      }
      free(candidate);
      if (!end) break;
      start = end + 1;
    }
  }
  return cq_id_strdup(command);
}

static int cq_id_read_file(const char *path, char **data, size_t *size) {
  int fd = open(path, O_RDONLY);
  if (fd < 0) return errno;
  CqIdBuffer buffer = {0, 0, 0, 0};
  char chunk[65536];
  for (;;) {
    ssize_t count = read(fd, chunk, sizeof chunk);
    if (count > 0) {
      if (!cq_id_buf_add(&buffer, chunk, (size_t)count)) {
        buffer.error = ENOMEM;
        break;
      }
      continue;
    }
    if (count == 0) break;
    if (errno == EINTR) continue;
    buffer.error = errno;
    break;
  }
  if (close(fd) && !buffer.error) buffer.error = errno;
  if (buffer.error) {
    cq_id_buf_free(&buffer);
    return buffer.error;
  }
  if (!buffer.data) {
    buffer.data = (char *)malloc(1);
    if (!buffer.data) return ENOMEM;
    buffer.data[0] = '\0';
  }
  *data = buffer.data;
  *size = buffer.length;
  return 0;
}

/* ------------------------------------------------------------------------- */
/* Source closure                                                            */
/* ------------------------------------------------------------------------- */

typedef struct {
  char *root;
  CqIdList records;
  CqIdList visited;
  CqIdList queue;
  size_t head;
  int error;
} CqIdClosure;

static void cq_id_closure_free(CqIdClosure *closure) {
  free(closure->root);
  cq_id_list_free(&closure->records);
  cq_id_list_free(&closure->visited);
  cq_id_list_free(&closure->queue);
  closure->root = NULL;
  closure->head = 0;
  closure->error = 0;
}

static void cq_id_enqueue(CqIdClosure *closure, const char *path) {
  if (closure->error) return;
  char *copy = cq_id_strdup(path);
  if (!copy) {
    closure->error = ENOMEM;
    return;
  }
  if (!cq_id_list_add(&closure->queue, copy)) closure->error = ENOMEM;
}

static void cq_id_enqueue_relative(CqIdClosure *closure, const char *importer,
                                   const char *target) {
  if (closure->error) return;
  if (target[0] == '/') {
    closure->error = EINVAL;
    return;
  }
  char *directory = cq_id_dirname(importer);
  if (!directory) {
    closure->error = ENOMEM;
    return;
  }
  char *joined = cq_id_join(directory, target);
  free(directory);
  if (!joined) {
    closure->error = ENOMEM;
    return;
  }
  if (!cq_id_list_add(&closure->queue, joined)) closure->error = ENOMEM;
}

static int cq_id_space(char value) {
  return value == ' ' || value == '\t';
}

static int cq_id_next_line(const char *data, size_t size, size_t *offset,
                           size_t *start, size_t *end) {
  if (*offset >= size) return 0;
  *start = *offset;
  while (*offset < size && data[*offset] != '\n') (*offset)++;
  *end = *offset;
  if (*offset < size) (*offset)++;
  if (*end > *start && data[*end - 1] == '\r') (*end)--;
  return 1;
}

static void cq_id_parse_bend(CqIdClosure *closure, const char *path,
                             const char *data, size_t size) {
  size_t offset = 0;
  size_t start = 0;
  size_t end = 0;
  while (!closure->error
         && cq_id_next_line(data, size, &offset, &start, &end)) {
    size_t position = start;
    size_t indent = 0;
    while (position < end && cq_id_space(data[position])) {
      position++;
      indent++;
    }
    if (position >= end || data[position] == '#') continue;
    if (end - position < 6 || memcmp(data + position, "import", 6)) continue;
    size_t cursor = position + 6;
    if (cursor < end && !cq_id_space(data[cursor]) && data[cursor] != '"') {
      continue;
    }
    while (cursor < end && cq_id_space(data[cursor])) cursor++;
    if (cursor >= end) continue;
    if (data[cursor] == '"') {
      size_t close = cursor + 1;
      while (close < end && data[close] != '"') close++;
      if (close >= end) continue;
      size_t length = close - cursor - 1;
      char *target = (char *)malloc(length + 1);
      if (!target) {
        closure->error = ENOMEM;
        return;
      }
      memcpy(target, data + cursor + 1, length);
      target[length] = '\0';
      cq_id_enqueue_relative(closure, path, target);
      free(target);
      continue;
    }
    if (indent != 0) continue;
    size_t target_end = cursor;
    while (target_end < end && !cq_id_space(data[target_end])) target_end++;
    size_t length = target_end - cursor;
    char *target = (char *)malloc(length + 1);
    if (!target) {
      closure->error = ENOMEM;
      return;
    }
    memcpy(target, data + cursor, length);
    target[length] = '\0';
    if (!strcmp(target, "Base")) {
      free(target);
      continue;
    }
    cq_id_enqueue_relative(closure, path, target);
    free(target);
  }
}

static void cq_id_parse_c(CqIdClosure *closure, const char *path,
                          const char *data, size_t size) {
  size_t offset = 0;
  size_t start = 0;
  size_t end = 0;
  while (!closure->error
         && cq_id_next_line(data, size, &offset, &start, &end)) {
    size_t position = start;
    while (position < end && cq_id_space(data[position])) position++;
    if (position >= end || data[position] != '#') continue;
    position++;
    while (position < end && cq_id_space(data[position])) position++;
    if (end - position < 7 || memcmp(data + position, "include", 7)) continue;
    position += 7;
    while (position < end && cq_id_space(data[position])) position++;
    if (position >= end || data[position] != '"') continue;
    size_t close = position + 1;
    while (close < end && data[close] != '"') close++;
    if (close >= end) continue;
    size_t length = close - position - 1;
    char *target = (char *)malloc(length + 1);
    if (!target) {
      closure->error = ENOMEM;
      return;
    }
    memcpy(target, data + position + 1, length);
    target[length] = '\0';
    cq_id_enqueue_relative(closure, path, target);
    free(target);
  }
}

static void cq_id_closure_parse(CqIdClosure *closure, const char *path,
                                const char *data, size_t size) {
  const char *name = cq_id_basename(path);
  const char *dot = strrchr(name, '.');
  if (!dot) return;
  if (!strcmp(dot, ".bend")) {
    cq_id_parse_bend(closure, path, data, size);
  } else if (!strcmp(dot, ".c") || !strcmp(dot, ".h")) {
    cq_id_parse_c(closure, path, data, size);
  }
}

static void cq_id_closure_run(CqIdClosure *closure) {
  while (!closure->error && closure->head < closure->queue.length) {
    char *candidate = closure->queue.items[closure->head++];
    char *resolved = realpath(candidate, NULL);
    if (!resolved) {
      closure->error = ENOENT;
      break;
    }
    if (!cq_id_inside(closure->root, resolved)) {
      free(resolved);
      closure->error = EINVAL;
      break;
    }
    if (cq_id_list_contains(&closure->visited, resolved)) {
      free(resolved);
      continue;
    }
    char *visited = cq_id_strdup(resolved);
    if (!visited || !cq_id_list_add(&closure->visited, visited)) {
      free(resolved);
      closure->error = ENOMEM;
      break;
    }
    char *data = NULL;
    size_t size = 0;
    int error = cq_id_read_file(resolved, &data, &size);
    if (error) {
      free(resolved);
      closure->error = error;
      break;
    }
    char digest[65];
    cq_id_hash_bytes(data, size, digest);
    char *relative = cq_id_relative(closure->root, resolved);
    if (!relative) {
      free(data);
      free(resolved);
      closure->error = ENOMEM;
      break;
    }
    char *record = cq_id_format("%s\t%s\t%llu", relative, digest,
                                (unsigned long long)size);
    free(relative);
    if (!record || !cq_id_list_add(&closure->records, record)) {
      free(data);
      free(resolved);
      closure->error = ENOMEM;
      break;
    }
    cq_id_closure_parse(closure, resolved, data, size);
    free(data);
    free(resolved);
  }
}

static char *cq_id_closure_text(const char *root, const char *entry,
                                const char *files) {
  CqIdClosure closure;
  memset(&closure, 0, sizeof closure);
  closure.root = realpath(root, NULL);
  if (!closure.root) return NULL;
  char *entry_relative = NULL;
  if (entry) {
    char *candidate = NULL;
    if (entry[0] == '/') {
      candidate = realpath(entry, NULL);
    } else {
      char *joined = cq_id_join(closure.root, entry);
      if (joined) {
        candidate = realpath(joined, NULL);
        free(joined);
      }
    }
    if (!candidate || !cq_id_inside(closure.root, candidate)) {
      free(candidate);
      cq_id_closure_free(&closure);
      return NULL;
    }
    entry_relative = cq_id_relative(closure.root, candidate);
    if (!entry_relative) {
      free(candidate);
      cq_id_closure_free(&closure);
      return NULL;
    }
    cq_id_enqueue(&closure, candidate);
    free(candidate);
  }
  if (files) {
    const char *start = files;
    while (*start) {
      const char *end = strchr(start, '\n');
      size_t length = end ? (size_t)(end - start) : strlen(start);
      if (length > 0) {
        char *name = (char *)malloc(length + 1);
        if (!name) {
          closure.error = ENOMEM;
          break;
        }
        memcpy(name, start, length);
        name[length] = '\0';
        char *candidate = NULL;
        if (name[0] == '/') {
          candidate = realpath(name, NULL);
        } else {
          char *joined = cq_id_join(closure.root, name);
          if (joined) {
            candidate = realpath(joined, NULL);
            free(joined);
          }
        }
        free(name);
        if (!candidate || !cq_id_inside(closure.root, candidate)) {
          free(candidate);
          closure.error = EINVAL;
          break;
        }
        cq_id_enqueue(&closure, candidate);
        free(candidate);
      }
      if (!end) break;
      start = end + 1;
    }
  }
  cq_id_closure_run(&closure);
  if (closure.error) {
    free(entry_relative);
    cq_id_closure_free(&closure);
    return NULL;
  }
  cq_id_list_sort_unique(&closure.records);
  CqIdBuffer out = {0, 0, 0, 0};
  cq_id_buf_adds(&out, "schema=baton-compile-queue-source-v2\n");
  if (entry_relative) {
    cq_id_buf_format(&out, "source-entry=%s\n", entry_relative);
    free(entry_relative);
  }
  for (size_t i = 0; i < closure.records.length; i++) {
    cq_id_buf_adds(&out, "source-file=");
    cq_id_buf_adds(&out, closure.records.items[i]);
    cq_id_buf_adds(&out, "\n");
  }
  cq_id_closure_free(&closure);
  if (out.error) {
    cq_id_buf_free(&out);
    return NULL;
  }
  return out.data;
}

/* ------------------------------------------------------------------------- */
/* Compiler and linker closure                                               */
/* ------------------------------------------------------------------------- */

static void cq_id_collect_all(CqIdList *list, const char *directory,
                              const char *prefix) {
  DIR *dir = opendir(directory);
  if (!dir) return;
  struct dirent *entry;
  while (!list->error && (entry = readdir(dir)) != NULL) {
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    char *full = cq_id_join(directory, entry->d_name);
    if (!full) {
      list->error = ENOMEM;
      break;
    }
    struct stat info;
    if (lstat(full, &info)) {
      free(full);
      continue;
    }
    char *child = cq_id_join(prefix, entry->d_name);
    if (!child) {
      free(full);
      list->error = ENOMEM;
      break;
    }
    if (S_ISDIR(info.st_mode)) {
      cq_id_collect_all(list, full, child);
      free(child);
    } else if (S_ISREG(info.st_mode)) {
      if (!cq_id_list_add(list, child)) list->error = ENOMEM;
    } else {
      free(child);
    }
    free(full);
  }
  closedir(dir);
}

static char *cq_id_chain(CqIdBuffer *out, const char *command,
                         const char *label) {
  char *current = cq_id_resolve_command(command);
  if (!current) {
    out->error = ENOMEM;
    return NULL;
  }
  char digest[65];
  if (cq_id_hash_file(current, digest)) digest[0] = '\0';
  cq_id_buf_format(out, "%s-entry=%s\n", label, digest);
  int steps = 0;
  while (steps < 5 && cq_id_is_file(current) && cq_id_is_script(current)) {
    char *target = cq_id_exec_target(current);
    if (!target || target[0] != '/') {
      free(target);
      break;
    }
    if (!cq_id_is_file(target)) {
      free(target);
      break;
    }
    char *next = realpath(target, NULL);
    free(target);
    if (!next) break;
    free(current);
    current = next;
    if (cq_id_hash_file(current, digest)) digest[0] = '\0';
    cq_id_buf_format(out, "%s-wrapper=%s\n", label, digest);
    steps++;
  }
  return current;
}

static char *cq_id_toolchain_text(const char *compiler, const char *linker,
                                  const char *version) {
  CqIdBuffer out = {0, 0, 0, 0};
  cq_id_buf_adds(&out, "schema=baton-compile-queue-toolchain-v2\n");
  if (!compiler[0]) {
    cq_id_buf_adds(&out, "compiler=none\n");
  } else {
    char *resolved = cq_id_chain(&out, compiler, "compiler");
    if (!resolved) {
      out.error = ENOMEM;
    } else {
      char *parent = cq_id_dirname(resolved);
      char *root = parent ? cq_id_dirname(parent) : NULL;
      free(parent);
      char *main_ts = root ? cq_id_join(root, "bend2/main.ts") : NULL;
      char *bun = root ? cq_id_join(root, "bin/bun") : NULL;
      if (main_ts && bun && cq_id_is_file(main_ts) && cq_id_is_file(bun)) {
        cq_id_buf_adds(&out, "toolchain-release=release\n");
        CqIdList files = {0, 0, 0, 0};
        char *bend = cq_id_join(root, "bend2");
        if (bend) {
          cq_id_collect_all(&files, bend, "bend2");
          free(bend);
        }
        struct stat info;
        if (!lstat(bun, &info) && S_ISREG(info.st_mode)) {
          cq_id_list_add(&files, cq_id_strdup("bin/bun"));
        }
        cq_id_list_sort_unique(&files);
        for (size_t i = 0; i < files.length; i++) {
          char *path = cq_id_join(root, files.items[i]);
          if (!path) {
            out.error = ENOMEM;
            break;
          }
          char hex[65];
          if (cq_id_hash_file(path, hex)) hex[0] = '\0';
          struct stat item;
          unsigned long long size = 0;
          if (!stat(path, &item)) size = (unsigned long long)item.st_size;
          cq_id_buf_format(&out, "toolchain-file=%s %s %llu\n",
                           files.items[i], hex, size);
          free(path);
        }
        cq_id_list_free(&files);
      } else {
        cq_id_buf_adds(&out, "toolchain-release=executable\n");
      }
      free(main_ts);
      free(bun);
      free(root);
      free(resolved);
    }
  }
  if (!linker[0]) {
    cq_id_buf_adds(&out, "linker=none\n");
  } else {
    char *resolved = cq_id_chain(&out, linker, "linker");
    free(resolved);
  }
  char version_sha[65];
  cq_id_hash_bytes(version, strlen(version), version_sha);
  cq_id_buf_format(&out, "compiler-version-sha=%s\n", version_sha);
  if (out.error) {
    cq_id_buf_free(&out);
    return NULL;
  }
  return out.data;
}

/* ------------------------------------------------------------------------- */
/* Effects                                                                   */
/* ------------------------------------------------------------------------- */

enum {
  CQ_ID_SOURCE_CLOSURE = 1,
  CQ_ID_SOURCE_DIGEST = 2,
  CQ_ID_FILE_CLOSURE = 3,
  CQ_ID_COMPILER_CLOSURE = 4,
  CQ_ID_FILE_DIGEST = 5,
  CQ_ID_TEXT_DIGEST = 6,
  CQ_ID_FILE_CLOSURE_DIGEST = 7,
  CQ_ID_COMPILER_CLOSURE_DIGEST = 8,
  CQ_ID_FILE_SIZE = 9,
  CQ_ID_LIST_DIR = 10,
  CQ_ID_REALPATH = 11,
  CQ_ID_READLINK = 12,
  CQ_ID_IS_SCRIPT = 13,
  CQ_ID_RESOLVE_COMMAND = 14
};

typedef struct {
  char *first;
  char *second;
  char *third;
  size_t first_length;
  int mode;
  int error;
  char *text;
} CqIdCall;

static void cq_id_call_free(CqIdCall *call) {
  free(call->first);
  free(call->second);
  free(call->third);
  free(call->text);
  free(call);
}

static void cq_id_call_work(IoWork *work) {
  CqIdCall *call = (CqIdCall *)work->data;
  switch (call->mode) {
    case CQ_ID_SOURCE_CLOSURE:
    case CQ_ID_SOURCE_DIGEST:
      call->text = cq_id_closure_text(call->first, call->second, NULL);
      break;
    case CQ_ID_FILE_CLOSURE:
    case CQ_ID_FILE_CLOSURE_DIGEST:
      call->text = cq_id_closure_text(call->first, NULL, call->second);
      break;
    case CQ_ID_COMPILER_CLOSURE:
    case CQ_ID_COMPILER_CLOSURE_DIGEST:
      call->text = cq_id_toolchain_text(call->first, call->second, call->third);
      break;
    case CQ_ID_FILE_DIGEST: {
      char hex[65];
      int error = cq_id_hash_file(call->first, hex);
      if (error) {
        call->error = error;
      } else {
        call->text = cq_id_strdup(hex);
      }
      break;
    }
    case CQ_ID_TEXT_DIGEST: {
      char hex[65];
      cq_id_hash_bytes(call->first, call->first_length, hex);
      call->text = cq_id_strdup(hex);
      break;
    }
    case CQ_ID_FILE_SIZE: {
      struct stat info;
      if (stat(call->first, &info)) {
        call->error = errno;
        break;
      }
      char text[32];
      snprintf(text, sizeof text, "%llu", (unsigned long long)info.st_size);
      call->text = cq_id_strdup(text);
      break;
    }
    case CQ_ID_LIST_DIR: {
      DIR *directory = opendir(call->first);
      if (!directory) {
        call->error = errno;
        break;
      }
      CqIdBuffer listing = {0, 0, 0, 0};
      struct dirent *entry;
      while ((entry = readdir(directory)) != NULL) {
        if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
        if (!cq_id_buf_adds(&listing, entry->d_name)
            || !cq_id_buf_adds(&listing, "\n")) {
          listing.error = ENOMEM;
          break;
        }
      }
      closedir(directory);
      if (listing.error) {
        call->error = listing.error;
        cq_id_buf_free(&listing);
        break;
      }
      if (!listing.data) {
        listing.data = cq_id_strdup("");
        if (!listing.data) {
          call->error = ENOMEM;
          break;
        }
      }
      call->text = listing.data;
      break;
    }
    case CQ_ID_REALPATH: {
      char *resolved = realpath(call->first, NULL);
      if (!resolved) call->error = errno;
      else call->text = resolved;
      break;
    }
    case CQ_ID_READLINK: {
      size_t capacity = 256;
      char *target = NULL;
      for (;;) {
        char *next = (char *)malloc(capacity);
        if (!next) {
          call->error = ENOMEM;
          break;
        }
        ssize_t length = readlink(call->first, next, capacity - 1);
        if (length < 0) {
          call->error = errno;
          free(next);
          free(target);
          break;
        }
        if ((size_t)length < capacity - 1) {
          next[length] = '\0';
          free(target);
          target = next;
          break;
        }
        free(next);
        free(target);
        target = NULL;
        capacity *= 2;
      }
      if (!call->error) call->text = target;
      break;
    }
    case CQ_ID_IS_SCRIPT: {
      int fd = open(call->first, O_RDONLY);
      if (fd < 0) {
        call->error = errno;
        break;
      }
      unsigned char magic[2];
      ssize_t count = read(fd, magic, sizeof magic);
      close(fd);
      call->text = cq_id_strdup(
        count == 2 && magic[0] == '#' && magic[1] == '!' ? "1" : "0");
      break;
    }
    case CQ_ID_RESOLVE_COMMAND:
      call->text = cq_id_resolve_command(call->first);
      break;
    default:
      call->error = EINVAL;
      break;
  }
  if (!call->error && !call->text) call->error = ENOMEM;
}

static Term cq_id_call_pack(Env env, IoWork *work) {
  CqIdCall *call = (CqIdCall *)work->data;
  Term result;
  if (call->error) {
    result = io_fail(env, call->error, NULL);
  } else if (call->mode == CQ_ID_SOURCE_DIGEST
             || call->mode == CQ_ID_FILE_CLOSURE_DIGEST
             || call->mode == CQ_ID_COMPILER_CLOSURE_DIGEST) {
    char hex[65];
    cq_id_hash_bytes(call->text, strlen(call->text), hex);
    result = io_done(env, io_str(env, hex, 64));
  } else {
    result = io_done(env, io_str(env, call->text, strlen(call->text)));
  }
  cq_id_call_free(call);
  work->data = NULL;
  return result;
}

static Term cq_id_source_run(Env env, Term *fields, IoWork *work, int mode) {
  CqIdCall *call = (CqIdCall *)calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->mode = mode;
  u64 first = 0, second = 0;
  call->first = io_cstr(env, fields[0], &first);
  call->second = io_cstr(env, fields[1], &second);
  if (!call->first || strlen(call->first) != first
      || !call->second || strlen(call->second) != second) {
    cq_id_call_free(call);
    return io_fail(env, EINVAL, "source path contains NUL");
  }
  work->data = call;
  return io_work(work, cq_id_call_work, cq_id_call_pack);
}

static Term cq_id_file_closure_run(Env env, Term *fields, IoWork *work) {
  CqIdCall *call = (CqIdCall *)calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->mode = CQ_ID_FILE_CLOSURE;
  u64 first = 0, second = 0;
  call->first = io_cstr(env, fields[0], &first);
  call->second = io_cstr(env, fields[1], &second);
  if (!call->first || strlen(call->first) != first
      || !call->second || strlen(call->second) != second) {
    cq_id_call_free(call);
    return io_fail(env, EINVAL, "closure path contains NUL");
  }
  work->data = call;
  return io_work(work, cq_id_call_work, cq_id_call_pack);
}

static Term cq_id_compiler_run(Env env, Term *fields, IoWork *work) {
  CqIdCall *call = (CqIdCall *)calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->mode = CQ_ID_COMPILER_CLOSURE;
  u64 first = 0, second = 0, third = 0;
  call->first = io_cstr(env, fields[0], &first);
  call->second = io_cstr(env, fields[1], &second);
  call->third = io_cstr(env, fields[2], &third);
  if (!call->first || strlen(call->first) != first
      || !call->second || strlen(call->second) != second
      || !call->third || strlen(call->third) != third) {
    cq_id_call_free(call);
    return io_fail(env, EINVAL, "compiler path contains NUL");
  }
  work->data = call;
  return io_work(work, cq_id_call_work, cq_id_call_pack);
}

static Term cq_id_file_digest_run(Env env, Term *fields, IoWork *work) {
  CqIdCall *call = (CqIdCall *)calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->mode = CQ_ID_FILE_DIGEST;
  u64 length = 0;
  call->first = io_cstr(env, fields[0], &length);
  if (!call->first || strlen(call->first) != length) {
    cq_id_call_free(call);
    return io_fail(env, EINVAL, "path contains NUL");
  }
  work->data = call;
  return io_work(work, cq_id_call_work, cq_id_call_pack);
}

static Term cq_id_text_digest_run(Env env, Term *fields, IoWork *work) {
  CqIdCall *call = (CqIdCall *)calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->mode = CQ_ID_TEXT_DIGEST;
  u64 length = 0;
  call->first = io_cstr(env, fields[0], &length);
  if (!call->first) {
    cq_id_call_free(call);
    return io_fail(env, ENOMEM, NULL);
  }
  call->first_length = (size_t)length;
  work->data = call;
  return io_work(work, cq_id_call_work, cq_id_call_pack);
}

static Term cq_id_file_size_run(Env env, Term *fields, IoWork *work) {
  CqIdCall *call = (CqIdCall *)calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->mode = CQ_ID_FILE_SIZE;
  u64 length = 0;
  call->first = io_cstr(env, fields[0], &length);
  if (!call->first || strlen(call->first) != length) {
    cq_id_call_free(call);
    return io_fail(env, EINVAL, "path contains NUL");
  }
  work->data = call;
  return io_work(work, cq_id_call_work, cq_id_call_pack);
}

static Term cq_id_file_closure_digest_run(Env env, Term *fields, IoWork *work) {
  CqIdCall *call = (CqIdCall *)calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->mode = CQ_ID_FILE_CLOSURE_DIGEST;
  u64 first = 0, second = 0;
  call->first = io_cstr(env, fields[0], &first);
  call->second = io_cstr(env, fields[1], &second);
  if (!call->first || strlen(call->first) != first
      || !call->second || strlen(call->second) != second) {
    cq_id_call_free(call);
    return io_fail(env, EINVAL, "closure path contains NUL");
  }
  work->data = call;
  return io_work(work, cq_id_call_work, cq_id_call_pack);
}

static Term cq_id_compiler_closure_digest_run(Env env, Term *fields,
                                              IoWork *work) {
  CqIdCall *call = (CqIdCall *)calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->mode = CQ_ID_COMPILER_CLOSURE_DIGEST;
  u64 first = 0, second = 0, third = 0;
  call->first = io_cstr(env, fields[0], &first);
  call->second = io_cstr(env, fields[1], &second);
  call->third = io_cstr(env, fields[2], &third);
  if (!call->first || strlen(call->first) != first
      || !call->second || strlen(call->second) != second
      || !call->third || strlen(call->third) != third) {
    cq_id_call_free(call);
    return io_fail(env, EINVAL, "compiler path contains NUL");
  }
  work->data = call;
  return io_work(work, cq_id_call_work, cq_id_call_pack);
}

#ifdef CID_COMPILEQUEUEIDENTITY_FILE_CLOSURE_DIGEST
static void __attribute__((constructor)) cq_id_file_closure_digest_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_FILE_CLOSURE_DIGEST,
         cq_id_file_closure_digest_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEIDENTITY_COMPILER_CLOSURE_DIGEST
static void __attribute__((constructor)) cq_id_compiler_closure_digest_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_COMPILER_CLOSURE_DIGEST,
         cq_id_compiler_closure_digest_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEDIGEST_FILE
static Term cq_digest_file_run(Env env, Term *fields, IoWork *work) {
  return cq_id_file_digest_run(env, fields, work);
}
static void __attribute__((constructor)) cq_digest_file_use(void) {
  io_eff(CID_COMPILEQUEUEDIGEST_FILE, cq_digest_file_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEDIGEST_TEXT
static Term cq_digest_text_run(Env env, Term *fields, IoWork *work) {
  return cq_id_text_digest_run(env, fields, work);
}
static void __attribute__((constructor)) cq_digest_text_use(void) {
  io_eff(CID_COMPILEQUEUEDIGEST_TEXT, cq_digest_text_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEIDENTITY_SOURCE_CLOSURE
static Term cq_id_source_closure_run(Env env, Term *fields, IoWork *work) {
  return cq_id_source_run(env, fields, work, CQ_ID_SOURCE_CLOSURE);
}
static void __attribute__((constructor)) cq_id_source_closure_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_SOURCE_CLOSURE, cq_id_source_closure_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEIDENTITY_SOURCE_DIGEST
static Term cq_id_source_digest_run(Env env, Term *fields, IoWork *work) {
  return cq_id_source_run(env, fields, work, CQ_ID_SOURCE_DIGEST);
}
static void __attribute__((constructor)) cq_id_source_digest_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_SOURCE_DIGEST, cq_id_source_digest_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEIDENTITY_FILE_CLOSURE
static void __attribute__((constructor)) cq_id_file_closure_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_FILE_CLOSURE, cq_id_file_closure_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEIDENTITY_COMPILER_CLOSURE
static void __attribute__((constructor)) cq_id_compiler_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_COMPILER_CLOSURE, cq_id_compiler_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEIDENTITY_FILE_DIGEST
static void __attribute__((constructor)) cq_id_file_digest_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_FILE_DIGEST, cq_id_file_digest_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEIDENTITY_TEXT_DIGEST
static void __attribute__((constructor)) cq_id_text_digest_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_TEXT_DIGEST, cq_id_text_digest_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEIDENTITY_FILE_SIZE
static void __attribute__((constructor)) cq_id_file_size_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_FILE_SIZE, cq_id_file_size_run, 0);
}
#endif

static Term cq_id_primitive_run(Env env, Term *fields, IoWork *work, int mode) {
  CqIdCall *call = (CqIdCall *)calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->mode = mode;
  u64 length = 0;
  call->first = io_cstr(env, fields[0], &length);
  if (!call->first || strlen(call->first) != length) {
    cq_id_call_free(call);
    return io_fail(env, EINVAL, "path contains NUL");
  }
  work->data = call;
  return io_work(work, cq_id_call_work, cq_id_call_pack);
}

#ifdef CID_COMPILEQUEUEIDENTITY_LIST_DIR
static Term cq_id_list_dir_run(Env env, Term *fields, IoWork *work) {
  return cq_id_primitive_run(env, fields, work, CQ_ID_LIST_DIR);
}
static void __attribute__((constructor)) cq_id_list_dir_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_LIST_DIR, cq_id_list_dir_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEIDENTITY_REALPATH
static Term cq_id_realpath_run(Env env, Term *fields, IoWork *work) {
  return cq_id_primitive_run(env, fields, work, CQ_ID_REALPATH);
}
static void __attribute__((constructor)) cq_id_realpath_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_REALPATH, cq_id_realpath_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEIDENTITY_READLINK
static Term cq_id_readlink_run(Env env, Term *fields, IoWork *work) {
  return cq_id_primitive_run(env, fields, work, CQ_ID_READLINK);
}
static void __attribute__((constructor)) cq_id_readlink_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_READLINK, cq_id_readlink_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEIDENTITY_IS_SCRIPT
static Term cq_id_is_script_run(Env env, Term *fields, IoWork *work) {
  return cq_id_primitive_run(env, fields, work, CQ_ID_IS_SCRIPT);
}
static void __attribute__((constructor)) cq_id_is_script_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_IS_SCRIPT, cq_id_is_script_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEIDENTITY_RESOLVE_COMMAND
static Term cq_id_resolve_command_run(Env env, Term *fields, IoWork *work) {
  return cq_id_primitive_run(env, fields, work, CQ_ID_RESOLVE_COMMAND);
}
static void __attribute__((constructor)) cq_id_resolve_command_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_RESOLVE_COMMAND, cq_id_resolve_command_run, 0);
}
#endif
