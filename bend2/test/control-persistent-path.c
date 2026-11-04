/* Focused checks for the persistent path rule in bend2/src/host/persistent-path.h.

   usage: control-persistent-path FIXTURE

   The fixture holds one "input|expected" pair per line. The scratch cases create
   directories under /tmp and inject the prefix pair, so no bind mount is needed.
   Exit status 0 means that every check passed. */

#define _XOPEN_SOURCE 700

#include <errno.h>
#include <ftw.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include "../src/host/persistent-path.h"

static int failures=0,checks=0;

static void expect_text(const char *label,const char *got,const char *want) {
  checks++;
  if(!got || strcmp(got,want)) {
    failures++;
    fprintf(stderr,"FAIL %s: got %s, want %s\n",label,got?got:"(null)",want);
  }
}

static void expect_error(const char *label,int got,int want) {
  checks++;
  if(got!=want) {
    failures++;
    fprintf(stderr,"FAIL %s: error %d, want %d\n",label,got,want);
  }
}

static int fixture_vectors(const char *fixture) {
  FILE *file=fopen(fixture,"r");
  if(!file) {perror(fixture);return 1;}
  char line[PATH_MAX*2];
  while(fgets(line,sizeof line,file)) {
    if(line[0]=='#' || line[0]=='\n') continue;
    line[strcspn(line,"\n")]=0;
    char *bar=strchr(line,'|');
    if(!bar) {failures++;fprintf(stderr,"malformed fixture line: %s\n",line);continue;}
    *bar=0;
    char *got=baton_remap_prefix(line,BATON_RUN_PREFIX,BATON_PERSISTENT_PREFIX);
    expect_text(line,got,bar+1);
    free(got);
  }
  fclose(file);
  return 0;
}

static void write_file(const char *path,const char *text) {
  FILE *file=fopen(path,"w");
  if(!file) {perror(path);failures++;return;}
  fputs(text,file);
  fclose(file);
}

static void make_dir(const char *path) {
  if(mkdir(path,0700)) {perror(path);failures++;}
}

static int remove_entry(const char *path,const struct stat *info,int flag,struct FTW *ftw) {
  (void)info;(void)flag;(void)ftw;
  return remove(path);
}

static void scratch_cases(void) {
  char template[]="/tmp/baton-972-XXXXXX";
  if(!mkdtemp(template)) {perror("mkdtemp");failures++;return;}
  char *root=realpath(template,NULL);
  if(!root) {perror("realpath");failures++;return;}

  char run[PATH_MAX],persist[PATH_MAX],source[PATH_MAX],link_path[PATH_MAX],text[PATH_MAX];
  snprintf(run,sizeof run,"%s/run",root);
  snprintf(persist,sizeof persist,"%s/persist",root);

  /* The run tree stands in for the mount point. A hard link gives the same inode
     under both spellings, as a bind mount does. */
  make_dir(run);
  make_dir(persist);
  snprintf(text,sizeof text,"%s/persist/codex-release",root);
  make_dir(text);
  snprintf(text,sizeof text,"%s/persist/codex-release/codex",root);
  write_file(text,"codex\n");
  snprintf(source,sizeof source,"%s/run/codex-release",root);
  make_dir(source);
  snprintf(source,sizeof source,"%s/run/codex-release/codex",root);
  if(link(text,source)) {perror("link");failures++;}

  /* The bin link points at the run spelling, as an installed command link does. */
  snprintf(link_path,sizeof link_path,"%s/bin",root);
  make_dir(link_path);
  snprintf(link_path,sizeof link_path,"%s/bin/codex",root);
  if(symlink(source,link_path)) {perror("symlink");failures++;}

  /* Two different files, one under each spelling. */
  snprintf(text,sizeof text,"%s/run/diverged",root);
  make_dir(text);
  snprintf(text,sizeof text,"%s/run/diverged/file",root);
  write_file(text,"run\n");
  snprintf(text,sizeof text,"%s/persist/diverged",root);
  make_dir(text);
  snprintf(text,sizeof text,"%s/persist/diverged/file",root);
  write_file(text,"persist\n");

  snprintf(text,sizeof text,"%s/run/gone",root);
  make_dir(text);
  snprintf(text,sizeof text,"%s/run/gone/file",root);
  write_file(text,"gone\n");

  snprintf(text,sizeof text,"%s/persist/only-persist",root);
  make_dir(text);
  snprintf(text,sizeof text,"%s/persist/only-persist/file",root);
  write_file(text,"only\n");

  /* 1. A path under run with a matching persistent file is rewritten. */
  char *path=strdup(source);
  int error=baton_remap_resolved(&path,run,persist);
  snprintf(text,sizeof text,"%s/persist/codex-release/codex",root);
  expect_error("matching inode: error",error,0);
  expect_text("matching inode: path",path,text);
  free(path);

  /* 2. A symlink into run is resolved first and then rewritten. */
  char *resolved=realpath(link_path,NULL);
  if(!resolved) {perror("realpath link");failures++;}
  else {
    error=baton_remap_resolved(&resolved,run,persist);
    expect_error("symlink: error",error,0);
    expect_text("symlink: path",resolved,text);
    free(resolved);
  }

  /* 3. A missing persistent target is refused and the path is unchanged. */
  snprintf(text,sizeof text,"%s/run/gone/file",root);
  path=strdup(text);
  error=baton_remap_resolved(&path,run,persist);
  expect_error("missing target: error",error,ENOENT);
  expect_text("missing target: path",path,text);
  free(path);

  /* 4. Two different files under the two spellings are refused. */
  snprintf(text,sizeof text,"%s/run/diverged/file",root);
  path=strdup(text);
  error=baton_remap_resolved(&path,run,persist);
  expect_error("different inode: error",error,ESTALE);
  expect_text("different inode: path",path,text);
  free(path);

  /* 5. Without a run spelling on disk, the persistent target alone is checked. */
  snprintf(text,sizeof text,"%s/run/only-persist/file",root);
  path=strdup(text);
  error=baton_remap_resolved(&path,run,persist);
  snprintf(text,sizeof text,"%s/persist/only-persist/file",root);
  expect_error("absent run spelling: error",error,0);
  expect_text("absent run spelling: path",path,text);
  free(path);

  nftw(root,remove_entry,16,FTW_DEPTH|FTW_PHYS);
  free(root);
}

int main(int argc,char **argv) {
  if(argc!=2) {fprintf(stderr,"usage: control-persistent-path FIXTURE\n");return 2;}
  if(fixture_vectors(argv[1])) return 1;
  scratch_cases();
  if(failures) {
    fprintf(stderr,"%d of %d checks failed\n",failures,checks);
    return 1;
  }
  printf("persistent-path: %d checks passed\n",checks);
  return 0;
}
