/* Atomic immutable receipt publication and the landing's live guard.
 *
 * Every effect answers the tab separated record
 *   <tag> <path> <errno> <phase> <pending> <detail>
 * so the native boundary carries the outcome, the first errno, the phase it
 * happened in, whether an incomplete temp remains, and the detail text. Tags:
 *   publish  published | existing | may-exist | unpublished
 *   qualify  qualified | absent | unreadable | unsyncable
 *   ensure   present | created | failed
 *   matches  listed | absent-root | failed
 * A caller maps the tag into its own variant, so published, existing and
 * may-exist can never be confused by accident.
 *
 * An ordinary success tag (published, existing, qualified) never carries a
 * negative pending answer. A fresh publication made and removed its own temp, so
 * it observed that state: it carries pending 0 and its record stays published,
 * never uncertain. The existing-record fast path and qualify only probed a state
 * someone else published, so a negative answer there is genuine uncertainty: the
 * tag becomes uncertain and the fact the effect did establish moves to the
 * non-owned established field, which the record carries as its detail. The
 * non-success tags (absent, unreadable, unsyncable, unpublished, may-exist) keep
 * their tag with the negative answer visible instead of being converted.
 *
 * publish order, every step checked (S = directory/name, T = S.publishing):
 *   1. S present -> existing, S is never replaced
 *   2. open(T, O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC, 0600)  EEXIST -> unpublished, T kept
 *   3. write loop: advance on short writes, retry EINTR, require the full length
 *   4. fsync(fd), close(fd)                       failure -> unpublished, T kept
 *   5. link(T, S)   the publication point         EEXIST -> existing, else unpublished
 *   6. fsync(directory)  the link is durable      failure -> may-exist, T kept
 *   7. unlink(T), fsync(directory)                failure -> may-exist, S stays durable
 * The temp is unlinked only after the link has been synced, so a missing temp is
 * never proof of completion and no failure after the link is a clean failure.
 *
 * Paths built by an effect are checked against the internal alphabet; content is
 * written with the byte length the caller supplied, never through strlen.
 */
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

enum { REC_PUBLISHED, REC_EXISTING, REC_MAY_EXIST, REC_UNPUBLISHED,
       REC_QUALIFIED, REC_ABSENT, REC_UNREADABLE, REC_UNSYNCABLE,
       REC_PRESENT, REC_CREATED, REC_FAILED, REC_LISTED, REC_ABSENT_ROOT,
       REC_UNCERTAIN };

typedef struct {
  char *directory,*name,*content,*common,*target,*path,*detail,*names,*phase;
  const char *established;      /* the fact an uncertain record keeps; never owned */
  size_t content_length,names_length;
  int error,outcome,pending,handle;
} BatonReceipt;

static const char *receipt_tag(int outcome) {
  switch(outcome) {
    case REC_PUBLISHED: return "published";
    case REC_EXISTING: return "existing";
    case REC_MAY_EXIST: return "may-exist";
    case REC_UNPUBLISHED: return "unpublished";
    case REC_QUALIFIED: return "qualified";
    case REC_ABSENT: return "absent";
    case REC_UNREADABLE: return "unreadable";
    case REC_UNSYNCABLE: return "unsyncable";
    case REC_PRESENT: return "present";
    case REC_CREATED: return "created";
    case REC_LISTED: return "listed";
    case REC_UNCERTAIN: return "uncertain";
    case REC_ABSENT_ROOT: return "absent-root";
    default: return "failed";
  }
}

/* The first failure is kept, with the phase it happened in. */
static void receipt_fail(BatonReceipt *call,int error,const char *phase) {
  if(!call->error) {call->error=error;call->phase=(char *)phase;}
}

static int receipt_chars_ok(const char *text,size_t length) {
  if(length==0 || strlen(text)!=length) return 0;
  for(size_t index=0;index<length;index++) {
    char c=text[index];
    int ok=(c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')
           ||c=='.'||c=='_'||c=='-';
    if(!ok) return 0;
  }
  return strcmp(text,".")!=0 && strcmp(text,"..")!=0;
}

/* A reversible encoding of the target ref for a lock name: no hashing, so two
   distinct targets in one repository can never share a lock, and every other
   character is confined to the internal alphabet. */
static void receipt_encode_ref(const char *target,char *out,size_t span) {
  static const char *hex="0123456789abcdef";
  size_t at=0;
  for(const char *p=target;*p && at+4<span;p++) {
    unsigned char c=(unsigned char)*p;
    int plain=(c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')
              ||c=='.'||c=='_'||c=='-';
    if(plain) out[at++]=(char)c;
    else {out[at++]='%';out[at++]=hex[c>>4];out[at++]=hex[c&15];}
  }
  out[at]=0;
}

static int receipt_write_all(int fd,const char *data,size_t length) {
  size_t done=0;
  while(done<length) {
    ssize_t wrote=write(fd,data+done,length-done);
    if(wrote<0) {if(errno==EINTR) continue; return errno;}
    if(wrote==0) return EIO;
    done+=(size_t)wrote;
  }
  return 0;
}

/* One close attempt; the first failure is retained and no descriptor is closed
   twice. */
static void receipt_sync_dir(BatonReceipt *call,const char *file,const char *phase) {
  char *copy=strdup(file);
  if(!copy) {receipt_fail(call,ENOMEM,phase);return;}
  char *slash=strrchr(copy,'/');
  if(slash) *slash=0; else strcpy(copy,".");
  int fd=open(copy,O_RDONLY);
  if(fd<0) {receipt_fail(call,errno,phase);free(copy);return;}
  if(fsync(fd)) receipt_fail(call,errno,phase);
  if(close(fd)) receipt_fail(call,errno,"close-dir");
  free(copy);
}

/* 1 present, 0 absent, negative -errno when the probe could not answer, so an
   unavailable observation is never reported as absence. */
static int receipt_pending(const char *path) {
  size_t span=strlen(path)+16;
  char *temp=malloc(span);
  if(!temp) return -ENOMEM;
  snprintf(temp,span,"%s.publishing",path);
  int answer;
  if(access(temp,F_OK)==0) answer=1;
  else if(errno==ENOENT) answer=0;
  else answer=-errno;
  free(temp);
  return answer;
}

/* mkdir -p for the landing's own directories. An existing path is accepted only
   when it is a directory. */
static int receipt_mkdir_p(const char *directory) {
  if(!directory || !*directory) return EINVAL;
  char *copy=strdup(directory);
  if(!copy) return ENOMEM;
  for(char *p=copy+1;*p;p++) {
    if(*p!='/') continue;
    *p=0;
    if(mkdir(copy,0700) && errno!=EEXIST) {int error=errno;free(copy);return error;}
    struct stat state;
    if(stat(copy,&state) || !S_ISDIR(state.st_mode)) {free(copy);return ENOTDIR;}
    *p='/';
  }
  if(mkdir(copy,0700) && errno!=EEXIST) {int error=errno;free(copy);return error;}
  struct stat state;
  if(stat(copy,&state) || !S_ISDIR(state.st_mode)) {free(copy);return ENOTDIR;}
  free(copy);
  return 0;
}

/* The record is built at exactly the size its components need. An allocation or
   overflow failure is a failure: a truncated record is never returned, because a
   caller cannot tell a truncated list from a complete one. */
static Term receipt_record(Env e,BatonReceipt *call) {
  const char *tag=receipt_tag(call->outcome);
  const char *path=call->path?call->path:"";
  const char *phase=call->phase?call->phase:"";
  /* An uncertain record carries the established fact in its own field; every
     other outcome keeps the detail the call set, or the first error's text. */
  const char *detail=call->outcome==REC_UNCERTAIN && call->established
                     ? call->established
                     : (call->detail?call->detail:(call->phase?strerror(call->error):""));
  char error_text[24],pending_text[24];
  snprintf(error_text,sizeof error_text,"%d",call->error);
  snprintf(pending_text,sizeof pending_text,"%d",call->pending);
  size_t parts[6];
  parts[0]=strlen(tag);parts[1]=strlen(path);parts[2]=strlen(error_text);
  parts[3]=strlen(phase);parts[4]=strlen(pending_text);parts[5]=strlen(detail);
  size_t span=6;                                  /* five separators and the terminator */
  for(int index=0;index<6;index++) {
    if(SIZE_MAX-parts[index]<span) return io_fail(e,EOVERFLOW,NULL);
    span+=parts[index];
  }
  char *record=malloc(span);
  if(!record) return io_fail(e,ENOMEM,NULL);
  int written=snprintf(record,span,"%s\t%s\t%s\t%s\t%s\t%s",
                       tag,path,error_text,phase,pending_text,detail);
  if(written<0 || (size_t)written>=span) {free(record);return io_fail(e,EOVERFLOW,NULL);}
  Term value=io_str(e,record,(size_t)written);
  free(record);
  return io_done(e,value);
}

static void receipt_free(BatonReceipt *call) {
  free(call->directory);free(call->name);free(call->content);free(call->common);
  free(call->target);free(call->path);
  /* Every pointer freed here is heap owned; established is non-owned and is
     never freed. */
  if(call->detail && call->detail!=call->names) free(call->detail);
  free(call->names);
  free(call);
}

/* A negative pending answer means the temp state could not be observed. The
   fresh publication is never converted: it made and removed its own temp, so it
   observed that state, carries pending 0 and its record stays published. An
   existing record and a qualified one were only probed, so a negative answer
   there is genuine uncertainty: the tag becomes uncertain and the established
   fact is kept in its own non-owned field, so a caller cannot read the negative
   value as absence and cannot confuse it with a clean publication. Every other
   outcome keeps its tag with the negative answer visible.
   The guard names published as well, so no ordinary success tag can ever carry a
   negative answer; the fresh path can only reach this call with pending 0. */
static void receipt_uncertain_if_pending_unknown(BatonReceipt *call,const char *established) {
  if(call->pending>=0) return;
  if(call->outcome!=REC_PUBLISHED && call->outcome!=REC_EXISTING
     && call->outcome!=REC_QUALIFIED) return;
  call->outcome=REC_UNCERTAIN;
  call->established=established;
}

/* --- publish ------------------------------------------------------------- */

static void baton_receipt_publish_call(IoWork *w) {
  BatonReceipt *call=(BatonReceipt *)w->data;
  size_t span=strlen(call->directory)+strlen(call->name)+16;
  call->path=malloc(span);
  if(!call->path) {receipt_fail(call,ENOMEM,"path");call->outcome=REC_UNPUBLISHED;return;}
  snprintf(call->path,span,"%s/%s",call->directory,call->name);
  call->pending=receipt_pending(call->path);

  if(access(call->path,F_OK)==0) {
    /* Only the probe looked at the temp here, so a negative answer is kept. */
    call->outcome=REC_EXISTING;
    receipt_uncertain_if_pending_unknown(call,"existing");
    return;
  }                                                                            /* 1 */
  if(errno!=ENOENT) {receipt_fail(call,errno,"access");call->outcome=REC_UNPUBLISHED;return;}

  char *temp=malloc(span);
  if(!temp) {receipt_fail(call,ENOMEM,"path");call->outcome=REC_UNPUBLISHED;return;}
  snprintf(temp,span,"%s.publishing",call->path);

  int fd=open(temp,O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC,0600);                    /* 2 */
  if(fd<0) {receipt_fail(call,errno,"open-temp");call->outcome=REC_UNPUBLISHED;free(temp);return;}
  int error=receipt_write_all(fd,call->content,call->content_length);          /* 3 */
  if(error) receipt_fail(call,error,"write");
  if(!error && fsync(fd)) receipt_fail(call,errno,"fsync-file");               /* 4 */
  if(close(fd)) receipt_fail(call,errno,"close-temp");
  if(call->error) {call->outcome=REC_UNPUBLISHED;call->pending=1;free(temp);return;}

  if(link(temp,call->path)!=0) {                                              /* 5 */
    if(errno==EEXIST) call->outcome=REC_EXISTING;
    else {receipt_fail(call,errno,"link");call->outcome=REC_UNPUBLISHED;}
    call->pending=1;
    free(temp);
    return;
  }
  call->pending=1;
  receipt_sync_dir(call,call->path,"fsync-dir");                              /* 6 */
  if(call->error) {call->outcome=REC_MAY_EXIST;free(temp);return;}
  if(unlink(temp)) {receipt_fail(call,errno,"unlink-temp");call->outcome=REC_MAY_EXIST;free(temp);return;}
  /* This call made and removed its own temp, so it observed the state it is
     recording: pending is 0 here and the record is never converted. */
  call->pending=0;
  receipt_sync_dir(call,call->path,"fsync-dir-final");                        /* 7 */
  if(call->error) call->outcome=REC_MAY_EXIST;
  else call->outcome=REC_PUBLISHED;
  receipt_uncertain_if_pending_unknown(call,"published");
  free(temp);
}

static Term baton_receipt_publish_pack(Env e,IoWork *w) {
  BatonReceipt *call=(BatonReceipt *)w->data;
  Term result=receipt_record(e,call);
  receipt_free(call);w->data=NULL;
  return result;
}

#ifdef CID_RECEIPT_PUBLISH
static Term baton_receipt_publish_run(Env e,Term *f,IoWork *w) {
  BatonReceipt *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  u64 dn=0,nn=0,cn=0;
  call->directory=io_cstr(e,f[0],&dn);call->name=io_cstr(e,f[1],&nn);
  call->content=io_cstr(e,f[2],&cn);
  call->content_length=(size_t)cn;
  if(dn==0 || strlen(call->directory)!=dn || strchr(call->directory,'\t')) {
    receipt_free(call);return io_fail(e,EINVAL,"directory is empty, truncated at NUL, or carries a tab");
  }
  if(!receipt_chars_ok(call->name,nn)) {
    receipt_free(call);return io_fail(e,EINVAL,"name is not in the internal alphabet");
  }
  w->data=(char *)call;
  return io_work(w,baton_receipt_publish_call,baton_receipt_publish_pack);
}
static void __attribute__((constructor)) baton_receipt_publish_use(void) {io_eff(CID_RECEIPT_PUBLISH,baton_receipt_publish_run,0);}
#endif

/* --- qualify ------------------------------------------------------------- */

static void baton_receipt_qualify_call(IoWork *w) {
  BatonReceipt *call=(BatonReceipt *)w->data;
  call->path=strdup(call->directory);
  if(!call->path) {receipt_fail(call,ENOMEM,"path");call->outcome=REC_UNREADABLE;return;}
  call->pending=receipt_pending(call->path);
  int fd=open(call->path,O_RDONLY);
  if(fd<0) {
    if(errno==ENOENT) call->outcome=REC_ABSENT;
    else {receipt_fail(call,errno,"open");call->outcome=REC_UNREADABLE;}
    return;
  }
  if(close(fd)) {receipt_fail(call,errno,"close");call->outcome=REC_UNREADABLE;return;}
  int file=open(call->path,O_RDONLY);
  if(file<0) {receipt_fail(call,errno,"open");call->outcome=REC_UNREADABLE;return;}
  if(fsync(file)) receipt_fail(call,errno,"fsync-file");
  if(close(file)) receipt_fail(call,errno,"close-file");
  receipt_sync_dir(call,call->path,"fsync-dir");
  if(call->error) call->outcome=REC_UNSYNCABLE;
  else call->outcome=REC_QUALIFIED;
  /* qualify never observed the temp: the probe is the only evidence. */
  receipt_uncertain_if_pending_unknown(call,"qualified");
}

static Term baton_receipt_qualify_pack(Env e,IoWork *w) {
  BatonReceipt *call=(BatonReceipt *)w->data;
  Term result=receipt_record(e,call);
  receipt_free(call);w->data=NULL;
  return result;
}

#ifdef CID_RECEIPT_QUALIFY
static Term baton_receipt_qualify_run(Env e,Term *f,IoWork *w) {
  BatonReceipt *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  u64 dn=0;
  call->directory=io_cstr(e,f[0],&dn);
  if(strlen(call->directory)!=dn) {receipt_free(call);return io_fail(e,EINVAL,"path contains NUL");}
  w->data=(char *)call;
  return io_work(w,baton_receipt_qualify_call,baton_receipt_qualify_pack);
}
static void __attribute__((constructor)) baton_receipt_qualify_use(void) {io_eff(CID_RECEIPT_QUALIFY,baton_receipt_qualify_run,0);}
#endif

/* --- ensure -------------------------------------------------------------- */

static void baton_receipt_ensure_call(IoWork *w) {
  BatonReceipt *call=(BatonReceipt *)w->data;
  call->path=strdup(call->directory);
  if(!call->path) {receipt_fail(call,ENOMEM,"path");call->outcome=REC_FAILED;return;}
  struct stat state;
  int existed=stat(call->path,&state)==0;
  int error=receipt_mkdir_p(call->path);
  if(error) {receipt_fail(call,error,"mkdir");call->outcome=REC_FAILED;return;}
  call->outcome=existed?REC_PRESENT:REC_CREATED;
}

static Term baton_receipt_ensure_pack(Env e,IoWork *w) {
  BatonReceipt *call=(BatonReceipt *)w->data;
  Term result=receipt_record(e,call);
  receipt_free(call);w->data=NULL;
  return result;
}

#ifdef CID_RECEIPT_ENSURE
static Term baton_receipt_ensure_run(Env e,Term *f,IoWork *w) {
  BatonReceipt *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  u64 dn=0;
  call->directory=io_cstr(e,f[0],&dn);
  if(dn==0) {receipt_free(call);return io_fail(e,EINVAL,"path is empty");}
  if(strlen(call->directory)!=dn) {receipt_free(call);return io_fail(e,EINVAL,"path contains NUL");}
  w->data=(char *)call;
  return io_work(w,baton_receipt_ensure_call,baton_receipt_ensure_pack);
}
static void __attribute__((constructor)) baton_receipt_ensure_use(void) {io_eff(CID_RECEIPT_ENSURE,baton_receipt_ensure_run,0);}
#endif

/* --- matches ------------------------------------------------------------- */

static void baton_receipt_matches_call(IoWork *w) {
  BatonReceipt *call=(BatonReceipt *)w->data;
  DIR *directory=opendir(call->directory);
  if(!directory) {
    if(errno==ENOENT) call->outcome=REC_ABSENT_ROOT;
    else {receipt_fail(call,errno,"opendir");call->outcome=REC_FAILED;}
    return;
  }
  size_t suffix=strlen(call->name),capacity=256;
  call->names=malloc(capacity);
  if(!call->names) {receipt_fail(call,ENOMEM,"buffer");call->outcome=REC_FAILED;closedir(directory);return;}
  call->names[0]=0;
  struct dirent *entry;
  errno=0;
  while((entry=readdir(directory))) {
    size_t length=strlen(entry->d_name);
    if(length<suffix || strcmp(entry->d_name+length-suffix,call->name)) continue;
    if(!receipt_chars_ok(entry->d_name,length)) {
      receipt_fail(call,EINVAL,"name-outside-alphabet");
      break;
    }
    if(call->names_length+length+2>capacity) {
      size_t wanted=capacity;
      while(call->names_length+length+2>wanted) wanted*=2;
      char *next=realloc(call->names,wanted);
      if(!next) {receipt_fail(call,ENOMEM,"buffer");break;}
      call->names=next;
      capacity=wanted;
    }
    memcpy(call->names+call->names_length,entry->d_name,length);
    call->names_length+=length;
    call->names[call->names_length++]='\n';
    call->names[call->names_length]=0;
  }
  if(errno) receipt_fail(call,errno,"readdir");
  if(closedir(directory)) receipt_fail(call,errno,"closedir");
  call->outcome=call->error?REC_FAILED:REC_LISTED;
}

static Term baton_receipt_matches_pack(Env e,IoWork *w) {
  BatonReceipt *call=(BatonReceipt *)w->data;
  if(call->outcome==REC_LISTED) call->detail=call->names;
  Term result=receipt_record(e,call);
  receipt_free(call);w->data=NULL;
  return result;
}

#ifdef CID_RECEIPT_MATCHES
static Term baton_receipt_matches_run(Env e,Term *f,IoWork *w) {
  BatonReceipt *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  u64 dn=0,sn=0;
  call->directory=io_cstr(e,f[0],&dn);call->name=io_cstr(e,f[1],&sn);
  if(strlen(call->directory)!=dn || strlen(call->name)!=sn) {
    receipt_free(call);return io_fail(e,EINVAL,"directory or suffix contains NUL");
  }
  w->data=(char *)call;
  return io_work(w,baton_receipt_matches_call,baton_receipt_matches_pack);
}
static void __attribute__((constructor)) baton_receipt_matches_use(void) {io_eff(CID_RECEIPT_MATCHES,baton_receipt_matches_run,0);}
#endif

/* --- claim and release --------------------------------------------------- */

/* The canonical guard location for a common directory, and the guard path for a target
   under it. Both are naming only: no directory is created and no filesystem call is made,
   so a caller asking where the guard is cannot change what is on disk. On failure each
   returns NULL with *problem set to ENOMEM. */
static char *receipt_guard_root(const char *common,int *problem) {
  size_t span=strlen(common)+strlen("/baton2-landing")+1;
  char *root=malloc(span);
  if(!root) {*problem=ENOMEM;return NULL;}
  snprintf(root,span,"%s/baton2-landing",common);
  return root;
}

static char *receipt_guard_path(const char *root,const char *target,int *problem) {
  size_t span=strlen(root)+strlen(target)*3+8;
  char *path=malloc(span);
  char *encoded=malloc(strlen(target)*3+2);
  if(!path || !encoded) {free(path);free(encoded);*problem=ENOMEM;return NULL;}
  receipt_encode_ref(target,encoded,strlen(target)*3+2);
  snprintf(path,span,"%s/%s.lock",root,encoded);
  free(encoded);
  return path;
}

static void baton_receipt_claim_call(IoWork *w) {
  BatonReceipt *call=(BatonReceipt *)w->data;
  int problem=0;
  char *root=receipt_guard_root(call->common,&problem);
  if(!root) {receipt_fail(call,problem,"path");return;}
  int made=receipt_mkdir_p(root);
  if(made) {receipt_fail(call,made,"mkdir");free(root);return;}
  call->path=receipt_guard_path(root,call->target,&problem);
  free(root);
  if(!call->path) {receipt_fail(call,problem,"path");return;}
  call->handle=open(call->path,O_CREAT|O_RDWR|O_CLOEXEC,0600);
  if(call->handle<0) {receipt_fail(call,errno,"open-lock");return;}
  int result;
  do {result=flock(call->handle,LOCK_EX|LOCK_NB);} while(result<0 && errno==EINTR);
  if(result<0) {receipt_fail(call,errno,"flock");close(call->handle);}
}

static Term baton_receipt_claim_pack(Env e,IoWork *w) {
  BatonReceipt *call=(BatonReceipt *)w->data;
  Term value;
  if(call->error==EWOULDBLOCK || call->error==EAGAIN) {call->error=0;value=term_pak(CID_NONE,0);}
  else if(!call->error) value=io_box(e,CID_SOME,(Term)call->handle);
  else value=(Term)0;
  Term result=call->error ? io_fail(e,call->error,NULL) : io_done(e,value);
  receipt_free(call);w->data=NULL;
  return result;
}

#ifdef CID_RECEIPT_CLAIM
static Term baton_receipt_claim_run(Env e,Term *f,IoWork *w) {
  BatonReceipt *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  u64 cn=0,tn=0;
  call->common=io_cstr(e,f[0],&cn);call->target=io_cstr(e,f[1],&tn);
  if(strlen(call->common)!=cn) {receipt_free(call);return io_fail(e,EINVAL,"common directory contains NUL");}
  if(tn==0 || strlen(call->target)!=tn) {
    receipt_free(call);return io_fail(e,EINVAL,"target is empty or truncated at NUL");
  }
  w->data=(char *)call;
  return io_work(w,baton_receipt_claim_call,baton_receipt_claim_pack);
}
static void __attribute__((constructor)) baton_receipt_claim_use(void) {io_eff(CID_RECEIPT_CLAIM,baton_receipt_claim_run,0);}
#endif

#ifdef CID_RECEIPT_RELEASE
static Term baton_receipt_release_run(Env e,Term *f,IoWork *w) {
  BatonReceipt *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  int handle=(int)f[0];
  int error=handle<0?EBADF:(close(handle)?errno:0);
  receipt_free(call);
  return error ? io_fail(e,error,NULL) : io_done(e,term_pak(CID_UNIT,0));
}
static void __attribute__((constructor)) baton_receipt_release_use(void) {io_eff(CID_RECEIPT_RELEASE,baton_receipt_release_run,0);}
#endif

#ifdef CID_RECEIPT_GUARD_PATH
/* Naming data only: it reports where the guard is, not that any claim is held, and it
   creates nothing. */
static Term baton_receipt_guard_path_run(Env e,Term *f,IoWork *w) {
  BatonReceipt *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  u64 cn=0,tn=0;
  call->common=io_cstr(e,f[0],&cn);call->target=io_cstr(e,f[1],&tn);
  if(strlen(call->common)!=cn) {receipt_free(call);return io_fail(e,EINVAL,"common directory contains NUL");}
  if(tn==0 || strlen(call->target)!=tn) {
    receipt_free(call);return io_fail(e,EINVAL,"target is empty or truncated at NUL");
  }
  int problem=0;
  char *root=receipt_guard_root(call->common,&problem);
  /* the path is built while call->target is still owned; both allocations are released
     once on every exit, and nothing reads call after receipt_free */
  char *path=root?receipt_guard_path(root,call->target,&problem):NULL;
  free(root);
  receipt_free(call);
  if(!path) return io_fail(e,problem?problem:ENOMEM,NULL);
  Term value=io_str(e,path,strlen(path));
  free(path);
  return io_done(e,value);
}
static void __attribute__((constructor)) baton_receipt_guard_path_use(void) {io_eff(CID_RECEIPT_GUARD_PATH,baton_receipt_guard_path_run,0);}
#endif

#ifdef CID_RECEIPT_ATTEMPT_TOKEN
/* The same encoded form of a target ref the guard path uses, exposed as the safe token an
   attempt scratch name can carry. Two distinct targets can never share it, and it is
   confined to the internal alphabet, so a slash-bearing branch name cannot alter the
   directory structure of an attempt. */
static Term baton_receipt_attempt_token_run(Env e,Term *f,IoWork *w) {
  BatonReceipt *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  u64 tn=0;
  call->target=io_cstr(e,f[0],&tn);
  if(tn==0 || strlen(call->target)!=tn) {
    receipt_free(call);return io_fail(e,EINVAL,"target is empty or truncated at NUL");
  }
  size_t span=strlen(call->target)*3+2;
  char *token=malloc(span);
  if(!token) {receipt_free(call);return io_fail(e,ENOMEM,NULL);}
  receipt_encode_ref(call->target,token,span);
  receipt_free(call);
  Term value=io_str(e,token,strlen(token));
  free(token);
  return io_done(e,value);
}
static void __attribute__((constructor)) baton_receipt_attempt_token_use(void) {io_eff(CID_RECEIPT_ATTEMPT_TOKEN,baton_receipt_attempt_token_run,0);}
#endif

#ifdef CID_RECEIPT_RESERVE_ATTEMPT
/* Exclusively establish one attempt directory under a parent. mkdir is the write boundary, so
   an existing name is reported as taken rather than probed, a write failure is reported with
   its own errno, and nothing here treats an observation failure as absence. The caller is
   expected to hold the target claim: the reservation admits the attempt, it does not
   establish the guard. Success answers the reserved path; every failure answers its errno, so
   the caller can tell EEXIST from a real error. */
static Term baton_receipt_reserve_attempt_run(Env e,Term *f,IoWork *w) {
  BatonReceipt *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  u64 dn=0,nn=0;
  call->directory=io_cstr(e,f[0],&dn);
  call->name=io_cstr(e,f[1],&nn);
  if(strlen(call->directory)!=dn) {receipt_free(call);return io_fail(e,EINVAL,"parent contains NUL");}
  if(strlen(call->name)!=nn) {receipt_free(call);return io_fail(e,EINVAL,"name contains NUL");}
  if(dn==0 || nn==0) {receipt_free(call);return io_fail(e,EINVAL,"parent or name is empty");}
  size_t span=dn+nn+2;
  char *path=malloc(span);
  if(!path) {receipt_free(call);return io_fail(e,ENOMEM,NULL);}
  snprintf(path,span,"%s/%s",call->directory,call->name);
  receipt_free(call);
  int result=mkdir(path,0700);
  int error=result?errno:0;
  if(error) {free(path);return io_fail(e,error,NULL);}
  Term value=io_str(e,path,strlen(path));
  free(path);
  return io_done(e,value);
}
static void __attribute__((constructor)) baton_receipt_reserve_attempt_use(void) {io_eff(CID_RECEIPT_RESERVE_ATTEMPT,baton_receipt_reserve_attempt_run,0);}
#endif
