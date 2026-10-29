#include <errno.h>
#include <dirent.h>
#include <fcntl.h>
#include <limits.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/types.h>
#ifdef __linux__
#include <sys/sysmacros.h>
#endif
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#ifdef __APPLE__
#include <libproc.h>
#include <mach-o/dyld.h>
#include <sys/proc.h>
#endif
extern char **environ;

static int posix_seconds_text(char **out) {
  struct timespec value;
  if (clock_gettime(CLOCK_REALTIME, &value)) return errno;
  char text[32];
  int length = snprintf(text, sizeof text, "%llu", (unsigned long long)value.tv_sec);
  if (length < 0 || (size_t)length >= sizeof text) return EOVERFLOW;
  *out = strdup(text);
  return *out ? 0 : ENOMEM;
}

static int posix_starttime_text(u32 pid, char **out) {
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

static int posix_alive_value(u32 pid, const char *start, u32 *alive) {
  *alive = 0;
  if (!pid || !start || !*start) return 0;
  char *current = NULL;
  int error = posix_starttime_text(pid, &current);
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

static int posix_self_path(char **out) {
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
  /* Keep the procfs magic link so a caller can re-execute this loaded image
     after its installed pathname has been replaced or unlinked. */
  *out = strdup("/proc/self/exe");
  return *out ? 0 : ENOMEM;
#endif
}

static int posix_now_text(clockid_t clock, char **out) {
  struct timespec value;
  if (clock_gettime(clock, &value)) return errno;
  char text[64];
  unsigned long long ns = (unsigned long long)value.tv_sec * 1000000000ull
    + (unsigned long long)value.tv_nsec;
  snprintf(text, sizeof(text), "%llu", ns);
  *out = strdup(text);
  return *out ? 0 : ENOMEM;
}

static int posix_set_inheritable(int fd) {
  int flags = fcntl(fd, F_GETFD);
  if (flags < 0) return errno;
  if (fcntl(fd, F_SETFD, flags & ~FD_CLOEXEC)) return errno;
  return 0;
}

static int posix_lock_open(const char *path, u32 *handle) {
  mode_t previous = umask(0007);
  int fd = open(path, O_RDWR | O_CREAT | O_NOFOLLOW, 0660);
  int saved = errno;
  umask(previous);
  errno = saved;
  if (fd < 0) return errno;
  int error = posix_set_inheritable(fd);
  if (error) { close(fd); return error; }
  *handle = (u32)fd;
  return 0;
}

static int posix_lock_acquire(const char *path, u32 *handle) {
  u32 fd = 0;
  int error = posix_lock_open(path, &fd);
  if (error) return error;
  while (flock((int)fd, LOCK_EX) < 0) {
    if (errno == EINTR) continue;
    error = errno; close((int)fd); return error;
  }
  *handle = fd;
  return 0;
}

static int posix_lock_try(const char *path, u32 *handle, int *present) {
  u32 fd = 0;
  int error = posix_lock_open(path, &fd);
  if (error) return error;
  if (flock((int)fd, LOCK_EX | LOCK_NB) < 0) {
    error = errno;
    close((int)fd);
    if (error == EWOULDBLOCK || error == EAGAIN) { *present = 0; return 0; }
    return error;
  }
  *handle = fd;
  *present = 1;
  return 0;
}

static int posix_dup_inherit(int fd, int minimum, int cloexec);

static int posix_meminfo_text(char **out) {
#ifdef __linux__
  FILE *file = fopen("/proc/meminfo", "r");
  if (!file) return errno;
  char *line = NULL; size_t capacity = 0;
  unsigned long long total = 0, available = 0;
  while (getline(&line, &capacity, file) >= 0) {
    if (!strncmp(line, "MemTotal:", 9)) total = strtoull(line + 9, NULL, 10);
    else if (!strncmp(line, "MemAvailable:", 13)) available = strtoull(line + 13, NULL, 10);
  }
  int error = ferror(file) ? EIO : 0;
  free(line); fclose(file);
  if (error) return error;
  if (!total || !available) return ENODATA;
  char text[96];
  int length = snprintf(text, sizeof text, "total_kb=%llu\navailable_kb=%llu\n", total, available);
  if (length < 0 || (size_t)length >= sizeof text) return EOVERFLOW;
  *out = strdup(text);
  return *out ? 0 : ENOMEM;
#else
  (void)out;
  return ENOSYS;
#endif
}

static int posix_session_kb(u32 root, char **out) {
#ifdef __linux__
  char root_path[64];
  snprintf(root_path, sizeof root_path, "/proc/%u/stat", root);
  FILE *root_file = fopen(root_path, "r");
  if (!root_file) return errno;
  char *root_line = NULL; size_t root_capacity = 0;
  ssize_t root_length = getline(&root_line, &root_capacity, root_file);
  fclose(root_file);
  if (root_length < 0) { free(root_line); return EIO; }
  char *close_paren = strrchr(root_line, ')');
  if (!close_paren) { free(root_line); return EINVAL; }
  char state = 0; int parent = 0, group = 0, session = 0;
  if (sscanf(close_paren + 2, "%c %d %d %d", &state, &parent, &group, &session) != 4 ||
      state == 'Z' || state == 'X') { free(root_line); return ESRCH; }
  free(root_line);
  DIR *proc = opendir("/proc");
  if (!proc) return errno;
  unsigned long long sum = 0;
  int root_status_seen = 0;
  struct dirent *entry;
  while ((entry = readdir(proc))) {
    char *end = NULL; errno = 0;
    long pid = strtol(entry->d_name, &end, 10);
    if (errno || end == entry->d_name || *end || pid <= 0 || pid > UINT32_MAX) continue;
    char path[96];
    snprintf(path, sizeof path, "/proc/%ld/stat", pid);
    FILE *file = fopen(path, "r");
    if (!file) continue;
    char *line = NULL; size_t capacity = 0;
    ssize_t length = getline(&line, &capacity, file);
    fclose(file);
    if (length < 0) { free(line); continue; }
    char *end_name = strrchr(line, ')');
    char proc_state = 0; int proc_parent = 0, proc_group = 0, proc_session = 0;
    int valid = end_name && sscanf(end_name + 2, "%c %d %d %d", &proc_state,
      &proc_parent, &proc_group, &proc_session) == 4;
    free(line);
    if (!valid || proc_state == 'Z' || proc_state == 'X' || proc_session != session) continue;
    snprintf(path, sizeof path, "/proc/%ld/status", pid);
    file = fopen(path, "r");
    if (!file) continue;
    char status[8192]; size_t got = fread(status, 1, sizeof status - 1, file);
    int failed = ferror(file); fclose(file);
    if (failed) continue;
    status[got] = 0;
    char *at; unsigned long long anon = 0, shared = 0, resident = 0;
    char *resident_field = strstr(status, "VmRSS:");
    if ((at = strstr(status, "RssAnon:"))) anon = strtoull(at + 8, NULL, 10);
    if ((at = strstr(status, "RssShmem:"))) shared = strtoull(at + 9, NULL, 10);
    if (resident_field) resident = strtoull(resident_field + 6, NULL, 10);
    if ((u32)pid == root && resident_field) root_status_seen = 1;
    sum += (anon || shared) ? anon + shared : resident;
  }
  closedir(proc);
  if (!root_status_seen) return EACCES;
  char text[64];
  int length = snprintf(text, sizeof text, "kb=%llu\n", sum);
  if (length < 0 || (size_t)length >= sizeof text) return EOVERFLOW;
  *out = strdup(text);
  return *out ? 0 : ENOMEM;
#else
  (void)root; (void)out;
  return ENOSYS;
#endif
}

static int posix_exclusive_lock_pid(const char *path, char **out) {
#ifdef __linux__
  struct stat info;
  if (stat(path, &info)) return errno;
  FILE *locks = fopen("/proc/locks", "r");
  if (!locks) return errno;
  char line[512]; int holder = 0;
  while (fgets(line, sizeof(line), locks)) {
    if (strstr(line, "->") || !strstr(line, "FLOCK")) continue;
    char *at = strstr(line, "WRITE");
    if (!at) continue;
    int pid; unsigned major_id, minor_id; unsigned long inode;
    if (sscanf(at + 5, " %d %x:%x:%lu", &pid, &major_id, &minor_id, &inode) != 4) continue;
    if (inode == (unsigned long)info.st_ino &&
        major_id == major(info.st_dev) && minor_id == minor(info.st_dev)) {
      holder = pid; break;
    }
  }
  int failed = ferror(locks); fclose(locks);
  if (failed) return EIO;
  char text[48];
  int length = snprintf(text, sizeof text, "pid=%d\n", holder);
  if (length < 0 || (size_t)length >= sizeof text) return EOVERFLOW;
  *out = strdup(text);
  return *out ? 0 : ENOMEM;
#else
  (void)path; (void)out;
  return ENOSYS;
#endif
}

static int posix_mkdir_sticky(const char *path) {
  mode_t previous = umask(0007);
  int made = mkdir(path, 01770);
  int saved = errno;
  umask(previous);
  if (!made) return 0;
  if (saved != EEXIST) return saved;
  struct stat info;
  if (stat(path, &info)) return errno;
  if (!S_ISDIR(info.st_mode) || !(info.st_mode & S_ISVTX)) return EPERM;
  return 0;
}

static int posix_lock_shared_try(const char *path, u32 *handle, int *present) {
  mode_t previous = umask(0007);
  int fd = open(path, O_RDWR | O_CREAT | O_NOFOLLOW, 0660);
  int saved = errno; umask(previous); errno = saved;
  if (fd < 0) return errno;
  if (flock(fd, LOCK_SH | LOCK_NB) < 0) {
    int error = errno; close(fd);
    if (error == EWOULDBLOCK || error == EAGAIN) { *present = 0; return 0; }
    return error;
  }
  int copy = posix_dup_inherit(fd, 10, 0);
  int error = copy < 0 ? errno : 0;
  close(fd);
  if (error) return error;
  *handle = (u32)copy; *present = 1;
  return 0;
}

static int posix_lock_fd_acquire(u32 fd) {
  while (flock((int)fd, LOCK_EX) < 0) {
    if (errno == EINTR) continue;
    return errno;
  }
  return 0;
}

static int posix_parse_argv(const char *text, size_t length, char ***out, int *count) {
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

static int posix_dup_inherit(int fd, int minimum, int cloexec) {
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

static int posix_setup_child_fds(int key_lock, int cgen_lock, int status_write,
                              int *status_out) {
  int key_copy = posix_dup_inherit(key_lock, 10, 0);
  int cgen_copy = posix_dup_inherit(cgen_lock, 10, 0);
  int status_copy = posix_dup_inherit(status_write, 10, 1);
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

static int posix_spawn_detached(const char *argv_text, size_t argv_length,
                             u32 key_lock, u32 cgen_lock, char *const *envp, pid_t *pid_out) {
  char **parsed = NULL; int count = 0;
  int error = posix_parse_argv(argv_text, argv_length, &parsed, &count);
  if (error) return error;
  char **argv=parsed;
  const char *exec=argv[0];
  int status[2];
  if (pipe(status)) { free(parsed); return errno; }
  fcntl(status[0], F_SETFD, FD_CLOEXEC);
  fcntl(status[1], F_SETFD, FD_CLOEXEC);
  posix_set_inheritable((int)key_lock);
  posix_set_inheritable((int)cgen_lock);
  pid_t child = fork();
  if (child < 0) {
    error = errno; close(status[0]); close(status[1]);
    free(parsed); return error;
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
    child_error = posix_setup_child_fds((int)key_lock, (int)cgen_lock, status[1], &status_fd);
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
    free(parsed);
    return child_error ? child_error : EIO;
  }
  *pid_out = child;
  free(parsed);
  return 0;
}


static volatile sig_atomic_t host_posix_signal=0;
static struct sigaction host_posix_previous[3];
static int host_posix_watching=0;
static const int host_posix_signals[3]={SIGTERM,SIGINT,SIGHUP};

static void host_posix_notice(int signal_number) {host_posix_signal=signal_number;}

static int host_posix_spawn_held(const char *text,size_t length,const char *cwd,
                                 const char *stdout_path,const char *stderr_path,
                                 u32 *pid,u32 *gate,u32 *errors) {
  char **argv=NULL;int argc=0;
  int error=posix_parse_argv(text,length,&argv,&argc);
  if(error) return error;
  int out=open(stdout_path,O_WRONLY|O_CREAT|O_APPEND,0660);
  if(out<0) {free(argv);return errno;}
  if(fchmod(out,0640)) {error=errno;close(out);free(argv);return error;}
  int err=open(stderr_path,O_WRONLY|O_CREAT|O_APPEND,0660);
  if(err<0) {error=errno;close(out);free(argv);return error;}
  if(fchmod(err,0640)) {error=errno;close(out);close(err);free(argv);return error;}
  int release[2],status[2];
  if(pipe(release)) {error=errno;close(out);close(err);free(argv);return error;}
  if(pipe(status)) {
    error=errno;close(out);close(err);close(release[0]);close(release[1]);free(argv);return error;
  }
  fcntl(status[0],F_SETFD,FD_CLOEXEC);fcntl(status[1],F_SETFD,FD_CLOEXEC);
  fcntl(release[1],F_SETFD,FD_CLOEXEC);
  pid_t child=fork();
  if(child<0) {
    error=errno;close(out);close(err);close(release[0]);close(release[1]);
    close(status[0]);close(status[1]);free(argv);return error;
  }
  if(child==0) {
    close(release[1]);close(status[0]);
    signal(SIGTERM,SIG_DFL);signal(SIGINT,SIG_DFL);signal(SIGHUP,SIG_DFL);
    int input=open("/dev/null",O_RDONLY);
    if(input<0 || dup2(input,0)<0 || dup2(out,1)<0 || dup2(err,2)<0) {
      error=errno;write(status[1],&error,sizeof error);_exit(127);
    }
    if(input>2) close(input);
    close(out);close(err);
    long maximum=sysconf(_SC_OPEN_MAX);
    if(maximum<1024 || maximum>1048576) maximum=65536;
    for(int fd=3;fd<(int)maximum;fd++) {
      if(fd!=8 && !(fd==10 && getenv("BATON_QUEUE_CLAIM_FD")) &&
         fd!=release[0] && fd!=status[1]) close(fd);
    }
    char ready=0;ssize_t got;
    do {got=read(release[0],&ready,1);} while(got<0 && errno==EINTR);
    close(release[0]);
    if(got!=1) _exit(127);
    if(cwd && *cwd && chdir(cwd)) {
      error=errno;write(status[1],&error,sizeof error);_exit(127);
    }
    execvp(argv[0],argv);
    error=errno;write(status[1],&error,sizeof error);_exit(127);
  }
  close(out);close(err);close(release[0]);close(status[1]);free(argv);
  *pid=(u32)child;*gate=(u32)release[1];*errors=(u32)status[0];
  return 0;
}

static int host_posix_release_start(int gate,int errors) {
  sigset_t blocked,previous;
  sigemptyset(&blocked);sigaddset(&blocked,SIGPIPE);
  int error=pthread_sigmask(SIG_BLOCK,&blocked,&previous);
  if(error) {close(gate);close(errors);return error;}
  sigset_t pending;
  int had_pipe=!sigpending(&pending) && sigismember(&pending,SIGPIPE);
  char ready=1;ssize_t sent;
  do {sent=write(gate,&ready,1);} while(sent<0 && errno==EINTR);
  error=sent==1?0:errno;
  close(gate);
  if(error==EPIPE && !had_pipe && !sigpending(&pending) && sigismember(&pending,SIGPIPE)) {
    int signal_number=0;
    sigwait(&blocked,&signal_number);
  }
  pthread_sigmask(SIG_SETMASK,&previous,NULL);
  int child_error=0;ssize_t got;
  do {got=read(errors,&child_error,sizeof child_error);} while(got<0 && errno==EINTR);
  if(got>0) error=child_error?child_error:EIO;
  else if(got<0 && !error) error=errno;
  close(errors);
  return error;
}

typedef struct {
  char *text[4],*answer;
  char spawned[128];
  size_t length[4];
  u32 number[4],value,gate,errors;
  int present;
  int operation,error,result_kind;
} HostPosixCall;

static int host_posix_new_lock(const char *path,const char *body,size_t length,u32 *out) {
  mode_t previous=umask(0007);
  int fd=open(path,O_RDWR|O_CREAT|O_EXCL,0660);
  int saved=errno;umask(previous);
  if(fd<0) return saved;
  int error=0;
  if(flock(fd,LOCK_EX|LOCK_NB)<0) error=errno;
  size_t offset=0;
  while(!error && offset<length) {
    ssize_t count=write(fd,body+offset,length-offset);
    if(count>0) offset+=(size_t)count;
    else if(count<0 && errno==EINTR) continue;
    else error=count<0?errno:EIO;
  }
  if(!error) error=posix_set_inheritable(fd);
  if(error) {close(fd);unlink(path);return error;}
  *out=(u32)fd;return 0;
}

static int host_posix_publish_wait_status(const char *attempt, const char *start,
                                          u32 pid, unsigned int exit_code,
                                          unsigned int signal_code) {
  char directory[PATH_MAX], temporary[PATH_MAX], final[PATH_MAX], body[256];
  int length=snprintf(directory,sizeof directory,"%s",attempt);
  if(length<0 || (size_t)length>=sizeof directory) return ENAMETOOLONG;
  length=snprintf(temporary,sizeof temporary,"%s/exit_status.tmp.%u.%u",attempt,
                  (unsigned)getpid(),pid);
  if(length<0 || (size_t)length>=sizeof temporary) return ENAMETOOLONG;
  length=snprintf(final,sizeof final,"%s/exit_status",attempt);
  if(length<0 || (size_t)length>=sizeof final) return ENAMETOOLONG;
  length=snprintf(body,sizeof body,"pid=%u\nstarttime=%s\nexit=%u\nsignal=%u\n",
                  pid,start,exit_code,signal_code);
  if(length<0 || (size_t)length>=sizeof body) return EOVERFLOW;
  int fd=open(temporary,O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC,0660);
  if(fd<0) return errno;
  int error=0;
  if(fchmod(fd,0660)) error=errno;
  size_t offset=0;
  while(!error && offset<(size_t)length) {
    ssize_t count=write(fd,body+offset,(size_t)length-offset);
    if(count>0) offset+=(size_t)count;
    else if(count<0 && errno==EINTR) continue;
    else error=count<0?errno:EIO;
  }
  if(!error && fsync(fd)) error=errno;
  if(close(fd) && !error) error=errno;
  if(!error && rename(temporary,final)) error=errno;
  if(!error) {
    int dirfd=open(directory,O_RDONLY|O_CLOEXEC);
    if(dirfd<0) error=errno;
    else {
      if(fsync(dirfd)) error=errno;
      if(close(dirfd) && !error) error=errno;
    }
  }
  if(error) unlink(temporary);
  return error;
}

static void host_posix_work(IoWork *work) {
  HostPosixCall *call=(HostPosixCall *)work->data;
  int fd,status;
  switch(call->operation) {
    case 1: call->value=(u32)getpid();break;
    case 2: call->value=(u32)getuid();break;
    case 3:
      {pid_t sid=getsid(0);if(sid<0) call->error=errno;else call->value=(u32)sid;}
      break;
    case 4:
      call->answer=getcwd(NULL,0);if(!call->answer) call->error=errno;
      break;
    case 5: call->error=posix_self_path(&call->answer);break;
    case 6: call->error=posix_now_text(CLOCK_REALTIME,&call->answer);break;
    case 7: call->error=posix_now_text(CLOCK_MONOTONIC,&call->answer);break;
    case 8: call->error=posix_starttime_text(call->number[0],&call->answer);break;
    case 9: call->error=posix_alive_value(call->number[0],call->text[1],&call->value);break;
    case 10: if(kill((pid_t)call->number[0],(int)call->number[1])) call->error=errno;break;
    case 11: if(kill(-(pid_t)call->number[0],(int)call->number[1])) call->error=errno;break;
    case 12: call->error=posix_lock_open(call->text[0],&call->value);break;
    case 13: call->error=posix_lock_acquire(call->text[0],&call->value);break;
    case 14: call->error=posix_lock_fd_acquire(call->number[0]);break;
    case 15:
      if(flock((int)call->number[0],LOCK_UN)<0) call->error=errno;
      if(close((int)call->number[0]) && !call->error) call->error=errno;
      break;
    case 16: if(close((int)call->number[0])) call->error=errno;break;
    case 17:
      if(dup2((int)call->number[0],(int)call->number[1])<0) call->error=errno;
      else call->error=posix_set_inheritable((int)call->number[1]);
      break;
    case 18:
      fd=open(call->text[0],O_RDONLY|O_CLOEXEC);
      if(fd<0) {call->error=errno;break;}
      if(flock(fd,LOCK_SH|LOCK_NB)<0) {
        if(errno==EWOULDBLOCK || errno==EAGAIN) call->value=1;
        else call->error=errno;
      }
      close(fd);break;
    case 19:
      call->error=host_posix_new_lock(call->text[0],call->text[1],call->length[1],&call->value);
      break;
    case 20: {
      char **environment=NULL;int count=0;
      if(call->length[3]) call->error=posix_parse_argv(call->text[3],call->length[3],&environment,&count);
      pid_t child=0;
      if(!call->error) call->error=posix_spawn_detached(call->text[0],call->length[0],
        call->number[1],call->number[2],environment,&child);
      free(environment);call->value=(u32)child;break;
    }
    case 33: {
      char **environment=NULL;int environment_count=0;
      if(call->length[3])
        call->error=posix_parse_argv(call->text[3],call->length[3],&environment,&environment_count);
      pid_t child=0;
      if(!call->error) call->error=posix_spawn_detached(call->text[0],call->length[0],
        call->number[1],call->number[2],environment,&child);
      free(environment);
      char *start=NULL;
      if(!call->error) call->error=posix_starttime_text((u32)child,&start);
      if(!call->error) {
        int length=snprintf(call->spawned,sizeof call->spawned,"pid=%u\nstarttime=%s\n",
          (unsigned)child,start);
        if(length<0 || (size_t)length>=sizeof call->spawned) call->error=EOVERFLOW;
      }
      free(start);break;
    }
    case 21:
      call->error=host_posix_spawn_held(call->text[0],call->length[0],
        call->text[1],call->text[2],call->text[3],&call->value,&call->gate,&call->errors);
      if(!call->error) snprintf(call->spawned,sizeof call->spawned,"pid=%u\ngate=%u\nstatus=%u\n",call->value,call->gate,call->errors);
      break;
    case 22: call->error=host_posix_release_start((int)call->number[0],(int)call->number[1]);break;
    case 23: {
      pid_t result=waitpid((pid_t)call->number[1],&status,WNOHANG);
      if(result<0 && errno==EINTR) result=0;
      if(result<0) call->error=errno;
      else if(!result) call->answer=strdup("running=1\n");
      else {
        char text[96];
        unsigned int exit_code=WIFEXITED(status)?(unsigned)WEXITSTATUS(status):
          WIFSIGNALED(status)?(unsigned)(128+WTERMSIG(status)):1;
        unsigned int signal_code=WIFSIGNALED(status)?(unsigned)WTERMSIG(status):0;
        call->error=host_posix_publish_wait_status(call->text[0],call->text[2],
          call->number[1],exit_code,signal_code);
        if(!call->error) {
          snprintf(text,sizeof text,"running=0\nexit=%u\nsignal=%u\n",exit_code,signal_code);
          call->answer=strdup(text);
        }
      }
      if(!call->error && !call->answer) call->error=ENOMEM;
      break;
    }
    case 34: {
      do {fd=waitpid((pid_t)call->number[0],&status,0);} while(fd<0 && errno==EINTR);
      if(fd<0) call->error=errno;
      else {
        char text[96];
        unsigned int exit_code=WIFEXITED(status)?(unsigned)WEXITSTATUS(status):
          WIFSIGNALED(status)?(unsigned)(128+WTERMSIG(status)):1;
        unsigned int signal_code=WIFSIGNALED(status)?(unsigned)WTERMSIG(status):0;
        snprintf(text,sizeof text,"running=0\nexit=%u\nsignal=%u\n",exit_code,signal_code);
        call->answer=strdup(text);
      }
      if(!call->error && !call->answer) call->error=ENOMEM;
      break;
    }
    case 24:
      do {fd=waitpid((pid_t)call->number[0],&status,0);} while(fd<0 && errno==EINTR);
      if(fd<0) call->error=errno;
      else call->value=WIFEXITED(status)?(u32)WEXITSTATUS(status):
        WIFSIGNALED(status)?(u32)(128+WTERMSIG(status)):1;
      break;
    case 25: {
      if(host_posix_watching) {call->error=EBUSY;break;}
      struct sigaction action;
      memset(&action,0,sizeof action);action.sa_handler=host_posix_notice;
      sigemptyset(&action.sa_mask);host_posix_signal=0;
      for(int i=0;i<3;i++) {
        if(sigaction(host_posix_signals[i],&action,&host_posix_previous[i])) {
          call->error=errno;
          for(int j=0;j<i;j++) sigaction(host_posix_signals[j],&host_posix_previous[j],NULL);
          break;
        }
      }
      if(!call->error) host_posix_watching=1;
      break;
    }
    case 26:
      if(host_posix_watching) {
        for(int i=0;i<3;i++) if(sigaction(host_posix_signals[i],&host_posix_previous[i],NULL) && !call->error) call->error=errno;
        host_posix_watching=0;
      }
      break;
    case 27: call->value=(u32)host_posix_signal;break;
    case 28: {
      struct rusage usage;
      if(getrusage(RUSAGE_CHILDREN,&usage)) {call->error=errno;break;}
      char text[32];
#ifdef __APPLE__
      snprintf(text,sizeof text,"%llu",(unsigned long long)usage.ru_maxrss/1024);
#else
      snprintf(text,sizeof text,"%llu",(unsigned long long)usage.ru_maxrss);
#endif
      call->answer=strdup(text);if(!call->answer) call->error=ENOMEM;break;
    }
    case 29: if(setenv(call->text[0],call->text[1],1)) call->error=errno;break;
    case 30: {
      size_t offset=0;
      while(offset<call->length[0]) {
        ssize_t count=write(STDERR_FILENO,call->text[0]+offset,call->length[0]-offset);
        if(count>0) offset+=(size_t)count;
        else if(count<0 && errno==EINTR) continue;
        else {call->error=count<0?errno:EIO;break;}
      }
      break;
    }
    case 31:
#ifdef __linux__
      call->answer=strdup("linux");
#elif defined(__APPLE__)
      call->answer=strdup("darwin");
#else
      call->answer=strdup("other");
#endif
      if(!call->answer) call->error=ENOMEM;break;
    case 32:
      call->error=posix_lock_try(call->text[0],&call->value,&call->present);break;
    case 35: call->error=posix_meminfo_text(&call->answer);break;
    case 36: call->error=posix_session_kb(call->number[0],&call->answer);break;
    case 37: call->error=posix_lock_shared_try(call->text[0],&call->value,&call->present);break;
    case 38: call->error=posix_seconds_text(&call->answer);break;
    case 39: call->error=posix_mkdir_sticky(call->text[0]);break;
    case 40: call->error=posix_exclusive_lock_pid(call->text[0],&call->answer);break;
  }
}

static Term host_posix_pack(Env env,IoWork *work) {
  HostPosixCall *call=(HostPosixCall *)work->data;
  Term value=term_pak(CID_UNIT,0);
  if(!call->error) {
    if(call->result_kind==1) value=(Term)call->value;
    else if(call->result_kind==2) value=io_str(env,call->answer?call->answer:"",call->answer?strlen(call->answer):0);
    else if(call->result_kind==3) value=io_str(env,call->spawned,strlen(call->spawned));
    else if(call->result_kind==4) value=call->present?io_box(env,CID_SOME,(Term)call->value):term_pak(CID_NONE,0);
  }
  Term result=call->error?io_fail(env,call->error,NULL):io_done(env,value);
  for(int i=0;i<4;i++) free(call->text[i]);
  free(call->answer);free(call);work->data=NULL;return result;
}

static Term host_posix_run(Env env,Term *fields,IoWork *work,int operation,
                           int result_kind,const char *pattern) {
  HostPosixCall *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(env,ENOMEM,NULL);
  call->operation=operation;call->result_kind=result_kind;
  for(int i=0;pattern[i];i++) {
    if(pattern[i]=='u') call->number[i]=(u32)fields[i];
    else {
      u64 length=0;
      call->text[i]=io_cstr(env,fields[i],&length);call->length[i]=(size_t)length;
      if(!call->text[i]) call->error=ENOMEM;
      else if(pattern[i]=='s' && strlen(call->text[i])!=length) call->error=EINVAL;
    }
  }
  work->data=(char *)call;
  if(call->error) return host_posix_pack(env,work);
  return io_work(work,host_posix_work,host_posix_pack);
}

#ifdef CID_HOSTPOSIX_MKDIR_STICKY
static Term host_posix_mkdir_sticky_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,39,0,"s");}
static void __attribute__((constructor)) host_posix_mkdir_sticky_use(void) {io_eff(CID_HOSTPOSIX_MKDIR_STICKY,host_posix_mkdir_sticky_run,0);}
#endif
#ifdef CID_HOSTPOSIX_NOW_SECONDS
static Term host_posix_now_seconds_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,38,2,"");}
static void __attribute__((constructor)) host_posix_now_seconds_use(void) {io_eff(CID_HOSTPOSIX_NOW_SECONDS,host_posix_now_seconds_run,0);}
#endif
#ifdef CID_HOSTPOSIX_MEMINFO
static Term host_posix_meminfo_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,35,2,"");}
static void __attribute__((constructor)) host_posix_meminfo_use(void) {io_eff(CID_HOSTPOSIX_MEMINFO,host_posix_meminfo_run,0);}
#endif
#ifdef CID_HOSTPOSIX_SESSION_KB
static Term host_posix_session_kb_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,36,2,"u");}
static void __attribute__((constructor)) host_posix_session_kb_use(void) {io_eff(CID_HOSTPOSIX_SESSION_KB,host_posix_session_kb_run,0);}
#endif
#ifdef CID_HOSTPOSIX_EXCLUSIVE_LOCK_PID
static Term host_posix_exclusive_lock_pid_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,40,2,"s");}
static void __attribute__((constructor)) host_posix_exclusive_lock_pid_use(void) {io_eff(CID_HOSTPOSIX_EXCLUSIVE_LOCK_PID,host_posix_exclusive_lock_pid_run,0);}
#endif
#ifdef CID_HOSTPOSIX_LOCK_SHARED_TRY
static Term host_posix_lock_shared_try_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,37,4,"s");}
static void __attribute__((constructor)) host_posix_lock_shared_try_use(void) {io_eff(CID_HOSTPOSIX_LOCK_SHARED_TRY,host_posix_lock_shared_try_run,0);}
#endif
#ifdef CID_HOSTPOSIX_PID
static Term host_posix_pid_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,1,1,"");}
static void __attribute__((constructor)) host_posix_pid_use(void) {io_eff(CID_HOSTPOSIX_PID,host_posix_pid_run,0);}
#endif
#ifdef CID_HOSTPOSIX_UID
static Term host_posix_uid_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,2,1,"");}
static void __attribute__((constructor)) host_posix_uid_use(void) {io_eff(CID_HOSTPOSIX_UID,host_posix_uid_run,0);}
#endif
#ifdef CID_HOSTPOSIX_SID
static Term host_posix_sid_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,3,1,"");}
static void __attribute__((constructor)) host_posix_sid_use(void) {io_eff(CID_HOSTPOSIX_SID,host_posix_sid_run,0);}
#endif
#ifdef CID_HOSTPOSIX_CWD
static Term host_posix_cwd_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,4,2,"");}
static void __attribute__((constructor)) host_posix_cwd_use(void) {io_eff(CID_HOSTPOSIX_CWD,host_posix_cwd_run,0);}
#endif
#ifdef CID_HOSTPOSIX_SELF_EXE
static Term host_posix_self_exe_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,5,2,"");}
static void __attribute__((constructor)) host_posix_self_exe_use(void) {io_eff(CID_HOSTPOSIX_SELF_EXE,host_posix_self_exe_run,0);}
#endif
#ifdef CID_HOSTPOSIX_NOW_NS
static Term host_posix_now_ns_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,6,2,"");}
static void __attribute__((constructor)) host_posix_now_ns_use(void) {io_eff(CID_HOSTPOSIX_NOW_NS,host_posix_now_ns_run,0);}
#endif
#ifdef CID_HOSTPOSIX_MONOTONIC_NS
static Term host_posix_monotonic_ns_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,7,2,"");}
static void __attribute__((constructor)) host_posix_monotonic_ns_use(void) {io_eff(CID_HOSTPOSIX_MONOTONIC_NS,host_posix_monotonic_ns_run,0);}
#endif
#ifdef CID_HOSTPOSIX_STARTTIME
static Term host_posix_starttime_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,8,2,"u");}
static void __attribute__((constructor)) host_posix_starttime_use(void) {io_eff(CID_HOSTPOSIX_STARTTIME,host_posix_starttime_run,0);}
#endif
#ifdef CID_HOSTPOSIX_ALIVE
static Term host_posix_alive_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,9,1,"us");}
static void __attribute__((constructor)) host_posix_alive_use(void) {io_eff(CID_HOSTPOSIX_ALIVE,host_posix_alive_run,0);}
#endif
#ifdef CID_HOSTPOSIX_SIGNAL_PID
static Term host_posix_signal_pid_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,10,0,"uu");}
static void __attribute__((constructor)) host_posix_signal_pid_use(void) {io_eff(CID_HOSTPOSIX_SIGNAL_PID,host_posix_signal_pid_run,0);}
#endif
#ifdef CID_HOSTPOSIX_SIGNAL_GROUP
static Term host_posix_signal_group_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,11,0,"uu");}
static void __attribute__((constructor)) host_posix_signal_group_use(void) {io_eff(CID_HOSTPOSIX_SIGNAL_GROUP,host_posix_signal_group_run,0);}
#endif
#ifdef CID_HOSTPOSIX_LOCK_OPEN
static Term host_posix_lock_open_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,12,1,"s");}
static void __attribute__((constructor)) host_posix_lock_open_use(void) {io_eff(CID_HOSTPOSIX_LOCK_OPEN,host_posix_lock_open_run,0);}
#endif
#ifdef CID_HOSTPOSIX_LOCK_ACQUIRE
static Term host_posix_lock_acquire_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,13,1,"s");}
static void __attribute__((constructor)) host_posix_lock_acquire_use(void) {io_eff(CID_HOSTPOSIX_LOCK_ACQUIRE,host_posix_lock_acquire_run,0);}
#endif
#ifdef CID_HOSTPOSIX_LOCK_TRY
static Term host_posix_lock_try_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,32,4,"s");}
static void __attribute__((constructor)) host_posix_lock_try_use(void) {io_eff(CID_HOSTPOSIX_LOCK_TRY,host_posix_lock_try_run,0);}
#endif
#ifdef CID_HOSTPOSIX_LOCK_FD_ACQUIRE
static Term host_posix_lock_fd_acquire_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,14,0,"u");}
static void __attribute__((constructor)) host_posix_lock_fd_acquire_use(void) {io_eff(CID_HOSTPOSIX_LOCK_FD_ACQUIRE,host_posix_lock_fd_acquire_run,0);}
#endif
#ifdef CID_HOSTPOSIX_LOCK_RELEASE
static Term host_posix_lock_release_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,15,0,"u");}
static void __attribute__((constructor)) host_posix_lock_release_use(void) {io_eff(CID_HOSTPOSIX_LOCK_RELEASE,host_posix_lock_release_run,0);}
#endif
#ifdef CID_HOSTPOSIX_CLOSE_FD
static Term host_posix_close_fd_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,16,0,"u");}
static void __attribute__((constructor)) host_posix_close_fd_use(void) {io_eff(CID_HOSTPOSIX_CLOSE_FD,host_posix_close_fd_run,0);}
#endif
#ifdef CID_HOSTPOSIX_DUP_TO
static Term host_posix_dup_to_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,17,0,"uu");}
static void __attribute__((constructor)) host_posix_dup_to_use(void) {io_eff(CID_HOSTPOSIX_DUP_TO,host_posix_dup_to_run,0);}
#endif
#ifdef CID_HOSTPOSIX_HELD
static Term host_posix_held_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,18,1,"s");}
static void __attribute__((constructor)) host_posix_held_use(void) {io_eff(CID_HOSTPOSIX_HELD,host_posix_held_run,0);}
#endif
#ifdef CID_HOSTPOSIX_CREATE_LOCKED
static Term host_posix_create_locked_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,19,1,"sb");}
static void __attribute__((constructor)) host_posix_create_locked_use(void) {io_eff(CID_HOSTPOSIX_CREATE_LOCKED,host_posix_create_locked_run,0);}
#endif
#ifdef CID_HOSTPOSIX_SPAWN_DETACHED
static Term host_posix_spawn_detached_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,20,1,"buub");}
static void __attribute__((constructor)) host_posix_spawn_detached_use(void) {io_eff(CID_HOSTPOSIX_SPAWN_DETACHED,host_posix_spawn_detached_run,0);}
#endif
#ifdef CID_HOSTPOSIX_SPAWN_DETACHED_IDENTITY
static Term host_posix_spawn_detached_identity_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,33,3,"buub");}
static void __attribute__((constructor)) host_posix_spawn_detached_identity_use(void) {io_eff(CID_HOSTPOSIX_SPAWN_DETACHED_IDENTITY,host_posix_spawn_detached_identity_run,0);}
#endif
#ifdef CID_HOSTPOSIX_SPAWN_HELD
static Term host_posix_spawn_held_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,21,3,"bsss");}
static void __attribute__((constructor)) host_posix_spawn_held_use(void) {io_eff(CID_HOSTPOSIX_SPAWN_HELD,host_posix_spawn_held_run,0);}
#endif
#ifdef CID_HOSTPOSIX_START
static Term host_posix_start_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,22,0,"uu");}
static void __attribute__((constructor)) host_posix_start_use(void) {io_eff(CID_HOSTPOSIX_START,host_posix_start_run,0);}
#endif
#ifdef CID_HOSTPOSIX_TRY_WAIT
static Term host_posix_try_wait_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,23,2,"sus");}
static void __attribute__((constructor)) host_posix_try_wait_use(void) {io_eff(CID_HOSTPOSIX_TRY_WAIT,host_posix_try_wait_run,0);}
#endif
#ifdef CID_HOSTPOSIX_WAIT_SUPERVISOR
static Term host_posix_wait_supervisor_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,34,2,"u");}
static void __attribute__((constructor)) host_posix_wait_supervisor_use(void) {io_eff(CID_HOSTPOSIX_WAIT_SUPERVISOR,host_posix_wait_supervisor_run,0);}
#endif
#ifdef CID_HOSTPOSIX_WAIT_PID
static Term host_posix_wait_pid_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,24,1,"u");}
static void __attribute__((constructor)) host_posix_wait_pid_use(void) {io_eff(CID_HOSTPOSIX_WAIT_PID,host_posix_wait_pid_run,0);}
#endif
#ifdef CID_HOSTPOSIX_WATCH_SIGNALS
static Term host_posix_watch_signals_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,25,0,"");}
static void __attribute__((constructor)) host_posix_watch_signals_use(void) {io_eff(CID_HOSTPOSIX_WATCH_SIGNALS,host_posix_watch_signals_run,0);}
#endif
#ifdef CID_HOSTPOSIX_RESTORE_SIGNALS
static Term host_posix_restore_signals_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,26,0,"");}
static void __attribute__((constructor)) host_posix_restore_signals_use(void) {io_eff(CID_HOSTPOSIX_RESTORE_SIGNALS,host_posix_restore_signals_run,0);}
#endif
#ifdef CID_HOSTPOSIX_PENDING_SIGNAL
static Term host_posix_pending_signal_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,27,1,"");}
static void __attribute__((constructor)) host_posix_pending_signal_use(void) {io_eff(CID_HOSTPOSIX_PENDING_SIGNAL,host_posix_pending_signal_run,0);}
#endif
#ifdef CID_HOSTPOSIX_CHILDREN_PEAK
static Term host_posix_children_peak_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,28,2,"");}
static void __attribute__((constructor)) host_posix_children_peak_use(void) {io_eff(CID_HOSTPOSIX_CHILDREN_PEAK,host_posix_children_peak_run,0);}
#endif
#ifdef CID_HOSTPOSIX_SET_ENV
static Term host_posix_set_env_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,29,0,"ss");}
static void __attribute__((constructor)) host_posix_set_env_use(void) {io_eff(CID_HOSTPOSIX_SET_ENV,host_posix_set_env_run,0);}
#endif
#ifdef CID_HOSTPOSIX_WRITE_STDERR
static Term host_posix_write_stderr_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,30,0,"b");}
static void __attribute__((constructor)) host_posix_write_stderr_use(void) {io_eff(CID_HOSTPOSIX_WRITE_STDERR,host_posix_write_stderr_run,0);}
#endif
#ifdef CID_HOSTPOSIX_PLATFORM
static Term host_posix_platform_run(Env e,Term *f,IoWork *w) {return host_posix_run(e,f,w,31,2,"");}
static void __attribute__((constructor)) host_posix_platform_use(void) {io_eff(CID_HOSTPOSIX_PLATFORM,host_posix_platform_run,0);}
#endif
