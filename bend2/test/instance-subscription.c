#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <unistd.h>
static ssize_t fixture_read(int descriptor,void *bytes,size_t length);
#define read fixture_read
#define main generated_main
#include BATON2_PROCESS_SOURCE
#undef main
#undef read

#define REQUIRE(test) do { if(!(test)) { fprintf(stderr,"fixture failure: %s (errno %d)\n",#test,errno); return 2; } } while(0)

static pthread_mutex_t fixture_mutex=PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t fixture_changed=PTHREAD_COND_INITIALIZER;
static int fixture_descriptor=-1,fixture_reads;

/* The second call follows consumption of the first frame byte. It marks the
   real read operation whose remaining frame bytes are still unavailable. */
static ssize_t fixture_read(int descriptor,void *bytes,size_t length) {
  pthread_mutex_lock(&fixture_mutex);
  if(descriptor==fixture_descriptor) {
    fixture_reads++;
    pthread_cond_signal(&fixture_changed);
  }
  pthread_mutex_unlock(&fixture_mutex);
  return read(descriptor,bytes,length);
}

static int fixture_subscription(BatonProcessCall *selected,int *peer) {
  int sockets[2];
  if(socketpair(AF_UNIX,SOCK_STREAM,0,sockets))return errno;
  int error=baton_child_allocate(selected);
  if(error) {close(sockets[0]);close(sockets[1]);return error;}
  BatonRetained *retained=calloc(1,sizeof(*retained));
  if(!retained) {close(sockets[0]);close(sockets[1]);return ENOMEM;}
  retained->socket=sockets[0];selected->child->retained=retained;
  *peer=sockets[1];return 0;
}

static void fixture_call(BatonProcessCall *call) {
  IoWork work={.data=(char *)call};
  baton_process_call(&work);
}
static void *fixture_notice(void *data) {
  fixture_call(data);return NULL;
}
static int fixture_unsubscribe(BatonProcessCall *selected) {
  BatonProcessCall removed=*selected;removed.kind=BP_INSTANCE_UNSUBSCRIBE;
  int error=br_subscription_prepare(&removed);
  if(error)return error;
  if(baton_children[selected->index])return EBUSY;
  fixture_call(&removed);
  selected->child=NULL;
  return removed.error;
}

int main(int argc,char **argv) {
  REQUIRE(argc==2);
  BatonProcessCall selected={0};int peer=-1;
  REQUIRE(fixture_subscription(&selected,&peer)==0);
  BatonProcessCall notice=selected;notice.kind=BP_INSTANCE_NOTICE;
  REQUIRE(br_subscription_prepare(&notice)==0);
  int descriptor=notice.notice_socket;
  REQUIRE(descriptor>=0 && notice.child==NULL);
  int flags=fcntl(descriptor,F_GETFD);
  REQUIRE(flags>=0 && (flags&FD_CLOEXEC));
  if(!strcmp(argv[1],"blocked")) {
    fixture_descriptor=descriptor;
    char first=0;REQUIRE(br_write_all(peer,&first,1)==0);
    pthread_t thread;REQUIRE(pthread_create(&thread,NULL,fixture_notice,&notice)==0);
    pthread_mutex_lock(&fixture_mutex);
    while(fixture_reads<2)pthread_cond_wait(&fixture_changed,&fixture_mutex);
    pthread_mutex_unlock(&fixture_mutex);
    REQUIRE(fixture_unsubscribe(&selected)==0);
    REQUIRE(pthread_join(thread,NULL)==0);
    REQUIRE(notice.error==EPIPE);
    puts("blocked-notice-returned");
  } else if(!strcmp(argv[1],"queued")) {
    REQUIRE(fixture_unsubscribe(&selected)==0);
    /* Reuse the closed registry entry for a distinct subscription. The queued
       old read must retain its own closed socket and leave this frame intact. */
    BatonChild *replacement=calloc(1,sizeof(*replacement));
    BatonRetained *retained=calloc(1,sizeof(*retained));int sockets[2];
    REQUIRE(replacement && retained && socketpair(AF_UNIX,SOCK_STREAM,0,sockets)==0);
    replacement->retained=retained;retained->socket=sockets[0];
    baton_children[selected.index]=replacement;
    BrInstanceFrame frame={.op=BI_NOTICE,.epoch=19,.length=sizeof(BrInstanceNotice)};
    BrInstanceNotice expected={.cursor=37,.kind=BN_COMMIT};
    REQUIRE(br_write_all(sockets[1],&frame,sizeof(frame))==0);
    REQUIRE(br_write_all(sockets[1],&expected,sizeof(expected))==0);
    fixture_call(&notice);
    REQUIRE(notice.error==EPIPE);
    BrInstanceNotice actual={0};uint64_t generation=0;
    REQUIRE(br_instance_notice(sockets[0],&actual,&generation)==0);
    REQUIRE(actual.cursor==37 && actual.kind==BN_COMMIT && generation==19);
    br_subscription_free(retained);free(replacement);
    baton_children[selected.index]=NULL;close(sockets[1]);
    puts("queued-notice-returned-replacement-intact");
  } else if(!strcmp(argv[1],"notice")) {
    BrInstanceFrame frame={.op=BI_NOTICE,.epoch=23,.length=sizeof(BrInstanceNotice)};
    BrInstanceNotice expected={.cursor=41,.kind=BN_COMMIT};
    REQUIRE(br_write_all(peer,&frame,sizeof(frame))==0);
    REQUIRE(br_write_all(peer,&expected,sizeof(expected))==0);
    fixture_call(&notice);
    REQUIRE(notice.error==0 && notice.text);
    REQUIRE(!strcmp(notice.text,"{\"kind\":\"commit\",\"cursor\":41,\"generation\":23}"));
    REQUIRE(fixture_unsubscribe(&selected)==0);
    puts(notice.text);
  } else return 2;
  REQUIRE(notice.notice_socket==-1);
  errno=0;REQUIRE(fcntl(descriptor,F_GETFD)==-1 && errno==EBADF);
  close(peer);free(notice.text);
  return 0;
}
