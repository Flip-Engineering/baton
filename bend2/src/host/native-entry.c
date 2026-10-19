#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <unistd.h>
#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif

int baton2_runtime_main(int argc, char **argv);

static char *application_executable(void) {
#ifdef __APPLE__
  uint32_t size=0;
  _NSGetExecutablePath(NULL,&size);
  char *path=malloc(size);
  if(!path) return NULL;
  if(_NSGetExecutablePath(path,&size)) {free(path);return NULL;}
  char *resolved=realpath(path,NULL);
  free(path);return resolved;
#else
  return realpath("/proc/self/exe",NULL);
#endif
}

static int settings_entry(int argc,char **argv) {
  if(argc<2 || strcmp(argv[1],"--project-settings")) return -1;
  if(argc!=3) {
    fputs("baton2: expected --project-settings PATH.\n",stderr);
    return 1;
  }
  char *executable=application_executable();
  char *directory=executable?strdup(executable):NULL;
  char *slash=directory?strrchr(directory,'/'):NULL;
  if(!slash) {free(directory);free(executable);perror("baton2 settings executable");return 1;}
  *slash=0;
  const char *suffixes[]={"/../libexec/baton2/project-settings.mjs","/../../bend2/harness/project-settings.mjs"};
  char *helper=NULL;
  for(size_t i=0;i<sizeof(suffixes)/sizeof(suffixes[0]);i++) {
    size_t size=strlen(directory)+strlen(suffixes[i])+1;
    char *candidate=malloc(size);
    if(!candidate) break;
    snprintf(candidate,size,"%s%s",directory,suffixes[i]);
    helper=realpath(candidate,NULL);free(candidate);
    if(helper) break;
  }
  free(directory);free(executable);
  if(!helper) {
    fputs("baton2: project-settings.mjs is missing from this installation. Install the complete Baton package.\n",stderr);
    return 2;
  }
  char *args[]={"node",helper,"--inspect",argv[2],NULL};
  execvp(args[0],args);
  perror("baton2 settings: Node could not execute the installed settings operation");
  free(helper);return 1;
}

static int dispatch_verb(const char *value) {
  return !strcmp(value,"dispatch") || !strcmp(value,"task");
}

static int contextual_dispatch_args(int argc,char **argv,int first) {
  const char *values[]={"--text","--file","--project","--session","--to",
    "--route","--harness","--command","--model","--effort","--workspace",
    "--output-log","--dispatch-id","--task-id","--sender"};
  for(int i=first;i<argc;i++) {
    if(!strcmp(argv[i],"--")) return 0;
    if(!strcmp(argv[i],"--id") || !strcmp(argv[i],"--kind")) return 1;
    for(size_t j=0;j<sizeof(values)/sizeof(values[0]);j++) {
      if(!strcmp(argv[i],values[j])) {if(i+1<argc)i++;break;}
    }
  }
  return 0;
}

static int executable_at(const char *path) {
  return path && path[0] && access(path,X_OK)==0;
}

/* The installed package can carry a Node executable beside the router or the
   bundled Bun runtime below libexec. BATON2_NODE selects an absolute runtime
   explicitly. The PATH lookup remains the final fallback. */
static char *dispatch_runtime(void) {
  const char *configured=getenv("BATON2_NODE");
  if(configured && configured[0]=='/' && executable_at(configured))
    return strdup(configured);
  char *executable=application_executable();
  char *directory=executable?strdup(executable):NULL;
  char *slash=directory?strrchr(directory,'/'):NULL;
  if(slash) {
    *slash=0;
    const char *suffixes[]={"/node","/../libexec/baton2/repl/bun",
      "/../libexec/baton2/node",NULL};
    for(size_t i=0;suffixes[i];i++) {
      size_t size=strlen(directory)+strlen(suffixes[i])+1;
      char *candidate=malloc(size);
      if(!candidate) break;
      snprintf(candidate,size,"%s%s",directory,suffixes[i]);
      char *resolved=realpath(candidate,NULL);
      free(candidate);
      if(resolved && executable_at(resolved)) {
        free(directory);free(executable);
        return resolved;
      }
      free(resolved);
    }
  }
  free(directory);free(executable);
  return strdup("node");
}

/* The dispatch frontend reads complete input and calls the native setup and
   admission operations. exec preserves its stdin, stdout and exit status. */
static int dispatch_entry(int argc,char **argv) {
  int first=0;
  const char *verb=NULL;
  const char *database="",*project=NULL;
  if(argc>1 && (!strcmp(argv[1],"help") || !strcmp(argv[1],"--help") ||
                !strcmp(argv[1],"-h"))) return -1;
  if(argc>1 && dispatch_verb(argv[1])) {verb=argv[1];first=2;}
  else if(argc>3 && !strcmp(argv[1],"--project") && dispatch_verb(argv[3])) {
    verb=argv[3];project=argv[2];first=4;
  } else if(argc>2 && strcmp(argv[1],"--project") && dispatch_verb(argv[2])) {
    verb=argv[2];database=argv[1];first=3;
  }
  if(!first) return -1;
  if(!strcmp(verb,"dispatch") && contextual_dispatch_args(argc,argv,first)) return -1;
  char *executable=application_executable();
  char *directory=executable?strdup(executable):NULL;
  char *slash=directory?strrchr(directory,'/'):NULL;
  if(!slash) {free(directory);free(executable);perror("baton dispatch executable");return 1;}
  *slash=0;
  const char *suffixes[]={"/../libexec/baton2/task-start.mjs","/../../bend2/harness/task-start.mjs"};
  char *helper=NULL;
  for(size_t i=0;i<sizeof(suffixes)/sizeof(suffixes[0]);i++) {
    size_t size=strlen(directory)+strlen(suffixes[i])+1;
    char *candidate=malloc(size);
    if(!candidate) break;
    snprintf(candidate,size,"%s%s",directory,suffixes[i]);
    helper=realpath(candidate,NULL);free(candidate);
    if(helper) break;
  }
  free(directory);
  if(!helper) {
    fputs("baton dispatch: task-start.mjs is missing from this installation. Install the complete Baton package.\n",stderr);
    free(executable);return 2;
  }
  char **args=calloc((size_t)argc+9,sizeof(*args));
  if(!args) {free(helper);free(executable);perror("baton dispatch arguments");return 1;}
  char *runtime=dispatch_runtime();
  if(!runtime) {free(args);free(helper);free(executable);perror("baton dispatch runtime");return 1;}
  int count=0;
  args[count++]=runtime;args[count++]=helper;
  args[count++]="--baton2";args[count++]=executable;
  args[count++]="--database";args[count++]=(char *)database;
  if(project) {args[count++]="--project";args[count++]=(char *)project;}
  for(int i=first;i<argc;i++) args[count++]=argv[i];
  execvp(args[0],args);
  perror("baton dispatch: dispatch runtime could not execute the installed dispatch operation");
  free(args);free(helper);free(executable);free(runtime);return 1;
}

#if defined(BATON2_RECEIVE_FOCUSED) || defined(BATON2_NATIVE_RECEIVER_ROUTER) || defined(BATON2_RECOVERY_HELPER)
static int native_help_request(int argc,char **argv) {
  return argc>1 && (!strcmp(argv[1],"help") || !strcmp(argv[1],"--help") || !strcmp(argv[1],"-h"));
}
#endif

#ifdef BATON2_RECEIVE_FOCUSED
/* The focused executable owns receiver operations and exposes the same path
   to native workers. All general Baton actions use the sibling full CLI. */
static int focused_receiver_verb(int argc,char **argv) {
  if(argc<2 || native_help_request(argc,argv)) return 0;
  const char *first=argv[1];
  if(!strcmp(first,"--dispatch-message") || !strcmp(first,"--host-process-keeper") ||
     !strcmp(first,"--instance-owner") || !strcmp(first,"--instance-shutdown")) return 1;
  if(argc>2 && (!strcmp(argv[2],"receive") || !strcmp(argv[2],"turn") ||
                !strcmp(argv[2],"turn-text") || !strcmp(argv[2],"agent-native-input") ||
                !strcmp(argv[2],"register-receiver") || !strcmp(argv[2],"storage-policy") ||
                !strcmp(argv[2],"storage-preview") || !strcmp(argv[2],"storage-apply"))) return 1;
  return 0;
}

#endif

#ifdef BATON2_NATIVE_RECEIVER_ROUTER
static int native_receiver_route(int argc, char **argv) {
  if(native_help_request(argc,argv)) return -1;
  int native_input=argc>2 && !strcmp(argv[2],"agent-native-input");
  int recovery=(argc>1 && (!strcmp(argv[1],"--recover-observer") ||
                           !strcmp(argv[1],"--recover-receive"))) ||
               (argc>2 && !strcmp(argv[2],"recover-observer"));
  int focused_verb=argc>1 && (!strcmp(argv[1],"--dispatch-message") ||
    !strcmp(argv[1],"--host-process-keeper") || !strcmp(argv[1],"--instance-owner") ||
    !strcmp(argv[1],"--instance-shutdown") || recovery);
  if(argc>2 && (!strcmp(argv[2],"receive") || !strcmp(argv[2],"turn") ||
      !strcmp(argv[2],"turn-text") || !strcmp(argv[2],"recover-observer") ||
      !strcmp(argv[2],"register-receiver") || !strcmp(argv[2],"storage-policy") ||
      !strcmp(argv[2],"storage-preview") || !strcmp(argv[2],"storage-apply"))) focused_verb=1;
  if(!native_input && !focused_verb) return -1;
  char *full=application_executable();
  char *directory=full?strdup(full):NULL;
  char *slash=directory?strrchr(directory,'/'):NULL;
  if(!slash) {free(directory);free(full);perror("baton receiver router");return 78;}
  *slash=0;
  const char *name=recovery?"/baton-recovery":"/baton";
  size_t size=strlen(directory)+strlen(name)+1;
  char *candidate=malloc(size);
  if(!candidate) {free(directory);free(full);perror("baton receiver path");return 1;}
  snprintf(candidate,size,"%s%s",directory,name);
  char *focused=realpath(candidate,NULL);
  free(candidate);free(directory);
  if(!focused || access(focused,X_OK)) {
    fputs(recovery ? "baton: recovery helper is missing or not executable. Install the complete Baton package.\n"
                    : "baton: focused receiver is missing or not executable. Install the complete Baton package.\n",stderr);
    free(focused);free(full);return 78;
  }
  char **next=calloc((size_t)argc+2,sizeof(*next));
  if(!next) {free(focused);free(full);perror("baton receiver arguments");return 1;}
  next[0]=focused;
  int count=1;
  if(native_input) {
    next[count++]=argv[1];
    next[count++]=argv[2];
    next[count++]=full;
    for(int i=3;i<argc;i++) next[count++]=argv[i];
  } else {
    for(int i=1;i<argc;i++) next[count++]=argv[i];
  }
  execv(focused,next);
  perror("baton: focused receiver could not execute");
  free(next);free(focused);free(full);return 1;
}
#endif

#if defined(BATON2_RECEIVE_FOCUSED) || defined(BATON2_RECOVERY_HELPER)
static int delegate_sibling_cli(char **argv,const char *name,const char *role) {
  char *executable=application_executable();
  char *directory=executable?strdup(executable):NULL;
  char *slash=directory?strrchr(directory,'/'):NULL;
  if(!slash) {
    free(directory);free(executable);
    fputs("baton: cannot locate the focused installation directory.\n",stderr);
    return 78;
  }
  *slash=0;
  size_t size=strlen(directory)+strlen(name)+2;
  char *candidate=malloc(size);
  if(!candidate) {
    free(directory);free(executable);
    perror("baton: full CLI path");
    return 1;
  }
  snprintf(candidate,size,"%s/%s",directory,name);
  char *full=realpath(candidate,NULL);
  free(candidate);free(directory);free(executable);
  if(!full || access(full,X_OK)) {
    if(!strcmp(role,"full CLI"))
      fputs("baton: sibling baton-full is missing or not executable. Install the complete Baton package.\n",stderr);
    else
      fputs("baton: sibling baton-recovery is missing or not executable. Install the complete Baton package.\n",stderr);
    free(full);return 78;
  }
  argv[0]=full;
  execv(full,argv);
  if(!strcmp(role,"full CLI"))perror("baton: full CLI could not execute");
  else perror("baton: recovery helper could not execute");
  free(full);return 1;
}

static int delegate_full_cli(char **argv) {
  return delegate_sibling_cli(argv,"baton-full","full CLI");
}
#endif

#ifdef BATON2_RECEIVE_FOCUSED
static int focused_recovery_route(int argc,char **argv) {
  int recovery=(argc>1 && (!strcmp(argv[1],"--recover-observer") ||
                           !strcmp(argv[1],"--recover-receive"))) ||
               (argc>2 && !strcmp(argv[2],"recover-observer"));
  if(!recovery) return -1;
  return delegate_sibling_cli(argv,"baton-recovery","recovery helper");
}
#endif

#ifdef BATON2_RECOVERY_HELPER
static int recovery_helper_verb(int argc,char **argv) {
  if(argc<2 || native_help_request(argc,argv)) return 0;
  if(!strcmp(argv[1],"--recover-observer") || !strcmp(argv[1],"--recover-receive") ||
     !strcmp(argv[1],"--host-process-keeper") || !strcmp(argv[1],"--instance-owner") ||
     !strcmp(argv[1],"--instance-shutdown")) return 1;
  return argc>2 && !strcmp(argv[2],"recover-observer");
}
#endif

/* Pass the complete application argv through the runtime's argument boundary. */
int main(int argc, char **argv) {
  if (argc < 1 || argc == INT_MAX ||
      (size_t)argc > SIZE_MAX / sizeof(char *) - 2) {
    fputs("baton2: invalid native argument count.\n", stderr);
    return 1;
  }
#ifdef BATON2_RECOVERY_HELPER
  /* Keep this executable limited to retained-receive recovery. */
  if(!recovery_helper_verb(argc,argv)) return delegate_full_cli(argv);
#endif
  int settings=settings_entry(argc,argv);
  if(settings>=0) return settings;
#ifdef BATON2_RECEIVE_FOCUSED
  int recovery_route=focused_recovery_route(argc,argv);
  if(recovery_route>=0) return recovery_route;
#endif
  int dispatch=dispatch_entry(argc,argv);
  if(dispatch>=0) return dispatch;
#ifdef BATON2_NATIVE_RECEIVER_ROUTER
  int receiver_route=native_receiver_route(argc,argv);
  if(receiver_route>=0) return receiver_route;
#endif
#ifdef BATON2_RECEIVE_FOCUSED
  /* Native task bootstrap enters through the canonical full CLI once so its
     router can append the trusted executable identity expected by Bend. */
  if(argc==3 && !strcmp(argv[2],"agent-native-input")) return delegate_full_cli(argv);
  if(!focused_receiver_verb(argc,argv)) return delegate_full_cli(argv);
#endif
#ifdef BATON2_RECOVERY_HELPER_LEGACY_13_ARG
  /* The retained recovery C predates the optional input-tail argument. The
     recovery function reads owed inputs from the session database, so omit
     only that final host ABI value when reusing this exact 13-argument C. */
  int runtime_argc=argc;
  if(argc==15 && !strcmp(argv[1],"--recover-receive")) runtime_argc=14;
#else
  int runtime_argc=argc;
#endif
  char **application = calloc((size_t)runtime_argc + 2, sizeof(*application));
  if (!application) {
    fputs("baton2: cannot allocate native arguments.\n", stderr);
    return 1;
  }
  application[0] = argv[0];
  application[1] = "--";
  for (int i = 1; i < runtime_argc; i++) application[i + 1] = argv[i];
  int status = baton2_runtime_main(runtime_argc + 1, application);
  free(application);
  return status;
}
