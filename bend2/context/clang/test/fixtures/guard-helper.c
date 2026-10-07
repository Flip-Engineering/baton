/* Authentic-shaped guard/helper fixture for the clang-analyzer extractor.
 * The handler mirrors the supported shape: a global permission-record guard
 * whose denial continues to an explicit return, opaque intervening calls,
 * and a constant-SQL helper call bound to one local statement handle. */
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
void trace_begin(void);
void trace_end(void);
const char *row_text(Stmt *stmt, int col);

void handler(void) {
  Stmt q;
  trace_begin();
  if (!g.okRead && !g.okWrite) {
    deny_login();
    return;
  }
  if (opaque_prepare(&q, "SELECT rn, title, owner FROM items ORDER BY title") != 0)
    return;
  while (opaque_step(&q) == 0) {
    const char *t = row_text(&q, 1);
    (void)t;
  }
  trace_end();
}

/* Selected-function formals case: nonempty formals plus variadic tail. */
int opaque_prepare(Stmt *stmt, const char *sql, ...) {
  (void)stmt;
  (void)sql;
  return 0;
}
