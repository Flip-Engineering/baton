#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>


#ifdef CID_REPLHOST_LINE
typedef struct { char *line; size_t capacity; int eof; int error; } BatonReplLine;

static void baton_repl_line_call(IoWork *work) {
  BatonReplLine *call=(BatonReplLine *)work->data;
  errno=0;
  if(getline(&call->line,&call->capacity,stdin)<0) {
    if(feof(stdin)) call->eof=1;
    else call->error=errno?errno:EIO;
  }
}

static Term baton_repl_line_pack(Env env,IoWork *work) {
  BatonReplLine *call=(BatonReplLine *)work->data;
  Term result;
  if(call->error) result=io_fail(env,call->error,"Reading a REPL input line failed.");
  else if(call->eof) result=io_done(env,term_pak(CID_NONE,0));
  else result=io_done(env,io_box(env,CID_SOME,io_str(env,call->line,(u64)strlen(call->line))));
  free(call->line); free(call); work->data=NULL;
  return result;
}

static Term baton_repl_line(Env env,Term *fields,IoWork *work) {
  BatonReplLine *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(env,ENOMEM,NULL);
  work->data=(char *)call;
  return io_work(work,baton_repl_line_call,baton_repl_line_pack);
}
static void __attribute__((constructor)) baton_repl_line_use(void) {
  io_eff(CID_REPLHOST_LINE,baton_repl_line,0);
}
#endif

#ifdef CID_REPLHOST_PRESERVE_OUTPUT
typedef struct { char *directory; int error; } BatonReplOutput;

static void baton_repl_output_call(IoWork *work) {
  BatonReplOutput *call=(BatonReplOutput *)work->data;
  size_t length=strlen(call->directory);
  char *source=malloc(length+8),*target=malloc(length+14);
  int input=-1,output=-1;
  if(!source || !target) {call->error=ENOMEM;goto done;}
  sprintf(source,"%s/stdout",call->directory);
  sprintf(target,"%s/stdout.saved",call->directory);
  input=open(source,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);
  if(input<0) {call->error=errno;goto done;}
  output=open(target,O_WRONLY|O_CREAT|O_TRUNC|O_CLOEXEC|O_NOFOLLOW,0600);
  if(output<0) {call->error=errno;goto done;}
  char bytes[65536];
  for(;;) {
    ssize_t count=read(input,bytes,sizeof(bytes));
    if(count<0) {if(errno==EINTR)continue;call->error=errno;break;}
    if(!count)break;
    ssize_t offset=0;
    while(offset<count) {
      ssize_t written=write(output,bytes+offset,(size_t)(count-offset));
      if(written<0 && errno==EINTR)continue;
      if(written<=0) {call->error=written<0?errno:EIO;break;}
      offset+=written;
    }
    if(call->error)break;
  }
  if(!call->error && fsync(output))call->error=errno;
  if(!call->error) {
    int parent=open(call->directory,O_RDONLY|O_CLOEXEC);
    if(parent<0)call->error=errno;
    else {if(fsync(parent))call->error=errno;close(parent);}
  }
done:
  if(input>=0 && close(input) && !call->error)call->error=errno;
  if(output>=0 && close(output) && !call->error)call->error=errno;
  free(source);free(target);
}

static Term baton_repl_output_pack(Env env,IoWork *work) {
  BatonReplOutput *call=(BatonReplOutput *)work->data;
  Term result=call->error?io_fail(env,call->error,"Retaining the complete REPL stdout failed."):
    io_done(env,term_pak(CID_UNIT,0));
  free(call->directory);free(call);work->data=NULL;
  return result;
}

static Term baton_repl_output(Env env,Term *fields,IoWork *work) {
  BatonReplOutput *call=calloc(1,sizeof(*call));
  if(!call)return io_fail(env,ENOMEM,NULL);
  u64 length=0;
  call->directory=io_cstr(env,fields[0],&length);
  if(!call->directory || strlen(call->directory)!=length) {
    free(call->directory);free(call);return io_fail(env,EINVAL,"The attempt directory contains NUL.");
  }
  work->data=(char *)call;
  return io_work(work,baton_repl_output_call,baton_repl_output_pack);
}
static void __attribute__((constructor)) baton_repl_output_use(void) {
  io_eff(CID_REPLHOST_PRESERVE_OUTPUT,baton_repl_output,0);
}
#endif
