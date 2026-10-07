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
  uint32_t generation;
  struct BatonRetained *retained;
} BatonChild;

typedef struct {
  BatonChild *child;
  char *args, *cwd, *log, *text;
  size_t length;
  u32 handle, signal, index;
  int kind, error, eof, unstarted;
  char *directory, *initial, *recovery, *detail, *database;
  size_t initial_length, recovery_length;
  u32 keep_stdin, lock;
} BatonProcessCall;

/* A capability packs its slot index and generation. A retired slot is reused
   with a higher generation, and a request carrying the old generation is
   refused instead of reaching the new child. */
#define BATCHILD_INDEX_MASK 0xffffu
#define BATCHILD_GENERATION_MAX 0xffffu
static BatonChild **baton_children;
static size_t baton_child_count, baton_child_capacity;
static uint32_t *baton_child_free;
static size_t baton_child_free_count, baton_child_free_capacity;
static uint32_t baton_child_next_generation=1;

enum { BP_SPAWN, BP_WRITE, BP_CLOSE, BP_READ, BP_WAIT, BP_SIGNAL, BP_PID,
       BP_RETAIN, BP_ATTACH, BP_RELEASE, BP_ACK, BP_KEEPER, BP_INPUT_CLOSED,
       BP_CONTROL_WRITE, BP_CONTROL_SIGNAL, BP_ATTACH_OWNED, BP_RECOVERY,
       BP_INSTANCE_OWNER, BP_INSTANCE_ADMIT, BP_INSTANCE_ATTACH,
       BP_INSTANCE_ATTACH_OWNED, BP_INSTANCE_SHUTDOWN, BP_INSTANCE_RETIRE };

static int baton_pipe(int fds[2]) {
  if (pipe(fds)) return errno;
  if (fcntl(fds[0],F_SETFD,FD_CLOEXEC) < 0 || fcntl(fds[1],F_SETFD,FD_CLOEXEC) < 0) {
    int error=errno; close(fds[0]); close(fds[1]); return error;
  }
  return 0;
}

/* Claims a capability slot, reusing a retired one when the free list has one.
   The packed handle carries the slot's current generation, so a request for a
   retired capability is refused instead of reaching the new child. */
static int baton_child_allocate(BatonProcessCall *call) {
  size_t index;
  if(baton_child_free_count) index=baton_child_free[--baton_child_free_count];
  else {
    if(baton_child_count>=BATCHILD_INDEX_MASK) return EMFILE;
    if(baton_child_count==baton_child_capacity) {
      size_t capacity=baton_child_capacity?baton_child_capacity*2:16;
      BatonChild **next=realloc(baton_children,capacity*sizeof(*next));
      if(!next) return ENOMEM;
      memset(next+baton_child_capacity,0,(capacity-baton_child_capacity)*sizeof(*next));
      baton_children=next;baton_child_capacity=capacity;
    }
    index=baton_child_count++;
  }
  BatonChild *child=baton_children[index];
  if(!child) {
    child=calloc(1,sizeof(*child));
    if(!child) return ENOMEM;
    child->input=-1;
    child->generation=baton_child_next_generation++;
    if(!child->generation)child->generation=1;
    baton_children[index]=child;
  } else {
    child->reaped=0;child->pid=0;child->input=-1;child->output=NULL;child->retained=NULL;
  }
  call->index=(u32)index;
  call->child=child;
  call->handle=(u32)(index|((size_t)child->generation<<16));
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
#include <sys/file.h>
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
       BR_ATTACH, BR_CONTROL_WRITE, BR_CONTROL_SIGNAL, BR_READY };
typedef struct { uint32_t op; int32_t error; uint64_t serial,length; int64_t value; } BrFrame;
typedef struct { int32_t pid,exited,status,released,input_closed; } BrState;
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
  int guard,watch,life,orphan,unknown,released,acknowledged;
  char *directory;
  uint64_t version,serial,reply_serial;
  int reply_error;
  off_t offset;
  pthread_t receiver;
  pthread_mutex_t state,command,reader;
  pthread_cond_t changed;
} BatonRetained;
typedef struct BrKeeper {
  struct BrKeeper *next;
  uint32_t id;
  int listener,client,input,lock,watch,wake[2],spool,finishing,change_queued;
  uint64_t generation;
  pid_t native_pid,recovery_pid;
  int exited,status,released,input_closed,ready,native_waiting;
  char *directory,*incoming;
  size_t incoming_size,incoming_capacity;
  BrManifest manifest;
  BrBuffer *writes,*writes_tail,*outgoing,*outgoing_tail;
  BrControl *controls;
} BrKeeper;

/* The database-level owner protocol. One owner process serves one canonical
   database; clients admit, resolve and retire attempts through this header and
   then speak the existing per-attempt protocol to the attempt's own socket. */
typedef struct {
  uint32_t op; int32_t error;
  uint64_t owner,attempt,generation,length;
} BrInstanceFrame;
enum { BI_ENSURE=1, BI_ADMIT, BI_SHUTDOWN, BI_STATE, BI_HELLO, BI_REPLY };
typedef struct BrOwnerControl {
  struct BrOwnerControl *next;
  int socket,answered,rights;
  char *incoming,*reply;
  size_t size,capacity,reply_length,sent;
} BrOwnerControl;
/* A database-level reply payload: the owner token and its open attempt count. */
typedef struct { uint64_t owner,attempts; } BrOwnerState;
typedef struct {
  int listener,lock,finishing;
  uint64_t token,device,inode;
  char *database,*socket_path;
  BrKeeper *attempts;
  BrOwnerControl *controls;
  uint32_t next_id;
} BrOwner;

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
  if(!error && memcmp(manifest->header.magic,"BATONRP1",8)) error=EINVAL;
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
typedef struct { int32_t pid; uint64_t first,second; } BrBirth;
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
    pthread_mutex_lock(&retained->state);
    if(error || frame.length) {
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
    if(frame.op==BR_CHANGE) retained->version++;
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
  retained->input_closed=state.input_closed;retained->released=state.released;
  pthread_mutex_init(&retained->state,NULL);pthread_mutex_init(&retained->command,NULL);
  pthread_mutex_init(&retained->reader,NULL);pthread_cond_init(&retained->changed,NULL);
  if(!retained->directory)error=ENOMEM;
  if(!error && hello.value==2) {
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
    if(retained->unknown) snprintf(text,sizeof(text),"unknown after keeper loss");
    else if(WIFEXITED(status)) snprintf(text,sizeof(text),"exit %d",WEXITSTATUS(status));
    else if(WIFSIGNALED(status)) snprintf(text,sizeof(text),"signal %d",WTERMSIG(status));
    else {call->error=ECHILD;return;}
    call->text=strdup(text);call->length=strlen(text);call->child->reaped=1;
    if(!call->text) call->error=ENOMEM;
    return;
  }
  uint32_t op=call->kind==BP_WRITE?BR_WRITE:call->kind==BP_CLOSE?BR_CLOSE:
    call->kind==BP_SIGNAL?BR_SIGNAL:call->kind==BP_RELEASE?BR_RELEASE:BR_ACK;
  pthread_mutex_lock(&retained->state);int orphan=retained->orphan;pthread_mutex_unlock(&retained->state);
  call->error=orphan?EPIPE:br_request(retained,op,call->text,call->kind==BP_WRITE?call->length:0,call->signal);
  pthread_mutex_lock(&retained->state);orphan=retained->orphan;int exited=retained->exited;pthread_mutex_unlock(&retained->state);
  if(orphan && (call->error==EPIPE || call->error==ECONNRESET)) {
    if(op==BR_CLOSE)call->error=0;
    else if(op==BR_RELEASE || op==BR_ACK) {
      call->error=exited?br_file(retained->directory,op==BR_RELEASE?"released":"acknowledged",
        op==BR_RELEASE?"released\n":"acknowledged\n",op==BR_RELEASE?9:13,1):EBUSY;
      if(call->error==EEXIST)call->error=0;
    } else if(op==BR_SIGNAL)call->error=exited?ESRCH:kill(-call->child->pid,(int)call->signal)?errno:0;
  }
  if(!call->error && call->kind==BP_RELEASE) {
    pthread_mutex_lock(&retained->state);retained->released=1;pthread_mutex_unlock(&retained->state);
    if(retained->guard>=0){close(retained->guard);retained->guard=-1;}
  }
  if(!call->error && call->kind==BP_ACK) {
    retained->acknowledged=1;
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
static void br_recover(BrKeeper *keeper) {
  char **argv=br_argv(keeper->manifest.field[4],(size_t)keeper->manifest.header.lengths[4]);
  char *path=br_path(keeper->directory,"observer.log");
  int null=open("/dev/null",O_RDONLY|O_CLOEXEC),log=path?open(path,O_WRONLY|O_CREAT|O_APPEND|O_CLOEXEC,0600):-1;
  int error=argv&&path&&null>=0&&log>=0?br_spawn(&keeper->recovery_pid,argv,keeper->manifest.field[1],null,log,log,-1,-1):errno?errno:ENOMEM;
  if(null>=0)close(null);if(log>=0)close(log);free(path);free(argv);
  if(!error) error=br_wait_start(keeper,keeper->recovery_pid,'R');
  if(error) br_note(keeper,"observer-error",error);
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
  keeper->status=status;keeper->exited=1;keeper->native_waiting=0;
  char text[64];int n=snprintf(text,sizeof(text),"%d\n",status);
  int error=br_file(keeper->directory,"status",text,(size_t)n,1);
  return error?error:br_send(keeper,(BrFrame){.op=BR_EXIT,.value=status},NULL);
}
static int br_command(BrKeeper *keeper,BrFrame frame,const char *payload) {
  int error=0;
  if(frame.op==BR_WRITE || frame.op==BR_CLOSE) {
    if(frame.op==BR_CLOSE && frame.length) return EPROTO;
    if(frame.op==BR_WRITE && (keeper->input_closed || keeper->exited))
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
    if(keeper->exited)error=ESRCH;
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
      return br_send(keeper,(BrFrame){.op=BR_HELLO,.length=sizeof(state),.value=2},&state);
    }
  } else if(!frame.serial)br_control_reply(control,frame.serial,EPROTO);
  else if(frame.op==BR_CONTROL_WRITE) {
    if(keeper->input_closed || keeper->exited)error=EPIPE;
    else {
      error=br_queue(&keeper->writes,&keeper->writes_tail,payload+identity,
                     (size_t)frame.length-identity,frame.serial,0,0);
      if(!error) {keeper->writes_tail->control=control;control->pending=1;}
    }
    if(error)br_control_reply(control,frame.serial,error);
  } else if(frame.op==BR_CONTROL_SIGNAL) {
    if(frame.length!=identity || frame.value<=0 || frame.value>=NSIG)error=EINVAL;
    else if(keeper->exited)error=ESRCH;
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
/* Releases one attempt's descriptors, buffers and record. It runs after the
   attempt's last observer and control connection has finished, and never
   touches another attempt's state. */
static void br_keeper_stop(BrKeeper *keeper) {
  if(keeper->client>=0)close(keeper->client);if(keeper->listener>=0)close(keeper->listener);
  if(keeper->input>=0)close(keeper->input);if(keeper->lock>=0)close(keeper->lock);
  if(keeper->watch>=0)close(keeper->watch);if(keeper->spool>=0)close(keeper->spool);
  if(keeper->wake[0]>=0)close(keeper->wake[0]);if(keeper->wake[1]>=0)close(keeper->wake[1]);
  while(keeper->controls) {
    BrControl *control=keeper->controls;keeper->controls=control->next;
    if(control->socket>=0)close(control->socket);
    free(control->incoming);free(control);
  }
  br_buffer_free(&keeper->writes,&keeper->writes_tail);
  br_buffer_free(&keeper->outgoing,&keeper->outgoing_tail);
  free(keeper->incoming);free(keeper->directory);br_manifest_free(&keeper->manifest);
  free(keeper);
}
/* Starts custody of one attempt. The native process, its stdin writer, its
   stdout spool and its wait authority stay in this process for the attempt's
   lifetime, so observer and coordinator loss leave them intact. */
static int br_keeper_start(BrKeeper *keeper,const char *directory,int lock) {
  int error=br_manifest_read(directory,&keeper->manifest);
  if(error)return error;
  if(lock>=0)fcntl(lock,F_SETFD,FD_CLOEXEC);
  if((error=br_file(directory,"launch","launch\n",7,1)))return error;
  struct sockaddr_un address;
  if((error=br_socket_address(&address,keeper->manifest.field[5])))return error;
  keeper->listener=socket(AF_UNIX,SOCK_STREAM,0);
  if(keeper->listener<0)return errno;
  fcntl(keeper->listener,F_SETFD,FD_CLOEXEC);
  if(bind(keeper->listener,(struct sockaddr *)&address,sizeof(address)) || listen(keeper->listener,SOMAXCONN))return errno;
  char *path=br_path(directory,"stdout");
  keeper->spool=path?open(path,O_CREAT|O_EXCL|O_RDWR|O_APPEND|O_CLOEXEC,0600):-1;
  if(keeper->spool<0){error=path?errno:ENOMEM;free(path);return error;}
  keeper->watch=br_watch_file(keeper->spool,path);free(path);
  if(keeper->watch<0)return errno;
  if((error=baton_pipe(keeper->wake)))return error;
  int input[2];if((error=baton_pipe(input)))return error;
  int log=open(keeper->manifest.field[2],O_WRONLY|O_CREAT|O_APPEND|O_CLOEXEC,0600);
  char **argv=br_argv(keeper->manifest.field[0],(size_t)keeper->manifest.header.lengths[0]);
  if(log<0 || !argv)error=log<0?errno:ENOMEM;
  else error=br_spawn(&keeper->native_pid,argv,keeper->manifest.field[1],input[0],keeper->spool,log,-1,-1);
  free(argv);if(log>=0)close(log);close(input[0]);
  if(error){close(input[1]);return error;}
  keeper->input=input[1];br_nonblock(keeper->input);
  char pid[64];int n=snprintf(pid,sizeof(pid),"%d\n",keeper->native_pid);
  if((error=br_file(directory,"native.pid",pid,(size_t)n,1)))return error;
  BrBirth birth;if((error=br_birth(keeper->native_pid,&birth)))return error;
  if((error=br_file(directory,"native.birth",&birth,sizeof(birth),1)))return error;
  if((error=br_wait_start(keeper,keeper->native_pid,'N')))return error;
  if((error=br_queue(&keeper->writes,&keeper->writes_tail,keeper->manifest.field[3],
                    (size_t)keeper->manifest.header.lengths[3],0,0,0)))return error;
  if(!keeper->manifest.header.keep_stdin) {
    if((error=br_queue(&keeper->writes,&keeper->writes_tail,NULL,0,0,0,1)))return error;
    keeper->input_closed=1;
  }
  return 0;
}
/* Serves one attempt's ready descriptors: a five-entry fixed slice (listener,
   observer, spool watch, wake pipe, input) followed by its control slice. */
static int br_attempt_ready(BrKeeper *keeper,struct pollfd *fds,BrControl **clients,size_t count) {
  int error=0;
  if(fds[0].revents&POLLIN) {
    int socket=accept(keeper->listener,NULL,NULL);
    if(socket>=0) {
      fcntl(socket,F_SETFD,FD_CLOEXEC);
      BrControl *control=calloc(1,sizeof(*control));
      if(!control) {close(socket);return ENOMEM;}
      control->socket=socket;br_nonblock(socket);control->next=keeper->controls;keeper->controls=control;
    } else if(errno!=EINTR && errno!=EAGAIN) return errno;
  }
  if(keeper->client>=0 && fds[1].fd==keeper->client && fds[1].revents&(POLLIN|POLLHUP|POLLERR)) {
    if((error=br_read_commands(keeper)))return error;
  }
  if(fds[2].revents&POLLIN) {
    br_watch_drain(keeper->watch);
    if(!keeper->change_queued && keeper->client>=0) {
      if((error=br_send(keeper,(BrFrame){.op=BR_CHANGE},NULL)))return error;
      keeper->outgoing_tail->change=1;keeper->change_queued=1;
    }
  }
  if(fds[3].revents&POLLIN) {
    BrWake event;
    if((error=br_read_all(keeper->wake[0],&event,sizeof(event))))return error;
    if(event.kind=='N') {
      if(event.status<0)return ECHILD;
      keeper->native_waiting=1;
      if((error=br_native_exited(keeper)))return error;
    } else if(event.kind=='R' && event.generation==keeper->generation && keeper->client<0) {
      char text[96];int n=snprintf(text,sizeof(text),"pid %d exited before attach: wait status %d\n",event.pid,event.status);
      br_file(keeper->directory,"observer-error",text,(size_t)n,0);
    }
  }
  for(size_t i=0;i<count;i++) if(fds[5+i].revents&(POLLIN|POLLHUP|POLLERR)) {
    if((error=br_control_read(keeper,clients[i])))return error;
  }
  return 0;
}

/* The rendezvous pathname is derived from the database's physical identity, so
   it stays inside sun_path at any project path length. The pathname elects
   nothing by itself: the database lock and the owner token carry the binding. */
static char *br_suffix(const char *text,const char *suffix) {
  size_t a=strlen(text),b=strlen(suffix);char *path=malloc(a+b+1);
  if(path){memcpy(path,text,a);memcpy(path+a,suffix,b+1);}
  return path;
}
static int br_entropy(uint64_t *value) {
  int fd=open("/dev/urandom",O_RDONLY|O_CLOEXEC);
  if(fd<0)return errno;
  int error=br_read_all(fd,value,sizeof(*value));
  close(fd);return error;
}
static int br_owner_socket_path(const char *database,uint64_t device,uint64_t inode,char **path) {
  const char *base=getenv("TMPDIR");
  if(!base || !base[0])base="/tmp";
  size_t length=strlen(base);int slash=base[length-1]=='/';
  size_t size=length+(size_t)(slash?0:1)+80;
  char *full=malloc(size);
  if(!full)return ENOMEM;
  snprintf(full,size,"%s%sbaton-instance-%llx-%llx.sock",base,slash?"":"/",
    (unsigned long long)device,(unsigned long long)inode);
  *path=full;return 0;
}
static BrKeeper *br_owner_find(BrOwner *owner,const char *directory) {
  for(BrKeeper *keeper=owner->attempts;keeper;keeper=keeper->next)
    if(!strcmp(keeper->directory,directory))return keeper;
  return NULL;
}
static uint64_t br_owner_attempts(BrOwner *owner) {
  uint64_t count=0;
  for(BrKeeper *keeper=owner->attempts;keeper;keeper=keeper->next)count++;
  return count;
}
/* Starts custody of the attempt whose manifest the caller already wrote. The
   bound database identity is rechecked, so a replaced file is never adopted,
   and an existing attempt record refuses a second native child for it. */
static int br_owner_admit(BrOwner *owner,const char *directory,int lock) {
  int error=0;
  size_t prefix=strlen(owner->database);
  struct stat info;
  if(stat(owner->database,&info))error=errno;
  else if((uint64_t)info.st_dev!=owner->device || (uint64_t)info.st_ino!=owner->inode)error=ESTALE;
  else if(strncmp(directory,owner->database,prefix) || strncmp(directory+prefix,".attempt-",9))error=EINVAL;
  else {
    BrKeeper *keeper=calloc(1,sizeof(*keeper));
    if(!keeper)error=ENOMEM;
    else {
      *keeper=(BrKeeper){.listener=-1,.client=-1,.input=-1,.lock=lock,.watch=-1,
        .wake={-1,-1},.spool=-1,.generation=1,.id=++owner->next_id};
      keeper->directory=realpath(directory,NULL);
      if(!keeper->directory)error=errno;
      else if(br_owner_find(owner,keeper->directory)) {error=EBUSY;}
      else if((error=br_keeper_start(keeper,directory,lock))) {keeper->next=NULL;}
      if(error) {lock=-1;br_keeper_stop(keeper);}
      else {keeper->next=owner->attempts;owner->attempts=keeper;return 0;}
    }
  }
  if(lock>=0)close(lock);
  return error;
}
static void br_owner_control_close(BrOwnerControl *control) {
  if(control->socket>=0)close(control->socket);
  control->socket=-1;
}
static void br_owner_control_flush(BrOwnerControl *control) {
  if(!control->answered || control->socket<0)return;
  while(control->sent<control->reply_length) {
    ssize_t n=write(control->socket,control->reply+control->sent,control->reply_length-control->sent);
    if(n<0 && errno==EINTR)continue;
    if(n<0 && errno==EAGAIN)return;
    if(n<=0) {br_owner_control_close(control);return;}
    control->sent+=(size_t)n;
  }
  br_owner_control_close(control);
}
static int br_owner_reply(BrOwnerControl *control,BrInstanceFrame frame,const void *payload) {
  size_t length=sizeof(frame)+(size_t)frame.length;
  char *reply=malloc(length);
  if(!reply)return ENOMEM;
  memcpy(reply,&frame,sizeof(frame));
  if(frame.length)memcpy(reply+sizeof(frame),payload,(size_t)frame.length);
  free(control->reply);control->reply=reply;control->reply_length=length;
  control->sent=0;control->answered=1;
  return 0;
}
/* Answers one database-level request. The attempt's observer then connects to
   the attempt's own socket, so this connection stays short-lived. */
static int br_owner_command(BrOwner *owner,BrOwnerControl *control,BrInstanceFrame frame) {
  const char *payload=control->incoming+sizeof(frame);
  if(frame.owner && frame.owner!=owner->token)
    return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.error=ESTALE},NULL);
  if(frame.op==BI_ENSURE || frame.op==BI_STATE) {
    if(frame.length)return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.error=EPROTO},NULL);
    BrOwnerState state={owner->token,br_owner_attempts(owner)};
    return br_owner_reply(control,(BrInstanceFrame){.op=BI_HELLO,.owner=owner->token,
      .length=sizeof(state)},&state);
  }
  if(frame.op==BI_SHUTDOWN) {
    if(frame.length)return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.error=EPROTO},NULL);
    owner->finishing=1;
    return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.owner=owner->token},NULL);
  }
  if(frame.op==BI_ADMIT) {
    if(frame.length<2 || payload[frame.length-1])
      return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.error=EINVAL},NULL);
    int error=br_owner_admit(owner,payload,control->rights);
    control->rights=-1;
    if(error)return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.error=error},NULL);
    BrKeeper *keeper=br_owner_find(owner,payload);
    BrOwnerState state={owner->token,br_owner_attempts(owner)};
    return br_owner_reply(control,(BrInstanceFrame){.op=BI_HELLO,.owner=owner->token,
      .attempt=keeper?keeper->id:0,.generation=keeper?keeper->generation:0,
      .length=sizeof(state)},&state);
  }
  return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.error=EINVAL},NULL);
}
static int br_owner_control_read(BrOwner *owner,BrOwnerControl *control) {
  char buffer[8192],data[CMSG_SPACE(sizeof(int))];
  struct iovec vector={buffer,sizeof(buffer)};
  struct msghdr message={.msg_iov=&vector,.msg_iovlen=1,.msg_control=data,.msg_controllen=sizeof(data)};
  ssize_t n;do {n=recvmsg(control->socket,&message,0);} while(n<0 && errno==EINTR);
  if(n<0 && errno==EAGAIN)return 0;
  if(n<=0) {br_owner_control_close(control);return 0;}
  for(struct cmsghdr *header=CMSG_FIRSTHDR(&message);header;header=CMSG_NXTHDR(&message,header)) {
    if(header->cmsg_level!=SOL_SOCKET || header->cmsg_type!=SCM_RIGHTS ||
       header->cmsg_len!=CMSG_LEN(sizeof(int))) {br_owner_control_close(control);return 0;}
    int guard=-1;memcpy(&guard,CMSG_DATA(header),sizeof(guard));
    if(control->rights>=0)close(control->rights);
    control->rights=guard;
  }
  if(message.msg_flags&MSG_CTRUNC) {br_owner_control_close(control);return 0;}
  if(control->answered)return 0;
  if((size_t)n>SIZE_MAX-control->size) {br_owner_control_close(control);return 0;}
  size_t size=control->size+(size_t)n;
  if(size>control->capacity) {
    char *next=realloc(control->incoming,size);
    if(!next)return ENOMEM;
    control->incoming=next;control->capacity=size;
  }
  memcpy(control->incoming+control->size,buffer,(size_t)n);control->size=size;
  if(size>=sizeof(BrInstanceFrame)) {
    BrInstanceFrame frame;memcpy(&frame,control->incoming,sizeof(frame));
    if(frame.length>SIZE_MAX-sizeof(frame)) {br_owner_control_close(control);return 0;}
    size_t complete=sizeof(frame)+(size_t)frame.length;
    if(size>complete) {br_owner_control_close(control);return 0;}
    if(size==complete)return br_owner_command(owner,control,frame);
  }
  return 0;
}
/* The owner loop serves every attempt, control connection and the database
   listener in one readiness pass. An attempt error retires that attempt and
   leaves its siblings running; only an owner-scope error stops the process. */
static int br_owner_loop(BrOwner *owner) {
  for(;;) {
    int error=0;
    size_t slots=0,attempt_controls=0,owner_controls=0;
    for(BrOwnerControl **link=&owner->controls;*link;) {
      BrOwnerControl *control=*link;br_owner_control_flush(control);
      if(control->socket<0) {
        *link=control->next;
        if(control->rights>=0)close(control->rights);
        free(control->incoming);free(control->reply);free(control);
      } else {owner_controls++;link=&control->next;}
    }
    for(BrKeeper **link=&owner->attempts;*link;) {
      BrKeeper *keeper=*link;
      if(keeper->finishing && !keeper->outgoing) {
        *link=keeper->next;
        if(owner->single)owner->finishing=1;else br_keeper_stop(keeper);
        continue;
      }
      if((error=br_flush_commands(keeper))) {
        if(owner->single)return error;
        br_note(keeper,"attempt-error",error);
        keeper->finishing=1;error=0;
      }
      br_flush_responses(keeper);
      for(BrControl **entry=&keeper->controls;*entry;) {
        BrControl *control=*entry;br_control_flush(control);
        if(control->socket<0 && !control->pending) {
          *entry=control->next;free(control->incoming);free(control);
        } else {attempt_controls++;entry=&control->next;}
      }
      slots++;link=&keeper->next;
    }
    if(owner->finishing && !owner->attempts)return 0;
    size_t head=owner->listener>=0?1:0,total=head+owner_controls+slots*5+attempt_controls;
    struct pollfd *fds=calloc(total?total:1,sizeof(*fds));
    BrKeeper **keepers=calloc(slots?slots:1,sizeof(*keepers));
    BrControl **clients=calloc(attempt_controls?attempt_controls:1,sizeof(*clients));
    size_t *bases=calloc(slots?slots:1,sizeof(*bases));
    size_t *apart=calloc(slots+1,sizeof(*apart));
    if(!fds || !keepers || !clients || !bases || !apart) {
      free(fds);free(keepers);free(clients);free(bases);free(apart);return ENOMEM;
    }
    size_t index=0;
    if(head)fds[index++]=(struct pollfd){owner->listener,POLLIN,0};
    size_t owner_first=index;
    for(BrOwnerControl *control=owner->controls;control;control=control->next,index++)
      fds[index]=(struct pollfd){control->socket,POLLIN|(control->answered?POLLOUT:0),0};
    size_t owner_last=index,bound=0,slot=0;
    for(BrKeeper *keeper=owner->attempts;keeper;keeper=keeper->next,slot++) {
      keepers[slot]=keeper;bases[slot]=index;apart[slot]=bound;
      fds[index++]=(struct pollfd){keeper->listener,POLLIN,0};
      fds[index++]=(struct pollfd){keeper->client,POLLIN|(keeper->outgoing?POLLOUT:0),0};
      fds[index++]=(struct pollfd){keeper->watch,POLLIN,0};
      fds[index++]=(struct pollfd){keeper->wake[0],POLLIN,0};
      fds[index++]=(struct pollfd){keeper->writes?keeper->input:-1,POLLOUT,0};
      for(BrControl *control=keeper->controls;control;control=control->next,index++)
        clients[bound++]=control,fds[index]=(struct pollfd){control->socket,POLLIN|(control->answered?POLLOUT:0),0};
    }
    apart[slots]=bound;
    int ready;do {ready=poll(fds,(nfds_t)total,-1);} while(ready<0 && errno==EINTR);
    if(ready<0) {error=errno;goto polled;}
    if(head && fds[0].revents&POLLIN) {
      int socket=accept(owner->listener,NULL,NULL);
      if(socket>=0) {
        fcntl(socket,F_SETFD,FD_CLOEXEC);
        BrOwnerControl *control=calloc(1,sizeof(*control));
        if(!control) {close(socket);error=ENOMEM;goto polled;}
        control->socket=socket;control->rights=-1;br_nonblock(socket);
        control->next=owner->controls;owner->controls=control;
      } else if(errno!=EINTR && errno!=EAGAIN) {error=errno;goto polled;}
    }
    BrOwnerControl *control=owner->controls;
    for(size_t i=owner_first;i<owner_last && control;i++,control=control->next)
      if(fds[i].revents&(POLLIN|POLLHUP|POLLERR))
        if((error=br_owner_control_read(owner,control)))goto polled;
    for(size_t i=0;i<slots;i++) {
      error=br_attempt_ready(keepers[i],fds+bases[i],clients+apart[i],apart[i+1]-apart[i]);
      if(error) {
        if(owner->single)goto polled;
        br_note(keepers[i],"attempt-error",error);
        keepers[i]->finishing=1;error=0;
      }
    }
polled:
    free(fds);free(keepers);free(clients);free(bases);free(apart);
    if(error)return error;
  }
}
/* Binds the owner to one canonical database: checked physical identity, a
   refused multiply-linked or replaced file, database-level exclusion, and a
   fresh instance token published before the rendezvous socket accepts work. */
static int br_owner_bind(BrOwner *owner,const char *database) {
  struct stat info;
  int error=0;
  owner->database=realpath(database,NULL);
  if(!owner->database)return errno;
  if(stat(owner->database,&info))return errno;
  if(!S_ISREG(info.st_mode))return EINVAL;
  if(info.st_nlink!=1)return EMLINK;
  owner->device=(uint64_t)info.st_dev;owner->inode=(uint64_t)info.st_ino;
  char *lock_path=br_suffix(owner->database,".owner-lock");
  char *token_path=br_suffix(owner->database,".owner-token");
  if(!lock_path || !token_path){free(lock_path);free(token_path);return ENOMEM;}
  owner->lock=open(lock_path,O_CREAT|O_RDWR|O_CLOEXEC,0600);
  error=owner->lock<0?errno:0;
  if(!error) {
    int result;do {result=flock(owner->lock,LOCK_EX|LOCK_NB);}while(result<0 && errno==EINTR);
    if(result<0)error=errno==EWOULDBLOCK?EBUSY:errno;
  }
  free(lock_path);
  if(!error)error=br_entropy(&owner->token);
  if(!error) {
    char text[32];int n=snprintf(text,sizeof(text),"%016llx\n",(unsigned long long)owner->token);
    int file=open(token_path,O_WRONLY|O_CREAT|O_TRUNC|O_CLOEXEC,0600);
    if(file<0)error=errno;
    else {
      error=br_write_all(file,text,(size_t)n);
      if(!error && fsync(file))error=errno;
      close(file);
    }
  }
  free(token_path);
  if(!error)error=br_owner_socket_path(owner->database,owner->device,owner->inode,&owner->socket_path);
  if(!error) {
    /* A live owner holds the database lock, so a socket at this path is stale. */
    unlink(owner->socket_path);
    struct sockaddr_un address;
    if((error=br_socket_address(&address,owner->socket_path))) {}
    else {
      owner->listener=socket(AF_UNIX,SOCK_STREAM,0);
      if(owner->listener<0)error=errno;
      else {
        fcntl(owner->listener,F_SETFD,FD_CLOEXEC);
        if(bind(owner->listener,(struct sockaddr *)&address,sizeof(address)) ||
           listen(owner->listener,SOMAXCONN))error=errno;
      }
    }
  }
  if(error) {
    if(owner->listener>=0){close(owner->listener);owner->listener=-1;}
    if(owner->lock>=0){close(owner->lock);owner->lock=-1;}
  }
  return error;
}
static int br_owner_serve(const char *database) {
  BrOwner owner={.listener=-1,.lock=-1};
  int error=br_owner_bind(&owner,database);
  if(!error)error=br_owner_loop(&owner);
  if(owner.listener>=0)close(owner.listener);
  if(owner.socket_path)unlink(owner.socket_path);
  while(owner.attempts){BrKeeper *keeper=owner.attempts;owner.attempts=keeper->next;br_keeper_stop(keeper);}
  while(owner.controls) {
    BrOwnerControl *control=owner.controls;owner.controls=control->next;
    if(control->rights>=0)close(control->rights);
    br_owner_control_close(control);free(control->incoming);free(control->reply);free(control);
  }
  if(owner.lock>=0)close(owner.lock);
  free(owner.database);free(owner.socket_path);
  return error;
}
static int br_keeper(const char *directory,int lock) {
  BrKeeper keeper={.listener=-1,.client=3,.input=-1,.lock=lock,.watch=-1,.wake={-1,-1},.spool=-1,.generation=1};
  BrOwner owner={.listener=-1,.lock=-1,.single=1};
  BrState state={0,0,0,0,0};
  int error=0;
  keeper.directory=realpath(directory,NULL);
  if(!keeper.directory)return errno;
  fcntl(keeper.client,F_SETFD,FD_CLOEXEC);
  if((error=br_nonblock(keeper.client)))goto done;
  if((error=br_keeper_start(&keeper,directory,lock)))goto done;
  state=(BrState){keeper.native_pid,0,0,0,keeper.input_closed};
  if((error=br_send(&keeper,(BrFrame){.op=BR_HELLO,.length=sizeof(state),.value=2},&state)))goto done;
  owner.attempts=&keeper;
  error=br_owner_loop(&owner);
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
  free(keeper.incoming);br_manifest_free(&keeper.manifest);
  return 0;
}
/* Writes the attempt manifest that custody and recovery both read. */
static int br_manifest_store(const char *directory,const char *manifest_path,BrManifestHeader *header,char **fields,size_t *lengths) {
  int fd=open(manifest_path,O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC,0600),error=0;
  if(fd<0)return errno;
  error=br_write_all(fd,header,sizeof(*header));
  for(int i=0;i<6 && !error;i++)error=br_write_all(fd,fields[i],lengths[i]);
  if(!error && fsync(fd))error=errno;
  if(!error && fchmod(fd,0400))error=errno;
  close(fd);
  int dirfd=open(directory,O_RDONLY|O_CLOEXEC);
  if(!error && (dirfd<0 || fsync(dirfd)))error=errno;
  if(dirfd>=0)close(dirfd);
  return error;
}
/* Creates the exclusive attempt directory, its control socket directory and
   the manifest that admits the attempt. */
static int br_attempt_prepare(BatonProcessCall *call,char **directory_out,char **address_out) {
  if(!call->length || call->args[call->length-1] || !call->args[0] || !call->recovery_length ||
     call->recovery[call->recovery_length-1] || !call->recovery[0])return EINVAL;
  if(mkdir(call->directory,0700))return errno;
  call->unstarted=1;
  char *directory=realpath(call->directory,NULL);
  if(!directory)return errno;
  char temporary[]="/tmp/baton-retained-XXXXXX";
  if(!mkdtemp(temporary)){free(directory);return errno;}
  char *address=br_path(temporary,"control"),*manifest_path=br_path(directory,"manifest");
  int error=!address || !manifest_path?ENOMEM:0;
  if(!error) {
    BrManifestHeader header={.magic={'B','A','T','O','N','R','P','1'},.keep_stdin=call->keep_stdin};
    char *fields[6]={call->args,call->cwd,call->log,call->initial,call->recovery,address};
    size_t lengths[6]={call->length,strlen(call->cwd),strlen(call->log),call->initial_length,call->recovery_length,strlen(address)};
    for(int i=0;i<6;i++)header.lengths[i]=lengths[i];
    error=br_manifest_store(directory,manifest_path,&header,fields,lengths);
  }
  free(manifest_path);
  if(error){free(address);free(directory);return error;}
  *directory_out=directory;*address_out=address;
  return 0;
}
static int br_retain(BatonProcessCall *call) {
  char *directory=NULL,*address=NULL;
  int error=br_attempt_prepare(call,&directory,&address);
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
  free(self);free(log_path);free(address);free(directory);
  return error;
}

/* Reads the token the bound owner published before it listened. */
static int br_instance_token(const char *canonical,uint64_t *token) {
  char *path=br_suffix(canonical,".owner-token");
  if(!path)return ENOMEM;
  int fd=open(path,O_RDONLY|O_CLOEXEC);free(path);
  if(fd<0)return errno;
  char text[17];int error=br_read_all(fd,text,sizeof(text));
  close(fd);
  if(error)return error;
  text[16]=0;
  char *end;errno=0;unsigned long long value=strtoull(text,&end,16);
  if(errno || end!=text+16)return EINVAL;
  *token=(uint64_t)value;return 0;
}
static int br_instance_spawn(const char *canonical,pid_t *pid) {
  char *self=br_self(),*log_path=br_suffix(canonical,".owner.log");
  int null=self?open("/dev/null",O_RDONLY|O_CLOEXEC):-1;
  int log=log_path?open(log_path,O_WRONLY|O_CREAT|O_APPEND|O_CLOEXEC,0600):-1;
  char *argv[]={self,"--instance-owner",(char *)canonical,NULL};
  int error=self && log_path && null>=0 && log>=0?br_spawn(pid,argv,NULL,null,log,log,-1,-1):(errno?errno:ENOMEM);
  if(null>=0)close(null);if(log>=0)close(log);free(self);free(log_path);
  if(!error) {
    pthread_t reaper;
    if(!pthread_create(&reaper,NULL,br_reap_detached,(void *)(intptr_t)*pid))pthread_detach(reaper);
  }
  return error;
}
/* Connects to the database owner and reads the token it published. When the
   rendezvous socket has no listener and `spawn` is set, the client starts one
   owner and waits for it, so adding a session adds no custody process. */
static int br_instance_connect(const char *database,int spawn,uint64_t *token,int *socket_out) {
  char *canonical=realpath(database,NULL);
  if(!canonical)return errno;
  struct stat info;
  int error=stat(canonical,&info)?errno:0;
  char *path=NULL;
  if(!error)error=br_owner_socket_path(canonical,(uint64_t)info.st_dev,(uint64_t)info.st_ino,&path);
  struct sockaddr_un address;
  if(!error)error=br_socket_address(&address,path);
  int socket_fd=-1,started=0;
  for(int attempt=0;!error && attempt<600;attempt++) {
    if(attempt){struct timespec pause={0,20000000};nanosleep(&pause,NULL);}
    socket_fd=socket(AF_UNIX,SOCK_STREAM,0);
    if(socket_fd<0){error=errno;break;}
    fcntl(socket_fd,F_SETFD,FD_CLOEXEC);
    if(!connect(socket_fd,(struct sockaddr *)&address,sizeof(address)))break;
    error=errno;close(socket_fd);socket_fd=-1;
    if(error!=ENOENT && error!=ECONNREFUSED)break;
    if(spawn && !started) {
      pid_t pid;
      if((error=br_instance_spawn(canonical,&pid)))break;
      started=1;
    }
    error=spawn?0:ENOENT;
    if(attempt==599)error=ETIMEDOUT;
  }
  if(!error)error=br_instance_token(canonical,token);
  if(error && socket_fd>=0){close(socket_fd);socket_fd=-1;}
  free(path);free(canonical);
  *socket_out=socket_fd;
  return error;
}
/* Sends one database-level request and refuses a reply whose owner token does
   not match the token published for the bound database. */
static int br_instance_request(const char *database,BrInstanceFrame frame,const char *payload,int rights,BrInstanceFrame *reply) {
  uint64_t token=0;int socket_fd=-1;
  int error=br_instance_connect(database,1,&token,&socket_fd);
  if(error)return error;
  frame.owner=token;
  if(rights>=0) {
    char data[CMSG_SPACE(sizeof(int))];
    struct iovec vector={&frame,sizeof(frame)};
    struct msghdr message={.msg_iov=&vector,.msg_iovlen=1,.msg_control=data,.msg_controllen=sizeof(data)};
    struct cmsghdr *control=CMSG_FIRSTHDR(&message);
    control->cmsg_level=SOL_SOCKET;control->cmsg_type=SCM_RIGHTS;
    control->cmsg_len=CMSG_LEN(sizeof(int));
    int guard=rights;memcpy(CMSG_DATA(control),&guard,sizeof(guard));
    ssize_t n;do {n=sendmsg(socket_fd,&message,0);}while(n<0 && errno==EINTR);
    error=n<0?errno:n!=(ssize_t)sizeof(frame)?EIO:0;
  } else error=br_write_all(socket_fd,&frame,sizeof(frame));
  if(!error && frame.length)error=br_write_all(socket_fd,payload,(size_t)frame.length);
  BrInstanceFrame answer;
  if(!error)error=br_read_all(socket_fd,&answer,sizeof(answer));
  close(socket_fd);
  if(error)return error;
  if(answer.owner!=token)return ESTALE;
  if(answer.error)return answer.error;
  *reply=answer;
  return 0;
}
/* Connects to the attempt's own socket and writes its directory-addressed
   request. The caller reads the reply on the same socket. */
static int br_attempt_socket(const char *directory,uint32_t op,uint64_t serial,int64_t value,const char *payload,size_t length,int *socket_out) {
  BrManifest manifest={0};
  int error=br_manifest_read(directory,&manifest);
  struct sockaddr_un address;
  if(!error)error=br_socket_address(&address,manifest.field[5]);
  int socket_fd=-1;
  if(!error) {
    socket_fd=socket(AF_UNIX,SOCK_STREAM,0);
    if(socket_fd<0)error=errno;else fcntl(socket_fd,F_SETFD,FD_CLOEXEC);
  }
  size_t identity=strlen(directory)+1;
  if(!error && length>UINT64_MAX-identity)error=EOVERFLOW;
  if(!error && connect(socket_fd,(struct sockaddr *)&address,sizeof(address)))error=errno;
  if(!error) {
    BrFrame frame={.op=op,.serial=serial,.length=identity+length,.value=value};
    error=br_write_all(socket_fd,&frame,sizeof(frame));
    if(!error)error=br_write_all(socket_fd,directory,identity);
    if(!error && length)error=br_write_all(socket_fd,payload,length);
  }
  if(error && socket_fd>=0){close(socket_fd);socket_fd=-1;}
  br_manifest_free(&manifest);
  *socket_out=socket_fd;
  return error;
}
/* Joins an existing attempt as its observer. */
static int br_instance_join(BatonProcessCall *call,const char *directory) {
  int socket_fd=-1;
  int error=br_attempt_socket(directory,BR_ATTACH,0,0,NULL,0,&socket_fd);
  if(!error) {error=br_attach_socket(call->child,directory,socket_fd,NULL);socket_fd=-1;}
  if(socket_fd>=0)close(socket_fd);
  return error;
}
/* Asks the owner for the attempt's custody, then joins as its observer. The
   owner refuses a second native child for an attempt that already launched. */
static int br_instance_admit(BatonProcessCall *call) {
  char *directory=NULL,*address=NULL;
  int error=br_attempt_prepare(call,&directory,&address);
  if(!error) {
    BrInstanceFrame reply;
    error=br_instance_request(call->database,
      (BrInstanceFrame){.op=BI_ADMIT,.length=strlen(directory)+1},directory,
      call->lock<0?-1:(int)call->lock,&reply);
    if(!error && reply.attempt)call->unstarted=0;
  }
  if(!error)error=br_instance_join(call,directory);
  free(address);free(directory);
  return error;
}
static int br_instance_attach(BatonProcessCall *call) {
  char *directory=realpath(call->directory,NULL);
  if(!directory)return errno;
  BrInstanceFrame reply;
  int error=br_instance_request(call->database,(BrInstanceFrame){.op=BI_ENSURE},NULL,-1,&reply);
  if(!error)error=br_instance_join(call,directory);
  free(directory);
  return error;
}
static int br_instance_attach_owned(BatonProcessCall *call) {
  char *directory=realpath(call->directory,NULL);
  if(!directory)return errno;
  BrInstanceFrame reply;
  int error=br_instance_request(call->database,(BrInstanceFrame){.op=BI_ENSURE},NULL,-1,&reply);
  if(!error) {
    error=br_instance_join(call,directory);
    if(error==ECONNREFUSED || error==ENOENT || error==EPIPE)
      error=br_attach_orphan(call->child,directory,(int)call->lock);
  }
  free(directory);
  return error;
}
static int br_instance_shutdown(BatonProcessCall *call) {
  BrInstanceFrame reply;
  uint64_t token=0;
  int socket_fd=-1;
  int error=br_instance_connect(call->database,0,&token,&socket_fd);
  if(error==ENOENT || error==ECONNREFUSED)return 0;
  if(error)return error;
  close(socket_fd);
  return br_instance_request(call->database,(BrInstanceFrame){.op=BI_SHUTDOWN},NULL,-1,&reply);
}
/* Terminal capability cleanup. The attempt directory and its markers stay the
   durable record; this only releases the slot for reuse. */
static int br_instance_retire(BatonProcessCall *call) {
  BatonRetained *retained=call->child->retained;
  if(!retained)return EBADF;
  if(!retained->acknowledged)return EBUSY;
  if(retained->socket>=0)close(retained->socket);
  if(retained->spool>=0)close(retained->spool);
  if(retained->life>=0)close(retained->life);
  if(retained->watch>=0)close(retained->watch);
  pthread_mutex_destroy(&retained->state);pthread_mutex_destroy(&retained->command);
  pthread_mutex_destroy(&retained->reader);pthread_cond_destroy(&retained->changed);
  free(retained->directory);free(retained);
  call->child->retained=NULL;
  call->child->input=-1;
  call->child->pid=0;
  call->child->reaped=1;
  uint32_t index=call->handle&BATCHILD_INDEX_MASK;
  if(call->child->generation<BATCHILD_GENERATION_MAX) {
    call->child->generation++;
    if(baton_child_free_count==baton_child_free_capacity) {
      size_t capacity=baton_child_free_capacity?baton_child_free_capacity*2:16;
      uint32_t *next=realloc(baton_child_free,capacity*sizeof(*next));
      if(next){baton_child_free=next;baton_child_free_capacity=capacity;}
    }
    if(baton_child_free_count<baton_child_free_capacity)
      baton_child_free[baton_child_free_count++]=index;
  }
  return 0;
}
static int br_recovery(BatonProcessCall *call) {
  call->eof=1;
  char *directory=realpath(call->directory,NULL);
  if(!directory)return errno==ENOENT?0:errno;
  if(br_exists(directory,"acknowledged") || br_exists(directory,"released") || br_exists(directory,"native-start-error") || !br_exists(directory,"launch")) {
    free(directory);return 0;
  }
  BrManifest manifest={0};int error=br_manifest_read(directory,&manifest);BrBirth birth;
  if(!error)error=br_read_file(directory,"native.birth",&birth,sizeof(birth));
  if(!error) {
    call->text=manifest.field[4];manifest.field[4]=NULL;
    call->length=(size_t)manifest.header.lengths[4]-1;call->eof=0;
  }
  br_manifest_free(&manifest);free(directory);return error;
}
static void baton_retained_begin_call(BatonProcessCall *call) {
  if(call->kind==BP_RECOVERY)call->error=br_recovery(call);
  else if(call->kind==BP_KEEPER) call->error=br_keeper(call->directory,(int)call->lock);
  else if(call->kind==BP_RETAIN) call->error=br_retain(call);
  else if(call->kind==BP_INSTANCE_OWNER) call->error=br_owner_serve(call->database);
  else if(call->kind==BP_INSTANCE_ADMIT) call->error=br_instance_admit(call);
  else if(call->kind==BP_INSTANCE_ATTACH) call->error=br_instance_attach(call);
  else if(call->kind==BP_INSTANCE_ATTACH_OWNED) call->error=br_instance_attach_owned(call);
  else if(call->kind==BP_INSTANCE_SHUTDOWN) call->error=br_instance_shutdown(call);
  else if(call->kind==BP_INSTANCE_RETIRE) call->error=br_instance_retire(call);
  else {
    char *directory=realpath(call->directory,NULL);
    if(!directory)call->error=errno;
    else {
      int attach=call->kind==BP_ATTACH || call->kind==BP_ATTACH_OWNED;
      uint32_t op=attach?BR_ATTACH:call->kind==BP_CONTROL_WRITE?BR_CONTROL_WRITE:BR_CONTROL_SIGNAL;
      uint64_t serial=attach?0:1;
      const char *payload=call->kind==BP_CONTROL_WRITE?call->text:NULL;
      size_t length=call->kind==BP_CONTROL_WRITE?call->length:0;
      int socket_fd=-1;
      call->error=br_attempt_socket(directory,op,serial,call->signal,payload,length,&socket_fd);
      if(!call->error) {
        if(attach) {call->error=br_attach_socket(call->child,directory,socket_fd,NULL);socket_fd=-1;}
        else {
          BrFrame reply;
          call->error=br_read_all(socket_fd,&reply,sizeof(reply));
          if(!call->error && (reply.op!=BR_REPLY || reply.serial!=serial || reply.length))call->error=EPROTO;
          if(!call->error)call->error=reply.error;
        }
      }
      if(call->kind==BP_ATTACH_OWNED && (call->error==ECONNREFUSED || call->error==ENOENT || call->error==EPIPE))
        call->error=br_attach_orphan(call->child,directory,(int)call->lock);
      if(socket_fd>=0)close(socket_fd);
      free(directory);
    }
  }
  if(call->error) {
    const char *operation=call->kind==BP_RETAIN?"retain":call->kind==BP_ATTACH?"attach":
      call->kind==BP_CONTROL_WRITE?"control_write":call->kind==BP_CONTROL_SIGNAL?"control_signal":
      call->kind==BP_INSTANCE_OWNER?"owner":call->kind==BP_INSTANCE_ADMIT?"admit":
      call->kind==BP_INSTANCE_ATTACH?"instance_attach":call->kind==BP_INSTANCE_ATTACH_OWNED?"instance_attach_owned":
      call->kind==BP_INSTANCE_SHUTDOWN?"shutdown":call->kind==BP_INSTANCE_RETIRE?"retire":"keeper";
    size_t n=(call->directory?strlen(call->directory):0)+(call->database?strlen(call->database):0)+160;
    call->detail=malloc(n);
    if(call->detail)snprintf(call->detail,n,"%s %s%s%s: %s; inspect manifest, keeper-error and observer.log",
      operation,call->database?call->database:"",call->database?" ":"",
      call->directory?call->directory:"",strerror(call->error));
  }
}

static void baton_process_call(IoWork *w) {
  BatonProcessCall *call=(BatonProcessCall *)w->data;
  BatonChild *child=call->child;
  if(call->kind==BP_SPAWN) { baton_child_spawn(call);return; }
  if(call->kind==BP_RETAIN || call->kind==BP_ATTACH || call->kind==BP_ATTACH_OWNED || call->kind==BP_RECOVERY || call->kind==BP_KEEPER || call->kind==BP_CONTROL_WRITE || call->kind==BP_CONTROL_SIGNAL ||
     call->kind==BP_INSTANCE_OWNER || call->kind==BP_INSTANCE_ADMIT || call->kind==BP_INSTANCE_ATTACH || call->kind==BP_INSTANCE_ATTACH_OWNED ||
     call->kind==BP_INSTANCE_SHUTDOWN || call->kind==BP_INSTANCE_RETIRE) {
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
  }
}

static Term baton_process_pack(Env e, IoWork *w) {
  BatonProcessCall *call=(BatonProcessCall *)w->data;
  Term value=term_pak(CID_UNIT,0);
  if(!call->error) {
    if(call->kind==BP_SPAWN || call->kind==BP_ATTACH || call->kind==BP_ATTACH_OWNED ||
       call->kind==BP_INSTANCE_ATTACH || call->kind==BP_INSTANCE_ATTACH_OWNED) value=(Term)call->handle;
    else if(call->kind==BP_INPUT_CLOSED) value=(Term)call->signal;
    else if(call->kind==BP_WAIT) value=io_str(e,call->text,call->length);
#ifdef CID_SOME
    else if(call->kind==BP_READ || call->kind==BP_RECOVERY) value=call->eof ? term_pak(CID_NONE,0)
      : io_box(e,CID_SOME,io_str(e,call->text,call->length));
#endif
  }
#ifdef CID_PROCESSCHILD_RETAIN_START
  if(call->kind==BP_RETAIN && (!call->error || call->unstarted)) {
    const char *error=call->detail?call->detail:strerror(call->error);
    value=io_tup(e,call->unstarted?term_pak(CID_NONE,0):io_box(e,CID_SOME,(Term)call->handle),
      io_str(e,call->unstarted?error:"",call->unstarted?strlen(error):0));
  }
#endif
#ifdef CID_INSTANCE_ADMIT
  if(call->kind==BP_INSTANCE_ADMIT && (!call->error || call->unstarted)) {
    const char *error=call->detail?call->detail:strerror(call->error);
    value=io_tup(e,call->unstarted?term_pak(CID_NONE,0):io_box(e,CID_SOME,(Term)call->handle),
      io_str(e,call->unstarted?error:"",call->unstarted?strlen(error):0));
  }
#endif
  Term result=call->error && !call->unstarted ? io_fail(e,call->error,call->detail) : io_done(e,value);
  if((call->kind==BP_SPAWN || call->kind==BP_RETAIN || call->kind==BP_ATTACH || call->kind==BP_ATTACH_OWNED ||
      call->kind==BP_INSTANCE_ADMIT || call->kind==BP_INSTANCE_ATTACH || call->kind==BP_INSTANCE_ATTACH_OWNED) && call->error) {
    baton_children[call->index]=NULL;free(call->child);call->child=NULL;
  }
  free(call->args);free(call->cwd);free(call->log);free(call->text);
  free(call->directory);free(call->initial);free(call->recovery);free(call->detail);free(call->database);free(call);
  w->data=NULL;
  return result;
}

static Term baton_process_begin(Env e, Term *f, IoWork *w, int kind) {
  BatonProcessCall *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  int acquire=kind==BP_SPAWN || kind==BP_RETAIN || kind==BP_ATTACH || kind==BP_ATTACH_OWNED ||
              kind==BP_INSTANCE_ADMIT || kind==BP_INSTANCE_ATTACH || kind==BP_INSTANCE_ATTACH_OWNED;
  call->kind=kind;
  if(acquire) {
    int error=baton_child_allocate(call);
    if(error) {free(call);return io_fail(e,(u32)error,NULL);}
  }
  if(kind==BP_SPAWN || kind==BP_RETAIN || kind==BP_INSTANCE_ADMIT) {
    int offset=kind==BP_RETAIN?1:2;
    u64 length=0,cwd_length=0,log_length=0;
    if(kind==BP_INSTANCE_ADMIT)call->database=io_cstr(e,f[0],&length);
    call->args=io_cstr(e,f[offset],&length);call->length=length;
    call->cwd=io_cstr(e,f[offset+1],&cwd_length);
    call->log=io_cstr(e,f[offset+2],&log_length);
    if(strlen(call->cwd)!=cwd_length || strlen(call->log)!=log_length) call->error=EINVAL;
    if(kind==BP_RETAIN) {
      call->initial=io_cstr(e,f[4],&length);call->initial_length=length;
      call->keep_stdin=(u32)f[5];call->lock=(u32)f[6];
      call->recovery=io_cstr(e,f[7],&length);call->recovery_length=length;
    } else if(kind==BP_INSTANCE_ADMIT) {
      call->initial=io_cstr(e,f[5],&length);call->initial_length=length;
      call->keep_stdin=(u32)f[6];call->lock=(u32)f[7];
      call->recovery=io_cstr(e,f[8],&length);call->recovery_length=length;
    }
  }
  if(kind==BP_RETAIN || kind==BP_INSTANCE_ADMIT) {
    u64 length=0;call->directory=io_cstr(e,f[kind==BP_RETAIN?0:1],&length);
    if(strlen(call->directory)!=length)call->error=EINVAL;
  } else if(kind==BP_ATTACH || kind==BP_ATTACH_OWNED || kind==BP_RECOVERY || kind==BP_KEEPER ||
            kind==BP_CONTROL_WRITE || kind==BP_CONTROL_SIGNAL) {
    u64 length=0;call->directory=io_cstr(e,f[0],&length);
    if(strlen(call->directory)!=length)call->error=EINVAL;
    if(kind==BP_KEEPER || kind==BP_ATTACH_OWNED)call->lock=(u32)f[1];
    if(kind==BP_CONTROL_WRITE) {call->text=io_cstr(e,f[1],&length);call->length=length;}
    if(kind==BP_CONTROL_SIGNAL)call->signal=(u32)f[1];
  } else if(kind==BP_INSTANCE_OWNER || kind==BP_INSTANCE_SHUTDOWN) {
    u64 length=0;call->database=io_cstr(e,f[0],&length);
    if(strlen(call->database)!=length)call->error=EINVAL;
  } else if(kind==BP_INSTANCE_ATTACH || kind==BP_INSTANCE_ATTACH_OWNED) {
    u64 length=0;call->database=io_cstr(e,f[0],&length);
    call->directory=io_cstr(e,f[1],&length);
    if(strlen(call->directory)!=length)call->error=EINVAL;
    if(kind==BP_INSTANCE_ATTACH_OWNED)call->lock=(u32)f[2];
  } else if(!acquire) {
    call->handle=(u32)f[0];
    u32 index=call->handle&BATCHILD_INDEX_MASK;
    if(index>=baton_child_count || !baton_children[index]) {free(call);return io_fail(e,EBADF,NULL);}
    call->index=index;
    call->child=baton_children[index];
    if(call->child->generation!=(call->handle>>16)) {free(call);return io_fail(e,ESTALE,NULL);}
    if(call->child->reaped && !call->child->retained && kind!=BP_WRITE && kind!=BP_INPUT_CLOSED) {free(call);return io_fail(e,ECHILD,NULL);}
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

#ifdef CID_INSTANCE_OWNER
BP_EFFECT(baton_instance_owner,CID_INSTANCE_OWNER,BP_INSTANCE_OWNER)
#endif
#ifdef CID_INSTANCE_ADMIT
BP_EFFECT(baton_instance_admit,CID_INSTANCE_ADMIT,BP_INSTANCE_ADMIT)
#endif
#ifdef CID_INSTANCE_ATTACH
BP_EFFECT(baton_instance_attach,CID_INSTANCE_ATTACH,BP_INSTANCE_ATTACH)
#endif
#ifdef CID_INSTANCE_ATTACH_OWNED
BP_EFFECT(baton_instance_attach_owned,CID_INSTANCE_ATTACH_OWNED,BP_INSTANCE_ATTACH_OWNED)
#endif
#ifdef CID_INSTANCE_SHUTDOWN
BP_EFFECT(baton_instance_shutdown,CID_INSTANCE_SHUTDOWN,BP_INSTANCE_SHUTDOWN)
#endif
#ifdef CID_INSTANCE_RETIRE
BP_EFFECT(baton_instance_retire,CID_INSTANCE_RETIRE,BP_INSTANCE_RETIRE)
#endif

#undef BP_EFFECT
static void __attribute__((constructor)) baton_process_signals(void){signal(SIGPIPE,SIG_IGN);}
