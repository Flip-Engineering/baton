#include <errno.h>
#include <fcntl.h>
#include <spawn.h>
#include <string.h>
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

/* SHA-256, self-contained in this translation unit. The dispatch log name
 * for an oversized identity hashes the full database path and the full
 * UTF-8 original ID, separated by one NUL byte, and renders the digest as
 * 64 hexadecimal characters. */
typedef struct { unsigned int state[8]; unsigned long long length; unsigned char block[64]; size_t used; } BcSha256;
static const unsigned int bc_sha256_k[64]={
  0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,0x3956c25bu,0x59f111f1u,0x923f82a4u,0xab1c5ed5u,
  0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,
  0xe49b69c1u,0xefbe4786u,0x0fc19dc6u,0x240ca1ccu,0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,
  0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,0xc6e00bf3u,0xd5a79147u,0x06ca6351u,0x14292967u,
  0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,
  0xa2bfe8a1u,0xa81a664bu,0xc24b8b70u,0xc76c51a3u,0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,
  0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,0x391c0cb3u,0x4ed8aa4au,0x5b9cca4fu,0x682e6ff3u,
  0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u};
#define BC_ROR(x,n) (((x)>>(n))|((x)<<(32-(n))))
static void bc_sha256_block(BcSha256 *sha,const unsigned char *block) {
  unsigned int w[64];
  for(int i=0;i<16;i++)
    w[i]=((unsigned int)block[i*4]<<24)|((unsigned int)block[i*4+1]<<16)|((unsigned int)block[i*4+2]<<8)|(unsigned int)block[i*4+3];
  for(int i=16;i<64;i++) {
    unsigned int a=w[i-15],b=w[i-2];
    unsigned int s0=BC_ROR(a,7)^BC_ROR(a,18)^(a>>3),s1=BC_ROR(b,17)^BC_ROR(b,19)^(b>>10);
    w[i]=w[i-16]+s0+w[i-7]+s1;
  }
  unsigned int a=sha->state[0],b=sha->state[1],c=sha->state[2],d=sha->state[3];
  unsigned int e=sha->state[4],f=sha->state[5],g=sha->state[6],h=sha->state[7];
  for(int i=0;i<64;i++) {
    unsigned int s1=BC_ROR(e,6)^BC_ROR(e,11)^BC_ROR(e,25);
    unsigned int ch=(e&f)^((~e)&g);
    unsigned int t1=h+s1+ch+bc_sha256_k[i]+w[i];
    unsigned int s0=BC_ROR(a,2)^BC_ROR(a,13)^BC_ROR(a,22);
    unsigned int maj=(a&b)^(a&c)^(b&c);
    unsigned int t2=s0+maj;
    h=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;
  }
  sha->state[0]+=a;sha->state[1]+=b;sha->state[2]+=c;sha->state[3]+=d;
  sha->state[4]+=e;sha->state[5]+=f;sha->state[6]+=g;sha->state[7]+=h;
}
static void bc_sha256_init(BcSha256 *sha) {
  static const unsigned int initial[8]={0x6a09e667u,0xbb67ae85u,0x3c6ef372u,0xa54ff53au,
    0x510e527fu,0x9b05688cu,0x1f83d9abu,0x5be0cd19u};
  for(int i=0;i<8;i++) sha->state[i]=initial[i];
  sha->length=0;sha->used=0;
}
static void bc_sha256_update(BcSha256 *sha,const unsigned char *data,size_t length) {
  sha->length+=(unsigned long long)length;
  while(length) {
    size_t room=64-sha->used,count=length<room?length:room;
    for(size_t i=0;i<count;i++) sha->block[sha->used+i]=data[i];
    sha->used+=count;data+=count;length-=count;
    if(sha->used==64){bc_sha256_block(sha,sha->block);sha->used=0;}
  }
}
static void bc_sha256_final(BcSha256 *sha,unsigned char out[32]) {
  unsigned long long bits=sha->length*8;
  unsigned char pad=0x80;
  bc_sha256_update(sha,&pad,1);
  pad=0;
  while(sha->used!=56)bc_sha256_update(sha,&pad,1);
  unsigned char tail[8];
  for(int i=0;i<8;i++)tail[i]=(unsigned char)(bits>>(56-i*8));
  bc_sha256_update(sha,tail,8);
  for(int i=0;i<8;i++) {
    out[i*4]=(unsigned char)(sha->state[i]>>24);out[i*4+1]=(unsigned char)(sha->state[i]>>16);
    out[i*4+2]=(unsigned char)(sha->state[i]>>8);out[i*4+3]=(unsigned char)sha->state[i];
  }
}

/* The observed filesystem component limit for dispatch log names. */
#define BATON_CONTROL_NAME_MAX 255

/* The dispatch log name hex-encodes the full original ID beside the database.
 * When that component would exceed the filesystem limit, the name instead
 * carries a bounded strong identity: SHA-256 over the full database identity
 * and the full UTF-8 original ID, separated by a NUL byte that cannot occur
 * in either C string, so the identity binds both exactly. Fitting names stay
 * byte-identical. A bounded name that still does not fit is refused with
 * ENAMETOOLONG rather than truncated. */
static char *baton_control_log(const char *database,const char *id,const char *suffix) {
  errno=0;
  size_t dn=strlen(database),in=strlen(id),sn=strlen(suffix);
  const char *base=strrchr(database,'/');
  base=base?base+1:database;
  size_t bn=dn-(size_t)(base-database);
  if(in<=(SIZE_MAX-dn-sn-12)/2 && bn+10+in*2+sn<=BATON_CONTROL_NAME_MAX) {
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
  if(bn+10+64+sn>BATON_CONTROL_NAME_MAX) {errno=ENAMETOOLONG;return NULL;}
  BcSha256 sha;unsigned char digest[32];
  bc_sha256_init(&sha);
  bc_sha256_update(&sha,(const unsigned char *)database,dn);
  unsigned char separator=0;
  bc_sha256_update(&sha,&separator,1);
  bc_sha256_update(&sha,(const unsigned char *)id,in);
  bc_sha256_final(&sha,digest);
  char identity[65];
  for(int i=0;i<32;i++) {
    identity[i*2]="0123456789abcdef"[digest[i]>>4];
    identity[i*2+1]="0123456789abcdef"[digest[i]&15];
  }
  identity[64]=0;
  char *path=malloc(dn+11+64+sn+1);
  if(!path) return NULL;
  memcpy(path,database,dn);memcpy(path+dn,".dispatch-",10);
  memcpy(path+dn+10,identity,64);
  memcpy(path+dn+10+64,suffix,sn+1);
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
  if(!call->out || !call->err) {call->error=errno==ENAMETOOLONG?ENAMETOOLONG:ENOMEM;goto done;}
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
