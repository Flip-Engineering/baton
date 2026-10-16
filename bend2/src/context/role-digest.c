/* SHA-256 for the stable managed semantic role identity. The compression
   core lives in bend2/src/host/sha256.h, shared with Files.digest. */
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include "../host/sha256.h"


typedef struct { char *identity; char *digest; int error; } BatonRoleDigest;
static void baton_role_digest_work(IoWork *w) {
  BatonRoleDigest *call=(BatonRoleDigest *)w->data;
  static const char hex[]="0123456789abcdef";
  BatonSha256 s;baton_sha256_init(&s);
  baton_sha256_update(&s,(const unsigned char *)call->identity,strlen(call->identity));
  unsigned char bytes[32];baton_sha256_final(&s,bytes);
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
