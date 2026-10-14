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

/* The task frontend reads complete input and calls the native setup and
   admission operations. exec preserves its stdin, stdout and exit status. */
static int task_entry(int argc,char **argv) {
  int first=0;
  const char *database="",*project=NULL;
  if(argc>1 && !strcmp(argv[1],"task")) first=2;
  else if(argc>3 && !strcmp(argv[1],"--project") && !strcmp(argv[3],"task")) {
    project=argv[2];first=4;
  } else if(argc>2 && strcmp(argv[1],"--project") && !strcmp(argv[2],"task")) {
    database=argv[1];first=3;
  }
  if(!first) return -1;
  char *executable=application_executable();
  char *directory=executable?strdup(executable):NULL;
  char *slash=directory?strrchr(directory,'/'):NULL;
  if(!slash) {free(directory);free(executable);perror("baton2 task executable");return 1;}
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
    fputs("baton2 task: task-start.mjs is missing from this installation. Install the complete Baton package.\n",stderr);
    free(executable);return 2;
  }
  char **args=calloc((size_t)argc+9,sizeof(*args));
  if(!args) {free(helper);free(executable);perror("baton2 task arguments");return 1;}
  int count=0;
  args[count++]="node";args[count++]=helper;
  args[count++]="--baton2";args[count++]=executable;
  args[count++]="--database";args[count++]=(char *)database;
  if(project) {args[count++]="--project";args[count++]=(char *)project;}
  for(int i=first;i<argc;i++) args[count++]=argv[i];
  execvp(args[0],args);
  perror("baton2 task: Node could not execute the installed task operation");
  free(args);free(helper);free(executable);return 1;
}

/* Pass the complete application argv through the runtime's argument boundary. */
int main(int argc, char **argv) {
  if (argc < 1 || argc == INT_MAX ||
      (size_t)argc > SIZE_MAX / sizeof(char *) - 2) {
    fputs("baton2: invalid native argument count.\n", stderr);
    return 1;
  }
  int task=task_entry(argc,argv);
  if(task>=0) return task;
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
