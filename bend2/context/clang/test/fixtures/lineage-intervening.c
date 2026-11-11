/* Lineage discriminator: the step call shares the bound local statement, but
 * an intervening use of that local between the prepare call and the step
 * call refuses the derived lineage. The mapping/correspondence and guard
 * facts stay independent of this refusal. */
struct Stmt;
typedef struct Stmt Stmt;

int prepare(Stmt *stmt, const char *sql);
int step(Stmt *stmt);
void escape(Stmt *stmt);

void handler(void) {
  Stmt q;
  if (prepare(&q, "SELECT id FROM events") != 0)
    return;
  escape(&q); /* intervening use of the bound local */
  while (step(&q) == 0) {
  }
}
