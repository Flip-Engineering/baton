// The C host half of Process.run: spawn one process with an argv built from
// the length-prefixed argument string, answer "exit <n>\n" or "signal <n>\n"
// followed by everything the child wrote to stdout. The child inherits stderr
// so diagnostics reach the coordinator's log. A spawn or read failure answers
// io_fail with the errno; the blocking spawn and wait run through io_work like
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
#include <fcntl.h>
#include <spawn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <unistd.h>
#include <sys/file.h>

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

/* A claim this effect may transfer. An arbitrary descriptor number establishes
   nothing: the descriptor must be open, refer to a regular file, and be the SAME file
   as the caller's canonical guard path (same device and inode), so a descriptor that
   merely happens to be an unlocked regular file is refused. The lock test rejects a
   claim another process currently holds. This does not by itself prove the caller
   claimed this attempt: that is the caller contract, named here rather than assumed. */
static int git_claim_check(int claim_fd, const char* guard) {
  if (claim_fd < 0) return EBADF;
  if (fcntl(claim_fd, F_GETFD) < 0) return errno;
  struct stat held;
  if (fstat(claim_fd, &held)) return errno;
  if (!S_ISREG(held.st_mode)) return EINVAL;
  if (!guard || !guard[0]) return EINVAL;
  struct stat canonical;
  if (stat(guard, &canonical)) return errno;
  if (held.st_dev != canonical.st_dev || held.st_ino != canonical.st_ino) return EXDEV;
  if (flock(claim_fd, LOCK_EX | LOCK_NB)) return errno;
  return 0;
}

/* The spawn actions install the standard destinations 0, 1 and 2. If the caller's
   process has any of them closed, the diagnostic file and the pipe would take those
   numbers, and an action that closes a pipe end would then close an installed stream.
   Every source descriptor is therefore moved above the standard destinations first. */
static int git_to_high(int fd) {
  if (fd < 0 || fd > 2) return fd;
  int moved = fcntl(fd, F_DUPFD, 3);
  if (moved < 0) return -1;
  close(fd);
  return moved;
}

static void git_proc_call_with_stderr(IoWork* w, int stderr_fd, int claim_fd) {
  char** argv = (char**)w->hand;
  char* cwd = w->text;
  int fds[2];
  if (pipe(fds) != 0) {
    w->code = errno;
    return;
  }
  if ((fds[0] = git_to_high(fds[0])) < 0 || (fds[1] = git_to_high(fds[1])) < 0) {
    int e = errno;
    close(fds[0] >= 0 ? fds[0] : -1); close(fds[1] >= 0 ? fds[1] : -1);
    w->code = e;
    return;
  }
  if (stderr_fd > 2 && (stderr_fd == fds[0] || stderr_fd == fds[1])) {
    close(fds[0]); close(fds[1]);
    w->code = EBUSY;
    return;
  }
  /* The claim is transferred as an inherited duplicate taken AFTER the pipe exists,
     so its number cannot collide with the pipe or with the dup2 destinations 1 and 2,
     and so no spawn action has to name it: dup() clears FD_CLOEXEC, which is exactly
     the inheritance the child needs. A fixed destination descriptor would be wrong
     here, because a later addclose on a pipe end can remove it again. */
  int transferred = -1;
  int slot = -1;
  if (claim_fd >= 0) {
    /* An inheritable duplicate sitting in the parent would be picked up by any other
       spawn in this process, so the duplicate carries FD_CLOEXEC and only the spawn
       action below clears it, for this child alone. */
    transferred = dup(claim_fd);
    if (transferred < 0) { int e = errno; close(fds[0]); close(fds[1]); w->code = e; return; }
    int attempts = 0;
    while (transferred < 3 || transferred == fds[0] || transferred == fds[1]) {
      if (++attempts > 64) { close(transferred); close(fds[0]); close(fds[1]); w->code = EMFILE; return; }
      int again = dup(claim_fd);
      if (again < 0) { int e = errno; close(transferred); close(fds[0]); close(fds[1]); w->code = e; return; }
      if (again == transferred) { close(transferred); close(fds[0]); close(fds[1]); w->code = EBUSY; return; }
      close(transferred);
      transferred = again;
    }
    if (fcntl(transferred, F_SETFD, FD_CLOEXEC) < 0) {
      int e = errno; close(transferred); close(fds[0]); close(fds[1]); w->code = e; return;
    }
    slot = 3;
    while (slot == fds[0] || slot == fds[1] || slot == transferred) slot += 1;
  }
  posix_spawn_file_actions_t acts;
  int action = posix_spawn_file_actions_init(&acts);
  if (action) { close(transferred >= 0 ? transferred : -1); close(fds[0]); close(fds[1]); w->code = action; return; }
  /* Every action is checked and every failure takes the one cleanup path below, so an
     action error cannot leak the pipe or leave the file actions undestroyed. */
  if (!action) action = posix_spawn_file_actions_addclose(&acts, fds[0]);
  if (!action) action = posix_spawn_file_actions_adddup2(&acts, fds[1], 1);
  if (!action && stderr_fd >= 0) action = posix_spawn_file_actions_adddup2(&acts, stderr_fd, 2);
  if (!action) action = posix_spawn_file_actions_addclose(&acts, fds[1]);
  /* After the pipe end is closed, so no later action can remove the installed slot;
     dup2 clears FD_CLOEXEC on the new descriptor, which is the whole transfer. */
  if (!action && slot >= 0) action = posix_spawn_file_actions_adddup2(&acts, transferred, slot);
  if (!action) action = posix_spawn_file_actions_addchdir_np(&acts, cwd);
  if (action) {
    posix_spawn_file_actions_destroy(&acts);
    if (transferred >= 0) close(transferred);
    close(fds[0]);
    close(fds[1]);
    w->code = action;
    return;
  }
  pid_t pid = -1;
  int rc = posix_spawnp(&pid, argv[0], &acts, NULL, argv, environ);
  posix_spawn_file_actions_destroy(&acts);
  close(fds[1]);
  /* The parent's copy goes away; the child's inherited copy keeps the lock. */
  if (transferred >= 0) close(transferred);
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
      int reaped = 0;
      if (waitpid(pid, &reaped, 0) < 0 && !w->code) w->code = errno;
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

static void git_proc_call(IoWork* w) {
  git_proc_call_with_stderr(w, -1, -1);
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

#if defined(CID_PROCESS_CAPTURE) || defined(CID_PROCESS_CAPTURE_HOLDING)
/* Capture stderr in an unlinked file so both streams are complete without
   blocking one pipe while the other fills. Legacy Process.run inherits stderr. */
typedef struct {
  IoWork process;
  char *diagnostic;
  size_t diagnostic_size;
  int claim;        /* -1 when the caller holds no claim: legacy behaviour */
  char *guard;      /* the canonical guard path the claim must be the same file as */
  char *artifact;   /* NULL: unlinked diagnostic file; else the attempt-bound path */
} GitCapture;

static void git_capture_call(IoWork *w) {
  GitCapture *capture = (GitCapture *)w->data;
  FILE *diagnostic = NULL;
  if (capture->claim >= 0) {
    /* An unvalidated descriptor number establishes nothing. */
    int claim_error = git_claim_check(capture->claim, capture->guard);
    if (claim_error) { capture->process.code = claim_error; return; }
  }
  if (capture->artifact) {
    /* Attempt evidence is created once and never truncated: O_EXCL refuses an existing
       path, so a retry has to choose a new name instead of destroying retained bytes,
       and O_NOFOLLOW refuses an aliased final component. The stream is opened read/write
       because the bytes are read back from it. Partial writes and an unreadable back
       read leave the file in place; the fsync below is reached only on the normal path,
       so a supervisor that dies before it leaves bytes that may not be durable. */
    int fd = open(capture->artifact, O_CREAT | O_EXCL | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0) { capture->process.code = errno; return; }
    if ((fd = git_to_high(fd)) < 0) { capture->process.code = errno; return; }
    diagnostic = fdopen(fd, "w+");
    if (!diagnostic) { int e = errno; close(fd); capture->process.code = e; return; }
  } else {
    diagnostic = tmpfile();
    if (!diagnostic) { capture->process.code = errno; return; }
    if (fcntl(fileno(diagnostic), F_SETFD, FD_CLOEXEC) < 0) {
      capture->process.code = errno; fclose(diagnostic); return;
    }
    int moved = git_to_high(fileno(diagnostic));
    if (moved < 0) { capture->process.code = errno; fclose(diagnostic); return; }
    if (moved != fileno(diagnostic)) {
      FILE *again = fdopen(moved, "w+");
      if (!again) { capture->process.code = errno; close(moved); fclose(diagnostic); return; }
      fclose(diagnostic);
      diagnostic = again;
    }
  }
  git_proc_call_with_stderr(&capture->process, fileno(diagnostic), capture->claim);
  if (capture->artifact && fflush(diagnostic) != 0 && !capture->process.code) capture->process.code = errno;
  if (capture->artifact && fsync(fileno(diagnostic)) != 0 && !capture->process.code) capture->process.code = errno;
  if (fseek(diagnostic, 0, SEEK_END) != 0) {
    if (!capture->process.code) capture->process.code = errno;
  } else {
    long size = ftell(diagnostic);
    if (size < 0 || fseek(diagnostic, 0, SEEK_SET) != 0) {
      if (!capture->process.code) capture->process.code = errno;
    } else {
      capture->diagnostic = malloc((size_t)size + 1);
      if (!capture->diagnostic) {
        if (!capture->process.code) capture->process.code = ENOMEM;
      } else {
        capture->diagnostic_size = fread(capture->diagnostic, 1, (size_t)size, diagnostic);
        capture->diagnostic[capture->diagnostic_size] = 0;
        if (ferror(diagnostic) && !capture->process.code) capture->process.code = errno ? errno : EIO;
      }
    }
  }
  fclose(diagnostic);
}

static Term git_capture_pack(Env e, IoWork *w) {
  GitCapture *capture = (GitCapture *)w->data;
  IoWork *p = &capture->process;
  Term result;
  if (p->code) {
    result = io_fail(e, p->code, capture->diagnostic_size ? capture->diagnostic : NULL);
  } else {
    char head[32];
    int n = snprintf(head, sizeof(head), p->made / 1000 == GIT_PROC_KIND_EXIT ? "exit %d\n" : "signal %d\n", (int)(p->made % 1000));
    char *out = io_mem(malloc((size_t)n + p->size));
    memcpy(out, head, (size_t)n);
    memcpy(out + n, p->data, p->size);
    result = io_done(e, io_tup(e, io_str(e, out, (size_t)n + p->size), io_str(e, capture->diagnostic ? capture->diagnostic : "", capture->diagnostic_size)));
    free(out);
  }
  git_proc_free_argv((char **)p->hand);
  free(p->text); free(p->data); free(capture->diagnostic); free(capture->artifact); free(capture->guard); free(capture);
  w->data = NULL;
  return result;
}

#ifdef CID_PROCESS_CAPTURE
static Term git_capture_run(Env e, Term *f, IoWork *w) {
  GitCapture *capture = calloc(1, sizeof(*capture));
  if (!capture) return io_fail(e, ENOMEM, NULL);
  u64 args_n = 0, cwd_n = 0;
  char *args = io_cstr(e, f[0], &args_n);
  capture->process.text = io_cstr(e, f[1], &cwd_n);
  if (strlen(args) != args_n || strlen(capture->process.text) != cwd_n) {
    free(args); free(capture->process.text); free(capture);
    return io_fail(e, EINVAL, "process arguments or directory contain NUL");
  }
  capture->process.hand = (intptr_t)git_proc_parse_argv(args);
  free(args);
  capture->claim = -1;
  capture->process.word = 65536;
  capture->process.data = io_mem(malloc(capture->process.word));
  w->data = (char *)capture;
  return io_work(w, git_capture_call, git_capture_pack);
}

static void __attribute__((constructor)) git_capture_use(void) {
  io_eff(CID_PROCESS_CAPTURE, git_capture_run, 0);
}
#endif
#endif

#ifdef CID_PROCESS_CAPTURE_HOLDING
/* The guarded variant. It differs from Process.capture only in that the caller supplies
   the claim it already holds and the attempt-bound artifact that must survive, so the
   custody machinery above is reachable rather than dead: without these arguments the
   claim stays -1 and the diagnostic stays an unlinked file. */
static Term git_capture_holding_run(Env e, Term *f, IoWork *w) {
  GitCapture *capture = calloc(1, sizeof(*capture));
  if (!capture) return io_fail(e, ENOMEM, NULL);
  u64 args_n = 0, cwd_n = 0;
  char *args = io_cstr(e, f[0], &args_n);
  capture->process.text = io_cstr(e, f[1], &cwd_n);
  if (strlen(args) != args_n || strlen(capture->process.text) != cwd_n) {
    free(args); free(capture->process.text); free(capture);
    return io_fail(e, EINVAL, "process arguments or directory contain NUL");
  }
  /* A supplied claim is never accepted through the legacy sentinel: a value that does
     not fit a target int, or that names no descriptor, is refused before any artifact
     is created or child is spawned. */
  u32 raw = (u32)f[2];
  if (raw > (u32)INT32_MAX) {
    free(args); free(capture->process.text); free(capture);
    return io_fail(e, EINVAL, "claim handle out of range");
  }
  capture->claim = (int)raw;
  u64 guard_n = 0;
  capture->guard = io_cstr(e, f[3], &guard_n);
  u64 art_n = 0;
  capture->artifact = io_cstr(e, f[4], &art_n);
  if (strlen(capture->guard) != guard_n || strlen(capture->artifact) != art_n) {
    free(args); free(capture->process.text); free(capture->guard); free(capture->artifact); free(capture);
    return io_fail(e, EINVAL, "guard or artifact path contains NUL");
  }
  capture->process.hand = (intptr_t)git_proc_parse_argv(args);
  free(args);
  capture->process.word = 65536;
  capture->process.data = io_mem(malloc(capture->process.word));
  w->data = (char *)capture;
  return io_work(w, git_capture_call, git_capture_pack);
}

static void __attribute__((constructor)) git_capture_holding_use(void) {io_eff(CID_PROCESS_CAPTURE_HOLDING, git_capture_holding_run, 0);}
#endif

#ifdef CID_PROCESS_PATH_EXISTS
static void git_path_call(IoWork *w) {
  struct stat status;
  if (lstat(w->text, &status) == 0) w->made = 1;
  else if (errno != ENOENT) w->code = errno;
}
static Term git_path_pack(Env e, IoWork *w) {
  Term answer = w->code ? io_fail(e, w->code, NULL) : io_done(e, term_pak(w->made ? CID_TRUE : CID_FALSE, 0));
  free(w->text); return answer;
}
static Term git_path_run(Env e, Term *f, IoWork *w) {
  u64 n = 0;
  w->text = io_cstr(e, f[0], &n); w->code = 0; w->made = 0;
  if (strlen(w->text) != n) {free(w->text); return io_fail(e, EINVAL, "path contains NUL");}
  return io_work(w, git_path_call, git_path_pack);
}
static void __attribute__((constructor)) git_path_use(void) {io_eff(CID_PROCESS_PATH_EXISTS, git_path_run, 0);}
#endif
