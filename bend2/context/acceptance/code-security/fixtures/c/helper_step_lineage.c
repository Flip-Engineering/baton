/* S12: the stepping local is reassigned after preparation. The uncertain
   reaching definition refuses the step lineage, so no joined access edge is
   produced. */
typedef struct Stmt Stmt;
extern int db_prepare(Stmt **pStmt, const char *zSql, ...);
extern int db_step(Stmt *pStmt);

int handler(int ok, Stmt *pOther) {
  Stmt *q = 0;
  if (!ok) {
    return -1;
  }
  db_prepare(&q, "SELECT 1 FROM t");
  q = pOther;
  return db_step(q);
}
