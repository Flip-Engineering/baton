#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#define main generated_main
#include BATON2_PROCESS_SOURCE
#undef main

#define REQUIRE(test) do { if(!(test)) { fprintf(stderr,"fixture failure: %s (errno %d)\n",#test,errno); return 2; } } while(0)

#define SHORT_LINES 4096
#define SHORT_LINE_BYTES 127
#define SHORT_BYTES (SHORT_LINES*(SHORT_LINE_BYTES+1))

/* Bytes this process has read through read and pread, from /proc/self/io. */
static unsigned long long fixture_rchar(void) {
  FILE *file=fopen("/proc/self/io","r");
  if(!file)return 0;
  char line[128];unsigned long long value=0;
  while(fgets(line,sizeof(line),file))
    if(!strncmp(line,"rchar:",6)) {value=strtoull(line+6,NULL,10);break;}
  fclose(file);
  return value;
}

static int fixture_spool(const char *directory,const char *name,const char *bytes,size_t length) {
  char *path=br_path(directory,name);
  int fd=path?open(path,O_CREAT|O_RDWR|O_TRUNC|O_CLOEXEC,0600):-1;
  free(path);
  if(fd<0)return -1;
  if(length && br_write_all(fd,bytes,length)) {close(fd);return -1;}
  return fd;
}

static int fixture_append(int fd,const char *bytes,size_t length) {
  struct stat info;
  if(fstat(fd,&info))return errno;
  if(pwrite(fd,bytes,length,info.st_size)!=(ssize_t)length)return EIO;
  return 0;
}

static void fixture_retained(BatonRetained *retained,BatonChild *child,const char *directory,int fd,int exited) {
  memset(retained,0,sizeof(*retained));
  memset(child,0,sizeof(*child));
  retained->spool=fd;retained->exited=exited;
  retained->socket=-1;retained->guard=-1;retained->watch=-1;retained->life=-1;retained->custody_lock=-1;
  retained->directory=(char *)directory;
  pthread_mutex_init(&retained->state,NULL);
  pthread_mutex_init(&retained->command,NULL);
  pthread_mutex_init(&retained->reader,NULL);
  pthread_cond_init(&retained->changed,NULL);
  child->retained=retained;
}

static void fixture_set_error(BatonRetained *retained,int error) {
  pthread_mutex_lock(&retained->state);
  retained->error=error;
  pthread_mutex_unlock(&retained->state);
}

static void fixture_set_exited(BatonRetained *retained) {
  pthread_mutex_lock(&retained->state);
  retained->exited=1;retained->version++;
  pthread_cond_broadcast(&retained->changed);
  pthread_mutex_unlock(&retained->state);
}

enum { SPAN_LINE=1, SPAN_SILENT=0, SPAN_END=-1, SPAN_ERROR=-2 };

/* One span read through the awake probe (blocking=0) or the blocking reader
   (blocking=1). A returned line or end-of-output tail yields SPAN_LINE with its
   range; *error receives the call error for SPAN_ERROR. */
static int fixture_span(int blocking,BatonChild *child,uint64_t *start,uint64_t *length,int *error) {
  BatonProcessCall call;memset(&call,0,sizeof(call));
  call.child=child;call.kind=BP_READ_SPAN;
  int result;
  if(blocking) {
    br_read_line_span(&call);
    result=call.error?SPAN_ERROR:call.eof?SPAN_END:SPAN_LINE;
    free(call.cursor);free(call.generation);
  } else {
    int probe=br_spool_try_line_span(child->retained,&call);
    result=call.error?SPAN_ERROR:probe==1?SPAN_LINE:probe==0?SPAN_SILENT:call.eof?SPAN_END:SPAN_LINE;
  }
  *start=call.frame_start;*length=call.frame_length;*error=call.error;
  return result;
}

/* Reads SHORT_LINES lines of SHORT_LINE_BYTES bytes and reports the bytes read.
   With uncached set, the kept bytes are discarded before every read, which
   repeats the 8192-byte pread at each line start. */
static int short_lines(const char *directory,int blocking,int uncached,unsigned long long *read) {
  char *bytes=malloc(SHORT_BYTES);
  REQUIRE(bytes!=NULL);
  for(size_t i=0;i<SHORT_LINES;i++) {
    memset(bytes+i*(SHORT_LINE_BYTES+1),'a',SHORT_LINE_BYTES);
    bytes[i*(SHORT_LINE_BYTES+1)+SHORT_LINE_BYTES]='\n';
  }
  int fd=fixture_spool(directory,"short",bytes,SHORT_BYTES);
  free(bytes);
  REQUIRE(fd>=0);
  BatonRetained retained;BatonChild child;
  fixture_retained(&retained,&child,directory,fd,1);
  unsigned long long before=fixture_rchar();
  uint64_t expected=0,start=0,length=0;int error=0;size_t lines=0;
  for(;;) {
    if(uncached) br_spool_tail_reset(&retained);
    int result=fixture_span(blocking,&child,&start,&length,&error);
    if(result==SPAN_END)break;
    REQUIRE(result==SPAN_LINE);
    REQUIRE(start==expected && length==SHORT_LINE_BYTES);
    expected+=SHORT_LINE_BYTES+1;lines++;
  }
  unsigned long long after=fixture_rchar();
  close(fd);
  REQUIRE(lines==SHORT_LINES && retained.offset==(off_t)SHORT_BYTES);
  REQUIRE(before && after>=before);
  *read=after-before;
  return 0;
}

/* Empty and unterminated lines; the empty line and the final tail come from
   the kept bytes of the first pread. */
static int edge_lines(const char *directory,int blocking) {
  int fd=fixture_spool(directory,"edges","a\n\nlast",7);
  REQUIRE(fd>=0);
  BatonRetained retained;BatonChild child;
  fixture_retained(&retained,&child,directory,fd,1);
  uint64_t start=0,length=0;int error=0;
  REQUIRE(fixture_span(blocking,&child,&start,&length,&error)==SPAN_LINE && start==0 && length==1);
  REQUIRE(retained.offset==2 && retained.spool_tail_length==5);
  REQUIRE(fixture_span(blocking,&child,&start,&length,&error)==SPAN_LINE && start==2 && length==0);
  REQUIRE(retained.offset==3 && retained.spool_tail_length==4);
  REQUIRE(fixture_span(blocking,&child,&start,&length,&error)==SPAN_LINE && start==3 && length==4);
  REQUIRE(retained.offset==7 && retained.spool_tail_length==0);
  REQUIRE(fixture_span(blocking,&child,&start,&length,&error)==SPAN_END && retained.offset==7);
  close(fd);
  return 0;
}

/* A line split across writes keeps its NUL byte. A silent probe leaves offset
   unchanged and records the scanned bytes, so the next probe reads after them. */
static int split_line(const char *directory) {
  int fd=fixture_spool(directory,"split","left\0mid",8);
  REQUIRE(fd>=0);
  BatonRetained retained;BatonChild child;
  fixture_retained(&retained,&child,directory,fd,0);
  uint64_t start=0,length=0;int error=0;
  REQUIRE(fixture_span(0,&child,&start,&length,&error)==SPAN_SILENT);
  REQUIRE(retained.offset==0 && retained.spool_partial==8 && retained.spool_tail_length==0);
  REQUIRE(fixture_append(fd,"right\nnext",10)==0);
  REQUIRE(fixture_span(0,&child,&start,&length,&error)==SPAN_LINE && start==0 && length==13);
  REQUIRE(retained.offset==14 && retained.spool_tail_length==4);
  REQUIRE(fixture_span(0,&child,&start,&length,&error)==SPAN_SILENT);
  REQUIRE(retained.offset==14 && retained.spool_partial==4 && retained.spool_tail_length==0);
  fixture_set_exited(&retained);
  REQUIRE(fixture_span(0,&child,&start,&length,&error)==SPAN_LINE && start==14 && length==4);
  REQUIRE(retained.offset==18 && retained.spool_partial==0);
  REQUIRE(fixture_span(0,&child,&start,&length,&error)==SPAN_END && retained.offset==18);
  close(fd);
  return 0;
}

/* Kept bytes belong to one offset. A text read that moves offset and a replay
   rewind both discard them. */
static int invalidation(const char *directory) {
  int fd=fixture_spool(directory,"moved","one\ntwo\nthree\n",14);
  REQUIRE(fd>=0);
  BatonRetained retained;BatonChild child;
  fixture_retained(&retained,&child,directory,fd,1);
  uint64_t start=0,length=0;int error=0;
  REQUIRE(fixture_span(0,&child,&start,&length,&error)==SPAN_LINE && start==0 && length==3);
  REQUIRE(retained.spool_tail_length==10);
  BatonProcessCall text;memset(&text,0,sizeof(text));
  REQUIRE(br_spool_try_line(&retained,&text)==1 && text.length==3 && !memcmp(text.text,"two",3));
  free(text.text);
  REQUIRE(retained.offset==8);
  REQUIRE(fixture_span(1,&child,&start,&length,&error)==SPAN_LINE && start==8 && length==5);
  REQUIRE(retained.offset==14);
  BatonProcessCall replay;memset(&replay,0,sizeof(replay));
  replay.child=&child;replay.kind=BP_INSTANCE_REPLAY;
  baton_retained_call(&replay);
  REQUIRE(replay.error==0);
  REQUIRE(retained.offset==0 && retained.spool_tail_length==0 && retained.spool_state_offset==0);
  REQUIRE(fixture_span(1,&child,&start,&length,&error)==SPAN_LINE && start==0 && length==3);
  REQUIRE(retained.spool_tail_length==10);
  close(fd);
  return 0;
}

/* A child error recorded after a read is reported before the kept bytes are
   used, and leaves offset and the kept bytes unchanged. */
static int recorded_error(const char *directory,int blocking) {
  int fd=fixture_spool(directory,"error","first\nsecond\n",13);
  REQUIRE(fd>=0);
  BatonRetained retained;BatonChild child;
  fixture_retained(&retained,&child,directory,fd,1);
  uint64_t start=0,length=0;int error=0;
  REQUIRE(fixture_span(blocking,&child,&start,&length,&error)==SPAN_LINE && start==0 && length==5);
  REQUIRE(retained.offset==6 && retained.spool_tail_length==7);
  fixture_set_error(&retained,EIO);
  REQUIRE(fixture_span(blocking,&child,&start,&length,&error)==SPAN_ERROR && error==EIO);
  REQUIRE(retained.offset==6 && retained.spool_tail_length==7);
  fixture_set_error(&retained,0);
  REQUIRE(fixture_span(blocking,&child,&start,&length,&error)==SPAN_LINE && start==6 && length==6);
  close(fd);
  return 0;
}

int main(void) {
  char directory[]="/tmp/spool-line-span-XXXXXX";
  REQUIRE(mkdtemp(directory)!=NULL);
  unsigned long long probe_cached=0,probe_uncached=0,blocking_cached=0,blocking_uncached=0;
  REQUIRE(short_lines(directory,0,0,&probe_cached)==0);
  REQUIRE(short_lines(directory,0,1,&probe_uncached)==0);
  REQUIRE(short_lines(directory,1,0,&blocking_cached)==0);
  REQUIRE(short_lines(directory,1,1,&blocking_uncached)==0);
  for(int blocking=0;blocking<2;blocking++) {
    REQUIRE(edge_lines(directory,blocking)==0);
    REQUIRE(recorded_error(directory,blocking)==0);
  }
  REQUIRE(split_line(directory)==0);
  REQUIRE(invalidation(directory)==0);
  printf("SHORT_LINES=%d\n",SHORT_LINES);
  printf("SHORT_BYTES=%d\n",SHORT_BYTES);
  printf("PROBE_CACHED_RCHAR=%llu\n",probe_cached);
  printf("PROBE_UNCACHED_RCHAR=%llu\n",probe_uncached);
  printf("BLOCKING_CACHED_RCHAR=%llu\n",blocking_cached);
  printf("BLOCKING_UNCACHED_RCHAR=%llu\n",blocking_uncached);
  printf("spool-line-span PASS\n");
  return 0;
}
