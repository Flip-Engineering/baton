#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <dirent.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/un.h>
#define main generated_main
#include BATON2_PROCESS_SOURCE
#undef main

#define REQUIRE(test) do { if(!(test)) { fprintf(stderr,"fixture failure: %s (errno %d)\n",#test,errno); return 2; } } while(0)

static int write_text(const char *path,const char *text) {
  int fd=open(path,O_WRONLY|O_CREAT|O_TRUNC|O_CLOEXEC,0600);
  if(fd<0)return errno;
  int error=br_write_all(fd,text,strlen(text));
  if(close(fd) && !error)error=errno;
  return error;
}

static int read_text(const char *path,char *buffer,size_t capacity) {
  int fd=open(path,O_RDONLY|O_CLOEXEC);
  if(fd<0)return errno;
  size_t used=0;int error=0;
  for(;;) {
    if(used+1>=capacity){error=EOVERFLOW;break;}
    ssize_t n=read(fd,buffer+used,capacity-1-used);
    if(n<0 && errno==EINTR)continue;
    if(n<0){error=errno;break;}
    if(!n)break;
    used+=(size_t)n;
  }
  close(fd);
  buffer[used]=0;
  return error;
}

static int process_identity(pid_t pid,char *text,size_t capacity) {
  char path[64],stat[2048];
  snprintf(path,sizeof(path),"/proc/%d/stat",(int)pid);
  int error=read_text(path,stat,sizeof(stat));
  if(error)return error;
  char *closing=strrchr(stat,')');
  if(!closing)return EINVAL;
  char *at=closing+1;
  char comm[256]={0};
  char *opening=strchr(stat,'(');
  if(!opening)return EINVAL;
  size_t comm_length=(size_t)(closing-opening-1);
  if(comm_length>=sizeof(comm))return EOVERFLOW;
  memcpy(comm,opening+1,comm_length);
  while(*at==' ')at++;
  if(!*at)return EINVAL;
  char state=*at++;
  unsigned long long starttime=0;
  int ppid=0,pgrp=0,session=0;
  for(int field=4;field<=22;field++) {
    while(*at==' ')at++;
    if(!*at)break;
    char *end=NULL;
    unsigned long long value=strtoull(at,&end,10);
    if(end==at)break;
    if(field==4)ppid=(int)value;
    else if(field==5)pgrp=(int)value;
    else if(field==6)session=(int)value;
    else if(field==22)starttime=value;
    at=end;
  }
  snprintf(text,capacity,"pid=%d comm=%s state=%c ppid=%d pgrp=%d session=%d starttime=%llu\n",
    (int)pid,comm,state,ppid,pgrp,session,starttime);
  return 0;
}

static int read_cgroup_membership(pid_t pid,char *text,size_t capacity) {
  char path[64];
  snprintf(path,sizeof(path),"/proc/%d/cgroup",(int)pid);
  return read_text(path,text,capacity);
}

static int wait_for_lines(int fd,char *buffer,size_t capacity,const char *first,const char *second) {
  size_t used=0;
  for(int attempt=0;attempt<500;attempt++) {
    if(used+1>=capacity)return EOVERFLOW;
    ssize_t n=read(fd,buffer+used,capacity-1-used);
    if(n<0 && errno==EINTR)continue;
    if(n<0)return errno;
    if(n>0)used+=(size_t)n;
    buffer[used]=0;
    if(strstr(buffer,first) && (!second || strstr(buffer,second)))return 0;
    struct timespec pause={0,10000000};
    nanosleep(&pause,NULL);
  }
  return ETIMEDOUT;
}

static int run_native_descendant(void) {
  printf("native-pid %d\n",(int)getpid());
  fflush(stdout);
  pid_t descendant=fork();
  if(descendant<0)return 1;
  if(!descendant) {
    for(;;)pause();
  }
  printf("descendant-pid %d\n",(int)descendant);
  fflush(stdout);
  for(;;)pause();
}

static int remove_tree(const char *path) {
  struct stat info;
  if(lstat(path,&info))return errno==ENOENT?0:errno;
  if(!S_ISDIR(info.st_mode))return unlink(path)?errno:0;
  DIR *directory=opendir(path);
  if(!directory)return errno;
  struct dirent *entry;
  int error=0;
  while((entry=readdir(directory))) {
    if(!strcmp(entry->d_name,".") || !strcmp(entry->d_name,".."))continue;
    char *child=br_path(path,entry->d_name);
    if(!child){error=ENOMEM;break;}
    error=remove_tree(child);
    free(child);
    if(error)break;
  }
  closedir(directory);
  if(!error && rmdir(path))error=errno;
  return error;
}

/* The request must bind the published owner incarnation into the frame. The
   listener replies only when it receives the record's token and epoch; a
   missing or wrong binding makes the request fail instead of succeeding. */
static int owner_binding_control(void) {
  char template[]="/tmp/baton-owner-binding-XXXXXX";
  char *directory=mkdtemp(template);
  if(!directory)return 1;
  char *runtime=br_path(directory,"baton2");
  char *database=br_path(directory,"owner.db");
  char *socket_path=br_path(directory,"owner.sock");
  if(!runtime || !database || !socket_path)return 1;
  if(mkdir(runtime,0700))return 1;
  if(setenv("XDG_RUNTIME_DIR",directory,1))return 1;
  int db=open(database,O_CREAT|O_WRONLY|O_CLOEXEC,0600);
  if(db<0)return 1;
  struct stat info;
  if(fstat(db,&info))return 1;
  close(db);
  struct sockaddr_un address;
  memset(&address,0,sizeof(address));
  address.sun_family=AF_UNIX;
  if(strlen(socket_path)>=sizeof(address.sun_path))return 1;
  strcpy(address.sun_path,socket_path);
  int listener=socket(AF_UNIX,SOCK_STREAM,0);
  if(listener<0)return 1;
  if(bind(listener,(struct sockaddr *)&address,sizeof(address)))return 1;
  if(listen(listener,1))return 1;
  BrOwnerRecord record={0};
  record.token=7;record.epoch=9;
  record.device=(uint64_t)info.st_dev;record.inode=(uint64_t)info.st_ino;
  record.pid=(int32_t)getpid();
  record.reserved=(int32_t)BR_OWNER_CAP_NATIVE_CGROUP;
  if(strlen(socket_path)>=sizeof(record.socket))return 1;
  strcpy(record.socket,socket_path);
  char *key=br_owner_key((uint64_t)info.st_dev,(uint64_t)info.st_ino);
  char *record_path=key?br_ipc_path(runtime,key,".record"):NULL;
  if(!record_path)return 1;
  int stored=open(record_path,O_CREAT|O_TRUNC|O_WRONLY|O_CLOEXEC,0600);
  if(stored<0)return 1;
  int write_error=br_write_all(stored,&record,sizeof(record));
  close(stored);
  if(write_error)return 1;
  pid_t child=fork();
  if(child<0)return 1;
  if(!child) {
    BrInstanceFrame frame={.op=BI_ENSURE},reply={0};
    int error=br_instance_request_witness(database,frame,NULL,-1,&reply,0,0,1);
    _exit(error?1:0);
  }
  struct pollfd wait={.fd=listener,.events=POLLIN};
  int ready;
  do {ready=poll(&wait,1,5000);} while(ready<0 && errno==EINTR);
  int client=ready==1?accept(listener,NULL,NULL):-1;
  BrInstanceFrame sent={0};
  int binding=0;
  if(client>=0 && !br_read_all(client,&sent,sizeof(sent))) {
    binding=sent.op==BI_ENSURE && sent.owner==7 && sent.epoch==9;
    if(binding) {
      BrInstanceFrame reply={.op=BI_HELLO,.owner=7,.epoch=9};
      br_write_all(client,&reply,sizeof(reply));
    }
  }
  if(client>=0)close(client);
  close(listener);
  int status=0,reaped=0;
  for(int i=0;i<500;i++) {
    pid_t result=waitpid(child,&status,WNOHANG);
    if(result==child){reaped=1;break;}
    if(result<0 && errno!=EINTR)break;
    struct timespec pause={0,10000000};
    nanosleep(&pause,NULL);
  }
  if(!reaped)kill(child,SIGKILL);
  unlink(socket_path);unlink(record_path);unlink(database);
  rmdir(runtime);rmdir(directory);
  free(runtime);free(database);free(socket_path);free(key);free(record_path);
  return binding && reaped && WIFEXITED(status) && WEXITSTATUS(status)==0 ? 0 : 1;
}

int main(int argc,char **argv) {
  if(argc==2 && !strcmp(argv[1],"--native-descendant"))return run_native_descendant();
  if(argc==2 && !strcmp(argv[1],"--sibling-keeper")) {
    for(;;)pause();
  }
  if(argc!=2) {
    fputs("usage: cgroup-confinement ROOT\n",stderr);
    return 2;
  }
  char *root=realpath(argv[1],NULL);
  REQUIRE(root!=NULL);
  char *receiver=br_path(root,"receiver");
  char *shared=br_path(root,"session-6448.scope");
  char *sibling_cgroup=br_path(root,"sibling-keeper");
  REQUIRE(receiver && shared && sibling_cgroup);
  REQUIRE(mkdir(receiver,0700)==0);
  REQUIRE(mkdir(shared,0700)==0);
  REQUIRE(mkdir(sibling_cgroup,0700)==0);
  char *path=br_path(receiver,"memory.max");
  REQUIRE(path && write_text(path,"17179869184\n")==0);free(path);
  path=br_path(receiver,"memory.swap.max");
  REQUIRE(path && write_text(path,"0\n")==0);free(path);
  path=br_path(receiver,"cgroup.subtree_control");
  REQUIRE(path && write_text(path,"memory\n")==0);free(path);
  path=br_path(shared,"memory.max");
  REQUIRE(path && write_text(path,"max\n")==0);free(path);
  path=br_path(shared,"memory.swap.max");
  REQUIRE(path && write_text(path,"max\n")==0);free(path);
  char *sibling_memory=br_path(sibling_cgroup,"memory.max");
  char *sibling_swap=br_path(sibling_cgroup,"memory.swap.max");
  char *sibling_procs=br_path(sibling_cgroup,"cgroup.procs");
  REQUIRE(sibling_memory && sibling_swap && sibling_procs);
  REQUIRE(write_text(sibling_memory,"8589934592\n")==0);
  REQUIRE(write_text(sibling_swap,"0\n")==0);
  REQUIRE(write_text(sibling_procs,"424242\n")==0);
  char sibling_memory_before[64],sibling_swap_before[64],sibling_procs_before[64];
  REQUIRE(read_text(sibling_memory,sibling_memory_before,sizeof(sibling_memory_before))==0);
  REQUIRE(read_text(sibling_swap,sibling_swap_before,sizeof(sibling_swap_before))==0);
  REQUIRE(read_text(sibling_procs,sibling_procs_before,sizeof(sibling_procs_before))==0);

  /* One sibling keeper stays untouched for the whole run. */
  char *sibling_argv[]={"/bin/sleep","30",NULL};
  pid_t sibling=0;
  REQUIRE(br_spawn(&sibling,sibling_argv,NULL,-1,-1,-1,-1,-1)==0);
  struct timespec settle={0,100000000};
  nanosleep(&settle,NULL);
  char sibling_cgroup_before[256],sibling_state_before[512],sibling_cmdline_before[512];
  REQUIRE(read_cgroup_membership(sibling,sibling_cgroup_before,sizeof(sibling_cgroup_before))==0);
  REQUIRE(process_identity(sibling,sibling_state_before,sizeof(sibling_state_before))==0);
  char cmdline_path[64];
  snprintf(cmdline_path,sizeof(cmdline_path),"/proc/%d/cmdline",(int)sibling);
  REQUIRE(read_text(cmdline_path,sibling_cmdline_before,sizeof(sibling_cmdline_before))==0);

  REQUIRE(setenv("BATON2_CGROUP_ROOT",root,1)==0);
  REQUIRE(setenv("BATON2_CGROUP_PARENT","/receiver",1)==0);
  char *cgroup=NULL,*relative=NULL;
  unsigned long long memory=0,swap=0;
  const char *condition=NULL;
  int error=br_native_cgroup_create("/receiver","baton-native-fixture",
    &cgroup,&relative,&memory,&swap,&condition);
  REQUIRE(error==0);
  REQUIRE(cgroup!=NULL && relative!=NULL);
  REQUIRE(memory==17179869184ULL);
  REQUIRE(swap==0);
  char *session_prefix=br_path(root,"session-6448.scope");
  REQUIRE(session_prefix!=NULL);
  REQUIRE(strncmp(cgroup,session_prefix,strlen(session_prefix))!=0);
  char *receiver_prefix=br_path(root,"receiver/");
  REQUIRE(receiver_prefix!=NULL);
  REQUIRE(strncmp(cgroup,receiver_prefix,strlen(receiver_prefix))==0);
  REQUIRE(!strcmp(relative,"/receiver/baton-native-fixture"));
  char *child_memory=br_path(cgroup,"memory.max");
  char *child_swap=br_path(cgroup,"memory.swap.max");
  REQUIRE(child_memory && child_swap);
  char child_memory_text[64],child_swap_text[64];
  REQUIRE(read_text(child_memory,child_memory_text,sizeof(child_memory_text))==0);
  REQUIRE(read_text(child_swap,child_swap_text,sizeof(child_swap_text))==0);
  REQUIRE(!strcmp(child_memory_text,"17179869184\n"));
  REQUIRE(!strcmp(child_swap_text,"0\n"));
  free(session_prefix);free(receiver_prefix);

  /* A tighter receiver bound under a larger delegated unit is preserved. */
  char *cluster=br_path(root,"cluster.service");
  char *cluster_receiver=br_path(root,"cluster.service/receiver");
  REQUIRE(cluster && cluster_receiver);
  REQUIRE(mkdir(cluster,0700)==0);
  REQUIRE(mkdir(cluster_receiver,0700)==0);
  path=br_path(cluster,"memory.max");
  REQUIRE(path && write_text(path,"17179869184\n")==0);free(path);
  path=br_path(cluster,"memory.swap.max");
  REQUIRE(path && write_text(path,"0\n")==0);free(path);
  path=br_path(cluster,"cgroup.subtree_control");
  REQUIRE(path && write_text(path,"memory\n")==0);free(path);
  path=br_path(cluster_receiver,"memory.max");
  REQUIRE(path && write_text(path,"8589934592\n")==0);free(path);
  path=br_path(cluster_receiver,"memory.swap.max");
  REQUIRE(path && write_text(path,"0\n")==0);free(path);
  REQUIRE(chmod(cluster_receiver,0500)==0);
  char *tight_cgroup=NULL,*tight_relative=NULL;
  unsigned long long tight_memory=0,tight_swap=0;
  condition=NULL;
  error=br_native_cgroup_create("/cluster.service/receiver","baton-native-tight",
    &tight_cgroup,&tight_relative,&tight_memory,&tight_swap,&condition);
  REQUIRE(error==0);
  REQUIRE(tight_memory==8589934592ULL);
  REQUIRE(tight_swap==0);
  REQUIRE(!strcmp(tight_relative,"/cluster.service/baton-native-tight"));
  char *tight_memory_path=br_path(tight_cgroup,"memory.max");
  char *tight_swap_path=br_path(tight_cgroup,"memory.swap.max");
  char tight_memory_text[64],tight_swap_text[64];
  REQUIRE(read_text(tight_memory_path,tight_memory_text,sizeof(tight_memory_text))==0);
  REQUIRE(read_text(tight_swap_path,tight_swap_text,sizeof(tight_swap_text))==0);
  REQUIRE(!strcmp(tight_memory_text,"8589934592\n"));
  REQUIRE(!strcmp(tight_swap_text,"0\n"));
  REQUIRE(chmod(cluster_receiver,0700)==0);
  free(tight_cgroup);free(tight_relative);free(tight_memory_path);free(tight_swap_path);

  /* The walk stops at the receiver unit and does not climb into a bounded
     higher slice when the unit itself cannot delegate a placement. */
  char *user_slice=br_path(root,"user.slice");
  char *user_scope=br_path(root,"user.slice/session-6448.scope");
  REQUIRE(user_slice && user_scope);
  REQUIRE(mkdir(user_slice,0700)==0);
  REQUIRE(mkdir(user_scope,0700)==0);
  path=br_path(user_slice,"memory.max");
  REQUIRE(path && write_text(path,"4294967296\n")==0);free(path);
  path=br_path(user_slice,"memory.swap.max");
  REQUIRE(path && write_text(path,"0\n")==0);free(path);
  path=br_path(user_slice,"cgroup.subtree_control");
  REQUIRE(path && write_text(path,"memory\n")==0);free(path);
  path=br_path(user_scope,"memory.max");
  REQUIRE(path && write_text(path,"max\n")==0);free(path);
  path=br_path(user_scope,"memory.swap.max");
  REQUIRE(path && write_text(path,"max\n")==0);free(path);
  REQUIRE(chmod(user_scope,0500)==0);
  char *no_climb=NULL,*no_climb_relative=NULL;
  condition=NULL;
  error=br_native_cgroup_create("/user.slice/session-6448.scope","baton-native-climb",
    &no_climb,&no_climb_relative,&tight_memory,&tight_swap,&condition);
  REQUIRE(error==EOPNOTSUPP);
  REQUIRE(no_climb==NULL && no_climb_relative==NULL);
  REQUIRE(condition!=NULL && !strcmp(condition,"cgroupUnbounded"));
  REQUIRE(chmod(user_scope,0700)==0);
  free(user_slice);free(user_scope);

  /* A repeated admission reuses the stored control path; field 5 is not part
     of the manifest identity. */
  char *manifest_directory=br_path(root,"manifest-control");
  REQUIRE(manifest_directory && mkdir(manifest_directory,0700)==0);
  char manifest_argv[]="/bin/true";
  char manifest_recovery[]="/bin/true";
  char control_a[]="/tmp/control-a";
  char control_b[]="/tmp/control-b";
  char *manifest_fields[6]={manifest_argv,"/","/tmp/log","",manifest_recovery,control_a};
  size_t manifest_lengths[6]={sizeof(manifest_argv),1,8,0,sizeof(manifest_recovery),strlen(control_a)};
  BrManifestHeader manifest_header={.keep_stdin=1};
  memcpy(manifest_header.magic,"BATONRP1",8);
  for(int i=0;i<6;i++)manifest_header.lengths[i]=manifest_lengths[i];
  char *manifest_path=br_path(manifest_directory,"manifest");
  REQUIRE(manifest_path!=NULL);
  error=br_manifest_store(manifest_directory,manifest_path,&manifest_header,manifest_fields,manifest_lengths,6);
  REQUIRE(error==0);
  manifest_fields[5]=control_b;
  manifest_header.lengths[5]=strlen(control_b);
  REQUIRE(br_manifest_same(manifest_directory,&manifest_header,manifest_fields,6)==0);
  free(manifest_directory);free(manifest_path);

  /* The owner incarnation is bound into the request frame. */
  REQUIRE(owner_binding_control()==0);

  char *spool_path=br_path(root,"native.stdout");
  char *log_path=br_path(root,"native.stderr");
  REQUIRE(spool_path && log_path);
  int input[2];
  REQUIRE(pipe(input)==0);
  int spool=open(spool_path,O_CREAT|O_TRUNC|O_RDWR|O_CLOEXEC,0600);
  int log=open(log_path,O_CREAT|O_TRUNC|O_WRONLY|O_CLOEXEC,0600);
  REQUIRE(spool>=0 && log>=0);
  char *self=realpath("/proc/self/exe",NULL);
  REQUIRE(self!=NULL);
  char *native_argv[]={self,"--native-descendant",NULL};
  pid_t native=0;
  error=br_spawn_confined(&native,native_argv,"/",input[0],spool,log,cgroup);
  close(input[0]);close(input[1]);close(spool);close(log);
  REQUIRE(error==0 && native>0);

  /* The gated child cannot exec until the parent wrote its PID to the exact
     per-native cgroup.procs file. */
  char *procs=br_path(cgroup,"cgroup.procs");
  REQUIRE(procs!=NULL);
  char procs_text[256];
  REQUIRE(read_text(procs,procs_text,sizeof(procs_text))==0);
  char native_pid[32];
  snprintf(native_pid,sizeof(native_pid),"%d\n",(int)native);
  REQUIRE(strstr(procs_text,native_pid)!=NULL);

  int reader=open(spool_path,O_RDONLY|O_CLOEXEC);
  REQUIRE(reader>=0);
  char lines[512];
  REQUIRE(wait_for_lines(reader,lines,sizeof(lines),"native-pid ","descendant-pid ")==0);
  close(reader);
  int reported_native=0,reported_descendant=0;
  REQUIRE(sscanf(lines,"native-pid %d",&reported_native)==1);
  char *descendant_line=strstr(lines,"descendant-pid ");
  REQUIRE(descendant_line!=NULL);
  REQUIRE(sscanf(descendant_line,"descendant-pid %d",&reported_descendant)==1);
  REQUIRE(reported_native==(int)native);
  REQUIRE(reported_descendant>0);
  char descendant_state[512];
  REQUIRE(process_identity((pid_t)reported_descendant,descendant_state,
    sizeof(descendant_state))==0);
  char expected_parent[64];
  snprintf(expected_parent,sizeof(expected_parent),"ppid=%d ",(int)native);
  REQUIRE(strstr(descendant_state,expected_parent)!=NULL);
  REQUIRE(kill((pid_t)reported_descendant,0)==0);

  REQUIRE(kill(-native,SIGKILL)==0);
  int wait_status;
  while(waitpid(native,&wait_status,0)<0 && errno==EINTR) {}
  REQUIRE(WIFSIGNALED(wait_status) && WTERMSIG(wait_status)==SIGKILL);

  /* The sibling keeper and its cgroup are byte-identical. */
  REQUIRE(kill(sibling,0)==0);
  char sibling_cgroup_after[256],sibling_state_after[512],sibling_cmdline_after[512];
  REQUIRE(read_cgroup_membership(sibling,sibling_cgroup_after,sizeof(sibling_cgroup_after))==0);
  REQUIRE(process_identity(sibling,sibling_state_after,sizeof(sibling_state_after))==0);
  REQUIRE(read_text(cmdline_path,sibling_cmdline_after,sizeof(sibling_cmdline_after))==0);
  REQUIRE(!strcmp(sibling_cgroup_before,sibling_cgroup_after));
  REQUIRE(!strcmp(sibling_state_before,sibling_state_after));
  REQUIRE(!strcmp(sibling_cmdline_before,sibling_cmdline_after));
  char sibling_memory_after[64],sibling_swap_after[64],sibling_procs_after[64];
  REQUIRE(read_text(sibling_memory,sibling_memory_after,sizeof(sibling_memory_after))==0);
  REQUIRE(read_text(sibling_swap,sibling_swap_after,sizeof(sibling_swap_after))==0);
  REQUIRE(read_text(sibling_procs,sibling_procs_after,sizeof(sibling_procs_after))==0);
  REQUIRE(!strcmp(sibling_memory_before,sibling_memory_after));
  REQUIRE(!strcmp(sibling_swap_before,sibling_swap_after));
  REQUIRE(!strcmp(sibling_procs_before,sibling_procs_after));
  REQUIRE(kill(sibling,SIGKILL)==0);
  while(waitpid(sibling,&wait_status,0)<0 && errno==EINTR) {}

  /* Fail closed: the unbounded shared scope creates no child. */
  char *shared_child=br_path(shared,"baton-native-refused");
  REQUIRE(shared_child!=NULL);
  condition=NULL;
  char *refused=NULL,*refused_relative=NULL;
  error=br_native_cgroup_create("/session-6448.scope","baton-native-refused",
    &refused,&refused_relative,&memory,&swap,&condition);
  REQUIRE(error==EOPNOTSUPP);
  REQUIRE(refused==NULL && refused_relative==NULL);
  REQUIRE(condition!=NULL && !strcmp(condition,"cgroupUnbounded"));
  REQUIRE(access(shared_child,F_OK)!=0 && errno==ENOENT);

  /* Fail closed: an unwritable delegated parent creates no child. */
  char *readonly=br_path(receiver,"readonly");
  REQUIRE(readonly!=NULL && mkdir(readonly,0700)==0);
  path=br_path(readonly,"memory.max");
  REQUIRE(path && write_text(path,"17179869184\n")==0);free(path);
  path=br_path(readonly,"memory.swap.max");
  REQUIRE(path && write_text(path,"0\n")==0);free(path);
  path=br_path(readonly,"cgroup.subtree_control");
  REQUIRE(path && write_text(path,"memory\n")==0);free(path);
  REQUIRE(chmod(readonly,0500)==0);
  condition=NULL;
  refused=NULL;
  refused_relative=NULL;
  error=br_native_cgroup_create("/receiver/readonly","baton-native-refused",
    &refused,&refused_relative,&memory,&swap,&condition);
  REQUIRE(error==EACCES || error==EPERM);
  REQUIRE(refused==NULL && refused_relative==NULL);
  REQUIRE(condition!=NULL && !strcmp(condition,"cgroupCreate"));
  REQUIRE(chmod(readonly,0700)==0);

  /* Fail closed: an attach that cannot write cgroup.procs starts no native. */
  char *attach_failure=br_path(receiver,"attach-failure");
  REQUIRE(attach_failure!=NULL && mkdir(attach_failure,0700)==0);
  char *blocked_procs=br_path(attach_failure,"cgroup.procs");
  REQUIRE(blocked_procs!=NULL && mkdir(blocked_procs,0700)==0);
  int null=open("/dev/null",O_RDWR|O_CLOEXEC);
  REQUIRE(null>=0);
  pid_t refused_pid=0;
  error=br_spawn_confined(&refused_pid,native_argv,"/",null,null,null,attach_failure);
  close(null);
  REQUIRE(error!=0);
  REQUIRE(refused_pid==0);

  printf("{\"cgroup\":\"%s\",\"cgroupRelative\":\"%s\",\"memoryMax\":%llu,"
         "\"memorySwapMax\":%llu,\"nativePid\":%d,\"descendantPid\":%d,"
         "\"descendantParent\":%d,\"attachBeforeExec\":true,"
         "\"siblingUnchanged\":true,\"unboundedRefused\":true,"
         "\"unwritableRefused\":true,\"attachFailureRefused\":true,"
         "\"tightReceiverMax\":8589934592,"
         "\"tightReceiverRelative\":\"/cluster.service/baton-native-tight\","
         "\"noClimbRefused\":true,\"manifestControlPathReuse\":true,"
         "\"ownerBinding\":true,\"realCgroup\":false,"
         "\"limitation\":\"fixture uid has no writable delegated cgroup; "
         "the exact create/attach writer ran against a disposable directory hierarchy\"}\n",
    cgroup,relative,memory,swap,(int)native,reported_descendant,(int)native);
  puts("cgroup-confinement PASS");

  free(procs);free(spool_path);free(log_path);free(self);
  free(cgroup);free(relative);free(receiver);free(shared);free(sibling_cgroup);
  free(cluster);free(cluster_receiver);
  free(shared_child);free(readonly);free(attach_failure);free(blocked_procs);
  free(child_memory);free(child_swap);
  remove_tree(root);
  free(root);
  return 0;
}
