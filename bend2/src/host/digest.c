#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct {
  uint32_t state[8];
  uint64_t bits;
  unsigned char block[64];
  size_t used;
} HostSha;

static const uint32_t host_sha_k[64] = {
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

static uint32_t host_sha_rotr(uint32_t value, unsigned count) {
  return (value >> count) | (value << (32u - count));
}

static void host_sha_sha_block(HostSha *sha, const unsigned char *block) {
  uint32_t w[64];
  for (int i = 0; i < 16; i++) {
    w[i] = ((uint32_t)block[i * 4] << 24)
      | ((uint32_t)block[i * 4 + 1] << 16)
      | ((uint32_t)block[i * 4 + 2] << 8)
      | (uint32_t)block[i * 4 + 3];
  }
  for (int i = 16; i < 64; i++) {
    uint32_t s0 = host_sha_rotr(w[i - 15], 7) ^ host_sha_rotr(w[i - 15], 18)
      ^ (w[i - 15] >> 3);
    uint32_t s1 = host_sha_rotr(w[i - 2], 17) ^ host_sha_rotr(w[i - 2], 19)
      ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  uint32_t a = sha->state[0], b = sha->state[1], c = sha->state[2];
  uint32_t d = sha->state[3], e = sha->state[4], f = sha->state[5];
  uint32_t g = sha->state[6], h = sha->state[7];
  for (int i = 0; i < 64; i++) {
    uint32_t s1 = host_sha_rotr(e, 6) ^ host_sha_rotr(e, 11) ^ host_sha_rotr(e, 25);
    uint32_t ch = (e & f) ^ ((~e) & g);
    uint32_t t1 = h + s1 + ch + host_sha_k[i] + w[i];
    uint32_t s0 = host_sha_rotr(a, 2) ^ host_sha_rotr(a, 13) ^ host_sha_rotr(a, 22);
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

static void host_sha_sha_init(HostSha *sha) {
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

static void host_sha_sha_update(HostSha *sha, const void *data, size_t length) {
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
      host_sha_sha_block(sha, sha->block);
      sha->used = 0;
    }
  }
}

static void host_sha_sha_final(HostSha *sha, unsigned char digest[32]) {
  uint64_t bits = sha->bits;
  size_t used = sha->used;
  sha->block[used++] = 0x80;
  if (used > 56) {
    while (used < 64) sha->block[used++] = 0;
    host_sha_sha_block(sha, sha->block);
    used = 0;
  }
  while (used < 56) sha->block[used++] = 0;
  for (int i = 0; i < 8; i++) {
    sha->block[56 + i] = (unsigned char)(bits >> (56 - i * 8));
  }
  host_sha_sha_block(sha, sha->block);
  for (int i = 0; i < 8; i++) {
    digest[i * 4] = (unsigned char)(sha->state[i] >> 24);
    digest[i * 4 + 1] = (unsigned char)(sha->state[i] >> 16);
    digest[i * 4 + 2] = (unsigned char)(sha->state[i] >> 8);
    digest[i * 4 + 3] = (unsigned char)sha->state[i];
  }
}

static void host_sha_hex(const unsigned char digest[32], char hex[65]) {
  static const char digits[] = "0123456789abcdef";
  for (int i = 0; i < 32; i++) {
    hex[i * 2] = digits[digest[i] >> 4];
    hex[i * 2 + 1] = digits[digest[i] & 15];
  }
  hex[64] = '\0';
}

static void host_sha_hash_bytes(const void *data, size_t length, char hex[65]) {
  HostSha sha;
  unsigned char digest[32];
  host_sha_sha_init(&sha);
  host_sha_sha_update(&sha, data, length);
  host_sha_sha_final(&sha, digest);
  host_sha_hex(digest, hex);
}

static int host_sha_hash_file(const char *path, char hex[65]) {
  int fd = open(path, O_RDONLY);
  if (fd < 0) return errno;
  HostSha sha;
  unsigned char digest[32];
  unsigned char chunk[65536];
  host_sha_sha_init(&sha);
  for (;;) {
    ssize_t count = read(fd, chunk, sizeof chunk);
    if (count > 0) {
      host_sha_sha_update(&sha, chunk, (size_t)count);
      continue;
    }
    if (count == 0) break;
    if (errno == EINTR) continue;
    int error = errno;
    close(fd);
    return error;
  }
  if (close(fd)) return errno;
  host_sha_sha_final(&sha, digest);
  host_sha_hex(digest, hex);
  return 0;
}


typedef struct { char *value; size_t length; int file,error; char digest[65]; } HostDigestCall;

static void host_digest_work(IoWork *work) {
  HostDigestCall *call=(HostDigestCall *)work->data;
  if(call->file) call->error=host_sha_hash_file(call->value,call->digest);
  else host_sha_hash_bytes(call->value,call->length,call->digest);
}

static Term host_digest_pack(Env env,IoWork *work) {
  HostDigestCall *call=(HostDigestCall *)work->data;
  Term result=call->error ? io_fail(env,call->error,NULL)
    : io_done(env,io_str(env,call->digest,64));
  free(call->value);free(call);work->data=NULL;
  return result;
}

static Term host_digest_run(Env env,Term *fields,IoWork *work,int file) {
  HostDigestCall *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(env,ENOMEM,NULL);
  call->file=file;
  u64 length=0;
  call->value=io_cstr(env,fields[0],&length);
  call->length=(size_t)length;
  if(!call->value) {free(call);return io_fail(env,ENOMEM,NULL);}
  if(file && strlen(call->value)!=call->length) {
    free(call->value);free(call);return io_fail(env,EINVAL,"path contains NUL");
  }
  work->data=(char *)call;
  return io_work(work,host_digest_work,host_digest_pack);
}

#ifdef CID_HOSTDIGEST_TEXT
static Term host_digest_text_run(Env env,Term *fields,IoWork *work) {
  return host_digest_run(env,fields,work,0);
}
static void __attribute__((constructor)) host_digest_text_use(void) {
  io_eff(CID_HOSTDIGEST_TEXT,host_digest_text_run,0);
}
#endif
#ifdef CID_HOSTDIGEST_FILE
static Term host_digest_file_run(Env env,Term *fields,IoWork *work) {
  return host_digest_run(env,fields,work,1);
}
static void __attribute__((constructor)) host_digest_file_use(void) {
  io_eff(CID_HOSTDIGEST_FILE,host_digest_file_run,0);
}
#endif
