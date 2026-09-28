#include <dirent.h>
#include <errno.h>

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
