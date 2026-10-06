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

/* The claim a guarded effect must hold across supervisor loss. The descriptor is
   transferred into the child by a spawn file action, which clears FD_CLOEXEC on the
   new descriptor (POSIX), so the lock's open file description outlives the supervisor.
   Whether the executed program or its descendants keep it open is NOT assumed here:
   that is what the surviving-child reproduction must establish on the admitted
   executable, and the fixture records it rather than this comment. */
#define BATON_CLAIM_FD 9

/* An arbitrary descriptor number is not a claim. The caller must pass a descriptor
   that is open, refers to a regular file, and whose lock this process still holds;
   a re-lock of the same description succeeds, a foreign one answers EWOULDBLOCK. */
static int git_claim_check(int claim_fd) {
  if (claim_fd < 0) return EBADF;
  if (fcntl(claim_fd, F_GETFD) < 0) return errno;
  struct stat state;
  if (fstat(claim_fd, &state)) return errno;
  if (!S_ISREG(state.st_mode)) return EINVAL;
  if (fcntl(BATON_CLAIM_FD, F_GETFD) >= 0 || errno != EBADF) return EBUSY;
  if (flock(claim_fd, LOCK_EX | LOCK_NB)) return errno;
  return 0;
}

static void git_proc_call_with_stderr(IoWork* w, int stderr_fd, int claim_fd) {
  char** argv = (char**)w->hand;
  char* cwd = w->text;
  int fds[2];
  if (pipe(fds) != 0) {
    w->code = errno;
    return;
  }
  posix_spawn_file_actions_t acts;
  int action = posix_spawn_file_actions_init(&acts);
  if (action) { w->code = action; return; }
  /* Every action is checked: a silently failed dup2 would leave the child with the
     wrong streams, and a failed claim transfer would leave it without custody. */
  if ((action = posix_spawn_file_actions_addclose(&acts, fds[0]))) { w->code = action; return; }
  if ((action = posix_spawn_file_actions_adddup2(&acts, fds[1], 1))) { w->code = action; return; }
  if (stderr_fd >= 0 && (action = posix_spawn_file_actions_adddup2(&acts, stderr_fd, 2))) { w->code = action; return; }
  if (claim_fd >= 0 && (action = posix_spawn_file_actions_adddup2(&acts, claim_fd, BATON_CLAIM_FD))) { w->code = action; return; }
  if ((action = posix_spawn_file_actions_addclose(&acts, fds[1]))) { w->code = action; return; }
  if ((action = posix_spawn_file_actions_addchdir_np(&acts, cwd))) { w->code = action; return; }
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
  char *artifact;   /* NULL: unlinked diagnostic file; else the attempt-bound path */
} GitCapture;

static void git_capture_call(IoWork *w) {
  GitCapture *capture = (GitCapture *)w->data;
  FILE *diagnostic = NULL;
  if (capture->claim >= 0) {
    /* An unvalidated descriptor number establishes nothing. */
    int claim_error = git_claim_check(capture->claim);
    if (claim_error) { capture->process.code = claim_error; return; }
  }
  if (capture->artifact) {
    /* Durable attempt evidence: a named file the attempt retains, not an unlinked
       one. It is created or truncated here, kept on every exit path including host
       failure and interrupted observation, and never unlinked by this effect. */
    int fd = open(capture->artifact, O_CREAT | O_WRONLY | O_TRUNC | O_CLOEXEC, 0600);
    if (fd < 0) { capture->process.code = errno; return; }
    diagnostic = fdopen(fd, "w");
    if (!diagnostic) { int e = errno; close(fd); capture->process.code = e; return; }
  } else {
    diagnostic = tmpfile();
    if (!diagnostic) { capture->process.code = errno; return; }
    if (fcntl(fileno(diagnostic), F_SETFD, FD_CLOEXEC) < 0) {
      capture->process.code = errno; fclose(diagnostic); return;
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
  free(p->text); free(p->data); free(capture->diagnostic); free(capture->artifact); free(capture);
  w->data = NULL;
  return result;
}

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
  capture->claim = (int)(u32)f[2];
  u64 art_n = 0;
  capture->artifact = io_cstr(e, f[3], &art_n);
  if (strlen(capture->artifact) != art_n) {
    free(args); free(capture->process.text); free(capture->artifact); free(capture);
    return io_fail(e, EINVAL, "artifact path contains NUL");
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
