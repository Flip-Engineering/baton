#include <errno.h>
#include <fcntl.h>
#include <spawn.h>
#include <sys/wait.h>

extern char **environ;

typedef struct {
  pid_t pid;
  int input;
  FILE *output;
  int reaped;
} BatonChild;

typedef struct {
  BatonChild *child;
  char *args, *cwd, *log, *text;
  size_t length;
  u32 handle, signal;
  int kind, error, eof;
} BatonProcessCall;

static BatonChild **baton_children;
static size_t baton_child_count, baton_child_capacity;

enum { BP_SPAWN, BP_WRITE, BP_CLOSE, BP_READ, BP_WAIT, BP_SIGNAL, BP_PID };

static int baton_pipe(int fds[2]) {
  if (pipe(fds)) return errno;
  if (fcntl(fds[0],F_SETFD,FD_CLOEXEC) < 0 || fcntl(fds[1],F_SETFD,FD_CLOEXEC) < 0) {
    int error=errno; close(fds[0]); close(fds[1]); return error;
  }
  return 0;
}

static void baton_child_spawn(BatonProcessCall *call) {
  if (!call->length || call->args[call->length-1] != 0 || !call->args[0]) {
    call->error=EINVAL; return;
  }
  size_t count=0;
  for(size_t i=0;i<call->length;i++) if(!call->args[i]) count++;
  char **argv=calloc(count+1,sizeof(char *));
  if(!argv) { call->error=ENOMEM; return; }
  size_t index=0, start=0;
  for(size_t i=0;i<call->length;i++) if(!call->args[i]) {
    argv[index++]=call->args+start; start=i+1;
  }
  int in[2], out[2];
  call->error=baton_pipe(in);
  if(call->error) { free(argv); return; }
  call->error=baton_pipe(out);
  if(call->error) { close(in[0]);close(in[1]);free(argv);return; }
  int log=open(call->log,O_CREAT|O_WRONLY|O_APPEND|O_CLOEXEC,0600);
  if(log<0) { call->error=errno; goto pipes; }
  FILE *reader=fdopen(out[0],"r");
  if(!reader) { call->error=errno; close(log); goto pipes; }
  posix_spawn_file_actions_t actions;
  posix_spawnattr_t attr;
  int rc=posix_spawn_file_actions_init(&actions);
  if(rc) { call->error=rc; fclose(reader);out[0]=-1;close(log);goto pipes; }
  rc=posix_spawnattr_init(&attr);
  if(rc) { call->error=rc;posix_spawn_file_actions_destroy(&actions);fclose(reader);out[0]=-1;close(log);goto pipes; }
#define BP_ACTION(expr) do { rc=(expr); if(rc) goto actions_done; } while(0)
  BP_ACTION(posix_spawn_file_actions_addchdir_np(&actions,call->cwd));
  BP_ACTION(posix_spawn_file_actions_adddup2(&actions,in[0],STDIN_FILENO));
  BP_ACTION(posix_spawn_file_actions_adddup2(&actions,out[1],STDOUT_FILENO));
  BP_ACTION(posix_spawn_file_actions_adddup2(&actions,log,STDERR_FILENO));
  BP_ACTION(posix_spawn_file_actions_addclose(&actions,in[0]));
  BP_ACTION(posix_spawn_file_actions_addclose(&actions,in[1]));
  BP_ACTION(posix_spawn_file_actions_addclose(&actions,out[0]));
  BP_ACTION(posix_spawn_file_actions_addclose(&actions,out[1]));
  BP_ACTION(posix_spawn_file_actions_addclose(&actions,log));
  sigset_t defaults;
  sigemptyset(&defaults); sigaddset(&defaults,SIGPIPE);
  BP_ACTION(posix_spawnattr_setsigdefault(&attr,&defaults));
  BP_ACTION(posix_spawnattr_setpgroup(&attr,0));
  BP_ACTION(posix_spawnattr_setflags(&attr,POSIX_SPAWN_SETPGROUP|POSIX_SPAWN_SETSIGDEF));
  rc=posix_spawnp(&call->child->pid,argv[0],&actions,&attr,argv,environ);
actions_done:
#undef BP_ACTION
  posix_spawnattr_destroy(&attr); posix_spawn_file_actions_destroy(&actions); close(log);
  if(rc) { call->error=rc;fclose(reader);out[0]=-1; }
  else {
    call->child->input=in[1];in[1]=-1;
    call->child->output=reader;out[0]=-1;
  }
pipes:
  if(in[0]>=0)close(in[0]); if(in[1]>=0)close(in[1]);
  if(out[0]>=0)close(out[0]); if(out[1]>=0)close(out[1]);
  free(argv);
}

static void baton_process_call(IoWork *w) {
  BatonProcessCall *call=(BatonProcessCall *)w->data;
  BatonChild *child=call->child;
  if(call->kind==BP_SPAWN) { baton_child_spawn(call);return; }
  if(call->kind==BP_WRITE) {
    size_t offset=0;
    while(offset<call->length) {
      ssize_t n=write(child->input,call->text+offset,call->length-offset);
      if(n<0 && errno==EINTR) continue;
      if(n<=0) { call->error=n<0?errno:EIO;break; }
      offset+=(size_t)n;
    }
  } else if(call->kind==BP_CLOSE) {
    if(child->input>=0) {
      if(close(child->input)) call->error=errno;
      child->input=-1;
    }
  } else if(call->kind==BP_READ) {
    if(!child->output) { call->error=EBADF;return; }
    size_t capacity=0;
    ssize_t n;
    do { errno=0;n=getline(&call->text,&capacity,child->output); }
    while(n<0 && errno==EINTR && (clearerr(child->output),1));
    if(n<0) {
      if(feof(child->output)) call->eof=1;
      else call->error=errno?errno:EIO;
    } else {
      call->length=(size_t)n;
      if(call->length && call->text[call->length-1]=='\n') call->length--;
    }
  } else if(call->kind==BP_WAIT) {
    int status;
    pid_t pid;
    do { pid=waitpid(child->pid,&status,0); } while(pid<0 && errno==EINTR);
    if(pid<0) { call->error=errno;return; }
    child->reaped=1;
    if(child->input>=0) {close(child->input);child->input=-1;}
    if(child->output) {fclose(child->output);child->output=NULL;}
    char status_text[64];
    if(WIFEXITED(status)) snprintf(status_text,sizeof(status_text),"exit %d",WEXITSTATUS(status));
    else if(WIFSIGNALED(status)) snprintf(status_text,sizeof(status_text),"signal %d",WTERMSIG(status));
    else { call->error=ECHILD;return; }
    call->text=strdup(status_text);
    if(!call->text) call->error=ENOMEM;
    else call->length=strlen(call->text);
  } else if(call->kind==BP_SIGNAL) {
    if(kill(-child->pid,(int)call->signal)) call->error=errno;
  }
}

static Term baton_process_pack(Env e, IoWork *w) {
  BatonProcessCall *call=(BatonProcessCall *)w->data;
  Term value=term_pak(CID_UNIT,0);
  if(!call->error) {
    if(call->kind==BP_SPAWN) value=(Term)call->handle;
    else if(call->kind==BP_WAIT) value=io_str(e,call->text,call->length);
#ifdef CID_SOME
    else if(call->kind==BP_READ) value=call->eof ? term_pak(CID_NONE,0)
      : io_box(e,CID_SOME,io_str(e,call->text,call->length));
#endif
  }
  Term result=call->error ? io_fail(e,call->error,NULL) : io_done(e,value);
  if(call->kind==BP_SPAWN && call->error) { baton_children[call->handle]=NULL;free(call->child); }
  free(call->args);free(call->cwd);free(call->log);free(call->text);free(call);
  w->data=NULL;
  return result;
}

static Term baton_process_begin(Env e, Term *f, IoWork *w, int kind) {
  BatonProcessCall *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  call->kind=kind;
  if(kind==BP_SPAWN) {
    if(baton_child_count==UINT32_MAX) {free(call);return io_fail(e,ENOMEM,NULL);}
    if(baton_child_count==baton_child_capacity) {
      size_t capacity=baton_child_capacity?baton_child_capacity*2:16;
      BatonChild **next=realloc(baton_children,capacity*sizeof(*next));
      if(!next) {free(call);return io_fail(e,ENOMEM,NULL);}
      baton_children=next;baton_child_capacity=capacity;
    }
    call->child=calloc(1,sizeof(*call->child));
    if(!call->child) {free(call);return io_fail(e,ENOMEM,NULL);}
    call->child->input=-1;
    call->handle=(u32)baton_child_count++;
    baton_children[call->handle]=call->child;
    u64 length=0,cwd_length=0,log_length=0;
    call->args=io_cstr(e,f[0],&length);call->length=length;
    call->cwd=io_cstr(e,f[1],&cwd_length);
    call->log=io_cstr(e,f[2],&log_length);
    if(strlen(call->cwd)!=cwd_length || strlen(call->log)!=log_length) call->error=EINVAL;
  } else {
    call->handle=(u32)f[0];
    if(call->handle>=baton_child_count || !baton_children[call->handle]) {free(call);return io_fail(e,EBADF,NULL);}
    call->child=baton_children[call->handle];
    if(call->child->reaped && kind!=BP_WRITE) {free(call);return io_fail(e,ECHILD,NULL);}
    if(kind==BP_PID) {Term pid=io_done(e,(Term)call->child->pid);free(call);return pid;}
    if(kind==BP_WRITE) {u64 length=0;call->text=io_cstr(e,f[1],&length);call->length=length;}
    if(kind==BP_SIGNAL) call->signal=(u32)f[1];
  }
  w->data=(char *)call;
  if(call->error) return baton_process_pack(e,w);
  return io_work(w,baton_process_call,baton_process_pack);
}

#define BP_EFFECT(name,ID,kind) \
  static Term name##_run(Env e,Term *f,IoWork *w){return baton_process_begin(e,f,w,kind);} \
  static void __attribute__((constructor)) name##_use(void){io_eff(ID,name##_run,0);}
#ifdef CID_PROCESSCHILD_SPAWN
BP_EFFECT(baton_spawn,CID_PROCESSCHILD_SPAWN,BP_SPAWN)
#endif
#ifdef CID_PROCESSCHILD_WRITE
BP_EFFECT(baton_write,CID_PROCESSCHILD_WRITE,BP_WRITE)
#endif
#ifdef CID_PROCESSCHILD_CLOSE_STDIN
BP_EFFECT(baton_close,CID_PROCESSCHILD_CLOSE_STDIN,BP_CLOSE)
#endif
#ifdef CID_PROCESSCHILD_READ_LINE
BP_EFFECT(baton_read,CID_PROCESSCHILD_READ_LINE,BP_READ)
#endif
#ifdef CID_PROCESSCHILD_WAIT
BP_EFFECT(baton_wait,CID_PROCESSCHILD_WAIT,BP_WAIT)
#endif
#ifdef CID_PROCESSCHILD_SIGNAL
BP_EFFECT(baton_signal,CID_PROCESSCHILD_SIGNAL,BP_SIGNAL)
#endif
#ifdef CID_PROCESSCHILD_PID
BP_EFFECT(baton_pid,CID_PROCESSCHILD_PID,BP_PID)
#endif
#undef BP_EFFECT
static void __attribute__((constructor)) baton_process_signals(void){signal(SIGPIPE,SIG_IGN);}
