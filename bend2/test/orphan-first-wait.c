#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <pthread.h>
static int fixture_create(pthread_t *,const pthread_attr_t *,void *(*)(void *),void *);
#define pthread_create fixture_create
#define main generated_main
#include BATON2_PROCESS_SOURCE
#undef main
#undef pthread_create
#include <sys/file.h>

/* Hold the actual follower until the attached handle has supplied its first wait. */
static pthread_mutex_t fixture_mutex=PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t fixture_changed=PTHREAD_COND_INITIALIZER;
static int fixture_entered,fixture_released;
static void *fixture_follow(void *argument) {
  pthread_mutex_lock(&fixture_mutex);
  fixture_entered=1;pthread_cond_broadcast(&fixture_changed);
  while(!fixture_released)pthread_cond_wait(&fixture_changed,&fixture_mutex);
  pthread_mutex_unlock(&fixture_mutex);
  return br_follow(argument);
}
static int fixture_create(pthread_t *thread,const pthread_attr_t *attr,void *(*fn)(void *),void *arg) {
  if(fn!=br_follow)return pthread_create(thread,attr,fn,arg);
  int error=pthread_create(thread,attr,fixture_follow,arg);
  if(error)return error;
  pthread_mutex_lock(&fixture_mutex);
  while(!fixture_entered)pthread_cond_wait(&fixture_changed,&fixture_mutex);
  pthread_mutex_unlock(&fixture_mutex);
  return 0;
}
#define REQUIRE(test) do { if(!(test)) { fprintf(stderr,"fixture failure: %s (errno %d)\n",#test,errno); return 2; } } while(0)

int main(int argc,char **argv) {
  REQUIRE(argc==3);
  const char *mode=argv[1],*directory=argv[2];
  int absent=!strcmp(mode,"absent"), malformed=!strcmp(mode,"malformed");
  int signalled=!strcmp(mode,"signal"), zero=!strcmp(mode,"zero");
  REQUIRE(absent || malformed || signalled || zero || !strcmp(mode,"nonzero"));
  REQUIRE(br_file(directory,"stdout","",0,1)==0);
  int gate[2];REQUIRE(pipe(gate)==0);
  pid_t native=fork();REQUIRE(native>=0);
  if(native==0) {
    close(gate[1]);char byte;
    ssize_t received;do {received=read(gate[0],&byte,1);}while(received<0 && errno==EINTR);
    close(gate[0]);
    if(received!=1)_exit(99);
    if(signalled){signal(SIGTERM,SIG_DFL);raise(SIGTERM);_exit(98);}
    _exit(zero?0:13);
  }
  close(gate[0]);
  BrBirth birth;REQUIRE(br_birth(native,&birth)==0);
  REQUIRE(br_file(directory,"native.birth",&birth,sizeof(birth),1)==0);
  REQUIRE(write(gate[1],"x",1)==1);close(gate[1]);
  int status;pid_t ended;
  do {ended=waitpid(native,&status,0);}while(ended<0 && errno==EINTR);
  REQUIRE(ended==native);
  REQUIRE(signalled?(WIFSIGNALED(status) && WTERMSIG(status)==SIGTERM):
                    (WIFEXITED(status) && WEXITSTATUS(status)==(zero?0:13)));
  if(!absent) {
    char raw[64];int length=snprintf(raw,sizeof(raw),"%d\n",status);
    REQUIRE(br_file(directory,"status",malformed?"unavailable\n":raw,malformed?12:(size_t)length,1)==0);
  }
  char *guard_path=br_path(directory,"fixture.guard");REQUIRE(guard_path!=NULL);
  int guard=open(guard_path,O_CREAT|O_RDWR|O_CLOEXEC,0600);free(guard_path);
  REQUIRE(guard>=0);REQUIRE(flock(guard,LOCK_EX|LOCK_NB)==0);
  BatonChild child={0};REQUIRE(br_attach_orphan(&child,directory,guard)==0);
  REQUIRE(child.pid==native && fixture_entered && !fixture_released);
  BatonProcessCall first={.kind=BP_WAIT,.child=&child};
  baton_retained_call(&first);
  pthread_mutex_lock(&fixture_mutex);fixture_released=1;
  pthread_cond_broadcast(&fixture_changed);pthread_mutex_unlock(&fixture_mutex);
  REQUIRE(pthread_join(child.retained->receiver,NULL)==0);
  REQUIRE(!first.error && first.text!=NULL);
  const char *expected=absent || malformed?"unknown after keeper loss":
                       signalled?"signal 15":zero?"exit 0":"exit 13";
  BatonProcessCall after={.kind=BP_WAIT,.child=&child};baton_retained_call(&after);
  REQUIRE(!after.error && after.text!=NULL && !strcmp(after.text,expected));
  printf("{\"case\":\"%s\",\"native\":%d,\"rawStatus\":%d,\"firstWait\":\"%s\",\"afterFollower\":\"%s\",\"expected\":\"%s\"}\n",
         mode,native,status,first.text,after.text,expected);
  int matches=!strcmp(first.text,expected);
  if(!matches)fprintf(stderr,"first wait mismatch: expected %s; observed %s\n",expected,first.text);
  free(first.text);free(after.text);
  BatonRetained *retained=child.retained;
  close(guard);close(retained->guard);close(retained->spool);
  if(retained->watch>=0)close(retained->watch);
  if(retained->life>=0)close(retained->life);
  pthread_mutex_destroy(&retained->state);pthread_mutex_destroy(&retained->command);
  pthread_mutex_destroy(&retained->reader);pthread_cond_destroy(&retained->changed);
  free(retained->directory);free(retained);
  return matches?0:1;
}
