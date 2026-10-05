/* The role guard digest of the managed semantic context lifecycle. The Bend
   declaration `def Context.role_guard_key` imports this file; the effect returns
   64 lowercase hexadecimal characters of the SHA-256 over the identity's exact
   UTF-8 bytes. The implementation is self-contained so the digest does not
   depend on a platform crypto library. */
#include <errno.h>
#include <string.h>

typedef struct {
  unsigned char data[64];
  unsigned int datalen;
  unsigned long long bitlen;
  unsigned int state[8];
} BatonSha256;

static const unsigned int baton_sha256_k[64] = {
  0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,0x3956c25bu,0x59f111f1u,0x923f82a4u,0xab1c5ed5u,
  0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,
  0xe49b69c1u,0xefbe4786u,0x0fc19dc6u,0x240ca1ccu,0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,
  0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,0xc6e00bf3u,0xd5a79147u,0x06ca6351u,0x14292967u,
  0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,
  0xa2bfe8a1u,0xa81a664bu,0xc24b8b70u,0xc76c51a3u,0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,
  0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,0x391c0cb3u,0x4ed8aa4au,0x5b9cca4fu,0x682e6ff3u,
  0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u
};

static unsigned int baton_sha256_ror(unsigned int x, unsigned int n) {
  return (x >> n) | (x << (32u - n));
}

static void baton_sha256_block(BatonSha256 *ctx, const unsigned char *p) {
  unsigned int w[64];
  for (int i = 0; i < 16; i++)
    w[i] = ((unsigned int)p[i*4] << 24) | ((unsigned int)p[i*4+1] << 16) |
           ((unsigned int)p[i*4+2] << 8) | (unsigned int)p[i*4+3];
  for (int i = 16; i < 64; i++) {
    unsigned int s0 = baton_sha256_ror(w[i-15], 7) ^ baton_sha256_ror(w[i-15], 18) ^ (w[i-15] >> 3);
    unsigned int s1 = baton_sha256_ror(w[i-2], 17) ^ baton_sha256_ror(w[i-2], 19) ^ (w[i-2] >> 10);
    w[i] = w[i-16] + s0 + w[i-7] + s1;
  }
  unsigned int a = ctx->state[0], b = ctx->state[1], c = ctx->state[2], d = ctx->state[3];
  unsigned int e = ctx->state[4], f = ctx->state[5], g = ctx->state[6], h = ctx->state[7];
  for (int i = 0; i < 64; i++) {
    unsigned int s1 = baton_sha256_ror(e, 6) ^ baton_sha256_ror(e, 11) ^ baton_sha256_ror(e, 25);
    unsigned int ch = (e & f) ^ ((~e) & g);
    unsigned int t1 = h + s1 + ch + baton_sha256_k[i] + w[i];
    unsigned int s0 = baton_sha256_ror(a, 2) ^ baton_sha256_ror(a, 13) ^ baton_sha256_ror(a, 22);
    unsigned int maj = (a & b) ^ (a & c) ^ (b & c);
    unsigned int t2 = s0 + maj;
    h = g; g = f; f = e; e = d + t1;
    d = c; c = b; b = a; a = t1 + t2;
  }
  ctx->state[0] += a; ctx->state[1] += b; ctx->state[2] += c; ctx->state[3] += d;
  ctx->state[4] += e; ctx->state[5] += f; ctx->state[6] += g; ctx->state[7] += h;
}

static void baton_sha256_init(BatonSha256 *ctx) {
  ctx->datalen = 0; ctx->bitlen = 0;
  ctx->state[0] = 0x6a09e667u; ctx->state[1] = 0xbb67ae85u;
  ctx->state[2] = 0x3c6ef372u; ctx->state[3] = 0xa54ff53au;
  ctx->state[4] = 0x510e527fu; ctx->state[5] = 0x9b05688cu;
  ctx->state[6] = 0x1f83d9abu; ctx->state[7] = 0x5be0cd19u;
}

static void baton_sha256_update(BatonSha256 *ctx, const unsigned char *data, size_t len) {
  for (size_t i = 0; i < len; i++) {
    ctx->data[ctx->datalen++] = data[i];
    if (ctx->datalen == 64) {
      baton_sha256_block(ctx, ctx->data);
      ctx->bitlen += 512;
      ctx->datalen = 0;
    }
  }
}

static void baton_sha256_final(BatonSha256 *ctx, unsigned char *out) {
  unsigned int i = ctx->datalen;
  if (ctx->datalen < 56) {
    ctx->data[i++] = 0x80;
    while (i < 56) ctx->data[i++] = 0x00;
  } else {
    ctx->data[i++] = 0x80;
    while (i < 64) ctx->data[i++] = 0x00;
    baton_sha256_block(ctx, ctx->data);
    memset(ctx->data, 0, 56);
  }
  ctx->bitlen += (unsigned long long)ctx->datalen * 8u;
  ctx->data[63] = (unsigned char)(ctx->bitlen);
  ctx->data[62] = (unsigned char)(ctx->bitlen >> 8);
  ctx->data[61] = (unsigned char)(ctx->bitlen >> 16);
  ctx->data[60] = (unsigned char)(ctx->bitlen >> 24);
  ctx->data[59] = (unsigned char)(ctx->bitlen >> 32);
  ctx->data[58] = (unsigned char)(ctx->bitlen >> 40);
  ctx->data[57] = (unsigned char)(ctx->bitlen >> 48);
  ctx->data[56] = (unsigned char)(ctx->bitlen >> 56);
  baton_sha256_block(ctx, ctx->data);
  for (i = 0; i < 4; i++) {
    out[i]      = (unsigned char)(ctx->state[0] >> (24 - i * 8));
    out[i + 4]  = (unsigned char)(ctx->state[1] >> (24 - i * 8));
    out[i + 8]  = (unsigned char)(ctx->state[2] >> (24 - i * 8));
    out[i + 12] = (unsigned char)(ctx->state[3] >> (24 - i * 8));
    out[i + 16] = (unsigned char)(ctx->state[4] >> (24 - i * 8));
    out[i + 20] = (unsigned char)(ctx->state[5] >> (24 - i * 8));
    out[i + 24] = (unsigned char)(ctx->state[6] >> (24 - i * 8));
    out[i + 28] = (unsigned char)(ctx->state[7] >> (24 - i * 8));
  }
}

typedef struct {
  char *identity;
  char *out;
  int code;
} BatonRoleDigest;

static void baton_role_digest_call(IoWork *w) {
  BatonRoleDigest *call = (BatonRoleDigest *)w->data;
  static const char hex[] = "0123456789abcdef";
  BatonSha256 ctx;
  unsigned char digest[32];
  baton_sha256_init(&ctx);
  baton_sha256_update(&ctx, (const unsigned char *)call->identity, strlen(call->identity));
  baton_sha256_final(&ctx, digest);
  call->out = malloc(65);
  if (!call->out) { call->code = ENOMEM; return; }
  for (int i = 0; i < 32; i++) {
    call->out[2 * i] = hex[digest[i] >> 4];
    call->out[2 * i + 1] = hex[digest[i] & 15];
  }
  call->out[64] = 0;
}

static Term baton_role_digest_pack(Env e, IoWork *w) {
  BatonRoleDigest *call = (BatonRoleDigest *)w->data;
  Term result = call->code == 0
    ? io_done(e, io_str(e, call->out, 64))
    : io_fail(e, call->code, "role identity digest failed");
  free(call->identity); free(call->out); free(call);
  w->data = NULL;
  return result;
}

/* The effect ID uses the definition name from the Bend source. */
#ifdef CID_CONTEXT_ROLE_GUARD_KEY
static Term baton_role_digest_run(Env e, Term *f, IoWork *w) {
  BatonRoleDigest *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  u64 n = 0;
  call->identity = io_cstr(e, f[0], &n);
  if (strlen(call->identity) != n) {
    free(call->identity); free(call);
    return io_fail(e, EINVAL, "role identity contains NUL");
  }
  w->data = (char *)call;
  return io_work(w, baton_role_digest_call, baton_role_digest_pack);
}
static void __attribute__((constructor)) baton_role_digest_use(void) {
  io_eff(CID_CONTEXT_ROLE_GUARD_KEY, baton_role_digest_run, 0);
}
#endif
