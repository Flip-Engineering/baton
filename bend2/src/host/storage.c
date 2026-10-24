/* Host evidence for the Bend2 storage policy.
 *
 * observe, measure and entries open every parent component with O_NOFOLLOW
 * and use fstatat(AT_SYMLINK_NOFOLLOW) for the final component, so a path
 * reached through a symlink reports an error and never the target's identity.
 *
 * remove revalidates the caller's observed identity at the opened parent and
 * then unlinks the exact directory entry. A directory tree is walked through
 * directory descriptors opened with O_NOFOLLOW; symlink entries are unlinked
 * and never followed. A replaced path answers "changed" instead of removing
 * something the preview did not observe.
 *
 * process_refs and runtime_refs compare cwd, executable, descriptor and
 * mapped-file targets for every process of the current user by device and
 * inode. A descriptor whose directory entry is unlinked still matches its
 * recorded path after the " (deleted)" suffix is removed. /proc is
 * Linux-only; other hosts answer an unknown result so cleanup preserves the
 * candidate.
 */

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#ifndef O_CLOEXEC
#define O_CLOEXEC 0
#endif
#ifndef O_NOFOLLOW
#define O_NOFOLLOW 0
#endif
#ifndef O_DIRECTORY
#define O_DIRECTORY 0
#endif
#ifndef AT_SYMLINK_NOFOLLOW
#define AT_SYMLINK_NOFOLLOW 0
#endif
#ifndef AT_REMOVEDIR
#define AT_REMOVEDIR 0
#endif

#define BATON_STORAGE_DEPTH 128
#define BATON_STORAGE_PID_LIMIT 65536
#define BATON_STORAGE_REF_LIMIT 4096

typedef unsigned long long baton_u64;

#ifndef O_PATH
#define O_PATH O_RDONLY
#endif

/* Traversal uses O_PATH where available so an execute-only parent still
   permits descent; the final directory is reopened read-only for listing. */
static int baton_storage_dir_flags(void) {
  return O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC;
}

static int baton_storage_read_dir_flags(void) {
  return O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC;
}

/* Opens each component of PATH without following a symlink. PATH may be
 * relative or absolute and must not contain "..". */
static int baton_storage_open_dir_at(int base, const char *path) {
  int fd = dup(base);
  if (fd < 0) return -1;
  const char *cursor = path;
  while (*cursor) {
    while (*cursor == '/') cursor++;
    if (!*cursor) break;
    const char *start = cursor;
    while (*cursor && *cursor != '/') cursor++;
    size_t length = (size_t)(cursor - start);
    if (length == 0) continue;
    if (length == 1 && start[0] == '.') continue;
    if (length == 2 && start[0] == '.' && start[1] == '.') { close(fd); errno = EPERM; return -1; }
    char *part = strndup(start, length);
    if (!part) { close(fd); errno = ENOMEM; return -1; }
    int next = openat(fd, part, baton_storage_dir_flags());
    int saved = errno;
    free(part);
    close(fd);
    if (next < 0) { errno = saved; return -1; }
    fd = next;
  }
  return fd;
}

static int baton_storage_open_dir(const char *path) {
  int fd = path[0] == '/' ? open("/", baton_storage_dir_flags()) : open(".", baton_storage_dir_flags());
  if (fd < 0) return -1;
  const char *cursor = path;
  while (*cursor) {
    while (*cursor == '/') cursor++;
    if (!*cursor) break;
    const char *start = cursor;
    while (*cursor && *cursor != '/') cursor++;
    size_t length = (size_t)(cursor - start);
    if (length == 0) continue;
    if (length == 1 && start[0] == '.') continue;
    if (length == 2 && start[0] == '.' && start[1] == '.') { close(fd); errno = EPERM; return -1; }
    char *part = strndup(start, length);
    if (!part) { close(fd); errno = ENOMEM; return -1; }
    int next = openat(fd, part, baton_storage_dir_flags());
    int saved = errno;
    free(part);
    close(fd);
    if (next < 0) { errno = saved; return -1; }
    fd = next;
  }
  return fd;
}

/* Splits PATH into a parent directory and a final entry name. The caller frees
 * both. Trailing slashes are ignored. */
static int baton_storage_split(const char *path, char **parent, char **name) {
  char *copy = strdup(path);
  if (!copy) { errno = ENOMEM; return -1; }
  size_t length = strlen(copy);
  while (length > 1 && copy[length - 1] == '/') copy[--length] = 0;
  char *slash = strrchr(copy, '/');
  if (!slash) {
    *parent = strdup(".");
    *name = strdup(copy);
  } else if (slash == copy) {
    *parent = strdup("/");
    *name = strdup(slash + 1);
  } else {
    *slash = 0;
    *parent = strdup(copy);
    *name = strdup(slash + 1);
  }
  free(copy);
  if (!*parent || !*name) {
    free(*parent); free(*name);
    errno = ENOMEM;
    return -1;
  }
  if ((*name)[0] == 0 || !strcmp(*name, ".") || !strcmp(*name, "..")) {
    free(*parent); free(*name);
    errno = EINVAL;
    return -1;
  }
  return 0;
}

static const char *baton_storage_kind(mode_t mode) {
  if (S_ISREG(mode)) return "file";
  if (S_ISDIR(mode)) return "dir";
  if (S_ISLNK(mode)) return "symlink";
  return "other";
}

/* Identity text: kind:device:inode. */
static int baton_storage_identity_parse(const char *identity, char *kind, size_t capacity,
                                        baton_u64 *device, baton_u64 *inode) {
  const char *first = strchr(identity, ':');
  if (!first) return -1;
  size_t length = (size_t)(first - identity);
  if (length == 0 || length >= capacity) return -1;
  memcpy(kind, identity, length);
  kind[length] = 0;
  const char *cursor = first + 1;
  char *end = NULL;
  *device = strtoull(cursor, &end, 10);
  if (end == cursor || *end != ':') return -1;
  cursor = end + 1;
  *inode = strtoull(cursor, &end, 10);
  if (end == cursor || *end) return -1;
  return 0;
}

static int baton_storage_identity_match(const struct stat *info, const char *kind,
                                        baton_u64 device, baton_u64 inode) {
  if (strcmp(kind, baton_storage_kind(info->st_mode))) return 0;
  if ((baton_u64)info->st_dev != device) return 0;
  if ((baton_u64)info->st_ino != inode) return 0;
  return 1;
}

/* ---------- observe ---------- */

typedef struct { char *path, *answer; int error; } BatonStorageObserve;

static void baton_storage_observe_call(IoWork *w) {
  BatonStorageObserve *call = (BatonStorageObserve *)w->data;
  char *parent = NULL, *name = NULL;
  if (baton_storage_split(call->path, &parent, &name)) { call->error = errno; return; }
  int fd = baton_storage_open_dir(parent);
  if (fd < 0) {
    if (errno == ENOENT) call->answer = strdup("missing\t0\t0\t0");
    else call->error = errno;
    free(parent); free(name);
    return;
  }
  struct stat info;
  if (fstatat(fd, name, &info, AT_SYMLINK_NOFOLLOW)) {
    if (errno == ENOENT) call->answer = strdup("missing\t0\t0\t0");
    else call->error = errno;
  } else {
    baton_u64 bytes = S_ISREG(info.st_mode) && info.st_size > 0 ? (baton_u64)info.st_size : 0;
    char text[256];
    snprintf(text, sizeof(text), "%s\t%llu\t%llu\t%llu",
      baton_storage_kind(info.st_mode), (baton_u64)info.st_dev, (baton_u64)info.st_ino, bytes);
    call->answer = strdup(text);
    if (!call->answer) call->error = ENOMEM;
  }
  close(fd);
  free(parent); free(name);
}

static Term baton_storage_observe_pack(Env e, IoWork *w) {
  BatonStorageObserve *call = (BatonStorageObserve *)w->data;
  Term result = call->error ? io_fail(e, call->error, "storage observation failed")
    : io_done(e, io_str(e, call->answer, strlen(call->answer)));
  free(call->path); free(call->answer); free(call);
  w->data = NULL;
  return result;
}

/* ---------- measure ---------- */

typedef struct { baton_u64 bytes, nodes, other; } BatonStorageCount;

static int baton_storage_measure_walk(int fd, BatonStorageCount *count, int depth);

static int baton_storage_measure_entry(int fd, const char *name, BatonStorageCount *count, int depth) {
  struct stat info;
  if (fstatat(fd, name, &info, AT_SYMLINK_NOFOLLOW)) return errno == ENOENT ? 0 : errno;
  if (S_ISREG(info.st_mode)) {
    count->nodes++;
    if (info.st_size > 0) count->bytes += (baton_u64)info.st_size;
    return 0;
  }
  if (S_ISLNK(info.st_mode)) { count->nodes++; return 0; }
  if (S_ISDIR(info.st_mode)) {
    int child = openat(fd, name, baton_storage_read_dir_flags());
    if (child < 0) return errno == ENOENT ? 0 : errno;
    struct stat opened;
    if (fstat(child, &opened) || opened.st_dev != info.st_dev || opened.st_ino != info.st_ino) {
      close(child);
      return ESTALE;
    }
    count->nodes++;
    int error = baton_storage_measure_walk(child, count, depth + 1);
    close(child);
    return error;
  }
  count->other++;
  return 0;
}

static int baton_storage_measure_walk(int fd, BatonStorageCount *count, int depth) {
  if (depth > BATON_STORAGE_DEPTH) return ELOOP;
  int copy = dup(fd);
  if (copy < 0) return errno;
  DIR *directory = fdopendir(copy);
  if (!directory) { close(copy); return errno; }
  int error = 0;
  struct dirent *entry;
  for (;;) {
    errno = 0;
    entry = readdir(directory);
    if (!entry) { if (errno) error = errno; break; }
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    error = baton_storage_measure_entry(fd, entry->d_name, count, depth);
    if (error) break;
  }
  closedir(directory);
  return error;
}

typedef struct { char *path, *answer; int error; } BatonStorageMeasure;

static void baton_storage_measure_call(IoWork *w) {
  BatonStorageMeasure *call = (BatonStorageMeasure *)w->data;
  char *parent = NULL, *name = NULL;
  if (baton_storage_split(call->path, &parent, &name)) { call->error = errno; return; }
  int fd = baton_storage_open_dir(parent);
  if (fd < 0) {
    if (errno == ENOENT) call->answer = strdup("0\t0\t0");
    else call->error = errno;
    free(parent); free(name);
    return;
  }
  struct stat info;
  BatonStorageCount count = {0, 0, 0};
  if (fstatat(fd, name, &info, AT_SYMLINK_NOFOLLOW)) {
    if (errno != ENOENT) call->error = errno;
  } else if (S_ISREG(info.st_mode)) {
    count.nodes = 1;
    if (info.st_size > 0) count.bytes = (baton_u64)info.st_size;
  } else if (S_ISLNK(info.st_mode)) {
    count.nodes = 1;
  } else if (S_ISDIR(info.st_mode)) {
    count.nodes = 1;
    int child = openat(fd, name, baton_storage_read_dir_flags());
    if (child < 0) { if (errno != ENOENT) call->error = errno; }
    else {
      struct stat opened;
      if (fstat(child, &opened) || opened.st_dev != info.st_dev || opened.st_ino != info.st_ino) call->error = ESTALE;
      else call->error = baton_storage_measure_walk(child, &count, 0);
      close(child);
    }
  } else {
    count.other = 1;
  }
  if (!call->error) {
    char text[256];
    snprintf(text, sizeof(text), "%llu\t%llu\t%llu", count.bytes, count.nodes, count.other);
    call->answer = strdup(text);
    if (!call->answer) call->error = ENOMEM;
  }
  close(fd);
  free(parent); free(name);
}

static Term baton_storage_measure_pack(Env e, IoWork *w) {
  BatonStorageMeasure *call = (BatonStorageMeasure *)w->data;
  Term result = call->error ? io_fail(e, call->error, "storage measurement failed")
    : io_done(e, io_str(e, call->answer, strlen(call->answer)));
  free(call->path); free(call->answer); free(call);
  w->data = NULL;
  return result;
}

/* ---------- entries ---------- */

typedef struct { char *path, *answer; size_t length, capacity; int error; } BatonStorageEntries;

static int baton_storage_entries_push(BatonStorageEntries *call, const char *text, size_t length) {
  if (call->length > (size_t)-1 - length - 1) return ENOMEM;
  if (call->length + length + 1 > call->capacity) {
    size_t next = call->capacity ? call->capacity * 2 : 256;
    while (next < call->length + length + 1) next *= 2;
    char *grown = realloc(call->answer, next);
    if (!grown) return ENOMEM;
    call->answer = grown;
    call->capacity = next;
  }
  memcpy(call->answer + call->length, text, length);
  call->length += length;
  call->answer[call->length] = 0;
  return 0;
}

/* One record per child: kind, TAB, name, NUL. */
static void baton_storage_entries_call(IoWork *w) {
  BatonStorageEntries *call = (BatonStorageEntries *)w->data;
  int path_fd = baton_storage_open_dir(call->path);
  if (path_fd < 0) {
    if (errno == ENOENT) { call->answer = strdup(""); call->length = 0; call->capacity = 1; return; }
    call->error = errno;
    return;
  }
  int fd = openat(path_fd, ".", baton_storage_read_dir_flags());
  int opened_error = errno;
  close(path_fd);
  if (fd < 0) { call->error = opened_error; return; }
  int copy = dup(fd);
  if (copy < 0) { call->error = errno; close(fd); return; }
  DIR *directory = fdopendir(copy);
  if (!directory) { call->error = errno; close(copy); close(fd); return; }
  struct dirent *entry;
  for (;;) {
    errno = 0;
    entry = readdir(directory);
    if (!entry) { if (errno) call->error = errno; break; }
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    if (strchr(entry->d_name, '\t') || strchr(entry->d_name, '\n')) { call->error = EINVAL; break; }
    struct stat info;
    if (fstatat(fd, entry->d_name, &info, AT_SYMLINK_NOFOLLOW)) {
      if (errno == ENOENT) continue;
      call->error = errno;
      break;
    }
    const char *kind = baton_storage_kind(info.st_mode);
    size_t kind_length = strlen(kind);
    size_t name_length = strlen(entry->d_name);
    size_t text_length = kind_length + 1 + name_length;
    char *text = malloc(text_length + 1);
    if (!text) { call->error = ENOMEM; break; }
    memcpy(text, kind, kind_length);
    text[kind_length] = '\t';
    memcpy(text + kind_length + 1, entry->d_name, name_length);
    text[text_length] = 0;
    int error = baton_storage_entries_push(call, text, text_length + 1);
    free(text);
    if (error) { call->error = error; break; }
  }
  closedir(directory);
  close(fd);
}

static Term baton_storage_entries_pack(Env e, IoWork *w) {
  BatonStorageEntries *call = (BatonStorageEntries *)w->data;
  Term result = call->error ? io_fail(e, call->error, "storage listing failed")
    : io_done(e, io_str(e, call->answer ? call->answer : "", call->length));
  free(call->path); free(call->answer); free(call);
  w->data = NULL;
  return result;
}

/* ---------- remove ---------- */

typedef struct { char **names; size_t count, capacity; } BatonStorageNames;

static void baton_storage_names_free(BatonStorageNames *names) {
  for (size_t i = 0; i < names->count; i++) free(names->names[i]);
  free(names->names);
  names->names = NULL;
  names->count = names->capacity = 0;
}

static int baton_storage_names_push(BatonStorageNames *names, const char *name) {
  if (names->count == names->capacity) {
    size_t next = names->capacity ? names->capacity * 2 : 16;
    if (next < names->capacity || next > (size_t)-1 / sizeof(char *)) return ENOMEM;
    char **grown = realloc(names->names, next * sizeof(char *));
    if (!grown) return ENOMEM;
    names->names = grown;
    names->capacity = next;
  }
  names->names[names->count] = strdup(name);
  if (!names->names[names->count]) return ENOMEM;
  names->count++;
  return 0;
}

static int baton_storage_remove_children(int fd, BatonStorageCount *count, int depth);

static int baton_storage_remove_child(int fd, const char *name, BatonStorageCount *count, int depth) {
  struct stat info;
  if (fstatat(fd, name, &info, AT_SYMLINK_NOFOLLOW)) return errno == ENOENT ? 0 : errno;
  if (S_ISREG(info.st_mode)) {
    if (unlinkat(fd, name, 0) && errno != ENOENT) return errno;
    count->nodes++;
    if (info.st_size > 0) count->bytes += (baton_u64)info.st_size;
    return 0;
  }
  if (S_ISLNK(info.st_mode)) {
    if (unlinkat(fd, name, 0) && errno != ENOENT) return errno;
    count->nodes++;
    return 0;
  }
  if (S_ISDIR(info.st_mode)) {
    int child = openat(fd, name, baton_storage_read_dir_flags());
    if (child < 0) return errno == ENOENT ? 0 : errno;
    struct stat opened;
    if (fstat(child, &opened) || opened.st_dev != info.st_dev || opened.st_ino != info.st_ino) {
      close(child);
      return ESTALE;
    }
    int error = baton_storage_remove_children(child, count, depth + 1);
    close(child);
    if (error) return error;
    if (unlinkat(fd, name, AT_REMOVEDIR) && errno != ENOENT) return errno;
    count->nodes++;
    return 0;
  }
  return ENOTSUP;
}

static int baton_storage_remove_children(int fd, BatonStorageCount *count, int depth) {
  if (depth > BATON_STORAGE_DEPTH) return ELOOP;
  int copy = dup(fd);
  if (copy < 0) return errno;
  DIR *directory = fdopendir(copy);
  if (!directory) { close(copy); return errno; }
  BatonStorageNames names = {NULL, 0, 0};
  int error = 0;
  struct dirent *entry;
  for (;;) {
    errno = 0;
    entry = readdir(directory);
    if (!entry) { if (errno) error = errno; break; }
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    error = baton_storage_names_push(&names, entry->d_name);
    if (error) break;
  }
  closedir(directory);
  for (size_t i = 0; !error && i < names.count; i++) {
    error = baton_storage_remove_child(fd, names.names[i], count, depth);
  }
  baton_storage_names_free(&names);
  return error;
}

/* Answers 0 removed, 1 absent, 2 changed, -1 error. */
static int baton_storage_remove_at(int parent, const char *name, const char *kind,
                                   baton_u64 device, baton_u64 inode, BatonStorageCount *count) {
  struct stat info;
  if (fstatat(parent, name, &info, AT_SYMLINK_NOFOLLOW)) return errno == ENOENT ? 1 : -1;
  if (!baton_storage_identity_match(&info, kind, device, inode)) return 2;
  if (S_ISREG(info.st_mode) || S_ISLNK(info.st_mode)) {
    if (unlinkat(parent, name, 0)) return errno == ENOENT ? 1 : -1;
    count->nodes = 1;
    if (S_ISREG(info.st_mode) && info.st_size > 0) count->bytes = (baton_u64)info.st_size;
    return 0;
  }
  if (S_ISDIR(info.st_mode)) {
    int child = openat(parent, name, baton_storage_read_dir_flags());
    if (child < 0) return errno == ENOENT ? 1 : (errno == ELOOP ? 2 : -1);
    struct stat opened;
    if (fstat(child, &opened) || opened.st_dev != info.st_dev || opened.st_ino != info.st_ino) {
      close(child);
      return 2;
    }
    count->nodes = 1;
    int error = baton_storage_remove_children(child, count, 0);
    close(child);
    if (error) { errno = error; return -1; }
    if (unlinkat(parent, name, AT_REMOVEDIR)) return errno == ENOENT ? 0 : -1;
    return 0;
  }
  errno = ENOTSUP;
  return -1;
}

typedef struct { char *path, *identity, *root, *root_identity, *answer; int error; } BatonStorageRemove;

static void baton_storage_remove_call(IoWork *w) {
  BatonStorageRemove *call = (BatonStorageRemove *)w->data;
  char kind[16], root_kind[16];
  baton_u64 device = 0, inode = 0, root_device = 0, root_inode = 0;
  if (baton_storage_identity_parse(call->identity, kind, sizeof(kind), &device, &inode) ||
      baton_storage_identity_parse(call->root_identity, root_kind, sizeof(root_kind), &root_device, &root_inode) ||
      strcmp(root_kind, "dir")) {
    call->error = EINVAL;
    return;
  }
  int root_fd = baton_storage_open_dir(call->root);
  if (root_fd < 0) {
    if (errno == ENOENT) call->answer = strdup("already-absent\t0\t0");
    else call->error = errno;
    return;
  }
  struct stat root_info;
  if (fstat(root_fd, &root_info)) { call->error = errno; close(root_fd); return; }
  if ((baton_u64)root_info.st_dev != root_device || (baton_u64)root_info.st_ino != root_inode) {
    close(root_fd);
    call->answer = strdup("changed\t0\t0");
    return;
  }
  size_t root_length = strlen(call->root);
  const char *relative = NULL;
  if (!strncmp(call->path, call->root, root_length) && call->path[root_length] == '/') relative = call->path + root_length + 1;
  if (!relative || !*relative) {
    close(root_fd);
    call->answer = strdup("refused\toutside-approved-root");
    return;
  }
  char *parent = NULL, *name = NULL;
  if (baton_storage_split(relative, &parent, &name)) { call->error = errno; close(root_fd); return; }
  int fd = baton_storage_open_dir_at(root_fd, parent);
  if (fd < 0) {
    if (errno == ENOENT) call->answer = strdup("already-absent\t0\t0");
    else call->error = errno;
    free(parent); free(name); close(root_fd);
    return;
  }
  BatonStorageCount count = {0, 0, 0};
  int answer = baton_storage_remove_at(fd, name, kind, device, inode, &count);
  int saved = errno;
  close(fd);
  close(root_fd);
  free(parent); free(name);
  char text[256];
  if (answer < 0) {
    snprintf(text, sizeof(text), "refused\tpartial bytes=%llu nodes=%llu error=%d", count.bytes, count.nodes, saved);
  } else if (answer == 1) {
    snprintf(text, sizeof(text), "already-absent\t0\t0");
  } else if (answer == 2) {
    snprintf(text, sizeof(text), "changed\t0\t0");
  } else {
    snprintf(text, sizeof(text), "removed\t%llu\t%llu", count.bytes, count.nodes);
  }
  call->answer = strdup(text);
  if (!call->answer) call->error = ENOMEM;
}

static Term baton_storage_remove_pack(Env e, IoWork *w) {
  BatonStorageRemove *call = (BatonStorageRemove *)w->data;
  Term result = call->error ? io_fail(e, call->error, "storage removal failed")
    : io_done(e, io_str(e, call->answer, strlen(call->answer)));
  free(call->path); free(call->identity); free(call->root); free(call->root_identity); free(call->answer); free(call);
  w->data = NULL;
  return result;
}

/* ---------- process references ---------- */

typedef struct { pid_t *items; size_t count, capacity; } BatonStoragePids;

static int baton_storage_pid_push(BatonStoragePids *pids, pid_t pid) {
  for (size_t i = 0; i < pids->count; i++) if (pids->items[i] == pid) return 0;
  if (pids->count >= BATON_STORAGE_REF_LIMIT) return 0;
  if (pids->count == pids->capacity) {
    size_t next = pids->capacity ? pids->capacity * 2 : 16;
    if (next > BATON_STORAGE_REF_LIMIT) next = BATON_STORAGE_REF_LIMIT;
    pid_t *grown = realloc(pids->items, next * sizeof(pid_t));
    if (!grown) return ENOMEM;
    pids->items = grown;
    pids->capacity = next;
  }
  pids->items[pids->count++] = pid;
  return 0;
}


static int baton_storage_numeric(const char *text) {
  if (!*text) return 0;
  for (const char *cursor = text; *cursor; cursor++) {
    if (*cursor < '0' || *cursor > '9') return 0;
  }
  return 1;
}

static int baton_storage_scan_unknown(const char *operation, const char *path,
                                      int error, size_t count, size_t limit) {
  fprintf(stderr, "storage process scan: %s path=%s error=%d (%s) count=%zu limit=%zu\n",
          operation, path, error, error ? strerror(error) : "none", count, limit);
  return 1;
}

static int baton_storage_access_unknown(int error) {
  return error == EACCES || error == EPERM;
}

/* Answers 1 on a match, 0 otherwise, and marks UNKNOWN on an access error. */
static int baton_storage_path_hit(const char *path, baton_u64 device, baton_u64 inode, int *unknown) {
  struct stat info;
  if (!stat(path, &info)) return (baton_u64)info.st_dev == device && (baton_u64)info.st_ino == inode;
  if (errno == ENOENT || errno == ESRCH || errno == ENOTDIR) return 0;
  if (baton_storage_access_unknown(errno)) *unknown = baton_storage_scan_unknown("stat", path, errno, 0, 0);
  return 0;
}

static int baton_storage_prefix(const char *root, const char *path) {
  size_t length = strlen(root);
  if (strncmp(path, root, length)) return 0;
  return path[length] == 0 || path[length] == '/';
}

/* A proc link target under the canonical candidate directory. */
static int baton_storage_link_hit(const char *link, const char *root, int *unknown) {
  char buffer[PATH_MAX];
  ssize_t length = readlink(link, buffer, sizeof(buffer) - 1);
  if (length < 0) {
    if (baton_storage_access_unknown(errno)) *unknown = baton_storage_scan_unknown("readlink", link, errno, 0, 0);
    return 0;
  }
  buffer[length] = 0;
  char *deleted = strstr(buffer, " (deleted)");
  if (deleted) *deleted = 0;
  return baton_storage_prefix(root, buffer);
}

/* The pathname field of one /proc/PID/maps line, or NULL for a special map. */
static char *baton_storage_maps_path(char *line) {
  int field = 0;
  char *cursor = line;
  while (*cursor) {
    while (*cursor == ' ' || *cursor == '\t') cursor++;
    if (!*cursor) return NULL;
    if (field == 5) {
      char *end = cursor;
      while (*end && *end != '\n') end++;
      *end = 0;
      return cursor;
    }
    while (*cursor && *cursor != ' ' && *cursor != '\t' && *cursor != '\n') cursor++;
    field++;
  }
  return NULL;
}

/* Answers 1 when PID references the inode through cwd, exe, a descriptor or a
 * mapped file. Access errors and scan truncation set their flag. */
static int baton_storage_pid_hit(pid_t pid, baton_u64 device, baton_u64 inode, const char *root, int is_dir, int *unknown, int *truncated) {
  char path[64];
  snprintf(path, sizeof(path), "/proc/%ld/cwd", (long)pid);
  if (baton_storage_path_hit(path, device, inode, unknown)) return 1;
  if (is_dir && baton_storage_link_hit(path, root, unknown)) return 1;
  snprintf(path, sizeof(path), "/proc/%ld/exe", (long)pid);
  if (baton_storage_path_hit(path, device, inode, unknown)) return 1;
  if (is_dir && baton_storage_link_hit(path, root, unknown)) return 1;

  snprintf(path, sizeof(path), "/proc/%ld/fd", (long)pid);
  DIR *fds = opendir(path);
  if (!fds) {
    if (baton_storage_access_unknown(errno)) *unknown = baton_storage_scan_unknown("opendir", path, errno, 0, 0);
  } else {
    struct dirent *entry;
    size_t seen = 0;
    for (;;) {
      errno = 0;
      entry = readdir(fds);
      if (!entry) break;
      if (!baton_storage_numeric(entry->d_name)) continue;
      if (++seen > BATON_STORAGE_REF_LIMIT) { *truncated = baton_storage_scan_unknown("fd-limit", path, 0, seen, BATON_STORAGE_REF_LIMIT); break; }
      char target_path[128];
      snprintf(target_path, sizeof(target_path), "/proc/%ld/fd/%s", (long)pid, entry->d_name);
      if (baton_storage_path_hit(target_path, device, inode, unknown)) { closedir(fds); return 1; }
      if (is_dir && baton_storage_link_hit(target_path, root, unknown)) { closedir(fds); return 1; }
    }
    if (entry == NULL && errno) *unknown = baton_storage_scan_unknown("readdir", path, errno, 0, 0);
    closedir(fds);
  }

  snprintf(path, sizeof(path), "/proc/%ld/maps", (long)pid);
  FILE *maps = fopen(path, "r");
  if (!maps) {
    if (baton_storage_access_unknown(errno)) *unknown = baton_storage_scan_unknown("fopen", path, errno, 0, 0);
  } else {
    char *line = NULL;
    size_t capacity = 0;
    size_t seen = 0;
    while (getline(&line, &capacity, maps) >= 0) {
      if (++seen > BATON_STORAGE_REF_LIMIT) { *truncated = baton_storage_scan_unknown("maps-limit", path, 0, seen, BATON_STORAGE_REF_LIMIT); break; }
      char *mapped = baton_storage_maps_path(line);
      if (!mapped || mapped[0] != '/') continue;
      if (baton_storage_path_hit(mapped, device, inode, unknown)) { free(line); fclose(maps); return 1; }
      if (is_dir && baton_storage_prefix(root, mapped)) { free(line); fclose(maps); return 1; }
    }
    if (ferror(maps)) *unknown = baton_storage_scan_unknown("getline", path, errno, 0, 0);
    free(line);
    fclose(maps);
  }
  return 0;
}

static char *baton_storage_refs_answer(BatonStoragePids *pids, const char *unknown) {
  size_t length = strlen(unknown) + 1;
  for (size_t i = 0; i < pids->count; i++) {
    char number[32];
    snprintf(number, sizeof(number), "%ld", (long)pids->items[i]);
    length += strlen(number) + 1;
  }
  char *answer = malloc(length + 8);
  if (!answer) return NULL;
  answer[0] = 0;
  if (pids->count) {
    strcpy(answer, "present:");
    for (size_t i = 0; i < pids->count; i++) {
      if (i) strcat(answer, ",");
      char number[32];
      snprintf(number, sizeof(number), "%ld", (long)pids->items[i]);
      strcat(answer, number);
    }
    return answer;
  }
  if (unknown[0]) {
    strcpy(answer, "unknown:");
    strcat(answer, unknown);
    return answer;
  }
  strcpy(answer, "absent");
  return answer;
}

typedef struct { char *path, *answer; int error; u32 descriptors; } BatonStorageRefs;

static void baton_storage_refs_call(IoWork *w) {
  BatonStorageRefs *call = (BatonStorageRefs *)w->data;
  struct stat target;
  if (lstat(call->path, &target)) {
    if (errno == ENOENT) call->answer = strdup("absent");
    else call->error = errno;
    return;
  }
  baton_u64 device = (baton_u64)target.st_dev, inode = (baton_u64)target.st_ino;
  int is_dir = S_ISDIR(target.st_mode);
  char *root = is_dir ? realpath(call->path, NULL) : NULL;
  if (is_dir && !root) { call->answer = strdup("unknown:root-unresolved"); return; }
  DIR *proc = opendir("/proc");
  if (!proc) {
    call->answer = strdup(errno == ENOENT || errno == ENOTDIR ? "unknown:non-linux" : "unknown:access");
    return;
  }
  BatonStoragePids pids = {NULL, 0, 0};
  int unknown = 0, truncated = 0;
  struct dirent *entry;
  size_t seen = 0;
  for (;;) {
    errno = 0;
    entry = readdir(proc);
    if (!entry) { if (errno) unknown = baton_storage_scan_unknown("readdir", "/proc", errno, 0, 0); break; }
    if (!baton_storage_numeric(entry->d_name)) continue;
    if (++seen > BATON_STORAGE_PID_LIMIT) { truncated = baton_storage_scan_unknown("pid-limit", "/proc", 0, seen, BATON_STORAGE_PID_LIMIT); break; }
    pid_t pid = (pid_t)strtol(entry->d_name, NULL, 10);
    char process_path[64];
    snprintf(process_path, sizeof(process_path), "/proc/%ld", (long)pid);
    struct stat process_info;
    if (stat(process_path, &process_info)) continue;
    if (process_info.st_uid != geteuid()) continue;
    if (baton_storage_pid_hit(pid, device, inode, root, is_dir, &unknown, &truncated)) {
      if (baton_storage_pid_push(&pids, pid)) { call->error = ENOMEM; break; }
      if (pids.count >= BATON_STORAGE_REF_LIMIT) { truncated = baton_storage_scan_unknown("result-limit", process_path, 0, pids.count, BATON_STORAGE_REF_LIMIT); break; }
    }
    if (truncated) break;
  }
  closedir(proc);
  free(root);
  if (call->error) { free(pids.items); return; }
  const char *reason = unknown ? "access" : (truncated ? "scan-truncated" : "");
  call->answer = baton_storage_refs_answer(&pids, reason);
  free(pids.items);
  if (!call->answer) call->error = ENOMEM;
}

static Term baton_storage_refs_pack(Env e, IoWork *w) {
  BatonStorageRefs *call = (BatonStorageRefs *)w->data;
  Term result = call->error ? io_fail(e, call->error, "process reference scan failed")
    : io_done(e, io_str(e, call->answer, strlen(call->answer)));
  free(call->path); free(call->answer); free(call);
  w->data = NULL;
  return result;
}

/* ---------- pid liveness ---------- */

typedef struct { u32 pid; u32 alive; } BatonStoragePid;

static void baton_storage_pid_call(IoWork *w) {
  BatonStoragePid *call = (BatonStoragePid *)w->data;
  if (call->pid == 0) { call->alive = 0; return; }
  if (kill((pid_t)call->pid, 0) == 0 || errno == EPERM) call->alive = 1;
  else call->alive = 0;
}

static Term baton_storage_pid_pack(Env e, IoWork *w) {
  BatonStoragePid *call = (BatonStoragePid *)w->data;
  Term result = io_done(e, (Term)call->alive);
  free(call);
  w->data = NULL;
  return result;
}

/* ---------- effect wrappers ---------- */

#ifdef CID_STORAGEHOST_OBSERVE
static Term baton_storage_observe_run(Env e, Term *f, IoWork *w) {
  BatonStorageObserve *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  u64 length = 0;
  call->path = io_cstr(e, f[0], &length);
  if (!call->path || strlen(call->path) != length) { free(call->path); free(call); return io_fail(e, EINVAL, "path contains NUL"); }
  w->data = (char *)call;
  return io_work(w, baton_storage_observe_call, baton_storage_observe_pack);
}
static void __attribute__((constructor)) baton_storage_observe_use(void) {io_eff(CID_STORAGEHOST_OBSERVE, baton_storage_observe_run, 0);}
#endif

#ifdef CID_STORAGEHOST_MEASURE
static Term baton_storage_measure_run(Env e, Term *f, IoWork *w) {
  BatonStorageMeasure *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  u64 length = 0;
  call->path = io_cstr(e, f[0], &length);
  if (!call->path || strlen(call->path) != length) { free(call->path); free(call); return io_fail(e, EINVAL, "path contains NUL"); }
  w->data = (char *)call;
  return io_work(w, baton_storage_measure_call, baton_storage_measure_pack);
}
static void __attribute__((constructor)) baton_storage_measure_use(void) {io_eff(CID_STORAGEHOST_MEASURE, baton_storage_measure_run, 0);}
#endif

#ifdef CID_STORAGEHOST_ENTRIES
static Term baton_storage_entries_run(Env e, Term *f, IoWork *w) {
  BatonStorageEntries *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  u64 length = 0;
  call->path = io_cstr(e, f[0], &length);
  if (!call->path || strlen(call->path) != length) { free(call->path); free(call); return io_fail(e, EINVAL, "path contains NUL"); }
  w->data = (char *)call;
  return io_work(w, baton_storage_entries_call, baton_storage_entries_pack);
}
static void __attribute__((constructor)) baton_storage_entries_use(void) {io_eff(CID_STORAGEHOST_ENTRIES, baton_storage_entries_run, 0);}
#endif

#ifdef CID_STORAGEHOST_REMOVE
static Term baton_storage_remove_run(Env e, Term *f, IoWork *w) {
  BatonStorageRemove *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  u64 length = 0;
  call->path = io_cstr(e, f[0], &length);
  if (!call->path || strlen(call->path) != length) { free(call->path); free(call); return io_fail(e, EINVAL, "path contains NUL"); }
  call->identity = io_cstr(e, f[1], &length);
  if (!call->identity || strlen(call->identity) != length) { free(call->path); free(call->identity); free(call); return io_fail(e, EINVAL, "identity contains NUL"); }
  call->root = io_cstr(e, f[2], &length);
  if (!call->root || strlen(call->root) != length) { free(call->path); free(call->identity); free(call->root); free(call); return io_fail(e, EINVAL, "root contains NUL"); }
  call->root_identity = io_cstr(e, f[3], &length);
  if (!call->root_identity || strlen(call->root_identity) != length) { free(call->path); free(call->identity); free(call->root); free(call->root_identity); free(call); return io_fail(e, EINVAL, "root identity contains NUL"); }
  w->data = (char *)call;
  return io_work(w, baton_storage_remove_call, baton_storage_remove_pack);
}
static void __attribute__((constructor)) baton_storage_remove_use(void) {io_eff(CID_STORAGEHOST_REMOVE, baton_storage_remove_run, 0);}
#endif

#ifdef CID_STORAGEHOST_PROCESS_REFS
static Term baton_storage_process_refs_run(Env e, Term *f, IoWork *w) {
  BatonStorageRefs *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  u64 length = 0;
  call->path = io_cstr(e, f[0], &length);
  call->descriptors = 0;
  if (!call->path || strlen(call->path) != length) { free(call->path); free(call); return io_fail(e, EINVAL, "path contains NUL"); }
  w->data = (char *)call;
  return io_work(w, baton_storage_refs_call, baton_storage_refs_pack);
}
static void __attribute__((constructor)) baton_storage_process_refs_use(void) {io_eff(CID_STORAGEHOST_PROCESS_REFS, baton_storage_process_refs_run, 0);}
#endif

#ifdef CID_STORAGEHOST_RUNTIME_REFS
static Term baton_storage_runtime_refs_run(Env e, Term *f, IoWork *w) {
  BatonStorageRefs *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  u64 length = 0;
  call->path = io_cstr(e, f[0], &length);
  call->descriptors = 1;
  if (!call->path || strlen(call->path) != length) { free(call->path); free(call); return io_fail(e, EINVAL, "path contains NUL"); }
  w->data = (char *)call;
  return io_work(w, baton_storage_refs_call, baton_storage_refs_pack);
}
static void __attribute__((constructor)) baton_storage_runtime_refs_use(void) {io_eff(CID_STORAGEHOST_RUNTIME_REFS, baton_storage_runtime_refs_run, 0);}
#endif

#ifdef CID_STORAGEHOST_PID_ALIVE
static Term baton_storage_pid_run(Env e, Term *f, IoWork *w) {
  BatonStoragePid *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  call->pid = (u32)(Term)f[0];
  w->data = (char *)call;
  return io_work(w, baton_storage_pid_call, baton_storage_pid_pack);
}
static void __attribute__((constructor)) baton_storage_pid_use(void) {io_eff(CID_STORAGEHOST_PID_ALIVE, baton_storage_pid_run, 0);}
#endif
