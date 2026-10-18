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

/* The dispatch frontend reads complete input and calls the native setup and
   admission operations. exec preserves its stdin, stdout and exit status. */
static int dispatch_entry(int argc,char **argv) {
  int first=0;
  const char *verb=NULL;
  const char *database="",*project=NULL;
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
  int count=0;
  args[count++]="node";args[count++]=helper;
  args[count++]="--baton2";args[count++]=executable;
  args[count++]="--database";args[count++]=(char *)database;
  if(project) {args[count++]="--project";args[count++]=(char *)project;}
  for(int i=first;i<argc;i++) args[count++]=argv[i];
  execvp(args[0],args);
  perror("baton dispatch: Node could not execute the installed dispatch operation");
  free(args);free(helper);free(executable);return 1;
}

#ifdef BATON2_RECEIVE_FOCUSED
/* The focused executable owns receiver operations and exposes the same path
   to native workers. All general Baton actions use the sibling full CLI. */
static int focused_receiver_verb(int argc,char **argv) {
  if(argc<2) return 0;
  const char *first=argv[1];
  if(!strcmp(first,"--dispatch-message") || !strcmp(first,"--host-process-keeper") ||
     !strcmp(first,"--instance-owner") || !strcmp(first,"--instance-shutdown") ||
     !strcmp(first,"--recover-observer") || !strcmp(first,"--recover-receive")) return 1;
  if(argc>2 && (!strcmp(argv[2],"receive") || !strcmp(argv[2],"turn") ||
                !strcmp(argv[2],"recover-observer"))) return 1;
  return 0;
}

static int focused_receiver_registration(int argc,char **argv) {
  if(argc>2 && !strcmp(argv[2],"receiver")) return 1;
  return argc>3 && !strcmp(argv[1],"--database") && !strcmp(argv[3],"receiver");
}

static int delegate_receiver_registration(int argc,char **argv) {
  char *facade=application_executable();
  char *directory=facade?strdup(facade):NULL;
  char *slash=directory?strrchr(directory,'/'):NULL;
  if(!slash) {
    free(directory);free(facade);
    fputs("baton: cannot locate the focused installation directory.\n",stderr);
    return 78;
  }
  *slash=0;
  size_t size=strlen(directory)+sizeof("/baton-register");
  char *candidate=malloc(size);
  if(!candidate) {
    free(directory);free(facade);
    perror("baton: receiver registrar path");
    return 1;
  }
  snprintf(candidate,size,"%s/baton-register",directory);
  char *registrar=realpath(candidate,NULL);
  free(candidate);free(directory);
  if(!registrar || access(registrar,X_OK)) {
    fputs("baton: sibling receiver registrar is missing or not executable. Install the complete Baton package.\n",stderr);
    free(registrar);free(facade);return 78;
  }
  char **next=calloc((size_t)argc+2,sizeof(*next));
  if(!next) {
    free(registrar);free(facade);
    perror("baton: receiver registrar arguments");
    return 1;
  }
  next[0]=registrar;
  next[1]=facade;
  for(int i=1;i<argc;i++) next[i+1]=argv[i];
  execv(registrar,next);
  perror("baton: receiver registrar could not execute");
  free(next);free(registrar);free(facade);return 1;
}

static int delegate_full_cli(char **argv) {
  char *executable=application_executable();
  char *directory=executable?strdup(executable):NULL;
  char *slash=directory?strrchr(directory,'/'):NULL;
  if(!slash) {
    free(directory);free(executable);
    fputs("baton: cannot locate the focused installation directory.\n",stderr);
    return 78;
  }
  *slash=0;
  size_t size=strlen(directory)+sizeof("/baton-full");
  char *candidate=malloc(size);
  if(!candidate) {
    free(directory);free(executable);
    perror("baton: full CLI path");
    return 1;
  }
  snprintf(candidate,size,"%s/baton-full",directory);
  char *full=realpath(candidate,NULL);
  free(candidate);free(directory);free(executable);
  if(!full || access(full,X_OK)) {
    fputs("baton: sibling baton-full is missing or not executable. Install the complete Baton package.\n",stderr);
    free(full);return 78;
  }
  argv[0]=full;
  execv(full,argv);
  perror("baton: full CLI could not execute");
  free(full);return 1;
}
#endif

/* Pass the complete application argv through the runtime's argument boundary. */
int main(int argc, char **argv) {
  if (argc < 1 || argc == INT_MAX ||
      (size_t)argc > SIZE_MAX / sizeof(char *) - 2) {
    fputs("baton2: invalid native argument count.\n", stderr);
    return 1;
  }
  int settings=settings_entry(argc,argv);
  if(settings>=0) return settings;
  int dispatch=dispatch_entry(argc,argv);
  if(dispatch>=0) return dispatch;
#ifdef BATON2_RECEIVE_FOCUSED
  if(focused_receiver_registration(argc,argv)) return delegate_receiver_registration(argc,argv);
  if(!focused_receiver_verb(argc,argv)) return delegate_full_cli(argv);
#endif
  char **application = calloc((size_t)argc + 2, sizeof(*application));
  if (!application) {
    fputs("baton2: cannot allocate native arguments.\n", stderr);
    return 1;
  }
  application[0] = argv[0];
  application[1] = "--";
  for (int i = 1; i < argc; i++) application[i + 1] = argv[i];
  int status = baton2_runtime_main(argc + 1, application);
  free(application);
  return status;
}
