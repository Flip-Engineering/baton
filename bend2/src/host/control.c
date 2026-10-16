#include <errno.h>
#include <fcntl.h>
#include <spawn.h>
#include <sys/stat.h>
#include <unistd.h>

extern char **environ;

typedef struct {
  char *input, *database, *id, *path, *helper, *out, *err;
  int kind, error;
  pid_t pid;
} BatonControl;

static char *baton_control_join(const char *a, const char *b) {
  size_t an=strlen(a),bn=strlen(b);
  if(an>SIZE_MAX-bn-1) return NULL;
  char *s=malloc(an+bn+1);
  if(s) {memcpy(s,a,an);memcpy(s+an,b,bn+1);}
  return s;
}

static char *baton_control_log(const char *database,const char *id,const char *suffix) {
  size_t dn=strlen(database),in=strlen(id),sn=strlen(suffix);
  if(in>(SIZE_MAX-dn-sn-12)/2) return NULL;
  char *path=malloc(dn+11+in*2+sn+1);
  if(!path) return NULL;
  memcpy(path,database,dn);memcpy(path+dn,".dispatch-",10);
  for(size_t i=0;i<in;i++) {
    unsigned char c=(unsigned char)id[i];
    path[dn+10+i*2]="0123456789abcdef"[c>>4];
    path[dn+11+i*2]="0123456789abcdef"[c&15];
  }
  memcpy(path+dn+10+in*2,suffix,sn+1);
  return path;
}

static void baton_control_identity(BatonControl *call) {
  const char *configured=getenv("BATON2_GIT_REGISTRY");
  char *candidate=NULL;
  if(configured && *configured) candidate=strdup(configured);
  else {
    const char *home=getenv("HOME");
    if(home) candidate=baton_control_join(home,"/.config/baton/github-apps/series.json");
    else candidate=strdup("");
  }
  if(!candidate) {call->error=ENOMEM;return;}
  if(!*candidate || access(candidate,F_OK)) {
    int error=*candidate?errno:0;
    free(candidate);
    if(configured && *configured) {call->error=error?error:ENOENT;return;}
    if(error && error!=ENOENT) {call->error=error;return;}
    call->path=strdup("");
    if(!call->path) {call->error=ENOMEM;return;}
  } else {
    call->path=realpath(candidate,NULL);free(candidate);
    if(!call->path) {call->error=errno;return;}
  }
  char *directory=strdup(call->input);
  if(!directory) {call->error=ENOMEM;return;}
  char *slash=strrchr(directory,'/');
  if(!slash) {free(directory);call->error=EINVAL;return;}
  *slash=0;
  char *installed=baton_control_join(directory,"/../libexec/baton2/git-series.mjs");
  if(!installed) {free(directory);call->error=ENOMEM;return;}
  call->helper=realpath(installed,NULL);
  if(!call->helper) {
    candidate=baton_control_join(directory,"/../../bend2/harness/git-series.mjs");
    if(candidate) call->helper=realpath(candidate,NULL);
    free(candidate);
  }
  free(directory);
  if(!call->helper && !*call->path) {call->helper=installed;installed=NULL;}
  free(installed);
  if(!call->helper) call->error=ENOENT;
}

static void baton_control_free_argv(char **argv) {
  if(argv) {for(size_t i=0;argv[i];i++) free(argv[i]);free(argv);}
}

/* Decode the existing length-prefixed argv contract with checked boundaries. */
static char **baton_control_argv(const char *encoded) {
  size_t capacity=8,count=0,remaining=strlen(encoded);
  char **argv=calloc(capacity,sizeof(char *));
  if(!argv) return NULL;
  const char *p=encoded;
  while(remaining) {
    if(*p<'0' || *p>'9') goto invalid;
    errno=0;char *end=NULL;
    unsigned long n=strtoul(p,&end,10);
    size_t prefix=(size_t)(end-p);
    if(errno || prefix>=remaining || *end!=':' || n>remaining-prefix-1) goto invalid;
    p=end+1;remaining-=prefix+1;
    if(count+1==capacity) {
      if(capacity>SIZE_MAX/2/sizeof(char *)) goto invalid;
      capacity*=2;char **next=realloc(argv,capacity*sizeof(char *));
      if(!next) goto invalid;
      argv=next;argv[count]=NULL;
    }
    argv[count]=malloc((size_t)n+1);
    if(!argv[count]) goto invalid;
    memcpy(argv[count],p,n);argv[count][n]=0;
    count++;argv[count]=NULL;p+=n;remaining-=n;
  }
  if(!count || !*argv[0]) goto invalid;
  return argv;
invalid:
  baton_control_free_argv(argv);return NULL;
}

static int baton_control_stream(const char *path) {
  int fd=open(path,O_CREAT|O_WRONLY|O_APPEND|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK,0600);
  if(fd<0) return -1;
  struct stat info;
  if(fstat(fd,&info)) {int error=errno;close(fd);errno=error;return -1;}
  if(!S_ISREG(info.st_mode)) {close(fd);errno=EINVAL;return -1;}
  return fd;
}

static void baton_control_launch(BatonControl *call) {
  char **argv=baton_control_argv(call->input);
  if(!argv) {call->error=EINVAL;return;}
  call->out=baton_control_log(call->database,call->id,".stdout");
  call->err=baton_control_log(call->database,call->id,".stderr");
  if(!call->out || !call->err) {call->error=ENOMEM;goto done;}
  int in=-1,out=-1,err=-1;
  in=open("/dev/null",O_RDONLY|O_CLOEXEC);
  if(in<0) {call->error=errno;goto close_files;}
  out=baton_control_stream(call->out);
  if(out<0) {call->error=errno;goto close_files;}
  err=baton_control_stream(call->err);
  if(err<0) {call->error=errno;goto close_files;}
  posix_spawn_file_actions_t actions;posix_spawnattr_t attr;
  int rc=posix_spawn_file_actions_init(&actions);
  if(rc) {call->error=rc;goto close_files;}
  rc=posix_spawnattr_init(&attr);
  if(rc) {call->error=rc;posix_spawn_file_actions_destroy(&actions);goto close_files;}
#define BC_ACTION(expr) do {rc=(expr);if(rc) goto actions_done;} while(0)
  BC_ACTION(posix_spawn_file_actions_adddup2(&actions,in,STDIN_FILENO));
  BC_ACTION(posix_spawn_file_actions_adddup2(&actions,out,STDOUT_FILENO));
  BC_ACTION(posix_spawn_file_actions_adddup2(&actions,err,STDERR_FILENO));
#ifdef __APPLE__
  short flags=POSIX_SPAWN_SETPGROUP|POSIX_SPAWN_CLOEXEC_DEFAULT;
#else
  BC_ACTION(posix_spawn_file_actions_addclosefrom_np(&actions,3));
  short flags=POSIX_SPAWN_SETPGROUP;
#endif
  BC_ACTION(posix_spawnattr_setpgroup(&attr,0));
  BC_ACTION(posix_spawnattr_setflags(&attr,flags));
  rc=posix_spawnp(&call->pid,argv[0],&actions,&attr,argv,environ);
actions_done:
#undef BC_ACTION
  posix_spawnattr_destroy(&attr);posix_spawn_file_actions_destroy(&actions);
  if(rc) call->error=rc;
close_files:
  if(in>=0) close(in);if(out>=0) close(out);if(err>=0) close(err);
done:
  baton_control_free_argv(argv);
}

static void baton_control_call(IoWork *w) {
  BatonControl *call=(BatonControl *)w->data;
  if(call->kind==2) {baton_control_identity(call);return;}
  if(call->kind==3) {baton_control_launch(call);return;}
  if(call->kind==5) {
    if(strchr(call->input,'/')) call->path=realpath(call->input,NULL);
    else {
      const char *search=getenv("PATH");
      char *path=strdup(search?search:"/usr/bin:/bin");
      if(!path) {call->error=ENOMEM;return;}
      char *cursor=path;
      while(cursor) {
        char *next=strchr(cursor,':');
        if(next) *next++=0;
        char *prefix=baton_control_join(*cursor?cursor:".","/");
        char *candidate=prefix?baton_control_join(prefix,call->input):NULL;
        free(prefix);
        if(!candidate) {call->error=ENOMEM;break;}
        if(!access(candidate,X_OK)) call->path=realpath(candidate,NULL);
        free(candidate);
        if(call->path) break;
        cursor=next;
      }
      free(path);
    }
    if(!call->path && !call->error) call->error=ENOENT;
    struct stat info;
    if(call->path && (stat(call->path,&info) || !S_ISREG(info.st_mode) || access(call->path,X_OK))) call->error=EACCES;
    return;
  }
  if(call->kind==4) {
    char *copy=strdup(call->input);
    if(!copy) {call->error=ENOMEM;return;}
    char *slash=strrchr(copy,'/');
    char *name=slash?slash+1:copy;
    if(!*name || !strcmp(name,".") || !strcmp(name,"..")) {free(copy);call->error=EINVAL;return;}
    char *base=strdup(name);
    if(!base) {free(copy);call->error=ENOMEM;return;}
    if(slash) *slash=0;
    char *directory=realpath(slash?(*copy?copy:"/"):".",NULL);
    if(!directory) call->error=errno;
    else {
      struct stat info;
      if(stat(directory,&info) || !S_ISDIR(info.st_mode)) {call->error=ENOTDIR;free(directory);free(base);free(copy);return;}
      char *prefix=baton_control_join(directory,"/");
      if(prefix) call->path=baton_control_join(prefix,base);
      if(!call->path) call->error=ENOMEM;
      free(prefix);
    }
    free(directory);free(base);free(copy);return;
  }
  call->path=realpath(call->input,NULL);
  if(!call->path) {call->error=errno;return;}
  struct stat info;
  if(stat(call->path,&info)) call->error=errno;
  else if(!S_ISDIR(info.st_mode)) call->error=ENOTDIR;
}

static Term baton_control_pack(Env e,IoWork *w) {
  BatonControl *call=(BatonControl *)w->data;
  Term value=0;
  if(!call->error) {
    if(call->kind==2) value=io_tup(e,io_str(e,call->path,strlen(call->path)),io_str(e,call->helper,strlen(call->helper)));
    else if(call->kind==3) {
      char text[80];snprintf(text,sizeof(text),"{\"deliveryPid\":%ld,\"state\":\"launched\"}",(long)call->pid);
      value=io_str(e,text,strlen(text));
    } else value=io_str(e,call->path,strlen(call->path));
  }
  Term result=call->error?io_fail(e,call->error,"Native control setup failed; inspect the registered session and retained input."):io_done(e,value);
  free(call->input);free(call->database);free(call->id);free(call->path);free(call->helper);free(call->out);free(call->err);free(call);
  w->data=NULL;return result;
}

static Term baton_control_begin(Env e,Term *f,IoWork *w,int kind) {
  BatonControl *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  call->kind=kind;u64 n=0;
  call->input=io_cstr(e,f[0],&n);
  if(strlen(call->input)!=n) call->error=EINVAL;
  if(kind==3) {
    call->database=io_cstr(e,f[1],&n);
    if(strlen(call->database)!=n) call->error=EINVAL;
    call->id=io_cstr(e,f[2],&n);
    if(strlen(call->id)!=n) call->error=EINVAL;
  }
  if(call->error) {free(call->input);free(call->database);free(call->id);free(call);return io_fail(e,EINVAL,"Control arguments contain NUL.");}
  w->data=(char *)call;return io_work(w,baton_control_call,baton_control_pack);
}

#ifdef CID_CONTROL_WORKSPACE
static Term baton_control_workspace(Env e,Term *f,IoWork *w) {return baton_control_begin(e,f,w,1);}
static void __attribute__((constructor)) baton_control_use_workspace(void) {io_eff(CID_CONTROL_WORKSPACE,baton_control_workspace,0);}
#endif
#ifdef CID_CONTROL_IDENTITY
static Term baton_control_find_identity(Env e,Term *f,IoWork *w) {return baton_control_begin(e,f,w,2);}
static void __attribute__((constructor)) baton_control_use_identity(void) {io_eff(CID_CONTROL_IDENTITY,baton_control_find_identity,0);}
#endif
#ifdef CID_CONTROL_OUTPUT
static Term baton_control_output(Env e,Term *f,IoWork *w) {return baton_control_begin(e,f,w,4);}
static void __attribute__((constructor)) baton_control_use_output(void) {io_eff(CID_CONTROL_OUTPUT,baton_control_output,0);}
#endif
#ifdef CID_CONTROL_COMMAND
static Term baton_control_command(Env e,Term *f,IoWork *w) {return baton_control_begin(e,f,w,5);}
static void __attribute__((constructor)) baton_control_use_command(void) {io_eff(CID_CONTROL_COMMAND,baton_control_command,0);}
#endif
#ifdef CID_CONTROL_LAUNCH
static Term baton_control_spawn(Env e,Term *f,IoWork *w) {return baton_control_begin(e,f,w,3);}
static void __attribute__((constructor)) baton_control_use_launch(void) {io_eff(CID_CONTROL_LAUNCH,baton_control_spawn,0);}
#endif
