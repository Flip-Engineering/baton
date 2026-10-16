#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include "../src/host/codex-proxy.c"

static void fixture_result(BatonCodexCall *call) {
  if(call->error)fprintf(stderr,"error %d: %s\n",call->error,call->detail?call->detail:strerror(call->error));
  else if(call->text && (call->kind==BC_NEXT || call->kind==BC_CLOSE)){fwrite(call->text,1,call->length,stdout);fputc('\n',stdout);}
  free(call->text);free(call->detail);call->text=call->detail=NULL;
}

int main(int argc,char **argv) {
  if(argc<2)return 2;
  BatonCodexCall open={.kind=BC_OPEN};baton_codex_call(&open);fixture_result(&open);
  if(open.error)return 1;
  uint32_t handle=open.handle;
  if(!strcmp(argv[1],"echo")) {
    if(argc!=3)return 2;
    FILE *file=fopen(argv[2],"rb");if(!file)return 2;
    if(fseek(file,0,SEEK_END))return 2;
    long amount=ftell(file);if(amount<0 || fseek(file,0,SEEK_SET))return 2;
    char *bytes=malloc((size_t)amount+1);if(!bytes)return 2;
    if(fread(bytes,1,(size_t)amount,file)!=(size_t)amount)return 2;
    fclose(file);
    BatonCodexCall send={.kind=BC_SEND,.handle=handle,.text=bytes,.length=(size_t)amount};
    baton_codex_call(&send);fixture_result(&send);if(send.error)return 1;
    for(int i=0;i<2;i++) {
      BatonCodexCall next={.kind=BC_NEXT,.handle=handle};baton_codex_call(&next);fixture_result(&next);if(next.error)return 1;
    }
  } else if(!strcmp(argv[1],"next")) {
    BatonCodexCall next={.kind=BC_NEXT,.handle=handle};baton_codex_call(&next);fixture_result(&next);
    if(!next.error)return 2;
  } else if(!strcmp(argv[1],"cancel")) {
    BatonCodexCall cancel={.kind=BC_CANCEL,.handle=handle,.signal=SIGTERM};baton_codex_call(&cancel);fixture_result(&cancel);
    if(cancel.error)return 1;
  }
  BatonCodexCall close={.kind=BC_CLOSE,.handle=handle};baton_codex_call(&close);fixture_result(&close);if(close.error)return 1;
  BatonCodexCall stale={.kind=BC_CANCEL,.handle=handle,.signal=0};baton_codex_call(&stale);
  if(stale.error!=EBADF)return 2;
  return 0;
}
