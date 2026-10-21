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
  unlink(marker); unlink(status_path); rmdir(directory);
  puts("{\"liveDisconnectedRecoveredOnce\":true,\"exitedDisconnectRecoveredOnceNoRetry\":true,\"terminalStatusPreserved\":true}");
  return 0;
}
