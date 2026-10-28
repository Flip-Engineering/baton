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
 * mapped-file targets for every observable process by device and
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
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#ifdef __linux__
#include <sys/syscall.h>
#endif

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

/* Measurement walks with an explicit stack of open directory frames, so any
   tree depth measures without a recursion limit. Each frame owns one
   directory descriptor pair: the descriptor names children and a duplicate
   feeds the stream. */
typedef struct { int fd; DIR *stream; } BatonStorageMeasureFrame;
typedef struct { BatonStorageMeasureFrame *items; size_t count, capacity; } BatonStorageMeasureStack;

static int baton_storage_measure_push(BatonStorageMeasureStack *stack, int fd) {
  if (stack->count == stack->capacity) {
    size_t next = stack->capacity ? stack->capacity * 2 : 16;
    if (next < stack->capacity || next > (size_t)-1 / sizeof(*stack->items)) { close(fd); return ENOMEM; }
    BatonStorageMeasureFrame *grown = realloc(stack->items, next * sizeof(*stack->items));
    if (!grown) { close(fd); return ENOMEM; }
    stack->items = grown;
    stack->capacity = next;
  }
  int copy = dup(fd);
  if (copy < 0) { int error = errno; close(fd); return error; }
  if (lseek(copy, 0, SEEK_SET) < 0) { int error = errno; close(copy); close(fd); return error; }
  DIR *stream = fdopendir(copy);
  if (!stream) { int error = errno; close(copy); close(fd); return error; }
  stack->items[stack->count].fd = fd;
  stack->items[stack->count].stream = stream;
  stack->count++;
  return 0;
}

static void baton_storage_measure_pop(BatonStorageMeasureStack *stack) {
  BatonStorageMeasureFrame *frame = &stack->items[--stack->count];
  closedir(frame->stream);
  close(frame->fd);
}

/* Returns 0 when the entry is fully counted, or an errno. A counted
   directory entry joins the stack and is measured by the walk loop. */
static int baton_storage_measure_entry(int fd, const char *name, BatonStorageCount *count,
                                       BatonStorageMeasureStack *stack) {
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
    int error = baton_storage_measure_push(stack, child);
    if (error) return error;
    return 0;
  }
  count->other++;
  return 0;
}

static int baton_storage_measure_walk(int fd, BatonStorageCount *count) {
  BatonStorageMeasureStack stack = {NULL, 0, 0};
  int owned = dup(fd);
  if (owned < 0) return errno;
  int error = baton_storage_measure_push(&stack, owned);
  while (!error && stack.count) {
    BatonStorageMeasureFrame *frame = &stack.items[stack.count - 1];
    errno = 0;
    struct dirent *entry = readdir(frame->stream);
    if (!entry) {
      if (errno) error = errno;
      else baton_storage_measure_pop(&stack);
      continue;
    }
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    error = baton_storage_measure_entry(frame->fd, entry->d_name, count, &stack);
  }
  while (stack.count) baton_storage_measure_pop(&stack);
  free(stack.items);
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
      else call->error = baton_storage_measure_walk(child, &count);
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
    if (strchr(entry->d_name, '\t')) { call->error = EINVAL; break; }
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

/* Answers 0 for a verified same mount, EXDEV for a different mount, and
   ENOTSUP when the mount identity cannot be established (no statx support,
   ENOSYS, or a mask without STATX_MNT_ID). Callers preserve on any non-zero
   answer: st_dev equality cannot see a same-device bind mount. */
static int baton_storage_mount_boundary(int fd, const char *name) {
#if defined(__linux__) && defined(STATX_MNT_ID)
  struct statx parent, child;
  if (statx(fd, "", AT_EMPTY_PATH, STATX_MNT_ID, &parent) ||
      statx(fd, name, AT_SYMLINK_NOFOLLOW, STATX_MNT_ID, &child)) {
    return ENOTSUP;
  }
  if (!(parent.stx_mask & STATX_MNT_ID) || !(child.stx_mask & STATX_MNT_ID)) return ENOTSUP;
  return parent.stx_mnt_id == child.stx_mnt_id ? 0 : EXDEV;
#elif defined(__APPLE__)
  /* macOS has no bind mounts; a filesystem identity comparison still verifies
     that the entry lives on the same mounted volume before removal. */
  struct statfs parent, child;
  struct stat child_info;
  if (fstatat(fd, name, &child_info, AT_SYMLINK_NOFOLLOW)) return ENOTSUP;
  /* Only a directory can be a mount point; unlinking a regular file or a
     symlink cannot cross one. Opening those with O_DIRECTORY failed and
     preserved every ordinary tree, so classify the entry first. */
  if (!S_ISDIR(child_info.st_mode)) return 0;
  if (fstatfs(fd, &parent)) return ENOTSUP;
  int entry = openat(fd, name, baton_storage_read_dir_flags());
  if (entry < 0) return ENOTSUP;
  int error = fstatfs(entry, &child) ? ENOTSUP : 0;
  close(entry);
  if (error) return error;
  if (parent.f_fsid.val[0] != child.f_fsid.val[0] || parent.f_fsid.val[1] != child.f_fsid.val[1]) return EXDEV;
  return 0;
#else
  return ENOTSUP;
#endif
}

/* The candidate root is a boundary of its own: a same-device bind mount keeps
   st_dev equal, so without this check its contents would be deleted before
   the final rmdir fails with EBUSY. The fixture hooks inject the kernel's
   answers because unprivileged fixtures cannot mount. */
static int baton_storage_candidate_boundary(int parent, const char *name) {
#ifdef BATON_STORAGE_CARGO_TEST
  const char *forced = getenv("BATON_CARGO_TEST_CANDIDATE_BOUNDARY");
  if (forced && !strcmp(forced, "exdev")) return EXDEV;
  if (forced && !strcmp(forced, "unknown")) return ENOTSUP;
#endif
  return baton_storage_mount_boundary(parent, name);
}

/* Removal walks with an explicit stack of frames. A frame holds one open
   directory, its collected child names and the progress through them, so any
   tree depth removes without a recursion limit. Each frame owns its
   descriptor; the parent descriptor stays open below it in the stack and
   names the directory for the final rmdir. The walk root frame carries no
   parent and removes only the tree under the given directory. */
typedef struct {
  int fd;
  int parent;
  char *name;
  dev_t device;
  BatonStorageNames names;
  size_t index;
} BatonStorageRemoveFrame;

typedef struct { BatonStorageRemoveFrame *items; size_t count, capacity; } BatonStorageRemoveStack;

static int baton_storage_remove_frame(int fd, int parent, char *name, dev_t device,
                                      BatonStorageRemoveStack *stack) {
  if (stack->count == stack->capacity) {
    size_t next = stack->capacity ? stack->capacity * 2 : 16;
    if (next < stack->capacity || next > (size_t)-1 / sizeof(*stack->items)) { close(fd); free(name); return ENOMEM; }
    BatonStorageRemoveFrame *grown = realloc(stack->items, next * sizeof(*stack->items));
    if (!grown) { close(fd); free(name); return ENOMEM; }
    stack->items = grown;
    stack->capacity = next;
  }
  BatonStorageRemoveFrame *frame = &stack->items[stack->count];
  frame->fd = fd;
  frame->parent = parent;
  frame->name = name;
  frame->device = device;
  frame->names.names = NULL;
  frame->names.count = frame->names.capacity = 0;
  frame->index = 0;
  int copy = dup(fd);
  if (copy < 0) { int error = errno; close(fd); free(name); return error; }
  /* The duplicate shares the open file description with a descriptor an
     earlier pass may already have enumerated. Rewind before the stream. */
  if (lseek(copy, 0, SEEK_SET) < 0) { int error = errno; close(copy); close(fd); free(name); return error; }
  DIR *directory = fdopendir(copy);
  if (!directory) { int error = errno; close(copy); close(fd); free(name); return error; }
  int error = 0;
  struct dirent *entry;
  for (;;) {
    errno = 0;
    entry = readdir(directory);
    if (!entry) { if (errno) error = errno; break; }
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    error = baton_storage_names_push(&frame->names, entry->d_name);
    if (error) break;
  }
  closedir(directory);
  if (error) {
    close(fd);
    baton_storage_names_free(&frame->names);
    free(name);
    return error;
  }
  stack->count++;
  return 0;
}

static void baton_storage_remove_pop(BatonStorageRemoveStack *stack) {
  BatonStorageRemoveFrame *frame = &stack->items[--stack->count];
  close(frame->fd);
  baton_storage_names_free(&frame->names);
  free(frame->name);
}

/* Answers 0 when every entry below FD belongs to SELF, EPERM when another uid
   owns an entry (its name is written to FOREIGN), or the read failure. The
   walk never unlinks, so a foreign child anywhere in the tree preserves the
   whole candidate before the removal pass starts. */
static int baton_storage_uid_walk(int fd, uid_t self, char *foreign, size_t foreign_size) {
  BatonStorageRemoveStack stack = {NULL, 0, 0};
  int owned = dup(fd);
  if (owned < 0) return errno;
  int error = baton_storage_remove_frame(owned, -1, NULL, 0, &stack);
  while (!error && stack.count) {
    BatonStorageRemoveFrame *frame = &stack.items[stack.count - 1];
    if (frame->index < frame->names.count) {
      const char *name = frame->names.names[frame->index++];
      struct stat info;
      if (fstatat(frame->fd, name, &info, AT_SYMLINK_NOFOLLOW)) {
        if (errno != ENOENT) error = errno;
        continue;
      }
      if (info.st_uid != self) {
        snprintf(foreign, foreign_size, "%s", name);
        error = EPERM;
        continue;
      }
      if (S_ISDIR(info.st_mode)) {
        int child = openat(frame->fd, name, baton_storage_read_dir_flags());
        if (child < 0) { if (errno != ENOENT) error = errno; }
        else {
          struct stat opened;
          if (fstat(child, &opened) || opened.st_dev != info.st_dev || opened.st_ino != info.st_ino) {
            close(child);
            error = ESTALE;
          } else {
            char *owned_name = strdup(name);
            if (!owned_name) { close(child); error = ENOMEM; }
            else error = baton_storage_remove_frame(child, frame->fd, owned_name, frame->device, &stack);
          }
        }
      } else if (!S_ISREG(info.st_mode) && !S_ISLNK(info.st_mode)) error = ENOTSUP;
    } else {
      baton_storage_remove_pop(&stack);
    }
  }
  while (stack.count) baton_storage_remove_pop(&stack);
  free(stack.items);
  return error;
}

static int baton_storage_remove_children(int fd, dev_t device, BatonStorageCount *count) {
  BatonStorageRemoveStack stack = {NULL, 0, 0};
  int owned = dup(fd);
  if (owned < 0) return errno;
  int error = baton_storage_remove_frame(owned, -1, NULL, device, &stack);
  while (!error && stack.count) {
    BatonStorageRemoveFrame *frame = &stack.items[stack.count - 1];
    if (frame->index < frame->names.count) {
      const char *name = frame->names.names[frame->index++];
      struct stat info;
      if (fstatat(frame->fd, name, &info, AT_SYMLINK_NOFOLLOW)) {
        if (errno != ENOENT) error = errno;
        continue;
      }
#ifdef BATON_STORAGE_CARGO_TEST
      /* The runner cannot mount a private filesystem. Exercise the device
         boundary with the same observed child metadata comparison. */
      const char *different_device = getenv("BATON_CARGO_TEST_DEVICE_MISMATCH");
      if (different_device && !strcmp(name, different_device)) info.st_dev = device ^ 1;
#endif
      int boundary = baton_storage_mount_boundary(frame->fd, name);
#ifdef BATON_STORAGE_CARGO_TEST
      /* Unknown mount identity must preserve the subtree exactly like a
         detected boundary; the fixture injects the kernel's answer. */
      const char *unknown_mount = getenv("BATON_CARGO_TEST_MOUNT_UNKNOWN");
      if (unknown_mount && !strcmp(name, unknown_mount)) boundary = ENOTSUP;
#endif
      if (info.st_uid != geteuid()) {
        fprintf(stderr, "storage removal preserves foreign-uid entry=%s uid=%llu self=%llu\n",
                name, (unsigned long long)info.st_uid, (unsigned long long)geteuid());
        error = EPERM;
        continue;
      }
      if (info.st_dev != frame->device || boundary) {
        fprintf(stderr, "storage removal preserves mount entry=%s device=%llu root-device=%llu\n",
                name, (baton_u64)info.st_dev, (baton_u64)frame->device);
        error = boundary ? boundary : EXDEV;
        continue;
      }
      if (S_ISREG(info.st_mode)) {
        if (unlinkat(frame->fd, name, 0) && errno != ENOENT) error = errno;
        else {
          count->nodes++;
          if (info.st_size > 0) count->bytes += (baton_u64)info.st_size;
        }
      } else if (S_ISLNK(info.st_mode)) {
        if (unlinkat(frame->fd, name, 0) && errno != ENOENT) error = errno;
        else count->nodes++;
      } else if (S_ISDIR(info.st_mode)) {
        int child = openat(frame->fd, name, baton_storage_read_dir_flags());
        if (child < 0) { if (errno != ENOENT) error = errno; }
        else {
          struct stat opened;
          if (fstat(child, &opened) || opened.st_dev != info.st_dev || opened.st_ino != info.st_ino) {
            close(child);
            error = ESTALE;
          } else {
            char *owned = strdup(name);
            if (!owned) { close(child); error = ENOMEM; }
            else {
              error = baton_storage_remove_frame(child, frame->fd, owned, frame->device, &stack);
            }
          }
        }
      } else error = ENOTSUP;
    } else {
      if (frame->parent >= 0) {
        if (unlinkat(frame->parent, frame->name, AT_REMOVEDIR) && errno != ENOENT) error = errno;
        else count->nodes++;
      }
      baton_storage_remove_pop(&stack);
    }
  }
  while (stack.count) baton_storage_remove_pop(&stack);
  free(stack.items);
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
    /* The candidate root itself must not be a mount boundary before any
       descent; the fixture hooks inject the kernel answer for the same-device
       bind mount and unknown-identity cases. */
    int boundary = baton_storage_candidate_boundary(parent, name);
    if (boundary) {
      fprintf(stderr, "storage removal preserves candidate mount entry=%s error=%d (%s)\n",
              name, boundary, strerror(boundary));
      close(child);
      errno = boundary;
      return -1;
    }
    char foreign[256];
    foreign[0] = 0;
    int uid_error = baton_storage_uid_walk(child, geteuid(), foreign, sizeof(foreign));
    if (uid_error) {
      fprintf(stderr, "storage removal preserves uid boundary entry=%s error=%d (%s)\n",
              foreign[0] ? foreign : "(unreadable)", uid_error, strerror(uid_error));
      close(child);
      errno = uid_error;
      return -1;
    }
    count->nodes = 1;
    int error = baton_storage_remove_children(child, opened.st_dev, count);
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

/* ---------- Cargo output ---------- */

/* Cargo 5f94df478 src/compiler/layout.rs takes a shared .cargo-lock for
   compatibility and uses build/artifact locks for newer layouts. */
static const char *baton_cargo_locks[] = {
  ".cargo-lock", ".cargo-build-lock", ".cargo-artifact-lock"
};

static int baton_cargo_regular(int fd, const char *name) {
  struct stat info;
  if (fstatat(fd, name, &info, AT_SYMLINK_NOFOLLOW)) return errno == ENOENT ? 0 : -1;
  if (!S_ISREG(info.st_mode)) { errno = EINVAL; return -1; }
  return 1;
}

static int baton_cargo_tag(int fd) {
  static const char signature[] = "Signature: 8a477f597d28d172789f06886806bc55";
  int tag = openat(fd, "CACHEDIR.TAG", O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC);
  if (tag < 0) return errno == ENOENT ? 0 : -1;
  struct stat info;
  int stat_error = fstat(tag, &info) ? errno : 0;
  if (stat_error || !S_ISREG(info.st_mode)) {
    int error = stat_error ? stat_error : EINVAL;
    close(tag); errno = error; return -1;
  }
  char bytes[sizeof(signature) - 1];
  size_t used = 0;
  while (used < sizeof(bytes)) {
    ssize_t count = read(tag, bytes + used, sizeof(bytes) - used);
    if (count < 0 && errno == EINTR) continue;
    if (count < 0) { int error = errno; close(tag); errno = error; return -1; }
    if (!count) break;
    used += (size_t)count;
  }
  close(tag);
  return used == sizeof(bytes) && !memcmp(bytes, signature, sizeof(bytes));
}

/* A profile has Cargo's compatibility lock or its separate build lock.
   Relative lock paths refer to the opened allocation directory. */
static int baton_cargo_profile(int fd, const char *relative, BatonStorageNames *locks) {
  int profile = baton_cargo_regular(fd, ".cargo-lock");
  if (profile < 0) return -1;
  int build = baton_cargo_regular(fd, ".cargo-build-lock");
  if (build < 0) return -1;
  if (!profile && !build) return 0;
  for (size_t i = 0; i < sizeof(baton_cargo_locks) / sizeof(baton_cargo_locks[0]); i++) {
    int found = baton_cargo_regular(fd, baton_cargo_locks[i]);
    if (found < 0) return -1;
    if (!found) continue;
    char *name = NULL;
    if (asprintf(&name, "%s/%s", relative, baton_cargo_locks[i]) < 0) { errno = ENOMEM; return -1; }
    int error = baton_storage_names_push(locks, name);
    free(name);
    if (error) { errno = error; return -1; }
  }
  return 1;
}

/* Layout discovery walks an explicit stack of open directories with their
   relative prefixes, so nested target and profile prefixes are found at any
   depth without recursion. Each stacked descriptor is closed when popped. */
typedef struct { int fd; char *prefix; } BatonCargoScan;
typedef struct { BatonCargoScan *items; size_t count, capacity; } BatonCargoScans;

static int baton_cargo_scan_push(BatonCargoScans *scans, int fd, char *prefix) {
  if (scans->count == scans->capacity) {
    size_t next = scans->capacity ? scans->capacity * 2 : 16;
    if (next < scans->capacity || next > (size_t)-1 / sizeof(*scans->items)) { free(prefix); close(fd); return ENOMEM; }
    BatonCargoScan *grown = realloc(scans->items, next * sizeof(*scans->items));
    if (!grown) { free(prefix); close(fd); return ENOMEM; }
    scans->items = grown;
    scans->capacity = next;
  }
  scans->items[scans->count].fd = fd;
  scans->items[scans->count].prefix = prefix;
  scans->count++;
  return 0;
}

static int baton_cargo_profiles(int fd, const char *prefix, dev_t device, BatonStorageNames *locks) {
  BatonCargoScans scans = {NULL, 0, 0};
  char *root_prefix = strdup(prefix);
  if (!root_prefix) return ENOMEM;
  int owned = dup(fd);
  if (owned < 0) { free(root_prefix); return errno; }
  int error = baton_cargo_scan_push(&scans, owned, root_prefix);
  while (!error && scans.count) {
    BatonCargoScan scan = scans.items[--scans.count];
    int copy = dup(scan.fd);
    if (copy < 0) { error = errno; close(scan.fd); free(scan.prefix); break; }
    /* A duplicate shares the open file description, so enumeration from an
       earlier pass leaves its offset at end. Rewind before the new stream. */
    if (lseek(copy, 0, SEEK_SET) < 0) { error = errno; close(copy); close(scan.fd); free(scan.prefix); break; }
    DIR *directory = fdopendir(copy);
    if (!directory) { error = errno; close(copy); close(scan.fd); free(scan.prefix); break; }
    for (;;) {
      errno = 0;
      struct dirent *entry = readdir(directory);
      if (!entry) { if (errno) error = errno; break; }
      if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
      struct stat info;
      if (fstatat(scan.fd, entry->d_name, &info, AT_SYMLINK_NOFOLLOW)) { error = errno; break; }
      if (info.st_dev != device) {
        fprintf(stderr, "Cargo layout preserves mount entry=%s/%s device=%llu root-device=%llu\n",
                scan.prefix, entry->d_name, (baton_u64)info.st_dev, (baton_u64)device);
        error = EXDEV; break;
      }
      int boundary = baton_storage_mount_boundary(scan.fd, entry->d_name);
      if (boundary) {
        fprintf(stderr, "Cargo layout preserves entry=%s/%s error=%d (%s)\n",
                scan.prefix, entry->d_name, boundary, strerror(boundary));
        error = boundary; break;
      }
      if (!S_ISDIR(info.st_mode)) continue;
      int child = openat(scan.fd, entry->d_name, baton_storage_read_dir_flags());
      if (child < 0) { error = errno; break; }
      char *relative = NULL;
      if (asprintf(&relative, "%s%s%s", scan.prefix, *scan.prefix ? "/" : "", entry->d_name) < 0) {
        close(child); error = ENOMEM; break;
      }
      int profile = baton_cargo_profile(child, relative, locks);
      if (profile < 0) { error = errno; free(relative); close(child); break; }
      if (!profile) {
        error = baton_cargo_scan_push(&scans, child, relative);
      } else {
        free(relative);
        close(child);
      }
      if (error) break;
    }
    closedir(directory);
    close(scan.fd);
    free(scan.prefix);
  }
  while (scans.count) {
    close(scans.items[scans.count - 1].fd);
    free(scans.items[scans.count - 1].prefix);
    scans.count--;
  }
  free(scans.items);
  return error;
}

static int baton_cargo_output(int fd, BatonStorageNames *locks, int *tagged) {
  *tagged = baton_cargo_tag(fd);
  if (*tagged < 0) return -1;
  int rustc = baton_cargo_regular(fd, ".rustc_info.json");
  if (rustc < 0) return -1;
  if (!*tagged && !rustc) return 0;
  struct stat info;
  if (fstat(fd, &info) || baton_cargo_profiles(fd, "", info.st_dev, locks)) return -1;
  return locks->count > 0;
}

static int baton_cargo_open(const char *path) {
  int directory = baton_storage_open_dir(path);
  if (directory < 0) return -1;
  int fd = openat(directory, ".", baton_storage_read_dir_flags());
  int error = errno;
  close(directory);
  if (fd < 0) { errno = error; return -1; }
  struct stat info;
  if (fstat(fd, &info)) { error = errno; close(fd); errno = error; return -1; }
  if (info.st_uid != geteuid()) { close(fd); errno = EPERM; return -1; }
  return fd;
}

typedef struct { char *path, *identity, *associated, *answer, *detail; int error; } BatonCargo;

/* A failed restore leaves a sibling named for this allocation. Subsequent
   observations report that retained output before considering a new target. */
static int baton_cargo_retained(BatonCargo *call) {
  char *parent = NULL, *name = NULL, *prefix = NULL;
  if (baton_storage_split(call->path, &parent, &name)) return errno;
  int directory_fd = baton_storage_open_dir(parent), error = 0;
  if (directory_fd < 0) { error = errno; goto done; }
  int fd = openat(directory_fd, ".", baton_storage_read_dir_flags());
  error = fd < 0 ? errno : 0;
  close(directory_fd);
  if (error) goto done;
  if (asprintf(&prefix, ".%s.baton-cargo-", name) < 0) { error = ENOMEM; close(fd); goto done; }
  DIR *directory = fdopendir(fd);
  if (!directory) { error = errno; close(fd); goto done; }
  for (;;) {
    errno = 0;
    struct dirent *entry = readdir(directory);
    if (!entry) { error = errno; break; }
    if (strncmp(entry->d_name, prefix, strlen(prefix))) continue;
    error = EINPROGRESS;
    if (asprintf(&call->detail, "Cargo output retained at %s/%s", parent, entry->d_name) < 0) error = ENOMEM;
    break;
  }
  closedir(directory);
done:
  free(parent); free(name); free(prefix);
  return error;
}

static void baton_cargo_probe_call(IoWork *w) {
  BatonCargo *call = (BatonCargo *)w->data;
  call->error = baton_cargo_retained(call);
  if (call->error) return;
  int fd = baton_cargo_open(call->path);
  if (fd < 0) { call->error = errno; return; }
  BatonStorageNames locks = {NULL, 0, 0};
  int tagged = 0;
  int found = baton_cargo_output(fd, &locks, &tagged);
  if (found < 0) call->error = errno;
  else if (!found) call->answer = strdup("unclassified");
  else {
    struct stat info;
    if (fstat(fd, &info)) call->error = errno;
    else if (asprintf(&call->answer, "cargo\tdir:%llu:%llu\t%s", (baton_u64)info.st_dev,
                     (baton_u64)info.st_ino, tagged ? "tag" : "layout") < 0) call->error = ENOMEM;
  }
  baton_storage_names_free(&locks);
  close(fd);
  if (!call->error && !call->answer) call->error = ENOMEM;
}

static int baton_cargo_lock(int fd, const BatonStorageNames *names, int **held, size_t *count) {
  for (size_t i = 0; i < names->count; i++) {
    char *parent = NULL, *name = NULL;
    if (baton_storage_split(names->names[i], &parent, &name)) return -1;
    int directory = baton_storage_open_dir_at(fd, parent);
    int lock = directory < 0 ? -1 : openat(directory, name, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC);
    int error = errno;
    if (directory >= 0) close(directory);
    free(parent); free(name);
    if (lock < 0) { errno = error; return -1; }
    struct stat info;
    error = fstat(lock, &info) ? errno : 0;
    if (error || !S_ISREG(info.st_mode)) {
      if (!error) error = EINVAL;
      close(lock); errno = error; return -1;
    }
    int locked;
    do { locked = flock(lock, LOCK_EX | LOCK_NB); } while (locked < 0 && errno == EINTR);
    if (locked < 0) { error = errno; close(lock); errno = error; return -1; }
    int *grown = realloc(*held, (*count + 1) * sizeof(int));
    if (!grown) { close(lock); errno = ENOMEM; return -1; }
    *held = grown;
    (*held)[(*count)++] = lock;
  }
  return 0;
}

/* Re-read the complete layout after all locks are held. A new profile or a
   replaced lock retains the allocation for a later collection pass. */
static int baton_cargo_stable(int fd, const BatonStorageNames *names, const int *held) {
  BatonStorageNames current = {NULL, 0, 0};
  int tagged = 0, error = 0;
  int found = baton_cargo_output(fd, &current, &tagged);
  if (found < 0) error = errno;
  else if (!found || current.count != names->count) error = ESTALE;
  for (size_t i = 0; !error && i < names->count; i++) {
    size_t j = 0;
    while (j < current.count && strcmp(names->names[i], current.names[j])) j++;
    struct stat locked, named;
    if (j == current.count) error = ESTALE;
    else if (fstat(held[i], &locked) || fstatat(fd, names->names[i], &named, AT_SYMLINK_NOFOLLOW)) error = errno;
    else if (!S_ISREG(named.st_mode) || locked.st_dev != named.st_dev || locked.st_ino != named.st_ino) error = ESTALE;
  }
  baton_storage_names_free(&current);
  return error;
}

#ifdef BATON_STORAGE_CARGO_TEST
/* The functional fixture observes the held native locks after the rename. */
static int baton_cargo_test_boundary(const char *boundary) {
  const char *selected = getenv("BATON_CARGO_TEST_BOUNDARY");
  if (strcmp(boundary, selected ? selected : "renamed")) return 0;
  const char *ready_path = getenv("BATON_CARGO_TEST_RENAMED");
  const char *release_path = getenv("BATON_CARGO_TEST_RELEASE");
  if (!ready_path || !release_path) return 0;
  int ready = open(ready_path, O_WRONLY | O_CLOEXEC);
  if (ready < 0) return errno;
  char byte = 1;
  ssize_t result;
  do { result = write(ready, &byte, 1); } while (result < 0 && errno == EINTR);
  int error = result == 1 ? 0 : (errno ? errno : EIO);
  close(ready);
  if (error) return error;
  int release = open(release_path, O_RDONLY | O_CLOEXEC);
  if (release < 0) return errno;
  do { result = read(release, &byte, 1); } while (result < 0 && errno == EINTR);
  error = result == 1 ? 0 : (errno ? errno : EIO);
  close(release);
  return error;
}
#endif

/* Restore only into an absent name so a concurrent replacement stays intact. */
static int baton_cargo_restore(int box, int parent, const char *name) {
#if defined(__linux__) && defined(SYS_renameat2)
  return syscall(SYS_renameat2, box, "output", parent, name, 1 /* RENAME_NOREPLACE */) ? errno : 0;
#elif defined(__APPLE__)
  return renameatx_np(box, "output", parent, name, RENAME_EXCL) ? errno : 0;
#else
  return ENOTSUP;
#endif
}

static void baton_cargo_remove_call(IoWork *w) {
  BatonCargo *call = (BatonCargo *)w->data;
  int fd = -1, other = -1, parent_fd = -1, box_fd = -1;
  int *held = NULL, error = 0, renamed = 0;
  size_t held_count = 0, other_start = 0;
  char *parent = NULL, *name = NULL, *box = NULL;
  BatonStorageNames locks = {NULL, 0, 0}, other_locks = {NULL, 0, 0};
  BatonStorageCount count = {0, 0, 0};
  char kind[16];
  baton_u64 device = 0, inode = 0;
  if (baton_storage_identity_parse(call->identity, kind, sizeof(kind), &device, &inode) || strcmp(kind, "dir")) {
    call->error = EINVAL; return;
  }
  call->error = baton_cargo_retained(call);
  if (call->error) goto done;
#ifdef BATON_STORAGE_CARGO_TEST
  call->error = baton_cargo_test_boundary("observed");
  if (call->error) goto done;
#endif
  if (baton_storage_split(call->path, &parent, &name)) { call->error = errno; goto done; }
  parent_fd = baton_storage_open_dir(parent);
  if (parent_fd < 0) { call->error = errno; goto done; }
  fd = openat(parent_fd, name, baton_storage_read_dir_flags());
  if (fd < 0) {
    if (errno == ENOENT) call->answer = strdup("already-absent\t0\t0");
    else call->error = errno;
    goto done;
  }
  struct stat info;
  if (fstat(fd, &info)) { call->error = errno; goto done; }
  if (!baton_storage_identity_match(&info, kind, device, inode)) {
    call->answer = strdup("changed\t0\t0"); goto done;
  }
  if (info.st_uid != geteuid()) { call->error = EPERM; goto done; }
  int tagged = 0, found = baton_cargo_output(fd, &locks, &tagged);
  if (found < 0) { call->error = errno; goto done; }
  if (!found) { call->answer = strdup("refused\tunclassified-cargo-output"); goto done; }
  if (!locks.count) { call->answer = strdup("refused\tcargo-lock-layout-unresolved"); goto done; }
  if (baton_cargo_lock(fd, &locks, &held, &held_count)) { error = errno; goto lock_failed; }
  other_start = held_count;
  if (call->associated[0]) {
    other = baton_cargo_open(call->associated);
    if (other < 0) { call->error = errno; goto done; }
    struct stat associated;
    if (fstat(other, &associated)) { call->error = errno; goto done; }
    if (associated.st_dev != info.st_dev || associated.st_ino != info.st_ino) {
      found = baton_cargo_output(other, &other_locks, &tagged);
      if (found < 0) { call->error = errno; goto done; }
      if (!found || !other_locks.count) { call->answer = strdup("refused\tcargo-build-layout-unresolved"); goto done; }
      if (baton_cargo_lock(other, &other_locks, &held, &held_count)) { error = errno; goto lock_failed; }
    }
  }
#ifdef BATON_STORAGE_CARGO_TEST
  call->error = baton_cargo_test_boundary("locked");
  if (call->error) goto done;
#endif
  error = baton_cargo_stable(fd, &locks, held);
  if (!error && other_locks.count) error = baton_cargo_stable(other, &other_locks, held + other_start);
  if (error) {
    if (asprintf(&call->answer, "refused\tcargo-lock-layout-changed error=%d", error) < 0) call->error = ENOMEM;
    goto done;
  }
  if (fstatat(parent_fd, name, &info, AT_SYMLINK_NOFOLLOW)) { call->error = errno; goto done; }
  if (!baton_storage_identity_match(&info, kind, device, inode)) {
    call->answer = strdup("changed\t0\t0"); goto done;
  }
  static unsigned long long sequence;
  for (;;) {
    unsigned long long serial = __sync_add_and_fetch(&sequence, 1);
    free(box); box = NULL;
    if (asprintf(&box, ".%s.baton-cargo-%ld-%llu", name, (long)getpid(), serial) < 0) { call->error = ENOMEM; goto done; }
    if (!mkdirat(parent_fd, box, 0700)) break;
    if (errno != EEXIST) { call->error = errno; free(box); box = NULL; goto done; }
  }
  box_fd = openat(parent_fd, box, baton_storage_read_dir_flags());
  if (box_fd < 0) { call->error = errno; goto done; }
  if (renameat(parent_fd, name, box_fd, "output")) { call->error = errno; goto done; }
  renamed = 1;
  struct stat moved;
  int moved_error = fstatat(box_fd, "output", &moved, AT_SYMLINK_NOFOLLOW) ? errno : 0;
  if (moved_error || !baton_storage_identity_match(&moved, kind, device, inode)) {
    error = moved_error ? moved_error : ESTALE;
    int restore = baton_cargo_restore(box_fd, parent_fd, name);
    if (!restore) { renamed = 0; call->answer = strdup("changed\t0\t0"); }
    else if (asprintf(&call->answer, "refused\tidentity-changed error=%d restore-error=%d retained=%s/%s/output",
                      error, restore, parent, box) < 0) call->error = ENOMEM;
    goto done;
  }
  count.nodes = 1;
#ifdef BATON_STORAGE_CARGO_TEST
  error = baton_cargo_test_boundary("renamed");
#endif
  if (!error) error = baton_cargo_stable(fd, &locks, held);
  if (!error && other_locks.count) error = baton_cargo_stable(other, &other_locks, held + other_start);
  if (!error) error = baton_storage_remove_children(fd, (dev_t)device, &count);
  if (!error && unlinkat(box_fd, "output", AT_REMOVEDIR)) error = errno;
  if (error) {
    int restore = baton_cargo_restore(box_fd, parent_fd, name);
    if (!restore) renamed = 0;
    if (asprintf(&call->answer, "refused\tpartial bytes=%llu nodes=%llu error=%d restore-error=%d retained=%s/%s%s",
                 count.bytes, count.nodes, error, restore, parent, restore ? box : name,
                 restore ? "/output" : "") < 0) call->error = ENOMEM;
  } else {
    if (asprintf(&call->answer, "removed\t%llu\t%llu", count.bytes, count.nodes) < 0) call->error = ENOMEM;
#ifdef BATON_STORAGE_CARGO_TEST
    int hook_error = baton_cargo_test_boundary("removed");
    if (hook_error) fprintf(stderr, "Cargo fixture boundary failed error=%d\n", hook_error);
#endif
  }
  goto done;
lock_failed:
  if (error == EWOULDBLOCK || error == EAGAIN) call->answer = strdup("refused\tcargo-writer-active");
  else call->error = error;
done:
  if (box_fd >= 0) close(box_fd);
  if (parent_fd >= 0 && box && (!renamed || !error)) {
    if (unlinkat(parent_fd, box, AT_REMOVEDIR)) {
      fprintf(stderr, "Cargo collection retained box=%s/%s error=%d (%s)\n", parent, box, errno, strerror(errno));
    }
  }
  if (fd >= 0) close(fd);
  if (other >= 0) close(other);
  if (parent_fd >= 0) close(parent_fd);
  for (size_t i = 0; i < held_count; i++) close(held[i]);
  free(held);
  baton_storage_names_free(&locks);
  baton_storage_names_free(&other_locks);
  free(parent); free(name); free(box);
  if (!call->error && !call->answer) call->error = ENOMEM;
}

static Term baton_cargo_pack(Env e, IoWork *w) {
  BatonCargo *call = (BatonCargo *)w->data;
  Term result = call->error ? io_fail(e, call->error, call->detail ? call->detail : "Cargo output observation or removal failed")
    : io_done(e, io_str(e, call->answer, strlen(call->answer)));
  free(call->path); free(call->identity); free(call->associated); free(call->answer); free(call->detail); free(call);
  w->data = NULL;
  return result;
}

#ifdef CID_STORAGEHOST_CARGO_PROBE
static Term baton_cargo_probe_run(Env e, Term *f, IoWork *w) {
  BatonCargo *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  u64 length = 0;
  call->path = io_cstr(e, f[0], &length);
  if (!call->path || strlen(call->path) != length) { free(call->path); free(call); return io_fail(e, EINVAL, "path contains NUL"); }
  w->data = (char *)call;
  return io_work(w, baton_cargo_probe_call, baton_cargo_pack);
}
static void __attribute__((constructor)) baton_cargo_probe_use(void) {io_eff(CID_STORAGEHOST_CARGO_PROBE, baton_cargo_probe_run, 0);}
#endif

#ifdef CID_STORAGEHOST_CARGO_REMOVE
static Term baton_cargo_remove_run(Env e, Term *f, IoWork *w) {
  BatonCargo *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  char **fields[] = {&call->path, &call->identity, &call->associated};
  for (size_t i = 0; i < sizeof(fields) / sizeof(fields[0]); i++) {
    u64 length = 0;
    *fields[i] = io_cstr(e, f[i], &length);
    if (!*fields[i] || strlen(*fields[i]) != length) {
      free(call->path); free(call->identity); free(call->associated); free(call);
      return io_fail(e, EINVAL, "Cargo output argument contains NUL");
    }
  }
  w->data = (char *)call;
  return io_work(w, baton_cargo_remove_call, baton_cargo_pack);
}
static void __attribute__((constructor)) baton_cargo_remove_use(void) {io_eff(CID_STORAGEHOST_CARGO_REMOVE, baton_cargo_remove_run, 0);}
#endif

/* ---------- process references ---------- */

typedef struct { pid_t *items; size_t count, capacity; } BatonStoragePids;

static int baton_storage_pid_push(BatonStoragePids *pids, pid_t pid) {
  for (size_t i = 0; i < pids->count; i++) if (pids->items[i] == pid) return 0;
  if (pids->count == pids->capacity) {
    size_t next = pids->capacity ? pids->capacity * 2 : 16;
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

/* The storage test supplies a proc view containing its own fixture peers.
   The production build always reads the host proc filesystem. */
static const char *baton_storage_proc_root(void) {
#ifdef BATON_STORAGE_TEST_PROC
  return getenv("BATON_STORAGE_TEST_PROC");
#else
  return "/proc";
#endif
}

static void baton_storage_refs_unknown(pid_t pid, const char *operation,
                                       const char *path, int error, int *unknown) {
  *unknown = 1;
  fprintf(stderr, "storage process scan: pid=%ld operation=%s path=%s error=%d (%s)\n",
          (long)pid, operation, path, error, strerror(error));
}

static int baton_storage_gone(int error) {
  return error == ENOENT || error == ESRCH || error == ENOTDIR;
}

/* The effective UID and exit state come from the process's status record.
   proc inode ownership can change when a process disables dumping. */
static int baton_storage_process_current(const char *proc_root, pid_t pid, uid_t *owner, int *unknown) {
  char path[PATH_MAX];
  snprintf(path, sizeof(path), "%s/%ld/status", proc_root, (long)pid);
  FILE *status = fopen(path, "r");
  if (!status) {
    int error = errno;
    if (!baton_storage_gone(error)) baton_storage_refs_unknown(pid, "fopen", path, error, unknown);
    return 0;
  }
  char *line = NULL, state = 0;
  size_t capacity = 0;
  unsigned long real_uid = 0, effective_uid = 0;
  int have_uid = 0, error = 0;
  while (!state || !have_uid) {
    errno = 0;
    if (getline(&line, &capacity, status) < 0) {
      error = ferror(status) ? (errno ? errno : EIO) : EPROTO;
      break;
    }
    if (!strncmp(line, "State:", 6)) sscanf(line + 6, " %c", &state);
    if (!strncmp(line, "Uid:", 4)) have_uid = sscanf(line + 4, "%lu %lu", &real_uid, &effective_uid) == 2;
  }
  free(line);
  fclose(status);
  if (state == 'Z' || state == 'X') return 0;
  if (error) {
    struct stat current;
    if (stat(path, &current) && baton_storage_gone(errno)) return 0;
    if (!baton_storage_gone(error)) baton_storage_refs_unknown(pid, "getline", path, error, unknown);
    return 0;
  }
  *owner = (uid_t)effective_uid;
  return 1;
}

/* proc entries and descriptors can disappear while they are being read. */
static int baton_storage_path_hit(pid_t pid, const char *path, baton_u64 device,
                                  baton_u64 inode, int *unknown) {
  struct stat info;
  if (!stat(path, &info)) return (baton_u64)info.st_dev == device && (baton_u64)info.st_ino == inode;
  int error = errno;
  if (!baton_storage_gone(error)) baton_storage_refs_unknown(pid, "stat", path, error, unknown);
  return 0;
}

static int baton_storage_prefix(const char *root, const char *path) {
  size_t length = strlen(root);
  if (strncmp(path, root, length)) return 0;
  return path[length] == 0 || path[length] == '/';
}

/* A proc link target under the canonical candidate directory. */
static int baton_storage_link_hit(pid_t pid, const char *link, const char *root, int *unknown) {
  char buffer[PATH_MAX];
  ssize_t length = readlink(link, buffer, sizeof(buffer) - 1);
  if (length < 0) {
    int error = errno;
    if (!baton_storage_gone(error)) baton_storage_refs_unknown(pid, "readlink", link, error, unknown);
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
 * mapped file. Every directory and maps stream is read to its actual end. */
static int baton_storage_pid_hit(const char *proc_root, pid_t pid, baton_u64 device, baton_u64 inode,
                                 const char *root, int is_dir, int *unknown) {
  char path[PATH_MAX];
  snprintf(path, sizeof(path), "%s/%ld/cwd", proc_root, (long)pid);
  if (baton_storage_path_hit(pid, path, device, inode, unknown)) return 1;
  if (is_dir && baton_storage_link_hit(pid, path, root, unknown)) return 1;
  snprintf(path, sizeof(path), "%s/%ld/exe", proc_root, (long)pid);
  if (baton_storage_path_hit(pid, path, device, inode, unknown)) return 1;
  if (is_dir && baton_storage_link_hit(pid, path, root, unknown)) return 1;

  snprintf(path, sizeof(path), "%s/%ld/fd", proc_root, (long)pid);
  DIR *fds = opendir(path);
  if (!fds) {
    int error = errno;
    if (!baton_storage_gone(error)) baton_storage_refs_unknown(pid, "opendir", path, error, unknown);
  } else {
    for (;;) {
      errno = 0;
      struct dirent *entry = readdir(fds);
      if (!entry) {
        int error = errno;
        if (error && !baton_storage_gone(error)) baton_storage_refs_unknown(pid, "readdir", path, error, unknown);
        break;
      }
      if (!baton_storage_numeric(entry->d_name)) continue;
      char target_path[sizeof(path) + sizeof(entry->d_name)];
      snprintf(target_path, sizeof(target_path), "%s/%ld/fd/%s", proc_root, (long)pid, entry->d_name);
      if (baton_storage_path_hit(pid, target_path, device, inode, unknown)) { closedir(fds); return 1; }
      if (is_dir && baton_storage_link_hit(pid, target_path, root, unknown)) { closedir(fds); return 1; }
    }
    closedir(fds);
  }

  snprintf(path, sizeof(path), "%s/%ld/maps", proc_root, (long)pid);
  FILE *maps = fopen(path, "r");
  if (!maps) {
    int error = errno;
    if (!baton_storage_gone(error)) baton_storage_refs_unknown(pid, "fopen", path, error, unknown);
  } else {
    char *line = NULL;
    size_t capacity = 0;
    for (;;) {
      errno = 0;
      ssize_t length = getline(&line, &capacity, maps);
      if (length < 0) {
        int error = errno;
        if (!feof(maps) && !baton_storage_gone(error)) baton_storage_refs_unknown(pid, "getline", path, error ? error : EIO, unknown);
        break;
      }
      char *mapped = baton_storage_maps_path(line);
      if (!mapped || mapped[0] != '/') continue;
      if (baton_storage_path_hit(pid, mapped, device, inode, unknown)) { free(line); fclose(maps); return 1; }
      if (is_dir && baton_storage_prefix(root, mapped)) { free(line); fclose(maps); return 1; }
    }
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
    else {
      call->error = errno;
      int unknown = 0;
      baton_storage_refs_unknown(0, "lstat", call->path, call->error, &unknown);
    }
    return;
  }
  baton_u64 device = (baton_u64)target.st_dev, inode = (baton_u64)target.st_ino;
  int is_dir = S_ISDIR(target.st_mode);
  char *root = is_dir ? realpath(call->path, NULL) : NULL;
  if (is_dir && !root) {
    int unknown = 0;
    baton_storage_refs_unknown(0, "realpath", call->path, errno, &unknown);
    call->answer = strdup("unknown:root-unresolved");
    return;
  }
  const char *proc_root = baton_storage_proc_root();
  if (!proc_root || !*proc_root) {
    free(root);
    call->error = EINVAL;
    return;
  }
  DIR *proc = opendir(proc_root);
  if (!proc) {
    int error = errno;
    int unknown = 0;
    baton_storage_refs_unknown(0, "opendir", proc_root, error, &unknown);
    call->answer = strdup(error == ENOENT || error == ENOTDIR ? "unknown:non-linux" : "unknown:access");
    free(root);
    return;
  }
  BatonStoragePids pids = {NULL, 0, 0};
  int unknown = 0;
  for (;;) {
    errno = 0;
    struct dirent *entry = readdir(proc);
    if (!entry) {
      int error = errno;
      if (error) baton_storage_refs_unknown(0, "readdir", proc_root, error, &unknown);
      break;
    }
    if (!baton_storage_numeric(entry->d_name)) continue;
    pid_t pid = (pid_t)strtol(entry->d_name, NULL, 10);
    uid_t owner = 0;
    int pid_unknown = 0;
    if (!baton_storage_process_current(proc_root, pid, &owner, &pid_unknown)) {
      /* A live process whose status cannot be read may reference the target;
         an exited or vanished process cannot. */
      if (pid_unknown) unknown = 1;
      continue;
    }
    if (baton_storage_pid_hit(proc_root, pid, device, inode, root, is_dir, &pid_unknown)) {
      if (baton_storage_pid_push(&pids, pid)) { call->error = ENOMEM; break; }
    } else if (pid_unknown) {
      /* The process is live and its cwd, descriptors or mappings could not be
         read (for example another uid). Custody is unknown, so the candidate
         is preserved. */
      unknown = 1;
    }
  }
  closedir(proc);
  free(root);
  if (call->error) { free(pids.items); return; }
  const char *reason = unknown ? "read-failed" : "";
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

/* ---------- descendant uid boundary ---------- */

typedef struct { char *path, *answer; int error; } BatonStorageUid;

/* `own` when the path and every descendant belong to the caller's effective
   uid, `foreign:<name>` when another uid owns one entry, `unknown` when the
   tree or the path could not be read. Foreign ownership preserves the
   candidate because the host process scan may be unable to observe that uid. */
static void baton_storage_uid_call(IoWork *w) {
  BatonStorageUid *call = (BatonStorageUid *)w->data;
  struct stat info;
  if (lstat(call->path, &info)) { call->error = errno; return; }
  if (info.st_uid != geteuid()) { call->answer = strdup("foreign:(root)"); return; }
  if (!S_ISDIR(info.st_mode)) { call->answer = strdup("own"); return; }
  int fd = baton_storage_open_dir(call->path);
  if (fd < 0) { call->answer = strdup("unknown"); return; }
  char foreign[256];
  foreign[0] = 0;
  int error = baton_storage_uid_walk(fd, geteuid(), foreign, sizeof(foreign));
  close(fd);
  if (!error) { call->answer = strdup("own"); return; }
  if (error == EPERM) {
    char text[300];
    snprintf(text, sizeof(text), "foreign:%s", foreign[0] ? foreign : "(unreadable)");
    call->answer = strdup(text);
    return;
  }
  call->answer = strdup("unknown");
}

static Term baton_storage_uid_pack(Env e, IoWork *w) {
  BatonStorageUid *call = (BatonStorageUid *)w->data;
  Term result = call->error ? io_fail(e, call->error, "uid boundary scan failed")
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
/* ---------- cooperative root writer lease ---------- */

/* A configured root carries one lease file. Baton-owned writers open it and
 * take a shared flock for the duration of their writes. Cleanup takes an
 * exclusive flock before it removes anything. The kernel releases the lock
 * when the last descriptor for the open file description closes, so a crash
 * needs no timestamp, age or stale-lock recovery. The flock API is
 * cooperative: a process that writes the root without opening this file is
 * not blocked, and the process and runtime-reference evidence still preserves
 * its files. An external `flock -s ROOT/.baton-writer-lease` holder uses the
 * same file and blocks cleanup the same way a Baton writer does.
 *
 * Contention and every open or flock error answer `none`. Cleanup treats that
 * answer as a refusal rather than proceeding without ownership. */

#define BATON_STORAGE_LEASE ".baton-writer-lease"

typedef struct { char *root; int kind, handle; } BatonStorageLease;

static void baton_storage_lease_call(IoWork *w) {
  BatonStorageLease *call = (BatonStorageLease *)w->data;
  int root_fd = baton_storage_open_dir(call->root);
  if (root_fd < 0) return;
  int fd = openat(root_fd, BATON_STORAGE_LEASE,
                  O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0600);
  int saved = errno;
  close(root_fd);
  if (fd < 0) { errno = saved; return; }
  int operation = call->kind == 0 ? LOCK_SH : LOCK_EX;
  int held;
  do { held = flock(fd, operation | LOCK_NB); } while (held < 0 && errno == EINTR);
  if (held < 0) { close(fd); return; }
  call->handle = fd;
}

static Term baton_storage_lease_pack(Env e, IoWork *w) {
  BatonStorageLease *call = (BatonStorageLease *)w->data;
  char text[64];
  size_t length;
  if (call->handle < 0) {
    memcpy(text, "none", 4);
    length = 4;
  } else {
    int written = snprintf(text, sizeof(text), "handle:%d", call->handle);
    length = written > 0 ? (size_t)written : 0;
  }
  Term result = io_done(e, io_str(e, text, length));
  free(call->root);
  free(call);
  w->data = NULL;
  return result;
}

static Term baton_storage_lease_begin(Env e, Term *f, IoWork *w, int kind) {
  BatonStorageLease *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  call->kind = kind;
  call->handle = -1;
  u64 length = 0;
  call->root = io_cstr(e, f[0], &length);
  if (!call->root || strlen(call->root) != length) {
    free(call->root);
    free(call);
    return io_done(e, io_str(e, "none", 4));
  }
  w->data = (char *)call;
  return io_work(w, baton_storage_lease_call, baton_storage_lease_pack);
}

typedef struct { u32 handle; } BatonStorageLeaseRelease;

static void baton_storage_lease_release_call(IoWork *w) {
  BatonStorageLeaseRelease *call = (BatonStorageLeaseRelease *)w->data;
  close((int)call->handle);
}

static Term baton_storage_lease_release_pack(Env e, IoWork *w) {
  BatonStorageLeaseRelease *call = (BatonStorageLeaseRelease *)w->data;
  free(call);
  w->data = NULL;
  return io_done(e, term_pak(CID_UNIT, 0));
}

static Term baton_storage_lease_release_run(Env e, Term *f, IoWork *w) {
  BatonStorageLeaseRelease *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  call->handle = (u32)f[0];
  w->data = (char *)call;
  return io_work(w, baton_storage_lease_release_call, baton_storage_lease_release_pack);
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

#ifdef CID_STORAGEHOST_WRITER_TRY_ACQUIRE
static Term baton_storage_writer_try_acquire_run(Env e, Term *f, IoWork *w) {
  return baton_storage_lease_begin(e, f, w, 0);
}
static void __attribute__((constructor)) baton_storage_writer_try_acquire_use(void) {io_eff(CID_STORAGEHOST_WRITER_TRY_ACQUIRE, baton_storage_writer_try_acquire_run, 0);}
#endif

#ifdef CID_STORAGEHOST_CLEANUP_TRY_ACQUIRE
static Term baton_storage_cleanup_try_acquire_run(Env e, Term *f, IoWork *w) {
  return baton_storage_lease_begin(e, f, w, 1);
}
static void __attribute__((constructor)) baton_storage_cleanup_try_acquire_use(void) {io_eff(CID_STORAGEHOST_CLEANUP_TRY_ACQUIRE, baton_storage_cleanup_try_acquire_run, 0);}
#endif

#ifdef CID_STORAGEHOST_UID_BOUNDARY
static Term baton_storage_uid_run(Env e, Term *f, IoWork *w) {
  BatonStorageUid *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  u64 length = 0;
  call->path = io_cstr(e, f[0], &length);
  if (!call->path || strlen(call->path) != length) { free(call->path); free(call); return io_fail(e, EINVAL, "path contains NUL"); }
  w->data = (char *)call;
  return io_work(w, baton_storage_uid_call, baton_storage_uid_pack);
}
static void __attribute__((constructor)) baton_storage_uid_use(void) {io_eff(CID_STORAGEHOST_UID_BOUNDARY, baton_storage_uid_run, 0);}
#endif

#ifdef CID_STORAGEHOST_LEASE_RELEASE
static void __attribute__((constructor)) baton_storage_lease_release_use(void) {io_eff(CID_STORAGEHOST_LEASE_RELEASE, baton_storage_lease_release_run, 0);}
#endif
