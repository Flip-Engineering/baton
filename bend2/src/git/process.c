// The C host half of Process.run: spawn one process with an argv built from
// the length-prefixed argument string, answer "exit <n>\n" or "signal <n>\n"
// followed by everything the child wrote to stdout and stderr (the child's
// stderr is duped onto stdout). A spawn or read failure answers io_fail with
// the errno; the blocking spawn and wait run through io_work like
// effs/file_read.c.
//
// Argument encoding: each argv element is its UTF-8 byte length in decimal, a
// colon, then the bytes; "0:" is an empty element. The encoding is
// self-describing and survives any bytes OS argv can carry, including spaces
// and newlines, so no element needs quoting and no shell runs anywhere.
//
// IoWork fields across the park, per the effs/ discipline of raw values only:
// hand = argv vector, text = cwd, data = output buffer, word = capacity,
// size = output length, made = kind * 1000 + status number, code = errno.

#include <errno.h>
#include <spawn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

extern char** environ;

#define GIT_PROC_KIND_EXIT 0
#define GIT_PROC_KIND_SIGNAL 1

static char** git_proc_parse_argv(const char* enc) {
  u32 cap = 8, argc = 0;
  char** argv = malloc(cap * sizeof(char*));
  const char* p = enc;
  while (*p) {
    char* end = NULL;
    unsigned long len = strtoul(p, &end, 10);
    if (end == p || *end != ':') {
      break; // unreachable for Bend-built input; stop rather than overrun
    }
    p = end + 1;
    if (argc + 2 > cap) {
      cap *= 2;
      argv = realloc(argv, cap * sizeof(char*));
    }
    argv[argc] = malloc((size_t)len + 1);
    memcpy(argv[argc], p, len);
    argv[argc][len] = 0;
    argc += 1;
    p += len;
  }
  argv[argc] = NULL;
  return argv;
}

static void git_proc_free_argv(char** argv) {
  for (int i = 0; argv[i]; i += 1) {
    free(argv[i]);
  }
  free(argv);
}

static void git_proc_call(IoWork* w) {
  char** argv = (char**)w->hand;
  char* cwd = w->text;
  int fds[2];
  if (pipe(fds) != 0) {
    w->code = errno;
    return;
  }
  posix_spawn_file_actions_t acts;
  posix_spawn_file_actions_init(&acts);
  posix_spawn_file_actions_addclose(&acts, fds[0]);
  posix_spawn_file_actions_adddup2(&acts, fds[1], 1);
  posix_spawn_file_actions_adddup2(&acts, fds[1], 2);
  posix_spawn_file_actions_addclose(&acts, fds[1]);
  posix_spawn_file_actions_addchdir_np(&acts, cwd);
  pid_t pid = -1;
  int rc = posix_spawnp(&pid, argv[0], &acts, NULL, argv, environ);
  posix_spawn_file_actions_destroy(&acts);
  close(fds[1]);
  if (rc != 0) {
    close(fds[0]);
    w->code = (u32)rc;
    return;
  }
  for (;;) {
    if (w->size == w->word) {
      w->word *= 2;
      w->data = io_mem(realloc(w->data, w->word));
    }
    ssize_t got = read(fds[0], w->data + w->size, w->word - w->size);
    if (got < 0) {
      if (errno == EINTR) {
        continue;
      }
      w->code = errno;
      close(fds[0]);
      return;
    }
    if (got == 0) {
      break;
    }
    w->size += (u32)got;
  }
  close(fds[0]);
  int st = 0;
  if (waitpid(pid, &st, 0) < 0) {
    w->code = errno;
    return;
  }
  if (WIFEXITED(st)) {
    w->made = GIT_PROC_KIND_EXIT * 1000 + WEXITSTATUS(st);
  } else if (WIFSIGNALED(st)) {
    w->made = GIT_PROC_KIND_SIGNAL * 1000 + WTERMSIG(st);
  } else {
    w->made = GIT_PROC_KIND_SIGNAL * 1000 + 127;
  }
}

static Term git_proc_pack(Env e, IoWork* w) {
  Term r;
  if (w->code) {
    r = io_fail(e, w->code, NULL);
  } else {
    int kind = (int)(w->made / 1000);
    int num = (int)(w->made % 1000);
    char head[20];
    int hn = snprintf(head, sizeof(head),
      kind == GIT_PROC_KIND_EXIT ? "exit %d\n" : "signal %d\n", num);
    char* out = malloc((u64)hn + w->size);
    memcpy(out, head, (u64)hn);
    memcpy(out + hn, w->data, w->size);
    r = io_done(e, io_str(e, out, hn + w->size));
    free(out);
  }
  git_proc_free_argv((char**)w->hand);
  free(w->text);
  free(w->data);
  return r;
}

#ifdef CID_PROCESS_RUN

Term process_run_run(Env e, Term* f, IoWork* w) {
  u64 alen = 0, clen = 0;
  char* enc = io_cstr(e, f[0], &alen);
  w->hand = (intptr_t)git_proc_parse_argv(enc);
  free(enc);
  w->text = io_cstr(e, f[1], &clen); // freed in pack
  w->word = 65536;
  w->size = 0;
  w->data = io_mem(malloc(w->word));
  w->made = 0;
  w->code = 0;
  return io_work(w, git_proc_call, git_proc_pack);
}

static void __attribute__((constructor)) process_run_use(void) {
  io_eff(CID_PROCESS_RUN, process_run_run, 0);
}

#endif
