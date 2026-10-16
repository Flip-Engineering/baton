#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <poll.h>
#include <sched.h>
#include <signal.h>
#include <spawn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

typedef struct BatonCodexProxy {
  uint32_t handle;
  pid_t pid;
  int input, output, closing, upgraded;
  size_t references;
  pthread_mutex_t reader, writer;
  struct BatonCodexProxy *next;
} BatonCodexProxy;

typedef struct {
  BatonCodexProxy *proxy;
  char *text, *detail;
  size_t length;
  uint32_t handle, signal;
  int kind, error;
} BatonCodexCall;

enum { BC_OPEN, BC_SEND, BC_NEXT, BC_CLOSE, BC_CANCEL };
static pthread_mutex_t baton_codex_registry_lock=PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t baton_codex_registry_changed=PTHREAD_COND_INITIALIZER;
static pthread_mutex_t baton_codex_lifecycle_lock=PTHREAD_MUTEX_INITIALIZER;
static BatonCodexProxy *baton_codex_proxies;
static uint32_t baton_codex_serial;
static int bc_pipe(int fds[2]);
static int bc_signal_pipe[2]={-1,-1},bc_signal_started;
static volatile sig_atomic_t bc_signal_writer=-1,bc_signal_handlers;
static pthread_t bc_signal_thread;
static struct sigaction bc_previous_interrupt,bc_previous_terminate;

static void bc_forward_signal(int signal) {
  int saved=errno;
  __atomic_add_fetch(&bc_signal_handlers,1,__ATOMIC_SEQ_CST);
  int fd=__atomic_load_n(&bc_signal_writer,__ATOMIC_SEQ_CST);
  if(fd>=0){unsigned char value=(unsigned char)signal;ssize_t ignored=write(fd,&value,1);(void)ignored;}
  __atomic_sub_fetch(&bc_signal_handlers,1,__ATOMIC_SEQ_CST);
  errno=saved;
}

static void *bc_signal_worker(void *unused) {
  (void)unused;
  for(;;) {
    unsigned char signal;ssize_t count=read(bc_signal_pipe[0],&signal,1);
    if(count<0 && errno==EINTR)continue;
    if(count!=1 || !signal)return NULL;
    pthread_mutex_lock(&baton_codex_registry_lock);
    for(BatonCodexProxy *proxy=baton_codex_proxies;proxy;proxy=proxy->next)
      if(proxy->pid>0)kill(-proxy->pid,(int)signal);
    pthread_mutex_unlock(&baton_codex_registry_lock);
  }
}

static void bc_signal_stop(void) {
  if(!bc_signal_started)return;
  __atomic_store_n(&bc_signal_writer,-1,__ATOMIC_SEQ_CST);
  sigaction(SIGINT,&bc_previous_interrupt,NULL);sigaction(SIGTERM,&bc_previous_terminate,NULL);
  while(__atomic_load_n(&bc_signal_handlers,__ATOMIC_SEQ_CST))sched_yield();
  unsigned char stop=0;
  for(;;) {
    ssize_t count=write(bc_signal_pipe[1],&stop,1);
    if(count==1)break;
    if(count<0 && errno==EINTR)continue;
    if(count<0 && (errno==EAGAIN || errno==EWOULDBLOCK)) {
      struct pollfd ready={bc_signal_pipe[1],POLLOUT,0};
      while(poll(&ready,1,-1)<0 && errno==EINTR){}
      continue;
    }
    break;
  }
  pthread_join(bc_signal_thread,NULL);
  close(bc_signal_pipe[0]);close(bc_signal_pipe[1]);
  bc_signal_pipe[0]=bc_signal_pipe[1]=-1;bc_signal_started=0;
}

/* Called under lifecycle and registry locks before a child can be spawned. */
static int bc_signal_start(void) {
  if(bc_signal_started)return 0;
  int error=bc_pipe(bc_signal_pipe);if(error)return error;
  int flags=fcntl(bc_signal_pipe[1],F_GETFL);
  if(flags<0 || fcntl(bc_signal_pipe[1],F_SETFL,flags|O_NONBLOCK)<0) {
    error=errno;close(bc_signal_pipe[0]);close(bc_signal_pipe[1]);return error;
  }
  if(sigaction(SIGINT,NULL,&bc_previous_interrupt) || sigaction(SIGTERM,NULL,&bc_previous_terminate)) {
    error=errno;close(bc_signal_pipe[0]);close(bc_signal_pipe[1]);return error;
  }
  error=pthread_create(&bc_signal_thread,NULL,bc_signal_worker,NULL);
  if(error){close(bc_signal_pipe[0]);close(bc_signal_pipe[1]);return error;}
  bc_signal_started=1;
  struct sigaction action={0};action.sa_handler=bc_forward_signal;sigemptyset(&action.sa_mask);
  sigaddset(&action.sa_mask,SIGINT);sigaddset(&action.sa_mask,SIGTERM);
  __atomic_store_n(&bc_signal_writer,bc_signal_pipe[1],__ATOMIC_SEQ_CST);
  if(sigaction(SIGINT,&action,NULL) || sigaction(SIGTERM,&action,NULL))error=errno;
  return error;
}

static int bc_read(int fd,void *bytes,size_t length,size_t *received) {
  size_t offset=0;
  while(offset<length) {
    ssize_t count=read(fd,(char *)bytes+offset,length-offset);
    if(count>0)offset+=(size_t)count;
    else if(count<0 && errno==EINTR)continue;
    else {if(received)*received=offset;return count<0?errno:EPIPE;}
  }
  if(received)*received=offset;
  return 0;
}

static int bc_write(int fd,const void *bytes,size_t length) {
  /* A closed proxy pipe reports EPIPE to this operation. */
  sigset_t blocked,previous,pending;
  sigemptyset(&blocked);sigaddset(&blocked,SIGPIPE);
  int error=pthread_sigmask(SIG_BLOCK,&blocked,&previous);
  if(error)return error;
  sigpending(&pending);
  int had_pipe=sigismember(&pending,SIGPIPE);
  size_t offset=0;
  while(offset<length) {
    ssize_t count=write(fd,(const char *)bytes+offset,length-offset);
    if(count>0)offset+=(size_t)count;
    else if(count<0 && errno==EINTR)continue;
    else {error=count<0?errno:EIO;break;}
  }
  if(error==EPIPE && !had_pipe) {
    sigpending(&pending);
    if(sigismember(&pending,SIGPIPE)){int delivered;sigwait(&blocked,&delivered);}
  }
  int restored=pthread_sigmask(SIG_SETMASK,&previous,NULL);
  return error?error:restored;
}

static int bc_random(void *bytes,size_t length) {
  int fd=open("/dev/urandom",O_RDONLY|O_CLOEXEC);
  if(fd<0)return errno;
  int error=bc_read(fd,bytes,length,NULL);
  if(close(fd) && !error)error=errno;
  return error;
}

static uint32_t bc_rotate(uint32_t x,unsigned n) {return (x<<n)|(x>>(32-n));}

/* SHA-1 is required by the WebSocket opening handshake. */
static void bc_sha1_block(uint32_t state[5],const unsigned char block[64]) {
  uint32_t words[80];
  for(unsigned i=0;i<16;i++)words[i]=((uint32_t)block[4*i]<<24)|((uint32_t)block[4*i+1]<<16)|((uint32_t)block[4*i+2]<<8)|block[4*i+3];
  for(unsigned i=16;i<80;i++)words[i]=bc_rotate(words[i-3]^words[i-8]^words[i-14]^words[i-16],1);
  uint32_t a=state[0],b=state[1],c=state[2],d=state[3],e=state[4];
  for(unsigned i=0;i<80;i++) {
    uint32_t f,k;
    if(i<20){f=(b&c)|((~b)&d);k=0x5a827999;}
    else if(i<40){f=b^c^d;k=0x6ed9eba1;}
    else if(i<60){f=(b&c)|(b&d)|(c&d);k=0x8f1bbcdc;}
    else {f=b^c^d;k=0xca62c1d6;}
    uint32_t next=bc_rotate(a,5)+f+e+k+words[i];
    e=d;d=c;c=bc_rotate(b,30);b=a;a=next;
  }
  state[0]+=a;state[1]+=b;state[2]+=c;state[3]+=d;state[4]+=e;
}

static void bc_sha1(const unsigned char *bytes,size_t length,unsigned char digest[20]) {
  uint32_t state[5]={0x67452301,0xefcdab89,0x98badcfe,0x10325476,0xc3d2e1f0};
  size_t offset=0;
  while(length-offset>=64){bc_sha1_block(state,bytes+offset);offset+=64;}
  unsigned char final[128]={0};size_t tail=length-offset;
  memcpy(final,bytes+offset,tail);final[tail]=0x80;
  size_t padded=tail<56?64:128;
  uint64_t bits=(uint64_t)length*8;
  for(unsigned i=0;i<8;i++)final[padded-1-i]=(unsigned char)(bits>>(8*i));
  bc_sha1_block(state,final);if(padded==128)bc_sha1_block(state,final+64);
  for(unsigned i=0;i<20;i++)digest[i]=(unsigned char)(state[i/4]>>(24-8*(i%4)));
}

static void bc_base64(const unsigned char *bytes,size_t length,char *output) {
  static const char alphabet[]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  size_t j=0;
  for(size_t i=0;i<length;i+=3) {
    uint32_t value=(uint32_t)bytes[i]<<16;
    if(i+1<length)value|=(uint32_t)bytes[i+1]<<8;
    if(i+2<length)value|=bytes[i+2];
    output[j++]=alphabet[value>>18];output[j++]=alphabet[(value>>12)&63];
    output[j++]=i+1<length?alphabet[(value>>6)&63]:'=';
    output[j++]=i+2<length?alphabet[value&63]:'=';
  }
  output[j]=0;
}

static char *bc_hex_detail(const char *prefix,const unsigned char *bytes,size_t length) {
  size_t start=strlen(prefix);
  if(length>(SIZE_MAX-start-1)/2)return NULL;
  char *text=malloc(start+length*2+1);
  if(!text)return NULL;
  memcpy(text,prefix,start);
  static const char digits[]="0123456789abcdef";
  for(size_t i=0;i<length;i++){text[start+2*i]=digits[bytes[i]>>4];text[start+2*i+1]=digits[bytes[i]&15];}
  text[start+length*2]=0;return text;
}

static int bc_utf8(const unsigned char *bytes,size_t length) {
  for(size_t i=0;i<length;) {
    unsigned a=bytes[i++],need,min,next;
    if(a<0x80)continue;
    if(a>=0xc2 && a<=0xdf){need=1;min=0x80;next=a&31;}
    else if(a>=0xe0 && a<=0xef){need=2;min=0x800;next=a&15;}
    else if(a>=0xf0 && a<=0xf4){need=3;min=0x10000;next=a&7;}
    else return 0;
    if(need>length-i)return 0;
    while(need--){unsigned b=bytes[i++];if((b&0xc0)!=0x80)return 0;next=(next<<6)|(b&63);}
    if(next<min || next>0x10ffff || (next>=0xd800 && next<=0xdfff))return 0;
  }
  return 1;
}

static int bc_frame(BatonCodexProxy *proxy,unsigned opcode,const unsigned char *bytes,size_t length) {
  unsigned char header[14],mask[4];size_t n=2;
  int error=bc_random(mask,sizeof(mask));if(error)return error;
  header[0]=(unsigned char)(0x80|opcode);
  if(length<126)header[1]=(unsigned char)(0x80|length);
  else if(length<=65535){header[1]=0xfe;header[2]=(unsigned char)(length>>8);header[3]=(unsigned char)length;n=4;}
  else {header[1]=0xff;for(unsigned i=0;i<8;i++)header[2+i]=(unsigned char)((uint64_t)length>>(56-8*i));n=10;}
  memcpy(header+n,mask,4);n+=4;
  pthread_mutex_lock(&proxy->writer);
  error=proxy->input<0?EPIPE:bc_write(proxy->input,header,n);
  unsigned char chunk[8192];
  for(size_t offset=0;!error && offset<length;) {
    size_t count=length-offset;if(count>sizeof(chunk))count=sizeof(chunk);
    for(size_t i=0;i<count;i++)chunk[i]=bytes[offset+i]^mask[(offset+i)%4];
    error=bc_write(proxy->input,chunk,count);offset+=count;
  }
  pthread_mutex_unlock(&proxy->writer);return error;
}

static int bc_pipe(int fds[2]) {
  if(pipe(fds))return errno;
  if(fcntl(fds[0],F_SETFD,FD_CLOEXEC)<0 || fcntl(fds[1],F_SETFD,FD_CLOEXEC)<0) {
    int error=errno;close(fds[0]);close(fds[1]);return error;
  }
  return 0;
}

static int bc_spawn(BatonCodexProxy *proxy) {
  int input[2],output[2],error=bc_pipe(input);
  if(error)return error;
  error=bc_pipe(output);if(error){close(input[0]);close(input[1]);return error;}
  posix_spawn_file_actions_t actions;posix_spawnattr_t attrs;
  int have_actions=0,have_attrs=0;
  error=posix_spawn_file_actions_init(&actions);if(error)goto cleanup;have_actions=1;
  error=posix_spawnattr_init(&attrs);if(error)goto cleanup;have_attrs=1;
  error=posix_spawn_file_actions_adddup2(&actions,input[0],STDIN_FILENO);if(error)goto cleanup;
  error=posix_spawn_file_actions_adddup2(&actions,output[1],STDOUT_FILENO);if(error)goto cleanup;
  int fds[]={input[0],input[1],output[0],output[1]};
  for(unsigned i=0;i<4;i++){error=posix_spawn_file_actions_addclose(&actions,fds[i]);if(error)goto cleanup;}
  sigset_t defaults;sigemptyset(&defaults);sigaddset(&defaults,SIGPIPE);
  error=posix_spawnattr_setsigdefault(&attrs,&defaults);if(error)goto cleanup;
  error=posix_spawnattr_setpgroup(&attrs,0);if(error)goto cleanup;
  error=posix_spawnattr_setflags(&attrs,POSIX_SPAWN_SETPGROUP|POSIX_SPAWN_SETSIGDEF);if(error)goto cleanup;
  char *argv[]={"codex","app-server","proxy",NULL};
  error=posix_spawnp(&proxy->pid,argv[0],&actions,&attrs,argv,environ);
cleanup:
  if(have_actions)posix_spawn_file_actions_destroy(&actions);
  if(have_attrs)posix_spawnattr_destroy(&attrs);
  close(input[0]);close(output[1]);
  if(error){close(input[1]);close(output[0]);}
  else {proxy->input=input[1];proxy->output=output[0];}
  return error;
}

static int bc_upgrade(BatonCodexProxy *proxy,char **detail) {
  unsigned char random[16],digest[20];char key[25],expected[29],challenge[61];
  int error=bc_random(random,sizeof(random));if(error)return error;
  bc_base64(random,sizeof(random),key);
  snprintf(challenge,sizeof(challenge),"%s258EAFA5-E914-47DA-95CA-C5AB0DC85B11",key);
  bc_sha1((unsigned char *)challenge,strlen(challenge),digest);bc_base64(digest,sizeof(digest),expected);
  char request[256];int count=snprintf(request,sizeof(request),"GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: %s\r\n\r\n",key);
  error=bc_write(proxy->input,request,(size_t)count);if(error)return error;
  size_t length=0,capacity=256;char *header=malloc(capacity);
  if(!header)return ENOMEM;
  for(;;) {
    if(length+1==capacity) {
      if(capacity>SIZE_MAX/2){error=EOVERFLOW;break;}
      char *next=realloc(header,capacity*=2);if(!next){error=ENOMEM;break;}header=next;
    }
    error=bc_read(proxy->output,header+length,1,NULL);if(error)break;
    length++;
    if(length>=4 && !memcmp(header+length-4,"\r\n\r\n",4))break;
  }
  header[length]=0;
  int accepted=length>=13 && !memcmp(header,"HTTP/1.1 101",12) && (header[12]==' ' || header[12]=='\r');
  int matched=0;char *line=header;
  while(line && *line) {
    char *end=strstr(line,"\r\n");
    if(!strncasecmp(line,"Sec-WebSocket-Accept:",21)) {
      char *value=line+21;while(*value==' ' || *value=='\t')value++;
      size_t size=end?(size_t)(end-value):strlen(value);
      while(size && (value[size-1]==' ' || value[size-1]=='\t'))size--;
      matched=size==strlen(expected) && !memcmp(value,expected,size);
    }
    line=end?end+2:NULL;
  }
  if(error || !accepted || !matched) {
    *detail=bc_hex_detail("Codex proxy WebSocket upgrade response bytes: ",(unsigned char *)header,length);
    if(!error)error=EPROTO;
  } else proxy->upgraded=1;
  free(header);return error;
}

static int bc_read_part(BatonCodexProxy *proxy,void *bytes,size_t length,char **detail) {
  size_t received=0;int error=bc_read(proxy->output,bytes,length,&received);
  if(error)*detail=bc_hex_detail("Codex proxy closed during frame; incomplete bytes: ",bytes,received);
  return error;
}

static int bc_message(BatonCodexProxy *proxy,char **message,size_t *length,char **detail) {
  unsigned char *text=NULL;size_t size=0,capacity=0;int fragmented=0,error=0;
  for(;;) {
    unsigned char header[2],extended[8],mask[4];
    error=bc_read_part(proxy,header,2,detail);if(error)break;
    unsigned opcode=header[0]&15,final=header[0]&128;uint64_t amount=header[1]&127;
    if(amount==126) {
      error=bc_read_part(proxy,extended,2,detail);if(error)break;
      amount=((uint64_t)extended[0]<<8)|extended[1];
    } else if(amount==127) {
      error=bc_read_part(proxy,extended,8,detail);if(error)break;
      amount=0;for(unsigned i=0;i<8;i++)amount=(amount<<8)|extended[i];
      if(extended[0]&128){error=EPROTO;break;}
    }
    if(amount>SIZE_MAX-1){error=EOVERFLOW;break;}
    if(header[1]&128){error=bc_read_part(proxy,mask,4,detail);if(error)break;}
    unsigned char *payload=malloc((size_t)amount+1);if(!payload){error=ENOMEM;break;}
    error=bc_read_part(proxy,payload,(size_t)amount,detail);
    if(error){free(payload);break;}
    if(header[1]&128)for(size_t i=0;i<(size_t)amount;i++)payload[i]^=mask[i%4];
    if((header[0]&0x70) || (opcode>=8 && (!final || amount>125))) {
      *detail=bc_hex_detail("Codex proxy invalid WebSocket frame bytes: ",payload,(size_t)amount);free(payload);error=EPROTO;break;
    }
    if(opcode==8) {
      *detail=bc_hex_detail("Codex proxy WebSocket close bytes: ",payload,(size_t)amount);
      free(payload);error=EPIPE;break;
    }
    if(opcode==9 || opcode==10) {
      if(opcode==9)error=bc_frame(proxy,10,payload,(size_t)amount);
      free(payload);if(error)break;continue;
    }
    if((opcode!=0 && opcode!=1) || (opcode==0 && !fragmented) || (opcode==1 && fragmented)) {
      *detail=bc_hex_detail("Codex proxy non-text or invalid continuation bytes: ",payload,(size_t)amount);free(payload);error=EPROTO;break;
    }
    if(amount>SIZE_MAX-size-1){free(payload);error=EOVERFLOW;break;}
    size_t wanted=size+(size_t)amount+1;
    if(wanted>capacity) {
      size_t grown=capacity?capacity:256;
      while(grown<wanted){if(grown>SIZE_MAX/2){grown=wanted;break;}grown*=2;}
      unsigned char *next=realloc(text,grown);
      if(!next){free(payload);error=ENOMEM;break;}
      text=next;capacity=grown;
    }
    memcpy(text+size,payload,(size_t)amount);size+=(size_t)amount;free(payload);
    if(!final){fragmented=1;continue;}
    if(!bc_utf8(text,size)) {
      *detail=bc_hex_detail("Codex proxy invalid UTF-8 bytes: ",text,size);error=EILSEQ;break;
    }
    text[size]=0;*message=(char *)text;*length=size;return 0;
  }
  free(text);return error;
}

static BatonCodexProxy *bc_acquire(uint32_t handle) {
  pthread_mutex_lock(&baton_codex_registry_lock);
  BatonCodexProxy *proxy=baton_codex_proxies;
  while(proxy && proxy->handle!=handle)proxy=proxy->next;
  if(proxy && !proxy->closing)proxy->references++;else proxy=NULL;
  pthread_mutex_unlock(&baton_codex_registry_lock);return proxy;
}

static void bc_release(BatonCodexProxy *proxy) {
  pthread_mutex_lock(&baton_codex_registry_lock);
  proxy->references--;pthread_cond_broadcast(&baton_codex_registry_changed);
  pthread_mutex_unlock(&baton_codex_registry_lock);
}

static int bc_finish(BatonCodexProxy *proxy,char **status) {
  if(proxy->upgraded)bc_frame(proxy,8,NULL,0);
  pthread_mutex_lock(&proxy->writer);
  if(proxy->input>=0){close(proxy->input);proxy->input=-1;}
  pthread_mutex_unlock(&proxy->writer);
  pthread_mutex_lock(&proxy->reader);
  char buffer[8192];int error=0;
  for(;;) {
    ssize_t count=read(proxy->output,buffer,sizeof(buffer));
    if(count>0)continue;
    if(count<0 && errno==EINTR)continue;
    if(count<0)error=errno;
    break;
  }
  close(proxy->output);proxy->output=-1;pthread_mutex_unlock(&proxy->reader);
  /* Keep the exited child unreaped until signal forwarding stops selecting it. */
  siginfo_t observed;int settled;
  do {settled=waitid(P_PID,(id_t)proxy->pid,&observed,WEXITED|WNOWAIT);}while(settled<0 && errno==EINTR);
  if(settled<0)return errno;
  pthread_mutex_lock(&baton_codex_registry_lock);
  pid_t child=proxy->pid;proxy->pid=0;
  int actual;pid_t waited;
  do {waited=waitpid(child,&actual,0);}while(waited<0 && errno==EINTR);
  pthread_mutex_unlock(&baton_codex_registry_lock);
  if(waited<0)return errno;
  char text[64];
  if(WIFEXITED(actual))snprintf(text,sizeof(text),"exit %d",WEXITSTATUS(actual));
  else if(WIFSIGNALED(actual))snprintf(text,sizeof(text),"signal %d",WTERMSIG(actual));
  else return ECHILD;
  *status=strdup(text);return *status?error:ENOMEM;
}

static void bc_destroy(BatonCodexProxy *proxy) {
  pthread_mutex_destroy(&proxy->reader);pthread_mutex_destroy(&proxy->writer);free(proxy);
}

static void bc_remove(BatonCodexProxy *proxy) {
  pthread_mutex_lock(&baton_codex_lifecycle_lock);
  pthread_mutex_lock(&baton_codex_registry_lock);
  while(proxy->references)pthread_cond_wait(&baton_codex_registry_changed,&baton_codex_registry_lock);
  BatonCodexProxy **link=&baton_codex_proxies;while(*link!=proxy)link=&(*link)->next;*link=proxy->next;
  int empty=baton_codex_proxies==NULL;
  pthread_mutex_unlock(&baton_codex_registry_lock);
  if(empty)bc_signal_stop();
  pthread_mutex_unlock(&baton_codex_lifecycle_lock);bc_destroy(proxy);
}

static void baton_codex_call(BatonCodexCall *call) {
  if(call->kind==BC_OPEN) {
    BatonCodexProxy *proxy=calloc(1,sizeof(*proxy));if(!proxy){call->error=ENOMEM;return;}
    proxy->input=proxy->output=-1;
    int reader=pthread_mutex_init(&proxy->reader,NULL),writer=reader?0:pthread_mutex_init(&proxy->writer,NULL);
    if(reader || writer){if(!reader)pthread_mutex_destroy(&proxy->reader);free(proxy);call->error=reader?reader:writer;return;}
    pthread_mutex_lock(&baton_codex_lifecycle_lock);
    pthread_mutex_lock(&baton_codex_registry_lock);
    if(baton_codex_serial==UINT32_MAX)call->error=EMFILE;
    else call->error=bc_signal_start();
    if(!call->error)call->error=bc_spawn(proxy);
    if(!call->error){proxy->handle=++baton_codex_serial;proxy->next=baton_codex_proxies;baton_codex_proxies=proxy;call->handle=proxy->handle;}
    pthread_mutex_unlock(&baton_codex_registry_lock);
    if(call->error && !baton_codex_proxies)bc_signal_stop();
    pthread_mutex_unlock(&baton_codex_lifecycle_lock);
    if(call->error){bc_destroy(proxy);return;}
    call->error=bc_upgrade(proxy,&call->detail);
    if(call->error){char *status=NULL;bc_finish(proxy,&status);free(status);bc_remove(proxy);}
    return;
  }
  if(call->kind==BC_CLOSE) {
    pthread_mutex_lock(&baton_codex_registry_lock);
    BatonCodexProxy *proxy=baton_codex_proxies;
    while(proxy && proxy->handle!=call->handle)proxy=proxy->next;
    if(!proxy || proxy->closing){pthread_mutex_unlock(&baton_codex_registry_lock);call->error=EBADF;return;}
    proxy->closing=1;pthread_mutex_unlock(&baton_codex_registry_lock);
    call->error=bc_finish(proxy,&call->text);if(call->text)call->length=strlen(call->text);
    bc_remove(proxy);return;
  }
  BatonCodexProxy *proxy=bc_acquire(call->handle);if(!proxy){call->error=EBADF;return;}
  if(call->kind==BC_SEND) {
    if(!bc_utf8((unsigned char *)call->text,call->length))call->error=EILSEQ;
    else call->error=bc_frame(proxy,1,(unsigned char *)call->text,call->length);
  } else if(call->kind==BC_NEXT) {
    pthread_mutex_lock(&proxy->reader);call->error=bc_message(proxy,&call->text,&call->length,&call->detail);pthread_mutex_unlock(&proxy->reader);
  } else if(call->kind==BC_CANCEL) {
    pthread_mutex_lock(&baton_codex_registry_lock);
    if(proxy->pid<=0)call->error=ECHILD;
    else if(kill(-proxy->pid,(int)call->signal))call->error=errno;
    pthread_mutex_unlock(&baton_codex_registry_lock);
  } else call->error=EINVAL;
  bc_release(proxy);
}

#if defined(CID_CODEXPROXY_OPEN) || defined(CID_CODEXPROXY_SEND) || defined(CID_CODEXPROXY_NEXT) || defined(CID_CODEXPROXY_CLOSE) || defined(CID_CODEXPROXY_CANCEL)
static void baton_codex_work(IoWork *work) {baton_codex_call((BatonCodexCall *)work->data);}

static Term baton_codex_pack(Env environment,IoWork *work) {
  BatonCodexCall *call=(BatonCodexCall *)work->data;
  Term value=term_pak(CID_UNIT,0);
  if(!call->error) {
    if(call->kind==BC_OPEN)value=(Term)call->handle;
    else if(call->kind==BC_NEXT || call->kind==BC_CLOSE)value=io_str(environment,call->text,call->length);
  }
  Term result=call->error?io_fail(environment,call->error,call->detail):io_done(environment,value);
  free(call->text);free(call->detail);free(call);work->data=NULL;return result;
}

static Term baton_codex_begin(Env environment,Term *arguments,IoWork *work,int kind) {
  BatonCodexCall *call=calloc(1,sizeof(*call));if(!call)return io_fail(environment,ENOMEM,NULL);
  call->kind=kind;
  if(kind!=BC_OPEN)call->handle=(uint32_t)arguments[0];
  if(kind==BC_SEND){u64 length=0;call->text=io_cstr(environment,arguments[1],&length);call->length=length;}
  if(kind==BC_CANCEL)call->signal=(uint32_t)arguments[1];
  work->data=(char *)call;return io_work(work,baton_codex_work,baton_codex_pack);
}

#define BC_EFFECT(name,id,kind) \
  static Term name##_run(Env e,Term *f,IoWork *w){return baton_codex_begin(e,f,w,kind);} \
  static void __attribute__((constructor)) name##_use(void){io_eff(id,name##_run,0);}
#ifdef CID_CODEXPROXY_OPEN
BC_EFFECT(baton_codex_open,CID_CODEXPROXY_OPEN,BC_OPEN)
#endif
#ifdef CID_CODEXPROXY_SEND
BC_EFFECT(baton_codex_send,CID_CODEXPROXY_SEND,BC_SEND)
#endif
#ifdef CID_CODEXPROXY_NEXT
BC_EFFECT(baton_codex_next,CID_CODEXPROXY_NEXT,BC_NEXT)
#endif
#ifdef CID_CODEXPROXY_CLOSE
BC_EFFECT(baton_codex_close,CID_CODEXPROXY_CLOSE,BC_CLOSE)
#endif
#ifdef CID_CODEXPROXY_CANCEL
BC_EFFECT(baton_codex_cancel,CID_CODEXPROXY_CANCEL,BC_CANCEL)
#endif
#endif
