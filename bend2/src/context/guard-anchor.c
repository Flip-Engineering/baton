/* The private guard anchor of the managed semantic context lifecycle. The Bend
   declaration `def Context.prepare_guard_anchor` imports this file. It creates
   `<log directory>/g` with mode 0700 and then validates the created path: the
   canonical parent must be the recorded log directory and the canonical basename
   must remain `g`, so a pre-existing symlink or a replaced directory cannot
   redirect the guard somewhere else. The guard lock the host later creates is a
   sibling of this directory, named `g.lock-` plus the hex expansion of the key. */
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

typedef struct {
  char *log_dir;
  char *path;
  int error;
} BatonGuardAnchor;

static void baton_guard_anchor_call(IoWork *w) {
  BatonGuardAnchor *call = (BatonGuardAnchor *)w->data;
  char *log = realpath(call->log_dir, NULL);
  if (!log) { call->error = errno; return; }
  size_t n = strlen(log);
  char *requested = malloc(n + 3);
  if (!requested) { free(log); call->error = ENOMEM; return; }
  memcpy(requested, log, n);
  memcpy(requested + n, "/g", 3);
  if (mkdir(requested, 0700) && errno != EEXIST) {
    call->error = errno; free(log); free(requested); return;
  }
  char *canonical = realpath(requested, NULL);
  if (!canonical) { call->error = errno; free(log); free(requested); return; }
  size_t c = strlen(canonical);
  const char *slash = c > 2 ? strrchr(canonical, '/') : NULL;
  int parent_ok = slash && (size_t)(slash - canonical) == n && strncmp(canonical, log, n) == 0;
  int name_ok = slash && strcmp(slash + 1, "g") == 0;
  struct stat info;
  if (stat(canonical, &info) != 0) { call->error = errno; free(log); free(requested); free(canonical); return; }
  if (!parent_ok || !name_ok || !S_ISDIR(info.st_mode)) {
    call->error = EINVAL; free(log); free(requested); free(canonical); return;
  }
  call->path = canonical;
  free(log); free(requested);
}

static Term baton_guard_anchor_pack(Env e, IoWork *w) {
  BatonGuardAnchor *call = (BatonGuardAnchor *)w->data;
  Term result = call->error == 0
    ? io_done(e, io_str(e, call->path, strlen(call->path)))
    : io_fail(e, call->error, "guard anchor directory unavailable");
  free(call->log_dir); free(call->path); free(call);
  w->data = NULL;
  return result;
}

#ifdef CID_CONTEXT_PREPARE_GUARD_ANCHOR
static Term baton_guard_anchor_run(Env e, Term *f, IoWork *w) {
  BatonGuardAnchor *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  u64 n = 0;
  call->log_dir = io_cstr(e, f[0], &n);
  if (strlen(call->log_dir) != n) {
    free(call->log_dir); free(call);
    return io_fail(e, EINVAL, "log directory contains NUL");
  }
  w->data = (char *)call;
  return io_work(w, baton_guard_anchor_call, baton_guard_anchor_pack);
}
static void __attribute__((constructor)) baton_guard_anchor_use(void) {
  io_eff(CID_CONTEXT_PREPARE_GUARD_ANCHOR, baton_guard_anchor_run, 0);
}
#endif
