#define main process_test_generated_main
#include BATON2_PROCESS_SOURCE
#undef main

#define REQUIRE(test) do { if (!(test)) { perror(#test); return __LINE__; } } while (0)

static int spawn_native(pid_t *pid, const char *command) {
  char *argv[] = {"/bin/sh", "-c", (char *)command, NULL};
  posix_spawn_file_actions_t actions;
  int null=open("/dev/null",O_RDWR|O_CLOEXEC);
  if(null<0)return errno;
  int error=posix_spawn_file_actions_init(&actions);
  int initialized=!error;
  if(!error) error=posix_spawn_file_actions_adddup2(&actions,null,STDIN_FILENO);
  if(!error) error=posix_spawn_file_actions_adddup2(&actions,null,STDOUT_FILENO);
  if(!error) error=posix_spawn_file_actions_adddup2(&actions,null,STDERR_FILENO);
  if(!error) error=posix_spawn(pid,argv[0],&actions,NULL,argv,environ);
  if(initialized)posix_spawn_file_actions_destroy(&actions);
  close(null);
  return error;
}

static int wait_recovery(BrKeeper *keeper, int descriptor, const char *marker) {
  struct pollfd ready = {.fd=descriptor,.events=POLLIN};
  REQUIRE(poll(&ready,1,5000)==1);
  BrWake event;
  REQUIRE(br_read_all(descriptor,&event,sizeof(event))==0);
  REQUIRE(event.kind=='R' && event.pid==keeper->recovery_pid);
  REQUIRE(keeper->recovery_pending==1);
  REQUIRE(WIFEXITED(event.status) && WEXITSTATUS(event.status)==0);
  keeper->recovery_pending=0;
  FILE *file=fopen(marker,"rb");
  REQUIRE(file!=NULL);
  char bytes[8]={0};
  size_t count=fread(bytes,1,sizeof(bytes),file);
  REQUIRE(fclose(file)==0);
  REQUIRE(count==2 && !memcmp(bytes,"x\n",2));
  return 0;
}

static int setup_recovery(BrKeeper *keeper,const char *directory) {
  char command[PATH_MAX];
  int n=snprintf(command,sizeof(command),"printf 'x\\n' >> %s/recovery-started",directory);
  if(n<0 || (size_t)n>=sizeof(command)) return EOVERFLOW;
  size_t cwd_length=strlen(directory)+1;
  keeper->directory=strdup(directory);
  keeper->manifest.field[1]=strdup(directory);
  keeper->manifest.header.lengths[1]=cwd_length;
  size_t argv_length=strlen("/bin/sh")+1+strlen("-c")+1+(size_t)n+1;
  keeper->manifest.field[4]=calloc(argv_length,1);
  if(!keeper->directory || !keeper->manifest.field[1] || !keeper->manifest.field[4]) return ENOMEM;
  size_t offset=0;
  memcpy(keeper->manifest.field[4]+offset,"/bin/sh",strlen("/bin/sh")+1); offset+=strlen("/bin/sh")+1;
  memcpy(keeper->manifest.field[4]+offset,"-c",strlen("-c")+1); offset+=strlen("-c")+1;
  memcpy(keeper->manifest.field[4]+offset,command,(size_t)n+1);
  keeper->manifest.header.lengths[4]=argv_length;
  return 0;
}

static int run_live(const char *directory) {
  BrKeeper keeper={0}; int wake[2]; pid_t native=0;
  REQUIRE(pipe(wake)==0);
  REQUIRE(spawn_native(&native,"sleep 30")==0);
  REQUIRE(setup_recovery(&keeper,directory)==0);
  keeper.native_pid=native; keeper.wake[1]=wake[1]; keeper.client=-1;
  br_disconnected(&keeper);
  char marker[PATH_MAX]; snprintf(marker,sizeof(marker),"%s/recovery-started",directory);
  REQUIRE(wait_recovery(&keeper,wake[0],marker)==0);
  REQUIRE(kill(native,0)==0);
  REQUIRE(kill(native,SIGTERM)==0);
  int status=0; REQUIRE(waitpid(native,&status,0)==native);
  REQUIRE(WIFSIGNALED(status) && WTERMSIG(status)==SIGTERM);
  close(wake[0]); close(wake[1]);
  br_manifest_free(&keeper.manifest); free(keeper.directory);
  return 0;
}

static int run_exited(const char *directory) {
  BrKeeper keeper={0}; int wake[2]; pid_t native=0;
  REQUIRE(pipe(wake)==0);
  REQUIRE(spawn_native(&native,"exit 17")==0);
  REQUIRE(setup_recovery(&keeper,directory)==0);
  keeper.native_pid=native; keeper.native_waiting=1; keeper.wake[1]=wake[1]; keeper.client=-1;
  REQUIRE(br_record_native_exit(&keeper)==0);
  REQUIRE(keeper.exited && WIFEXITED(keeper.status) && WEXITSTATUS(keeper.status)==17);
  br_disconnected(&keeper);
  char marker[PATH_MAX]; snprintf(marker,sizeof(marker),"%s/recovery-started",directory);
  REQUIRE(wait_recovery(&keeper,wake[0],marker)==0);
  br_disconnected(&keeper);
  struct timespec delay={.tv_sec=0,.tv_nsec=200000000};
  nanosleep(&delay,NULL);
  char status_path[PATH_MAX]; snprintf(status_path,sizeof(status_path),"%s/status",directory);
  FILE *file=fopen(status_path,"rb"); REQUIRE(file!=NULL);
  char bytes[16]={0}; size_t count=fread(bytes,1,sizeof(bytes),file);
  REQUIRE(fclose(file)==0);
  char expected[32]; int expected_length=snprintf(expected,sizeof(expected),"%d\n",keeper.status);
  REQUIRE(expected_length>0 && count==(size_t)expected_length && !memcmp(bytes,expected,count));
  REQUIRE(keeper.recovery_pending==0);
  close(wake[0]); close(wake[1]);
  br_manifest_free(&keeper.manifest); free(keeper.directory);
  return 0;
}

static int run_status_write_retry(const char *directory) {
  BrKeeper keeper={0};pid_t native=0;
  REQUIRE(spawn_native(&native,"exit 17")==0);
  REQUIRE(setup_recovery(&keeper,directory)==0);
  keeper.native_pid=native;keeper.native_waiting=1;keeper.ready=1;keeper.client=1;keeper.lock=-1;
  char status_path[PATH_MAX];snprintf(status_path,sizeof(status_path),"%s/status",directory);
  REQUIRE(mkdir(status_path,0700)==0);
  REQUIRE(br_native_exit_event(&keeper)==0);
  REQUIRE(keeper.exited && !keeper.native_waiting &&
          WIFEXITED(keeper.status) && WEXITSTATUS(keeper.status)==17);
  REQUIRE(keeper.outgoing && keeper.outgoing->length==sizeof(BrFrame));
  BrFrame exit_frame;memcpy(&exit_frame,keeper.outgoing->data,sizeof(exit_frame));
  REQUIRE(exit_frame.op==BR_EXIT && exit_frame.value==keeper.status);
  br_buffer_free(&keeper.outgoing,&keeper.outgoing_tail);
  REQUIRE(br_command(&keeper,(BrFrame){.op=BR_RELEASE,.serial=1},"")==0);
  REQUIRE(!keeper.released);
  REQUIRE(keeper.outgoing && keeper.outgoing->length==sizeof(BrFrame));
  BrFrame release_frame;memcpy(&release_frame,keeper.outgoing->data,sizeof(release_frame));
  REQUIRE(release_frame.op==BR_REPLY && release_frame.error==EISDIR);
  br_buffer_free(&keeper.outgoing,&keeper.outgoing_tail);
  BrKeeper fresh={.directory=keeper.directory};
  REQUIRE(br_file(directory,"released","",0,1)==0);
  REQUIRE(!br_attempt_completed(&fresh));
  char released_path[PATH_MAX];snprintf(released_path,sizeof(released_path),"%s/released",directory);
  REQUIRE(unlink(released_path)==0);
  REQUIRE(rmdir(status_path)==0);
  REQUIRE(br_file(directory,"status","",0,1)==0);
  REQUIRE(!br_attempt_completed(&fresh));
  REQUIRE(br_native_exit_event(&keeper)==0);
  int status=0;
  REQUIRE(br_status_read(directory,&status)==0 && status==keeper.status);
  REQUIRE(br_attempt_completed(&fresh));
  REQUIRE(keeper.outgoing && keeper.outgoing->length==sizeof(BrFrame));
  memcpy(&exit_frame,keeper.outgoing->data,sizeof(exit_frame));
  REQUIRE(exit_frame.op==BR_EXIT && exit_frame.value==keeper.status);
  br_buffer_free(&keeper.outgoing,&keeper.outgoing_tail);
  REQUIRE(br_command(&keeper,(BrFrame){.op=BR_RELEASE,.serial=2},"")==0);
  REQUIRE(keeper.released && br_marker_recorded(directory,"released","released\n",9));
  REQUIRE(br_command(&keeper,(BrFrame){.op=BR_ACK,.serial=3},"")==0);
  REQUIRE(keeper.finishing && br_marker_recorded(directory,"acknowledged","acknowledged\n",13));
  br_buffer_free(&keeper.outgoing,&keeper.outgoing_tail);
  char error_path[PATH_MAX];snprintf(error_path,sizeof(error_path),"%s/native-exit-error",directory);
  char acknowledged_path[PATH_MAX];snprintf(acknowledged_path,sizeof(acknowledged_path),"%s/acknowledged",directory);
  unlink(error_path);unlink(status_path);unlink(released_path);unlink(acknowledged_path);
  br_manifest_free(&keeper.manifest);free(keeper.directory);
  return 0;
}

static int run_unknown_status_guards(const char *directory) {
  BrKeeper keeper={0};pid_t native=0;int status=0;
  REQUIRE(spawn_native(&native,"exit 17")==0);
  REQUIRE(waitpid(native,&status,0)==native);
  REQUIRE(WIFEXITED(status) && WEXITSTATUS(status)==17);
  REQUIRE(setup_recovery(&keeper,directory)==0);
  keeper.native_pid=native;keeper.native_waiting=1;keeper.ready=1;keeper.client=1;
  REQUIRE(br_native_exit_event(&keeper)==0);
  REQUIRE(!keeper.exited && keeper.native_waiting);
  REQUIRE(keeper.outgoing==NULL);

  /* A recovered keeper can know that the process ended while its wait status
     remains unavailable. Controls and reconciliation must preserve that state. */
  keeper.exited=1;keeper.status_unavailable=1;keeper.native_waiting=0;
  REQUIRE(br_command(&keeper,(BrFrame){.op=BR_RELEASE,.serial=4},"")==0);
  REQUIRE(!keeper.released && keeper.outgoing && keeper.outgoing->length==sizeof(BrFrame));
  BrFrame reply;memcpy(&reply,keeper.outgoing->data,sizeof(reply));
  REQUIRE(reply.op==BR_REPLY && reply.error==ECHILD);
  br_buffer_free(&keeper.outgoing,&keeper.outgoing_tail);
  keeper.released=1;
  REQUIRE(br_command(&keeper,(BrFrame){.op=BR_ACK,.serial=5},"")==0);
  REQUIRE(!keeper.finishing && keeper.outgoing && keeper.outgoing->length==sizeof(BrFrame));
  memcpy(&reply,keeper.outgoing->data,sizeof(reply));
  REQUIRE(reply.op==BR_REPLY && reply.error==ECHILD);
  br_buffer_free(&keeper.outgoing,&keeper.outgoing_tail);
  char status_path[PATH_MAX];snprintf(status_path,sizeof(status_path),"%s/status",directory);
  REQUIRE(access(status_path,F_OK)<0 && errno==ENOENT);

  BrKeeper recovered={0};pid_t live=0;BrBirth birth;
  REQUIRE(spawn_native(&live,"sleep 30")==0);
  REQUIRE(setup_recovery(&recovered,directory)==0);
  REQUIRE(br_birth(live,&birth)==0);
  recovered.native_pid=live;recovered.native_birth=birth;
  recovered.exited=1;recovered.status_unavailable=1;
  REQUIRE(br_file(directory,"native.birth",&birth,sizeof(birth),1)==0);
  REQUIRE(br_reconcile_native(&recovered,birth)==ECHILD);
  REQUIRE(access(status_path,F_OK)<0 && errno==ENOENT);
  REQUIRE(kill(live,SIGTERM)==0);
  REQUIRE(waitpid(live,&status,0)==live);
  REQUIRE(WIFSIGNALED(status) && WTERMSIG(status)==SIGTERM);

  br_buffer_free(&recovered.outgoing,&recovered.outgoing_tail);
  br_manifest_free(&recovered.manifest);free(recovered.directory);
  br_buffer_free(&keeper.outgoing,&keeper.outgoing_tail);
  br_manifest_free(&keeper.manifest);free(keeper.directory);
  char birth_path[PATH_MAX];snprintf(birth_path,sizeof(birth_path),"%s/native.birth",directory);
  unlink(birth_path);
  return 0;
}

int main(void) {
  char template[]="/tmp/baton-disconnected-recovery-XXXXXX";
  char *directory=mkdtemp(template);
  char marker[PATH_MAX], status_path[PATH_MAX];
  REQUIRE(directory!=NULL);
  REQUIRE(run_live(directory)==0);
  snprintf(marker,sizeof(marker),"%s/recovery-started",directory); unlink(marker);
  REQUIRE(run_exited(directory)==0);
  snprintf(marker,sizeof(marker),"%s/recovery-started",directory);
  snprintf(status_path,sizeof(status_path),"%s/status",directory);
  unlink(marker); unlink(status_path);
  REQUIRE(run_status_write_retry(directory)==0);
  unlink(marker);unlink(status_path);
  REQUIRE(run_unknown_status_guards(directory)==0);
  unlink(marker);unlink(status_path);
  rmdir(directory);
  puts("{\"liveDisconnectedRecoveredOnce\":true,\"exitedDisconnectRecoveredOnceNoRetry\":true,\"terminalStatusPreserved\":true,\"failedStatusWriteRetainedAndRetried\":true,\"unknownWaitStatusNeverReportedOrPersisted\":true,\"unknownStatusReleaseAckAndReconcileRejected\":true}");
  return 0;
}
