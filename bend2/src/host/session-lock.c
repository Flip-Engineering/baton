#include <errno.h>
#include <fcntl.h>
#include <sys/file.h>
#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif

typedef struct {
  char *database, *session, *path;
  int handle, error, kind;
} BatonSessionLock;

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
  char *database=realpath(call->database,NULL);
  if(!database) {call->error=errno;return;}
  size_t prefix=strlen(database), length=strlen(call->session);
  char *path=malloc(prefix+7+length*2);
  if(!path) {free(database);call->error=ENOMEM;return;}
  memcpy(path,database,prefix); memcpy(path+prefix,".lock-",6);
  for(size_t i=0;i<length;i++) {
    unsigned char c=(unsigned char)call->session[i];
    path[prefix+6+i*2]="0123456789abcdef"[c>>4];
    path[prefix+7+i*2]="0123456789abcdef"[c&15];
  }
  path[prefix+6+length*2]=0;
  call->handle=open(path,O_CREAT|O_RDWR|O_CLOEXEC,0600);
  free(path);free(database);
  if(call->handle<0) {call->error=errno;return;}
  int result;
  do {result=flock(call->handle,LOCK_EX|(call->kind==3?LOCK_NB:0));} while(result<0 && errno==EINTR);
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
  Term result=call->error ? io_fail(e,call->error,NULL) : io_done(e,value);
  free(call->database);free(call->session);free(call->path);free(call);
  w->data=NULL;
  return result;
}

static Term baton_session_lock_begin(Env e, Term *f, IoWork *w, int kind) {
  BatonSessionLock *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  call->kind=kind;
  if(kind==0 || kind==3) {
    u64 dn=0,sn=0;
    call->database=io_cstr(e,f[0],&dn);
    call->session=io_cstr(e,f[1],&sn);
    if(strlen(call->database)!=dn || strlen(call->session)!=sn) {
      free(call->database);free(call->session);free(call);
      return io_fail(e,EINVAL,"database or session contains NUL");
    }
  } else if(kind==4) {
    u64 length=0;
    call->database=io_cstr(e,f[0],&length);
    if(strlen(call->database)!=length) {free(call->database);free(call);return io_fail(e,EINVAL,"database path contains NUL");}
  } else if(kind==1) call->handle=(int)f[0];
  w->data=(char *)call;
  return io_work(w,baton_session_lock_call,baton_session_lock_pack);
}

#ifdef CID_SESSIONLOCK_ACQUIRE
static Term baton_session_lock_acquire(Env e,Term *f,IoWork *w) {return baton_session_lock_begin(e,f,w,0);}
static void __attribute__((constructor)) baton_session_lock_use_acquire(void) {io_eff(CID_SESSIONLOCK_ACQUIRE,baton_session_lock_acquire,0);}
#endif
#ifdef CID_SESSIONLOCK_CANONICAL
static Term baton_session_lock_canonical(Env e,Term *f,IoWork *w) {return baton_session_lock_begin(e,f,w,4);}
static void __attribute__((constructor)) baton_session_lock_use_canonical(void) {io_eff(CID_SESSIONLOCK_CANONICAL,baton_session_lock_canonical,0);}
#endif
#ifdef CID_SESSIONLOCK_TRY_ACQUIRE
static Term baton_session_lock_try_acquire(Env e,Term *f,IoWork *w) {return baton_session_lock_begin(e,f,w,3);}
static void __attribute__((constructor)) baton_session_lock_use_try_acquire(void) {io_eff(CID_SESSIONLOCK_TRY_ACQUIRE,baton_session_lock_try_acquire,0);}
#endif
#ifdef CID_SESSIONLOCK_RELEASE
static Term baton_session_lock_release(Env e,Term *f,IoWork *w) {return baton_session_lock_begin(e,f,w,1);}
static void __attribute__((constructor)) baton_session_lock_use_release(void) {io_eff(CID_SESSIONLOCK_RELEASE,baton_session_lock_release,0);}
#endif
#ifdef CID_SESSIONLOCK_EXECUTABLE
static Term baton_session_lock_executable(Env e,Term *f,IoWork *w) {return baton_session_lock_begin(e,f,w,2);}
static void __attribute__((constructor)) baton_session_lock_use_executable(void) {io_eff(CID_SESSIONLOCK_EXECUTABLE,baton_session_lock_executable,0);}
#endif
