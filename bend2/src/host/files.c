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
