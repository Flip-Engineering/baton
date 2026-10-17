// The generic exec effect: spawn one process with an argv built from the
// length-prefixed argument string, capture stdout, and answer "exit <n>\n"
// or "signal <n>\n" followed by everything the child wrote to stdout.
// Exec.run lets the child inherit stderr; Exec.run_capture writes the
// child's stderr to a caller-named path, truncated before the child
// starts, so the delivery contract can record it verbatim. The env delta
// crosses as the NUL-separated entries env-delta.h defines: NAME=VALUE
// sets or overrides, a bare NAME removes, empty inherits all.
//
// Argument encoding: each argv element is its UTF-8 byte length in
// decimal, a colon, then the bytes; "0:" is an empty element. The
// encoding is self-describing and survives any bytes OS argv can carry,
// so no element needs quoting and no shell runs anywhere.
//
// IoWork fields across the park, per the effs/ discipline of raw values
// only: hand = argv vector, text = cwd, data = output buffer,
// word = capacity, size = output length, made = envp context during the
// call, then kind * 1000 + status number, code = errno.

#include <errno.h>
#include <fcntl.h>
#include <spawn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

extern char** environ;
#include "env-delta.h"

#define EXEC_KIND_EXIT 0
#define EXEC_KIND_SIGNAL 1

static char** exec_parse_argv(const char* enc) {
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

static void exec_free_argv(char** argv) {
  for (int i = 0; argv[i]; i += 1) {
    free(argv[i]);
  }
  free(argv);
}

typedef struct {
  char** envp;
  char** built;
  size_t built_count;
  char* capture_path; // owned; set only for the capture variant
} ExecEnv;

static void exec_env_free(ExecEnv* ctx) {
  if (ctx) {
    baton_envp_free(ctx->envp, ctx->built, ctx->built_count);
    free(ctx->capture_path);
    free(ctx);
  }
}

static void exec_call(IoWork* w) {
  ExecEnv* ctx = (ExecEnv*)(uintptr_t)w->made;
  char** envp = ctx && ctx->envp ? ctx->envp : environ;
  char** argv = (char**)w->hand;
  char* cwd = w->text;
  u64 status = 0;
  int fds[2] = {-1, -1};
  int err = -1;
  if (pipe(fds) != 0) {
    w->code = errno;
    goto done;
  }
  if (ctx && ctx->capture_path) {
    err = open(ctx->capture_path,
               O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
    if (err < 0) {
      w->code = errno;
      goto done;
    }
  }
  posix_spawn_file_actions_t acts;
  posix_spawn_file_actions_init(&acts);
  posix_spawn_file_actions_addclose(&acts, fds[0]);
  posix_spawn_file_actions_adddup2(&acts, fds[1], 1);
  posix_spawn_file_actions_addclose(&acts, fds[1]);
  if (err >= 0) {
    posix_spawn_file_actions_adddup2(&acts, err, 2);
  }
  posix_spawn_file_actions_addchdir_np(&acts, cwd);
  pid_t pid = -1;
  int rc = posix_spawnp(&pid, argv[0], &acts, NULL, argv, envp);
  posix_spawn_file_actions_destroy(&acts);
  close(fds[1]);
  fds[1] = -1;
  if (err >= 0) {
    close(err);
    err = -1;
  }
  if (rc != 0) {
    w->code = (u32)rc;
    goto done;
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
      goto done;
    }
    if (got == 0) {
      break;
    }
    w->size += (u32)got;
  }
  close(fds[0]);
  fds[0] = -1;
  int st = 0;
  if (waitpid(pid, &st, 0) < 0) {
    w->code = errno;
    goto done;
  }
  if (WIFEXITED(st)) {
    status = (u64)(EXEC_KIND_EXIT * 1000 + WEXITSTATUS(st));
  } else if (WIFSIGNALED(st)) {
    status = (u64)(EXEC_KIND_SIGNAL * 1000 + WTERMSIG(st));
  } else {
    status = (u64)(EXEC_KIND_SIGNAL * 1000 + 127);
  }
done:
  exec_env_free(ctx);
  if (fds[0] >= 0) close(fds[0]);
  if (fds[1] >= 0) close(fds[1]);
  if (err >= 0) close(err);
  w->made = status;
}

static Term exec_pack(Env e, IoWork* w) {
  Term r;
  if (w->code) {
    r = io_fail(e, w->code, NULL);
  } else {
    int kind = (int)(w->made / 1000);
    int num = (int)(w->made % 1000);
    char head[20];
    int hn = snprintf(head, sizeof(head),
      kind == EXEC_KIND_EXIT ? "exit %d\n" : "signal %d\n", num);
    char* out = malloc((u64)hn + w->size);
    memcpy(out, head, (u64)hn);
    memcpy(out + hn, w->data, w->size);
    r = io_done(e, io_str(e, out, hn + w->size));
    free(out);
  }
  exec_free_argv((char**)w->hand);
  free(w->text);
  free(w->data);
  return r;
}

static Term exec_begin(Env e, Term* f, IoWork* w, int capture) {
  u64 alen = 0, clen = 0, elen = 0;
  char* enc = io_cstr(e, f[0], &alen);
  w->hand = (intptr_t)exec_parse_argv(enc);
  free(enc);
  w->text = io_cstr(e, f[1], &clen); // freed in pack
  char* env = io_cstr(e, f[2], &elen);
  ExecEnv* ctx = (ExecEnv*)calloc(1, sizeof(ExecEnv));
  w->word = 65536;
  w->size = 0;
  w->data = io_mem(malloc(w->word));
  w->made = 0;
  w->code = 0;
  if (!ctx) {
    w->code = ENOMEM;
  } else {
    if (capture) {
      ctx->capture_path = io_cstr(e, f[3], &elen); // freed in exec_env_free
    }
    int error = baton_envp_build(env, elen, &ctx->envp, &ctx->built, &ctx->built_count);
    if (error == EINVAL) {
      exec_env_free(ctx);
      ctx = NULL;
      free(env);
      exec_free_argv((char**)w->hand);
      free(w->text);
      free(w->data);
      return io_fail(e, EINVAL, "environment entry has an empty name");
    }
    if (error) w->code = (u32)error;
  }
  free(env);
  if (w->code) {
    exec_env_free(ctx);
    exec_free_argv((char**)w->hand);
    free(w->text);
    free(w->data);
    return io_fail(e, w->code, NULL);
  }
  w->made = (u64)(uintptr_t)ctx;
  return io_work(w, exec_call, exec_pack);
}

#ifdef CID_EXEC_RUN
static Term exec_run_run(Env e, Term* f, IoWork* w) {
  return exec_begin(e, f, w, 0);
}
static void __attribute__((constructor)) exec_run_use(void) {
  io_eff(CID_EXEC_RUN, exec_run_run, 0);
}
#endif

#ifdef CID_EXEC_RUN_CAPTURE
static Term exec_run_capture_run(Env e, Term* f, IoWork* w) {
  return exec_begin(e, f, w, 1);
}
static void __attribute__((constructor)) exec_run_capture_use(void) {
  io_eff(CID_EXEC_RUN_CAPTURE, exec_run_capture_run, 0);
}
#endif
