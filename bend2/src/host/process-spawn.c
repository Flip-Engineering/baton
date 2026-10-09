#include <errno.h>
#include <limits.h>
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
  uint64_t owner_incarnation,owner_attempt;
  int kind, error, eof, unstarted, fresh;
  char *directory, *initial, *recovery, *detail, *database, *artifact_name, *artifact, *identity, *owner_witness;
  size_t initial_length, recovery_length, artifact_name_length, artifact_length, identity_length;
  u32 keep_stdin, lock;
  char *cursor, *generation;
  char *notice;
  size_t notice_length;
  int awake_alive;
} BatonProcessCall;
static int br_instance_decision(BatonProcessCall *call);
static void br_instance_state_call(BatonProcessCall *call);
static char *br_json_escape(const char *text);

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

enum { BP_SPAWN, BP_WRITE, BP_CLOSE, BP_READ, BP_READ_AWAKE, BP_WAIT, BP_SIGNAL, BP_PID,
       BP_RETAIN, BP_ATTACH, BP_RELEASE, BP_ACK, BP_KEEPER, BP_INPUT_CLOSED,
       BP_CONTROL_WRITE, BP_CONTROL_SIGNAL, BP_ATTACH_OWNED, BP_RECOVERY,
       BP_INSTANCE_OWNER, BP_INSTANCE_ADMIT, BP_INSTANCE_ATTACH,
       BP_INSTANCE_ATTACH_OWNED, BP_INSTANCE_SHUTDOWN, BP_INSTANCE_RETIRE,
       BP_INSTANCE_COMMIT, BP_INSTANCE_RESTORE, BP_INSTANCE_REPLAY,
       BP_INSTANCE_JOB, BP_RETAIN_WITH_FILE, BP_INSTANCE_ADMIT_WITH_FILE,
       BP_INSTANCE_SUBSCRIBE, BP_INSTANCE_NOTICE, BP_INSTANCE_UNSUBSCRIBE,
       BP_INSTANCE_PUBLISH, BP_INSTANCE_STATE, BP_INSTANCE_PREPARE,
       BP_INSTANCE_PREPARE_WITH_FILE, BP_INSTANCE_START, BP_INSTANCE_CANCEL,
       BP_INSTANCE_OWNER_WITNESS, BP_INSTANCE_ENSURE_OWNER_WITNESS,
       BP_INSTANCE_RECOVER };

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
    child->generation=baton_child_next_generation++&BATCHILD_GENERATION_MAX;
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

static void baton_child_retire_slot(BatonProcessCall *call) {
  call->child->input=-1;call->child->pid=0;call->child->reaped=1;
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
  int log=open(call->log,O_WRONLY|O_CREAT|O_APPEND|O_CLOEXEC,0600);
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
       BR_ATTACH, BR_CONTROL_WRITE, BR_CONTROL_SIGNAL, BR_READY, BR_CANCELLED,
       BR_UNKNOWN };
typedef struct { uint32_t op; int32_t error; uint64_t serial,length; int64_t value; } BrFrame;
typedef struct { int32_t pid,exited,status,released,input_closed; } BrState;
typedef struct {
  char magic[8]; uint64_t lengths[8]; uint32_t keep_stdin,reserved;
} BrManifestHeader;
/* `count` is the manifest version's field count: 6 for BATONRP1, 8 for BATONRP2,
   whose two further fields carry the prepared artifact's name and the digest of
   its bytes. */
typedef struct { BrManifestHeader header; char *field[8]; int count; } BrManifest;
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
/* The native process identity: pid plus its start time, so a checkpoint can be
   bound to the exact process that produced the observed bytes. */
typedef struct { int32_t pid; uint64_t first,second; } BrBirth;
typedef struct BatonRetained {
  int socket,spool,error,exited,status,input_closed;
  int guard,watch,life,orphan,unknown,released,acknowledged,observer_only;
  char *directory,*database;
  uint64_t version,serial,reply_serial,owner_attempt,owner_incarnation,owner_epoch;
  int reply_error;
  off_t offset;
  uint64_t offset_stored,incarnation;
  uint64_t subscribe_generation,subscribe_cursor;
  int subscribe_gap;
  pthread_t receiver;
  pthread_mutex_t state,command,reader;
  pthread_cond_t changed;
} BatonRetained;
typedef struct BrKeeper {
  struct BrKeeper *next;
  uint32_t id;
  uint64_t identity;
  int listener,client,input,lock,watch,wake[2],spool,native_life,finishing,change_queued;
  uint64_t generation;
  pid_t native_pid,recovery_pid;
  int exited,status,released,input_closed,ready,native_waiting,prepared,cancelled;
  int monitor_only,status_unavailable;
  /* Recovery observers are owner-managed continuation work. An acknowledged
     attempt remains live until every child launched for it has been reaped. */
  size_t recovery_pending;
  struct BrWaiter *unwatched_recovery;
  char *directory,*incoming;
  size_t incoming_size,incoming_capacity;
  BrManifest manifest;
  BrBuffer *writes,*writes_tail,*outgoing,*outgoing_tail;
  BrControl *controls;
} BrKeeper;

/* The database-level owner protocol. One owner process serves one physical
   database; clients admit, resolve and retire attempts through this header and
   then speak the existing per-attempt protocol to the attempt's own socket.
   `owner` is the owner incarnation token and `epoch` its native custody epoch,
   so a client can refuse a socket left by an earlier owner. */
typedef struct {
  uint32_t op; int32_t error;
  uint64_t owner,epoch,attempt,generation,length;
  uint32_t state,reserved;
} BrInstanceFrame;
typedef struct {
  uint32_t directory_length,bootstrap_length,witness_length,reserved;
} BrRecoveryRequest;
enum { BI_ENSURE=1, BI_ADMIT, BI_ATTACH, BI_SHUTDOWN, BI_STATE, BI_HELLO, BI_REPLY,
       BI_SUBSCRIBE, BI_COMMIT, BI_NOTICE, BI_READY, BI_PREPARE, BI_START, BI_CANCEL,
       BI_RECOVER };
/* A committed-change subscription. A process that committed a database
   transaction publishes the durable native_changes high-water cursor with
   BI_COMMIT after its commit; the owner records the highest published cursor and
   sends one BI_NOTICE to each subscribed connection per advance. A notice carries
   the cursor only: the subscriber rereads the rows from SQLite in its own read
   transaction, scoped to its reader and subtree. */
typedef struct { uint64_t generation,after_cursor; } BrInstanceSubscribe;
typedef struct { uint64_t cursor; } BrInstanceCommit;
/* The readiness reply. `gap` is one when this owner incarnation cannot serve the
   range the subscriber asked to resume from, so the subscriber takes a fresh
   snapshot; `cursor` is the high-water it may replay rows up to either way. */
typedef struct { uint64_t generation,cursor; uint32_t gap,reserved; } BrInstanceReady;
enum { BN_COMMIT=1, BN_GAP=2 };
typedef struct { uint64_t cursor; uint32_t kind,reserved; } BrInstanceNotice;
typedef struct BrOwnerControl {
  struct BrOwnerControl *next;
  int socket,answered,rights,subscribe;
  uint64_t after_cursor;
  char *incoming,*reply;
  size_t size,capacity,reply_length,sent;
} BrOwnerControl;
/* A database-level reply payload: the owner incarnation and the facts a caller
   needs to address the attempt as a retained job. `observing` is one while an
   observer holds the attempt's socket; a caller that cannot observe still has
   the retained result path through this reference. */
typedef struct {
  uint64_t owner,epoch,attempts;
  uint64_t attempt,generation;
  uint64_t spool_bytes,checkpoint_offset;
  int32_t status;
  uint32_t status_known,observing,reserved;
} BrOwnerState;
/* The elected owner's published incarnation, in the per-user IPC directory. */
typedef struct {
  uint64_t token,epoch,device,inode;
  int32_t pid,reserved;
  char socket[104];
} BrOwnerRecord;
/* The observation checkpoint of one attempt. It binds the consumed spool offset
   to the reducer state the observation owner had durably committed there, and to
   the exact custody the bytes came from: the native process, the admitted
   manifest, and the stdout spool file. The checksum covers the whole record
   including the state bytes, so a same-length corruption is refused. The owner
   incarnation is recorded as provenance and is not an acceptance criterion,
   because a native attempt outlives an owner restart. */
typedef struct {
  char magic[8];
  uint32_t schema,expected_set;
  uint64_t incarnation,attempt,manifest,spool_device,spool_inode,offset,length,check;
  BrBirth birth;
} BrCheckpoint;
/* A checkpoint whose facts cannot be validated against this attempt is unusable
   and the observer replays from the beginning. A failure to perform the
   validation at all (allocation, device I/O, a descriptor that is no longer
   usable) is reported to the caller instead, because the record may be intact. */
static int br_checkpoint_unusable(int error) {
  return error==ENOENT || error==EINVAL || error==EOVERFLOW || error==ENOTDIR ||
         error==EPIPE || error==ESTALE;
}
static int br_checkpoint_load(const char *directory,int spool_fd,uint32_t schema,
                              uint64_t *offset,char **state,size_t *length);
static int br_checkpoint_store(const char *directory,int spool_fd,uint32_t schema,
                               uint64_t incarnation,uint64_t offset,const char *state,size_t length);
static int br_checkpoint_verified_offset(const char *directory,int spool_fd,uint64_t *offset);
static uint64_t br_attempt_identity(const char *directory);
static int br_checkpoint_custody(const char *directory,int spool_fd,BrBirth *birth,
                                 uint64_t *manifest,uint64_t *spool_device,uint64_t *spool_inode);
static uint64_t br_manifest_digest(const BrManifestHeader *header,char *const *fields,int count);
static int br_manifest_digest_file(const char *directory,uint64_t *digest);
static int br_artifact_name_ok(const char *name,size_t length);
static int br_artifact_write(const char *directory,const char *name,const char *bytes,size_t length);
static int br_artifact_binding(const char *directory,const char *name,size_t name_length,
                               unsigned char digest[32],uint64_t *length);
static int br_artifact_same(const char *directory,const char *name,size_t name_length,
                            const char *bytes,size_t length);
static int br_manifest_same(const char *directory,const BrManifestHeader *header,char *const *fields,int count);
static int br_admission_verify(const char *directory,const char *database,int guard);
static int br_attempt_manifest_verify(const char *directory);
static int br_lifecycle_start(const char *directory,const unsigned char *expected_digest,
                              const unsigned char *grant_digest,int *retained);
static int br_lifecycle_cancel(const char *directory,const unsigned char *expected_digest,
                              const unsigned char *rejection_digest);
static int br_lifecycle_ready(const char *directory);
static int br_lifecycle_expectation(const char *directory,const unsigned char *expected_digest);
static int br_lifecycle_prepare_check(const char *directory);
static int br_manifest_store(const char *directory,const char *manifest_path,BrManifestHeader *header,char **fields,size_t *lengths,int count);
typedef struct {
  int listener,lock,finishing,single,database_fd,bound;
  uint64_t token,epoch,device,inode,parent_device,parent_inode;
  uint64_t cursor;
  char *database,*ipc,*key,*socket_path,*record_path,*generation_path,*cursor_path;
  BrKeeper *attempts;
  BrOwnerControl *controls;
  uint32_t next_id;
} BrOwner;
static int br_owner_recover(BrOwner *owner,const char *directory,const char *bootstrap,
                            const char *witness,BrKeeper **keeper_out);
static int br_owner_witness_parse(const char *text,uint64_t *token,uint64_t *epoch);
static void br_identity_sha256(const char *text,size_t length,unsigned char digest[32]);
#define BR_CHECKPOINT_MAGIC "BATONC03"

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
  for(int i=0;i<8;i++) free(manifest->field[i]);
}
static int br_manifest_read(const char *directory,BrManifest *manifest) {
  char *path=br_path(directory,"manifest");
  if(!path) return ENOMEM;
  int fd=open(path,O_RDONLY|O_CLOEXEC);free(path);
  if(fd<0) return errno;
  int error=br_read_all(fd,manifest->header.magic,8);
  int count=0;
  if(!error) {
    if(!memcmp(manifest->header.magic,"BATONRP1",8)) count=6;
    else if(!memcmp(manifest->header.magic,"BATONRP2",8)) count=8;
    else error=EINVAL;
  }
  uint64_t total=8+8*(uint64_t)count+8;
  for(int i=0;i<count && !error;i++) {
    error=br_read_all(fd,&manifest->header.lengths[i],sizeof(uint64_t));
    if(error) break;
    if(manifest->header.lengths[i]>SIZE_MAX-1 ||
       total>UINT64_MAX-manifest->header.lengths[i]) {error=EOVERFLOW;break;}
    total+=manifest->header.lengths[i];
  }
  if(!error) error=br_read_all(fd,&manifest->header.keep_stdin,sizeof(uint32_t));
  if(!error) error=br_read_all(fd,&manifest->header.reserved,sizeof(uint32_t));
  for(int i=0;i<count && !error;i++) {
    uint64_t length=manifest->header.lengths[i];
    manifest->field[i]=calloc((size_t)length+1,1);
    if(!manifest->field[i]) {error=ENOMEM;break;}
    error=br_read_all(fd,manifest->field[i],(size_t)length);
  }
  manifest->count=count;
  struct stat status;
  if(!error && (fstat(fd,&status) || (uint64_t)status.st_size!=total)) error=EINVAL;
  close(fd);
  if(!error) {
    for(int i=0;i<count;i++) {
      size_t n=(size_t)manifest->header.lengths[i];
      if(i==0 || i==4) {if(!n || manifest->field[i][n-1] || !manifest->field[i][0]) error=EINVAL;}
      else if(i!=3 && i!=7 && strlen(manifest->field[i])!=n) error=EINVAL;
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
static int br_process_lifetime(pid_t pid,int *ended) {
#ifdef __APPLE__
  int fd=kqueue();if(fd<0)return -1;
  fcntl(fd,F_SETFD,FD_CLOEXEC);
  struct kevent event;EV_SET(&event,pid,EVFILT_PROC,EV_ADD|EV_CLEAR,NOTE_EXIT,0,NULL);
  if(kevent(fd,&event,1,NULL,0,NULL)<0) {
    int error=errno;close(fd);if(error==ESRCH){*ended=1;return -1;}errno=error;return -1;
  }
#else
  int fd=(int)syscall(SYS_pidfd_open,pid,0);
  if(fd<0){if(errno==ESRCH)*ended=1;return -1;}
  fcntl(fd,F_SETFD,FD_CLOEXEC);
#endif
  return fd;
}
/* Registration precedes the keeper's waitpid. A dead/reused birth is ended. */
static int br_lifetime(const char *directory,int *ended) {
  BrBirth saved,current;int error=br_read_file(directory,"native.birth",&saved,sizeof(saved));
  if(error){errno=error;return -1;}
  int fd=br_process_lifetime(saved.pid,ended);
  if(fd<0)return -1;
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
    else if(frame.op==BR_UNKNOWN) {retained->exited=1;retained->unknown=1;retained->version++;}
    else if(frame.op==BR_CANCELLED) {retained->error=ECANCELED;retained->version++;}
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
static int br_attach_socket(BatonChild *child,const char *directory,int socket,int *unstarted,uint64_t incarnation) {
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
  if(!error && (hello.value==2 || hello.value==5) && !ended) {
    life=br_lifetime(directory,&ended);if(life<0 && !ended)error=errno;
  }
  BatonRetained *retained=error?NULL:calloc(1,sizeof(*retained));
  if(!error && !retained)error=ENOMEM;
  if(error){if(life>=0)close(life);if(guard>=0)close(guard);if(spool>=0)close(spool);close(socket);return error;}
  retained->socket=socket;retained->spool=spool;retained->guard=guard;retained->life=life;retained->watch=-1;
  retained->directory=strdup(directory);retained->exited=state.exited;retained->status=state.status;
  retained->input_closed=state.input_closed;retained->released=state.released;
  retained->observer_only=hello.value==4 || hello.value==5;
  if(hello.value==4)retained->unknown=1;
  pthread_mutex_init(&retained->state,NULL);pthread_mutex_init(&retained->command,NULL);
  pthread_mutex_init(&retained->reader,NULL);pthread_cond_init(&retained->changed,NULL);
  if(!retained->directory)error=ENOMEM;
  retained->incarnation=incarnation;
  /* The reader starts at the beginning. Resuming at a recorded offset is the
     caller's decision, taken through restore after it has restored the reducer
     state the checkpoint carries. */
  if(!error && (hello.value==2 || hello.value==3 || hello.value==4 || hello.value==5)) {
    BrFrame ready={.op=BR_READY,.serial=1};error=br_write_all(socket,&ready,sizeof(ready));
    BrFrame reply={0};
    if(!error)error=br_read_all(socket,&reply,sizeof(reply));
    if(!error && (reply.op!=BR_REPLY || reply.serial!=ready.serial || reply.length))error=EPROTO;
    if(!error)error=reply.error;
  }
  if(!error)error=pthread_create(&retained->receiver,NULL,br_receiver,retained);
  if(error){if(life>=0)close(life);if(guard>=0)close(guard);close(spool);close(socket);free(retained->directory);free(retained);return error;}
  child->pid=state.pid;child->retained=retained;
  return 0;
}
static int br_attach_orphan(BatonChild *child,const char *directory,int guard) {
  BatonRetained *retained=calloc(1,sizeof(*retained));if(!retained)return ENOMEM;
  retained->socket=-1;retained->spool=-1;retained->watch=-1;retained->life=-1;
  /* No owner serves this attempt, so no incarnation is bound and a checkpoint
     carrying one is unreadable; the native identity still binds. */
  retained->guard=fcntl(guard,F_DUPFD_CLOEXEC,10);retained->directory=strdup(directory);
  int error=retained->guard<0?errno:!retained->directory?ENOMEM:0;
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
  BrBirth birth={0};
  if(!error && !br_read_file(directory,"native.birth",&birth,sizeof(birth)))
    child->pid=birth.pid;
  child->retained=retained;return 0;
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
  if(retained->observer_only &&
     (call->kind==BP_WRITE || call->kind==BP_CLOSE || call->kind==BP_SIGNAL ||
      call->kind==BP_RELEASE || call->kind==BP_ACK ||
      call->kind==BP_INSTANCE_START || call->kind==BP_INSTANCE_CANCEL)) {
    call->error=EPERM;return;
  }
  if(call->kind==BP_INSTANCE_STATE) {
    br_instance_state_call(call);
    return;
  }
  if(call->kind==BP_INSTANCE_START || call->kind==BP_INSTANCE_CANCEL) {
    call->error=br_instance_decision(call);
    return;
  }
  if(call->kind==BP_READ) {br_read_line(call);return;}
  if(call->kind==BP_INSTANCE_COMMIT) {
    /* One atomic record: the consumed offset and the reducer state the caller
       committed after its own durable store and reducer effects for that frame.
       It is bound to this attempt's manifest, native process and spool file. */
    if(retained->spool<0) {call->error=EBADF;return;}
    pthread_mutex_lock(&retained->reader);
    call->error=br_checkpoint_store(retained->directory,retained->spool,(uint32_t)call->signal,
      retained->incarnation,(uint64_t)retained->offset,call->text,call->length);
    if(!call->error)retained->offset_stored=(uint64_t)retained->offset;
    pthread_mutex_unlock(&retained->reader);
    return;
  }
  if(call->kind==BP_INSTANCE_RESTORE) {
    /* Returns the committed reducer state and resumes at the offset that state
       belongs to. A missing, malformed or corrupt record yields no state and
       rewinds this reader to the beginning with a durable diagnostic, so the
       caller replays with its own deduplication and never skips a frame. */
    uint64_t offset=0;char *state=NULL;size_t length=0;
    int error=retained->spool<0?0:br_checkpoint_load(retained->directory,retained->spool,
      (uint32_t)call->signal,&offset,&state,&length);
    if(br_checkpoint_unusable(error)) {
      br_file(retained->directory,"checkpoint-error",
        "unusable observation checkpoint; replaying from the beginning\n",62,1);
      free(state);state=NULL;length=0;offset=0;error=0;
    }
    if(error) {free(state);call->error=error;return;}
    call->text=state;call->length=length;
    /* The reader is positioned at the recorded offset when there is one and
       rewound to the beginning when there is not. */
    pthread_mutex_lock(&retained->reader);
    retained->offset=(off_t)offset;retained->offset_stored=offset;
    pthread_mutex_unlock(&retained->reader);
    return;
  }
  if(call->kind==BP_INSTANCE_REPLAY) {
    /* Rewinds this admitted reader to the beginning after its own decode of the
       restored state was rejected. The child, its spool and its custody are
       untouched; only the observation position changes. */
    pthread_mutex_lock(&retained->reader);
    retained->offset=0;retained->offset_stored=0;
    pthread_mutex_unlock(&retained->reader);
    br_file(retained->directory,"checkpoint-error",
      "state rejected by the observer; replaying from the beginning\n",61,1);
    return;
  }
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
    if(retained->observer_only && retained->unknown)
      snprintf(text,sizeof(text),"unavailable: native exit status was not retained");
    else if(retained->unknown) snprintf(text,sizeof(text),"unknown after keeper loss");
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
typedef struct BrWaiter { BrWake event; int descriptor; struct BrWaiter *next; } BrWaiter;
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
static BrWaiter *br_waiter_prepare(BrKeeper *keeper,int kind) {
  BrWaiter *waiter=calloc(1,sizeof(*waiter));
  if(!waiter)return NULL;
  waiter->event=(BrWake){.kind=kind,.generation=keeper->generation};
  waiter->descriptor=fcntl(keeper->wake[1],F_DUPFD_CLOEXEC,10);
  if(waiter->descriptor<0){free(waiter);return NULL;}
  return waiter;
}
static void br_waiter_discard(BrWaiter *waiter) {
  if(!waiter)return;
  if(waiter->descriptor>=0)close(waiter->descriptor);
  free(waiter);
}
static int br_waiter_submit(BrKeeper *keeper,BrWaiter *waiter,pid_t pid) {
  waiter->event.pid=pid;
  if(waiter->event.kind=='R')keeper->recovery_pending++;
  pthread_t thread;int error=pthread_create(&thread,NULL,br_waiter,waiter);
  if(error) {
    if(waiter->event.kind=='R') {
      waiter->next=keeper->unwatched_recovery;
      keeper->unwatched_recovery=waiter;
    } else br_waiter_discard(waiter);
    return error;
  }
  pthread_detach(thread);return 0;
}
static int br_wait_start(BrKeeper *keeper,pid_t pid,int kind) {
  BrWaiter *waiter=br_waiter_prepare(keeper,kind);
  if(!waiter)return errno?errno:ENOMEM;
  return br_waiter_submit(keeper,waiter,pid);
}
/* A recovery child remains tracked if the waiter thread could not start. The
   owner reaps that exceptional child with WNOHANG while continuing its normal
   request loop; the periodic poll only applies while such a child is pending. */
static int br_recovery_reap_unwatched(BrKeeper *keeper) {
  for(BrWaiter **link=&keeper->unwatched_recovery;*link;) {
    BrWaiter *waiter=*link;int status=0;pid_t result;
    do {result=waitpid(waiter->event.pid,&status,WNOHANG);} while(result<0 && errno==EINTR);
    if(!result){link=&waiter->next;continue;}
    if(result<0 && errno!=ECHILD)return errno;
    *link=waiter->next;
    if(keeper->recovery_pending)keeper->recovery_pending--;
    if(result<0)br_note(keeper,"observer-error",ECHILD);
    else if(keeper->client<0 && !(WIFEXITED(status) && WEXITSTATUS(status)==0)) {
      char text[96];int n=snprintf(text,sizeof(text),"pid %d exited before attach: wait status %d\n",waiter->event.pid,status);
      br_file(keeper->directory,"observer-error",text,(size_t)n,0);
    }
    br_waiter_discard(waiter);
  }
  return 0;
}
static void br_recover(BrKeeper *keeper) {
  char **argv=br_argv(keeper->manifest.field[4],(size_t)keeper->manifest.header.lengths[4]);
  char *path=br_path(keeper->directory,"observer.log");
  int null=open("/dev/null",O_RDONLY|O_CLOEXEC),log=path?open(path,O_WRONLY|O_CREAT|O_APPEND|O_CLOEXEC,0600):-1;
  BrWaiter *waiter=argv&&path&&null>=0&&log>=0?br_waiter_prepare(keeper,'R'):NULL;
  int error=argv&&path&&null>=0&&log>=0&&waiter?
    br_spawn(&keeper->recovery_pid,argv,keeper->manifest.field[1],null,log,log,-1,-1):errno?errno:ENOMEM;
  if(null>=0)close(null);if(log>=0)close(log);free(path);free(argv);
  if(!error)error=br_waiter_submit(keeper,waiter,keeper->recovery_pid);
  else br_waiter_discard(waiter);
  if(error) br_note(keeper,"observer-error",error);
}
static void br_detach_observer(BrKeeper *keeper) {
  if(keeper->client>=0) close(keeper->client);
  keeper->client=-1;keeper->ready=0;keeper->incoming_size=0;keeper->change_queued=0;
  br_buffer_free(&keeper->outgoing,&keeper->outgoing_tail);
}
static void br_disconnected(BrKeeper *keeper) {
  br_detach_observer(keeper);
  if(!keeper->finishing && keeper->native_pid) br_recover(keeper);
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
  if(keeper->monitor_only && (frame.op==BR_WRITE || frame.op==BR_CLOSE ||
      frame.op==BR_SIGNAL || frame.op==BR_RELEASE || frame.op==BR_ACK))
    return br_reply(keeper,frame.serial,keeper->generation,EPERM);
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
  if(frame.op==BR_READY) {
    int error=br_lifecycle_ready(keeper->directory);
    if(error)return br_reply(keeper,frame.serial,keeper->generation,error);
    keeper->ready=1;
    if((error=br_reply(keeper,frame.serial,keeper->generation,0)))return error;
    return keeper->native_pid?br_native_exited(keeper):0;
  }
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
        if(keeper->status==0 && !keeper->status_unavailable) {
          char *path=br_path(keeper->directory,"stdout");
          int cleanup=path?0:ENOMEM;
          if(path && unlink(path) && errno!=ENOENT)cleanup=errno;
          free(path);
          if(cleanup)br_note(keeper,"cleanup-error",cleanup);
        }
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
static int br_observer_pid(int socket,pid_t *pid) {
#ifdef __APPLE__
  socklen_t length=sizeof(*pid);
  return getsockopt(socket,SOL_LOCAL,LOCAL_PEERPID,pid,&length)?errno:0;
#else
  struct {pid_t pid;uid_t uid;gid_t gid;} peer;
  socklen_t length=sizeof(peer);
  if(getsockopt(socket,SOL_SOCKET,SO_PEERCRED,&peer,&length))return errno;
  *pid=peer.pid;return 0;
#endif
}
static int br_control_command(BrKeeper *keeper,BrControl *control,BrFrame frame,const char *payload) {
  const char *end=memchr(payload,0,(size_t)frame.length);
  int error=0;
  if(!end || strcmp(payload,keeper->directory))error=EINVAL;
  else if(keeper->finishing)error=ESHUTDOWN;
  else if(keeper->monitor_only &&
          (frame.op==BR_CONTROL_WRITE || frame.op==BR_CONTROL_SIGNAL))error=EPERM;
  if(error) {br_control_reply(control,frame.serial,error);return 0;}
  size_t identity=(size_t)(end-payload)+1;
  if(frame.op==BR_ATTACH) {
    if(frame.length!=identity || frame.serial)error=EPROTO;
    else if(keeper->client>=0) {
      pid_t observer=0;
      /* A completed attempt can transfer the selected observer's connection. */
      if(frame.value>1 && frame.value<=INT_MAX && keeper->exited) {
        error=br_observer_pid(keeper->client,&observer);
        if(!error && observer==(pid_t)frame.value)br_detach_observer(keeper);
        else if(!error)error=EBUSY;
      } else error=EBUSY;
    }
    if(error) {
      control->reply=(BrFrame){.op=BR_HELLO,.error=error};control->answered=1;
    } else {
      keeper->client=control->socket;control->socket=-1;keeper->generation++;keeper->ready=0;
      BrState state={keeper->native_pid,keeper->exited,keeper->status,keeper->released,keeper->input_closed};
      return br_send(keeper,(BrFrame){.op=BR_HELLO,.length=sizeof(state),
        .value=keeper->monitor_only?(keeper->status_unavailable?4:5):keeper->native_pid?2:3},&state);
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
  if(keeper->native_life>=0)close(keeper->native_life);
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
/* Removes the per-attempt listener path only after acknowledgment has made the
   attempt terminal. The manifest's control path was verified before the owner
   started this keeper; an unacknowledged attempt keeps its socket and
   private directory for recovery. */
static void br_keeper_cleanup_control_path(BrKeeper *keeper) {
  if(!keeper || !br_exists(keeper->directory,"acknowledged"))return;
  const char *path=keeper->manifest.field[5];
  if(!path || !path[0])return;
  char *parent=strdup(path);
  if(!parent)return;
  char *slash=strrchr(parent,'/');
  if(!slash || slash==parent || strcmp(slash+1,"control")) {free(parent);return;}
  *slash=0;
  if(strncmp(parent,"/tmp/baton-retained-",20)) {free(parent);return;}
  struct stat directory_info,socket_info;
  if(lstat(parent,&directory_info) || !S_ISDIR(directory_info.st_mode) ||
     directory_info.st_uid!=geteuid() || (directory_info.st_mode&0777)!=0700) {
    free(parent);return;
  }
  int remove_parent=0;
  if(lstat(path,&socket_info)) {
    remove_parent=errno==ENOENT;
  } else if(S_ISSOCK(socket_info.st_mode) && socket_info.st_uid==geteuid()) {
    remove_parent=!unlink(path);
  }
  if(remove_parent && rmdir(parent) && errno!=ENOENT && errno!=ENOTEMPTY)
    br_note(keeper,"cleanup-error",errno);
  free(parent);
}
static int br_attempt_listener(const char *path,struct sockaddr_un *address) {
  int error=br_socket_address(address,path);
  if(error)return error;
  int listener=socket(AF_UNIX,SOCK_STREAM,0);
  if(listener<0)return errno;
  fcntl(listener,F_SETFD,FD_CLOEXEC);
  if(bind(listener,(struct sockaddr *)address,sizeof(*address))) {
    error=errno;
    if(error==EADDRINUSE) {
      struct stat info;
      if(lstat(path,&info))error=errno;
      else if(!S_ISSOCK(info.st_mode) || info.st_uid!=geteuid())error=EPERM;
      else {
        int probe=socket(AF_UNIX,SOCK_STREAM,0);
        if(probe<0)error=errno;
        else if(!connect(probe,(struct sockaddr *)address,sizeof(*address)))error=EBUSY;
        else if(errno==ECONNREFUSED || errno==ENOENT) {
          if(unlink(path))error=errno;
          else if(bind(listener,(struct sockaddr *)address,sizeof(*address)))error=errno;
          else error=0;
        } else error=errno;
        if(probe>=0)close(probe);
      }
    }
    if(error){close(listener);return error;}
  }
  if(listen(listener,SOMAXCONN)) {error=errno;close(listener);return error;}
  return listener;
}
/* Starts custody of one attempt. The native process, its stdin writer, its
   stdout spool and its wait authority stay in this process for the attempt's
   lifetime, so observer and coordinator loss leave them intact. */
static int br_keeper_prepare(BrKeeper *keeper,const char *directory,int lock) {
  int error=br_manifest_read(directory,&keeper->manifest);
  if(error)return error;
  if(keeper->manifest.count==8) {
    /* A prepared artifact is verified against its manifest before any child
       starts, so the file cannot be swapped between preparation and launch. */
    const char *name=keeper->manifest.field[6];
    size_t name_length=(size_t)keeper->manifest.header.lengths[6];
    unsigned char recorded[32],held[32];uint64_t held_length=0;
    if(keeper->manifest.header.lengths[7]!=sizeof(recorded))error=EINVAL;
    else memcpy(recorded,keeper->manifest.field[7],sizeof(recorded));
    if(!error)error=br_artifact_name_ok(name,name_length);
    if(!error)error=br_artifact_binding(directory,name,name_length,held,&held_length);
    if(!error && memcmp(held,recorded,sizeof(recorded)))error=EINVAL;
    if(error)return error;
  }
  if((error=br_attempt_manifest_verify(directory)))return error;
  if((error=br_admission_verify(directory,NULL,lock)))return error;
  if((error=br_lifecycle_prepare_check(directory)))return error;
  keeper->identity=br_manifest_digest(&keeper->manifest.header,keeper->manifest.field,keeper->manifest.count);
  if(lock>=0)fcntl(lock,F_SETFD,FD_CLOEXEC);
  struct sockaddr_un address;
  keeper->listener=br_attempt_listener(keeper->manifest.field[5],&address);
  if(keeper->listener<0)return errno;
  char *path=br_path(directory,"stdout");
  keeper->spool=path?open(path,O_CREAT|O_EXCL|O_RDWR|O_APPEND|O_CLOEXEC,0600):-1;
  if(keeper->spool<0 && path && errno==EEXIST) {
    keeper->spool=open(path,O_RDWR|O_APPEND|O_CLOEXEC|O_NOFOLLOW);
    if(keeper->spool>=0) {
      struct stat info;
      if(fstat(keeper->spool,&info))error=errno;
      else if(!S_ISREG(info.st_mode) || info.st_uid!=geteuid() || info.st_size!=0 ||
              (info.st_mode&0077))error=EPERM;
      if(error){close(keeper->spool);keeper->spool=-1;}
    }
  }
  if(keeper->spool<0){error=path?errno:ENOMEM;free(path);return error;}
  keeper->watch=br_watch_file(keeper->spool,path);free(path);
  if(keeper->watch<0)return errno;
  if((error=baton_pipe(keeper->wake)))return error;
  keeper->prepared=1;
  return 0;
}
static int br_keeper_spawn(BrKeeper *keeper,const unsigned char *expected_digest,
                           const unsigned char *grant_digest) {
  if(!keeper->prepared || keeper->cancelled)return EPERM;
  int error=0;
  /* The one start of this task is latched durably before its program exists, so a
     repeated start decision never spawns a second child: an already latched start
     keeps the work it retained and this keeper reports it rather than spawning. */
  int retained=0;
  if((error=br_lifecycle_start(keeper->directory,expected_digest,grant_digest,&retained)))return error;
  if(retained)return keeper->native_pid?0:EPERM;
  if(keeper->native_pid)return EPERM;
  if((error=br_file(keeper->directory,"launch","launch\n",7,1)))return error;
  int input[2];if((error=baton_pipe(input)))return error;
  int log=open(keeper->manifest.field[2],O_WRONLY|O_CREAT|O_APPEND|O_CLOEXEC,0600);
  char **argv=br_argv(keeper->manifest.field[0],(size_t)keeper->manifest.header.lengths[0]);
  if(log<0 || !argv)error=log<0?errno:ENOMEM;
  else error=br_spawn(&keeper->native_pid,argv,keeper->manifest.field[1],input[0],keeper->spool,log,-1,-1);
  free(argv);if(log>=0)close(log);close(input[0]);
  if(error){close(input[1]);return error;}
  keeper->input=input[1];br_nonblock(keeper->input);
  char pid[64];int n=snprintf(pid,sizeof(pid),"%d\n",keeper->native_pid);
  if((error=br_file(keeper->directory,"native.pid",pid,(size_t)n,1)))return error;
  BrBirth birth;if((error=br_birth(keeper->native_pid,&birth)))return error;
  if((error=br_file(keeper->directory,"native.birth",&birth,sizeof(birth),1)))return error;
  if((error=br_wait_start(keeper,keeper->native_pid,'N')))return error;
  if((error=br_queue(&keeper->writes,&keeper->writes_tail,keeper->manifest.field[3],
                    (size_t)keeper->manifest.header.lengths[3],0,0,0)))return error;
  if(!keeper->manifest.header.keep_stdin) {
    if((error=br_queue(&keeper->writes,&keeper->writes_tail,NULL,0,0,0,1)))return error;
    keeper->input_closed=1;
  }
  return 0;
}
static int br_keeper_start(BrKeeper *keeper,const char *directory,int lock) {
  int error=br_keeper_prepare(keeper,directory,lock);
  if(error)return error;
  if((error=br_lifecycle_ready(directory)))return error;
  keeper->ready=1;
  return br_keeper_spawn(keeper,NULL,NULL);
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
    } else if(event.kind=='R') {
      /* Recovery waiters belong to this keeper attempt, not an observer
         generation. A replacement observer must not strand their counts. */
      if(keeper->recovery_pending)keeper->recovery_pending--;
      if(event.status<0) {
        br_note(keeper,"observer-error",ECHILD);
      } else if(keeper->client<0 && !(WIFEXITED(event.status) && WEXITSTATUS(event.status)==0)) {
        char text[96];int n=snprintf(text,sizeof(text),"pid %d exited before attach: wait status %d\n",event.pid,event.status);
        br_file(keeper->directory,"observer-error",text,(size_t)n,0);
      }
    }
  }
  if(keeper->monitor_only && keeper->native_life>=0 &&
     fds[5].revents&(POLLIN|POLLHUP|POLLERR)) {
    close(keeper->native_life);keeper->native_life=-1;
    keeper->status_unavailable=1;keeper->exited=1;keeper->input_closed=1;
    if(keeper->client>=0 && (error=br_send(keeper,(BrFrame){.op=BR_UNKNOWN},NULL)))return error;
  }
  for(size_t i=0;i<count;i++) if(fds[6+i].revents&(POLLIN|POLLHUP|POLLERR)) {
    if((error=br_control_read(keeper,clients[i])))return error;
  }
  return 0;
}

/* The per-user IPC directory is the one place lock, socket, record and custody
   epoch live. It is fixed for the user, so unrelated client configurations elect
   one owner, and it is validated before use: a symlink, another user's
   directory or a world-readable directory is refused. */
static int br_ipc_prepare(const char *path) {
  struct stat info;
  if(lstat(path,&info)==0) {
    if(!S_ISDIR(info.st_mode))return EINVAL;
    if(info.st_uid!=geteuid())return EPERM;
    if(info.st_mode&0077 && chmod(path,0700))return errno;
    return 0;
  }
  if(errno!=ENOENT)return errno;
  char *copy=strdup(path);
  if(!copy)return ENOMEM;
  for(char *at=copy+1;*at;at++) {
    if(*at!='/')continue;
    *at=0;
    /* Intermediate components belong to the system, so an existing one is
       accepted as it is; only the directory this call creates is validated. */
    if(mkdir(copy,0700) && errno!=EEXIST) {int error=errno;free(copy);return error;}
    *at='/';
  }
  int error=mkdir(copy,0700)&&errno!=EEXIST?errno:0;
  if(!error) {
    if(lstat(copy,&info))error=errno;
    else if(!S_ISDIR(info.st_mode) || info.st_uid!=geteuid())error=EPERM;
    else if((info.st_mode&0077) && chmod(copy,0700))error=errno;
  }
  free(copy);
  return error;
}
static int br_ipc_directory(char **directory_out) {
  const char *runtime=getenv("XDG_RUNTIME_DIR"),*home=getenv("HOME");
  *directory_out=NULL;
  if(runtime && runtime[0]) {
    char *directory=br_path(runtime,"baton2");
    if(!directory)return ENOMEM;
    int error=br_ipc_prepare(directory);
    if(!error){*directory_out=directory;return 0;}
    free(directory);
  }
  int fallback_length=snprintf(NULL,0,"/tmp/baton2-%u",(unsigned)geteuid());
  if(fallback_length<0)return EOVERFLOW;
  char *fallback=malloc((size_t)fallback_length+1);
  if(!fallback)return ENOMEM;
  snprintf(fallback,(size_t)fallback_length+1,"/tmp/baton2-%u",(unsigned)geteuid());
  int fallback_error=br_ipc_prepare(fallback);
  if(!fallback_error){*directory_out=fallback;return 0;}
  free(fallback);
  if(home && home[0]) {
    char *state=br_path(home,".local/state/baton2");
    if(!state)return ENOMEM;
    int error=br_ipc_prepare(state);
    if(!error){*directory_out=state;return 0;}
    free(state);
  }
  return fallback_error?fallback_error:EACCES;
}
/* The election key is the physical database identity, so a hard link or a
   symlink alias elects the same owner. */
static char *br_owner_key(uint64_t device,uint64_t inode) {
  char *key=malloc(48);
  if(key)snprintf(key,48,"owner-%llx-%llx",(unsigned long long)device,(unsigned long long)inode);
  return key;
}
static char *br_ipc_path(const char *directory,const char *key,const char *suffix) {
  size_t a=strlen(directory),b=strlen(key),c=strlen(suffix);
  char *path=malloc(a+b+c+3);
  if(path)snprintf(path,a+b+c+3,"%s/%s%s",directory,key,suffix);
  return path;
}
static int br_owner_socket_copy(char *destination,size_t capacity,const char *path) {
  size_t length=strlen(path);
  if(length>=capacity)return ENAMETOOLONG;
  memcpy(destination,path,length+1);
  return 0;
}
/* Replacing a record or the epoch writes a temporary file, syncs it, renames it
   over the target and syncs the directory, so a reader never sees a torn
   record. The observation checkpoint passes flush=0: it is a resume hint, and a
   lost update only means an observer reads a little more of the stream again. */
static int br_replace(const char *directory,const char *path,const void *data,size_t length,int flush) {
  char *temporary=malloc(strlen(path)+24);
  if(!temporary)return ENOMEM;
  sprintf(temporary,"%s.tmp-%d",path,(int)getpid());
  int fd=open(temporary,O_WRONLY|O_CREAT|O_TRUNC|O_CLOEXEC,0600);
  int error=fd<0?errno:0;
  if(!error) {
    error=br_write_all(fd,data,length);
    if(!error && flush && fsync(fd))error=errno;
    close(fd);
  }
  if(!error && rename(temporary,path))error=errno;
  if(error)unlink(temporary);
  free(temporary);
  if(flush) {
    int dirfd=open(directory,O_RDONLY|O_CLOEXEC);
    if(dirfd>=0){if(!error && fsync(dirfd))error=errno;close(dirfd);}
  }
  return error;
}
static int br_entropy(uint64_t *value) {
  int fd=open("/dev/urandom",O_RDONLY|O_CLOEXEC);
  if(fd<0)return errno;
  int error=br_read_all(fd,value,sizeof(*value));
  close(fd);return error;
}
/* The native custody epoch increases across owner incarnations and is a
   persistent counter in the IPC directory, never a value derived from a table
   that can be emptied. */
static int br_epoch_next(const char *directory,const char *path,uint64_t *epoch) {
  uint64_t previous=0;
  int fd=open(path,O_RDONLY|O_CLOEXEC);
  if(fd>=0) {
    char text[32];ssize_t n=read(fd,text,sizeof(text)-1);
    close(fd);
    if(n>0){text[n]=0;previous=strtoull(text,NULL,10);}
  }
  uint64_t next=previous+1;
  if(next<=previous)next=1;
  char text[32];
  int written=snprintf(text,sizeof(text),"%llu\n",(unsigned long long)next);
  int error=br_replace(directory,path,text,(size_t)written,1);
  if(!error)*epoch=next;
  return error;
}
static int br_owner_record_write(BrOwner *owner) {
  BrOwnerRecord record={.token=owner->token,.epoch=owner->epoch,.device=owner->device,
    .inode=owner->inode,.pid=(int32_t)getpid()};
  int error=br_owner_socket_copy(record.socket,sizeof(record.socket),owner->socket_path);
  if(error)return error;
  return br_replace(owner->ipc,owner->record_path,&record,sizeof(record),1);
}
static int br_owner_record_read(const char *ipc,const char *record_path,BrOwnerRecord *record) {
  int fd=open(record_path,O_RDONLY|O_CLOEXEC);
  if(fd<0)return errno;
  int error=br_read_all(fd,record,sizeof(*record));
  struct stat info;
  if(!error && (fstat(fd,&info) || info.st_size!=(off_t)sizeof(*record)))error=EINVAL;
  close(fd);
  if(!error && !record->socket[0])error=EINVAL;
  (void)ipc;
  return error;
}
/* The checksum covers every field of the record except itself, and every byte of
   the state, so a corruption of equal length is refused as well. */
static uint64_t br_checkpoint_check(const BrCheckpoint *checkpoint,const char *state,size_t length) {
  uint64_t digest=0xcbf29ce484222325ULL;
  const unsigned char *bytes=(const unsigned char *)checkpoint;
  for(size_t i=0;i<offsetof(BrCheckpoint,check);i++) {digest^=bytes[i];digest*=0x100000001b3ULL;}
  for(size_t i=offsetof(BrCheckpoint,check)+sizeof(uint64_t);i<sizeof(*checkpoint);i++) {
    digest^=bytes[i];digest*=0x100000001b3ULL;
  }
  for(size_t i=0;i<length;i++) {digest^=(unsigned char)state[i];digest*=0x100000001b3ULL;}
  return digest;
}
static char *br_checkpoint_path(const char *directory) {
  return br_path(directory,"checkpoint");
}
/* The offset recorded in the checkpoint, for a caller that only needs the
   reference. Malformed or absent records report zero. */
static int br_checkpoint_offset(const char *directory,uint64_t *offset) {
  *offset=0;
  char *path=br_checkpoint_path(directory);
  if(!path)return ENOMEM;
  int fd=open(path,O_RDONLY|O_CLOEXEC);
  if(fd<0){int error=errno;free(path);return error==ENOENT?0:error;}
  BrCheckpoint checkpoint;
  int error=br_read_all(fd,&checkpoint,sizeof(checkpoint));
  close(fd);free(path);
  if(error)return 0;
  if(memcmp(checkpoint.magic,BR_CHECKPOINT_MAGIC,8))return 0;
  *offset=checkpoint.offset;
  return 0;
}
/* The recorded offset only when the whole record verifies against this attempt's
   custody: structure, checksum over header and state bytes, attempt identity,
   native birth, manifest, spool identity and offset bounds. The caller's schema
   is not required to validate an offset, so it is not compared here. */
static int br_checkpoint_verified_offset(const char *directory,int spool_fd,uint64_t *offset) {
  *offset=0;
  char *path=br_checkpoint_path(directory);
  if(!path)return ENOMEM;
  int fd=open(path,O_RDONLY|O_CLOEXEC);
  if(fd<0){int error=errno;free(path);return error==ENOENT?ENOENT:error;}
  BrCheckpoint checkpoint,stored;
  int error=br_read_all(fd,&stored,sizeof(stored));
  if(error==EPIPE)error=EINVAL;
  struct stat info;
  if(!error && fstat(fd,&info))error=errno;
  if(!error && memcmp(stored.magic,BR_CHECKPOINT_MAGIC,8))error=EINVAL;
  if(!error && info.st_size<0)error=EINVAL;
  if(!error && stored.length>SIZE_MAX-sizeof(stored))error=EOVERFLOW;
  if(!error && (uint64_t)info.st_size!=(uint64_t)sizeof(stored)+stored.length)error=EINVAL;
  BrBirth birth;uint64_t manifest,spool_device,spool_inode;
  if(!error)error=br_checkpoint_custody(directory,spool_fd,&birth,&manifest,&spool_device,&spool_inode);
  if(!error && (stored.birth.pid!=birth.pid || stored.birth.first!=birth.first ||
                stored.birth.second!=birth.second))error=EINVAL;
  if(!error && (stored.manifest!=manifest || stored.attempt!=br_attempt_identity(directory)))error=EINVAL;
  if(!error && (stored.spool_device!=spool_device || stored.spool_inode!=spool_inode))error=EINVAL;
  if(!error && fstat(spool_fd,&info))error=errno;
  if(!error && stored.offset>(uint64_t)info.st_size)error=EINVAL;
  char *state=NULL;
  if(!error && stored.length) {
    state=malloc((size_t)stored.length+1);
    if(!state)error=ENOMEM;
    else if((error=br_read_all(fd,state,(size_t)stored.length))) {free(state);state=NULL;if(error==EPIPE)error=EINVAL;}
    else state[stored.length]=0;
  }
  checkpoint=stored;
  if(!error && checkpoint.check!=br_checkpoint_check(&checkpoint,state?state:"",(size_t)checkpoint.length))
    error=EINVAL;
  free(state);close(fd);free(path);
  if(error)return error;
  *offset=stored.offset;
  return 0;
}
 /* The durable attempt identity: a digest of the attempt's canonical directory.
   An owner-local attempt number is not durable across an owner restart, so the
   checkpoint binds this value instead. */
static uint64_t br_attempt_identity(const char *directory) {
  char *canonical=realpath(directory,NULL);
  const char *text=canonical?canonical:directory;
  uint64_t digest=0xcbf29ce484222325ULL;
  for(const unsigned char *at=(const unsigned char *)text;*at;at++) {digest^=*at;digest*=0x100000001b3ULL;}
  free(canonical);
  return digest;
}
/* The custody identity a checkpoint is bound to: the native process, the admitted
   manifest, and the stdout spool file. All three survive an owner restart. */
static int br_checkpoint_custody(const char *directory,int spool_fd,BrBirth *birth,
                                 uint64_t *manifest,uint64_t *spool_device,uint64_t *spool_inode) {
  int error=br_read_file(directory,"native.birth",birth,sizeof(*birth));
  if(!error)error=br_manifest_digest_file(directory,manifest);
  struct stat info;
  if(!error && (fstat(spool_fd,&info) || !S_ISREG(info.st_mode)))error=errno?errno:EINVAL;
  if(!error) {*spool_device=(uint64_t)info.st_dev;*spool_inode=(uint64_t)info.st_ino;}
  return error;
}
static int br_checkpoint_store(const char *directory,int spool_fd,uint32_t schema,
                               uint64_t incarnation,uint64_t offset,const char *state,size_t length) {
  if(length>SIZE_MAX-sizeof(BrCheckpoint))return EOVERFLOW;
  BrBirth birth;uint64_t manifest,spool_device,spool_inode;
  int error=br_checkpoint_custody(directory,spool_fd,&birth,&manifest,&spool_device,&spool_inode);
  if(error)return error;
  char *path=br_checkpoint_path(directory);
  if(!path)return ENOMEM;
  size_t total=sizeof(BrCheckpoint)+length;
  char *record=malloc(total);
  error=record?0:ENOMEM;
  if(!error) {
    BrCheckpoint checkpoint={.schema=schema,.incarnation=incarnation,
      .attempt=br_attempt_identity(directory),.manifest=manifest,
      .spool_device=spool_device,.spool_inode=spool_inode,
      .offset=offset,.length=length,.birth=birth};
    memcpy(checkpoint.magic,BR_CHECKPOINT_MAGIC,8);
    checkpoint.check=br_checkpoint_check(&checkpoint,state,length);
    memcpy(record,&checkpoint,sizeof(checkpoint));
    if(length)memcpy(record+sizeof(checkpoint),state,length);
    error=br_replace(directory,path,record,total,1);
  }
  free(record);free(path);
  return error;
}
/* Loads the checkpoint of one attempt. Every binding is validated: schema,
   attempt, native process, admitted manifest, spool file identity, offset within
   the current spool, the checksum over the whole record and the state bytes, and
   the state length before any allocation. A stale, mismatched or corrupt record
   is EINVAL so the caller replays from the beginning; the caller writes the
   durable diagnostic. */
static int br_checkpoint_load(const char *directory,int spool_fd,uint32_t schema,
                              uint64_t *offset,char **state,size_t *length) {
  *offset=0;*state=NULL;*length=0;
  char *path=br_checkpoint_path(directory);
  if(!path)return ENOMEM;
  int fd=open(path,O_RDONLY|O_CLOEXEC);
  if(fd<0){int error=errno;free(path);return error==ENOENT?0:error;}
  BrCheckpoint checkpoint;
  int error=br_read_all(fd,&checkpoint,sizeof(checkpoint));
  /* A record shorter than its header is a torn write, which is corruption and
     not a transport failure: it must reach the replay path. */
  if(error==EPIPE)error=EINVAL;
  struct stat info;
  if(!error && fstat(fd,&info))error=errno;
  if(!error && memcmp(checkpoint.magic,BR_CHECKPOINT_MAGIC,8))error=EINVAL;
  if(!error && checkpoint.schema!=schema)error=EINVAL;
  if(!error && checkpoint.attempt!=br_attempt_identity(directory))error=EINVAL;
  if(!error && info.st_size<0)error=EINVAL;
  if(!error && checkpoint.length>SIZE_MAX-sizeof(checkpoint))error=EOVERFLOW;
  if(!error && (uint64_t)info.st_size!=(uint64_t)sizeof(checkpoint)+checkpoint.length)error=EINVAL;
  BrBirth birth;uint64_t manifest,spool_device,spool_inode;
  if(!error)error=br_checkpoint_custody(directory,spool_fd,&birth,&manifest,&spool_device,&spool_inode);
  if(!error && (checkpoint.birth.pid!=birth.pid || checkpoint.birth.first!=birth.first ||
                checkpoint.birth.second!=birth.second))error=EINVAL;
  if(!error && checkpoint.manifest!=manifest)error=EINVAL;
  if(!error && (checkpoint.spool_device!=spool_device || checkpoint.spool_inode!=spool_inode))error=EINVAL;
  if(!error && fstat(spool_fd,&info))error=errno;
  if(!error && (checkpoint.offset>(uint64_t)info.st_size))error=EINVAL;
  char *buffer=NULL;
  if(!error && checkpoint.length) {
    buffer=malloc((size_t)checkpoint.length+1);
    if(!buffer)error=ENOMEM;
    else if((error=br_read_all(fd,buffer,(size_t)checkpoint.length))) {
      free(buffer);buffer=NULL;
      if(error==EPIPE)error=EINVAL;
    }
    else buffer[checkpoint.length]=0;
  }
  if(!error && checkpoint.check!=br_checkpoint_check(&checkpoint,buffer?buffer:"",(size_t)checkpoint.length))
    error=EINVAL;
  close(fd);free(path);
  if(error){free(buffer);return error;}
  *offset=checkpoint.offset;*state=buffer;*length=(size_t)checkpoint.length;
  return 0;
}
/* The admission identity of an attempt: a digest of the manifest fields that
   describe the native work. It excludes the attempt's control socket pathname,
   which changes on every preparation, so a repeated admission of the same work
   resolves the attempt that already exists and a repeated admission of different
   work is refused. */
static uint64_t br_digest_mix(uint64_t digest,const void *data,size_t length) {
  const unsigned char *bytes=data;
  for(size_t i=0;i<length;i++) {digest^=bytes[i];digest*=0x100000001b3ULL;}
  return digest;
}
static uint64_t br_manifest_digest(const BrManifestHeader *header,char *const *fields,int count) {
  uint64_t digest=0xcbf29ce484222325ULL;
  for(int i=0;i<count;i++) {
    if(i==5)continue;
    uint64_t length=header->lengths[i];
    digest=br_digest_mix(digest,&length,sizeof(length));
    digest=br_digest_mix(digest,fields[i],(size_t)length);
  }
  uint32_t keep=header->keep_stdin;
  digest=br_digest_mix(digest,&keep,sizeof(keep));
  /* Preserve legacy manifest identities, including the historical reserved word. */
  return header->reserved?br_digest_mix(digest,&header->reserved,sizeof(header->reserved)):digest;
}
static int br_manifest_digest_file(const char *directory,uint64_t *digest) {
  BrManifest manifest={0};
  int error=br_manifest_read(directory,&manifest);
  if(!error)*digest=br_manifest_digest(&manifest.header,manifest.field,manifest.count);
  br_manifest_free(&manifest);
  return error;
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
   bound database identity is rechecked against the held descriptor and against
   the pathname, so a replaced file is never adopted; the attempt directory must
   live in the database's own directory, so an alias pathname works and an
   unrelated directory does not. An existing attempt record refuses a second
   native child for the same attempt. */
static int br_owner_admit(BrOwner *owner,const char *directory,int lock,int *existing,int start_now) {
  int error=0;
  char *resolved=NULL;
  struct stat info;
  *existing=0;
  if(fstat(owner->database_fd,&info))error=errno;
  else if((uint64_t)info.st_dev!=owner->device || (uint64_t)info.st_ino!=owner->inode)error=ESTALE;
  else if(stat(owner->database,&info))error=errno;
  else if((uint64_t)info.st_dev!=owner->device || (uint64_t)info.st_ino!=owner->inode)error=ESTALE;
  else {
    char *parent=strdup(directory);
    if(!parent)error=ENOMEM;
    else {
      char *slash=strrchr(parent,'/');
      if(!slash)error=EINVAL;
      else {
        *slash=0;
        if(stat(parent,&info))error=errno;
        else if((uint64_t)info.st_dev!=owner->parent_device ||
                (uint64_t)info.st_ino!=owner->parent_inode)error=EINVAL;
      }
      free(parent);
    }
  }
  if(!error) {
    resolved=realpath(directory,NULL);
    if(!resolved)error=errno;
  }
  if(!error) {
    BrKeeper *held=br_owner_find(owner,resolved);
    if(held) {
      /* The same admission identity resolves the attempt that already owns the
         work. The comparison is exact, field by field: a short digest is not the
         identity. A different manifest for the same directory is conflicting
         reuse and is refused. */
      BrManifest stored={0};
      error=br_manifest_read(resolved,&stored);
      if(!error && (stored.count!=held->manifest.count ||
                    stored.header.keep_stdin!=held->manifest.header.keep_stdin))error=EEXIST;
      for(int i=0;!error && i<stored.count;i++)
        if(stored.header.lengths[i]!=held->manifest.header.lengths[i] ||
           memcmp(stored.field[i],held->manifest.field[i],(size_t)stored.header.lengths[i]))error=EEXIST;
      br_manifest_free(&stored);
      if(!error)*existing=1;
    }
  }
  if(!error && !*existing) {
    BrKeeper *keeper=calloc(1,sizeof(*keeper));
    if(!keeper)error=ENOMEM;
    else {
      *keeper=(BrKeeper){.listener=-1,.client=-1,.input=-1,.lock=lock,.watch=-1,
        .wake={-1,-1},.spool=-1,.native_life=-1,.generation=1,.id=++owner->next_id};
      keeper->directory=resolved;resolved=NULL;
      error=start_now?br_keeper_start(keeper,directory,lock):br_keeper_prepare(keeper,directory,lock);
      if(error) {lock=-1;br_keeper_stop(keeper);}
      else {keeper->next=owner->attempts;owner->attempts=keeper;return 0;}
    }
  }
  free(resolved);
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
  /* A subscribed connection is this database's notice channel: it stays open
     after its readiness reply and receives one notice per committed change. */
  if(control->subscribe) {control->answered=0;control->sent=0;control->reply_length=0;return;}
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
   the attempt's own socket, so this connection stays short-lived. Every reply
   carries the owner token and the native custody epoch, so a client refuses a
   socket left behind by an earlier owner incarnation. */
/* Fills the job facts a caller addresses an attempt by: the retained output
   extent, the committed checkpoint offset, the terminal status when it is
   recorded, and whether an observer holds the attempt. */
static void br_owner_state(BrOwner *owner,BrKeeper *keeper,BrOwnerState *state) {
  *state=(BrOwnerState){.owner=owner->token,.epoch=owner->epoch,
    .attempts=br_owner_attempts(owner)};
  if(!keeper)return;
  state->attempt=keeper->id;state->generation=keeper->generation;
  state->observing=(uint32_t)(keeper->client>=0);
  char *spool=br_path(keeper->directory,"stdout");
  struct stat info;
  if(spool && !stat(spool,&info))state->spool_bytes=(uint64_t)info.st_size;
  free(spool);
  uint64_t offset=0;
  if(!br_checkpoint_offset(keeper->directory,&offset))state->checkpoint_offset=offset;
  char *status=br_path(keeper->directory,"status");
  FILE *file=status?fopen(status,"r"):NULL;
  if(file) {
    int value=0;
    if(fscanf(file,"%d",&value)==1) {state->status=value;state->status_known=1;}
    fclose(file);
  }
  free(status);
}
/* The committed-change cursor is durable across owner incarnations, so a
   replacement owner never reports a high-water below the one its predecessor
   published. */
static void br_owner_cursor_load(BrOwner *owner) {
  FILE *file=owner->cursor_path?fopen(owner->cursor_path,"r"):NULL;
  if(!file)return;
  unsigned long long value=0;
  if(fscanf(file,"%llu",&value)==1)owner->cursor=(uint64_t)value;
  fclose(file);
}
static void br_owner_cursor_store(BrOwner *owner) {
  if(!owner->cursor_path)return;
  char text[32];
  int length=snprintf(text,sizeof(text),"%llu\n",(unsigned long long)owner->cursor);
  int fd=open(owner->cursor_path,O_WRONLY|O_CREAT|O_TRUNC|O_CLOEXEC,0600);
  if(fd<0)return;
  if(!br_write_all(fd,text,(size_t)length))fsync(fd);
  close(fd);
}
/* Sends one notice per subscriber whose cursor the publication advanced. The
   notice payload is the cursor alone, so a notice still in flight is replaced by
   the newer one instead of queued: the subscriber rereads rows up to the cursor
   it is told, and a notice is never lost to a busy socket. */
static void br_owner_notify(BrOwner *owner,int kind) {
  BrInstanceNotice notice={.cursor=owner->cursor,.kind=(uint32_t)kind};
  BrInstanceFrame frame={.op=BI_NOTICE,.owner=owner->token,.epoch=owner->epoch,
    .length=sizeof(notice)};
  for(BrOwnerControl *subscriber=owner->controls;subscriber;subscriber=subscriber->next) {
    if(!subscriber->subscribe || subscriber->socket<0)continue;
    if(subscriber->after_cursor==owner->cursor)continue;
    subscriber->after_cursor=owner->cursor;
    if(subscriber->sent<subscriber->reply_length) {
      BrInstanceFrame pending;
      memcpy(&pending,subscriber->reply,sizeof(pending));
      if(pending.op==BI_NOTICE && pending.length==sizeof(notice))
        memcpy(subscriber->reply+sizeof(pending),&notice,sizeof(notice));
      continue;
    }
    br_owner_reply(subscriber,frame,&notice);
  }
}
static int br_owner_command(BrOwner *owner,BrOwnerControl *control,BrInstanceFrame frame) {
  const char *payload=control->incoming+sizeof(frame);
  if((frame.owner && frame.owner!=owner->token) || (frame.epoch && frame.epoch!=owner->epoch))
    return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.owner=owner->token,
      .epoch=owner->epoch,.error=ESTALE},NULL);
  if(frame.op==BI_ENSURE || frame.op==BI_STATE) {
    if(frame.length)return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.error=EPROTO},NULL);
    BrOwnerState state;
    br_owner_state(owner,NULL,&state);
    return br_owner_reply(control,(BrInstanceFrame){.op=BI_HELLO,.owner=owner->token,
      .epoch=owner->epoch,.length=sizeof(state)},&state);
  }
  if(frame.op==BI_SHUTDOWN) {
    if(frame.length)return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.error=EPROTO},NULL);
    owner->finishing=1;
    return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.owner=owner->token,.epoch=owner->epoch},NULL);
  }
  if(frame.op==BI_ADMIT || frame.op==BI_PREPARE) {
    if(frame.length<2 || payload[frame.length-1])
      return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.error=EINVAL},NULL);
    int existing=0;
    int error=br_owner_admit(owner,payload,control->rights,&existing,frame.op==BI_ADMIT);
    control->rights=-1;
    if(error)return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.owner=owner->token,
      .epoch=owner->epoch,.error=error},NULL);
    BrKeeper *keeper=br_owner_find(owner,payload);
    BrOwnerState state;
    br_owner_state(owner,keeper,&state);
    return br_owner_reply(control,(BrInstanceFrame){.op=BI_HELLO,.owner=owner->token,
      .epoch=owner->epoch,.attempt=keeper?keeper->id:0,
      .generation=keeper?keeper->generation:0,.state=(uint32_t)(existing?1:0),
      .length=sizeof(state)},&state);
  }
  if(frame.op==BI_START || frame.op==BI_CANCEL) {
    size_t path_length=strnlen(payload,(size_t)frame.length);
    if(path_length+1+64!=(size_t)frame.length)
      return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.owner=owner->token,
        .epoch=owner->epoch,.error=EPROTO},NULL);
    char *path=strndup(payload,path_length);
    if(!path)return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.owner=owner->token,
      .epoch=owner->epoch,.error=ENOMEM},NULL);
    char *resolved=realpath(path,NULL);int error=resolved?0:errno;
    BrKeeper *keeper=NULL;
    if(!error)keeper=br_owner_find(owner,resolved);
    if(!error && !keeper)error=ENOENT;
    if(!error && keeper->monitor_only)error=EPERM;
    if(!error && (!keeper->prepared || !keeper->ready ||
       (keeper->cancelled && frame.op!=BI_CANCEL)))error=EPERM;
    if(!error && frame.op==BI_START) {
      const unsigned char *decision=(const unsigned char *)payload+path_length+1;
      error=br_keeper_spawn(keeper,decision,decision+32);
    } else if(!error) {
      const unsigned char *decision=(const unsigned char *)payload+path_length+1;
      error=br_lifecycle_cancel(resolved,decision,decision+32);
      if(!error) {
        keeper->cancelled=1;
        if(keeper->lock>=0) {close(keeper->lock);keeper->lock=-1;}
        error=br_send(keeper,(BrFrame){.op=BR_CANCELLED},NULL);
      }
    }
    BrOwnerState state;
    if(!error)br_owner_state(owner,keeper,&state);
    free(resolved);free(path);
    if(error)return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.owner=owner->token,
      .epoch=owner->epoch,.error=error},NULL);
    return br_owner_reply(control,(BrInstanceFrame){.op=BI_HELLO,.owner=owner->token,
      .epoch=owner->epoch,.attempt=keeper->id,.generation=keeper->generation,
      .length=sizeof(state)},&state);
  }
  if(frame.op==BI_RECOVER) {
    if(frame.length<sizeof(BrRecoveryRequest))
      return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.owner=owner->token,
        .epoch=owner->epoch,.error=EPROTO},NULL);
    BrRecoveryRequest request;memcpy(&request,payload,sizeof(request));
    uint64_t total=sizeof(request)+(uint64_t)request.directory_length+
      (uint64_t)request.bootstrap_length+(uint64_t)request.witness_length;
    if(!request.directory_length || !request.bootstrap_length || !request.witness_length ||
       total!=frame.length || request.reserved) return br_owner_reply(control,
        (BrInstanceFrame){.op=BI_REPLY,.owner=owner->token,.epoch=owner->epoch,.error=EPROTO},NULL);
    const char *directory=payload+sizeof(request);
    const char *bootstrap=directory+request.directory_length;
    const char *witness=bootstrap+request.bootstrap_length;
    if(directory[request.directory_length-1] || bootstrap[request.bootstrap_length-1] ||
       witness[request.witness_length-1]) return br_owner_reply(control,
        (BrInstanceFrame){.op=BI_REPLY,.owner=owner->token,.epoch=owner->epoch,.error=EINVAL},NULL);
    BrKeeper *keeper=NULL;
    int error=br_owner_recover(owner,directory,bootstrap,witness,&keeper);
    if(error)return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.owner=owner->token,
      .epoch=owner->epoch,.error=error},NULL);
    BrOwnerState state;br_owner_state(owner,keeper,&state);
    return br_owner_reply(control,(BrInstanceFrame){.op=BI_HELLO,.owner=owner->token,
      .epoch=owner->epoch,.attempt=keeper->id,.generation=keeper->generation,
      .state=keeper->monitor_only?2u:1u,.length=sizeof(state)},&state);
  }
  if(frame.op==BI_ATTACH) {
    /* Resolves the attempt that already owns this directory, so an attaching
       observer binds the same attempt identity the admitting client recorded,
       and a caller that cannot observe still receives the retained job facts. */
    if(frame.length<2 || payload[frame.length-1])
      return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.error=EINVAL},NULL);
    char *resolved=realpath(payload,NULL);
    int error=resolved?0:errno;
    BrKeeper *held=NULL;
    if(!error) {
      held=br_owner_find(owner,resolved);
      if(!held)error=ENOENT;
      free(resolved);
    }
    if(error)return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.owner=owner->token,
      .epoch=owner->epoch,.error=error},NULL);
    BrOwnerState state;
    br_owner_state(owner,held,&state);
    return br_owner_reply(control,(BrInstanceFrame){.op=BI_HELLO,.owner=owner->token,
      .epoch=owner->epoch,.attempt=held->id,.generation=held->generation,.state=1,
      .length=sizeof(state)},&state);
  }
  if(frame.op==BI_SUBSCRIBE) {
    if(frame.length!=sizeof(BrInstanceSubscribe))
      return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.owner=owner->token,
        .epoch=owner->epoch,.error=EPROTO},NULL);
    BrInstanceSubscribe request;
    memcpy(&request,payload,sizeof(request));
    /* A subscription opened against another owner incarnation cannot be served
       continuously: commits written while that owner was gone were never
       forwarded, and a cursor ahead of this owner's record cannot be resumed
       here. Both report the gap so the subscriber takes a fresh snapshot, and the
       ready cursor states the high-water it may replay rows up to either way. */
    BrInstanceReady ready={.generation=owner->epoch,.cursor=owner->cursor,
      .gap=(uint32_t)(request.generation!=owner->epoch || request.after_cursor>owner->cursor)};
    control->subscribe=1;
    control->after_cursor=request.after_cursor;
    return br_owner_reply(control,(BrInstanceFrame){.op=BI_READY,.owner=owner->token,
      .epoch=owner->epoch,.generation=owner->epoch,.length=sizeof(ready)},&ready);
  }
  if(frame.op==BI_COMMIT) {
    if(frame.length!=sizeof(BrInstanceCommit))
      return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.owner=owner->token,
        .epoch=owner->epoch,.error=EPROTO},NULL);
    BrInstanceCommit commit;
    memcpy(&commit,payload,sizeof(commit));
    /* Concurrent writers can publish their committed cursors out of order.
       The owner retains the highest published cursor. */
    if(commit.cursor>owner->cursor) {
      owner->cursor=commit.cursor;
      br_owner_cursor_store(owner);
      br_owner_notify(owner,BN_COMMIT);
    }
    BrInstanceReady ready={.generation=owner->epoch,.cursor=owner->cursor};
    return br_owner_reply(control,(BrInstanceFrame){.op=BI_REPLY,.owner=owner->token,
      .epoch=owner->epoch,.length=sizeof(ready)},&ready);
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
      if(keeper->unwatched_recovery && (error=br_recovery_reap_unwatched(keeper))) {
        br_note(keeper,"observer-error",error);error=0;
      }
      if(keeper->finishing && !keeper->outgoing && !keeper->recovery_pending) {
        *link=keeper->next;
        if(owner->single)owner->finishing=1;
        else {br_keeper_cleanup_control_path(keeper);br_keeper_stop(keeper);}
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
    size_t head=owner->listener>=0?1:0,total=head+owner_controls+slots*6+attempt_controls;
    struct pollfd *fds=calloc(total?total:1,sizeof(*fds));
    BrOwnerControl **owner_clients=calloc(owner_controls?owner_controls:1,sizeof(*owner_clients));
    BrKeeper **keepers=calloc(slots?slots:1,sizeof(*keepers));
    BrControl **clients=calloc(attempt_controls?attempt_controls:1,sizeof(*clients));
    size_t *bases=calloc(slots?slots:1,sizeof(*bases));
    size_t *apart=calloc(slots+1,sizeof(*apart));
    if(!fds || !owner_clients || !keepers || !clients || !bases || !apart) {
      free(fds);free(owner_clients);free(keepers);free(clients);free(bases);free(apart);return ENOMEM;
    }
    size_t index=0;
    if(head)fds[index++]=(struct pollfd){owner->listener,POLLIN,0};
    size_t owner_first=index;
    size_t owner_bound=0;
    for(BrOwnerControl *control=owner->controls;control;control=control->next,index++) {
      owner_clients[owner_bound++]=control;
      fds[index]=(struct pollfd){control->socket,POLLIN|(control->answered?POLLOUT:0),0};
    }
    size_t bound=0,slot=0;
    for(BrKeeper *keeper=owner->attempts;keeper;keeper=keeper->next,slot++) {
      keepers[slot]=keeper;bases[slot]=index;apart[slot]=bound;
      fds[index++]=(struct pollfd){keeper->listener,POLLIN,0};
      fds[index++]=(struct pollfd){keeper->client,POLLIN|(keeper->outgoing?POLLOUT:0),0};
      /* Spool notifications follow the attached observer's ready reply. */
      fds[index++]=(struct pollfd){keeper->client>=0 && !keeper->ready?-1:keeper->watch,POLLIN,0};
      fds[index++]=(struct pollfd){keeper->wake[0],POLLIN,0};
      fds[index++]=(struct pollfd){keeper->writes?keeper->input:-1,POLLOUT,0};
      fds[index++]=(struct pollfd){keeper->native_life,POLLIN,0};
      for(BrControl *control=keeper->controls;control;control=control->next,index++)
        clients[bound++]=control,fds[index]=(struct pollfd){control->socket,POLLIN|(control->answered?POLLOUT:0),0};
    }
    apart[slots]=bound;
    int poll_timeout=-1;
    for(BrKeeper *keeper=owner->attempts;keeper;keeper=keeper->next)
      if(keeper->unwatched_recovery) {poll_timeout=100;break;}
    int ready;do {ready=poll(fds,(nfds_t)total,poll_timeout);} while(ready<0 && errno==EINTR);
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
    for(size_t i=0;i<owner_bound;i++) {
      BrOwnerControl *control=owner_clients[i];
      size_t fd_index=owner_first+i;
      if(fds[fd_index].revents&(POLLIN|POLLHUP|POLLERR))
        if((error=br_owner_control_read(owner,control)))goto polled;
    }
    for(size_t i=0;i<slots;i++) {
      error=br_attempt_ready(keepers[i],fds+bases[i],clients+apart[i],apart[i+1]-apart[i]);
      if(error) {
        if(owner->single)goto polled;
        br_note(keepers[i],"attempt-error",error);
        keepers[i]->finishing=1;error=0;
      }
    }
polled:
    free(fds);free(owner_clients);free(keepers);free(clients);free(bases);free(apart);
    if(error)return error;
  }
}
/* Binds the owner to one physical database. Hard-link and symlink aliases share
   the physical identity and therefore elect one owner: the lock, socket, record
   and custody epoch all live in the fixed per-user IPC directory under a key
   derived from that identity. The database file is held open for the owner's
   lifetime and its identity is rechecked at every admission, so a replaced file
   is refused. */
static int br_owner_bind(BrOwner *owner,const char *database) {
  struct stat info;
  int error=0;
  owner->database=realpath(database,NULL);
  if(!owner->database)return errno;
  owner->database_fd=open(owner->database,O_RDONLY|O_CLOEXEC);
  if(owner->database_fd<0)return errno;
  if(fstat(owner->database_fd,&info))return errno;
  if(!S_ISREG(info.st_mode))return EINVAL;
  owner->device=(uint64_t)info.st_dev;owner->inode=(uint64_t)info.st_ino;
  if(stat(owner->database,&info))return errno;
  if((uint64_t)info.st_dev!=owner->device || (uint64_t)info.st_ino!=owner->inode)return ESTALE;
  char *parent=strdup(owner->database);
  if(!parent)return ENOMEM;
  char *slash=strrchr(parent,'/');
  if(!slash){free(parent);return EINVAL;}
  *slash=0;
  error=stat(parent,&info)?errno:0;
  if(!error){owner->parent_device=(uint64_t)info.st_dev;owner->parent_inode=(uint64_t)info.st_ino;}
  free(parent);
  if(error)return error;
  error=br_ipc_directory(&owner->ipc);
  if(error)return error;
  owner->key=br_owner_key(owner->device,owner->inode);
  if(!owner->ipc || !owner->key)return ENOMEM;
  char *lock_path=br_ipc_path(owner->ipc,owner->key,".lock");
  owner->record_path=br_ipc_path(owner->ipc,owner->key,".record");
  owner->generation_path=br_ipc_path(owner->ipc,owner->key,".generation");
  owner->cursor_path=br_ipc_path(owner->ipc,owner->key,".cursor");
  owner->socket_path=br_ipc_path(owner->ipc,owner->key,".sock");
  if(!lock_path || !owner->record_path || !owner->generation_path || !owner->socket_path ||
     !owner->cursor_path) {
    free(lock_path);return ENOMEM;
  }
  owner->lock=open(lock_path,O_CREAT|O_RDWR|O_CLOEXEC,0600);
  free(lock_path);
  error=owner->lock<0?errno:0;
  if(!error) {
    int result;do {result=flock(owner->lock,LOCK_EX|LOCK_NB);}while(result<0 && errno==EINTR);
    if(result<0)error=errno==EWOULDBLOCK?EBUSY:errno;
  }
  if(!error)error=br_epoch_next(owner->ipc,owner->generation_path,&owner->epoch);
  if(!error)error=br_entropy(&owner->token);
  if(!error) {
    /* A live owner holds the election lock, so a socket at this path is stale. */
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
  if(!error)error=br_owner_record_write(owner);
  if(!error)owner->bound=1;
  if(error) {
    if(owner->listener>=0){close(owner->listener);owner->listener=-1;}
    if(owner->lock>=0){close(owner->lock);owner->lock=-1;}
  }
  return error;
}
static int br_owner_serve(const char *database) {
  BrOwner owner={.listener=-1,.lock=-1,.database_fd=-1};
  int error=br_owner_bind(&owner,database);
  /* The elected owner resumes the committed-change high-water its predecessor
     published, so the cursor it reports never regresses. */
  if(!error)br_owner_cursor_load(&owner);
  if(!error)error=br_owner_loop(&owner);
  if(owner.listener>=0)close(owner.listener);
  /* A failed election must not remove the elected owner's socket or record;
     this process unlinks them only when it bound them itself. */
  if(owner.bound) {
    if(owner.socket_path)unlink(owner.socket_path);
    if(owner.record_path)unlink(owner.record_path);
  }
  if(owner.database_fd>=0)close(owner.database_fd);
  free(owner.ipc);free(owner.key);free(owner.record_path);free(owner.generation_path);
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
  BrKeeper keeper={.listener=-1,.client=3,.input=-1,.lock=lock,.watch=-1,.wake={-1,-1},.spool=-1,.native_life=-1,.generation=1};
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
/* A prepared artifact name is one non-empty path component with no traversal. */
static int br_artifact_name_ok(const char *name,size_t length) {
  if(!name || !length)return EINVAL;
  if(name[0]=='.' && (!name[1] || (name[1]=='.' && !name[2])))return EINVAL;
  if(strchr(name,'/') || strchr(name,'\\'))return EINVAL;
  if(strlen(name)!=length)return EINVAL;
  return 0;
}
/* Writes the prepared artifact into private attempt custody: exclusive creation,
   no symlink following, read-only mode, the file flushed and its directory
   flushed, all before any child is spawned. */
static int br_artifact_write(const char *directory,const char *name,const char *bytes,size_t length) {
  if(br_artifact_name_ok(name,strlen(name)))return EINVAL;
  char *path=br_path(directory,name);
  if(!path)return ENOMEM;
  int fd=open(path,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0400);
  int error=fd<0?errno:0;
  if(!error) {
    error=br_write_all(fd,bytes,length);
    if(!error && fsync(fd))error=errno;
    close(fd);
    if(error)unlink(path);
  }
  if(!error) {
    int dirfd=open(directory,O_RDONLY|O_CLOEXEC);
    if(dirfd>=0){if(fsync(dirfd))error=errno;close(dirfd);}
  }
  free(path);
  return error;
}
/* SHA-256 over the prepared artifact's bytes. The manifest binds this value, and
   the owner recomputes it at custody start, so the content binding does not rely
   on a short hash. */
typedef struct { uint32_t state[8]; uint64_t length; unsigned char block[64]; size_t used; } BrSha256;
static const uint32_t br_sha256_k[64]={
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
#define BR_ROR(x,n) (((x)>>(n))|((x)<<(32-(n))))
static void br_sha256_block(BrSha256 *sha,const unsigned char *block) {
  uint32_t w[64];
  for(int i=0;i<16;i++)
    w[i]=((uint32_t)block[i*4]<<24)|((uint32_t)block[i*4+1]<<16)|((uint32_t)block[i*4+2]<<8)|(uint32_t)block[i*4+3];
  for(int i=16;i<64;i++) {
    uint32_t a=w[i-15],b=w[i-2];
    uint32_t s0=BR_ROR(a,7)^BR_ROR(a,18)^(a>>3),s1=BR_ROR(b,17)^BR_ROR(b,19)^(b>>10);
    w[i]=w[i-16]+s0+w[i-7]+s1;
  }
  uint32_t a=sha->state[0],b=sha->state[1],c=sha->state[2],d=sha->state[3];
  uint32_t e=sha->state[4],f=sha->state[5],g=sha->state[6],h=sha->state[7];
  for(int i=0;i<64;i++) {
    uint32_t s1=BR_ROR(e,6)^BR_ROR(e,11)^BR_ROR(e,25);
    uint32_t ch=(e&f)^((~e)&g);
    uint32_t t1=h+s1+ch+br_sha256_k[i]+w[i];
    uint32_t s0=BR_ROR(a,2)^BR_ROR(a,13)^BR_ROR(a,22);
    uint32_t maj=(a&b)^(a&c)^(b&c);
    uint32_t t2=s0+maj;
    h=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;
  }
  sha->state[0]+=a;sha->state[1]+=b;sha->state[2]+=c;sha->state[3]+=d;
  sha->state[4]+=e;sha->state[5]+=f;sha->state[6]+=g;sha->state[7]+=h;
}
static void br_sha256_init(BrSha256 *sha) {
  static const uint32_t initial[8]={0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
    0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
  memset(sha,0,sizeof(*sha));
  memcpy(sha->state,initial,sizeof(initial));
}
static void br_sha256_update(BrSha256 *sha,const unsigned char *data,size_t length) {
  sha->length+=(uint64_t)length;
  while(length) {
    size_t room=64-sha->used,count=length<room?length:room;
    memcpy(sha->block+sha->used,data,count);
    sha->used+=count;data+=count;length-=count;
    if(sha->used==64){br_sha256_block(sha,sha->block);sha->used=0;}
  }
}
static void br_sha256_final(BrSha256 *sha,unsigned char out[32]) {
  uint64_t bits=sha->length*8;
  unsigned char pad=0x80;
  br_sha256_update(sha,&pad,1);
  pad=0;
  while(sha->used!=56)br_sha256_update(sha,&pad,1);
  unsigned char tail[8];
  for(int i=0;i<8;i++)tail[i]=(unsigned char)(bits>>(56-i*8));
  br_sha256_update(sha,tail,8);
  for(int i=0;i<8;i++) {
    out[i*4]=(unsigned char)(sha->state[i]>>24);out[i*4+1]=(unsigned char)(sha->state[i]>>16);
    out[i*4+2]=(unsigned char)(sha->state[i]>>8);out[i*4+3]=(unsigned char)sha->state[i];
  }
}
/* The artifact's recorded content binding: its SHA-256 and its exact length. */
static int br_artifact_binding(const char *directory,const char *name,size_t name_length,
                               unsigned char digest[32],uint64_t *length) {
  if(br_artifact_name_ok(name,name_length))return EINVAL;
  char *path=br_path(directory,name);
  if(!path)return ENOMEM;
  int fd=open(path,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
  if(fd<0){int error=errno;free(path);return error;}
  BrSha256 sha;br_sha256_init(&sha);
  unsigned char buffer[8192];ssize_t n;uint64_t total=0;int error=0;
  while((n=read(fd,buffer,sizeof(buffer)))>0){br_sha256_update(&sha,buffer,(size_t)n);total+=(uint64_t)n;}
  if(n<0)error=errno;
  close(fd);free(path);
  if(error)return error;
  br_sha256_final(&sha,digest);
  *length=total;
  return 0;
}
/* Exact comparison of the artifact already in custody with a requested byte
   string: the same length and the same bytes. */
static int br_artifact_same(const char *directory,const char *name,size_t name_length,
                            const char *bytes,size_t length) {
  if(br_artifact_name_ok(name,name_length))return EINVAL;
  char *path=br_path(directory,name);
  if(!path)return ENOMEM;
  struct stat info;
  int error=0;
  if(lstat(path,&info))error=errno;
  else if(!S_ISREG(info.st_mode))error=EINVAL;
  else if(info.st_size!=(off_t)length)error=EEXIST;
  int fd=error?-1:open(path,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
  if(!error && fd<0)error=errno;
  char buffer[8192];size_t offset=0;
  while(!error && offset<length) {
    size_t take=length-offset<sizeof(buffer)?length-offset:sizeof(buffer);
    ssize_t n=read(fd,buffer,take);
    if(n<0 && errno==EINTR)continue;
    if(n<=0){error=n<0?errno:EIO;break;}
    if(memcmp(buffer,bytes+offset,(size_t)n))error=EEXIST;
    offset+=(size_t)n;
  }
  if(fd>=0)close(fd);
  free(path);
  return error;
}
/* Exact comparison of the stored manifest with a requested one: the same field
   count, the same lengths and the same bytes in every field. */
static int br_manifest_same(const char *directory,const BrManifestHeader *header,char *const *fields,int count) {
  BrManifest stored={0};
  int error=br_manifest_read(directory,&stored);
  if(!error && (stored.count!=count || stored.header.keep_stdin!=header->keep_stdin))error=EEXIST;
  for(int i=0;!error && i<count;i++)
    if(stored.header.lengths[i]!=header->lengths[i] ||
       memcmp(stored.field[i],fields[i],(size_t)header->lengths[i]))error=EEXIST;
  br_manifest_free(&stored);
  return error;
}
static int br_manifest_store(const char *directory,const char *manifest_path,BrManifestHeader *header,char **fields,size_t *lengths,int count) {
  int fd=open(manifest_path,O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC,0600),error=0;
  if(fd<0)return errno;
  error=br_write_all(fd,header->magic,8);
  for(int i=0;i<count && !error;i++)error=br_write_all(fd,&header->lengths[i],sizeof(uint64_t));
  if(!error)error=br_write_all(fd,&header->keep_stdin,sizeof(uint32_t));
  if(!error)error=br_write_all(fd,&header->reserved,sizeof(uint32_t));
  for(int i=0;i<count && !error;i++)error=br_write_all(fd,fields[i],lengths[i]);
  if(!error && fsync(fd))error=errno;
  if(!error && fchmod(fd,0400))error=errno;
  close(fd);
  int dirfd=open(directory,O_RDONLY|O_CLOEXEC);
  if(!error && (dirfd<0 || fsync(dirfd)))error=errno;
  if(dirfd>=0)close(dirfd);
  return error;
}
/* The durable admission record. It binds one attempt directory to the physical
   database that admitted it, to the session guard whose lock the admitting call
   held, and to the directory's own identity, so adoption and launch are
   authorized from durable evidence rather than from the presence of a spool
   file. The integrity check covers the record and the recorded path; the
   authority comes from the recorded device and inode identities, which a copy
   of the record into another directory cannot change. */
#define BR_ADMISSION_MAGIC "BATONAD1"
typedef struct {
  char magic[8];
  uint32_t schema,reserved;
  uint64_t database_device,database_inode;
  uint64_t guard_device,guard_inode;
  uint64_t attempt_device,attempt_inode;
  uint64_t directory_length;
  uint64_t check;
} BrAdmission;
static uint64_t br_admission_check(const BrAdmission *record,const char *directory,size_t length) {
  uint64_t digest=0xcbf29ce484222325ULL;
  const unsigned char *bytes=(const unsigned char *)record;
  for(size_t i=0;i<offsetof(BrAdmission,check);i++) {digest^=bytes[i];digest*=0x100000001b3ULL;}
  for(size_t i=offsetof(BrAdmission,check)+sizeof(uint64_t);i<sizeof(*record);i++) {
    digest^=bytes[i];digest*=0x100000001b3ULL;
  }
  for(size_t i=0;i<length;i++) {digest^=(unsigned char)directory[i];digest*=0x100000001b3ULL;}
  return digest;
}
/* Records the admitting facts of a newly prepared attempt. `database` is the
   path the admitting call named and `guard` its session guard descriptor. */
static int br_admission_store(const char *directory,const char *database,int guard) {
  struct stat attempt,database_info,guard_info;
  char *canonical=realpath(directory,NULL);
  if(!canonical)return errno;
  if(lstat(canonical,&attempt) || !S_ISDIR(attempt.st_mode)){free(canonical);return EPERM;}
  memset(&database_info,0,sizeof(database_info));
  /* An admission through the legacy attempt-level API carries no database, so the
     record states no database binding and verification skips that comparison. */
  if(database && stat(database,&database_info)){free(canonical);return EPERM;}
  /* A descriptor number of zero means the admitting call holds no session guard,
     because the effect boundary passes zero for an absent lock. */
  if(guard>0) {if(fstat(guard,&guard_info)){free(canonical);return EPERM;}}
  else memset(&guard_info,0,sizeof(guard_info));
  size_t length=strlen(canonical);
  BrAdmission record={.schema=1,
    .database_device=(uint64_t)database_info.st_dev,.database_inode=(uint64_t)database_info.st_ino,
    .guard_device=(uint64_t)guard_info.st_dev,.guard_inode=(uint64_t)guard_info.st_ino,
    .attempt_device=(uint64_t)attempt.st_dev,.attempt_inode=(uint64_t)attempt.st_ino,
    .directory_length=length};
  memcpy(record.magic,BR_ADMISSION_MAGIC,8);
  record.check=br_admission_check(&record,canonical,length);
  char *path=br_path(canonical,"admission");
  if(!path){free(canonical);return ENOMEM;}
  char *bytes=malloc(sizeof(record)+length);
  int error=bytes?0:ENOMEM;
  if(!error) {
    memcpy(bytes,&record,sizeof(record));
    memcpy(bytes+sizeof(record),canonical,length);
    error=br_replace(canonical,path,bytes,sizeof(record)+length,1);
  }
  free(bytes);free(path);free(canonical);
  return error;
}
/* Verifies the admission record of a directory against the database that requests
   it and the guard the caller holds. Every mismatch refuses: a directory whose
   recorded identity, database or guard differs is not the attempt that was
   admitted, whatever files it contains. */
static int br_admission_verify(const char *directory,const char *database,int guard) {
  char *path=br_path(directory,"admission");
  if(!path)return ENOMEM;
  int fd=open(path,O_RDONLY|O_CLOEXEC);
  if(fd<0) {
    /* A directory with no admission record is not ours to write into, so the
       refusal is reported to the caller alone. */
    int error=errno;free(path);return error==ENOENT?EPERM:error;
  }
  BrAdmission record;
  const char *reason=NULL;
  int error=br_read_all(fd,&record,sizeof(record));
  struct stat info;
  if(error||fstat(fd,&info)) {error=EPERM;reason="truncated admission record\n";}
  if(!error && (memcmp(record.magic,BR_ADMISSION_MAGIC,8) || record.schema!=1))
    {error=EPERM;reason="the admission record is not this schema\n";}
  if(!error && record.directory_length>SIZE_MAX-sizeof(record)) {error=EOVERFLOW;reason=NULL;}
  size_t length=error?0:(size_t)record.directory_length;
  if(!error && length==0) {error=EPERM;reason="the recorded path is not a path\n";}
  if(!error && (size_t)info.st_size!=sizeof(record)+length)
    {error=EPERM;reason="the admission record and its path are not one record\n";}
  char *recorded=NULL;
  if(!error) {
    recorded=malloc(length+1);
    if(!recorded)error=ENOMEM;
    else if(br_read_all(fd,recorded,length)) {error=EPERM;reason="truncated recorded path\n";}
    else recorded[length]=0;
  }
  close(fd);free(path);
  char *canonical=error||!recorded?NULL:realpath(directory,NULL);
  if(!error && !canonical) {error=errno;reason=NULL;}
  struct stat attempt,database_info,guard_info;
  if(!error && (lstat(canonical,&attempt) || !S_ISDIR(attempt.st_mode)))
    {error=EPERM;reason="the requested directory is not a directory\n";}
  if(!error && ((uint64_t)attempt.st_dev!=record.attempt_device ||
                (uint64_t)attempt.st_ino!=record.attempt_inode))
    {error=EPERM;reason="the admission record belongs to another directory\n";}
  if(!error && strcmp(recorded,canonical))
    {error=EPERM;reason="the admission record names another path\n";}
  if(!error && br_admission_check(&record,canonical,length)!=record.check)
    {error=EPERM;reason="the admission record is not intact\n";}
  if(!error && database && !record.database_inode)
    {error=EPERM;reason="the admission record states no database binding\n";}
  if(!error && database && record.database_inode) {
    if(stat(database,&database_info)) {error=EPERM;reason="the requesting database is not readable\n";}
    else if((uint64_t)database_info.st_dev!=record.database_device ||
            (uint64_t)database_info.st_ino!=record.database_inode)
      {error=EPERM;reason="the admission record belongs to another database\n";}
  }
  /* A guard identity states which session guard admitted the attempt. An attempt
     that states none has no session authority, and a request that presents none
     cannot exercise the identity the record carries: both are refused rather than
     treated as a match, and the descriptor number zero means no guard because the
     effect boundary passes zero for an absent lock. */
  if(!error && guard>=0 && guard>0 && !record.guard_inode)
    {error=EPERM;reason="the admission record states no session guard binding\n";}
  /* Recovery passes -1 only after validating the exact old managed bootstrap
     under the elected database owner. The recorded guard remains historical
     provenance; this path does not claim that its descriptor or lock is held. */
  if(!error && guard>=0 && record.guard_inode) {
    if(guard<=0) {error=EPERM;reason="the admission record requires a session guard\n";}
    else if(fstat(guard,&guard_info)) {error=EPERM;reason="the presented guard is not a file\n";}
    else if((uint64_t)guard_info.st_dev!=record.guard_device ||
            (uint64_t)guard_info.st_ino!=record.guard_inode)
      {error=EPERM;reason="the admission record belongs to another session guard\n";}
  }
  if(error && reason)br_file(canonical?canonical:directory,"admission-error",reason,strlen(reason),1);
  free(recorded);
  free(canonical);
  return error;
}
/* The durable lifecycle record of one attempt. It carries the identity fixed when
   the task was prepared, the grant that authorized its start and the rejection
   that cancelled it, so a start decision is made once and survives every process
   that takes part in it. The two latches are the task's state authority: a start
   latches before it spawns, and a cancellation is refused once a start latched. */
#define BR_LIFECYCLE_MAGIC "BATONLC1"
typedef struct {
  char magic[8];
  uint32_t schema,expected_set;
  uint32_t latched,cancelled,observer_ready,reserved3;
  unsigned char expected[32],grant[32],rejection[32];
  uint64_t check;
} BrLifecycle;
static uint64_t br_lifecycle_check(const BrLifecycle *record) {
  uint64_t digest=0xcbf29ce484222325ULL;
  const unsigned char *bytes=(const unsigned char *)record;
  for(size_t i=0;i<offsetof(BrLifecycle,check);i++) {digest^=bytes[i];digest*=0x100000001b3ULL;}
  for(size_t i=offsetof(BrLifecycle,check)+sizeof(uint64_t);i<sizeof(*record);i++) {
    digest^=bytes[i];digest*=0x100000001b3ULL;
  }
  return digest;
}
static int br_lifecycle_store(const char *directory,const BrLifecycle *record) {
  char *path=br_path(directory,"lifecycle");
  if(!path)return ENOMEM;
  BrLifecycle stored=*record;
  memcpy(stored.magic,BR_LIFECYCLE_MAGIC,8);
  stored.schema=1;
  stored.check=br_lifecycle_check(&stored);
  int error=br_replace(directory,path,&stored,sizeof(stored),1);
  free(path);
  return error;
}
static int br_lifecycle_read(const char *directory,BrLifecycle *record) {
  char *path=br_path(directory,"lifecycle");
  if(!path)return ENOMEM;
  int fd=open(path,O_RDONLY|O_CLOEXEC);
  if(fd<0) {int error=errno;free(path);return error;}
  int error=br_read_all(fd,record,sizeof(*record));
  struct stat info;
  if(error||fstat(fd,&info))error=EINVAL;
  else if((size_t)info.st_size!=sizeof(*record))error=EINVAL;
  else if(memcmp(record->magic,BR_LIFECYCLE_MAGIC,8) || record->schema!=1)error=EINVAL;
  else if(record->expected_set>1 || record->observer_ready>1 || record->latched>1 || record->cancelled>1)error=EINVAL;
  else if(br_lifecycle_check(record)!=record->check)error=EINVAL;
  close(fd);free(path);
  return error;
}
/* Writes the record of a newly prepared attempt. The expected identity is the
   digest of the admission identity the caller fixed before anything ran; the
   legacy attempt-level admission fixes none, and the effect call passes NULL. */
static int br_lifecycle_init(const char *directory,const unsigned char *expected_digest) {
  BrLifecycle record={0};
  if(expected_digest) {
    record.expected_set=1;
    memcpy(record.expected,expected_digest,sizeof(record.expected));
  }
  return br_lifecycle_store(directory,&record);
}
/* Reads the lifecycle record of an attempt. A missing record fails closed: the
   prepared state, the grant that authorized the start and the rejection that
   cancelled the task are authority, so their absence is never treated as an empty
   record with nothing latched. */
static int br_lifecycle_required(const char *directory,BrLifecycle *record) {
  int error=br_lifecycle_read(directory,record);
  if(error==ENOENT) {
    br_file(directory,"lifecycle-error","no lifecycle record for this attempt\n",37,1);
    return EPERM;
  }
  if(error)br_file(directory,"lifecycle-error","unusable lifecycle record\n",27,1);
  return error;
}
static int br_lifecycle_has_expected(const BrLifecycle *record) {
  return record->expected_set==1;
}
static int br_lifecycle_expectation(const char *directory,const unsigned char *expected_digest) {
  BrLifecycle record;
  int error=br_lifecycle_required(directory,&record);
  if(error)return error;
  if(expected_digest)
    return br_lifecycle_has_expected(&record) &&
      !memcmp(record.expected,expected_digest,sizeof(record.expected))?0:EPERM;
  return br_lifecycle_has_expected(&record)?EPERM:0;
}
static int br_lifecycle_prepare_check(const char *directory) {
  BrLifecycle record;
  int error=br_lifecycle_required(directory,&record);
  if(error)return error;
  return record.latched || record.cancelled?EPERM:0;
}
/* Latches the one start of this task before its program is spawned. A cancelled
   task never starts. A start already latched with the same grant reports that the
   work is retained, so the caller reports the existing attempt instead of spawning
   a second child; a different grant is refused. */
static int br_lifecycle_start(const char *directory,const unsigned char *expected_digest,
                              const unsigned char *grant_digest,int *retained) {
  BrLifecycle record;
  int error=br_lifecycle_required(directory,&record);
  if(error)return error;
  *retained=0;
  if(record.cancelled)return EPERM;
  if(br_lifecycle_has_expected(&record) &&
     (!expected_digest || memcmp(record.expected,expected_digest,sizeof(record.expected))))return EPERM;
  if(record.latched) {
    if(grant_digest && memcmp(record.grant,grant_digest,sizeof(record.grant)))return EEXIST;
    if(!grant_digest && br_lifecycle_has_expected(&record))return EEXIST;
    *retained=1;
    return 0;
  }
  if(!record.observer_ready)return EPERM;
  record.latched=1;
  if(grant_digest)memcpy(record.grant,grant_digest,sizeof(record.grant));
  return br_lifecycle_store(directory,&record);
}
/* Records a rejection before any start. A repeated rejection is a no-op, and a
   rejection after a start is refused because the task exists. */
static int br_lifecycle_cancel(const char *directory,const unsigned char *expected_digest,
                               const unsigned char *rejection_digest) {
  BrLifecycle record;
  int error=br_lifecycle_required(directory,&record);
  if(error)return error;
  if(record.latched)return EPERM;
  if(br_lifecycle_has_expected(&record) &&
     (!expected_digest || memcmp(record.expected,expected_digest,sizeof(record.expected))))return EPERM;
  if(!rejection_digest)return EINVAL;
  if(record.cancelled)
    return rejection_digest && !memcmp(record.rejection,rejection_digest,sizeof(record.rejection))?0:EEXIST;
  if(rejection_digest)memcpy(record.rejection,rejection_digest,sizeof(record.rejection));
  record.cancelled=1;
  return br_lifecycle_store(directory,&record);
}
static int br_lifecycle_ready(const char *directory) {
  BrLifecycle record;
  int error=br_lifecycle_required(directory,&record);
  if(error)return error;
  if(record.cancelled)return EPERM;
  if(record.latched)return 0;
  if(!record.observer_ready) {
    record.observer_ready=1;
    error=br_lifecycle_store(directory,&record);
  }
  return error;
}
/* Names the state the durable facts show: a started task is running while its
   recorded native process is alive and exited once it is not. */
static const char *br_lifecycle_state(const char *directory,BrLifecycle *record,uint64_t *pid,
                                     int *status_known,int *status) {
  *pid=0;*status_known=0;*status=0;
  int error=br_lifecycle_read(directory,record);
  if(error) {memset(record,0,sizeof(*record));return "unknown";}
  char *pid_path=br_path(directory,"native.pid");
  FILE *file=pid_path?fopen(pid_path,"r"):NULL;
  if(file) {
    unsigned long long value=0;
    if(fscanf(file,"%llu",&value)==1)*pid=(uint64_t)value;
    fclose(file);
  }
  free(pid_path);
  char *status_path=br_path(directory,"status");
  file=status_path?fopen(status_path,"r"):NULL;
  if(file) {
    int value=0;
    if(fscanf(file,"%d",&value)==1) {*status=value;*status_known=1;}
    fclose(file);
  }
  free(status_path);
  if(record->cancelled)return "cancelled";
  if(!record->latched)return record->observer_ready?"ready":"prepared";
  if(!*pid)return "uncertain";
  if(*status_known)return "exited";
  return br_exists(directory,"native-start-error")?"failed":"running";
}
/* Rebinds observation to a live process after the database owner restarted.
   The old session guard remains historical admission evidence; recovery validates
   the sealed bootstrap, original admission record, canonical database and native
   birth, and it creates a read-only monitor entry under the newly elected owner. */
static int br_owner_recover(BrOwner *owner,const char *directory,const char *bootstrap,
                            const char *witness,BrKeeper **keeper_out) {
  if(!owner || !directory || !bootstrap || !witness || !keeper_out)return EINVAL;
  *keeper_out=NULL;
  uint64_t old_token=0,old_epoch=0;
  int error=br_owner_witness_parse(witness,&old_token,&old_epoch);
  if(error)return error;
  int same_owner=old_token==owner->token && old_epoch==owner->epoch;
  if(!same_owner && old_epoch>=owner->epoch)return ESTALE;
  static const char witness_prefix[]="\"ownerWitness\":\"";
  size_t witness_length=strlen(witness),prefix_length=sizeof(witness_prefix)-1;
  if(witness_length>SIZE_MAX-prefix_length-2)return ENOMEM;
  char *witness_field=malloc(prefix_length+witness_length+2);
  if(!witness_field)return ENOMEM;
  memcpy(witness_field,witness_prefix,prefix_length);
  memcpy(witness_field+prefix_length,witness,witness_length);
  witness_field[prefix_length+witness_length]='"';
  witness_field[prefix_length+witness_length+1]=0;
  int witness_matches=strstr(bootstrap,witness_field)!=NULL;
  free(witness_field);
  if(!witness_matches)return EPERM;
  char *canonical=realpath(directory,NULL);
  if(!canonical)return errno;
  struct stat info;
  if(fstat(owner->database_fd,&info))error=errno;
  else if((uint64_t)info.st_dev!=owner->device || (uint64_t)info.st_ino!=owner->inode)error=ESTALE;
  else if(stat(owner->database,&info))error=errno;
  else if((uint64_t)info.st_dev!=owner->device || (uint64_t)info.st_ino!=owner->inode)error=ESTALE;
  if(!error) {
    char *parent=strdup(canonical);
    if(!parent)error=ENOMEM;
    else {
      char *slash=strrchr(parent,'/');
      if(!slash)error=EINVAL;
      else {
        *slash=0;
        if(stat(parent,&info))error=errno;
        else if((uint64_t)info.st_dev!=owner->parent_device ||
                (uint64_t)info.st_ino!=owner->parent_inode)error=EINVAL;
      }
      free(parent);
    }
  }
  if(!error)error=br_admission_verify(canonical,owner->database,-1);
  BrManifest manifest={0};
  if(!error)error=br_manifest_read(canonical,&manifest);
  if(!error)error=br_attempt_manifest_verify(canonical);
  unsigned char expected[32];
  if(!error) {
    br_identity_sha256(bootstrap,strlen(bootstrap),expected);
    error=br_lifecycle_expectation(canonical,expected);
  }
  BrLifecycle lifecycle={0};
  if(!error)error=br_lifecycle_required(canonical,&lifecycle);
  if(!error && (!lifecycle.latched || lifecycle.cancelled || !lifecycle.observer_ready))error=EPERM;
  if(!error && (br_exists(canonical,"acknowledged") || br_exists(canonical,"native-start-error")))error=ENODATA;
  int terminal=0,terminal_status=0;
  if(!error && br_exists(canonical,"status")) {
    char *status_path=br_path(canonical,"status");
    FILE *status_file=status_path?fopen(status_path,"r"):NULL;
    if(!status_file)error=status_path?errno:ENOMEM;
    else {
      if(fscanf(status_file,"%d",&terminal_status)!=1 ||
         (!WIFEXITED(terminal_status) && !WIFSIGNALED(terminal_status)))error=EPERM;
      fclose(status_file);
      if(!error)terminal=1;
    }
    free(status_path);
  }
  if(!error && br_exists(canonical,"released") && !terminal)error=ENODATA;
  BrBirth saved={0},current={0};int ended=0,life=-1;
  if(!error)error=br_read_file(canonical,"native.birth",&saved,sizeof(saved));
  if(!error) {
    life=br_lifetime(canonical,&ended);
    if(life<0 && !ended)error=errno;
    else if(life<0 && !terminal)error=ENODATA;
  }
  if(!error && life>=0)error=br_birth(saved.pid,&current);
  if(!error && life>=0 && !br_same_birth(saved,current))error=ESTALE;
  if(!error && terminal && life>=0)error=EPERM;
  BrKeeper *existing=!error?br_owner_find(owner,canonical):NULL;
  if(!error && existing) {
    if(existing->identity!=br_manifest_digest(&manifest.header,manifest.field,manifest.count) ||
       !existing->monitor_only)error=EBUSY;
    else *keeper_out=existing;
  }
  if(!error && !existing && same_owner)error=ENOENT;
  if(!error && !existing) {
    BrKeeper *keeper=calloc(1,sizeof(*keeper));
    if(!keeper)error=ENOMEM;
    else {
      *keeper=(BrKeeper){.listener=-1,.client=-1,.input=-1,.lock=-1,.watch=-1,
        .wake={-1,-1},.spool=-1,.native_life=life,.generation=1,
        .id=++owner->next_id,.native_pid=saved.pid,.exited=terminal,
        .status=terminal_status,.input_closed=1,.ready=1,.prepared=1,
        .monitor_only=1,.status_unavailable=0};
      life=-1;
      keeper->directory=canonical;canonical=NULL;
      keeper->manifest=manifest;memset(&manifest,0,sizeof(manifest));
      keeper->identity=br_manifest_digest(&keeper->manifest.header,keeper->manifest.field,
        keeper->manifest.count);
      struct sockaddr_un address;
      keeper->listener=br_attempt_listener(keeper->manifest.field[5],&address);
      if(keeper->listener<0)error=errno;
      char *spool=error?NULL:br_path(keeper->directory,"stdout");
      if(!error)keeper->spool=spool?open(spool,O_RDONLY|O_CLOEXEC|O_NOFOLLOW):-1;
      if(!error && keeper->spool<0)error=spool?errno:ENOMEM;
      struct stat spool_info;
      if(!error && fstat(keeper->spool,&spool_info))error=errno;
      if(!error && (!S_ISREG(spool_info.st_mode) || spool_info.st_uid!=geteuid()))error=EPERM;
      if(!error)keeper->watch=br_watch_file(keeper->spool,spool);
      if(!error && keeper->watch<0)error=errno;
      free(spool);
      if(!error)error=baton_pipe(keeper->wake);
      if(error)br_keeper_stop(keeper);
      else {keeper->next=owner->attempts;owner->attempts=keeper;*keeper_out=keeper;}
    }
  }
  if(life>=0)close(life);
  br_manifest_free(&manifest);free(canonical);
  return error;
}
/* Verifies the manifest of an attempt and, for a prepared artifact, that the file
   in custody still carries the bytes the manifest binds. */
static int br_attempt_manifest_verify(const char *directory) {
  BrManifest manifest={0};
  int error=br_manifest_read(directory,&manifest);
  if(!error && manifest.count==8) {
    const char *name=manifest.field[6];
    size_t name_length=(size_t)manifest.header.lengths[6];
    if(manifest.header.lengths[7]!=32)error=EINVAL;
    else {
      unsigned char recorded[32],held[32];uint64_t held_length=0;
      memcpy(recorded,manifest.field[7],sizeof(recorded));
      if(!(error=br_artifact_name_ok(name,name_length)))
        error=br_artifact_binding(directory,name,name_length,held,&held_length);
      if(!error && memcmp(held,recorded,sizeof(recorded)))error=EINVAL;
    }
  }
  br_manifest_free(&manifest);
  return error;
}
/* Creates the exclusive attempt directory, its control socket directory and
   the manifest that admits the attempt. */
static int br_attempt_prepare(BatonProcessCall *call,char **directory_out,char **address_out,int idempotent) {
  if(!call->length || call->args[call->length-1] || !call->args[0] || !call->recovery_length ||
     call->recovery[call->recovery_length-1] || !call->recovery[0])return EINVAL;
  unsigned char expected_digest[32],*expected=NULL;
  if(call->identity) {
    if(!call->identity_length || strlen(call->identity)!=call->identity_length)return EINVAL;
    BrSha256 sha;br_sha256_init(&sha);
    br_sha256_update(&sha,(const unsigned char *)call->identity,call->identity_length);
    br_sha256_final(&sha,expected_digest);expected=expected_digest;
  }
  if(mkdir(call->directory,0700)) {
    int error=errno;
    if(error!=EEXIST || !idempotent)return error;
    /* The directory exists. The same admission identity reuses it, so a repeated
       admission is idempotent; a different identity is conflicting reuse. */
    char *existing=realpath(call->directory,NULL);
    if(!existing)return errno;
    BrManifestHeader header={.keep_stdin=call->keep_stdin,.reserved=0};
    char *fields[8]={call->args,call->cwd,call->log,call->initial,call->recovery,NULL,NULL,NULL};
    size_t lengths[8]={call->length,strlen(call->cwd),strlen(call->log),call->initial_length,call->recovery_length,0,0,0};
    int count=6;
    unsigned char digest_bytes[32]={0};
    if(call->artifact_name) {
      error=br_artifact_name_ok(call->artifact_name,call->artifact_name_length);
      /* A repeated request must present exactly the bytes already in custody:
         same length, same bytes. A digest alone is not the comparison. */
      if(!error)error=br_artifact_same(existing,call->artifact_name,call->artifact_name_length,
                                       call->artifact,call->artifact_length);
      if(!error) {
        BrSha256 sha;br_sha256_init(&sha);
        br_sha256_update(&sha,(const unsigned char *)call->artifact,call->artifact_length);
        br_sha256_final(&sha,digest_bytes);
        count=8;memcpy(header.magic,"BATONRP2",8);
        fields[6]=(char *)call->artifact_name;lengths[6]=call->artifact_name_length;
        fields[7]=(char *)digest_bytes;lengths[7]=sizeof(digest_bytes);
      }
    } else memcpy(header.magic,"BATONRP1",8);
    for(int i=0;i<count;i++)header.lengths[i]=lengths[i];
    /* The stored manifest must describe exactly this request, field by field. */
    if(!error)error=br_manifest_same(existing,&header,fields,count);
    if(!error)error=br_admission_verify(existing,call->database,(int)call->lock);
    if(!error)error=br_lifecycle_expectation(existing,expected);
    BrManifest manifest={0};
    if(!error)error=br_manifest_read(existing,&manifest);
    char *address=error?NULL:strdup(manifest.field[5]);
    br_manifest_free(&manifest);
    if(!error && !address)error=ENOMEM;
    if(error){free(address);free(existing);return error;}
    call->unstarted=1;
    /* This call reused custody that already existed; it must never be discarded
       by a later refusal. */
    call->fresh=0;
    *directory_out=existing;*address_out=address;
    return 0;
  }
  call->unstarted=1;
  call->fresh=1;
  char *directory=realpath(call->directory,NULL);
  if(!directory)return errno;
  char temporary[]="/tmp/baton-retained-XXXXXX";
  if(!mkdtemp(temporary)){free(directory);return errno;}
  char *address=br_path(temporary,"control"),*manifest_path=br_path(directory,"manifest");
  int error=!address || !manifest_path?ENOMEM:0;
  if(!error) {
    BrManifestHeader header={.keep_stdin=call->keep_stdin,.reserved=0};
    char *fields[8]={call->args,call->cwd,call->log,call->initial,call->recovery,address,NULL,NULL};
    size_t lengths[8]={call->length,strlen(call->cwd),strlen(call->log),call->initial_length,call->recovery_length,strlen(address),0,0};
    int count=6;
    unsigned char digest_bytes[32]={0};
    if(call->artifact_name) {
      error=br_artifact_name_ok(call->artifact_name,call->artifact_name_length);
      /* The prepared artifact is written, flushed and made read-only inside
         private attempt custody before anything is spawned, and the SHA-256 of
         its bytes is bound into the admission identity below. */
      if(!error)error=br_artifact_write(directory,call->artifact_name,call->artifact,call->artifact_length);
      if(!error) {
        BrSha256 sha;br_sha256_init(&sha);
        br_sha256_update(&sha,(const unsigned char *)call->artifact,call->artifact_length);
        br_sha256_final(&sha,digest_bytes);
        count=8;memcpy(header.magic,"BATONRP2",8);
        fields[6]=(char *)call->artifact_name;lengths[6]=call->artifact_name_length;
        fields[7]=(char *)digest_bytes;lengths[7]=sizeof(digest_bytes);
      }
    } else memcpy(header.magic,"BATONRP1",8);
    for(int i=0;i<count;i++)header.lengths[i]=lengths[i];
    if(!error)error=br_manifest_store(directory,manifest_path,&header,fields,lengths,count);
    if(!error)error=br_admission_store(directory,call->database,(int)call->lock);
    if(!error)error=br_lifecycle_init(directory,expected);
  }
  free(manifest_path);
  if(error){free(address);free(directory);return error;}
  *directory_out=directory;*address_out=address;
  return 0;
}
static int br_retain(BatonProcessCall *call) {
  char *directory=NULL,*address=NULL;
  int error=br_attempt_prepare(call,&directory,&address,0);
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
  if(!error) {error=br_attach_socket(call->child,directory,sockets[0],&call->unstarted,0);sockets[0]=-1;}
  if(sockets[0]>=0)close(sockets[0]);if(null>=0)close(null);if(log>=0)close(log);
  free(self);free(log_path);free(address);free(directory);
  return error;
}

/* Reads the elected owner's published record for a database path. The record
   lives in the per-user IPC directory under the physical identity key, so an
   alias pathname finds the same owner. */
static int br_instance_record(const char *canonical,char **ipc_out,char **key_out,char **record_path_out,BrOwnerRecord *record) {
  struct stat info;
  if(stat(canonical,&info))return errno;
  char *ipc=NULL;
  int error=br_ipc_directory(&ipc);
  if(error)return error;
  char *key=br_owner_key((uint64_t)info.st_dev,(uint64_t)info.st_ino);
  if(!key){free(ipc);return ENOMEM;}
  char *record_path=br_ipc_path(ipc,key,".record");
  if(!record_path){free(ipc);free(key);return ENOMEM;}
  error=br_owner_record_read(ipc,record_path,record);
  if(error) {free(ipc);free(key);free(record_path);}
  else {
    *ipc_out=ipc;*key_out=key;*record_path_out=record_path;
  }
  return error;
}
static int br_instance_spawn(const char *canonical,pid_t *pid,const char *log_path) {
  char *self=br_self();
  int null=self?open("/dev/null",O_RDONLY|O_CLOEXEC):-1;
  int log=log_path?open(log_path,O_WRONLY|O_CREAT|O_APPEND|O_CLOEXEC,0600):-1;
  if(log<0)log=null;
  char *argv[]={self,"--instance-owner",(char *)canonical,NULL};
  int error=self && null>=0?br_spawn(pid,argv,NULL,null,log,null,-1,-1):(errno?errno:ENOMEM);
  if(null>=0)close(null);
  if(log>=0 && log!=null)close(log);
  free(self);
  if(!error) {
    pthread_t reaper;
    if(!pthread_create(&reaper,NULL,br_reap_detached,(void *)(intptr_t)*pid))pthread_detach(reaper);
  }
  return error;
}
/* The socket pathname a client would use for this database. A failure detail
   carries it so a caller can tell a missing owner from an unreachable one. */
static int br_instance_socket_for(const char *database,char **socket_out) {
  *socket_out=NULL;
  char *canonical=realpath(database,NULL);
  if(!canonical)return errno;
  struct stat info;
  int error=stat(canonical,&info)?errno:0;
  char *ipc=NULL;
  char *key=NULL,*record_path=NULL;
  BrOwnerRecord record={0};
  if(!error)error=br_ipc_directory(&ipc);
  if(!error) {
    key=br_owner_key((uint64_t)info.st_dev,(uint64_t)info.st_ino);
    if(!key)error=ENOMEM;
  }
  if(!error) {
    record_path=br_ipc_path(ipc,key,".record");
    if(!record_path)error=ENOMEM;
  }
  if(!error) {
    if(br_owner_record_read(ipc,record_path,&record)) {
      *socket_out=br_ipc_path(ipc,key,".sock");
      if(!*socket_out)*socket_out=strdup(record_path);
    } else *socket_out=strdup(record.socket);
    if(!*socket_out)error=ENOMEM;
  }
  free(ipc);free(key);free(record_path);free(canonical);
  return error;
}
/* Connects to the database owner. The socket pathname comes from the published
   record, and the client validates the token and custody epoch it reads after
   connecting, so a socket left behind by an earlier owner incarnation is
   refused. When no listener answers and `spawn` is set, the client starts one
   owner and waits for it, so adding a session adds no custody process. */
static int br_instance_connect(const char *database,int spawn,BrOwnerRecord *record,int *socket_out) {
  char *canonical=realpath(database,NULL);
  if(!canonical)return errno;
  int socket_fd=-1,started=0,error=0;
  char *owner_log=NULL;
  for(;;) {
    char *ipc=NULL,*key=NULL,*record_path=NULL;
    int record_error=br_instance_record(canonical,&ipc,&key,&record_path,record);
    if(record_error) {
      /* The record is only needed to propose a pathname; a first owner writes it. */
      struct stat info;
      if(stat(canonical,&info)) {error=errno;break;}
      char *directory=NULL;
      if((error=br_ipc_directory(&directory)))break;
      key=br_owner_key((uint64_t)info.st_dev,(uint64_t)info.st_ino);
      record_path=br_ipc_path(directory,key,".sock");
      if(!key || !record_path){error=ENOMEM;free(directory);free(key);free(record_path);break;}
      if((error=br_owner_socket_copy(record->socket,sizeof(record->socket),record_path))) {
        free(directory);free(key);free(record_path);break;
      }
      char *log_path=br_ipc_path(directory,key,".log");
      if(log_path){if(!owner_log)owner_log=log_path;else free(log_path);}
      free(directory);
    }
    struct sockaddr_un address;
    int address_error=br_socket_address(&address,record->socket);
    free(ipc);free(key);free(record_path);
    if(address_error){error=address_error;break;}
    socket_fd=socket(AF_UNIX,SOCK_STREAM,0);
    if(socket_fd<0){error=errno;break;}
    fcntl(socket_fd,F_SETFD,FD_CLOEXEC);
    if(!connect(socket_fd,(struct sockaddr *)&address,sizeof(address)))break;
    error=errno;close(socket_fd);socket_fd=-1;
    if(error!=ENOENT && error!=ECONNREFUSED)break;
    if(!spawn)break;
    if(!started) {
      pid_t pid;
      if((error=br_instance_spawn(canonical,&pid,owner_log)))break;
      started=1;
    }
    error=0;
    struct timespec pause={0,20000000};
    nanosleep(&pause,NULL);
  }
  free(canonical);
  free(owner_log);
  if(error && socket_fd>=0){close(socket_fd);socket_fd=-1;}
  *socket_out=socket_fd;
  return error;
}
static int br_instance_exchange(int socket_fd,BrInstanceFrame frame,const char *payload,int rights,BrInstanceFrame *answer) {
  int error=0;
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
  if(!error)error=br_read_all(socket_fd,answer,sizeof(*answer));
  return error;
}
/* Sends one database-level request. The reply must carry the published owner
   incarnation and epoch; a stale socket from an earlier owner is retried
   against the record that owner left. An owner binds its listener before it
   publishes its record, so a client can connect to a new owner while it still
   reads the previous incarnation's record: that window is retried, with the
   record read again each time, until the answer and the record agree. */
static int br_witness_decimal(const char *text,size_t length,uint64_t *value) {
  if(!text || !length || !value)return EINVAL;
  uint64_t result=0;
  for(size_t i=0;i<length;i++) {
    if(text[i]<'0' || text[i]>'9')return EINVAL;
    unsigned digit=(unsigned)(text[i]-'0');
    if(result>(UINT64_MAX-digit)/10)return ERANGE;
    result=result*10+digit;
  }
  *value=result;return 0;
}
static int br_owner_witness_parse(const char *text,uint64_t *token,uint64_t *epoch) {
  if(!text || !*text)return EINVAL;
  const char *colon=strchr(text,':');
  if(!colon || strchr(colon+1,':'))return EINVAL;
  int error=br_witness_decimal(text,(size_t)(colon-text),token);
  if(!error)error=br_witness_decimal(colon+1,strlen(colon+1),epoch);
  if(!error && (!*token || !*epoch))error=EINVAL;
  return error;
}
static int br_instance_request_witness(const char *database,BrInstanceFrame frame,const char *payload,int rights,BrInstanceFrame *reply,uint64_t expected_token,uint64_t expected_epoch) {
  if((expected_token==0)!=(expected_epoch==0))return EINVAL;
  int first=1;
  for(;;) {
    BrOwnerRecord record={0};
    int socket_fd=-1;
    int error=br_instance_connect(database,first,&record,&socket_fd);
    first=0;
    if(error)return error;
    if(expected_token && (record.token!=expected_token || record.epoch!=expected_epoch)) {
      close(socket_fd);return ESTALE;
    }
    frame.owner=record.token;frame.epoch=record.epoch;
    error=br_instance_exchange(socket_fd,frame,payload,rights,reply);
    close(socket_fd);
    if(error)return error;
    if(reply->owner && (reply->owner!=record.token || reply->epoch!=record.epoch))error=ESTALE;
    if(!error && !reply->error)return 0;
    if(error!=ESTALE && reply->error!=ESTALE)return error?error:reply->error;
    struct timespec pause={0,20000000};
    nanosleep(&pause,NULL);
  }
}
static int br_instance_request(const char *database,BrInstanceFrame frame,const char *payload,int rights,BrInstanceFrame *reply) {
  return br_instance_request_witness(database,frame,payload,rights,reply,0,0);
}
static void br_instance_owner_witness(BatonProcessCall *call,int spawn) {
  BrOwnerRecord record={0};BrInstanceFrame reply={0};int socket_fd=-1;
  call->error=br_instance_connect(call->database,spawn,&record,&socket_fd);
  if(!call->error) {
    call->error=br_instance_exchange(socket_fd,
      (BrInstanceFrame){.op=BI_ENSURE,.owner=record.token,.epoch=record.epoch},
      NULL,-1,&reply);
    if(!call->error && (reply.op!=BI_HELLO || reply.length!=sizeof(BrOwnerState)))
      call->error=EPROTO;
    if(!call->error && (reply.owner!=record.token || reply.epoch!=record.epoch))
      call->error=ESTALE;
  }
  if(socket_fd>=0)close(socket_fd);
  if(call->error)return;
  char text[64];
  int length=snprintf(text,sizeof(text),"%llu:%llu",
    (unsigned long long)reply.owner,(unsigned long long)reply.epoch);
  if(length<=0 || (size_t)length>=sizeof(text)){call->error=EOVERFLOW;return;}
  call->text=strdup(text);
  if(!call->text){call->error=ENOMEM;return;}
  call->length=(size_t)length;
}
static void br_identity_sha256(const char *text,size_t length,unsigned char digest[32]) {
  BrSha256 sha;br_sha256_init(&sha);
  br_sha256_update(&sha,(const unsigned char *)text,length);
  br_sha256_final(&sha,digest);
}
static int br_instance_decision(BatonProcessCall *call) {
  BatonRetained *retained=call->child?call->child->retained:NULL;
  if(!retained || !retained->database || !retained->directory)return EBADF;
  if(!call->identity || !call->identity_length || !call->text || !call->length ||
     strlen(call->identity)!=call->identity_length || strlen(call->text)!=call->length)return EINVAL;
  size_t path_length=strlen(retained->directory);
  if(path_length>SIZE_MAX-65)return EOVERFLOW;
  size_t payload_length=path_length+1+64;
  char *payload=malloc(payload_length);
  if(!payload)return ENOMEM;
  memcpy(payload,retained->directory,path_length+1);
  unsigned char *digests=(unsigned char *)payload+path_length+1;
  br_identity_sha256(call->identity,call->identity_length,digests);
  br_identity_sha256(call->text,call->length,digests+32);
  BrInstanceFrame reply={0};
  uint32_t op=call->kind==BP_INSTANCE_START?BI_START:BI_CANCEL;
  uint64_t expected_token=0,expected_epoch=0;
  int error=call->owner_witness && *call->owner_witness
    ? br_owner_witness_parse(call->owner_witness,&expected_token,&expected_epoch) : 0;
  if(!error && expected_token &&
     (expected_token!=retained->owner_incarnation || expected_epoch!=retained->owner_epoch))error=ESTALE;
  if(!error)error=br_instance_request_witness(retained->database,
    (BrInstanceFrame){.op=op,.length=payload_length},payload,-1,&reply,expected_token,expected_epoch);
  free(payload);
  if(!error && (reply.op!=BI_HELLO || reply.length!=sizeof(BrOwnerState)))error=EPROTO;
  if(!error && call->kind==BP_INSTANCE_START) {
    char *path=br_path(retained->directory,"native.pid");
    FILE *file=path?fopen(path,"r"):NULL;
    long pid=0;
    if(!file)error=path?errno:ENOMEM;
    else {
      if(fscanf(file,"%ld",&pid)!=1 || pid<=0 || pid>INT_MAX)error=EINVAL;
      fclose(file);
    }
    if(!error)call->child->pid=(pid_t)pid;
    free(path);
  }
  if(!error && call->kind==BP_INSTANCE_CANCEL && retained->guard>=0) {
    close(retained->guard);retained->guard=-1;
  }
  return error;
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
/* Joins an existing attempt as its observer, bound to the owner incarnation
   that resolved it. */
static int br_instance_join(BatonProcessCall *call,const char *directory,uint64_t incarnation,uint64_t epoch,int64_t observer) {
  int socket_fd=-1;
  int error=br_attempt_socket(directory,BR_ATTACH,0,observer,NULL,0,&socket_fd);
  if(!error) {
    error=br_attach_socket(call->child,directory,socket_fd,NULL,incarnation);socket_fd=-1;
    if(!error && call->child->retained) {
      call->child->retained->database=strdup(call->database);
      if(!call->child->retained->database)error=ENOMEM;
      call->child->retained->owner_incarnation=incarnation;
      call->child->retained->owner_epoch=epoch;
      call->child->retained->owner_attempt=call->owner_attempt;
    }
  }
  if(socket_fd>=0)close(socket_fd);
  return error;
}
/* Removes the attempt directory this call created when the owner refused and
   started no custody, so a retry can prepare it again. A refusal that may leave
   custody running (`EEXIST` for an already launched attempt, `EBUSY` for an
   attempt the owner already holds) is not cleaned. */
static void br_attempt_discard(char *directory,char *address) {
  if(address)unlink(address);
  if(!directory)return;
  char *spool=br_path(directory,"stdout");
  if(spool){unlink(spool);free(spool);}
  char *manifest=br_path(directory,"manifest");
  if(manifest){unlink(manifest);free(manifest);}
  rmdir(directory);
  if(address) {
    char *parent=strdup(address);
    if(parent) {
      char *slash=strrchr(parent,'/');
      if(slash){*slash=0;rmdir(parent);}
      free(parent);
    }
  }
}
/* Asks the owner for the attempt's custody, then joins as its observer. The
   owner refuses a second native child for an attempt that already launched. */
static int br_instance_admit(BatonProcessCall *call,int dormant) {
  char *directory=NULL,*address=NULL;
  BrInstanceFrame reply={0};
  int error=br_attempt_prepare(call,&directory,&address,1);
  if(!error) {
    uint64_t expected_token=0,expected_epoch=0;
    if(call->owner_witness && *call->owner_witness)
      error=br_owner_witness_parse(call->owner_witness,&expected_token,&expected_epoch);
    if(!error)error=br_instance_request_witness(call->database,
      (BrInstanceFrame){.op=dormant?BI_PREPARE:BI_ADMIT,.length=strlen(directory)+1},directory,
      call->lock?(int)call->lock:-1,&reply,expected_token,expected_epoch);
    if(!error)call->owner_attempt=reply.attempt;
    if(!error && reply.attempt)call->unstarted=0;
    if(error==EINVAL || error==ESTALE || error==ENOENT || error==ENOMEM) {
      /* Only an attempt this call created, that never reached custody, is
         discarded: the owner writes `launch` as its first custody step, so its
         absence proves no child started. A reused attempt and every uncertain
         attempt keep their manifest, control socket, spool and birth. */
      if(call->fresh && !br_exists(directory,"launch"))br_attempt_discard(directory,address);
      free(address);free(directory);
      return error;
    }
  }
  if(!error)error=br_instance_join(call,directory,reply.owner,reply.epoch,0);
  if(!error && dormant) {
    call->unstarted=0;
    br_instance_state_call(call);
  }
  free(address);free(directory);
  return error;
}
static int br_instance_attach_observer(BatonProcessCall *call,int64_t observer) {
  char *directory=realpath(call->directory,NULL);
  if(!directory)return errno;
  BrInstanceFrame reply={0};
  int error=br_instance_request(call->database,
    (BrInstanceFrame){.op=BI_ATTACH,.length=strlen(directory)+1},directory,-1,&reply);
  if(!error)error=br_instance_join(call,directory,reply.owner,reply.epoch,observer);
  free(directory);
  return error;
}
static int br_instance_attach(BatonProcessCall *call) {
  return br_instance_attach_observer(call,0);
}
static int br_instance_recover(BatonProcessCall *call) {
  if(!call || !call->database || !call->directory || !call->identity ||
     !call->owner_witness || !call->generation || !*call->identity ||
     !*call->owner_witness || !*call->generation)return EINVAL;
  char *directory=realpath(call->directory,NULL);
  if(!directory)return errno;
  uint64_t old_token=0,old_epoch=0,expected_token=0,expected_epoch=0;
  int error=br_owner_witness_parse(call->owner_witness,&old_token,&old_epoch);
  if(!error)error=br_owner_witness_parse(call->generation,&expected_token,&expected_epoch);
  size_t directory_length=strlen(directory)+1;
  size_t bootstrap_length=call->identity_length+1;
  size_t witness_length=strlen(call->owner_witness)+1;
  if(!error && (directory_length>UINT32_MAX || bootstrap_length>UINT32_MAX ||
      witness_length>UINT32_MAX || sizeof(BrRecoveryRequest)>SIZE_MAX-directory_length ||
      sizeof(BrRecoveryRequest)+directory_length>SIZE_MAX-bootstrap_length ||
      sizeof(BrRecoveryRequest)+directory_length+bootstrap_length>SIZE_MAX-witness_length))error=EOVERFLOW;
  size_t payload_length=error?0:sizeof(BrRecoveryRequest)+directory_length+bootstrap_length+witness_length;
  char *payload=!error?malloc(payload_length):NULL;
  if(!error && !payload)error=ENOMEM;
  if(!error) {
    BrRecoveryRequest request={(uint32_t)directory_length,(uint32_t)bootstrap_length,
      (uint32_t)witness_length,0};
    memcpy(payload,&request,sizeof(request));
    char *cursor=payload+sizeof(request);
    memcpy(cursor,directory,directory_length);cursor+=directory_length;
    memcpy(cursor,call->identity,call->identity_length);cursor[call->identity_length]=0;
    cursor+=bootstrap_length;
    memcpy(cursor,call->owner_witness,witness_length);
  }
  BrInstanceFrame reply={0};BrOwnerState state={0};BrOwnerRecord current={0};int socket_fd=-1;
  if(!error)error=br_instance_connect(call->database,0,&current,&socket_fd);
  if(!error && (current.token!=expected_token || current.epoch!=expected_epoch))error=ESTALE;
  if(!error)error=br_instance_exchange(socket_fd,
    (BrInstanceFrame){.op=BI_RECOVER,.owner=current.token,.epoch=current.epoch,
      .length=payload_length},payload,-1,&reply);
  free(payload);
  if(!error && (reply.owner!=current.token || reply.epoch!=current.epoch))error=ESTALE;
  if(!error && reply.op==BI_REPLY && reply.error)error=reply.error;
  if(!error && (reply.op!=BI_HELLO || reply.length!=sizeof(state) ||
      reply.state!=2))error=EPROTO;
  if(!error)error=br_read_all(socket_fd,&state,sizeof(state));
  if(socket_fd>=0)close(socket_fd);
  if(!error) {
    call->owner_attempt=reply.attempt;
    error=br_instance_join(call,directory,reply.owner,reply.epoch,0);
  }
  if(!error) {
    BrManifest manifest={0};BrBirth birth={0};uint64_t manifest_digest=0;
    error=br_manifest_read(directory,&manifest);
    if(!error)manifest_digest=br_manifest_digest(&manifest.header,manifest.field,manifest.count);
    if(!error)error=br_read_file(directory,"native.birth",&birth,sizeof(birth));
    char *escaped=!error?br_json_escape(directory):NULL;
    if(!error && !escaped)error=ENOMEM;
    uint64_t new_token=reply.owner,new_epoch=reply.epoch;
    const char *custody_mode=old_token==new_token && old_epoch==new_epoch?
      "same-owner-observer":"owner-rebound-monitor";
    const char *observation=state.status_known?"exited":"live";
    const char *terminal_status=state.status_known?"known":"unavailable";
    int needed=error?-1:snprintf(NULL,0,
      "{\"schema\":\"baton2-custody-transition-v1\",\"directory\":\"%s\","
      "\"oldOwnerWitness\":\"%s\",\"currentOwnerWitness\":\"%llu:%llu\","
      "\"attemptManifest\":\"%016llx\",\"ownerAttempt\":%llu,\"nativePid\":%d,\"nativeBirth\":\"%llu:%llu\","
      "\"custodyMode\":\"%s\",\"observation\":\"%s\",\"historicalGuard\":\"not-carried\","
      "\"terminalStatus\":\"%s\"}",escaped,call->owner_witness,
      (unsigned long long)new_token,(unsigned long long)new_epoch,
      (unsigned long long)manifest_digest,(unsigned long long)reply.attempt,birth.pid,
      (unsigned long long)birth.first,
      (unsigned long long)birth.second,
      custody_mode,
      observation,terminal_status);
    if(!error && needed<0)error=EIO;
    char *transition=!error?malloc((size_t)needed+1):NULL;
    if(!error && !transition)error=ENOMEM;
    int written=error?-1:snprintf(transition,(size_t)needed+1,
      "{\"schema\":\"baton2-custody-transition-v1\",\"directory\":\"%s\","
      "\"oldOwnerWitness\":\"%s\",\"currentOwnerWitness\":\"%llu:%llu\","
      "\"attemptManifest\":\"%016llx\",\"ownerAttempt\":%llu,\"nativePid\":%d,\"nativeBirth\":\"%llu:%llu\","
      "\"custodyMode\":\"%s\",\"observation\":\"%s\",\"historicalGuard\":\"not-carried\","
      "\"terminalStatus\":\"%s\"}",escaped,call->owner_witness,
      (unsigned long long)new_token,(unsigned long long)new_epoch,
      (unsigned long long)manifest_digest,(unsigned long long)reply.attempt,birth.pid,
      (unsigned long long)birth.first,(unsigned long long)birth.second,
      custody_mode,
      observation,terminal_status);
    if(!error && (written<0 || written!=needed))error=EIO;
    if(!error) {call->text=transition;transition=NULL;call->length=(size_t)written;}
    free(transition);
    free(escaped);br_manifest_free(&manifest);
  }
  free(directory);
  return error;
}
static int br_instance_attach_owned(BatonProcessCall *call) {
  char *directory=realpath(call->directory,NULL);
  if(!directory)return errno;
  BrInstanceFrame reply={0};
  int error=br_instance_request(call->database,
    (BrInstanceFrame){.op=BI_ATTACH,.length=strlen(directory)+1},directory,-1,&reply);
  if(!error) {
    error=br_instance_join(call,directory,reply.owner,reply.epoch,0);
    if(error==ECONNREFUSED || error==ENOENT || error==EPIPE || error==ECONNRESET)
      error=br_attach_orphan(call->child,directory,(int)call->lock);
  }
  else if(error==ENOENT || error==ECONNREFUSED || error==EPIPE || error==ECONNRESET) {
    /* A legacy keeper can still serve this attempt when the database owner
       has no record of it. Attach there to retain native input and completion. */
    int socket_fd=-1;
    error=br_attempt_socket(directory,BR_ATTACH,0,0,NULL,0,&socket_fd);
    if(!error) {
      error=br_attach_socket(call->child,directory,socket_fd,NULL,0);
      socket_fd=-1;
    }
    if(socket_fd>=0)close(socket_fd);
    if(error==ENOENT || error==ECONNREFUSED || error==EPIPE || error==ECONNRESET)
      error=br_attach_orphan(call->child,directory,(int)call->lock);
  }
  free(directory);
  return error;
}
/* A compact reference to a retained job: its owner-side identity when an owner
   holds it, its retained output extent, the committed checkpoint offset and the
   terminal status when it is recorded. One attempt has at most one observation
   owner; any number of callers can read the retained result through this
   reference, which is why a duplicate admission is not an EBUSY dead end. */
static int br_instance_job(BatonProcessCall *call) {
  char *directory=realpath(call->directory,NULL);
  if(!directory)return errno;
  BrOwnerRecord record={0};
  BrInstanceFrame reply={0};
  BrOwnerState state={0};
  int owner_known=0,socket_fd=-1,absent=0;
  int error=br_instance_connect(call->database,0,&record,&socket_fd);
  if(error==ENOENT || error==ECONNREFUSED || error==EINVAL) {absent=1;error=0;}
  if(!error && !absent) {
    BrInstanceFrame frame={.op=BI_ATTACH,.owner=record.token,.epoch=record.epoch,
      .length=strlen(directory)+1};
    error=br_instance_exchange(socket_fd,frame,directory,-1,&reply);
    if(!error) {
      /* An answering owner must answer with its own incarnation and a complete
         payload; anything else is a typed error, never silently unknown facts. */
      if(reply.owner!=record.token || reply.epoch!=record.epoch)error=ESTALE;
      else if(reply.error) {if(reply.error!=ENOENT)error=reply.error;}
      else if(reply.length!=sizeof(state))error=EPROTO;
      else if((error=br_read_all(socket_fd,&state,sizeof(state)))) {}
      else owner_known=1;
    }
  }
  if(socket_fd>=0)close(socket_fd);
  if(error) {free(directory);return error;}
  uint64_t spool_bytes=0,checkpoint_offset=0;
  int checkpoint_verified=0;
  int status=0,status_known=0;
  char *spool=br_path(directory,"stdout");
  struct stat info;
  int spool_fd=spool?open(spool,O_RDONLY|O_CLOEXEC):-1;
  if(spool_fd>=0 && !fstat(spool_fd,&info))spool_bytes=(uint64_t)info.st_size;
  if(spool_fd>=0 && !br_checkpoint_verified_offset(directory,spool_fd,&checkpoint_offset))
    checkpoint_verified=1;
  if(spool_fd>=0)close(spool_fd);
  free(spool);
  char *status_path=br_path(directory,"status");
  FILE *file=status_path?fopen(status_path,"r"):NULL;
  if(file) {if(fscanf(file,"%d",&status)==1)status_known=1;fclose(file);}
  free(status_path);
  if(!spool_bytes && owner_known)spool_bytes=state.spool_bytes;
  if(!checkpoint_verified && owner_known)checkpoint_offset=state.checkpoint_offset;
  if(!status_known && owner_known) {status=state.status;status_known=(int)state.status_known;}
  char text[288];
  int written=snprintf(text,sizeof(text),
    "{\"attempt\":%llu,\"generation\":%llu,\"spool_bytes\":%llu,\"checkpoint_offset\":%llu,"
    "\"checkpoint_verified\":%s,\"status\":%d,\"status_known\":%s,\"observing\":%s,"
    "\"owner_known\":%s}",
    (unsigned long long)(owner_known?state.attempt:0),
    (unsigned long long)(owner_known?state.generation:0),
    (unsigned long long)spool_bytes,(unsigned long long)checkpoint_offset,
    checkpoint_verified?"true":"false",status,
    status_known?"true":"false",
    owner_known&&state.observing?"true":"false",
    owner_known?"true":"false");
  call->text=malloc((size_t)written+1);
  if(!call->text) {free(directory);return ENOMEM;}
  memcpy(call->text,text,(size_t)written+1);
  call->length=(size_t)written;
  free(directory);
  return 0;
}
static int br_instance_shutdown(BatonProcessCall *call) {
  BrInstanceFrame reply;
  BrOwnerRecord record={0};
  int socket_fd=-1;
  int error=br_instance_connect(call->database,0,&record,&socket_fd);
  if(error==ENOENT || error==ECONNREFUSED || error==EINVAL)return 0;
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
  free(retained->directory);free(retained->database);free(retained);
  call->child->retained=NULL;
  baton_child_retire_slot(call);
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
/* Parses a non-negative decimal cursor. A durable change cursor is not a 32-bit
   quantity, so it crosses this boundary as text and a malformed or oversized
   value is refused here. */
static int br_parse_u64(const char *text,size_t length,uint64_t *value) {
  if(!text || !length)return EINVAL;
  uint64_t result=0;
  for(size_t i=0;i<length;i++) {
    if(text[i]<'0' || text[i]>'9')return EINVAL;
    uint64_t digit=(uint64_t)(text[i]-'0');
    if(result>(UINT64_MAX-digit)/10)return EOVERFLOW;
    result=result*10+digit;
  }
  *value=result;
  return 0;
}
/* Opens the committed-change subscription on the elected owner. The connection
   stays open as the notice channel, so the handle carries one notice per commit
   the owner publishes. */
static int br_instance_subscription(const char *database,uint64_t generation,uint64_t after_cursor,
                                    BrInstanceReady *ready,int *socket_out) {
  BrInstanceSubscribe request={.generation=generation,.after_cursor=after_cursor};
  int first=1;
  for(;;) {
    BrOwnerRecord record={0};
    int socket_fd=-1;
    BrInstanceFrame reply={0};
    int error=br_instance_connect(database,first,&record,&socket_fd);
    first=0;
    if(error)return error;
    BrInstanceFrame frame={.op=BI_SUBSCRIBE,.owner=record.token,.epoch=record.epoch,
      .length=sizeof(request)};
    error=br_instance_exchange(socket_fd,frame,(const char *)&request,-1,&reply);
    if(!error && (reply.owner!=record.token || reply.epoch!=record.epoch))error=ESTALE;
    if(!error && reply.error)error=reply.error;
    if(!error && (reply.op!=BI_READY || reply.length!=sizeof(*ready)))error=EPROTO;
    if(error==ESTALE) {
      /* The owner publishes its record after it binds its listener; read the
         record again while that window is open. */
      close(socket_fd);
      struct timespec pause={0,20000000};
      nanosleep(&pause,NULL);
      continue;
    }
    if(!error)error=br_read_all(socket_fd,ready,sizeof(*ready));
    if(error) {if(socket_fd>=0)close(socket_fd);socket_fd=-1;}
    *socket_out=socket_fd;
    return error;
  }
}
/* Waits for the next notice on a subscription. The notice carries the committed
   cursor high-water; the subscriber rereads rows from the database up to it. */
static int br_instance_notice(int socket_fd,BrInstanceNotice *notice,uint64_t *generation) {
  BrInstanceFrame frame;
  int error=br_read_all(socket_fd,&frame,sizeof(frame));
  if(error)return error;
  if(frame.op!=BI_NOTICE || frame.length!=sizeof(*notice))return EPROTO;
  if((error=br_read_all(socket_fd,notice,sizeof(*notice))))return error;
  if(generation)*generation=frame.epoch;
  return 0;
}
/* Publishes one committed change: the caller has already committed the
   transaction that produced this cursor. A commit that does not advance the
   high-water publishes nothing, and a rolled-back transaction never calls here. */
static int br_instance_publish(const char *database,uint64_t cursor) {
  BrInstanceCommit commit={.cursor=cursor};
  BrInstanceFrame reply={0};
  return br_instance_request(database,(BrInstanceFrame){.op=BI_COMMIT,.length=sizeof(commit)},
    (const char *)&commit,-1,&reply);
}
static void br_subscription_free(BatonRetained *retained) {
  if(!retained)return;
  if(retained->socket>=0)close(retained->socket);
  retained->socket=-1;
  free(retained->directory);free(retained->database);
  free(retained);
}
/* Woken-read design note: every wait round below blocks in poll with no
   timeout. The watcher thread only watches the spool condition and pokes a
   pipe; it never reads the subscription socket, so unreported notices stay
   buffered. The owner joins the watcher on every path before returning. A
   consumed notice always returns; only a silent spool with no notice
   re-waits, so the loop cannot spin. */
/* Bounded spool probe: returns 1 with one full line committed, 0 when the
   spool holds no full line and the child still runs, or -1 on error or end
   of output. Only a complete returned line or a real end of output commits
   spool bytes: a silent or failed probe leaves the offset and the call text
   exactly as found, so partial bytes survive notice-only returns and the
   next call re-scans from the same offset. Mirrors br_read_line byte
   handling but never blocks, so the caller can multiplex the wait. */
static int br_spool_try_line(BatonRetained *retained,BatonProcessCall *call) {
  size_t base=call->length;
  size_t staged=0;
  for(;;) {
    pthread_mutex_lock(&retained->state);
    int exited=retained->exited;
    call->error=retained->error;pthread_mutex_unlock(&retained->state);
    if(call->error) break;
    char chunk[8192];
    ssize_t n=pread(retained->spool,chunk,sizeof(chunk),retained->offset+(off_t)staged);
    if(n<0 && errno==EINTR) continue;
    if(n<0) {call->error=errno;break;}
    if(n==0) {
      pthread_mutex_lock(&retained->state);
      if(retained->error) call->error=retained->error;
      else if(exited) {
        /* End of output commits the tail, even partial, mirroring
           br_read_line; an empty tail reads as end of output. */
        retained->offset+=(off_t)staged;
        call->eof=call->length==0;
      }
      pthread_mutex_unlock(&retained->state);
      if(call->error || exited) return -1;
      break;
    }
    char *newline=memchr(chunk,'\n',(size_t)n);
    size_t count=newline?(size_t)(newline-chunk)+1:(size_t)n;
    if(count>SIZE_MAX-call->length-1) {call->error=EOVERFLOW;break;}
    char *buffer=realloc(call->text,call->length+count+1);
    if(!buffer) {call->error=ENOMEM;break;}
    call->text=buffer;
    memcpy(call->text+call->length,chunk,count);call->length+=count;
    call->text[call->length]=0;staged+=count;
    if(newline) {call->length--;retained->offset+=(off_t)staged;return 1;}
  }
  if(staged) {call->length=base;call->text[base]=0;}
  return call->error?-1:0;
}
typedef struct { BatonRetained *retained;uint64_t version;int wake;int done; } BrAwakeWatch;
/* Single-shot spool watcher: waits for spool progress, child exit or failure,
   then writes one byte so the owner's poll returns. Never reads the
   subscription socket, so buffered notices survive. The owner always joins
   this thread before returning, and stops it with done plus broadcast. */
static void *br_awake_watch(void *raw) {
  BrAwakeWatch *watch=(BrAwakeWatch *)raw;
  BatonRetained *retained=watch->retained;
  pthread_mutex_lock(&retained->state);
  while(!watch->done && watch->version==retained->version &&
        !retained->exited && !retained->error)
    pthread_cond_wait(&retained->changed,&retained->state);
  int progress=!watch->done &&
    (watch->version!=retained->version||retained->exited||retained->error);
  pthread_mutex_unlock(&retained->state);
  if(progress) {
    char byte=0;
    ssize_t written=write(watch->wake,&byte,1);
    (void)written;
  }
  return NULL;
}
/* read_awake: multiplexed read of a retained child spool with an instance
   subscription socket. Reports a spooled line when one is available; when
   the child is silent, blocks until a line arrives or a commit notice lands
   and reports both sides honestly: a full line wins, otherwise the
   notice-only wake returns with no spool bytes consumed. The subscription
   socket is only consumed through br_instance_notice after poll reports it
   readable, so unreported notices stay buffered for later calls. A dead
   subscription fails the call so the caller unsubscribes and falls back to
   a plain blocking read. The second effect argument carries the subscription
   child handle in call->signal; its table generation is verified, and the
   subscription outlives the call because the owner unsubscribes only after
   this call returns. A consumed notice is always reported, including at end
   of output; the Turn layer drains it and terminates on the following
   notice-free round. */
static void br_read_awake(BatonProcessCall *call) {
  BatonChild *child=call->child;
  BatonRetained *retained=child?child->retained:NULL;
  if(!retained || retained->spool<0) {call->error=EBADF;return;}
  /* Resolve the subscription child once: the owner unsubscribes only after
     this call returns, so the socket outlives the wait. The table slot is
     verified by generation, mirroring baton_process_begin. */
  u32 sub=call->signal;
  u32 index=sub&BATCHILD_INDEX_MASK;
  BatonChild *watch_child=index<baton_child_count?baton_children[index]:NULL;
  int sub_socket=-1;
  pthread_mutex_lock(&retained->reader);
  if(!watch_child) call->error=EBADF;
  else if(watch_child->generation!=(sub>>16)) call->error=ESTALE;
  else if(!watch_child->retained || watch_child->retained->socket<0) call->error=EBADF;
  else sub_socket=watch_child->retained->socket;
  if(call->error) {pthread_mutex_unlock(&retained->reader);return;}
  /* Loop invariant: retained->reader is held at the top. The spool version
     is captured before each scan, so output arriving between the scan and
     the watcher setup still advances past the watched version and fires
     instead of hanging. A consumed notice always returns; only a silent
     spool with no notice re-waits, and every re-wait blocks in poll, so the
     loop cannot spin. */
  int noticed=0;
  for(;;) {
    pthread_mutex_lock(&retained->state);
    uint64_t version=retained->version;
    pthread_mutex_unlock(&retained->state);
    int line=br_spool_try_line(retained,call);
    if(line!=0 || call->error || call->eof || noticed) {
      if(noticed && line==0) call->eof=1;
      if(!call->error) call->awake_alive=1;
      pthread_mutex_unlock(&retained->reader);return;
    }
    int wake[2]={-1,-1};
    if(baton_pipe(wake)) {call->error=errno;pthread_mutex_unlock(&retained->reader);return;}
    pthread_mutex_lock(&retained->state);
    BrAwakeWatch watch={retained,version,wake[1],0};
    pthread_t watcher;
    int spawned=pthread_create(&watcher,NULL,br_awake_watch,&watch);
    pthread_mutex_unlock(&retained->state);
    if(spawned) {close(wake[0]);close(wake[1]);call->error=spawned;pthread_mutex_unlock(&retained->reader);return;}
    pthread_mutex_unlock(&retained->reader);
    struct pollfd waits[2];
    waits[0].fd=sub_socket;waits[0].events=POLLIN;waits[0].revents=0;
    waits[1].fd=wake[0];waits[1].events=POLLIN;waits[1].revents=0;
    int ready;
    do { ready=poll(waits,2,-1); } while(ready<0 && errno==EINTR);
    int sub_event=ready>0 && (waits[0].revents&(POLLIN|POLLHUP));
    int error=0;
    if(ready<0) error=errno;
    else if(waits[0].revents&POLLNVAL) error=EBADF;
    else if((waits[0].revents&POLLERR) && !sub_event) error=EPIPE;
    /* Exactly one join on every path: stop a still-waiting watcher, reap
       an exited one. */
    pthread_mutex_lock(&retained->state);
    watch.done=1;
    pthread_cond_broadcast(&retained->changed);
    pthread_mutex_unlock(&retained->state);
    pthread_join(watcher,NULL);
    if(waits[1].revents&POLLIN) {
      char drained=0;
      ssize_t kept=read(wake[0],&drained,1);
      (void)kept;
    }
    close(wake[0]);close(wake[1]);
    pthread_mutex_lock(&retained->reader);
    if(error) {call->error=error;pthread_mutex_unlock(&retained->reader);return;}
    if(sub_event && !noticed) {
      BrInstanceNotice notice={0};uint64_t generation=0;
      int seen=br_instance_notice(sub_socket,&notice,&generation);
      if(seen) {call->error=seen;pthread_mutex_unlock(&retained->reader);return;}
      const char *kind=notice.kind==BN_COMMIT?"commit":notice.kind==BN_GAP?"gap":"unknown";
      char text[224];
      int written=snprintf(text,sizeof(text),
        "{\"kind\":\"%s\",\"cursor\":%llu,\"generation\":%llu}",kind,
        (unsigned long long)notice.cursor,(unsigned long long)generation);
      call->notice=malloc((size_t)written+1);
      if(!call->notice) {call->error=ENOMEM;pthread_mutex_unlock(&retained->reader);return;}
      memcpy(call->notice,text,(size_t)written+1);call->notice_length=(size_t)written;
      noticed=1;
    }
  }
}
static void br_instance_subscribe_call(BatonProcessCall *call) {
  uint64_t generation=0,after_cursor=0;
  int error=br_parse_u64(call->generation,call->generation?strlen(call->generation):0,&generation);
  if(!error)error=br_parse_u64(call->cursor,call->cursor?strlen(call->cursor):0,&after_cursor);
  BrInstanceReady ready={0};
  int socket_fd=-1;
  if(!error)error=br_instance_subscription(call->database,generation,after_cursor,&ready,&socket_fd);
  BatonRetained *retained=error?NULL:calloc(1,sizeof(*retained));
  if(!error && !retained)error=ENOMEM;
  if(error) {
    if(socket_fd>=0)close(socket_fd);
    call->error=error;
    return;
  }
  retained->socket=socket_fd;
  retained->spool=-1;retained->guard=-1;retained->watch=-1;retained->life=-1;
  retained->directory=strdup(call->database?call->database:"");
  retained->subscribe_generation=ready.generation;
  retained->subscribe_cursor=ready.cursor;
  retained->subscribe_gap=(int)ready.gap;
  if(!retained->directory) {
    br_subscription_free(retained);
    call->error=ENOMEM;
    return;
  }
  call->child->retained=retained;
  char text[224];
  int written=snprintf(text,sizeof(text),"{\"generation\":%llu,\"cursor\":%llu,\"gap\":%s}",
    (unsigned long long)ready.generation,(unsigned long long)ready.cursor,
    ready.gap?"true":"false");
  call->text=malloc((size_t)written+1);
  if(!call->text) {call->error=ENOMEM;return;}
  memcpy(call->text,text,(size_t)written+1);
  call->length=(size_t)written;
}
static void br_instance_notice_call(BatonProcessCall *call) {
  BatonRetained *retained=call->child?call->child->retained:NULL;
  if(!retained || retained->socket<0) {call->error=EBADF;return;}
  BrInstanceNotice notice={0};
  uint64_t generation=0;
  int error=br_instance_notice(retained->socket,&notice,&generation);
  if(error) {call->error=error;return;}
  const char *kind=notice.kind==BN_COMMIT?"commit":notice.kind==BN_GAP?"gap":"unknown";
  char text[192];
  int written=snprintf(text,sizeof(text),
    "{\"kind\":\"%s\",\"cursor\":%llu,\"generation\":%llu}",kind,
    (unsigned long long)notice.cursor,(unsigned long long)generation);
  call->text=malloc((size_t)written+1);
  if(!call->text) {call->error=ENOMEM;return;}
  memcpy(call->text,text,(size_t)written+1);
  call->length=(size_t)written;
}
/* Ends the subscription locally. The owner drops the connection when it reads
   the closed socket, so no request is needed and a dead owner costs nothing. */
static void br_instance_unsubscribe_call(BatonProcessCall *call) {
  if(!call->child) {call->error=EBADF;return;}
  br_subscription_free(call->child->retained);
  call->child->retained=NULL;
  baton_children[call->index]=NULL;
  free(call->child);
  call->child=NULL;
}
static void br_instance_publish_call(BatonProcessCall *call) {
  uint64_t cursor=0;
  int error=br_parse_u64(call->text,call->length,&cursor);
  if(!error)error=br_instance_publish(call->database,cursor);
  call->error=error;
}
static void br_hex(const unsigned char *bytes,size_t length,char *out) {
  static const char digits[]="0123456789abcdef";
  for(size_t i=0;i<length;i++) {out[i*2]=digits[bytes[i]>>4];out[i*2+1]=digits[bytes[i]&15];}
  out[length*2]=0;
}
static char *br_json_escape(const char *text) {
  size_t length=strlen(text);
  if(length>(SIZE_MAX-1)/6)return NULL;
  char *escaped=malloc(length*6+1);
  if(!escaped)return NULL;
  static const char hex[]="0123456789abcdef";
  size_t out=0;
  for(size_t i=0;i<length;i++) {
    unsigned char c=(unsigned char)text[i];
    if(c=='"' || c=='\\') {escaped[out++]='\\';escaped[out++]=(char)c;}
    else if(c<0x20) {
      escaped[out++]='\\';escaped[out++]='u';escaped[out++]='0';escaped[out++]='0';
      escaped[out++]=hex[c>>4];escaped[out++]=hex[c&15];
    } else escaped[out++]=(char)c;
  }
  escaped[out]=0;
  return escaped;
}
/* The observed facts of one attempt: the durable lifecycle state and identity, and
   the custody this observer holds. Everything reported here comes from a file the
   host wrote or from this process's own descriptors. */
static void br_instance_state_call(BatonProcessCall *call) {
  BatonRetained *retained=call->child?call->child->retained:NULL;
  if(!retained || !retained->directory) {call->error=EBADF;return;}
  BrLifecycle record;uint64_t pid=0;int status_known=0,status=0;
  const char *state=br_lifecycle_state(retained->directory,&record,&pid,&status_known,&status);
  pthread_mutex_lock(&retained->state);int status_unavailable=retained->unknown;
  pthread_mutex_unlock(&retained->state);
  if(retained->observer_only && status_unavailable)state="unavailable";
  uint64_t guard_device=0,guard_inode=0;
  struct stat info;
  if(retained->guard>=0 && !fstat(retained->guard,&info)) {
    guard_device=(uint64_t)info.st_dev;guard_inode=(uint64_t)info.st_ino;
  }
  char expected[65],grant[65],rejection[65];
  br_hex(record.expected,sizeof(record.expected),expected);
  br_hex(record.grant,sizeof(record.grant),grant);
  br_hex(record.rejection,sizeof(record.rejection),rejection);
  char *directory=br_json_escape(retained->directory);
  if(!directory){call->error=ENOMEM;return;}
  const char *format=
    "{\"schema\":\"baton2-host-ready-v1\",\"state\":\"%s\",\"handle\":%u,\"directory\":\"%s\","
    "\"ownerIncarnation\":%llu,\"ownerEpoch\":%llu,\"ownerAttempt\":%llu,\"guardDevice\":%llu,\"guardInode\":%llu,\"guard\":\"%llu:%llu\","
    "\"observer_ready\":%s,\"native_pid\":%llu,\"status_known\":%s,\"status\":%d,"
    "\"spawn_latched\":%s,\"cancelled\":%s,\"identity\":\"%s\",\"expectedBinding\":\"%s\","
    "\"grant\":\"%s\",\"rejection\":\"%s\"}";
  int needed=snprintf(NULL,0,format,
    state,(unsigned)call->handle,directory,
    (unsigned long long)retained->owner_incarnation,(unsigned long long)retained->owner_epoch,
    (unsigned long long)retained->owner_attempt,
    (unsigned long long)guard_device,(unsigned long long)guard_inode,
    (unsigned long long)guard_device,(unsigned long long)guard_inode,
    retained->socket>=0 && record.observer_ready?"true":"false",(unsigned long long)pid,
    status_known?"true":"false",status,
    record.latched?"true":"false",record.cancelled?"true":"false",
    br_lifecycle_has_expected(&record)?"fixed":"none",
    br_lifecycle_has_expected(&record)?expected:"",grant,rejection);
  if(needed<0){free(directory);call->error=EOVERFLOW;return;}
  size_t capacity=(size_t)needed+1;
  call->text=malloc(capacity);
  if(!call->text) {free(directory);call->error=ENOMEM;return;}
  int written=snprintf(call->text,capacity,format,
    state,(unsigned)call->handle,directory,
    (unsigned long long)retained->owner_incarnation,(unsigned long long)retained->owner_epoch,
    (unsigned long long)retained->owner_attempt,
    (unsigned long long)guard_device,(unsigned long long)guard_inode,
    (unsigned long long)guard_device,(unsigned long long)guard_inode,
    retained->socket>=0 && record.observer_ready?"true":"false",(unsigned long long)pid,
    status_known?"true":"false",status,
    record.latched?"true":"false",record.cancelled?"true":"false",
    br_lifecycle_has_expected(&record)?"fixed":"none",
    br_lifecycle_has_expected(&record)?expected:"",grant,rejection);
  free(directory);
  if(written<0 || written!=needed){free(call->text);call->text=NULL;call->error=EOVERFLOW;return;}
  call->length=(size_t)written;
}
static void baton_retained_begin_call(BatonProcessCall *call) {
  if(call->kind==BP_RECOVERY)call->error=br_recovery(call);
  else if(call->kind==BP_KEEPER) call->error=br_keeper(call->directory,(int)call->lock);
  else if(call->kind==BP_RETAIN) call->error=br_retain(call);
  else if(call->kind==BP_RETAIN_WITH_FILE) call->error=br_retain(call);
  else if(call->kind==BP_INSTANCE_OWNER) call->error=br_owner_serve(call->database);
  else if(call->kind==BP_INSTANCE_ADMIT) call->error=br_instance_admit(call,0);
  else if(call->kind==BP_INSTANCE_ADMIT_WITH_FILE) call->error=br_instance_admit(call,0);
  else if(call->kind==BP_INSTANCE_PREPARE) call->error=br_instance_admit(call,1);
  else if(call->kind==BP_INSTANCE_PREPARE_WITH_FILE) call->error=br_instance_admit(call,1);
  else if(call->kind==BP_INSTANCE_ATTACH) call->error=br_instance_attach(call);
  else if(call->kind==BP_INSTANCE_ATTACH_OWNED) call->error=br_instance_attach_owned(call);
  else if(call->kind==BP_INSTANCE_SHUTDOWN) call->error=br_instance_shutdown(call);
  else if(call->kind==BP_INSTANCE_JOB) call->error=br_instance_job(call);
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
        if(attach) {call->error=br_attach_socket(call->child,directory,socket_fd,NULL,0);socket_fd=-1;}
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
    char *socket=NULL;
    int have_socket=call->database && !br_instance_socket_for(call->database,&socket);
    const char *format=have_socket?
      "%s %s%s%s at %s: %s; inspect manifest, keeper-error and observer.log":
      "%s %s%s%s: %s; inspect manifest, keeper-error and observer.log";
    int needed=have_socket?
      snprintf(NULL,0,format,operation,call->database,call->database?" ":"",
        call->directory?call->directory:"",socket,strerror(call->error)):
      snprintf(NULL,0,format,operation,call->database?call->database:"",call->database?" ":"",
        call->directory?call->directory:"",strerror(call->error));
    if(needed>=0)call->detail=malloc((size_t)needed+1);
    if(call->detail) {
      int written=have_socket?
        snprintf(call->detail,(size_t)needed+1,format,operation,call->database,call->database?" ":"",
          call->directory?call->directory:"",socket,strerror(call->error)):
        snprintf(call->detail,(size_t)needed+1,format,operation,call->database?call->database:"",call->database?" ":"",
          call->directory?call->directory:"",strerror(call->error));
      if(written!=needed){free(call->detail);call->detail=NULL;}
    }
    free(socket);
  }
}

static void baton_process_call(IoWork *w) {
  BatonProcessCall *call=(BatonProcessCall *)w->data;
  BatonChild *child=call->child;
  if(call->kind==BP_INSTANCE_RETIRE && child->retained &&
     child->retained->observer_only) { call->error=EPERM;return; }
  if(call->kind==BP_SPAWN) { baton_child_spawn(call);return; }
  if(call->kind==BP_INSTANCE_RECOVER) { call->error=br_instance_recover(call);return; }
  if(call->kind==BP_INSTANCE_OWNER_WITNESS) { br_instance_owner_witness(call,0);return; }
  if(call->kind==BP_INSTANCE_ENSURE_OWNER_WITNESS) { br_instance_owner_witness(call,1);return; }
  if(call->kind==BP_INSTANCE_SUBSCRIBE) { br_instance_subscribe_call(call);return; }
  if(call->kind==BP_INSTANCE_NOTICE) { br_instance_notice_call(call);return; }
  if(call->kind==BP_INSTANCE_UNSUBSCRIBE) { br_instance_unsubscribe_call(call);return; }
  if(call->kind==BP_INSTANCE_PUBLISH) { br_instance_publish_call(call);return; }
  if(call->kind==BP_RETAIN || call->kind==BP_ATTACH || call->kind==BP_ATTACH_OWNED || call->kind==BP_RECOVERY || call->kind==BP_KEEPER || call->kind==BP_CONTROL_WRITE || call->kind==BP_CONTROL_SIGNAL ||
     call->kind==BP_INSTANCE_OWNER || call->kind==BP_INSTANCE_ADMIT || call->kind==BP_INSTANCE_ATTACH || call->kind==BP_INSTANCE_ATTACH_OWNED ||
     call->kind==BP_INSTANCE_PREPARE || call->kind==BP_INSTANCE_PREPARE_WITH_FILE ||
     call->kind==BP_INSTANCE_SHUTDOWN || call->kind==BP_INSTANCE_RETIRE ||
     call->kind==BP_RETAIN_WITH_FILE || call->kind==BP_INSTANCE_ADMIT_WITH_FILE) {
    baton_retained_begin_call(call);return;
  }
  if(call->kind==BP_READ_AWAKE && child->retained) {br_read_awake(call);return;}
  if(child->retained) { baton_retained_call(call);return; }
  if(call->kind==BP_RELEASE || call->kind==BP_ACK || call->kind==BP_INSTANCE_COMMIT ||
     call->kind==BP_INSTANCE_RESTORE || call->kind==BP_INSTANCE_REPLAY) { call->error=EINVAL;return; }
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
  } else if(call->kind==BP_READ || call->kind==BP_READ_AWAKE) {
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
    else if(call->kind==BP_INSTANCE_STATE || call->kind==BP_INSTANCE_RESTORE || call->kind==BP_INSTANCE_JOB ||
            call->kind==BP_INSTANCE_NOTICE || call->kind==BP_INSTANCE_OWNER_WITNESS ||
            call->kind==BP_INSTANCE_ENSURE_OWNER_WITNESS)
      value=io_str(e,call->text?call->text:"",call->length);
    else if(call->kind==BP_INSTANCE_RECOVER)
      value=io_tup(e,(Term)call->handle,io_str(e,call->text?call->text:"",call->length));
    else if(call->kind==BP_INSTANCE_PREPARE || call->kind==BP_INSTANCE_PREPARE_WITH_FILE)
      value=io_tup(e,(Term)call->handle,io_tup(e,
        io_str(e,call->identity?call->identity:"",call->identity_length),
        io_str(e,call->text?call->text:"",call->length)));
#ifdef CID_SOME
    else if(call->kind==BP_READ || call->kind==BP_RECOVERY) value=call->eof ? term_pak(CID_NONE,0)
      : io_box(e,CID_SOME,io_str(e,call->text,call->length));
#endif
#ifdef CID_PROCESSCHILD_READ_AWAKE
#ifdef CID_SOME
    else if(call->kind==BP_READ_AWAKE)
      value=io_tup(e,
        call->eof ? term_pak(CID_NONE,0)
        : io_box(e,CID_SOME,io_str(e,call->text?call->text:"",call->length)),
        io_tup(e,io_str(e,call->notice?call->notice:"",call->notice_length),(Term)call->awake_alive));
#endif
#endif
  }
#ifdef CID_PROCESSCHILD_RETAIN_WITH_FILE
  if(call->kind==BP_RETAIN_WITH_FILE && (!call->error || call->unstarted)) {
    const char *error=call->detail?call->detail:strerror(call->error);
    value=io_tup(e,call->unstarted?term_pak(CID_NONE,0):io_box(e,CID_SOME,(Term)call->handle),
      io_str(e,call->unstarted?error:"",call->unstarted?strlen(error):0));
  }
#endif
#ifdef CID_INSTANCE_ADMIT_WITH_FILE_START
  if(call->kind==BP_INSTANCE_ADMIT_WITH_FILE && (!call->error || call->unstarted)) {
    const char *error=call->detail?call->detail:strerror(call->error);
    value=io_tup(e,call->unstarted?term_pak(CID_NONE,0):io_box(e,CID_SOME,(Term)call->handle),
      io_str(e,call->unstarted?error:"",call->unstarted?strlen(error):0));
  }
#endif
#ifdef CID_PROCESSCHILD_RETAIN_START
  if(call->kind==BP_RETAIN && (!call->error || call->unstarted)) {
    const char *error=call->detail?call->detail:strerror(call->error);
    value=io_tup(e,call->unstarted?term_pak(CID_NONE,0):io_box(e,CID_SOME,(Term)call->handle),
      io_str(e,call->unstarted?error:"",call->unstarted?strlen(error):0));
  }
#endif
#ifdef CID_INSTANCE_ADMIT_START
  if(call->kind==BP_INSTANCE_ADMIT && (!call->error || call->unstarted)) {
    const char *error=call->detail?call->detail:strerror(call->error);
    value=io_tup(e,call->unstarted?term_pak(CID_NONE,0):io_box(e,CID_SOME,(Term)call->handle),
      io_str(e,call->unstarted?error:"",call->unstarted?strlen(error):0));
  }
#endif
#ifdef CID_INSTANCE_SUBSCRIBE
  if(call->kind==BP_INSTANCE_SUBSCRIBE && !call->error)
    value=io_tup(e,(Term)call->handle,io_str(e,call->text?call->text:"",call->length));
#endif
  int preparation=call->kind==BP_INSTANCE_PREPARE || call->kind==BP_INSTANCE_PREPARE_WITH_FILE;
  Term result=call->error && (preparation || !call->unstarted) ? io_fail(e,call->error,call->detail) : io_done(e,value);
  if((call->kind==BP_SPAWN || call->kind==BP_RETAIN || call->kind==BP_ATTACH || call->kind==BP_ATTACH_OWNED ||
      call->kind==BP_INSTANCE_ADMIT || call->kind==BP_INSTANCE_PREPARE || call->kind==BP_INSTANCE_ATTACH || call->kind==BP_INSTANCE_ATTACH_OWNED ||
      call->kind==BP_RETAIN_WITH_FILE || call->kind==BP_INSTANCE_ADMIT_WITH_FILE || call->kind==BP_INSTANCE_PREPARE_WITH_FILE ||
      call->kind==BP_INSTANCE_SUBSCRIBE || call->kind==BP_INSTANCE_RECOVER) && call->error) {
    if(call->child && call->child->retained)br_subscription_free(call->child->retained);
    if(call->child)call->child->retained=NULL;
    baton_children[call->index]=NULL;
    free(call->child);call->child=NULL;
  }
  free(call->args);free(call->cwd);free(call->log);free(call->text);
  free(call->directory);free(call->initial);free(call->recovery);free(call->detail);free(call->database);free(call->notice);
  free(call->artifact_name);free(call->artifact);free(call->identity);free(call->owner_witness);free(call->cursor);free(call->generation);free(call);
  w->data=NULL;
  return result;
}

static Term baton_process_begin(Env e, Term *f, IoWork *w, int kind) {
  BatonProcessCall *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  int acquire=kind==BP_SPAWN || kind==BP_RETAIN || kind==BP_ATTACH || kind==BP_ATTACH_OWNED ||
              kind==BP_INSTANCE_ADMIT || kind==BP_INSTANCE_PREPARE || kind==BP_INSTANCE_ATTACH || kind==BP_INSTANCE_ATTACH_OWNED || kind==BP_INSTANCE_RECOVER ||
              kind==BP_RETAIN_WITH_FILE || kind==BP_INSTANCE_ADMIT_WITH_FILE || kind==BP_INSTANCE_PREPARE_WITH_FILE ||
              kind==BP_INSTANCE_SUBSCRIBE;
  call->kind=kind;
  if(acquire) {
    int error=baton_child_allocate(call);
    if(error) {free(call);return io_fail(e,(u32)error,NULL);}
  }
  if(kind==BP_RETAIN_WITH_FILE || kind==BP_INSTANCE_ADMIT_WITH_FILE || kind==BP_INSTANCE_PREPARE_WITH_FILE) {
    int base=kind==BP_RETAIN_WITH_FILE?0:1;
    u64 length=0,cwd_length=0,log_length=0;
    if(base)call->database=io_cstr(e,f[0],&length);
    call->directory=io_cstr(e,f[base],&length);
    call->args=io_cstr(e,f[base+1],&length);call->length=length;
    call->cwd=io_cstr(e,f[base+2],&cwd_length);
    call->log=io_cstr(e,f[base+3],&log_length);
    call->artifact_name=io_cstr(e,f[base+4],&length);call->artifact_name_length=length;
    call->artifact=io_cstr(e,f[base+5],&length);call->artifact_length=length;
    call->initial=io_cstr(e,f[base+6],&length);call->initial_length=length;
    call->keep_stdin=(u32)f[base+7];call->lock=(u32)f[base+8];
    call->recovery=io_cstr(e,f[base+9],&length);call->recovery_length=length;
    if(kind==BP_INSTANCE_PREPARE_WITH_FILE) {
      call->identity=io_cstr(e,f[base+10],&length);call->identity_length=length;
      call->owner_witness=io_cstr(e,f[base+11],&length);
      if(!call->owner_witness || strlen(call->owner_witness)!=length)call->error=EINVAL;
    }
    if(strlen(call->cwd)!=cwd_length || strlen(call->log)!=log_length) call->error=EINVAL;
  } else if(kind==BP_SPAWN || kind==BP_RETAIN || kind==BP_INSTANCE_ADMIT || kind==BP_INSTANCE_PREPARE) {
    int offset=kind==BP_SPAWN?0:(kind==BP_RETAIN?1:2);
    u64 length=0,cwd_length=0,log_length=0;
    if(kind==BP_INSTANCE_ADMIT || kind==BP_INSTANCE_PREPARE)call->database=io_cstr(e,f[0],&length);
    call->args=io_cstr(e,f[offset],&length);call->length=length;
    call->cwd=io_cstr(e,f[offset+1],&cwd_length);
    call->log=io_cstr(e,f[offset+2],&log_length);
    if(strlen(call->cwd)!=cwd_length || strlen(call->log)!=log_length) call->error=EINVAL;
    if(kind==BP_RETAIN) {
      call->initial=io_cstr(e,f[4],&length);call->initial_length=length;
      call->keep_stdin=(u32)f[5];call->lock=(u32)f[6];
      call->recovery=io_cstr(e,f[7],&length);call->recovery_length=length;
    } else if(kind==BP_INSTANCE_ADMIT || kind==BP_INSTANCE_PREPARE) {
      call->initial=io_cstr(e,f[5],&length);call->initial_length=length;
      call->keep_stdin=(u32)f[6];call->lock=(u32)f[7];
      call->recovery=io_cstr(e,f[8],&length);call->recovery_length=length;
      if(kind==BP_INSTANCE_PREPARE) {
        call->identity=io_cstr(e,f[9],&length);call->identity_length=length;
        call->owner_witness=io_cstr(e,f[10],&length);
        if(!call->owner_witness || strlen(call->owner_witness)!=length)call->error=EINVAL;
      }
    }
  }
  if(kind==BP_RETAIN || kind==BP_INSTANCE_ADMIT || kind==BP_INSTANCE_PREPARE) {
    u64 length=0;call->directory=io_cstr(e,f[kind==BP_RETAIN?0:1],&length);
    if(strlen(call->directory)!=length)call->error=EINVAL;
  } else if(kind==BP_ATTACH || kind==BP_ATTACH_OWNED || kind==BP_RECOVERY || kind==BP_KEEPER ||
            kind==BP_CONTROL_WRITE || kind==BP_CONTROL_SIGNAL) {
    u64 length=0;call->directory=io_cstr(e,f[0],&length);
    if(strlen(call->directory)!=length)call->error=EINVAL;
    if(kind==BP_KEEPER || kind==BP_ATTACH_OWNED)call->lock=(u32)f[1];
    if(kind==BP_CONTROL_WRITE) {call->text=io_cstr(e,f[1],&length);call->length=length;}
    if(kind==BP_CONTROL_SIGNAL)call->signal=(u32)f[1];
  } else if(kind==BP_INSTANCE_OWNER || kind==BP_INSTANCE_SHUTDOWN ||
            kind==BP_INSTANCE_OWNER_WITNESS || kind==BP_INSTANCE_ENSURE_OWNER_WITNESS) {
    u64 length=0;call->database=io_cstr(e,f[0],&length);
    if(strlen(call->database)!=length)call->error=EINVAL;
  } else if(kind==BP_INSTANCE_SUBSCRIBE || kind==BP_INSTANCE_PUBLISH) {
    u64 length=0;call->database=io_cstr(e,f[0],&length);
    if(kind==BP_INSTANCE_SUBSCRIBE) {
      /* The durable cursor crosses as decimal text: this dialect has no 64-bit
         integer type, and a truncated cursor would resume the wrong range. */
      call->cursor=io_cstr(e,f[1],&length);
      call->generation=io_cstr(e,f[2],&length);
    } else {call->text=io_cstr(e,f[1],&length);call->length=length;}
  } else if(kind==BP_INSTANCE_ATTACH || kind==BP_INSTANCE_ATTACH_OWNED || kind==BP_INSTANCE_RECOVER || kind==BP_INSTANCE_JOB) {
    u64 length=0;call->database=io_cstr(e,f[0],&length);
    call->directory=io_cstr(e,f[1],&length);
    if(strlen(call->directory)!=length)call->error=EINVAL;
    if(kind==BP_INSTANCE_ATTACH_OWNED)call->lock=(u32)f[2];
    if(kind==BP_INSTANCE_RECOVER) {
      call->identity=io_cstr(e,f[2],&call->identity_length);
      u64 witness_length=0,current_length=0;
      call->owner_witness=io_cstr(e,f[3],&witness_length);
      call->generation=io_cstr(e,f[4],&current_length);
      if(!call->identity || strlen(call->identity)!=call->identity_length ||
         !call->owner_witness || strlen(call->owner_witness)!=witness_length ||
         !call->generation || strlen(call->generation)!=current_length)call->error=EINVAL;
    }
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
    if(kind==BP_INSTANCE_COMMIT) {
      call->signal=(u32)f[1];
      u64 length=0;call->text=io_cstr(e,f[2],&length);call->length=length;
    }
    if(kind==BP_INSTANCE_START || kind==BP_INSTANCE_CANCEL) {
      u64 length=0;
      call->identity=io_cstr(e,f[1],&length);call->identity_length=length;
      call->text=io_cstr(e,f[2],&length);call->length=length;
      call->owner_witness=io_cstr(e,f[3],&length);
      if(!call->identity || !call->text || !call->owner_witness ||
         strlen(call->identity)!=call->identity_length || strlen(call->text)!=call->length ||
         strlen(call->owner_witness)!=length)call->error=EINVAL;
    }
    if(kind==BP_INSTANCE_RESTORE) call->signal=(u32)f[1];
    if(kind==BP_SIGNAL) call->signal=(u32)f[1];
    if(kind==BP_READ_AWAKE) call->signal=(u32)f[1];
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
#ifdef CID_PROCESSCHILD_READ_AWAKE
BP_EFFECT(baton_process_read_awake,CID_PROCESSCHILD_READ_AWAKE,BP_READ_AWAKE)
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
#ifdef CID_INSTANCE_OWNER_WITNESS
BP_EFFECT(baton_instance_owner_witness,CID_INSTANCE_OWNER_WITNESS,BP_INSTANCE_OWNER_WITNESS)
#endif
#ifdef CID_INSTANCE_ENSURE_OWNER_WITNESS
BP_EFFECT(baton_instance_ensure_owner_witness,CID_INSTANCE_ENSURE_OWNER_WITNESS,BP_INSTANCE_ENSURE_OWNER_WITNESS)
#endif
#ifdef CID_INSTANCE_ADMIT_START
BP_EFFECT(baton_instance_admit,CID_INSTANCE_ADMIT_START,BP_INSTANCE_ADMIT)
#endif
#ifdef CID_INSTANCE_PREPARE_START
BP_EFFECT(baton_instance_prepare,CID_INSTANCE_PREPARE_START,BP_INSTANCE_PREPARE)
#endif
#ifdef CID_INSTANCE_PREPARE_WITH_FILE_START
BP_EFFECT(baton_instance_prepare_with_file,CID_INSTANCE_PREPARE_WITH_FILE_START,BP_INSTANCE_PREPARE_WITH_FILE)
#endif
#ifdef CID_INSTANCE_START
BP_EFFECT(baton_instance_start,CID_INSTANCE_START,BP_INSTANCE_START)
#endif
#ifdef CID_INSTANCE_CANCEL
BP_EFFECT(baton_instance_cancel,CID_INSTANCE_CANCEL,BP_INSTANCE_CANCEL)
#endif
#ifdef CID_INSTANCE_STATE
BP_EFFECT(baton_instance_state,CID_INSTANCE_STATE,BP_INSTANCE_STATE)
#endif
#ifdef CID_INSTANCE_ATTACH
BP_EFFECT(baton_instance_attach,CID_INSTANCE_ATTACH,BP_INSTANCE_ATTACH)
#endif
#ifdef CID_INSTANCE_ATTACH_OWNED
BP_EFFECT(baton_instance_attach_owned,CID_INSTANCE_ATTACH_OWNED,BP_INSTANCE_ATTACH_OWNED)
#endif
#ifdef CID_INSTANCE_RECOVER
BP_EFFECT(baton_instance_recover,CID_INSTANCE_RECOVER,BP_INSTANCE_RECOVER)
#endif
#ifdef CID_INSTANCE_SHUTDOWN
BP_EFFECT(baton_instance_shutdown,CID_INSTANCE_SHUTDOWN,BP_INSTANCE_SHUTDOWN)
#endif
#ifdef CID_INSTANCE_RETIRE
BP_EFFECT(baton_instance_retire,CID_INSTANCE_RETIRE,BP_INSTANCE_RETIRE)
#endif
#ifdef CID_INSTANCE_COMMIT
BP_EFFECT(baton_instance_commit,CID_INSTANCE_COMMIT,BP_INSTANCE_COMMIT)
#endif
#ifdef CID_INSTANCE_RESTORE
BP_EFFECT(baton_instance_restore,CID_INSTANCE_RESTORE,BP_INSTANCE_RESTORE)
#endif
#ifdef CID_INSTANCE_REPLAY
BP_EFFECT(baton_instance_replay,CID_INSTANCE_REPLAY,BP_INSTANCE_REPLAY)
#endif
#ifdef CID_INSTANCE_JOB
BP_EFFECT(baton_instance_job,CID_INSTANCE_JOB,BP_INSTANCE_JOB)
#endif
#ifdef CID_PROCESSCHILD_RETAIN_WITH_FILE
BP_EFFECT(baton_process_retain_with_file,CID_PROCESSCHILD_RETAIN_WITH_FILE,BP_RETAIN_WITH_FILE)
#endif
#ifdef CID_INSTANCE_ADMIT_WITH_FILE_START
BP_EFFECT(baton_instance_admit_with_file,CID_INSTANCE_ADMIT_WITH_FILE_START,BP_INSTANCE_ADMIT_WITH_FILE)
#endif
#ifdef CID_INSTANCE_SUBSCRIBE
BP_EFFECT(baton_instance_subscribe,CID_INSTANCE_SUBSCRIBE,BP_INSTANCE_SUBSCRIBE)
#endif
#ifdef CID_INSTANCE_NOTICE
BP_EFFECT(baton_instance_notice,CID_INSTANCE_NOTICE,BP_INSTANCE_NOTICE)
#endif
#ifdef CID_INSTANCE_UNSUBSCRIBE
BP_EFFECT(baton_instance_unsubscribe,CID_INSTANCE_UNSUBSCRIBE,BP_INSTANCE_UNSUBSCRIBE)
#endif
#ifdef CID_INSTANCE_PUBLISH_COMMIT
BP_EFFECT(baton_instance_publish_commit,CID_INSTANCE_PUBLISH_COMMIT,BP_INSTANCE_PUBLISH)
#endif

#undef BP_EFFECT
static void __attribute__((constructor)) baton_process_signals(void){signal(SIGPIPE,SIG_IGN);}

/* Session locks use the physical database key and the owner IPC namespace. */
#if defined(CID_SESSIONLOCK_CANONICAL) || defined(CID_SESSIONLOCK_TRY_ACQUIRE) || defined(CID_SESSIONLOCK_WAIT_ACQUIRE) || defined(CID_SESSIONLOCK_RELEASE) || defined(CID_SESSIONLOCK_EXECUTABLE) || defined(CID_SESSIONLOCK_RECOVER_OBSERVER)
typedef struct {
  char *database, *session, *path, *directory;
  const char *detail;
  int handle, error, kind, keeper;
  u32 observer;
  BatonProcessCall attempt;
} BatonSessionLock;

static int baton_observer_completed(BatonSessionLock *call) {
  if(call->observer<=1 || call->observer>INT_MAX || call->observer==(u32)getpid())return EINVAL;
  int error=br_admission_verify(call->directory,call->database,call->handle);
  if(error)return error;
  char *path=br_path(call->directory,"status");
  FILE *file=path?fopen(path,"r"):NULL;
  error=file?0:path?errno:ENOMEM;
  free(path);
  int status=0;
  if(file) {
    if(fscanf(file,"%d",&status)!=1)error=EINVAL;
    else if(!WIFEXITED(status) && !WIFSIGNALED(status))error=EBUSY;
    fclose(file);
  }
  if(error) {call->detail="Observer recovery requires the retained native exit status.";return error;}
  BrBirth native;
  if((error=br_read_file(call->directory,"native.birth",&native,sizeof(native))))return error;
  if(call->observer==(u32)native.pid)return EINVAL;
  BrManifest manifest={0};
  if((error=br_manifest_read(call->directory,&manifest))) {
    br_manifest_free(&manifest);return error;
  }
  struct sockaddr_un address;
  error=br_socket_address(&address,manifest.field[5]);
  br_manifest_free(&manifest);
  int probe=error?-1:socket(AF_UNIX,SOCK_STREAM,0);
  if(!error && probe<0)error=errno;
  if(!error) {
    if(!connect(probe,(struct sockaddr *)&address,sizeof(address))) {
      call->keeper=1;
    } else {
      error=errno;
      if(error==ENOENT || error==ECONNREFUSED)error=0;
    }
  }
  if(probe>=0)close(probe);
  return error;
}

static int baton_observer_retire(BatonSessionLock *call) {
  int ended=0,life=br_process_lifetime((pid_t)call->observer,&ended);
  if(life<0 && !ended)return errno;
  int error=0;
  if(kill((pid_t)call->observer,SIGTERM) && errno!=ESRCH)error=errno;
  if(!error && kill((pid_t)call->observer,SIGCONT) && errno!=ESRCH)error=errno;
  if(!error && life>=0) {
    struct pollfd observed={life,POLLIN,0};
    int ready;do {ready=poll(&observed,1,-1);}while(ready<0 && errno==EINTR);
    if(ready<0)error=errno;
  }
  if(life>=0)close(life);
  return error;
}

static int baton_observer_recover(BatonSessionLock *call) {
  int error=baton_observer_completed(call);
  if(error)return error;
  call->attempt.database=call->database;
  call->attempt.directory=call->directory;
  call->attempt.lock=(u32)call->handle;
  if(call->keeper) {
    error=br_instance_attach_observer(&call->attempt,call->observer);
    if(error==EBUSY) {
      /* Older keepers use ordinary attachment after observer exit. */
      error=baton_observer_retire(call);
      if(!error)error=br_instance_attach(&call->attempt);
    } else if(!error)error=baton_observer_retire(call);
    if(error==EBUSY)call->detail="Another observer holds the retained attempt; inspect its current receive.";
    if(!error) {
      int guard=call->attempt.child->retained->guard;
      if(guard>=0) {
        int owned=fcntl(guard,F_DUPFD_CLOEXEC,10);
        if(owned<0)return errno;
        close(call->handle);call->handle=owned;
        return 0;
      }
    } else if(error!=ENOENT && error!=ECONNREFUSED && error!=EPIPE && error!=ECONNRESET)return error;
  }
  if(!call->attempt.child->retained && (error=baton_observer_retire(call)))return error;
  int held;do {held=flock(call->handle,LOCK_EX);}while(held<0 && errno==EINTR);
  if(held<0)return errno;
  return call->attempt.child->retained?0:br_instance_attach_owned(&call->attempt);
}

static void baton_session_lock_call(IoWork *w) {
  BatonSessionLock *call=(BatonSessionLock *)w->data;
  if(call->kind==1) {
    if(close(call->handle)) call->error=errno;
    return;
  }
  if(call->kind==4) {
    call->path=realpath(call->database,NULL);
    if(!call->path) call->error=errno;
    return;
  }
  if(call->kind==2) {
#ifdef __APPLE__
    uint32_t size=0;
    _NSGetExecutablePath(NULL,&size);
    char *path=malloc(size);
    if(!path) {call->error=ENOMEM;return;}
    if(_NSGetExecutablePath(path,&size)) call->error=ENOENT;
    else if(!(call->path=realpath(path,NULL))) call->error=errno;
    free(path);
#else
    call->path=realpath("/proc/self/exe",NULL);
    if(!call->path) call->error=errno;
#endif
    return;
  }
  struct stat info;
  if(stat(call->database,&info)) {call->error=errno;return;}
  char *directory=NULL;
  int directory_error=br_ipc_directory(&directory);
  if(directory_error) {call->error=directory_error;return;}
  char *key=br_owner_key((uint64_t)info.st_dev,(uint64_t)info.st_ino);
  if(!key) {free(directory);call->error=ENOMEM;return;}
  size_t length=strlen(call->session);
  char *suffix=malloc(7+length*2);
  if(!suffix) {free(directory);free(key);call->error=ENOMEM;return;}
  memcpy(suffix,".lock-",6);
  for(size_t i=0;i<length;i++) {
    unsigned char c=(unsigned char)call->session[i];
    suffix[6+i*2]="0123456789abcdef"[c>>4];
    suffix[7+i*2]="0123456789abcdef"[c&15];
  }
  suffix[6+length*2]=0;
  char *path=br_ipc_path(directory,key,suffix);
  free(suffix);free(key);free(directory);
  if(!path) {call->error=ENOMEM;return;}
  call->handle=open(path,O_CREAT|O_RDWR|O_CLOEXEC,0600);
  free(path);
  if(call->handle<0) {call->error=errno;return;}
  if(call->kind==5) {
    call->error=baton_observer_recover(call);
    if(call->error)close(call->handle);
    return;
  }
  int result;
  do {result=flock(call->handle,LOCK_EX|(call->kind==6?0:LOCK_NB));} while(result<0 && errno==EINTR);
  if(result<0) {call->error=errno;close(call->handle);}
}

static Term baton_session_lock_pack(Env e, IoWork *w) {
  BatonSessionLock *call=(BatonSessionLock *)w->data;
  Term value=call->kind==1 ? term_pak(CID_UNIT,0) : (Term)call->handle;
  if((call->kind==2 || call->kind==4) && !call->error) value=io_str(e,call->path,strlen(call->path));
  if(call->kind==3) {
    if(call->error==EWOULDBLOCK || call->error==EAGAIN) {call->error=0;value=term_pak(CID_NONE,0);}
    else if(!call->error) value=io_box(e,CID_SOME,(Term)call->handle);
  }
  if(call->kind==5) {
    if(!call->error)value=io_tup(e,(Term)call->handle,(Term)call->attempt.handle);
    else if(call->attempt.child) {
      BatonRetained *retained=call->attempt.child->retained;
      if(retained) {
        if(retained->socket>=0)shutdown(retained->socket,SHUT_RDWR);
        pthread_join(retained->receiver,NULL);
        if(retained->socket>=0)close(retained->socket);
        if(retained->guard>=0)close(retained->guard);
        if(retained->spool>=0)close(retained->spool);
        if(retained->life>=0)close(retained->life);
        if(retained->watch>=0)close(retained->watch);
        pthread_mutex_destroy(&retained->state);pthread_mutex_destroy(&retained->command);
        pthread_mutex_destroy(&retained->reader);pthread_cond_destroy(&retained->changed);
        free(retained->directory);free(retained->database);free(retained);
      }
      call->attempt.child->retained=NULL;
      baton_child_retire_slot(&call->attempt);
    }
  }
  Term result=call->error ? io_fail(e,call->error,call->detail) : io_done(e,value);
  free(call->database);free(call->session);free(call->path);free(call->directory);free(call);
  w->data=NULL;
  return result;
}

static Term baton_session_lock_begin(Env e, Term *f, IoWork *w, int kind) {
  BatonSessionLock *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  call->kind=kind;
  if(kind==3 || kind==5 || kind==6) {
    u64 dn=0,sn=0;
    call->database=io_cstr(e,f[0],&dn);
    call->session=io_cstr(e,f[1],&sn);
    if(strlen(call->database)!=dn || strlen(call->session)!=sn) {
      free(call->database);free(call->session);free(call);
      return io_fail(e,EINVAL,"database or session contains NUL");
    }
    if(kind==5) {
      u64 length=0;
      call->directory=io_cstr(e,f[2],&length);call->observer=(u32)f[3];
      if(strlen(call->directory)!=length) {
        free(call->database);free(call->session);free(call->directory);free(call);
        return io_fail(e,EINVAL,"attempt directory contains NUL");
      }
    }
  } else if(kind==4) {
    u64 length=0;
    call->database=io_cstr(e,f[0],&length);
    if(strlen(call->database)!=length) {free(call->database);free(call);return io_fail(e,EINVAL,"database path contains NUL");}
  } else if(kind==1) call->handle=(int)f[0];
  if(kind==5 && (call->error=baton_child_allocate(&call->attempt))) {
    w->data=(char *)call;
    return baton_session_lock_pack(e,w);
  }
  w->data=(char *)call;
  return io_work(w,baton_session_lock_call,baton_session_lock_pack);
}

#ifdef CID_SESSIONLOCK_CANONICAL
static Term baton_session_lock_canonical(Env e,Term *f,IoWork *w) {return baton_session_lock_begin(e,f,w,4);}
static void __attribute__((constructor)) baton_session_lock_use_canonical(void) {io_eff(CID_SESSIONLOCK_CANONICAL,baton_session_lock_canonical,0);}
#endif
#ifdef CID_SESSIONLOCK_TRY_ACQUIRE
static Term baton_session_lock_try_acquire(Env e,Term *f,IoWork *w) {return baton_session_lock_begin(e,f,w,3);}
static void __attribute__((constructor)) baton_session_lock_use_try_acquire(void) {io_eff(CID_SESSIONLOCK_TRY_ACQUIRE,baton_session_lock_try_acquire,0);}
#endif
#ifdef CID_SESSIONLOCK_WAIT_ACQUIRE
static Term baton_session_lock_wait_acquire(Env e,Term *f,IoWork *w) {return baton_session_lock_begin(e,f,w,6);}
static void __attribute__((constructor)) baton_session_lock_use_wait_acquire(void) {io_eff(CID_SESSIONLOCK_WAIT_ACQUIRE,baton_session_lock_wait_acquire,0);}
#endif

#ifdef CID_SESSIONLOCK_RECOVER_OBSERVER
static Term baton_session_lock_recover_observer(Env e,Term *f,IoWork *w) {return baton_session_lock_begin(e,f,w,5);}
static void __attribute__((constructor)) baton_session_lock_use_recover_observer(void) {io_eff(CID_SESSIONLOCK_RECOVER_OBSERVER,baton_session_lock_recover_observer,0);}
#endif
#ifdef CID_SESSIONLOCK_RELEASE
static Term baton_session_lock_release(Env e,Term *f,IoWork *w) {return baton_session_lock_begin(e,f,w,1);}
static void __attribute__((constructor)) baton_session_lock_use_release(void) {io_eff(CID_SESSIONLOCK_RELEASE,baton_session_lock_release,0);}
#endif
#ifdef CID_SESSIONLOCK_EXECUTABLE
static Term baton_session_lock_executable(Env e,Term *f,IoWork *w) {return baton_session_lock_begin(e,f,w,2);}
static void __attribute__((constructor)) baton_session_lock_use_executable(void) {io_eff(CID_SESSIONLOCK_EXECUTABLE,baton_session_lock_executable,0);}
#endif
#endif
