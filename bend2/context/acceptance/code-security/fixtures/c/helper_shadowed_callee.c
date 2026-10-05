/* S10: a parameter named db_prepare shadows the global helper declaration. The
   call binds to the parameter, so the helper summary must not produce a
   modeled access edge. */
typedef struct Stmt Stmt;
extern int db_prepare(Stmt **pStmt, const char *zSql, ...);
extern int db_step(Stmt *pStmt);
extern void other_use(Stmt *pStmt);

typedef int (*prepare_fn)(Stmt **, const char *, ...);

int handler(int ok, prepare_fn db_prepare) {
  Stmt *q = 0;
  if (!ok) {
    return -1;
  }
  db_prepare(&q, "SELECT 1 FROM t");
  other_use(q);
  return db_step(q);
}
