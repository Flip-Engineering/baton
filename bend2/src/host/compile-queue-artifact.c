/* Compile queue artifact bindings.
 *
 * Effect names follow the Bend module and function names:
 *   CompileQueueArtifact.kind     -> CID_COMPILEQUEUEARTIFACT_KIND
 *   CompileQueueArtifact.digest   -> CID_COMPILEQUEUEARTIFACT_DIGEST
 *   CompileQueueArtifact.copy     -> CID_COMPILEQUEUEARTIFACT_COPY
 *   CompileQueueArtifact.install  -> CID_COMPILEQUEUEARTIFACT_INSTALL
 *
 * Directory trees are hashed as sorted `./relative/path <sha256>` lines over
 * regular files, so verification covers the tree contents rather than only
 * the directory's existence. Install copies into a caller-supplied fresh
 * staging path, then publishes it with rename. A directory destination is
 * moved to a backup name and the staged tree is renamed into place; the old
 * tree is removed only after the new tree is installed, so a failed install
 * never leaves the destination deleted.
 *
 * POSIX C only: Linux and macOS use the same helpers.
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
} CqArtSha;

static const uint32_t cq_art_k[64] = {
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

static uint32_t cq_art_rotr(uint32_t value, unsigned count) {
  return (value >> count) | (value << (32u - count));
}

static void cq_art_sha_block(CqArtSha *sha, const unsigned char *block) {
  uint32_t w[64];
  for (int i = 0; i < 16; i++) {
    w[i] = ((uint32_t)block[i * 4] << 24)
      | ((uint32_t)block[i * 4 + 1] << 16)
      | ((uint32_t)block[i * 4 + 2] << 8)
      | (uint32_t)block[i * 4 + 3];
  }
  for (int i = 16; i < 64; i++) {
    uint32_t s0 = cq_art_rotr(w[i - 15], 7) ^ cq_art_rotr(w[i - 15], 18)
      ^ (w[i - 15] >> 3);
    uint32_t s1 = cq_art_rotr(w[i - 2], 17) ^ cq_art_rotr(w[i - 2], 19)
      ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  uint32_t a = sha->state[0], b = sha->state[1], c = sha->state[2];
  uint32_t d = sha->state[3], e = sha->state[4], f = sha->state[5];
  uint32_t g = sha->state[6], h = sha->state[7];
  for (int i = 0; i < 64; i++) {
    uint32_t s1 = cq_art_rotr(e, 6) ^ cq_art_rotr(e, 11) ^ cq_art_rotr(e, 25);
    uint32_t ch = (e & f) ^ ((~e) & g);
    uint32_t t1 = h + s1 + ch + cq_art_k[i] + w[i];
    uint32_t s0 = cq_art_rotr(a, 2) ^ cq_art_rotr(a, 13) ^ cq_art_rotr(a, 22);
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

static void cq_art_sha_init(CqArtSha *sha) {
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

static void cq_art_sha_update(CqArtSha *sha, const void *data, size_t length) {
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
      cq_art_sha_block(sha, sha->block);
      sha->used = 0;
    }
  }
}

static void cq_art_sha_final(CqArtSha *sha, unsigned char digest[32]) {
  uint64_t bits = sha->bits;
  size_t used = sha->used;
  sha->block[used++] = 0x80;
  if (used > 56) {
    while (used < 64) sha->block[used++] = 0;
    cq_art_sha_block(sha, sha->block);
    used = 0;
  }
  while (used < 56) sha->block[used++] = 0;
  for (int i = 0; i < 8; i++) {
    sha->block[56 + i] = (unsigned char)(bits >> (56 - i * 8));
  }
  cq_art_sha_block(sha, sha->block);
  for (int i = 0; i < 8; i++) {
    digest[i * 4] = (unsigned char)(sha->state[i] >> 24);
    digest[i * 4 + 1] = (unsigned char)(sha->state[i] >> 16);
    digest[i * 4 + 2] = (unsigned char)(sha->state[i] >> 8);
    digest[i * 4 + 3] = (unsigned char)sha->state[i];
  }
}

static void cq_art_hex(const unsigned char digest[32], char hex[65]) {
  static const char digits[] = "0123456789abcdef";
  for (int i = 0; i < 32; i++) {
    hex[i * 2] = digits[digest[i] >> 4];
    hex[i * 2 + 1] = digits[digest[i] & 15];
  }
  hex[64] = '\0';
}

static void cq_art_hash_bytes(const void *data, size_t length, char hex[65]) {
  CqArtSha sha;
  unsigned char digest[32];
  cq_art_sha_init(&sha);
  cq_art_sha_update(&sha, data, length);
  cq_art_sha_final(&sha, digest);
  cq_art_hex(digest, hex);
}

static int cq_art_hash_file(const char *path, char hex[65]) {
  int fd = open(path, O_RDONLY);
  if (fd < 0) return errno;
  CqArtSha sha;
  unsigned char digest[32];
  unsigned char chunk[65536];
  cq_art_sha_init(&sha);
  for (;;) {
    ssize_t count = read(fd, chunk, sizeof chunk);
    if (count > 0) {
      cq_art_sha_update(&sha, chunk, (size_t)count);
      continue;
    }
    if (count == 0) break;
    if (errno == EINTR) continue;
    int error = errno;
    close(fd);
    return error;
  }
  if (close(fd)) return errno;
  cq_art_sha_final(&sha, digest);
  cq_art_hex(digest, hex);
  return 0;
}

/* ------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------- */

typedef struct {
  char *data;
  size_t length;
  size_t capacity;
  int error;
} CqArtBuffer;

typedef struct {
  char **items;
  size_t length;
  size_t capacity;
  int error;
} CqArtList;

static void cq_art_buf_free(CqArtBuffer *buffer) {
  free(buffer->data);
  buffer->data = NULL;
  buffer->length = buffer->capacity = 0;
}

static int cq_art_buf_reserve(CqArtBuffer *buffer, size_t extra) {
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

static int cq_art_buf_add(CqArtBuffer *buffer, const char *text, size_t length) {
  if (!cq_art_buf_reserve(buffer, length)) return 0;
  memcpy(buffer->data + buffer->length, text, length);
  buffer->length += length;
  buffer->data[buffer->length] = '\0';
  return 1;
}

static int cq_art_buf_adds(CqArtBuffer *buffer, const char *text) {
  return cq_art_buf_add(buffer, text, strlen(text));
}

static int cq_art_buf_format(CqArtBuffer *buffer, const char *format, ...) {
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
    return cq_art_buf_add(buffer, small, (size_t)length);
  }
  char *large = (char *)malloc((size_t)length + 1);
  if (!large) {
    buffer->error = ENOMEM;
    return 0;
  }
  va_start(args, format);
  vsnprintf(large, (size_t)length + 1, format, args);
  va_end(args);
  int ok = cq_art_buf_add(buffer, large, (size_t)length);
  free(large);
  return ok;
}

static char *cq_art_strdup(const char *text) {
  size_t length = strlen(text);
  char *copy = (char *)malloc(length + 1);
  if (!copy) return NULL;
  memcpy(copy, text, length + 1);
  return copy;
}

static int cq_art_list_add(CqArtList *list, char *item) {
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

static int cq_art_list_compare(const void *left, const void *right) {
  return strcmp(*(char *const *)left, *(char *const *)right);
}

static void cq_art_list_sort(CqArtList *list) {
  if (list->error || list->length < 2) return;
  qsort(list->items, list->length, sizeof(*list->items), cq_art_list_compare);
}

static void cq_art_list_free(CqArtList *list) {
  for (size_t i = 0; i < list->length; i++) free(list->items[i]);
  free(list->items);
  list->items = NULL;
  list->length = list->capacity = 0;
}

static char *cq_art_join(const char *directory, const char *name) {
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

static void cq_art_collect(CqArtList *list, const char *directory,
                           const char *prefix) {
  DIR *dir = opendir(directory);
  if (!dir) return;
  struct dirent *entry;
  while (!list->error && (entry = readdir(dir)) != NULL) {
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    char *full = cq_art_join(directory, entry->d_name);
    if (!full) {
      list->error = ENOMEM;
      break;
    }
    struct stat info;
    if (lstat(full, &info)) {
      free(full);
      continue;
    }
    char *child = cq_art_join(prefix, entry->d_name);
    if (!child) {
      free(full);
      list->error = ENOMEM;
      break;
    }
    if (S_ISDIR(info.st_mode)) {
      cq_art_collect(list, full, child);
      free(child);
    } else if (S_ISREG(info.st_mode)) {
      if (!cq_art_list_add(list, child)) list->error = ENOMEM;
    } else {
      free(child);
    }
    free(full);
  }
  closedir(dir);
}

static int cq_art_is_dir(const char *path) {
  struct stat info;
  return !stat(path, &info) && S_ISDIR(info.st_mode);
}

static int cq_art_remove(const char *path) {
  struct stat info;
  if (lstat(path, &info)) return errno == ENOENT ? 0 : errno;
  if (S_ISDIR(info.st_mode)) {
    DIR *dir = opendir(path);
    if (!dir) return errno;
    struct dirent *entry;
    int error = 0;
    while ((entry = readdir(dir)) != NULL) {
      if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
      char *child = cq_art_join(path, entry->d_name);
      if (!child) {
        error = ENOMEM;
        break;
      }
      error = cq_art_remove(child);
      free(child);
      if (error) break;
    }
    closedir(dir);
    if (error) return error;
    return rmdir(path) ? errno : 0;
  }
  return unlink(path) ? errno : 0;
}

static int cq_art_copy_path(const char *source, const char *destination,
                            const struct stat *info) {
  if (S_ISREG(info->st_mode)) {
    int input = open(source, O_RDONLY);
    if (input < 0) return errno;
    int output = open(destination, O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (output < 0) {
      int error = errno;
      close(input);
      return error;
    }
    unsigned char chunk[65536];
    int error = 0;
    for (;;) {
      ssize_t count = read(input, chunk, sizeof chunk);
      if (count > 0) {
        size_t offset = 0;
        while (offset < (size_t)count) {
          ssize_t written = write(output, chunk + offset,
                                  (size_t)count - offset);
          if (written > 0) {
            offset += (size_t)written;
            continue;
          }
          if (written < 0 && errno == EINTR) continue;
          error = written < 0 ? errno : EIO;
          break;
        }
        if (error) break;
        continue;
      }
      if (count == 0) break;
      if (errno == EINTR) continue;
      error = errno;
      break;
    }
    if (!error && close(output)) error = errno;
    else if (error) close(output);
    if (!error && chmod(destination, info->st_mode & 07777)) {
      error = errno;
    }
    close(input);
    return error;
  }
  if (S_ISDIR(info->st_mode)) {
    if (mkdir(destination, info->st_mode & 07777)) {
      if (errno != EEXIST || !cq_art_is_dir(destination)) return errno;
    }
    DIR *dir = opendir(source);
    if (!dir) return errno;
    struct dirent *entry;
    int error = 0;
    while ((entry = readdir(dir)) != NULL) {
      if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
      char *from = cq_art_join(source, entry->d_name);
      char *to = cq_art_join(destination, entry->d_name);
      if (!from || !to) {
        free(from);
        free(to);
        error = ENOMEM;
        break;
      }
      struct stat child;
      if (lstat(from, &child)) {
        error = errno;
      } else {
        error = cq_art_copy_path(from, to, &child);
      }
      free(from);
      free(to);
      if (error) break;
    }
    closedir(dir);
    if (!error && chmod(destination, info->st_mode & 07777)) error = errno;
    return error;
  }
#ifdef S_ISLNK
  if (S_ISLNK(info->st_mode)) {
    size_t capacity = 256;
    char *target = NULL;
    for (;;) {
      char *next = (char *)malloc(capacity);
      if (!next) return ENOMEM;
      ssize_t length = readlink(source, next, capacity - 1);
      if (length < 0) {
        int error = errno;
        free(next);
        free(target);
        return error;
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
    int error = symlink(target, destination) ? errno : 0;
    free(target);
    return error;
  }
#endif
  return EINVAL;
}

/* ------------------------------------------------------------------------- */
/* Effects                                                                   */
/* ------------------------------------------------------------------------- */

enum {
  CQ_ART_KIND = 1,
  CQ_ART_DIGEST = 2,
  CQ_ART_COPY = 3,
  CQ_ART_INSTALL = 4
};

typedef struct {
  char *first;
  char *second;
  char *third;
  int mode;
  int error;
  char answer[16];
  char *text;
} CqArtCall;

static void cq_art_call_free(CqArtCall *call) {
  free(call->first);
  free(call->second);
  free(call->third);
  free(call->text);
  free(call);
}

static void cq_art_call_work(IoWork *work) {
  CqArtCall *call = (CqArtCall *)work->data;
  switch (call->mode) {
    case CQ_ART_KIND: {
      struct stat info;
      if (!stat(call->first, &info)) {
        if (S_ISREG(info.st_mode)) strcpy(call->answer, "file");
        else if (S_ISDIR(info.st_mode)) strcpy(call->answer, "directory");
        else strcpy(call->answer, "other");
      } else if (errno == ENOENT) {
        strcpy(call->answer, "missing");
      } else {
        strcpy(call->answer, "other");
      }
      break;
    }
    case CQ_ART_DIGEST: {
      struct stat info;
      if (stat(call->first, &info)) {
        call->error = errno;
        break;
      }
      char hex[65];
      if (!S_ISDIR(info.st_mode)) {
        int error = cq_art_hash_file(call->first, hex);
        if (error) {
          call->error = error;
          break;
        }
        call->text = cq_art_strdup(hex);
        break;
      }
      CqArtList files = {0, 0, 0, 0};
      cq_art_collect(&files, call->first, ".");
      if (files.error) {
        cq_art_list_free(&files);
        call->error = files.error;
        break;
      }
      cq_art_list_sort(&files);
      CqArtBuffer tree = {0, 0, 0, 0};
      for (size_t i = 0; i < files.length; i++) {
        char *path = cq_art_join(call->first, files.items[i]);
        if (!path) {
          tree.error = ENOMEM;
          break;
        }
        char item[65];
        int error = cq_art_hash_file(path, item);
        free(path);
        if (error) {
          tree.error = error;
          break;
        }
        cq_art_buf_format(&tree, "%s %s\n", files.items[i], item);
      }
      cq_art_list_free(&files);
      if (tree.error) {
        call->error = tree.error;
        cq_art_buf_free(&tree);
        break;
      }
      cq_art_hash_bytes(tree.data ? tree.data : "", tree.length, hex);
      cq_art_buf_free(&tree);
      call->text = cq_art_strdup(hex);
      break;
    }
    case CQ_ART_COPY: {
      struct stat info;
      if (lstat(call->first, &info)) {
        call->error = errno;
        break;
      }
      int error = cq_art_copy_path(call->first, call->second, &info);
      if (error) call->error = error;
      break;
    }
    case CQ_ART_INSTALL: {
      struct stat info;
      if (lstat(call->first, &info)) {
        call->error = errno;
        break;
      }
      struct stat staged;
      if (!lstat(call->third, &staged)) {
        call->error = EEXIST;
        break;
      }
      int error = cq_art_copy_path(call->first, call->third, &info);
      if (error) {
        call->error = error;
        break;
      }
      struct stat existing;
      int present = !lstat(call->second, &existing);
      if (S_ISDIR(info.st_mode) && present) {
        size_t length = strlen(call->third);
        char *backup = (char *)malloc(length + 10);
        if (!backup) {
          call->error = ENOMEM;
          break;
        }
        memcpy(backup, call->third, length);
        memcpy(backup + length, ".previous", 10);
        error = cq_art_remove(backup);
        if (!error) error = rename(call->second, backup);
        if (error) {
          free(backup);
          call->error = error;
          break;
        }
        if (rename(call->third, call->second)) {
          error = errno;
          rename(backup, call->second);
          free(backup);
          call->error = error;
          break;
        }
        cq_art_remove(backup);
        free(backup);
      } else if (rename(call->third, call->second)) {
        call->error = errno;
      }
      break;
    }
    default:
      call->error = EINVAL;
      break;
  }
  if (!call->error && (call->mode == CQ_ART_DIGEST) && !call->text) {
    call->error = ENOMEM;
  }
}

static Term cq_art_call_pack(Env env, IoWork *work) {
  CqArtCall *call = (CqArtCall *)work->data;
  Term result;
  if (call->error) {
    result = io_fail(env, call->error, NULL);
  } else if (call->mode == CQ_ART_KIND) {
    result = io_done(env, io_str(env, call->answer, strlen(call->answer)));
  } else if (call->mode == CQ_ART_DIGEST) {
    result = io_done(env, io_str(env, call->text, strlen(call->text)));
  } else {
    result = io_done(env, term_pak(CID_UNIT, 0));
  }
  cq_art_call_free(call);
  work->data = NULL;
  return result;
}

static int cq_art_take(CqArtCall *call, Env env, Term *fields, int count) {
  u64 lengths[3] = {0, 0, 0};
  call->first = io_cstr(env, fields[0], &lengths[0]);
  if (!call->first || strlen(call->first) != lengths[0]) return EINVAL;
  if (count > 1) {
    call->second = io_cstr(env, fields[1], &lengths[1]);
    if (!call->second || strlen(call->second) != lengths[1]) return EINVAL;
  }
  if (count > 2) {
    call->third = io_cstr(env, fields[2], &lengths[2]);
    if (!call->third || strlen(call->third) != lengths[2]) return EINVAL;
  }
  return 0;
}

static Term cq_art_run(Env env, Term *fields, IoWork *work, int mode, int count) {
  CqArtCall *call = (CqArtCall *)calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->mode = mode;
  int error = cq_art_take(call, env, fields, count);
  if (error) {
    cq_art_call_free(call);
    return io_fail(env, EINVAL, "artifact path contains NUL");
  }
  work->data = call;
  return io_work(work, cq_art_call_work, cq_art_call_pack);
}

#ifdef CID_COMPILEQUEUEARTIFACT_KIND
static Term cq_art_kind_run(Env env, Term *fields, IoWork *work) {
  return cq_art_run(env, fields, work, CQ_ART_KIND, 1);
}
static void __attribute__((constructor)) cq_art_kind_use(void) {
  io_eff(CID_COMPILEQUEUEARTIFACT_KIND, cq_art_kind_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEARTIFACT_DIGEST
static Term cq_art_digest_run(Env env, Term *fields, IoWork *work) {
  return cq_art_run(env, fields, work, CQ_ART_DIGEST, 1);
}
static void __attribute__((constructor)) cq_art_digest_use(void) {
  io_eff(CID_COMPILEQUEUEARTIFACT_DIGEST, cq_art_digest_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEARTIFACT_COPY
static Term cq_art_copy_run(Env env, Term *fields, IoWork *work) {
  return cq_art_run(env, fields, work, CQ_ART_COPY, 2);
}
static void __attribute__((constructor)) cq_art_copy_use(void) {
  io_eff(CID_COMPILEQUEUEARTIFACT_COPY, cq_art_copy_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEARTIFACT_INSTALL
static Term cq_art_install_run(Env env, Term *fields, IoWork *work) {
  return cq_art_run(env, fields, work, CQ_ART_INSTALL, 3);
}
static void __attribute__((constructor)) cq_art_install_use(void) {
  io_eff(CID_COMPILEQUEUEARTIFACT_INSTALL, cq_art_install_run, 0);
}
#endif
