#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
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
typedef struct { char *path,*target; size_t size; int error; } BatonFileOp;

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

#ifdef CID_FILES_MKDIR
static Term baton_file_mkdir_run(Env e,Term *f,IoWork *w) {
  BatonFileOp *call=baton_file_op(e,f,w,1);
  if(!call) return io_fail(e,ENOMEM,NULL);
  if(call->error) return baton_file_unit_pack(e,w);
  return io_work(w,baton_file_mkdir_call,baton_file_unit_pack);
}
static void __attribute__((constructor)) baton_file_mkdir_use(void) {io_eff(CID_FILES_MKDIR,baton_file_mkdir_run,0);}
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
