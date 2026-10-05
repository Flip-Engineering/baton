/* Owned generic handler fixture for extractor smoke and mutation control.
 *
 * Mirrors the measured Fossil handler shape at small scale: a permission
 * guard on a global capability word, a direct helper call, a single string
 * literal SQL statement, and a local statement variable. This file is
 * acceptance input only; it is not producer truth for the authentic Fossil
 * qualification, which is the separate fossil-five-family harness.
 */
extern int db_prepare(const char *sql, ...);
extern int db_exec(const char *sql);
extern int g_perm;

struct stmt {
  int ready;
};

static struct stmt q;

int authorize_and_list(const char *user) {
  if ((g_perm & 2) == 0) {
    return 0;
  }
  db_exec("CREATE TEMP TABLE listed(rn)");
  q.ready = db_prepare("SELECT rn, title, owner FROM reportfmt ORDER BY title", 0, 0);
  if (q.ready != 0 || user == 0) {
    return 1;
  }
  return 0;
}
