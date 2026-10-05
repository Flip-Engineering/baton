#include <errno.h>
#include <fcntl.h>
#include <spawn.h>
#include <sys/wait.h>
#include <time.h>

extern char **environ;

typedef struct {
  pid_t pid;
  int input;
  FILE *output;
  int reaped;
  struct BatonRetained *retained;
} BatonChild;

typedef struct {
  BatonChild *child;
  char *args, *cwd, *log, *text;
  size_t length;
  u32 handle, signal;
  int kind, error, eof, unstarted, typed_state;
  char *directory, *initial, *recovery, *detail;
  size_t initial_length, recovery_length;
  u32 keep_stdin, lock;
} BatonProcessCall;

static BatonChild **baton_children;
static size_t baton_child_count, baton_child_capacity;

enum { BP_SPAWN, BP_WRITE, BP_CLOSE, BP_READ, BP_WAIT, BP_SIGNAL, BP_PID,
       BP_RETAIN, BP_ATTACH, BP_RELEASE, BP_ACK, BP_KEEPER, BP_INPUT_CLOSED,
       BP_CONTROL_WRITE, BP_CONTROL_SIGNAL, BP_ATTACH_OWNED, BP_RECOVERY,
       BP_PREPARE, BP_START, BP_STATE, BP_CANCEL,
       BP_START_SNAPSHOT, BP_STATE_SNAPSHOT, BP_CANCEL_SNAPSHOT };

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

#include <pthread.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#ifdef __APPLE__
#include <sys/event.h>
#include <mach-o/dyld.h>
#include <libproc.h>
#else
#include <sys/inotify.h>
#include <sys/syscall.h>
#endif

enum { BR_HELLO=1, BR_CHANGE, BR_EXIT, BR_REPLY, BR_WRITE, BR_CLOSE,
       BR_SIGNAL, BR_RELEASE, BR_ACK, BR_INPUT_CLOSED,
       BR_ATTACH, BR_CONTROL_WRITE, BR_CONTROL_SIGNAL, BR_READY, BR_START, BR_STATE, BR_CANCEL };
typedef struct { uint32_t op; int32_t error; uint64_t serial,length; int64_t value; } BrFrame;
typedef struct { int32_t pid,exited,status,released,input_closed; } BrState;
typedef struct { int32_t pid; uint64_t first,second; } BrBirth;
enum { BR_PREPARED, BR_STARTING, BR_RUNNING, BR_EXITED, BR_UNSTARTED, BR_UNKNOWN, BR_CANCELLED };
typedef struct {
  BrBirth keeper;
  int32_t phase,pid,status,start_error,attached,prepared,released;
} BrSnapshot;
typedef struct {
  char magic[8]; uint64_t lengths[6]; uint32_t keep_stdin,reserved;
} BrManifestHeader;
typedef struct { BrManifestHeader header; char *field[6]; } BrManifest;
typedef struct BrBuffer {
  struct BrBuffer *next; char *data; size_t length,offset;
  uint64_t serial,generation; int close_input,change,rights;
  struct BrControl *control;
} BrBuffer;
typedef struct BrControl {
  struct BrControl *next;
  int socket,pending,answered;
  char *incoming;
  size_t size,capacity,sent;
  BrFrame reply;
} BrControl;
typedef struct BatonRetained {
  int socket,spool,error,exited,status,input_closed;
  int guard,watch,life,orphan,unknown,released;
  char *directory;
  uint64_t version,serial,reply_serial;
  int reply_error,prepared;
  BrSnapshot snapshot;
  off_t offset;
  pthread_t receiver;
  pthread_mutex_t state,command,reader;
  pthread_cond_t changed;
} BatonRetained;
typedef struct {
  int listener,client,input,lock,watch,wake[2],spool,finishing,change_queued;
  uint64_t generation;
  pid_t native_pid,recovery_pid;
  int recovery_waiting;
  uint64_t recovery_due,recovery_attempt;
  BrBirth birth;
  char *identity;
  size_t identity_length;
  int phase,start_error,start_attempt,native_watcher;
  int exited,status,released,input_closed,ready,native_waiting;
  char *directory,*incoming;
  size_t incoming_size,incoming_capacity;
  BrManifest manifest;
  BrBuffer *writes,*writes_tail,*outgoing,*outgoing_tail;
  BrControl *controls;
} BrKeeper;

static char *br_path(const char *directory,const char *name) {
  size_t a=strlen(directory),b=strlen(name);
  char *path=malloc(a+b+2);
  if(path) {memcpy(path,directory,a);path[a]='/';memcpy(path+a+1,name,b+1);}
  return path;
}
static int br_write_all(int fd,const void *data,size_t length) {
  const char *bytes=data;
  while(length) {
    ssize_t n=write(fd,bytes,length);
    if(n<0 && errno==EINTR) continue;
    if(n<=0) return n<0?errno:EIO;
    bytes+=n;length-=(size_t)n;
  }
  return 0;
}
static int br_read_all(int fd,void *data,size_t length) {
  char *bytes=data;
  while(length) {
    ssize_t n=read(fd,bytes,length);
    if(n<0 && errno==EINTR) continue;
    if(n<=0) return n<0?errno:EPIPE;
    bytes+=n;length-=(size_t)n;
  }
  return 0;
}
static int br_file(const char *directory,const char *name,const void *data,size_t length,int exclusive) {
  char *path=br_path(directory,name);
  if(!path) return ENOMEM;
  int fd=open(path,O_WRONLY|O_CREAT|O_CLOEXEC|(exclusive?O_EXCL:O_APPEND),0600);
  free(path);
  if(fd<0) return errno;
  int error=br_write_all(fd,data,length);
  if(!error && fsync(fd)) error=errno;
  if(!error && exclusive && fchmod(fd,0400)) error=errno;
  close(fd);
  return error;
}
static void br_note(BrKeeper *keeper,const char *name,int error) {
  char text[256];
  int n=snprintf(text,sizeof(text),"%d: %s\n",error,strerror(error));
  br_file(keeper->directory,name,text,(size_t)n,0);
}
static void br_manifest_free(BrManifest *manifest) {
  for(int i=0;i<6;i++) free(manifest->field[i]);
}
static int br_manifest_read(const char *directory,BrManifest *manifest) {
  char *path=br_path(directory,"manifest");
  if(!path) return ENOMEM;
  int fd=open(path,O_RDONLY|O_CLOEXEC);free(path);
  if(fd<0) return errno;
  int error=br_read_all(fd,&manifest->header,sizeof(manifest->header));
  if(!error && (memcmp(manifest->header.magic,"BATONRP1",8) || manifest->header.reserved>1)) error=EINVAL;
  struct stat status;
  uint64_t total=sizeof(manifest->header);
  for(int i=0;i<6 && !error;i++) {
    uint64_t length=manifest->header.lengths[i];
    if(length>SIZE_MAX-1 || total>UINT64_MAX-length) {error=EOVERFLOW;break;}
    total+=length;
    manifest->field[i]=calloc((size_t)length+1,1);
    if(!manifest->field[i]) {error=ENOMEM;break;}
    error=br_read_all(fd,manifest->field[i],(size_t)length);
  }
  if(!error && (fstat(fd,&status) || (uint64_t)status.st_size!=total)) error=EINVAL;
  close(fd);
  if(!error) {
    for(int i=0;i<6;i++) {
      size_t n=(size_t)manifest->header.lengths[i];
      if(i==0 || i==4) {if(!n || manifest->field[i][n-1] || !manifest->field[i][0]) error=EINVAL;}
      else if(i!=3 && strlen(manifest->field[i])!=n) error=EINVAL;
    }
  }
  return error;
}
static int br_read_file(const char *directory,const char *name,void *bytes,size_t length) {
  char *path=br_path(directory,name);
  int fd=path?open(path,O_RDONLY|O_CLOEXEC):-1;
  free(path);if(fd<0)return errno;
  int error=br_read_all(fd,bytes,length);struct stat info;
  if(!error && (fstat(fd,&info) || info.st_size!=(off_t)length))error=EINVAL;
  close(fd);return error;
}
static int br_exists(const char *directory,const char *name) {
  char *path=br_path(directory,name);struct stat info;
  int result=path?stat(path,&info):-1;free(path);
  return result==0;
}
static int br_birth(pid_t pid,BrBirth *birth) {
  memset(birth,0,sizeof(*birth));birth->pid=pid;
#ifdef __APPLE__
  struct proc_bsdinfo info;
  errno=0;int length=proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&info,sizeof(info));
  if(length!=(int)sizeof(info))return errno?errno:EIO;
  birth->first=info.pbi_start_tvsec;birth->second=info.pbi_start_tvusec;
#else
  char path[64];snprintf(path,sizeof(path),"/proc/%d/stat",pid);
  FILE *file=fopen(path,"r");if(!file)return errno==ENOENT?ESRCH:errno;
  char *line=NULL;size_t capacity=0;ssize_t length=getline(&line,&capacity,file);fclose(file);
  if(length<0){free(line);return EIO;}
  char *field=strrchr(line,')');if(!field){free(line);return EINVAL;}
  field+=2;
  for(int index=3;index<22;index++) {
    field=strchr(field,' ');if(!field){free(line);return EINVAL;}field++;
  }
  char *end;errno=0;birth->first=strtoull(field,&end,10);
  int error=errno || end==field?EINVAL:0;free(line);if(error)return error;
  file=fopen("/proc/stat","r");if(!file)return errno;
  line=NULL;capacity=0;int found=0;
  while(getline(&line,&capacity,file)>=0) {
    if(!strncmp(line,"btime ",6)){birth->second=strtoull(line+6,NULL,10);found=1;break;}
  }
  free(line);fclose(file);if(!found)return EIO;
#endif
  return 0;
}
static int br_same_birth(BrBirth a,BrBirth b) {
  return a.pid==b.pid && a.first==b.first && a.second==b.second;
}
/* Registration precedes the keeper's waitpid. A dead/reused birth is ended. */
static int br_lifetime(const char *directory,int *ended) {
  BrBirth saved,current;int error=br_read_file(directory,"native.birth",&saved,sizeof(saved));
  if(error){errno=error;return -1;}
#ifdef __APPLE__
  int fd=kqueue();if(fd<0)return -1;
  fcntl(fd,F_SETFD,FD_CLOEXEC);
  struct kevent event;EV_SET(&event,saved.pid,EVFILT_PROC,EV_ADD|EV_CLEAR,NOTE_EXIT,0,NULL);
  if(kevent(fd,&event,1,NULL,0,NULL)<0) {
    error=errno;close(fd);if(error==ESRCH){*ended=1;return -1;}errno=error;return -1;
  }
#else
  int fd=(int)syscall(SYS_pidfd_open,saved.pid,0);
  if(fd<0){if(errno==ESRCH)*ended=1;return -1;}
  fcntl(fd,F_SETFD,FD_CLOEXEC);
#endif
  error=br_birth(saved.pid,&current);
  if(error || !br_same_birth(saved,current)) {
    close(fd);if(!error || error==ESRCH){*ended=1;return -1;}errno=error;return -1;
  }
  return fd;
}
static int br_watch_file(int spool,const char *path);
static void br_watch_drain(int fd);
static int br_orphan(BatonRetained *retained) {
  if(retained->guard<0)return EBUSY;
  if(retained->watch<0) {
    char *path=br_path(retained->directory,"stdout");
    retained->watch=path?br_watch_file(retained->spool,path):-1;free(path);
    if(retained->watch<0)return errno;
  }
  if(retained->prepared && retained->life<0 && !retained->exited) {
    int ended=0;retained->life=br_lifetime(retained->directory,&ended);
    if(retained->life<0 && !ended)return errno?errno:EIO;
    if(ended)retained->exited=1;
  }
  retained->orphan=1;retained->input_closed=1;retained->version++;
  if(retained->life<0)retained->exited=1;
  return 0;
}
static void br_orphan_exit(BatonRetained *retained) {
  char *path=br_path(retained->directory,"status");FILE *file=path?fopen(path,"r"):NULL;free(path);
  int status;
  if(file && fscanf(file,"%d",&status)==1){retained->status=status;retained->unknown=0;}
  else retained->unknown=1;
  if(file)fclose(file);
  retained->exited=1;retained->version++;
}
static void *br_follow(void *argument) {
  BatonRetained *retained=argument;
  for(;;) {
    pthread_mutex_lock(&retained->state);
    if(retained->exited) {
      br_orphan_exit(retained);pthread_cond_broadcast(&retained->changed);
      pthread_mutex_unlock(&retained->state);return NULL;
    }
    pthread_mutex_unlock(&retained->state);
    struct pollfd fds[2]={{retained->watch,POLLIN,0},{retained->life,POLLIN,0}};
    int ready;do {ready=poll(fds,2,-1);}while(ready<0 && errno==EINTR);
    pthread_mutex_lock(&retained->state);
    if(ready<0)retained->error=errno;
    else {
      if(fds[0].revents&POLLIN){br_watch_drain(retained->watch);retained->version++;}
      if(fds[1].revents&(POLLIN|POLLHUP|POLLERR))br_orphan_exit(retained);
    }
    pthread_cond_broadcast(&retained->changed);
    int done=retained->exited || retained->error;
    pthread_mutex_unlock(&retained->state);if(done)return NULL;
  }
}

static char **br_argv(char *bytes,size_t length) {
  if(!length || bytes[length-1] || !bytes[0]) return NULL;
  size_t count=0;
  for(size_t i=0;i<length;i++) if(!bytes[i]) count++;
  char **argv=calloc(count+1,sizeof(*argv));
  if(!argv) return NULL;
  size_t item=0,start=0;
  for(size_t i=0;i<length;i++) if(!bytes[i]) {argv[item++]=bytes+start;start=i+1;}
  return argv;
}
static char *br_self(void) {
#ifdef __APPLE__
  uint32_t size=0;_NSGetExecutablePath(NULL,&size);
  char *buffer=malloc(size),*path=NULL;
  if(buffer && !_NSGetExecutablePath(buffer,&size)) path=realpath(buffer,NULL);
  free(buffer);return path;
#else
  return realpath("/proc/self/exe",NULL);
#endif
}

/* Every child receives only explicitly assigned descriptors. */
static int br_spawn(pid_t *pid,char **argv,const char *cwd,int input,int output,int error_log,int life,int lock) {
  posix_spawn_file_actions_t actions;
  posix_spawnattr_t attributes;
  int rc=posix_spawn_file_actions_init(&actions);
  if(rc) return rc;
  rc=posix_spawnattr_init(&attributes);
  if(rc) {posix_spawn_file_actions_destroy(&actions);return rc;}
  int originals[5]={input,output,error_log,life,lock}, copies[5]={-1,-1,-1,-1,-1};
  for(int i=0;i<5;i++) if(originals[i]>=0) {
    copies[i]=fcntl(originals[i],F_DUPFD_CLOEXEC,10);
    if(copies[i]<0) {rc=errno;goto done;}
  }
  for(int i=0;i<5;i++) if(copies[i]>=0) {
    rc=posix_spawn_file_actions_adddup2(&actions,copies[i],i);
    if(rc) goto done;
  }
  if(cwd && (rc=posix_spawn_file_actions_addchdir_np(&actions,cwd))) goto done;
  short flags=POSIX_SPAWN_SETPGROUP|POSIX_SPAWN_SETSIGDEF;
#ifdef __APPLE__
  flags|=POSIX_SPAWN_CLOEXEC_DEFAULT;
#else
  rc=posix_spawn_file_actions_addclosefrom_np(&actions,life>=0?5:3);
  if(rc) goto done;
#endif
  sigset_t defaults;sigemptyset(&defaults);sigaddset(&defaults,SIGPIPE);
  if((rc=posix_spawnattr_setsigdefault(&attributes,&defaults))) goto done;
  if((rc=posix_spawnattr_setpgroup(&attributes,0))) goto done;
  if((rc=posix_spawnattr_setflags(&attributes,flags))) goto done;
  rc=posix_spawnp(pid,argv[0],&actions,&attributes,argv,environ);
done:
  for(int i=0;i<5;i++) if(copies[i]>=0) close(copies[i]);
  posix_spawnattr_destroy(&attributes);posix_spawn_file_actions_destroy(&actions);
  return rc;
}
static void *br_reap_detached(void *argument) {
  pid_t pid=(pid_t)(intptr_t)argument;
  while(waitpid(pid,NULL,0)<0 && errno==EINTR) {}
  return NULL;
}
static int br_nonblock(int fd) {
  int flags=fcntl(fd,F_GETFL);
  if(flags<0 || fcntl(fd,F_SETFL,flags|O_NONBLOCK)<0) return errno;
  return 0;
}
static int br_socket_address(struct sockaddr_un *address,const char *path) {
  if(strlen(path)>=sizeof(address->sun_path)) return ENAMETOOLONG;
  memset(address,0,sizeof(*address));address->sun_family=AF_UNIX;
  strcpy(address->sun_path,path);return 0;
}
static void *br_receiver(void *argument) {
  BatonRetained *retained=argument;
  for(;;) {
    BrFrame frame;
    int error=br_read_all(retained->socket,&frame,sizeof(frame));
    BrSnapshot snapshot={0};
    if(!error && frame.op==BR_STATE && frame.length!=sizeof(snapshot))error=EPROTO;
    if(!error && frame.op==BR_STATE && frame.length==sizeof(snapshot))
      error=br_read_all(retained->socket,&snapshot,sizeof(snapshot));
    pthread_mutex_lock(&retained->state);
    if(error || (frame.length && !(frame.op==BR_STATE && frame.length==sizeof(snapshot)))) {
      if(error && !retained->released) {
        retained->error=br_orphan(retained);
        pthread_cond_broadcast(&retained->changed);pthread_mutex_unlock(&retained->state);
        if(!retained->error)return br_follow(retained);
      } else {
        retained->error=error?error:EPROTO;
        pthread_cond_broadcast(&retained->changed);pthread_mutex_unlock(&retained->state);
      }
      break;
    }
    if(frame.op==BR_STATE) {
      retained->snapshot=snapshot;
      if(snapshot.phase==BR_CANCELLED || snapshot.phase==BR_UNSTARTED)retained->exited=1;
      if(snapshot.pid>0 && retained->life<0 && !retained->exited) {
        int ended=0;retained->life=br_lifetime(retained->directory,&ended);
        /* Keeper custody remains available when lifetime setup is unavailable. */
      }
    }
    else if(frame.op==BR_CHANGE) retained->version++;
    else if(frame.op==BR_EXIT) {retained->exited=1;retained->status=(int)frame.value;retained->version++;}
    else if(frame.op==BR_REPLY) {retained->reply_serial=frame.serial;retained->reply_error=frame.error;}
    else if(frame.op==BR_INPUT_CLOSED) retained->input_closed=1;
    else retained->error=EPROTO;
    pthread_cond_broadcast(&retained->changed);pthread_mutex_unlock(&retained->state);
  }
  return NULL;
}
static int br_hello(int socket,BrFrame *hello,int *guard) {
  char control[CMSG_SPACE(sizeof(int))];struct iovec vector={hello,sizeof(*hello)};
  struct msghdr message={.msg_iov=&vector,.msg_iovlen=1,.msg_control=control,.msg_controllen=sizeof(control)};
  ssize_t length;do {length=recvmsg(socket,&message,MSG_WAITALL);}while(length<0 && errno==EINTR);
  if(length<=0)return length<0?errno:EPIPE;
  for(struct cmsghdr *header=CMSG_FIRSTHDR(&message);header;header=CMSG_NXTHDR(&message,header)) {
    if(header->cmsg_level!=SOL_SOCKET || header->cmsg_type!=SCM_RIGHTS || header->cmsg_len!=CMSG_LEN(sizeof(int)))return EPROTO;
    memcpy(guard,CMSG_DATA(header),sizeof(int));
    if(fcntl(*guard,F_SETFD,FD_CLOEXEC)<0)return errno;
  }
  if(message.msg_flags&MSG_CTRUNC)return EPROTO;
  return (size_t)length<sizeof(*hello)?br_read_all(socket,(char *)hello+length,sizeof(*hello)-(size_t)length):0;
}
static int br_attach_socket(BatonChild *child,const char *directory,int socket,int *unstarted) {
  BrFrame hello;BrState state={0};int guard=-1;
  int error=br_hello(socket,&hello,&guard);
  if(!error && hello.error) {
    error=hello.error;
    if(unstarted && hello.op==BR_HELLO && hello.value==1)*unstarted=1;
  }
  if(!error && (hello.op!=BR_HELLO || hello.length!=sizeof(state)))error=EPROTO;
  if(!error)error=br_read_all(socket,&state,sizeof(state));
  char *path=br_path(directory,"stdout");int spool=-1;
  if(!error){spool=path?open(path,O_RDONLY|O_CLOEXEC):-1;if(spool<0)error=path?errno:ENOMEM;}
  free(path);
  int life=-1,ended=state.exited;
  if(!error && hello.value==2 && !ended) {
    life=br_lifetime(directory,&ended);if(life<0 && !ended)error=errno;
  }
  BatonRetained *retained=error?NULL:calloc(1,sizeof(*retained));
  if(!error && !retained)error=ENOMEM;
  if(error){if(life>=0)close(life);if(guard>=0)close(guard);if(spool>=0)close(spool);close(socket);return error;}
  retained->socket=socket;retained->spool=spool;retained->guard=guard;retained->life=life;retained->watch=-1;
  retained->directory=strdup(directory);retained->exited=state.exited;retained->status=state.status;
  retained->input_closed=state.input_closed;retained->released=state.released;retained->prepared=hello.value==3;
  pthread_mutex_init(&retained->state,NULL);pthread_mutex_init(&retained->command,NULL);
  pthread_mutex_init(&retained->reader,NULL);pthread_cond_init(&retained->changed,NULL);
  if(!retained->directory)error=ENOMEM;
  if(!error && (hello.value==2 || hello.value==3)) {
    BrFrame ready={.op=BR_READY};error=br_write_all(socket,&ready,sizeof(ready));
  }
  if(!error)error=pthread_create(&retained->receiver,NULL,br_receiver,retained);
  if(error){if(life>=0)close(life);if(guard>=0)close(guard);close(spool);close(socket);free(retained->directory);free(retained);return error;}
  child->pid=state.pid;child->retained=retained;
  return 0;
}
static int br_attach_orphan(BatonChild *child,const char *directory,int guard) {
  BatonRetained *retained=calloc(1,sizeof(*retained));if(!retained)return ENOMEM;
  retained->socket=-1;retained->spool=-1;retained->watch=-1;retained->life=-1;
  retained->guard=fcntl(guard,F_DUPFD_CLOEXEC,10);retained->directory=strdup(directory);
  int error=retained->guard<0?errno:!retained->directory?ENOMEM:0;
  BrBirth birth;
  if(!error)error=br_read_file(directory,"native.birth",&birth,sizeof(birth));
  char *path=br_path(directory,"stdout");
  if(!error){retained->spool=path?open(path,O_RDONLY|O_CLOEXEC):-1;if(retained->spool<0)error=errno;}
  free(path);
  if(!error){retained->life=br_lifetime(directory,&retained->exited);if(retained->life<0 && !retained->exited)error=errno;}
  pthread_mutex_init(&retained->state,NULL);pthread_mutex_init(&retained->command,NULL);
  pthread_mutex_init(&retained->reader,NULL);pthread_cond_init(&retained->changed,NULL);
  if(!error)error=br_orphan(retained);
  if(!error)error=pthread_create(&retained->receiver,NULL,br_follow,retained);
  if(error){if(retained->guard>=0)close(retained->guard);if(retained->spool>=0)close(retained->spool);
    if(retained->life>=0)close(retained->life);if(retained->watch>=0)close(retained->watch);
    free(retained->directory);free(retained);return error;}
  child->pid=birth.pid;child->retained=retained;return 0;
}
static int br_request(BatonRetained *retained,uint32_t op,const char *data,size_t length,int64_t value) {
  pthread_mutex_lock(&retained->command);
  pthread_mutex_lock(&retained->state);
  uint64_t serial=++retained->serial;
  int error=retained->error;
  pthread_mutex_unlock(&retained->state);
  BrFrame frame={.op=op,.serial=serial,.length=length,.value=value};
  if(!error) error=br_write_all(retained->socket,&frame,sizeof(frame));
  if(!error && length) error=br_write_all(retained->socket,data,length);
  if(error==EPIPE || error==ECONNRESET) {
    pthread_mutex_lock(&retained->state);
    while(!retained->orphan && !retained->error && !retained->released)
      pthread_cond_wait(&retained->changed,&retained->state);
    if(retained->error)error=retained->error;
    pthread_mutex_unlock(&retained->state);
  }
  if(!error) {
    pthread_mutex_lock(&retained->state);
    while(retained->reply_serial<serial && !retained->error && !retained->orphan)
      pthread_cond_wait(&retained->changed,&retained->state);
    error=retained->reply_serial==serial?retained->reply_error:retained->orphan?EPIPE:retained->error;
    pthread_mutex_unlock(&retained->state);
  }
  pthread_mutex_unlock(&retained->command);
  return error;
}
static void br_read_line(BatonProcessCall *call) {
  BatonRetained *retained=call->child->retained;
  pthread_mutex_lock(&retained->reader);
  size_t capacity=0;
  for(;;) {
    pthread_mutex_lock(&retained->state);
    uint64_t version=retained->version;int exited=retained->exited;
    call->error=retained->error;pthread_mutex_unlock(&retained->state);
    if(call->error) break;
    char chunk[8192];ssize_t n=pread(retained->spool,chunk,sizeof(chunk),retained->offset);
    if(n<0 && errno==EINTR) continue;
    if(n<0) {call->error=errno;break;}
    if(n) {
      char *newline=memchr(chunk,'\n',(size_t)n);
      size_t count=newline?(size_t)(newline-chunk)+1:(size_t)n;
      if(count>SIZE_MAX-call->length-1) {call->error=EOVERFLOW;break;}
      if(call->length+count+1>capacity) {
        size_t required=call->length+count+1;
        size_t next=capacity && capacity<=SIZE_MAX/2?capacity*2:required;
        if(next<required)next=required;
        char *buffer=realloc(call->text,next);
        if(!buffer) {call->error=ENOMEM;break;}
        call->text=buffer;capacity=next;
      }
      memcpy(call->text+call->length,chunk,count);call->length+=count;
      call->text[call->length]=0;retained->offset+=(off_t)count;
      if(newline) {call->length--;break;}
      continue;
    }
    pthread_mutex_lock(&retained->state);
    if(retained->error) call->error=retained->error;
    else if(exited) call->eof=call->length==0;
    else if(!retained->exited) {
      while(version==retained->version && !retained->exited && !retained->error)
        pthread_cond_wait(&retained->changed,&retained->state);
    }
    pthread_mutex_unlock(&retained->state);
    if(call->error || exited) break;
  }
  pthread_mutex_unlock(&retained->reader);
}
static void baton_retained_call(BatonProcessCall *call) {
  BatonRetained *retained=call->child->retained;
  if(call->kind==BP_READ) {br_read_line(call);return;}
  if(call->kind==BP_INPUT_CLOSED) {
    pthread_mutex_lock(&retained->state);
    call->error=retained->error;call->signal=(u32)(retained->input_closed || retained->exited);
    pthread_mutex_unlock(&retained->state);return;
  }
  if(call->kind==BP_WAIT) {
    pthread_mutex_lock(&retained->state);
    while(!retained->exited && !retained->error) pthread_cond_wait(&retained->changed,&retained->state);
    call->error=retained->error;int status=retained->status;
    pthread_mutex_unlock(&retained->state);
    if(call->error) return;
    char text[64];
    if(retained->prepared && (retained->snapshot.phase==BR_CANCELLED || retained->snapshot.phase==BR_UNSTARTED))snprintf(text,sizeof(text),"not started");
    else if(retained->unknown) snprintf(text,sizeof(text),"unknown after keeper loss");
    else if(WIFEXITED(status)) snprintf(text,sizeof(text),"exit %d",WEXITSTATUS(status));
    else if(WIFSIGNALED(status)) snprintf(text,sizeof(text),"signal %d",WTERMSIG(status));
    else {call->error=ECHILD;return;}
    call->text=strdup(text);call->length=strlen(text);call->child->reaped=1;
    if(!call->text) call->error=ENOMEM;
    return;
  }
  uint32_t op=call->kind==BP_WRITE?BR_WRITE:call->kind==BP_CLOSE?BR_CLOSE:
    call->kind==BP_SIGNAL?BR_SIGNAL:call->kind==BP_RELEASE?BR_RELEASE:
    call->kind==BP_START?BR_START:call->kind==BP_STATE?BR_STATE:call->kind==BP_CANCEL?BR_CANCEL:BR_ACK;
  pthread_mutex_lock(&retained->state);int orphan=retained->orphan;pthread_mutex_unlock(&retained->state);
  call->error=orphan?EPIPE:br_request(retained,op,call->text,(call->kind==BP_WRITE || call->kind==BP_START || call->kind==BP_CANCEL)?call->length:0,call->signal);
  pthread_mutex_lock(&retained->state);orphan=retained->orphan;int exited=retained->exited;pthread_mutex_unlock(&retained->state);
  if(orphan && (call->error==EPIPE || call->error==ECONNRESET)) {
    if(op==BR_CLOSE)call->error=0;
    else if(op==BR_RELEASE || op==BR_ACK) {
      call->error=exited?br_file(retained->directory,op==BR_RELEASE?"released":"acknowledged",
        op==BR_RELEASE?"released\n":"acknowledged\n",op==BR_RELEASE?9:13,1):EBUSY;
      if(call->error==EEXIST)call->error=0;
    } else if(op==BR_SIGNAL)call->error=exited?ESRCH:kill(-call->child->pid,(int)call->signal)?errno:0;
  }
  if(!call->error && (call->kind==BP_START || call->kind==BP_STATE || call->kind==BP_CANCEL)) {
    pthread_mutex_lock(&retained->state);BrSnapshot state=retained->snapshot;pthread_mutex_unlock(&retained->state);
    if(state.phase<BR_PREPARED || state.phase>BR_CANCELLED) {call->error=EPROTO;return;}
    call->signal=(u32)state.phase;
    const char *phases[]={"prepared","starting","running","exited","unstarted","unknown","cancelled"};
    char text[512];
    int n=snprintf(text,sizeof(text),"{\"protocol\":1,\"preparedMode\":%s,\"processState\":\"%s\",\"nativePid\":%d,\"waitStatus\":%d,\"startError\":%d,\"observerAttached\":%s,\"released\":%s,\"keeper\":{\"pid\":%d,\"first\":%llu,\"second\":%llu}}",
      state.prepared?"true":"false",phases[state.phase],state.pid,state.status,state.start_error,state.attached?"true":"false",state.released?"true":"false",
      state.keeper.pid,(unsigned long long)state.keeper.first,(unsigned long long)state.keeper.second);
    free(call->text);call->text=strdup(text);call->length=(size_t)n;call->child->pid=state.pid;
    if(!call->text)call->error=ENOMEM;
  }
  if(!call->error && call->kind==BP_RELEASE) {
    pthread_mutex_lock(&retained->state);retained->released=1;pthread_mutex_unlock(&retained->state);
    if(retained->guard>=0){close(retained->guard);retained->guard=-1;}
  }
  if(!call->error && call->kind==BP_ACK) {
    if(retained->socket>=0)shutdown(retained->socket,SHUT_RDWR);
    pthread_join(retained->receiver,NULL);
    if(retained->socket>=0)close(retained->socket);retained->socket=-1;
    close(retained->spool);retained->spool=-1;
    if(retained->life>=0)close(retained->life);retained->life=-1;
    if(retained->watch>=0)close(retained->watch);retained->watch=-1;
  }
}

static void br_buffer_free(BrBuffer **head,BrBuffer **tail) {
  while(*head) {BrBuffer *next=(*head)->next;free((*head)->data);free(*head);*head=next;}
  *tail=NULL;
}
static int br_queue(BrBuffer **head,BrBuffer **tail,const void *data,size_t length,uint64_t serial,uint64_t generation,int close_input) {
  BrBuffer *buffer=calloc(1,sizeof(*buffer));
  if(!buffer) return ENOMEM;
  if(length) {buffer->data=malloc(length);if(!buffer->data){free(buffer);return ENOMEM;}memcpy(buffer->data,data,length);}
  buffer->rights=-1;buffer->length=length;buffer->serial=serial;buffer->generation=generation;buffer->close_input=close_input;
  if(*tail) (*tail)->next=buffer;else *head=buffer;*tail=buffer;
  return 0;
}
static int br_send(BrKeeper *keeper,BrFrame frame,const void *payload) {
  if(keeper->client<0) return 0;
  size_t size=sizeof(frame)+(size_t)frame.length;
  char *bytes=malloc(size);if(!bytes)return ENOMEM;
  memcpy(bytes,&frame,sizeof(frame));if(frame.length)memcpy(bytes+sizeof(frame),payload,(size_t)frame.length);
  int error=br_queue(&keeper->outgoing,&keeper->outgoing_tail,bytes,size,0,0,0);
  if(!error && frame.op==BR_HELLO && keeper->lock>=0)keeper->outgoing_tail->rights=keeper->lock;
  free(bytes);return error;
}
static int br_reply(BrKeeper *keeper,uint64_t serial,uint64_t generation,int error) {
  if(!serial || generation!=keeper->generation) return 0;
  return br_send(keeper,(BrFrame){.op=BR_REPLY,.serial=serial,.error=error},NULL);
}
typedef struct { int kind,status; pid_t pid; uint64_t generation; } BrWake;
typedef struct { BrWake event; int descriptor; } BrWaiter;
static void *br_waiter(void *argument) {
  BrWaiter *waiter=argument;
  int result;
  if(waiter->event.kind=='N') {
    /* Keep the native PID reserved until the keeper handles exit and signals. */
    siginfo_t info;
    do {result=waitid(P_PID,waiter->event.pid,&info,WEXITED|WNOWAIT);} while(result<0 && errno==EINTR);
  } else {
    do {result=waitpid(waiter->event.pid,&waiter->event.status,0);} while(result<0 && errno==EINTR);
  }
  if(result<0) waiter->event.status=-1;
  br_write_all(waiter->descriptor,&waiter->event,sizeof(waiter->event));
  close(waiter->descriptor);free(waiter);return NULL;
}
static int br_wait_start(BrKeeper *keeper,pid_t pid,int kind) {
  BrWaiter *waiter=calloc(1,sizeof(*waiter));
  if(!waiter)return ENOMEM;
  waiter->event=(BrWake){.kind=kind,.pid=pid,.generation=keeper->generation};
  waiter->descriptor=fcntl(keeper->wake[1],F_DUPFD_CLOEXEC,10);
  if(waiter->descriptor<0){int error=errno;free(waiter);return error;}
  pthread_t thread;int error=pthread_create(&thread,NULL,br_waiter,waiter);
  if(error){close(waiter->descriptor);free(waiter);return error;}
  pthread_detach(thread);return 0;
}
static uint64_t br_monotonic_ms(void) {
  struct timespec now;
  if(clock_gettime(CLOCK_MONOTONIC,&now))return 0;
  return (uint64_t)now.tv_sec*1000+(uint64_t)now.tv_nsec/1000000;
}
static void br_recovery_note(BrKeeper *keeper,int error,int status) {
  char text[256];
  int n=snprintf(text,sizeof(text),"attempt %llu monotonicMs %llu error %d status %d\n",
    (unsigned long long)keeper->recovery_attempt,(unsigned long long)br_monotonic_ms(),error,status);
  /* The first diagnostic and the current diagnostic have separate retention. */
  br_file(keeper->directory,"observer-first-error",text,(size_t)n,1);
  char *temporary=br_path(keeper->directory,"observer-error.next");
  char *path=br_path(keeper->directory,"observer-error");
  int fd=temporary?open(temporary,O_WRONLY|O_CREAT|O_TRUNC|O_CLOEXEC,0600):-1;
  if(fd>=0) {
    int failed=br_write_all(fd,text,(size_t)n);
    if(!failed && fsync(fd))failed=errno;
    close(fd);
    if(!failed && path)rename(temporary,path);
  }
  free(temporary);free(path);
}
static void br_recovery_arm(BrKeeper *keeper) {
  if(!keeper->finishing && keeper->client<0)
    keeper->recovery_due=br_monotonic_ms()+1000;
}
static void br_recover(BrKeeper *keeper) {
  if(keeper->finishing || keeper->client>=0 || keeper->recovery_pid>0)return;
  keeper->recovery_due=0;keeper->recovery_attempt++;
  char **argv=br_argv(keeper->manifest.field[4],(size_t)keeper->manifest.header.lengths[4]);
  char *path=br_path(keeper->directory,"observer.log");
  int null=open("/dev/null",O_RDONLY|O_CLOEXEC),log=path?open(path,O_WRONLY|O_CREAT|O_APPEND|O_CLOEXEC,0600):-1;
  pid_t pid=0;
  int error=argv&&path&&null>=0&&log>=0?br_spawn(&pid,argv,keeper->manifest.field[1],null,log,log,-1,-1):errno?errno:ENOMEM;
  if(null>=0)close(null);if(log>=0)close(log);free(path);free(argv);
  if(!error) {
    keeper->recovery_pid=pid;
    error=br_wait_start(keeper,pid,'R');
    keeper->recovery_waiting=!error;
  }
  if(error) {br_recovery_note(keeper,error,-1);br_recovery_arm(keeper);}
}
/* A failed waiter leaves the keeper as this child's parent. waitpid both
   qualifies its end and reaps it before another recovery child can exist. */
static int br_recovery_tick(BrKeeper *keeper) {
  uint64_t now=br_monotonic_ms();
  if(keeper->recovery_pid>0 && !keeper->recovery_waiting) {
    int status=0;pid_t ended;
    do {ended=waitpid(keeper->recovery_pid,&status,WNOHANG);}while(ended<0 && errno==EINTR);
    if(ended==keeper->recovery_pid) {
      keeper->recovery_pid=0;
      if(keeper->client<0) {br_recovery_note(keeper,0,status);br_recovery_arm(keeper);}
    }
    /* An unavailable child observation preserves ownership uncertainty. */
  }
  if(keeper->client>=0 || keeper->finishing)keeper->recovery_due=0;
  else if(!keeper->recovery_pid && keeper->recovery_due && now>=keeper->recovery_due)
    br_recover(keeper);
  int timeout=-1;
  if(keeper->recovery_pid>0 && !keeper->recovery_waiting)timeout=1000;
  if(keeper->recovery_due && !keeper->recovery_pid) {
    now=br_monotonic_ms();
    int delay=now>=keeper->recovery_due?0:(int)(keeper->recovery_due-now);
    if(timeout<0 || delay<timeout)timeout=delay;
  }
  return timeout;
}
static void br_disconnected(BrKeeper *keeper) {
  if(keeper->client>=0) close(keeper->client);
  keeper->client=-1;keeper->ready=0;keeper->incoming_size=0;keeper->change_queued=0;
  br_buffer_free(&keeper->outgoing,&keeper->outgoing_tail);
  if(!keeper->finishing) br_recover(keeper);
}
static int br_native_exited(BrKeeper *keeper) {
  if(!keeper->ready || !keeper->native_waiting)return 0;
  pid_t reaped;int status;
  do {reaped=waitpid(keeper->native_pid,&status,0);}while(reaped<0 && errno==EINTR);
  if(reaped<0)return errno;
  keeper->status=status;keeper->exited=1;keeper->native_waiting=0;keeper->phase=BR_EXITED;
  char text[64];int n=snprintf(text,sizeof(text),"%d\n",status);
  int error=br_file(keeper->directory,"status",text,(size_t)n,1);
  return error?error:br_send(keeper,(BrFrame){.op=BR_EXIT,.value=status},NULL);
}
static int br_snapshot(BrKeeper *keeper) {
  BrSnapshot state={.keeper=keeper->birth,.phase=keeper->phase,.pid=keeper->native_pid,
    .status=keeper->exited && keeper->native_pid?keeper->status:-1,.start_error=keeper->start_error,
    .attached=keeper->ready,.prepared=keeper->manifest.header.reserved==1,.released=keeper->released};
  return br_send(keeper,(BrFrame){.op=BR_STATE,.length=sizeof(state)},&state);
}
static int br_grant(BrKeeper *keeper) {
  if(keeper->start_attempt)return 0;
  keeper->start_attempt=1;keeper->phase=BR_STARTING;
  int error=br_file(keeper->directory,"start-attempt","start\n",6,1);
  if(error) {keeper->phase=BR_UNKNOWN;keeper->start_error=error;return 0;}
  int input[2];error=baton_pipe(input);
  if(error)goto unstarted;
  keeper->input=input[1];
  int log=open(keeper->manifest.field[2],O_WRONLY|O_CREAT|O_APPEND|O_CLOEXEC,0600);
  char **argv=br_argv(keeper->manifest.field[0],(size_t)keeper->manifest.header.lengths[0]);
  if(log<0 || !argv)error=log<0?errno:ENOMEM;
  if(!error)error=br_nonblock(keeper->input);
  if(!error)error=br_queue(&keeper->writes,&keeper->writes_tail,keeper->manifest.field[3],
                          (size_t)keeper->manifest.header.lengths[3],0,0,0);
  if(!error && !keeper->manifest.header.keep_stdin) {
    error=br_queue(&keeper->writes,&keeper->writes_tail,NULL,0,0,0,1);keeper->input_closed=1;
  }
  if(!error)error=br_spawn(&keeper->native_pid,argv,keeper->manifest.field[1],input[0],keeper->spool,log,-1,-1);
  free(argv);if(log>=0)close(log);close(input[0]);
  if(error){close(keeper->input);keeper->input=-1;goto unstarted;}
  keeper->phase=BR_RUNNING;
  char pid[64];int n=snprintf(pid,sizeof(pid),"%d\n",keeper->native_pid);
  error=br_file(keeper->directory,"native.pid",pid,(size_t)n,1);
  BrBirth birth;int observed=br_birth(keeper->native_pid,&birth);
  if(!observed)observed=br_file(keeper->directory,"native.birth",&birth,sizeof(birth),1);
  if(!error)error=observed;
  observed=br_wait_start(keeper,keeper->native_pid,'N');keeper->native_watcher=!observed;
  if(!error)error=observed;
  if(error) {
    keeper->start_error=error;br_note(keeper,"native-setup-error",error);
    if(keeper->input>=0)close(keeper->input);keeper->input=-1;keeper->input_closed=1;
    br_buffer_free(&keeper->writes,&keeper->writes_tail);
  }
  return 0;
unstarted:
  keeper->phase=BR_UNSTARTED;keeper->start_error=error;keeper->exited=1;
  br_buffer_free(&keeper->writes,&keeper->writes_tail);
  br_note(keeper,"native-start-error",error);return 0;
}
static int br_command(BrKeeper *keeper,BrFrame frame,const char *payload) {
  int error=0;
  if(frame.op==BR_START || frame.op==BR_CANCEL || frame.op==BR_STATE) {
    if(frame.op==BR_STATE) {if(frame.length)error=EINVAL;}
    else if(keeper->manifest.header.reserved!=1 || frame.length!=keeper->identity_length ||
            memcmp(payload,keeper->identity,(size_t)frame.length))error=EINVAL;
    else if(frame.op==BR_START) {
      if(keeper->phase==BR_CANCELLED)error=ECANCELED;
      else error=br_grant(keeper);
    } else if(keeper->start_attempt)error=EBUSY;
    else {keeper->phase=BR_CANCELLED;keeper->exited=1;}
    if(!error)error=br_snapshot(keeper);
    return br_reply(keeper,frame.serial,keeper->generation,error);
  }
  if(frame.op==BR_WRITE || frame.op==BR_CLOSE) {
    if(frame.op==BR_CLOSE && frame.length) return EPROTO;
    if(!keeper->native_pid || (frame.op==BR_WRITE && (keeper->input_closed || keeper->exited)))
      return br_reply(keeper,frame.serial,keeper->generation,EPIPE);
    error=br_queue(&keeper->writes,&keeper->writes_tail,payload,(size_t)frame.length,
                   frame.serial,keeper->generation,frame.op==BR_CLOSE);
    if(!error && frame.op==BR_CLOSE && !keeper->input_closed) {
      /* Accepted closure also covers input still queued before the close. */
      keeper->input_closed=1;
      error=br_send(keeper,(BrFrame){.op=BR_INPUT_CLOSED},NULL);
    }
    return error;
  }
  if(frame.length) return EPROTO;
  if(frame.op==BR_READY) {keeper->ready=1;return br_native_exited(keeper);}
  if(frame.op==BR_SIGNAL) {
    if(keeper->exited || !keeper->native_pid)error=ESRCH;
    else if(kill(-keeper->native_pid,(int)frame.value))error=errno;
  }
  else if(frame.op==BR_RELEASE) {
    if(!keeper->exited) error=EBUSY;
    else if(!keeper->released) {
      if(close(keeper->lock)) error=errno;
      else {keeper->lock=-1;keeper->released=1;error=br_file(keeper->directory,"released","released\n",9,1);}
    }
  } else if(frame.op==BR_ACK) {
    if(!keeper->exited || !keeper->released) error=EBUSY;
    else {
      error=br_file(keeper->directory,"acknowledged","acknowledged\n",13,1);
      if(!error) {
        keeper->finishing=1;
        char *path=br_path(keeper->directory,"stdout");
        int cleanup=path?0:ENOMEM;
        if(path && unlink(path) && errno!=ENOENT)cleanup=errno;
        free(path);
        if(cleanup)br_note(keeper,"cleanup-error",cleanup);
      }
    }
  } else error=EINVAL;
  return br_reply(keeper,frame.serial,keeper->generation,error);
}
static int br_read_commands(BrKeeper *keeper) {
  char buffer[8192];ssize_t n=read(keeper->client,buffer,sizeof(buffer));
  if(n<0 && (errno==EINTR || errno==EAGAIN)) return 0;
  if(n<=0) {br_disconnected(keeper);return 0;}
  if((size_t)n>SIZE_MAX-keeper->incoming_size) return EOVERFLOW;
  size_t size=keeper->incoming_size+(size_t)n;
  if(size>keeper->incoming_capacity) {
    char *next=realloc(keeper->incoming,size);
    if(!next) return ENOMEM;keeper->incoming=next;keeper->incoming_capacity=size;
  }
  memcpy(keeper->incoming+keeper->incoming_size,buffer,(size_t)n);keeper->incoming_size=size;
  while(keeper->incoming_size>=sizeof(BrFrame)) {
    BrFrame frame;memcpy(&frame,keeper->incoming,sizeof(frame));
    if(frame.length>SIZE_MAX-sizeof(frame)) return EOVERFLOW;
    size_t consumed=sizeof(frame)+(size_t)frame.length;
    if(keeper->incoming_size<consumed) break;
    int error=br_command(keeper,frame,keeper->incoming+sizeof(frame));
    if(error) return error;
    keeper->incoming_size-=consumed;
    memmove(keeper->incoming,keeper->incoming+consumed,keeper->incoming_size);
  }
  return 0;
}
static int br_flush_commands(BrKeeper *keeper) {
  while(keeper->writes) {
    BrBuffer *buffer=keeper->writes;int error=0;
    if(buffer->close_input) {if(keeper->input>=0)close(keeper->input);keeper->input=-1;}
    else if(keeper->input<0) error=EPIPE;
    else if(buffer->offset<buffer->length) {
      ssize_t n=write(keeper->input,buffer->data+buffer->offset,buffer->length-buffer->offset);
      if(n<0 && errno==EINTR) continue;
      if(n<0 && errno==EAGAIN) break;
      if(n<=0) error=n<0?errno:EIO;
      else {buffer->offset+=(size_t)n;if(buffer->offset<buffer->length)break;}
    }
    if(error && !buffer->serial)br_note(keeper,"initial-input-error",error);
    int reply=0;
    if(buffer->control) {
      buffer->control->pending=0;buffer->control->answered=1;
      buffer->control->reply=(BrFrame){.op=BR_REPLY,.serial=buffer->serial,.error=error};
    } else reply=br_reply(keeper,buffer->serial,buffer->generation,error);
    keeper->writes=buffer->next;if(!keeper->writes)keeper->writes_tail=NULL;
    free(buffer->data);free(buffer);
    if(reply) return reply;
  }
  return 0;
}
static int br_flush_responses(BrKeeper *keeper) {
  while(keeper->outgoing && keeper->client>=0) {
    BrBuffer *buffer=keeper->outgoing;
    ssize_t n;
    if(buffer->rights>=0 && !buffer->offset) {
      char control[CMSG_SPACE(sizeof(int))];struct iovec vector={buffer->data,buffer->length};
      struct msghdr message={.msg_iov=&vector,.msg_iovlen=1,.msg_control=control,.msg_controllen=sizeof(control)};
      struct cmsghdr *header=CMSG_FIRSTHDR(&message);header->cmsg_level=SOL_SOCKET;header->cmsg_type=SCM_RIGHTS;
      header->cmsg_len=CMSG_LEN(sizeof(int));memcpy(CMSG_DATA(header),&buffer->rights,sizeof(int));
      n=sendmsg(keeper->client,&message,0);
    } else n=write(keeper->client,buffer->data+buffer->offset,buffer->length-buffer->offset);
    if(n<0 && errno==EINTR) continue;
    if(n<0 && errno==EAGAIN) break;
    if(n<=0) {br_disconnected(keeper);break;}
    buffer->offset+=(size_t)n;
    if(buffer->offset<buffer->length) break;
    keeper->outgoing=buffer->next;if(!keeper->outgoing)keeper->outgoing_tail=NULL;
    if(buffer->change)keeper->change_queued=0;
    free(buffer->data);free(buffer);
  }
  return 0;
}
static void br_control_close(BrControl *control) {
  if(control->socket>=0)close(control->socket);
  control->socket=-1;
}
static void br_control_reply(BrControl *control,uint64_t serial,int error) {
  control->reply=(BrFrame){.op=BR_REPLY,.serial=serial,.error=error};
  control->answered=1;
}
static int br_control_command(BrKeeper *keeper,BrControl *control,BrFrame frame,const char *payload) {
  const char *end=memchr(payload,0,(size_t)frame.length);
  int error=0;
  if(!end || strcmp(payload,keeper->directory))error=EINVAL;
  else if(keeper->finishing)error=ESHUTDOWN;
  if(error) {br_control_reply(control,frame.serial,error);return 0;}
  size_t identity=(size_t)(end-payload)+1;
  if(frame.op==BR_ATTACH) {
    if(frame.length!=identity || frame.serial)error=EPROTO;
    else if(keeper->client>=0)error=EBUSY;
    if(error) {
      control->reply=(BrFrame){.op=BR_HELLO,.error=error};control->answered=1;
    } else {
      keeper->client=control->socket;control->socket=-1;keeper->generation++;keeper->ready=0;
      BrState state={keeper->native_pid,keeper->exited,keeper->status,keeper->released,keeper->input_closed};
      return br_send(keeper,(BrFrame){.op=BR_HELLO,.length=sizeof(state),.value=keeper->manifest.header.reserved?3:2},&state);
    }
  } else if(!frame.serial)br_control_reply(control,frame.serial,EPROTO);
  else if(frame.op==BR_CONTROL_WRITE) {
    if(keeper->input_closed || keeper->exited || !keeper->native_pid)error=EPIPE;
    else {
      error=br_queue(&keeper->writes,&keeper->writes_tail,payload+identity,
                     (size_t)frame.length-identity,frame.serial,0,0);
      if(!error) {keeper->writes_tail->control=control;control->pending=1;}
    }
    if(error)br_control_reply(control,frame.serial,error);
  } else if(frame.op==BR_CONTROL_SIGNAL) {
    if(frame.length!=identity || frame.value<=0 || frame.value>=NSIG)error=EINVAL;
    else if(keeper->exited || !keeper->native_pid)error=ESRCH;
    else if(kill(-keeper->native_pid,(int)frame.value))error=errno;
    br_control_reply(control,frame.serial,error);
  } else br_control_reply(control,frame.serial,EINVAL);
  return 0;
}
static int br_control_read(BrKeeper *keeper,BrControl *control) {
  char buffer[8192];ssize_t n=read(control->socket,buffer,sizeof(buffer));
  if(n<0 && (errno==EINTR || errno==EAGAIN))return 0;
  if(n<=0) {br_control_close(control);return 0;}
  if(control->answered || control->pending) {br_control_close(control);return 0;}
  if((size_t)n>SIZE_MAX-control->size) {br_control_close(control);return 0;}
  size_t size=control->size+(size_t)n;
  if(size>control->capacity) {
    char *next=realloc(control->incoming,size);
    if(!next)return ENOMEM;
    control->incoming=next;control->capacity=size;
  }
  memcpy(control->incoming+control->size,buffer,(size_t)n);control->size=size;
  if(size>=sizeof(BrFrame)) {
    BrFrame frame;memcpy(&frame,control->incoming,sizeof(frame));
    if(frame.length>SIZE_MAX-sizeof(frame)) {br_control_close(control);return 0;}
    size_t complete=sizeof(frame)+(size_t)frame.length;
    if(size>complete) {br_control_close(control);return 0;}
    if(size==complete) {
      int error=br_control_command(keeper,control,frame,control->incoming+sizeof(frame));
      free(control->incoming);control->incoming=NULL;control->size=control->capacity=0;
      return error;
    }
  }
  return 0;
}
static void br_control_flush(BrControl *control) {
  if(!control->answered || control->socket<0)return;
  while(control->sent<sizeof(control->reply)) {
    ssize_t n=write(control->socket,(char *)&control->reply+control->sent,sizeof(control->reply)-control->sent);
    if(n<0 && errno==EINTR)continue;
    if(n<0 && errno==EAGAIN)return;
    if(n<=0) {br_control_close(control);return;}
    control->sent+=(size_t)n;
  }
  br_control_close(control);
}
static int br_watch_file(int spool,const char *path) {
#ifdef __APPLE__
  int fd=kqueue();if(fd<0)return -1;
  fcntl(fd,F_SETFD,FD_CLOEXEC);
  struct kevent event;EV_SET(&event,spool,EVFILT_VNODE,EV_ADD|EV_CLEAR,NOTE_WRITE|NOTE_EXTEND,0,NULL);
  if(kevent(fd,&event,1,NULL,0,NULL)<0){int error=errno;close(fd);errno=error;return -1;}
  return fd;
#else
  int fd=inotify_init1(IN_NONBLOCK|IN_CLOEXEC);if(fd<0)return -1;
  if(inotify_add_watch(fd,path,IN_MODIFY|IN_CLOSE_WRITE)<0){int error=errno;close(fd);errno=error;return -1;}
  return fd;
#endif
}
static void br_watch_drain(int fd) {
#ifdef __APPLE__
  struct kevent events[8];struct timespec zero={0,0};
  kevent(fd,NULL,0,events,8,&zero);
#else
  char events[4096];while(read(fd,events,sizeof(events))>0) {}
#endif
}
static int br_keep(BrKeeper *keeper) {
  for(;;) {
    int error=br_flush_commands(keeper);if(error)return error;
    br_flush_responses(keeper);
    BrControl **link=&keeper->controls;size_t count=5;
    while(*link) {
      BrControl *control=*link;br_control_flush(control);
      if(control->socket<0 && !control->pending) {
        *link=control->next;free(control->incoming);free(control);
      } else {count++;link=&control->next;}
    }
    if(keeper->finishing && !keeper->outgoing) return 0;
    struct pollfd *fds=calloc(count,sizeof(*fds));
    BrControl **clients=calloc(count,sizeof(*clients));
    if(!fds || !clients) {free(fds);free(clients);return ENOMEM;}
    fds[0]=(struct pollfd){keeper->listener,POLLIN,0};
    fds[1]=(struct pollfd){keeper->client,POLLIN|(keeper->outgoing?POLLOUT:0),0};
    fds[2]=(struct pollfd){keeper->watch,POLLIN,0};
    fds[3]=(struct pollfd){keeper->wake[0],POLLIN,0};
    fds[4]=(struct pollfd){keeper->writes?keeper->input:-1,POLLOUT,0};
    size_t index=5;
    for(BrControl *control=keeper->controls;control;control=control->next,index++) {
      clients[index]=control;fds[index]=(struct pollfd){control->socket,POLLIN|(control->answered?POLLOUT:0),0};
    }
    int native_poll=keeper->native_pid && !keeper->exited && !keeper->native_watcher;
    if(native_poll && !keeper->native_waiting) {
      siginfo_t info={0};int result;
      do {result=waitid(P_PID,keeper->native_pid,&info,WEXITED|WNOWAIT|WNOHANG);}while(result<0 && errno==EINTR);
      if(!result && info.si_pid==keeper->native_pid) {
        keeper->native_waiting=1;
        if((error=br_native_exited(keeper)))goto polled;
      }
    }
    int ready,timeout;
    do {
      timeout=br_recovery_tick(keeper);
      if(native_poll && (timeout<0 || timeout>1000))timeout=1000;
      ready=poll(fds,(nfds_t)count,timeout);
    }while(ready<0 && errno==EINTR);
    /* A completed poll timeout also advances retry if clock observation failed. */
    if(!ready && keeper->recovery_due && !keeper->recovery_pid)br_recover(keeper);
    if(ready<0) {error=errno;goto polled;}
    if(fds[0].revents&POLLIN) {
      int socket=accept(keeper->listener,NULL,NULL);
      if(socket>=0) {
        fcntl(socket,F_SETFD,FD_CLOEXEC);
        BrControl *control=calloc(1,sizeof(*control));
        if(!control) {close(socket);error=ENOMEM;goto polled;}
        control->socket=socket;br_nonblock(socket);control->next=keeper->controls;keeper->controls=control;
      } else if(errno!=EINTR && errno!=EAGAIN) {error=errno;goto polled;}
    }
    if(keeper->client>=0 && fds[1].fd==keeper->client && fds[1].revents&(POLLIN|POLLHUP|POLLERR)) {
      if((error=br_read_commands(keeper)))goto polled;
    }
    if(fds[2].revents&POLLIN) {
      br_watch_drain(keeper->watch);
      if(!keeper->change_queued && keeper->client>=0) {
        if((error=br_send(keeper,(BrFrame){.op=BR_CHANGE},NULL)))goto polled;
        keeper->outgoing_tail->change=1;keeper->change_queued=1;
      }
    }
    if(fds[3].revents&POLLIN) {
      BrWake event;
      if((error=br_read_all(keeper->wake[0],&event,sizeof(event))))goto polled;
      if(event.kind=='N') {
        if(event.status<0) {error=ECHILD;goto polled;}
        keeper->native_waiting=1;
        if((error=br_native_exited(keeper)))goto polled;
      } else if(event.kind=='R' && event.pid==keeper->recovery_pid) {
        if(event.status>=0) {
          keeper->recovery_pid=0;keeper->recovery_waiting=0;
          if(keeper->client<0) {br_recovery_note(keeper,0,event.status);br_recovery_arm(keeper);}
        } else {
          /* A failed wait is not evidence that this recovery child ended. */
          keeper->recovery_waiting=0;
          br_recovery_note(keeper,ECHILD,-1);
        }
      }
    }
    for(size_t i=5;i<count;i++) if(fds[i].revents&(POLLIN|POLLHUP|POLLERR)) {
      if((error=br_control_read(keeper,clients[i])))goto polled;
    }
polled:
    free(fds);free(clients);if(error)return error;
  }
}
static int br_bootstrap(BrKeeper *keeper) {
  char *path=br_path(keeper->directory,"bootstrap");
  int fd=path?open(path,O_RDONLY|O_CLOEXEC):-1;free(path);
  if(fd<0)return errno?errno:ENOMEM;
  struct stat info;int error=fstat(fd,&info)?errno:0;
  if(!error && (info.st_size<=0 || (uint64_t)info.st_size>SIZE_MAX-1))error=EINVAL;
  if(!error) {
    keeper->identity_length=(size_t)info.st_size;keeper->identity=malloc(keeper->identity_length);
    error=keeper->identity?br_read_all(fd,keeper->identity,keeper->identity_length):ENOMEM;
  }
  close(fd);return error;
}
static int br_keeper(const char *directory,int lock) {
  BrKeeper keeper={.listener=-1,.client=3,.input=-1,.lock=lock,.watch=-1,.wake={-1,-1},.spool=-1,.generation=1};
  keeper.directory=realpath(directory,NULL);
  if(!keeper.directory)return errno;
  int error=br_manifest_read(directory,&keeper.manifest);
  if(error)return error;
  fcntl(keeper.client,F_SETFD,FD_CLOEXEC);fcntl(lock,F_SETFD,FD_CLOEXEC);
  if((error=br_nonblock(keeper.client)))goto done;
  if((error=br_file(directory,"launch","launch\n",7,1)))goto done;
  struct sockaddr_un address;
  if((error=br_socket_address(&address,keeper.manifest.field[5])))goto done;
  keeper.listener=socket(AF_UNIX,SOCK_STREAM,0);
  if(keeper.listener<0){error=errno;goto done;}
  fcntl(keeper.listener,F_SETFD,FD_CLOEXEC);
  if(bind(keeper.listener,(struct sockaddr *)&address,sizeof(address)) || listen(keeper.listener,SOMAXCONN)) {error=errno;goto done;}
  char *path=br_path(directory,"stdout");
  keeper.spool=path?open(path,O_CREAT|O_EXCL|O_RDWR|O_APPEND|O_CLOEXEC,0600):-1;
  if(keeper.spool<0){error=path?errno:ENOMEM;free(path);goto done;}
  keeper.watch=br_watch_file(keeper.spool,path);free(path);
  if(keeper.watch<0){error=errno;goto done;}
  if((error=baton_pipe(keeper.wake)))goto done;
  if(keeper.manifest.header.reserved==1) {
    if((error=br_bootstrap(&keeper)))goto done;
    if((error=br_birth(getpid(),&keeper.birth)))goto done;
    if((error=br_file(directory,"keeper.birth",&keeper.birth,sizeof(keeper.birth),1)))goto done;
    keeper.phase=BR_PREPARED;
    BrState prepared={0};
    if((error=br_send(&keeper,(BrFrame){.op=BR_HELLO,.length=sizeof(prepared),.value=3},&prepared)))goto done;
    error=br_keep(&keeper);goto done;
  }
  int input[2];if((error=baton_pipe(input)))goto done;
  int log=open(keeper.manifest.field[2],O_WRONLY|O_CREAT|O_APPEND|O_CLOEXEC,0600);
  char **argv=br_argv(keeper.manifest.field[0],(size_t)keeper.manifest.header.lengths[0]);
  if(log<0 || !argv)error=log<0?errno:ENOMEM;
  else error=br_spawn(&keeper.native_pid,argv,keeper.manifest.field[1],input[0],keeper.spool,log,-1,-1);
  free(argv);if(log>=0)close(log);close(input[0]);
  if(error){close(input[1]);goto done;}
  keeper.input=input[1];br_nonblock(keeper.input);
  char pid[64];int n=snprintf(pid,sizeof(pid),"%d\n",keeper.native_pid);
  if((error=br_file(directory,"native.pid",pid,(size_t)n,1)))goto done;
  BrBirth birth;if((error=br_birth(keeper.native_pid,&birth)))goto done;
  if((error=br_file(directory,"native.birth",&birth,sizeof(birth),1)))goto done;
  if((error=br_wait_start(&keeper,keeper.native_pid,'N')))goto done;
  keeper.native_watcher=1;keeper.phase=BR_RUNNING;
  if((error=br_queue(&keeper.writes,&keeper.writes_tail,keeper.manifest.field[3],
                    (size_t)keeper.manifest.header.lengths[3],0,0,0)))goto done;
  if(!keeper.manifest.header.keep_stdin) {
    if((error=br_queue(&keeper.writes,&keeper.writes_tail,NULL,0,0,0,1)))goto done;
    keeper.input_closed=1;
  }
  BrState state={keeper.native_pid,0,0,0,keeper.input_closed};
  if((error=br_send(&keeper,(BrFrame){.op=BR_HELLO,.length=sizeof(state),.value=2},&state)))goto done;
  error=br_keep(&keeper);
done:
  if(error) {
    br_note(&keeper,"keeper-error",error);
    if(!keeper.native_pid) {
      br_note(&keeper,"native-start-error",error);
      if(keeper.lock>=0) {close(keeper.lock);keeper.lock=-1;}
      BrFrame hello={.op=BR_HELLO,.error=error,.value=1};
      br_write_all(keeper.client,&hello,sizeof(hello));
    }
  }
  if(keeper.finishing || (error && !keeper.native_pid)) {
    unlink(keeper.manifest.field[5]);
    char *parent=strdup(keeper.manifest.field[5]);
    if(parent){char *slash=strrchr(parent,'/');if(slash){*slash=0;rmdir(parent);}free(parent);}
  }
  /* A keeper failure terminates this process; native output remains a regular file. */
  if(error) _exit(1);
  if(keeper.client>=0)close(keeper.client);if(keeper.listener>=0)close(keeper.listener);
  if(keeper.input>=0)close(keeper.input);if(keeper.lock>=0)close(keeper.lock);
  if(keeper.watch>=0)close(keeper.watch);if(keeper.spool>=0)close(keeper.spool);
  if(keeper.wake[0]>=0)close(keeper.wake[0]);if(keeper.wake[1]>=0)close(keeper.wake[1]);
  br_buffer_free(&keeper.writes,&keeper.writes_tail);br_buffer_free(&keeper.outgoing,&keeper.outgoing_tail);
  free(keeper.incoming);free(keeper.identity);br_manifest_free(&keeper.manifest);
  return 0;
}
static int br_retain(BatonProcessCall *call) {
  if(!call->length || call->args[call->length-1] || !call->args[0] || !call->recovery_length ||
     call->recovery[call->recovery_length-1] || !call->recovery[0])return EINVAL;
  if(mkdir(call->directory,0700))return errno;
  call->unstarted=1;
  char *directory=realpath(call->directory,NULL);if(!directory)return errno;
  char temporary[]="/tmp/baton-retained-XXXXXX";
  if(!mkdtemp(temporary)){free(directory);return errno;}
  char *address=br_path(temporary,"control"),*manifest_path=br_path(directory,"manifest");
  if(!address || !manifest_path){free(address);free(manifest_path);free(directory);return ENOMEM;}
  BrManifestHeader header={.magic={'B','A','T','O','N','R','P','1'},.keep_stdin=call->keep_stdin,.reserved=call->kind==BP_PREPARE};
  char *fields[6]={call->args,call->cwd,call->log,call->initial,call->recovery,address};
  size_t lengths[6]={call->length,strlen(call->cwd),strlen(call->log),call->initial_length,call->recovery_length,strlen(address)};
  for(int i=0;i<6;i++)header.lengths[i]=lengths[i];
  int fd=open(manifest_path,O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC,0600),error=0;
  if(fd<0)error=errno;
  else {
    error=br_write_all(fd,&header,sizeof(header));
    for(int i=0;i<6 && !error;i++)error=br_write_all(fd,fields[i],lengths[i]);
    if(!error && fsync(fd))error=errno;
    if(!error && fchmod(fd,0400))error=errno;
    close(fd);
  }
  if(!error && call->kind==BP_PREPARE)
    error=call->text && call->text[0]?br_file(directory,"bootstrap",call->text,strlen(call->text),1):EINVAL;
  int dirfd=open(directory,O_RDONLY|O_CLOEXEC);
  if(!error && (dirfd<0 || fsync(dirfd)))error=errno;
  if(dirfd>=0)close(dirfd);
  int sockets[2]={-1,-1},null=-1,log=-1;
  char *self=NULL,*log_path=NULL;
  if(!error && socketpair(AF_UNIX,SOCK_STREAM,0,sockets))error=errno;
  if(!error) {
    fcntl(sockets[0],F_SETFD,FD_CLOEXEC);fcntl(sockets[1],F_SETFD,FD_CLOEXEC);
    self=br_self();log_path=br_path(directory,"keeper.log");
    null=open("/dev/null",O_RDONLY|O_CLOEXEC);
    log=log_path?open(log_path,O_WRONLY|O_CREAT|O_APPEND|O_CLOEXEC,0600):-1;
    if(!self || !log_path || null<0 || log<0)error=errno?errno:ENOMEM;
  }
  if(!error) {
    char *argv[]={self,"--host-process-keeper",directory,"4",NULL};pid_t pid;
    error=br_spawn(&pid,argv,NULL,null,log,log,sockets[1],(int)call->lock);
    if(!error) {
      call->unstarted=0;
      pthread_t reaper;if(!pthread_create(&reaper,NULL,br_reap_detached,(void *)(intptr_t)pid))pthread_detach(reaper);
    }
  }
  if(sockets[1]>=0)close(sockets[1]);
  if(!error) {error=br_attach_socket(call->child,directory,sockets[0],&call->unstarted);sockets[0]=-1;}
  if(sockets[0]>=0)close(sockets[0]);if(null>=0)close(null);if(log>=0)close(log);
  free(self);free(log_path);free(address);free(manifest_path);free(directory);
  return error;
}
static int br_recovery(BatonProcessCall *call) {
  call->eof=1;
  char *directory=realpath(call->directory,NULL);
  if(!directory)return errno==ENOENT?0:errno;
  if(br_exists(directory,"acknowledged") || !br_exists(directory,"launch")) {free(directory);return 0;}
  BrManifest manifest={0};int error=br_manifest_read(directory,&manifest);BrBirth birth;
  if(!error && !manifest.header.reserved &&
      (br_exists(directory,"released") || br_exists(directory,"native-start-error"))) {
    br_manifest_free(&manifest);free(directory);return 0;
  }
  if(!error && !manifest.header.reserved)error=br_read_file(directory,"native.birth",&birth,sizeof(birth));
  if(!error) {
    call->text=manifest.field[4];manifest.field[4]=NULL;
    call->length=(size_t)manifest.header.lengths[4]-1;call->eof=0;
  }
  br_manifest_free(&manifest);free(directory);return error;
}
static void baton_retained_begin_call(BatonProcessCall *call) {
  if(call->kind==BP_RECOVERY)call->error=br_recovery(call);
  else if(call->kind==BP_KEEPER) call->error=br_keeper(call->directory,(int)call->lock);
  else if(call->kind==BP_RETAIN || call->kind==BP_PREPARE) call->error=br_retain(call);
  else {
    char *directory=realpath(call->directory,NULL);
    BrManifest manifest={0};call->error=directory?br_manifest_read(directory,&manifest):errno;
    struct sockaddr_un address;
    if(!call->error)call->error=br_socket_address(&address,manifest.field[5]);
    int socket_fd=-1;
    if(!call->error) {socket_fd=socket(AF_UNIX,SOCK_STREAM,0);if(socket_fd<0)call->error=errno;else fcntl(socket_fd,F_SETFD,FD_CLOEXEC);}
    if(!call->error && connect(socket_fd,(struct sockaddr *)&address,sizeof(address)))call->error=errno;
    if(!call->error) {
      size_t identity=strlen(directory)+1;
      uint32_t op=(call->kind==BP_ATTACH || call->kind==BP_ATTACH_OWNED)?BR_ATTACH:call->kind==BP_CONTROL_WRITE?BR_CONTROL_WRITE:BR_CONTROL_SIGNAL;
      BrFrame frame={.op=op,.serial=(call->kind==BP_ATTACH || call->kind==BP_ATTACH_OWNED)?0:1,.length=identity,.value=call->signal};
      if(call->kind==BP_CONTROL_WRITE) {
        if(call->length>UINT64_MAX-identity)call->error=EOVERFLOW;
        else frame.length+=call->length;
      }
      if(!call->error)call->error=br_write_all(socket_fd,&frame,sizeof(frame));
      if(!call->error)call->error=br_write_all(socket_fd,directory,identity);
      if(!call->error && call->kind==BP_CONTROL_WRITE)call->error=br_write_all(socket_fd,call->text,call->length);
      if(!call->error && (call->kind==BP_ATTACH || call->kind==BP_ATTACH_OWNED)) {
        call->error=br_attach_socket(call->child,directory,socket_fd,NULL);socket_fd=-1;
      } else if(!call->error) {
        BrFrame reply;call->error=br_read_all(socket_fd,&reply,sizeof(reply));
        if(!call->error && (reply.op!=BR_REPLY || reply.serial!=frame.serial || reply.length))call->error=EPROTO;
        if(!call->error)call->error=reply.error;
      }
    }
    if(call->kind==BP_ATTACH_OWNED && (call->error==ECONNREFUSED || call->error==ENOENT || call->error==EPIPE))
      call->error=br_attach_orphan(call->child,directory,(int)call->lock);
    if(socket_fd>=0)close(socket_fd);br_manifest_free(&manifest);free(directory);
  }
  if(call->error) {
    const char *operation=call->kind==BP_RETAIN?"retain":call->kind==BP_ATTACH?"attach":
      call->kind==BP_CONTROL_WRITE?"control_write":call->kind==BP_CONTROL_SIGNAL?"control_signal":"keeper";
    size_t n=strlen(call->directory)+128;call->detail=malloc(n);
    if(call->detail)snprintf(call->detail,n,"%s %s: %s; inspect manifest, keeper-error and observer.log",operation,call->directory,strerror(call->error));
  }
}

static void baton_process_call(IoWork *w) {
  BatonProcessCall *call=(BatonProcessCall *)w->data;
  BatonChild *child=call->child;
  if(call->kind==BP_SPAWN) { baton_child_spawn(call);return; }
  if(call->kind==BP_RETAIN || call->kind==BP_PREPARE || call->kind==BP_ATTACH || call->kind==BP_ATTACH_OWNED || call->kind==BP_RECOVERY || call->kind==BP_KEEPER || call->kind==BP_CONTROL_WRITE || call->kind==BP_CONTROL_SIGNAL) {
    baton_retained_begin_call(call);return;
  }
  if(child->retained) { baton_retained_call(call);return; }
  if(call->kind==BP_RELEASE || call->kind==BP_ACK) { call->error=EINVAL;return; }
  if(call->kind==BP_INPUT_CLOSED) {call->signal=(u32)(child->input<0 || child->reaped);return;}
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
  } else { call->error=EINVAL; }
}

static Term baton_process_pack(Env e, IoWork *w) {
  BatonProcessCall *call=(BatonProcessCall *)w->data;
  Term value=term_pak(CID_UNIT,0);
  if(!call->error) {
    if(call->kind==BP_SPAWN || call->kind==BP_ATTACH || call->kind==BP_ATTACH_OWNED) value=(Term)call->handle;
    else if(call->kind==BP_INPUT_CLOSED) value=(Term)call->signal;
    else if(call->kind==BP_WAIT || call->kind==BP_START || call->kind==BP_STATE || call->kind==BP_CANCEL) value=io_str(e,call->text,call->length);
#ifdef CID_SOME
    else if(call->kind==BP_READ || call->kind==BP_RECOVERY) value=call->eof ? term_pak(CID_NONE,0)
      : io_box(e,CID_SOME,io_str(e,call->text,call->length));
#endif
  }
#if defined(CID_PROCESSCHILD_RETAIN_START) || defined(CID_PROCESSCHILD_PREPARE_START)
  if((call->kind==BP_RETAIN || call->kind==BP_PREPARE) && (!call->error || call->unstarted)) {
    const char *error=call->detail?call->detail:strerror(call->error);
    value=io_tup(e,call->unstarted?term_pak(CID_NONE,0):io_box(e,CID_SOME,(Term)call->handle),
      io_str(e,call->unstarted?error:"",call->unstarted?strlen(error):0));
  }
#endif
  if(!call->error && call->typed_state) value=io_tup(e,(Term)call->signal,value);
  Term result=call->error && !call->unstarted ? io_fail(e,call->error,call->detail) : io_done(e,value);
  if((call->kind==BP_SPAWN || call->kind==BP_RETAIN || call->kind==BP_PREPARE || call->kind==BP_ATTACH || call->kind==BP_ATTACH_OWNED) && call->error) {
    baton_children[call->handle]=NULL;free(call->child);
  }
  free(call->args);free(call->cwd);free(call->log);free(call->text);
  free(call->directory);free(call->initial);free(call->recovery);free(call->detail);free(call);
  w->data=NULL;
  return result;
}

static Term baton_process_begin(Env e, Term *f, IoWork *w, int kind) {
  BatonProcessCall *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  if(kind==BP_START_SNAPSHOT || kind==BP_STATE_SNAPSHOT || kind==BP_CANCEL_SNAPSHOT) {
    call->typed_state=1;
    kind=kind==BP_START_SNAPSHOT?BP_START:kind==BP_STATE_SNAPSHOT?BP_STATE:BP_CANCEL;
  }
  call->kind=kind;
  if(kind==BP_SPAWN || kind==BP_RETAIN || kind==BP_PREPARE || kind==BP_ATTACH || kind==BP_ATTACH_OWNED) {
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
  }
  if(kind==BP_SPAWN || kind==BP_RETAIN || kind==BP_PREPARE) {
    int offset=kind==BP_RETAIN || kind==BP_PREPARE?1:0;
    u64 length=0,cwd_length=0,log_length=0;
    call->args=io_cstr(e,f[offset],&length);call->length=length;
    call->cwd=io_cstr(e,f[offset+1],&cwd_length);
    call->log=io_cstr(e,f[offset+2],&log_length);
    if(strlen(call->cwd)!=cwd_length || strlen(call->log)!=log_length) call->error=EINVAL;
    if(kind==BP_RETAIN || kind==BP_PREPARE) {
      call->initial=io_cstr(e,f[4],&length);call->initial_length=length;
      call->keep_stdin=(u32)f[5];call->lock=(u32)f[6];
      call->recovery=io_cstr(e,f[7],&length);call->recovery_length=length;
      if(kind==BP_PREPARE) {
        call->text=io_cstr(e,f[8],&length);
        if(strlen(call->text)!=length || !length)call->error=EINVAL;
      }
    }
  }
  if(kind==BP_RETAIN || kind==BP_PREPARE || kind==BP_ATTACH || kind==BP_ATTACH_OWNED || kind==BP_RECOVERY || kind==BP_KEEPER || kind==BP_CONTROL_WRITE || kind==BP_CONTROL_SIGNAL) {
    u64 length=0;call->directory=io_cstr(e,f[0],&length);
    if(strlen(call->directory)!=length)call->error=EINVAL;
    if(kind==BP_KEEPER || kind==BP_ATTACH_OWNED)call->lock=(u32)f[1];
    if(kind==BP_CONTROL_WRITE) {call->text=io_cstr(e,f[1],&length);call->length=length;}
    if(kind==BP_CONTROL_SIGNAL)call->signal=(u32)f[1];
  } else if(kind!=BP_SPAWN) {
    call->handle=(u32)f[0];
    if(call->handle>=baton_child_count || !baton_children[call->handle]) {free(call);return io_fail(e,EBADF,NULL);}
    call->child=baton_children[call->handle];
    if(call->child->reaped && !call->child->retained && kind!=BP_WRITE && kind!=BP_INPUT_CLOSED) {free(call);return io_fail(e,ECHILD,NULL);}
    if(kind==BP_PID) {Term pid=io_done(e,(Term)call->child->pid);free(call);return pid;}
    if(kind==BP_WRITE || kind==BP_START || kind==BP_CANCEL) {u64 length=0;call->text=io_cstr(e,f[1],&length);call->length=length;}
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
BP_EFFECT(baton_process_spawn,CID_PROCESSCHILD_SPAWN,BP_SPAWN)
#endif
#ifdef CID_PROCESSCHILD_WRITE
BP_EFFECT(baton_process_write,CID_PROCESSCHILD_WRITE,BP_WRITE)
#endif
#ifdef CID_PROCESSCHILD_CLOSE_STDIN
BP_EFFECT(baton_process_close,CID_PROCESSCHILD_CLOSE_STDIN,BP_CLOSE)
#endif
#ifdef CID_PROCESSCHILD_READ_LINE
BP_EFFECT(baton_process_read,CID_PROCESSCHILD_READ_LINE,BP_READ)
#endif
#ifdef CID_PROCESSCHILD_WAIT
BP_EFFECT(baton_process_wait,CID_PROCESSCHILD_WAIT,BP_WAIT)
#endif
#ifdef CID_PROCESSCHILD_SIGNAL
BP_EFFECT(baton_process_signal,CID_PROCESSCHILD_SIGNAL,BP_SIGNAL)
#endif
#ifdef CID_PROCESSCHILD_PID
BP_EFFECT(baton_process_pid,CID_PROCESSCHILD_PID,BP_PID)
#endif
#ifdef CID_PROCESSCHILD_RETAIN_START
BP_EFFECT(baton_process_retain,CID_PROCESSCHILD_RETAIN_START,BP_RETAIN)
#endif
#ifdef CID_PROCESSCHILD_ATTACH
BP_EFFECT(baton_process_attach,CID_PROCESSCHILD_ATTACH,BP_ATTACH)
#endif
#ifdef CID_PROCESSCHILD_RELEASE
BP_EFFECT(baton_process_release,CID_PROCESSCHILD_RELEASE,BP_RELEASE)
#endif
#ifdef CID_PROCESSCHILD_ACKNOWLEDGE
BP_EFFECT(baton_process_acknowledge,CID_PROCESSCHILD_ACKNOWLEDGE,BP_ACK)
#endif
#ifdef CID_PROCESSCHILD_KEEPER
BP_EFFECT(baton_process_keeper,CID_PROCESSCHILD_KEEPER,BP_KEEPER)
#endif
#ifdef CID_PROCESSCHILD_INPUT_CLOSED
BP_EFFECT(baton_process_input_closed,CID_PROCESSCHILD_INPUT_CLOSED,BP_INPUT_CLOSED)
#endif
#ifdef CID_PROCESSCHILD_CONTROL_WRITE
BP_EFFECT(baton_process_control_write,CID_PROCESSCHILD_CONTROL_WRITE,BP_CONTROL_WRITE)
#endif
#ifdef CID_PROCESSCHILD_CONTROL_SIGNAL
BP_EFFECT(baton_process_control_signal,CID_PROCESSCHILD_CONTROL_SIGNAL,BP_CONTROL_SIGNAL)
#endif

#ifdef CID_PROCESSCHILD_ATTACH_OWNED
BP_EFFECT(baton_process_attach_owned,CID_PROCESSCHILD_ATTACH_OWNED,BP_ATTACH_OWNED)
#endif
#ifdef CID_PROCESSCHILD_RECOVERY_ARGV
BP_EFFECT(baton_process_recovery_argv,CID_PROCESSCHILD_RECOVERY_ARGV,BP_RECOVERY)
#endif

#ifdef CID_PROCESSCHILD_PREPARE_START
BP_EFFECT(baton_process_prepare,CID_PROCESSCHILD_PREPARE_START,BP_PREPARE)
#endif
#ifdef CID_PROCESSCHILD_START
BP_EFFECT(baton_process_start,CID_PROCESSCHILD_START,BP_START)
#endif
#ifdef CID_PROCESSCHILD_STATE
BP_EFFECT(baton_process_state,CID_PROCESSCHILD_STATE,BP_STATE)
#endif
#ifdef CID_PROCESSCHILD_CANCEL_PREPARED
BP_EFFECT(baton_process_cancel,CID_PROCESSCHILD_CANCEL_PREPARED,BP_CANCEL)
#endif

#ifdef CID_PROCESSCHILD_START_SNAPSHOT
BP_EFFECT(baton_process_start_snapshot,CID_PROCESSCHILD_START_SNAPSHOT,BP_START_SNAPSHOT)
#endif
#ifdef CID_PROCESSCHILD_STATE_SNAPSHOT
BP_EFFECT(baton_process_state_snapshot,CID_PROCESSCHILD_STATE_SNAPSHOT,BP_STATE_SNAPSHOT)
#endif
#ifdef CID_PROCESSCHILD_CANCEL_SNAPSHOT
BP_EFFECT(baton_process_cancel_snapshot,CID_PROCESSCHILD_CANCEL_SNAPSHOT,BP_CANCEL_SNAPSHOT)
#endif

#undef BP_EFFECT
static void __attribute__((constructor)) baton_process_signals(void){signal(SIGPIPE,SIG_IGN);}
