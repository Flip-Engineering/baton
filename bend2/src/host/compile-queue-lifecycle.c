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
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/resource.h>
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
  if (error == ESRCH) {
#ifdef __linux__
    /* The /proc of another user's service can hide processes. A signal check is
       not hidden: a process that has no /proc entry for this caller but answers
       it exists. Its start time cannot be compared, so it counts as alive. A
       zombie keeps its /proc entry and is dead. */
    char entry[64];
    snprintf(entry, sizeof(entry), "/proc/%u", pid);
    if (access(entry, F_OK) && errno == ENOENT && (kill((pid_t)pid, 0) == 0 || errno == EPERM)) *alive = 1;
#endif
    return 0;
  }
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
                             u32 key_lock, u32 cgen_lock, char *const *envp, pid_t *pid_out) {
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
    execve(exec, argv, envp ? envp : environ);
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

/* ---- admission by measured memory --------------------------------------- */

/* Jobs are admitted by memory instead of one host-wide lock. The state root
   holds these records, each rewritten from durable sources after a crash:

     admission/lock              serializes every read and write below
     admission/waiting/<ticket>  one ticket per waiting supervisor
     admission/running/<claim>   one claim per admitted job; the claim file
                                 is the custody lock and the supervisor and
                                 its command hold it as descriptor 8
     admission/observed          process measurements, at most one second old
     outside-growth              largest rise of memory used outside the queue
                                 seen during one run
     peaks/<group>               largest recorded peak of one kind, compiler, entry
                                 and command
     peaks/sh.<kind>.<shape>     largest recorded peak of one kind, entry and command
                                 shape on any compiler
     peaks/kc.<kind>.<compiler>  largest recorded peak of one kind and compiler
     peaks/k.<kind>              largest recorded peak of one kind
     keys/<key>/peak             largest recorded peak of one key
     keys/<key>/runs/<run>/peak  measured peak of one run

   A claim is live while any process holds its descriptor. The marker watcher
   unlocks that descriptor when the compiler finishes, so a finished compiler
   stops reserving memory. Sizes are kibibytes. */

#define CQ_POLL_NS 200000000L
#define CQ_OBSERVE_AGE_NS 1000000000ULL
#define CQ_SAMPLE_NS 2000000000ULL
#define CQ_ID 128
#define CQ_NAME 96
#define CQ_ENTRY 256

typedef struct {
  char id[CQ_ID], start[32], key[CQ_NAME], group[CQ_NAME], entry[CQ_ENTRY];
  int pid, root, tree, history, backfill;
  long long expected, current;
  unsigned long long admitted;
} CqClaim;

typedef struct {
  char id[CQ_ID], start[32], key[CQ_NAME], group[CQ_NAME], entry[CQ_ENTRY];
  char compiler[CQ_NAME], kind[16], shape[24];
  int pid, history;
  long long expected;
  unsigned long long queued;
} CqTicket;

typedef struct {
  CqClaim *claims; size_t claim_count;
  CqTicket *tickets; size_t ticket_count;
  int legacy_pid, legacy_tree;
  char legacy_entry[CQ_ENTRY];
  long long legacy_current;
  long long total, available;
  long long reserve;
  int memory_known;
  int unreliable;
} CqAdmission;

typedef struct { int pid, ppid, sid; } CqProc;

static unsigned long long cq_clock_ns(clockid_t clock) {
  struct timespec value;
  if (clock_gettime(clock, &value)) return 0;
  return (unsigned long long)value.tv_sec * 1000000000ull + (unsigned long long)value.tv_nsec;
}

static void cq_sleep_ns(long nanoseconds) {
  struct timespec request = {.tv_sec = nanoseconds / 1000000000L,
                             .tv_nsec = nanoseconds % 1000000000L};
  while (nanosleep(&request, &request) < 0 && errno == EINTR) {}
}

static int cq_read_small(const char *path, char *buffer, size_t capacity) {
  int fd = open(path, O_RDONLY);
  if (fd < 0) return errno;
  size_t used = 0;
  for (;;) {
    ssize_t got = read(fd, buffer + used, capacity - 1 - used);
    if (got < 0) { if (errno == EINTR) continue; int error = errno; close(fd); return error; }
    if (got == 0) break;
    used += (size_t)got;
    if (used + 1 >= capacity) break;
  }
  close(fd);
  buffer[used] = 0;
  return 0;
}

static int cq_field(const char *text, const char *name, char *out, size_t capacity) {
  size_t length = strlen(name);
  const char *at = text;
  while (*at) {
    if (!strncmp(at, name, length) && at[length] == '=') {
      const char *value = at + length + 1;
      size_t size = strcspn(value, "\n");
      if (size >= capacity) size = capacity - 1;
      memcpy(out, value, size); out[size] = 0;
      return 1;
    }
    const char *next = strchr(at, '\n');
    if (!next) break;
    at = next + 1;
  }
  out[0] = 0;
  return 0;
}

static long long cq_field_number(const char *text, const char *name, long long fallback) {
  char value[48];
  if (!cq_field(text, name, value, sizeof(value)) || !*value) return fallback;
  char *end = NULL; errno = 0;
  long long number = strtoll(value, &end, 10);
  return (errno || end == value) ? fallback : number;
}

static int cq_path(char *out, const char *format, ...) __attribute__((format(printf, 2, 3)));
static int cq_path(char *out, const char *format, ...) {
  va_list args; va_start(args, format);
  int written = vsnprintf(out, PATH_MAX, format, args);
  va_end(args);
  return (written < 0 || written >= PATH_MAX) ? ENAMETOOLONG : 0;
}

/* The attempt is <state>/keys/<key>/runs/<run>. */
static int cq_attempt_parts(const char *attempt, char *state, char *keydir, char *key) {
  char copy[PATH_MAX];
  if (strlen(attempt) >= sizeof(copy)) return ENAMETOOLONG;
  strcpy(copy, attempt);
  size_t length = strlen(copy);
  while (length > 1 && copy[length - 1] == '/') copy[--length] = 0;
  char *run = strrchr(copy, '/');
  if (!run) return EINVAL;
  *run = 0;
  char *runs = strrchr(copy, '/');
  if (!runs || strcmp(runs, "/runs")) return EINVAL;
  *runs = 0;
  if (cq_path(keydir, "%s", copy)) return ENAMETOOLONG;
  char *name = strrchr(copy, '/');
  if (!name) return EINVAL;
  snprintf(key, CQ_NAME, "%s", name + 1);
  *name = 0;
  char *keys = strrchr(copy, '/');
  if (!keys || strcmp(keys, "/keys")) return EINVAL;
  *keys = 0;
  return cq_path(state, "%s", copy);
}

/* Total and available memory. Other platforms report no measurement and the
   queue admits one job at a time there. */
static int cq_meminfo(long long *total, long long *available) {
#ifdef __linux__
  char text[8192];
  if (cq_read_small("/proc/meminfo", text, sizeof(text))) return EIO;
  const char *a = strstr(text, "MemTotal:");
  const char *b = strstr(text, "MemAvailable:");
  if (!a || !b) return ENOENT;
  *total = strtoll(a + 9, NULL, 10);
  *available = strtoll(b + 13, NULL, 10);
  return *total > 0 ? 0 : ENOENT;
#else
  (void)total; (void)available;
  return ENOSYS;
#endif
}

#ifdef __linux__
static int cq_proc_by_pid(const void *left, const void *right) {
  return ((const CqProc *)left)->pid - ((const CqProc *)right)->pid;
}

static int cq_proc_table(CqProc **out, size_t *count) {
  DIR *directory = opendir("/proc");
  if (!directory) return errno;
  size_t capacity = 1024, used = 0;
  CqProc *table = malloc(capacity * sizeof(*table));
  if (!table) { closedir(directory); return ENOMEM; }
  struct dirent *entry;
  while ((entry = readdir(directory))) {
    char *end = NULL;
    long pid = strtol(entry->d_name, &end, 10);
    if (*end || pid <= 0) continue;
    char path[64], line[1024];
    snprintf(path, sizeof(path), "/proc/%ld/stat", pid);
    if (cq_read_small(path, line, sizeof(line))) continue;
    char *close_paren = strrchr(line, ')');
    if (!close_paren) continue;
    char state; int ppid, pgrp, sid;
    if (sscanf(close_paren + 2, "%c %d %d %d", &state, &ppid, &pgrp, &sid) != 4) continue;
    if (state == 'Z' || state == 'X') continue;
    if (used == capacity) {
      CqProc *grown = realloc(table, capacity * 2 * sizeof(*table));
      if (!grown) { free(table); closedir(directory); return ENOMEM; }
      table = grown; capacity *= 2;
    }
    table[used].pid = (int)pid; table[used].ppid = ppid; table[used].sid = sid;
    used++;
  }
  closedir(directory);
  qsort(table, used, sizeof(*table), cq_proc_by_pid);
  *out = table; *count = used;
  return 0;
}

/* Anonymous and shared resident memory: the part the kernel cannot drop. */
static long long cq_process_kb(int pid) {
  char path[64], text[4096];
  snprintf(path, sizeof(path), "/proc/%d/status", pid);
  if (cq_read_small(path, text, sizeof(text))) return 0;
  long long anon = 0, shared = 0, resident = 0;
  const char *at;
  if ((at = strstr(text, "RssAnon:"))) anon = strtoll(at + 8, NULL, 10);
  if ((at = strstr(text, "RssShmem:"))) shared = strtoll(at + 9, NULL, 10);
  if ((at = strstr(text, "VmRSS:"))) resident = strtoll(at + 6, NULL, 10);
  return (anon || shared) ? anon + shared : resident;
}

/* Sum of the memory of every process in the session of root, or of root and
   its descendants. members reports how many processes were found. The table
   is sorted by pid. */
static long long cq_measure(CqProc *table, size_t count, int root, int tree, int *members) {
  long long total = 0; int found = 0;
  char *marked = calloc(count ? count : 1, 1);
  if (!marked) { *members = 0; return 0; }
  if (tree) {
    /* 0 unknown, 1 member, 2 outside; each chain is walked once. */
    for (size_t i = 0; i < count; i++) {
      size_t path[256]; size_t depth = 0; size_t at = i; char verdict = 2;
      while (depth < 256) {
        if (marked[at]) { verdict = marked[at]; break; }
        path[depth++] = at;
        if (table[at].pid == root) { verdict = 1; break; }
        CqProc key = {.pid = table[at].ppid};
        CqProc *parent = bsearch(&key, table, count, sizeof(*table), cq_proc_by_pid);
        if (!parent) { verdict = 2; break; }
        at = (size_t)(parent - table);
      }
      for (size_t k = 0; k < depth; k++) marked[path[k]] = verdict;
    }
    for (size_t i = 0; i < count; i++) marked[i] = marked[i] == 1;
  } else {
    for (size_t i = 0; i < count; i++) marked[i] = table[i].sid == root;
  }
  for (size_t i = 0; i < count; i++) {
    if (!marked[i]) continue;
    found++;
    total += cq_process_kb(table[i].pid);
  }
  free(marked);
  *members = found;
  return total;
}

/* One /proc/locks holder of the old shared lock, as left by a queue that has
   not been replaced. */
static int cq_legacy_holder(const char *state, int *pid) {
  char path[PATH_MAX];
  struct stat info;
  if (cq_path(path, "%s/heavy.lock", state) || stat(path, &info)) return 0;
  FILE *locks = fopen("/proc/locks", "r");
  if (!locks) return 0;
  char line[512];
  int found = 0;
  while (fgets(line, sizeof(line), locks)) {
    if (strstr(line, "->") || !strstr(line, "FLOCK")) continue;
    char *at = strstr(line, "WRITE");
    if (!at) continue;
    int holder; unsigned major_id, minor_id; unsigned long inode;
    if (sscanf(at + 5, " %d %x:%x:%lu", &holder, &major_id, &minor_id, &inode) != 4) continue;
    if (inode == (unsigned long)info.st_ino) { *pid = holder; found = 1; break; }
  }
  fclose(locks);
  return found;
}
#endif

/* The entry file of the attempt that a supervisor of an older queue runs. */
static void cq_legacy_entry(int pid, char *entry, size_t capacity) {
  char path[64], line[8192], meta[PATH_MAX], text[2048];
  entry[0] = 0;
  snprintf(path, sizeof(path), "/proc/%d/cmdline", pid);
  int fd = open(path, O_RDONLY);
  ssize_t got = fd < 0 ? -1 : read(fd, line, sizeof(line) - 1);
  if (fd >= 0) close(fd);
  if (got <= 0) return;
  line[got] = 0;
  const char *previous = NULL, *last = NULL;
  for (char *at = line; at < line + got; at += strlen(at) + 1) { previous = last; last = at; }
  if (!previous || strcmp(previous, "__supervise") || cq_path(meta, "%s/meta", last)) return;
  if (cq_read_small(meta, text, sizeof(text))) return;
  char value[CQ_ENTRY];
  if (cq_field(text, "entry", value, sizeof(value))) snprintf(entry, capacity, "%s", value);
}

static int cq_admission_dirs(const char *state) {
  char path[PATH_MAX];
  int error;
  /* The waiting directory is sticky: a user can remove only the tickets of own
     supervisors. Another user's loader that cannot see a process would otherwise
     remove its ticket. mkdir keeps the sticky bit and inherits setgid; chmod
     would clear setgid for a caller outside the group. */
  if ((error = cq_path(path, "%s/admission/running", state)) || (error = cq_mkdir_p(path))) return error;
  if ((error = cq_path(path, "%s/admission/waiting", state))) return error;
  mode_t previous = umask(0007);
  int made = mkdir(path, 01770);
  int saved = errno;
  umask(previous);
  if (made && saved != EEXIST) return saved;
  if ((error = cq_mkdir_p(path))) return error;
  if ((error = cq_path(path, "%s/admission/usage", state)) || (error = cq_mkdir_p(path))) return error;
  if ((error = cq_path(path, "%s/peaks", state)) || (error = cq_mkdir_p(path))) return error;
  return 0;
}

static int cq_admission_lock(const char *state, int *fd) {
  char path[PATH_MAX];
  int error = cq_path(path, "%s/admission/lock", state);
  if (error) return error;
  mode_t previous = umask(0007);
  *fd = open(path, O_RDWR | O_CREAT | O_CLOEXEC, 0660);
  int saved = errno;
  umask(previous);
  if (*fd < 0) return saved;
  while (flock(*fd, LOCK_EX) < 0) {
    if (errno == EINTR) continue;
    error = errno; close(*fd); *fd = -1; return error;
  }
  return 0;
}

static void cq_admission_unlock(int fd) {
  if (fd >= 0) close(fd);
}

static int cq_value_load(const char *path, const char *name, long long *value) {
  char text[128];
  *value = -1;
  int error = cq_read_small(path, text, sizeof(text));
  if (error) return error == ENOENT ? 0 : error;
  *value = cq_field_number(text, name, -1);
  return 0;
}

static int cq_peak_load(const char *path, long long *peak) {
  return cq_value_load(path, "peak_kb", peak);
}

/* The shape of an attempt: a hash of its kind, entry file and command in which
   every absolute path is reduced to its file name. The same job with another
   compiler release, in another checkout or with another output directory has the
   same shape; `--check-only` and a full C generation of one entry do not. */
static unsigned long long cq_fnv(unsigned long long hash, const char *data, size_t length) {
  for (size_t i = 0; i < length; i++) { hash ^= (unsigned char)data[i]; hash *= 1099511628211ull; }
  return hash;
}

static int cq_shape(const char *attempt, char *shape, size_t capacity, char *kind, size_t kind_capacity) {
  char path[PATH_MAX], meta[2048], entry[CQ_ENTRY];
  shape[0] = 0;
  if (cq_path(path, "%s/meta", attempt) || cq_read_small(path, meta, sizeof(meta))) return ENOENT;
  cq_field(meta, "kind", kind, kind_capacity);
  cq_field(meta, "entry", entry, sizeof(entry));
  const char *entry_name = entry[0] == '/' ? strrchr(entry, '/') + 1 : entry;
  char head[CQ_ENTRY + 64];
  int head_length = snprintf(head, sizeof(head), "kind=%s\nentry=%s\n", kind, entry_name);
  unsigned long long hash = cq_fnv(14695981039346656037ull, head, (size_t)head_length);
  char *text = NULL; size_t length = 0; int separator = 0;
  if (!cq_path(path, "%s/argv", attempt) && !cq_read_path(path, &text, &length)) separator = 0;
  else if (!cq_path(path, "%s/command", attempt) && !cq_read_path(path, &text, &length)) separator = '\n';
  else return ENOENT;
  size_t at = 0;
  while (at < length) {
    size_t end = at;
    while (end < length && text[end] != (char)separator) end++;
    const char *token = text + at; size_t size = end - at;
    int plain = size > 0 && token[0] == '/';
    for (size_t i = 0; plain && i < size; i++) if (token[i] == ' ' || token[i] == '\n' || token[i] == '\t') plain = 0;
    if (plain) {
      size_t slash = size;
      while (slash > 0 && token[slash - 1] != '/') slash--;
      token += slash; size -= slash;
    }
    hash = cq_fnv(hash, token, size);
    hash = cq_fnv(hash, "\n", 1);
    at = end + 1;
  }
  free(text);
  snprintf(shape, capacity, "%016llx", hash);
  return 0;
}

/* The expected peak of a key: its own recorded peak, otherwise the largest
   recorded peak of its group, otherwise of its kind, entry and command shape on
   any compiler, otherwise of its kind and compiler, otherwise of its kind.
   History is false when none exists. */
static void cq_expected(const char *state, const char *key, const char *group,
                        const char *shape, const char *compiler, const char *kind,
                        long long *expected, int *history) {
  char path[PATH_MAX];
  long long peak = -1;
  *expected = 0; *history = 0;
  if (!cq_path(path, "%s/keys/%s/peak", state, key)) cq_peak_load(path, &peak);
  if (peak < 0 && *group && !cq_path(path, "%s/peaks/%s", state, group)) cq_peak_load(path, &peak);
  if (peak < 0 && *kind && *shape && !cq_path(path, "%s/peaks/sh.%s.%s", state, kind, shape))
    cq_peak_load(path, &peak);
  if (peak < 0 && *kind && *compiler && !cq_path(path, "%s/peaks/kc.%s.%s", state, kind, compiler))
    cq_peak_load(path, &peak);
  if (peak < 0 && *kind && !cq_path(path, "%s/peaks/k.%s", state, kind)) cq_peak_load(path, &peak);
  if (peak >= 0) { *expected = peak; *history = 1; }
}

static int cq_claim_alive(const char *path) {
  int fd = open(path, O_RDONLY | O_CLOEXEC);
  if (fd < 0) return 0;
  int alive = flock(fd, LOCK_SH | LOCK_NB) < 0 && (errno == EWOULDBLOCK || errno == EAGAIN);
  close(fd);
  return alive;
}

static void cq_claim_parse(const char *id, const char *text, CqClaim *claim) {
  char value[64];
  memset(claim, 0, sizeof(*claim));
  snprintf(claim->id, sizeof(claim->id), "%s", id);
  claim->pid = (int)cq_field_number(text, "pid", 0);
  cq_field(text, "starttime", claim->start, sizeof(claim->start));
  claim->root = (int)cq_field_number(text, "root", claim->pid);
  cq_field(text, "measure", value, sizeof(value));
  claim->tree = !strcmp(value, "tree");
  cq_field(text, "key", claim->key, sizeof(claim->key));
  cq_field(text, "group", claim->group, sizeof(claim->group));
  cq_field(text, "entry", claim->entry, sizeof(claim->entry));
  claim->expected = cq_field_number(text, "expected_kb", 0);
  claim->history = (int)cq_field_number(text, "history", 0);
  claim->backfill = (int)cq_field_number(text, "backfill", 0);
  claim->admitted = (unsigned long long)cq_field_number(text, "admitted_ns", 0);
}

static void cq_ticket_parse(const char *id, const char *text, CqTicket *ticket) {
  memset(ticket, 0, sizeof(*ticket));
  snprintf(ticket->id, sizeof(ticket->id), "%s", id);
  ticket->pid = (int)cq_field_number(text, "pid", 0);
  cq_field(text, "starttime", ticket->start, sizeof(ticket->start));
  cq_field(text, "key", ticket->key, sizeof(ticket->key));
  cq_field(text, "group", ticket->group, sizeof(ticket->group));
  cq_field(text, "entry", ticket->entry, sizeof(ticket->entry));
  cq_field(text, "compiler", ticket->compiler, sizeof(ticket->compiler));
  cq_field(text, "kind", ticket->kind, sizeof(ticket->kind));
  cq_field(text, "shape", ticket->shape, sizeof(ticket->shape));
  ticket->queued = (unsigned long long)cq_field_number(text, "queued_ns", 0);
}

static int cq_read_cmdline(int pid, char *line, size_t capacity, char **argv, int *argc);

/* A ticket written by an older build has no shape, kind or compiler. They are
   read from the attempt that the process of the ticket runs. */
static void cq_ticket_complete(CqTicket *ticket) {
  if (*ticket->shape && *ticket->kind) return;
#ifdef __linux__
  char line[8192], *argv[16], path[PATH_MAX], text[1024]; int argc = 0;
  if (!cq_read_cmdline(ticket->pid, line, sizeof(line), argv, &argc)) return;
  const char *attempt = NULL;
  if (argc >= 2 && !strcmp(argv[argc - 2], "__supervise")) attempt = argv[argc - 1];
  else if (argc >= 5 && !strcmp(argv[argc - 5], "__takeover")) attempt = argv[argc - 4];
  if (!attempt) return;
  char kind[16] = "";
  if (!*ticket->shape) cq_shape(attempt, ticket->shape, sizeof(ticket->shape), kind, sizeof(kind));
  if (!*ticket->kind) snprintf(ticket->kind, sizeof(ticket->kind), "%s", kind);
  if (!*ticket->compiler && !cq_path(path, "%s/group", attempt) && !cq_read_small(path, text, sizeof(text)))
    cq_field(text, "compiler", ticket->compiler, sizeof(ticket->compiler));
#endif
}

static void cq_admission_free(CqAdmission *view) {
  free(view->claims); free(view->tickets);
  memset(view, 0, sizeof(*view));
}

static void cq_write_cache(const char *path, const char *text, size_t length) {
  char temporary[PATH_MAX];
  if (snprintf(temporary, sizeof(temporary), "%s.tmp.%d", path, (int)getpid()) >= (int)sizeof(temporary)) return;
  mode_t previous = umask(0007);
  int fd = open(temporary, O_WRONLY | O_CREAT | O_TRUNC, 0660);
  umask(previous);
  if (fd < 0) return;
  int error = cq_write_all_fd(fd, text, length);
  if (close(fd) && !error) error = errno;
  if (error || rename(temporary, path)) unlink(temporary);
}

/* Current memory of each claim and of the old lock holder. Measurements are
   shared through admission/observed so a waiting queue scans /proc about once
   a second in total. The caller holds the admission lock. */
/* The supervisor of a claim measures its own session and publishes the value, so
   a process that cannot see it in /proc (another user's service hides processes)
   still reads it. A value older than five sample intervals is not used. */
static int cq_usage_value(const char *state, const char *id, unsigned long long now, long long *kb) {
  char path[PATH_MAX], text[64];
  struct stat info;
  if (cq_path(path, "%s/admission/usage/%s", state, id) || stat(path, &info)) return 0;
  unsigned long long age = now / 1000000000ull > (unsigned long long)info.st_mtime
    ? now / 1000000000ull - (unsigned long long)info.st_mtime : 0;
  if (age > 5 * (CQ_SAMPLE_NS / 1000000000ull)) return 0;
  if (cq_read_small(path, text, sizeof(text))) return 0;
  *kb = cq_field_number(text, "kb", 0);
  return 1;
}

/* A process that is alive but has no /proc entry for this caller. */
static int cq_hidden(int pid) {
  char entry[64];
  snprintf(entry, sizeof(entry), "/proc/%d", pid);
  return access(entry, F_OK) && errno == ENOENT && (kill((pid_t)pid, 0) == 0 || errno == EPERM);
}

static void cq_observe(const char *state, CqAdmission *view) {
#ifdef __linux__
  char path[PATH_MAX], text[16384];
  unsigned long long now = cq_clock_ns(CLOCK_REALTIME);
  int fresh = 0;
  /* One cache per user: what a process sees in /proc depends on its user. */
  if (cq_path(path, "%s/admission/observed.%u", state, (unsigned)getuid())) return;
  if (!cq_read_small(path, text, sizeof(text))) {
    unsigned long long stamp = (unsigned long long)cq_field_number(text, "ts_ns", 0);
    fresh = stamp && now >= stamp && now - stamp < CQ_OBSERVE_AGE_NS
      && (int)cq_field_number(text, "legacy_pid", 0) == view->legacy_pid;
    for (size_t i = 0; fresh && i < view->claim_count; i++) {
      char name[CQ_ID + 8], value[32];
      snprintf(name, sizeof(name), "c.%s", view->claims[i].id);
      if (!cq_field(text, name, value, sizeof(value))) fresh = 0;
    }
  }
  if (fresh) {
    char value[32];
    for (size_t i = 0; i < view->claim_count; i++) {
      char name[CQ_ID + 8];
      snprintf(name, sizeof(name), "c.%s", view->claims[i].id);
      cq_field(text, name, value, sizeof(value));
      view->claims[i].current = strtoll(value, NULL, 10);
    }
    view->legacy_current = cq_field_number(text, "legacy_kb", 0);
  } else {
    CqProc *table = NULL; size_t count = 0;
    if (cq_proc_table(&table, &count)) return;
    char out[16384]; size_t used = 0;
    used += (size_t)snprintf(out + used, sizeof(out) - used, "ts_ns=%llu\nlegacy_pid=%d\n", now, view->legacy_pid);
    for (size_t i = 0; i < view->claim_count; i++) {
      int members = 0;
      view->claims[i].current = cq_measure(table, count, view->claims[i].root, view->claims[i].tree, &members);
      if (used + CQ_ID + 40 < sizeof(out))
        used += (size_t)snprintf(out + used, sizeof(out) - used, "c.%s=%lld\n", view->claims[i].id, view->claims[i].current);
    }
    if (view->legacy_pid) {
      int members = 0, session = 0;
      for (size_t i = 0; i < count; i++) if (table[i].pid == view->legacy_pid) session = table[i].sid == view->legacy_pid;
      view->legacy_tree = !session;
      view->legacy_current = cq_measure(table, count, view->legacy_pid, view->legacy_tree, &members);
    }
    used += (size_t)snprintf(out + used, sizeof(out) - used, "legacy_kb=%lld\n", view->legacy_current);
    free(table);
    cq_write_cache(path, out, used);
  }
  /* The value published by the supervisor of a claim is its own measurement. A
     claim that nobody measured and whose process is hidden has no usable value. */
  for (size_t i = 0; i < view->claim_count; i++) {
    long long published = 0;
    if (cq_usage_value(state, view->claims[i].id, now, &published)) view->claims[i].current = published;
    else if (view->claims[i].current == 0 && cq_hidden(view->claims[i].root)) view->unreliable = 1;
  }
#else
  (void)state; (void)view;
#endif
}

static int cq_ticket_compare(const void *left, const void *right) {
  return strcmp(((const CqTicket *)left)->id, ((const CqTicket *)right)->id);
}

/* Reads the claims and tickets, removes dead ones, and fills the observation.
   The caller holds the admission lock. */
static int cq_admission_load(const char *state, CqAdmission *view) {
  char directory[PATH_MAX], path[PATH_MAX], text[2048];
  memset(view, 0, sizeof(*view));
  view->memory_known = !cq_meminfo(&view->total, &view->available);
  /* The reserve is the largest rise of memory used outside the queue that a run
     has seen. Until a run has recorded one, the rule starts one job at a time. */
  long long growth = -1;
  if (!cq_path(path, "%s/outside-growth", state)) cq_value_load(path, "growth_kb", &growth);
  view->reserve = growth > 0 ? growth : 0;
  if (growth < 0) view->memory_known = 0;
  int error = cq_path(directory, "%s/admission/running", state);
  if (error) return error;
  DIR *running = opendir(directory);
  if (running) {
    struct dirent *entry;
    while ((entry = readdir(running))) {
      if (entry->d_name[0] == '.' || strstr(entry->d_name, ".tmp.")) continue;
      if (cq_path(path, "%s/%s", directory, entry->d_name)) continue;
      if (!cq_claim_alive(path)) {
        unlink(path);
        char usage[PATH_MAX];
        if (!cq_path(usage, "%s/admission/usage/%s", state, entry->d_name)) unlink(usage);
        continue;
      }
      if (cq_read_small(path, text, sizeof(text))) continue;
      CqClaim *grown = realloc(view->claims, (view->claim_count + 1) * sizeof(*grown));
      if (!grown) { closedir(running); return ENOMEM; }
      view->claims = grown;
      cq_claim_parse(entry->d_name, text, &view->claims[view->claim_count++]);
    }
    closedir(running);
  }
  error = cq_path(directory, "%s/admission/waiting", state);
  if (error) return error;
  DIR *waiting = opendir(directory);
  if (waiting) {
    struct dirent *entry;
    while ((entry = readdir(waiting))) {
      if (entry->d_name[0] == '.' || strstr(entry->d_name, ".tmp.")) continue;
      if (cq_path(path, "%s/%s", directory, entry->d_name)) continue;
      if (cq_read_small(path, text, sizeof(text))) continue;
      CqTicket ticket;
      cq_ticket_parse(entry->d_name, text, &ticket);
      u32 alive = 0;
      if (cq_alive_value((u32)ticket.pid, ticket.start, &alive) || !alive) { unlink(path); continue; }
      cq_ticket_complete(&ticket);
      cq_expected(state, ticket.key, ticket.group, ticket.shape, ticket.compiler, ticket.kind, &ticket.expected, &ticket.history);
      CqTicket *grown = realloc(view->tickets, (view->ticket_count + 1) * sizeof(*grown));
      if (!grown) { closedir(waiting); return ENOMEM; }
      view->tickets = grown;
      view->tickets[view->ticket_count++] = ticket;
    }
    closedir(waiting);
  }
  if (view->ticket_count) qsort(view->tickets, view->ticket_count, sizeof(*view->tickets), cq_ticket_compare);
#ifdef __linux__
  if (!cq_legacy_holder(state, &view->legacy_pid)) view->legacy_pid = 0;
  if (view->legacy_pid) cq_legacy_entry(view->legacy_pid, view->legacy_entry, sizeof(view->legacy_entry));
#endif
  if (view->claim_count || view->legacy_pid) cq_observe(state, view);
  return 0;
}

static long long cq_max_ll(long long a, long long b) { return a > b ? a : b; }

/* Memory in use that no running queue job accounts for. */
static long long cq_outside_use(const CqAdmission *view) {
  long long used = view->legacy_current;
  for (size_t i = 0; i < view->claim_count; i++) used += view->claims[i].current;
  return cq_max_ll(0, view->total - view->available - used);
}

/* The memory a ticket is expected to need: its recorded peak, otherwise the
   current memory of a running job of its group, otherwise none. A job without
   a group (a takeover successor) is matched by entry file, as is the holder of
   the older lock, because their command is not known here. */
static long long cq_need(const CqAdmission *view, const CqTicket *ticket) {
  if (ticket->history) return ticket->expected;
  if (!*ticket->entry) return 0;
  long long bound = 0;
  for (size_t i = 0; i < view->claim_count; i++) {
    const CqClaim *claim = &view->claims[i];
    int same = *ticket->group && *claim->group ? !strcmp(claim->group, ticket->group)
                                               : !strcmp(claim->entry, ticket->entry);
    if (same) bound = cq_max_ll(bound, claim->current);
  }
  if (view->legacy_pid && !strcmp(view->legacy_entry, ticket->entry))
    bound = cq_max_ll(bound, view->legacy_current);
  return bound;
}

/* Whether the ticket may start now. The reserve is the recorded growth of memory
   used outside the queue. Running jobs keep claiming the part of their expected peak they have not
   reached yet, so a job admitted a moment ago is counted before it grows. */
static int cq_admit_decision(const CqAdmission *view, size_t index, int *backfill) {
  const CqTicket *ticket = &view->tickets[index];
  *backfill = 0;
  if (!view->claim_count && !view->legacy_pid && index == 0) return 1;
  if (!view->memory_known) return 0;
  if (!ticket->history)
    for (size_t i = 0; i < view->claim_count; i++) if (!view->claims[i].history) return 0;
  long long reserve = view->reserve;
  long long unspent = 0, used = 0, backfilled = 0;
  for (size_t i = 0; i < view->claim_count; i++) {
    const CqClaim *claim = &view->claims[i];
    unspent += cq_max_ll(0, claim->expected - claim->current);
    used += claim->current;
    if (claim->backfill) backfilled += cq_max_ll(claim->expected, claim->current);
  }
  used += view->legacy_current;
  long long free_now = view->available - unspent - reserve;
  long long idle = view->available + used - reserve;
  long long need = cq_need(view, ticket);
  int fits = need > 0 ? need <= free_now : free_now > 0;
  if (!fits) return 0;
  if (index == 0) return 1;
  const CqTicket *head = &view->tickets[0];
  long long head_need = cq_need(view, head);
  if (head_need <= free_now && need + head_need > free_now) return 0;
  if (backfilled + need + head_need > idle) return 0;
  *backfill = 1;
  return 1;
}

static int cq_ticket_index(const CqAdmission *view, const char *id) {
  for (size_t i = 0; i < view->ticket_count; i++) if (!strcmp(view->tickets[i].id, id)) return (int)i;
  return -1;
}

static int cq_claim_create(const char *state, const char *id, const char *body, int *fd) {
  char path[PATH_MAX];
  int error = cq_path(path, "%s/admission/running/%s", state, id);
  if (error) return error;
  mode_t previous = umask(0007);
  *fd = open(path, O_RDWR | O_CREAT | O_EXCL, 0660);
  int saved = errno;
  umask(previous);
  if (*fd < 0) return saved;
  if (flock(*fd, LOCK_EX | LOCK_NB) < 0) { error = errno; close(*fd); unlink(path); return error; }
  error = cq_write_all_fd(*fd, body, strlen(body));
  if (error) { close(*fd); unlink(path); return error; }
  error = cq_set_inheritable(*fd);
  return error;
}

/* Wait for admission. Returns the claim descriptor installed as descriptor 8.
   queued overrides the queue time (a takeover keeps the queue position of the
   supervisor it replaces); old_pid and old_start name that supervisor, which
   is killed if this process is stopped while waiting. */
static volatile sig_atomic_t cq_admit_signal = 0;
static char cq_my_claim[CQ_ID];
static void cq_admit_handler(int sig) { cq_admit_signal = sig; }

static int cq_ticket_write(const char *state, const char *id, const char *key,
                           const char *group, const char *entry, const char *compiler, const char *kind,
                           const char *shape, unsigned long long queued, const char *start) {
  char path[PATH_MAX], body[1024];
  int error = cq_path(path, "%s/admission/waiting/%s", state, id);
  if (error) return error;
  int length = snprintf(body, sizeof(body),
    "pid=%d\nstarttime=%s\nkey=%s\ngroup=%s\nentry=%s\ncompiler=%s\nkind=%s\nshape=%s\nqueued_ns=%llu\n",
    (int)getpid(), start, key, group, entry, compiler, kind, shape, queued);
  return cq_write_text(path, body, (size_t)length);
}

static int cq_wait_admission(const char *attempt, const char *queued_text,
                             u32 old_pid, const char *old_start, int *claim_fd) {
  char state[PATH_MAX], keydir[PATH_MAX], key[CQ_NAME], path[PATH_MAX], text[1024];
  char group[CQ_NAME] = "", entry[CQ_ENTRY] = "", compiler[CQ_NAME] = "", kind[16] = "", shape[24] = "", *start = NULL;
  int error = cq_attempt_parts(attempt, state, keydir, key);
  if (error) return error;
  { char shape_kind[16]; cq_shape(attempt, shape, sizeof(shape), shape_kind, sizeof(shape_kind)); }
  if (!cq_path(path, "%s/group", attempt) && !cq_read_small(path, text, sizeof(text))) {
    cq_field(text, "group", group, sizeof(group));
    cq_field(text, "compiler", compiler, sizeof(compiler));
  }
  if (!cq_path(path, "%s/meta", attempt) && !cq_read_small(path, text, sizeof(text))) {
    cq_field(text, "entry", entry, sizeof(entry));
    cq_field(text, "kind", kind, sizeof(kind));
  }
  if ((error = cq_admission_dirs(state))) return error;
  if ((error = cq_starttime_text((u32)getpid(), &start))) return error;
  unsigned long long queued = queued_text && *queued_text ? strtoull(queued_text, NULL, 10) : 0;
  if (!queued) queued = cq_clock_ns(CLOCK_REALTIME);
  char id[CQ_ID];
  snprintf(id, sizeof(id), "%020llu-%010d", queued, (int)getpid());
  int fd = -1;
  if ((error = cq_admission_lock(state, &fd))) { free(start); return error; }
  error = cq_ticket_write(state, id, key, group, entry, compiler, kind, shape, queued, start);
  cq_admission_unlock(fd);
  if (error) { free(start); return error; }
  struct sigaction action, old_term, old_int, old_hup;
  int handling = old_pid != 0;
  if (handling) {
    memset(&action, 0, sizeof(action));
    action.sa_handler = cq_admit_handler;
    sigemptyset(&action.sa_mask);
    cq_admit_signal = 0;
    sigaction(SIGTERM, &action, &old_term);
    sigaction(SIGINT, &action, &old_int);
    sigaction(SIGHUP, &action, &old_hup);
  }
  int admitted = 0;
  char ticket_path[PATH_MAX];
  cq_path(ticket_path, "%s/admission/waiting/%s", state, id);
  while (!admitted) {
    if (cq_admit_signal) { error = ECANCELED; break; }
    if ((error = cq_admission_lock(state, &fd))) break;
    CqAdmission view;
    error = cq_admission_load(state, &view);
    int index = error ? -1 : cq_ticket_index(&view, id);
    if (!error && index < 0) error = cq_ticket_write(state, id, key, group, entry, compiler, kind, shape, queued, start);
    int backfill = 0;
    /* The oldest ticket that may start goes first, whichever supervisor polls first. */
    int go = !error && index >= 0 && cq_admit_decision(&view, (size_t)index, &backfill);
    for (int before = 0; go && before < index; before++) {
      int ignored = 0;
      if (cq_admit_decision(&view, (size_t)before, &ignored)) go = 0;
    }
    if (go) {
      const CqTicket *ticket = &view.tickets[index];
      char body[1024];
      snprintf(body, sizeof(body),
        "pid=%d\nstarttime=%s\nroot=%d\nmeasure=session\nkey=%s\ngroup=%s\nentry=%s\nexpected_kb=%lld\n"
        "history=%d\nbackfill=%d\nadmitted_ns=%llu\n", (int)getpid(), start, (int)getsid(0), key, group, entry,
        cq_need(&view, ticket), ticket->history, backfill, cq_clock_ns(CLOCK_REALTIME));
      error = cq_claim_create(state, id, body, claim_fd);
      if (!error) { unlink(ticket_path); admitted = 1; snprintf(cq_my_claim, sizeof(cq_my_claim), "%s", id); }
    }
    cq_admission_free(&view);
    cq_admission_unlock(fd);
    if (error || admitted) break;
    cq_sleep_ns(CQ_POLL_NS);
  }
  if (error || !admitted) unlink(ticket_path);
  if (handling) {
    sigaction(SIGTERM, &old_term, NULL);
    sigaction(SIGINT, &old_int, NULL);
    sigaction(SIGHUP, &old_hup, NULL);
    if (cq_admit_signal && old_pid) {
      u32 alive = 0;
      if (!cq_alive_value(old_pid, old_start, &alive) && alive) kill((pid_t)old_pid, SIGKILL);
    }
  }
  free(start);
  if (error) return error;
  if (*claim_fd != 8) {
    if (dup2(*claim_fd, 8) < 0) { error = errno; close(*claim_fd); return error; }
    close(*claim_fd);
    *claim_fd = 8;
  }
  return cq_set_inheritable(8);
}

/* ---- peak history ------------------------------------------------------- */

static int cq_value_raise(const char *path, const char *name, long long value) {
  long long recorded = -1;
  int error = cq_value_load(path, name, &recorded);
  if (error || recorded >= value) return error;
  char text[64];
  int length = snprintf(text, sizeof(text), "%s=%lld\n", name, value);
  return cq_write_text(path, text, (size_t)length);
}

static int cq_history_raise(const char *path, long long peak) {
  return cq_value_raise(path, "peak_kb", peak);
}

/* Raises the peaks of a run in the group, kind-and-compiler and kind records. */
static void cq_raise_peaks(const char *state, const char *group, const char *shape, const char *compiler,
                           const char *kind, long long peak) {
  char path[PATH_MAX];
  if (*group && !cq_path(path, "%s/peaks/%s", state, group)) cq_history_raise(path, peak);
  if (*kind && *shape && !cq_path(path, "%s/peaks/sh.%s.%s", state, kind, shape)) cq_history_raise(path, peak);
  if (*kind && *compiler && !cq_path(path, "%s/peaks/kc.%s.%s", state, kind, compiler))
    cq_history_raise(path, peak);
  if (*kind && !cq_path(path, "%s/peaks/k.%s", state, kind)) cq_history_raise(path, peak);
}

static void cq_record_peak(const char *attempt, long long peak) {
  char state[PATH_MAX], keydir[PATH_MAX], key[CQ_NAME], path[PATH_MAX], text[1024];
  char group[CQ_NAME] = "", compiler[CQ_NAME] = "", kind[16] = "", shape[24] = "";
  if (peak <= 0 || cq_attempt_parts(attempt, state, keydir, key)) return;
  int length = snprintf(text, sizeof(text), "peak_kb=%lld\n", peak);
  if (!cq_path(path, "%s/peak", attempt)) cq_write_text(path, text, (size_t)length);
  if (!cq_path(path, "%s/group", attempt) && !cq_read_small(path, text, sizeof(text))) {
    cq_field(text, "group", group, sizeof(group));
    cq_field(text, "compiler", compiler, sizeof(compiler));
  }
  cq_shape(attempt, shape, sizeof(shape), kind, sizeof(kind));
  if (cq_admission_dirs(state)) return;
  int fd = -1;
  if (cq_admission_lock(state, &fd)) return;
  if (!cq_path(path, "%s/peak", keydir)) cq_history_raise(path, peak);
  cq_raise_peaks(state, group, shape, compiler, kind, peak);
  cq_admission_unlock(fd);
}

static int cq_text_append(char **text, size_t *used, size_t *capacity, const char *format, ...)
  __attribute__((format(printf, 4, 5)));

/* Group text: the paths that belong to one checkout or one attempt are replaced
   by placeholders, so the same job in two worktrees has one text. */
static int cq_path_char(char c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
    || c == '.' || c == '_' || c == '-' || c == '/' || c == '@';
}

static int cq_name_char(char c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
    || c == '.' || c == '_' || c == '-';
}

static int cq_roots_compare(const void *left, const void *right) {
  size_t a = strlen(*(const char *const *)left), b = strlen(*(const char *const *)right);
  return a < b ? 1 : a > b ? -1 : 0;
}

/* Replaces every root directory (newline-separated list) with @root. */
static char *cq_replace_roots(const char *text, const char *roots) {
  char *list = strdup(roots);
  char **items = calloc(strlen(roots) + 2, sizeof(*items));
  size_t count = 0;
  if (!list || !items) { free(list); free(items); return NULL; }
  for (char *at = strtok(list, "\n"); at; at = strtok(NULL, "\n"))
    if (at[0] == '/' && strlen(at) > 1) items[count++] = at;
  qsort(items, count, sizeof(*items), cq_roots_compare);
  size_t capacity = strlen(text) + 1, used = 0;
  char *out = malloc(capacity);
  if (!out) { free(list); free(items); return NULL; }
  for (size_t i = 0; text[i];) {
    size_t matched = 0;
    for (size_t k = 0; k < count && !matched; k++) {
      size_t n = strlen(items[k]);
      if (!strncmp(text + i, items[k], n) && !cq_name_char(text[i + n])) matched = n;
    }
    if (matched) {
      if (used + 6 >= capacity) { capacity = capacity * 2 + 8; out = realloc(out, capacity); if (!out) break; }
      memcpy(out + used, "@root", 5); used += 5; i += matched;
    } else {
      if (used + 2 >= capacity) { capacity = capacity * 2 + 8; out = realloc(out, capacity); if (!out) break; }
      out[used++] = text[i++];
    }
  }
  free(list); free(items);
  if (out) out[used] = 0;
  return out;
}

/* Replaces the whole path that contains a marker: the prefix before it, the
   marker and the segments after it that belong to the pattern. */
static char *cq_replace_pattern(const char *text, int attempt_paths) {
  size_t capacity = strlen(text) + 16, used = 0;
  char *out = malloc(capacity);
  if (!out) return NULL;
  const char *worktrees = "/worktrees/", *keys = "/keys/", *runs = "/runs/";
  for (size_t i = 0; text[i];) {
    size_t end = 0; const char *replacement = NULL;
    if (!attempt_paths && !strncmp(text + i, worktrees, strlen(worktrees))) {
      end = i + strlen(worktrees);
      while (cq_name_char(text[end])) end++;
      replacement = "@worktree";
    } else if (attempt_paths && !strncmp(text + i, keys, strlen(keys))) {
      size_t at = i + strlen(keys), hex = 0;
      while (text[at + hex] && strchr("0123456789abcdef", text[at + hex])) hex++;
      if (hex == 64 && !strncmp(text + at + hex, runs, strlen(runs))) {
        end = at + hex + strlen(runs);
        while (cq_name_char(text[end])) end++;
        replacement = "@attempt";
      }
    }
    if (replacement) {
      size_t start = used;
      while (start > 0 && cq_path_char(out[start - 1])) start--;
      used = start;
      size_t n = strlen(replacement);
      if (used + n + 2 >= capacity) { capacity = capacity * 2 + n + 8; out = realloc(out, capacity); if (!out) return NULL; }
      memcpy(out + used, replacement, n); used += n;
      i = end;
    } else {
      if (used + 2 >= capacity) { capacity = capacity * 2 + 8; out = realloc(out, capacity); if (!out) return NULL; }
      out[used++] = text[i++];
    }
  }
  out[used] = 0;
  return out;
}

static int cq_group_text(const char *text, const char *roots, char **out) {
  char *first = cq_replace_roots(text, roots);
  if (!first) return ENOMEM;
  char *second = cq_replace_pattern(first, 0);
  free(first);
  if (!second) return ENOMEM;
  char *third = cq_replace_pattern(second, 1);
  free(second);
  if (!third) return ENOMEM;
  *out = third;
  return 0;
}

/* Raises the peak records from the runs already recorded under keys/. */
static int cq_backfill(const char *state, char **out, size_t *length) {
  char keys[PATH_MAX], path[PATH_MAX], text[1024];
  size_t used = 0, capacity = 256; long runs = 0;
  char *report = malloc(capacity);
  if (!report) return ENOMEM;
  report[0] = 0;
  int error = cq_admission_dirs(state);
  int fd = -1;
  if (!error) error = cq_admission_lock(state, &fd);
  if (!error && !cq_path(keys, "%s/keys", state)) {
    DIR *key_dir = opendir(keys);
    struct dirent *key_entry;
    while (key_dir && (key_entry = readdir(key_dir))) {
      if (key_entry->d_name[0] == '.') continue;
      char runs_dir[PATH_MAX];
      if (cq_path(runs_dir, "%s/%s/runs", keys, key_entry->d_name)) continue;
      DIR *run_dir = opendir(runs_dir);
      struct dirent *run_entry;
      while (run_dir && (run_entry = readdir(run_dir))) {
        if (run_entry->d_name[0] == '.') continue;
        char attempt[PATH_MAX], group[CQ_NAME] = "", compiler[CQ_NAME] = "", kind[16] = "", shape[24] = "";
        if (cq_path(attempt, "%s/%s", runs_dir, run_entry->d_name)) continue;
        long long peak = -1;
        if (cq_path(path, "%s/peak", attempt) || cq_peak_load(path, &peak) || peak <= 0) continue;
        cq_shape(attempt, shape, sizeof(shape), kind, sizeof(kind));
        if (!cq_path(path, "%s/group", attempt) && !cq_read_small(path, text, sizeof(text))) {
          cq_field(text, "group", group, sizeof(group));
          cq_field(text, "compiler", compiler, sizeof(compiler));
        }
        if (!cq_path(path, "%s/%s/peak", keys, key_entry->d_name)) cq_history_raise(path, peak);
        cq_raise_peaks(state, group, shape, compiler, kind, peak);
        runs++;
      }
      if (run_dir) closedir(run_dir);
    }
    if (key_dir) closedir(key_dir);
  }
  if (fd >= 0) cq_admission_unlock(fd);
  if (!error) error = cq_text_append(&report, &used, &capacity, "backfilled runs=%ld\n", runs);
  if (error) { free(report); return error; }
  *out = report; *length = used;
  return 0;
}

/* Samples the session of the calling supervisor while its command runs. */
/* Samples the session of the calling supervisor while its command runs, and the
   memory used outside the queue. The rise of outside use from the first sample
   is raised in outside-growth when the run ends. */
typedef struct {
  unsigned long long next, begun, last;
  long long peak, baseline, rise;
  int samples, track;
  char state[PATH_MAX];
} CqSampler;

static void cq_sampler_start(CqSampler *sampler, const char *stdout_path) {
  memset(sampler, 0, sizeof(*sampler));
  sampler->baseline = -1;
  const char *suffix = strrchr(stdout_path, '/');
  if (!suffix || strcmp(suffix, "/stdout")) return;
  char attempt[PATH_MAX], keydir[PATH_MAX], key[CQ_NAME];
  size_t length = (size_t)(suffix - stdout_path);
  if (length >= sizeof(attempt)) return;
  memcpy(attempt, stdout_path, length); attempt[length] = 0;
  sampler->track = !cq_attempt_parts(attempt, sampler->state, keydir, key);
}

#ifdef __linux__
static void cq_sample_outside(CqSampler *sampler, long long own_kb, unsigned long long now) {
  int fd = -1;
  if (!sampler->track || cq_admission_lock(sampler->state, &fd)) return;
  CqAdmission view;
  if (!cq_admission_load(sampler->state, &view) && view.total > 0) {
    long long outside = cq_outside_use(&view);
    if (view.unreliable) { cq_admission_free(&view); cq_admission_unlock(fd); return; }
    int listed = 0;
    for (size_t i = 0; i < view.claim_count; i++) if (!strcmp(view.claims[i].id, cq_my_claim)) listed = 1;
    /* After the compile marker the claim is released but the command still uses memory. */
    if (!listed) outside = cq_max_ll(0, outside - own_kb);
    if (sampler->baseline < 0) { sampler->baseline = outside; sampler->begun = now; }
    else sampler->rise = cq_max_ll(sampler->rise, outside - sampler->baseline);
    sampler->last = now;
    sampler->samples++;
  }
  cq_admission_free(&view);
  cq_admission_unlock(fd);
}
#endif

static void cq_sample(CqSampler *sampler, int final) {
#ifdef __linux__
  unsigned long long now = cq_clock_ns(CLOCK_MONOTONIC);
  if (!final && now < sampler->next) return;
  sampler->next = now + CQ_SAMPLE_NS;
  CqProc *table = NULL; size_t count = 0;
  if (cq_proc_table(&table, &count)) return;
  int members = 0;
  long long kb = cq_measure(table, count, (int)getsid(0), 0, &members);
  free(table);
  if (kb > sampler->peak) sampler->peak = kb;
  if (sampler->track && *cq_my_claim) {
    char usage[PATH_MAX], text[48];
    int length = snprintf(text, sizeof(text), "kb=%lld\n", kb);
    if (!cq_path(usage, "%s/admission/usage/%s", sampler->state, cq_my_claim)) cq_write_cache(usage, text, (size_t)length);
  }
  cq_sample_outside(sampler, kb, now);
#else
  (void)sampler; (void)final;
#endif
}

/* A run shorter than one sample interval has no measured rise to record. */
static void cq_record_outside(const CqSampler *sampler) {
  if (!sampler->track || sampler->samples < 2 || sampler->last - sampler->begun < CQ_SAMPLE_NS) return;
  char path[PATH_MAX];
  int fd = -1;
  if (cq_path(path, "%s/outside-growth", sampler->state) || cq_admission_lock(sampler->state, &fd)) return;
  cq_value_raise(path, "growth_kb", sampler->rise);
  cq_admission_unlock(fd);
}

static long long cq_children_peak_kb(void) {
  struct rusage usage;
  if (getrusage(RUSAGE_CHILDREN, &usage)) return 0;
#ifdef __APPLE__
  return (long long)usage.ru_maxrss / 1024;
#else
  return (long long)usage.ru_maxrss;
#endif
}

/* ---- queue takeover and status ------------------------------------------ */

/* Registers a process that was started outside the queue. It is admitted at
   once and its memory is counted until it exits. */
static int cq_admit_external(const char *keydir, u32 pid, int *claim_fd) {
  char state[PATH_MAX], key[CQ_NAME], attempt[PATH_MAX], parsed_keydir[PATH_MAX], *start = NULL;
  snprintf(attempt, sizeof(attempt), "%s/runs/x", keydir);
  int error = cq_attempt_parts(attempt, state, parsed_keydir, key);
  if (error) return error;
  if ((error = cq_admission_dirs(state))) return error;
  if ((error = cq_starttime_text(pid, &start))) return error;
  int fd = -1;
  if ((error = cq_admission_lock(state, &fd))) { free(start); return error; }
  char id[CQ_ID], body[1024];
  unsigned long long now = cq_clock_ns(CLOCK_REALTIME);
  snprintf(id, sizeof(id), "%020llu-%010d", now, (int)pid);
  snprintf(body, sizeof(body),
    "pid=%u\nstarttime=%s\nroot=%u\nmeasure=tree\nkey=%s\ngroup=\nexpected_kb=0\nhistory=1\nbackfill=0\n"
    "admitted_ns=%llu\n", pid, start, pid, key, now);
  error = cq_claim_create(state, id, body, claim_fd);
  cq_admission_unlock(fd);
  free(start);
  return error;
}

static int cq_text_append(char **text, size_t *used, size_t *capacity, const char *format, ...)
  __attribute__((format(printf, 4, 5)));
static int cq_text_append(char **text, size_t *used, size_t *capacity, const char *format, ...) {
  for (;;) {
    va_list args; va_start(args, format);
    int needed = vsnprintf(*text + *used, *capacity - *used, format, args);
    va_end(args);
    if (needed < 0) return EINVAL;
    if ((size_t)needed < *capacity - *used) { *used += (size_t)needed; return 0; }
    size_t next = *capacity * 2 + (size_t)needed;
    char *grown = realloc(*text, next);
    if (!grown) return ENOMEM;
    *text = grown; *capacity = next;
  }
}

static int cq_admission_status(const char *state, char **out, size_t *length) {
  size_t used = 0, capacity = 1024;
  char *text = malloc(capacity);
  if (!text) return ENOMEM;
  text[0] = 0;
  int error = cq_admission_dirs(state);
  int fd = -1;
  if (!error) error = cq_admission_lock(state, &fd);
  CqAdmission view;
  memset(&view, 0, sizeof(view));
  if (!error) error = cq_admission_load(state, &view);
  if (!error) {
    char growth[32] = "none";
    if (view.memory_known || view.reserve > 0) snprintf(growth, sizeof(growth), "%lld", view.reserve);
    error = cq_text_append(&text, &used, &capacity,
      "memory total_kb=%lld available_kb=%lld outside_use_kb=%lld outside_growth_kb=%s\n",
      view.total, view.available, cq_outside_use(&view), growth);
    if (!error && view.legacy_pid)
      error = cq_text_append(&text, &used, &capacity, "legacy-holder pid=%d current_kb=%lld\n",
        view.legacy_pid, view.legacy_current);
    for (size_t i = 0; !error && i < view.claim_count; i++)
      error = cq_text_append(&text, &used, &capacity,
        "running pid=%d key=%s expected_kb=%lld current_kb=%lld history=%d backfill=%d\n",
        view.claims[i].pid, view.claims[i].key, view.claims[i].expected, view.claims[i].current,
        view.claims[i].history, view.claims[i].backfill);
    for (size_t i = 0; !error && i < view.ticket_count; i++)
      error = cq_text_append(&text, &used, &capacity, "waiting position=%zu pid=%d key=%s expected_kb=%lld history=%d\n",
        i + 1, view.tickets[i].pid, view.tickets[i].key, view.tickets[i].expected, view.tickets[i].history);
  }
  cq_admission_free(&view);
  cq_admission_unlock(fd);
  if (error) { free(text); return error; }
  *out = text; *length = used;
  return 0;
}

#ifdef __linux__
/* Whether pid sees the same mount namespace as this process. A successor runs
   in this namespace, so it cannot start an attempt whose cwd or command exists
   only in another one. */
static int cq_same_mount_namespace(int pid) {
  char path[64], mine[128], theirs[128];
  snprintf(path, sizeof(path), "/proc/%d/ns/mnt", pid);
  ssize_t a = readlink("/proc/self/ns/mnt", mine, sizeof(mine) - 1);
  ssize_t b = readlink(path, theirs, sizeof(theirs) - 1);
  if (a < 0 || b < 0) return 1;
  mine[a] = 0; theirs[b] = 0;
  return !strcmp(mine, theirs);
}

static int cq_stopped(int pid) {
  char path[64], line[1024];
  snprintf(path, sizeof(path), "/proc/%d/stat", pid);
  if (cq_read_small(path, line, sizeof(line))) return 0;
  char *close_paren = strrchr(line, ')');
  return close_paren && close_paren[2] == 'T';
}

/* Whether pid holds the old shared lock of the state root. A stopped process
   that waited for the lock no longer appears in /proc/locks; one that was
   granted the lock before it stopped appears as the holder. */
static int cq_legacy_holds(const char *state, int pid) {
  int holder = 0;
  return cq_legacy_holder(state, &holder) && holder == pid;
}

static int cq_legacy_waiters(const char *state, int **pids, size_t *count) {
  char path[PATH_MAX];
  struct stat info;
  *pids = NULL; *count = 0;
  if (cq_path(path, "%s/heavy.lock", state) || stat(path, &info)) return 0;
  FILE *locks = fopen("/proc/locks", "r");
  if (!locks) return errno;
  char line[512];
  while (fgets(line, sizeof(line), locks)) {
    char *at = strstr(line, "WRITE");
    if (!strstr(line, "->") || !at) continue;
    int holder; unsigned major_id, minor_id; unsigned long inode;
    if (sscanf(at + 5, " %d %x:%x:%lu", &holder, &major_id, &minor_id, &inode) != 4) continue;
    if (inode != (unsigned long)info.st_ino) continue;
    int *grown = realloc(*pids, (*count + 1) * sizeof(**pids));
    if (!grown) { fclose(locks); return ENOMEM; }
    *pids = grown;
    (*pids)[(*count)++] = holder;
  }
  fclose(locks);
  return 0;
}

/* The environment of another process of the same user, as an envp array. The
   caller frees both the array and the block. Answers NULL when it cannot be read. */
static char **cq_read_environ(int pid, char **block) {
  char path[64];
  char *text = NULL; size_t length = 0;
  snprintf(path, sizeof(path), "/proc/%d/environ", pid);
  if (cq_read_path(path, &text, &length) || !length) { free(text); return NULL; }
  size_t entries = 0;
  for (size_t i = 0; i < length; i++) if (!text[i]) entries++;
  if (text[length - 1]) entries++;
  char **envp = calloc(entries + 2, sizeof(*envp));
  char *copy = realloc(text, length + 1);
  if (!envp || !copy) { free(envp); free(copy ? copy : text); return NULL; }
  copy[length] = 0;
  size_t count = 0;
  for (size_t at = 0; at < length; ) {
    if (copy[at]) envp[count++] = copy + at;
    at += strlen(copy + at) + 1;
  }
  envp[count] = NULL;
  *block = copy;
  return envp;
}

/* Starts a successor that takes the place of a waiting supervisor. old_pid and
   old_start name the supervisor that the requester waits for; the successor kills
   it when the attempt has a result. */
static int cq_spawn_successor(const char *state, const char *keydir, const char *attempt,
                              const char *old_pid, const char *old_start, const char *queued,
                              pid_t *successor) {
  char args[PATH_MAX + 256]; size_t at = 0;
  const char *parts[6] = {"--", "__takeover", attempt, old_pid, old_start, queued};
  for (int part = 0; part < 6; part++) {
    size_t size = strlen(parts[part]) + 1;
    if (at + size >= sizeof(args)) return ENAMETOOLONG;
    memcpy(args + at, parts[part], size); at += size;
  }
  u32 key_fd = 0, heavy_fd = 0;
  char key_lock[PATH_MAX], heavy_lock[PATH_MAX];
  int error = cq_path(key_lock, "%s/lock", keydir);
  if (!error) error = cq_path(heavy_lock, "%s/heavy.lock", state);
  if (!error) error = cq_lock_open(key_lock, &key_fd);
  if (!error) error = cq_lock_open(heavy_lock, &heavy_fd);
  /* The successor runs the command with the environment of the supervisor that
     it replaces, which is the environment of the requester. */
  char *block = NULL;
  char **envp = cq_read_environ(atoi(old_pid), &block);
  if (!error) error = cq_spawn_detached(args, at, key_fd, heavy_fd, envp, successor);
  free(envp); free(block);
  if (key_fd) close((int)key_fd);
  if (heavy_fd) close((int)heavy_fd);
  return error;
}

static int cq_read_cmdline(int pid, char *line, size_t capacity, char **argv, int *argc) {
  char path[64];
  snprintf(path, sizeof(path), "/proc/%d/cmdline", pid);
  int fd = open(path, O_RDONLY);
  ssize_t got = fd < 0 ? -1 : read(fd, line, capacity - 1);
  if (fd >= 0) close(fd);
  if (got <= 0) return 0;
  line[got] = 0;
  *argc = 0;
  for (char *at = line; at < line + got && *argc < 16; at += strlen(at) + 1) argv[(*argc)++] = at;
  return 1;
}

/* Whether the process runs another executable file than this process. */
static int cq_other_executable(int pid) {
  char path[64];
  struct stat mine, theirs;
  snprintf(path, sizeof(path), "/proc/%d/exe", pid);
  if (stat("/proc/self/exe", &mine) || stat(path, &theirs)) return 0;
  return mine.st_dev != theirs.st_dev || mine.st_ino != theirs.st_ino;
}

/* Replaces supervisors that wait for admission under an older executable
   with successors of this executable, so changes of the rule reach waiting jobs.
   A successor of an earlier takeover is replaced by a new successor for the same
   stopped supervisor. */
static int cq_retake_waiting(const char *state, char **text, size_t *used, size_t *capacity) {
  CqAdmission view;
  int fd = -1;
  int error = cq_admission_lock(state, &fd);
  if (error) return error;
  error = cq_admission_load(state, &view);
  cq_admission_unlock(fd);
  if (error) return error;
  for (size_t index = 0; !error && index < view.ticket_count; index++) {
    const CqTicket *ticket = &view.tickets[index];
    int pid = ticket->pid, running = 0;
    if (pid == (int)getpid()) continue;
    for (size_t i = 0; i < view.claim_count; i++) if (view.claims[i].pid == pid) running = 1;
    if (running) continue;
    char line[8192], *argv[16]; int argc = 0;
    if (!cq_read_cmdline(pid, line, sizeof(line), argv, &argc)) continue;
    const char *attempt = NULL, *old_pid = NULL, *old_start = NULL, *queued = NULL;
    char own_pid[32], own_queued[32];
    int successor_kind = 0;
    snprintf(own_pid, sizeof(own_pid), "%d", pid);
    snprintf(own_queued, sizeof(own_queued), "%llu", ticket->queued);
    if (argc >= 2 && !strcmp(argv[argc - 2], "__supervise")) {
      attempt = argv[argc - 1]; old_pid = own_pid; old_start = ticket->start; queued = own_queued;
    } else if (argc >= 5 && !strcmp(argv[argc - 5], "__takeover")) {
      attempt = argv[argc - 4]; old_pid = argv[argc - 3]; old_start = argv[argc - 2]; queued = argv[argc - 1];
      successor_kind = 1;
    } else continue;
    if (!cq_other_executable(pid)) continue;
    char keydir[PATH_MAX], key[CQ_NAME], parsed_state[PATH_MAX], marker[PATH_MAX];
    if (cq_attempt_parts(attempt, parsed_state, keydir, key) || strcmp(parsed_state, state)) continue;
    if (!cq_same_mount_namespace(pid)) {
      error = cq_text_append(text, used, capacity, "skipped pid=%d reason=other-mount-namespace attempt=%s\n", pid, attempt);
      continue;
    }
    /* Take the admission lock first. A supervisor that is stopped while it holds
       the lock would keep it and block every other waiter. With the lock held
       here the target either waits for it or sleeps. */
    int locked = !cq_admission_lock(state, &fd);
    if (!locked) { error = cq_text_append(text, used, capacity, "skipped pid=%d reason=no-lock attempt=%s\n", pid, attempt); continue; }
    if (kill((pid_t)pid, SIGSTOP)) {
      cq_admission_unlock(fd);
      error = cq_text_append(text, used, capacity, "skipped pid=%d reason=not-permitted attempt=%s\n", pid, attempt);
      continue;
    }
    for (int wait = 0; wait < 100 && !cq_stopped(pid); wait++) cq_sleep_ns(20000000L);
    /* A stopped supervisor cannot start its command. Check that it was not
       admitted before it stopped, then remove its ticket. */
    int still_waiting = 0;
    if (cq_stopped(pid)) {
      CqAdmission now;
      if (!cq_admission_load(state, &now)) {
        int claimed = 0, listed = 0;
        for (size_t i = 0; i < now.claim_count; i++) if (now.claims[i].pid == pid) claimed = 1;
        for (size_t i = 0; i < now.ticket_count; i++) if (now.tickets[i].pid == pid) listed = 1;
        if (!claimed && listed) {
          char ticket_path[PATH_MAX];
          if (!cq_path(ticket_path, "%s/admission/waiting/%s", state, ticket->id)) unlink(ticket_path);
          still_waiting = 1;
        }
      }
      cq_admission_free(&now);
    }
    cq_admission_unlock(fd);
    if (!still_waiting) {
      kill((pid_t)pid, SIGCONT);
      error = cq_text_append(text, used, capacity, "skipped pid=%d reason=not-waiting attempt=%s\n", pid, attempt);
      continue;
    }
    pid_t successor = 0;
    error = cq_spawn_successor(state, keydir, attempt, old_pid, old_start, queued, &successor);
    if (error) {
      kill((pid_t)pid, SIGCONT);
      error = cq_text_append(text, used, capacity, "failed pid=%d attempt=%s\n", pid, attempt);
      continue;
    }
    if (successor_kind) kill((pid_t)pid, SIGKILL);
    if (!cq_path(marker, "%s/takeover", attempt)) {
      char note[160];
      int n = snprintf(note, sizeof(note), "pid=%s\nstarttime=%s\nsuccessor=%d\n", old_pid, old_start, (int)successor);
      cq_write_text(marker, note, (size_t)n);
    }
    error = cq_text_append(text, used, capacity, "retaken pid=%d successor=%d attempt=%s\n", pid, (int)successor, attempt);
  }
  cq_admission_free(&view);
  return error;
}

/* Replaces every supervisor that waits for the old shared lock. The waiting
   supervisor is stopped, so it cannot start its command, and a new supervisor
   takes its place in the same queue position. The stopped one is killed when
   the new one finishes, which releases the requester that waits for it. Then
   it replaces supervisors that wait for admission under an older executable. */
static int cq_takeover(const char *state, char **out, size_t *length) {
  size_t used = 0, capacity = 1024;
  char *text = malloc(capacity);
  if (!text) return ENOMEM;
  text[0] = 0;
  int *pids = NULL; size_t count = 0;
  int error = cq_legacy_waiters(state, &pids, &count);
  for (size_t index = 0; !error && index < count; index++) {
    int pid = pids[index], duplicate = 0;
    for (size_t before = 0; before < index; before++) if (pids[before] == pid) duplicate = 1;
    if (duplicate) continue;
    char line[8192], *argv[16]; int argc = 0;
    if (!cq_read_cmdline(pid, line, sizeof(line), argv, &argc)) continue;
    if (argc < 2 || strcmp(argv[argc - 2], "__supervise")) continue;
    const char *attempt = argv[argc - 1];
    char *start = NULL;
    if (cq_starttime_text((u32)pid, &start)) continue;
    char marker[PATH_MAX], keydir[PATH_MAX], key[CQ_NAME], parsed_state[PATH_MAX];
    if (cq_attempt_parts(attempt, parsed_state, keydir, key) || strcmp(parsed_state, state)) { free(start); continue; }
    if (cq_path(marker, "%s/takeover", attempt)) { free(start); continue; }
    if (access(marker, F_OK) == 0) { free(start); continue; }
    if (!cq_same_mount_namespace(pid)) {
      error = cq_text_append(&text, &used, &capacity, "skipped pid=%d reason=other-mount-namespace attempt=%s\n", pid, attempt);
      free(start);
      continue;
    }
    if (kill((pid_t)pid, SIGSTOP)) {
      error = cq_text_append(&text, &used, &capacity, "skipped pid=%d reason=not-permitted attempt=%s\n", pid, attempt);
      free(start);
      continue;
    }
    for (int wait = 0; wait < 100 && !cq_stopped(pid); wait++) cq_sleep_ns(20000000L);
    if (!cq_stopped(pid) || cq_legacy_holds(state, pid)) {
      kill((pid_t)pid, SIGCONT);
      error = cq_text_append(&text, &used, &capacity, "skipped pid=%d reason=not-stopped-waiting attempt=%s\n", pid, attempt);
      free(start);
      continue;
    }
    char active_path[PATH_MAX], active[512], queued[32] = "", pid_text[32];
    if (!cq_path(active_path, "%s/active", keydir) && !cq_read_small(active_path, active, sizeof(active)))
      cq_field(active, "started_ns", queued, sizeof(queued));
    snprintf(pid_text, sizeof(pid_text), "%d", pid);
    pid_t successor = 0;
    error = cq_spawn_successor(state, keydir, attempt, pid_text, start, queued, &successor);
    if (error) {
      kill((pid_t)pid, SIGCONT);
      error = cq_text_append(&text, &used, &capacity, "failed pid=%d attempt=%s\n", pid, attempt);
      free(start);
      continue;
    }
    char note[128];
    int note_length = snprintf(note, sizeof(note), "pid=%d\nstarttime=%s\nsuccessor=%d\n", pid, start, (int)successor);
    cq_write_text(marker, note, (size_t)note_length);
    error = cq_text_append(&text, &used, &capacity, "taken-over pid=%d successor=%d attempt=%s\n",
      pid, (int)successor, attempt);
    free(start);
  }
  free(pids);
  if (!error) error = cq_retake_waiting(state, &text, &used, &capacity);
  if (error) { free(text); return error; }
  *out = text; *length = used;
  return 0;
}
#else
static int cq_takeover(const char *state, char **out, size_t *length) {
  (void)state; (void)out; (void)length;
  return ENOSYS;
}
#endif

static volatile sig_atomic_t cq_cancel_signal = 0;

static void cq_forward_signal(int sig) {
  cq_cancel_signal = sig;
}

static int cq_watch_command(const char *stdout_path) {
  const char *suffix = strrchr(stdout_path, '/');
  if (!suffix || strcmp(suffix, "/stdout")) return EINVAL;
  char *start = NULL;
  int error = cq_starttime_text((u32)getpid(), &start);
  if (error) return error;
  char pid[32];
  snprintf(pid, sizeof(pid), "%u", (unsigned)getpid());
  const char *kind = "__watch-heavy";
  size_t attempt_length = (size_t)(suffix - stdout_path);
  size_t length = strlen(kind) + 1 + attempt_length + 1
    + strlen(pid) + 1 + strlen(start) + 1;
  char *args = malloc(length);
  if (!args) { free(start); return ENOMEM; }
  char *at = args;
  memcpy(at, kind, strlen(kind) + 1); at += strlen(kind) + 1;
  memcpy(at, stdout_path, attempt_length); at[attempt_length] = 0;
  at += attempt_length + 1;
  memcpy(at, pid, strlen(pid) + 1); at += strlen(pid) + 1;
  memcpy(at, start, strlen(start) + 1);
  pid_t watcher = 0;
  error = cq_spawn_detached(args, length, 9, 8, NULL, &watcher);
  free(args); free(start);
  return error;
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
    /* Start the marker watcher before the command can execute. Its identity
       follows this command when the requesting supervisor exits. */
    int watcher_error = cq_watch_command(stdout_path);
    if (watcher_error) {
      write(status[1], &watcher_error, sizeof(watcher_error));
      _exit(127);
    }
    long limit = sysconf(_SC_OPEN_MAX);
    if (limit < 1024 || limit > 1048576) limit = 65536;
    /* The command retains heavy execution custody if its supervisor exits.
       The compiled marker releases this shared open file description when
       the compiler proceeds to its separately queued C compilation. */
    for (int fd = 3; fd < (int)limit; fd++) {
      if (fd != status[1] && fd != 8) close(fd);
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
  /* The supervisor measures the memory of its session while the command
     runs and records the peak with the key and the compiler history. */
  CqSampler sampler;
  cq_sampler_start(&sampler, stdout_path);
  long delay = 2000000L;
  for (;;) {
    waited = waitpid(child, &wait_status, WNOHANG);
    if (waited != 0 && !(waited < 0 && errno == EINTR)) break;
    cq_sample(&sampler, 0);
    cq_sleep_ns(delay);
    if (delay < 100000000L) delay *= 2;
  }
  sigaction(SIGTERM, &old_term, NULL);
  sigaction(SIGINT, &old_int, NULL);
  sigaction(SIGHUP, &old_hup, NULL);
  close(out); close(err); free(parsed);
  if (waited < 0) return errno;
  if (!cq_cancel_signal) {
    cq_sample(&sampler, 1);
    cq_record_outside(&sampler);
    long long peak = cq_children_peak_kb();
    if (sampler.peak > peak) peak = sampler.peak;
    const char *suffix = strrchr(stdout_path, '/');
    if (suffix && !strcmp(suffix, "/stdout")) {
      char attempt[PATH_MAX];
      size_t length = (size_t)(suffix - stdout_path);
      if (length < sizeof(attempt)) {
        memcpy(attempt, stdout_path, length); attempt[length] = 0;
        cq_record_peak(attempt, peak);
      }
    }
  }
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

static void cq_call_write_bytes(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  call->error = cq_write_text(call->path, call->argv, call->argv_length);
}

static void cq_call_group_text(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  call->error = cq_group_text(call->text, call->second, &call->out);
  if (!call->error) call->out_length = strlen(call->out);
}

static void cq_call_backfill(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  call->error = cq_backfill(call->path, &call->out, &call->out_length);
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
                                  call->cgen_lock, NULL, &pid);
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

static void cq_call_admit(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  int fd = -1;
  call->error = cq_wait_admission(call->path, call->text, call->pid, call->second, &fd);
}

static void cq_call_admit_external(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  int fd = -1;
  call->error = cq_admit_external(call->path, (u32)strtoul(call->text, NULL, 10), &fd);
  call->code = fd;
}

static void cq_call_takeover(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  call->error = cq_takeover(call->path, &call->out, &call->out_length);
}

static void cq_call_admission_status(IoWork *work) {
  CqCall *call = (CqCall *)work->data;
  call->error = cq_admission_status(call->path, &call->out, &call->out_length);
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

#ifdef CID_COMPILEQUEUELIFECYCLE_ADMIT
static void cq_admit_call(IoWork *work) { cq_call_admit(work); }
static Term cq_admit_pack(Env env, IoWork *work) { return cq_unit_pack(env, work); }
static Term cq_admit_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_text_arg(env, fields[0], &call->path);
  if (!call->error) call->error = cq_text_arg(env, fields[1], &call->text);
  call->pid = (u32)fields[2];
  if (!call->error) call->error = cq_text_arg(env, fields[3], &call->second);
  work->data = (char *)call;
  if (call->error) return cq_admit_pack(env, work);
  return io_work(work, cq_admit_call, cq_admit_pack);
}
static void __attribute__((constructor)) cq_admit_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_ADMIT, cq_admit_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_ADMIT_EXTERNAL
static void cq_admit_external_call(IoWork *work) { cq_call_admit_external(work); }
static Term cq_admit_external_pack(Env env, IoWork *work) { return cq_u32_pack(env, work); }
static Term cq_admit_external_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_text_arg(env, fields[0], &call->path);
  if (!call->error) call->error = cq_text_arg(env, fields[1], &call->text);
  work->data = (char *)call;
  if (call->error) return cq_admit_external_pack(env, work);
  return io_work(work, cq_admit_external_call, cq_admit_external_pack);
}
static void __attribute__((constructor)) cq_admit_external_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_ADMIT_EXTERNAL, cq_admit_external_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_TAKEOVER
static void cq_takeover_call(IoWork *work) { cq_call_takeover(work); }
static Term cq_takeover_pack(Env env, IoWork *work) { return cq_text_pack(env, work); }
static Term cq_takeover_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_text_arg(env, fields[0], &call->path);
  work->data = (char *)call;
  if (call->error) return cq_takeover_pack(env, work);
  return io_work(work, cq_takeover_call, cq_takeover_pack);
}
static void __attribute__((constructor)) cq_takeover_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_TAKEOVER, cq_takeover_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_ADMISSION_STATUS
static void cq_admission_status_call(IoWork *work) { cq_call_admission_status(work); }
static Term cq_admission_status_pack(Env env, IoWork *work) { return cq_text_pack(env, work); }
static Term cq_admission_status_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_text_arg(env, fields[0], &call->path);
  work->data = (char *)call;
  if (call->error) return cq_admission_status_pack(env, work);
  return io_work(work, cq_admission_status_call, cq_admission_status_pack);
}
static void __attribute__((constructor)) cq_admission_status_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_ADMISSION_STATUS, cq_admission_status_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_WRITE_BYTES
static void cq_write_bytes_call(IoWork *work) { cq_call_write_bytes(work); }
static Term cq_write_bytes_pack(Env env, IoWork *work) { return cq_unit_pack(env, work); }
static Term cq_write_bytes_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_text_arg(env, fields[0], &call->path);
  if (!call->error) call->error = cq_bytes_arg(env, fields[1], &call->argv, &call->argv_length);
  work->data = (char *)call;
  if (call->error) return cq_write_bytes_pack(env, work);
  return io_work(work, cq_write_bytes_call, cq_write_bytes_pack);
}
static void __attribute__((constructor)) cq_write_bytes_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_WRITE_BYTES, cq_write_bytes_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_GROUP_TEXT
static void cq_group_text_call(IoWork *work) { cq_call_group_text(work); }
static Term cq_group_text_pack(Env env, IoWork *work) { return cq_text_pack(env, work); }
static Term cq_group_text_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_text_arg(env, fields[0], &call->text);
  if (!call->error) call->error = cq_text_arg(env, fields[1], &call->second);
  work->data = (char *)call;
  if (call->error) return cq_group_text_pack(env, work);
  return io_work(work, cq_group_text_call, cq_group_text_pack);
}
static void __attribute__((constructor)) cq_group_text_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_GROUP_TEXT, cq_group_text_run, 0); }
#endif

#ifdef CID_COMPILEQUEUELIFECYCLE_BACKFILL
static void cq_backfill_call(IoWork *work) { cq_call_backfill(work); }
static Term cq_backfill_pack(Env env, IoWork *work) { return cq_text_pack(env, work); }
static Term cq_backfill_run(Env env, Term *fields, IoWork *work) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(env, ENOMEM, NULL);
  call->error = cq_text_arg(env, fields[0], &call->path);
  work->data = (char *)call;
  if (call->error) return cq_backfill_pack(env, work);
  return io_work(work, cq_backfill_call, cq_backfill_pack);
}
static void __attribute__((constructor)) cq_backfill_use(void) { io_eff(CID_COMPILEQUEUELIFECYCLE_BACKFILL, cq_backfill_run, 0); }
#endif
