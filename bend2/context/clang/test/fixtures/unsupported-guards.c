/* Unsupported-guard discriminators. Every condition here contains an
 * operand or call outside the supported guard profile: a call in the guard,
 * a volatile read, a pointer dereference, and an indirect call site. The
 * extractor must classify each condition unsupported with its reason and
 * claim no guarded_call relation for it, while the indirect call keeps its
 * unavailable callee identity. */
struct Ctx {
  int okRead;
  int okWrite;
};

struct Ctx g;

struct Stmt;
typedef struct Stmt Stmt;

volatile int vflag;
int counter;

int helper(Stmt *stmt, const char *sql);
int indirect(void);
int fetch(void);

void handler(void) {
  Stmt q;
  int (*fp)(void) = indirect;
  if (fetch() && !g.okRead) { /* call in guard */
    return;
  }
  if (vflag) { /* volatile operand */
    return;
  }
  if (*&counter) { /* dereference in guard */
    return;
  }
  if (helper(&q, "SELECT 1") != 0)
    return;
  fp(); /* indirect call: callee identity unavailable */
}
