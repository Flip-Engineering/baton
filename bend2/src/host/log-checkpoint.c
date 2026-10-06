#include <errno.h>
#include <fcntl.h>
#include <unistd.h>

typedef struct { char *path, *text; size_t length; int error; } BatonLogCheckpoint;

static void baton_log_checkpoint_call(IoWork *work) {
  BatonLogCheckpoint *call=(BatonLogCheckpoint *)work->data;
  if (!call->length) {
    if (unlink(call->path) && errno!=ENOENT) call->error=errno;
    return;
  }
  size_t length=strlen(call->path);
  char *temporary=malloc(length+12);
  if (!temporary) {call->error=ENOMEM;return;}
  memcpy(temporary,call->path,length);
  memcpy(temporary+length,".tmp.XXXXXX",12);
  int descriptor=mkstemp(temporary);
  if (descriptor<0) {call->error=errno;free(temporary);return;}
  size_t offset=0;
  while (offset<call->length) {
    ssize_t count=write(descriptor,call->text+offset,call->length-offset);
    if (count>0) offset+=(size_t)count;
    else if (count<0 && errno==EINTR) continue;
    else {call->error=count<0?errno:EIO;break;}
  }
  if (!call->error && fsync(descriptor)) call->error=errno;
  if (close(descriptor) && !call->error) call->error=errno;
  if (!call->error && rename(temporary,call->path)) call->error=errno;
  if (call->error) unlink(temporary);
  free(temporary);
}

static Term baton_log_checkpoint_pack(Env environment,IoWork *work) {
  BatonLogCheckpoint *call=(BatonLogCheckpoint *)work->data;
  Term result=call->error ? io_fail(environment,call->error,NULL)
    : io_done(environment,term_pak(CID_UNIT,0));
  free(call->path);free(call->text);free(call);work->data=NULL;
  return result;
}

#ifdef CID_LOGCHECKPOINT_SAVE
static Term baton_log_checkpoint_run(Env environment,Term *arguments,IoWork *work) {
  BatonLogCheckpoint *call=calloc(1,sizeof(*call));
  if (!call) return io_fail(environment,ENOMEM,NULL);
  u64 path_length=0,text_length=0;
  call->path=io_cstr(environment,arguments[0],&path_length);
  call->text=io_cstr(environment,arguments[1],&text_length);
  call->length=text_length;
  if (!call->path || !call->text || strlen(call->path)!=path_length) {
    free(call->path);free(call->text);free(call);
    return io_fail(environment,EINVAL,"checkpoint path contains NUL");
  }
  work->data=(char *)call;
  return io_work(work,baton_log_checkpoint_call,baton_log_checkpoint_pack);
}
static void __attribute__((constructor)) baton_log_checkpoint_use(void) {
  io_eff(CID_LOGCHECKPOINT_SAVE,baton_log_checkpoint_run,0);
}
#endif
