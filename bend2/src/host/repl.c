#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>


#ifdef CID_REPLHOST_LINE
typedef struct { char *line; size_t capacity; ssize_t count; int eof; int error; int refusal; } BatonReplLine;

/* Same RFC 3629 decision as the context raw reader. The C files are embedded
   in one generated translation unit, so the validator is repeated here. */
static int baton_repl_utf8_bad(const unsigned char *b, size_t n) {
  size_t i = 0;
  while (i < n) {
    unsigned char c = b[i];
    if (c < 0x80) { i += 1; continue; }
    if (c < 0xC2) return 1;
    if (c < 0xE0) {
      if (i + 1 >= n || (b[i + 1] & 0xC0) != 0x80) return 1;
      i += 2; continue;
    }
    if (c < 0xF0) {
      if (i + 2 >= n) return 1;
      unsigned char c1 = b[i + 1], c2 = b[i + 2];
      if ((c1 & 0xC0) != 0x80 || (c2 & 0xC0) != 0x80) return 1;
      if (c == 0xE0 && c1 < 0xA0) return 1;
      if (c == 0xED && c1 > 0x9F) return 1;
      i += 3; continue;
    }
    if (c < 0xF5) {
      if (i + 3 >= n) return 1;
      unsigned char c1 = b[i + 1], c2 = b[i + 2], c3 = b[i + 3];
      if ((c1 & 0xC0) != 0x80 || (c2 & 0xC0) != 0x80 || (c3 & 0xC0) != 0x80) return 1;
      if (c == 0xF0 && c1 < 0x90) return 1;
      if (c == 0xF4 && c1 > 0x8F) return 1;
      i += 4; continue;
    }
    return 1;
  }
  return 0;
}

static void baton_repl_line_call(IoWork *work) {
  BatonReplLine *call=(BatonReplLine *)work->data;
  errno=0;
  call->count=getline(&call->line,&call->capacity,stdin);
  if(call->count<0) {
    if(feof(stdin)) call->eof=1;
    else call->error=errno?errno:EIO;
    return;
  }
  if(memchr(call->line,'\0',(size_t)call->count)!=NULL) call->refusal=1;
  else if(baton_repl_utf8_bad((const unsigned char *)call->line,(size_t)call->count)) call->refusal=2;
}

static Term baton_repl_line_pack(Env env,IoWork *work) {
  BatonReplLine *call=(BatonReplLine *)work->data;
  Term result;
  if(call->error) result=io_fail(env,call->error,"Reading a REPL input line failed.");
  else if(call->refusal==1) result=io_fail(env,EINVAL,"The REPL input line contains a NUL byte.");
  else if(call->refusal==2) result=io_fail(env,EILSEQ,"The REPL input line is not valid UTF-8.");
  else if(call->eof) result=io_done(env,term_pak(CID_NONE,0));
  else result=io_done(env,io_box(env,CID_SOME,io_str(env,call->line,(u64)call->count)));
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
  { struct stat st;
    if(fstat(input,&st)) {call->error=errno;goto done;}
    if(!S_ISREG(st.st_mode)) {call->error=EINVAL;goto done;}
  }
  output=open(target,O_WRONLY|O_CREAT|O_TRUNC|O_CLOEXEC|O_NOFOLLOW,0600);
  if(output<0) {call->error=errno;goto done;}
  { struct stat st;
    if(fstat(output,&st)) {call->error=errno;goto done;}
    if(!S_ISREG(st.st_mode)) {call->error=EINVAL;goto done;}
  }
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
