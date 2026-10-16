/* SHA-256 for the stable managed semantic role identity. */
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  uint32_t state[8];
  uint64_t bitlen;
  unsigned char block[64];
  size_t used;
} BatonRoleSha256;

static const uint32_t baton_role_k[64] = {
  0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,0x3956c25bu,0x59f111f1u,0x923f82a4u,0xab1c5ed5u,
  0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,
  0xe49b69c1u,0xefbe4786u,0x0fc19dc6u,0x240ca1ccu,0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,
  0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,0xc6e00bf3u,0xd5a79147u,0x06ca6351u,0x14292967u,
  0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,
  0xa2bfe8a1u,0xa81a664bu,0xc24b8b70u,0xc76c51a3u,0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,
  0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,0x391c0cb3u,0x4ed8aa4au,0x5b9cca4fu,0x682e6ff3u,
  0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u
};

static uint32_t baton_role_ror(uint32_t x, unsigned n) { return (x >> n) | (x << (32u - n)); }

static void baton_role_block(BatonRoleSha256 *s, const unsigned char *p) {
  uint32_t w[64];
  for (int i = 0; i < 16; ++i)
    w[i] = ((uint32_t)p[i*4] << 24) | ((uint32_t)p[i*4+1] << 16) |
           ((uint32_t)p[i*4+2] << 8) | (uint32_t)p[i*4+3];
  for (int i = 16; i < 64; ++i) {
    uint32_t a=w[i-15], b=w[i-2];
    uint32_t s0=baton_role_ror(a,7)^baton_role_ror(a,18)^(a>>3);
    uint32_t s1=baton_role_ror(b,17)^baton_role_ror(b,19)^(b>>10);
    w[i]=w[i-16]+s0+w[i-7]+s1;
  }
  uint32_t a=s->state[0],b=s->state[1],c=s->state[2],d=s->state[3];
  uint32_t e=s->state[4],f=s->state[5],g=s->state[6],h=s->state[7];
  for (int i = 0; i < 64; ++i) {
    uint32_t s1=baton_role_ror(e,6)^baton_role_ror(e,11)^baton_role_ror(e,25);
    uint32_t ch=(e&f)^((~e)&g), t1=h+s1+ch+baton_role_k[i]+w[i];
    uint32_t s0=baton_role_ror(a,2)^baton_role_ror(a,13)^baton_role_ror(a,22);
    uint32_t maj=(a&b)^(a&c)^(b&c), t2=s0+maj;
    h=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;
  }
  s->state[0]+=a;s->state[1]+=b;s->state[2]+=c;s->state[3]+=d;
  s->state[4]+=e;s->state[5]+=f;s->state[6]+=g;s->state[7]+=h;
}

static void baton_role_update(BatonRoleSha256 *s, const unsigned char *p, size_t n) {
  while (n) {
    size_t take=64-s->used;
    if (take>n) take=n;
    memcpy(s->block+s->used,p,take);s->used+=take;p+=take;n-=take;
    if (s->used==64) { baton_role_block(s,s->block);s->bitlen+=512;s->used=0; }
  }
}

static void baton_role_digest(const unsigned char *p, size_t n, unsigned char out[32]) {
  BatonRoleSha256 s={.state={0x6a09e667u,0xbb67ae85u,0x3c6ef372u,0xa54ff53au,
    0x510e527fu,0x9b05688cu,0x1f83d9abu,0x5be0cd19u}};
  baton_role_update(&s,p,n);
  uint64_t bits=s.bitlen+(uint64_t)s.used*8u;
  unsigned char pad=0x80;baton_role_update(&s,&pad,1);pad=0;
  while (s.used!=56) baton_role_update(&s,&pad,1);
  unsigned char length[8];
  for (unsigned i=0;i<8;++i) length[i]=(unsigned char)(bits>>(56u-i*8u));
  baton_role_update(&s,length,8);
  for (unsigned i=0;i<8;++i) {
    out[i*4]=(unsigned char)(s.state[i]>>24);out[i*4+1]=(unsigned char)(s.state[i]>>16);
    out[i*4+2]=(unsigned char)(s.state[i]>>8);out[i*4+3]=(unsigned char)s.state[i];
  }
}

typedef struct { char *identity; char *digest; int error; } BatonRoleDigest;
static void baton_role_digest_work(IoWork *w) {
  BatonRoleDigest *call=(BatonRoleDigest *)w->data;
  unsigned char bytes[32];static const char hex[]="0123456789abcdef";
  baton_role_digest((const unsigned char *)call->identity,strlen(call->identity),bytes);
  call->digest=malloc(65);
  if (!call->digest) { call->error=ENOMEM;return; }
  for (unsigned i=0;i<32;++i) { call->digest[i*2]=hex[bytes[i]>>4];call->digest[i*2+1]=hex[bytes[i]&15]; }
  call->digest[64]=0;
}

static Term baton_role_digest_pack(Env e, IoWork *w) {
  BatonRoleDigest *call=(BatonRoleDigest *)w->data;
  Term result=call->error?io_fail(e,call->error,"role identity SHA-256 failed")
    :io_done(e,io_str(e,call->digest,64));
  free(call->identity);free(call->digest);free(call);w->data=NULL;return result;
}

#ifdef CID_ROLE_GUARD_KEY
static Term baton_role_digest_run(Env e, Term *f, IoWork *w) {
  BatonRoleDigest *call=calloc(1,sizeof(*call));
  if (!call) return io_fail(e,ENOMEM,NULL);
  u64 n=0;call->identity=io_cstr(e,f[0],&n);
  if (!call->identity || strlen(call->identity)!=n) {
    free(call->identity);free(call);return io_fail(e,EINVAL,"role identity contains NUL");
  }
  w->data=(char *)call;return io_work(w,baton_role_digest_work,baton_role_digest_pack);
}
static void __attribute__((constructor)) baton_role_digest_use(void) {
  io_eff(CID_ROLE_GUARD_KEY,baton_role_digest_run,0);
}
#endif
