/* Guard-change discriminator: same handler shape as guard-helper.c with a
 * different guard. The derived relation must follow the actual guard: the
 * single-condition denial guards the helper call with different exit sets
 * and operands than the two-leaf conjunction in guard-helper.c. */
struct Ctx {
  int okRead;
  int okWrite;
  int trace;
};

struct Ctx g;

struct Stmt;
typedef struct Stmt Stmt;

int opaque_prepare(Stmt *stmt, const char *sql);
int opaque_step(Stmt *stmt);
void deny_login(void);
const char *row_text(Stmt *stmt, int col);

void handler(void) {
  Stmt q;
  if (!g.okRead) {
    deny_login();
    return;
  }
  if (opaque_prepare(&q, "SELECT rn, title, owner FROM items ORDER BY title") != 0)
    return;
  while (opaque_step(&q) == 0) {
    const char *t = row_text(&q, 1);
    (void)t;
  }
}
