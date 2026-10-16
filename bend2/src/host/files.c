#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include "sha256.h"

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

typedef struct { char *path; char answer[2]; int error,exists; } BatonRegularFile;
static void baton_regular_file_call(IoWork *w) {
  BatonRegularFile *call=(BatonRegularFile *)w->data;
  struct stat info;
  if(!lstat(call->path,&info))call->answer[0]=call->exists||S_ISREG(info.st_mode)?'1':'0';
  else if(errno==ENOENT)call->answer[0]='0';
  else call->error=errno;
  call->answer[1]=0;
}
static Term baton_regular_file_pack(Env e,IoWork *w) {
  BatonRegularFile *call=(BatonRegularFile *)w->data;
  Term result=call->error?io_fail(e,call->error,NULL):io_done(e,io_str(e,call->answer,1));
  free(call->path);free(call);w->data=NULL;return result;
}
static Term baton_path_stat_run(Env e,Term *f,IoWork *w,int exists) {
  BatonRegularFile *call=calloc(1,sizeof(*call));
  if(!call)return io_fail(e,ENOMEM,NULL);
  call->exists=exists;
  u64 length=0;call->path=io_cstr(e,f[0],&length);
  if(!call->path || strlen(call->path)!=length) {free(call->path);free(call);return io_fail(e,EINVAL,"path contains NUL");}
  w->data=(char *)call;return io_work(w,baton_regular_file_call,baton_regular_file_pack);
}
#ifdef CID_FILES_REGULAR
static Term baton_regular_file_run(Env e,Term *f,IoWork *w) {return baton_path_stat_run(e,f,w,0);}
static void __attribute__((constructor)) baton_regular_file_use(void) {io_eff(CID_FILES_REGULAR,baton_regular_file_run,0);}
#endif
#ifdef CID_FILES_EXISTS
static Term baton_path_exists_run(Env e,Term *f,IoWork *w) {return baton_path_stat_run(e,f,w,1);}
static void __attribute__((constructor)) baton_path_exists_use(void) {io_eff(CID_FILES_EXISTS,baton_path_exists_run,0);}
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

typedef struct { char *directory,*names; size_t length,capacity; int error; } BatonEntries;

static void baton_entries_call(IoWork *w) {
  BatonEntries *call=(BatonEntries *)w->data;
  DIR *directory=opendir(call->directory);
  if(!directory) {call->error=errno;return;}
  struct dirent *entry;
  errno=0;
  while((entry=readdir(directory))) {
    const char *name=entry->d_name;
    if(name[0]=='.'
       && (name[1]==0 || (name[1]=='.' && name[2]==0))) continue;
    size_t length=strlen(name);
    if(call->length+length+2>call->capacity) {
      size_t capacity=call->capacity?call->capacity:256;
      while(call->length+length+2>capacity) {if(capacity>SIZE_MAX/2) {call->error=ENOMEM;break;} capacity*=2;}
      if(call->error) break;
      char *names=realloc(call->names,capacity);
      if(!names) {call->error=ENOMEM;break;}
      call->names=names;call->capacity=capacity;
    }
    memcpy(call->names+call->length,name,length);
    call->length+=length;
    call->names[call->length++]=0;
  }
  if(!entry && errno) call->error=errno;
  else if(call->names) call->names[call->length]=0;
  closedir(directory);
}

static Term baton_entries_pack(Env e,IoWork *w) {
  BatonEntries *call=(BatonEntries *)w->data;
  Term result=call->error ? io_fail(e,call->error,NULL)
    : io_done(e,io_str(e,call->names?call->names:"",call->names?call->length:0));
  free(call->directory);free(call->names);free(call);w->data=NULL;
  return result;
}

#ifdef CID_FILES_ENTRIES
static Term baton_entries_run(Env e,Term *f,IoWork *w) {
  BatonEntries *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  u64 length=0;
  call->directory=io_cstr(e,f[0],&length);
  if(!call->directory || strlen(call->directory)!=length) {
    free(call->directory);free(call);
    return io_fail(e,EINVAL,"path contains NUL");
  }
  w->data=(char *)call;
  return io_work(w,baton_entries_call,baton_entries_pack);
}
static void __attribute__((constructor)) baton_entries_use(void) {io_eff(CID_FILES_ENTRIES,baton_entries_run,0);}
#endif

typedef struct { char *path; const char *kind; int error, follow; } BatonKind;

static void baton_kind_call(IoWork *w) {
  BatonKind *call=(BatonKind *)w->data;
  struct stat info;
  if(call->follow ? stat(call->path,&info) : lstat(call->path,&info)) {
    call->error=errno;return;
  }
  call->kind=S_ISLNK(info.st_mode)?"link":S_ISREG(info.st_mode)?"file"
    :S_ISDIR(info.st_mode)?"dir":"other";
}

static Term baton_kind_pack(Env e,IoWork *w) {
  BatonKind *call=(BatonKind *)w->data;
  Term result=call->error ? io_fail(e,call->error,NULL)
    : io_done(e,io_str(e,call->kind,strlen(call->kind)));
  free(call->path);free(call);w->data=NULL;
  return result;
}

static Term baton_kind_begin(Env e,Term *f,IoWork *w,int follow) {
  BatonKind *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  call->follow=follow;
  u64 length=0;
  call->path=io_cstr(e,f[0],&length);
  if(!call->path || strlen(call->path)!=length) {
    free(call->path);free(call);
    return io_fail(e,EINVAL,"path contains NUL");
  }
  w->data=(char *)call;
  return io_work(w,baton_kind_call,baton_kind_pack);
}
#ifdef CID_FILES_KIND
static Term baton_kind_run(Env e,Term *f,IoWork *w) {return baton_kind_begin(e,f,w,1);}
static void __attribute__((constructor)) baton_kind_use(void) {io_eff(CID_FILES_KIND,baton_kind_run,0);}
#endif
#ifdef CID_FILES_KIND_LINK
static Term baton_kind_link_run(Env e,Term *f,IoWork *w) {return baton_kind_begin(e,f,w,0);}
static void __attribute__((constructor)) baton_kind_link_use(void) {io_eff(CID_FILES_KIND_LINK,baton_kind_link_run,0);}
#endif


typedef struct { char *path; char text[8]; int error; } BatonMode;

static void baton_mode_call(IoWork *w) {
  BatonMode *call=(BatonMode *)w->data;
  struct stat info;
  if(stat(call->path,&info)) {call->error=errno;return;}
  snprintf(call->text,sizeof(call->text),"%o",(unsigned)(info.st_mode & 0777));
}

static Term baton_mode_pack(Env e,IoWork *w) {
  BatonMode *call=(BatonMode *)w->data;
  Term result=call->error ? io_fail(e,call->error,NULL)
    : io_done(e,io_str(e,call->text,strlen(call->text)));
  free(call->path);free(call);w->data=NULL;
  return result;
}

#ifdef CID_FILES_MODE
static Term baton_mode_run(Env e,Term *f,IoWork *w) {
  BatonMode *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  u64 length=0;
  call->path=io_cstr(e,f[0],&length);
  if(!call->path || strlen(call->path)!=length) {
    free(call->path);free(call);
    return io_fail(e,EINVAL,"path contains NUL");
  }
  w->data=(char *)call;
  return io_work(w,baton_mode_call,baton_mode_pack);
}
static void __attribute__((constructor)) baton_mode_use(void) {io_eff(CID_FILES_MODE,baton_mode_run,0);}
#endif

typedef struct { char *path; char answer[2]; int error; } BatonExecutable;

static void baton_executable_call(IoWork *w) {
  BatonExecutable *call=(BatonExecutable *)w->data;
  if(!access(call->path,X_OK)) call->answer[0]='1';
  else if(errno==EACCES) call->answer[0]='0';
  else call->error=errno;
  call->answer[1]=0;
}

static Term baton_executable_pack(Env e,IoWork *w) {
  BatonExecutable *call=(BatonExecutable *)w->data;
  Term result=call->error ? io_fail(e,call->error,NULL)
    : io_done(e,io_str(e,call->answer,1));
  free(call->path);free(call);w->data=NULL;
  return result;
}

#ifdef CID_FILES_EXECUTABLE
static Term baton_executable_run(Env e,Term *f,IoWork *w) {
  BatonExecutable *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  u64 length=0;
  call->path=io_cstr(e,f[0],&length);
  if(!call->path || strlen(call->path)!=length) {
    free(call->path);free(call);
    return io_fail(e,EINVAL,"path contains NUL");
  }
  w->data=(char *)call;
  return io_work(w,baton_executable_call,baton_executable_pack);
}
static void __attribute__((constructor)) baton_executable_use(void) {io_eff(CID_FILES_EXECUTABLE,baton_executable_run,0);}
#endif

typedef struct { char *from,*to; int error; } BatonCopy;

static void baton_copy_call(IoWork *w) {
  BatonCopy *call=(BatonCopy *)w->data;
  /* Regular-file semantics are established before the destination is
     mutated: O_NONBLOCK keeps a FIFO source from waiting for a writer, the
     source must stat as a regular file, and a same-inode destination is
     refused before any truncation. */
  int in=open(call->from,O_RDONLY|O_NONBLOCK|O_CLOEXEC);
  if(in<0) {call->error=errno;return;}
  struct stat info;
  if(fstat(in,&info)) {call->error=errno;close(in);return;}
  if(!S_ISREG(info.st_mode)) {call->error=S_ISDIR(info.st_mode)?EISDIR:EINVAL;close(in);return;}
  /* O_NONBLOCK keeps a writerless destination FIFO from blocking the
     open; the opened descriptor must then stat as a regular file before
     anything mutates it. A special destination refuses EINVAL with both
     sides preserved; a missing-entry open keeps its ENOENT cause. */
  int out=open(call->to,O_WRONLY|O_CREAT|O_NONBLOCK|O_CLOEXEC,0600);
  if(out<0) {call->error=errno;close(in);return;}
  struct stat outinfo;
  if(fstat(out,&outinfo)) {call->error=errno;close(out);close(in);return;}
  if(!S_ISREG(outinfo.st_mode)) {call->error=EINVAL;close(out);close(in);return;}
  if(info.st_dev==outinfo.st_dev && info.st_ino==outinfo.st_ino) {
    call->error=EINVAL;close(out);close(in);return;
  }
  if(ftruncate(out,0)) {call->error=errno;close(out);close(in);return;}
  char buffer[65536];
  for(;;) {
    ssize_t got=read(in,buffer,sizeof(buffer));
    if(got<0) {if(errno==EINTR)continue;call->error=errno;break;}
    if(!got) break;
    size_t offset=0;
    while((size_t)offset<(size_t)got) {
      ssize_t put=write(out,buffer+offset,(size_t)got-offset);
      if(put<0 && errno==EINTR) continue;
      if(put<=0) {call->error=put<0?errno:EIO;break;}
      offset+=(size_t)put;
    }
    if(call->error) break;
  }
  if(!call->error && fchmod(out,info.st_mode & 07777)) call->error=errno;
  if(close(out) && !call->error) call->error=errno;
  close(in);
}

static Term baton_copy_pack(Env e,IoWork *w) {
  BatonCopy *call=(BatonCopy *)w->data;
  Term result=call->error ? io_fail(e,call->error,NULL)
    : io_done(e,term_pak(CID_UNIT,0));
  free(call->from);free(call->to);free(call);w->data=NULL;
  return result;
}

#ifdef CID_FILES_COPY
static Term baton_copy_run(Env e,Term *f,IoWork *w) {
  BatonCopy *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  u64 length=0;
  call->from=io_cstr(e,f[0],&length);
  if(!call->from || strlen(call->from)!=length) {
    free(call->from);free(call);
    return io_fail(e,EINVAL,"path contains NUL");
  }
  call->to=io_cstr(e,f[1],&length);
  if(!call->to || strlen(call->to)!=length) {
    free(call->from);free(call->to);free(call);
    return io_fail(e,EINVAL,"path contains NUL");
  }
  w->data=(char *)call;
  return io_work(w,baton_copy_call,baton_copy_pack);
}
static void __attribute__((constructor)) baton_copy_use(void) {io_eff(CID_FILES_COPY,baton_copy_run,0);}
#endif

typedef struct { char *name,*found; int error; } BatonWhich;

static void baton_which_call(IoWork *w) {
  BatonWhich *call=(BatonWhich *)w->data;
  const char *search=getenv("PATH");
  const char *path=search&&*search?search:"/usr/bin:/bin";
  char *directories=strdup(path);
  if(!directories) {call->error=ENOMEM;return;}
  size_t name_length=strlen(call->name);
  int present=0;
  for(const char *cursor=directories;;) {
    const char *colon=strchr(cursor,':');
    size_t length=colon?(size_t)(colon-cursor):strlen(cursor);
    size_t directory_length=length?length:1;
    char *candidate=malloc(directory_length+1+name_length+1);
    if(!candidate) {call->error=ENOMEM;break;}
    if(length) memcpy(candidate,cursor,length);
    else candidate[0]='.';
    candidate[directory_length]='/';
    memcpy(candidate+directory_length+1,call->name,name_length+1);
    struct stat info;
    if(!stat(candidate,&info) && S_ISREG(info.st_mode)) {
      if(!access(candidate,X_OK)) {call->found=candidate;break;}
      present=1;
    }
    free(candidate);
    if(!colon) break;
    cursor=colon+1;
  }
  free(directories);
  if(!call->error && !call->found && present) call->error=EACCES;
}

static Term baton_which_pack(Env e,IoWork *w) {
  BatonWhich *call=(BatonWhich *)w->data;
  Term result;
  if(call->error) result=io_fail(e,call->error,NULL);
  else if(call->found) result=io_done(e,io_str(e,call->found,strlen(call->found)));
  else result=io_done(e,io_str(e,"",0));
  free(call->name);free(call->found);free(call);w->data=NULL;
  return result;
}

#ifdef CID_FILES_WHICH
static Term baton_which_run(Env e,Term *f,IoWork *w) {
  BatonWhich *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  u64 length=0;
  call->name=io_cstr(e,f[0],&length);
  if(!call->name || strlen(call->name)!=length) {
    free(call->name);free(call);
    return io_fail(e,EINVAL,"name contains NUL");
  }
  w->data=(char *)call;
  return io_work(w,baton_which_call,baton_which_pack);
}
static void __attribute__((constructor)) baton_which_use(void) {io_eff(CID_FILES_WHICH,baton_which_run,0);}
#endif

typedef struct { char *path; char hex[65]; int error; } BatonDigest;

static void baton_digest_call(IoWork *w) {
  BatonDigest *call=(BatonDigest *)w->data;
  int fd=open(call->path,O_RDONLY|O_CLOEXEC);
  if(fd<0) {call->error=errno;return;}
  BatonSha256 s;
  baton_sha256_init(&s);
  unsigned char buffer[65536];
  for(;;) {
    ssize_t got=read(fd,buffer,sizeof(buffer));
    if(got<0) {if(errno==EINTR)continue;call->error=errno;break;}
    if(!got) break;
    baton_sha256_update(&s,buffer,(size_t)got);
  }
  close(fd);
  if(call->error) return;
  unsigned char bytes[32];
  baton_sha256_final(&s,bytes);
  static const char hex[]="0123456789abcdef";
  for(unsigned i=0;i<32;++i) {
    call->hex[i*2]=hex[bytes[i]>>4];
    call->hex[i*2+1]=hex[bytes[i]&15];
  }
  call->hex[64]=0;
}

static Term baton_digest_pack(Env e,IoWork *w) {
  BatonDigest *call=(BatonDigest *)w->data;
  Term result=call->error ? io_fail(e,call->error,NULL)
    : io_done(e,io_str(e,call->hex,64));
  free(call->path);free(call);w->data=NULL;
  return result;
}

#ifdef CID_FILES_DIGEST
static Term baton_digest_run(Env e,Term *f,IoWork *w) {
  BatonDigest *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  u64 length=0;
  call->path=io_cstr(e,f[0],&length);
  if(!call->path || strlen(call->path)!=length) {
    free(call->path);free(call);
    return io_fail(e,EINVAL,"path contains NUL");
  }
  w->data=(char *)call;
  return io_work(w,baton_digest_call,baton_digest_pack);
}
static void __attribute__((constructor)) baton_digest_use(void) {io_eff(CID_FILES_DIGEST,baton_digest_run,0);}
#endif
