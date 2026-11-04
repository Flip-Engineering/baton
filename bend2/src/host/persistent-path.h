#ifndef BATON_PERSISTENT_PATH_H
#define BATON_PERSISTENT_PATH_H

/* Paths that Baton records must name persistent storage.

   /run/baton2-native-homelab is a bind mount of the homelab storage. realpath(3)
   resolves symlinks, but it keeps the spelling of a bind mount. A path reached
   through the mount point is therefore returned under /run, and the /run spelling
   stops naming a directory when the mount is absent. The helpers below rewrite
   that prefix after realpath and check the target before the caller stores it. */

#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#define BATON_RUN_PREFIX "/run/baton2-native-homelab"
#define BATON_PERSISTENT_PREFIX "/mnt/nvme4tb/ci-runners/baton2-native-homelab"

/* Returns a new string. The prefix is replaced when path equals from or continues
   with a slash after it. Any other path is copied unchanged. NULL means that
   allocation failed. */
static char *baton_remap_prefix(const char *path,const char *from,const char *to) {
  size_t fn=strlen(from);
  int match=!strncmp(path,from,fn) && (path[fn]=='\0' || path[fn]=='/');
  if(!match) return strdup(path);
  size_t tn=strlen(to),rest=strlen(path)-fn;
  char *out=malloc(tn+rest+1);
  if(out) {memcpy(out,to,tn);memcpy(out+tn,path+fn,rest+1);}
  return out;
}

/* Replaces *path with its persistent spelling when it lies under from. The target
   must exist. When the original spelling also exists, both must name the same file.
   On error *path is unchanged and the return value is an errno code. */
static int baton_remap_resolved(char **path,const char *from,const char *to) {
  char *mapped=baton_remap_prefix(*path,from,to);
  if(!mapped) return ENOMEM;
  if(!strcmp(mapped,*path)) {free(mapped);return 0;}
  struct stat target,original;
  int error=0;
  if(stat(mapped,&target)) error=errno;
  else if(!stat(*path,&original) &&
          (original.st_dev!=target.st_dev || original.st_ino!=target.st_ino)) error=ESTALE;
  if(error) {free(mapped);return error;}
  free(*path);
  *path=mapped;
  return 0;
}

#define BATON_REMAP_RESOLVED(path) baton_remap_resolved((path),BATON_RUN_PREFIX,BATON_PERSISTENT_PREFIX)

#endif
