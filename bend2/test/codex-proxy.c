#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include "../src/host/codex-proxy.c"

static volatile sig_atomic_t fixture_interrupts,fixture_terminations;
static void fixture_signal(int signal) {
  if(signal==SIGINT)fixture_interrupts++;else if(signal==SIGTERM)fixture_terminations++;
}

typedef struct {
  uint32_t handle;
  pthread_mutex_t mutex;
  pthread_cond_t changed;
  int started,error;
} FixtureReader;

static void *fixture_reader(void *data) {
  FixtureReader *reader=data;BatonCodexProxy *proxy=bc_acquire(reader->handle);
  if(!proxy){reader->error=EBADF;return NULL;}
  pthread_mutex_lock(&proxy->reader);
  pthread_mutex_lock(&reader->mutex);reader->started=1;pthread_cond_signal(&reader->changed);pthread_mutex_unlock(&reader->mutex);
  char *text=NULL,*detail=NULL;size_t length=0;
  reader->error=bc_message(proxy,&text,&length,&detail);
  free(text);free(detail);pthread_mutex_unlock(&proxy->reader);bc_release(proxy);return NULL;
}

static void fixture_result(BatonCodexCall *call) {
  if(call->error)fprintf(stderr,"error %d: %s\n",call->error,call->detail?call->detail:strerror(call->error));
  else if(call->text && (call->kind==BC_NEXT || call->kind==BC_CLOSE)){fwrite(call->text,1,call->length,stdout);fputc('\n',stdout);}
  free(call->text);free(call->detail);call->text=call->detail=NULL;
}

int main(int argc,char **argv) {
  if(argc<2)return 2;
  int external=!strncmp(argv[1],"external-",9),blocked=!strcmp(argv[1],"blocked-close");
  if(external) {
    struct sigaction prior={0};prior.sa_handler=fixture_signal;sigemptyset(&prior.sa_mask);
    if(sigaction(SIGINT,&prior,NULL) || sigaction(SIGTERM,&prior,NULL))return 2;
    raise(SIGINT);raise(SIGTERM);
    if(fixture_interrupts!=1 || fixture_terminations!=1)return 2;
  }
  BatonCodexCall open={.kind=BC_OPEN};baton_codex_call(&open);fixture_result(&open);
  if(open.error)return 1;
  uint32_t handle=open.handle;
  if(!strcmp(argv[1],"retired-cancel")) {
    BatonCodexProxy *held=bc_acquire(handle);if(!held)return 2;
    char *status=NULL;int error=bc_finish(held,&status);
    if(error || !status || strcmp(status,"exit 7"))return 2;free(status);
    /* This is CLOSE's actual post-wait state while an earlier call still owns
       a reference. Signal zero detects accidental process-group selection. */
    BatonCodexCall cancel={.kind=BC_CANCEL,.handle=handle,.signal=0};baton_codex_call(&cancel);
    if(cancel.error!=ECHILD)return 2;
    bc_release(held);bc_remove(held);puts("retired-child-refused");return 0;
  } else if(external || blocked) {
    BatonCodexCall ready={.kind=BC_NEXT,.handle=handle};baton_codex_call(&ready);
    if(ready.error)return 2;free(ready.text);free(ready.detail);
    FixtureReader reader={.handle=handle,.mutex=PTHREAD_MUTEX_INITIALIZER,.changed=PTHREAD_COND_INITIALIZER};
    pthread_t thread;if(pthread_create(&thread,NULL,fixture_reader,&reader))return 2;
    pthread_mutex_lock(&reader.mutex);while(!reader.started)pthread_cond_wait(&reader.changed,&reader.mutex);pthread_mutex_unlock(&reader.mutex);
    BatonCodexCall second={.kind=BC_OPEN};int multiple=!strcmp(argv[1],"external-two");
    if(multiple){baton_codex_call(&second);if(second.error)return 2;}
    if(external)raise(!strcmp(argv[1],"external-int")?SIGINT:SIGTERM);
    BatonCodexCall close={.kind=BC_CLOSE,.handle=handle};baton_codex_call(&close);fixture_result(&close);if(close.error)return 1;
    if(pthread_join(thread,NULL) || reader.error!=EPIPE)return 2;
    pthread_mutex_destroy(&reader.mutex);pthread_cond_destroy(&reader.changed);
    if(multiple) {
      struct sigaction current;if(sigaction(SIGTERM,NULL,&current) || current.sa_handler!=bc_forward_signal)return 2;
      close=(BatonCodexCall){.kind=BC_CLOSE,.handle=second.handle};baton_codex_call(&close);fixture_result(&close);if(close.error)return 1;
    }
    if(external) {
      struct sigaction interrupt,terminate;
      if(sigaction(SIGINT,NULL,&interrupt) || sigaction(SIGTERM,NULL,&terminate))return 2;
      if(interrupt.sa_handler!=fixture_signal || terminate.sa_handler!=fixture_signal)return 2;
      raise(SIGINT);raise(SIGTERM);
      if(fixture_interrupts!=2 || fixture_terminations!=2 || bc_signal_started || bc_signal_pipe[0]!=-1 || bc_signal_pipe[1]!=-1 || baton_codex_proxies)return 2;
    }
    return 0;
  } else if(!strcmp(argv[1],"echo")) {
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
