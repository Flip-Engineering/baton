// C effect: spawn a child process with pipes for stdin/stdout/stderr.
// Returns a handle packing the child PID. The caller writes to the child's
// stdin with ProcessChild.write and reads stdout with ProcessChild.read.

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

#ifndef BATON_PROCESS_CHILDREN_DEFINED
#define BATON_PROCESS_CHILDREN_DEFINED

typedef struct {
  pid_t pid;
  int stdin_fd;
  int stdout_fd;
  int stderr_fd;
} SpawnedChild;

#define CHILDREN_INITIAL_CAP 16
static SpawnedChild* children = NULL;
static int child_count = 0;
static int children_cap = 0;

#endif

static int alloc_child(pid_t pid, int in_fd, int out_fd, int err_fd) {
  if (children == NULL) {
    children_cap = CHILDREN_INITIAL_CAP;
    children = malloc(sizeof(SpawnedChild) * (size_t)children_cap);
  }
  if (child_count >= children_cap) {
    children_cap *= 2;
    children = realloc(children, sizeof(SpawnedChild) * (size_t)children_cap);
  }
  int idx = child_count++;
  children[idx].pid = pid;
  children[idx].stdin_fd = in_fd;
  children[idx].stdout_fd = out_fd;
  children[idx].stderr_fd = err_fd;
  return idx;
}

#ifdef CID_PROCESSCHILD_SPAWN

// ProcessChild.spawn(cmd: String, args: String, cwd: String) -> IO(U32)
//
// args is a single string with arguments separated by newlines.
// Returns a child index (handle) as U32.
Term processchild_spawn_run(Env e, Term* f, IoWork* w) {
  u64 cmd_len = 0, args_len = 0, cwd_len = 0;
  char* cmd = io_cstr(e, f[0], &cmd_len);
  char* args_str = io_cstr(e, f[1], &args_len);
  char* cwd = io_cstr(e, f[2], &cwd_len);

  // Count arguments (split by newline).
  int argc = 1; // cmd itself
  for (u64 i = 0; i < args_len; i++) {
    if (args_str[i] == '\n') argc++;
  }
  if (args_len == 0) argc = 0;

  // Build argv: [cmd, arg1, arg2, ..., NULL]
  char** argv = malloc(sizeof(char*) * (1 + argc + 1));
  argv[0] = cmd;
  if (argc > 0 && args_len > 0) {
    int ai = 0;
    char* p = args_str;
    for (u64 i = 0; i <= args_len; i++) {
      if (i == args_len || args_str[i] == '\n') {
        args_str[i] = '\0';
        argv[1 + ai++] = p;
        p = args_str + i + 1;
      }
    }
  }
  argv[1 + argc] = NULL;

  // Create pipes.
  int pipe_in[2], pipe_out[2], pipe_err[2];
  if (pipe(pipe_in) < 0 || pipe(pipe_out) < 0 || pipe(pipe_err) < 0) {
    free(argv);
    free(cmd);
    free(args_str);
    free(cwd);
    return io_fail(e, errno, NULL);
  }

  pid_t pid = fork();
  if (pid < 0) {
    int err = errno;
    close(pipe_in[0]); close(pipe_in[1]);
    close(pipe_out[0]); close(pipe_out[1]);
    close(pipe_err[0]); close(pipe_err[1]);
    free(argv);
    free(cmd);
    free(args_str);
    free(cwd);
    return io_fail(e, err, NULL);
  }

  if (pid == 0) {
    setsid();
    close(pipe_in[1]);
    close(pipe_out[0]);
    close(pipe_err[0]);
    dup2(pipe_in[0], STDIN_FILENO);
    dup2(pipe_out[1], STDOUT_FILENO);
    int devnull = open("/dev/null", O_WRONLY);
    if (devnull >= 0) { dup2(devnull, STDERR_FILENO); close(devnull); }
    close(pipe_in[0]);
    close(pipe_out[1]);
    if (cwd_len > 0 && chdir(cwd) < 0) _exit(126);
    execvp(cmd, argv);
    _exit(127);
  }

  close(pipe_in[0]);
  close(pipe_out[1]);
  close(pipe_err[0]);
  close(pipe_err[1]);

  int idx = alloc_child(pid, pipe_in[1], pipe_out[0], -1);
  free(argv);
  free(cmd);
  free(args_str);
  free(cwd);

  if (idx < 0) {
    kill(pid, SIGKILL);
    waitpid(pid, NULL, 0);
    close(pipe_in[1]);
    close(pipe_out[0]);
    close(pipe_err[0]);
    return io_fail(e, ENOMEM, "child allocation failed");
  }

  return (Term)(u32)idx;
}

static void __attribute__((constructor)) processchild_spawn_use(void) {
  io_eff(CID_PROCESSCHILD_SPAWN, processchild_spawn_run, 0);
}

#endif

#ifdef CID_PROCESSCHILD_WRITE

// ProcessChild.write(handle: U32, data: String) -> IO(Unit)
Term processchild_write_run(Env e, Term* f, IoWork* w) {
  int idx = (int)(u32)f[0];
  if (idx < 0 || idx >= child_count) return io_fail(e, EINVAL, "invalid child handle");

  u64 len = 0;
  char* data = io_cstr(e, f[1], &len);
  ssize_t written = 0;
  while ((u64)written < len) {
    ssize_t n = write(children[idx].stdin_fd, data + written, len - (u64)written);
    if (n < 0) {
      int err = errno;
      free(data);
      return io_fail(e, err, NULL);
    }
    written += n;
  }
  free(data);
  return term_pak(CID_UNIT, 0);
}

static void __attribute__((constructor)) processchild_write_use(void) {
  io_eff(CID_PROCESSCHILD_WRITE, processchild_write_run, 0);
}

#endif

#ifdef CID_PROCESSCHILD_CLOSE_STDIN

// ProcessChild.close_stdin(handle: U32) -> IO(Unit)
Term processchild_close_stdin_run(Env e, Term* f, IoWork* w) {
  int idx = (int)(u32)f[0];
  if (idx < 0 || idx >= child_count) return io_fail(e, EINVAL, "invalid child handle");
  if (children[idx].stdin_fd >= 0) {
    close(children[idx].stdin_fd);
    children[idx].stdin_fd = -1;
  }
  return term_pak(CID_UNIT, 0);
}

static void __attribute__((constructor)) processchild_close_stdin_use(void) {
  io_eff(CID_PROCESSCHILD_CLOSE_STDIN, processchild_close_stdin_run, 0);
}

#endif

#ifdef CID_PROCESSCHILD_READ_LINE

// ProcessChild.read_line(handle: U32) -> IO(String)
// Read one line from stdout (up to newline or EOF). Returns the line without
// the newline. Returns empty string at EOF.
Term processchild_read_line_run(Env e, Term* f, IoWork* w) {
  int idx = (int)(u32)f[0];
  if (idx < 0 || idx >= child_count) return io_fail(e, EINVAL, "invalid child handle");

  u32 cap = 4096;
  u32 n = 0;
  char* buf = malloc(cap);
  for (;;) {
    char c;
    ssize_t got = read(children[idx].stdout_fd, &c, 1);
    if (got <= 0) break;
    if (c == '\n') break;
    if (n == cap) { cap *= 2; buf = realloc(buf, cap); }
    buf[n++] = c;
  }
  Term r = io_str(e, buf, n);
  free(buf);
  return r;
}

static void __attribute__((constructor)) processchild_read_line_use(void) {
  io_eff(CID_PROCESSCHILD_READ_LINE, processchild_read_line_run, 0);
}

#endif

#ifdef CID_PROCESSCHILD_WAIT

// ProcessChild.wait(handle: U32) -> IO(U32)
// Wait for the child to exit, return the exit status (or 128+signal).
Term processchild_wait_run(Env e, Term* f, IoWork* w) {
  int idx = (int)(u32)f[0];
  if (idx < 0 || idx >= child_count) return io_fail(e, EINVAL, "invalid child handle");

  int status = 0;
  pid_t r = waitpid(children[idx].pid, &status, 0);
  if (r < 0) return io_fail(e, errno, NULL);

  u32 code;
  if (WIFEXITED(status)) code = (u32)WEXITSTATUS(status);
  else if (WIFSIGNALED(status)) code = 128 + (u32)WTERMSIG(status);
  else code = 255;

  // Close remaining fds.
  if (children[idx].stdin_fd >= 0) close(children[idx].stdin_fd);
  if (children[idx].stdout_fd >= 0) close(children[idx].stdout_fd);
  if (children[idx].stderr_fd >= 0) close(children[idx].stderr_fd);
  children[idx].stdin_fd = -1;
  children[idx].stdout_fd = -1;
  children[idx].stderr_fd = -1;

  return (Term)code;
}

static void __attribute__((constructor)) processchild_wait_use(void) {
  io_eff(CID_PROCESSCHILD_WAIT, processchild_wait_run, 0);
}

#endif

#ifdef CID_PROCESSCHILD_SIGNAL

// ProcessChild.signal(handle: U32, sig: U32) -> IO(Unit)
Term processchild_signal_run(Env e, Term* f, IoWork* w) {
  int idx = (int)(u32)f[0];
  if (idx < 0 || idx >= child_count) return io_fail(e, EINVAL, "invalid child handle");
  int sig = (int)(u32)f[1];
  if (kill(children[idx].pid, sig) < 0) return io_fail(e, errno, NULL);
  return term_pak(CID_UNIT, 0);
}

static void __attribute__((constructor)) processchild_signal_use(void) {
  io_eff(CID_PROCESSCHILD_SIGNAL, processchild_signal_run, 0);
}

#endif

#ifdef CID_PROCESSCHILD_PID

// ProcessChild.pid(handle: U32) -> IO(U32)
Term processchild_pid_run(Env e, Term* f, IoWork* w) {
  int idx = (int)(u32)f[0];
  if (idx < 0 || idx >= child_count) return io_fail(e, EINVAL, "invalid child handle");
  return (Term)(u32)children[idx].pid;
}

static void __attribute__((constructor)) processchild_pid_use(void) {
  io_eff(CID_PROCESSCHILD_PID, processchild_pid_run, 0);
}

#endif
