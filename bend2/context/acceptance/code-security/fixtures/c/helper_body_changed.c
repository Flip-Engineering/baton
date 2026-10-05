/* S11: the preparation call leaves the reviewed literal-copy summary. The
   literal carries a percent and an extra variadic argument, so the summary
   does not produce a modeled access edge. */
typedef struct Stmt Stmt;
extern int db_prepare(Stmt **pStmt, const char *zSql, ...);
extern int db_step(Stmt *pStmt);

int handler(int ok, const char *zName) {
  Stmt *q = 0;
  if (!ok) {
    return -1;
  }
  db_prepare(&q, "SELECT name FROM t WHERE name = '%s'", zName);
  return db_step(q);
}
