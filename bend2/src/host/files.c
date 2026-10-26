#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

typedef struct { char *directory,*suffix,*path; int error; } BatonFindFile;

static void baton_find_file_call(IoWork *w) {
  BatonFindFile *call=(BatonFindFile *)w->data;
  DIR *directory=opendir(call->directory);
  if(!directory) {if(errno!=ENOENT) call->error=errno;return;}
  size_t suffix=strlen(call->suffix);
  struct dirent *entry;
  errno=0;
  while((entry=readdir(directory))) {
    size_t length=strlen(entry->d_name);
    if(length>=suffix && !strcmp(entry->d_name+length-suffix,call->suffix)) {
      size_t base=strlen(call->directory);
      call->path=malloc(base+length+2);
      if(!call->path) {call->error=ENOMEM;break;}
      memcpy(call->path,call->directory,base);call->path[base]='/';
      memcpy(call->path+base+1,entry->d_name,length+1);
      break;
    }
  }
  if(!entry && errno) call->error=errno;
  closedir(directory);
}

static Term baton_find_file_pack(Env e,IoWork *w) {
  BatonFindFile *call=(BatonFindFile *)w->data;
  Term result=call->error ? io_fail(e,call->error,NULL)
    : io_done(e,io_str(e,call->path?call->path:"",call->path?strlen(call->path):0));
  free(call->directory);free(call->suffix);free(call->path);free(call);w->data=NULL;
  return result;
}

#ifdef CID_FILES_FIND_SUFFIX
static Term baton_find_file_run(Env e,Term *f,IoWork *w) {
  BatonFindFile *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  u64 dn=0,sn=0;
  call->directory=io_cstr(e,f[0],&dn);call->suffix=io_cstr(e,f[1],&sn);
  if(strlen(call->directory)!=dn || strlen(call->suffix)!=sn) {
    free(call->directory);free(call->suffix);free(call);
    return io_fail(e,EINVAL,"directory or suffix contains NUL");
  }
  w->data=(char *)call;
  return io_work(w,baton_find_file_call,baton_find_file_pack);
}
static void __attribute__((constructor)) baton_find_file_use(void) {io_eff(CID_FILES_FIND_SUFFIX,baton_find_file_run,0);}
#endif

/* Log inspection reads a file's size. Cleanup removes named Baton2-owned log
   artifacts. A missing path reports zero bytes, and removing a missing path
   succeeds. */
typedef struct { char *path,*target; size_t size; u32 mode; int error; } BatonFileOp;

static u32 baton_file_size(BatonFileOp *call) {
  return call->size > 0xffffffffu ? 0xffffffffu : (u32)call->size;
}

static void baton_file_size_call(IoWork *w) {
  BatonFileOp *call=(BatonFileOp *)w->data;
  struct stat info;
  if(!stat(call->path,&info)) call->size=(size_t)info.st_size;
  else if(errno!=ENOENT) call->error=errno;
}

static Term baton_file_size_pack(Env e,IoWork *w) {
  BatonFileOp *call=(BatonFileOp *)w->data;
  Term result=call->error ? io_fail(e,call->error,NULL) : io_done(e,(Term)baton_file_size(call));
  free(call->path);free(call->target);free(call);w->data=NULL;
  return result;
}

static void baton_file_rename_call(IoWork *w) {
  BatonFileOp *call=(BatonFileOp *)w->data;
  if(rename(call->path,call->target) && errno!=ENOENT) call->error=errno;
}

static void baton_file_remove_call(IoWork *w) {
  BatonFileOp *call=(BatonFileOp *)w->data;
  if(unlink(call->path) && errno!=ENOENT) call->error=errno;
}

static void baton_file_mkdir_call(IoWork *w) {
  BatonFileOp *call=(BatonFileOp *)w->data;
  if(mkdir(call->path,0700)) {
    if(errno!=EEXIST) call->error=errno;
    else {
      struct stat info;
      if(stat(call->path,&info)) call->error=errno;
      else if(!S_ISDIR(info.st_mode)) call->error=ENOTDIR;
    }
  }
}

static Term baton_file_unit_pack(Env e,IoWork *w) {
  BatonFileOp *call=(BatonFileOp *)w->data;
  Term result=call->error ? io_fail(e,call->error,NULL) : io_done(e,term_pak(CID_UNIT,0));
  free(call->path);free(call->target);free(call);w->data=NULL;
  return result;
}

/* The call owns its path arguments. An invalid path reports EINVAL through the
   call's own error field; only an allocation failure needs an immediate answer. */
static BatonFileOp *baton_file_op(Env e,Term *f,IoWork *w,int inputs) {
  BatonFileOp *call=calloc(1,sizeof(*call));
  if(!call) {w->data=NULL;return NULL;}
  u64 length=0;
  call->path=io_cstr(e,f[0],&length);
  if(!call->path || strlen(call->path)!=length) call->error=EINVAL;
  if(inputs>1 && !call->error) {
    call->target=io_cstr(e,f[1],&length);
    if(!call->target || strlen(call->target)!=length) call->error=EINVAL;
  }
  w->data=(char *)call;
  return call;
}

#ifdef CID_FILES_SIZE
static Term baton_file_size_run(Env e,Term *f,IoWork *w) {
  BatonFileOp *call=baton_file_op(e,f,w,1);
  if(!call) return io_fail(e,ENOMEM,NULL);
  if(call->error) return baton_file_size_pack(e,w);
  return io_work(w,baton_file_size_call,baton_file_size_pack);
}
static void __attribute__((constructor)) baton_file_size_use(void) {io_eff(CID_FILES_SIZE,baton_file_size_run,0);}
#endif

#ifdef CID_FILES_MODE_OF
static void baton_file_mode_call(IoWork *w) {
  BatonFileOp *call=(BatonFileOp *)w->data;
  struct stat info;
  if(!stat(call->path,&info)) call->mode=(u32)(info.st_mode & 07777);
  else call->error=errno;
}
static Term baton_file_mode_pack(Env e,IoWork *w) {
  BatonFileOp *call=(BatonFileOp *)w->data;
  Term result=call->error ? io_fail(e,call->error,NULL) : io_done(e,(Term)call->mode);
  free(call->path);free(call->target);free(call);w->data=NULL;
  return result;
}
static Term baton_file_mode_run(Env e,Term *f,IoWork *w) {
  BatonFileOp *call=baton_file_op(e,f,w,1);
  if(!call) return io_fail(e,ENOMEM,NULL);
  if(call->error) return baton_file_mode_pack(e,w);
  return io_work(w,baton_file_mode_call,baton_file_mode_pack);
}
static void __attribute__((constructor)) baton_file_mode_use(void) {io_eff(CID_FILES_MODE_OF,baton_file_mode_run,0);}
#endif

#ifdef CID_FILES_WRITE_PRIVATE
typedef struct { char *path,*text; size_t length; int error; } BatonPrivateWrite;
static void baton_private_write_call(IoWork *w) {
  BatonPrivateWrite *call=(BatonPrivateWrite *)w->data;
  int flags=O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC;
#ifdef O_NOFOLLOW
  flags|=O_NOFOLLOW;
#endif
  int fd=open(call->path,flags,0600);
  if(fd<0) {call->error=errno;return;}
  if(fchmod(fd,0600)) {call->error=errno;close(fd);return;}
  size_t offset=0;
  while(offset<call->length) {
    ssize_t count=write(fd,call->text+offset,call->length-offset);
    if(count>0) {offset+=(size_t)count;continue;}
    if(count<0 && errno==EINTR) continue;
    call->error=count<0?errno:EIO;
    break;
  }
  if(close(fd) && !call->error) call->error=errno;
}
static Term baton_private_write_pack(Env e,IoWork *w) {
  BatonPrivateWrite *call=(BatonPrivateWrite *)w->data;
  Term result=call->error?io_fail(e,call->error,NULL):io_done(e,term_pak(CID_UNIT,0));
  free(call->path);free(call->text);free(call);w->data=NULL;
  return result;
}
static Term baton_private_write_run(Env e,Term *f,IoWork *w) {
  BatonPrivateWrite *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  u64 path_length=0,text_length=0;
  call->path=io_cstr(e,f[0],&path_length);
  call->text=io_cstr(e,f[1],&text_length);
  call->length=text_length;
  if(!call->path || strlen(call->path)!=path_length) call->error=EINVAL;
  w->data=(char *)call;
  if(call->error) return baton_private_write_pack(e,w);
  return io_work(w,baton_private_write_call,baton_private_write_pack);
}
static void __attribute__((constructor)) baton_private_write_use(void) {io_eff(CID_FILES_WRITE_PRIVATE,baton_private_write_run,0);}
#endif

#ifdef CID_FILES_MKDIR
static Term baton_file_mkdir_run(Env e,Term *f,IoWork *w) {
  BatonFileOp *call=baton_file_op(e,f,w,1);
  if(!call) return io_fail(e,ENOMEM,NULL);
  if(call->error) return baton_file_unit_pack(e,w);
  return io_work(w,baton_file_mkdir_call,baton_file_unit_pack);
}
static void __attribute__((constructor)) baton_file_mkdir_use(void) {io_eff(CID_FILES_MKDIR,baton_file_mkdir_run,0);}
#endif

#ifdef CID_FILES_WRITABLE
static void baton_file_writable_call(IoWork *w) {
  BatonFileOp *call=(BatonFileOp *)w->data;
  if(access(call->path,W_OK)) call->error=errno;
}
static Term baton_file_writable_run(Env e,Term *f,IoWork *w) {
  BatonFileOp *call=baton_file_op(e,f,w,1);
  if(!call) return io_fail(e,ENOMEM,NULL);
  if(call->error) return baton_file_unit_pack(e,w);
  return io_work(w,baton_file_writable_call,baton_file_unit_pack);
}
static void __attribute__((constructor)) baton_file_writable_use(void) {io_eff(CID_FILES_WRITABLE,baton_file_writable_run,0);}
#endif

#ifdef CID_FILES_RENAME
static Term baton_file_rename_run(Env e,Term *f,IoWork *w) {
  BatonFileOp *call=baton_file_op(e,f,w,2);
  if(!call) return io_fail(e,ENOMEM,NULL);
  if(call->error) return baton_file_unit_pack(e,w);
  return io_work(w,baton_file_rename_call,baton_file_unit_pack);
}
static void __attribute__((constructor)) baton_file_rename_use(void) {io_eff(CID_FILES_RENAME,baton_file_rename_run,0);}
#endif

#ifdef CID_FILES_REMOVE
static Term baton_file_remove_run(Env e,Term *f,IoWork *w) {
  BatonFileOp *call=baton_file_op(e,f,w,1);
  if(!call) return io_fail(e,ENOMEM,NULL);
  if(call->error) return baton_file_unit_pack(e,w);
  return io_work(w,baton_file_remove_call,baton_file_unit_pack);
}
static void __attribute__((constructor)) baton_file_remove_use(void) {io_eff(CID_FILES_REMOVE,baton_file_remove_run,0);}
#endif

/* Attempt cleanup is limited to regular diagnostic files in a sibling
   <database>.attempt-* directory. Open the directory without following its
   final component, verify it shares the database's canonical parent, and
   unlink only the named regular file relative to that directory handle. */
typedef struct { char *database,*directory,*name,*answer; int error; } BatonAttemptFile;

static int baton_attempt_name_allowed(const char *name) {
  return !strcmp(name,"stdout") || !strcmp(name,"native.stderr") ||
    !strcmp(name,"stderr.full") || !strcmp(name,"stderr.meta") || !strcmp(name,"stderr-processing-error") ||
    !strcmp(name,"observer.log") || !strcmp(name,"keeper.log");
}

static char *baton_parent_path(const char *path) {
  char *copy=strdup(path);
  if(!copy)return NULL;
  char *slash=strrchr(copy,'/');
  if(!slash) {free(copy);return strdup(".");}
  if(slash==copy) slash[1]=0;
  else *slash=0;
  return copy;
}

static const char *baton_base_name(const char *path) {
  const char *slash=strrchr(path,'/');
  return slash?slash+1:path;
}

static void baton_attempt_remove_call(IoWork *w) {
  BatonAttemptFile *call=(BatonAttemptFile *)w->data;
  char *database=realpath(call->database,NULL),*directory=realpath(call->directory,NULL);
  char *database_parent=database?baton_parent_path(database):NULL;
  char *directory_parent=directory?baton_parent_path(directory):NULL;
  struct stat before,opened,canonical;
  int dirfd=-1;
  if(!baton_attempt_name_allowed(call->name) || !database || !directory ||
     !database_parent || !directory_parent) call->error=EINVAL;
  else if(strcmp(database_parent,directory_parent)) call->error=EPERM;
  else {
    size_t prefix=strlen(baton_base_name(call->database));
    const char *base=baton_base_name(call->directory);
    if(strncmp(base,baton_base_name(call->database),prefix) ||
       strncmp(base+prefix,".attempt-",9)) call->error=EPERM;
    else if(lstat(call->directory,&before)) call->error=errno;
    else if(!S_ISDIR(before.st_mode)) call->error=EINVAL;
    else if((dirfd=open(call->directory,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC))<0) call->error=errno;
    else if(fstat(dirfd,&opened) || stat(directory,&canonical) ||
            opened.st_dev!=before.st_dev || opened.st_ino!=before.st_ino ||
            opened.st_dev!=canonical.st_dev || opened.st_ino!=canonical.st_ino) call->error=ESTALE;
    else {
      struct stat file;
      if(fstatat(dirfd,call->name,&file,AT_SYMLINK_NOFOLLOW)) {
        if(errno==ENOENT) call->answer=strdup("missing");
        else call->error=errno;
      } else if(!S_ISREG(file.st_mode)) call->error=EINVAL;
      else if(unlinkat(dirfd,call->name,0)) call->error=errno;
      else call->answer=strdup("removed");
      if(!call->answer && !call->error) call->error=ENOMEM;
    }
  }
  if(dirfd>=0)close(dirfd);
  free(database);free(directory);free(database_parent);free(directory_parent);
}

static Term baton_attempt_file_pack(Env e,IoWork *w) {
  BatonAttemptFile *call=(BatonAttemptFile *)w->data;
  Term result=call->error?io_fail(e,call->error,"attempt cleanup requires a regular file inside its database directory")
    :io_done(e,io_str(e,call->answer,strlen(call->answer)));
  free(call->database);free(call->directory);free(call->name);free(call->answer);free(call);w->data=NULL;
  return result;
}

#ifdef CID_FILES_REMOVE_ATTEMPT_FILE
static Term baton_attempt_file_run(Env e,Term *f,IoWork *w) {
  BatonAttemptFile *call=calloc(1,sizeof(*call));
  if(!call)return io_fail(e,ENOMEM,NULL);
  u64 length=0;
  call->database=io_cstr(e,f[0],&length);
  if(!call->database || strlen(call->database)!=length)call->error=EINVAL;
  call->directory=io_cstr(e,f[1],&length);
  if(!call->directory || strlen(call->directory)!=length)call->error=EINVAL;
  call->name=io_cstr(e,f[2],&length);
  if(!call->name || strlen(call->name)!=length)call->error=EINVAL;
  if(call->error) {free(call->database);free(call->directory);free(call->name);free(call);return io_fail(e,EINVAL,"database, directory or file name contains NUL");}
  w->data=(char *)call;
  return io_work(w,baton_attempt_remove_call,baton_attempt_file_pack);
}
static void __attribute__((constructor)) baton_attempt_file_use(void) {io_eff(CID_FILES_REMOVE_ATTEMPT_FILE,baton_attempt_file_run,0);}
#endif

typedef struct { char *path; char answer[2]; int error; } BatonRegularFile;
static void baton_regular_file_call(IoWork *w) {
  BatonRegularFile *call=(BatonRegularFile *)w->data;
  struct stat info;
  if(!lstat(call->path,&info))call->answer[0]=S_ISREG(info.st_mode)?'1':'0';
  else if(errno==ENOENT)call->answer[0]='0';
  else call->error=errno;
  call->answer[1]=0;
}
static Term baton_regular_file_pack(Env e,IoWork *w) {
  BatonRegularFile *call=(BatonRegularFile *)w->data;
  Term result=call->error?io_fail(e,call->error,NULL):io_done(e,io_str(e,call->answer,1));
  free(call->path);free(call);w->data=NULL;return result;
}
#ifdef CID_FILES_REGULAR
static Term baton_regular_file_run(Env e,Term *f,IoWork *w) {
  BatonRegularFile *call=calloc(1,sizeof(*call));
  if(!call)return io_fail(e,ENOMEM,NULL);
  u64 length=0;call->path=io_cstr(e,f[0],&length);
  if(!call->path || strlen(call->path)!=length) {free(call->path);free(call);return io_fail(e,EINVAL,"path contains NUL");}
  w->data=(char *)call;return io_work(w,baton_regular_file_call,baton_regular_file_pack);
}
static void __attribute__((constructor)) baton_regular_file_use(void) {io_eff(CID_FILES_REGULAR,baton_regular_file_run,0);}
#endif

/* The numbered segments beside one log: directory entries whose name is the
   log's basename followed by "." and a positive decimal number, answered
   sorted by number, one per line. A log whose directory is absent answers
   nothing. */
typedef struct { char *index; } BatonSegment;

typedef struct {
  char *path,*directory,*base,*output;
  size_t length,capacity,count;
  int error;
} BatonSegments;

static int baton_segment_compare(const void *left,const void *right) {
  const BatonSegment *a=(const BatonSegment *)left;
  const BatonSegment *b=(const BatonSegment *)right;
  size_t a_length=strlen(a->index),b_length=strlen(b->index);
  if(a_length!=b_length)return a_length<b_length?-1:1;
  int order=memcmp(a->index,b->index,a_length);
  return order<0?-1:order>0?1:0;
}

static int baton_segment_push(BatonSegments *call,BatonSegment **segments,size_t *capacity,const char *index) {
  if(call->count==*capacity) {
    size_t next=*capacity?*capacity*2:16;
    if(next<*capacity || next>SIZE_MAX/sizeof(**segments)) return ENOMEM;
    BatonSegment *grown=realloc(*segments,next*sizeof(**segments));
    if(!grown) return ENOMEM;
    *capacity=next;*segments=grown;
  }
  char *copy=strdup(index);
  if(!copy)return ENOMEM;
  (*segments)[call->count++].index=copy;
  return 0;
}

static void baton_segments_call(IoWork *w) {
  BatonSegments *call=(BatonSegments *)w->data;
  DIR *directory=opendir(call->directory);
  if(!directory) {if(errno!=ENOENT) call->error=errno;return;}
  BatonSegment *segments=NULL;
  size_t capacity=0;
  size_t base=strlen(call->base);
  for(;;) {
    errno=0;
    struct dirent *entry=readdir(directory);
    if(!entry) {if(errno) call->error=errno;break;}
    if(strncmp(entry->d_name,call->base,base) || entry->d_name[base]!='.') continue;
    const char *digits=entry->d_name+base+1;
    if(*digits<'1' || *digits>'9') continue;
    const char *cursor=digits;
    while(*cursor>='0' && *cursor<='9') cursor++;
    if(*cursor) continue;
    int error=baton_segment_push(call,&segments,&capacity,digits);
    if(error) {call->error=error;break;}
  }
  closedir(directory);
  if(call->error) {
    for(size_t i=0;i<call->count;i++)free(segments[i].index);
    free(segments);return;
  }
  qsort(segments,call->count,sizeof(*segments),baton_segment_compare);
  call->capacity=64;call->length=0;call->output=malloc(call->capacity);
  if(!call->output) {
    for(size_t i=0;i<call->count;i++)free(segments[i].index);
    free(segments);call->error=ENOMEM;return;
  }
  for(size_t i=0;i<call->count;i++) {
    size_t n=strlen(segments[i].index);
    if(call->length>SIZE_MAX-2 || n>SIZE_MAX-call->length-2) {call->error=ENOMEM;break;}
    if(call->length+n+2>call->capacity) {
      size_t next=call->capacity;
      while(next<call->length+n+2) {
        if(next>SIZE_MAX/2) {next=call->length+n+2;break;}
        next*=2;
      }
      char *grown=realloc(call->output,next);
      if(!grown) {call->error=ENOMEM;break;}
      call->output=grown;call->capacity=next;
    }
    memcpy(call->output+call->length,segments[i].index,n);
    call->length+=n;
    call->output[call->length++]='\n';
  }
  for(size_t i=0;i<call->count;i++)free(segments[i].index);
  free(segments);
  if(!call->error) call->output[call->length]=0;
}

static Term baton_segments_pack(Env e,IoWork *w) {
  BatonSegments *call=(BatonSegments *)w->data;
  Term result=call->error ? io_fail(e,call->error,NULL)
    : io_done(e,io_str(e,call->output?call->output:"",call->output?call->length:0));
  free(call->path);free(call->directory);free(call->base);free(call->output);free(call);
  w->data=NULL;
  return result;
}

#ifdef CID_FILES_SEGMENTS
static Term baton_segments_run(Env e,Term *f,IoWork *w) {
  BatonSegments *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  u64 length=0;
  call->path=io_cstr(e,f[0],&length);
  if(!call->path || strlen(call->path)!=length) {
    free(call->path);free(call);
    return io_fail(e,EINVAL,"path contains NUL");
  }
  const char *slash=strrchr(call->path,'/');
  size_t directory=slash?((size_t)(slash-call->path)?(size_t)(slash-call->path):1):1;
  call->directory=malloc(directory+1);
  if(!call->directory) {free(call->path);free(call);return io_fail(e,ENOMEM,NULL);}
  memcpy(call->directory,slash?call->path:".",directory);
  call->directory[directory]=0;
  call->base=strdup(slash?slash+1:call->path);
  if(!call->base) {free(call->path);free(call->directory);free(call);return io_fail(e,ENOMEM,NULL);}
  w->data=(char *)call;
  return io_work(w,baton_segments_call,baton_segments_pack);
}
static void __attribute__((constructor)) baton_segments_use(void) {io_eff(CID_FILES_SEGMENTS,baton_segments_run,0);}
#endif

typedef struct {
  char *path,*position,*text;
  size_t length;
  int operation,error;
} BatonPathCall;

static void baton_path_work(IoWork *work) {
  BatonPathCall *call=(BatonPathCall *)work->data;
  if(call->operation==1) {
    call->text=realpath(call->path,NULL);
    if(!call->text) call->error=errno;
  } else if(call->operation==2) {
    size_t capacity=256;
    for(;;) {
      char *next=malloc(capacity);
      if(!next) {call->error=ENOMEM;break;}
      ssize_t length=readlink(call->path,next,capacity-1);
      if(length<0) {call->error=errno;free(next);break;}
      if((size_t)length<capacity-1) {
        next[length]=0;call->text=next;break;
      }
      free(next);
      if(capacity>SIZE_MAX/2) {call->error=EOVERFLOW;break;}
      capacity*=2;
    }
  } else if(call->operation==3) {
    if(access(call->path,X_OK)) call->error=errno;
  } else if(call->operation==4) {
    char *end=NULL;
    errno=0;
    unsigned long long position=strtoull(call->position,&end,10);
    if(errno || !*call->position || *end || (off_t)position<0 ||
       (unsigned long long)(off_t)position!=position) {call->error=EINVAL;return;}
    FILE *file=fopen(call->path,"rb");
    if(!file) {call->error=errno;return;}
    if(fseeko(file,(off_t)position,SEEK_SET)) {
      call->error=errno;fclose(file);return;
    }
    size_t capacity=65537;
    call->text=malloc(capacity);
    if(!call->text) {call->error=ENOMEM;fclose(file);return;}
    int ch;
    while((ch=fgetc(file))!=EOF) {
      if(call->length+1==capacity) {
        if(capacity>SIZE_MAX/2) {call->error=EOVERFLOW;break;}
        char *grown=realloc(call->text,capacity*2);
        if(!grown) {call->error=ENOMEM;break;}
        call->text=grown;capacity*=2;
      }
      call->text[call->length++]=(char)ch;
      if(call->length>=65536 && ch=='\n') break;
    }
    if(!call->error && ferror(file)) call->error=errno?errno:EIO;
    call->text[call->length]=0;
    if(fclose(file) && !call->error) call->error=errno;
    char next[32];
    if(position>ULLONG_MAX-call->length) {call->error=EOVERFLOW;return;}
    snprintf(next,sizeof next,"%llu",position+call->length);
    free(call->position);call->position=strdup(next);
    if(!call->position) call->error=ENOMEM;
  } else if(call->operation==5) {
    struct stat info;
    if(lstat(call->path,&info)) {call->error=errno;return;}
    const char *kind=S_ISDIR(info.st_mode)?"dir":S_ISREG(info.st_mode)?"file":
      S_ISLNK(info.st_mode)?"symlink":"other";
    char text[256];
    snprintf(text,sizeof text,"%s\t%u\t%llu\t%llu\t%llu",kind,
      (unsigned)(info.st_mode&07777),(unsigned long long)info.st_dev,
      (unsigned long long)info.st_ino,(unsigned long long)info.st_size);
    call->text=strdup(text);
    if(!call->text) call->error=ENOMEM;
  } else if(call->operation==6) {
    mode_t previous=umask(0007);
    int result=mkdir(call->path,0770);
    int saved=errno;
    umask(previous);
    if(result) call->error=saved;
  }
}

static Term baton_path_pack(Env env,IoWork *work) {
  BatonPathCall *call=(BatonPathCall *)work->data;
  Term value=term_pak(CID_UNIT,0);
  if(!call->error) {
    if(call->operation==4) value=io_tup(env,
      io_str(env,call->text,call->length),
      io_str(env,call->position,strlen(call->position)));
    else if(call->text) value=io_str(env,call->text,strlen(call->text));
  }
  Term result=call->error?io_fail(env,call->error,NULL):io_done(env,value);
  free(call->path);free(call->position);free(call->text);free(call);
  work->data=NULL;
  return result;
}

static Term baton_path_run(Env env,Term *fields,IoWork *work,int operation) {
  BatonPathCall *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(env,ENOMEM,NULL);
  call->operation=operation;
  u64 length=0;
  call->path=io_cstr(env,fields[0],&length);
  if(!call->path) {free(call);return io_fail(env,ENOMEM,NULL);}
  if(strlen(call->path)!=length) call->error=EINVAL;
  if(operation==4) {
    call->position=io_cstr(env,fields[1],&length);
    if(!call->position || strlen(call->position)!=length) call->error=EINVAL;
  }
  work->data=(char *)call;
  if(call->error) return baton_path_pack(env,work);
  return io_work(work,baton_path_work,baton_path_pack);
}

#ifdef CID_FILES_REALPATH
static Term baton_path_realpath(Env e,Term *f,IoWork *w) {return baton_path_run(e,f,w,1);}
static void __attribute__((constructor)) baton_path_realpath_use(void) {io_eff(CID_FILES_REALPATH,baton_path_realpath,0);}
#endif
#ifdef CID_FILES_READLINK
static Term baton_path_readlink(Env e,Term *f,IoWork *w) {return baton_path_run(e,f,w,2);}
static void __attribute__((constructor)) baton_path_readlink_use(void) {io_eff(CID_FILES_READLINK,baton_path_readlink,0);}
#endif
#ifdef CID_FILES_EXECUTABLE
static Term baton_path_executable(Env e,Term *f,IoWork *w) {return baton_path_run(e,f,w,3);}
static void __attribute__((constructor)) baton_path_executable_use(void) {io_eff(CID_FILES_EXECUTABLE,baton_path_executable,0);}
#endif
#ifdef CID_FILES_TEXT_CHUNK
static Term baton_path_chunk(Env e,Term *f,IoWork *w) {return baton_path_run(e,f,w,4);}
static void __attribute__((constructor)) baton_path_chunk_use(void) {io_eff(CID_FILES_TEXT_CHUNK,baton_path_chunk,0);}
#endif
#ifdef CID_FILES_LSTAT
static Term baton_path_lstat(Env e,Term *f,IoWork *w) {return baton_path_run(e,f,w,5);}
static void __attribute__((constructor)) baton_path_lstat_use(void) {io_eff(CID_FILES_LSTAT,baton_path_lstat,0);}
#endif
#ifdef CID_FILES_MKDIR_SHARED
static Term baton_path_mkdir(Env e,Term *f,IoWork *w) {return baton_path_run(e,f,w,6);}
static void __attribute__((constructor)) baton_path_mkdir_use(void) {io_eff(CID_FILES_MKDIR_SHARED,baton_path_mkdir,0);}
#endif

typedef struct {
  char *first,*second,*answer;
  size_t length;
  u32 mode;
  int operation,error;
} BatonFileData;

static int baton_data_write(int fd,const char *data,size_t length) {
  size_t offset=0;
  while(offset<length) {
    ssize_t count=write(fd,data+offset,length-offset);
    if(count>0) offset+=(size_t)count;
    else if(count<0 && errno==EINTR) continue;
    else return count<0?errno:EIO;
  }
  return 0;
}

static void baton_data_work(IoWork *work) {
  BatonFileData *call=(BatonFileData *)work->data;
  if(call->operation==1) {
    if(mkdir(call->first,call->mode&0777)) call->error=errno;
  } else if(call->operation==2) {
    if(chmod(call->first,call->mode&07777)) call->error=errno;
  } else if(call->operation==3) {
    if(rmdir(call->first)) call->error=errno;
  } else if(call->operation==4) {
    if(symlink(call->first,call->second)) call->error=errno;
  } else if(call->operation==5) {
    int input=open(call->first,O_RDONLY|O_CLOEXEC);
    if(input<0) {call->error=errno;return;}
    struct stat info;
    if(fstat(input,&info)) {call->error=errno;close(input);return;}
    if(!S_ISREG(info.st_mode)) {call->error=EINVAL;close(input);return;}
    int output=open(call->second,O_WRONLY|O_CREAT|O_TRUNC|O_NOFOLLOW|O_CLOEXEC,0600);
    if(output<0) {call->error=errno;close(input);return;}
    char chunk[65536];
    for(;;) {
      ssize_t count=read(input,chunk,sizeof chunk);
      if(count>0) {
        call->error=baton_data_write(output,chunk,(size_t)count);
        if(call->error) break;
      } else if(count==0) break;
      else if(errno!=EINTR) {call->error=errno;break;}
    }
    if(!call->error && fchmod(output,info.st_mode&0777)) call->error=errno;
    if(close(output) && !call->error) call->error=errno;
    if(close(input) && !call->error) call->error=errno;
  } else if(call->operation==6) {
    size_t length=strlen(call->first)+48;
    char *temporary=malloc(length);
    if(!temporary) {call->error=ENOMEM;return;}
    snprintf(temporary,length,"%s.tmp.%u",call->first,(unsigned)getpid());
    unlink(temporary);
    mode_t previous=umask(0007);
    int fd=open(temporary,O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC,0660);
    int saved=errno;umask(previous);
    if(fd<0) {call->error=saved;free(temporary);return;}
    call->error=baton_data_write(fd,call->second,call->length);
    if(!call->error && fsync(fd)) call->error=errno;
    if(close(fd) && !call->error) call->error=errno;
    if(!call->error && rename(temporary,call->first)) call->error=errno;
    if(call->error) unlink(temporary);
    free(temporary);
  } else if(call->operation==7) {
    int fd=open(call->first,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);
    if(fd<0) {call->error=errno;return;}
    struct stat info;
    if(fstat(fd,&info)) {call->error=errno;close(fd);return;}
    char chunk[65536],prefix[9]={0};
    static const char hex[]="0123456789abcdef";
    unsigned long long bytes=0;
    int zero=0;
    for(;;) {
      ssize_t count=read(fd,chunk,sizeof chunk);
      if(count<0 && errno==EINTR) continue;
      if(count<0) {call->error=errno;break;}
      if(count==0) break;
      for(ssize_t i=0;i<count;i++) {
        unsigned char value=(unsigned char)chunk[i];
        if(bytes<4) {prefix[bytes*2]=hex[value>>4];prefix[bytes*2+1]=hex[value&15];}
        if(value==0) zero=1;
        bytes++;
      }
    }
    if(close(fd) && !call->error) call->error=errno;
    if(!call->error) {
      char result[96];
      snprintf(result,sizeof result,"bytes=%llu\nzeros=%d\nprefix=%s\n",bytes,zero,prefix);
      call->answer=strdup(result);
      if(!call->answer) call->error=ENOMEM;
    }
  } else if(call->operation==8) {
    if(rename(call->first,call->second)) call->error=errno;
  }
}

static Term baton_data_pack(Env env,IoWork *work) {
  BatonFileData *call=(BatonFileData *)work->data;
  Term value=call->answer?io_str(env,call->answer,strlen(call->answer)):term_pak(CID_UNIT,0);
  Term result=call->error?io_fail(env,call->error,NULL):io_done(env,value);
  free(call->first);free(call->second);free(call->answer);free(call);work->data=NULL;
  return result;
}

static Term baton_data_run(Env env,Term *fields,IoWork *work,int operation) {
  BatonFileData *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(env,ENOMEM,NULL);
  call->operation=operation;
  u64 length=0;
  call->first=io_cstr(env,fields[0],&length);
  if(!call->first || strlen(call->first)!=length) call->error=EINVAL;
  if(operation==1 || operation==2) call->mode=(u32)fields[1];
  if(operation==4 || operation==5 || operation==6 || operation==8) {
    call->second=io_cstr(env,fields[1],&length);call->length=(size_t)length;
    if(!call->second || (operation!=6 && strlen(call->second)!=length)) call->error=EINVAL;
  }
  work->data=(char *)call;
  if(call->error) return baton_data_pack(env,work);
  return io_work(work,baton_data_work,baton_data_pack);
}

#ifdef CID_FILES_MKDIR_MODE
static Term baton_data_mkdir(Env e,Term *f,IoWork *w) {return baton_data_run(e,f,w,1);}
static void __attribute__((constructor)) baton_data_mkdir_use(void) {io_eff(CID_FILES_MKDIR_MODE,baton_data_mkdir,0);}
#endif
#ifdef CID_FILES_CHMOD
static Term baton_data_chmod(Env e,Term *f,IoWork *w) {return baton_data_run(e,f,w,2);}
static void __attribute__((constructor)) baton_data_chmod_use(void) {io_eff(CID_FILES_CHMOD,baton_data_chmod,0);}
#endif
#ifdef CID_FILES_RMDIR
static Term baton_data_rmdir(Env e,Term *f,IoWork *w) {return baton_data_run(e,f,w,3);}
static void __attribute__((constructor)) baton_data_rmdir_use(void) {io_eff(CID_FILES_RMDIR,baton_data_rmdir,0);}
#endif
#ifdef CID_FILES_SYMLINK
static Term baton_data_symlink(Env e,Term *f,IoWork *w) {return baton_data_run(e,f,w,4);}
static void __attribute__((constructor)) baton_data_symlink_use(void) {io_eff(CID_FILES_SYMLINK,baton_data_symlink,0);}
#endif
#ifdef CID_FILES_COPY_FILE
static Term baton_data_copy(Env e,Term *f,IoWork *w) {return baton_data_run(e,f,w,5);}
static void __attribute__((constructor)) baton_data_copy_use(void) {io_eff(CID_FILES_COPY_FILE,baton_data_copy,0);}
#endif
#ifdef CID_FILES_WRITE_SHARED
static Term baton_data_write_run(Env e,Term *f,IoWork *w) {return baton_data_run(e,f,w,6);}
static void __attribute__((constructor)) baton_data_write_use(void) {io_eff(CID_FILES_WRITE_SHARED,baton_data_write_run,0);}
#endif
#ifdef CID_FILES_BYTE_PROPERTIES
static Term baton_data_properties(Env e,Term *f,IoWork *w) {return baton_data_run(e,f,w,7);}
static void __attribute__((constructor)) baton_data_properties_use(void) {io_eff(CID_FILES_BYTE_PROPERTIES,baton_data_properties,0);}
#endif
#ifdef CID_FILES_MOVE
static Term baton_data_move(Env e,Term *f,IoWork *w) {return baton_data_run(e,f,w,8);}
static void __attribute__((constructor)) baton_data_move_use(void) {io_eff(CID_FILES_MOVE,baton_data_move,0);}
#endif
