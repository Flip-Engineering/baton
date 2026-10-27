#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#define main generated_main
#include BATON2_PROCESS_SOURCE
#undef main

#define REQUIRE(test) do { if(!(test)) { fprintf(stderr,"fixture failure: %s (errno %d)\n",#test,errno); return 2; } } while(0)

static int fixture_write(const char *directory,const char *name,const char *bytes) {
  char *path=br_path(directory,name);
  int fd=path?open(path,O_CREAT|O_WRONLY|O_TRUNC|O_CLOEXEC,0600):-1;
  free(path);
  if(fd<0)return errno;
  int error=br_write_all(fd,bytes,strlen(bytes));
  close(fd);
  return error;
}

static int fixture_append(const char *directory,const char *name,const char *bytes) {
  char *path=br_path(directory,name);
  int fd=path?open(path,O_WRONLY|O_APPEND|O_CLOEXEC):-1;
  free(path);
  if(fd<0)return errno;
  int error=br_write_all(fd,bytes,strlen(bytes));
  close(fd);
  return error;
}

/* Builds one registered keeper. `client` selects no observer, a connected
   observer that has not acknowledged readiness, or a ready observer. The spool
   reader is positioned after the initial bytes the observer already consumed. */
static int fixture_keeper(BrKeeper *keeper,const char *directory,const char *name,
                          const char *initial,int watch,int client,int ready,int *peer) {
  memset(keeper,0,sizeof(*keeper));
  keeper->listener=-1;keeper->client=-1;keeper->input=-1;keeper->lock=-1;
  keeper->watch=watch;keeper->spool=-1;keeper->wake[0]=keeper->wake[1]=-1;
  keeper->native_life=-1;keeper->ready=ready;
  keeper->directory=strdup(directory);
  if(!keeper->directory)return ENOMEM;
  if(client) {
    int sockets[2];
    if(socketpair(AF_UNIX,SOCK_STREAM,0,sockets))return errno;
    keeper->client=sockets[0];
    if(peer)*peer=sockets[1];
  }
  if(fixture_write(directory,name,initial))return errno;
  char *path=br_path(directory,name);
  keeper->spool=path?open(path,O_RDONLY|O_CLOEXEC):-1;
  free(path);
  if(keeper->spool<0)return errno;
  char consumed[64];
  ssize_t n=read(keeper->spool,consumed,sizeof(consumed));
  return n==(ssize_t)strlen(initial)?0:EIO;
}

static int fixture_final(BrKeeper *keeper,const char *expected) {
  char bytes[64];
  ssize_t n=read(keeper->spool,bytes,sizeof(bytes));
  return n==(ssize_t)strlen(expected) && !memcmp(bytes,expected,strlen(expected));
}

static void fixture_close(BrKeeper *keeper,int peer) {
  if(keeper->client>=0)close(keeper->client);
  if(peer>=0)close(peer);
  if(keeper->spool>=0)close(keeper->spool);
  br_buffer_free(&keeper->outgoing,&keeper->outgoing_tail);
  free(keeper->directory);
}

int main(void) {
  char directory[]="/tmp/spool-watch-overflow-XXXXXX";
  REQUIRE(mkdtemp(directory)!=NULL);
  BrKeeper ready_a,ready_b,unready,detached;
  int a_peer=-1,b_peer=-1,unready_peer=-1;
  REQUIRE(fixture_keeper(&ready_a,directory,"a.stdout","a-before\n",1,1,1,&a_peer)==0);
  REQUIRE(fixture_keeper(&ready_b,directory,"b.stdout","b-before\n",2,1,1,&b_peer)==0);
  REQUIRE(fixture_keeper(&unready,directory,"unready.stdout","u-before\n",3,1,0,&unready_peer)==0);
  REQUIRE(fixture_keeper(&detached,directory,"detached.stdout","d-before\n",4,0,1,NULL)==0);
  ready_a.next=&ready_b;ready_b.next=&unready;unready.next=&detached;
  REQUIRE(fixture_append(directory,"a.stdout","a-final\n")==0);
  REQUIRE(fixture_append(directory,"b.stdout","b-final\n")==0);
  REQUIRE(fixture_append(directory,"unready.stdout","u-final\n")==0);

  /* The kernel dropped individual spool events. Connected observers retain a
     dirty mark until ready, while an attempt without a client needs no notice. */
  br_spool_watch_event(&ready_a,IN_Q_OVERFLOW,-1);
  REQUIRE(ready_a.spool_changed==1);
  REQUIRE(ready_b.spool_changed==1);
  REQUIRE(unready.spool_changed==1);
  REQUIRE(detached.spool_changed==0);

  struct pollfd no_events[5];memset(no_events,0,sizeof(no_events));
  REQUIRE(br_attempt_ready(&ready_a,no_events,NULL,0)==0);
  REQUIRE(br_attempt_ready(&ready_b,no_events,NULL,0)==0);
  REQUIRE(br_attempt_ready(&unready,no_events,NULL,0)==0);
  REQUIRE(br_attempt_ready(&detached,no_events,NULL,0)==0);
  REQUIRE(ready_a.change_queued==1 && ready_b.change_queued==1);
  REQUIRE(unready.change_queued==0 && detached.change_queued==0);
  REQUIRE(unready.spool_changed==1);
  unready.ready=1;
  REQUIRE(br_attempt_ready(&unready,no_events,NULL,0)==0);
  REQUIRE(unready.spool_changed==0 && unready.change_queued==1);

  /* A second overflow while the notice is still queued must not add one. */
  BrBuffer *first=ready_a.outgoing;
  br_spool_watch_event(&ready_a,IN_Q_OVERFLOW,-1);
  REQUIRE(br_attempt_ready(&ready_a,no_events,NULL,0)==0);
  REQUIRE(ready_a.outgoing==first && first->next==NULL && ready_a.change_queued==1);

  BrFrame frame={0};
  REQUIRE(br_flush_responses(&ready_a)==0);
  REQUIRE(ready_a.change_queued==0);
  REQUIRE(br_read_all(a_peer,&frame,sizeof(frame))==0);
  REQUIRE(frame.op==BR_CHANGE && frame.length==0);
  REQUIRE(fixture_final(&ready_a,"a-final\n"));

  frame=(BrFrame){0};
  REQUIRE(br_flush_responses(&ready_b)==0);
  REQUIRE(br_read_all(b_peer,&frame,sizeof(frame))==0);
  REQUIRE(frame.op==BR_CHANGE && frame.length==0);
  REQUIRE(fixture_final(&ready_b,"b-final\n"));

  REQUIRE(unready.outgoing!=NULL && detached.outgoing==NULL);
  REQUIRE(br_flush_responses(&unready)==0);
  REQUIRE(unready.change_queued==0);
  REQUIRE(br_read_all(unready_peer,&frame,sizeof(frame))==0);
  REQUIRE(frame.op==BR_CHANGE && frame.length==0);
  REQUIRE(fixture_final(&unready,"u-final\n"));

  printf("spool-watch-overflow PASS ready=2 coalesced=1 unready-deferred=1 detached=0 final=a,b,u\n");
  fixture_close(&ready_a,a_peer);fixture_close(&ready_b,b_peer);
  fixture_close(&unready,unready_peer);fixture_close(&detached,-1);
  char *a=br_path(directory,"a.stdout"),*b=br_path(directory,"b.stdout");
  char *u=br_path(directory,"unready.stdout"),*d=br_path(directory,"detached.stdout");
  if(a)unlink(a);if(b)unlink(b);if(u)unlink(u);if(d)unlink(d);
  free(a);free(b);free(u);free(d);
  rmdir(directory);
  return 0;
}
