#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#define main generated_main
#include BATON2_PROCESS_SOURCE
#undef main

#define REQUIRE(test) do { if(!(test)) { fprintf(stderr,"fixture failure: %s (errno %d)\n",#test,errno); return 2; } } while(0)

static int fixture_frame(int socket,BrFrame *frame) {
  int error=br_read_all(socket,frame,sizeof(*frame));
  return error?error:frame->length?EPROTO:0;
}
static int fixture_reply(int socket,uint64_t serial) {
  BrFrame frame;
  for(;;) {
    int error=fixture_frame(socket,&frame);
    if(error)return error;
    if(frame.op==BR_CHANGE)continue;
    return frame.op==BR_REPLY && frame.serial==serial?frame.error:EPROTO;
  }
}

int main(int argc,char **argv) {
  if(argc==2 && !strcmp(argv[1],"native")) {
    return br_write_all(STDOUT_FILENO,"native-ready\n",13)?1:0;
  }
  if(argc==4 && !strcmp(argv[1],"--host-process-keeper"))
    return br_keeper(argv[2],atoi(argv[3]));
  REQUIRE(argc==2);
  char *self=realpath(argv[0],NULL),*directory=NULL,*address=NULL;
  REQUIRE(self!=NULL);
  size_t argv_length=strlen(self)+1+sizeof("native");
  char *native_argv=calloc(1,argv_length);
  REQUIRE(native_argv!=NULL);
  memcpy(native_argv,self,strlen(self));
  memcpy(native_argv+strlen(self)+1,"native",sizeof("native"));
  /* The attempt does not exist until preparation, so the guard is its sibling. */
  char *guard_path=malloc(strlen(argv[1])+sizeof(".guard"));
  REQUIRE(guard_path!=NULL);sprintf(guard_path,"%s.guard",argv[1]);
  int guard=open(guard_path,O_CREAT|O_RDWR|O_CLOEXEC,0600);free(guard_path);
  REQUIRE(guard>0 && flock(guard,LOCK_EX|LOCK_NB)==0);
  char *native_log=br_path(argv[1],"native.stderr");
  REQUIRE(native_log!=NULL);
  char recovery[]="/usr/bin/false";
  BatonProcessCall call={.directory=argv[1],.args=native_argv,.length=argv_length,
    .cwd="/",.log=native_log,.initial="",.keep_stdin=0,.lock=(u32)guard,
    .recovery=recovery,.recovery_length=sizeof(recovery)};
  REQUIRE(br_attempt_prepare(&call,&directory,&address,0)==0);
  int sockets[2];REQUIRE(socketpair(AF_UNIX,SOCK_STREAM,0,sockets)==0);
  int null=open("/dev/null",O_RDONLY|O_CLOEXEC);
  char *keeper_log=br_path(directory,"keeper.log");
  int log=keeper_log?open(keeper_log,O_CREAT|O_WRONLY|O_CLOEXEC,0600):-1;
  REQUIRE(null>=0 && log>=0);
  char *keeper_argv[]={self,"--host-process-keeper",directory,"4",NULL};
  pid_t keeper;
  REQUIRE(br_spawn(&keeper,keeper_argv,NULL,null,log,log,sockets[1],guard)==0);
  close(sockets[1]);close(null);close(log);close(guard);
  BrFrame hello;BrState state;int received_guard=-1;
  REQUIRE(br_hello(sockets[0],&hello,&received_guard)==0);
  REQUIRE(hello.op==BR_HELLO && !hello.error && hello.length==sizeof(state));
  REQUIRE(br_read_all(sockets[0],&state,sizeof(state))==0 && state.pid>0);
  REQUIRE(received_guard>=0);close(received_guard);

  /* Native exit establishes that its complete initial output reached custody. */
  int ended=0,life=br_lifetime(directory,&ended);
  REQUIRE(life>=0 || ended);
  if(life>=0 && !ended) {
    struct pollfd event={life,POLLIN,0};int ready;
    do {ready=poll(&event,1,-1);}while(ready<0 && errno==EINTR);
    REQUIRE(ready==1 && event.revents&(POLLIN|POLLHUP|POLLERR));
  }
  if(life>=0)close(life);
  char output[13];REQUIRE(br_read_file(directory,"stdout",output,sizeof(output))==0);
  REQUIRE(!memcmp(output,"native-ready\n",sizeof(output)));

  /* The busy attachment reply proves the keeper served its event loop while
     this observer still withheld READY. The selected observer remains attached. */
  int contender=-1;
  REQUIRE(br_attempt_socket(directory,BR_ATTACH,0,0,NULL,0,&contender)==0);
  BrFrame busy;int no_guard=-1;
  REQUIRE(br_hello(contender,&busy,&no_guard)==0);
  REQUIRE(busy.op==BR_HELLO && busy.error==EBUSY && !busy.length && no_guard==-1);
  close(contender);
  BrFrame ready={.op=BR_READY,.serial=1};
  REQUIRE(br_write_all(sockets[0],&ready,sizeof(ready))==0);
  BrFrame frame;uint32_t first=0;uint64_t first_serial=0;
  int replied=0,exited=0,changes=0;
  while(!replied || !exited) {
    REQUIRE(fixture_frame(sockets[0],&frame)==0);
    if(!first){first=frame.op;first_serial=frame.serial;}
    if(frame.op==BR_REPLY) {
      REQUIRE(frame.serial==1 && !frame.error);replied=1;
    } else if(frame.op==BR_EXIT) {
      REQUIRE(frame.value==0);exited=1;
    } else {REQUIRE(frame.op==BR_CHANGE);changes++;}
  }
  BrFrame release={.op=BR_RELEASE,.serial=2},ack={.op=BR_ACK,.serial=3};
  REQUIRE(br_write_all(sockets[0],&release,sizeof(release))==0);
  REQUIRE(fixture_reply(sockets[0],2)==0);
  REQUIRE(br_write_all(sockets[0],&ack,sizeof(ack))==0);
  REQUIRE(fixture_reply(sockets[0],3)==0);close(sockets[0]);
  int status;pid_t result;
  do {result=waitpid(keeper,&status,0);}while(result<0 && errno==EINTR);
  REQUIRE(result==keeper && WIFEXITED(status) && WEXITSTATUS(status)==0);
  REQUIRE(br_exists(directory,"released") && br_exists(directory,"acknowledged"));
  REQUIRE(!br_exists(directory,"stdout"));
  printf("{\"firstFrame\":%u,\"firstSerial\":%llu,\"changes\":%d,\"nativeExit\":0,\"keeperExit\":0,\"released\":true,\"acknowledged\":true}\n",
    first,(unsigned long long)first_serial,changes);
  free(self);free(native_argv);free(native_log);free(keeper_log);free(directory);free(address);
  return first==BR_REPLY && first_serial==1?0:1;
}
