#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#define main generated_main
#include BATON2_PROCESS_SOURCE
#undef main

#define REQUIRE(test) do { if(!(test)) { fprintf(stderr,"fixture failure: %s (errno %d)\n",#test,errno); return 2; } } while(0)

static char *encoded(char **items,int count) {
  size_t total=0;
  for(int i=0;i<count;i++) total+=strlen(items[i])+1;
  char *buffer=calloc(1,total);
  if(!buffer)return NULL;
  size_t at=0;
  for(int i=0;i<count;i++) {size_t n=strlen(items[i])+1;memcpy(buffer+at,items[i],n);at+=n;}
  return buffer;
}

static int custody_rewrite(const char *directory,BrCustody *record) {
  record->check=br_custody_check(record);
  char *path=br_path(directory,"custody");
  if(!path)return ENOMEM;
  int fd=open(path,O_WRONLY|O_TRUNC|O_CLOEXEC);
  free(path);
  if(fd<0)return errno;
  int error=br_write_all(fd,record,sizeof(*record));
  close(fd);
  return error;
}

static uint64_t checkpoint_offset(const char *directory) {
  char *path=br_path(directory,"checkpoint");
  if(!path)return UINT64_MAX;
  int fd=open(path,O_RDONLY|O_CLOEXEC);free(path);
  if(fd<0)return UINT64_MAX;
  BrCheckpoint checkpoint;
  int error=br_read_all(fd,&checkpoint,sizeof(checkpoint));
  close(fd);
  if(error || memcmp(checkpoint.magic,BR_CHECKPOINT_MAGIC,8))return UINT64_MAX;
  return checkpoint.offset;
}
static int checkpoint_state_equals(const char *directory,const char *expected) {
  char *path=br_path(directory,"checkpoint");
  if(!path)return 0;
  int fd=open(path,O_RDONLY|O_CLOEXEC);free(path);
  if(fd<0)return 0;
  BrCheckpoint checkpoint;
  int error=br_read_all(fd,&checkpoint,sizeof(checkpoint));
  size_t expected_length=strlen(expected);
  char *state=NULL;
  if(!error && checkpoint.length!=expected_length)error=EINVAL;
  if(!error) {
    state=malloc(expected_length?expected_length:1);
    if(!state)error=ENOMEM;
  }
  if(!error && expected_length)error=br_read_all(fd,state,expected_length);
  close(fd);
  int equal=!error && (!expected_length || !memcmp(state,expected,expected_length));
  free(state);
  return equal;
}
int main(int argc,char **argv) {
  if(argc==2 && !strcmp(argv[1],"native-sleep")) {
    if(br_write_all(STDOUT_FILENO,"native-ready\n",13))return 1;
    sleep(30);
    return 0;
  }
  if(argc==2 && !strcmp(argv[1],"native-exit")) {
    if(br_write_all(STDOUT_FILENO,"normal-ready\n",13))return 1;
    return 0;
  }
  if(argc==4 && !strcmp(argv[1],"--host-process-keeper"))
    return br_keeper(argv[2],atoi(argv[3]));
  REQUIRE(argc==2 || argc==3);
  char *self=realpath(argv[0],NULL);
  const char *keeper_exe=argc==3?argv[2]:self;
  REQUIRE(self!=NULL);
  char *native_items[]={self,"native-sleep"};
  char *native_args=encoded(native_items,2);
  REQUIRE(native_args!=NULL);
  char *guard_path=malloc(strlen(argv[1])+sizeof(".guard"));
  REQUIRE(guard_path!=NULL);sprintf(guard_path,"%s.guard",argv[1]);
  int guard=open(guard_path,O_CREAT|O_RDWR|O_CLOEXEC,0600);free(guard_path);
  REQUIRE(guard>0 && flock(guard,LOCK_EX|LOCK_NB)==0);
  char *native_log=br_path(argv[1],"native.stderr");
  REQUIRE(native_log!=NULL);
  char recovery[]="/usr/bin/true";
  BatonProcessCall call={.directory=argv[1],.args=native_args,.length=(u32)(strlen(self)+strlen("native-sleep")+2),
    .cwd="/",.log=native_log,.initial="",.keep_stdin=0,.lock=(u32)guard,
    .recovery=recovery,.recovery_length=sizeof(recovery)};
  char *directory=NULL,*address=NULL;
  REQUIRE(br_attempt_prepare(&call,&directory,&address,0)==0);
  int sockets[2];REQUIRE(socketpair(AF_UNIX,SOCK_STREAM,0,sockets)==0);
  int null=open("/dev/null",O_RDONLY|O_CLOEXEC);
  char *keeper_log=br_path(directory,"keeper.log");
  int log=keeper_log?open(keeper_log,O_CREAT|O_WRONLY|O_CLOEXEC,0600):-1;
  REQUIRE(null>=0 && log>=0);
  char *keeper_argv[]={(char *)keeper_exe,"--host-process-keeper",directory,"4",NULL};
  pid_t keeper;
  REQUIRE(br_spawn(&keeper,keeper_argv,NULL,null,log,log,sockets[1],guard)==0);
  close(sockets[1]);close(null);close(log);
  BrFrame hello;BrState state;int received_guard=-1;
  REQUIRE(br_hello(sockets[0],&hello,&received_guard)==0);
  REQUIRE(hello.op==BR_HELLO && !hello.error && hello.length==sizeof(state));
  REQUIRE(br_read_all(sockets[0],&state,sizeof(state))==0 && state.pid>0);
  if(received_guard>=0)close(received_guard);
  close(sockets[0]);

  /* A validated checkpoint is retained, not rewritten, by adoption. */
  char *spool_path=br_path(directory,"stdout");
  REQUIRE(spool_path!=NULL);
  int spool=open(spool_path,O_RDONLY|O_CLOEXEC);
  REQUIRE(spool>=0);
  REQUIRE(br_checkpoint_store(directory,spool,1,0,0,"{}",2)==0);
  close(spool);
  char *checkpoint_path=br_path(directory,"checkpoint");
  REQUIRE(checkpoint_path!=NULL);
  struct stat checkpoint_before;
  REQUIRE(stat(checkpoint_path,&checkpoint_before)==0);
  /* No observer attaches. Adoption verifies the attempt and takes monitor-only
     custody without connecting to the keeper. */
  BatonChild child={0};
  BatonProcessCall adopt={.directory=directory,.child=&child,.database=NULL};
  int error=br_adopt_orphan(&adopt,directory,guard);
  REQUIRE(error==0);
  BatonRetained *retained=child.retained;
  REQUIRE(retained!=NULL);
  REQUIRE(retained->observer_only==1 && retained->unknown==1);
  REQUIRE(retained->socket==-1);
  struct stat checkpoint_after;
  REQUIRE(stat(checkpoint_path,&checkpoint_after)==0);
  REQUIRE(checkpoint_before.st_size==checkpoint_after.st_size);
  REQUIRE(checkpoint_before.st_mtime==checkpoint_after.st_mtime);
  free(checkpoint_path); free(spool_path);
  long native_pid_before=state.pid;
  char *pid_path=br_path(directory,"native.pid");
  REQUIRE(pid_path!=NULL);
  FILE *pid_file=fopen(pid_path,"r");REQUIRE(pid_file!=NULL);
  long recorded_pid=0;REQUIRE(fscanf(pid_file,"%ld",&recorded_pid)==1);fclose(pid_file);
  free(pid_path);
  REQUIRE(recorded_pid==native_pid_before);
  /* The adopted reader serves the retained spool. */
  BrFrame ack={.op=BR_ACK};
  BatonProcessCall command={.kind=BP_ACK,.child=&child};
  baton_retained_call(&command);
  REQUIRE(command.error==EPERM);
  BatonProcessCall signal={.kind=BP_SIGNAL,.child=&child,.signal=SIGTERM};
  baton_retained_call(&signal);
  REQUIRE(signal.error==EPERM);
  BatonProcessCall write={.kind=BP_WRITE,.child=&child,.text="x",.length=1};
  baton_retained_call(&write);
  REQUIRE(write.error==EPERM);
  BatonProcessCall replay={.kind=BP_INSTANCE_REPLAY,.child=&child};
  baton_retained_call(&replay);
  REQUIRE(replay.error==EPERM);
  REQUIRE(kill((pid_t)state.pid,0)==0);
  char *custody=br_path(directory,"custody");
  REQUIRE(custody!=NULL && access(custody,F_OK)==0);
  BrCustody stored={0};
  REQUIRE(br_read_file(directory,"custody",&stored,sizeof(stored))==0);
  REQUIRE(!memcmp(stored.magic,BR_CUSTODY_MAGIC,8));
  REQUIRE((stored.flags&BR_CUSTODY_UNKNOWN) && (stored.flags&BR_CUSTODY_INPUT_UNFINISHED));
  REQUIRE(stored.birth.pid==state.pid);
  free(custody);
  /* The ordinary checkpoint stays refused on an adopted monitor. */
  BatonProcessCall commit={.kind=BP_INSTANCE_COMMIT,.child=&child,.signal=1,.text="{}",.length=2};
  baton_retained_call(&commit);
  REQUIRE(commit.error==EPERM);
  /* One observed line advances the monitor cursor once, and the reducer
     snapshot is stored with the same offset. */
  BatonProcessCall line={.kind=BP_READ,.child=&child};
  baton_retained_call(&line);
  REQUIRE(line.error==0 && line.length==12 && !memcmp(line.text,"native-ready",12));
  char *state_text="{\"output\":\"13\"}";
  BatonProcessCall monitor={.kind=BP_INSTANCE_MONITOR_COMMIT,.child=&child,
    .signal=1,.text=state_text,.length=(u32)strlen(state_text)};
  baton_retained_call(&monitor);
  REQUIRE(monitor.error==0);
  REQUIRE(checkpoint_offset(directory)==13);
  REQUIRE(br_read_file(directory,"custody",&stored,sizeof(stored))==0);
  REQUIRE(stored.offset==13);
  /* A state-only checkpoint at the same offset is allowed; a rewound cursor
     is not, and neither is an empty reducer snapshot. */
  BatonProcessCall final={.kind=BP_INSTANCE_MONITOR_COMMIT,.child=&child,
    .signal=1,.text=state_text,.length=(u32)strlen(state_text)};
  baton_retained_call(&final);
  REQUIRE(final.error==0);
  /* An owner-managed monitor arrives with a keeper socket and no adopted
     monitor-lock descriptor. Its monitor checkpoint uses the normal
     attempt-bound checkpoint record and leaves native-control operations
     denied. */
  int owner_pair[2];
  REQUIRE(socketpair(AF_UNIX,SOCK_SEQPACKET|SOCK_CLOEXEC,0,owner_pair)==0);
  int adopted_lock=retained->custody_lock;
  int adopted_orphan=retained->orphan;
  retained->custody_lock=-1;
  retained->orphan=0;
  retained->error=0;
  retained->socket=owner_pair[0];
  char *owner_state_text="{\"output\":\"13\",\"owner_monitor\":true}";
  BatonProcessCall owner_monitor={.kind=BP_INSTANCE_MONITOR_COMMIT,.child=&child,
    .signal=1,.text=owner_state_text,.length=(u32)strlen(owner_state_text)};
  baton_retained_call(&owner_monitor);
  REQUIRE(owner_monitor.error==0);
  REQUIRE(checkpoint_offset(directory)==13);
  REQUIRE(checkpoint_state_equals(directory,owner_state_text));
  retained->error=EIO;
  BatonProcessCall owner_error={.kind=BP_INSTANCE_MONITOR_COMMIT,.child=&child,
    .signal=1,.text=state_text,.length=(u32)strlen(state_text)};
  baton_retained_call(&owner_error);
  REQUIRE(owner_error.error==EBUSY);
  REQUIRE(checkpoint_state_equals(directory,owner_state_text));
  retained->error=0;
  BatonProcessCall owner_ack={.kind=BP_ACK,.child=&child};
  baton_retained_call(&owner_ack);
  REQUIRE(owner_ack.error==EPERM);
  BatonProcessCall owner_signal={.kind=BP_SIGNAL,.child=&child,.signal=9};
  baton_retained_call(&owner_signal);
  REQUIRE(owner_signal.error==EPERM);
  retained->offset=0;
  BatonProcessCall restore={.kind=BP_INSTANCE_RESTORE,.child=&child,.signal=1};
  baton_retained_call(&restore);
  REQUIRE(restore.error==0 && retained->offset==13);
  /* A disconnected/orphaned keeper can retain the socket descriptor. It must
     not use the owner-managed checkpoint path based on socket presence alone. */
  retained->orphan=1;
  BatonProcessCall orphan_monitor={.kind=BP_INSTANCE_MONITOR_COMMIT,.child=&child,
    .signal=1,.text=state_text,.length=(u32)strlen(state_text)};
  baton_retained_call(&orphan_monitor);
  REQUIRE(orphan_monitor.error==EBUSY);
  REQUIRE(checkpoint_offset(directory)==13);
  retained->orphan=adopted_orphan;
  retained->socket=-1;
  retained->custody_lock=adopted_lock;
  close(owner_pair[0]);close(owner_pair[1]);
  retained->offset=0;
  BatonProcessCall backward={.kind=BP_INSTANCE_MONITOR_COMMIT,.child=&child,
    .signal=1,.text=state_text,.length=(u32)strlen(state_text)};
  baton_retained_call(&backward);
  REQUIRE(backward.error==ESTALE);
  retained->offset=13;
  BatonProcessCall empty={.kind=BP_INSTANCE_MONITOR_COMMIT,.child=&child,.signal=1};
  baton_retained_call(&empty);
  REQUIRE(empty.error==EINVAL);
  /* A changed custody identity refuses the checkpoint: manifest digest,
     native birth and spool inode each bind the record. */
  BrCustody original_custody=stored;
  stored.manifest^=1;
  REQUIRE(custody_rewrite(directory,&stored)==0);
  BatonProcessCall manifest_mismatch={.kind=BP_INSTANCE_MONITOR_COMMIT,.child=&child,
    .signal=1,.text=state_text,.length=(u32)strlen(state_text)};
  baton_retained_call(&manifest_mismatch);
  REQUIRE(manifest_mismatch.error==ESTALE);
  stored=original_custody; stored.birth.second^=1;
  REQUIRE(custody_rewrite(directory,&stored)==0);
  BatonProcessCall birth_mismatch={.kind=BP_INSTANCE_MONITOR_COMMIT,.child=&child,
    .signal=1,.text=state_text,.length=(u32)strlen(state_text)};
  baton_retained_call(&birth_mismatch);
  REQUIRE(birth_mismatch.error==ESTALE);
  stored=original_custody; stored.spool_inode^=1;
  REQUIRE(custody_rewrite(directory,&stored)==0);
  BatonProcessCall spool_mismatch={.kind=BP_INSTANCE_MONITOR_COMMIT,.child=&child,
    .signal=1,.text=state_text,.length=(u32)strlen(state_text)};
  baton_retained_call(&spool_mismatch);
  REQUIRE(spool_mismatch.error==ESTALE);
  REQUIRE(custody_rewrite(directory,&original_custody)==0);
  /* A second adoption while this monitor is live is refused; the durable
     cursor cannot be advanced by two readers. */
  BatonChild second_child={0};
  BatonProcessCall second={.directory=directory,.child=&second_child,.database=NULL};
  REQUIRE(br_adopt_orphan(&second,directory,guard)==EBUSY);
  /* Once the monitor ends, a retry validates the same custody and resumes. */
  close(retained->custody_lock);retained->custody_lock=-1;
  BatonChild retry_child={0};
  BatonProcessCall retry={.directory=directory,.child=&retry_child,.database=NULL};
  REQUIRE(br_adopt_orphan(&retry,directory,guard)==0);
  REQUIRE(retry_child.retained!=NULL);
  close(retry_child.retained->custody_lock);retry_child.retained->custody_lock=-1;
  /* A changed birth refuses adoption. */
  BrBirth original={0};
  REQUIRE(br_read_file(directory,"native.birth",&original,sizeof(original))==0);
  BrBirth wrong=original; wrong.second++;
  char *birth_path=br_path(directory,"native.birth");
  REQUIRE(birth_path!=NULL);
  REQUIRE(chmod(birth_path,0600)==0);
  int fd=open(birth_path,O_WRONLY|O_TRUNC|O_CLOEXEC);REQUIRE(fd>=0);
  REQUIRE(br_write_all(fd,&wrong,sizeof(wrong))==0);close(fd);
  BatonChild bad_child={0};
  BatonProcessCall bad={.directory=directory,.child=&bad_child,.database=NULL};
  REQUIRE(br_adopt_orphan(&bad,directory,guard)==ESTALE);
  fd=open(birth_path,O_WRONLY|O_TRUNC|O_CLOEXEC);REQUIRE(fd>=0);
  REQUIRE(br_write_all(fd,&original,sizeof(original))==0);close(fd);
  REQUIRE(chmod(birth_path,0400)==0);
  free(birth_path);
  /* A dead native with no status file also adopts unknown custody, and the
     wait text is unavailable rather than a fabricated exit zero. */
  kill(-state.pid,SIGKILL);
  for(int i=0;i<50;i++) {if(br_exists(directory,"status"))break;usleep(10000);}
  char *status_path=br_path(directory,"status");
  REQUIRE(status_path!=NULL);
  unlink(status_path);free(status_path);
  BatonChild dead_child={0};
  BatonProcessCall dead={.directory=directory,.child=&dead_child,.database=NULL};
  REQUIRE(br_adopt_orphan(&dead,directory,guard)==0);
  REQUIRE(dead_child.retained!=NULL && dead_child.retained->observer_only==1);
  BatonProcessCall waited={.kind=BP_WAIT,.child=&dead_child};
  baton_retained_call(&waited);
  REQUIRE(waited.error==0 && waited.text && strstr(waited.text,"unavailable")!=NULL);
  REQUIRE(strcmp(waited.text,"exit 0")!=0);
  /* Relaunch remains blocked by the custody record. */
  char *retry_args=br_path(directory,"native.stderr");
  REQUIRE(retry_args!=NULL);
  BatonProcessCall relaunch={.directory=directory,.args=native_args,
    .length=(u32)(strlen(self)+strlen("native-sleep")+2),.cwd="/",.log=retry_args,
    .initial="",.keep_stdin=0,.lock=(u32)guard,.recovery=recovery,
    .recovery_length=sizeof(recovery)};
  char *relaunch_dir=NULL,*relaunch_address=NULL;
  REQUIRE(br_attempt_prepare(&relaunch,&relaunch_dir,&relaunch_address,1)==EBUSY);
  free(retry_args);
  /* A normal retained handle initializes its custody lock to -1, so release
     and acknowledge do not close standard input. */
  {
    char *normal_dir=malloc(strlen(argv[1])+8);
    REQUIRE(normal_dir!=NULL);sprintf(normal_dir,"%s-normal",argv[1]);
    char *normal_items[]={self,"native-exit"};
    char *normal_args=encoded(normal_items,2);
    REQUIRE(normal_args!=NULL);
    char *normal_log=br_path(normal_dir,"native.stderr");
    REQUIRE(normal_log!=NULL);
    BatonProcessCall normal_call={.directory=normal_dir,.args=normal_args,
      .length=(u32)(strlen(self)+strlen("native-exit")+2),.cwd="/",.log=normal_log,
      .initial="",.keep_stdin=0,.lock=(u32)guard,.recovery=recovery,
      .recovery_length=sizeof(recovery)};
    char *normal_path=NULL,*normal_address=NULL;
    REQUIRE(br_attempt_prepare(&normal_call,&normal_path,&normal_address,0)==0);
    int normal_sockets[2];REQUIRE(socketpair(AF_UNIX,SOCK_STREAM,0,normal_sockets)==0);
    int normal_null=open("/dev/null",O_RDONLY|O_CLOEXEC);
    char *normal_keeper_log=br_path(normal_path,"keeper.log");
    int normal_log_fd=normal_keeper_log?open(normal_keeper_log,O_CREAT|O_WRONLY|O_CLOEXEC,0600):-1;
    REQUIRE(normal_null>=0 && normal_log_fd>=0);
    char *normal_keeper_argv[]={(char *)keeper_exe,"--host-process-keeper",normal_path,"4",NULL};
    pid_t normal_keeper;
    REQUIRE(br_spawn(&normal_keeper,normal_keeper_argv,NULL,normal_null,normal_log_fd,normal_log_fd,
      normal_sockets[1],guard)==0);
    close(normal_sockets[1]);close(normal_null);close(normal_log_fd);
    BatonChild normal_child={0};
    REQUIRE(br_attach_socket(&normal_child,normal_path,normal_sockets[0],NULL,0,1)==0);
    REQUIRE(normal_child.retained!=NULL);
    REQUIRE(normal_child.retained->custody_lock==-1);
    BatonProcessCall normal_wait={.kind=BP_WAIT,.child=&normal_child};
    baton_retained_call(&normal_wait);
    REQUIRE(normal_wait.error==0 && normal_wait.text && !strcmp(normal_wait.text,"exit 0"));
    BatonProcessCall normal_release={.kind=BP_RELEASE,.child=&normal_child};
    baton_retained_call(&normal_release);
    REQUIRE(normal_release.error==0);
    BatonProcessCall normal_ack={.kind=BP_ACK,.child=&normal_child};
    baton_retained_call(&normal_ack);
    REQUIRE(normal_ack.error==0);
    REQUIRE(fcntl(STDIN_FILENO,F_GETFD)!=-1);
    kill(normal_keeper,SIGKILL);
    waitpid(normal_keeper,NULL,0);
    free(normal_dir);free(normal_args);free(normal_log);
    free(normal_keeper_log);free(normal_address);free(normal_path);
  }
  /* Leave no fixture processes behind. */
  kill(-state.pid,SIGKILL);
  kill(keeper,SIGKILL);
  waitpid(keeper,NULL,0);
  printf("custody-adopt PASS\n");
  return 0;
}
