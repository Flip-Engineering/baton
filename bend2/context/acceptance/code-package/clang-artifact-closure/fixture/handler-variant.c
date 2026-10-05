/* Mutation-control variant: the guard constant changes, so any derived
 * guard/deny relation must change; the SQL text and helper call are intact so
 * an unchanged relation proves the extractor ignored the actual guard.
 */
extern int db_prepare(const char *sql, ...);
extern int db_exec(const char *sql);
extern int g_perm;

struct stmt {
  int ready;
};

static struct stmt q;

int authorize_and_list(const char *user) {
  if ((g_perm & 8) == 0) {
    return 0;
  }
  db_exec("CREATE TEMP TABLE listed(rn)");
  q.ready = db_prepare("SELECT rn, title, owner FROM reportfmt ORDER BY title", 0, 0);
  if (q.ready != 0 || user == 0) {
    return 1;
  }
  return 0;
}
