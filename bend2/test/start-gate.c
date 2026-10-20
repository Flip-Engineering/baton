#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <poll.h>
#include <sys/socket.h>
#include <sys/un.h>
#define main generated_main
#include BATON2_PROCESS_SOURCE
#undef main

#define REQUIRE(test) do { if(!(test)) { fprintf(stderr,"fixture failure: %s (errno %d)\n",#test,errno); return 2; } } while(0)

static int gated_exec(void) {
  int output[2],errors[2];
  if(pipe(output) || pipe(errors))return errno;
  char *argv[]={"/bin/sh","-c","printf gated-start-ok",NULL};
  pid_t child=0;
  int error=br_spawn_gated(&child,argv,NULL,-1,output[1],errors[1]);
  close(output[1]);close(errors[1]);close(errors[0]);
  if(error)return error;
  char text[64]={0};ssize_t count=read(output[0],text,sizeof(text)-1);
  close(output[0]);
  int status=0;while(waitpid(child,&status,0)<0 && errno==EINTR){}
  if(count!=(ssize_t)(sizeof("gated-start-ok")-1) || memcmp(text,"gated-start-ok",sizeof("gated-start-ok")-1) || !WIFEXITED(status) || WEXITSTATUS(status))return EIO;
  return 0;
}

/* A published owner with the legacy zero reserved field accepts a witnessed
   request and returns the same owner incarnation. */
static int legacy_owner_control(void) {
  char template[]="/tmp/baton-legacy-owner-XXXXXX";
  char *directory=mkdtemp(template);
  if(!directory)return 1;
  char *runtime=br_path(directory,"baton2"),*database=br_path(directory,"owner.db");
  char *socket_path=br_path(directory,"owner.sock");
  if(!runtime || !database || !socket_path)return 1;
  if(mkdir(runtime,0700) || setenv("XDG_RUNTIME_DIR",directory,1))return 1;
  int db=open(database,O_CREAT|O_WRONLY|O_CLOEXEC,0600);
  if(db<0)return 1;
  struct stat info;
  if(fstat(db,&info))return 1;
  close(db);
  struct sockaddr_un address={0};address.sun_family=AF_UNIX;
  if(strlen(socket_path)>=sizeof(address.sun_path))return 1;
  strcpy(address.sun_path,socket_path);
  int listener=socket(AF_UNIX,SOCK_STREAM,0);
  if(listener<0 || bind(listener,(struct sockaddr *)&address,sizeof(address)) || listen(listener,1))return 1;
  BrOwnerRecord record={0};
  record.token=7;record.epoch=9;record.device=(uint64_t)info.st_dev;
  record.inode=(uint64_t)info.st_ino;record.pid=(int32_t)getpid();
  if(strlen(socket_path)>=sizeof(record.socket))return 1;
  strcpy(record.socket,socket_path);
  char *key=br_owner_key((uint64_t)info.st_dev,(uint64_t)info.st_ino);
  char *record_path=key?br_ipc_path(runtime,key,".record"):NULL;
  if(!record_path)return 1;
  int stored=open(record_path,O_CREAT|O_TRUNC|O_WRONLY|O_CLOEXEC,0600);
  if(stored<0)return 1;
  int error=br_write_all(stored,&record,sizeof(record));close(stored);
  if(error)return 1;
  pid_t client=fork();
  if(client<0)return 1;
  if(!client) {
    BrInstanceFrame reply={0};
    int result=br_instance_request_witness(database,(BrInstanceFrame){.op=BI_ENSURE},NULL,-1,&reply,0,0);
    _exit(result || reply.op!=BI_HELLO || reply.owner!=7 || reply.epoch!=9);
  }
  struct pollfd wait={.fd=listener,.events=POLLIN};
  int ready;do {ready=poll(&wait,1,5000);} while(ready<0 && errno==EINTR);
  int peer=ready==1?accept(listener,NULL,NULL):-1;
  BrInstanceFrame request={0};
  int valid=peer>=0 && !br_read_all(peer,&request,sizeof(request)) &&
    request.op==BI_ENSURE && request.owner==7 && request.epoch==9;
  if(valid)br_write_all(peer,&(BrInstanceFrame){.op=BI_HELLO,.owner=7,.epoch=9},sizeof(BrInstanceFrame));
  if(peer>=0)close(peer);
  int status=0;while(waitpid(client,&status,0)<0 && errno==EINTR){}
  close(listener);unlink(socket_path);unlink(record_path);unlink(database);rmdir(runtime);rmdir(directory);
  free(runtime);free(database);free(socket_path);free(key);free(record_path);
  return valid && WIFEXITED(status) && WEXITSTATUS(status)==0 ? 0 : 1;
}

int main(void) {
  int error=gated_exec();
  if(error){fprintf(stderr,"gated exec failed: %s (%d)\n",strerror(error),error);return 1;}
  char *bad_argv[]={"/definitely/not/a/baton-native",NULL};
  pid_t failed_child=0;
  error=br_spawn_gated(&failed_child,bad_argv,NULL,-1,-1,-1);
  if(error!=ENOENT || failed_child){fprintf(stderr,"exec failure was not reported synchronously: %d\n",error);return 1;}
  if(legacy_owner_control()){fputs("legacy owner compatibility failed\n",stderr);return 1;}
  puts("start-gate PASS");
  return 0;
}
