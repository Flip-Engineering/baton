/* Compile queue identity host primitives.
 *
 * The C layer exposes host facts only:
 *   - SHA-256 over text and files
 *   - file size
 *   - directory names (one per line)
 *   - realpath
 *   - readlink
 *   - is_script (two-byte read)
 *   - PATH/realpath command resolution
 *
 * Import/include parsing, closure membership and ordering, wrapper and release
 * layout policy, and toolchain identity composition live in
 * compile-queue-identity.bend.
 *
 * Effects follow the Bend module and function names:
 *   CompileQueueIdentity.realpath         -> CID_COMPILEQUEUEIDENTITY_REALPATH
 *   CompileQueueIdentity.resolve_command  -> CID_COMPILEQUEUEIDENTITY_RESOLVE_COMMAND
 *   CompileQueueIdentity.file_digest      -> CID_COMPILEQUEUEIDENTITY_FILE_DIGEST
 *   CompileQueueIdentity.text_digest      -> CID_COMPILEQUEUEIDENTITY_TEXT_DIGEST
 *   CompileQueueIdentity.file_size        -> CID_COMPILEQUEUEIDENTITY_FILE_SIZE
 *   CompileQueueIdentity.list_dir         -> CID_COMPILEQUEUEIDENTITY_LIST_DIR
 *   CompileQueueIdentity.readlink         -> CID_COMPILEQUEUEIDENTITY_READLINK
 *   CompileQueueIdentity.is_script        -> CID_COMPILEQUEUEIDENTITY_IS_SCRIPT
 *   CompileQueueDigest.file               -> CID_COMPILEQUEUEDIGEST_FILE
 *   CompileQueueDigest.text               -> CID_COMPILEQUEUEDIGEST_TEXT
 *
 * All primitives are POSIX C; no GNU-only facility is used.
 */
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
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

static char *cq_id_strdup(const char *text) {
  size_t length = strlen(text);
  char *copy = (char *)malloc(length + 1);
  if (!copy) return NULL;
  memcpy(copy, text, length + 1);
  return copy;
}

/* Host path resolution. PATH lookup is a host primitive; the caller decides
   which compiler or linker name to resolve and how to compose its identity. */
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
      size_t join = strlen(directory);
      int slash = join > 0 && directory[join - 1] != '/';
      char *candidate = (char *)malloc(join + (size_t)slash + strlen(command) + 1);
      if (!candidate) {
        free(directory);
        return cq_id_strdup(command);
      }
      memcpy(candidate, directory, join);
      if (slash) candidate[join++] = '/';
      memcpy(candidate + join, command, strlen(command) + 1);
      free(directory);
      if (access(candidate, X_OK) == 0) {
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

/* ------------------------------------------------------------------------- */
/* Effects                                                                   */
/* ------------------------------------------------------------------------- */

typedef struct {
  char *data;
  size_t length;
  size_t capacity;
  int error;
} CqIdBuffer;

enum {
  CQ_ID_REALPATH = 1,
  CQ_ID_RESOLVE_COMMAND = 2,
  CQ_ID_FILE_DIGEST = 3,
  CQ_ID_TEXT_DIGEST = 4,
  CQ_ID_FILE_SIZE = 5,
  CQ_ID_LIST_DIR = 6,
  CQ_ID_READLINK = 7,
  CQ_ID_IS_SCRIPT = 8
};

typedef struct {
  char *first;
  size_t first_length;
  int mode;
  int error;
  char *text;
} CqIdCall;

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

static void cq_id_call_free(CqIdCall *call) {
  free(call->first);
  free(call->text);
  free(call);
}

static void cq_id_call_work(IoWork *work) {
  CqIdCall *call = (CqIdCall *)work->data;
  switch (call->mode) {
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
    case CQ_ID_FILE_DIGEST: {
      char hex[65];
      int error = cq_id_hash_file(call->first, hex);
      if (error) call->error = error;
      else call->text = cq_id_strdup(hex);
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
    default:
      call->error = EINVAL;
      break;
  }
  if (!call->error && !call->text) call->error = ENOMEM;
}

static Term cq_id_call_pack(Env env, IoWork *work) {
  CqIdCall *call = (CqIdCall *)work->data;
  Term result = call->error
    ? io_fail(env, call->error, NULL)
    : io_done(env, io_str(env, call->text, strlen(call->text)));
  cq_id_call_free(call);
  work->data = NULL;
  return result;
}

static Term cq_id_path_run(Env env, Term *fields, IoWork *work, int mode) {
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

static Term cq_id_text_run(Env env, Term *fields, IoWork *work) {
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

#ifdef CID_COMPILEQUEUEIDENTITY_REALPATH
static Term cq_id_realpath_run(Env env, Term *fields, IoWork *work) {
  return cq_id_path_run(env, fields, work, CQ_ID_REALPATH);
}
static void __attribute__((constructor)) cq_id_realpath_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_REALPATH, cq_id_realpath_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEIDENTITY_RESOLVE_COMMAND
static Term cq_id_resolve_run(Env env, Term *fields, IoWork *work) {
  return cq_id_path_run(env, fields, work, CQ_ID_RESOLVE_COMMAND);
}
static void __attribute__((constructor)) cq_id_resolve_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_RESOLVE_COMMAND, cq_id_resolve_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEIDENTITY_FILE_DIGEST
static Term cq_id_file_digest_run(Env env, Term *fields, IoWork *work) {
  return cq_id_path_run(env, fields, work, CQ_ID_FILE_DIGEST);
}
static void __attribute__((constructor)) cq_id_file_digest_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_FILE_DIGEST, cq_id_file_digest_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEIDENTITY_TEXT_DIGEST
static void __attribute__((constructor)) cq_id_text_digest_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_TEXT_DIGEST, cq_id_text_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEIDENTITY_FILE_SIZE
static Term cq_id_file_size_run(Env env, Term *fields, IoWork *work) {
  return cq_id_path_run(env, fields, work, CQ_ID_FILE_SIZE);
}
static void __attribute__((constructor)) cq_id_file_size_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_FILE_SIZE, cq_id_file_size_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEIDENTITY_LIST_DIR
static Term cq_id_list_dir_run(Env env, Term *fields, IoWork *work) {
  return cq_id_path_run(env, fields, work, CQ_ID_LIST_DIR);
}
static void __attribute__((constructor)) cq_id_list_dir_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_LIST_DIR, cq_id_list_dir_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEIDENTITY_READLINK
static Term cq_id_readlink_run(Env env, Term *fields, IoWork *work) {
  return cq_id_path_run(env, fields, work, CQ_ID_READLINK);
}
static void __attribute__((constructor)) cq_id_readlink_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_READLINK, cq_id_readlink_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEIDENTITY_IS_SCRIPT
static Term cq_id_is_script_run(Env env, Term *fields, IoWork *work) {
  return cq_id_path_run(env, fields, work, CQ_ID_IS_SCRIPT);
}
static void __attribute__((constructor)) cq_id_is_script_use(void) {
  io_eff(CID_COMPILEQUEUEIDENTITY_IS_SCRIPT, cq_id_is_script_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEDIGEST_FILE
static Term cq_digest_file_run(Env env, Term *fields, IoWork *work) {
  return cq_id_path_run(env, fields, work, CQ_ID_FILE_DIGEST);
}
static void __attribute__((constructor)) cq_digest_file_use(void) {
  io_eff(CID_COMPILEQUEUEDIGEST_FILE, cq_digest_file_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUEDIGEST_TEXT
static void __attribute__((constructor)) cq_digest_text_use(void) {
  io_eff(CID_COMPILEQUEUEDIGEST_TEXT, cq_id_text_run, 0);
}
#endif
