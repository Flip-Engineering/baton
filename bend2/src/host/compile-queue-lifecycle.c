/* Host boundary for the Bend2 shared compile queue.

   Locking is BSD flock(2) directly in this file. The lock belongs to the open
   file description and survives fork and exec, so a detached supervisor or
   guard inherits the key and heavy locks through descriptors 9 and 8. The
   process start identity follows process-spawn.c: Linux /proc/<pid>/stat
   starttime and macOS PROC_PIDTBSDINFO start time. Detachment follows the
   fork/exec shape of br_spawn_gated, with setsid(2) in the child. No shell
   helper or setsid executable participates. */

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <ftw.h>
#include <limits.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#ifdef __APPLE__
#include <libproc.h>
#include <mach-o/dyld.h>
#include <sys/proc.h>
#endif

extern char **environ;

typedef struct {
  char *path, *text, *second, *cwd, *stdout_path, *stderr_path, *argv;
  u32 pid, sig, key_lock, cgen_lock, millis;
  int error, code, disposition;
  char *out;
  size_t out_length, argv_length;
} CqCall;

static void cq_free(CqCall *call) {
  if (!call) return;
  free(call->path); free(call->text); free(call->second); free(call->cwd);
  free(call->stdout_path); free(call->stderr_path); free(call->argv);
  free(call->out); free(call);
}

static int cq_text_arg(Env env, Term value, char **out) {
  u64 length = 0;
  char *text = io_cstr(env, value, &length);
  if (!text) return ENOMEM;
  if (strlen(text) != length) { free(text); return EINVAL; }
  *out = text;
  return 0;
}
static int cq_bytes_arg(Env env, Term value, char **out, size_t *length) {
  u64 size = 0;
  char *bytes = io_cstr(env, value, &size);
  if (!bytes) return ENOMEM;
  *out = bytes;
  *length = (size_t)size;
  return 0;
}



static Term cq_unit_pack(Env env, IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  Term result = call->error ? io_fail(env, call->error, NULL)
                            : io_done(env, term_pak(CID_UNIT, 0));
  cq_free(call); work->data = NULL;
  return result;
}

static Term cq_u32_pack(Env env, IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  Term result = call->error ? io_fail(env, call->error, NULL)
                            : io_done(env, (Term)call->code);
  cq_free(call); work->data = NULL;
  return result;
}

static Term cq_text_pack(Env env, IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  Term result = call->error ? io_fail(env, call->error, NULL)
    : io_done(env, io_str(env, call->out ? call->out : "", call->out ? call->out_length : 0));
  cq_free(call); work->data = NULL;
  return result;
}

static Term cq_maybe_u32_pack(Env env, IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  Term value = call->code < 0 ? term_pak(CID_NONE, 0)
                              : io_box(env, CID_SOME, (Term)(u32)call->code);
  Term result = call->error ? io_fail(env, call->error, NULL) : io_done(env, value);
  cq_free(call); work->data = NULL;
  return result;
}

static Term cq_pair_pack(Env env, IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  const char *kind = call->disposition == 2 ? "canceled"
    : call->disposition == 1 ? "signal" : "exit";
  Term result = call->error ? io_fail(env, call->error, NULL)
    : io_done(env, io_tup(env, (Term)call->code, io_str(env, kind, strlen(kind))));
  cq_free(call); work->data = NULL;
  return result;
}


static int cq_read_all(int fd, char **out, size_t *length) {
  size_t capacity = 4096, used = 0;
  char *buffer = malloc(capacity);
  if (!buffer) return ENOMEM;
  for (;;) {
    if (used == capacity) {
      size_t next = capacity * 2;
      char *grown = realloc(buffer, next);
      if (!grown) { free(buffer); return ENOMEM; }
      buffer = grown; capacity = next;
    }
    ssize_t got = read(fd, buffer + used, capacity - used);
    if (got < 0) {
      if (errno == EINTR) continue;
      int error = errno; free(buffer); return error;
    }
    if (got == 0) break;
    used += (size_t)got;
  }
  *out = buffer; *length = used;
  return 0;
}

static int cq_read_path(const char *path, char **out, size_t *length) {
  int fd = open(path, O_RDONLY);
  if (fd < 0) return errno;
  int error = cq_read_all(fd, out, length);
  close(fd);
  return error;
}

static int cq_starttime_text(u32 pid, char **out) {
  char *text = calloc(64, 1);
  if (!text) return ENOMEM;
#ifdef __APPLE__
  struct proc_bsdinfo info;
  int length = proc_pidinfo((int)pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info));
  if (length != (int)sizeof(info)) { free(text); return errno ? errno : ESRCH; }
#ifdef SZOMB
  if (info.pbi_status == SZOMB) { free(text); return ESRCH; }
#endif
  unsigned long long value = (unsigned long long)info.pbi_start_tvsec * 1000000ull
    + (unsigned long long)info.pbi_start_tvusec;
  snprintf(text, 64, "%llu", value);
#else
  char path[64];
  snprintf(path, sizeof(path), "/proc/%u/stat", pid);
  FILE *file = fopen(path, "r");
  if (!file) { free(text); return errno == ENOENT ? ESRCH : errno; }
  char *line = NULL; size_t capacity = 0;
  ssize_t length = getline(&line, &capacity, file);
  fclose(file);
  if (length < 0) { free(line); free(text); return EIO; }
  char *field = strrchr(line, ')');
  if (!field) { free(line); free(text); return EINVAL; }
  field += 2;
  char state = *field;
  if (state == 'Z' || state == 'X') { free(line); free(text); return ESRCH; }
  for (int index = 3; index < 22; index++) {
    field = strchr(field, ' ');
    if (!field) { free(line); free(text); return EINVAL; }
    field++;
  }
  char *end = NULL; errno = 0;
  unsigned long long value = strtoull(field, &end, 10);
  int error = (errno || end == field) ? EINVAL : 0;
  free(line);
  if (error) { free(text); return error; }
  snprintf(text, 64, "%llu", value);
#endif
  *out = text;
  return 0;
}

static int cq_alive_value(u32 pid, const char *start, u32 *alive) {
  *alive = 0;
  if (!pid || !start || !*start) return 0;
  char *current = NULL;
  int error = cq_starttime_text(pid, &current);
  if (error == ESRCH) return 0;
  if (error) return error;
  *alive = strcmp(current, start) ? 0 : 1;
  free(current);
  return 0;
}

static int cq_self_path(char **out) {
#ifdef __APPLE__
  uint32_t size = 0;
  _NSGetExecutablePath(NULL, &size);
  char *buffer = malloc(size ? size : 1);
  if (!buffer) return ENOMEM;
  if (_NSGetExecutablePath(buffer, &size)) { free(buffer); return EINVAL; }
  char *resolved = realpath(buffer, NULL);
  free(buffer);
  if (!resolved) return errno;
  *out = resolved;
  return 0;
#else
  char buffer[PATH_MAX];
  ssize_t length = readlink("/proc/self/exe", buffer, sizeof(buffer) - 1);
  if (length < 0) return errno;
  buffer[length] = 0;
  char *resolved = realpath(buffer, NULL);
  if (!resolved) return errno;
  *out = resolved;
  return 0;
#endif
}

static int cq_now_text(clockid_t clock, char **out) {
  struct timespec value;
  if (clock_gettime(clock, &value)) return errno;
  char text[64];
  unsigned long long ns = (unsigned long long)value.tv_sec * 1000000000ull
    + (unsigned long long)value.tv_nsec;
  snprintf(text, sizeof(text), "%llu", ns);
  *out = strdup(text);
  return *out ? 0 : ENOMEM;
}

static int cq_set_inheritable(int fd) {
  int flags = fcntl(fd, F_GETFD);
  if (flags < 0) return errno;
  if (fcntl(fd, F_SETFD, flags & ~FD_CLOEXEC)) return errno;
  return 0;
}

static int cq_lock_open(const char *path, u32 *handle) {
  mode_t previous = umask(0007);
  int fd = open(path, O_RDWR | O_CREAT | O_NOFOLLOW, 0660);
  int saved = errno;
  umask(previous);
  errno = saved;
  if (fd < 0) return errno;
  int error = cq_set_inheritable(fd);
  if (error) { close(fd); return error; }
  *handle = (u32)fd;
  return 0;
}

static int cq_lock_acquire(const char *path, u32 *handle) {
  u32 fd = 0;
  int error = cq_lock_open(path, &fd);
  if (error) return error;
  while (flock((int)fd, LOCK_EX) < 0) {
    if (errno == EINTR) continue;
    error = errno; close((int)fd); return error;
  }
  *handle = fd;
  return 0;
}

static int cq_lock_try(const char *path, int *handle) {
  u32 fd = 0;
  int error = cq_lock_open(path, &fd);
  if (error) return error;
  if (flock((int)fd, LOCK_EX | LOCK_NB) < 0) {
    error = errno;
    close((int)fd);
    if (error == EWOULDBLOCK || error == EAGAIN) return 0;
    return error;
  }
  *handle = (int)fd;
  return 0;
}

static int cq_lock_fd_acquire(u32 fd) {
  while (flock((int)fd, LOCK_EX) < 0) {
    if (errno == EINTR) continue;
    return errno;
  }
  return 0;
}

static int cq_mkdir_p(const char *path) {
  if (!path || !*path) return EINVAL;
  char *copy = strdup(path);
  if (!copy) return ENOMEM;
  size_t length = strlen(copy);
  if (length > 1 && copy[length - 1] == '/') copy[length - 1] = 0;
  mode_t previous = umask(0007);
  for (char *at = copy + 1; *at; at++) {
    if (*at != '/') continue;
    *at = 0;
    if (mkdir(copy, 02770) && errno != EEXIST) {
      int error = errno; umask(previous); free(copy); return error;
    }
    struct stat parent_info;
    int parent_status = lstat(copy, &parent_info);
    if (parent_status || !S_ISDIR(parent_info.st_mode)) {
      int error = parent_status ? errno : ENOTDIR;
      umask(previous); free(copy); return error;
    }
    *at = '/';
  }
  int error = 0;
  if (mkdir(copy, 02770) && errno != EEXIST) error = errno;
  umask(previous);
  struct stat info;
  if (!error && (lstat(copy, &info) || !S_ISDIR(info.st_mode))) error = ENOTDIR;
  if (!error && (!(info.st_mode & S_ISGID) || !(info.st_mode & S_IWGRP)
      || (info.st_mode & S_IWOTH))) error = EACCES;
  free(copy);
  return error;
}

static int cq_write_all_fd(int fd, const char *text, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t wrote = write(fd, text + offset, length - offset);
    if (wrote < 0) { if (errno == EINTR) continue; return errno; }
    if (wrote == 0) return EIO;
    offset += (size_t)wrote;
  }
  return 0;
}

static int cq_write_text(const char *path, const char *text, size_t length) {
  char temporary[PATH_MAX];
  int written = snprintf(temporary, sizeof(temporary), "%s.tmp.%d", path, (int)getpid());
  if (written < 0 || (size_t)written >= sizeof(temporary)) return ENAMETOOLONG;
  unlink(temporary);
  mode_t previous = umask(0007);
  int fd = open(temporary, O_WRONLY | O_CREAT | O_EXCL, 0660);
  int saved = errno;
  umask(previous);
  errno = saved;
  if (fd < 0) return errno;
  int error = cq_write_all_fd(fd, text, length);
  if (!error && fsync(fd)) error = errno;
  if (close(fd) && !error) error = errno;
  if (!error && rename(temporary, path)) error = errno;
  if (error) unlink(temporary);
  return error;
}

static int cq_copy_file(const char *source, const char *destination) {
  int input = open(source, O_RDONLY);
  if (input < 0) return errno;
  mode_t previous = umask(0007);
  int output = open(destination, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, 0660);
  int saved = errno;
  umask(previous);
  errno = saved;
  if (output < 0) { int error = errno; close(input); return error; }
  char buffer[65536];
  int error = 0;
  for (;;) {
    ssize_t got = read(input, buffer, sizeof(buffer));
    if (got < 0) { if (errno == EINTR) continue; error = errno; break; }
    if (got == 0) break;
    error = cq_write_all_fd(output, buffer, (size_t)got);
    if (error) break;
  }
  if (!error && fsync(output)) error = errno;
  if (close(output) && !error) error = errno;
  struct stat source_mode;
  if (!error && stat(source, &source_mode)) error = errno;
  if (!error && chmod(destination, source_mode.st_mode & 0777)) error = errno;
  close(input);
  return error;
}

static int cq_unlink_cb(const char *path, const struct stat *info, int type, struct FTW *tree) {
  (void)info; (void)type; (void)tree;
  if (remove(path) && errno != ENOENT) return -1;
  return 0;
}

static int cq_remove_tree(const char *path) {
  struct stat info;
  if (lstat(path, &info)) return errno == ENOENT ? 0 : errno;
  if (!S_ISDIR(info.st_mode)) return unlink(path) && errno != ENOENT ? errno : 0;
  return nftw(path, cq_unlink_cb, 32, FTW_DEPTH | FTW_PHYS) ? errno : 0;
}

static int cq_name_compare(const void *left, const void *right) {
  return strcmp(*(const char *const *)left, *(const char *const *)right);
}

static int cq_list_dir(const char *path, char **out, size_t *length) {
  DIR *directory = opendir(path);
  if (!directory) return errno == ENOENT ? 0 : errno;
  char **names = NULL;
  size_t count = 0, capacity = 0;
  struct dirent *entry;
  int error = 0;
  while ((entry = readdir(directory))) {
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    if (count == capacity) {
      size_t next = capacity ? capacity * 2 : 16;
      char **grown = realloc(names, next * sizeof(*names));
      if (!grown) { error = ENOMEM; break; }
      names = grown; capacity = next;
    }
    names[count] = strdup(entry->d_name);
    if (!names[count]) { error = ENOMEM; break; }
    count++;
  }
  closedir(directory);
  if (error) {
    for (size_t i = 0; i < count; i++) free(names[i]);
    free(names); return error;
  }
  qsort(names, count, sizeof(*names), cq_name_compare);
  size_t total = 0;
  for (size_t i = 0; i < count; i++) total += strlen(names[i]) + 1;
  char *text = malloc(total ? total : 1);
  if (!text) {
    for (size_t i = 0; i < count; i++) free(names[i]);
    free(names); return ENOMEM;
  }
  size_t at = 0;
  for (size_t i = 0; i < count; i++) {
    size_t length_name = strlen(names[i]);
    memcpy(text + at, names[i], length_name); at += length_name;
    text[at++] = '\n';
    free(names[i]);
  }
  free(names);
  *out = text; *length = at;
  return 0;
}

static int cq_parse_argv(const char *text, size_t length, char ***out, int *count) {
  if (!text || !length) return EINVAL;
  int items = 0;
  for (size_t i = 0; i < length; i++) if (!text[i]) items++;
  if (!items || text[length - 1]) return EINVAL;
  char **argv = calloc((size_t)items + 2, sizeof(*argv));
  if (!argv) return ENOMEM;
  int index = 0; size_t start = 0;
  for (size_t i = 0; i < length; i++) {
    if (!text[i]) { argv[index++] = (char *)text + start; start = i + 1; }
  }
  argv[index] = NULL;
  *out = argv; *count = index;
  return 0;
}

static int cq_dup_inherit(int fd, int minimum, int cloexec) {
  int copy = fcntl(fd, F_DUPFD, minimum);
  if (copy < 0) return -1;
  if (cloexec) {
    int flags = fcntl(copy, F_GETFD);
    if (flags < 0 || fcntl(copy, F_SETFD, flags | FD_CLOEXEC) < 0) {
      close(copy);
      return -1;
    }
  }
  return copy;
}

static int cq_setup_child_fds(int key_lock, int cgen_lock, int status_write,
                              int *status_out) {
  int key_copy = cq_dup_inherit(key_lock, 10, 0);
  int cgen_copy = cq_dup_inherit(cgen_lock, 10, 0);
  int status_copy = cq_dup_inherit(status_write, 10, 1);
  int error = 0;
  if (key_copy < 0 || cgen_copy < 0 || status_copy < 0) error = errno;
  if (!error) {
    int devnull = open("/dev/null", O_RDWR);
    if (devnull < 0) error = errno;
    else {
      if (dup2(devnull, STDIN_FILENO) < 0 || dup2(devnull, STDOUT_FILENO) < 0 ||
          dup2(devnull, STDERR_FILENO) < 0) error = errno;
      if (devnull > STDERR_FILENO) close(devnull);
    }
  }
  if (!error) {
    long limit = sysconf(_SC_OPEN_MAX);
    if (limit < 1024 || limit > 1048576) limit = 65536;
    for (int fd = 3; fd < (int)limit; fd++) {
      if (fd == key_copy || fd == cgen_copy || fd == status_copy) continue;
      close(fd);
    }
    if (dup2(key_copy, 9) < 0 || dup2(cgen_copy, 8) < 0) error = errno;
    int flags;
    if (!error && ((flags = fcntl(9, F_GETFD)) < 0 ||
                   fcntl(9, F_SETFD, flags & ~FD_CLOEXEC) < 0)) error = errno;
    if (!error && ((flags = fcntl(8, F_GETFD)) < 0 ||
                   fcntl(8, F_SETFD, flags & ~FD_CLOEXEC) < 0)) error = errno;
  }
  if (key_copy >= 0) close(key_copy);
  if (cgen_copy >= 0) close(cgen_copy);
  if (error) {
    /* Keep the duplicate status descriptor open so the child can report the
       late setup failure after the close-all loop. */
    *status_out = status_copy;
    return error;
  }
  *status_out = status_copy;
  return 0;
}

static int cq_spawn_detached(const char *argv_text, size_t argv_length,
                             u32 key_lock, u32 cgen_lock, pid_t *pid_out) {
  char **parsed = NULL; int count = 0;
  int error = cq_parse_argv(argv_text, argv_length, &parsed, &count);
  if (error) return error;
  char *self = NULL;
  error = cq_self_path(&self);
  if (error) { free(parsed); return error; }
  int prepend = parsed[0][0] != '/';
  char **argv = calloc((size_t)count + (prepend ? 2 : 1), sizeof(*argv));
  if (!argv) { free(parsed); free(self); return ENOMEM; }
  int at = 0;
  if (prepend) argv[at++] = self;
  for (int i = 0; i < count; i++) argv[at++] = parsed[i];
  argv[at] = NULL;
  const char *exec = argv[0];
  int status[2];
  if (pipe(status)) { free(argv); free(parsed); free(self); return errno; }
  fcntl(status[0], F_SETFD, FD_CLOEXEC);
  fcntl(status[1], F_SETFD, FD_CLOEXEC);
  cq_set_inheritable((int)key_lock);
  cq_set_inheritable((int)cgen_lock);
  pid_t child = fork();
  if (child < 0) {
    error = errno; close(status[0]); close(status[1]);
    free(argv); free(parsed); free(self); return error;
  }
  if (child == 0) {
    close(status[0]);
    if (setsid() < 0) {
      int child_error = errno;
      write(status[1], &child_error, sizeof(child_error));
      _exit(127);
    }
    int child_error = 0;
    int status_fd = -1;
    child_error = cq_setup_child_fds((int)key_lock, (int)cgen_lock, status[1], &status_fd);
    if (child_error) {
      write(status_fd >= 0 ? status_fd : status[1], &child_error, sizeof(child_error));
      _exit(127);
    }
    execve(exec, argv, environ);
    child_error = errno;
    write(status_fd >= 0 ? status_fd : status[1], &child_error, sizeof(child_error));
    _exit(127);
  }
  close(status[1]);
  int child_error = 0;
  ssize_t got;
  do { got = read(status[0], &child_error, sizeof(child_error)); } while (got < 0 && errno == EINTR);
  close(status[0]);
  if (got > 0) {
    int status_value = 0;
    while (waitpid(child, &status_value, 0) < 0 && errno == EINTR) {}
    free(argv); free(parsed); free(self);
    return child_error ? child_error : EIO;
  }
  *pid_out = child;
  free(argv); free(parsed); free(self);
  return 0;
}

static volatile sig_atomic_t cq_cancel_signal = 0;

static void cq_forward_signal(int sig) {
  cq_cancel_signal = sig;
}

static int cq_run_command(const char *argv_text, size_t argv_length, const char *cwd,
                          const char *stdout_path, const char *stderr_path,
                          u32 *code, int *disposition) {
  char **parsed = NULL; int count = 0;
  int error = cq_parse_argv(argv_text, argv_length, &parsed, &count);
  if (error) return error;
  int out = open(stdout_path, O_WRONLY | O_CREAT | O_APPEND, 0660);
  if (out < 0) { error = errno; free(parsed); return error; }
  int err = open(stderr_path, O_WRONLY | O_CREAT | O_APPEND, 0660);
  if (err < 0) { error = errno; close(out); free(parsed); return error; }
  int status[2];
  if (pipe(status)) {
    error = errno; close(out); close(err); free(parsed); return error;
  }
  fcntl(status[0], F_SETFD, FD_CLOEXEC);
  fcntl(status[1], F_SETFD, FD_CLOEXEC);
  struct sigaction action, old_term, old_int, old_hup;
  memset(&action, 0, sizeof(action));
  action.sa_handler = cq_forward_signal;
  sigemptyset(&action.sa_mask);
  cq_cancel_signal = 0;
  sigaction(SIGTERM, &action, &old_term);
  sigaction(SIGINT, &action, &old_int);
  sigaction(SIGHUP, &action, &old_hup);
  pid_t child = fork();
  if (child < 0) {
    error = errno;
    sigaction(SIGTERM, &old_term, NULL);
    sigaction(SIGINT, &old_int, NULL);
    sigaction(SIGHUP, &old_hup, NULL);
    close(status[0]); close(status[1]);
    close(out); close(err); free(parsed); return error;
  }
  if (child == 0) {
    close(status[0]);
    signal(SIGTERM, SIG_DFL);
    signal(SIGINT, SIG_DFL);
    signal(SIGHUP, SIG_DFL);
    int devnull = open("/dev/null", O_RDONLY);
    if (devnull < 0 || dup2(devnull, STDIN_FILENO) < 0 ||
        dup2(out, STDOUT_FILENO) < 0 || dup2(err, STDERR_FILENO) < 0) {
      int child_error = errno;
      write(status[1], &child_error, sizeof(child_error));
      _exit(127);
    }
    if (devnull > STDERR_FILENO) close(devnull);
    close(out); close(err);
    long limit = sysconf(_SC_OPEN_MAX);
    if (limit < 1024 || limit > 1048576) limit = 65536;
    for (int fd = 3; fd < (int)limit; fd++) {
      if (fd != status[1]) close(fd);
    }
    if (cwd && chdir(cwd)) {
      int child_error = errno;
      write(status[1], &child_error, sizeof(child_error));
      _exit(127);
    }
    execvp(parsed[0], parsed);
    int child_error = errno;
    write(status[1], &child_error, sizeof(child_error));
    _exit(127);
  }
  close(status[1]);
  int child_error = 0;
  ssize_t got;
  do { got = read(status[0], &child_error, sizeof(child_error)); } while (got < 0 && errno == EINTR);
  close(status[0]);
  if (got > 0) {
    int status_value = 0;
    while (waitpid(child, &status_value, 0) < 0 && errno == EINTR) {}
    sigaction(SIGTERM, &old_term, NULL);
    sigaction(SIGINT, &old_int, NULL);
    sigaction(SIGHUP, &old_hup, NULL);
    close(out); close(err); free(parsed);
    return child_error ? child_error : EIO;
  }
  int wait_status = 0;
  pid_t waited;
  do { waited = waitpid(child, &wait_status, 0); } while (waited < 0 && errno == EINTR);
  sigaction(SIGTERM, &old_term, NULL);
  sigaction(SIGINT, &old_int, NULL);
  sigaction(SIGHUP, &old_hup, NULL);
  close(out); close(err); free(parsed);
  if (waited < 0) return errno;
  if (cq_cancel_signal) { *code = 130; *disposition = 2; return 0; }
  if (WIFEXITED(wait_status)) { *code = (u32)WEXITSTATUS(wait_status); *disposition = 0; return 0; }
  if (WIFSIGNALED(wait_status)) { *code = (u32)(128 + WTERMSIG(wait_status)); *disposition = 1; return 0; }
  *code = 1; *disposition = 1;
  return 0;
}

/* Adoption reads the live command through Linux /proc. The portable queue
   operations (run, key, wait, cancel, status) do not use this path. */
static int cq_read_proc_file(u32 pid, const char *name, char **out, size_t *length) {
  char path[64];
  snprintf(path, sizeof(path), "/proc/%u/%s", pid, name);
  return cq_read_path(path, out, length);
}

static int cq_environ_value(u32 pid, const char *name, char **out) {
  char *text = NULL; size_t length = 0;
  int error = cq_read_proc_file(pid, "environ", &text, &length);
  if (error) return error;
  size_t name_length = strlen(name);
  char *value = NULL;
  size_t at = 0;
  while (at < length) {
    size_t end = at;
    while (end < length && text[end]) end++;
    if (end > at && end - at > name_length && !strncmp(text + at, name, name_length) &&
        text[at + name_length] == '=') {
      size_t value_length = end - (at + name_length + 1);
      value = malloc(value_length + 1);
      if (!value) { free(text); return ENOMEM; }
      memcpy(value, text + at + name_length + 1, value_length);
      value[value_length] = 0;
      break;
    }
    at = end + 1;
  }
  free(text);
  if (!value) return ENOENT;
  *out = value;
  return 0;
}

/* ---- effect calls ------------------------------------------------------- */

static void cq_call_starttime(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  call->error = cq_starttime_text(call->pid, &call->out);
  if (!call->error) call->out_length = strlen(call->out);
}

static void cq_call_alive(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  call->error = cq_alive_value(call->pid, call->text, &call->code);
}

static void cq_call_wait_external(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  for (;;) {
    u32 alive = 0;
    call->error = cq_alive_value(call->pid, call->text, &alive);
    if (call->error || !alive) return;
    struct timespec delay = {5, 0}, remaining = delay;
    while (nanosleep(&remaining, &remaining) < 0) {
      if (errno == EINTR) continue;
      call->error = errno;
      return;
    }
  }
}

static void cq_call_signal_group(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  if (kill(-(pid_t)call->pid, (int)call->sig) && errno != ESRCH) call->error = errno;
}

static void cq_call_signal_pid(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  if (kill((pid_t)call->pid, (int)call->sig) && errno != ESRCH) call->error = errno;
}

static void cq_call_lock_open(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  call->error = cq_lock_open(call->path, &call->code);
}

static void cq_call_lock_acquire(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  call->error = cq_lock_acquire(call->path, &call->code);
}

static void cq_call_lock_try(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  int handle = -1;
  call->error = cq_lock_try(call->path, &handle);
  call->code = handle;
}

static void cq_call_lock_fd_acquire(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  call->error = cq_lock_fd_acquire(call->pid);
}

static void cq_call_lock_release(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  if (flock((int)call->pid, LOCK_UN)) call->error = errno;
  if (close((int)call->pid) && !call->error) call->error = errno;
}

static void cq_call_mkdir_p(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  call->error = cq_mkdir_p(call->path);
}

static void cq_call_write_text(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  call->error = cq_write_text(call->path, call->text, strlen(call->text));
}
static void cq_call_write_stderr(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  call->error = cq_write_all_fd(2, call->text, strlen(call->text));
}
static void cq_call_set_env(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  if (setenv(call->path, call->text, 1)) call->error = errno;
}

static void cq_call_read_text(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  call->error = cq_read_path(call->path, &call->out, &call->out_length);
  if (call->error == ENOENT) { call->error = 0; call->out = strdup(""); call->out_length = 0; }
}

static void cq_call_list_dir(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  call->error = cq_list_dir(call->path, &call->out, &call->out_length);
}

static void cq_call_remove(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  if (unlink(call->path) && errno != ENOENT) call->error = errno;
}

static void cq_call_remove_tree(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  call->error = cq_remove_tree(call->path);
}

static void cq_call_copy_file(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  call->error = cq_copy_file(call->path, call->second);
}

static void cq_call_sleep_millis(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  struct timespec request = {.tv_sec = call->millis / 1000,
                             .tv_nsec = (long)(call->millis % 1000) * 1000000L};
  while (nanosleep(&request, &request) < 0) {
    if (errno == EINTR) continue;
    call->error = errno; break;
  }
}

static void cq_call_spawn_detached(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  pid_t pid = 0;
  call->error = cq_spawn_detached(call->argv, call->argv_length, call->key_lock,
                                  call->cgen_lock, &pid);
  call->code = (int)pid;
}

static void cq_call_wait_pid(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  int status = 0; pid_t waited;
  do { waited = waitpid((pid_t)call->pid, &status, 0); } while (waited < 0 && errno == EINTR);
  if (waited < 0) { call->error = errno; return; }
  if (WIFEXITED(status)) call->code = WEXITSTATUS(status);
  else if (WIFSIGNALED(status)) call->code = 128 + WTERMSIG(status);
  else call->code = 1;
}

static void cq_call_run_command(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  u32 code = 0; int disposition = 0;
  call->error = cq_run_command(call->argv, call->argv_length, call->cwd,
                               call->stdout_path, call->stderr_path, &code, &disposition);
  call->code = (int)code; call->disposition = disposition;
}

static void cq_call_cmdline(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  call->error = cq_read_proc_file(call->pid, "cmdline", &call->out, &call->out_length);
}

static void cq_call_environ(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  call->error = cq_environ_value(call->pid, call->text, &call->out);
  if (!call->error) call->out_length = strlen(call->out);
}

static void cq_call_cwd_of_pid(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
#ifdef __APPLE__
  char path[PROC_PIDPATHINFO_MAXSIZE];
  int length = proc_pidinfo((int)call->pid, PROC_PIDVNODEPATHINFO, 0, path, sizeof(path));
  if (length <= 0) call->error = errno ? errno : ESRCH;
  else {
    struct proc_vnodepathinfo *info = (struct proc_vnodepathinfo *)path;
    call->out = strdup(info->pvi_cdir.vip_path);
    if (!call->out) call->error = ENOMEM;
    else call->out_length = strlen(call->out);
  }
#else
  char link[64];
  snprintf(link, sizeof(link), "/proc/%u/cwd", call->pid);
  char buffer[PATH_MAX];
  ssize_t length = readlink(link, buffer, sizeof(buffer) - 1);
  if (length < 0) call->error = errno;
  else {
    buffer[length] = 0;
    call->out = strdup(buffer);
    if (!call->out) call->error = ENOMEM;
    else call->out_length = (size_t)length;
  }
#endif
}

/* ---- immediate effects -------------------------------------------------- */

#ifdef CID_COMPILEQUEUELIFECYCLE_SELF_EXE
static Term cq_self_exe_run(Env env, Term *fields, IoWork *work) {
  (void)fields; (void)work;
  char *path = NULL;
  int error = cq_self_path(&path);
  if (error) return io_fail(env, error, NULL);
  Term result = io_done(env, io_str(env, path, strlen(path)));
  free(path);
  return result;
}
static void __attribute__((constructor)) cq_self_exe_use(void) {
  io_eff(CID_COMPILEQUEUELIFECYCLE_SELF_EXE, cq_self_exe_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_PID
static Term cq_pid_run(Env env, Term *fields, IoWork *work) {
  (void)fields; (void)work;
  return io_done(env, (Term)(u32)getpid());
}
static void __attribute__((constructor)) cq_pid_use(void) {
  io_eff(CID_COMPILEQUEUELIFECYCLE_PID, cq_pid_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_UID
static Term cq_uid_run(Env env, Term *fields, IoWork *work) {
  (void)fields; (void)work;
  return io_done(env, (Term)(u32)getuid());
}
static void __attribute__((constructor)) cq_uid_use(void) {
  io_eff(CID_COMPILEQUEUELIFECYCLE_UID, cq_uid_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_CWD
static Term cq_cwd_run(Env env, Term *fields, IoWork *work) {
  (void)fields; (void)work;
  char buffer[PATH_MAX];
  if (!getcwd(buffer, sizeof(buffer))) return io_fail(env, errno, NULL);
  return io_done(env, io_str(env, buffer, strlen(buffer)));
}
static void __attribute__((constructor)) cq_cwd_use(void) {
  io_eff(CID_COMPILEQUEUELIFECYCLE_CWD, cq_cwd_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_NOW_NS
static Term cq_now_ns_run(Env env, Term *fields, IoWork *work) {
  (void)fields; (void)work;
  char *text = NULL;
  int error = cq_now_text(CLOCK_REALTIME, &text);
  if (error) return io_fail(env, error, NULL);
  Term result = io_done(env, io_str(env, text, strlen(text)));
  free(text);
  return result;
}
static void __attribute__((constructor)) cq_now_ns_use(void) {
  io_eff(CID_COMPILEQUEUELIFECYCLE_NOW_NS, cq_now_ns_run, 0);
}
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_MONOTONIC_NS
static Term cq_monotonic_ns_run(Env env, Term *fields, IoWork *work) {
  (void)fields; (void)work;
  char *text = NULL;
  int error = cq_now_text(CLOCK_MONOTONIC, &text);
  if (error) return io_fail(env, error, NULL);
  Term result = io_done(env, io_str(env, text, strlen(text)));
  free(text);
  return result;
}
static void __attribute__((constructor)) cq_monotonic_ns_use(void) {
  io_eff(CID_COMPILEQUEUELIFECYCLE_MONOTONIC_NS, cq_monotonic_ns_run, 0);
}
#endif

/* ---- work effects ------------------------------------------------------- */



#ifdef CID_COMPILEQUEUELIFECYCLE_STARTTIME
static void cq_starttime_call(IoWork *work) { cq_call_starttime(work); }
static Term cq_starttime_pack(Env env, IoWork *work) { return cq_text_pack(env, work); }
static Term cq_starttime_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->pid = (u32)fields[0];
  work->data = (char *)call;
  return io_work(work, cq_starttime_call, cq_starttime_pack);
}
static void __attribute__((constructor)) cq_starttime_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_STARTTIME, cq_starttime_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_ALIVE
static void cq_alive_call(IoWork *work) { cq_call_alive(work); }
static Term cq_alive_pack(Env env, IoWork *work) { return cq_u32_pack(env, work); }
static Term cq_alive_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->pid = (u32)fields[0];
  call->error = cq_text_arg(env, fields[1], &call->text);
  work->data = (char *)call;
  if (call->error) return cq_alive_pack(env, work);
  return io_work(work, cq_alive_call, cq_alive_pack);
}
static void __attribute__((constructor)) cq_alive_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_ALIVE, cq_alive_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_WAIT_EXTERNAL
static void cq_wait_external_call(IoWork *work) { cq_call_wait_external(work); }
static Term cq_wait_external_pack(Env env, IoWork *work) { return cq_unit_pack(env, work); }
static Term cq_wait_external_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->pid = (u32)fields[0];
  call->error = cq_text_arg(env, fields[1], &call->text);
  work->data = (char *)call;
  if (call->error) return cq_wait_external_pack(env, work);
  return io_work(work, cq_wait_external_call, cq_wait_external_pack);
}
static void __attribute__((constructor)) cq_wait_external_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_WAIT_EXTERNAL, cq_wait_external_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_SIGNAL_GROUP
static void cq_signal_group_call(IoWork *work) { cq_call_signal_group(work); }
static Term cq_signal_group_pack(Env env, IoWork *work) { return cq_unit_pack(env, work); }
static Term cq_signal_group_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->pid = (u32)fields[0]; call->sig = (u32)fields[1];
  work->data = (char *)call;
  return io_work(work, cq_signal_group_call, cq_signal_group_pack);
}
static void __attribute__((constructor)) cq_signal_group_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_SIGNAL_GROUP, cq_signal_group_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_SIGNAL_PID
static void cq_signal_pid_call(IoWork *work) { cq_call_signal_pid(work); }
static Term cq_signal_pid_pack(Env env, IoWork *work) { return cq_unit_pack(env, work); }
static Term cq_signal_pid_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->pid = (u32)fields[0]; call->sig = (u32)fields[1];
  work->data = (char *)call;
  return io_work(work, cq_signal_pid_call, cq_signal_pid_pack);
}
static void __attribute__((constructor)) cq_signal_pid_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_SIGNAL_PID, cq_signal_pid_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_LOCK_OPEN
static void cq_lock_open_call(IoWork *work) { cq_call_lock_open(work); }
static Term cq_lock_open_pack(Env env, IoWork *work) { return cq_u32_pack(env, work); }
static Term cq_lock_open_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_text_arg(env, fields[0], &call->path);
  work->data = (char *)call;
  if (call->error) return cq_lock_open_pack(env, work);
  return io_work(work, cq_lock_open_call, cq_lock_open_pack);
}
static void __attribute__((constructor)) cq_lock_open_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_LOCK_OPEN, cq_lock_open_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_LOCK_ACQUIRE
static void cq_lock_acquire_call(IoWork *work) { cq_call_lock_acquire(work); }
static Term cq_lock_acquire_pack(Env env, IoWork *work) { return cq_u32_pack(env, work); }
static Term cq_lock_acquire_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_text_arg(env, fields[0], &call->path);
  work->data = (char *)call;
  if (call->error) return cq_lock_acquire_pack(env, work);
  return io_work(work, cq_lock_acquire_call, cq_lock_acquire_pack);
}
static void __attribute__((constructor)) cq_lock_acquire_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_LOCK_ACQUIRE, cq_lock_acquire_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_LOCK_TRY
static void cq_lock_try_call(IoWork *work) { cq_call_lock_try(work); }
static Term cq_lock_try_pack(Env env, IoWork *work) { return cq_maybe_u32_pack(env, work); }
static Term cq_lock_try_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_text_arg(env, fields[0], &call->path);
  work->data = (char *)call;
  if (call->error) return cq_lock_try_pack(env, work);
  return io_work(work, cq_lock_try_call, cq_lock_try_pack);
}
static void __attribute__((constructor)) cq_lock_try_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_LOCK_TRY, cq_lock_try_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_LOCK_FD_ACQUIRE
static void cq_lock_fd_acquire_call(IoWork *work) { cq_call_lock_fd_acquire(work); }
static Term cq_lock_fd_acquire_pack(Env env, IoWork *work) { return cq_unit_pack(env, work); }
static Term cq_lock_fd_acquire_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->pid = (u32)fields[0];
  work->data = (char *)call;
  return io_work(work, cq_lock_fd_acquire_call, cq_lock_fd_acquire_pack);
}
static void __attribute__((constructor)) cq_lock_fd_acquire_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_LOCK_FD_ACQUIRE, cq_lock_fd_acquire_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_LOCK_RELEASE
static void cq_lock_release_call(IoWork *work) { cq_call_lock_release(work); }
static Term cq_lock_release_pack(Env env, IoWork *work) { return cq_unit_pack(env, work); }
static Term cq_lock_release_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->pid = (u32)fields[0];
  work->data = (char *)call;
  return io_work(work, cq_lock_release_call, cq_lock_release_pack);
}
static void __attribute__((constructor)) cq_lock_release_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_LOCK_RELEASE, cq_lock_release_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_CLOSE_FD
static Term cq_close_fd_run(Env env, Term *fields, IoWork *work) {
  (void)work;
  int fd = (int)fields[0];
  if (fd >= 0 && close(fd)) return io_fail(env, errno, NULL);
  return io_done(env, term_pak(CID_UNIT, 0));
}
static void __attribute__((constructor)) cq_close_fd_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_CLOSE_FD, cq_close_fd_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_MKDIR_P
static void cq_mkdir_p_call(IoWork *work) { cq_call_mkdir_p(work); }
static Term cq_mkdir_p_pack(Env env, IoWork *work) { return cq_unit_pack(env, work); }
static Term cq_mkdir_p_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_text_arg(env, fields[0], &call->path);
  work->data = (char *)call;
  if (call->error) return cq_mkdir_p_pack(env, work);
  return io_work(work, cq_mkdir_p_call, cq_mkdir_p_pack);
}
static void __attribute__((constructor)) cq_mkdir_p_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_MKDIR_P, cq_mkdir_p_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_WRITE_TEXT
static void cq_write_text_call(IoWork *work) { cq_call_write_text(work); }
static Term cq_write_text_pack(Env env, IoWork *work) { return cq_unit_pack(env, work); }
static Term cq_write_text_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_text_arg(env, fields[0], &call->path);
  if (!call->error) call->error = cq_text_arg(env, fields[1], &call->text);
  work->data = (char *)call;
  if (call->error) return cq_write_text_pack(env, work);
  return io_work(work, cq_write_text_call, cq_write_text_pack);
}
static void __attribute__((constructor)) cq_write_text_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_WRITE_TEXT, cq_write_text_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_WRITE_STDERR
static void cq_write_stderr_call(IoWork *work) { cq_call_write_stderr(work); }
static Term cq_write_stderr_pack(Env env, IoWork *work) { return cq_unit_pack(env, work); }
static Term cq_write_stderr_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_text_arg(env, fields[0], &call->text);
  work->data = (char *)call;
  if (call->error) return cq_write_stderr_pack(env, work);
  return io_work(work, cq_write_stderr_call, cq_write_stderr_pack);
}
static void __attribute__((constructor)) cq_write_stderr_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_WRITE_STDERR, cq_write_stderr_run, 0); }
#endif
#ifdef CID_COMPILEQUEUELIFECYCLE_SET_ENV
static void cq_set_env_call(IoWork *work) { cq_call_set_env(work); }
static Term cq_set_env_pack(Env env, IoWork *work) { return cq_unit_pack(env, work); }
static Term cq_set_env_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_text_arg(env, fields[0], &call->path);
  if (!call->error) call->error = cq_text_arg(env, fields[1], &call->text);
  work->data = (char *)call;
  if (call->error) return cq_set_env_pack(env, work);
  return io_work(work, cq_set_env_call, cq_set_env_pack);
}
static void __attribute__((constructor)) cq_set_env_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_SET_ENV, cq_set_env_run, 0); }
#endif


#ifdef CID_COMPILEQUEUELIFECYCLE_READ_TEXT
static void cq_read_text_call(IoWork *work) { cq_call_read_text(work); }
static Term cq_read_text_pack(Env env, IoWork *work) { return cq_text_pack(env, work); }
static Term cq_read_text_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_text_arg(env, fields[0], &call->path);
  work->data = (char *)call;
  if (call->error) return cq_read_text_pack(env, work);
  return io_work(work, cq_read_text_call, cq_read_text_pack);
}
static void __attribute__((constructor)) cq_read_text_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_READ_TEXT, cq_read_text_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_LIST_DIR
static void cq_list_dir_call(IoWork *work) { cq_call_list_dir(work); }
static Term cq_list_dir_pack(Env env, IoWork *work) { return cq_text_pack(env, work); }
static Term cq_list_dir_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_text_arg(env, fields[0], &call->path);
  work->data = (char *)call;
  if (call->error) return cq_list_dir_pack(env, work);
  return io_work(work, cq_list_dir_call, cq_list_dir_pack);
}
static void __attribute__((constructor)) cq_list_dir_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_LIST_DIR, cq_list_dir_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_REMOVE
static void cq_remove_call(IoWork *work) { cq_call_remove(work); }
static Term cq_remove_pack(Env env, IoWork *work) { return cq_unit_pack(env, work); }
static Term cq_remove_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_text_arg(env, fields[0], &call->path);
  work->data = (char *)call;
  if (call->error) return cq_remove_pack(env, work);
  return io_work(work, cq_remove_call, cq_remove_pack);
}
static void __attribute__((constructor)) cq_remove_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_REMOVE, cq_remove_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_REMOVE_TREE
static void cq_remove_tree_call(IoWork *work) { cq_call_remove_tree(work); }
static Term cq_remove_tree_pack(Env env, IoWork *work) { return cq_unit_pack(env, work); }
static Term cq_remove_tree_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_text_arg(env, fields[0], &call->path);
  work->data = (char *)call;
  if (call->error) return cq_remove_tree_pack(env, work);
  return io_work(work, cq_remove_tree_call, cq_remove_tree_pack);
}
static void __attribute__((constructor)) cq_remove_tree_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_REMOVE_TREE, cq_remove_tree_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_COPY_FILE
static void cq_copy_file_call(IoWork *work) { cq_call_copy_file(work); }
static Term cq_copy_file_pack(Env env, IoWork *work) { return cq_unit_pack(env, work); }
static Term cq_copy_file_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_text_arg(env, fields[0], &call->path);
  if (!call->error) call->error = cq_text_arg(env, fields[1], &call->second);
  work->data = (char *)call;
  if (call->error) return cq_copy_file_pack(env, work);
  return io_work(work, cq_copy_file_call, cq_copy_file_pack);
}
static void __attribute__((constructor)) cq_copy_file_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_COPY_FILE, cq_copy_file_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_SLEEP_MILLIS
static void cq_sleep_millis_call(IoWork *work) { cq_call_sleep_millis(work); }
static Term cq_sleep_millis_pack(Env env, IoWork *work) { return cq_unit_pack(env, work); }
static Term cq_sleep_millis_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->millis = (u32)fields[0];
  work->data = (char *)call;
  return io_work(work, cq_sleep_millis_call, cq_sleep_millis_pack);
}
static void __attribute__((constructor)) cq_sleep_millis_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_SLEEP_MILLIS, cq_sleep_millis_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_SPAWN_DETACHED
static void cq_spawn_detached_call(IoWork *work) { cq_call_spawn_detached(work); }
static Term cq_spawn_detached_pack(Env env, IoWork *work) { return cq_u32_pack(env, work); }
static Term cq_spawn_detached_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_bytes_arg(env, fields[0], &call->argv, &call->argv_length);
  call->key_lock = (u32)fields[1];
  call->cgen_lock = (u32)fields[2];
  work->data = (char *)call;
  if (call->error) return cq_spawn_detached_pack(env, work);
  return io_work(work, cq_spawn_detached_call, cq_spawn_detached_pack);
}
static void __attribute__((constructor)) cq_spawn_detached_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_SPAWN_DETACHED, cq_spawn_detached_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_WAIT_PID
static void cq_wait_pid_call(IoWork *work) { cq_call_wait_pid(work); }
static Term cq_wait_pid_pack(Env env, IoWork *work) { return cq_u32_pack(env, work); }
static Term cq_wait_pid_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->pid = (u32)fields[0];
  work->data = (char *)call;
  return io_work(work, cq_wait_pid_call, cq_wait_pid_pack);
}
static void __attribute__((constructor)) cq_wait_pid_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_WAIT_PID, cq_wait_pid_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_RUN_COMMAND
static void cq_run_command_call(IoWork *work) { cq_call_run_command(work); }
static Term cq_run_command_pack(Env env, IoWork *work) { return cq_pair_pack(env, work); }
static Term cq_run_command_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_bytes_arg(env, fields[0], &call->argv, &call->argv_length);
  if (!call->error) call->error = cq_text_arg(env, fields[1], &call->cwd);
  if (!call->error) call->error = cq_text_arg(env, fields[2], &call->stdout_path);
  if (!call->error) call->error = cq_text_arg(env, fields[3], &call->stderr_path);
  work->data = (char *)call;
  if (call->error) return cq_run_command_pack(env, work);
  return io_work(work, cq_run_command_call, cq_run_command_pack);
}
static void __attribute__((constructor)) cq_run_command_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_RUN_COMMAND, cq_run_command_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_CMDLINE
static void cq_cmdline_call(IoWork *work) { cq_call_cmdline(work); }
static Term cq_cmdline_pack(Env env, IoWork *work) { return cq_text_pack(env, work); }
static Term cq_cmdline_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->pid = (u32)fields[0];
  work->data = (char *)call;
  return io_work(work, cq_cmdline_call, cq_cmdline_pack);
}
static void __attribute__((constructor)) cq_cmdline_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_CMDLINE, cq_cmdline_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_ENVIRON
static void cq_environ_call(IoWork *work) { cq_call_environ(work); }
static Term cq_environ_pack(Env env, IoWork *work) { return cq_text_pack(env, work); }
static Term cq_environ_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->pid = (u32)fields[0];
  call->error = cq_text_arg(env, fields[1], &call->text);
  work->data = (char *)call;
  if (call->error) return cq_environ_pack(env, work);
  return io_work(work, cq_environ_call, cq_environ_pack);
}
static void __attribute__((constructor)) cq_environ_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_ENVIRON, cq_environ_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_CWD_OF_PID
static void cq_cwd_of_pid_call(IoWork *work) { cq_call_cwd_of_pid(work); }
static Term cq_cwd_of_pid_pack(Env env, IoWork *work) { return cq_text_pack(env, work); }
static Term cq_cwd_of_pid_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->pid = (u32)fields[0];
  work->data = (char *)call;
  return io_work(work, cq_cwd_of_pid_call, cq_cwd_of_pid_pack);
}
static void __attribute__((constructor)) cq_cwd_of_pid_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_CWD_OF_PID, cq_cwd_of_pid_run, 0); }
#endif
