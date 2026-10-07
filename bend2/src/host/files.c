#include <dirent.h>
#include <errno.h>
#include <stdio.h>
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

/* Log retention reads one file's size and moves or removes Baton2-owned log
   files. A missing path reports zero bytes; a rename or removal of a missing
   path succeeds, so a rotation shift with nothing to move is a no-op. */
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

/* The numbered segments beside one log: directory entries whose name is the
   log's basename followed by "." and a positive decimal number, answered
   sorted by number, one per line. A log whose directory is absent answers
   nothing. */
typedef struct { long index; } BatonSegment;

typedef struct {
  char *path,*directory,*base,*output;
  size_t length,capacity,count;
  int error;
} BatonSegments;

static int baton_segment_compare(const void *left,const void *right) {
  const BatonSegment *a=(const BatonSegment *)left;
  const BatonSegment *b=(const BatonSegment *)right;
  return a->index<b->index?-1:a->index>b->index?1:0;
}

static int baton_segment_push(BatonSegments *call,BatonSegment **segments,size_t *capacity,long index) {
  if(call->count==*capacity) {
    size_t next=*capacity?*capacity*2:16;
    if(next<*capacity || next>SIZE_MAX/sizeof(**segments)) return ENOMEM;
    BatonSegment *grown=realloc(*segments,next*sizeof(**segments));
    if(!grown) return ENOMEM;
    *capacity=next;*segments=grown;
  }
  (*segments)[call->count++].index=index;
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
    if(!*digits) continue;
    char *end=NULL;
    errno=0;
    long index=strtol(digits,&end,10);
    if(errno || !end || *end || index<=0) continue;
    int error=baton_segment_push(call,&segments,&capacity,index);
    if(error) {call->error=error;break;}
  }
  closedir(directory);
  if(call->error) {free(segments);return;}
  qsort(segments,call->count,sizeof(*segments),baton_segment_compare);
  call->capacity=64;call->length=0;call->output=malloc(call->capacity);
  if(!call->output) {free(segments);call->error=ENOMEM;return;}
  for(size_t i=0;i<call->count;i++) {
    char text[32];
    int n=snprintf(text,sizeof(text),"%ld\n",segments[i].index);
    if(n<=0) {call->error=EIO;break;}
    if(call->length+(size_t)n+1>call->capacity) {
      size_t next=call->capacity;
      while(next<call->length+(size_t)n+1) next*=2;
      char *grown=realloc(call->output,next);
      if(!grown) {call->error=ENOMEM;break;}
      call->output=grown;call->capacity=next;
    }
    memcpy(call->output+call->length,text,(size_t)n);
    call->length+=(size_t)n;
  }
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
