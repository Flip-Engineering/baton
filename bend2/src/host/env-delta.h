/* The env delta crosses as NUL-separated entries: NAME=VALUE sets or
   overrides that variable for the child, a bare NAME removes it from the
   inherited set, and an empty delta (length 0) inherits everything. An
   entry with an empty name - one that starts with '=' - is refused.

   Last writer wins: a set entry that a later bare NAME removes never
   reaches the child, and an inherited variable named by any entry is
   superseded.

   baton_envp_build returns an envp that aliases environ for inherited
   entries and owns one constructed string per surviving set entry;
   *built receives the owned strings and *built_count their number, for
   baton_envp_free. The parent's environ is never mutated. */

#ifndef BATON_ENV_DELTA_H
#define BATON_ENV_DELTA_H

#include <errno.h>
#include <stdlib.h>
#include <string.h>

/* Whether one delta entry (entry[0..n)) names the variable name[0..m):
   a set entry by its name before '=', a removal by equality. */
static int baton_env_names(const char *entry, size_t n,
                           const char *name, size_t m) {
  const char *equals = memchr(entry, '=', n);
  if (equals) return (size_t)(equals - entry) == m && !memcmp(entry, name, m);
  return n == m && !memcmp(entry, name, m);
}

/* Whether any delta entry names the variable. */
static int baton_env_touched(const char *delta, size_t length,
                             const char *name, size_t m) {
  for (size_t i = 0; i < length;) {
    size_t n = strnlen(delta + i, length - i);
    if (!n) { i += 1; continue; }
    if (baton_env_names(delta + i, n, name, m)) return 1;
    i += n + 1;
  }
  return 0;
}

/* Whether any entry after `from` names the variable set at delta[i0..],
   whose name is name[0..nl). A later set or a later bare NAME both
   supersede this entry: last writer wins either way. */
static int baton_env_superseded_later(const char *delta, size_t length,
                                      size_t from, const char *name,
                                      size_t nl) {
  for (size_t j = from; j < length;) {
    size_t m = strnlen(delta + j, length - j);
    if (!m) { j += 1; continue; }
    if (baton_env_names(delta + j, m, name, nl)) return 1;
    j += m + 1;
  }
  return 0;
}

static int baton_envp_build(const char *delta, size_t length, char ***out,
                            char ***built, size_t *built_count) {
  *out = NULL;
  *built = NULL;
  *built_count = 0;
  if (!length) return 0;
  size_t sets = 0;
  for (size_t i = 0; i < length;) {
    size_t n = strnlen(delta + i, length - i);
    if (!n) { i += 1; continue; }
    const char *equals = memchr(delta + i, '=', n);
    if (equals == delta + i) return EINVAL;
    if (equals) sets += 1;
    i += n + 1;
  }
  size_t slots = 0;
  for (char **e = environ; *e; e += 1) {
    const char *name = *e;
    const char *at = strchr(name, '=');
    size_t m = at ? (size_t)(at - name) : strlen(name);
    if (!baton_env_touched(delta, length, name, m)) slots += 1;
  }
  char **envp = malloc((slots + sets + 1) * sizeof(char *));
  if (!envp) return ENOMEM;
  char **owned = malloc((sets ? sets : 1) * sizeof(char *));
  if (!owned) { free(envp); return ENOMEM; }
  size_t used = 0;
  for (char **e = environ; *e; e += 1) {
    const char *name = *e;
    const char *at = strchr(name, '=');
    size_t m = at ? (size_t)(at - name) : strlen(name);
    if (!baton_env_touched(delta, length, name, m)) envp[used++] = *e;
  }
  size_t owned_used = 0;
  for (size_t i = 0; i < length;) {
    size_t n = strnlen(delta + i, length - i);
    if (!n) { i += 1; continue; }
    const char *equals = memchr(delta + i, '=', n);
    size_t start = i;
    i += n + 1;
    if (!equals) continue;
    /* Last writer wins: any later entry naming this variable - a later
       set or a later bare NAME - suppresses this set. */
    size_t name_length = (size_t)(equals - (delta + start));
    if (baton_env_superseded_later(delta, length, start + n + 1,
                                   delta + start, name_length)) continue;
    char *item = malloc(n + 1);
    if (!item) {
      for (size_t k = 0; k < owned_used; k += 1) free(owned[k]);
      free(owned);
      free(envp);
      return ENOMEM;
    }
    memcpy(item, delta + start, n);
    item[n] = 0;
    owned[owned_used++] = item;
    envp[used++] = item;
  }
  envp[used] = NULL;
  *out = envp;
  *built = owned;
  *built_count = owned_used;
  return 0;
}

static void baton_envp_free(char **envp, char **built, size_t built_count) {
  if (built) {
    for (size_t k = 0; k < built_count; k += 1) free(built[k]);
    free(built);
  }
  free(envp);
}

#endif
